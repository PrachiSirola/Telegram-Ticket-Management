import { db, type Filter } from "../db/index.js";
import { hydrateTickets } from "./hydrate.js";
import { type DateWindow } from "./dateRanges.js";

export function serializeTicket(t: any) {
  return {
    id: t.id,
    projectId: t.projectId,
    orgId: t.project?.orgId,
    project: t.project ? { id: t.project.id, name: t.project.name } : undefined,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    type: t.type,
    dueDate: t.dueDate,
    estimate: t.estimate,
    assignee: t.assignee ?? null,
    assignees: t.assignees ?? [],
    reporter: t.reporter ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export interface CompletedWorkScope {
  orgId: string;
  userId: string;
  projectIds: string[];
  searchWhere: Filter;
  window: DateWindow;
}
async function resolveCompletionDates(ticketIds: string[]): Promise<Map<string, Date>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await db.statusHistory.find(
    { ticketId: { $in: ticketIds }, toStatus: "DONE" },
    { sort: { changedAt: -1, _id: -1 }, select: ["ticketId", "changedAt"] },
  );
  const map = new Map<string, Date>();
  for (const row of rows) {
    if (!map.has(row.ticketId)) map.set(row.ticketId, row.changedAt);
  }
  return map;
}
export async function loadCompletedInScope(scope: CompletedWorkScope) {
  const { userId, projectIds, searchWhere, window } = scope;
  const found = await db.tickets.find({
    assigneeIds: userId,
    status: "DONE",
    archivedAt: null,
    projectId: { $in: projectIds },
    ...searchWhere,
  });
  const doneTickets = await hydrateTickets(found);

  const completionDates = await resolveCompletionDates(doneTickets.map((t) => t.id));
  const withDates = doneTickets.map((t) => ({
    ticket: t,
    completedAt: completionDates.get(t.id) ?? t.updatedAt,
  }));
  const filtered = withDates.filter(
    ({ completedAt }) =>
      (!window.start || completedAt >= window.start) && (!window.end || completedAt <= window.end),
  );

  filtered.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
  return filtered;
}

export async function countCompletedInRange(scope: CompletedWorkScope): Promise<number> {
  const rows = await loadCompletedInScope(scope);
  return rows.length;
}

export async function fetchCompletedWork(
  scope: CompletedWorkScope & { page: number; pageSize: number },
) {
  const rows = await loadCompletedInScope(scope);
  const total = rows.length;
  const start = (scope.page - 1) * scope.pageSize;
  const pageRows = rows.slice(start, start + scope.pageSize);
  return {
    items: pageRows.map(({ ticket, completedAt }) => ({
      ...serializeTicket(ticket),
      completedAt,
    })),
    total,
    page: scope.page,
    pageSize: scope.pageSize,
  };
}