import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole, requireProjectAccess } from "../middleware/org.js";
import { isClient, membershipIn, orgRole, type AuthUser } from "../lib/access.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { developerVisibleProjectsWhere } from "../lib/projectAccess.js";

// mergeParams so :orgId from the parent mount is available.
export const projectsRouter = Router({ mergeParams: true });

/**
 * "New" / "Active" / "Closed" tabs, AND the ticketCount badge on a project
 * card, are all derived live from ticket state — none of it is stored, so
 * it can never go stale and flips automatically both ways as tickets move.
 * Every project falls into exactly one of the three:
 *   - New: has zero tickets yet.
 *   - Active: has at least one OPEN or IN_PROGRESS ticket.
 *   - Closed: has at least one ticket, and every ticket is DONE.
 * ticketCount itself is the number of OPEN/IN_PROGRESS tickets (drops when
 * a ticket closes, rises again when one's created or reopened).
 */
// Mutable array type (not `as const`): Prisma's `in` filter rejects readonly arrays.
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[];

const projectSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  archivedAt: true,
  _count: { select: { tickets: { where: { status: { in: OPEN_STATUSES }, archivedAt: null } } } },
};

function serialize(p: any) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    ticketCount: p._count?.tickets ?? 0,
    createdAt: p.createdAt,
    archivedAt: p.archivedAt ?? null,
  };
}

const MAX_PAGE_SIZE = 100;

function statusWhere(status: string | undefined): Record<string, unknown> {
  if (status === "new") {
    return { tickets: { none: {} } };
  }
  if (status === "current") {
    // The Dashboard default: projects that are New (no tickets yet) or Active.
    return { OR: [{ tickets: { none: {} } }, { tickets: { some: { status: { in: OPEN_STATUSES } } } }] };
  }
  if (status === "active") {
    return { tickets: { some: { status: { in: OPEN_STATUSES } } } };
  }
  if (status === "closed") {
    return {
      AND: [
        { tickets: { some: {} } },
        { tickets: { none: { status: { in: OPEN_STATUSES } } } },
      ],
    };
  }
  return {};
}

/** Role-scoped base `where`: SA/Admin see every org project; clients see only
 * attached projects; developers see only projects they're explicitly
 * assigned to OR have a ticket assigned to them in. Shared by the list
 * route and the counts route so the two never drift apart. */
function scopedWhere(user: AuthUser, orgId: string) {
  let scope: Record<string, unknown> = {};
  if (isClient(user, orgId)) {
    scope = { clients: { some: { membershipId: membershipIn(user, orgId)!.id } } };
  } else if (orgRole(user, orgId) === "DEVELOPER") {
    scope = developerVisibleProjectsWhere(user.id, membershipIn(user, orgId)!.id);
  }
  return { orgId, ...scope };
}

/** Only Super Admins / Admins manage archived projects (view, restore, delete). */
const canManageProjects = (user: AuthUser, orgId: string) => {
  const r = orgRole(user, orgId);
  return r === "SUPER_ADMIN" || r === "ADMIN";
};

/**
 * Archive state + tab filter, combined with the role scope. Everything except the
 * "archived" tab only ever shows LIVE projects, so archived ones drop out of the
 * dashboard, the project switcher and every picker automatically.
 *
 * The parts are AND-ed together on purpose: the role scope (developers) and the
 * search term are both `OR` lists, and merging them into one object would let one
 * overwrite the other — a developer's search would then escape their project scope.
 */
