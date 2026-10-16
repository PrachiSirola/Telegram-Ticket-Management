import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";
import { db } from "../db/index.js";
import { verifySession } from "../lib/jwt.js";
import type { AuthUser } from "../lib/access.js";

declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      user?: User;
    }
  }
}
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[env.sessionCookieName];
  if (token) {
    const payload = verifySession(token);
    if (payload) {
      const user = await db.users.byId(payload.userId);
      if (user) {
        const memberships = await db.memberships.find({ userId: user.id, disabled: false });
        req.user = { ...user, memberships };
      }
    }
  }
  next();
}
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}
