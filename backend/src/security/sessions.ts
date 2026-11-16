import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";

const COOKIE_NAME = "foodbank_session";
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Account {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "student" | "staff";
}

export type AccountRequest = Request & { account?: Account };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionToken(req: Request): string | null {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return null;
  const entry = rawCookie.split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(COOKIE_NAME + "="));
  const token = entry?.slice(COOKIE_NAME.length + 1) ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function startSession(res: Response, profileId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO auth_sessions (profile_id, token_hash, expires_at) " +
    "VALUES ($1, $2, NOW() + INTERVAL '7 days')",
    [profileId, hashToken(token)]
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_AGE_MS
  });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = sessionToken(req);
  if (token) {
    await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
  }
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = sessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Please sign in" });
    return;
  }
  try {
    const result = await pool.query<Account>(
      "SELECT p.id, p.email, p.first_name, p.last_name, p.role " +
      "FROM auth_sessions AS s " +
      "JOIN profiles AS p ON p.id = s.profile_id " +
      "WHERE s.token_hash = $1 AND s.expires_at > NOW()",
      [hashToken(token)]
    );
    if (!result.rows[0]) {
      res.status(401).json({ error: "Your session has expired. Please sign in again" });
      return;
    }
    (req as AccountRequest).account = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(role: Account["role"]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if ((req as AccountRequest).account?.role !== role) {
      res.status(403).json({ error: "You do not have permission to access this resource" });
      return;
    }
    next();
  };
}

export function currentAccount(req: Request): Account {
  const account = (req as AccountRequest).account;
  if (!account) throw new Error("Route missing requireUser middleware");
  return account;
}
