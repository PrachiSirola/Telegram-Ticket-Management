import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessOrg, isClient, membershipIn, orgRole } from "../lib/access.js";
import {
  hashPassword,
  passwordContainsIdentityError,
  passwordStrengthError,
  PasswordPolicyError,
  verifyPassword,
} from "../lib/password.js";
import { assertPasswordNotReused, recordPasswordHistory } from "../lib/passwordHistory.js";
import { passwordChangedEmail, sendEmail } from "../lib/email.js";
import { developerVisibleProjectsWhere } from "../lib/projectAccess.js";
import { resolveWorkRange, type WorkRange } from "../lib/dateRanges.js";
import {
  countCompletedInRange,
  fetchCompletedWork,
  serializeTicket,
  workTicketInclude,
} from "../lib/myWork.js";
import { setPin, pinFormatError } from "../lib/twoFactor.js";
import {
  paginate,
  parsePageParams,
  TICKET_TIEBREAK,
  wantsPagination,
} from "../lib/pagination.js";

export const meRouter = Router();

const userSelect = { select: { id: true, name: true, email: true, avatarUrl: true } };
const profileSchema = z.object({ name: z.string().min(1).max(100) });

meRouter.patch("/profile", requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name is required." });
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { name: parsed.data.name.trim() },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  res.json(user);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().superRefine((password, ctx) => {
    const err = passwordStrengthError(password);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  }),
});

meRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const ok = await verifyPassword(parsed.data.currentPassword, current.passwordHash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect." });

  const identityErr = passwordContainsIdentityError(parsed.data.newPassword, current.email, current.name);
  if (identityErr) return res.status(400).json({ error: identityErr });

  try {
    await assertPasswordNotReused(current.id, current.passwordHash, parsed.data.newPassword);
  } catch (err) {
    if (err instanceof PasswordPolicyError) return res.status(400).json({ error: err.message });
    throw err;
  }

  await prisma.user.update({
    where: { id: current.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });
  await recordPasswordHistory(current.id, current.passwordHash);
  const mail = passwordChangedEmail(current.name);
  sendEmail({ ...mail, to: current.email });
  res.json({ ok: true });
});
meRouter.get("/tickets", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgId = String(req.query.orgId ?? "");
  const filter = (req.query.filter as string) ?? "assigned";
  if (!orgId || !canAccessOrg(user, orgId)) {
    return res.status(404).json({ error: "Organisation not found" });
  }
  const projectScope = isClient(user, orgId)
    ? {
        project: {
          orgId,
          clients: { some: { membershipId: membershipIn(user, orgId)!.id } },
        },
      }
    : { project: { orgId } };

  const who = filter === "reported" ? { reporterId: user.id } : { assigneeId: user.id };

  const where = { ...projectScope, ...who, archivedAt: null };
  const include = {
    assignee: userSelect,
    reporter: userSelect,
    project: { select: { id: true, name: true, orgId: true } },
  };
  const orderBy = [
    { dueDate: "asc" as const },
    { updatedAt: "desc" as const },
    TICKET_TIEBREAK,
  ];
  const shape = (t: any) => ({
    ...t,
    orgId: t.project.orgId,
    project: { id: t.project.id, name: t.project.name },
  });
  if (!wantsPagination(req.query)) {
    const tickets = await prisma.ticket.findMany({ where, include, orderBy });
    return res.json(tickets.map(shape));
  }

  const paged = await paginate(
    parsePageParams(req.query),
    () => prisma.ticket.count({ where }),
    (skip, take) => prisma.ticket.findMany({ where, include, orderBy, skip, take }),
  );
  res.json({ ...paged, items: paged.items.map(shape) });
});
meRouter.get("/work", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgId = String(req.query.orgId ?? "");
  if (!orgId || !canAccessOrg(user, orgId)) {
    return res.status(404).json({ error: "Organisation not found" });
  }

  const range = (["current", "today", "week", "prev_week", "month", "prev_month", "custom"] as const).includes(
    req.query.range as WorkRange,
  )
    ? (req.query.range as WorkRange)
    : "current";
  const window = resolveWorkRange(range, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  });

  const statusFilter = String(req.query.status ?? "all");
  const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
  const q = req.query.q ? String(req.query.q).trim() : "";

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize ?? "15"), 10) || 15));
  const completedPage = Math.max(1, parseInt(String(req.query.completedPage ?? "1"), 10) || 1);
  const completedPageSize = Math.min(
    50,
    Math.max(1, parseInt(String(req.query.completedPageSize ?? "15"), 10) || 15),
  );
  let projectScope: Record<string, unknown> = {};
  if (isClient(user, orgId)) {
    projectScope = { clients: { some: { membershipId: membershipIn(user, orgId)!.id } } };
  } else if (orgRole(user, orgId) === "DEVELOPER") {
    projectScope = developerVisibleProjectsWhere(user.id, membershipIn(user, orgId)!.id);
  }
  if (projectId) projectScope = { ...projectScope, id: projectId };

  const now = new Date();
  const searchWhere = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const rangeStart = window.start;
  const rangeEnd = window.end;
  const dueDateWhere = rangeStart && rangeEnd ? { dueDate: { gte: rangeStart, lte: rangeEnd } } : {};
  const baseWhere = {
    assigneeId: user.id,
    archivedAt: null,
    project: { orgId, ...projectScope },
    ...searchWhere,
    ...(range === "current" ? {} : dueDateWhere),
  };

  const completedScope = { orgId, userId: user.id, projectScope, searchWhere, window, range };
  const [assignedCount, inProgressCount, overdueCount, completedCount] = await Promise.all([
    prisma.ticket.count({ where: baseWhere as any }),
    prisma.ticket.count({ where: { ...baseWhere, status: "IN_PROGRESS" } as any }),
    prisma.ticket.count({
      where: {
        assigneeId: user.id,
        archivedAt: null,
        project: { orgId, ...projectScope },
        ...searchWhere,
        status: { not: "DONE" },
        dueDate: { lt: now },
      } as any,
    }),
    countCompletedInRange(completedScope),
  ]);
  let statusWhere: Record<string, unknown> = {};
  if (statusFilter === "pending") statusWhere = { status: "OPEN" };
  else if (statusFilter === "in_progress") statusWhere = { status: "IN_PROGRESS" };
  else if (statusFilter === "completed") statusWhere = { status: "DONE" };
  else if (statusFilter === "overdue") statusWhere = { status: { not: "DONE" }, dueDate: { lt: now } };

  const workWhere = { ...baseWhere, ...statusWhere };
  const [workItems, workTotal] = await prisma.$transaction([
    prisma.ticket.findMany({
      where: workWhere as any,
      include: workTicketInclude,
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ticket.count({ where: workWhere as any }),
  ]);
  const completedWork = await fetchCompletedWork({
    ...completedScope,
    page: completedPage,
    pageSize: completedPageSize,
  });

  res.json({
    summary: {
      assigned: assignedCount,
      inProgress: inProgressCount,
      completed: completedCount,
      overdue: overdueCount,
    },
    work: { items: workItems.map(serializeTicket), total: workTotal, page, pageSize },
    completedWork,
  });
});
meRouter.get("/notifications", requireAuth, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    include: {
      ticket: {
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { name: true, orgId: true, org: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = notifications.filter((n) => !n.isRead).length;
  res.json({
    unread,
    notifications: notifications.map((n) => ({
      ...n,
      ticket: {
        id: n.ticket.id,
        title: n.ticket.title,
        projectId: n.ticket.projectId,
        orgId: n.ticket.project.orgId,
        orgName: n.ticket.project.org.name,
      },
    })),
  });
});

meRouter.post("/notifications/:id/read", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: { isRead: true },
  });
  res.json({ ok: true });
});

