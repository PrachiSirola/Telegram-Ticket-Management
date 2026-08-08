import { prisma } from "../prisma.js";
import { type DateWindow, type WorkRange } from "./dateRanges.js";

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
  /** Prisma `where` fragment scoping which projects are visible — SA/Admin
   *  get {}, clients/developers get their respective attachment rules. */
  projectScope: Record<string, unknown>;
  searchWhere: Record<string, unknown>;
  window: DateWindow;
  range: WorkRange;
}

/**
 * Resolves the actual completion date for a set of DONE tickets: the most
 * recent transition-to-DONE recorded in TicketStatusHistory. Tickets marked
 * DONE before that model existed have no history row at all — the caller
 * falls back to `updatedAt` for those (see loadCompletedInScope below), so
 * pre-existing completed tickets don't silently vanish from the list.
 */
async function resolveCompletionDates(ticketIds: string[]): Promise<Map<string, Date>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await prisma.ticketStatusHistory.findMany({
    where: { ticketId: { in: ticketIds }, toStatus: "DONE" },
    orderBy: { changedAt: "desc" },
    select: { ticketId: true, changedAt: true },
  });
  const map = new Map<string, Date>();
  for (const row of rows) {
    // Rows are ordered most-recent-first, so the first one seen per ticket
    // is its latest transition to DONE (relevant if it was completed,
    // reopened, then completed again — we want the latest completion).
    if (!map.has(row.ticketId)) map.set(row.ticketId, row.changedAt);
  }
  return map;
}

/**
 * All of this user's DONE tickets in scope, each with a resolved completion
 * date, filtered to the selected range by that date (not paginated —
 * callers slice/count as needed). Sorted most-recently-completed first.
 *
 * Data volumes here are inherently small (one person's own completed
 * tickets), so fetching the full set and filtering/sorting in application
 * code is simpler and more obviously correct than trying to express "latest
 * matching history row per ticket, filtered by date" as a single Prisma
 * query — and avoids the ambiguity of a relation `some` filter matching on
 * a stale historical row instead of the ticket's true latest completion.
 */
export async function loadCompletedInScope(scope: CompletedWorkScope) {
  const { orgId, userId, projectScope, searchWhere, window, range } = scope;
  const doneTickets = await prisma.ticket.findMany({
    where: {
      assigneeId: userId,
      status: "DONE",
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

  const unbounded = range === "current" || !window.start || !window.end;
  const filtered = unbounded
    ? withDates
    : withDates.filter(
        ({ completedAt }) => completedAt >= window.start! && completedAt <= window.end!,
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