import { Router } from "express";
import { z } from "zod";
import { db, deleteMembershipCascade, deleteOrganizationCascade, withTransaction } from "../db/index.js";
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
import { confirmed } from "../lib/confirmName.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { contains, OPEN_STATUSES } from "../lib/mongoFilters.js";
import { hydrateTickets } from "../lib/hydrate.js";
import { paginate, parsePageParams } from "../lib/pagination.js";
import { parseDueRange } from "../lib/dueRange.js";

export const orgsRouter = Router();
function mask(secret: string | null): string | null {
  if (!secret) return null;
  return `••••${secret.slice(-4)}`;
}

function serializeOrg(org: {
  id: string;
  name: string;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  timezone: string;
}) {
  return {
    id: org.id,
    name: org.name,
    timezone: org.timezone,
    telegramBotToken: mask(org.telegramBotToken),
    telegramChatId: org.telegramChatId,
    telegramConfigured: Boolean(org.telegramBotToken && org.telegramChatId),
  };
}
orgsRouter.get("/", requireAuth, async (req, res) => {
  const user = req.user!;
  const orgs = await db.orgs.find(
    { _id: { $in: user.memberships.map((m) => m.orgId) } },
    { sort: { name: 1 }, ci: true },
  );
  res.json(
    orgs.map((o) => ({ id: o.id, name: o.name, timezone: o.timezone, role: orgRole(user, o.id) })),
  );
});

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

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().max(64).refine(isValidTimeZone, "Unknown timezone").optional(),
  telegramBotToken: z.string().max(200).optional(),
  telegramChatId: z.string().max(100).optional(),
});

orgsRouter.get(
  "/:orgId/settings",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const org = await db.orgs.mustById(req.params.orgId);
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
    if (b.name !== undefined && !isOrgSA(req.user!, req.params.orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can rename the organisation" });
    }
    if (b.timezone !== undefined && !isOrgSA(req.user!, req.params.orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can change the organisation timezone" });
    }
    const org = await db.orgs.mustUpdate(
      { _id: req.params.orgId },
      {
        ...(b.name !== undefined ? { name: b.name.trim() } : {}),
        ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
        ...(b.telegramBotToken !== undefined ? { telegramBotToken: b.telegramBotToken || null } : {}),
        ...(b.telegramChatId !== undefined ? { telegramChatId: b.telegramChatId || null } : {}),
      },
    );
    res.json(serializeOrg(org));
  },
);

orgsRouter.delete(
  "/:orgId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN"),
  async (req, res) => {
    const orgId = req.params.orgId;
    const projectIds = await db.projects.distinct("_id", { orgId });
    const ticketIds = projectIds.length ? await db.tickets.distinct("_id", { projectId: { $in: projectIds } }) : [];
    await withTransaction((session) => deleteOrganizationCascade(orgId, { session }));
    for (const id of ticketIds) await deleteTicketFiles(id);
    res.json({ ok: true });
  },
);

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
    const target = await db.memberships.findOne({ userId: parsed.data.userId, orgId });
    if (!target || target.disabled || target.role !== "ADMIN") {
      return res.status(400).json({ error: "Ownership can only be transferred to an active Admin" });
    }
    // Demote first, then promote: the "one Super Admin per org" index never sees two.
    await withTransaction(async (session) => {
      await db.memberships.mustUpdate({ userId: req.user!.id, orgId }, { role: "ADMIN" }, { session });
      await db.memberships.mustUpdate({ _id: target.id }, { role: "SUPER_ADMIN" }, { session });
    });
    res.json({ ok: true });
  },
);

const MEMBERS_MAX_PAGE_SIZE = 100;

orgsRouter.get(
  "/:orgId/members",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const orgId = req.params.orgId;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const where: Record<string, unknown> = { orgId };
    if (q) {
      const users = await db.users.find({ $or: [{ name: contains(q) }, { email: contains(q) }] }, { select: ["id"] });
      where.userId = { $in: users.map((u) => u.id) };
    }
    const sort = { disabled: 1, createdAt: 1, _id: 1 } as const;

    const serializeMembers = async (rows: Awaited<ReturnType<typeof db.memberships.find>>) => {
      const [users, links] = await Promise.all([
        db.users.find({ _id: { $in: rows.map((m) => m.userId) } }),
        db.projectClients.find({ membershipId: { $in: rows.map((m) => m.id) } }),
      ]);
      const userById = new Map(users.map((u) => [u.id, u]));
      return rows.flatMap((m) => {
        const u = userById.get(m.userId);
        if (!u) return [];
        return [
          {
            membershipId: m.id,
            userId: u.id,
            name: u.name,
            email: u.email,
            avatarUrl: u.avatarUrl,
            role: m.role,
            disabled: m.disabled,
            projectIds: links.filter((l) => l.membershipId === m.id).map((l) => l.projectId),
            createdAt: m.createdAt,
          },
        ];
      });
    };

    const pageRaw = req.query.page;
    if (pageRaw === undefined) {
      return res.json(await serializeMembers(await db.memberships.find(where, { sort })));
    }

    const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
    const pageSize = Math.min(
      MEMBERS_MAX_PAGE_SIZE,
      Math.max(1, parseInt(String(req.query.pageSize ?? "10"), 10) || 10),
    );
    const [rows, total] = await Promise.all([
      db.memberships.find(where, { sort, skip: (page - 1) * pageSize, limit: pageSize }),
      db.memberships.count(where),
    ]);
    res.json({ items: await serializeMembers(rows), total, page, pageSize });
  },
);


