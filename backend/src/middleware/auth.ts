import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { verifySession } from "../lib/jwt.js";
import type { AuthUser } from "../lib/access.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      user?: User;
    }
  }
}

/**
 * Loads the current user from the session cookie (if any). Never rejects.
 * Only ACTIVE (non-disabled) org memberships are loaded — a disabled
 * membership makes that org invisible to the user, while the account keeps
 * working in their other orgs.
 */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[env.sessionCookieName];
  if (token) {
    const payload = verifySession(token);
    if (payload) {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { memberships: { where: { disabled: false } } },
      });
      if (user) req.user = user;
    }
  }
  next();
}

/** Rejects unauthenticated requests. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}
