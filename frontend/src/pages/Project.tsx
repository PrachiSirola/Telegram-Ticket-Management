import { q, toast } from "../lib/toast";
import { BackLink } from "../components/BackLink";
import { RestoreProjectModal } from "../components/ProjectModals";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, isInternalIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { TicketRow } from "../components/TicketRow";
import { BulkStatusBar, useBulkSelect } from "../components/BulkStatus";
import { Dropdown } from "../components/Dropdown";
import { DatePicker } from "../components/DatePicker";
import { DateRangeFilter, DATE_RANGE_URL_VALUES } from "../components/DateRangeFilter";
import { TablePagination } from "../components/TablePagination";
import { useListParams } from "../lib/useListParams";
import { Modal } from "../components/Modal";
import { ConfirmModal } from "../components/ConfirmModal";
import { IconPlus, IconTrash } from "../components/Icons";
import { FileDropzone, ProgressBar, StagedList, useStagedFiles } from "../components/FileDropzone";
import { VisibilityPicker, type VisibilityValue } from "../components/VisibilityPicker";
import { uploadErrorMessage, type RejectedFile } from "../lib/attachments";
import {
  MentionTextarea,
  extractMentionIds,
  type MentionMember,
} from "../components/MentionTextarea";
import { matchWords } from "../lib/search";
import type { Member, TeamMember, TicketPriority, TicketType, WorkRange } from "../types";
import { todayStr } from "../lib/dateUtils";

const STATUS_OPTS = ["OPEN", "IN_PROGRESS", "DONE"];
const PRIORITY_OPTS = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TYPE_OPTS = ["BUG", "FEATURE", "TASK"];
// "" (default) = active tickets only; the team can also look at archived ones.
const ARCHIVED_OPTS = ["archived", "all"];
const opt = (v: string) => ({ value: v, label: v.replace("_", " ") });

