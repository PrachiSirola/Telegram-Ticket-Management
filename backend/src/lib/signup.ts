import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hashPassword } from "./password.js";
import { AccountExistsError } from "./login.js";

const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
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
  const existing = await prisma.user.findUnique({ where: { email } });
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
  await prisma.pendingSignup.upsert({ where: { email }, update: data, create: { email, ...data } });
  return { code };
}
export async function resendSignupOtp(email: string): Promise<{ code: string } | null> {
  const pending = await prisma.pendingSignup.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!pending) return null;
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.pendingSignup.update({
    where: { id: pending.id },
    data: { codeHash: hashCode(code), attempts: 0, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  return { code };
}
export async function verifySignup(emailRaw: string, code: string): Promise<User> {
  const email = emailRaw.toLowerCase();
  const pending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (!pending || pending.expiresAt < new Date() || pending.attempts >= MAX_ATTEMPTS) {
    throw new InvalidOtpError();
  }
  if (!codesMatch(code, pending.codeHash)) {
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
    });
    throw new InvalidOtpError();
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name: pending.name, passwordHash: pending.passwordHash },
      });
      const org = await tx.organization.create({ data: { name: pending.orgName } });
      await tx.orgMembership.create({
        data: { userId: user.id, orgId: org.id, role: "SUPER_ADMIN" },
      });
      await tx.pendingSignup.delete({ where: { id: pending.id } });
      return user;
    });
  } catch (err: any) {
    if (err?.code === "P2002") throw new AccountExistsError();
    throw err;
  }
}
