import type { ClientSession } from "mongoose";
import { db } from "../db/index.js";
import type { Project, Ticket } from "../db/types.js";


export interface UserLite { id: string; name: string; email: string; avatarUrl: string | null }

export const liteUser = (u: { id: string; name: string; email: string; avatarUrl: string | null }): UserLite => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatarUrl ?? null,
});

const uniq = (ids: Array<string | null | undefined>) => [...new Set(ids.filter((x): x is string => Boolean(x)))];

export async function usersById(ids: Array<string | null | undefined>, session?: ClientSession) {
  const list = uniq(ids);
  const rows = list.length ? await db.users.find({ _id: { $in: list } }, { session }) : [];
  return new Map(rows.map((u) => [u.id, u]));
}

export async function projectsById(ids: Array<string | null | undefined>, session?: ClientSession) {
  const list = uniq(ids);
  const rows = list.length ? await db.projects.find({ _id: { $in: list } }, { session }) : [];
  return new Map(rows.map((p) => [p.id, p]));
}

export type HydratedTicket = Ticket & {
  assignees: UserLite[];
  assignee: UserLite | null;
  reporter: UserLite | null;
  project: Project;
};

export async function hydrateTickets(tickets: Ticket[], session?: ClientSession): Promise<HydratedTicket[]> {
  if (tickets.length === 0) return [];
  const [users, projects] = await Promise.all([
    usersById(tickets.flatMap((t) => [...(t.assigneeIds ?? []), t.reporterId]), session),
    projectsById(tickets.map((t) => t.projectId), session),
  ]);
  return tickets.map((t) => {
    const assignees = (t.assigneeIds ?? []).flatMap((id) => (users.get(id) ? [liteUser(users.get(id)!)] : []));
    return {
    ...t,
    assignees,
    assignee: assignees[0] ?? null,
    reporter: users.get(t.reporterId) ? liteUser(users.get(t.reporterId)!) : (null as unknown as UserLite),
    project: projects.get(t.projectId)!,
    };
  });
}

export async function hydrateTicket(t: Ticket, session?: ClientSession): Promise<HydratedTicket> {
  return (await hydrateTickets([t], session))[0];
}
