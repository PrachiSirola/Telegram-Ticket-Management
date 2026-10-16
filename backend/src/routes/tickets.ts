import { Router } from "express";
import { z } from "zod";
import { db, deleteTicketsCascade, withTransaction } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrgAccess, requireProjectAccess } from "../middleware/org.js";
import { isAdminOrAbove, isInternal, orgRole } from "../lib/access.js";
import { loadTicketForUser, loadTicketWithProject, rejectIfArchived, userCanAccessTicket } from "../lib/ticketAccess.js";
import { confirmed } from "../lib/confirmName.js";
import { deleteTicketFiles } from "../lib/storage.js";
import { listNames, notify } from "../lib/notify.js";
import { logActivity } from "../lib/activity.js";
import { parseDueRange } from "../lib/dueRange.js";
import { followerRecipients } from "../lib/followers.js";
import { contains } from "../lib/mongoFilters.js";
import { hydrateTicket, hydrateTickets } from "../lib/hydrate.js";
import { queryTickets } from "../lib/ticketQuery.js";
import { paginate, parsePageParams, wantsPagination } from "../lib/pagination.js";
import { assigneeFields, diffAssignees, requestedAssignees, validateAssignees } from "../lib/assignees.js";

const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);
const listFilterSchema = z.object({
  status: z.preprocess(emptyToUndef, z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional()),
  priority: z.preprocess(emptyToUndef, z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()),
  type: z.preprocess(emptyToUndef, z.enum(["BUG", "FEATURE", "TASK"]).optional()),
  assigneeId: z.preprocess(emptyToUndef, z.string().optional()),
  q: z.preprocess(emptyToUndef, z.string().optional()),
  archived: z.preprocess(emptyToUndef, z.enum(["active", "archived", "all"]).optional()),

  dueDate: z.preprocess(
    emptyToUndef,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d))
      .optional(),
  ),
});

export function ticketPermissions(
  user: Parameters<typeof isInternal>[0],
  orgId: string,
  ticket: { reporterId: string; archivedAt: Date | null; project?: { archivedAt: Date | null } | null },
) {
  const internal = isInternal(user, orgId);
  const admin = isAdminOrAbove(user, orgId);
  const reporter = ticket.reporterId === user.id;
  const projectArchived = Boolean(ticket.project?.archivedAt);
  const live = !ticket.archivedAt && !projectArchived;
  return {
    edit: live && (admin || (reporter && !internal)),
    changeStatus: live && internal,
    changePriority: live && internal,
    assign: live && admin,
    selfAssign: live && admin,
    duplicate: admin && !projectArchived,
    addFollower: admin && !projectArchived,
    move: live && admin,
    archive: live && admin,
    restore: Boolean(ticket.archivedAt) && !projectArchived && admin,
    delete: admin || (orgRole(user, orgId) !== "DEVELOPER" && reporter),
  };
}

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
    assignees: t.assignees ?? [],
    assigneeIds: t.assigneeIds ?? [],
    reporter: t.reporter ?? null,
    archivedAt: t.archivedAt ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export const projectTicketsRouter = Router({ mergeParams: true });

projectTicketsRouter.get(
  "/",
  requireAuth,
  requireOrgAccess,
  requireProjectAccess,
  async (req, res) => {
    const filters = listFilterSchema.safeParse(req.query);
    if (!filters.success) return res.status(400).json({ error: "Invalid filter value" });
    const { status, priority, type, assigneeId, q, archived } = filters.data;
    const org = await db.orgs.byId(req.params.orgId);
    const due = parseDueRange(req.query, org?.timezone);
    if (!due.ok) return res.status(400).json({ error: due.error });


    const archivedMode = isInternal(req.user!, req.params.orgId) ? archived ?? "active" : "active";
    const where = {
      projectId: req.project!.id,
      ...(archivedMode === "active" ? { archivedAt: null } : {}),
      ...(archivedMode === "archived" ? { archivedAt: { $ne: null } } : {}),
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(type ? { type } : {}),
      ...(assigneeId === "unassigned" ? { assigneeIds: { $size: 0 } } : assigneeId ? { assigneeIds: assigneeId } : {}),
      ...due.where,
      ...(q ? { title: contains(q) } : {}),
    };

    if (!wantsPagination(req.query)) {
      const tickets = await queryTickets(where, "updated");
      return res.json((await hydrateTickets(tickets)).map(serialize));
    }


    const paged = await paginate(
      parsePageParams(req.query),
      () => db.tickets.count(where),
      async (skip, take) => hydrateTickets(await queryTickets(where, "updated", { skip, take })),
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
  ...assigneeFields,
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


    let assigneeIds: string[] = [];
    const requested = requestedAssignees(data);
    if (requested?.length) {
      if (!isAdminOrAbove(user, orgId)) {
        return res.status(403).json({ error: "Only admins can assign on create" });
      }
      const check = await validateAssignees(requested, orgId, projectId, []);
      if (!check.ok) return res.status(400).json({ error: check.error });
      assigneeIds = check.ids;
    }

    const ticket = await withTransaction(async (tx) => {
      const row = await db.tickets.create(
        {
          projectId,
          title: data.title,
          description: data.description ?? "",
          priority: data.priority ?? "MEDIUM",
          type: data.type ?? "TASK",
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          estimate: data.estimate ?? null,
          reporterId: user.id,
          assigneeIds,
        },
        { session: tx },
      );
      const created = await hydrateTicket(row, tx);
      await logActivity(tx, {
        ticketId: created.id,
        actorId: user.id,
        type: "TICKET_CREATED",
        to: created.title,
      });
      for (const a of created.assignees) {
        await logActivity(tx, {
          ticketId: created.id,
          actorId: user.id,
          type: "ASSIGNED",
          field: "assignee",
          from: null,
          to: a.name,
          meta: { toId: a.id },
        });
      }
      return created;
    });


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
        `Assigned: ${ticket.assignees.length ? ticket.assignees.map((a) => a.name).join(", ") : "Unassigned"}`,
    });

    if (assigneeIds.length) {
      await notify({
        recipientIds: assigneeIds,
        type: "ASSIGNED",
        ticket,
        orgId,
        actorId: user.id,
        message: `${user.name} assigned you the ticket "${ticket.title}".`,
      });
    }


    if (data.mentions?.length) {
      const mentioned = await db.users.find({ _id: { $in: data.mentions } });
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


export const ticketsRouter = Router();

const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]),
});

