import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { TicketRow } from "../components/TicketRow";
import { Dropdown } from "../components/Dropdown";
import { Modal } from "../components/Modal";
import { ConfirmModal } from "../components/ConfirmModal";
import { IconPlus, IconTrash } from "../components/Icons";
import {
  MentionTextarea,
  extractMentionIds,
  type MentionMember,
} from "../components/MentionTextarea";
import { matchWords } from "../lib/search";
import type { Member, TicketPriority, TicketType } from "../types";
import { todayStr } from "../lib/dateUtils";

const STATUS_OPTS = ["OPEN", "IN_PROGRESS", "DONE"];
const PRIORITY_OPTS = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TYPE_OPTS = ["BUG", "FEATURE", "TASK"];
const opt = (v: string) => ({ value: v, label: v.replace("_", " ") });

export default function Project() {
  const { projectId = "" } = useParams();
  const { me } = useAuth();
  const { activeOrgId } = useOrg();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const canManage = isAdminOrAboveIn(me, activeOrgId);

  const { data: projects } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: () => api.projects(activeOrgId),
    enabled: !!activeOrgId,
  });
  const project = projects?.find((p) => p.id === projectId);

  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const { data: tickets, isLoading } = useQuery({
    queryKey: ["tickets", activeOrgId, projectId, activeFilters],
    queryFn: () => api.tickets(activeOrgId, projectId, activeFilters),
    enabled: !!activeOrgId && !!projectId,
  });
  const { data: members } = useQuery({
    queryKey: ["projectMembers", activeOrgId, projectId],
    queryFn: () => api.projectMembers(activeOrgId, projectId),
    enabled: !!activeOrgId && !!projectId,
  });

  // Removes a DEVELOPER/CLIENT from this project by re-PUTing the explicit
  // attachment list with them left out — the same set/prune endpoints the
  // Add Member flow uses, just with one membershipId excluded instead of
  // added. Note: a developer who still has a ticket assigned in this
  // project keeps implicit access (see lib/projectAccess.ts) and will
  // still appear here even after this succeeds — reassign or close their
  // ticket first if they need to fully lose access.
  const removeMember = useMutation({
    mutationFn: async (target: Member) => {
      const all = members ?? [];
      if (target.role === "DEVELOPER") {
        const remaining = all
          .filter((m) => m.role === "DEVELOPER" && m.membershipId !== target.membershipId)
          .map((m) => m.membershipId);
        await api.setProjectDevelopers(activeOrgId, projectId, remaining);
      } else if (target.role === "CLIENT") {
        const remaining = all
          .filter((m) => m.role === "CLIENT" && m.membershipId !== target.membershipId)
          .map((m) => m.membershipId);
        await api.setProjectClients(activeOrgId, projectId, remaining);
      }
    },
    onSuccess: () => {
      setRemovingMember(null);
      qc.invalidateQueries({ queryKey: ["projectMembers", activeOrgId, projectId] });
    },
  });

  function setFilter(k: string, v: string) {
    setFilters((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="eyebrow mb-1">Project</div>
            <h1 className="text-2xl font-bold tracking-tight text-fg">{project?.name ?? "Project"}</h1>
            {project?.description && (
              <p className="mt-1 text-sm text-fg-soft">{project.description}</p>
            )}
          </div>
          <button onClick={() => setShowForm((s) => !s)} className="btn btn-primary btn-sm">
            <IconPlus size={15} />
            {showForm ? "Cancel" : "New Ticket"}
          </button>
        </div>

        {showForm && (
          <NewTicketForm
            orgId={activeOrgId}
            projectId={projectId}
            canAssign={canManage}
            members={members ?? []}
            onCreated={() => {
              setShowForm(false);
              qc.invalidateQueries({ queryKey: ["tickets", activeOrgId, projectId] });
            }}
          />
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          {([
            ["status", STATUS_OPTS],
            ["priority", PRIORITY_OPTS],
            ["type", TYPE_OPTS],
          ] as const).map(([key, opts]) => (
            <Dropdown
              key={key}
              className="w-40"
              size="sm"
              placeholder={`All ${key}`}
              value={filters[key] ?? ""}
              onChange={(v) => setFilter(key, v)}
              options={[{ value: "", label: `All ${key}` }, ...opts.map(opt)]}
            />
          ))}
        </div>

        <div className="card divide-line overflow-hidden">
          {isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
          {tickets?.length === 0 && (
            <div className="p-10 text-center text-sm text-muted">No tickets.</div>
          )}
          {tickets?.map((t) => (
            <TicketRow key={t.id} ticket={t} />
          ))}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="eyebrow">Team</div>
            {canManage && (
                <button
                onClick={() => setShowAddMember(true)}
                className="btn btn-primary btn-sm"
              >
                <IconPlus size={13} />
                Add Member
              </button>
            )}
          </div>
          <ul className="space-y-3 text-sm">
            {members?.map((m) => {
              const removable =
                canManage && (m.role === "DEVELOPER" || m.role === "CLIENT");

              return (
                <li
                  key={m.userId}
                  className={`group relative flex items-center gap-3 ${
                    removable
                      ? "transition-transform duration-200 hover:-translate-x-5"
                      : ""
                  }`}
                >
                  {/* Avatar */}
                  {m.avatarUrl ? (
                    <img
                      src={m.avatarUrl}
                      alt={m.name}
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase text-primary">
                      {m.name.charAt(0)}
                    </span>
                  )}

                  {/* Name + Email */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{m.name}</div>
                    <div className="truncate text-[11px] text-muted">{m.email}</div>
                  </div>

                  {/* Role */}
                  <span className="eyebrow shrink-0">
                    {m.role === "SUPER_ADMIN" ? "Owner" : m.role.toLowerCase()}
                  </span>

                  {/* Delete icon only for Developer / Client */}
                  {removable && (
                    <button
                      type="button"
                      onClick={() => setRemovingMember(m)}
                      title="Remove from project"
                      className="absolute -right-7 rounded-md p-1 text-muted opacity-0 transition-opacity duration-200 hover:bg-[var(--danger-bg)] hover:text-danger group-hover:opacity-100"
                    >
                      <IconTrash size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {showAddMember && (
        <AddMemberModal
          orgId={activeOrgId}
          projectId={projectId}
          currentMembers={members ?? []}
          onClose={() => setShowAddMember(false)}
          onAdded={() => {
            setShowAddMember(false);
            qc.invalidateQueries({ queryKey: ["projectMembers", activeOrgId, projectId] });
          }}
        />
      )}

      <ConfirmModal
        open={!!removingMember}
        title="Remove member?"
        message={
          <>
            This will remove <span className="font-medium">{removingMember?.name}</span> from this
            project. They'll keep their org membership and access to other projects.
          </>
        }
        confirmLabel="Remove"
        pending={removeMember.isPending}
        onConfirm={() => removingMember && removeMember.mutate(removingMember)}
        onClose={() => setRemovingMember(null)}
      />
    </div>
  );
}

/**
 * Lets SA/Admin attach an existing org DEVELOPER or CLIENT to this project —
 * the gap this fills: today, project attachment only happens at invite
 * time (see Members.tsx's InviteForm), so someone already in the org had no
 * way to be added to a project after the fact. Reuses the same
 * setProjectDevelopers/setProjectClients endpoints the invite flow relies
 * on, just called after the fact instead of during signup.
 */
function AddMemberModal({
  orgId,
  projectId,
  currentMembers,
  onClose,
  onAdded,
}: {
  orgId: string;
  projectId: string;
  currentMembers: Member[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]); // OrgMember.membershipId values
  const [query, setQuery] = useState("");

  const { data: orgMembers, isLoading } = useQuery({
    queryKey: ["orgMembers", orgId],
    queryFn: () => api.orgMembers(orgId),
    enabled: !!orgId,
  });

  // Only devs/clients can be added this way — SA/Admin already see every
  // project, and a disabled member can't be attached to new work. Anyone
  // already on this project (by userId) is excluded from the picker.
  const currentUserIds = new Set(currentMembers.map((m) => m.userId));
  const candidates = (orgMembers ?? []).filter(
    (m) => !m.disabled && (m.role === "DEVELOPER" || m.role === "CLIENT") && !currentUserIds.has(m.userId),
  );
  const visibleCandidates = query.trim()
    ? candidates.filter((m) => matchWords(m.name, query) || matchWords(m.email, query))
    : candidates;

  const mut = useMutation({
    mutationFn: async () => {
      const picked = candidates.filter((m) => selected.includes(m.membershipId));
      const newDevIds = picked.filter((m) => m.role === "DEVELOPER").map((m) => m.membershipId);
      const newClientIds = picked.filter((m) => m.role === "CLIENT").map((m) => m.membershipId);
      const existingDevIds = currentMembers.filter((m) => m.role === "DEVELOPER").map((m) => m.membershipId);
      const existingClientIds = currentMembers.filter((m) => m.role === "CLIENT").map((m) => m.membershipId);

      await Promise.all([
        newDevIds.length
          ? api.setProjectDevelopers(orgId, projectId, [...existingDevIds, ...newDevIds])
          : Promise.resolve(),
        newClientIds.length
          ? api.setProjectClients(orgId, projectId, [...existingClientIds, ...newClientIds])
          : Promise.resolve(),
      ]);
    },
    onSuccess: onAdded,
  });

  function toggle(membershipId: string) {
    setSelected((prev) =>
      prev.includes(membershipId) ? prev.filter((v) => v !== membershipId) : [...prev, membershipId],
    );
  }

  return (
    <Modal open onClose={onClose} title="Add member to project" width={440}>
      {isLoading && <p className="text-sm text-fg-soft">Loading org members…</p>}
      {!isLoading && candidates.length === 0 && (
        <p className="text-sm text-fg-soft">
          Every developer and client in this org is already on this project.
        </p>
      )}
      {!isLoading && candidates.length > 0 && (
        <>
          <div className="eyebrow mb-1.5">Members</div>
          {candidates.length > 5 && (
            <input
              className="input mb-2"
              placeholder="Search by name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {/* Inline checklist, not a floating dropdown — a floating menu
              would overlay the Cancel/Add buttons below it and, being
              multi-select, never auto-closes after a pick. This scrolls
              within its own fixed height instead, so the buttons always
              stay visible and in normal document flow. */}
          <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
            {visibleCandidates.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted">No matches</div>
            ) : (
              visibleCandidates.map((m, i) => {
                const checked = selected.includes(m.membershipId);
                return (
                  <label
                    key={m.membershipId}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                      i > 0 ? "border-t border-line" : ""
                    } ${checked ? "bg-[#8B6F4E]/10" : "hover:bg-accent/40"}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-[#5C4033]"
                      checked={checked}
                      onChange={() => toggle(m.membershipId)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">{m.name}</span>
                      <span className="block truncate text-[11px] text-muted">{m.email}</span>
                    </span>
                    <span className="eyebrow shrink-0">
                      {m.role === "DEVELOPER" ? "Developer" : "Client"}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </>
      )}
      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="text-xs text-fg-soft">
          {selected.length > 0 ? `${selected.length} selected` : ""}
        </span>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-sm text-white"
            style={{ background: "#5C4033" }}
            onClick={() => mut.mutate()}
            disabled={selected.length === 0 || mut.isPending}
          >
            {mut.isPending ? "Adding…" : "Add to project"}
          </button>
        </div>
      </div>
      {mut.isError && <p className="mt-2 text-sm text-danger">Failed to add member.</p>}
    </Modal>
  );
}

function NewTicketForm({
  orgId,
  projectId,
  canAssign,
  members,
  onCreated,
}: {
  orgId: string;
  projectId: string;
  canAssign: boolean;
  members: { userId: string; name: string; role: string }[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TicketType>("TASK");
  const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [picked, setPicked] = useState<MentionMember[]>([]);

  const mut = useMutation({
    mutationFn: () =>
      api.createTicket(orgId, projectId, {
        title,
        description,
        type,
        priority,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        assigneeId: assigneeId || null,
        mentions: extractMentionIds(description, picked),
      }),
    onSuccess: onCreated,
  });

  const assignable = members.filter((m) => m.role !== "CLIENT");
  const mentionables: MentionMember[] = members.map((m) => ({ id: m.userId, name: m.name }));

  return (
    <div className="card mb-4 p-5">
      <input
        className="input mb-3"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="mb-3">
        <MentionTextarea
          placeholder="Description (@ to mention)"
          rows={3}
          value={description}
          onChange={setDescription}
          members={mentionables}
          onMention={(m) => setPicked((prev) => [...prev, m])}
        />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Dropdown
          className="w-36"
          value={type}
          onChange={(v) => setType(v as TicketType)}
          options={["TASK", "BUG", "FEATURE"].map(opt)}
        />
        <Dropdown
          className="w-36"
          value={priority}
          onChange={(v) => setPriority(v as TicketPriority)}
          options={["LOW", "MEDIUM", "HIGH", "URGENT"].map(opt)}
        />
        <input
          type="date"
          className="input w-auto"
          value={dueDate}
          min={todayStr()}
          onChange={(e) => setDueDate(e.target.value)}
        />
        {canAssign && (
          <Dropdown
            className="w-44"
            placeholder="Unassigned"
            value={assigneeId}
            onChange={setAssigneeId}
            options={[
              { value: "", label: "Unassigned" },
              ...assignable.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
        )}
      </div>
      <button disabled={!title || mut.isPending} onClick={() => mut.mutate()} className="btn btn-primary btn-sm">
        Create ticket
      </button>
      {mut.isError && <p className="mt-2 text-sm text-danger">Failed to create ticket.</p>}
    </div>
  );
}