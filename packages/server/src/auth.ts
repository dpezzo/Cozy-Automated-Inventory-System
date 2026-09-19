import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { getRepository, type UserRecord } from "./db";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    email?: string;
  }
}

export async function verifyCredentials(email: string, password: string): Promise<UserRecord | null> {
  const user = await getRepository().findUserByEmail(email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

/** Enforces authentication on the backend for every protected route, per plan section 2. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in to continue." });
    return;
  }
  next();
}
