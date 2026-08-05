import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Admin sign-in for the pilot (estimate 2.1).
 *
 * The client's answer was "1–3 admins, one simple password, no roles in P0"
 * (spec §13: ADMIN_PASSWORD or a single Supabase Auth user, no OAuth). But the
 * audit trail has to attribute sensitive actions — caregiver consent, trust level,
 * profile edits — to a *person*, not to "the admin". So sign-in is:
 *
 *   shared password  +  pick which of the configured people you are
 *
 * That keeps the one-password simplicity the client asked for while every write
 * still carries a name. Real per-person credentials replace this the moment more
 * than three people need access.
 *
 * The admin is **off** unless both env vars are set — an unprotected admin is a
 * worse failure than an unavailable one.
 */

const COOKIE = "pando_admin";
const TTL_HOURS = 12;

export interface AdminSession {
  /** Who is acting — goes into every audit_log row. */
  user: string;
  /** Unix seconds. */
  exp: number;
}

export function adminUsers(): string[] {
  return (process.env.ADMIN_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD) && adminUsers().length > 0;
}

function secret(): string {
  // A dedicated secret is better, but deriving one keeps setup to two variables.
  return process.env.ADMIN_SESSION_SECRET || `pando:${process.env.ADMIN_PASSWORD ?? ""}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function passwordMatches(input: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof input !== "string" || input.length === 0) return false;
  return safeEqual(input, expected);
}

export const ADMIN_COOKIE = COOKIE;

export function issueToken(user: string): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
  const payload = Buffer.from(JSON.stringify({ user, exp })).toString("base64url");
  return { value: `${payload}.${sign(payload)}`, maxAge: TTL_HOURS * 3600 };
}

/** Verifies signature and expiry. Returns null for anything suspect. */
export function readToken(token: string | undefined): AdminSession | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AdminSession;
    if (typeof parsed.user !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    if (!adminUsers().includes(parsed.user)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ── Login throttling (spec §19: rate-limit admin login) ──────────────────── */

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function loginLocked(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.until < Date.now()) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailure(key: string): void {
  const entry = attempts.get(key) ?? { count: 0, until: 0 };
  entry.count += 1;
  entry.until = Date.now() + LOCK_MINUTES * 60_000;
  attempts.set(key, entry);
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
