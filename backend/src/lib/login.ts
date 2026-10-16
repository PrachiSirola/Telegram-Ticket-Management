import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { db, isDuplicateKey, withTransaction, type ClientSession } from "../db/index.js";
import type { Invite, User } from "../db/types.js";
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
  const user = await db.users.findOne({ email });
  if (!user) throw new InvalidCredentialsError();
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw new InvalidCredentialsError();
  return user;
}

async function loadUsableInvite(token: string): Promise<Invite | null> {
  const invite = await db.invites.findOne({ token });
  if (!invite || invite.status !== "PENDING" || invite.expiresAt < new Date()) return null;
  return invite;
}
export async function getInviteByToken(token: string) {
  const invite = await loadUsableInvite(token);
  if (!invite) return null;
  const [org, projects, existing] = await Promise.all([
    db.orgs.mustById(invite.orgId),
    invite.projectIds.length
      ? db.projects.find({ _id: { $in: invite.projectIds }, orgId: invite.orgId })
      : Promise.resolve([]),
    db.users.findOne({ email: invite.email.toLowerCase() }),
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
async function consumeInvite(session: ClientSession | undefined, invite: Invite, userId: string) {
  const membership = await db.memberships.upsert(
    { userId, orgId: invite.orgId },
    { role: invite.role, disabled: false },
    { userId, orgId: invite.orgId },
    { session },
  );
  const link =
    invite.role === "CLIENT" ? db.projectClients : invite.role === "DEVELOPER" ? db.projectDevelopers : null;
  if (link && invite.projectIds.length) {
    const projects = await db.projects.find(
      { _id: { $in: invite.projectIds }, orgId: invite.orgId },
      { select: ["id"], session },
    );
    for (const p of projects) {
      await link.upsert(
        { projectId: p.id, membershipId: membership.id },
        {},
        { projectId: p.id, membershipId: membership.id },
        { session },
      );
    }
  }
  await db.invites.mustUpdate({ _id: invite.id }, { status: "ACCEPTED" }, { session });
}
export async function registerFromInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<User> {
  const invite = await loadUsableInvite(input.token);
  if (!invite) throw new InvalidInviteError();
    const email = invite.email.toLowerCase();
  if (await db.users.findOne({ email })) throw new AccountExistsError();

  const identityErr = passwordContainsIdentityError(input.password, email, input.name);
  if (identityErr) throw new PasswordPolicyError(identityErr);

  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (tx) => {
      const user = await db.users.create({ email, name: input.name.trim() || email, passwordHash }, { session: tx });
      await consumeInvite(tx, invite, user.id);
      return user;
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new AccountExistsError();
    throw err;
  }
}
export async function acceptInviteForUser(user: User, token: string): Promise<void> {
  const invite = await loadUsableInvite(token);
  if (!invite) throw new InvalidInviteError();
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new InviteEmailMismatchError(invite.email);
  }
  await withTransaction((tx) => consumeInvite(tx, invite, user.id));
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function createPasswordResetToken(
  email: string,
): Promise<{ token: string; user: User } | null> {
  const user = await db.users.findOne({ email: email.toLowerCase() });
  if (!user) return null;

  const token = randomBytes(32).toString("hex");
  await db.passwordResets.create({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  return { token, user };
}
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<User> {
  const record = await db.passwordResets.findOne({ tokenHash: hashToken(token) });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("This reset link is invalid or has expired.");
  }

  const existingUser = await db.users.mustById(record.userId);

  const identityErr = passwordContainsIdentityError(newPassword, existingUser.email, existingUser.name);
  if (identityErr) throw new PasswordPolicyError(identityErr);
  return changePasswordWithHistory(existingUser.id, newPassword, {
    verify: async (tx) => {
      const fresh = await db.passwordResets.byId(record.id, { session: tx });
      if (!fresh || fresh.usedAt || fresh.expiresAt < new Date()) {
        throw new Error("This reset link is invalid or has expired.");
      }
    },
    after: async (tx) => {
      await db.passwordResets.mustUpdate({ _id: record.id }, { usedAt: new Date() }, { session: tx });
      await db.passwordResets.updateMany(
        { userId: record.userId, usedAt: null, _id: { $ne: record.id } },
        { usedAt: new Date() },
        { session: tx },
      );
    },
  });
}