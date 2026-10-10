import type { Request, Response } from "express";
import type { Project, Ticket } from "@prisma/client";
import { prisma } from "../prisma.js";
import { canAccessOrg, isClient, membershipIn, orgRole, type AuthUser } from "./access.js";
import { developerCanAccessProject } from "./projectAccess.js";

export type TicketWithProject = Ticket & { project: Project };

/**
 * Can this user open this ticket? Active member of the project's org, and —
 * for clients — attached to the project (and the ticket not archived); for
 * developers, explicitly assigned to the project OR assigned at least one
 * ticket in it (see lib/projectAccess.ts).
 *
 * Archived tickets are hidden from customers entirely; the internal team can
 * still open them (read-only until restored).
 */
export async function userCanAccessTicket(
  user: AuthUser,
  ticket: TicketWithProject,
): Promise<boolean> {
  const orgId = ticket.project.orgId;
  if (!canAccessOrg(user, orgId)) return false;
  if (isClient(user, orgId)) {
    if (ticket.archivedAt) return false;
    const membership = membershipIn(user, orgId)!;
    const attached = await prisma.projectClient.findUnique({
      where: {
        projectId_membershipId: { projectId: ticket.projectId, membershipId: membership.id },
      },
    });
    return Boolean(attached);
  }
  if (orgRole(user, orgId) === "DEVELOPER") {
    const membership = membershipIn(user, orgId)!;
    return developerCanAccessProject(user.id, membership.id, ticket.projectId);
  }
  return true;
}

/**
 * Loads a ticket by req.params.id (with its project) and verifies the user can
 * access it (userCanAccessTicket). Returns the ticket, or null after sending a
 * 404 response.
 */
export async function loadTicketForUser(
  req: Request,
  res: Response,
): Promise<TicketWithProject | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: { project: true },
  });
  if (!ticket || !req.user || !(await userCanAccessTicket(req.user, ticket))) {
    res.status(404).json({ error: "Ticket not found" });
    return null;
  }
  return ticket;
}

/**
 * Archived tickets — and every ticket of an archived project — are read-only:
 * send 409 and return true when blocked. (Callers load the ticket with its
 * project via loadTicketForUser, so the project's archive state is visible here.)
 */
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