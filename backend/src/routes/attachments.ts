import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { db, deleteAttachmentsWhere, withTransaction } from "../db/index.js";
import type { Attachment } from "../db/types.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessOrg, isAdminOrAbove, isInternal } from "../lib/access.js";
import { loadTicketForUser, loadTicketWithProject, rejectIfArchived, userCanAccessTicket } from "../lib/ticketAccess.js";
import { deleteFile, resolveStoredPath, saveFile } from "../lib/storage.js";
import {
  checkUpload,
  contentDisposition,
  MAX_FILES_PER_UPLOAD,
  FILE_KINDS,
} from "../lib/fileValidation.js";
import {
  ATTACHMENT_VISIBILITIES,
  attachmentVisibleFilter,
  canSeeAttachment,
  parseIdList,
  projectMemberPool,
  type AttVisibility,
} from "../lib/attachmentAccess.js";
import { logActivity } from "../lib/activity.js";
import { and } from "../lib/mongoFilters.js";
import { usersById } from "../lib/hydrate.js";

const MAX_BYTES = env.maxUploadMb * 1024 * 1024;
const MAX_FILES_PER_COMMENT = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_FILES_PER_UPLOAD + 1 },
});
const uploadFields = upload.fields([
  { name: "file", maxCount: MAX_FILES_PER_UPLOAD + 1 },
  { name: "files", maxCount: MAX_FILES_PER_UPLOAD + 1 },
]);
function handleUpload(req: Request, res: Response, next: NextFunction) {
  uploadFields(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `A file is too large (max ${env.maxUploadMb} MB per file).`,
          code: "FILE_TOO_LARGE",
        });
      }
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
          error: `You can upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`,
          code: "TOO_MANY_FILES",
        });
      }
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  });
}

type Row = {
  id: string;
  ticketId: string;
  commentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  visibility: AttVisibility;
  createdAt: Date;
  uploaderId: string;
  uploader: { id: string; name: string };
  access: { userId: string; user: { id: string; name: string } }[];
};

async function hydrateAttachments(rows: Attachment[]): Promise<(Row & { storageKey: string })[]> {
  if (rows.length === 0) return [];
  const access = await db.attachmentAccess.find(
    { attachmentId: { $in: rows.map((r) => r.id) } },
    { sort: { createdAt: 1, _id: 1 } },
  );
  const users = await usersById([...rows.map((r) => r.uploaderId), ...access.map((a) => a.userId)]);
  const person = (id: string) => ({ id, name: users.get(id)?.name ?? "" });
  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    commentId: r.commentId,
    filename: r.filename,
    mimeType: r.mimeType,
    size: r.size,
    visibility: r.visibility,
    createdAt: r.createdAt,
    uploaderId: r.uploaderId,
    storageKey: r.storageKey,
    uploader: person(r.uploaderId),
    access: access.filter((a) => a.attachmentId === r.id).map((a) => ({ userId: a.userId, user: person(a.userId) })),
  }));
}
const hydrateOne = async (r: Attachment) => (await hydrateAttachments([r]))[0];

const isPreviewable = (mime: string) =>
  Object.values(FILE_KINDS).some((k) => k.mime === mime && k.previewable);
export function serializeAttachment(
  a: Row,
  viewer: { id: string },
  orgId: string,
  user: Parameters<typeof isAdminOrAbove>[0],
) {
  const manage = a.uploaderId === viewer.id || isAdminOrAbove(user, orgId);
  const internal = isInternal(user, orgId);
  return {
    id: a.id,
    ticketId: a.ticketId,
    commentId: a.commentId,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    visibility: a.visibility,
    createdAt: a.createdAt,
    uploader: a.uploader,
    previewable: isPreviewable(a.mimeType),
    canDelete: a.uploaderId === viewer.id || internal,
    canChangeVisibility: manage && internal && !a.commentId,
    selectedUsers: internal ? a.access.map((x) => x.user) : undefined,
  };
}
async function resolveVisibility(
  body: Record<string, unknown>,
  orgId: string,
  projectId: string,
  uploaderId: string,
): Promise<
  | { ok: true; visibility: AttVisibility; selected: string[] }
  | { ok: false; error: string }
> {
  const requested = String(body.visibility ?? "CLIENT_VISIBLE") as AttVisibility;
  if (!ATTACHMENT_VISIBILITIES.includes(requested)) {
    return { ok: false, error: "Visibility must be Internal, Customer or Selected Members." };
  }
  if (requested !== "SELECTED") return { ok: true, visibility: requested, selected: [] };
  const ids = parseIdList(body.selectedUserIds).filter((id) => id !== uploaderId);
  if (ids.length === 0) {
    return { ok: false, error: "Pick at least one member to share this file with." };
  }
  const pool = await projectMemberPool(orgId, projectId);
  const allowed = new Set(pool.map((p) => p.userId));
  const bad = ids.filter((id) => !allowed.has(id));
  if (bad.length) {
    return { ok: false, error: "You can only share with members of this project." };
  }
  return { ok: true, visibility: "SELECTED", selected: ids };
}

