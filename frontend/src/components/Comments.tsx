import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { downloadAttachment, humanSize, uploadErrorMessage, ACCEPT } from "../lib/attachments";
import { Markdown } from "../lib/markdown";
import { Avatar } from "./ui";
import { ConfirmModal } from "./ConfirmModal";
import { Dropdown } from "./Dropdown";
import { FileThumb } from "./Attachments";
import { ProgressBar, StagedList, useStagedFiles } from "./FileDropzone";
import { IconDownload, IconEdit, IconReply, IconTrash, IconUpload } from "./Icons";
import { Lightbox } from "./Lightbox";
import { MarkdownEditor, MAX_COMMENT_LENGTH } from "./MarkdownEditor";
import { extractMentionIds, type MentionMember } from "./MentionTextarea";
import type { Comment, CommentAttachment, CommentVisibility, Member } from "../types";

function stamp(iso: string) {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  const rel =
    mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : d.toLocaleDateString();
  return { rel, full: d.toLocaleString() };
}

export function Comments({
  ticketId,
  internal,
  archived,
  members,
}: {
  ticketId: string;
  internal: boolean;
  archived: boolean;
  members: Member[];
}) {
  const qc = useQueryClient();
  const { data: comments, isLoading, isError, refetch } = useQuery({
    queryKey: ["comments", ticketId],
    queryFn: () => api.comments(ticketId),
  });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const memberNames = members.map((m) => m.name);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["comments", ticketId] });
    qc.invalidateQueries({ queryKey: ["activity", ticketId] });
  };

  const list = comments ?? [];
  const roots = list.filter((c) => !c.parentId);
  const repliesOf = (id: string) => list.filter((c) => c.parentId === id);
  const rootOf = (c: Comment) => (c.parentId ? list.find((x) => x.id === c.parentId) : c);

  return (
    <div data-testid="comments">
      {isLoading && (
        <div className="mb-4 space-y-3" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="card pulse h-20" />
          ))}
        </div>
      )}
      {isError && (
        <div className="alert alert-danger mb-4 text-sm">
          Couldn't load comments.{" "}
          <button className="link" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}
      {comments && list.length === 0 && <p className="mb-4 text-sm text-muted">No comments yet.</p>}

      <div className="mb-4 space-y-4">
        {roots.map((c) => {
          const replies = repliesOf(c.id);
          const threadHasForm = replyTo !== null && (replyTo === c.id || replies.some((r) => r.id === replyTo));
          return (
            <div key={c.id}>
              <CommentCard
                comment={c}
                ticketId={ticketId}
                members={members}
                memberNames={memberNames}
                archived={archived}
                hasReplies={replies.length > 0}
                onReply={() => setReplyTo(c.id)}
                onChanged={refresh}
              />
              {(replies.length > 0 || threadHasForm) && (
                <div className="ml-4 mt-2 space-y-2 border-l-2 border-card-border pl-3 sm:ml-8 sm:pl-4">
                  {replies.map((r) => (
                    <CommentCard
                      key={r.id}
                      comment={r}
                      ticketId={ticketId}
                      members={members}
                      memberNames={memberNames}
                      archived={archived}
                      hasReplies={false}
                      onReply={() => setReplyTo(r.id)}
                      onChanged={refresh}
                    />
                  ))}
                  {threadHasForm && (
                    <Composer
                      key={replyTo}
                      ticketId={ticketId}
                      members={members}
                      canPostInternal={internal}
                      parent={list.find((x) => x.id === replyTo)!}
                      rootVisibility={rootOf(list.find((x) => x.id === replyTo)!)?.visibility ?? c.visibility}
                      onCancel={() => setReplyTo(null)}
                      onPosted={() => {
                        setReplyTo(null);
                        refresh();
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {archived ? (
        <p className="text-sm text-muted">This ticket is archived — restore it to add comments.</p>
      ) : (
        <Composer
          ticketId={ticketId}
          members={members}
          canPostInternal={internal}
          onPosted={refresh}
        />
      )}
    </div>
  );
}
function CommentCard({
  comment,
  ticketId,
  members,
  memberNames,
  archived,
  hasReplies,
  onReply,
  onChanged,
}: {
  comment: Comment;
  ticketId: string;
  members: Member[];
  memberNames: string[];
  archived: boolean;
  hasReplies: boolean;
  onReply: () => void;
  onChanged: () => void;
}) {
  const internal = comment.visibility === "INTERNAL";
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [delError, setDelError] = useState<string | null>(null);
  const t = stamp(comment.createdAt);

  const del = useMutation({
    mutationFn: () => api.deleteComment(ticketId, comment.id),
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
    onError: (e: any) => setDelError(e?.response?.data?.error ?? "Couldn't delete the comment."),
  });

  const atts = comment.attachments ?? [];
  const previewables = atts.filter((a) => a.previewable);
  const extras = [...(hasReplies ? ["replies"] : []), ...(atts.length ? ["attachments"] : [])];

  return (
    <div className={internal ? "alert alert-ok" : "card p-4"} data-testid="comment" id={`c-${comment.id}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Avatar name={comment.author.name} url={comment.author.avatarUrl} size={24} />
        <span className="text-sm font-semibold text-fg">{comment.author.name}</span>
        {internal && <span className="badge b-warn">Internal</span>}
        <span className="text-[11px] text-muted" title={t.full}>
          {t.rel}
        </span>
        {comment.editedAt && (
          <span className="text-[11px] italic text-muted" title={`Edited ${new Date(comment.editedAt).toLocaleString()}`}>
            (edited)
          </span>
        )}
        <span className="ml-auto hidden text-[11px] text-muted sm:inline">{t.full}</span>
      </div>

      {editing ? (
        <EditBox
          ticketId={ticketId}
          comment={comment}
          members={members}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : (
        <Markdown text={comment.body} memberNames={memberNames} />
      )}

      {atts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="comment-attachments">
          {atts.map((a) => (
            <CommentFile
              key={a.id}
              att={a}
              onPreview={() => setLightbox(previewables.findIndex((p) => p.id === a.id))}
            />
          ))}
        </div>
      )}

      {!editing && !archived && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button className="link inline-flex items-center gap-1" onClick={onReply}>
            <IconReply size={13} /> Reply
          </button>
          {comment.canEdit && (
            <button className="link inline-flex items-center gap-1" onClick={() => setEditing(true)}>
              <IconEdit size={13} /> Edit
            </button>
          )}
          {comment.canDelete && (
            <button
              className="link link-danger inline-flex items-center gap-1"
              onClick={() => {
                setDelError(null);
                setConfirming(true);
              }}
            >
              <IconTrash size={13} /> Delete
            </button>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirming}
        title="Delete comment?"
        message={
          <>
            <p>
              {extras.length
                ? `Are you sure you want to delete this comment? Its ${extras.join(" and ")} will also be deleted.`
                : "Are you sure you want to delete this comment?"}
            </p>
            {delError && <p className="mt-2 text-danger">{delError}</p>}
          </>
        }
        pending={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={() => setConfirming(false)}
      />

      {lightbox !== null && lightbox >= 0 && (
        <Lightbox
          items={previewables.map((p) => ({ ...p, uploader: { name: comment.author.name } }))}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function CommentFile({ att, onPreview }: { att: CommentAttachment; onPreview: () => void }) {
  const [err, setErr] = useState(false);
  if (att.previewable) {
    return (
      <button
        type="button"
        onClick={onPreview}
        title={`${att.filename} · ${humanSize(att.size)}`}
        aria-label={`Preview ${att.filename}`}
        className="rounded-lg transition-shadow hover:shadow-elevated"
      >
        <FileThumb id={att.id} mimeType={att.mimeType} filename={att.filename} previewable className="h-24 w-28" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => downloadAttachment(att).catch(() => setErr(true))}
      className="flex max-w-full items-center gap-2 rounded-lg border border-card-border bg-white px-3 py-2 text-left text-sm hover:bg-accent"
      title={`Download ${att.filename}`}
    >
      <IconDownload size={14} className="shrink-0 text-muted" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-fg">{att.filename}</span>
        <span className="block text-[11px] text-muted">{err ? "Download failed" : humanSize(att.size)}</span>
      </span>
    </button>
  );
}

function EditBox({
  ticketId,
  comment,
  members,
  onCancel,
  onSaved,
}: {
  ticketId: string;
  comment: Comment;
  members: Member[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(comment.body);
  const mentionables = members
    .filter((m) => comment.visibility === "CLIENT_VISIBLE" || m.role !== "CLIENT")
    .map((m) => ({ id: m.userId, name: m.name }));
  const save = useMutation({
    mutationFn: () => api.editComment(ticketId, comment.id, body),
    onSuccess: onSaved,
  });
  const err = (save.error as any)?.response?.data?.error as string | undefined;
  const unchanged = body.trim() === comment.body.trim();

  return (
    <div data-testid="comment-edit">
      <MarkdownEditor
        value={body}
        onChange={setBody}
        members={mentionables}
        onMention={() => {}}
        rows={4}
        autoFocus
        disabled={save.isPending}
        onSubmit={() => !unchanged && body.trim() && save.mutate()}
      />
      {save.isError && <p className="mt-2 text-sm text-danger">{err ?? "Couldn't save your changes."}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => save.mutate()}
          disabled={save.isPending || unchanged || !body.trim() || body.length > MAX_COMMENT_LENGTH}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
function Composer({
  ticketId,
  members,
  canPostInternal,
  parent,
  rootVisibility,
  onCancel,
  onPosted,
}: {
  ticketId: string;
  members: Member[];
  canPostInternal: boolean;
  parent?: Comment;
  rootVisibility?: CommentVisibility;
  onCancel?: () => void;
  onPosted: () => void;
}) {
  const locked = parent && rootVisibility === "INTERNAL";
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>(
    locked ? "INTERNAL" : parent ? (parent.visibility ?? "INTERNAL") : canPostInternal ? "INTERNAL" : "CLIENT_VISIBLE",
  );
  const [picked, setPicked] = useState<MentionMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [postedId, setPostedId] = useState<string | null>(null); 
  const postedRef = useRef<string | null>(null); 
  const [dragging, setDragging] = useState(false);
  const staged = useStagedFiles();
  const picker = useRef<HTMLInputElement>(null);

  const mentionables: MentionMember[] = members
    .filter((m) => visibility === "CLIENT_VISIBLE" || m.role !== "CLIENT")
    .map((m) => ({ id: m.userId, name: m.name }));

  const post = useMutation({
    mutationFn: async () => {
      let id = postedRef.current;
      if (!id) {
        const c = await api.addComment(ticketId, {
          body,
          visibility,
          parentId: parent?.id ?? null,
          mentions: extractMentionIds(body, picked),
        });
        id = c.id;
        postedRef.current = id;
        setPostedId(id);
      }
      if (staged.files.length) {
        setPercent(0);
        await api.uploadAttachments(ticketId, staged.files, {
          visibility: "INTERNAL", // ignored: files take their comment's visibility
          commentId: id,
          onProgress: setPercent,
        });
      }
    },
    onSuccess: () => {
      setBody("");
      setPicked([]);
      setError(null);
      postedRef.current = null;
      setPostedId(null);
      staged.clear();
      onPosted();
    },
    onError: (e: any) => {
      if (postedRef.current) {
        const m = uploadErrorMessage(e);
        setError(
          `Your comment was posted, but its attachments couldn't be uploaded: ${m.message}` +
            (m.files ? " " + m.files.map((f) => `${f.name} ${f.reason}`).join("; ") : ""),
        );
        onPosted();
      } else {
        const d = e?.response?.data;
        setError(typeof d?.error === "string" ? d.error : "Failed to post comment.");
      }
    },
  });

  const canSubmit = (body.trim().length > 0 || !!postedId) && !post.isPending && body.length <= MAX_COMMENT_LENGTH;
  const submit = () => canSubmit && post.mutate();

  return (
    <div
      className={`card p-4 ${dragging ? "!border-primary" : ""}`}
      data-testid={parent ? "reply-form" : "comment-form"}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = Array.from(e.dataTransfer.files);
        if (f.length) staged.add(f);
      }}
    >
      {parent && (
        <div className="mb-2 text-xs text-muted">
          Replying to <span className="font-medium text-fg">{parent.author.name}</span>
          {locked && <span className="badge b-warn ml-2">Internal thread</span>}
        </div>
      )}
      <MarkdownEditor
        value={body}
        onChange={setBody}
        members={mentionables}
        onMention={(m) => setPicked((p) => [...p, m])}
        rows={parent ? 3 : 4}
        placeholder={parent ? "Write a reply… (@ to mention)" : "Write a comment… (@ to mention, drop files to attach)"}
        disabled={post.isPending || !!postedId}
        autoFocus={!!parent}
        onSubmit={submit}
      />

      <StagedList
        files={staged.files}
        rejected={staged.rejected}
        onRemove={staged.remove}
        onDismissRejected={staged.dismissRejected}
        disabled={post.isPending}
      />
      {post.isPending && staged.files.length > 0 && postedId && <div className="mt-2"><ProgressBar percent={percent} /></div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canPostInternal && !locked && !postedId && (
          <Dropdown
            className="w-48"
            size="sm"
            value={visibility}
            onChange={(v) => setVisibility(v as CommentVisibility)}
            options={[
              { value: "INTERNAL", label: "Internal (team only)" },
              { value: "CLIENT_VISIBLE", label: "Client-visible" },
            ]}
          />
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={post.isPending}
          onClick={() => picker.current?.click()}
        >
          <IconUpload size={14} />
          Attach files
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = Array.from(e.target.files ?? []);
            if (f.length) staged.add(f);
            e.target.value = "";
          }}
        />
        {error && (
          <span className="basis-full text-sm text-danger" role="alert" data-testid="comment-error">
            {error}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={post.isPending}>
              Cancel
            </button>
          )}
          <button disabled={!canSubmit} onClick={submit} className="btn btn-primary btn-sm">
            {post.isPending ? "Posting…" : postedId ? "Retry upload" : parent ? "Reply" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}