import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";

const SALT_ROUNDS = 12;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const PIN_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour, same as password reset
const PIN_RE = /^\d{6}$/;
const WEAK_PINS = new Set(["000000", "111111", "123456", "121212", "654321", "112233"]);

export class InvalidPinError extends Error {
  constructor(message = "Incorrect PIN.") {
    super(message);
  }
}
export class PinLockedError extends Error {
  constructor() {
    super("Too many incorrect attempts. Try again in a few minutes.");
  }
}

/** Returns a user-facing error message if the PIN is unusable, else null. */
export function pinFormatError(pin: string): string | null {
  if (!PIN_RE.test(pin)) return "PIN must be exactly 6 digits.";
  if (WEAK_PINS.has(pin)) return "This PIN is too common. Choose another.";
  if (new Set(pin).size === 1) return "This PIN is too common. Choose another.";
  return null;
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

/** Sets/replaces the user's PIN. Does not touch twoFactorEnabled/twoFactorMethod. */
export async function setPin(userId: string, pin: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash: await hashPin(pin), pinAttempts: 0, pinLockedUntil: null },
  });
}

/**
 * Verifies a PIN during login's second factor. Throws PinLockedError while
 * locked out, InvalidPinError on a wrong PIN (and records the attempt).
 */
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

// ---------------------------------------------------------------------------
// Forgot PIN — same shape as password reset (lib/login.ts), just its own
// token table so a PIN reset link can never be replayed as a password reset
// link or vice versa.
// ---------------------------------------------------------------------------

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a PIN-reset token for `userId`. Callers MUST have already verified
 * the password for this exact user (i.e. only call this from the 2FA-pending
 * step of login) — this function itself does no re-authentication.
 */
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

/** Consumes a PIN-reset token and sets a new PIN. Throws on invalid/expired/used token. */
export async function resetPinWithToken(token: string, newPin: string): Promise<void> {
  const record = await prisma.pinResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("This reset link is invalid or has expired.");
  }

  const formatErr = pinFormatError(newPin);
  if (formatErr) throw new InvalidPinError(formatErr);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { pinHash: await hashPin(newPin), pinAttempts: 0, pinLockedUntil: null },
    }),
    prisma.pinResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.pinResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);
}