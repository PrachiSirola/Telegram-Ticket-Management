import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { TicketRow } from "../components/TicketRow";
import { Dropdown } from "../components/Dropdown";
import { IconPlus } from "../components/Icons";
import {
  MentionTextarea,
  extractMentionIds,
  type MentionMember,
} from "../components/MentionTextarea";
import type { TicketPriority, TicketType } from "../types";

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
            canAssign={isAdminOrAboveIn(me, activeOrgId)}
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
          <div className="eyebrow mb-3">Team</div>
          <ul className="space-y-3 text-sm">
            {members?.map((m) => (
              <li key={m.userId} className="flex items-center gap-3">
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
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-fg">{m.name}</div>
                  <div className="truncate text-[11px] text-muted">{m.email}</div>
                </div>
                <span className="eyebrow shrink-0">
                  {m.role === "SUPER_ADMIN" ? "Owner" : m.role.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
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