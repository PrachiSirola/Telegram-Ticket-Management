import type { Request, Response } from "express";
import type { Project, Ticket } from "@prisma/client";
import { prisma } from "../prisma.js";
import { canAccessOrg, isClient, membershipIn, orgRole } from "./access.js";
import { developerCanAccessProject } from "./projectAccess.js";

export type TicketWithProject = Ticket & { project: Project };

/**
 * Loads a ticket by req.params.id (with its project) and verifies the user can
 * access it: active member of the project's org, and — for clients — attached
 * to the project; for developers, explicitly assigned to the project OR
 * assigned at least one ticket in it (see lib/projectAccess.ts). Returns the
 * ticket, or null after sending a 404 response.
 */
export async function loadTicketForUser(
  req: Request,
  res: Response,
): Promise<TicketWithProject | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: { project: true },
  });
  const orgId = ticket?.project.orgId;
  if (!ticket || !req.user || !orgId || !canAccessOrg(req.user, orgId)) {
    res.status(404).json({ error: "Ticket not found" });
    return null;
  }
  if (isClient(req.user, orgId)) {
    const membership = membershipIn(req.user, orgId)!;
    const attached = await prisma.projectClient.findUnique({
      where: {
        projectId_membershipId: { projectId: ticket.projectId, membershipId: membership.id },
      },
    });
    if (!attached) {
      res.status(404).json({ error: "Ticket not found" });
      return null;
    }
  } else if (orgRole(req.user, orgId) === "DEVELOPER") {
    const membership = membershipIn(req.user, orgId)!;
    const has = await developerCanAccessProject(req.user.id, membership.id, ticket.projectId);
    if (!has) {
      res.status(404).json({ error: "Ticket not found" });
      return null;
    }
  }
  return ticket;
}