ticketsRouter.post("/bulk-status", requireAuth, async (req, res) => {
  const parsed = bulkStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select 1–100 tickets and a valid status." });
  const { status } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];
  const user = req.user!;

  const updated: { id: string; title: string }[] = [];
  const skipped: { id: string; title: string; reason: string }[] = [];
  const failed: { id: string; title: string | null; reason: string }[] = [];

  for (const id of ids) {
    try {
      const ticket = await loadTicketWithProject(id);

      if (!ticket || !(await userCanAccessTicket(user, ticket))) {
        failed.push({ id, title: null, reason: "Ticket not found" });
        continue;
      }
      const orgId = ticket.project.orgId;
      if (!isInternal(user, orgId)) {
        failed.push({ id, title: ticket.title, reason: "You can't change the status of this ticket" });
        continue;
      }
      if (ticket.project.archivedAt) {
        failed.push({ id, title: ticket.title, reason: "Its project is archived" });
        continue;
      }
      if (ticket.archivedAt) {
        failed.push({ id, title: ticket.title, reason: "The ticket is archived" });
        continue;
      }
      if (ticket.status === status) {
        skipped.push({ id, title: ticket.title, reason: "Already in that status" });
        continue;
      }

      const row = await withTransaction(async (tx) => {
        const r = await hydrateTicket(await db.tickets.mustUpdate({ _id: id }, { status }, { session: tx }), tx);
        await db.statusHistory.create(
          { ticketId: id, fromStatus: ticket.status, toStatus: status, changedById: user.id },
          { session: tx },
        );
        await logActivity(tx, {
          ticketId: id,
          actorId: user.id,
          type: "STATUS_CHANGED",
          field: "status",
          from: ticket.status,
          to: status,
        });
        return r;
      });
      updated.push({ id, title: row.title });


      try {
        const followers = await followerRecipients(id, orgId, ticket.projectId, { customerVisible: true });
        await notify({
          recipientIds: [ticket.reporterId, ...ticket.assigneeIds, ...followers].filter(Boolean),
          type: "STATUS_CHANGED",
          ticket: row,
          orgId,
          actorId: user.id,
          message: `${user.name} moved "${row.title}" to ${row.status.replace("_", " ")}.`,
          telegram: true,
        });
      } catch (err) {
        console.error("bulk-status notify failed", id, err);
      }
    } catch (err) {
      console.error("bulk-status failed", id, err);
      failed.push({ id, title: null, reason: "Something went wrong saving this ticket" });
    }
  }

  res.json({ status, updated, skipped, failed });
});

