import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { isAdminOrAbove, isClient, isInternal } from "../lib/access.js";
import { loadTicketForUser, rejectIfArchived } from "../lib/ticketAccess.js";
import { projectMemberPool } from "../lib/attachmentAccess.js";
import { confirmed } from "../lib/confirmName.js";
import { logActivity } from "../lib/activity.js";
import { notify } from "../lib/notify.js";
import { paginate, parsePageParams } from "../lib/pagination.js";


export const ticketActionsRouter = Router({ mergeParams: true });

const ticketInclude = {
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  reporter: { select: { id: true, name: true, email: true, avatarUrl: true } },
  project: { select: { id: true, name: true, orgId: true } },
};

const ATTACHMENT_TYPES = [
  "ATTACHMENT_ADDED",
  "ATTACHMENT_DELETED",
  "ATTACHMENT_VISIBILITY_CHANGED",
] as const;

ticketActionsRouter.get("/activity", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const client = isClient(user, orgId);
  const admin = isAdminOrAbove(user, orgId);

  const where: Prisma.TicketActivityWhereInput = {
    ticketId: ticket.id,
    ...(client ? { internalOnly: false } : {}),
    ...(admin
      ? {}
      : {
          NOT: {
            type: { in: [...ATTACHMENT_TYPES] },
            actorId: { not: user.id },
            meta: { path: ["visibility"], equals: "SELECTED" },
          },
        }),
  };
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const paged = await paginate(
    parsePageParams({ page: 1, ...req.query }, 25),
    () => prisma.ticketActivity.count({ where }),
    (skip, take) =>
      prisma.ticketActivity.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
      }),
  );
  res.json({
    ...paged,
    items: paged.items.map((a) => ({
      id: a.id,
      type: a.type,
      field: a.field,
      from: a.fromValue,
      to: a.toValue,
      meta: client ? undefined : a.meta,
      internalOnly: a.internalOnly,
      createdAt: a.createdAt,
      actor: a.actor,
    })),
  });
});

ticketActionsRouter.get("/members", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (!isInternal(req.user!, ticket.project.orgId)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  res.json(await projectMemberPool(ticket.project.orgId, ticket.projectId));
});

ticketActionsRouter.get("/followers", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (!isInternal(req.user!, ticket.project.orgId)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  const rows = await prisma.ticketFollower.findMany({
    where: { ticketId: ticket.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
  res.json(rows.map((r) => ({ ...r.user, followedAt: r.createdAt })));
});

ticketActionsRouter.post("/followers", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  if (!isAdminOrAbove(user, orgId)) return res.status(403).json({ error: "Only admins can add followers." });
  if (rejectIfArchived(ticket, res)) return;
  const parsed = z.object({ userId: z.string().min(1).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const targetId = parsed.data.userId ?? user.id;

  const pool = await projectMemberPool(orgId, ticket.projectId);
  const target = pool.find((p) => p.userId === targetId);
  if (!target) {
    return res.status(400).json({ error: "You can only add members of this project." });
  }
  const existing = await prisma.ticketFollower.findUnique({
    where: { ticketId_userId: { ticketId: ticket.id, userId: targetId } },
  });
  if (existing) return res.status(409).json({ error: `${target.name} already follows this ticket.` });

  await prisma.$transaction(async (tx) => {
    await tx.ticketFollower.create({
      data: { ticketId: ticket.id, userId: targetId, addedById: user.id },
    });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "FOLLOWER_ADDED",
      field: "follower",
      to: target.name,
      meta: { userId: targetId },
      internalOnly: true,
    });
  });
  if (targetId !== user.id) {
    await notify({
      recipientIds: [targetId],
      type: "ASSIGNED",
      ticket,
      orgId,
      actorId: user.id,
      message: `${user.name} added you as a follower of "${ticket.title}".`,
    });
  }
  res.status(201).json({ ok: true });
});

ticketActionsRouter.delete("/followers/:userId", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  if (!isInternal(user, orgId)) return res.status(403).json({ error: "Not allowed" });
  if (rejectIfArchived(ticket, res)) return;
  const targetId = req.params.userId;
  if (targetId !== user.id && !isAdminOrAbove(user, orgId)) {
    return res.status(403).json({ error: "You can only remove yourself." });
  }
  const row = await prisma.ticketFollower.findUnique({
    where: { ticketId_userId: { ticketId: ticket.id, userId: targetId } },
    include: { user: { select: { name: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not a follower" });
  await prisma.$transaction(async (tx) => {
    await tx.ticketFollower.delete({ where: { id: row.id } });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "FOLLOWER_REMOVED",
      field: "follower",
      from: row.user.name,
      meta: { userId: targetId },
      internalOnly: true,
    });
  });
  res.json({ ok: true });
});

ticketActionsRouter.post("/duplicate", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  if (!isAdminOrAbove(user, ticket.project.orgId)) {
    return res.status(403).json({ error: "Only admins can duplicate tickets." });
  }
  if (ticket.project.archivedAt) {
    return res.status(409).json({ error: "This project is archived. Restore it before adding tickets." });
  }

  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.ticket.create({
      data: {
        projectId: ticket.projectId,
        title: `Copy of ${ticket.title}`.slice(0, 300),
        description: ticket.description,
        priority: ticket.priority,
        type: ticket.type,
        dueDate: ticket.dueDate,
        estimate: ticket.estimate,
        status: "OPEN",
        reporterId: user.id,
        assigneeId: null,
      },
      include: ticketInclude,
    });
    await logActivity(tx, {
      ticketId: created.id,
      actorId: user.id,
      type: "TICKET_CREATED",
      to: created.title,
      meta: { duplicatedFrom: ticket.id },
    });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "DUPLICATED",
      to: created.title,
      meta: { newTicketId: created.id },
      internalOnly: true,
    });
    return created;
  });
  res.status(201).json({ id: copy.id, projectId: copy.projectId, title: copy.title });
});

