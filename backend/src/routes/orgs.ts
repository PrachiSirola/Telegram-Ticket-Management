import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole } from "../middleware/org.js";
import { isOrgSA, orgRole, canCreateOrganisation } from "../lib/access.js";
import {
  InvalidOrgCreationTokenError,
  NotPlatformAdminError,
  requestOrgCreation,
  verifyAndCreateOrg,
} from "../lib/orgCreation.js";
import { orgCreationVerifyEmail, sendEmail } from "../lib/email.js";
import { env } from "../env.js";
import { paginate, parsePageParams, TICKET_TIEBREAK } from "../lib/pagination.js";

export const orgsRouter = Router();

/** Mask a secret for display: keep the last 4 chars. */
function mask(secret: string | null): string | null {
  if (!secret) return null;
  return `••••${secret.slice(-4)}`;
}

function serializeOrg(org: {
  id: string;
  name: string;
  telegramBotToken: string | null;
  telegramChatId: string | null;
}) {
  return {
    id: org.id,
    name: org.name,
    telegramBotToken: mask(org.telegramBotToken),
    telegramChatId: org.telegramChatId,
    telegramConfigured: Boolean(org.telegramBotToken && org.telegramChatId),
  };
}

// List my organisations (with my role in each).
orgsRouter.get("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgs = await prisma.organization.findMany({
    where: { id: { in: user.memberships.map((m) => m.orgId) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  res.json(
    orgs.map((o) => ({ id: o.id, name: o.name, role: orgRole(user, o.id) })),
  );
});

// Create a new organisation — a two-step, email-confirmed flow restricted to
// Super Admins (see lib/access.ts canCreateOrganisation). Admins, Developers
// and Clients are refused here regardless of what the UI shows. Step 1 here just sends the confirmation email; the org is
// only actually created once that link is clicked (see /create/verify below).
const createRequestSchema = z.object({ name: z.string().min(1).max(100) });
orgsRouter.post("/create/request", requireAuth, async (req, res) => {
  if (!canCreateOrganisation(req.user!)) {
    return res.status(403).json({
      error: "Only a Super Admin can create organisations.",
    });
  }
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Organisation name is required." });

  try {
    const { token } = await requestOrgCreation(req.user!, parsed.data.name);
    const verifyUrl = `${env.frontendUrl}/create-org/verify?token=${token}`;
    const mail = orgCreationVerifyEmail(req.user!.name, parsed.data.name.trim(), verifyUrl);
    await sendEmail({ ...mail, to: req.user!.email });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof NotPlatformAdminError) return res.status(403).json({ error: err.message });
    throw err;
  }
});

// Step 2: consumes the emailed link and actually creates the organisation.
const createVerifySchema = z.object({ token: z.string().min(1) });
orgsRouter.post("/create/verify", requireAuth, async (req, res) => {
  const parsed = createVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing verification token." });
  try {
    const { org } = await verifyAndCreateOrg(parsed.data.token, req.user!.id);
    res.status(201).json({ id: org.id, name: org.name, role: "SUPER_ADMIN" });
  } catch (err) {
    if (err instanceof InvalidOrgCreationTokenError) return res.status(400).json({ error: err.message });
    if (err instanceof NotPlatformAdminError) return res.status(403).json({ error: err.message });
    throw err;
  }
});

// Org settings (name, Telegram). Super Admin only. Bot token is write-only:
// responses carry a masked value; sending an empty string clears it.
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  telegramBotToken: z.string().max(200).optional(),
  telegramChatId: z.string().max(100).optional(),
});

// Settings are visible to SA and Admins (Admins only get the Telegram part).
orgsRouter.get(
  "/:orgId/settings",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.params.orgId } });
    res.json(serializeOrg(org));
  },
);

orgsRouter.patch(
  "/:orgId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    const b = parsed.data;
    // Admins may only manage Telegram config; renaming the org is SA-only.
    if (b.name !== undefined && !isOrgSA(req.user!, req.params.orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can rename the organisation" });
    }
    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: {
        ...(b.name !== undefined ? { name: b.name.trim() } : {}),
        ...(b.telegramBotToken !== undefined
          ? { telegramBotToken: b.telegramBotToken || null }
          : {}),
        ...(b.telegramChatId !== undefined ? { telegramChatId: b.telegramChatId || null } : {}),
      },
    });
    res.json(serializeOrg(org));
  },
);

