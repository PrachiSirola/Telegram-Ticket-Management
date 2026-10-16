import { db, type Filter } from "../db/index.js";
import { isClient, membershipIn, orgRole, type AuthUser } from "./access.js";

export async function developerCanAccessProject(
  userId: string,
  membershipId: string,
  projectId: string,
): Promise<boolean> {
  const [explicit, viaTicket] = await Promise.all([
    db.projectDevelopers.exists({ projectId, membershipId }),
    db.tickets.exists({ projectId, assigneeIds: userId }),
  ]);
  return explicit || viaTicket;
}

export async function developerVisibleProjectIds(userId: string, membershipId: string): Promise<string[]> {
  const [attached, viaTickets] = await Promise.all([
    db.projectDevelopers.distinct("projectId", { membershipId }),
    db.tickets.distinct("projectId", { assigneeIds: userId }),
  ]);
  return [...new Set([...attached, ...viaTickets])];
}

export async function projectScopeFilter(user: AuthUser, orgId: string): Promise<Filter> {
  if (isClient(user, orgId)) {
    const ids = await db.projectClients.distinct("projectId", { membershipId: membershipIn(user, orgId)!.id });
    return { _id: { $in: ids } };
  }
  if (orgRole(user, orgId) === "DEVELOPER") {
    return { _id: { $in: await developerVisibleProjectIds(user.id, membershipIn(user, orgId)!.id) } };
  }
  return {};
}

export async function scopedProjectIds(user: AuthUser, orgId: string, extra: Filter = {}): Promise<string[]> {
  const scope = await projectScopeFilter(user, orgId);
  const rows = await db.projects.find({ ...extra, ...scope, orgId }, { select: ["id"] });
  return rows.map((p) => p.id);
}
