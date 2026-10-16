import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useOrg } from "../org";
import { Dropdown } from "../components/Dropdown";
import { TablePagination } from "../components/TablePagination";
import { BulkStatusBar, RowCheck, useBulkSelect, type BulkSelect } from "../components/BulkStatus";
import { isInternalIn, useAuth } from "../auth";
import { StatusBadge, PriorityBadge } from "../components/ui";
import {
  IconSearch,
  IconFolder,
  IconTicket,
  IconCheckCircle,
  IconAlertTriangle,
  IconClock,
} from "../components/Icons";
import { DateRangeFilter, type DateRangeValue } from "../components/DateRangeFilter";
import type { AssignmentInfo, CompletedTicket, TicketPriority, WorkStatusFilter, WorkTicket } from "../types";

const DEFAULT_PAGE_SIZE = 10; // same page sizes as every other ticket table (10 / 25 / 50 / 100)

const SECTION_TITLES: Record<WorkStatusFilter, string> = {
  all: "My Work",
  pending: "My Work",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
};

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  ...(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((p) => ({ value: p, label: p })),
];

export default function MyWork() {
  const { activeOrgId, activeOrg } = useOrg();
  const timeZone = activeOrg?.timezone;

  const [dates, setDates] = useState<DateRangeValue>({ range: "all", from: "", to: "" });
  const { range, from: customFrom, to: customTo } = dates;
  // Default view: Open tickets only. Cards (and the API's `status`) change it; deselecting a card returns here.
  const DEFAULT_STATUS: WorkStatusFilter = "pending";
  const [status, setStatus] = useState<WorkStatusFilter>(DEFAULT_STATUS);
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [projectId, setProjectId] = useState("");
  const [assignedBy, setAssignedBy] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setCompletedPage(1);
  }, [range, customFrom, customTo, status, priority, projectId, assignedBy, debouncedSearch, pageSize]);

  const { data: projects } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: () => api.projects(activeOrgId),
    enabled: !!activeOrgId,
  });

  const { data, isLoading, isFetching, isPlaceholderData } = useQuery({
    queryKey: [
      "myWork",
      activeOrgId,
      range,
      customFrom,
      customTo,
      status,
      priority,
      projectId,
      assignedBy,
      debouncedSearch,
      page,
      completedPage,
      pageSize,
    ],
    queryFn: () =>
      api.myWork(activeOrgId, {
        range,
        ...(range === "custom" ? { from: customFrom || undefined, to: customTo || undefined } : {}),
        status,
        priority: priority || undefined,
        projectId: projectId || undefined,
        assignedBy: assignedBy || undefined,
        q: debouncedSearch || undefined,
        page,
        pageSize,
        completedPage,
        completedPageSize: pageSize,
      }),
    enabled: !!activeOrgId,
    // Keep the current rows (dimmed) while the next page loads instead of flashing a skeleton.
    placeholderData: keepPreviousData,
  });

  const summary = data?.summary;
  const work = data?.work;
  const completedWork = data?.completedWork;

  // If a page ends up past the end (e.g. its last tickets were just moved), step back to the last real page.
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    const last = (t: number, size: number) => Math.max(1, Math.ceil(t / size));
    if (data.work.total > 0 && page > last(data.work.total, data.work.pageSize)) setPage(last(data.work.total, data.work.pageSize));
    if (data.completedWork.total > 0 && completedPage > last(data.completedWork.total, data.completedWork.pageSize))
      setCompletedPage(last(data.completedWork.total, data.completedWork.pageSize));
  }, [data, isPlaceholderData, page, completedPage]);
  const { me } = useAuth();
  const canBulk = isInternalIn(me, activeOrgId);
  const toItems = (l?: { id: string; title: string }[]) => (canBulk ? l?.map((t) => ({ id: t.id, title: t.title })) : undefined);
  const workBulk = useBulkSelect(toItems(work?.items));
  const completedBulk = useBulkSelect(toItems(completedWork?.items));

  // Assigned By options come from the server (everyone who assigned one of my tickets). Names are remembered so
  // a selected person stays in the list even when another filter temporarily narrows the options.
  const knownAssigners = useRef(new Map<string, string>());
  data?.assigners?.forEach((p) => knownAssigners.current.set(p.id, p.name));
  const assignerOptions = useMemo(() => {
    const list = [...(data?.assigners ?? [])];
    if (assignedBy && !list.some((p) => p.id === assignedBy)) list.push({ id: assignedBy, name: knownAssigners.current.get(assignedBy) ?? "Selected" });
    return [{ value: "", label: "All assigners" }, ...list.map((p) => ({ value: p.id, label: p.name }))];
  }, [data?.assigners, assignedBy]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg" style={{ fontFamily: "var(--font-display)" }}>
          My Work
        </h1>
        <p className="mt-1 text-sm text-fg-soft">
          Tickets assigned to you, across the projects you have access to.
        </p>
      </div>

      {/* Summary cards — click one to filter the table below by it (click again to clear) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" role="group" aria-label="Filter tickets by summary">
        <SummaryCard testId="card-assigned" label="Assigned" value={summary?.open} icon={<IconFolder size={18} />} color="#92613a" bg="#f3ebe0" selected={status === DEFAULT_STATUS} onClick={() => setStatus(DEFAULT_STATUS)} />
        <SummaryCard testId="card-in-progress" label="In Progress" value={summary?.inProgress} icon={<IconClock size={18} />} color="#b8860b" bg="#fdf6e3" selected={status === "in_progress"} onClick={() => setStatus(status === "in_progress" ? DEFAULT_STATUS : "in_progress")} />
        <SummaryCard testId="card-completed" label="Completed" value={summary?.completed} icon={<IconCheckCircle size={18} />} color="#5a8a3c" bg="#f0f6ec" selected={status === "completed"} onClick={() => setStatus(status === "completed" ? DEFAULT_STATUS : "completed")} />
        <SummaryCard testId="card-overdue" label="Overdue" value={summary?.overdue} icon={<IconAlertTriangle size={18} />} color="#b93a2a" bg="#fdf0ee" selected={status === "overdue"} onClick={() => setStatus(status === "overdue" ? DEFAULT_STATUS : "overdue")} />
      </div>

      {/* Filters: date range (same presets as Attendance) + priority + project + search */}
      <div className="flex flex-wrap items-center gap-2" data-testid="work-filters">
        <DateRangeFilter value={dates} onChange={setDates} timeZone={timeZone} />
        <Dropdown
          className="w-40"
          size="sm"
          placeholder="All priorities"
          value={priority}
          onChange={(v) => setPriority(v as TicketPriority | "")}
          options={PRIORITY_OPTIONS}
        />
        <Dropdown
          className="w-48"
          size="sm"
          placeholder="All projects"
          searchable
          searchPlaceholder="Search projects…"
          value={projectId}
          onChange={setProjectId}
          options={[
            { value: "", label: "All projects" },
            ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Dropdown
          className="w-48"
          size="sm"
          placeholder="All assigners"
          ariaLabel="Assigned by"
          searchable
          searchPlaceholder="Search people…"
          value={assignedBy}
          onChange={setAssignedBy}
          options={assignerOptions}
        />
        <div className="relative min-w-[200px] flex-1 sm:max-w-[260px] sm:flex-none">
          <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input"
            style={{ paddingLeft: 34, width: "100%" }}
            placeholder="Search tickets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* My Work table */}
      <section>
        <h2 className="mb-3 text-lg font-bold tracking-tight text-fg" style={{ fontFamily: "var(--font-display)" }}>
          {SECTION_TITLES[status]}
        </h2>
        <div className={`card overflow-hidden transition-opacity ${isFetching && isPlaceholderData ? "opacity-60" : ""}`} aria-busy={isFetching && isPlaceholderData}>
          <WorkTable tickets={work?.items} loading={isLoading} bulk={canBulk ? workBulk : undefined} />
        </div>
        {work && work.total > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={work.total}
            busy={isFetching}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </section>

      {/* Completed Work table — only when Completed is selected; the default view is Open tickets only. */}
      {status === "completed" && (
      <section>
        <h2 className="mb-3 text-lg font-bold tracking-tight text-fg" style={{ fontFamily: "var(--font-display)" }}>
          Completed Work
        </h2>
        <div className={`card overflow-hidden transition-opacity ${isFetching && isPlaceholderData ? "opacity-60" : ""}`} aria-busy={isFetching && isPlaceholderData}>
          <CompletedTable tickets={completedWork?.items} loading={isLoading} timeZone={timeZone} bulk={canBulk ? completedBulk : undefined} />
        </div>
        {completedWork && completedWork.total > 0 && (
          <TablePagination
            page={completedPage}
            pageSize={pageSize}
            total={completedWork.total}
            busy={isFetching}
            onPageChange={setCompletedPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </section>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
  bg,
  selected,
  onClick,
  testId,
}: {
  label: string;
  value?: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
  selected: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={`card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      style={selected ? { background: bg } : undefined}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: selected ? "#fff" : bg, color }}
        >
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-fg" style={{ fontFamily: "var(--font-display)" }}>
            {value ?? "–"}
          </div>
          <div className="text-xs font-medium text-muted">{label}</div>
        </div>
      </div>
    </button>
  );
}

const ROW_GRID = "sm:grid-cols-[1fr_1.8fr_1fr_100px_110px_120px]";

/** "Assigned By" cell: the latest person who assigned or reassigned the ticket. */
function assignedByTip(info: AssignmentInfo): string | undefined {
  if (!info.assignedBy?.at) return undefined;
  const when = new Date(info.assignedBy.at).toLocaleString();
  if (info.assignmentCount > 1) {
    return `Originally assigned by ${info.firstAssignedBy?.name ?? "—"} · reassigned ${info.assignmentCount - 1} time${info.assignmentCount === 2 ? "" : "s"} · last on ${when}`;
  }
  return `Assigned on ${when}`;
}
function AssignedByCell({ info }: { info: AssignmentInfo }) {
  return (
    <span className="truncate text-sm text-fg-soft" data-testid="assigned-by" title={assignedByTip(info)}>
      {info.assignedBy?.name ?? "—"}
    </span>
  );
}

function WorkTable({ tickets, loading, bulk }: { tickets?: WorkTicket[]; loading: boolean; bulk?: BulkSelect }) {
  if (loading) {
    return (
      <div className="space-y-3 p-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-accent pulse" />
        ))}
      </div>
    );
  }
  if (!tickets || tickets.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
          <IconTicket size={20} />
        </div>
        <p className="text-sm font-medium text-fg-soft">Nothing here.</p>
        <p className="mt-1 text-xs text-muted">Tickets matching these filters will show up here.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="sm:min-w-[780px]">
      {bulk && <BulkStatusBar select={bulk} />}
      <div
        className={`hidden gap-3 border-b border-card-border bg-accent/40 py-2.5 pr-5 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid ${bulk?.active ? "pl-[52px]" : "pl-5"} ${ROW_GRID}`}
      >
        <span>Project</span>
        <span>Ticket</span>
        <span>Assigned By</span>
        <span>Priority</span>
        <span>Due Date</span>
        <span>Status</span>
      </div>
      <div className="divide-line">
        {tickets.map((t) => (
          <BulkRow key={t.id} bulk={bulk} id={t.id} title={t.title}>
          <Link
            to={`/tickets/${t.id}`}
            className={`grid grid-cols-1 gap-1.5 py-3.5 transition-colors hover:bg-accent sm:items-center sm:gap-3 ${bulk?.active ? "min-w-0 flex-1 pl-4 pr-5" : "px-5"} ${ROW_GRID}`}
          >
            <span className="truncate text-sm font-medium text-fg-soft">{t.project?.name ?? "—"}</span>
            <span className="truncate text-sm font-semibold text-fg">{t.title}</span>
            <span className="hidden sm:block"><AssignedByCell info={t} /></span>
            <span className="text-xs text-muted sm:hidden">Assigned by {t.assignedBy?.name ?? "—"}</span>
            <span>
              <PriorityBadge priority={t.priority} />
            </span>
            <span className="text-sm text-fg-soft">
              {t.dueDate ? new Date(t.dueDate).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—"}
            </span>
            <span>
              <StatusBadge status={t.status} />
            </span>
          </Link>
          </BulkRow>
        ))}
      </div>
      </div>
    </div>
  );
}

const COMPLETED_GRID = "sm:grid-cols-[2fr_1fr_1fr_140px]";

function CompletedTable({ tickets, loading, timeZone, bulk }: { tickets?: CompletedTicket[]; loading: boolean; timeZone?: string; bulk?: BulkSelect }) {
  if (loading) {
    return (
      <div className="space-y-3 p-5">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-accent pulse" />
        ))}
      </div>
    );
  }
  if (!tickets || tickets.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
          <IconCheckCircle size={20} />
        </div>
        <p className="text-sm font-medium text-fg-soft">No completed tickets in this range.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="sm:min-w-[700px]">
      {bulk && <BulkStatusBar select={bulk} />}
      <div
        className={`hidden gap-3 border-b border-card-border bg-accent/40 py-2.5 pr-5 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid ${bulk?.active ? "pl-[52px]" : "pl-5"} ${COMPLETED_GRID}`}
      >
        <span>Ticket</span>
        <span>Project</span>
        <span>Assigned By</span>
        <span>Completed Date</span>
      </div>
      <div className="divide-line">
        {tickets.map((t) => (
          <BulkRow key={t.id} bulk={bulk} id={t.id} title={t.title}>
          <Link
            to={`/tickets/${t.id}`}
            className={`grid grid-cols-1 gap-1.5 py-3.5 transition-colors hover:bg-accent sm:items-center sm:gap-3 ${bulk?.active ? "min-w-0 flex-1 pl-4 pr-5" : "px-5"} ${COMPLETED_GRID}`}
          >
            <span className="truncate text-sm font-semibold text-fg">{t.title}</span>
            <span className="truncate text-sm text-fg-soft">{t.project?.name ?? "—"}</span>
            <span className="hidden sm:block"><AssignedByCell info={t} /></span>
            <span className="text-xs text-muted sm:hidden">Assigned by {t.assignedBy?.name ?? "—"}</span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
              <IconCheckCircle size={14} />
              {new Date(t.completedAt).toLocaleDateString(undefined, { timeZone })}
            </span>
          </Link>
          </BulkRow>
        ))}
      </div>
      </div>
    </div>
  );
}

/** Wraps a My Work row with its select checkbox (just the row when bulk select is off). */
function BulkRow({ bulk, id, title, children }: { bulk?: BulkSelect; id: string; title: string; children: React.ReactNode }) {
  if (!bulk?.active) return <>{children}</>;
  const checked = bulk.selected.has(id);
  return (
    <div className={`flex items-stretch ${checked ? "bg-accent/70" : ""}`} data-testid="ticket-row">
      <div className="flex items-center pl-5">
        <RowCheck checked={checked} onToggle={() => bulk.toggle(id)} label={`Select ${title}`} />
      </div>
      {children}
    </div>
  );
}