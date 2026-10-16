import { db } from "../db/index.js";
import type { TicketActivity } from "../db/types.js";

export interface Person { id: string; name: string }
export interface AssignmentInfo {
  assignedBy: (Person & { at: Date | null }) | null;
  firstAssignedBy: Person | null;
  assignmentCount: number;
}

const hasAssignee = (e: Pick<TicketActivity, "meta" | "toValue">) => Boolean((e.meta as { toId?: string } | null)?.toId ?? e.toValue);


async function assignmentEvents(ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  const events = await db.activity.find(
    { ticketId: { $in: ticketIds }, type: "ASSIGNED" },
    { sort: { createdAt: 1, _id: 1 } },
  );
  return events.filter(hasAssignee);
}


async function firstAssignerByTicket(tickets: { id: string; reporterId: string }[]): Promise<Map<string, string>> {
  const events = await assignmentEvents(tickets.map((t) => t.id));
  const first = new Map<string, string>();
  for (const e of events) if (!first.has(e.ticketId)) first.set(e.ticketId, e.actorId);
  return new Map(tickets.map((t) => [t.id, first.get(t.id) ?? t.reporterId]));
}


export async function ticketIdsAssignedBy(assigneeId: string, assignerId: string): Promise<string[]> {
  const tickets = await db.tickets.find({ assigneeIds: assigneeId }, { select: ["id", "reporterId"] });
  const byTicket = await firstAssignerByTicket(tickets);
  return tickets.filter((t) => byTicket.get(t.id) === assignerId).map((t) => t.id);
}


export async function listAssigners(ticketIds: string[]): Promise<Person[]> {
  if (ticketIds.length === 0) return [];
  const tickets = await db.tickets.find({ _id: { $in: ticketIds } }, { select: ["id", "reporterId"] });
  const byTicket = await firstAssignerByTicket(tickets);
  const users = await db.users.find({ _id: { $in: [...new Set(byTicket.values())] } });
  return users.map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}


export async function withAssignmentInfo<T extends { id: string; reporter?: { id: string; name: string } | null }>(
  items: T[],
): Promise<(T & AssignmentInfo)[]> {
  if (items.length === 0) return [];
  const events = await assignmentEvents(items.map((t) => t.id));
  const actors = new Map((await db.users.find({ _id: { $in: [...new Set(events.map((e) => e.actorId))] } })).map((u) => [u.id, u]));
  const byTicket = new Map<string, typeof events>();
  for (const e of events) byTicket.set(e.ticketId, [...(byTicket.get(e.ticketId) ?? []), e]);
  const person = (id: string): Person => ({ id, name: actors.get(id)?.name ?? "" });
  return items.map((t) => {
    const evs = byTicket.get(t.id) ?? [];
    if (evs.length === 0) {
      const r = t.reporter ? { id: t.reporter.id, name: t.reporter.name } : null;
      return { ...t, assignedBy: r && { ...r, at: null }, firstAssignedBy: r, assignmentCount: 0 };
    }
    const first = evs[0], last = evs[evs.length - 1];
    return {
      ...t,
      assignedBy: { ...person(last.actorId), at: last.createdAt },
      firstAssignedBy: person(first.actorId),
      assignmentCount: evs.length,
    };
  });
}
