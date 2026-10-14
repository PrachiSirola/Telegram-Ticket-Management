import { prisma } from "../prisma.js";

/**
 * Who assigned a ticket, taken from its activity log (ASSIGNED events that name a new assignee):
 *   assignedBy      = the person behind the LATEST assignment or reassignment — what the "Assigned By" column shows.
 *   firstAssignedBy = the person behind the ORIGINAL (first) assignment — the only one the "Assigned By" FILTER
 *                     matches, so reassignments never move a ticket to another person's filter.
 *   assignmentCount = how many assignments the ticket has had (more than 1 means it was reassigned).
 * A ticket with no assignment event (older data, or created by import) falls back to its reporter.
 */
export interface Person { id: string; name: string }
export interface AssignmentInfo {
  assignedBy: (Person & { at: Date | null }) | null;
  firstAssignedBy: Person | null;
  assignmentCount: number;
}

/** Ids of tickets (of this assignee) whose "Assigned By" is `assignerId`. */
export async function ticketIdsAssignedBy(assigneeId: string, assignerId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t."id"
    FROM "Ticket" t
    WHERE t."assigneeId" = ${assigneeId}
      AND COALESCE(
        (SELECT a."actorId" FROM "TicketActivity" a
          WHERE a."ticketId" = t."id" AND a."type" = 'ASSIGNED'
            AND COALESCE(a."meta"->>'toId', a."toValue") IS NOT NULL
          ORDER BY a."createdAt" ASC, a."id" ASC LIMIT 1),
        t."reporterId") = ${assignerId}`;
  return rows.map((r) => r.id);
}

/** The people who are "Assigned By" on any of these tickets (options for the filter). */
export async function listAssigners(ticketIds: string[]): Promise<Person[]> {
  if (ticketIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT COALESCE(
        (SELECT a."actorId" FROM "TicketActivity" a
          WHERE a."ticketId" = t."id" AND a."type" = 'ASSIGNED'
            AND COALESCE(a."meta"->>'toId', a."toValue") IS NOT NULL
          ORDER BY a."createdAt" ASC, a."id" ASC LIMIT 1),
        t."reporterId") AS "id"
    FROM "Ticket" t
    WHERE t."id" = ANY(${ticketIds})`;
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, name: true },
  });
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

/** Adds assignedBy / reassignedBy / reassignCount to serialized tickets (one query for the whole page). */
export async function withAssignmentInfo<T extends { id: string; reporter?: { id: string; name: string } | null }>(
  items: T[],
): Promise<(T & AssignmentInfo)[]> {
  if (items.length === 0) return [];
  const events = await prisma.ticketActivity.findMany({
    where: { ticketId: { in: items.map((t) => t.id) }, type: "ASSIGNED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { ticketId: true, createdAt: true, toValue: true, meta: true, actor: { select: { id: true, name: true } } },
  });
  const byTicket = new Map<string, typeof events>();
  for (const e of events) {
    const names = (e.meta as { toId?: string } | null)?.toId ?? e.toValue;
    if (!names) continue; // "unassigned" — nobody was assigned
    byTicket.set(e.ticketId, [...(byTicket.get(e.ticketId) ?? []), e]);
  }
  return items.map((t) => {
    const evs = byTicket.get(t.id) ?? [];
    if (evs.length === 0) {
      const r = t.reporter ? { id: t.reporter.id, name: t.reporter.name } : null;
      return { ...t, assignedBy: r && { ...r, at: null }, firstAssignedBy: r, assignmentCount: 0 };
    }
    const first = evs[0], last = evs[evs.length - 1];
    return { ...t, assignedBy: { ...last.actor, at: last.createdAt }, firstAssignedBy: first.actor, assignmentCount: evs.length };
  });
}