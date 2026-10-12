import jwt from "jsonwebtoken";
import { env } from "../env.js";

export interface SessionPayload {
  userId: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "30d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionPayload;
  } catch {
    return null;
  }
}
export interface TwoFactorChallengePayload {
  userId: string;
  purpose: "2fa-pending";
}

export function signTwoFactorChallenge(userId: string): string {
  return jwt.sign(
    { userId, purpose: "2fa-pending" } satisfies TwoFactorChallengePayload,
    env.jwtSecret,
    { expiresIn: "5m" },
  );
}

export function verifyTwoFactorChallenge(token: string): TwoFactorChallengePayload | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TwoFactorChallengePayload;
    return payload.purpose === "2fa-pending" ? payload : null;
  } catch {
    return null;
  }
}