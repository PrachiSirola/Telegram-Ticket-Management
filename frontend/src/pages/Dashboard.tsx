import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { TicketRow } from "../components/TicketRow";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Project } from "../types";

export default function Dashboard() {
  const { me } = useAuth();
  const { activeOrgId, activeOrg } = useOrg();
  const [filter, setFilter] = useState<"assigned" | "reported">("assigned");
  const { data: tickets, isLoading } = useQuery({
    queryKey: ["myTickets", activeOrgId, filter],
    queryFn: () => api.myTickets(activeOrgId, filter),
    enabled: !!activeOrgId,
  });

  const admin = isAdminOrAboveIn(me, activeOrgId);

  return (
    <div className="space-y-10">
      <ProjectsSection orgId={activeOrgId} canManage={admin} />

      <div>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="eyebrow mb-1">{activeOrg?.name}</div>
            <h1 className="text-2xl font-bold tracking-tight">My Tickets</h1>
          </div>
          <div className="inline-flex border border-card-border bg-bg p-0.5 text-sm">
            {(["assigned", "reported"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 ${
                  filter === f ? "bg-fg text-bg" : "text-fg-soft hover:text-fg"
                }`}
              >
                {f === "assigned" ? "Assigned to me" : "Reported by me"}
              </button>
            ))}
          </div>
        </div>

        <div className="card divide-line">
          {isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
          {tickets?.length === 0 && (
            <div className="p-8 text-center text-sm text-muted">No tickets here.</div>
          )}
          {tickets?.map((t) => (
            <TicketRow key={t.id} ticket={t} showProject />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectsSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [delProject, setDelProject] = useState<Project | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => api.projects(orgId),
    enabled: !!orgId,
  });

  const create = useMutation({
    mutationFn: () => api.createProject(orgId, { name, description: description || undefined }),
    onSuccess: () => {
      setName("");
      setDescription("");
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["projects", orgId] });
    },
  });
  const del = useMutation({
    mutationFn: (projectId: string) => api.deleteProject(orgId, projectId),
    onSuccess: () => {
      setDelProject(null);
      qc.invalidateQueries({ queryKey: ["projects", orgId] });
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="eyebrow mb-1">Overview</div>
          <h2 className="text-xl font-bold tracking-tight">Projects</h2>
        </div>
        {canManage && (
          <button onClick={() => setShowForm((s) => !s)} className="btn btn-primary btn-sm">
            {showForm ? "Cancel" : "+ New Project"}
          </button>
        )}
      </div>

      {showForm && (
        <div className="card mb-4 flex flex-wrap items-end gap-2 p-3">
          <div className="flex-1" style={{ minWidth: 160 }}>
            <div className="eyebrow mb-1">Name</div>
            <input
              className="input"
              placeholder="Website Revamp"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex-1" style={{ minWidth: 200 }}>
            <div className="eyebrow mb-1">Description (optional)</div>
            <input
              className="input"
              placeholder="What is this project about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create project"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.length === 0 && (
          <div className="card p-6 text-sm text-muted sm:col-span-2 lg:col-span-3">
            No projects yet{canManage ? " — create one to get started." : "."}
          </div>
        )}
        {projects?.map((p) => (
          <div key={p.id} className="card relative p-4 transition hover:bg-accent">
            <Link to={`/projects/${p.id}`} className="block">
              <div className="font-medium text-fg">{p.name}</div>
              <div className="mt-1 line-clamp-2 min-h-4 text-xs text-fg-soft">{p.description}</div>
              <div className="mt-3 text-xs text-muted">
                {p.ticketCount} ticket{p.ticketCount === 1 ? "" : "s"}
              </div>
            </Link>
            {canManage && (
              <button
                className="link link-danger absolute right-3 top-3 text-xs"
                onClick={() => setDelProject(p)}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!delProject}
        title="Delete project?"
        message={
          <>
            This permanently deletes <span className="font-medium">“{delProject?.name}”</span> and
            all of its tickets, comments, and attachments.
          </>
        }
        pending={del.isPending}
        onConfirm={() => del.mutate(delProject!.id)}
        onClose={() => setDelProject(null)}
      />
    </div>
  );
}
