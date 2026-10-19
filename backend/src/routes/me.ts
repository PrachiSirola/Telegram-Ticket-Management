import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessOrg } from "../lib/access.js";
import {
  passwordContainsIdentityError,
  passwordStrengthError,
  PasswordPolicyError,
  verifyPassword,
} from "../lib/password.js";
import { changePasswordWithHistory } from "../lib/credentialHistory.js";
import { passwordChangedEmail, sendEmail } from "../lib/email.js";
import { scopedProjectIds } from "../lib/projectAccess.js";
import { contains } from "../lib/mongoFilters.js";
import { hydrateTickets } from "../lib/hydrate.js";
import { queryTickets } from "../lib/ticketQuery.js";
import { parseDueRange } from "../lib/dueRange.js";
import { listAssigners, ticketIdsAssignedBy, withAssignmentInfo } from "../lib/assignedBy.js";
import { dueDateFilter, isValidYmd, resolveWorkRange, ymdInZone, WORK_RANGES, type WorkRange } from "../lib/dateRanges.js";
import { countCompletedInRange, fetchCompletedWork, serializeTicket } from "../lib/myWork.js";
import { setPin, pinFormatError, PinReuseError } from "../lib/twoFactor.js";
import { authenticatorRouter } from "./authenticator.js";
import { paginate, parsePageParams, wantsPagination } from "../lib/pagination.js";

export const meRouter = Router();

const profileSchema = z.object({ name: z.string().min(1).max(100) });

meRouter.patch("/profile", requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Name is required." });
  const user = await db.users.mustUpdate({ _id: req.user!.id }, { name: parsed.data.name.trim() });
  res.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl });
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
  const current = await db.users.mustById(req.user!.id);
  const ok = await verifyPassword(parsed.data.currentPassword, current.passwordHash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect." });

  const identityErr = passwordContainsIdentityError(parsed.data.newPassword, current.email, current.name);
  if (identityErr) return res.status(400).json({ error: identityErr });

  try {
    await changePasswordWithHistory(current.id, parsed.data.newPassword, {
      verify: async (_tx, locked) => {
        if (!(await verifyPassword(parsed.data.currentPassword, locked.passwordHash))) {
          throw new PasswordPolicyError("Current password is incorrect.");
        }
      },
    });
  } catch (err) {
    if (err instanceof PasswordPolicyError) return res.status(400).json({ error: err.message });
    throw err;
  }
  const mail = passwordChangedEmail(current.name);
  sendEmail({ ...mail, to: current.email });
  res.json({ ok: true });
});

const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));
const myTicketsFilterSchema = z.object({
  status: z.preprocess(emptyToUndef, z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional()),
  priority: z.preprocess(emptyToUndef, z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()),
  dueFrom: z.preprocess(emptyToUndef, ymd.optional()),
  dueTo: z.preprocess(emptyToUndef, ymd.optional()),
});

meRouter.get("/tickets", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgId = String(req.query.orgId ?? "");
  const filter = (req.query.filter as string) ?? "assigned";
  if (!orgId || !canAccessOrg(user, orgId)) {
    return res.status(404).json({ error: "Organisation not found" });
  }

  const projectIds = await scopedProjectIds(user, orgId, { archivedAt: null });
  const who = filter === "reported" ? { reporterId: user.id } : { assigneeIds: user.id };

  const filters = myTicketsFilterSchema.safeParse(req.query);
  if (!filters.success) return res.status(400).json({ error: "Invalid filter value" });
  const { status, priority } = filters.data;

  const orgRow = await db.orgs.byId(orgId);
  const due = parseDueRange(req.query, orgRow?.timezone);
  if (!due.ok) return res.status(400).json({ error: due.error });

  const where = {
    projectId: { $in: projectIds },
    ...who,
    archivedAt: null,
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...due.where,
  };
  const shape = (t: any) => ({
    ...t,
    orgId: t.project.orgId,
    project: { id: t.project.id, name: t.project.name },
  });

  if (!wantsPagination(req.query)) {
    const tickets = await hydrateTickets(await queryTickets(where, "due"));
    return res.json(tickets.map(shape));
  }

  const paged = await paginate(
    parsePageParams(req.query),
    () => db.tickets.count(where),
    async (skip, take) => hydrateTickets(await queryTickets(where, "due", { skip, take })),
  );
  res.json({ ...paged, items: paged.items.map(shape) });
});