ticketsRouter.get("/:id", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const full = await hydrateTicket(await db.tickets.mustById(ticket.id));
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const internal = isInternal(user, orgId);
  const following = internal
    ? await db.followers.exists({ ticketId: ticket.id, userId: user.id })
    : false;
  res.json({
    ...serialize(full),
    followerCount: internal ? await db.followers.count({ ticketId: ticket.id }) : undefined,
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
  ...assigneeFields,
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


  let statusChanged = false;
  if (body.status !== undefined) {
    if (!internal) return res.status(403).json({ error: "Cannot change status" });
    statusChanged = body.status !== ticket.status;
    data.status = body.status;
  }


  const before = ticket.assigneeIds ?? [];
  let after = before;
  const requested = requestedAssignees(body);
  if (requested !== undefined) {
    if (!admin) return res.status(403).json({ error: "Only admins can assign or unassign" });
    const check = await validateAssignees(requested, orgId, ticket.projectId, before);
    if (!check.ok) return res.status(400).json({ error: check.error });
    after = check.ids;
    data.assigneeIds = after;
  }
  const { added, removed } = diffAssignees(before, after);
  const names = new Map(
    (await db.users.find({ _id: { $in: [...added, ...removed] } })).map((u) => [u.id, u.name] as const),
  );
  const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  const updated = await withTransaction(async (tx) => {
    const row = await hydrateTicket(await db.tickets.mustUpdate({ _id: ticket.id }, data, { session: tx }), tx);
    const log = (a: Omit<Parameters<typeof logActivity>[1], "ticketId" | "actorId">) =>
      logActivity(tx, { ticketId: ticket.id, actorId: user.id, ...a });

    if (statusChanged) {
      await db.statusHistory.create(
        {
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: row.status,
          changedById: user.id,
        },
        { session: tx },
      );
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
    for (const id of added) {
      await log({ type: "ASSIGNED", field: "assignee", from: null, to: names.get(id) ?? null, meta: { toId: id } });
    }
    for (const id of removed) {
      await log({ type: "ASSIGNED", field: "assignee", from: names.get(id) ?? null, to: null, meta: { fromId: id, toId: null } });
    }
    return row;
  });

  const followers = await followerRecipients(ticket.id, orgId, ticket.projectId, {
    customerVisible: true,
  });

  if (statusChanged) {
    await notify({
      recipientIds: [ticket.reporterId, ...after, ...followers].filter(Boolean),
      type: "STATUS_CHANGED",
      ticket: updated,
      orgId,
      actorId: user.id,
      message: `${user.name} moved "${updated.title}" to ${updated.status.replace("_", " ")}.`,
      telegram: true,
    });
  }
  if (added.length) {
    await notify({
      recipientIds: added,
      type: "ASSIGNED",
      ticket: updated,
      orgId,
      actorId: user.id,
      message: `${user.name} assigned "${updated.title}" to ${listNames(added.map((id) => names.get(id) ?? "someone"))}.`,
      telegram: true,
    });
  }

  res.json(serialize(updated));
});

async function loadDeletableTicket(req: any, res: any) {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return null;
  const user = req.user!;
  const admin = isAdminOrAbove(user, ticket.project.orgId);
  const isReporterAllowed =
    orgRole(user, ticket.project.orgId) !== "DEVELOPER" && ticket.reporterId === user.id;
  if (!admin && !isReporterAllowed) {
    res.status(403).json({ error: "Only the reporter or an admin can delete" });
    return null;
  }
  return ticket;
}


ticketsRouter.get("/:id/impact", requireAuth, async (req, res) => {
  const ticket = await loadDeletableTicket(req, res);
  if (!ticket) return;
  const [comments, attachments, activity, followers] = await Promise.all([
    db.comments.count({ ticketId: ticket.id }),
    db.attachments.count({ ticketId: ticket.id }),
    db.activity.count({ ticketId: ticket.id }),
    db.followers.count({ ticketId: ticket.id }),
  ]);
  res.json({ comments, attachments, activity, followers });
});

ticketsRouter.delete("/:id", requireAuth, async (req, res) => {
  const ticket = await loadDeletableTicket(req, res);
  if (!ticket) return;
  if (!confirmed(req.body?.confirmTicketName, ticket.title)) {
    return res.status(400).json({ error: "Type the ticket's name to confirm deleting it." });
  }
  await withTransaction((session) => deleteTicketsCascade([ticket.id], { session }));
  await deleteTicketFiles(ticket.id);
  res.json({ ok: true });
});


ticketsRouter.post("/:id/self-assign", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  if (!isAdminOrAbove(user, orgId)) {
    return res.status(403).json({ error: "Only admins can assign tickets" });
  }
  if (rejectIfArchived(ticket, res)) return;
  const before = ticket.assigneeIds ?? [];
  if (before.includes(user.id)) {
    const same = await hydrateTicket(await db.tickets.mustById(ticket.id));
    return res.json(serialize(same));
  }
  const check = await validateAssignees([...before, user.id], orgId, ticket.projectId, before);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const updated = await withTransaction(async (tx) => {
    const row = await hydrateTicket(
      await db.tickets.mustUpdate({ _id: ticket.id }, { assigneeIds: check.ids }, { session: tx }),
      tx,
    );
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "ASSIGNED",
      field: "assignee",
      from: null,
      to: user.name,
      meta: { toId: user.id, self: true },
    });
    return row;
  });
  res.json(serialize(updated));
});
