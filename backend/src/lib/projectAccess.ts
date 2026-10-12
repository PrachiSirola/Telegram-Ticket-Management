import { prisma } from "../prisma.js";
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

export function developerVisibleProjectsWhere(userId: string, membershipId: string) {
  return {
    OR: [
      { developers: { some: { membershipId } } },
      { tickets: { some: { assigneeId: userId } } },
    ],
  };
}