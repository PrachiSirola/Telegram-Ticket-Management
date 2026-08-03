import { Router } from "express";
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
import { InvalidOtpError, requestSignup, resendSignupOtp, verifySignup } from "../lib/signup.js";
import { MIN_PASSWORD_LENGTH } from "../lib/password.js";
import { passwordResetEmail, sendEmail, signupOtpEmail, welcomeEmail } from "../lib/email.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

// Throttle credential-guessing / spam on the sensitive endpoints. Keyed by IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

// OTP resend is throttled harder to avoid hammering the email provider.
const resendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Please wait a minute before requesting another code." },
});

const passwordField = z.string().min(MIN_PASSWORD_LENGTH, {
  message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
});

// ---------------------------------------------------------------------------
// Organisation signup (open, OTP-verified)
// ---------------------------------------------------------------------------

const signupSchema = z.object({
  orgName: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: passwordField,
});

authRouter.post("/signup", authLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  try {
    const { code } = await requestSignup(parsed.data);
    const mail = signupOtpEmail(parsed.data.name, code);
    await sendEmail({ ...mail, to: parsed.data.email.toLowerCase() });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof AccountExistsError) {
      return res.status(409).json({
        error: "An account with this email already exists. Sign in, then create an organisation from the org switcher.",
      });
    }
    throw err;
  }
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, { message: "Enter the 6-digit code." }),
});

authRouter.post("/signup/verify", authLimiter, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  try {
    const user = await verifySignup(parsed.data.email, parsed.data.code);
    setSessionCookie(res, user.id);
    // Send welcome email (fire-and-forget)
    const welcome = welcomeEmail(user.name, env.frontendUrl);
    sendEmail({ ...welcome, to: user.email });
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidOtpError) return res.status(400).json({ error: err.message });
    if (err instanceof AccountExistsError) return res.status(409).json({ error: err.message });
    throw err;
  }
});

authRouter.post("/signup/resend", resendLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  // Generic response either way — don't reveal which signups are in progress.
  if (parsed.success) {
    const result = await resendSignupOtp(parsed.data.email);
    if (result) {
      const pending = await prisma.pendingSignup.findUnique({
        where: { email: parsed.data.email.toLowerCase() },
      });
      const mail = signupOtpEmail(pending?.name ?? "there", result.code);
      await sendEmail({ ...mail, to: parsed.data.email.toLowerCase() });
    }
  }
  res.json({ ok: true });
});

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
    setSessionCookie(res, user.id);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) return res.status(401).json({ error: err.message });
    throw err;
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