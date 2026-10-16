import type { ClientSession } from "mongoose";
import { db, ActivityModel } from "./models.js";
type S = { session?: ClientSession };

export async function deleteAttachmentsWhere(filter: Record<string, any>, o: S = {}): Promise<string[]> {
  const rows = await db.attachments.find(filter, { session: o.session, select: ["storageKey"] });
  if (rows.length) {
    await db.attachmentAccess.deleteMany({ attachmentId: { $in: rows.map((r) => r.id) } }, o);
    await db.attachments.deleteMany({ _id: { $in: rows.map((r) => r.id) } }, o);
  }
  return rows.map((r) => r.storageKey);
}


export async function deleteCommentCascade(commentId: string, o: S = {}): Promise<string[]> {
  const ids = [commentId];
  let frontier = [commentId];
  while (frontier.length) {
    const kids = await db.comments.find({ parentId: { $in: frontier } }, { session: o.session, select: ["id"] });
    frontier = kids.map((k) => k.id);
    ids.push(...frontier);
  }
  const keys = await deleteAttachmentsWhere({ commentId: { $in: ids } }, o);
  await db.comments.deleteMany({ _id: { $in: ids } }, o);
  return keys;
}


export async function deleteTicketsCascade(ticketIds: string[], o: S = {}): Promise<string[]> {
  if (ticketIds.length === 0) return [];
  const byTicket = { ticketId: { $in: ticketIds } };
  const keys = await deleteAttachmentsWhere(byTicket, o);
  await Promise.all([
    db.comments.deleteMany(byTicket, o),
    db.followers.deleteMany(byTicket, o),
    db.statusHistory.deleteMany(byTicket, o),
    db.notifications.deleteMany(byTicket, o),
    ActivityModel.deleteMany(byTicket).setOptions({ cascade: true, session: o.session }).exec(),
  ]);
  await db.tickets.deleteMany({ _id: { $in: ticketIds } }, o);
  return keys;
}

export async function deleteProjectCascade(projectId: string, o: S = {}): Promise<string[]> {
  const tickets = await db.tickets.find({ projectId }, { session: o.session, select: ["id"] });
  const keys = await deleteTicketsCascade(tickets.map((t) => t.id), o);
  await Promise.all([db.projectClients.deleteMany({ projectId }, o), db.projectDevelopers.deleteMany({ projectId }, o)]);
  await db.projects.deleteOne({ _id: projectId }, o);
  return keys;
}

export async function deleteMembershipCascade(membershipId: string, o: S = {}): Promise<void> {
  await Promise.all([
    db.projectClients.deleteMany({ membershipId }, o),
    db.projectDevelopers.deleteMany({ membershipId }, o),
  ]);
  await db.memberships.deleteOne({ _id: membershipId }, o);
}

export async function deleteOrganizationCascade(orgId: string, o: S = {}): Promise<string[]> {
  const projects = await db.projects.find({ orgId }, { session: o.session, select: ["id"] });
  const keys: string[] = [];
  for (const p of projects) keys.push(...(await deleteProjectCascade(p.id, o)));
  const members = await db.memberships.find({ orgId }, { session: o.session, select: ["id"] });
  for (const m of members) await deleteMembershipCascade(m.id, o);
  await db.invites.deleteMany({ orgId }, o);
  await db.orgs.deleteOne({ _id: orgId }, o);
  return keys;
}
