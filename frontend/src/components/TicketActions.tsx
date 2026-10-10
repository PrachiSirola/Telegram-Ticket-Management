import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { humanize, q, toast } from "../lib/toast";
import { MenuButton, type MenuItem } from "./ActionMenu";
import { ConfirmModal } from "./ConfirmModal";
import { Dropdown } from "./Dropdown";
import { Modal } from "./Modal";
import { Avatar } from "./ui";
import {
  IconArchive,
  IconCopy,
  IconEdit,
  IconLink,
  IconMoreHorizontal,
  IconMove,
  IconTrash,
  IconUser,
  IconUserPlus,
} from "./Icons";
import type { Member, Ticket, TicketPriority, TicketStatus, TicketType } from "../types";

const STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "DONE"];
const PRIORITIES: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TYPES: TicketType[] = ["BUG", "FEATURE", "TASK"];
const label = (v: string) => v.replace("_", " ");

function errText(e: any, fallback: string) {
  const d = e?.response?.data?.error;
  return typeof d === "string" ? d : fallback;
}

/**
 * Edit · Assign · Status · Priority · More (Duplicate, Move, Add Follower,
 * Copy Link, Archive/Restore, Delete). Which buttons show is decided by the
 * `can` flags the API computes for the signed-in user; the API enforces the
 * same rules again on every request.
 */
