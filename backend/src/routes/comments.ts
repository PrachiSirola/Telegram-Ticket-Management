import { Router } from "express";
import { z } from "zod";
import { db, deleteCommentCascade, withTransaction } from "../db/index.js";
import type { Comment } from "../db/types.js";
import { requireAuth } from "../middleware/auth.js";
import { isAdminOrAbove, isClient, isInternal } from "../lib/access.js";
import { loadTicketForUser, rejectIfArchived } from "../lib/ticketAccess.js";
import { deleteFile } from "../lib/storage.js";
import { listNames, notify } from "../lib/notify.js";
import { attachmentVisibleFilter } from "../lib/attachmentAccess.js";
import { and } from "../lib/mongoFilters.js";
import { usersById } from "../lib/hydrate.js";
import { logActivity } from "../lib/activity.js";
import { followerRecipients } from "../lib/followers.js";
export const commentsRouter = Router({ mergeParams: true });

const MAX_COMMENT_LENGTH = 10_000;

async function decorate(comments: Comment[], user: Parameters<typeof attachmentVisibleFilter>[0], orgId: string) {
  if (comments.length === 0) return [];
  const [authors, files] = await Promise.all([
    usersById(comments.map((c) => c.authorId)),
    attachmentVisibleFilter(user, orgId).then((visible) =>
      db.attachments.find(and({ commentId: { $in: comments.map((c) => c.id) } }, visible), {
        sort: { createdAt: 1, _id: 1 },
        select: ["commentId", "filename", "mimeType", "size", "createdAt"],
      }),
    ),
  ]);
  return comments.map((c) => {
    const a = authors.get(c.authorId);
    return {
      ...c,
      author: a ? { id: a.id, name: a.name, avatarUrl: a.avatarUrl } : null,
      attachments: files
        .filter((f) => f.commentId === c.id)
        .map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt })),
    };
  });
}
const decorateOne = async (c: Comment, user: Parameters<typeof attachmentVisibleFilter>[0], orgId: string) =>
  (await decorate([c], user, orgId))[0];

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
    canEdit: !archived && c.authorId === user.id,
    canDelete: !archived && (c.authorId === user.id || admin),
  };
}

commentsRouter.get("/", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const clientView = isClient(user, orgId);
  const rows = await db.comments.find(
    { ticketId: ticket.id, ...(clientView ? { visibility: "CLIENT_VISIBLE" } : {}) },
    { sort: { createdAt: 1, _id: 1 } },
  );
  const comments = await decorate(rows, user, orgId);
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

  let visibility: "INTERNAL" | "CLIENT_VISIBLE" = internal
    ? parsed.data.visibility ?? "INTERNAL"
    : "CLIENT_VISIBLE";
  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await db.comments.byId(parsed.data.parentId);
    if (!parent || parent.ticketId !== ticket.id) {
      return res.status(400).json({ error: "Invalid parentId" });
    }
    if (parent.visibility === "INTERNAL" && !internal) {
      return res.status(400).json({ error: "Invalid parentId" });
    }
    if (parent.visibility === "INTERNAL") visibility = "INTERNAL";
    parentId = parent.parentId ?? parent.id;
  }

  const comment = await withTransaction(async (tx) => {
    const created = await db.comments.create(
      { ticketId: ticket.id, authorId: user.id, body, visibility, parentId },
      { session: tx },
    );
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
  const followers = await followerRecipients(ticket.id, orgId, ticket.projectId, {
    customerVisible: visibility === "CLIENT_VISIBLE",
  });
  const candidateIds = [
    ...new Set([ticket.reporterId, ...ticket.assigneeIds, ...mentions, ...followers].filter(Boolean)),
  ];
  const memberships = await db.memberships.find({ orgId, userId: { $in: candidateIds } });
  const clientIds = new Set(
    memberships.filter((m) => m.role === "CLIENT").map((m) => m.userId),
  );
  const canSee = (id: string) => visibility === "CLIENT_VISIBLE" || !clientIds.has(id);

  const mentionIds = mentions.filter(canSee);
  if (mentionIds.length) {
    const mentionedUsers = await db.users.find({ _id: { $in: mentionIds } });
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

  const commentRecipients = [ticket.reporterId, ...ticket.assigneeIds, ...followers]
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

  res.status(201).json(serialize(await decorateOne(comment, user, orgId), user, isAdminOrAbove(user, orgId), false));
});

commentsRouter.patch("/:commentId", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (rejectIfArchived(ticket, res)) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const comment = await db.comments.byId(req.params.commentId);
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
    return res.json(serialize(await decorateOne(comment, user, orgId), user, isAdminOrAbove(user, orgId), false));
  }
  const updated = await withTransaction(async (tx) => {
    const row = await db.comments.mustUpdate(
      { _id: comment.id },
      { body: parsed.data.body, editedAt: new Date() },
      { session: tx },
    );
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
  res.json(serialize(await decorateOne(updated, user, orgId), user, isAdminOrAbove(user, orgId), false));
});
commentsRouter.delete("/:commentId", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (rejectIfArchived(ticket, res)) return;
  const comment = await db.comments.byId(req.params.commentId);
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

  const replies = await db.comments.find({ parentId: comment.id }, { select: ["id"] });

  const storageKeys = await withTransaction(async (tx) => {
    const keys = await deleteCommentCascade(comment.id, { session: tx });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "COMMENT_DELETED",
      field: "comment",
      meta: { commentId: comment.id, replies: replies.length },
      internalOnly: comment.visibility === "INTERNAL",
    });
    return keys;
  });
  for (const key of storageKeys) await deleteFile(key);

  res.json({ ok: true });
});