const VIS_LABEL: Record<AttVisibility, string> = {
  INTERNAL: "Internal",
  CLIENT_VISIBLE: "Customer",
  SELECTED: "Selected members",
};
export const attachmentsRouter = Router({ mergeParams: true });

attachmentsRouter.get("/", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  const orgId = ticket.project.orgId;
  const found = await db.attachments.find(
    and({ ticketId: ticket.id, commentId: null }, await attachmentVisibleFilter(req.user!, orgId)),
    { sort: { createdAt: -1, _id: -1 } },
  );
  const rows = await hydrateAttachments(found);
  res.json(rows.map((r) => serializeAttachment(r as Row, req.user!, orgId, req.user!)));
});
attachmentsRouter.get("/members", requireAuth, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (!isInternal(req.user!, ticket.project.orgId)) {
    return res.status(403).json({ error: "Not allowed" });
  }
  const pool = await projectMemberPool(ticket.project.orgId, ticket.projectId);
  res.json(pool.filter((p) => p.userId !== req.user!.id));
});

attachmentsRouter.post("/", requireAuth, handleUpload, async (req, res) => {
  const ticket = await loadTicketForUser(req, res);
  if (!ticket) return;
  if (rejectIfArchived(ticket, res)) return;
  const user = req.user!;
  const orgId = ticket.project.orgId;

  const grouped = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const files = [...(grouped.file ?? []), ...(grouped.files ?? [])];
  if (files.length === 0) {
    return res.status(400).json({ error: "No file received. Choose at least one file." });
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return res.status(400).json({
      error: `You can upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`,
      code: "TOO_MANY_FILES",
    });
  }
  const checks = files.map((f) => checkUpload(f.originalname, f.buffer, MAX_BYTES));
  const failures = checks.filter((c) => !c.ok) as { filename: string; error: string }[];
  if (failures.length) {
    return res.status(400).json({
      error:
        failures.length === 1
          ? `${failures[0].filename}: ${failures[0].error}`
          : `${failures.length} files were rejected. Nothing was uploaded.`,
      code: "INVALID_FILES",
      files: failures.map((f) => ({ filename: f.filename, error: f.error })),
    });
  }
  const internal = isInternal(user, orgId);
  let visibility: AttVisibility = "CLIENT_VISIBLE";
  let selected: string[] = [];
  const commentId =
    typeof req.body?.commentId === "string" && req.body.commentId ? req.body.commentId : null;
  if (commentId) {
    const comment = await db.comments.byId(commentId);
    if (!comment || comment.ticketId !== ticket.id) {
      return res.status(400).json({ error: "Invalid commentId" });
    }
    if (comment.authorId !== user.id) {
      return res.status(403).json({ error: "You can only attach files to your own comment." });
    }
    const count = await db.attachments.count({ commentId });
    if (count + files.length > MAX_FILES_PER_COMMENT) {
      return res
        .status(400)
        .json({ error: `A comment can have at most ${MAX_FILES_PER_COMMENT} files.` });
    }
    visibility = comment.visibility;
  } else if (internal) {
    const v = await resolveVisibility(req.body ?? {}, orgId, ticket.projectId, user.id);
    if (!v.ok) return res.status(400).json({ error: v.error });
    visibility = v.visibility;
    selected = v.selected;
  }
  const stored: { key: string; check: Extract<(typeof checks)[number], { ok: true }>; size: number }[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const check = checks[i] as Extract<(typeof checks)[number], { ok: true }>;
      const key = await saveFile(ticket.id, `${randomUUID()}.${check.ext}`, files[i].buffer);
      stored.push({ key, check, size: files[i].size });
    }
    const created = await withTransaction(async (tx) => {
      const out: Attachment[] = [];
      for (const s of stored) {
        const att = await db.attachments.create(
          {
            ticketId: ticket.id,
            commentId,
            uploaderId: user.id,
            filename: s.check.filename,
            mimeType: s.check.mime,
            size: s.size,
            storageKey: s.key,
            visibility,
          },
          { session: tx },
        );
        if (selected.length) {
          await db.attachmentAccess.createMany(
            selected.map((userId) => ({ attachmentId: att.id, userId })),
            { session: tx },
          );
        }
        await logActivity(tx, {
          ticketId: ticket.id,
          actorId: user.id,
          type: "ATTACHMENT_ADDED",
          field: "attachment",
          to: s.check.filename,
          meta: { attachmentId: att.id, visibility, size: s.size, commentId },
          internalOnly: visibility !== "CLIENT_VISIBLE",
        });
        out.push(att);
      }
      return out;
    });
    const rows = await hydrateAttachments(created);
    res.status(201).json(rows.map((r) => serializeAttachment(r, user, orgId, user)));
  } catch (e) {
    for (const s of stored) await deleteFile(s.key);
    throw e;
  }
});

