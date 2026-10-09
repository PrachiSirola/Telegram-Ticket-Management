import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { TicketRow } from "../components/TicketRow";
import { ConfirmModal } from "../components/ConfirmModal";
import { Pagination } from "../components/Pagination";
import { TablePagination } from "../components/TablePagination";
import { useListParams } from "../lib/useListParams";
import { IconFolder, IconPlus, IconArrowRight, IconTrash, IconSearch } from "../components/Icons";
import type { Project, ProjectCounts, ProjectStatusFilter } from "../types";
import { Dropdown } from "../components/Dropdown";

function HeroIllustration() {
  const S = "#F2D9B8";          
  const F = "#F2D9B8";        
  return (
    <svg
      viewBox="0 0 520 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute bottom-0 right-0 h-full"
      style={{ opacity: 0.28, width: "auto", minWidth: 400 }}
      preserveAspectRatio="xMaxYMax meet"
      aria-hidden
    >
      {/* Radial glow */}
      <defs>
        <radialGradient id="glow">
          <stop offset="0%" stopColor={S} stopOpacity="0.12" />
          <stop offset="100%" stopColor={S} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="310" cy="120" rx="150" ry="100" fill="url(#glow)" />

      {/* Desk */}
      <rect x="100" y="175" width="400" height="5" rx="2.5" stroke={S} strokeWidth="1.8" />

      {/* Monitor */}
      <rect x="245" y="45" width="130" height="90" rx="10" stroke={S} strokeWidth="2" />
      <line x1="310" y1="135" x2="310" y2="158" stroke={S} strokeWidth="2" />
      <line x1="282" y1="158" x2="338" y2="158" stroke={S} strokeWidth="2" strokeLinecap="round" />
      {/* Chart bars */}
      <rect x="265" y="85" width="12" height="32" rx="3" fill={F} fillOpacity="0.35" />
      <rect x="283" y="68" width="12" height="49" rx="3" fill={F} fillOpacity="0.45" />
      <rect x="301" y="78" width="12" height="39" rx="3" fill={F} fillOpacity="0.35" />
      <rect x="319" y="55" width="12" height="62" rx="3" fill={F} fillOpacity="0.55" />
      <rect x="337" y="72" width="12" height="45" rx="3" fill={F} fillOpacity="0.4" />
      {/* Trend line */}
      <polyline
        points="271,82 289,65 307,75 325,52 343,62"
        stroke={S} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"
      />

      {/* Coffee mug */}
      <rect x="405" y="125" width="34" height="40" rx="5" stroke={S} strokeWidth="2" />
      <path d="M439 136 C451 136 455 148 449 155 L439 155" stroke={S} strokeWidth="1.5" fill="none" />
      {/* Steam */}
      <path d="M416 118 C416 110 420 107 420 99" stroke={S} strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
      <path d="M425 120 C425 112 429 108 429 101" stroke={S} strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
      <path d="M434 119 C434 113 437 110 437 105" stroke={S} strokeWidth="1.2" strokeLinecap="round" opacity="0.35" />

      {/* Notebook */}
      <rect x="135" y="120" width="75" height="50" rx="4" stroke={S} strokeWidth="2" transform="rotate(-4 172 145)" />
      <line x1="152" y1="136" x2="198" y2="134" stroke={S} strokeWidth="1" opacity="0.45" />
      <line x1="153" y1="145" x2="195" y2="143" stroke={S} strokeWidth="1" opacity="0.4" />
      <line x1="154" y1="154" x2="185" y2="152" stroke={S} strokeWidth="1" opacity="0.3" />

      {/* Pen */}
      <line x1="220" y1="128" x2="232" y2="168" stroke={S} strokeWidth="2" strokeLinecap="round" />
      <circle cx="232" cy="168" r="2" fill={F} fillOpacity="0.4" />

      {/* Plant pot */}
      <path d="M460 168 L465 140 L495 140 L500 168 Z" stroke={S} strokeWidth="1.8" strokeLinejoin="round" fill="none" />
      {/* Leaves */}
      <path d="M474 140 C470 122 478 112 486 118" stroke={S} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M482 136 C488 118 498 116 496 126" stroke={S} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M478 134 C468 118 472 108 480 112" stroke={S} strokeWidth="1.8" fill="none" strokeLinecap="round" />

      {/* Floating cards */}
      <rect x="140" y="22" width="62" height="42" rx="8" stroke={S} strokeWidth="1.5" opacity="0.55" />
      <line x1="152" y1="36" x2="186" y2="36" stroke={S} strokeWidth="1.2" opacity="0.35" />
      <line x1="152" y1="46" x2="176" y2="46" stroke={S} strokeWidth="1.2" opacity="0.25" />
      <circle cx="190" cy="52" r="3" fill={F} fillOpacity="0.35" />

      <rect x="395" y="12" width="56" height="38" rx="8" stroke={S} strokeWidth="1.5" opacity="0.45" />
      <line x1="406" y1="25" x2="436" y2="25" stroke={S} strokeWidth="1.2" opacity="0.3" />
      <line x1="406" y1="34" x2="428" y2="34" stroke={S} strokeWidth="1.2" opacity="0.22" />

      {/* Decorative circles */}
      <circle cx="125" cy="55" r="14" stroke={S} strokeWidth="1.2" opacity="0.35" />
      <circle cx="125" cy="55" r="6" fill={F} fillOpacity="0.2" />
      <circle cx="470" cy="60" r="10" stroke={S} strokeWidth="1" opacity="0.25" />

      {/* Dots */}
      <circle cx="215" cy="40" r="3" fill={F} fillOpacity="0.3" />
      <circle cx="380" cy="28" r="2.5" fill={F} fillOpacity="0.25" />
      <circle cx="240" cy="15" r="2" fill={F} fillOpacity="0.2" />
    </svg>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const { activeOrgId } = useOrg();
  const { filters, page, pageSize, setFilter: setListFilter, setPage, setPageSize } = useListParams({
    pageKey: "tpage",
    sizeKey: "tsize",
    filters: { tview: ["assigned", "reported"] },
  });
  const filter = (filters.tview || "assigned") as "assigned" | "reported";
  const listTop = useRef<HTMLDivElement>(null);
  const {
    data: paged,
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["myTickets", activeOrgId, filter, page, pageSize],
    queryFn: () => api.myTicketsPaged(activeOrgId, filter, { page, pageSize }),
    enabled: !!activeOrgId,
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[1] === activeOrgId && prevQuery?.queryKey[2] === filter ? prev : undefined,
  });
  const tickets = paged?.items;
  useEffect(() => {
    if (paged && !isPlaceholderData && paged.page !== page) setPage(paged.page, { replace: true });
  }, [paged, isPlaceholderData, page, setPage]);

  function goToPage(next: number) {
    setPage(next);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const admin = isAdminOrAboveIn(me, activeOrgId);

  return (
    <div className="space-y-8">

      {/* ── Hero banner ── */}
      <section
        className="relative overflow-hidden rounded-2xl px-8 py-7"
        style={{
          background: "linear-gradient(135deg, #3D2B1F 0%, #5C4033 40%, #8B6F4E 100%)",
        }}
      >
        <HeroIllustration />

        <h1
          className="relative z-10 text-2xl font-extrabold tracking-tight text-white"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Good {getGreeting()}{me ? `, ${me.name.split(" ")[0]}` : ""}! 👋
        </h1>
        <p className="relative z-10 mt-1 text-sm font-medium text-white/60">
          Here's what's happening across your workspace today.
        </p>
      </section>

      {/* ── Projects ── */}
      <ProjectsSection orgId={activeOrgId} canManage={admin} />

      {/* ── Tickets ── */}
      <section>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-fg" style={{ fontFamily: "var(--font-display)" }}>
            My Tickets
          </h2>
          <div className="inline-flex overflow-hidden rounded-xl border border-card-border bg-white text-sm shadow-sm">
            {(["assigned", "reported"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setListFilter("tview", f === "assigned" ? "" : f)}
                className={`px-5 py-2 font-semibold transition-all ${
                  filter === f ? "bg-primary text-white" : "text-fg-soft hover:bg-accent hover:text-fg"
                }`}
              >
                {f === "assigned" ? "Assigned to me" : "Reported by me"}
              </button>
            ))}
          </div>
        </div>
        <div ref={listTop} className="scroll-mt-4" />
        <div
          className={`card divide-line overflow-hidden transition-opacity ${
            isFetching && !isLoading ? "opacity-60" : ""
          }`}
          aria-busy={isFetching}
        >
          {isError && !paged && (
            <div className="p-10 text-center text-sm">
              <p className="text-danger">Couldn't load tickets.</p>
              <button className="btn btn-secondary btn-sm mt-3" onClick={() => refetch()}>
                Try again
              </button>
            </div>
          )}
          {isLoading && (
            <div className="space-y-3 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-accent pulse" />)}
            </div>
          )}
          {tickets?.length === 0 && (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
                <IconFolder size={20} />
              </div>
              <p className="text-sm font-medium text-fg-soft">No tickets here yet.</p>
              <p className="mt-1 text-xs text-muted">Tickets assigned or reported by you will show up here.</p>
            </div>
          )}
          {tickets?.map((t) => <TicketRow key={t.id} ticket={t} showProject />)}
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
      </section>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

