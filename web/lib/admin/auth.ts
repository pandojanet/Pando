import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * Admin sign-in (estimate 2.1).
 *
 * ## Why this changed
 *
 * The original was "one shared password + pick which of the configured people you
 * are", which is what the client asked for (spec §13, 31 Jul). It had one flaw
 * that mattered more than its convenience: **the actor was self-asserted.** Anyone
 * holding the shared password could sign in as Janet, and every `audit_log` row is
 * written from `session.user`. For a surface whose whole point is that a decision
 * about a named caregiver carries the name of the person who made it, "the audit
 * trail names a person" has to mean that person proved who they were.
 *
 * So there are now two modes, and the app reports which one it is running:
 *
 *  - **`ADMIN_CREDENTIALS`** — one scrypt hash per person. No password is stored
 *    anywhere, in env or otherwise; what is stored cannot be replayed. This is the
 *    mode to run.
 *  - **`ADMIN_PASSWORD` + `ADMIN_USERS`** — the original shared password. Kept,
 *    deprecated, and announced on the sign-in screen, for exactly one reason: a
 *    deploy must not take the admin dark before the client has had a chance to
 *    generate credentials. Remove it once `ADMIN_CREDENTIALS` is set.
 *
 * The admin is **off** unless one of the two is configured — an unprotected admin
 * is a worse failure than an unavailable one.
 *
 * ## Shape of ADMIN_CREDENTIALS
 *
 *   name:scrypt:<N>:<r>:<p>:<salt-base64url>:<hash-base64url>,name:scrypt:…
 *
 * Generate a record with `npm run admin:credential -- <name>`. base64url is used
 * so a record never contains a comma or a colon and the list stays parseable, and
 * the cost parameters live **inside** each record: if a future change to the
 * defaults did not match what a stored hash was made with, every sign-in would
 * fail for reasons nobody could see. Self-describing records cannot drift.
 */

const COOKIE = "pando_admin";
const TTL_HOURS = 12;

/**
 * scrypt cost for *new* records. Measured at ~135ms and 64MB per attempt, which a
 * sign-in can afford and a bot cannot — and with the five-attempt lock in front of
 * it, an attacker gets five of those per quarter hour.
 *
 * Raising this later is safe and needs no migration: every record carries the cost
 * it was made with, so old hashes keep verifying at their own settings while new
 * ones get the new ones. N is capped by `maxmem` below (128·N·r bytes), not by
 * Node's 32MB default.
 */
const SCRYPT = { N: 65536, r: 8, p: 1, keylen: 32 } as const;

/**
 * `promisify` picks the three-argument overload and drops the one that takes
 * options, so the cost parameters would be silently ignored — the hash would
 * still verify against itself, at Node's defaults instead of ours. Typed
 * explicitly so passing them is a compile-time fact.
 */
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>;

export interface AdminSession {
  /** Who is acting — goes into every audit_log row. */
  user: string;
  /** Unix seconds. */
  exp: number;
  /**
   * A fingerprint of the credential this session was issued against. Rotating a
   * person's password changes it, which invalidates their outstanding sessions —
   * without it, "change the password" would not remove anyone's access.
   */
  fp: string;
}

export type AdminAuthMode = "per_user" | "shared" | "off";

interface Credential {
  user: string;
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/* ── Configuration ────────────────────────────────────────────────────────── */

function parseCredentials(): Credential[] {
  const raw = process.env.ADMIN_CREDENTIALS ?? "";
  const out: Credential[] = [];

  for (const record of raw.split(",")) {
    const entry = record.trim();
    if (entry === "") continue;
    const [user, scheme, N, r, p, salt, hash] = entry.split(":");
    /* A malformed record is skipped rather than throwing: one bad paste must not
       take the whole admin offline. */
    if (!user || scheme !== "scrypt" || !N || !r || !p || !salt || !hash) continue;
    const cost = { N: Number(N), r: Number(r), p: Number(p) };
    if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
      continue;
    }
    out.push({
      user,
      ...cost,
      salt: Buffer.from(salt, "base64url"),
      hash: Buffer.from(hash, "base64url"),
    });
  }

  return out;
}

export function adminAuthMode(): AdminAuthMode {
  if (parseCredentials().length > 0) return "per_user";
  if (process.env.ADMIN_PASSWORD && sharedUsers().length > 0) return "shared";
  return "off";
}