meRouter.post("/notifications/read-all", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true });
});


meRouter.get("/2fa", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { twoFactorEnabled: true, twoFactorMethod: true, pinHash: true },
  });
  res.json({
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorMethod: user.twoFactorMethod,
    hasPin: Boolean(user.pinHash),
  });
});

const setPinSchema = z.object({
  currentPassword: z.string().min(1),
  pin: z.string().min(1),
  confirmPin: z.string().min(1),
});

meRouter.post("/2fa/pin", requireAuth, async (req, res) => {
  const parsed = setPinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { currentPassword, pin, confirmPin } = parsed.data;

  if (pin !== confirmPin) return res.status(400).json({ error: "PINs don't match." });
  const formatErr = pinFormatError(pin);
  if (formatErr) return res.status(400).json({ error: formatErr });

  const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const ok = await verifyPassword(currentPassword, current.passwordHash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect." });
  const identityErr = passwordContainsIdentityError(pin, current.email, current.name);
  if (identityErr) return res.status(400).json({ error: "PIN can't contain your name or email." });

  await setPin(current.id, pin);
  res.json({ ok: true });
});

const toggleSchema = z.object({
  enabled: z.boolean(),
  method: z.enum(["PIN", "PASSKEY"]).optional(),
});

meRouter.post("/2fa/toggle", requireAuth, async (req, res) => {
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { enabled, method } = parsed.data;

  if (enabled) {
    if (method === "PIN") {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
      if (!user.pinHash) return res.status(400).json({ error: "Set a PIN before enabling it." });
    } else if (method === "PASSKEY") {
      return res.status(400).json({ error: "Passkey 2FA isn't available yet." });
    } else {
      return res.status(400).json({ error: "Choose a 2FA method." });
    }
  }

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { twoFactorEnabled: enabled, twoFactorMethod: enabled ? method : null },
    select: { twoFactorEnabled: true, twoFactorMethod: true },
  });
  res.json(user);
});