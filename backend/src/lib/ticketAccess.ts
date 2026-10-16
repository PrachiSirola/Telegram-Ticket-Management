import type { Request, Response } from "express";
import { db } from "../db/index.js";
import type { Project, Ticket } from "../db/types.js";
import { canAccessOrg, isClient, membershipIn, orgRole, type AuthUser } from "./access.js";
import { developerCanAccessProject } from "./projectAccess.js";

export type TicketWithProject = Ticket & { project: Project };

export async function userCanAccessTicket(
  user: AuthUser,
  ticket: TicketWithProject,
): Promise<boolean> {
  const orgId = ticket.project.orgId;
  if (!canAccessOrg(user, orgId)) return false;
  if (isClient(user, orgId)) {
    if (ticket.archivedAt) return false;
    const membership = membershipIn(user, orgId)!;
    return db.projectClients.exists({ projectId: ticket.projectId, membershipId: membership.id });
  }
  if (orgRole(user, orgId) === "DEVELOPER") {
    const membership = membershipIn(user, orgId)!;
    return developerCanAccessProject(user.id, membership.id, ticket.projectId);
  }
  return true;
}

export async function loadTicketWithProject(id: string): Promise<TicketWithProject | null> {
  const ticket = await db.tickets.byId(id);
  if (!ticket) return null;
  const project = await db.projects.byId(ticket.projectId);
  return project ? { ...ticket, project } : null;
}

export async function loadTicketForUser(
  req: Request,
  res: Response,
): Promise<TicketWithProject | null> {
  const ticket = await loadTicketWithProject(req.params.id);
  if (!ticket || !req.user || !(await userCanAccessTicket(req.user, ticket))) {
    res.status(404).json({ error: "Ticket not found" });
    return null;
  }
  return ticket;
}

export function rejectIfArchived(
  ticket: Ticket & { project?: { archivedAt: Date | null } | null },
  res: Response,
): boolean {
  if (ticket.project?.archivedAt) {
    res.status(409).json({ error: "This project is archived. Restore it before making changes." });
    return true;
  }
  if (!ticket.archivedAt) return false;
  res.status(409).json({ error: "This ticket is archived. Restore it before making changes." });
  return true;
}
