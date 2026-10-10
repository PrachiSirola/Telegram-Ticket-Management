import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireProjectAccess } from "../middleware/org.js";
import { isAdminOrAbove, isInternal, orgRole } from "../lib/access.js";
import { loadTicketForUser, rejectIfArchived } from "../lib/ticketAccess.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { listNames, notify } from "../lib/notify.js";
import { logActivity } from "../lib/activity.js";
import { followerRecipients } from "../lib/followers.js";
import {
  paginate,
  parsePageParams,
  TICKET_TIEBREAK,
  wantsPagination,
} from "../lib/pagination.js";

// Optional list filters. Empty string = "no filter" (what the UI sends for "All …").
const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);
const listFilterSchema = z.object({
  status: z.preprocess(emptyToUndef, z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional()),
  priority: z.preprocess(emptyToUndef, z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()),
  type: z.preprocess(emptyToUndef, z.enum(["BUG", "FEATURE", "TASK"]).optional()),
  assigneeId: z.preprocess(emptyToUndef, z.string().optional()),
  q: z.preprocess(emptyToUndef, z.string().optional()),
  // Archived tickets are hidden by default; the team can view them separately.
  archived: z.preprocess(emptyToUndef, z.enum(["active", "archived", "all"]).optional()),
  // Tickets due on this calendar day (yyyy-mm-dd). Due dates are saved as a plain
  // date (midnight UTC of the day that was picked), so the day is matched as that
  // UTC calendar day — independent of the server's or viewer's timezone.
  dueDate: z.preprocess(
    emptyToUndef,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d))
      .optional(),
  ),
});

/** What the signed-in user may do with a ticket — computed server-side, enforced again on each route. */
export function ticketPermissions(
  user: Parameters<typeof isInternal>[0],
  orgId: string,
  ticket: { reporterId: string; archivedAt: Date | null; project?: { archivedAt: Date | null } | null },
) {
  const internal = isInternal(user, orgId);
  const admin = isAdminOrAbove(user, orgId);
  const reporter = ticket.reporterId === user.id;
  // A ticket of an archived project is read-only, exactly like an archived ticket.
  const projectArchived = Boolean(ticket.project?.archivedAt);
  const live = !ticket.archivedAt && !projectArchived;
  return {
    // Details (title, description, type, due date): Admins / Super Admins only;
    // the reporting customer may still fix their own ticket's text.
    edit: live && (admin || (reporter && !internal)),
    changeStatus: live && internal,
    changePriority: live && internal,
    assign: live && admin,
    selfAssign: live && internal,
    duplicate: admin && !projectArchived,
    addFollower: admin && !projectArchived,
    move: live && admin,
    archive: live && admin,
    restore: Boolean(ticket.archivedAt) && !projectArchived && admin,
    delete: admin || (orgRole(user, orgId) !== "DEVELOPER" && reporter),
  };
}

const userSelect = { select: { id: true, name: true, email: true, avatarUrl: true } };

