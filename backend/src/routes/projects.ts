import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole, requireProjectAccess } from "../middleware/org.js";
import { isClient, membershipIn, orgRole, type AuthUser } from "../lib/access.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { developerVisibleProjectsWhere } from "../lib/projectAccess.js";
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
const OPEN_STATUSES: Array<"OPEN" | "IN_PROGRESS"> = ["OPEN", "IN_PROGRESS"];

const projectSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  _count: { select: { tickets: { where: { status: { in: OPEN_STATUSES }, archivedAt: null } } } },
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

function statusWhere(status: string | undefined): Record<string, unknown> {
  if (status === "new") {
    return { tickets: { none: {} } };
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
function scopedWhere(user: AuthUser, orgId: string) {
  let scope: Record<string, unknown> = {};
  if (isClient(user, orgId)) {
    scope = { clients: { some: { membershipId: membershipIn(user, orgId)!.id } } };
  } else if (orgRole(user, orgId) === "DEVELOPER") {
    scope = developerVisibleProjectsWhere(user.id, membershipIn(user, orgId)!.id);
  }
  return { orgId, ...scope };
}
projectsRouter.get("/counts", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = req.params.orgId;
  const base = scopedWhere(req.user!, orgId);
  const [all, active, closed, newCount] = await Promise.all([
    prisma.project.count({ where: base }),
    prisma.project.count({ where: { ...base, ...statusWhere("active") } }),
    prisma.project.count({ where: { ...base, ...statusWhere("closed") } }),
    prisma.project.count({ where: { ...base, ...statusWhere("new") } }),
  ]);
  res.json({ all, active, closed, new: newCount });
});
projectsRouter.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = req.params.orgId;
  const user = req.user!;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const where = {
    ...scopedWhere(user, orgId),
    ...statusWhere(typeof req.query.status === "string" ? req.query.status : undefined),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

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