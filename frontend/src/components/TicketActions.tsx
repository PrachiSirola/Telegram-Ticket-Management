import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { humanize, q, toast } from "../lib/toast";
import { MenuButton, type MenuItem } from "./ActionMenu";
import { ConfirmModal } from "./ConfirmModal";
import { TypeToConfirmModal } from "./TypeToConfirmModal";
import { Dropdown } from "./Dropdown";
import { DatePicker } from "./DatePicker";
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
import type { Member, TeamMember, Ticket, TicketPriority, TicketStatus, TicketType } from "../types";

const STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "DONE"];
const PRIORITIES: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TYPES: TicketType[] = ["BUG", "FEATURE", "TASK"];
const label = (v: string) => v.replace("_", " ");

function errText(e: any, fallback: string) {
  const d = e?.response?.data?.error;
  return typeof d === "string" ? d : fallback;
}

export function TicketActions({
  ticket,
  me,
  assignable,
}: {
  ticket: Ticket;
  me: { id: string; name: string } | null;
  assignable: TeamMember[];
}) {
  const can = ticket.can;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [modal, setModal] = useState<
    null | "edit" | "move" | "followers" | "archive" | "restore" | "delete" | "duplicate" | "assign"
  >(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
    qc.invalidateQueries({ queryKey: ["activity", ticket.id] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.updateTicket>[1]) => api.updateTicket(ticket.id, data),
    meta: { errorTitle: `Couldn't update ${q(ticket.title)}` },
    onMutate: () => ({
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      assignees: (ticket.assignees ?? []).map((a) => a.name),
    }),
    onSuccess: (_res, data, before) => {
      const t = q(before?.title ?? ticket.title);
      const parts: string[] = [];
      if (data.status && data.status !== before?.status)
        parts.push(`status changed from ${humanize(before?.status)} to ${humanize(data.status)}`);
      if (data.priority && data.priority !== before?.priority)
        parts.push(`priority changed from ${humanize(before?.priority)} to ${humanize(data.priority)}`);
      if (data.assigneeIds) {
        const now = data.assigneeIds.map((id) => assignable.find((m) => m.userId === id)?.name ?? "a member");
        const was = before?.assignees ?? [];
        const added = now.filter((n) => !was.includes(n));
        const removed = was.filter((n) => !now.includes(n));
        if (added.length) parts.push(`assigned to ${added.join(", ")}`);
        if (removed.length) parts.push(`${removed.join(", ")} unassigned`);
        if (!now.length && !removed.length) parts.push("no assignees");
      }
      toast.success(parts.length ? `Ticket ${t}: ${parts.join("; ")}.` : `Ticket ${t} was updated.`);
      refresh();
    },
  });
  async function copyLink() {
    const url = `${window.location.origin}/tickets/${ticket.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
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
        {can.assign && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="action-assign"
            disabled={update.isPending}
            onClick={() => setModal("assign")}
          >
            <IconUser size={14} />
            {ticket.assignees?.length === 0
              ? "Assign"
              : ticket.assignees?.length === 1
                ? `Assignee: ${ticket.assignees[0].name}`
                : `Assignees: ${ticket.assignees[0].name} +${ticket.assignees.length - 1}`}
          </button>
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

      {modal === "assign" && (
        <AssignModal
          ticket={ticket}
          me={me}
          assignable={assignable}
          saving={update.isPending}
          onClose={() => setModal(null)}
          onSave={(ids) => update.mutate({ assigneeIds: ids }, { onSuccess: () => setModal(null) })}
        />
      )}
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
  // Archive / delete need the exact ticket name (re-checked by the server).
  const projectName = ticket.project?.name ?? "";
  const confirmNames = { confirmTicketName: ticket.title };
  const { data: impact, isLoading: impactLoading } = useQuery({
    queryKey: ["ticket-impact", ticket.id],
    queryFn: () => api.ticketImpact(ticket.id),
    enabled: modal === "delete",
    staleTime: 0,
    gcTime: 0,
  });
  const nameFields = [{ label: "Type the ticket name to confirm", expected: ticket.title }];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const archive = useMutation({
    mutationFn: () => api.archiveTicket(ticket.id, confirmNames),
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
    mutationFn: () => api.deleteTicket(ticket.id, confirmNames),
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
      <TypeToConfirmModal
        open={modal === "archive"}
        title="Archive ticket?"
        confirmLabel="Archive ticket"
        pendingLabel="Archiving…"
        variant="primary"
        pending={archive.isPending}
        error={error}
        testId="archive-ticket"
        fields={nameFields}
        onConfirm={() => archive.mutate()}
        onClose={close}
      >
        <p>
          <span className="font-medium text-fg">"{ticket.title}"</span> (project{" "}
          "{projectName}") will be hidden from ticket lists and from
          customers, and becomes read-only. Nothing is deleted — you can restore it at any time.
        </p>
      </TypeToConfirmModal>
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
      <TypeToConfirmModal
        open={modal === "delete"}
        title="Delete ticket?"
        confirmLabel="Delete ticket"
        pendingLabel="Deleting…"
        pending={del.isPending}
        loading={impactLoading}
        error={error}
        testId="delete-ticket"
        fields={nameFields}
        onConfirm={() => del.mutate()}
        onClose={close}
      >
        <p>
          This permanently deletes <span className="font-medium text-fg">"{ticket.title}"</span> from project{" "}
          "{projectName}"
          {impactLoading ? "…" : " together with:"}
        </p>
        {impact && (
          <ul className="mt-2 list-disc pl-5" data-testid="delete-ticket-impact">
            <li>{plural(impact.comments, "comment", "comments")}</li>
            <li>{plural(impact.attachments, "attachment (uploaded files)", "attachments (uploaded files)")}</li>
            <li>{plural(impact.activity, "activity history entry", "activity history entries")}</li>
            <li>{plural(impact.followers, "follower subscription", "follower subscriptions")}</li>
          </ul>
        )}
        <p className="mt-2">
          This can't be undone. {ticket.can?.archive && "Not sure? Archive it instead — it can be restored."}
        </p>
      </TypeToConfirmModal>
    </>
  );
}

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
            <div>
              <span className="eyebrow mb-1.5 block">Due date</span>
              <DatePicker size="md" ariaLabel="Due date" placeholder="No due date" value={due} onChange={setDue} />
            </div>
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

function AssignModal({
  ticket,
  me,
  assignable,
  saving,
  onClose,
  onSave,
}: {
  ticket: Ticket;
  me: { id: string; name: string } | null;
  assignable: Member[] | TeamMember[];
  saving: boolean;
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const current = (ticket.assignees ?? []).map((a) => a.id);
  const [picked, setPicked] = useState<string[]>(current);
  const poolIds = new Set(assignable.map((m) => m.userId));

  const options = [
    ...assignable.map((m) => ({ id: m.userId, name: m.name, outside: false })),
    ...(ticket.assignees ?? []).filter((a) => !poolIds.has(a.id)).map((a) => ({ id: a.id, name: a.name, outside: true })),
  ];
  const changed = picked.length !== current.length || picked.some((id) => !current.includes(id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Modal open onClose={onClose} title="Assign ticket" width={460}>
      <p className="mb-3 text-sm text-muted">
        Choose everyone who is working on this ticket. Only members of this project can be assigned.
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-card-border" data-testid="assign-options">
        {options.length === 0 && <div className="p-3 text-sm text-muted">No members available.</div>}
        {options.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-3 border-b border-card-border px-3 py-2 last:border-b-0 hover:bg-black/5"
          >
            <input
              type="checkbox"
              checked={picked.includes(o.id)}
              onChange={() => toggle(o.id)}
              data-testid={`assign-opt-${o.id}`}
            />
            <span className="min-w-0 flex-1 truncate">{o.id === me?.id ? `${o.name} (me)` : o.name}</span>
            {o.outside && <span className="text-[11px] text-muted">not in project</span>}
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!picked.length} onClick={() => setPicked([])}>
          Clear all
        </button>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="assign-save"
            disabled={!changed || saving}
            onClick={() => onSave(picked)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
