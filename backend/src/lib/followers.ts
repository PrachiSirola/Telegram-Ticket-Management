import { prisma } from "../prisma.js";
export async function followerRecipients(
  ticketId: string,
  orgId: string,
  projectId: string,
  opts: { customerVisible: boolean },
): Promise<string[]> {
  const followers = await prisma.ticketFollower.findMany({
    where: { ticketId },
    select: { userId: true },
  });
  if (followers.length === 0) return [];
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, disabled: false, userId: { in: followers.map((f) => f.userId) } },
    include: { projectAccess: { where: { projectId }, select: { id: true } } },
  });
  return memberships
    .filter((m) =>
      m.role === "CLIENT" ? opts.customerVisible && m.projectAccess.length > 0 : true,
    )
    .map((m) => m.userId);
}