import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { isAdminOrAbove, isClient, isInternal } from "../lib/access.js";
import { loadTicketForUser } from "../lib/ticketAccess.js";
import { deleteFile } from "../lib/storage.js";
import { listNames, notify } from "../lib/notify.js";

// mergeParams to receive :id (ticket id) from the parent mount.
export const commentsRouter = Router({ mergeParams: true });

const authorSelect = { select: { id: true, name: true, avatarUrl: true } };
const attachmentsSelect = {
  select: { id: true, filename: true, mimeType: true, size: true },
  orderBy: { createdAt: "asc" as const },
};

// List comments on a ticket. Clients only see CLIENT_VISIBLE comments.
commentsRouter.get("/", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const clientView = isClient(req.user!, ticket.project.orgId);
  const comments = await prisma.comment.findMany({
    where: {
      ticketId: ticket.id,
      ...(clientView ? { visibility: "CLIENT_VISIBLE" } : {}),
    },
    include: { author: authorSelect, attachments: attachmentsSelect },
    orderBy: { createdAt: "asc" },
  });
  res.json(comments);
});

const createSchema = z.object({
  body: z.string().min(1),
  visibility: z.enum(["INTERNAL", "CLIENT_VISIBLE"]).optional(),
  parentId: z.string().nullish(),
  mentions: z.array(z.string()).optional(),
});

commentsRouter.post("/", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { body, parentId, mentions = [] } = parsed.data;
  const user = req.user!;
  const orgId = ticket.project.orgId;
  const internal = isInternal(user, orgId);

  // Clients can only post client-visible comments; internal team chooses.
  const visibility = internal ? parsed.data.visibility ?? "INTERNAL" : "CLIENT_VISIBLE";

  if (parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: parentId } });
    if (!parent || parent.ticketId !== ticket.id) {
      return res.status(400).json({ error: "Invalid parentId" });
    }
  }

  const comment = await prisma.comment.create({
    data: { ticketId: ticket.id, authorId: user.id, body, visibility, parentId: parentId ?? null },
    include: { author: authorSelect },
  });

  // --- Notifications, respecting visibility ---
  // Candidate recipients: reporter + assignee + mentioned users. Clients must
  // NOT be notified about INTERNAL comments; notify() additionally drops
  // non-members and clients not attached to the project.
  const candidateIds = [
    ...new Set([ticket.reporterId, ticket.assigneeId ?? "", ...mentions].filter(Boolean)),
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

  const commentRecipients = [ticket.reporterId, ticket.assigneeId ?? ""]
    .filter(Boolean)
    .filter((id) => canSee(id) && !mentionIds.includes(id));
  if (commentRecipients.length) {
    await notify({
      recipientIds: commentRecipients,
      type: "COMMENTED",
      ticket,
      orgId,
      actorId: user.id,
      message: `${user.name} commented on "${ticket.title}".`,
    });
  }

  res.status(201).json(comment);
});

// Delete a comment: author or SA/Admin of the org. Replies and attachment rows
// cascade in the DB; attachment files (of the comment and its replies) are
// removed from disk.
commentsRouter.delete("/:commentId", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId } });
  if (!comment || comment.ticketId !== ticket.id) {
    return res.status(404).json({ error: "Not found" });
  }
  const user = req.user!;
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

  await prisma.comment.delete({ where: { id: comment.id } });
  for (const a of attachments) await deleteFile(a.storageKey);

  res.json({ ok: true });
});