function serialize(t: any) {
  return {
    id: t.id,
    projectId: t.projectId,
    orgId: t.project?.orgId,
    project: t.project
      ? { id: t.project.id, name: t.project.name, archivedAt: t.project.archivedAt ?? null }
      : undefined,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    type: t.type,
    dueDate: t.dueDate,
    estimate: t.estimate,
    assignee: t.assignee ?? null,
    reporter: t.reporter ?? null,
    archivedAt: t.archivedAt ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const ticketInclude = {
  assignee: userSelect,
  reporter: userSelect,
  project: { select: { id: true, name: true, orgId: true, archivedAt: true } },
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
    const filters = listFilterSchema.safeParse(req.query);
    if (!filters.success) return res.status(400).json({ error: "Invalid filter value" });
    const { status, priority, type, assigneeId, q, archived, dueDate } = filters.data;
    const dueStart = dueDate ? new Date(`${dueDate}T00:00:00Z`) : null;
    const dueEnd = dueStart ? new Date(dueStart.getTime() + 24 * 60 * 60 * 1000) : null;

    // Customers never see archived tickets, whatever they ask for.
    const archivedMode = isInternal(req.user!, req.params.orgId) ? archived ?? "active" : "active";
    const where = {
      projectId: req.project!.id,
      ...(archivedMode === "active" ? { archivedAt: null } : {}),
      ...(archivedMode === "archived" ? { archivedAt: { not: null } } : {}),
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(type ? { type } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(dueStart && dueEnd ? { dueDate: { gte: dueStart, lt: dueEnd } } : {}),
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    };
    // `id` makes the order total, so no ticket repeats or disappears between pages.
    const orderBy = [{ updatedAt: "desc" as const }, TICKET_TIEBREAK];

    // Opt-in pagination (same convention as projects/members): without `page`
    // the response is the plain array it has always been.
    if (!wantsPagination(req.query)) {
      const tickets = await prisma.ticket.findMany({ where, include: ticketInclude, orderBy });
      return res.json(tickets.map(serialize));
    }

    // Filters, count and page slice all share the same `where`, so `total`
    // is the FILTERED total and only one page of rows leaves the database.
    const paged = await paginate(
      parsePageParams(req.query),
      () => prisma.ticket.count({ where }),
      (skip, take) =>
        prisma.ticket.findMany({ where, include: ticketInclude, orderBy, skip, take }),
    );
    res.json({ ...paged, items: paged.items.map(serialize) });
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
    if (req.project!.archivedAt) {
      return res.status(409).json({ error: "This project is archived. Restore it before adding tickets." });
    }

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

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
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
      await logActivity(tx, {
        ticketId: created.id,
        actorId: user.id,
        type: "TICKET_CREATED",
        to: created.title,
      });
      if (assigneeId) {
        await logActivity(tx, {
          ticketId: created.id,
          actorId: user.id,
          type: "ASSIGNED",
          field: "assignee",
          from: null,
          to: created.assignee?.name ?? null,
          meta: { toId: assigneeId },
        });
      }
      return created;
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
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const internal = isInternal(user, orgId);
  const following = internal
    ? Boolean(
        await prisma.ticketFollower.findUnique({
          where: { ticketId_userId: { ticketId: ticket.id, userId: user.id } },
        }),
      )
    : false;
  res.json({
    ...serialize(full),
    // Followers are an internal-team feature; customers are never told who follows.
    followerCount: internal ? await prisma.ticketFollower.count({ where: { ticketId: ticket.id } }) : undefined,
    following,
    can: ticketPermissions(user, orgId, ticket),
  });
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
  if (rejectIfArchived(ticket, res)) return;
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
    if (!admin && !(isReporter && !internal)) return res.status(403).json({ error: "Only admins can edit ticket details" });
    data.title = body.title;
  }
  if (body.description !== undefined) {
    if (!admin && !(isReporter && !internal)) return res.status(403).json({ error: "Only admins can edit ticket details" });
    data.description = body.description;
  }
  for (const field of ["priority", "type", "dueDate", "estimate"] as const) {
    if (body[field] !== undefined) {
      // Priority is a working field for the internal team; the rest are ticket details (admins only).
      if (field === "priority" ? !internal : !admin) {
        return res.status(403).json({ error: field === "priority" ? "Cannot edit priority" : "Only admins can edit ticket details" });
      }
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

  const oldAssignee =
    newAssignee !== undefined && ticket.assigneeId
      ? await prisma.user.findUnique({ where: { id: ticket.assigneeId }, select: { name: true } })
      : null;
  const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.ticket.update({
      where: { id: ticket.id },
      data,
      include: ticketInclude,
    });
    const log = (a: Omit<Parameters<typeof logActivity>[1], "ticketId" | "actorId">) =>
      logActivity(tx, { ticketId: ticket.id, actorId: user.id, ...a });

    if (statusChanged) {
      // Source of truth for "when was this completed" — see the model's doc
      // comment in schema.prisma for why this exists separately from updatedAt.
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: row.status,
          changedById: user.id,
        },
      });
      await log({ type: "STATUS_CHANGED", field: "status", from: ticket.status, to: row.status });
    }
    if (row.priority !== ticket.priority) {
      await log({ type: "PRIORITY_CHANGED", field: "priority", from: ticket.priority, to: row.priority });
    }
    if (row.type !== ticket.type) {
      await log({ type: "TYPE_CHANGED", field: "type", from: ticket.type, to: row.type });
    }
    if (row.title !== ticket.title) {
      await log({ type: "TITLE_CHANGED", field: "title", from: ticket.title.slice(0, 200), to: row.title.slice(0, 200) });
    }
    if (row.description !== ticket.description) {
      await log({ type: "DESCRIPTION_CHANGED", field: "description" });
    }
    if (dayOf(row.dueDate) !== dayOf(ticket.dueDate)) {
      await log({ type: "DUE_DATE_CHANGED", field: "dueDate", from: dayOf(ticket.dueDate), to: dayOf(row.dueDate) });
    }
    if (newAssignee !== undefined && newAssignee !== ticket.assigneeId) {
      await log({
        type: "ASSIGNED",
        field: "assignee",
        from: oldAssignee?.name ?? null,
        to: row.assignee?.name ?? null,
        meta: { fromId: ticket.assigneeId, toId: newAssignee },
      });
    }
    return row;
  });

  const followers = await followerRecipients(ticket.id, orgId, ticket.projectId, {
    customerVisible: true,
  });

  if (statusChanged) {
    await notify({
      recipientIds: [ticket.reporterId, ticket.assigneeId ?? "", ...followers].filter(Boolean),
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
// Delete: SA/Admin of the org, or the ticket's reporter — except Developers,
// who never get delete access even for tickets they reported themselves.
// Comments, attachments and notifications cascade in the DB; uploaded files
// are removed from disk.
ticketsRouter.delete("/:id", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const admin = isAdminOrAbove(user, ticket.project.orgId);
  const isReporterAllowed =
    orgRole(user, ticket.project.orgId) !== "DEVELOPER" && ticket.reporterId === user.id;
  if (!admin && !isReporterAllowed) {
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
  if (rejectIfArchived(ticket, res)) return;
  if (ticket.assigneeId === user.id) {
    const same = await prisma.ticket.findUnique({ where: { id: ticket.id }, include: ticketInclude });
    return res.json(serialize(same));
  }
  const previous = ticket.assigneeId
    ? await prisma.user.findUnique({ where: { id: ticket.assigneeId }, select: { name: true } })
    : null;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.ticket.update({
      where: { id: ticket.id },
      data: { assigneeId: user.id },
      include: ticketInclude,
    });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "ASSIGNED",
      field: "assignee",
      from: previous?.name ?? null,
      to: user.name,
      meta: { fromId: ticket.assigneeId, toId: user.id, self: true },
    });
    return row;
  });
  res.json(serialize(updated));
});