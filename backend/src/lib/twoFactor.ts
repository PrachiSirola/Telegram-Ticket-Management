import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { HISTORY_ROWS_KEPT, HISTORY_TX_OPTIONS, PIN_REUSE_MESSAGE, lockUserRow, type Tx } from "./credentialHistory.js";
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
  await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await hooks.verify?.(tx, user);

    const history = await tx.pinHistory.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_ROWS_KEPT,
      select: { pinHash: true },
    });
    const recent = [...(user.pinHash ? [user.pinHash] : []), ...history.map((h) => h.pinHash)];
    if (await isPasswordRecentlyUsed(pin, recent)) throw new PinReuseError();

    await tx.user.update({ where: { id: userId }, data: { pinHash: newHash, pinAttempts: 0, pinLockedUntil: null } });
    if (user.pinHash) await tx.pinHistory.create({ data: { userId, pinHash: user.pinHash } });
    const stale = await tx.pinHistory.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: HISTORY_ROWS_KEPT,
      select: { id: true },
    });
    if (stale.length) await tx.pinHistory.deleteMany({ where: { id: { in: stale.map((x) => x.id) } } });

    await hooks.after?.(tx);
  }, HISTORY_TX_OPTIONS);
}

export const setPin = (userId: string, pin: string) => changePinWithHistory(userId, pin);
export async function verifyPin(userId: string, candidate: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    throw new PinLockedError();
  }
  if (!user.pinHash) throw new InvalidPinError();

  const ok = await bcrypt.compare(candidate, user.pinHash);
  if (!ok) {
    const attempts = user.pinAttempts + 1;
    const locked = attempts >= MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: userId },
      data: {
        pinAttempts: locked ? 0 : attempts,
        pinLockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
    throw locked ? new PinLockedError() : new InvalidPinError();
  }

  if (user.pinAttempts !== 0) {
    await prisma.user.update({ where: { id: userId }, data: { pinAttempts: 0, pinLockedUntil: null } });
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function createPinResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.pinResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PIN_RESET_TTL_MS),
    },
  });
  return token;
}

export async function resetPinWithToken(token: string, newPin: string): Promise<void> {
  const record = await prisma.pinResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("This reset link is invalid or has expired.");
  }

  const formatErr = pinFormatError(newPin);
  if (formatErr) throw new InvalidPinError(formatErr);

  await changePinWithHistory(record.userId, newPin, {
    verify: async (tx) => {
      const fresh = await tx.pinResetToken.findUnique({ where: { id: record.id } });
      if (!fresh || fresh.usedAt || fresh.expiresAt < new Date()) {
        throw new Error("This reset link is invalid or has expired.");
      }
    },
    after: async (tx) => {
      await tx.pinResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.pinResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      });
    },
  });
}