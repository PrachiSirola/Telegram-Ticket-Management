import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useOrg } from "../org";
import { Dropdown } from "../components/Dropdown";
import { Pagination } from "../components/Pagination";
import { StatusBadge, PriorityBadge } from "../components/ui";
import {
  IconSearch,
  IconFolder,
  IconTicket,
  IconCheckCircle,
  IconAlertTriangle,
  IconClock,
} from "../components/Icons";
import type { CompletedTicket, Ticket, WorkRange, WorkStatusFilter } from "../types";

const PAGE_SIZE = 15;

const RANGE_OPTIONS: { value: WorkRange; label: string }[] = [
  { value: "current", label: "Current Work" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "prev_week", label: "Previous Week" },
  { value: "month", label: "This Month" },
  { value: "prev_month", label: "Previous Month" },
  { value: "custom", label: "Custom Range" },
];

const STATUS_TABS: { value: WorkStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "overdue", label: "Overdue" },
];

export default function MyWork() {
  const { activeOrgId } = useOrg();

  const [range, setRange] = useState<WorkRange>("current");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [status, setStatus] = useState<WorkStatusFilter>("all");
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);

  // Debounce the search box so we're not firing a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change invalidates both tables' current page — land back on
  // page 1 of each rather than showing a stale/out-of-range page.
  useEffect(() => {
    setPage(1);
    setCompletedPage(1);
  }, [range, customFrom, customTo, status, projectId, debouncedSearch]);

  const { data: projects } = useQuery({
    queryKey: ["projects", activeOrgId],
    queryFn: () => api.projects(activeOrgId),
    enabled: !!activeOrgId,
  });

  const { data, isLoading } = useQuery({
    queryKey: [
      "myWork",
      activeOrgId,
      range,
      customFrom,
      customTo,
      status,
      projectId,
      debouncedSearch,
      page,
      completedPage,
    ],
    queryFn: () =>
      api.myWork(activeOrgId, {
        range,
        ...(range === "custom" ? { from: customFrom || undefined, to: customTo || undefined } : {}),
        status,
        projectId: projectId || undefined,
        q: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
        completedPage,
        completedPageSize: PAGE_SIZE,
      }),
    enabled: !!activeOrgId,
  });

  const summary = data?.summary;
  const work = data?.work;
  const completedWork = data?.completedWork;

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

      {/* Range tabs */}
      <div className="flex flex-wrap gap-2">
        {RANGE_OPTIONS.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              range === r.value
                ? "bg-primary text-white"
                : "border border-card-border bg-white text-fg-soft hover:bg-accent hover:text-fg"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Custom range inputs */}
      {range === "custom" && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <div className="eyebrow mb-1.5">From</div>
            <input
              type="date"
              className="input"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </div>
          <div>
            <div className="eyebrow mb-1.5">To</div>
            <input
              type="date"
              className="input"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Assigned" value={summary?.assigned} icon={<IconFolder size={18} />} color="#92613a" bg="#f3ebe0" />
        <SummaryCard label="In Progress" value={summary?.inProgress} icon={<IconClock size={18} />} color="#b8860b" bg="#fdf6e3" />
        <SummaryCard label="Completed" value={summary?.completed} icon={<IconCheckCircle size={18} />} color="#5a8a3c" bg="#f0f6ec" />
        <SummaryCard label="Overdue" value={summary?.overdue} icon={<IconAlertTriangle size={18} />} color="#b93a2a" bg="#fdf0ee" />
      </div>

      {/* Status tabs + project filter + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap overflow-hidden rounded-xl border border-card-border bg-white text-sm shadow-sm">
          {STATUS_TABS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`px-4 py-2 font-semibold transition-all ${
                status === s.value ? "bg-primary text-white" : "text-fg-soft hover:bg-accent hover:text-fg"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2" style={{ minWidth: 260 }}>
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
          <div className="relative">
            <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="input"
              style={{ paddingLeft: 34, width: 220 }}
              placeholder="Search tickets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* My Work table */}
      <section>
        <h2 className="mb-3 text-lg font-bold tracking-tight text-fg" style={{ fontFamily: "var(--font-display)" }}>
          My Work
        </h2>
        <div className="card overflow-hidden">
          <WorkTable tickets={work?.items} loading={isLoading} />
        </div>
        {work && work.total > 0 && (
          <Pagination page={work.page} total={work.total} pageSize={work.pageSize} onPageChange={setPage} />
        )}
      </section>

      {/* Completed Work table */}
      <section>
        <h2 className="mb-3 text-lg font-bold tracking-tight text-fg" style={{ fontFamily: "var(--font-display)" }}>
          Completed Work
        </h2>
        <div className="card overflow-hidden">
          <CompletedTable tickets={completedWork?.items} loading={isLoading} />
        </div>
        {completedWork && completedWork.total > 0 && (
          <Pagination
            page={completedWork.page}
            total={completedWork.total}
            pageSize={completedWork.pageSize}
            onPageChange={setCompletedPage}
          />
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
  bg,
}: {
  label: string;
  value?: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: bg, color }}
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
    </div>
  );
}

const ROW_GRID = "sm:grid-cols-[1fr_2fr_110px_120px_130px]";

function WorkTable({ tickets, loading }: { tickets?: Ticket[]; loading: boolean }) {
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
    <div>
      <div
        className={`hidden gap-3 border-b border-card-border bg-accent/40 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid ${ROW_GRID}`}
      >
        <span>Project</span>
        <span>Ticket</span>
        <span>Priority</span>
        <span>Due Date</span>
        <span>Status</span>
      </div>
      <div className="divide-line">
        {tickets.map((t) => (
          <Link
            key={t.id}
            to={`/tickets/${t.id}`}
            className={`grid grid-cols-1 gap-1.5 px-5 py-3.5 transition-colors hover:bg-accent sm:items-center sm:gap-3 ${ROW_GRID}`}
          >
            <span className="truncate text-sm font-medium text-fg-soft">{t.project?.name ?? "—"}</span>
            <span className="truncate text-sm font-semibold text-fg">{t.title}</span>
            <span>
              <PriorityBadge priority={t.priority} />
            </span>
            <span className="text-sm text-fg-soft">
              {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "—"}
            </span>
            <span>
              <StatusBadge status={t.status} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

const COMPLETED_GRID = "sm:grid-cols-[2fr_1fr_140px]";

function CompletedTable({ tickets, loading }: { tickets?: CompletedTicket[]; loading: boolean }) {
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
    <div>
      <div
        className={`hidden gap-3 border-b border-card-border bg-accent/40 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid ${COMPLETED_GRID}`}
      >
        <span>Ticket</span>
        <span>Project</span>
        <span>Completed Date</span>
      </div>
      <div className="divide-line">
        {tickets.map((t) => (
          <Link
            key={t.id}
            to={`/tickets/${t.id}`}
            className={`grid grid-cols-1 gap-1.5 px-5 py-3.5 transition-colors hover:bg-accent sm:items-center sm:gap-3 ${COMPLETED_GRID}`}
          >
            <span className="truncate text-sm font-semibold text-fg">{t.title}</span>
            <span className="truncate text-sm text-fg-soft">{t.project?.name ?? "—"}</span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
              <IconCheckCircle size={14} />
              {new Date(t.completedAt).toLocaleDateString()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}