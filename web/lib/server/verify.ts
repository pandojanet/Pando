import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_LOCK_MINUTES,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_MAX_SENDS,
  VERIFICATION_SESSION_HOURS,
  VERIFICATION_TTL_MINUTES,
} from "@/lib/sms-templates";

/** A confirmed verification stays usable this long — see the constant's note. */
const SESSION_MS = VERIFICATION_SESSION_HOURS * 60 * 60 * 1000;

/**
 * Phone verification for the founding path (client's v3.2 round).
 *
 * The rule that shapes this file: **nothing about the parent is stored until the
 * code is confirmed.** So a pending verification holds no profile, no cards and no
 * name — only what is needed to check one code:
 *
 *  - the phone, kept in memory for the length of the attempt because we have to
 *    text it, and never written to a log;
 *  - a keyed hash of the code, so a memory dump isn't a list of live codes;
 *  - the counters spec §19 specifies: 5-minute expiry, 3 sends, 3 wrong guesses,
 *    then a 15-minute lock on the number.
 *
 * State is process-local on purpose. It survives a page reload (the browser keeps
 * the id in an httpOnly cookie) but not a deploy, which is the right trade for a
 * five-minute code and one VPS container. When this moves to Supabase it becomes a
 * `phone_verifications` table with the same fields and the same TTL.
 */

const SECRET =
  process.env.SEED_VERIFY_SECRET ?? process.env.ADMIN_SESSION_SECRET ?? "pando-dev-verify";

export const VERIFY_COOKIE = "pando_verify";

interface Pending {
  phone: string;
  code_hash: string;
  expires_at: number;
  sends: number;
  attempts: number;
  /** Set once the parent got it right. This is what the submit gate reads. */
  verified_at: string | null;
}

/**
 * One store per *process*, not per module.
 *
 * Route handlers are bundled separately (in dev each route has its own module
 * graph), so a plain module-level `Map` gave `/verify/start` and `/verify/check`
 * two different stores and every code came back "unknown". The global is the fix
 * that keeps the counters authoritative; it stops being needed the moment this
 * becomes a `phone_verifications` table.
 */
const store = globalThis as typeof globalThis & {
  __pandoVerifications?: Map<string, Pending>;
};
store.__pandoVerifications ??= new Map<string, Pending>();
const pending = store.__pandoVerifications;

/**
 * Sends per phone, independent of the cookie.
 *
 * The three-send cap lives on a pending verification, which a browser can throw away:
 * clear the cookie, start again, get three more. That was harmless while sends were
 * inert. Now that a send costs money, reaches a real person's phone and counts against
 * our carrier reputation, the number itself needs a ceiling that a client cannot reset.
 */
const perPhone = globalThis as typeof globalThis & {
  __pandoVerifySends?: Map<string, number[]>;
};
perPhone.__pandoVerifySends ??= new Map<string, number[]>();
const sendsByPhone = perPhone.__pandoVerifySends;

/** Codes to one number per hour, across every session and cookie. */
export const VERIFICATION_SENDS_PER_HOUR = 5;

/**
 * The §19 lock, keyed to the phone rather than to the pending verification.
 *
 * On the verification it would be worthless: three wrong guesses, drop the cookie,
 * ask for another code, three more guesses. Keyed to the number it is what the
 * spec means — the number stops being verifiable for fifteen minutes, whatever the
 * browser does. Same store shape as the send counter above, and it moves into the
 * same table when this does.
 */
const lockStore = globalThis as typeof globalThis & {
  __pandoVerifyLocks?: Map<string, number>;
};
lockStore.__pandoVerifyLocks ??= new Map<string, number>();
const locksByPhone = lockStore.__pandoVerifyLocks;

/** Milliseconds until this number can try again, or 0 when it is not locked. */
export function lockRemaining(phone: string, now = Date.now()): number {
  const until = locksByPhone.get(phone);
  if (until === undefined) return 0;
  if (until <= now) {
    locksByPhone.delete(phone);
    return 0;
  }
  return until - now;
}

function lockPhone(phone: string, now = Date.now()) {
  locksByPhone.set(phone, now + VERIFICATION_LOCK_MINUTES * 60 * 1000);
}

function recentSends(phone: string, now: number): number[] {
  const cutoff = now - 60 * 60 * 1000;
  const kept = (sendsByPhone.get(phone) ?? []).filter((at) => at > cutoff);
  if (kept.length === 0) sendsByPhone.delete(phone);
  else sendsByPhone.set(phone, kept);
  return kept;
}

/**
 * True when this number has had its hourly allowance of codes. Checked before a code
 * is generated, so a rate-limited request costs nothing.
 */
export function phoneSendLimitReached(phone: string, now = Date.now()): boolean {
  return recentSends(phone, now).length >= VERIFICATION_SENDS_PER_HOUR;
}

function recordSend(phone: string, now = Date.now()) {
  sendsByPhone.set(phone, [...recentSends(phone, now), now]);
}

function sweep(now = Date.now()) {
  for (const [id, entry] of pending) {
    /* A verified record long outlives its code: since the code moved to the start
       of the flow, every write a parent makes for the rest of the visit re-checks
       this record. An unconfirmed one still dies with the code. */
    const cutoff = entry.verified_at ? entry.expires_at + SESSION_MS : entry.expires_at;
    if (cutoff < now) pending.delete(id);
  }
}

function hash(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("hex");
}

function newCode(): string {
  const max = 10 ** VERIFICATION_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(VERIFICATION_CODE_LENGTH, "0");
}

