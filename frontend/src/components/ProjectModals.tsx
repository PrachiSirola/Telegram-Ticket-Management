import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Modal } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";
import { TypeToConfirmModal } from "./TypeToConfirmModal";
import { q, toast } from "../lib/toast";
import type { Project } from "../types";

function errText(e: unknown, fallback: string): string {
  const err = (e as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof err === "string" ? err : fallback;
}

/** Edit a project's name and description. */
export function EditProjectModal({
  orgId,
  project,
  onClose,
  onSaved,
}: {
  orgId: string;
  project: Project | null;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setError("");
    }
  }, [project]);

  const save = useMutation({
    mutationFn: () => api.updateProject(orgId, project!.id, { name: name.trim(), description: description.trim() }),
    meta: { errorTitle: "Couldn't save the project" },
    onSuccess: (p) => {
      const renamed = p.name !== project!.name;
      const described = (p.description ?? "") !== (project!.description ?? "");
      toast.success(
        renamed
          ? `Project ${q(project!.name)} was renamed to ${q(p.name)}${described ? " and its description updated" : ""}.`
          : described
            ? `Description of project ${q(p.name)} was updated.`
            : `Project ${q(p.name)} was saved.`,
      );
      onSaved(p);
    },
    onError: (e) => setError(errText(e, "Couldn't save the project.")),
  });

  const unchanged = !!project && name.trim() === project.name && description.trim() === (project.description ?? "");

  return (
    <Modal open={!!project} onClose={save.isPending ? () => {} : onClose} title="Edit project" width={460}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !unchanged && !save.isPending) save.mutate();
        }}
      >
        <div className="eyebrow mb-1.5">Name</div>
        <input
          className="input"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          data-testid="edit-project-name"
        />
        <div className="eyebrow mb-1.5 mt-4">Description</div>
        <textarea
          className="input"
          rows={4}
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          data-testid="edit-project-description"
        />
        {error && (
          <div className="alert alert-danger mt-3 text-sm" role="alert">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!name.trim() || unchanged || save.isPending}
            data-testid="edit-project-save"
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Archive confirmation (restorable). The user must type the project's exact name. */
export function ArchiveProjectModal({
  orgId,
  project,
  onClose,
  onDone,
}: {
  orgId: string;
  project: Project | null;
  onClose: () => void;
  onDone: (p: Project) => void;
}) {
  const [error, setError] = useState("");
  useEffect(() => setError(""), [project]);
  const archive = useMutation({
    mutationFn: (name: string) => api.archiveProject(orgId, project!.id, name),
    meta: { errorTitle: "Couldn't archive the project" },
    onSuccess: (p) => {
      toast.success(`Project ${q(p.name)} has been archived. Restore it any time from the Archived tab.`);
      onDone(p);
    },
    onError: (e) => setError(errText(e, "Couldn't archive the project.")),
  });
  return (
    <TypeToConfirmModal
      open={!!project}
      title="Archive project?"
      confirmLabel="Archive project"
      pendingLabel="Archiving…"
      variant="primary"
      pending={archive.isPending}
      error={error}
      testId="archive-project"
      fields={[{ label: "Type the project name to confirm", expected: project?.name ?? "" }]}
      onConfirm={() => archive.mutate(project!.name)}
      onClose={onClose}
    >
      <p>
        <span className="font-medium text-fg">“{project?.name}”</span> will be hidden from project lists, pickers and My
        Work, and its tickets become read-only. Nothing is deleted.
      </p>
      <p className="mt-2">You can find it under the Archived tab and restore it at any time.</p>
    </TypeToConfirmModal>
  );
}

/** Restore from archive. */
export function RestoreProjectModal({
  orgId,
  project,
  onClose,
  onDone,
}: {
  orgId: string;
  project: Project | null;
  onClose: () => void;
  onDone: (p: Project) => void;
}) {
  const [error, setError] = useState("");
  useEffect(() => setError(""), [project]);
  const restore = useMutation({
    mutationFn: () => api.restoreProject(orgId, project!.id),
    meta: { errorTitle: "Couldn't restore the project" },
    onSuccess: (p) => {
      toast.success(`Project ${q(p.name)} has been restored.`);
      onDone(p);
    },
    onError: (e) => setError(errText(e, "Couldn't restore the project.")),
  });
  return (
    <ConfirmModal
      open={!!project}
      title="Restore project?"
      confirmLabel="Restore"
      variant="primary"
      pending={restore.isPending}
      onConfirm={() => restore.mutate()}
      onClose={onClose}
      message={
        <>
          <p>
            <span className="font-medium">“{project?.name}”</span> will return to the project lists and its tickets become
            editable again.
          </p>
          {error && <p className="mt-2 text-danger">{error}</p>}
        </>
      }
    />
  );
}

/** Permanent delete. The user must type the project's exact name. */
export function DeleteProjectModal({
  orgId,
  project,
  onClose,
  onDone,
}: {
  orgId: string;
  project: Project | null;
  onClose: () => void;
  onDone: (p: Project) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setTyped("");
    setError("");
  }, [project]);

  const { data: impact, isLoading } = useQuery({
    queryKey: ["projects", orgId, "impact", project?.id],
    queryFn: () => api.projectImpact(orgId, project!.id),
    enabled: !!project,
    staleTime: 0,
    gcTime: 0,
  });

  const del = useMutation({
    mutationFn: () => api.deleteProject(orgId, project!.id, typed),
    meta: { errorTitle: "Couldn't delete the project" },
    onSuccess: () => {
      toast.success(`Project ${q(project!.name)} and its data have been permanently deleted.`);
      onDone(project!);
    },
    onError: (e) => setError(errText(e, "Couldn't delete the project.")),
  });

  const matches = !!project && typed.trim() === project.name.trim();
  const hasData = !!impact && (impact.tickets > 0 || impact.comments > 0 || impact.attachments > 0);

  return (
    <Modal open={!!project} onClose={del.isPending ? () => {} : onClose} title="Delete project?" width={460}>
      <div className="text-sm text-fg-soft">
        <p>
          This permanently deletes <span className="font-medium text-fg">“{project?.name}”</span>
          {isLoading ? "…" : hasData ? " together with:" : ". It has no tickets."}
        </p>
        {hasData && impact && (
          <ul className="mt-2 list-disc pl-5" data-testid="delete-impact">
            <li>{impact.tickets} {impact.tickets === 1 ? "ticket" : "tickets"}</li>
            <li>{impact.comments} {impact.comments === 1 ? "comment" : "comments"}</li>
            <li>{impact.attachments} {impact.attachments === 1 ? "attachment" : "attachments"}</li>
          </ul>
        )}
        <p className="mt-2">
          This can't be undone. {project && !project.archivedAt && "Not sure? Archive it instead — it can be restored."}
        </p>
        <div className="eyebrow mb-1.5 mt-4">Type the project name to confirm</div>
        <input
          className="input"
          value={typed}
          placeholder={project?.name}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          data-testid="delete-project-confirm"
        />
        {error && (
          <div className="alert alert-danger mt-3 text-sm" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={del.isPending}>
          Cancel
        </button>
        <button
          className="btn btn-danger btn-sm"
          disabled={!matches || del.isPending || isLoading}
          onClick={() => del.mutate()}
          data-testid="delete-project-submit"
        >
          {del.isPending ? "Deleting…" : "Delete project"}
        </button>
      </div>
    </Modal>
  );
}
