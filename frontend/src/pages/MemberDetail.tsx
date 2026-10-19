import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { Avatar } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { DateRangeFilter, DATE_RANGE_URL_VALUES } from "../components/DateRangeFilter";
import { TablePagination } from "../components/TablePagination";
import { useListParams } from "../lib/useListParams";
import { listQuery, readMemberListMemory, writeMemberListMemory } from "../lib/projectListMemory";
import type { WorkRange } from "../types";
import { TicketRow } from "../components/TicketRow";
import { BulkStatusBar, useBulkSelect } from "../components/BulkStatus";
import { backState } from "../components/BackLink";
import { IconArrowLeft, IconFolder, IconTicket, IconClock, IconCheckCircle } from "../components/Icons";

const STATUS_OPTS = ["OPEN", "IN_PROGRESS", "DONE"];
const PRIORITY_OPTS = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TYPE_OPTS = ["BUG", "FEATURE", "TASK"];

const FILTER_KEYS = ["status", "priority", "type", "range", "from", "to"];

const DEFAULT_VIEW = "status=OPEN&range=today";
const opt = (v: string) => ({ value: v, label: v.replace("_", " ") });

export default function MemberDetail() {
  const { userId = "" } = useParams();
  const { me } = useAuth();
  const { activeOrgId, activeOrg } = useOrg();
  const admin = isAdminOrAboveIn(me, activeOrgId);


  const { filters, page, pageSize, setFilter, setFilters, setPage, setPageSize, clearFilters } = useListParams({
    filters: { status: STATUS_OPTS, priority: PRIORITY_OPTS, type: TYPE_OPTS, range: DATE_RANGE_URL_VALUES },
    dateKeys: ["from", "to"],
  });
  const [defaultsFor, setDefaultsFor] = useState("");
  const [urlParams, setUrlParams] = useSearchParams();
  const listTop = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLElement>(null);
  const [flashProjects, setFlashProjects] = useState(false);
  const location = useLocation();

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["memberDetail", activeOrgId, userId],
    queryFn: () => api.memberDetail(activeOrgId, userId),
    enabled: !!activeOrgId && !!userId && admin,
  });

  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const {
    data: paged,
    isLoading: ticketsLoading,
    isFetching: ticketsFetching,
    isPlaceholderData,
    isError: ticketsError,
    refetch: refetchTickets,
  } = useQuery({
    queryKey: ["memberTickets", activeOrgId, userId, activeFilters, page, pageSize],
    queryFn: () =>
      api.memberTickets(activeOrgId, userId, {
        ...activeFilters,
        page,
        pageSize,
      }),

    enabled: !!activeOrgId && !!userId && admin && defaultsFor === userId,

    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === userId ? prev : undefined),
  });
  const hasFilters = Object.keys(activeFilters).length > 0;
  const bulk = useBulkSelect(
    admin ? paged?.items.filter((t: any) => !t.archivedAt).map((t: any) => ({ id: t.id, title: t.title })) : undefined,
  );


  const pendingView = useRef<string | null>(null);
  useEffect(() => {
    if (!admin || !activeOrgId || !userId || defaultsFor === userId) return;
    const urlHasView = FILTER_KEYS.some((k) => urlParams.get(k)) || urlParams.has("page");
    if (!urlHasView) {
      const remembered = readMemberListMemory(activeOrgId, userId);
      const view = remembered === null ? DEFAULT_VIEW : remembered;
      if (view !== "") {
        const saved = new URLSearchParams(view);
        const next = new URLSearchParams(urlParams);
        for (const k of [...FILTER_KEYS, "page"]) {
          const v = saved.get(k);
          if (v) next.set(k, v);
          else next.delete(k);
        }
        pendingView.current = listQuery(next, FILTER_KEYS);
        setUrlParams(next, { replace: true, state: location.state }); 
      }
    }
    setDefaultsFor(userId);

  }, [admin, activeOrgId, userId, defaultsFor]);


  const currentQuery = listQuery(urlParams, FILTER_KEYS);
  useEffect(() => {
    if (!admin || !activeOrgId || !userId || defaultsFor !== userId) return;
    if (pendingView.current !== null) {
      if (currentQuery !== pendingView.current) return; 
      pendingView.current = null;
    }
    writeMemberListMemory(activeOrgId, userId, currentQuery);
  }, [admin, activeOrgId, userId, defaultsFor, currentQuery]);


  useEffect(() => {
    if (paged && !isPlaceholderData && paged.page !== page) setPage(paged.page, { replace: true });
  }, [paged, isPlaceholderData, page, setPage]);


  const here = backState({ path: `${location.pathname}${location.search}`, label: detail?.name ?? "member" });


  function showTickets(status: string) {

    setFilters({ status, priority: "", type: "", range: "", from: "", to: "" });
    window.setTimeout(() => listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  function showProjects() {
    projectsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlashProjects(true);
    window.setTimeout(() => setFlashProjects(false), 1800);
  }

  function goToPage(next: number) {
    setPage(next);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!admin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <Link to="/members" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-soft hover:text-fg">
        <IconArrowLeft size={14} />
        Back to Members
      </Link>

      {detailLoading && <div className="card p-6 text-sm text-muted">Loading…</div>}

      {detail && (
        <>
          {/* Header */}
          <div className="card flex flex-wrap items-center gap-4 p-6">
            <Avatar name={detail.name} url={detail.avatarUrl} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-fg">{detail.name}</h1>
                {detail.role === "SUPER_ADMIN" && <span className="badge b-sage">Super Admin</span>}
                {detail.disabled && <span className="badge b-danger">Disabled</span>}
              </div>
              <p className="mt-0.5 text-sm text-muted">{detail.email}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-fg-soft">
                {detail.role === "SUPER_ADMIN" ? "Owner" : detail.role.toLowerCase()}
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard testId="stat-projects" label="Projects" value={detail.projects.length} icon={<IconFolder size={18} />} color="#92613a" bg="#f3ebe0" onClick={showProjects} hint="Show projects" />
            <StatCard testId="stat-assigned" label="Assigned" value={detail.ticketCounts.total} icon={<IconTicket size={18} />} color="#5c4033" bg="#efe6dc" onClick={() => showTickets("")} selected={!filters.status} hint="Show all assigned tickets" />
            <StatCard testId="stat-in-progress" label="In Progress" value={detail.ticketCounts.IN_PROGRESS} icon={<IconClock size={18} />} color="#b8860b" bg="#fdf6e3" onClick={() => showTickets("IN_PROGRESS")} selected={filters.status === "IN_PROGRESS"} hint="Show in-progress tickets" />
            <StatCard testId="stat-done" label="Done" value={detail.ticketCounts.DONE} icon={<IconCheckCircle size={18} />} color="#5a8a3c" bg="#f0f6ec" onClick={() => showTickets("DONE")} selected={filters.status === "DONE"} hint="Show done tickets" />
          </div>

          {/* Projects */}
          <section
            ref={projectsRef}
            id="member-projects"
            data-testid="member-projects"
            className={`scroll-mt-4 rounded-2xl transition-shadow duration-500 ${flashProjects ? "ring-2 ring-primary/40 ring-offset-4 ring-offset-bg" : ""}`}
          >
            <div className="eyebrow mb-3">Projects ({detail.projects.length})</div>
            {detail.projects.length === 0 ? (
              <div className="card p-6 text-sm text-muted">Not attached to any projects.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detail.projects.map((p: { id: string; name: string }) => (
                  <Link
                    key={p.id}
                    to={`/projects/${p.id}`}
                    state={here}
                    data-testid="member-project-chip"
                    className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-white px-3 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:border-primary/30 hover:text-fg"
                  >
                    <IconFolder size={13} className="text-primary" />
                    {p.name}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Assigned tickets, filterable + paginated */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="eyebrow">Assigned tickets</div>
              <div className="flex flex-wrap gap-2">
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
                  onChange={(d) =>
                    setFilters({ range: d.range === "all" ? "" : d.range, from: d.range === "custom" ? d.from : "", to: d.range === "custom" ? d.to : "" })
                  }
                />
              </div>
            </div>

            <div ref={listTop} className="scroll-mt-4" />
            <div
              className={`card divide-line overflow-hidden transition-opacity ${
                ticketsFetching && !ticketsLoading ? "opacity-60" : ""
              }`}
              aria-busy={ticketsFetching}
            >
              {ticketsLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
              {ticketsError && !paged && (
                <div className="p-10 text-center text-sm">
                  <p className="text-danger">Couldn't load tickets.</p>
                  <button className="btn btn-secondary btn-sm mt-3" onClick={() => refetchTickets()}>
                    Try again
                  </button>
                </div>
              )}
              {!ticketsLoading && paged?.items.length === 0 && (
                <div className="p-10 text-center text-sm text-muted">
                  {hasFilters ? (
                    <>
                      <p>No tickets match these filters.</p>
                      <button className="btn btn-secondary btn-sm mt-3" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </>
                  ) : (
                    "No tickets assigned."
                  )}
                </div>
              )}
              {admin && !ticketsLoading && <BulkStatusBar select={bulk} />}
              {paged?.items.map((t: any) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  showProject
                  linkState={here}
                  select={admin && bulk.active ? { checked: bulk.selected.has(t.id), onToggle: () => bulk.toggle(t.id), disabled: !!t.archivedAt } : undefined}
                />
              ))}
            </div>

            {paged && (
              <TablePagination
                page={paged.page}
                pageSize={paged.pageSize}
                total={paged.total}
                busy={ticketsFetching}
                onPageChange={goToPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
  bg,
  onClick,
  selected = false,
  hint,
  testId,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
  onClick: () => void;
  selected?: boolean;
  hint: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-label={`${label}: ${value}. ${hint}`}
      aria-pressed={selected}
      data-testid={testId}
      className={`card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        selected ? "ring-2 ring-primary/50" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: bg, color }}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-fg" style={{ fontFamily: "var(--font-display)" }}>
            {value}
          </div>
          <div className="text-xs font-medium text-muted">{label}</div>
        </div>
      </div>
    </button>
  );
}