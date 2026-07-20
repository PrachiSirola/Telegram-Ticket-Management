import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireProjectAccess } from "../middleware/org.js";
import { isAdminOrAbove, isInternal } from "../lib/access.js";
import { loadTicketForUser } from "../lib/ticketAccess.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { listNames, notify } from "../lib/notify.js";

const userSelect = { select: { id: true, name: true, email: true, avatarUrl: true } };

function serialize(t: any) {
  return {
    id: t.id,
    projectId: t.projectId,
    orgId: t.project?.orgId,
    project: t.project ? { id: t.project.id, name: t.project.name } : undefined,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    type: t.type,
    dueDate: t.dueDate,
    estimate: t.estimate,
    assignee: t.assignee ?? null,
    reporter: t.reporter ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const ticketInclude = {
  assignee: userSelect,
  reporter: userSelect,
  project: { select: { id: true, name: true, orgId: true } },
};

/** Is userId an active internal (non-client) member of the org? */
async function isAssignableMember(userId: string, orgId: string) {
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  return Boolean(m && !m.disabled && m.role !== "CLIENT");
}

// ---------------------------------------------------------------------------
// Project-scoped: /orgs/:orgId/projects/:projectId/tickets
// ---------------------------------------------------------------------------
export const projectTicketsRouter = Router({ mergeParams: true });

projectTicketsRouter.get(
  "/",
  requireAuth,
  requireOrgAccess,
  requireProjectAccess,
  async (req, res) => {
    const { status, priority, type, assigneeId, q } = req.query as Record<string, string>;
    const tickets = await prisma.ticket.findMany({
      where: {
        projectId: req.project!.id,
        ...(status ? { status: status as any } : {}),
        ...(priority ? { priority: priority as any } : {}),
        ...(type ? { type: type as any } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      },
      include: ticketInclude,
      orderBy: [{ updatedAt: "desc" }],
    });
    res.json(tickets.map(serialize));
  },
);

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  type: z.enum(["BUG", "FEATURE", "TASK"]).optional(),
  dueDate: z.string().datetime().nullish(),
  estimate: z.number().positive().nullish(),
  assigneeId: z.string().nullish(),
  mentions: z.array(z.string()).optional(),
});

projectTicketsRouter.post(
  "/",
  requireAuth,
  requireOrgAccess,
  requireProjectAccess,
  async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;
    const user = req.user!;
    const orgId = req.params.orgId;
    const projectId = req.project!.id;

    // Only SA/Admin may assign on creation; assignees are internal members.
    let assigneeId: string | null = null;
    if (data.assigneeId) {
      if (!isAdminOrAbove(user, orgId)) {
        return res.status(403).json({ error: "Only admins can assign on create" });
      }
      if (!(await isAssignableMember(data.assigneeId, orgId))) {
        return res.status(400).json({ error: "Assignee must be an internal org member" });
      }
      assigneeId = data.assigneeId;
    }

    const ticket = await prisma.ticket.create({
      data: {
        projectId,
        title: data.title,
        description: data.description ?? "",
        priority: data.priority ?? "MEDIUM",
        type: data.type ?? "TASK",
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        estimate: data.estimate ?? null,
        reporterId: user.id,
        assigneeId,
      },
      include: ticketInclude,
    });

    // Announce to the org's Telegram chat (no in-app recipients here).
    await notify({
      recipientIds: [],
      type: "ASSIGNED",
      ticket,
      orgId,
      actorId: user.id,
      message: "",
      telegram: true,
      telegramMessage:
        `🆕 <b>New ticket</b>: ${ticket.title}\n` +
        `Project: ${req.project!.name}\n` +
        `Priority: ${ticket.priority} · Type: ${ticket.type}\n` +
        `Assigned: ${ticket.assignee?.name ?? "Unassigned"}`,
    });

    if (assigneeId) {
      await notify({
        recipientIds: [assigneeId],
        type: "ASSIGNED",
        ticket,
        orgId,
        actorId: user.id,
        message: `${user.name} assigned you the ticket "${ticket.title}".`,
      });
    }

    // Mentions in the description — notify() filters to actual org members
    // (and, for clients, project attachment).
    if (data.mentions?.length) {
      const mentioned = await prisma.user.findMany({
        where: { id: { in: data.mentions } },
        select: { id: true, name: true },
      });
      if (mentioned.length) {
        await notify({
          recipientIds: mentioned.map((u) => u.id),
          type: "MENTIONED",
          ticket,
          orgId,
          actorId: user.id,
          message: `${user.name} mentioned you on "${ticket.title}".`,
          telegram: true,
          telegramMessage: `${user.name} mentioned ${listNames(mentioned.map((u) => u.name))} on "${ticket.title}".`,
        });
      }
    }

    res.status(201).json(serialize(ticket));
  },
);

