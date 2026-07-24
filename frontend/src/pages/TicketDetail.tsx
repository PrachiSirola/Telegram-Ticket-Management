import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, isInternalIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { Avatar, PriorityBadge, StatusBadge, TypeBadge } from "../components/ui";
import { Attachments } from "../components/Attachments";
import { ConfirmModal } from "../components/ConfirmModal";
import { Dropdown } from "../components/Dropdown";
import {
  MentionTextarea,
  extractMentionIds,
  type MentionMember,
} from "../components/MentionTextarea";
import { IconUpload, IconTrash } from "../components/Icons";
import type { Comment, CommentAttachment, CommentVisibility } from "../types";

export default function TicketDetail() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const { activeOrgId, setActiveOrg } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.ticket(id),
  });

  // Cross-org notification clicks land here with a different active org —
  // sync the switcher to the ticket's org.
  const ticketOrgId = ticket?.orgId ?? "";
  useEffect(() => {
    if (ticketOrgId && ticketOrgId !== activeOrgId) setActiveOrg(ticketOrgId);
  }, [ticketOrgId, activeOrgId, setActiveOrg]);

  const { data: members } = useQuery({
    queryKey: ["projectMembers", ticketOrgId, ticket?.projectId],
    queryFn: () => api.projectMembers(ticketOrgId, ticket!.projectId),
    enabled: !!ticket && !!ticketOrgId,
  });
  const { data: comments } = useQuery({
    queryKey: ["comments", id],
    queryFn: () => api.comments(id),
  });

  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.updateTicket>[1]) => api.updateTicket(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", id] }),
  });
  const selfAssign = useMutation({
    mutationFn: () => api.selfAssign(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", id] }),
  });
  const deleteTicket = useMutation({
    mutationFn: () => api.deleteTicket(id),
    onSuccess: () => {
      const projectId = ticket!.projectId;
      qc.invalidateQueries({ queryKey: ["tickets"] });
      navigate(`/projects/${projectId}`);
    },
  });

  if (isLoading || !ticket) return <div className="text-sm text-muted">Loading…</div>;

  const orgId = ticket.orgId ?? "";
  const internal = isInternalIn(me, orgId);
  const admin = isAdminOrAboveIn(me, orgId);
  const canDeleteTicket = admin || ticket.reporter?.id === me?.id;
  const assignable = (members ?? []).filter((m) => m.role !== "CLIENT");
  const mentionables: MentionMember[] = (members ?? []).map((m) => ({
    id: m.userId,
    name: m.name,
  }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        {/* Breadcrumb */}
        {ticket.project && (
          <div className="mb-3 text-sm text-muted">
            <Link to={`/projects/${ticket.projectId}`} className="link text-sm">
              {ticket.project.name}
            </Link>
            <span className="mx-1.5">›</span>
            <span className="text-fg-soft">Ticket</span>
          </div>
        )}

        <h1 className="text-2xl font-bold tracking-tight text-fg">{ticket.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <TypeBadge type={ticket.type} />
        </div>

        <p className="mt-5 whitespace-pre-wrap text-fg-soft">
          {ticket.description ? (
            renderWithMentions(ticket.description, mentionables.map((m) => m.name))
          ) : (
            <span className="text-muted">No description.</span>
          )}
        </p>

        <Attachments ticketId={id} canPostInternal={internal} />

        <div className="eyebrow mb-2 mt-8">Comments</div>
        <CommentThread
          comments={comments ?? []}
          ticketId={id}
          canDelete={(c) => admin || c.author.id === me?.id}
          memberNames={mentionables.map((m) => m.name)}
          onDeleted={() => qc.invalidateQueries({ queryKey: ["comments", id] })}
        />
        <CommentForm
          ticketId={id}
          canPostInternal={internal}
          members={mentionables}
          onPosted={() => qc.invalidateQueries({ queryKey: ["comments", id] })}
        />
      </div>

      <aside className="space-y-4">
        <div className="card p-5 text-sm">
          <Field label="Reporter">
            {ticket.reporter && (
              <span className="flex items-center gap-2">
                <Avatar name={ticket.reporter.name} url={ticket.reporter.avatarUrl} size={22} />
                {ticket.reporter.name}
              </span>
            )}
          </Field>

          <Field label="Assignee">
            {admin ? (
              <Dropdown
                placeholder="Unassigned"
                value={ticket.assignee?.id ?? ""}
                onChange={(v) => update.mutate({ assigneeId: v || null })}
                options={[
                  { value: "", label: "Unassigned" },
                  ...assignable.map((m) => ({ value: m.userId, label: m.name })),
                ]}
              />
            ) : ticket.assignee ? (
              <span className="flex items-center gap-2">
                <Avatar name={ticket.assignee.name} url={ticket.assignee.avatarUrl} size={22} />
                {ticket.assignee.name}
              </span>
            ) : (
              <span className="text-muted">Unassigned</span>
            )}
            {internal && ticket.assignee?.id !== me?.id && (
              <button onClick={() => selfAssign.mutate()} className="link mt-1.5 block text-xs">
                Assign to me
              </button>
            )}
          </Field>

          <Field label="Status">
            {internal ? (
              <Dropdown
                value={ticket.status}
                onChange={(v) => update.mutate({ status: v as any })}
                options={["OPEN", "IN_PROGRESS", "DONE"].map((s) => ({
                  value: s,
                  label: s.replace("_", " "),
                }))}
              />
            ) : (
              <StatusBadge status={ticket.status} />
            )}
          </Field>

          {internal && (
            <>
              <Field label="Priority">
                <Dropdown
                  value={ticket.priority}
                  onChange={(v) => update.mutate({ priority: v as any })}
                  options={["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => ({ value: p, label: p }))}
                />
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  className="input"
                  value={ticket.dueDate ? ticket.dueDate.slice(0, 10) : ""}
                  onChange={(e) =>
                    update.mutate({
                      dueDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                />
              </Field>
            </>
          )}
        </div>

        {canDeleteTicket && (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="btn btn-danger btn-sm btn-block"
          >
            <IconTrash size={14} />
            Delete ticket
          </button>
        )}
      </aside>

      <ConfirmModal
        open={confirmingDelete}
        title="Delete ticket?"
        message={
          <>
            This will permanently delete <span className="font-medium">"{ticket.title}"</span> and
            all of its comments and attachments.
          </>
        }
        pending={deleteTicket.isPending}
        onConfirm={() => deleteTicket.mutate()}
        onClose={() => setConfirmingDelete(false)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function CommentThread({
  comments,
  ticketId,
  canDelete,
  memberNames,
  onDeleted,
}: {
  comments: Comment[];
  ticketId: string;
  canDelete: (c: Comment) => boolean;
  memberNames: string[];
  onDeleted: () => void;
}) {
  const roots = comments.filter((c) => !c.parentId);
  const repliesOf = (pid: string) => comments.filter((c) => c.parentId === pid);

  if (comments.length === 0)
    return <p className="mb-4 text-sm text-muted">No comments yet.</p>;

  return (
    <div className="mb-4 space-y-3">
      {roots.map((c) => (
        <div key={c.id}>
          <CommentCard
            comment={c}
            ticketId={ticketId}
            canDelete={canDelete(c)}
            hasReplies={repliesOf(c.id).length > 0}
            memberNames={memberNames}
            onDeleted={onDeleted}
          />
          <div className="ml-8 mt-2 space-y-2">
            {repliesOf(c.id).map((r) => (
              <CommentCard
                key={r.id}
                comment={r}
                ticketId={ticketId}
                canDelete={canDelete(r)}
                hasReplies={false}
                memberNames={memberNames}
                onDeleted={onDeleted}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CommentCard({
  comment,
  ticketId,
  canDelete,
  hasReplies,
  memberNames,
  onDeleted,
}: {
  comment: Comment;
  ticketId: string;
  canDelete: boolean;
  hasReplies: boolean;
  memberNames: string[];
  onDeleted: () => void;
}) {
  const internal = comment.visibility === "INTERNAL";
  const [confirming, setConfirming] = useState(false);

  const del = useMutation({
    mutationFn: () => api.deleteComment(ticketId, comment.id),
    onSuccess: () => {
      setConfirming(false);
      onDeleted();
    },
  });

  const extras = [
    ...(hasReplies ? ["replies"] : []),
    ...(comment.attachments?.length ? ["images"] : []),
  ];

  return (
    <div className={internal ? "alert alert-ok" : "card p-4"} style={internal ? {} : undefined}>
      <div className="mb-1.5 flex items-center gap-2">
        <Avatar name={comment.author.name} url={comment.author.avatarUrl} size={24} />
        <span className="text-sm font-semibold text-fg">{comment.author.name}</span>
        {internal && <span className="badge b-warn">Internal</span>}
        <span className="ml-auto text-[11px] text-muted">
          {new Date(comment.createdAt).toLocaleString()}
        </span>
        {canDelete && (
          <button onClick={() => setConfirming(true)} className="link link-danger text-xs">
            Delete
          </button>
        )}
      </div>
      <ConfirmModal
        open={confirming}
        title="Delete comment?"
        message={
          extras.length
            ? `Are you sure you want to delete this comment? Its ${extras.join(" and ")} will also be deleted.`
            : "Are you sure you want to delete this comment?"
        }
        pending={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={() => setConfirming(false)}
      />
      <p className="whitespace-pre-wrap text-sm text-fg-soft">
        {renderWithMentions(comment.body, memberNames)}
      </p>
      {comment.attachments && comment.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {comment.attachments.map((a) => (
            <CommentImage key={a.id} att={a} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Highlight "@Name" tokens (known member names only) inside a comment body. */
function renderWithMentions(body: string, memberNames: string[]) {
  if (memberNames.length === 0) return body;
  const escaped = [...memberNames]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="mention">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function CommentImage({ att }: { att: CommentAttachment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    api.attachmentBlob(att.id).then((blob) => {
      revoke = URL.createObjectURL(blob);
      setUrl(revoke);
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [att.id]);

  if (!url) {
    return <div className="h-28 w-36 rounded-lg border border-card-border bg-accent pulse" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title={att.filename}>
      <img
        src={url}
        alt={att.filename}
        className="h-28 max-w-56 rounded-lg border border-card-border object-cover transition-shadow hover:shadow-elevated"
      />
    </a>
  );
}

function CommentForm({
  ticketId,
  canPostInternal,
  members,
  onPosted,
}: {
  ticketId: string;
  canPostInternal: boolean;
  members: MentionMember[];
  onPosted: () => void;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>(
    canPostInternal ? "INTERNAL" : "CLIENT_VISIBLE",
  );
  const [images, setImages] = useState<File[]>([]);
  const [picked, setPicked] = useState<MentionMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const comment = await api.addComment(ticketId, {
        body,
        visibility,
        mentions: extractMentionIds(body, picked),
      });
      for (const file of images) {
        await api.uploadAttachment(ticketId, file, visibility, comment.id);
      }
    },
    onSuccess: () => {
      setBody("");
      setImages([]);
      setPicked([]);
      setError(null);
      onPosted();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error ?? "Failed to post comment");
      onPosted(); // the comment may exist even if an upload failed
    },
  });

  const MAX_IMAGES = 10;

  function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (picked.length) {
      const overflow = images.length + picked.length > MAX_IMAGES;
      setImages([...images, ...picked].slice(0, MAX_IMAGES));
      setError(overflow ? `Max ${MAX_IMAGES} images per comment` : null);
    }
    e.target.value = "";
  }

  return (
    <div className="card p-4">
      <MentionTextarea
        rows={3}
        placeholder="Write a comment… (@ to mention)"
        value={body}
        onChange={setBody}
        members={members}
        onMention={(m) => setPicked((prev) => [...prev, m])}
      />
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((file, i) => (
            <ImagePreview key={i} file={file} onRemove={() => setImages(images.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canPostInternal && (
          <Dropdown
            className="w-52"
            size="sm"
            value={visibility}
            onChange={(v) => setVisibility(v as CommentVisibility)}
            options={[
              { value: "INTERNAL", label: "Internal (team only)" },
              { value: "CLIENT_VISIBLE", label: "Client-visible" },
            ]}
          />
        )}
        <label
          className={`btn btn-secondary btn-sm ${images.length >= MAX_IMAGES ? "opacity-50" : "cursor-pointer"}`}
        >
          <IconUpload size={14} />
          Attach images
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onPickImages}
            disabled={mut.isPending || images.length >= MAX_IMAGES}
          />
        </label>
        {error && <span className="text-sm text-danger">{error}</span>}
        <button
          disabled={!body || mut.isPending}
          onClick={() => mut.mutate()}
          className="btn btn-primary btn-sm ml-auto"
        >
          {mut.isPending ? "Posting…" : "Comment"}
        </button>
      </div>
    </div>
  );
}

function ImagePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="relative">
      {url && (
        <img
          src={url}
          alt={file.name}
          title={file.name}
          className="h-20 w-24 rounded-lg border border-card-border object-cover"
        />
      )}
      <button
        onClick={onRemove}
        title="Remove"
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-card-border bg-white text-xs leading-none text-muted hover:text-danger"
      >
        ×
      </button>
    </div>
  );
}