export type StartOutcome =
  | { ok: true; id: string; code: string; sends: number; expires_at: string }
  | { ok: false; reason: "resend_limit"; sends: number }
  /** This number has had its hourly allowance, whatever the cookie says. */
  | { ok: false; reason: "phone_send_limit"; sends: number }
  /** §19: three wrong guesses locked this number for fifteen minutes. */
  | { ok: false; reason: "locked"; sends: number; retry_in_seconds: number };

/**
 * Creates or refreshes a pending verification and returns the code so the caller
 * can hand it to the send layer. The code is never returned to the browser (the
 * one labelled exception is the dev-code switch in the route).
 */
export function startVerification(phone: string, existingId: string | null): StartOutcome {
  sweep();

  const now = Date.now();

  /* The lock comes first: a locked number must not be able to buy its way out of
     the lock by asking for a fresh code. */
  const locked = lockRemaining(phone, now);
  if (locked > 0) {
    return {
      ok: false,
      reason: "locked",
      sends: recentSends(phone, now).length,
      retry_in_seconds: Math.ceil(locked / 1000),
    };
  }

  // Checked before a code exists, so a rate-limited request costs nothing and no
  // number is burned.
  if (phoneSendLimitReached(phone, now)) {
    return {
      ok: false,
      reason: "phone_send_limit",
      sends: recentSends(phone, now).length,
    };
  }

  const current = existingId ? pending.get(existingId) : undefined;

  // Same phone, still inside the window: this is a resend, and it is capped.
  if (current && current.phone === phone && current.expires_at > now) {
    if (current.sends >= VERIFICATION_MAX_SENDS) {
      return { ok: false, reason: "resend_limit", sends: current.sends };
    }
    const code = newCode();
    current.code_hash = hash(code);
    current.sends += 1;
    current.attempts = 0;
    current.verified_at = null;
    recordSend(phone, now);
    return {
      ok: true,
      id: existingId!,
      code,
      sends: current.sends,
      expires_at: new Date(current.expires_at).toISOString(),
    };
  }

  const id = hash(`${phone}:${now}:${randomInt(0, 1e9)}`).slice(0, 32);
  const code = newCode();
  const expires_at = now + VERIFICATION_TTL_MINUTES * 60 * 1000;
  pending.set(id, {
    phone,
    code_hash: hash(code),
    expires_at,
    sends: 1,
    attempts: 0,
    verified_at: null,
  });
  recordSend(phone, now);
  return { ok: true, id, code, sends: 1, expires_at: new Date(expires_at).toISOString() };
}

export type CheckOutcome =
  | { ok: true; verified_at: string }
  | {
      ok: false;
      reason: "unknown" | "expired" | "wrong_code" | "too_many_attempts" | "locked";
      attempts_left?: number;
      retry_in_seconds?: number;
    };

export function checkVerification(id: string | null, code: string): CheckOutcome {
  sweep();
  if (!id) return { ok: false, reason: "unknown" };

  const entry = pending.get(id);
  if (!entry) return { ok: false, reason: "unknown" };

  const locked = lockRemaining(entry.phone);
  if (locked > 0) {
    pending.delete(id);
    return {
      ok: false,
      reason: "locked",
      retry_in_seconds: Math.ceil(locked / 1000),
    };
  }

  if (entry.expires_at < Date.now()) {
    pending.delete(id);
    return { ok: false, reason: "expired" };
  }
  if (entry.attempts >= VERIFICATION_MAX_ATTEMPTS) {
    pending.delete(id);
    lockPhone(entry.phone);
    return { ok: false, reason: "too_many_attempts" };
  }

  const given = Buffer.from(hash(code));
  const wanted = Buffer.from(entry.code_hash);
  const same = given.length === wanted.length && timingSafeEqual(given, wanted);

  if (!same) {
    entry.attempts += 1;
    const left = VERIFICATION_MAX_ATTEMPTS - entry.attempts;
    if (left <= 0) {
      pending.delete(id);
      /* §19's "then a 15-minute lock". Set here rather than on the next request,
         because the entry that was counting the attempts is now gone. */
      lockPhone(entry.phone);
      return { ok: false, reason: "too_many_attempts", attempts_left: 0 };
    }
    return { ok: false, reason: "wrong_code", attempts_left: left };
  }

  entry.verified_at = new Date().toISOString();
  return { ok: true, verified_at: entry.verified_at };
}

/**
 * The submit gate. A write that claims a phone must present the cookie of a
 * verification that confirmed *that* phone — so a client can't set
 * `phone_verified: true` and a stale cookie can't carry a different number.
 */
export function verifiedPhone(id: string | null): { phone: string; verified_at: string } | null {
  if (!id) return null;
  const entry = pending.get(id);
  if (!entry || !entry.verified_at || entry.expires_at + SESSION_MS < Date.now()) {
    return null;
  }
  return { phone: entry.phone, verified_at: entry.verified_at };
}

/** True when the app must have a verified phone before it stores anything. */
export function verificationRequired(): boolean {
  return process.env.SEED_REQUIRE_VERIFICATION !== "0";
}

/**
 * QA switch. Returns the code in the response so the flow can be walked while the
 * A2P campaign is still pending. Off unless explicitly set, and the route says so
 * on screen when it's on — a hidden bypass is worse than no bypass.
 */
export function devCodesEnabled(): boolean {
  /**
   * Never in production, whatever the env says.
   *
   * This flag exists so QA could walk the flow while the A2P campaign was pending. A
   * misplaced `SEED_VERIFY_DEV_CODES=1` on the VPS would print live verification codes
   * on a public screen, so the build refuses rather than trusting deployment hygiene.
   */
  if (process.env.NODE_ENV === "production") return false;
  return process.env.SEED_VERIFY_DEV_CODES === "1";
}