// ---------------------------------------------------------------------------
// By id: /tickets/:id
// ---------------------------------------------------------------------------
export const ticketsRouter = Router();

ticketsRouter.get("/:id", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const full = await prisma.ticket.findUnique({
    where: { id: ticket.id },
    include: ticketInclude,
  });
  res.json(serialize(full));
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  type: z.enum(["BUG", "FEATURE", "TASK"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional(),
  dueDate: z.string().datetime().nullish(),
  estimate: z.number().positive().nullish(),
  assigneeId: z.string().nullish(),
});

ticketsRouter.patch("/:id", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;
  const user = req.user!;
  const orgId = ticket.project.orgId;

  const internal = isInternal(user, orgId);
  const admin = isAdminOrAbove(user, orgId);
  const isReporter = ticket.reporterId === user.id;

  const data: Record<string, unknown> = {};

  // Content fields: internal team always; the reporting client may edit
  // title/description of their own ticket.
  if (body.title !== undefined) {
    if (!internal && !isReporter) return res.status(403).json({ error: "Cannot edit title" });
    data.title = body.title;
  }
  if (body.description !== undefined) {
    if (!internal && !isReporter) return res.status(403).json({ error: "Cannot edit description" });
    data.description = body.description;
  }
  for (const field of ["priority", "type", "dueDate", "estimate"] as const) {
    if (body[field] !== undefined) {
      if (!internal) return res.status(403).json({ error: `Cannot edit ${field}` });
      data[field] = field === "dueDate" && body.dueDate ? new Date(body.dueDate) : body[field];
    }
  }

  // Status: internal team only.
  let statusChanged = false;
  if (body.status !== undefined) {
    if (!internal) return res.status(403).json({ error: "Cannot change status" });
    statusChanged = body.status !== ticket.status;
    data.status = body.status;
  }

  // Assignee (arbitrary): SA/Admin only; assignees are internal members.
  let newAssignee: string | null | undefined;
  if (body.assigneeId !== undefined) {
    if (!admin) return res.status(403).json({ error: "Only admins can reassign" });
    if (body.assigneeId && !(await isAssignableMember(body.assigneeId, orgId))) {
      return res.status(400).json({ error: "Assignee must be an internal org member" });
    }
    newAssignee = body.assigneeId ?? null;
    data.assigneeId = newAssignee;
  }

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data,
    include: ticketInclude,
  });

  if (statusChanged) {
    await notify({
      recipientIds: [ticket.reporterId, ticket.assigneeId ?? ""].filter(Boolean),
      type: "STATUS_CHANGED",
      ticket: updated,
      orgId,
      actorId: user.id,
      message: `${user.name} moved "${updated.title}" to ${updated.status.replace("_", " ")}.`,
      telegram: true,
    });
  }
  if (newAssignee && newAssignee !== ticket.assigneeId) {
    await notify({
      recipientIds: [newAssignee],
      type: "ASSIGNED",
      ticket: updated,
      orgId,
      actorId: user.id,
      message: `${user.name} assigned "${updated.title}" to ${updated.assignee?.name ?? "someone"}.`,
      telegram: true,
    });
  }

  res.json(serialize(updated));
});

// Delete: SA/Admin of the org, or the ticket's reporter. Comments, attachments
// and notifications cascade in the DB; uploaded files are removed from disk.
ticketsRouter.delete("/:id", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  if (!isAdminOrAbove(user, ticket.project.orgId) && ticket.reporterId !== user.id) {
    return res.status(403).json({ error: "Only the reporter or an admin can delete" });
  }
  await prisma.ticket.delete({ where: { id: ticket.id } });
  await deleteTicketFiles(ticket.id);
  res.json({ ok: true });
});

// Self-assign: internal team members only.
ticketsRouter.post("/:id/self-assign", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  if (!isInternal(user, ticket.project.orgId)) {
    return res.status(403).json({ error: "Only internal team members can self-assign" });
  }
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { assigneeId: user.id },
    include: ticketInclude,
  });
  res.json(serialize(updated));
});
