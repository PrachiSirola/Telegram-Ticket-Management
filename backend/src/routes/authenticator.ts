import { Router, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyPassword } from "../lib/password.js";
import {
  AuthenticatorStateError,
  AuthenticatorUnavailableError,
  InvalidCodeError,
  authenticatorStatus,
  beginEnrollment,
  confirmEnrollment,
  disableAuthenticator,
} from "../lib/authenticator.js";

export const authenticatorRouter = Router();

authenticatorRouter.use(requireAuth);
authenticatorRouter.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?.id ?? ipKeyGenerator(req.ip ?? "")}`,
    message: { error: "Too many attempts. Please try again later." },
  }),
);

const passwordSchema = z.object({ currentPassword: z.string().min(1) });
const codeSchema = z.object({ code: z.string().min(1).max(20) });

async function passwordOk(userId: string, password: string): Promise<boolean> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  return verifyPassword(password, u.passwordHash);
}
function fail(res: Response, err: unknown) {
  if (err instanceof AuthenticatorUnavailableError) return res.status(503).json({ error: err.message });
  if (err instanceof InvalidCodeError) return res.status(400).json({ error: err.message });
  if (err instanceof AuthenticatorStateError) return res.status(409).json({ error: err.message });
  throw err;
}

authenticatorRouter.get("/", async (req, res) => {
  res.json(await authenticatorStatus(req.user!.id));
});

authenticatorRouter.post("/setup", async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your current password." });
  if (!(await passwordOk(req.user!.id, parsed.data.currentPassword))) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  try {
    res.json(await beginEnrollment(req.user!.id));
  } catch (err) {
    return fail(res, err);
  }
});

authenticatorRouter.post("/enable", async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the 6-digit code from your app." });
  try {
    await confirmEnrollment(req.user!.id, parsed.data.code);
    res.json({ ok: true });
  } catch (err) {
    return fail(res, err);
  }
});

authenticatorRouter.post("/disable", async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your current password." });
  if (!(await passwordOk(req.user!.id, parsed.data.currentPassword))) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  await disableAuthenticator(req.user!.id);
  res.json({ ok: true });
});
