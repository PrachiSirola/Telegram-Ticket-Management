import { Router } from "express";
import type { Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import {
  AccountExistsError,
  acceptInviteForUser,
  clearSessionCookie,
  createPasswordResetToken,
  getInviteByToken,
  InvalidCredentialsError,
  InvalidInviteError,
  InviteEmailMismatchError,
  loginWithPassword,
  registerFromInvite,
  resetPasswordWithToken,
  setSessionCookie,
} from "../lib/login.js";
import { isPlatformSuperAdmin } from "../lib/access.js";
import { passwordStrengthError, PasswordPolicyError } from "../lib/password.js";
import { passwordResetEmail, sendEmail, pinResetEmail } from "../lib/email.js";
import { requireAuth } from "../middleware/auth.js";
import { signTwoFactorChallenge, verifyTwoFactorChallenge } from "../lib/jwt.js";
import { verifyPin, InvalidPinError, PinLockedError, createPinResetToken, resetPinWithToken} from "../lib/twoFactor.js";


export const authRouter = Router();

// Throttle credential-guessing / spam on the sensitive endpoints. Keyed by IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

const passwordField = z.string().superRefine((password, ctx) => {
  const err = passwordStrengthError(password);
  if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
});

// ---------------------------------------------------------------------------
// Two-factor pending cookie helpers (mirrors setSessionCookie/clearSessionCookie
// in lib/login.ts, just shorter-lived and on a separate cookie name so a
// half-completed login never doubles as a real session).
// ---------------------------------------------------------------------------

function setTwoFactorPendingCookie(res: Response, userId: string) {
  res.cookie(env.twoFactorCookieName, signTwoFactorChallenge(userId), {
    httpOnly: true,
    sameSite: env.isProd ? "none" : "lax",
    secure: env.isProd,
    maxAge: 5 * 60 * 1000,
  });
}

function clearTwoFactorPendingCookie(res: Response) {
  res.clearCookie(env.twoFactorCookieName, {
    httpOnly: true,
    sameSite: env.isProd ? "none" : "lax",
    secure: env.isProd,
  });
}

// ---------------------------------------------------------------------------
// Login / logout / session
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required." });
  try {
    const user = await loginWithPassword(parsed.data);

    // Password checked out. If PIN-based 2FA is on, don't log them in yet —
    // issue a short-lived pending cookie and make the frontend collect the PIN.
    if (user.twoFactorEnabled && user.twoFactorMethod === "PIN") {
      setTwoFactorPendingCookie(res, user.id);
      return res.json({ ok: true, requires2fa: true, method: "PIN" });
    }

    setSessionCookie(res, user.id);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) return res.status(401).json({ error: err.message });
    throw err;
  }
});

// Second step of PIN-based 2FA. Reads the pending cookie set by /login above,
// verifies the PIN against that specific user, then (on success) upgrades to
// a real session cookie exactly like a normal login would.
const twoFactorVerifySchema = z.object({ pin: z.string().min(1) });

authRouter.post("/2fa/verify", authLimiter, async (req, res) => {
  const parsed = twoFactorVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A PIN is required." });

  const token = req.cookies?.[env.twoFactorCookieName];
  const payload = token ? verifyTwoFactorChallenge(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }

  try {
    await verifyPin(payload.userId, parsed.data.pin);
    clearTwoFactorPendingCookie(res);
    setSessionCookie(res, payload.userId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof PinLockedError) return res.status(429).json({ error: err.message });
    if (err instanceof InvalidPinError) return res.status(401).json({ error: "Incorrect PIN." });
    throw err;
  }
});

// Requires the pending-2FA cookie set by /login — i.e. only reachable mid-
// login, right after the password check has already succeeded. This is what
// stops a bare "reset my PIN" request from being usable by someone who
// doesn't actually know the password.
authRouter.post("/2fa/forgot-pin", authLimiter, async (req, res) => {
  const token = req.cookies?.[env.twoFactorCookieName];
  const payload = token ? verifyTwoFactorChallenge(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.userId } });
  const resetToken = await createPinResetToken(user.id);
  const resetUrl = `${env.frontendUrl}/reset-pin?token=${resetToken}`;
  const mail = pinResetEmail(user.name, resetUrl);
  await sendEmail({ ...mail, to: user.email });

  res.json({ ok: true });
});

const resetPinSchema = z.object({
  token: z.string().min(1),
  pin: z.string().min(1),
  confirmPin: z.string().min(1),
});

authRouter.post("/2fa/reset-pin", authLimiter, async (req, res) => {
  const parsed = resetPinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  if (parsed.data.pin !== parsed.data.confirmPin) {
    return res.status(400).json({ error: "PINs don't match." });
  }
  try {
    await resetPinWithToken(parsed.data.token, parsed.data.pin);
    // Not logging them in here — same reasoning as password reset: show a
    // success message, let them return to login and enter the new PIN.
    res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const u = req.user!;
  const orgs = await prisma.organization.findMany({
    where: { id: { in: u.memberships.map((m) => m.orgId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    isPlatformSuperAdmin: isPlatformSuperAdmin(u),
    twoFactorEnabled: u.twoFactorEnabled,
    twoFactorMethod: u.twoFactorMethod,
    memberships: u.memberships.map((m) => ({
      orgId: m.orgId,
      orgName: nameById.get(m.orgId) ?? "",
      role: m.role,
    })),
  });
});

// Tells the frontend which optional auth features are available.
authRouter.get("/config", (_req, res) => {
  res.json({ passwordReset: env.email.enabled });
});

// ---------------------------------------------------------------------------
// Invites (member onboarding is invite-link-only)
// ---------------------------------------------------------------------------

// Validate a signup invite link. The account-creation form uses this to
// pre-fill the (locked) email and pick the right flow for existing accounts.
authRouter.get("/invite/:token", async (req, res) => {
  const invite = await getInviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: "This invite link is invalid or has expired." });
  res.json(invite);
});

// New-account registration via invite link. The email comes from the token.
const registerSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(100),
  password: passwordField,
});

authRouter.post("/register", authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  try {
    const user = await registerFromInvite(parsed.data);
    setSessionCookie(res, user.id);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidInviteError) return res.status(400).json({ error: err.message });
    if (err instanceof AccountExistsError) return res.status(409).json({ error: err.message });
    if (err instanceof PasswordPolicyError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// Existing account accepts an invite (must be signed in as the invited email).
authRouter.post("/invite/:token/accept", requireAuth, async (req, res) => {
  try {
    await acceptInviteForUser(req.user!, req.params.token);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidInviteError) return res.status(400).json({ error: err.message });
    if (err instanceof InviteEmailMismatchError) {
      return res.status(403).json({ error: err.message });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const forgotSchema = z.object({ email: z.string().email() });

authRouter.post("/forgot-password", authLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  // Always respond the same way — never reveal whether the email is registered.
  const generic = { ok: true };
  if (!parsed.success) return res.json(generic);

  const result = await createPasswordResetToken(parsed.data.email);
  if (result) {
    const resetUrl = `${env.frontendUrl}/reset-password?token=${result.token}`;
    const mail = passwordResetEmail(result.user.name, resetUrl);
    await sendEmail({ ...mail, to: result.user.email });
  }
  res.json(generic);
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: passwordField,
});

authRouter.post("/reset-password", authLimiter, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  try {
    await resetPasswordWithToken(parsed.data.token, parsed.data.password);
    // Deliberately not calling setSessionCookie here — after a reset,
    // the user should see a success message and sign in fresh, not be
    // silently logged into a new session.
    res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});