export function TicketActions({
  ticket,
  me,
  assignable,
}: {
  ticket: Ticket;
  me: { id: string; name: string } | null;
  assignable: Member[];
}) {
  const can = ticket.can;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modal, setModal] = useState<
    null | "edit" | "move" | "followers" | "archive" | "restore" | "delete" | "duplicate"
  >(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
    qc.invalidateQueries({ queryKey: ["activity", ticket.id] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    // Status changes move a project's open-ticket count (and so its position on the Dashboard).
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.updateTicket>[1]) => api.updateTicket(ticket.id, data),
    meta: { errorTitle: `Couldn't update ${q(ticket.title)}` },
    // Snapshot the "before" values at click time so the toast can say what changed.
    onMutate: () => ({
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      assignee: ticket.assignee?.name ?? null,
    }),
    onSuccess: (_res, data, before) => {
      const t = q(before?.title ?? ticket.title);
      const parts: string[] = [];
      if (data.status && data.status !== before?.status)
        parts.push(`status changed from ${humanize(before?.status)} to ${humanize(data.status)}`);
      if (data.priority && data.priority !== before?.priority)
        parts.push(`priority changed from ${humanize(before?.priority)} to ${humanize(data.priority)}`);
      if ("assigneeId" in data) {
        const to = data.assigneeId ? assignable.find((m) => m.userId === data.assigneeId)?.name ?? "the selected member" : null;
        if (!to) parts.push(`unassigned${before?.assignee ? ` (was ${before.assignee})` : ""}`);
        else if (before?.assignee) parts.push(`reassigned from ${before.assignee} to ${to}`);
        else parts.push(`assigned to ${to}`);
      }
      toast.success(parts.length ? `Ticket ${t}: ${parts.join("; ")}.` : `Ticket ${t} was updated.`);
      refresh();
    },
  });
  const selfAssign = useMutation({
    mutationFn: () => api.selfAssign(ticket.id),
    meta: { errorTitle: `Couldn't assign ${q(ticket.title)}` },
    onMutate: () => ({ title: ticket.title, assignee: ticket.assignee?.name ?? null }),
    onSuccess: (_res, _v, before) => {
      toast.success(
        before?.assignee
          ? `Ticket ${q(before.title)} reassigned from ${before.assignee} to you.`
          : `Ticket ${q(before?.title ?? ticket.title)} assigned to you.`,
      );
      refresh();
    },
  });

  async function copyLink() {
    const url = `${window.location.origin}/tickets/${ticket.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs HTTPS / permission; fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) return void toast.warning(`Couldn't copy automatically. Link: ${url}`, { title: "Copy failed", duration: 10000 });
    }
    toast.success(`Link to ${q(ticket.title)} copied to clipboard.`);
  }

  if (!can) return null;

  const assignItems: MenuItem[] = [
    { key: "assign-none", label: "Unassigned", checked: !ticket.assignee, onSelect: () => update.mutate({ assigneeId: null }) },
    ...assignable.map((m) => ({
      key: `assign-${m.userId}`,
      label: m.userId === me?.id ? `${m.name} (me)` : m.name,
      checked: ticket.assignee?.id === m.userId,
      onSelect: () => ticket.assignee?.id !== m.userId && update.mutate({ assigneeId: m.userId }),
    })),
  ];

  const moreItems: MenuItem[] = [
    { key: "duplicate", label: "Duplicate", icon: <IconCopy size={15} />, hidden: !can.duplicate, onSelect: () => setModal("duplicate") },
    { key: "move", label: "Move to project…", icon: <IconMove size={15} />, hidden: !can.move, onSelect: () => setModal("move") },
    { key: "follower", label: "Add follower…", icon: <IconUserPlus size={15} />, hidden: !can.addFollower, onSelect: () => setModal("followers") },
    { key: "copy", label: "Copy link", icon: <IconLink size={15} />, onSelect: copyLink },
    { key: "archive", label: "Archive", icon: <IconArchive size={15} />, hidden: !can.archive, separator: true, onSelect: () => setModal("archive") },
    { key: "restore", label: "Restore from archive", icon: <IconArchive size={15} />, hidden: !can.restore, separator: true, onSelect: () => setModal("restore") },
    { key: "delete", label: "Delete", icon: <IconTrash size={15} />, danger: true, hidden: !can.delete, separator: true, onSelect: () => setModal("delete") },
  ];

  return (
    <div className="mt-4" data-testid="ticket-actions">
      <div className="flex flex-wrap items-center gap-2">
        {can.edit && (
          <button className="btn btn-secondary btn-sm" data-testid="action-edit" onClick={() => setModal("edit")}>
            <IconEdit size={14} />
            Edit
          </button>
        )}
        {can.assign ? (
          <MenuButton
            label={ticket.assignee ? `Assignee: ${ticket.assignee.name}` : "Assign"}
            icon={<IconUser size={14} />}
            testId="action-assign"
            items={assignItems}
            disabled={update.isPending}
            width="w-64"
          />
        ) : (
          can.selfAssign &&
          ticket.assignee?.id !== me?.id && (
            <button
              className="btn btn-secondary btn-sm"
              data-testid="action-assign-me"
              disabled={selfAssign.isPending}
              onClick={() => selfAssign.mutate()}
            >
              <IconUser size={14} />
              {selfAssign.isPending ? "Assigning…" : "Assign to me"}
            </button>
          )
        )}
        {can.changeStatus && (
          <MenuButton
            label={`Status: ${label(ticket.status)}`}
            testId="action-status"
            disabled={update.isPending}
            items={STATUSES.map((s) => ({
              key: `status-${s}`,
              label: label(s),
              checked: ticket.status === s,
              onSelect: () => ticket.status !== s && update.mutate({ status: s }),
            }))}
          />
        )}
        {can.changePriority && (
          <MenuButton
            label={`Priority: ${ticket.priority}`}
            testId="action-priority"
            disabled={update.isPending}
            items={PRIORITIES.map((p) => ({
              key: `priority-${p}`,
              label: p,
              checked: ticket.priority === p,
              onSelect: () => ticket.priority !== p && update.mutate({ priority: p }),
            }))}
          />
        )}
        <MenuButton
          label="More"
          icon={<IconMoreHorizontal size={16} />}
          testId="action-more"
          items={moreItems}
          align="right"
          width="w-56"
        />
      </div>

      {modal === "edit" && (
        <EditModal
          ticket={ticket}
          internal={can.changePriority}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal === "move" && (
        <MoveModal
          ticket={ticket}
          onClose={() => setModal(null)}
          onMoved={(name) => {
            setModal(null);
            refresh();
            qc.invalidateQueries({ queryKey: ["projects"] });
            toast.success(`Ticket ${q(ticket.title)} moved from ${q(ticket.project?.name ?? "its project")} to ${q(name)}.`);
          }}
        />
      )}
      {modal === "followers" && (
        <FollowersModal
          ticket={ticket}
          me={me}
          canRemoveOthers={!!can.assign /* admins */}
          onClose={() => setModal(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
            qc.invalidateQueries({ queryKey: ["activity", ticket.id] });
          }}
        />
      )}
      <ActionConfirms ticket={ticket} modal={modal} close={() => setModal(null)} navigate={navigate} refresh={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function ActionConfirms({
  ticket,
  modal,
  close,
  navigate,
  refresh,
}: {
  ticket: Ticket;
  modal: string | null;
  close: () => void;
  navigate: (to: string) => void;
  refresh: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [modal]);

  const duplicate = useMutation({
    mutationFn: () => api.duplicateTicket(ticket.id),
    meta: { errorTitle: `Couldn't duplicate ${q(ticket.title)}` },
    onSuccess: (copy) => {
      toast.success(`Ticket ${q(`Copy of ${ticket.title}`)} was created from ${q(ticket.title)}.`);
      close();
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["activity", ticket.id] });
      navigate(`/tickets/${copy.id}`);
    },
    onError: (e) => setError(errText(e, "Couldn't duplicate the ticket.")),
  });
  const archive = useMutation({
    mutationFn: () => api.archiveTicket(ticket.id),
    meta: { errorTitle: `Couldn't archive ${q(ticket.title)}` },
    onSuccess: () => {
      close();
      refresh();
      toast.success(`Ticket ${q(ticket.title)} has been archived. You can restore it any time.`);
    },
    onError: (e) => setError(errText(e, "Couldn't archive the ticket.")),
  });
  const restore = useMutation({
    mutationFn: () => api.restoreTicket(ticket.id),
    meta: { errorTitle: `Couldn't restore ${q(ticket.title)}` },
    onSuccess: () => {
      close();
      refresh();
      toast.success(`Ticket ${q(ticket.title)} has been restored.`);
    },
    onError: (e) => setError(errText(e, "Couldn't restore the ticket.")),
  });
  const del = useMutation({
    mutationFn: () => api.deleteTicket(ticket.id),
    meta: { errorTitle: `Couldn't delete ${q(ticket.title)}` },
    onSuccess: () => {
      toast.success(`Ticket ${q(ticket.title)} has been permanently deleted.`);
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${ticket.projectId}`);
    },
    onError: (e) => setError(errText(e, "Couldn't delete the ticket.")),
  });

  const err = error && <p className="mt-2 text-danger">{error}</p>;
  return (
    <>
      <ConfirmModal
        open={modal === "duplicate"}
        title="Duplicate ticket?"
        message={
          <>
            <p>
              This creates a new open ticket, <span className="font-medium">"Copy of {ticket.title}"</span>, with
              the same description, type, priority and due date. Comments and attachments aren't copied.
            </p>
            {err}
          </>
        }
        confirmLabel="Duplicate"
        variant="primary"
        pending={duplicate.isPending}
        onConfirm={() => duplicate.mutate()}
        onClose={close}
      />
      <ConfirmModal
        open={modal === "archive"}
        title="Archive ticket?"
        message={
          <>
            <p>
              <span className="font-medium">"{ticket.title}"</span> will be hidden from ticket lists and from
              customers, and becomes read-only. Nothing is deleted — you can restore it at any time.
            </p>
            {err}
          </>
        }
        confirmLabel="Archive"
        variant="primary"
        pending={archive.isPending}
        onConfirm={() => archive.mutate()}
        onClose={close}
      />
      <ConfirmModal
        open={modal === "restore"}
        title="Restore ticket?"
        message={
          <>
            <p>
              <span className="font-medium">"{ticket.title}"</span> will appear in ticket lists again and customers
              will be able to see it.
            </p>
            {err}
          </>
        }
        confirmLabel="Restore"
        variant="primary"
        pending={restore.isPending}
        onConfirm={() => restore.mutate()}
        onClose={close}
      />
      <ConfirmModal
        open={modal === "delete"}
        title="Delete ticket?"
        message={
          <>
            <p>
              This will permanently delete <span className="font-medium">"{ticket.title}"</span> and all of its
              comments, attachments and activity history. This can't be undone.
            </p>
            {ticket.can?.archive && (
              <p className="mt-2 text-muted">Not sure? Archive it instead — it can be restored.</p>
            )}
            {err}
          </>
        }
        pending={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={close}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
function EditModal({
  ticket,
  internal,
  onClose,
  onSaved,
}: {
  ticket: Ticket;
  internal: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description ?? "");
  const [type, setType] = useState<TicketType>(ticket.type);
  const [due, setDue] = useState(ticket.dueDate ? ticket.dueDate.slice(0, 10) : "");

  const save = useMutation({
    meta: { errorTitle: `Couldn't save ${q(ticket.title)}` },
    mutationFn: () => {
      const data: Parameters<typeof api.updateTicket>[1] = {};
      if (title.trim() !== ticket.title) data.title = title.trim();
      if (description !== (ticket.description ?? "")) data.description = description;
      if (internal) {
        if (type !== ticket.type) data.type = type;
        const prev = ticket.dueDate ? ticket.dueDate.slice(0, 10) : "";
        if (due !== prev) data.dueDate = due ? new Date(due).toISOString() : null;
      }
      return Object.keys(data).length ? api.updateTicket(ticket.id, data) : Promise.resolve(ticket);
    },
    onSuccess: () => {
      // Describe what actually changed, with before -> after where it helps.
      const parts: string[] = [];
      const prevDue = ticket.dueDate ? ticket.dueDate.slice(0, 10) : "";
      if (title.trim() !== ticket.title) parts.push(`title changed to ${q(title.trim())}`);
      if (description !== (ticket.description ?? "")) parts.push("description updated");
      if (internal && type !== ticket.type) parts.push(`type changed from ${humanize(ticket.type)} to ${humanize(type)}`);
      if (internal && due !== prevDue) parts.push(`due date changed from ${prevDue || "none"} to ${due || "none"}`);
      if (parts.length) toast.success(`Ticket ${q(ticket.title)}: ${parts.join("; ")}.`);
      else toast.info("No changes to save.");
      onSaved();
    },
  });
  const err = (save.error as any)?.response?.data?.error;

  return (
    <Modal open onClose={save.isPending ? () => {} : onClose} title="Edit ticket" width={520}>
      <div className="space-y-4">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Title</span>
          <input
            className="input"
            value={title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="edit-title"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Description</span>
          <textarea
            className="input"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="edit-description"
          />
        </label>
        {internal && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <span className="eyebrow mb-1.5 block">Type</span>
              <Dropdown
                value={type}
                onChange={(v) => setType(v as TicketType)}
                options={TYPES.map((t) => ({ value: t, label: t }))}
              />
            </div>
            <label className="block">
              <span className="eyebrow mb-1.5 block">Due date</span>
              <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
        )}
        {save.isError && (
          <p className="text-sm text-danger" role="alert">
            {typeof err === "string" ? err : "Couldn't save your changes."}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={save.isPending}>
          Cancel
        </button>
        <button
          className="btn btn-primary btn-sm"
          data-testid="edit-save"
          disabled={save.isPending || !title.trim()}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function MoveModal({
  ticket,
  onClose,
  onMoved,
}: {
  ticket: Ticket;
  onClose: () => void;
  onMoved: (projectName: string) => void;
}) {
  const orgId = ticket.orgId ?? "";
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => api.projects(orgId),
    enabled: !!orgId,
  });
  const targets = (projects ?? []).filter((p) => p.id !== ticket.projectId);
  const [target, setTarget] = useState("");
  const move = useMutation({
    mutationFn: () => api.moveTicket(ticket.id, target),
    meta: { errorTitle: `Couldn't move ${q(ticket.title)}` },
    onSuccess: () => onMoved(targets.find((p) => p.id === target)?.name ?? "the project"),
  });
  const err = (move.error as any)?.response?.data?.error;

  return (
    <Modal open onClose={move.isPending ? () => {} : onClose} title="Move ticket" width={440}>
      <p className="mb-3 text-sm text-fg-soft">
        Move <span className="font-medium">"{ticket.title}"</span> to another project in this organisation. Its
        comments, files and history go with it. Access follows the new project — people who aren't on it
        will no longer see the ticket.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted">Loading projects…</p>
      ) : targets.length === 0 ? (
        <p className="text-sm text-muted">There are no other projects to move this ticket to.</p>
      ) : (
        <Dropdown
          value={target}
          onChange={setTarget}
          searchable
          placeholder="Choose a project…"
          options={targets.map((p) => ({ value: p.id, label: p.name }))}
        />
      )}
      {move.isError && <p className="mt-3 text-sm text-danger">{typeof err === "string" ? err : "Couldn't move the ticket."}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={move.isPending}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" disabled={!target || move.isPending} onClick={() => move.mutate()}>
          {move.isPending ? "Moving…" : "Move ticket"}
        </button>
      </div>
    </Modal>
  );
}

function FollowersModal({
  ticket,
  me,
  canRemoveOthers,
  onClose,
  onChanged,
}: {
  ticket: Ticket;
  me: { id: string; name: string } | null;
  canRemoveOthers: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: followers, isLoading } = useQuery({
    queryKey: ["followers", ticket.id],
    queryFn: () => api.followers(ticket.id),
  });
  const { data: team } = useQuery({
    queryKey: ["ticketMembers", ticket.id],
    queryFn: () => api.ticketMembers(ticket.id),
  });
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    qc.invalidateQueries({ queryKey: ["followers", ticket.id] });
    onChanged();
  };
  const add = useMutation({
    mutationFn: (userId?: string) => api.addFollower(ticket.id, userId),
    meta: { errorTitle: "Couldn't add the follower" },
    onSuccess: (_r, userId) => {
      const who = userId && userId !== me?.id ? (team ?? []).find((m) => m.userId === userId)?.name : null;
      toast.success(who ? `${who} is now following ${q(ticket.title)}.` : `You are now following ${q(ticket.title)}.`);
      setPick("");
      setError(null);
      done();
    },
    onError: (e) => setError(errText(e, "Couldn't add the follower.")),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeFollower(ticket.id, userId),
    meta: { errorTitle: "Couldn't remove the follower" },
    onSuccess: (_r, userId) => {
      const who = userId === me?.id ? null : (followers ?? []).find((f) => f.id === userId)?.name;
      toast.success(who ? `${who} was removed from followers of ${q(ticket.title)}.` : `You unfollowed ${q(ticket.title)}.`);
      setError(null);
      done();
    },
    onError: (e) => setError(errText(e, "Couldn't remove the follower.")),
  });

  const ids = new Set((followers ?? []).map((f) => f.id));
  const candidates = (team ?? []).filter((m) => !ids.has(m.userId));
  const iFollow = me ? ids.has(me.id) : false;

  return (
    <Modal open onClose={onClose} title="Followers" width={460}>
      <p className="mb-3 text-sm text-fg-soft">
        Followers are notified about comments and status changes on this ticket. Customers who follow only hear about
        customer-visible updates.
      </p>

      <div className="mb-4 max-h-52 space-y-1 overflow-y-auto" data-testid="followers-list">
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {followers?.length === 0 && <p className="text-sm text-muted">No followers yet.</p>}
        {followers?.map((f) => (
          <div key={f.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
            <Avatar name={f.name} url={f.avatarUrl} size={22} />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {(canRemoveOthers || f.id === me?.id) && (
              <button
                className="link link-danger text-xs"
                disabled={remove.isPending}
                onClick={() => remove.mutate(f.id)}
              >
                {f.id === me?.id ? "Unfollow" : "Remove"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="eyebrow mb-1.5">Add a follower</div>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Dropdown
            value={pick}
            onChange={setPick}
            searchable
            placeholder={candidates.length ? "Choose a member…" : "Everyone already follows"}
            disabled={candidates.length === 0}
            options={candidates.map((m) => ({ value: m.userId, label: `${m.name}${m.role === "CLIENT" ? " (customer)" : ""}` }))}
          />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!pick || add.isPending} onClick={() => add.mutate(pick)}>
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </div>
      {!iFollow && (
        <button className="link mt-2 text-xs" disabled={add.isPending} onClick={() => add.mutate(undefined)}>
          Follow this ticket myself
        </button>
      )}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      <div className="mt-5 flex justify-end">
        <button className="btn btn-secondary btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
