import { createHash, randomBytes } from "node:crypto";
import { db, withTransaction } from "../db/index.js";
import type { Organization } from "../db/types.js";
import { canCreateOrganisation, type AuthUser } from "./access.js";

const TOKEN_TTL_MS = 30 * 60 * 1000;

export class NotPlatformAdminError extends Error {
  constructor() {
    super("Only a Super Admin can create organisations.");
  }
}

export class InvalidOrgCreationTokenError extends Error {
  constructor() {
    super("This confirmation link is invalid or has expired. Please start again.");
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function requestOrgCreation(
  user: AuthUser,
  orgNameRaw: string,
): Promise<{ token: string }> {
  if (!canCreateOrganisation(user)) throw new NotPlatformAdminError();

  const orgName = orgNameRaw.trim();
  const token = randomBytes(32).toString("hex");
  await db.orgCreations.create({
    requestedById: user.id,
    orgName,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });
  return { token };
}
export async function verifyAndCreateOrg(
  token: string,
  confirmingUserId: string,
): Promise<{ org: Organization }> {
  const record = await db.orgCreations.findOne({ tokenHash: hashToken(token) });
  if (!record || record.verifiedAt || record.createdOrgId || record.expiresAt < new Date()) {
    throw new InvalidOrgCreationTokenError();
  }
  if (record.requestedById !== confirmingUserId) throw new InvalidOrgCreationTokenError();
  const requesterMemberships = await db.memberships.find({ userId: record.requestedById, disabled: false });
  if (!canCreateOrganisation({ memberships: requesterMemberships })) throw new NotPlatformAdminError();

  const org = await withTransaction(async (tx) => {
    const claimed = await db.orgCreations.updateMany(
      { _id: record.id, verifiedAt: null, createdOrgId: null },
      { verifiedAt: new Date() },
      { session: tx },
    );
    if (claimed !== 1) throw new InvalidOrgCreationTokenError();
    const org = await db.orgs.create({ name: record.orgName }, { session: tx });
    await db.memberships.create({ userId: record.requestedById, orgId: org.id, role: "SUPER_ADMIN" }, { session: tx });
    await db.orgCreations.mustUpdate({ _id: record.id }, { createdOrgId: org.id }, { session: tx });
    return org;
  });
  return { org };
}