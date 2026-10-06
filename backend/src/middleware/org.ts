import type { NextFunction, Request, Response } from "express";
import type { OrgRole, Project } from "@prisma/client";
import { prisma } from "../prisma.js";
import { canAccessOrg, isClient, membershipIn, orgRole } from "../lib/access.js";
import { developerCanAccessProject } from "../lib/projectAccess.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      project?: Project;
    }
  }
}

/**
 * Enforces that the authenticated user is an active member of the org named in
 * req.params.orgId. This is the central isolation guard — every org-scoped
 * route must pass through it. 404 (not 403) so we don't leak org existence.
 */
export function requireOrgAccess(req: Request, res: Response, next: NextFunction) {
  const orgId = req.params.orgId;
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (!orgId) return res.status(400).json({ error: "Missing orgId" });
  if (!canAccessOrg(req.user, orgId)) {
    return res.status(404).json({ error: "Organisation not found" });
  }
  next();
}

/** Requires one of the given roles within req.params.orgId. */
export function requireOrgRole(...roles: OrgRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const role = orgRole(req.user, req.params.orgId);
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

/**
 * Loads req.params.projectId, verifies it belongs to req.params.orgId, and —
 * for CLIENT members — that they are attached to the project. Attaches
 * req.project. Run after requireOrgAccess.
 */
export async function requireProjectAccess(req: Request, res: Response, next: NextFunction) {
  const { orgId, projectId } = req.params;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.orgId !== orgId) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (isClient(req.user!, orgId)) {
    const membership = membershipIn(req.user!, orgId)!;
    const attached = await prisma.projectClient.findUnique({
      where: { projectId_membershipId: { projectId, membershipId: membership.id } },
    });
    if (!attached) return res.status(404).json({ error: "Project not found" });
  } else if (orgRole(req.user!, orgId) === "DEVELOPER") {
    const membership = membershipIn(req.user!, orgId)!;
    const has = await developerCanAccessProject(req.user!.id, membership.id, projectId);
    if (!has) return res.status(404).json({ error: "Project not found" });
  }
  req.project = project;
  next();
}