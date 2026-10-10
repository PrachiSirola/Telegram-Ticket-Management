import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { isAdminOrAbove, isClient, isInternal } from "../lib/access.js";
import { loadTicketForUser, rejectIfArchived } from "../lib/ticketAccess.js";
import { deleteFile } from "../lib/storage.js";
import { listNames, notify } from "../lib/notify.js";
import { attachmentVisibleWhere } from "../lib/attachmentAccess.js";
import { logActivity } from "../lib/activity.js";
import { followerRecipients } from "../lib/followers.js";

// mergeParams to receive :id (ticket id) from the parent mount.
export const commentsRouter = Router({ mergeParams: true });

const MAX_COMMENT_LENGTH = 10_000;

const authorSelect = { select: { id: true, name: true, avatarUrl: true } };

function attachmentsSelect(user: Parameters<typeof attachmentVisibleWhere>[0], orgId: string) {
  return {
    where: attachmentVisibleWhere(user, orgId),
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
    orderBy: { createdAt: "asc" as const },
  };
}

const PREVIEW_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

function serialize(
  c: any,
  user: { id: string },
  admin: boolean,
  archived: boolean,
) {
  return {
    ...c,
    attachments: (c.attachments ?? []).map((a: any) => ({
      ...a,
      previewable: PREVIEW_MIMES.has(a.mimeType),
    })),
    // Only the author edits their words; author or an Admin can remove.
    canEdit: !archived && c.authorId === user.id,
    canDelete: !archived && (c.authorId === user.id || admin),
  };
}

// List comments on a ticket. Clients only see CLIENT_VISIBLE comments.
commentsRouter.get("/", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const clientView = isClient(user, orgId);
  const comments = await prisma.comment.findMany({
    where: {
      ticketId: ticket.id,
      ...(clientView ? { visibility: "CLIENT_VISIBLE" } : {}),
    },
    include: { author: authorSelect, attachments: attachmentsSelect(user, orgId) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const admin = isAdminOrAbove(user, orgId);
  res.json(comments.map((c) => serialize(c, user, admin, Boolean(ticket.archivedAt || ticket.project.archivedAt))));
});

const bodySchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, "Write something first.")
      .max(MAX_COMMENT_LENGTH, `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`),
  );

const createSchema = z.object({
  body: bodySchema,
  visibility: z.enum(["INTERNAL", "CLIENT_VISIBLE"]).optional(),
  parentId: z.string().nullish(),
  mentions: z.array(z.string()).optional(),
});

commentsRouter.post("/", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (rejectIfArchived(ticket, res)) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid comment";
    return res.status(400).json({ error: msg, details: parsed.error.flatten() });
  }
  const { body, mentions = [] } = parsed.data;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const internal = isInternal(user, orgId);

  // Clients can only post client-visible comments; internal team chooses.
  let visibility: "INTERNAL" | "CLIENT_VISIBLE" = internal
    ? parsed.data.visibility ?? "INTERNAL"
    : "CLIENT_VISIBLE";

  // Replies are one level deep: replying to a reply attaches to the thread's root.
  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: parsed.data.parentId } });
    if (!parent || parent.ticketId !== ticket.id) {
      return res.status(400).json({ error: "Invalid parentId" });
    }
    // A customer can't reply into a thread they can't see.
    if (parent.visibility === "INTERNAL" && !internal) {
      return res.status(400).json({ error: "Invalid parentId" });
    }
    // A reply to an internal thread can never be customer-visible (would leak the context).
    if (parent.visibility === "INTERNAL") visibility = "INTERNAL";
    parentId = parent.parentId ?? parent.id;
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { ticketId: ticket.id, authorId: user.id, body, visibility, parentId },
      include: { author: authorSelect, attachments: attachmentsSelect(user, orgId) },
    });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "COMMENT_ADDED",
      field: parentId ? "reply" : "comment",
      meta: { commentId: created.id, parentId },
      internalOnly: visibility === "INTERNAL",
    });
    return created;
  });

  // --- Notifications, respecting visibility ---
  // Candidate recipients: reporter + assignee + mentioned users. Clients must
  // NOT be notified about INTERNAL comments; notify() additionally drops
  // non-members and clients not attached to the project.
  const followers = await followerRecipients(ticket.id, orgId, ticket.projectId, {
    customerVisible: visibility === "CLIENT_VISIBLE",
  });
  const candidateIds = [
    ...new Set([ticket.reporterId, ticket.assigneeId ?? "", ...mentions, ...followers].filter(Boolean)),
  ];
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, userId: { in: candidateIds } },
  });
  const clientIds = new Set(
    memberships.filter((m) => m.role === "CLIENT").map((m) => m.userId),
  );
  const canSee = (id: string) => visibility === "CLIENT_VISIBLE" || !clientIds.has(id);

  const mentionIds = mentions.filter(canSee);
  if (mentionIds.length) {
    const mentionedUsers = await prisma.user.findMany({
      where: { id: { in: mentionIds } },
      select: { name: true },
    });
    await notify({
      recipientIds: mentionIds,
      type: "MENTIONED",
      ticket,
      orgId,
      actorId: user.id,
      message: `${user.name} mentioned you on "${ticket.title}".`,
      telegram: true,
      telegramMessage: `${user.name} mentioned ${listNames(mentionedUsers.map((u) => u.name))} on "${ticket.title}".`,
    });
  }

  const commentRecipients = [ticket.reporterId, ticket.assigneeId ?? "", ...followers]
    .filter(Boolean)
    .filter((id) => canSee(id) && !mentionIds.includes(id));
  if (commentRecipients.length) {
    await notify({
      recipientIds: commentRecipients,
      type: "COMMENTED",
      ticket,
      orgId,
      actorId: user.id,
      message: `${user.name} ${parentId ? "replied on" : "commented on"} "${ticket.title}".`,
    });
  }

  res.status(201).json(serialize(comment, user, isAdminOrAbove(user, orgId), false));
});