meRouter.get("/work", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgId = String(req.query.orgId ?? "");
  if (!orgId || !canAccessOrg(user, orgId)) {
    return res.status(404).json({ error: "Organisation not found" });
  }

  const rawRange = req.query.range === "current" ? "all" : req.query.range;
  const range: WorkRange = WORK_RANGES.includes(rawRange as WorkRange) ? (rawRange as WorkRange) : "all";
  const from = req.query.from ? String(req.query.from) : undefined;
  const to = req.query.to ? String(req.query.to) : undefined;
  if (range === "custom") {
    if ((from && !isValidYmd(from)) || (to && !isValidYmd(to))) {
      return res.status(400).json({ error: "Dates must be valid yyyy-mm-dd values." });
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: "The start date must be on or before the end date." });
    }
  }
  const priorityParam = req.query.priority ? String(req.query.priority) : undefined;
  if (priorityParam && !["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priorityParam)) {
    return res.status(400).json({ error: "Invalid priority" });
  }
  const org = await db.orgs.byId(orgId);
  const timezone = org?.timezone ?? "UTC";
  const window = resolveWorkRange(range, { from, to }, timezone);

  const statusFilter = String(req.query.status ?? "all");
  const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
  const q = req.query.q ? String(req.query.q).trim() : "";

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "15"), 10) || 15));
  const completedPage = Math.max(1, parseInt(String(req.query.completedPage ?? "1"), 10) || 1);
  const completedPageSize = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.completedPageSize ?? "15"), 10) || 15),
  );


  let projectIds = await scopedProjectIds(user, orgId, { archivedAt: null });
  if (projectId) projectIds = projectIds.filter((id) => id === projectId);

  const overdueBefore = new Date(`${ymdInZone(new Date(), timezone)}T00:00:00Z`);

  const assignedByParam = req.query.assignedBy ? String(req.query.assignedBy) : undefined;
  const assignedByIds = assignedByParam ? await ticketIdsAssignedBy(user.id, assignedByParam) : undefined;
  const searchWhere: Record<string, unknown> = {
    ...(assignedByIds ? { _id: { $in: assignedByIds } } : {}),
    ...(q ? { $or: [{ title: contains(q) }, { description: contains(q) }] } : {}),
    ...(priorityParam ? { priority: priorityParam } : {}),
  };
  const dueDateWhere = dueDateFilter(window);
  const baseWhere = {
    assigneeIds: user.id,
    archivedAt: null,
    projectId: { $in: projectIds },
    ...searchWhere,
    ...dueDateWhere,
  };

  const completedScope = { orgId, userId: user.id, projectIds, searchWhere, window };
  const [assignedCount, openCount, inProgressCount, overdueCount, completedCount] = await Promise.all([
    db.tickets.count(baseWhere),
    db.tickets.count({ ...baseWhere, status: "OPEN" }),
    db.tickets.count({ ...baseWhere, status: "IN_PROGRESS" }),
    db.tickets.count({
      assigneeIds: user.id,
      archivedAt: null,
      projectId: { $in: projectIds },
      ...searchWhere,
      status: { $ne: "DONE" },
      dueDate: { $lt: overdueBefore },
    }),
    countCompletedInRange(completedScope),
  ]);

  let statusWhere: Record<string, unknown> = {};

  if (statusFilter === "pending" || statusFilter === "open") statusWhere = { status: "OPEN" };
  else if (statusFilter === "in_progress") statusWhere = { status: "IN_PROGRESS" };
  else if (statusFilter === "completed") statusWhere = { status: "DONE" };
  else if (statusFilter === "overdue") statusWhere = { status: { $ne: "DONE" }, dueDate: { $lt: overdueBefore } };

  let work: { items: unknown[]; total: number; page: number; pageSize: number };
  if (statusFilter === "completed") {
    work = await fetchCompletedWork({ ...completedScope, page, pageSize });
  } else {
    const { dueDate: _ignored, ...baseNoDue } = baseWhere as any;
    const workWhere =
      statusFilter === "overdue"
        ? { ...baseNoDue, ...statusWhere }
        : { ...baseWhere, ...statusWhere };
    const [workItems, workTotal] = await Promise.all([
      queryTickets(workWhere, "due", { skip: (page - 1) * pageSize, take: pageSize }).then(hydrateTickets),
      db.tickets.count(workWhere),
    ]);
    work = { items: workItems.map(serializeTicket), total: workTotal, page, pageSize };
  }
  const completedWork = await fetchCompletedWork({
    ...completedScope,
    page: completedPage,
    pageSize: completedPageSize,
  });

  work.items = await withAssignmentInfo(work.items as any[]);
  completedWork.items = await withAssignmentInfo(completedWork.items as any[]);

  const myTicketIds = await db.tickets.distinct("_id", {
    assigneeIds: user.id,
    archivedAt: null,
    projectId: { $in: projectIds },
  });
  const assigners = await listAssigners(myTicketIds);

  res.json({
    summary: {
      assigned: assignedCount, 
      open: openCount,
      inProgress: inProgressCount,
      completed: completedCount,
      overdue: overdueCount,
    },
    work,
    completedWork,
    assigners,
    window: { range, fromDay: window.fromDay, toDay: window.toDay, timezone },
  });
});