export default function Project() {
  const { projectId = "" } = useParams();
  const { me } = useAuth();
  const { activeOrgId, activeOrg } = useOrg();
  const qc = useQueryClient();
  // Filters + page + page size live in the URL (?status=OPEN&page=2&pageSize=50),
  // so they survive refresh / back / shared links. Changing a filter or the
  // page size resets to page 1 (page size itself is kept).
  const { filters, page, pageSize, setFilter, setFilters, setPage, setPageSize, clearFilters } = useListParams({
    filters: { status: STATUS_OPTS, priority: PRIORITY_OPTS, type: TYPE_OPTS, archived: ARCHIVED_OPTS, range: DATE_RANGE_URL_VALUES },
    dateKeys: ["from", "to"],
  });
  const listTop = useRef<HTMLDivElement>(null);
  // The project whose default view has been settled (see the effect below).
  const [defaultsFor, setDefaultsFor] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  // Set when a ticket was created but its attachments couldn't be uploaded.
  const [uploadNotice, setUploadNotice] = useState<{
    ticketId: string;
    title: string;
    message: string;
    files?: RejectedFile[];
  } | null>(null);
  const canManage = isAdminOrAboveIn(me, activeOrgId);

  // Fetched by id (not picked from the project list) because the list hides
  // archived projects, which can still be opened read-only.
  const { data: project } = useQuery({
    queryKey: ["projects", activeOrgId, "one", projectId],
    queryFn: () => api.project(activeOrgId, projectId),
    enabled: !!activeOrgId && !!projectId,
  });
  const projectArchived = !!project?.archivedAt;
  const [restoring, setRestoring] = useState(false);

  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const {
    data: paged,
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["tickets", activeOrgId, projectId, activeFilters, page, pageSize],
    queryFn: () => api.ticketsPaged(activeOrgId, projectId, { ...activeFilters, page, pageSize }),
    // Wait until the default view (today + Open) has been settled, so the
    // unfiltered list never flashes before it.
    enabled: !!activeOrgId && !!projectId && defaultsFor === projectId,
    // Keep the current rows on screen (dimmed) while the next page loads, but
    // never carry them over from a different project.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === projectId ? prev : undefined),
  });
  const tickets = paged?.items;
  const hasFilters = Object.keys(activeFilters).length > 0;
  // Bulk status: internal team only, never on an archived project; archived tickets can't be selected.
  const canBulk = isInternalIn(me, activeOrgId) && !projectArchived;
  const bulk = useBulkSelect(canBulk ? tickets?.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, title: t.title })) : undefined);

  // Default view: opening a project (with no filters in the URL) shows the
  // Open tickets due TODAY, where "today" is the date in the organisation's
  // timezone. It only applies on arrival — clearing the date or any other filter
  // afterwards is respected, and a link that already carries filters/page is left alone.
  useEffect(() => {
    if (!projectId || !activeOrg || defaultsFor === projectId) return;
    if (!hasFilters && page === 1) {
      setFilters({ status: "OPEN", range: "today" });
    }
    setDefaultsFor(projectId);
  }, [projectId, activeOrg, defaultsFor, hasFilters, page, setFilters]);

  // The server clamps an out-of-range page (e.g. tickets were deleted, or a
  // hand-edited URL) to the last real page — mirror that into the URL.
  // Skip while `paged` is only placeholder data from the previous page —
  // that would look like a clamp and bounce the user straight back.
  useEffect(() => {
    if (paged && !isPlaceholderData && paged.page !== page) setPage(paged.page, { replace: true });
  }, [paged, isPlaceholderData, page, setPage]);

  function goToPage(next: number) {
    setPage(next);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
    meta: { errorTitle: "Couldn't remove the member" },
    onSuccess: (_d, target) => {
      toast.success(`${target.name} was removed from ${project?.name ? q(project.name) : "the project"}.`);
      setRemovingMember(null);
      qc.invalidateQueries({ queryKey: ["projectMembers", activeOrgId, projectId] });
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div>
        <BackLink />
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="eyebrow mb-1">Project</div>
            <h1 className="text-2xl font-bold tracking-tight text-fg">{project?.name ?? "Project"}</h1>
            {project?.description && (
              <p className="mt-1 text-sm text-fg-soft">{project.description}</p>
            )}
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="btn btn-primary btn-sm"
            disabled={projectArchived}
            title={projectArchived ? "This project is archived" : undefined}
          >
            <IconPlus size={15} />
            {showForm ? "Cancel" : "New Ticket"}
          </button>
        </div>

        {projectArchived && (
          <div className="alert mb-4 flex flex-wrap items-center justify-between gap-2 text-sm" role="status" data-testid="project-archived-banner">
            <div>
              <span className="font-semibold text-fg">This project is archived.</span>{" "}
              <span className="text-fg-soft">It's hidden from project lists and its tickets are read-only.</span>
            </div>
            {canManage && (
              <button className="btn btn-secondary btn-sm" onClick={() => setRestoring(true)} data-testid="project-restore">
                Restore project
              </button>
            )}
          </div>
        )}
        <RestoreProjectModal
          orgId={activeOrgId}
          project={restoring ? project ?? null : null}
          onClose={() => setRestoring(false)}
          onDone={() => {
            setRestoring(false);
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["tickets", activeOrgId, projectId] });
          }}
        />

        {showForm && !projectArchived && (
          <NewTicketForm
            orgId={activeOrgId}
            projectId={projectId}
            projectName={project?.name}
            canAssign={canManage}
            members={members ?? []}
            internal={isInternalIn(me, activeOrgId)}
            onCreated={(failed) => {
              setShowForm(false);
              setUploadNotice(failed ?? null);
              qc.invalidateQueries({ queryKey: ["tickets", activeOrgId, projectId] });
              // A new ticket changes the project's open count (Dashboard order).
              qc.invalidateQueries({ queryKey: ["projects"] });
            }}
          />
        )}

        {uploadNotice && (
          <div className="alert alert-danger mb-4 text-sm" role="alert" data-testid="create-upload-failed">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">
                Ticket “{uploadNotice.title}” was created, but its attachments weren't uploaded.
              </div>
              <button className="link shrink-0" onClick={() => setUploadNotice(null)}>
                Dismiss
              </button>
            </div>
            <div className="mt-1">{uploadNotice.message}</div>
            {uploadNotice.files && (
              <ul className="mt-1 list-disc pl-5 text-[13px]">
                {uploadNotice.files.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">{f.name}</span>: {f.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1">
              <Link className="link" to={`/tickets/${uploadNotice.ticketId}`}>
                Open the ticket
              </Link>{" "}
              to add them again.
            </div>
          </div>
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
          <DateRangeFilter
            timeZone={activeOrg?.timezone}
            value={{ range: (filters.range || "all") as WorkRange, from: filters.from ?? "", to: filters.to ?? "" }}
            onChange={(d) => setFilters({ range: d.range === "all" ? "" : d.range, from: d.range === "custom" ? d.from : "", to: d.range === "custom" ? d.to : "" })}
          />
          {isInternalIn(me, activeOrgId) && (
            <Dropdown
              className="w-44"
              size="sm"
              placeholder="Active tickets"
              value={filters.archived ?? ""}
              onChange={(v) => setFilter("archived", v)}
              options={[
                { value: "", label: "Active tickets" },
                { value: "archived", label: "Archived only" },
                { value: "all", label: "Active + archived" },
              ]}
            />
          )}
        </div>

        <div ref={listTop} className="scroll-mt-4" />
        <div
          className={`card divide-line overflow-hidden transition-opacity ${
            isFetching && !isLoading ? "opacity-60" : ""
          }`}
          aria-busy={isFetching}
        >
          {isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
          {isError && !paged && (
            <div className="p-10 text-center text-sm">
              <p className="text-danger">Couldn't load tickets.</p>
              <button className="btn btn-secondary btn-sm mt-3" onClick={() => refetch()}>
                Try again
              </button>
            </div>
          )}
          {tickets?.length === 0 && (
            <div className="p-10 text-center text-sm text-muted">
              {hasFilters ? (
                <>
                  <p>
                    {filters.archived === "archived"
                      ? "No archived tickets match."
                      : "No tickets match these filters."}
                  </p>
                  <button className="btn btn-secondary btn-sm mt-3" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              ) : (
                "No tickets."
              )}
            </div>
          )}
          {canBulk && !isLoading && <BulkStatusBar select={bulk} />}
          {tickets?.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              select={canBulk && bulk.active ? { checked: bulk.selected.has(t.id), onToggle: () => bulk.toggle(t.id), disabled: !!t.archivedAt } : undefined}
            />
          ))}
        </div>

        {paged && (
          <TablePagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            busy={isFetching}
            onPageChange={goToPage}
            onPageSizeChange={setPageSize}
          />
        )}
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
          projectName={project?.name}
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
  projectName,
}: {
  orgId: string;
  projectId: string;
  projectName?: string;
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
    meta: { errorTitle: "Couldn't add to the project" },
    onSuccess: () => {
      const names = candidates.filter((m) => selected.includes(m.membershipId)).map((m) => m.name);
      const list = names.length > 2 ? `${names[0]}, ${names[1]} and ${names.length - 2} more` : names.join(" and ");
      toast.success(`${list} ${names.length === 1 ? "was" : "were"} added to ${projectName ? q(projectName) : "the project"}.`);
      onAdded();
    },
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
  internal,
  onCreated,
  projectName,
}: {
  orgId: string;
  projectId: string;
  projectName?: string;
  canAssign: boolean;
  members: Member[];
  internal: boolean;
  onCreated: (uploadFailed?: {
    ticketId: string;
    title: string;
    message: string;
    files?: RejectedFile[];
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TicketType>("TASK");
  const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [picked, setPicked] = useState<MentionMember[]>([]);
  // Attachments are optional. They're staged here and uploaded right after the
  // ticket exists, through the same endpoint (and so the same validation,
  // visibility and permission rules) as the Attachments panel on the ticket.
  const staged = useStagedFiles();
  const [vis, setVis] = useState<VisibilityValue>({
    visibility: internal ? "INTERNAL" : "CLIENT_VISIBLE",
    selectedUserIds: [],
  });
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState<"ticket" | "files">("ticket");

  const mut = useMutation({
    mutationFn: async () => {
      setPhase("ticket");
      const ticket = await api.createTicket(orgId, projectId, {
        title,
        description,
        type,
        priority,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        assigneeId: assigneeId || null,
        mentions: extractMentionIds(description, picked),
      });
      if (staged.files.length === 0) return { ticket, failed: undefined };
      // The ticket is already saved. If the upload fails we keep the ticket
      // and report it, rather than losing what the person typed.
      try {
        setPhase("files");
        setPercent(0);
        await api.uploadAttachments(ticket.id, staged.files, {
          visibility: vis.visibility,
          selectedUserIds: vis.selectedUserIds,
          onProgress: setPercent,
        });
        return { ticket, failed: undefined };
      } catch (e) {
        const { message, files } = uploadErrorMessage(e);
        return { ticket, failed: { ticketId: ticket.id, title: ticket.title, message, files } };
      }
    },
    meta: { errorTitle: "Couldn't create the ticket" },
    onSuccess: ({ ticket, failed }) => {
      const who = assigneeId ? members.find((m) => m.userId === assigneeId)?.name : null;
      toast.success(
        `Ticket ${q(ticket.title)} was created${projectName ? ` in ${q(projectName)}` : ""}${who ? ` and assigned to ${who}` : ""}.`,
      );
      if (failed)
        toast.warning(failed.message, { title: `Attachments for ${q(failed.title)} weren't uploaded`, duration: 9000 });
      onCreated(failed);
    },
  });
  const needsPeople = internal && vis.visibility === "SELECTED" && vis.selectedUserIds.length === 0;
  const { me } = useAuth();
  const pool: TeamMember[] = members.map((m) => ({
    userId: m.userId,
    name: m.name,
    email: m.email,
    avatarUrl: m.avatarUrl,
    role: m.role,
  }));

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
        <DatePicker
          size="md"
          className="w-44"
          ariaLabel="Due date"
          placeholder="Due date"
          value={dueDate}
          min={todayStr()}
          today={todayStr()}
          onChange={setDueDate}
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
      <div className="mb-4" data-testid="create-attachments">
        <div className="eyebrow mb-1.5">Attachments (optional)</div>
        <FileDropzone onFiles={staged.add} disabled={mut.isPending} compact />
        <StagedList
          files={staged.files}
          rejected={staged.rejected}
          onRemove={staged.remove}
          onDismissRejected={staged.dismissRejected}
          disabled={mut.isPending}
        />
        {staged.files.length > 0 && internal && (
          <div className="mt-3">
            <div className="eyebrow mb-1.5">Who can see these files?</div>
            <VisibilityPicker
              value={vis}
              onChange={setVis}
              members={pool}
              hideUserId={me?.id}
              disabled={mut.isPending}
            />
          </div>
        )}
        {staged.files.length > 0 && !internal && (
          <p className="mt-2 text-xs text-muted">These files will be visible to the project team.</p>
        )}
      </div>
      {mut.isPending && staged.files.length > 0 && phase === "files" && (
        <div className="mb-3">
          <ProgressBar
            percent={percent}
            label={`Uploading ${staged.files.length} file${staged.files.length > 1 ? "s" : ""}…`}
          />
        </div>
      )}
      <button
        disabled={!title || mut.isPending || needsPeople}
        onClick={() => mut.mutate()}
        className="btn btn-primary btn-sm"
      >
        {mut.isPending
          ? phase === "files"
            ? "Uploading files…"
            : "Creating…"
          : staged.files.length > 0
            ? `Create ticket with ${staged.files.length} file${staged.files.length > 1 ? "s" : ""}`
            : "Create ticket"}
      </button>
      {needsPeople && (
        <p className="mt-2 text-xs text-danger">Pick at least one member to share the files with.</p>
      )}
      {mut.isError && <p className="mt-2 text-sm text-danger">Failed to create ticket.</p>}
    </div>
  );
}