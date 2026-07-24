import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import type { Invite, Prisma, User } from "@prisma/client";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { signSession } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";

// When the frontend and API are served from different origins (e.g. two
// Render services), the browser only sends the session cookie on cross-site
// XHR if it's SameSite=None; Secure. In local dev (same-site, http) we keep
// Lax so the cookie still works without HTTPS.
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

/** Wrong email/password or unknown user. Kept vague on purpose so login
 *  responses don't reveal which emails exist. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
  }
}

/** Registration attempted for an email that already has an account. */
export class AccountExistsError extends Error {
  constructor() {
    super("An account with this email already exists. Please sign in instead.");
  }
}

/** The invite token in a signup link is unknown, already used, or expired. */
export class InvalidInviteError extends Error {
  constructor() {
    super("This invite link is invalid or has expired. Ask your administrator for a new one.");
  }
}

/** The logged-in account's email doesn't match the invite's email. */
export class InviteEmailMismatchError extends Error {
  constructor(inviteEmail: string) {
    super(`This invite is for ${inviteEmail}. Log out and use that account.`);
  }
}

/** Email/password login. Throws InvalidCredentialsError for any failure mode. */
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

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

async function loadUsableInvite(token: string): Promise<Invite | null> {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "PENDING" || invite.expiresAt < new Date()) return null;
  return invite;
}

/** Public info about a signup invite link, or null if unusable. */
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
    orgName: org.name,
    projectNames: projects.map((p) => p.name),
    accountExists: Boolean(existing),
  };
}

/**
 * Turn an invite into an org membership (+ project attachments for clients)
 * and mark it accepted. projectIds are re-validated against the invite's org
 * so a stale/corrupt invite can never attach a client across org boundaries.
 */
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
  await tx.invite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });
}

/**
 * Invite-link registration for a NEW account. The email comes from the invite
 * token, never from user input. Existing emails must go through
 * acceptInviteForUser (sign in first) instead.
 */
export async function registerFromInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<User> {
  const invite = await loadUsableInvite(input.token);
  if (!invite) throw new InvalidInviteError();
  const email = invite.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new AccountExistsError();

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

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a password-reset token for `email` if an account exists, and return
 * the raw token (to embed in the emailed link). Returns null when no account
 * exists — callers should respond identically either way so the endpoint
 * never reveals which emails are registered.
 */
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

/**
 * Consume a reset token and set a new password. Throws on an invalid, expired,
 * or already-used token. Invalidates all of the user's other reset tokens.
 */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<User> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("This reset link is invalid or has expired.");
  }
  const passwordHash = await hashPassword(newPassword);
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Burn any other outstanding tokens for this user.
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);
  return user;
}
