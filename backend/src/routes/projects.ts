import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole, requireProjectAccess } from "../middleware/org.js";
import { isClient, membershipIn, orgRole, type AuthUser } from "../lib/access.js";
import { confirmed } from "../lib/confirmName.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { developerVisibleProjectsWhere } from "../lib/projectAccess.js";


export const projectsRouter = Router({ mergeParams: true });

const OPEN_STATUSES: Array<"OPEN" | "IN_PROGRESS"> = ["OPEN", "IN_PROGRESS"];

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


function scopedWhere(user: AuthUser, orgId: string) {
  let scope: Record<string, unknown> = {};
  if (isClient(user, orgId)) {
    scope = { clients: { some: { membershipId: membershipIn(user, orgId)!.id } } };
  } else if (orgRole(user, orgId) === "DEVELOPER") {
    scope = developerVisibleProjectsWhere(user.id, membershipIn(user, orgId)!.id);
  }
  return { orgId, ...scope };
}

const canManageProjects = (user: AuthUser, orgId: string) => {
  const r = orgRole(user, orgId);
  return r === "SUPER_ADMIN" || r === "ADMIN";
};


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

projectsRouter.get("/:projectId", requireAuth, requireOrgAccess, requireProjectAccess, async (req, res) => {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: req.project!.id },
    select: projectSelect,
  });
  res.json(serialize(project));
});

const bulkProjectsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["archive", "restore", "close"]),
});

projectsRouter.post("/bulk", requireAuth, requireOrgAccess, requireOrgRole("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  const parsed = bulkProjectsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select 1–100 projects and a valid action." });
  const { action } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];
  const { orgId } = req.params;
  const actorId = req.user!.id;

  const found = await prisma.project.findMany({ where: { id: { in: ids }, orgId }, select: { id: true, name: true, archivedAt: true } });
  const byId = new Map(found.map((p) => [p.id, p]));

  const updated: { id: string; name: string; tickets?: number }[] = [];
  const skipped: { id: string; name: string; reason: string }[] = [];
  const failed: { id: string; name: string | null; reason: string }[] = [];

  for (const id of ids) {
    const project = byId.get(id);

    if (!project) {
      failed.push({ id, name: null, reason: "Project not found" });
      continue;
    }
    try {
      if (action === "archive") {
        if (project.archivedAt) { skipped.push({ id, name: project.name, reason: "Already archived" }); continue; }
        await prisma.project.update({ where: { id }, data: { archivedAt: new Date() } });
        updated.push({ id, name: project.name });
      } else if (action === "restore") {
        if (!project.archivedAt) { skipped.push({ id, name: project.name, reason: "Not archived" }); continue; }
        await prisma.project.update({ where: { id }, data: { archivedAt: null } });
        updated.push({ id, name: project.name });
      } else {
        if (project.archivedAt) { failed.push({ id, name: project.name, reason: "It's archived — restore it first" }); continue; }
        const open = await prisma.ticket.findMany({
          where: { projectId: id, archivedAt: null, status: { in: OPEN_STATUSES } },
          select: { id: true, status: true },
        });
        if (open.length === 0) { skipped.push({ id, name: project.name, reason: "No open tickets" }); continue; }
        await prisma.$transaction(async (tx) => {
       
          const now = await tx.ticket.findMany({
            where: { id: { in: open.map((t) => t.id) }, status: { in: OPEN_STATUSES } },
            select: { id: true, status: true },
          });
          await tx.ticket.updateMany({ where: { id: { in: now.map((t) => t.id) } }, data: { status: "DONE" } });
          await tx.ticketStatusHistory.createMany({
            data: now.map((t) => ({ ticketId: t.id, fromStatus: t.status, toStatus: "DONE" as const, changedById: actorId })),
          });
          await tx.ticketActivity.createMany({
            data: now.map((t) => ({
              ticketId: t.id, actorId, type: "STATUS_CHANGED" as const, field: "status", fromValue: t.status, toValue: "DONE",
              meta: { viaProjectClose: true },
            })),
          });
          open.length = now.length;
        });
        updated.push({ id, name: project.name, tickets: open.length });
      }
    } catch (err) {
      console.error("bulk project action failed", action, id, err);
      failed.push({ id, name: project.name, reason: "Something went wrong saving this project" });
    }
  }

  res.json({ action, updated, skipped, failed });
});


projectsRouter.post(
  "/:projectId/archive",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    if (!confirmed(req.body?.confirmName, req.project!.name)) {
      return res.status(400).json({ error: "Type the project's name to confirm archiving it." });
    }
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