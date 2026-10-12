import { prisma } from "../prisma.js";
import { type DateWindow } from "./dateRanges.js";

const userSelect = { select: { id: true, name: true, email: true, avatarUrl: true } };

export const workTicketInclude = {
  assignee: userSelect,
  reporter: userSelect,
  project: { select: { id: true, name: true, orgId: true } },
};

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
    reporter: t.reporter ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export interface CompletedWorkScope {
  orgId: string;
  userId: string;
  projectScope: Record<string, unknown>;
  searchWhere: Record<string, unknown>;
  window: DateWindow;
}
async function resolveCompletionDates(ticketIds: string[]): Promise<Map<string, Date>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await prisma.ticketStatusHistory.findMany({
    where: { ticketId: { in: ticketIds }, toStatus: "DONE" },
    orderBy: { changedAt: "desc" },
    select: { ticketId: true, changedAt: true },
  });
  const map = new Map<string, Date>();
  for (const row of rows) {
    if (!map.has(row.ticketId)) map.set(row.ticketId, row.changedAt);
  }
  return map;
}
export async function loadCompletedInScope(scope: CompletedWorkScope) {
  const { orgId, userId, projectScope, searchWhere, window } = scope;
  const doneTickets = await prisma.ticket.findMany({
    where: {
      assigneeId: userId,
      status: "DONE",
      archivedAt: null,
      project: { orgId, ...projectScope },
      ...searchWhere,
    } as any,
    include: workTicketInclude,
  });

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