meRouter.get("/notifications", requireAuth, async (req, res) => {
  const notifications = await db.notifications.find(
    { userId: req.user!.id },
    { sort: { createdAt: -1, _id: -1 }, limit: 50 },
  );
  const tickets = await db.tickets.find({ _id: { $in: [...new Set(notifications.map((n) => n.ticketId))] } });
  const projects = await db.projects.find({ _id: { $in: [...new Set(tickets.map((t) => t.projectId))] } });
  const orgs = await db.orgs.find({ _id: { $in: [...new Set(projects.map((p) => p.orgId))] } });
  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const unread = notifications.filter((n) => !n.isRead).length;
  res.json({
    unread,
    notifications: notifications.flatMap((n) => {
      const t = ticketById.get(n.ticketId);
      const p = t && projectById.get(t.projectId);
      if (!t || !p) return [];
      return [
        {
          ...n,
          ticket: { id: t.id, title: t.title, projectId: t.projectId, orgId: p.orgId, orgName: orgById.get(p.orgId)?.name ?? "" },
        },
      ];
    }),
  });
});

meRouter.post("/notifications/:id/read", requireAuth, async (req, res) => {
  await db.notifications.updateMany({ _id: req.params.id, userId: req.user!.id }, { isRead: true });
  res.json({ ok: true });
});

meRouter.post("/notifications/read-all", requireAuth, async (req, res) => {
  await db.notifications.updateMany({ userId: req.user!.id, isRead: false }, { isRead: true });
  res.json({ ok: true });
});


meRouter.get("/2fa", requireAuth, async (req, res) => {
  const user = await db.users.mustById(req.user!.id);
  res.json({
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorMethod: user.twoFactorMethod,
    hasPin: Boolean(user.pinHash),
  });
});


meRouter.use("/2fa/authenticator", authenticatorRouter);


const pinActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PIN_ACTION_RATE_LIMIT) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `user:${req.user?.id ?? ipKeyGenerator(req.ip ?? "")}`,
  message: { error: "Too many attempts. Please try again later." },
});

const setPinSchema = z.object({
  currentPassword: z.string().min(1),
  pin: z.string().min(1),
  confirmPin: z.string().min(1),
});

meRouter.post("/2fa/pin", requireAuth, pinActionLimiter, async (req, res) => {
  const parsed = setPinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { currentPassword, pin, confirmPin } = parsed.data;

  if (pin !== confirmPin) return res.status(400).json({ error: "PINs don't match." });
  const formatErr = pinFormatError(pin);
  if (formatErr) return res.status(400).json({ error: formatErr });

  const current = await db.users.mustById(req.user!.id);
  const ok = await verifyPassword(currentPassword, current.passwordHash);
  if (!ok) return res.status(400).json({ error: "Current password is incorrect." });


  const identityErr = passwordContainsIdentityError(pin, current.email, current.name);
  if (identityErr) return res.status(400).json({ error: "PIN can't contain your name or email." });

  try {

    await setPin(current.id, pin);
  } catch (err) {
    if (err instanceof PinReuseError) return res.status(400).json({ error: err.message });
    throw err;
  }
  res.json({ ok: true });
});

const toggleSchema = z.object({
  enabled: z.boolean(),
  method: z.enum(["PIN", "PASSKEY"]).optional(),
  currentPassword: z.string().min(1).max(1000),
});


meRouter.post("/2fa/toggle", requireAuth, pinActionLimiter, async (req, res) => {
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    const missingPassword = !req.body || typeof req.body.currentPassword !== "string" || req.body.currentPassword === "";
    return res.status(400).json({ error: missingPassword ? "Enter your current password." : "Invalid input" });
  }
  const { enabled, method, currentPassword } = parsed.data;

  const account = await db.users.mustById(req.user!.id);
  if (!(await verifyPassword(currentPassword, account.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }

  if (enabled) {
    if (method === "PIN") {
      const user = account;
      if (!user.pinHash) return res.status(400).json({ error: "Set a PIN before enabling it." });
    } else if (method === "PASSKEY") {
      return res.status(400).json({ error: "Passkey 2FA isn't available yet." });
    } else {
      return res.status(400).json({ error: "Choose a 2FA method." });
    }
  }

  const user = await db.users.mustUpdate(
    { _id: req.user!.id },
    { twoFactorEnabled: enabled, twoFactorMethod: enabled ? method : null },
  );
  res.json({ twoFactorEnabled: user.twoFactorEnabled, twoFactorMethod: user.twoFactorMethod });
});