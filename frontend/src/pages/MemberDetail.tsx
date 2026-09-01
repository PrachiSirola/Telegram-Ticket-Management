import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isAdminOrAboveIn, useAuth } from "../auth";
import { useOrg } from "../org";
import { Avatar } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { Pagination } from "../components/Pagination";
import { TicketRow } from "../components/TicketRow";
import { IconArrowLeft, IconFolder, IconTicket, IconClock, IconCheckCircle } from "../components/Icons";

const STATUS_OPTS = ["OPEN", "IN_PROGRESS", "DONE"];
const PRIORITY_OPTS = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TYPE_OPTS = ["BUG", "FEATURE", "TASK"];
const opt = (v: string) => ({ value: v, label: v.replace("_", " ") });

const PAGE_SIZE = 10;

export default function MemberDetail() {
  const { userId = "" } = useParams();
  const { me } = useAuth();
  const { activeOrgId } = useOrg();
  const admin = isAdminOrAboveIn(me, activeOrgId);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);

  function setFilter(k: string, v: string) {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  }

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["memberDetail", activeOrgId, userId],
    queryFn: () => api.memberDetail(activeOrgId, userId),
    enabled: !!activeOrgId && !!userId && admin,
  });

  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const { data: paged, isLoading: ticketsLoading } = useQuery({
    queryKey: ["memberTickets", activeOrgId, userId, activeFilters, page],
    queryFn: () =>
      api.memberTickets(activeOrgId, userId, {
        ...activeFilters,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: !!activeOrgId && !!userId && admin,
  });

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
            <StatCard label="Projects" value={detail.projects.length} icon={<IconFolder size={18} />} color="#92613a" bg="#f3ebe0" />
            <StatCard label="Assigned" value={detail.ticketCounts.total} icon={<IconTicket size={18} />} color="#5c4033" bg="#efe6dc" />
            <StatCard label="In Progress" value={detail.ticketCounts.IN_PROGRESS} icon={<IconClock size={18} />} color="#b8860b" bg="#fdf6e3" />
            <StatCard label="Done" value={detail.ticketCounts.DONE} icon={<IconCheckCircle size={18} />} color="#5a8a3c" bg="#f0f6ec" />
          </div>

          {/* Projects */}
          <section>
            <div className="eyebrow mb-3">Projects ({detail.projects.length})</div>
            {detail.projects.length === 0 ? (
              <div className="card p-6 text-sm text-muted">Not attached to any projects.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detail.projects.map((p: { id: string; name: string }) => (
                  <Link
                    key={p.id}
                    to={`/projects/${p.id}`}
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
              </div>
            </div>

            <div className="card divide-line overflow-hidden">
              {ticketsLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
              {!ticketsLoading && paged?.items.length === 0 && (
                <div className="p-10 text-center text-sm text-muted">
                  No tickets match these filters.
                </div>
              )}
              {paged?.items.map((t: any) => (
                <TicketRow key={t.id} ticket={t} showProject />
              ))}
            </div>

            {paged && paged.total > 0 && (
              <Pagination page={paged.page} total={paged.total} pageSize={paged.pageSize} onPageChange={setPage} />
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
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <div className="card p-4">
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
    </div>
  );
}