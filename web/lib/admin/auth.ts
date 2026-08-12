import {
  createHash,
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
 * ## Why this changed, twice
 *
 * The original was "one shared password + pick which of the configured people you
 * are", which is what the client asked for (spec §13, 31 Jul). It had one flaw
 * that mattered more than its convenience: **the actor was self-asserted.** Anyone
 * holding the shared password could sign in as Janet, and every `audit_log` row is
 * written from `session.user`. For a surface whose whole point is that a decision
 * about a named caregiver carries the name of the person who made it, "the audit
 * trail names a person" has to mean that person proved who they were.
 *
 * `ADMIN_CREDENTIALS` fixed that — one scrypt record per person, no password
 * stored anywhere — and left an operational hole: every change to who can act
 * was an environment edit and a redeploy. **Revoking access needed a build.** So
 * the credentials now live in `admin_users` (12 Aug), and this file no longer
 * knows where they came from: it is given a `CredentialSet` and verifies against
 * it.
 *
 * Four sources, in order, reported by the app rather than assumed:
 *
 *  - **`database`** — `admin_users`. The mode to run. Changes take effect within
 *    a minute (`lib/server/admin-auth.ts` caches the read), immediately on the
 *    next sign-in.
 *  - **`per_user`** — `ADMIN_CREDENTIALS`, the same scrypt records in an env var.
 *    Now a **bootstrap fallback**: it is what admits the first person on a
 *    deployment whose table is still empty.
 *  - **`shared`** — `ADMIN_PASSWORD` + `ADMIN_USERS`. Deprecated, announced on
 *    the sign-in screen, kept so a deploy cannot take the admin dark.
 *  - **`off`** — nothing configured. An unprotected admin is a worse failure than
 *    an unavailable one, so the whole surface disappears.
 *
 * ## Shape of a record
 *
 *   ADMIN_CREDENTIALS:  name:scrypt:<N>:<r>:<p>:<salt>:<hash>,name:scrypt:…
 *   admin_users.password_hash:  scrypt:<N>:<r>:<p>:<salt>:<hash>
 *
 * Same record, with the name in the column instead of in front of the colon.
 * base64url so a record never contains a comma or a colon, and the cost
 * parameters live **inside** it: if a future change to the defaults did not match
 * what a stored hash was made with, every sign-in would fail for reasons nobody
 * could see. Self-describing records cannot drift.
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

/**
 * `unavailable` is not a configuration — it is "the credential store is
 * configured and could not be read". It exists so that a database blip fails
 * **closed** rather than falling back to whatever an env var still says, which
 * would hand a revoked admin their access back for the length of the outage.
 */
export type AdminAuthMode =
  | "database"
  | "per_user"
  | "shared"
  | "unavailable"
  | "off";

interface Credential {
  user: string;
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/**
 * Everything a sign-in or a session check needs, with no idea where it came
 * from. Built by `envCredentials()` here, or by `lib/server/admin-auth.ts` from
 * the database.
 */
export interface CredentialSet {
  mode: AdminAuthMode;
  /** Per-person records. Empty in `shared`, `off` and `unavailable`. */
  creds: Credential[];
  /**
   * Who may sign in. **Server-side only** — the sign-in form asks for the name
   * rather than offering it, so this list never reaches a browser. It is here
   * because shared mode verifies against it and `adminConfigured` counts it.
   */
  users: string[];
  /** Deprecated shared mode only. */
  sharedPassword?: string;
  /**
   * What the session signing key is derived from when `ADMIN_SESSION_SECRET` is
   * unset. Must be stable across processes and must change when any credential
   * does — see `secret()`.
   */
  keyMaterial: string;
}

/* ── Building a set ───────────────────────────────────────────────────────── */

function parseRecord(user: string, rest: string): Credential | null {
  const [scheme, N, r, p, salt, hash] = rest.split(":");
  if (!user || scheme !== "scrypt" || !N || !r || !p || !salt || !hash) return null;
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  if (
    !Number.isInteger(cost.N) ||
    !Number.isInteger(cost.r) ||
    !Number.isInteger(cost.p)
  ) {
    return null;
  }
  return {
    user,
    ...cost,
    salt: Buffer.from(salt, "base64url"),
    hash: Buffer.from(hash, "base64url"),
  };
}

function parseEnvCredentials(): Credential[] {
  const out: Credential[] = [];
  for (const record of (process.env.ADMIN_CREDENTIALS ?? "").split(",")) {
    const entry = record.trim();
    if (entry === "") continue;
    const colon = entry.indexOf(":");
    if (colon < 1) continue;
    /* A malformed record is skipped rather than throwing: one bad paste must not
       take the whole admin offline. */
    const cred = parseRecord(entry.slice(0, colon), entry.slice(colon + 1));
    if (cred) out.push(cred);
  }
  return out;
}

function sharedUsers(): string[] {
  return (process.env.ADMIN_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fingerprint of the whole set — stable, and different the moment any hash is. */
function materialOf(creds: Credential[]): string {
  return createHash("sha256")
    .update(creds.map((c) => `${c.user}:${c.hash.toString("base64url")}`).join(","))
    .digest("base64url");
}

/** The set the environment describes. The default everywhere, and the fallback. */
export function envCredentials(): CredentialSet {
  const creds = parseEnvCredentials();
  if (creds.length > 0) {
    return {
      mode: "per_user",
      creds,
      users: creds.map((c) => c.user),
      keyMaterial: process.env.ADMIN_CREDENTIALS ?? "",
    };
  }

  const shared = sharedUsers();
  if (process.env.ADMIN_PASSWORD && shared.length > 0) {
    return {
      mode: "shared",
      creds: [],
      users: shared,
      sharedPassword: process.env.ADMIN_PASSWORD,
      keyMaterial: process.env.ADMIN_PASSWORD,
    };
  }

  return { mode: "off", creds: [], users: [], keyMaterial: "" };
}

/**
 * The set `admin_users` describes. Rows with an unparseable hash are dropped the
 * same way a bad env record is — one broken row must not lock everyone out — but
 * a set that ends up empty falls back to the environment at the caller, not
 * here, because "the table has nobody in it yet" is a different situation from
 * "this row is malformed".
 */
export function databaseCredentials(
  rows: Array<{ name: string; password_hash: string }>,
): CredentialSet {
  const creds = rows
    .map((r) => parseRecord(r.name, r.password_hash))
    .filter((c): c is Credential => c !== null);

  return {
    mode: "database",
    creds,
    users: creds.map((c) => c.user),
    keyMaterial: `db:${materialOf(creds)}`,
  };
}

/** The store is configured but could not be read. Fails closed by construction. */
export function unavailableCredentials(): CredentialSet {
  return { mode: "unavailable", creds: [], users: [], keyMaterial: "" };
}

export function adminAuthMode(set: CredentialSet = envCredentials()): AdminAuthMode {
  return set.mode;
}

/** The people who can sign in. Named on the form; the names are not secret. */
export function adminUsers(set: CredentialSet = envCredentials()): string[] {
  return set.users;
}

export function adminConfigured(set: CredentialSet = envCredentials()): boolean {
  return set.mode !== "off" && set.mode !== "unavailable";
}

/* ── Session token ────────────────────────────────────────────────────────── */

/**
 * The session signing key, and the one place the modes differ in a way worth
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
 *
 * In `database` mode the material is a hash of the rows rather than the rows
 * themselves, and it is sorted by name at the query, so every process and every
 * restart derives the same key from the same table.
 */
function secret(set: CredentialSet): string {
  return process.env.ADMIN_SESSION_SECRET || `pando:${set.keyMaterial}`;
}

function sign(payload: string, set: CredentialSet): string {
  return createHmac("sha256", secret(set)).update(payload).digest("base64url");
}

/**
 * Ties a session to the credential it was issued against, so changing one
 * person's password ends their sessions and nobody else's. Truncated because it
 * only has to change when the credential does, not carry the credential.
 */
function fingerprint(user: string, set: CredentialSet): string {
  const cred = set.creds.find((c) => c.user === user);
  const material = cred
    ? cred.hash.toString("base64url")
    : (set.sharedPassword ?? "");
  return createHmac("sha256", secret(set))
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

export function issueToken(
  user: string,
  set: CredentialSet = envCredentials(),
): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
  const payload = Buffer.from(
    JSON.stringify({ user, exp, fp: fingerprint(user, set) }),
  ).toString("base64url");
  return { value: `${payload}.${sign(payload, set)}`, maxAge: TTL_HOURS * 3600 };
}

/**
 * Verifies signature, expiry, that the person is still allowed in, and that their
 * credential has not been rotated. Returns null for anything suspect.
 *
 * Synchronous on purpose: the only secret work here is an HMAC, and the caller
 * has already resolved the credential set. Everything that could touch a database
 * happens in `lib/server/admin-auth.ts`, once per minute, not on this path.
 */
export function readToken(
  token: string | undefined,
  set: CredentialSet = envCredentials(),
): AdminSession | null {
  if (!token) return null;
  /* Nothing verifies against a store we could not read, and nothing verifies
     against no configuration at all. */
  if (!adminConfigured(set)) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload, set))) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AdminSession;
    if (typeof parsed.user !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    /* Deactivated in `admin_users` ⇒ not in `users` ⇒ the session stops here,
       without a password change and without waiting for the token to expire. */
    if (!set.users.includes(parsed.user)) return null;
    /* Tokens issued before fingerprints existed have no `fp`. They are refused
       rather than grandfathered: the whole point is that a rotated credential
       ends a session, and an exception would be a way around it. */
    if (typeof parsed.fp !== "string") return null;
    if (!safeEqual(parsed.fp, fingerprint(parsed.user, set))) return null;
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
  set: CredentialSet = envCredentials(),
): Promise<boolean> {
  if (typeof user !== "string" || typeof password !== "string" || password === "") {
    return false;
  }
  if (set.mode === "off" || set.mode === "unavailable") return false;

  if (set.creds.length > 0) {
    const cred = set.creds.find((c) => c.user === user);
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
  const expected = set.sharedPassword;
  if (!expected || !set.users.includes(user)) return false;
  return safeEqual(password, expected);
}

/**
 * Hashes a password into the stored record — everything after the name.
 * `admin_users.password_hash` holds exactly this; an `ADMIN_CREDENTIALS` entry is
 * this with `<name>:` in front. One function, so the two cannot drift.
 */
export async function passwordRecord(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  })) as Buffer;
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");
}

/** The same record with a name in front — an `ADMIN_CREDENTIALS` entry. */
export async function credentialRecord(
  user: string,
  password: string,
): Promise<string> {
  return `${user}:${await passwordRecord(password)}`;
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
