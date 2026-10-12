import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../auth";
import {
  dropBlobUrl,
  downloadAttachment,
  extOf,
  getBlobUrl,
  humanSize,
  isImageMime,
  uploadErrorMessage,
  type RejectedFile,
} from "../lib/attachments";
import { ConfirmModal } from "./ConfirmModal";
import { FileDropzone, ProgressBar, StagedList, useStagedFiles } from "./FileDropzone";
import { IconDownload, IconEye, IconFile, IconLock, IconTrash } from "./Icons";
import { Lightbox, type LightboxItem } from "./Lightbox";
import { Modal } from "./Modal";
import {
  VisibilityBadge,
  VisibilityPicker,
  type VisibilityValue,
} from "./VisibilityPicker";
import type { Attachment, TeamMember } from "../types";

/** Thumbnail for an image; a typed icon for everything else. */
export function FileThumb({
  id,
  mimeType,
  filename,
  previewable,
  className = "h-14 w-14",
}: {
  id: string;
  mimeType: string;
  filename: string;
  previewable?: boolean;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const showImage = isImageMime(mimeType) && previewable !== false && !failed;

  useEffect(() => {
    let live = true;
    if (showImage) getBlobUrl(id, "preview").then((u) => live && setUrl(u)).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, showImage]);

  if (showImage) {
    return url ? (
      <img
        src={url}
        alt={filename}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${className} shrink-0 rounded-lg border border-card-border object-cover`}
      />
    ) : (
      <div className={`${className} shrink-0 rounded-lg border border-card-border bg-accent pulse`} />
    );
  }
  const ext = extOf(filename).toUpperCase().slice(0, 4);
  return (
    <div
      className={`${className} flex shrink-0 flex-col items-center justify-center rounded-lg border border-card-border bg-accent text-muted`}
      aria-hidden
    >
      <IconFile size={18} />
      {ext && <span className="mt-0.5 text-[9px] font-bold tracking-wide">{ext}</span>}
    </div>
  );
}

export function Attachments({
  ticketId,
  canPostInternal,
  archived = false,
}: {
  ticketId: string;
  canPostInternal: boolean;
  archived?: boolean;
}) {
  const qc = useQueryClient();
  const { data: items, isLoading, isError, refetch } = useQuery({
    queryKey: ["attachments", ticketId],
    queryFn: () => api.attachments(ticketId),
  });

  const { me } = useAuth();
  const staged = useStagedFiles();
  const [vis, setVis] = useState<VisibilityValue>({
    visibility: canPostInternal ? "INTERNAL" : "CLIENT_VISIBLE",
    selectedUserIds: [],
  });
  const [percent, setPercent] = useState(0);
  const [uploadError, setUploadError] = useState<{ message: string; files?: RejectedFile[] } | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Attachment | null>(null);
  const [editingVis, setEditingVis] = useState<Attachment | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["ticketMembers", ticketId],
    queryFn: () => api.ticketMembers(ticketId),
    enabled: canPostInternal && (vis.visibility === "SELECTED" || !!editingVis),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["attachments", ticketId] });
    qc.invalidateQueries({ queryKey: ["activity", ticketId] });
  };

  const upload = useMutation({
    mutationFn: () => {
      setPercent(0);
      return api.uploadAttachments(ticketId, staged.files, {
        visibility: vis.visibility,
        selectedUserIds: vis.selectedUserIds,
        onProgress: setPercent,
      });
    },
    onSuccess: () => {
      staged.clear();
      setUploadError(null);
      refresh();
    },
    onError: (e) => setUploadError(uploadErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (a: Attachment) => api.deleteAttachment(a.id),
    onSuccess: (_d, a) => {
      dropBlobUrl(a.id);
      setDeleting(null);
      setActionError(null);
      refresh();
    },
    onError: (e: any) => setActionError(e?.response?.data?.error ?? "Couldn't delete the file."),
  });

  const previewables: LightboxItem[] = (items ?? []).filter((a) => a.previewable);
  const needsPeople = vis.visibility === "SELECTED" && vis.selectedUserIds.length === 0;
  const busy = upload.isPending;

  return (
    <div className="mt-8" data-testid="attachments">
      <div className="eyebrow mb-3">
        Attachments{items && items.length > 0 ? ` (${items.length})` : ""}
      </div>

      {isLoading && (
        <div className="mb-3 space-y-2" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="card pulse h-[74px]" />
          ))}
        </div>
      )}
      {isError && (
        <div className="alert alert-danger mb-3 text-sm">
          Couldn't load attachments.{" "}
          <button className="link" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}
      {items && items.length === 0 && (
        <p className="mb-3 text-sm text-muted">No attachments yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className="mb-3 space-y-2">
          {items.map((a) => (
            <AttachmentRow
              key={a.id}
              att={a}
              archived={archived}
              onPreview={() => {
                const i = previewables.findIndex((p) => p.id === a.id);
                if (i >= 0) setLightbox(i);
              }}
              onDelete={() => {
                setActionError(null);
                setDeleting(a);
              }}
              onVisibility={() => setEditingVis(a)}
            />
          ))}
        </ul>
      )}

      {archived ? (
        <p className="text-sm text-muted">This ticket is archived — restore it to add attachments.</p>
      ) : (
        <div className="card p-4">
          <FileDropzone onFiles={staged.add} disabled={busy} compact />
          <StagedList
            files={staged.files}
            rejected={staged.rejected}
            onRemove={staged.remove}
            onDismissRejected={staged.dismissRejected}
            disabled={busy}
          />

          {staged.files.length > 0 && (
            <div className="mt-3 space-y-3">
              {canPostInternal ? (
                <div>
                  <div className="eyebrow mb-1.5">Who can see these files?</div>
                  <VisibilityPicker
                    value={vis}
                    onChange={(v) => {
                      setVis(v);
                      setUploadError(null);
                    }}
                    hideUserId={me?.id}
                    members={members}
                    membersLoading={membersLoading}
                    disabled={busy}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted">These files will be visible to the project team.</p>
              )}

              {busy && <ProgressBar percent={percent} label={`Uploading ${staged.files.length} file${staged.files.length > 1 ? "s" : ""}…`} />}

              {uploadError && (
                <div className="alert alert-danger text-sm" role="alert" data-testid="upload-error">
                  <div className="font-medium">{uploadError.message}</div>
                  {uploadError.files && (
                    <ul className="mt-1 list-disc pl-5 text-[13px]">
                      {uploadError.files.map((f, i) => (
                        <li key={i}>
                          <span className="font-medium">{f.name}</span>: {f.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-1 text-[13px]">Nothing was uploaded. Fix the problem and try again.</div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || needsPeople}
                  onClick={() => {
                    setUploadError(null);
                    upload.mutate();
                  }}
                >
                  {busy ? "Uploading…" : `Upload ${staged.files.length} file${staged.files.length > 1 ? "s" : ""}`}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { staged.clear(); setUploadError(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {lightbox !== null && previewables.length > 0 && (
        <Lightbox
          items={previewables}
          index={Math.min(lightbox, previewables.length - 1)}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}

      <ConfirmModal
        open={!!deleting}
        title="Delete attachment?"
        message={
          <>
            <p>
              <span className="break-all font-medium">"{deleting?.filename}"</span> will be permanently
              deleted. This can't be undone.
            </p>
            {actionError && <p className="mt-2 text-danger">{actionError}</p>}
          </>
        }
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />

      {editingVis && (
        <VisibilityModal
          att={editingVis}
          members={members}
          membersLoading={membersLoading}
          onClose={() => setEditingVis(null)}
          onSaved={() => {
            setEditingVis(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AttachmentRow({
  att,
  archived,
  onPreview,
  onDelete,
  onVisibility,
}: {
  att: Attachment;
  archived: boolean;
  onPreview: () => void;
  onDelete: () => void;
  onVisibility: () => void;
}) {
  const [dlError, setDlError] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const who =
    att.visibility === "SELECTED" && att.selectedUsers?.length
      ? `Shared with ${att.selectedUsers.map((u) => u.name).join(", ")}`
      : undefined;

  return (
    <li className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center" data-testid="attachment-row">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {att.previewable ? (
          <button
            type="button"
            onClick={onPreview}
            aria-label={`Preview ${att.filename}`}
            className="shrink-0 rounded-lg transition-shadow hover:shadow-elevated"
          >
            <FileThumb id={att.id} mimeType={att.mimeType} filename={att.filename} previewable />
          </button>
        ) : (
          <FileThumb id={att.id} mimeType={att.mimeType} filename={att.filename} previewable={false} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg" title={att.filename}>
            {att.filename}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span>{humanSize(att.size)}</span>
            <span>·</span>
            <span title={new Date(att.createdAt).toLocaleString()}>
              {new Date(att.createdAt).toLocaleDateString()} · {att.uploader.name}
            </span>
            <span title={who}>
              <VisibilityBadge visibility={att.visibility} />
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:justify-end">
        {att.previewable && (
          <button onClick={onPreview} className="link inline-flex items-center gap-1">
            <IconEye size={13} /> Preview
          </button>
        )}
        <button
          onClick={() => {
            setDlError(false);
            setDlBusy(true);
            downloadAttachment(att)
              .catch(() => setDlError(true))
              .finally(() => setDlBusy(false));
          }}
          disabled={dlBusy}
          className="link inline-flex items-center gap-1"
        >
          <IconDownload size={13} /> {dlBusy ? "Downloading…" : "Download"}
        </button>
        {!archived && att.canChangeVisibility && (
          <button onClick={onVisibility} className="link inline-flex items-center gap-1">
            <IconLock size={13} /> Visibility
          </button>
        )}
        {!archived && att.canDelete && (
          <button onClick={onDelete} className="link link-danger inline-flex items-center gap-1">
            <IconTrash size={13} /> Delete
          </button>
        )}
        {dlError && <span className="text-danger">Download failed</span>}
      </div>
    </li>
  );
}

function VisibilityModal({
  att,
  members,
  membersLoading,
  onClose,
  onSaved,
}: {
  att: Attachment;
  members: TeamMember[] | undefined;
  membersLoading: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<VisibilityValue>({
    visibility: att.visibility,
    selectedUserIds: att.selectedUsers?.map((u) => u.id) ?? [],
  });
  const save = useMutation({
    mutationFn: () =>
      api.updateAttachmentVisibility(att.id, {
        visibility: value.visibility,
        selectedUserIds: value.visibility === "SELECTED" ? value.selectedUserIds : undefined,
      }),
    onSuccess: onSaved,
  });
  const invalid = value.visibility === "SELECTED" && value.selectedUserIds.length === 0;
  const err = (save.error as any)?.response?.data?.error as string | undefined;

  return (
    <Modal open onClose={onClose} title="Who can see this file?" width={460}>
      <p className="mb-3 break-all text-sm text-fg-soft">{att.filename}</p>
      <VisibilityPicker
        value={value}
        onChange={setValue}
        members={members}
        membersLoading={membersLoading}
        disabled={save.isPending}
      />
      {save.isError && <p className="mt-3 text-sm text-danger">{err ?? "Couldn't update visibility."}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={save.isPending}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.isPending || invalid}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}