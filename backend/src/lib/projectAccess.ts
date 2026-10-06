import { prisma } from "../prisma.js";

/**
 * A DEVELOPER can see a project if EITHER:
 *  - they're explicitly attached via ProjectDeveloper (assigned ahead of any
 *    ticket, e.g. right after being invited to the project), OR
 *  - they have at least one ticket assigned to them within that project.
 *
 * Once either condition holds, the developer gets full project-level access
 * (all its tickets, not just their own) — same granularity SA/Admin/Client
 * already get, just scoped to the project instead of the whole org.
 *
 * This is the single source of truth for that rule; every access-control
 * checkpoint (project list, requireProjectAccess, ticket access) reads from
 * it so the definition never drifts between call sites.
 */
export async function developerCanAccessProject(
  userId: string,
  membershipId: string,
  projectId: string,
): Promise<boolean> {
  const [explicit, viaTicket] = await Promise.all([
    prisma.projectDeveloper.findUnique({
      where: { projectId_membershipId: { projectId, membershipId } },
      select: { id: true },
    }),
    prisma.ticket.findFirst({
      where: { projectId, assigneeId: userId },
      select: { id: true },
    }),
  ]);
  return Boolean(explicit || viaTicket);
}

/**
 * Prisma `where` fragment for "projects a DEVELOPER can see in this org" —
 * used to filter the projects list query. Mirrors developerCanAccessProject's
 * rule but as a single query condition instead of a per-project check.
 */
export function developerVisibleProjectsWhere(userId: string, membershipId: string) {
  return {
    OR: [
      { developers: { some: { membershipId } } },
      { tickets: { some: { assigneeId: userId } } },
    ],
  };
}