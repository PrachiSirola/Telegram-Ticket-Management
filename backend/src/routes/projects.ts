import { Router } from "express";
import { z } from "zod";
import { db, deleteProjectCascade, withTransaction } from "../db/index.js";
import type { Project } from "../db/types.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireOrgRole, requireProjectAccess } from "../middleware/org.js";
import { isInternal, orgRole, type AuthUser } from "../lib/access.js";
import { confirmed } from "../lib/confirmName.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { projectScopeFilter } from "../lib/projectAccess.js";
import { projectMembers } from "../lib/attachmentAccess.js";
import { assignablePool } from "../lib/assignees.js";
import { and, contains, OPEN_STATUSES } from "../lib/mongoFilters.js";

export const projectsRouter = Router({ mergeParams: true });

function serialize(p: Project, ticketCount = 0) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    ticketCount,
    createdAt: p.createdAt,
    archivedAt: p.archivedAt ?? null,
  };
}

const MAX_PAGE_SIZE = 100;

interface ProjectStats {
  total: number; 
  open: number; 
  openLive: number; 
}

async function ticketStats(projectIds: string[]): Promise<Map<string, ProjectStats>> {
  const out = new Map<string, ProjectStats>(projectIds.map((id) => [id, { total: 0, open: 0, openLive: 0 }]));
  if (projectIds.length === 0) return out;
  const isOpen = { $in: ["$status", [...OPEN_STATUSES]] };
  const rows = await db.tickets.aggregate<{ _id: string } & ProjectStats>([
    { $match: { projectId: { $in: projectIds } } },
    {
      $group: {
        _id: "$projectId",
        total: { $sum: 1 },
        open: { $sum: { $cond: [isOpen, 1, 0] } },
        openLive: { $sum: { $cond: [{ $and: [isOpen, { $lte: ["$archivedAt", null] }] }, 1, 0] } },
      },
    },
  ]);
  for (const r of rows) out.set(r._id, { total: r.total, open: r.open, openLive: r.openLive });
  return out;
}

function matchesStatus(status: string | undefined, st: ProjectStats): boolean {
  if (status === "new") return st.total === 0;
  if (status === "current") return st.total === 0 || st.open > 0;
  if (status === "active") return st.open > 0;
  if (status === "closed") return st.total > 0 && st.open === 0;
  return true;
}

const canManageProjects = (user: AuthUser, orgId: string) => {
  const r = orgRole(user, orgId);
  return r === "SUPER_ADMIN" || r === "ADMIN";
};

async function listProjects(user: AuthUser, orgId: string, status: string | undefined, q: string) {
  if (status === "archived" && !canManageProjects(user, orgId)) return []; // non-admins never see archived projects
  const scope = await projectScopeFilter(user, orgId);
  const rows = await db.projects.find(
    and(
      { orgId },
      scope,
      status === "archived" ? { archivedAt: { $ne: null } } : { archivedAt: null },
      q ? { $or: [{ name: contains(q) }, { description: contains(q) }] } : undefined,
    ),
    { sort: { name: 1, _id: 1 }, ci: true },
  );
  const stats = await ticketStats(rows.map((p) => p.id));
  return rows
    .filter((p) => status === "archived" || matchesStatus(status, stats.get(p.id)!))
    .map((p) => ({ project: p, ticketCount: stats.get(p.id)!.openLive }));
}

projectsRouter.get("/counts", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = req.params.orgId;
  const user = req.user!;
  const live = await listProjects(user, orgId, undefined, "");
  const stats = await ticketStats(live.map((p) => p.project.id));
  const tally = (status: string) => live.filter((p) => matchesStatus(status, stats.get(p.project.id)!)).length;
  const archived = canManageProjects(user, orgId) ? (await listProjects(user, orgId, "archived", "")).length : 0;
  res.json({
    all: live.length,
    current: tally("current"),
    active: tally("active"),
    closed: tally("closed"),
    new: tally("new"),
    archived,
  });
});

projectsRouter.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = req.params.orgId;
  const user = req.user!;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const items = (
    await listProjects(user, orgId, typeof req.query.status === "string" ? req.query.status : undefined, q)
  ).map((r) => serialize(r.project, r.ticketCount));

  const pageRaw = req.query.page;
  if (pageRaw === undefined) return res.json(items);

  const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(String(req.query.pageSize ?? "18"), 10) || 18),
  );

  const ranked = items.sort(
    (x, y) =>
      y.ticketCount - x.ticketCount ||
      x.name.localeCompare(y.name, undefined, { sensitivity: "base" }) ||
      x.id.localeCompare(y.id),
  );
  res.json({ items: ranked.slice((page - 1) * pageSize, page * pageSize), total: ranked.length, page, pageSize });
});

async function openCount(projectId: string) {
  return (await ticketStats([projectId])).get(projectId)!.openLive;
}

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
    const project = await db.projects.create({
      orgId: req.params.orgId,
      name: parsed.data.name.trim(),
      description: parsed.data.description ?? "",
    });
    res.status(201).json(serialize(project, 0));
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
    const project = await db.projects.mustUpdate(
      { _id: req.project!.id },
      {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      },
    );
    res.json(serialize(project, await openCount(project.id)));
  },
);

