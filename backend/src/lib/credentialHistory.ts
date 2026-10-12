import type { Prisma, User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { PasswordPolicyError, hashPassword, isPasswordRecentlyUsed } from "./password.js";
export const CREDENTIAL_HISTORY_LIMIT = 3;
export const HISTORY_ROWS_KEPT = CREDENTIAL_HISTORY_LIMIT - 1;

export const PASSWORD_REUSE_MESSAGE = "You have already used this password. Please choose a new one.";
export const PIN_REUSE_MESSAGE = "You have already used this PIN. Please choose a new one.";

export type Tx = Prisma.TransactionClient;
export const HISTORY_TX_OPTIONS = { timeout: 20_000, maxWait: 20_000 } as const;
export async function lockUserRow(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  if (rows.length === 0) throw new Error("User not found.");
}

export interface PasswordChangeHooks {
  verify?: (tx: Tx, user: User) => Promise<void>;
  after?: (tx: Tx, user: User) => Promise<void>;
}
export async function changePasswordWithHistory(
  userId: string,
  newPassword: string,
  hooks: PasswordChangeHooks = {},
): Promise<User> {
  const newHash = await hashPassword(newPassword);
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await hooks.verify?.(tx, user);

    const history = await tx.passwordHistory.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_ROWS_KEPT,
      select: { passwordHash: true },
    });
    if (await isPasswordRecentlyUsed(newPassword, [user.passwordHash, ...history.map((h) => h.passwordHash)])) {
      throw new PasswordPolicyError(PASSWORD_REUSE_MESSAGE);
    }

    const updated = await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    await tx.passwordHistory.create({ data: { userId, passwordHash: user.passwordHash } });
    const stale = await tx.passwordHistory.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: HISTORY_ROWS_KEPT,
      select: { id: true },
    });
    if (stale.length) await tx.passwordHistory.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });

    await hooks.after?.(tx, updated);
    return updated;
  }, HISTORY_TX_OPTIONS);
}