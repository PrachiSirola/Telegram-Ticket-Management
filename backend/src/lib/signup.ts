import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db, isDuplicateKey, withTransaction } from "../db/index.js";
import type { User } from "../db/types.js";
import { hashPassword } from "./password.js";
import { AccountExistsError } from "./login.js";

const OTP_TTL_MS = 15 * 60 * 1000; 
const MAX_ATTEMPTS = 5;

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function codesMatch(code: string, codeHash: string) {
  const a = Buffer.from(hashCode(code));
  const b = Buffer.from(codeHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class InvalidOtpError extends Error {
  constructor() {
    super("Invalid or expired code. Please try again or request a new one.");
  }
}
export async function requestSignup(input: {
  orgName: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ code: string }> {
  const email = input.email.toLowerCase();
  const existing = await db.users.findOne({ email });
  if (existing) throw new AccountExistsError();

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const data = {
    orgName: input.orgName.trim(),
    name: input.name.trim(),
    passwordHash: await hashPassword(input.password),
    codeHash: hashCode(code),
    attempts: 0,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  };
  await db.pendingSignups.upsert({ email }, data, { email });
  return { code };
}
export async function resendSignupOtp(email: string): Promise<{ code: string } | null> {
  const pending = await db.pendingSignups.findOne({ email: email.toLowerCase() });
  if (!pending) return null;
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.pendingSignups.mustUpdate(
    { _id: pending.id },
    { codeHash: hashCode(code), attempts: 0, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  );
  return { code };
}
export async function verifySignup(emailRaw: string, code: string): Promise<User> {
  const email = emailRaw.toLowerCase();
  const pending = await db.pendingSignups.findOne({ email });
  if (!pending || pending.expiresAt < new Date() || pending.attempts >= MAX_ATTEMPTS) {
    throw new InvalidOtpError();
  }
  if (!codesMatch(code, pending.codeHash)) {
    await db.pendingSignups.mustUpdate({ _id: pending.id }, { $inc: { attempts: 1 } });
    throw new InvalidOtpError();
  }

  try {
    return await withTransaction(async (tx) => {
      const user = await db.users.create({ email, name: pending.name, passwordHash: pending.passwordHash }, { session: tx });
      const org = await db.orgs.create({ name: pending.orgName }, { session: tx });
      await db.memberships.create({ userId: user.id, orgId: org.id, role: "SUPER_ADMIN" }, { session: tx });
      await db.pendingSignups.deleteOne({ _id: pending.id }, { session: tx });
      return user;
    });
  } catch (err: any) {
    if (isDuplicateKey(err)) throw new AccountExistsError();
    throw err;
  }
}