const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);
const memberTicketFilterSchema = z.object({
  status: z.preprocess(emptyToUndef, z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional()),
  priority: z.preprocess(emptyToUndef, z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()),
  type: z.preprocess(emptyToUndef, z.enum(["BUG", "FEATURE", "TASK"]).optional()),
});

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
    assignees: t.assignees ?? [],
    reporter: t.reporter ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
orgsRouter.get(
  "/:orgId/members/:userId/detail",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const orgId = req.params.orgId;
    const membership = await db.memberships.findOne({ userId: req.params.userId, orgId });
    const user = membership ? await db.users.byId(membership.userId) : null;
    if (!membership || !user) return res.status(404).json({ error: "Member not found" });

    const live = { orgId, archivedAt: null };
    const projects =
      membership.role === "SUPER_ADMIN" || membership.role === "ADMIN"
        ? await db.projects.find(live, { sort: { name: 1 }, ci: true, select: ["id", "name"] })
        : await db.projects.find(
            {
              ...live,
              _id: {
                $in: [
                  ...(await db.projectDevelopers.distinct("projectId", { membershipId: membership.id })),
                  ...(await db.projectClients.distinct("projectId", { membershipId: membership.id })),
                ],
              },
            },
            { sort: { name: 1 }, ci: true, select: ["id", "name"] },
          );

    const liveProjectIds = await db.projects.distinct("_id", live);
    const counts = await db.tickets.aggregate<{ _id: string; n: number }>([
      { $match: { assigneeIds: membership.userId, archivedAt: null, projectId: { $in: liveProjectIds } } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const ticketCounts = { OPEN: 0, IN_PROGRESS: 0, DONE: 0 };
    let total = 0;
    for (const c of counts) {
      ticketCounts[c._id as keyof typeof ticketCounts] = c.n;
      total += c.n;
    }

    res.json({
      userId: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: membership.role,
      disabled: membership.disabled,
      createdAt: membership.createdAt,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      ticketCounts: { ...ticketCounts, total },
    });
  },
);

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

    const org = await db.orgs.byId(orgId);
    const due = parseDueRange(req.query, org?.timezone);
    if (!due.ok) return res.status(400).json({ error: due.error });

    const liveProjectIds = await db.projects.distinct("_id", { orgId, archivedAt: null });
    const where = {
      assigneeIds: req.params.userId,
      archivedAt: null,
      projectId: { $in: liveProjectIds },
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(type ? { type } : {}),
      ...due.where,
    };
    const paged = await paginate(
      parsePageParams(req.query, 10),
      () => db.tickets.count(where),
      async (skip, take) =>
        hydrateTickets(await db.tickets.find(where, { sort: { updatedAt: -1, _id: -1 }, skip, limit: take })),
    );
    res.json({ ...paged, items: paged.items.map(serializeMemberTicket) });
  },
);
async function loadManagedMember(req: any, res: any) {
  const orgId = req.params.orgId;
  const target = await db.memberships.findOne({ userId: req.params.userId, orgId });
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

    if (parsed.data.role === "ADMIN" && !isOrgSA(req.user!, req.params.orgId)) {
      return res.status(403).json({ error: "Only the Super Admin can promote to Admin" });
    }

    if (parsed.data.disabled === true) {
      const u = await db.users.mustById(target.userId);
      if (!confirmed(req.body?.confirmName, u.name)) {
        return res.status(400).json({ error: "Type the member's name to confirm disabling their account." });
      }
    }
    const updated = await db.memberships.mustUpdate({ _id: target.id }, parsed.data);
    res.json({ ok: true, role: updated.role, disabled: updated.disabled });
  },
);


orgsRouter.get(
  "/:orgId/members/:userId/impact",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const target = await loadManagedMember(req, res);
    if (!target) return;
    const orgProjectIds = await db.projects.distinct("_id", { orgId: req.params.orgId });
    const [developerProjects, clientProjects, openAssigned] = await Promise.all([
      db.projectDevelopers.count({ membershipId: target.id }),
      db.projectClients.count({ membershipId: target.id }),
      db.tickets.count({
        assigneeIds: target.userId,
        archivedAt: null,
        status: { $in: [...OPEN_STATUSES] },
        projectId: { $in: orgProjectIds },
      }),
    ]);
    res.json({ projects: developerProjects + clientProjects, openAssignedTickets: openAssigned });
  },
);


orgsRouter.delete(
  "/:orgId/members/:userId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const target = await loadManagedMember(req, res);
    if (!target) return;
    const u = await db.users.mustById(target.userId);
    if (!confirmed(req.body?.confirmName, u.name)) {
      return res.status(400).json({ error: "Type the member's name to confirm removing them." });
    }
    await withTransaction((session) => deleteMembershipCascade(target.id, { session }));
    res.json({ ok: true });
  },
);
