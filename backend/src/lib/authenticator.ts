import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma.js";
import { env } from "../env.js";

const ISSUER = "Ticket Management";
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; 
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const PENDING_TTL_MS = 15 * 60 * 1000;

type AuthenticatorUser = {
  id: string;
  email: string;
  pinHash: string | null;
  totpEnabledAt: Date | null;
  totpPendingSecretEnc: string | null;
  totpPendingAt: Date | null;
  totpSecretEnc: string | null;
  totpLastStep: number | null;
  totpAttempts: number;
  totpLockedUntil: Date | null;
  twoFactorEnabled: boolean;
};

export class AuthenticatorUnavailableError extends Error {
  constructor() {
    super("Authenticator 2FA isn't available on this server yet. Please contact your administrator.");
  }
}
export class InvalidCodeError extends Error {
  constructor(message = "That code is incorrect.") {
    super(message);
  }
}
export class CodeLockedError extends Error {
  constructor() {
    super("Too many incorrect attempts. Try again in a few minutes.");
  }
}
export class AuthenticatorStateError extends Error {}

function masterKey(): Buffer {
  if (!env.totpEncryptionKey) throw new AuthenticatorUnavailableError();
  return createHash("sha256").update(env.totpEncryptionKey).digest();
}
export const authenticatorConfigured = () => Boolean(env.totpEncryptionKey);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable authenticator secret");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of str.replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20)); // 160 bits, as RFC 4226 recommends
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function matchTotp(secretBase32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = currentStep(now) + d;
    const ok = timingSafeEqual(given, Buffer.from(totpAt(secretBase32, step)));
    if (ok && (lastStep === null || step > lastStep)) matched = step;
  }
  return matched;
}

export function otpauthUrl(email: string, secretBase32: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
export async function authenticatorStatus(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpEnabledAt: true, pinHash: true, twoFactorEnabled: true },
  });
  return {
    configured: authenticatorConfigured(),
    enabled: Boolean(u.totpEnabledAt),
    enabledAt: u.totpEnabledAt,
    hasPin: Boolean(u.pinHash),
    passkeyLoginOn: u.twoFactorEnabled,
  };
}

export async function beginEnrollment(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!u.pinHash) throw new AuthenticatorStateError("Register a passkey first — the authenticator is a backup for it.");
  if (u.totpEnabledAt) throw new AuthenticatorStateError("An authenticator is already set up. Disable it first to set up a new one.");
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpPendingSecretEnc: encryptSecret(secret), totpPendingAt: new Date() },
  });
  return { secret, otpauthUrl: otpauthUrl(u.email, secret) };
}

export async function confirmEnrollment(userId: string, code: string): Promise<void> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.totpEnabledAt) throw new AuthenticatorStateError("An authenticator is already set up.");
  if (!u.totpPendingSecretEnc || !u.totpPendingAt || Date.now() - u.totpPendingAt.getTime() > PENDING_TTL_MS) {
    throw new AuthenticatorStateError("This setup expired. Start again to get a new QR code.");
  }
  const secret = decryptSecret(u.totpPendingSecretEnc);
  const step = matchTotp(secret, code.trim(), null);
  if (step === null) throw new InvalidCodeError("That code didn't match. Check your authenticator app and try again.");
  await prisma.user.update({
      where: { id: userId },
      data: {
        totpSecretEnc: u.totpPendingSecretEnc,
        totpEnabledAt: new Date(),
        totpPendingSecretEnc: null,
        totpPendingAt: null,
        totpLastStep: step,
        totpAttempts: 0,
        totpLockedUntil: null,
      },
  });
}

export async function disableAuthenticator(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpSecretEnc: null, totpEnabledAt: null, totpPendingSecretEnc: null, totpPendingAt: null,
        totpLastStep: null, totpAttempts: 0, totpLockedUntil: null,
      },
    });
  });
}

async function failAttempt(userId: string, attempts: number): Promise<never> {
  const next = attempts + 1;
  const locked = next >= MAX_ATTEMPTS;
  await prisma.user.update({
    where: { id: userId },
    data: { totpAttempts: locked ? 0 : next, totpLockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null },
  });
  throw locked ? new CodeLockedError() : new InvalidCodeError();
}
async function loadForVerify(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.totpLockedUntil && u.totpLockedUntil > new Date()) throw new CodeLockedError();
  return u;
}
async function succeed(userId: string, attempts: number) {
  if (attempts !== 0) await prisma.user.update({ where: { id: userId }, data: { totpAttempts: 0, totpLockedUntil: null } });
}

export async function verifyAuthenticatorCode(userId: string, code: string): Promise<void> {
  const u = await loadForVerify(userId);
  if (!u.totpEnabledAt || !u.totpSecretEnc) return failAttempt(userId, u.totpAttempts); // not enrolled: same answer as a wrong code
  const step = matchTotp(decryptSecret(u.totpSecretEnc), code.trim(), u.totpLastStep);
  if (step === null) return failAttempt(userId, u.totpAttempts);
  const claimed = await prisma.user.updateMany({
    where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  if (claimed.count !== 1) return failAttempt(userId, u.totpAttempts);
  await succeed(userId, u.totpAttempts);
}