function listWhere(user: AuthUser, orgId: string, status: string | undefined, q: string) {
  const scope = scopedWhere(user, orgId);
  const { orgId: _o, ...scopeRest } = scope as Record<string, unknown>;
  const archivedPart =
    status === "archived"
      ? canManageProjects(user, orgId)
        ? { archivedAt: { not: null } }
        : { id: { in: [] as string[] } } // non-admins never see archived projects
      : { archivedAt: null };
  return {
    orgId,
    AND: [
      scopeRest,
      archivedPart,
      ...(status === "archived" ? [] : [statusWhere(status)]),
      ...(q
        ? [
            {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { description: { contains: q, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
    ],
  };
}

/**
 * Live counts for the All/Active/Closed tab bar. Registered before
 * "/:projectId" so the literal "/counts" path always wins over the param
 * route for GET requests.
 */
projectsRouter.get("/counts", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = req.params.orgId;
  const user = req.user!;
  const count = (status: string | undefined) => prisma.project.count({ where: listWhere(user, orgId, status, "") });
  const [all, current, active, closed, newCount, archived] = await Promise.all([
    count(undefined),
    count("current"),
    count("active"),
    count("closed"),
    count("new"),
    count("archived"),
  ]);
  res.json({ all, current, active, closed, new: newCount, archived });
});

/**
 * List projects: internal roles (SA/Admin) see all; clients see only
 * attached projects; developers see only projects they're explicitly
 * assigned to OR have a ticket assigned to them in.
 *
 * `status` query param: "active" | "closed" | omitted (= all). Filters on
 * live ticket state — see statusWhere() above.
 *
 * Pagination is OPT-IN: if `page` is present in the query string, the
 * response is a `{ items, total, page, pageSize }` envelope. If omitted
 * (the existing behaviour every current caller — the project switcher,
 * lookups, invite forms — relies on), the response stays the plain array
 * it's always been. This lets the Dashboard's paginated grid opt in without
 * touching any of the other call sites that need the complete list.
 */

projectsRouter.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = req.params.orgId;
  const user = req.user!;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const where = listWhere(user, orgId, typeof req.query.status === "string" ? req.query.status : undefined, q);

  const pageRaw = req.query.page;
  if (pageRaw === undefined) {
    const projects = await prisma.project.findMany({
      where,
      select: projectSelect,
      orderBy: { name: "asc" },
    });
    return res.json(projects.map(serialize));
  }

  const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(String(req.query.pageSize ?? "18"), 10) || 18),
  );
  // Busiest projects first: most open tickets (the number on the card), then
  // A-Z by name. Prisma can't order by a *filtered* relation count, so the
  // matching set (already scoped to what this user may see, and small per
  // org) is ranked here and then paged — search/status filters still apply
  // first, so totals and page boundaries are unchanged.
  const all = await prisma.project.findMany({ where, select: projectSelect });
  const ranked = all.map(serialize).sort(
    (x, y) =>
      y.ticketCount - x.ticketCount ||
      x.name.localeCompare(y.name, undefined, { sensitivity: "base" }) ||
      x.id.localeCompare(y.id),
  );
  const items = ranked.slice((page - 1) * pageSize, page * pageSize);
  res.json({ items, total: ranked.length, page, pageSize });
});

const upsertSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
});

projectsRouter.post(
  "/",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  async (req, res) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Project name is required." });
    const project = await prisma.project.create({
      data: {
        orgId: req.params.orgId,
        name: parsed.data.name.trim(),
        description: parsed.data.description ?? "",
      },
      select: projectSelect,
    });
    res.status(201).json(serialize(project));
  },
);

projectsRouter.patch(
  "/:projectId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const parsed = upsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    if (req.project!.archivedAt) {
      return res.status(409).json({ error: "This project is archived. Restore it before editing." });
    }
    if (parsed.data.name !== undefined && !parsed.data.name.trim()) {
      return res.status(400).json({ error: "Project name is required." });
    }
    const project = await prisma.project.update({
      where: { id: req.project!.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      },
      select: projectSelect,
    });
    res.json(serialize(project));
  },
);

// One project (the project page needs it even when archived, which the list hides).
projectsRouter.get("/:projectId", requireAuth, requireOrgAccess, requireProjectAccess, async (req, res) => {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: req.project!.id },
    select: projectSelect,
  });
  res.json(serialize(project));
});

// Archive / restore. Admin / Super Admin only. Nothing is deleted or detached:
// tickets, members and clients stay exactly as they are; the project just leaves the
// default lists and becomes read-only until restored. Both are idempotent.
projectsRouter.post(
  "/:projectId/archive",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const project = await prisma.project.update({
      where: { id: req.project!.id },
      data: { archivedAt: req.project!.archivedAt ?? new Date() },
      select: projectSelect,
    });
    res.json(serialize(project));
  },
);
projectsRouter.post(
  "/:projectId/restore",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const project = await prisma.project.update({
      where: { id: req.project!.id },
      data: { archivedAt: null },
      select: projectSelect,
    });
    res.json(serialize(project));
  },
);

// What deleting this project would remove — shown in the confirmation dialog.
projectsRouter.get(
  "/:projectId/impact",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const projectId = req.project!.id;
    const [tickets, comments, attachments] = await Promise.all([
      prisma.ticket.count({ where: { projectId } }),
      prisma.comment.count({ where: { ticket: { projectId } } }),
      prisma.attachment.count({ where: { ticket: { projectId } } }),
    ]);
    res.json({ tickets, comments, attachments });
  },
);