projectsRouter.get("/:projectId", requireAuth, requireOrgAccess, requireProjectAccess, async (req, res) => {
  const project = await db.projects.mustById(req.project!.id);
  res.json(serialize(project, await openCount(project.id)));
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

  const found = await db.projects.find({ _id: { $in: ids }, orgId });
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
        await db.projects.mustUpdate({ _id: id }, { archivedAt: new Date() });
        updated.push({ id, name: project.name });
      } else if (action === "restore") {
        if (!project.archivedAt) { skipped.push({ id, name: project.name, reason: "Not archived" }); continue; }
        await db.projects.mustUpdate({ _id: id }, { archivedAt: null });
        updated.push({ id, name: project.name });
      } else {
        if (project.archivedAt) { failed.push({ id, name: project.name, reason: "It's archived — restore it first" }); continue; }
        const open = await db.tickets.find(
          { projectId: id, archivedAt: null, status: { $in: [...OPEN_STATUSES] } },
          { select: ["id", "status"] },
        );
        if (open.length === 0) { skipped.push({ id, name: project.name, reason: "No open tickets" }); continue; }
        await withTransaction(async (session) => {
          // Re-read inside the transaction so a ticket that changed meanwhile isn't counted twice.
          const now = await db.tickets.find(
            { _id: { $in: open.map((t) => t.id) }, status: { $in: [...OPEN_STATUSES] } },
            { select: ["id", "status"], session },
          );
          await db.tickets.updateMany({ _id: { $in: now.map((t) => t.id) } }, { status: "DONE" }, { session });
          await db.statusHistory.createMany(
            now.map((t) => ({ ticketId: t.id, fromStatus: t.status, toStatus: "DONE", changedById: actorId })),
            { session },
          );
          await db.activity.createMany(
            now.map((t) => ({
              ticketId: t.id, actorId, type: "STATUS_CHANGED", field: "status", fromValue: t.status, toValue: "DONE",
              meta: { viaProjectClose: true },
            })),
            { session },
          );
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
    const project = await db.projects.mustUpdate(
      { _id: req.project!.id },
      { archivedAt: req.project!.archivedAt ?? new Date() },
    );
    res.json(serialize(project, await openCount(project.id)));
  },
);
projectsRouter.post(
  "/:projectId/restore",
  requireAuth,
  requireOrgAccess,
  requireOrgRole("SUPER_ADMIN", "ADMIN"),
  requireProjectAccess,
  async (req, res) => {
    const project = await db.projects.mustUpdate({ _id: req.project!.id }, { archivedAt: null });
    res.json(serialize(project, await openCount(project.id)));
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
    const ticketIds = await db.tickets.distinct("_id", { projectId });
    const [tickets, comments, attachments] = await Promise.all([
      Promise.resolve(ticketIds.length),
      db.comments.count({ ticketId: { $in: ticketIds } }),
      db.attachments.count({ ticketId: { $in: ticketIds } }),
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
    const ticketIds = await db.tickets.distinct("_id", { projectId: req.project!.id });
    await withTransaction((session) => deleteProjectCascade(req.project!.id, { session }));
    for (const id of ticketIds) await deleteTicketFiles(id);
    res.json({ ok: true });
  },
);


projectsRouter.get(
  "/:projectId/members",
  requireAuth,
  requireOrgAccess,
  requireProjectAccess,
  async (req, res) => {
    res.json(await projectMembers(req.params.orgId, req.project!.id));
  },
);

/** Who can be assigned to this project's tickets (Super Admins/Admins + developers attached to the project). */
projectsRouter.get(
  "/:projectId/assignable",
  requireAuth,
  requireOrgAccess,
  requireProjectAccess,
  async (req, res) => {
    if (!isInternal(req.user!, req.params.orgId)) return res.status(403).json({ error: "Not allowed" });
    res.json(await assignablePool(req.params.orgId, req.project!.id));
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

  
    const valid = await db.memberships.find({ _id: { $in: desired }, orgId: req.params.orgId, role: "CLIENT" }, { select: ["id"] });
    if (valid.length !== desired.length) {
      return res.status(400).json({ error: "One or more ids are not client members of this org" });
    }

    const projectId = req.project!.id;
    const current = await db.projectClients.find({ projectId });
    const currentIds = new Set(current.map((c) => c.membershipId));
    await withTransaction(async (session) => {
      await db.projectClients.createMany(
        desired.filter((id) => !currentIds.has(id)).map((membershipId) => ({ projectId, membershipId })),
        { session },
      );
      await db.projectClients.deleteMany({ projectId, membershipId: { $nin: desired } }, { session });
    });
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


    const valid = await db.memberships.find({ _id: { $in: desired }, orgId: req.params.orgId, role: "DEVELOPER" }, { select: ["id"] });
    if (valid.length !== desired.length) {
      return res
        .status(400)
        .json({ error: "One or more ids are not developer members of this org" });
    }

    const projectId = req.project!.id;
    const current = await db.projectDevelopers.find({ projectId });
    const currentIds = new Set(current.map((c) => c.membershipId));
    await withTransaction(async (session) => {
      await db.projectDevelopers.createMany(
        desired.filter((id) => !currentIds.has(id)).map((membershipId) => ({ projectId, membershipId })),
        { session },
      );
      await db.projectDevelopers.deleteMany({ projectId, membershipId: { $nin: desired } }, { session });
    });
    res.json({ ok: true });
  },
);