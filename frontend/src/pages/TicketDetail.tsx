import { humanize, q, toast } from "../lib/toast";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { BackLink } from "../components/BackLink";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isInternalIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { Avatar, PriorityBadge, StatusBadge, TypeBadge } from "../components/ui";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Attachments } from "../components/Attachments";
import { Comments } from "../components/Comments";
import { ConfirmModal } from "../components/ConfirmModal";
import { TicketActions } from "../components/TicketActions";
import { IconArchive, IconCheckCircle } from "../components/Icons";

export default function TicketDetail() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { me } = useAuth();
  const { activeOrgId, setActiveOrg } = useOrg();
  const qc = useQueryClient();
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [tab, setTab] = useState<"comments" | "activity">("comments");

  // Moving between tickets (e.g. after Duplicate) starts on Comments again.
  useEffect(() => setTab("comments"), [id]);

  const { data: ticket, isLoading, isError, error } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.ticket(id),
    retry: (n, e: any) => e?.response?.status !== 404 && n < 2,
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
  // Same key as <Comments/> — only used here for the tab's count.
  const { data: comments } = useQuery({
    queryKey: ["comments", id],
    queryFn: () => api.comments(id),
    enabled: !!ticket,
  });

  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.updateTicket>[1]) => api.updateTicket(id, data),
    meta: { errorTitle: "Couldn't update the ticket" },
    onMutate: () => ({ title: ticket?.title ?? "", status: ticket?.status }),
    onSuccess: (_res, data, before) => {
      if (data.status && before)
        toast.success(`Ticket ${q(before.title)} status changed from ${humanize(before.status)} to ${humanize(data.status)}.`);
      else toast.success(`Ticket ${q(before?.title)} was updated.`);
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["activity", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  if (isLoading) return <div className="text-sm text-muted">Loading…</div>;
  if (isError || !ticket) {
    const notFound = (error as any)?.response?.status === 404;
    return (
      <div className="card p-8 text-center text-sm">
        <p className="font-medium text-fg">{notFound ? "Ticket not found" : "Couldn't load this ticket"}</p>
        <p className="mt-1 text-muted">
          {notFound
            ? "It may have been deleted, archived, or you may not have access."
            : "Check your connection and try again."}
        </p>
        <Link to="/" className="btn btn-secondary btn-sm mt-4">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const orgId = ticket.orgId ?? "";
  const internal = isInternalIn(me, orgId);
  const projectArchived = !!ticket.project?.archivedAt;
  const archived = !!ticket.archivedAt || projectArchived;
  const projectMembers = members ?? [];
  const assignable = projectMembers.filter((m) => m.role !== "CLIENT");
  const memberNames = projectMembers.map((m) => m.name);
  const can = ticket.can;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div className="min-w-0">
        <BackLink className="mb-2" />
        {/* Breadcrumb */}
        {ticket.project && (
          <div className="mb-3 text-sm text-muted">
            {/* keeps the "Back to <member>" state when going up to the project */}
            <Link to={`/projects/${ticket.projectId}`} state={location.state} className="link text-sm">
              {ticket.project.name}
            </Link>
            <span className="mx-1.5">›</span>
            <span className="text-fg-soft">Ticket</span>
          </div>
        )}

        {projectArchived && (
          <div className="alert mb-4 flex items-start gap-2 text-sm" role="status" data-testid="project-archived-banner">
            <IconArchive size={16} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold text-fg">This project is archived.</span>{" "}
              <span className="text-fg-soft">
                Its tickets are read-only until an admin restores the project.
              </span>
            </div>
          </div>
        )}
        {!projectArchived && archived && (
          <div className="alert mb-4 flex items-start gap-2 text-sm" role="status" data-testid="archived-banner">
            <IconArchive size={16} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold text-fg">This ticket is archived.</span>{" "}
              <span className="text-fg-soft">
                It's hidden from ticket lists and from customers, and is read-only
                {can?.restore ? " until an admin restores it." : "."}
              </span>
            </div>
          </div>
        )}

        <h1 className="break-words text-2xl font-bold tracking-tight text-fg">{ticket.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <TypeBadge type={ticket.type} />
          {ticket.archivedAt && <span className="badge b-outline-muted">Archived</span>}
        </div>

        <TicketActions
          ticket={ticket}
          me={me ? { id: me.id, name: me.name } : null}
          assignable={assignable}
        />

        <p className="mt-5 whitespace-pre-wrap break-words text-fg-soft">
          {ticket.description ? (
            renderWithMentions(ticket.description, memberNames)
          ) : (
            <span className="text-muted">No description.</span>
          )}
        </p>

        <Attachments ticketId={id} canPostInternal={internal} archived={archived} />

        {/* Comments / Activity */}
        <div className="mb-3 mt-8 flex gap-1 border-b border-card-border" role="tablist" aria-label="Discussion">
          {(
            [
              ["comments", `Comments${comments ? ` (${comments.length})` : ""}`],
              ["activity", "Activity"],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              data-testid={`tab-${key}`}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                tab === key ? "border-primary text-primary" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
        {tab === "comments" ? (
          <Comments key={id} ticketId={id} internal={internal} archived={archived} members={projectMembers} />
        ) : (
          <ActivityTimeline ticketId={id} internal={internal} />
        )}
      </div>

      <aside className="space-y-4">
        <div className="card p-5 text-sm" data-testid="ticket-details">
          <Field label="Reporter">
            {ticket.reporter && (
              <span className="flex items-center gap-2">
                <Avatar name={ticket.reporter.name} url={ticket.reporter.avatarUrl} size={22} />
                {ticket.reporter.name}
              </span>
            )}
          </Field>

          <Field label="Assignee">
            {ticket.assignee ? (
              <span className="flex items-center gap-2" data-testid="detail-assignee">
                <Avatar name={ticket.assignee.name} url={ticket.assignee.avatarUrl} size={22} />
                {ticket.assignee.name}
              </span>
            ) : (
              <span className="text-muted" data-testid="detail-assignee">Unassigned</span>
            )}
          </Field>

          <Field label="Status">
            <StatusBadge status={ticket.status} />
          </Field>

          {internal && (
            <Field label="Priority">
              <PriorityBadge priority={ticket.priority} />
            </Field>
          )}

          <Field label="Due date">
            {ticket.dueDate ? (
              new Date(ticket.dueDate).toLocaleDateString()
            ) : (
              <span className="text-muted">None</span>
            )}
          </Field>

          {internal && typeof ticket.followerCount === "number" && (
            <Field label="Followers">
              <span data-testid="detail-followers">
                {ticket.followerCount}
                {ticket.following && <span className="ml-1.5 text-xs text-muted">(including you)</span>}
              </span>
            </Field>
          )}

          <Field label="Created">
            <span className="text-fg-soft">{new Date(ticket.createdAt).toLocaleString()}</span>
          </Field>
        </div>

        {can?.changeStatus && (
          <button
            onClick={() => setConfirmingClose(true)}
            disabled={ticket.status === "DONE" || update.isPending}
            className="btn btn-secondary btn-sm btn-block"
          >
            <IconCheckCircle size={14} />
            {ticket.status === "DONE" ? "Closed" : update.isPending ? "Closing…" : "Close ticket"}
          </button>
        )}
      </aside>

      <ConfirmModal
        open={confirmingClose}
        title="Close ticket?"
        message={
          <>
            This will mark <span className="font-medium">"{ticket.title}"</span> as Done.
          </>
        }
        confirmLabel="Close ticket"
        variant="primary"
        pending={update.isPending}
        onConfirm={() =>
          update.mutate({ status: "DONE" }, { onSuccess: () => setConfirmingClose(false) })
        }
        onClose={() => setConfirmingClose(false)}
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

/** Highlight "@Name" tokens (known member names only) inside the description. */
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