// Delete the organisation (cascades projects, tickets, memberships, invites).
orgsRouter.delete(
  "/:orgId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN"),
  async (req, res) => {
    await prisma.organization.delete({ where: { id: req.params.orgId } });
    res.json({ ok: true });
  },
);

// Hand the Super Admin role to an existing Admin; the old SA becomes an Admin.
// Single transaction (demote first — the partial unique index enforces the
// exactly-one-SA invariant).
const transferSchema = z.object({ userId: z.string().min(1) });
orgsRouter.post(
  "/:orgId/transfer-ownership",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN"),
  async (req, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "userId is required" });
    const orgId = req.params.orgId;
    const target = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: parsed.data.userId, orgId } },
    });
    if (!target || target.disabled || target.role !== "ADMIN") {
      return res.status(400).json({ error: "Ownership can only be transferred to an active Admin" });
    }
    await prisma.$transaction([
      prisma.orgMembership.update({
        where: { userId_orgId: { userId: req.user!.id, orgId } },
        data: { role: "ADMIN" },
      }),
      prisma.orgMembership.update({
        where: { id: target.id },
        data: { role: "SUPER_ADMIN" },
      }),
    ]);
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// Full member list (incl. disabled) — management view for SA/Admin.
//
// Pagination is OPT-IN, same convention as the projects list: `page` present
// → `{ items, total, page, pageSize }` envelope (used by the Members page);
// omitted → the plain array as always (used by OrgSettings' ownership-transfer
// admin picker, which needs the complete list regardless of any page state).
const MEMBERS_MAX_PAGE_SIZE = 100;

orgsRouter.get(
  "/:orgId/members",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
    async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const where = {
      orgId: req.params.orgId,
      ...(q
        ? {
            user: {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };
    const include = {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      projectAccess: { select: { projectId: true } },
    };
    const orderBy = [{ disabled: "asc" as const }, { createdAt: "asc" as const }];
    const serializeMember = (m: any) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      disabled: m.disabled,
      projectIds: m.projectAccess.map((p: { projectId: string }) => p.projectId),
      createdAt: m.createdAt,
    });

    const pageRaw = req.query.page;
    if (pageRaw === undefined) {
      const members = await prisma.orgMembership.findMany({ where, include, orderBy });
      return res.json(members.map(serializeMember));
    }

    const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
    const pageSize = Math.min(
      MEMBERS_MAX_PAGE_SIZE,
      Math.max(1, parseInt(String(req.query.pageSize ?? "10"), 10) || 10),
    );
    const [items, total] = await prisma.$transaction([
      prisma.orgMembership.findMany({
        where,
        include,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.orgMembership.count({ where }),
    ]);
    res.json({ items: items.map(serializeMember), total, page, pageSize });
  },
);


const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);
const memberTicketFilterSchema = z.object({
  status: z.preprocess(emptyToUndef, z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional()),
  priority: z.preprocess(emptyToUndef, z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()),
  type: z.preprocess(emptyToUndef, z.enum(["BUG", "FEATURE", "TASK"]).optional()),
});

const ticketUserSelect = { select: { id: true, name: true, email: true, avatarUrl: true } };
const memberTicketInclude = {
  assignee: ticketUserSelect,
  reporter: ticketUserSelect,
  project: { select: { id: true, name: true, orgId: true } },
};
function serializeMemberTicket(t: any) {
  return {
    id: t.id,
    projectId: t.projectId,
    orgId: t.project?.orgId,
    project: t.project ? { id: t.project.id, name: t.project.name } : undefined,
    title: t.title,
    status: t.status,
    priority: t.priority,
    type: t.type,
    dueDate: t.dueDate,
    assignee: t.assignee ?? null,
    reporter: t.reporter ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// Single member's profile view: their role/status plus which projects they
// have access to and how their assigned tickets break down by status.
// SA/Admin implicitly have every org project; Developer/Client access is
// explicit (ProjectDeveloper/ProjectClient), so both tables are checked.
orgsRouter.get(
  "/:orgId/members/:userId/detail",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const orgId = req.params.orgId;
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: req.params.userId, orgId } },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
    if (!membership) return res.status(404).json({ error: "Member not found" });

    const projects =
      membership.role === "SUPER_ADMIN" || membership.role === "ADMIN"
        ? await prisma.project.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : await prisma.project.findMany({
            where: {
              orgId,
              OR: [
                { developers: { some: { membershipId: membership.id } } },
                { clients: { some: { membershipId: membership.id } } },
              ],
            },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          });

    const counts = await prisma.ticket.groupBy({
      by: ["status"],
      where: { assigneeId: membership.userId, archivedAt: null, project: { orgId } },
      _count: true,
    });
    const ticketCounts = { OPEN: 0, IN_PROGRESS: 0, DONE: 0 };
    let total = 0;
    for (const c of counts) {
      ticketCounts[c.status as keyof typeof ticketCounts] = c._count;
      total += c._count;
    }

    res.json({
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      avatarUrl: membership.user.avatarUrl,
      role: membership.role,
      disabled: membership.disabled,
      createdAt: membership.createdAt,
      projects,
      ticketCounts: { ...ticketCounts, total },
    });
  },
);