ticketActionsRouter.post("/move", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  if (!isAdminOrAbove(user, orgId)) return res.status(403).json({ error: "Only admins can move tickets." });
  if (rejectIfArchived(ticket, res)) return;
  const parsed = z.object({ projectId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a project to move to." });
  if (parsed.data.projectId === ticket.projectId) {
    return res.status(400).json({ error: "The ticket is already in that project." });
  }

  const target = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, orgId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!target) return res.status(404).json({ error: "Project not found." });
  if (target.archivedAt) {
    return res.status(409).json({ error: "That project is archived. Restore it before moving tickets into it." });
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticket.id }, data: { projectId: target.id } });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "MOVED",
      field: "project",
      from: ticket.project.name,
      to: target.name,
      meta: { fromProjectId: ticket.projectId, toProjectId: target.id },
    });
  });
  const full = await prisma.ticket.findUnique({ where: { id: ticket.id }, include: ticketInclude });
  res.json({ id: full!.id, projectId: full!.projectId, project: full!.project });
});

ticketActionsRouter.post("/archive", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  if (!isAdminOrAbove(user, ticket.project.orgId)) {
    return res.status(403).json({ error: "Only admins can archive tickets." });
  }
  if (!confirmed(req.body?.confirmTicketName, ticket.title)) {
    return res.status(400).json({ error: "Type the ticket's name to confirm archiving it." });
  }
  if (ticket.archivedAt) return res.status(409).json({ error: "This ticket is already archived." });
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticket.id }, data: { archivedAt: new Date() } });
    await logActivity(tx, { ticketId: ticket.id, actorId: user.id, type: "ARCHIVED", internalOnly: true });
  });
  res.json({ ok: true });
});

ticketActionsRouter.post("/restore", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  if (!isAdminOrAbove(user, ticket.project.orgId)) {
    return res.status(403).json({ error: "Only admins can restore tickets." });
  }
  if (!ticket.archivedAt) return res.status(409).json({ error: "This ticket isn't archived." });
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticket.id }, data: { archivedAt: null } });
    await logActivity(tx, { ticketId: ticket.id, actorId: user.id, type: "RESTORED", internalOnly: true });
  });
  res.json({ ok: true });
});