function sharedUsers(): string[] {
  return (process.env.ADMIN_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The people who can sign in. Named on the form; the names are not secret. */
export function adminUsers(): string[] {
  const creds = parseCredentials();
  return creds.length > 0 ? creds.map((c) => c.user) : sharedUsers();
}

export function adminConfigured(): boolean {
  return adminAuthMode() !== "off";
}

/* ── Session token ────────────────────────────────────────────────────────── */

/**
 * The session signing key, and the one place the two modes differ in a way worth
 * knowing about.
 *
 * **Set `ADMIN_SESSION_SECRET` in production.** With it, the key is independent of
 * the credentials, so `fp` below does what it was added for: rotating one person's
 * password ends that person's sessions and nobody else's.
 *
 * Without it the key is derived from the credential material, which keeps setup to
 * a single variable but means **rotating anyone's password signs everyone out** —
 * the key itself changed, so every outstanding signature stops verifying. That is
 * safe, just blunter than it looks, and it is asserted in the tests rather than
 * assumed: an earlier version of this comment claimed the per-person behaviour
 * held in both configurations, and it does not.
 */
function secret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    `pando:${process.env.ADMIN_CREDENTIALS ?? process.env.ADMIN_PASSWORD ?? ""}`
  );
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Ties a session to the credential it was issued against, so changing one
 * person's password ends their sessions and nobody else's. Truncated because it
 * only has to change when the credential does, not carry the credential.
 */
function fingerprint(user: string): string {
  const cred = parseCredentials().find((c) => c.user === user);
  const material = cred
    ? cred.hash.toString("base64url")
    : (process.env.ADMIN_PASSWORD ?? "");
  return createHmac("sha256", secret())
    .update(`${user}:${material}`)
    .digest("base64url")
    .slice(0, 16);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const ADMIN_COOKIE = COOKIE;

export function issueToken(user: string): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
  const payload = Buffer.from(
    JSON.stringify({ user, exp, fp: fingerprint(user) }),
  ).toString("base64url");
  return { value: `${payload}.${sign(payload)}`, maxAge: TTL_HOURS * 3600 };
}

/**
 * Verifies signature, expiry, that the person still exists, and that their
 * credential has not been rotated. Returns null for anything suspect.
 *
 * Deliberately synchronous: `proxy.ts` runs this on every admin request before
 * anything renders, and scrypt has no business on that path — the only secret
 * work here is an HMAC.
 */
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
    /* Tokens issued before fingerprints existed have no `fp`. They are refused
       rather than grandfathered: the whole point is that a rotated credential
       ends a session, and an exception would be a way around it. */
    if (typeof parsed.fp !== "string") return null;
    if (!safeEqual(parsed.fp, fingerprint(parsed.user))) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ── Verifying a sign-in ──────────────────────────────────────────────────── */

/**
 * True only when this person proved this password.
 *
 * Always does the same work whether or not the name exists: an unknown name is
 * hashed against a throwaway salt so the response time cannot be used to
 * enumerate who has access. The route above it says nothing about which half was
 * wrong, and this keeps that promise measurable rather than just stated.
 */
export async function verifyCredentials(
  user: unknown,
  password: unknown,
): Promise<boolean> {
  if (typeof user !== "string" || typeof password !== "string" || password === "") {
    return false;
  }

  const creds = parseCredentials();

  if (creds.length > 0) {
    const cred = creds.find((c) => c.user === user);
    const salt = cred?.salt ?? randomBytes(16);
    const expected = cred?.hash ?? randomBytes(SCRYPT.keylen);
    const cost = cred ?? SCRYPT;
    const actual = (await scryptAsync(password, salt, expected.length, {
      N: cost.N,
      r: cost.r,
      p: cost.p,
      /* scrypt needs memory ≈ 128·N·r bytes; Node's default cap is 32MB, which
         N=16384, r=8 sits exactly on. Raising it here means a future cost bump
         does not fail with an opaque "Invalid scrypt params". */
      maxmem: 256 * 1024 * 1024,
    })) as Buffer;
    /* `cred` is checked after the hash, not instead of it, so the unknown-name
       path costs the same as the wrong-password path. */
    if (!cred) return false;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  /* Deprecated shared-password mode. */
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !sharedUsers().includes(user)) return false;
  return safeEqual(password, expected);
}

/** Hashes a password into an `ADMIN_CREDENTIALS` record. Used by the CLI script. */
export async function credentialRecord(
  user: string,
  password: string,
): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  })) as Buffer;
  return [
    user,
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");
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
