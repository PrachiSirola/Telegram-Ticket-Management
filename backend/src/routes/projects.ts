import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole, requireProjectAccess } from "../middleware/org.js";
import { isClient, membershipIn, orgRole } from "../lib/access.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { developerVisibleProjectsWhere } from "../lib/projectAccess.js";

// mergeParams so :orgId from the parent mount is available.
export const projectsRouter = Router({ mergeParams: true });

const projectSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  _count: { select: { tickets: true } },
};

function serialize(p: any) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    ticketCount: p._count?.tickets ?? 0,
    createdAt: p.createdAt,
  };
}

const MAX_PAGE_SIZE = 100;

/**
 * List projects: internal roles (SA/Admin) see all; clients see only
 * attached projects; developers see only projects they're explicitly
 * assigned to OR have a ticket assigned to them in.
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

  let scope: Record<string, unknown> = {};
  if (isClient(user, orgId)) {
    scope = { clients: { some: { membershipId: membershipIn(user, orgId)!.id } } };
  } else if (orgRole(user, orgId) === "DEVELOPER") {
    scope = developerVisibleProjectsWhere(user.id, membershipIn(user, orgId)!.id);
  }

  const where = { orgId, ...scope };

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
  const [items, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      select: projectSelect,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.count({ where }),
  ]);
  res.json({ items: items.map(serialize), total, page, pageSize });
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

// Delete a project (tickets/comments/attachments cascade in the DB; uploaded
// files are removed from disk).
projectsRouter.delete(
  "/:projectId",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
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