import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import type { Invite, Prisma, User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { signSession } from "./jwt.js";
import { hashPassword, verifyPassword, passwordContainsIdentityError, PasswordPolicyError } from "./password.js";
import { changePasswordWithHistory } from "./credentialHistory.js";
const cookieOptions = {
  httpOnly: true as const,
  sameSite: (env.isProd ? "none" : "lax") as "none" | "lax",
  secure: env.isProd,
};

export function setSessionCookie(res: Response, userId: string) {
  res.cookie(env.sessionCookieName, signSession({ userId }), {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(env.sessionCookieName, cookieOptions);
}
export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
  }
}
export class AccountExistsError extends Error {
  constructor() {
    super("An account with this email already exists. Please sign in instead.");
  }
}
export class InvalidInviteError extends Error {
  constructor() {
    super("This invite link is invalid or has expired. Ask your administrator for a new one.");
  }
}
export class InviteEmailMismatchError extends Error {
  constructor(inviteEmail: string) {
    super(`This invite is for ${inviteEmail}. Log out and use that account.`);
  }
}
export async function loginWithPassword(input: {
  email: string;
  password: string;
}): Promise<User> {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new InvalidCredentialsError();
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw new InvalidCredentialsError();
  return user;
}

async function loadUsableInvite(token: string): Promise<Invite | null> {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "PENDING" || invite.expiresAt < new Date()) return null;
  return invite;
}
export async function getInviteByToken(token: string) {
  const invite = await loadUsableInvite(token);
  if (!invite) return null;
  const [org, projects, existing] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: invite.orgId } }),
    invite.projectIds.length
      ? prisma.project.findMany({
          where: { id: { in: invite.projectIds }, orgId: invite.orgId },
          select: { name: true },
        })
      : Promise.resolve([]),
    prisma.user.findUnique({ where: { email: invite.email } }),
  ]);
  return {
    email: invite.email,
    role: invite.role,
    orgId: org.id,
    orgName: org.name,
    projectNames: projects.map((p) => p.name),
    accountExists: Boolean(existing),
  };
}
async function consumeInvite(tx: Prisma.TransactionClient, invite: Invite, userId: string) {
  const membership = await tx.orgMembership.upsert({
    where: { userId_orgId: { userId, orgId: invite.orgId } },
    update: { role: invite.role, disabled: false },
    create: { userId, orgId: invite.orgId, role: invite.role },
  });
  if (invite.role === "CLIENT" && invite.projectIds.length) {
    const projects = await tx.project.findMany({
      where: { id: { in: invite.projectIds }, orgId: invite.orgId },
      select: { id: true },
    });
    for (const p of projects) {
      await tx.projectClient.upsert({
        where: { projectId_membershipId: { projectId: p.id, membershipId: membership.id } },
        update: {},
        create: { projectId: p.id, membershipId: membership.id },
      });
    }
  }
  if (invite.role === "DEVELOPER" && invite.projectIds.length) {
    const projects = await tx.project.findMany({
      where: { id: { in: invite.projectIds }, orgId: invite.orgId },
      select: { id: true },
    });
    for (const p of projects) {
      await tx.projectDeveloper.upsert({
        where: { projectId_membershipId: { projectId: p.id, membershipId: membership.id } },
        update: {},
        create: { projectId: p.id, membershipId: membership.id },
      });
    }
  }
  await tx.invite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });
}
export async function registerFromInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<User> {
  const invite = await loadUsableInvite(input.token);
  if (!invite) throw new InvalidInviteError();
    const email = invite.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new AccountExistsError();

  const identityErr = passwordContainsIdentityError(input.password, email, input.name);
  if (identityErr) throw new PasswordPolicyError(identityErr);

  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name: input.name.trim() || email, passwordHash },
    });
    await consumeInvite(tx, invite, user.id);
    return user;
  });
}

/** A logged-in user accepts an invite addressed to their own email. */
export async function acceptInviteForUser(user: User, token: string): Promise<void> {
  const invite = await loadUsableInvite(token);
  if (!invite) throw new InvalidInviteError();
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new InviteEmailMismatchError(invite.email);
  }
  await prisma.$transaction((tx) => consumeInvite(tx, invite, user.id));
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function createPasswordResetToken(
  email: string,
): Promise<{ token: string; user: User } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;

  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });
  return { token, user };
}
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<User> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("This reset link is invalid or has expired.");
  }

  const existingUser = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });

  const identityErr = passwordContainsIdentityError(newPassword, existingUser.email, existingUser.name);
  if (identityErr) throw new PasswordPolicyError(identityErr);
  return changePasswordWithHistory(existingUser.id, newPassword, {
    verify: async (tx) => {
      const fresh = await tx.passwordResetToken.findUnique({ where: { id: record.id } });
      if (!fresh || fresh.usedAt || fresh.expiresAt < new Date()) {
        throw new Error("This reset link is invalid or has expired.");
      }
    },
    after: async (tx) => {
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      });
    },
  });
}