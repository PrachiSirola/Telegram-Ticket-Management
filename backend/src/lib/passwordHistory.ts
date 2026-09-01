import { prisma } from "../prisma.js";
import {
  PASSWORD_HISTORY_LIMIT,
  PasswordPolicyError,
  isPasswordRecentlyUsed,
} from "./password.js";

/**
 * Throws PasswordPolicyError if `newPassword` matches the user's current
 * password or any of their last PASSWORD_HISTORY_LIMIT - 1 historical ones.
 * Call this BEFORE hashing/saving the new password. Callers must follow a
 * successful update with recordPasswordHistory() to archive the old hash.
 */
export async function assertPasswordNotReused(
  userId: string,
  currentPasswordHash: string,
  newPassword: string,
): Promise<void> {
  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: PASSWORD_HISTORY_LIMIT - 1,
    select: { passwordHash: true },
  });
  const hashesToCheck = [currentPasswordHash, ...history.map((h) => h.passwordHash)];
  if (await isPasswordRecentlyUsed(newPassword, hashesToCheck)) {
    throw new PasswordPolicyError("You can't reuse a recent password. Please choose a new one.");
  }
}

/** Archives the password just replaced, then trims history beyond the limit. */
export async function recordPasswordHistory(userId: string, oldPasswordHash: string): Promise<void> {
  await prisma.passwordHistory.create({ data: { userId, passwordHash: oldPasswordHash } });
  const excess = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: PASSWORD_HISTORY_LIMIT - 1,
    select: { id: true },
  });
  if (excess.length) {
    await prisma.passwordHistory.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } });
  }
}