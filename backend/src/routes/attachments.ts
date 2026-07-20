import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessOrg, isClient, isInternal, membershipIn } from "../lib/access.js";
import { loadTicketForUser } from "../lib/ticketAccess.js";
import { deleteFile, resolveStoredPath, saveFile } from "../lib/storage.js";

// Images only for now. Add back PDF/docs/etc. here when needed.
const ALLOWED: (string | RegExp)[] = [/^image\//];

const MAX_IMAGES_PER_COMMENT = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED.some((a) =>
      a instanceof RegExp ? a.test(file.mimetype) : a === file.mimetype,
    );
    cb(null, ok);
  },
});

const select = {
  id: true,
  filename: true,
  mimeType: true,
  size: true,
  visibility: true,
  createdAt: true,
  uploader: { select: { id: true, name: true } },
};

// ---------------------------------------------------------------------------
// /tickets/:id/attachments
// ---------------------------------------------------------------------------
export const attachmentsRouter = Router({ mergeParams: true });

attachmentsRouter.get("/", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const clientView = isClient(req.user!, ticket.project.orgId);
  // Comment-scoped attachments are rendered inline with their comment, not here.
  const attachments = await prisma.attachment.findMany({
    where: {
      ticketId: ticket.id,
      commentId: null,
      ...(clientView ? { visibility: "CLIENT_VISIBLE" } : {}),
    },
    select,
    orderBy: { createdAt: "desc" },
  });
  res.json(attachments);
});

attachmentsRouter.post("/", requireAuth, upload.single("file"), async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (!req.file) {
    return res.status(400).json({ error: "No file (check size limit / allowed type)" });
  }
  const internal = isInternal(req.user!, ticket.project.orgId);
  // Clients can only upload client-visible files; internal team may choose.
  const requested = req.body?.visibility === "INTERNAL" ? "INTERNAL" : "CLIENT_VISIBLE";
  let visibility: "INTERNAL" | "CLIENT_VISIBLE" = internal ? requested : "CLIENT_VISIBLE";

  // Optional comment scope: the file is shown inline with that comment.
  const commentId = typeof req.body?.commentId === "string" ? req.body.commentId : null;
  if (commentId) {
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "Only images can be attached to comments" });
    }
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.ticketId !== ticket.id) {
      return res.status(400).json({ error: "Invalid commentId" });
    }
    if (comment.authorId !== req.user!.id) {
      return res.status(403).json({ error: "Can only attach to your own comment" });
    }
    const count = await prisma.attachment.count({ where: { commentId } });
    if (count >= MAX_IMAGES_PER_COMMENT) {
      return res.status(400).json({ error: `Max ${MAX_IMAGES_PER_COMMENT} images per comment` });
    }
    visibility = comment.visibility;
  }

  const safeExt = path.extname(req.file.originalname).slice(0, 12).replace(/[^.\w]/g, "");
  const key = `${randomUUID()}${safeExt}`;
  const storageKey = await saveFile(ticket.id, key, req.file.buffer);

  const attachment = await prisma.attachment.create({
    data: {
      ticketId: ticket.id,
      commentId,
      uploaderId: req.user!.id,
      filename: req.file.originalname.slice(0, 255),
      mimeType: req.file.mimetype,
      size: req.file.size,
      storageKey,
      visibility,
    },
    select,
  });
  res.status(201).json(attachment);
});

// ---------------------------------------------------------------------------
// /attachments/:attId  (download + delete)
// ---------------------------------------------------------------------------
export const attachmentFileRouter = Router();

async function loadAttachmentForUser(req: any, res: any) {
  const att = await prisma.attachment.findUnique({ where: { id: req.params.attId } });
  if (!att) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  const ticket = await prisma.ticket.findUnique({
    where: { id: att.ticketId },
    include: { project: true },
  });
  const orgId = ticket?.project.orgId;
  if (!ticket || !orgId || !canAccessOrg(req.user, orgId)) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (isClient(req.user, orgId)) {
    // Clients: must be attached to the project, and never see internal files.
    const membership = membershipIn(req.user, orgId)!;
    const attached = await prisma.projectClient.findUnique({
      where: {
        projectId_membershipId: { projectId: ticket.projectId, membershipId: membership.id },
      },
    });
    if (!attached || att.visibility === "INTERNAL") {
      res.status(404).json({ error: "Not found" });
      return null;
    }
  }
  return { att, ticket };
}

attachmentFileRouter.get("/:attId/download", requireAuth, async (req, res) => {
  const loaded = await loadAttachmentForUser(req, res);
  if (!loaded) return;
  const abs = resolveStoredPath(loaded.att.storageKey);
  if (!abs) return res.status(404).json({ error: "File missing" });
  res.setHeader("Content-Type", loaded.att.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${loaded.att.filename}"`);
  res.sendFile(abs);
});

attachmentFileRouter.delete("/:attId", requireAuth, async (req, res) => {
  const loaded = await loadAttachmentForUser(req, res);
  if (!loaded) return;
  const { att, ticket } = loaded;
  const isUploader = att.uploaderId === req.user!.id;
  if (!isUploader && !isInternal(req.user!, ticket.project.orgId)) {
    return res.status(403).json({ error: "Cannot delete this attachment" });
  }
  await prisma.attachment.delete({ where: { id: att.id } });
  await deleteFile(att.storageKey);
  res.json({ ok: true });
});
