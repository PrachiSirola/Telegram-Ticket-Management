import { db } from "../db/index.js";

export async function followerRecipients(
  ticketId: string,
  orgId: string,
  projectId: string,
  opts: { customerVisible: boolean },
): Promise<string[]> {
  const followers = await db.followers.find({ ticketId }, { select: ["userId"] });
  if (followers.length === 0) return [];
  const memberships = await db.memberships.find({
    orgId,
    disabled: false,
    userId: { $in: followers.map((f) => f.userId) },
  });
  const attached = new Set(
    await db.projectClients.distinct("membershipId", {
      projectId,
      membershipId: { $in: memberships.filter((m) => m.role === "CLIENT").map((m) => m.id) },
    }),
  );
  return memberships
    .filter((m) => (m.role === "CLIENT" ? opts.customerVisible && attached.has(m.id) : true))
    .map((m) => m.userId);
}
