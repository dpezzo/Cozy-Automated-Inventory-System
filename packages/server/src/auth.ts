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

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface LoginAttemptState {
  failedCount: number;
  lockedUntil: number | null;
}

/**
 * In-memory per-email failed-login tracker. Resets on server restart, which
 * is acceptable for this single-operator, locally-run app -- the goal is
 * blunting scripted password-guessing, not surviving a process restart.
 */
const loginAttempts = new Map<string, LoginAttemptState>();

function attemptKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns remaining lockout milliseconds if this email is currently locked out, else null. */
export function getLoginLockoutRemainingMs(email: string): number | null {
  const state = loginAttempts.get(attemptKey(email));
  if (!state?.lockedUntil) return null;
  const remaining = state.lockedUntil - Date.now();
  if (remaining <= 0) {
    loginAttempts.delete(attemptKey(email));
    return null;
  }
  return remaining;
}

export function recordFailedLogin(email: string): void {
  const key = attemptKey(email);
  const state = loginAttempts.get(key) ?? { failedCount: 0, lockedUntil: null };
  state.failedCount += 1;
  if (state.failedCount >= MAX_FAILED_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCKOUT_MS;
    state.failedCount = 0;
  }
  loginAttempts.set(key, state);
}

export function clearLoginAttempts(email: string): void {
  loginAttempts.delete(attemptKey(email));
}

/** Enforces authentication on the backend for every protected route, per plan section 2. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in to continue." });
    return;
  }
  next();
}
