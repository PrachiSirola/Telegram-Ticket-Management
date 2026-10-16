import type { ClientSession } from "mongoose";
import { db, withTransaction } from "../db/index.js";
import type { User } from "../db/types.js";
import { PasswordPolicyError, hashPassword, isPasswordRecentlyUsed } from "./password.js";

export const CREDENTIAL_HISTORY_LIMIT = 3;
export const HISTORY_ROWS_KEPT = CREDENTIAL_HISTORY_LIMIT - 1;

export const PASSWORD_REUSE_MESSAGE = "You have already used this password. Please choose a new one.";
export const PIN_REUSE_MESSAGE = "You have already used this PIN. Please choose a new one.";


export type Tx = ClientSession | undefined;

const chains = new Map<string, Promise<unknown>>();

export function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(userId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  chains.set(userId, tail);
  void tail.then(() => {
    if (chains.get(userId) === tail) chains.delete(userId);
  });
  return run;
}

export async function lockUserRow(tx: Tx, userId: string): Promise<void> {
  const locked = await db.users.update({ _id: userId }, { $set: { updatedAt: new Date() } }, { session: tx });
  if (!locked) throw new Error("User not found.");
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
  const newHash = await hashPassword(newPassword); // slow bcrypt stays outside the transaction
  return withUserLock(userId, () => withTransaction(async (tx) => {
    await lockUserRow(tx, userId);
    const user = await db.users.mustById(userId, { session: tx });
    await hooks.verify?.(tx, user);

    const history = await db.passwordHistory.find(
      { userId },
      { sort: { createdAt: -1, _id: -1 }, limit: HISTORY_ROWS_KEPT, session: tx },
    );
    if (await isPasswordRecentlyUsed(newPassword, [user.passwordHash, ...history.map((h) => h.passwordHash)])) {
      throw new PasswordPolicyError(PASSWORD_REUSE_MESSAGE);
    }

    const updated = await db.users.mustUpdate({ _id: userId }, { passwordHash: newHash }, { session: tx });
    await db.passwordHistory.create({ userId, passwordHash: user.passwordHash }, { session: tx });
    const stale = await db.passwordHistory.find(
      { userId },
      { sort: { createdAt: -1, _id: -1 }, skip: HISTORY_ROWS_KEPT, select: ["id"], session: tx },
    );
    if (stale.length) await db.passwordHistory.deleteMany({ _id: { $in: stale.map((s) => s.id) } }, { session: tx });

    await hooks.after?.(tx, updated);
    return updated;
  }));
}