// Delete a project (tickets/comments/attachments cascade in the DB; uploaded
// files are removed from disk). Permanent, so the caller must send the project's
// exact name as confirmation — enforced here, not just in the dialog.
projectsRouter.delete(
  "/:projectId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const confirmName = typeof req.body?.confirmName === "string" ? req.body.confirmName.trim() : "";
    if (confirmName !== req.project!.name.trim()) {
      return res.status(400).json({ error: "Type the project's name to confirm deleting it." });
    }
    const tickets = await prisma.ticket.findMany({
      where: { projectId: req.project!.id },
      select: { id: true },
    });
    await prisma.project.delete({ where: { id: req.project!.id } });
    for (const t of tickets) await deleteTicketFiles(t.id);
    res.json({ ok: true });
  },
);

// Assignee/mention pool for a project: SA/Admin always; developers only if
// they have access to THIS project (explicit or via ticket assignment) —
// otherwise a developer with no stake in the project would still show up
// as an assignable option for it, which would contradict the "developers
// only see their assigned projects" rule; plus the clients attached to
// this project. Any project member can view.
projectsRouter.get(
  "/:projectId/members",
  requireAuth,
  requireOrgAccess,
  requireProjectAccess,
  async (req, res) => {
    const projectId = req.project!.id;
    const memberships = await prisma.orgMembership.findMany({
      where: {
        orgId: req.params.orgId,
        disabled: false,
        OR: [
          { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
          { role: "DEVELOPER", projectDevAccess: { some: { projectId } } },
          { role: "DEVELOPER", user: { assignedTickets: { some: { projectId } } } },
          { role: "CLIENT", projectAccess: { some: { projectId } } },
        ],
      },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(
      memberships.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
      })),
    );
  },
);

// Set which client memberships are attached to this project. SA/Admin only.
const clientsSchema = z.object({ membershipIds: z.array(z.string()) });
projectsRouter.put(
  "/:projectId/clients",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const parsed = clientsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "membershipIds required" });
    const desired = [...new Set(parsed.data.membershipIds)];

    // Only CLIENT memberships of THIS org can be attached.
    const valid = await prisma.orgMembership.findMany({
      where: { id: { in: desired }, orgId: req.params.orgId, role: "CLIENT" },
      select: { id: true },
    });
    if (valid.length !== desired.length) {
      return res.status(400).json({ error: "One or more ids are not client members of this org" });
    }

    const projectId = req.project!.id;
    const current = await prisma.projectClient.findMany({ where: { projectId } });
    const currentIds = new Set(current.map((c) => c.membershipId));
    const desiredIds = new Set(desired);
    await prisma.$transaction([
      ...desired
        .filter((id) => !currentIds.has(id))
        .map((membershipId) => prisma.projectClient.create({ data: { projectId, membershipId } })),
      prisma.projectClient.deleteMany({
        where: { projectId, membershipId: { notIn: [...desiredIds] } },
      }),
    ]);
    res.json({ ok: true });
  },
);

// Set which developer memberships are explicitly attached to this project.
// SA/Admin only. Mirrors the clients endpoint above — same shape, same
// upsert-then-prune pattern. A developer can also gain access implicitly
// via ticket assignment (see lib/projectAccess.ts); this endpoint covers
// the "attach ahead of any ticket" case.
const developersSchema = z.object({ membershipIds: z.array(z.string()) });
projectsRouter.put(
  "/:projectId/developers",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const parsed = developersSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "membershipIds required" });
    const desired = [...new Set(parsed.data.membershipIds)];

    // Only DEVELOPER memberships of THIS org can be attached.
    const valid = await prisma.orgMembership.findMany({
      where: { id: { in: desired }, orgId: req.params.orgId, role: "DEVELOPER" },
      select: { id: true },
    });
    if (valid.length !== desired.length) {
      return res
        .status(400)
        .json({ error: "One or more ids are not developer members of this org" });
    }

    const projectId = req.project!.id;
    const current = await prisma.projectDeveloper.findMany({ where: { projectId } });
    const currentIds = new Set(current.map((c) => c.membershipId));
    const desiredIds = new Set(desired);
    await prisma.$transaction([
      ...desired
        .filter((id) => !currentIds.has(id))
        .map((membershipId) =>
          prisma.projectDeveloper.create({ data: { projectId, membershipId } }),
        ),
      prisma.projectDeveloper.deleteMany({
        where: { projectId, membershipId: { notIn: [...desiredIds] } },
      }),
    ]);
    res.json({ ok: true });
  },
);