// Paginated, filterable list of tickets assigned to this member across the
// org (any project) — powers the Member Detail page's ticket table.
orgsRouter.get(
  "/:orgId/members/:userId/tickets",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const orgId = req.params.orgId;
    const filters = memberTicketFilterSchema.safeParse(req.query);
    if (!filters.success) return res.status(400).json({ error: "Invalid filter value" });
    const { status, priority, type } = filters.data;

    const where = {
      assigneeId: req.params.userId,
      archivedAt: null,
      project: { orgId },
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(type ? { type } : {}),
    };

    // Always paginated (existing behaviour). Default page size stays 10 for
    // callers that don't send one; max is now 100 to match the UI options.
    // `id` tiebreak keeps the order total so pages never overlap/skip.
    const paged = await paginate(
      parsePageParams(req.query, 10),
      () => prisma.ticket.count({ where }),
      (skip, take) =>
        prisma.ticket.findMany({
          where,
          include: memberTicketInclude,
          orderBy: [{ updatedAt: "desc" }, TICKET_TIEBREAK],
          skip,
          take,
        }),
    );
    res.json({ ...paged, items: paged.items.map(serializeMemberTicket) });
  },
);

/**
 * Guard for member-management writes. Rules:
 *  - The SA membership can never be modified (only transfer/delete-org).
 *  - You can't modify yourself.
 *  - ADMIN targets: SA only. DEVELOPER/CLIENT targets: SA or ADMIN.
 */
async function loadManagedMember(req: any, res: any) {
  const orgId = req.params.orgId;
  const target = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: req.params.userId, orgId } },
  });
  if (!target) {
    res.status(404).json({ error: "Member not found" });
    return null;
  }
  if (target.role === "SUPER_ADMIN") {
    res.status(400).json({ error: "The Super Admin can't be modified. Transfer ownership instead." });
    return null;
  }
  if (target.userId === req.user!.id) {
    res.status(400).json({ error: "You can't modify your own membership" });
    return null;
  }
  if (target.role === "ADMIN" && !isOrgSA(req.user!, orgId)) {
    res.status(403).json({ error: "Only the Super Admin can manage Admins" });
    return null;
  }
  return target;
}

const memberPatchSchema = z.object({
  role: z.enum(["ADMIN", "DEVELOPER", "CLIENT"]).optional(),
  disabled: z.boolean().optional(),
});

orgsRouter.patch(
  "/:orgId/members/:userId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const parsed = memberPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    const target = await loadManagedMember(req, res);
    if (!target) return;
    // Promoting someone TO Admin is Admin-management — SA only.
    if (parsed.data.role === "ADMIN" && !isOrgSA(req.user!, req.params.orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can promote to Admin" });
    }
    const updated = await prisma.orgMembership.update({
      where: { id: target.id },
      data: parsed.data,
    });
    res.json({ ok: true, role: updated.role, disabled: updated.disabled });
  },
);

// Remove a member from the org entirely (project attachments cascade).
orgsRouter.delete(
  "/:orgId/members/:userId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const target = await loadManagedMember(req, res);
    if (!target) return;
    await prisma.orgMembership.delete({ where: { id: target.id } });
    res.json({ ok: true });
  },
);