// Edit a comment's text: the AUTHOR only (an Admin may remove a comment, but
// never rewrite someone else's words). Visibility can't be changed afterwards.
commentsRouter.patch("/:commentId", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (rejectIfArchived(ticket, res)) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId } });
  // Customers can't even tell internal comments exist.
  if (
    !comment ||
    comment.ticketId !== ticket.id ||
    (comment.visibility === "INTERNAL" && isClient(user, orgId))
  ) {
    return res.status(404).json({ error: "Not found" });
  }
  if (comment.authorId !== user.id) {
    return res.status(403).json({ error: "You can only edit your own comments." });
  }
  const parsed = z.object({ body: bodySchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid comment" });
  }
  if (parsed.data.body === comment.body) {
    const same = await prisma.comment.findUnique({
      where: { id: comment.id },
      include: { author: authorSelect, attachments: attachmentsSelect(user, orgId) },
    });
    return res.json(serialize(same, user, isAdminOrAbove(user, orgId), false));
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.comment.update({
      where: { id: comment.id },
      data: { body: parsed.data.body, editedAt: new Date() },
      include: { author: authorSelect, attachments: attachmentsSelect(user, orgId) },
    });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "COMMENT_EDITED",
      field: "comment",
      meta: { commentId: comment.id },
      internalOnly: comment.visibility === "INTERNAL",
    });
    return row;
  });
  res.json(serialize(updated, user, isAdminOrAbove(user, orgId), false));
});

// Delete a comment: author or SA/Admin of the org. Replies and attachment rows
// cascade in the DB; attachment files (of the comment and its replies) are
// removed from disk.
commentsRouter.delete("/:commentId", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (rejectIfArchived(ticket, res)) return;
  const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId } });
  const user = req.user!;
  if (
    !comment ||
    comment.ticketId !== ticket.id ||
    (comment.visibility === "INTERNAL" && isClient(user, ticket.project.orgId))
  ) {
    return res.status(404).json({ error: "Not found" });
  }
  if (comment.authorId !== user.id && !isAdminOrAbove(user, ticket.project.orgId)) {
    return res.status(403).json({ error: "Can only delete your own comment" });
  }

  const replies = await prisma.comment.findMany({
    where: { parentId: comment.id },
    select: { id: true },
  });
  const attachments = await prisma.attachment.findMany({
    where: { commentId: { in: [comment.id, ...replies.map((r) => r.id)] } },
    select: { storageKey: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.comment.delete({ where: { id: comment.id } });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "COMMENT_DELETED",
      field: "comment",
      meta: { commentId: comment.id, replies: replies.length },
      internalOnly: comment.visibility === "INTERNAL",
    });
  });
  for (const a of attachments) await deleteFile(a.storageKey);

  res.json({ ok: true });
});