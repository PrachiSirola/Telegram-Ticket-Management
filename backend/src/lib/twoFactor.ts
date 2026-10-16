import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { db, withTransaction } from "../db/index.js";
import type { User } from "../db/types.js";
import { HISTORY_ROWS_KEPT, PIN_REUSE_MESSAGE, lockUserRow, withUserLock, type Tx } from "./credentialHistory.js";
import { isPasswordRecentlyUsed } from "./password.js";

const SALT_ROUNDS = 12;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const PIN_RESET_TTL_MS = 60 * 60 * 1000; 
const PIN_RE = /^\d{6}$/;
const WEAK_PINS = new Set(["000000", "111111", "123456", "121212", "654321", "112233"]);

export class InvalidPinError extends Error {
  constructor(message = "Incorrect PIN.") {
    super(message);
  }
}
export class PinReuseError extends Error {
  constructor(message = PIN_REUSE_MESSAGE) {
    super(message);
  }
}
export class PinLockedError extends Error {
  constructor() {
    super("Too many incorrect attempts. Try again in a few minutes.");
  }
}
export function pinFormatError(pin: string): string | null {
  if (!PIN_RE.test(pin)) return "PIN must be exactly 6 digits.";
  if (WEAK_PINS.has(pin)) return "This PIN is too common. Choose another.";
  if (new Set(pin).size === 1) return "This PIN is too common. Choose another.";
  return null;
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export interface PinChangeHooks {
  verify?: (tx: Tx, user: User) => Promise<void>;
  after?: (tx: Tx) => Promise<void>;
}
export async function changePinWithHistory(userId: string, pin: string, hooks: PinChangeHooks = {}): Promise<void> {
  const newHash = await hashPin(pin); 
  await withUserLock(userId, () => withTransaction(async (tx) => {
    await lockUserRow(tx, userId);
    const user = await db.users.mustById(userId, { session: tx });
    await hooks.verify?.(tx, user);

    const history = await db.pinHistory.find(
      { userId },
      { sort: { createdAt: -1, _id: -1 }, limit: HISTORY_ROWS_KEPT, session: tx },
    );
    const recent = [...(user.pinHash ? [user.pinHash] : []), ...history.map((h) => h.pinHash)];
    if (await isPasswordRecentlyUsed(pin, recent)) throw new PinReuseError();

    await db.users.mustUpdate(
      { _id: userId },
      { pinHash: newHash, pinAttempts: 0, pinLockedUntil: null },
      { session: tx },
    );
    if (user.pinHash) await db.pinHistory.create({ userId, pinHash: user.pinHash }, { session: tx });
    const stale = await db.pinHistory.find(
      { userId },
      { sort: { createdAt: -1, _id: -1 }, skip: HISTORY_ROWS_KEPT, select: ["id"], session: tx },
    );
    if (stale.length) await db.pinHistory.deleteMany({ _id: { $in: stale.map((x) => x.id) } }, { session: tx });

    await hooks.after?.(tx);
  }));
}

export const setPin = (userId: string, pin: string) => changePinWithHistory(userId, pin);
export async function verifyPin(userId: string, candidate: string): Promise<void> {
  const user = await db.users.mustById(userId);

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    throw new PinLockedError();
  }
  if (!user.pinHash) throw new InvalidPinError();

  const ok = await bcrypt.compare(candidate, user.pinHash);
  if (!ok) {
    const attempts = user.pinAttempts + 1;
    const locked = attempts >= MAX_ATTEMPTS;
    await db.users.mustUpdate(
      { _id: userId },
      {
        pinAttempts: locked ? 0 : attempts,
        pinLockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    );
    throw locked ? new PinLockedError() : new InvalidPinError();
  }

  if (user.pinAttempts !== 0) {
    await db.users.mustUpdate({ _id: userId }, { pinAttempts: 0, pinLockedUntil: null });
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function createPinResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.pinResets.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + PIN_RESET_TTL_MS),
  });
  return token;
}

export async function resetPinWithToken(token: string, newPin: string): Promise<void> {
  const record = await db.pinResets.findOne({ tokenHash: hashToken(token) });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("This reset link is invalid or has expired.");
  }

  const formatErr = pinFormatError(newPin);
  if (formatErr) throw new InvalidPinError(formatErr);

  await changePinWithHistory(record.userId, newPin, {
    verify: async (tx) => {
      const fresh = await db.pinResets.byId(record.id, { session: tx });
      if (!fresh || fresh.usedAt || fresh.expiresAt < new Date()) {
        throw new Error("This reset link is invalid or has expired.");
      }
    },
    after: async (tx) => {
      await db.pinResets.mustUpdate({ _id: record.id }, { usedAt: new Date() }, { session: tx });
      await db.pinResets.updateMany(
        { userId: record.userId, usedAt: null, _id: { $ne: record.id } },
        { usedAt: new Date() },
        { session: tx },
      );
    },
  });
}