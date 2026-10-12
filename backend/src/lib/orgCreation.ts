import { createHash, randomBytes } from "node:crypto";
import type { Organization } from "@prisma/client";
import { prisma } from "../prisma.js";
import { canCreateOrganisation, type AuthUser } from "./access.js";

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes — matches the copy in orgCreationVerifyEmail

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
  await prisma.orgCreationRequest.create({
    data: {
      requestedById: user.id,
      orgName,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return { token };
}
export async function verifyAndCreateOrg(
  token: string,
  confirmingUserId: string,
): Promise<{ org: Organization }> {
  const record = await prisma.orgCreationRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { requestedBy: { include: { memberships: { where: { disabled: false } } } } },
  });
  if (!record || record.verifiedAt || record.createdOrgId || record.expiresAt < new Date()) {
    throw new InvalidOrgCreationTokenError();
  }
  if (record.requestedById !== confirmingUserId) throw new InvalidOrgCreationTokenError();
  if (!canCreateOrganisation(record.requestedBy)) throw new NotPlatformAdminError();

  const org = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: record.orgName } });
    await tx.orgMembership.create({
      data: { userId: record.requestedById, orgId: org.id, role: "SUPER_ADMIN" },
    });
    await tx.orgCreationRequest.update({
      where: { id: record.id },
      data: { verifiedAt: new Date(), createdOrgId: org.id },
    });
    return org;
  });
  return { org };
}