const PROJECT_COLORS = [
  { bg: "#f3ebe0", icon: "#92613a", border: "#ddd2c4" },
  { bg: "#f0f6ec", icon: "#5a8a3c", border: "#d4e4cc" },
  { bg: "#fdf6e3", icon: "#b8860b", border: "#eee0b8" },
  { bg: "#f5efe7", icon: "#6b5744", border: "#ddd2c4" },
  { bg: "#fdf0ee", icon: "#b93a2a", border: "#ecd4d0" },
  { bg: "#f0ece8", icon: "#7a5030", border: "#d8cec2" },
];

const PROJECTS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]; 
const DEFAULT_PROJECTS_PAGE_SIZE = 25;

const PROJECT_TABS: { key: ProjectStatusFilter; label: string; countKey: keyof ProjectCounts }[] = [
  { key: undefined, label: "All", countKey: "all" },
  { key: "new", label: "New", countKey: "new" },
  { key: "active", label: "Active", countKey: "active" },
  { key: "closed", label: "Closed", countKey: "closed" },
];

function ProjectsSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [delProject, setDelProject] = useState<Project | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PROJECTS_PAGE_SIZE);
  const [tab, setTab] = useState<ProjectStatusFilter>(undefined); 
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [tab, pageSize, debouncedSearch]);
  const { data: counts } = useQuery({
    queryKey: ["projects", orgId, "counts"],
    queryFn: () => api.projectCounts(orgId),
    enabled: !!orgId,
  });

  const { data: paged, isLoading } = useQuery({
    queryKey: ["projects", orgId, "paged", tab, page, pageSize, debouncedSearch],
    queryFn: () => api.projectsPaged(orgId, { page, pageSize, status: tab, q: debouncedSearch }),
    enabled: !!orgId,
  });
  const projects = paged?.items;

  function selectTab(next: ProjectStatusFilter) {
    setTab(next);
  }

  const create = useMutation({
    mutationFn: () => api.createProject(orgId, { name, description: description || undefined }),
    onSuccess: () => {
      setName("");
      setDescription("");
      setShowForm(false);
      setTab(undefined);
      setSearch("");
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
  useEffect(() => {
    if (paged && paged.items.length === 0 && page > 1) setPage(page - 1);
  }, [paged, page]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-fg" style={{ fontFamily: "var(--font-display)" }}>Projects</h2>
        {canManage && (
          <button onClick={() => setShowForm((s) => !s)} className="btn btn-primary btn-sm">
            <IconPlus size={15} />{showForm ? "Cancel" : "New Project"}
          </button>
        )}
      </div>

      {/* Status tabs (left) + search (right), same row */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-full border border-card-border bg-white p-1">
          {PROJECT_TABS.map((t) => {
            const active = t.key === tab;
            const count = counts?.[t.countKey];
            return (
              <button
                key={t.label}
                onClick={() => selectTab(t.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  active ? "bg-[#5C4033] text-white" : "text-fg-soft hover:bg-[#8B6F4E]/15 hover:text-fg"
                }`}
              >
                {t.label}
                {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="relative" style={{ minWidth: 240 }}>
          <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {showForm && (
        <div className="card mb-5 flex flex-wrap items-end gap-3 p-5">
          <div className="flex-1" style={{ minWidth: 160 }}>
            <div className="eyebrow mb-1.5">Name</div>
            <input className="input" placeholder="Website Revamp" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex-1" style={{ minWidth: 200 }}>
            <div className="eyebrow mb-1.5">Description (optional)</div>
            <input className="input" placeholder="What is this project about?" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-sm" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create project"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!isLoading && projects?.length === 0 && (
          <div className="card px-8 py-12 text-center sm:col-span-2 lg:col-span-3">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary"><IconFolder size={20} /></div>
            <p className="text-sm font-medium text-fg-soft">
              {debouncedSearch
                ? `No projects match "${debouncedSearch}".`
                : tab === undefined
                  ? `No projects yet${canManage ? " — create one to get started." : "."}`
                  : `No ${tab} projects right now.`}
            </p>
          </div>
        )}
        {projects?.map((p, i) => {
          const c = PROJECT_COLORS[i % PROJECT_COLORS.length];
          return (
            <div key={p.id} className="group relative overflow-hidden rounded-2xl border bg-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevated" style={{ borderColor: c.border }}>
              <div className="h-1" style={{ background: c.icon }} />
              <Link to={`/projects/${p.id}`} className="block p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: c.bg }}><IconFolder size={18} style={{ color: c.icon }} /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-bold tracking-tight text-fg transition-colors group-hover:text-primary" style={{ fontFamily: "var(--font-display)" }}>{p.name}</h3>
                    <p className="mt-0.5 text-sm text-fg-soft line-clamp-2">{p.description || "No description."}</p>
                  </div>
                </div>
                <div className="mt-3.5 flex items-center justify-between">
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: c.bg, color: c.icon }}>{p.ticketCount} {p.ticketCount === 1 ? "Ticket" : "Tickets"}</span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition-all group-hover:opacity-100">Open <IconArrowRight size={13} /></span>
                </div>
              </Link>
              {canManage && (
                <button className="absolute right-3 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100" onClick={() => setDelProject(p)} title="Delete project"><IconTrash size={14} /></button>
              )}
            </div>
          );
        })}
      </div>

      {paged && paged.total > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-fg-soft">
            <span>Rows per page</span>
            <Dropdown
              className="w-20"
              size="sm"
              value={String(pageSize)}
              onChange={(v) => setPageSize(Number(v))}
              options={PROJECTS_PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <span>
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, paged.total)} of {paged.total} projects
            </span>
          </div>
          <Pagination page={paged.page} total={paged.total} pageSize={paged.pageSize} onPageChange={setPage} />
        </div>
      )}

      <ConfirmModal open={!!delProject} title="Delete project?" message={<>This permanently deletes <span className="font-medium">"{delProject?.name}"</span> and all of its tickets, comments, and attachments.</>} pending={del.isPending} onConfirm={() => del.mutate(delProject!.id)} onClose={() => setDelProject(null)} />
    </section>
  );
}