export const attachmentFileRouter = Router();
async function loadAttachmentForUser(req: Request, res: Response) {
  const raw = await db.attachments.byId(req.params.attId);
  const att = raw ? await hydrateOne(raw) : null;
  const ticket = att ? await loadTicketWithProject(att.ticketId) : null;
  const user = req.user!;
  if (!att || !ticket || !canAccessOrg(user, ticket.project.orgId)) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  const orgId = ticket.project.orgId;
  if (!(await userCanAccessTicket(user, ticket)) || !canSeeAttachment(user, orgId, att as any)) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return { att: att as Row & { storageKey: string }, ticket, orgId };
}

function sendFile(req: Request, res: Response, disposition: "inline" | "attachment") {
  return async () => {
    const loaded = await loadAttachmentForUser(req, res);
    if (!loaded) return;
    const { att } = loaded;
    if (disposition === "inline" && !isPreviewable(att.mimeType)) {
      return res.status(415).json({ error: "This file type can't be previewed. Download it instead." });
    }
    const abs = resolveStoredPath(att.storageKey);
    if (!abs) return res.status(404).json({ error: "File missing" });
    res.setHeader("Content-Type", att.mimeType);
    res.setHeader("Content-Disposition", contentDisposition(disposition, att.filename));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader(
      "Content-Security-Policy",
      att.mimeType === "application/pdf" ? "default-src 'none'" : "default-src 'none'; sandbox",
    );
    res.sendFile(abs);
  };
}

attachmentFileRouter.get("/:attId/preview", requireAuth, (req, res) => sendFile(req, res, "inline")());
attachmentFileRouter.get("/:attId/download", requireAuth, (req, res) =>
  sendFile(req, res, "attachment")(),
);

const visibilitySchema = (body: unknown) => (body && typeof body === "object" ? (body as any) : {});
attachmentFileRouter.patch("/:attId", requireAuth, async (req, res) => {
  const loaded = await loadAttachmentForUser(req, res);
  if (!loaded) return;
  const { att, ticket, orgId } = loaded;
  const user = req.user!;
  if (rejectIfArchived(ticket, res)) return;
  if (!isInternal(user, orgId) || (att.uploaderId !== user.id && !isAdminOrAbove(user, orgId))) {
    return res.status(403).json({ error: "You can't change who can see this file." });
  }
  if (att.commentId) {
    return res
      .status(400)
      .json({ error: "Files on a comment share that comment's visibility." });
  }
  const body = visibilitySchema(req.body);
  const v = await resolveVisibility(body, orgId, ticket.projectId, att.uploaderId);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const before = att.visibility;
  const beforeUsers = att.access.map((a) => a.userId).sort().join(",");
  const afterUsers = [...v.selected].sort().join(",");
  if (before === v.visibility && beforeUsers === afterUsers) {
    return res.json(serializeAttachment(att, user, orgId, user));
  }

  const updated = await withTransaction(async (tx) => {
    await db.attachmentAccess.deleteMany({ attachmentId: att.id }, { session: tx });
    const row = await db.attachments.mustUpdate({ _id: att.id }, { visibility: v.visibility }, { session: tx });
    if (v.selected.length) {
      await db.attachmentAccess.createMany(
        v.selected.map((userId) => ({ attachmentId: att.id, userId })),
        { session: tx },
      );
    }
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "ATTACHMENT_VISIBILITY_CHANGED",
      field: "visibility",
      from: VIS_LABEL[before],
      to: VIS_LABEL[v.visibility],
      meta: {
        attachmentId: att.id,
        filename: att.filename,
        selectedCount: v.selected.length,
        visibility: before === "SELECTED" || v.visibility === "SELECTED" ? "SELECTED" : v.visibility,
      },
      internalOnly: before !== "CLIENT_VISIBLE" && v.visibility !== "CLIENT_VISIBLE",
    });
    return row;
  });
  res.json(serializeAttachment(await hydrateOne(updated), user, orgId, user));
});

attachmentFileRouter.delete("/:attId", requireAuth, async (req, res) => {
  const loaded = await loadAttachmentForUser(req, res);
  if (!loaded) return;
  const { att, ticket, orgId } = loaded;
  const user = req.user!;
  if (rejectIfArchived(ticket, res)) return;
  if (att.uploaderId !== user.id && !isInternal(user, orgId)) {
    return res.status(403).json({ error: "You can't delete this attachment." });
  }
  await withTransaction(async (tx) => {
    await deleteAttachmentsWhere({ _id: att.id }, { session: tx });
    await logActivity(tx, {
      ticketId: ticket.id,
      actorId: user.id,
      type: "ATTACHMENT_DELETED",
      field: "attachment",
      from: att.filename,
      meta: { attachmentId: att.id, visibility: att.visibility, commentId: att.commentId },
      internalOnly: att.visibility !== "CLIENT_VISIBLE",
    });
  });
  await deleteFile(att.storageKey);
  res.json({ ok: true });
});