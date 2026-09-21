import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { isDbConfigured, withDb, type Db } from "./db";
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
 *  - the phone, kept for the length of the attempt because we have to text it,
 *    and never written to a log;
 *  - a keyed hash of the code, so a dump isn't a list of live codes;
 *  - the counters spec §19 specifies: 5-minute expiry, 3 sends, 3 wrong guesses,
 *    then a 15-minute lock on the number.
 *
 * ## Where that state lives, and why it moved (21 Sep)
 *
 * It was `globalThis`, and this file's own header promised the table it is now:
 * *"survives a page reload … but not a deploy, which is the right trade for a
 * five-minute code."* That trade was right when it was written and stopped being
 * right on **12 Aug**, when the code moved to the front of the flow and a
 * confirmed number began standing for **twelve hours** — because it now opens a
 * whole visit rather than ending one. This app ships several times a day, so the
 * twelve-hour promise was really "until the next deploy", and the developer hit
 * it twice: a saved, verified profile, one answer changed, and a fresh code
 * demanded with nothing on screen able to explain it.
 *
 * ⚠⚠ **Two §19 counters went with it, and they are the half that is not about
 * convenience:** the 15-minute lock after three wrong guesses, and the
 * five-codes-an-hour ceiling on a number. A restart cleared both — so the only
 * thing between a six-digit code and somebody working through it was reset
 * several times a day, by us.
 *
 * ⚠ **The in-process maps stay as the fallback for a deployment with no
 * database**, and that is not hedging: this app's own rule is that the flow
 * walks before there is a database (`persisted: false` rather than pretending),
 * and the client walks it that way. Without the fallback the code screen becomes
 * a dead end on a laptop. Which store is in use is decided once, by
 * `isDbConfigured`, and the two never run together.
 *
 * ⚠⚠ **A database that is configured and unreachable fails closed**, unlike the
 * rest of the app: `repo/outreach.ts` already makes this distinction and for the
 * same reason. Elsewhere an outage means *"we could not save your answer"*,
 * which is recoverable; here falling back to memory would mean a verification
 * the last deploy dropped quietly counting again, and a lock quietly lifting.
 */

const SECRET =
  process.env.SEED_VERIFY_SECRET ?? process.env.ADMIN_SESSION_SECRET ?? "pando-dev-verify";

export const VERIFY_COOKIE = "pando_verify";

/**
 * What a caller needs to know about a verification.
 *
 * ⚠ `sends` is a **count**, not the timestamps behind it, and that is the
 * store's business rather than this contract's: the resend cap is a number and
 * the hourly ceiling is a question only the store can answer (it spans every
 * verification that number has ever had). The first shape of this returned the
 * raw `timestamptz[]`, and it failed on the first real read — through
 * `db.execute` a Postgres array does not arrive as a JS array — which is the
 * useful half of the mistake: the column shape had leaked into the interface.
 */
interface Pending {
  phone: string;
  code_hash: string;
  expires_at: number;
  /** Codes sent on **this** verification, for the three-send cap. */
  sends: number;
  attempts: number;
  /** Set once the parent got it right. This is what the submit gate reads. */
  verified_at: string | null;
}

/** How long a row is worth keeping: the session window, past its own expiry. */
function deadAt(entry: Pick<Pending, "expires_at" | "verified_at">): number {
  return entry.verified_at ? entry.expires_at + SESSION_MS : entry.expires_at;
}

/**
 * What the two stores have to be able to do.
 *
 * Deliberately narrow, and deliberately **not** "read, mutate, write back":
 * every mutation below is expressed as its own method so the database version
 * can be one statement rather than a read-modify-write race. There is one
 * container today, so the race is theoretical — but a store written around
 * read-then-write is one that cannot be moved behind a pooler later, and the
 * attempt counter is exactly the thing a race would forgive.
 */
/** What a store is asked to write when a verification begins. */
interface NewVerification {
  phone: string;
  code_hash: string;
  expires_at: number;
  sent_at: number;
}

interface Store {
  get(id: string): Promise<Pending | null>;
  /** Returns the new id. */
  create(entry: NewVerification): Promise<string>;
  /** A resend on an existing row: new code, counted, attempts reset. */
  resend(id: string, codeHash: string, at: number): Promise<void>;
  /** One wrong guess. Returns the attempts *after* it. */
  countAttempt(id: string): Promise<number>;
  /** Mark it confirmed, and return the moment. */
  confirm(id: string, at: string): Promise<void>;
  /** Make it unusable without forgetting the sends it already cost. */
  invalidate(id: string): Promise<void>;
  /** Codes sent to this number inside the last hour, across every session. */
  sendsInLastHour(phone: string, now: number): Promise<number>;
  lockedUntil(phone: string, now: number): Promise<number>;
  lock(phone: string, until: number): Promise<void>;
}

/* ── the fallback: one store per *process* ──────────────────────────────────
 *
 * Route handlers are bundled separately (in dev each route has its own module
 * graph), so a plain module-level `Map` gave `/verify/start` and `/verify/check`
 * two different stores and every code came back "unknown". The global is what
 * keeps the counters authoritative within a process.
 */
/** The memory store's own record: the same fields, plus the send times. */
interface Held extends Omit<Pending, "sends"> {
  sent_at: number[];
}

const g = globalThis as typeof globalThis & {
  __pandoVerifications?: Map<string, Held>;
  __pandoVerifyLocks?: Map<string, number>;
};
g.__pandoVerifications ??= new Map<string, Held>();
g.__pandoVerifyLocks ??= new Map<string, number>();
const pending = g.__pandoVerifications;
const locks = g.__pandoVerifyLocks;

const memoryStore: Store = {
  async get(id) {
    const entry = pending.get(id);
    if (!entry) return null;
    if (deadAt(entry) < Date.now()) {
      pending.delete(id);
      return null;
    }
    const { sent_at, ...rest } = entry;
    return { ...rest, sends: sent_at.length };
  },
  async create(entry) {
    /* Opportunistic, and only here: a sweep on every read would be a scan on
       the hot path for a map that holds a handful of rows. */
    const now = Date.now();
    for (const [id, e] of pending) if (deadAt(e) + 60 * 60 * 1000 < now) pending.delete(id);
    const id = hash(`${entry.phone}:${now}:${randomInt(0, 1e9)}`).slice(0, 32);
    pending.set(id, {
      phone: entry.phone,
      code_hash: entry.code_hash,
      expires_at: entry.expires_at,
      sent_at: [entry.sent_at],
      attempts: 0,
      verified_at: null,
    });
    return id;
  },
  async resend(id, codeHash, at) {
    const entry = pending.get(id);
    if (!entry) return;
    entry.code_hash = codeHash;
    entry.sent_at = [...entry.sent_at, at];
    entry.attempts = 0;
    entry.verified_at = null;
  },
  async countAttempt(id) {
    const entry = pending.get(id);
    if (!entry) return VERIFICATION_MAX_ATTEMPTS;
    entry.attempts += 1;
    return entry.attempts;
  },
  async confirm(id, at) {
    const entry = pending.get(id);
    if (entry) entry.verified_at = at;
  },
  async invalidate(id) {
    const entry = pending.get(id);
    /* Expired rather than deleted — see the database version for why the sends
       have to outlive the verification that spent them. */
    if (entry) entry.expires_at = Date.now() - 1;
  },
  async sendsInLastHour(phone, now) {
    const cutoff = now - 60 * 60 * 1000;
    let n = 0;
    for (const entry of pending.values()) {
      if (entry.phone !== phone) continue;
      n += entry.sent_at.filter((at) => at > cutoff).length;
    }
    return n;
  },
  async lockedUntil(phone, now) {
    const until = locks.get(phone);
    if (until === undefined) return 0;
    if (until <= now) {
      locks.delete(phone);
      return 0;
    }
    return until;
  },
  async lock(phone, until) {
    locks.set(phone, until);
  },
};

/* ── the record ─────────────────────────────────────────────────────────── */

/**
 * A row read back, or null.
 *
 * ⚠ The **expiry is applied in the WHERE clause**, never after the read: a row
 * past its window is not a row, and the alternative is every caller remembering
 * to check — which is how the memory version's `sweep` came to be load-bearing.
 */
async function dbGet(db: Db, id: string): Promise<Pending | null> {
  /* An id that is not a uuid is a stale or forged cookie, and Postgres would
     raise 22P02 on the cast rather than answering "no". Refused here. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  /* ⚠ `cardinality`, not the array itself: through `db.execute` a Postgres
     array does not arrive as a JS array, and the count is the only thing a
     caller wants from it. Counting in SQL also keeps the column's shape out of
     the interface above. */
  const rows = (await db.execute(sql`
    select phone, code_hash,
           extract(epoch from expires_at) * 1000 as expires_ms,
           cardinality(sent_at) as sends,
           attempts, verified_at
      from phone_verifications
     where id = ${id}::uuid
       and case when verified_at is null
                then expires_at
                else expires_at + (interval '1 hour' * ${VERIFICATION_SESSION_HOURS})
           end > now()
  `)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  return {
    phone: String(row.phone),
    code_hash: String(row.code_hash),
    expires_at: Number(row.expires_ms),
    sends: Number(row.sends),
    attempts: Number(row.attempts),
    verified_at: row.verified_at ? new Date(String(row.verified_at)).toISOString() : null,
  };
}

const dbStore: Store = {
  async get(id) {
    const r = await withDb((db) => dbGet(db, id));
    return r.persisted ? r.data : null;
  },
  async create(entry) {
    const r = await withDb(async (db) => {
      /* A day is well past every window this table has, and keeping the rows
         that long is what lets the hourly ceiling see the sends a failed
         verification already cost. */
      await db.execute(sql`
        delete from phone_verifications where created_at < now() - interval '1 day'
      `);
      const rows = (await db.execute(sql`
        insert into phone_verifications (phone, code_hash, expires_at, sent_at)
        values (${entry.phone}, ${entry.code_hash},
                to_timestamp(${entry.expires_at / 1000}),
                array[to_timestamp(${entry.sent_at / 1000})]::timestamptz[])
        returning id
      `)) as unknown as Array<Record<string, unknown>>;
      return String(rows[0]!.id);
    });
    if (!r.persisted) throw new Error("verification store unavailable");
    return r.data;
  },
  async resend(id, codeHash, at) {
    const r = await withDb((db) =>
      db.execute(sql`
        update phone_verifications
           set code_hash = ${codeHash},
               sent_at = sent_at || to_timestamp(${at / 1000}),
               attempts = 0,
               verified_at = null
         where id = ${id}::uuid
      `),
    );
    /* Throws so the caller answers `unavailable` rather than texting a code
       that was never stored — the parent would then be told, correctly and
       uselessly, that the code they had just been sent was wrong. */
    if (!r.persisted) throw new Error("verification store unavailable");
  },
  async countAttempt(id) {
    const r = await withDb(async (db) => {
      const rows = (await db.execute(sql`
        update phone_verifications set attempts = attempts + 1
         where id = ${id}::uuid
        returning attempts
      `)) as unknown as Array<Record<string, unknown>>;
      return Number(rows[0]?.attempts ?? VERIFICATION_MAX_ATTEMPTS);
    });
    /* Unreachable counts as spent: a store that cannot record a wrong guess
       must not hand out an unlimited number of them. */
    return r.persisted ? r.data : VERIFICATION_MAX_ATTEMPTS;
  },
  async confirm(id, at) {
    const r = await withDb((db) =>
      db.execute(sql`
        update phone_verifications set verified_at = ${at}::timestamptz
         where id = ${id}::uuid
      `),
    );
    if (!r.persisted) throw new Error("verification store unavailable");
  },
  async invalidate(id) {
    /**
     * ⚠⚠ **Expired, never deleted, and the reason is the hourly ceiling.**
     *
     * The in-memory version deleted the entry and kept a *separate* per-phone
     * list of send times, so a burnt verification still counted against the
     * number. With the sends living on the row, deleting it would forgive
     * them — three wrong guesses, drop the cookie, and the five-an-hour cap
     * starts again at zero. The row stays until the daily prune; what changes
     * is that no read will return it.
     */
    await withDb((db) =>
      db.execute(sql`
        update phone_verifications set expires_at = now() - interval '1 second'
         where id = ${id}::uuid and verified_at is null
      `),
    );
  },
  async sendsInLastHour(phone, _now) {
    const r = await withDb(async (db) => {
      const rows = (await db.execute(sql`
        select count(*)::int as n
          from phone_verifications v, unnest(v.sent_at) as t
         where v.phone = ${phone} and t > now() - interval '1 hour'
      `)) as unknown as Array<Record<string, unknown>>;
      return Number(rows[0]?.n ?? 0);
    });
    /* Fails closed: a ceiling that cannot be read is a ceiling that is reached. */
    return r.persisted ? r.data : VERIFICATION_SENDS_PER_HOUR;
  },
  async lockedUntil(phone, _now) {
    const r = await withDb(async (db) => {
      const rows = (await db.execute(sql`
        select extract(epoch from until) * 1000 as until
          from phone_verification_locks
         where phone = ${phone} and until > now()
      `)) as unknown as Array<Record<string, unknown>>;
      return rows[0] ? Number(rows[0].until) : 0;
    });
    return r.persisted ? r.data : 0;
  },
  async lock(phone, until) {
    /* ⚠ The one write here that cannot fail loudly: it runs *after* the check
       has already decided to refuse, so there is no outcome left to change.
       `withDb` logs the failure, and the next wrong guess locks again — what
       is lost is fifteen minutes of a lock, not the refusal itself. */
    await withDb((db) =>
      db.execute(sql`
        insert into phone_verification_locks (phone, until)
        values (${phone}, to_timestamp(${until / 1000}))
        on conflict (phone) do update set until = excluded.until
      `),
    );
  },
};

/**
 * Has `drizzle/0048` been applied here?
 *
 * ⚠⚠ **This exists because migrations on this deployment are a manual
 * command** (`npm run migrate`, DEPLOY.md §3) and the image ships without
 * waiting for one. So there is a window — however short somebody means it to
 * be — where the new code is running against a database that has no
 * `phone_verifications` table, and in that window every read fails, every
 * write throws, and the **entire seed flow is down**: nobody can confirm a
 * code, so nobody can store anything. A hard outage caused by the order two
 * deploy steps happened in.
 *
 * ⚠ Answering it collapses that to *today's behaviour* — the in-process maps,
 * which is what shipped for six weeks — and it is deliberately **not** the
 * same as the unreachable case above. A missing table is a deployment state
 * with an obvious fix; an unreachable one is an outage, where falling back to
 * memory would quietly resurrect a verification and lift a lock.
 *
 * Cached once it is there, because it cannot go away; re-asked while it is
 * not, so running the migration takes effect without a restart. Logged the
 * first time, or the fallback is a thing nobody knows is happening.
 */
let tableReady: boolean | null = null;
let announced = false;

async function migrated(): Promise<boolean> {
  if (tableReady) return true;
  const r = await withDb(async (db) => {
    const rows = (await db.execute(sql`
      select to_regclass('public.phone_verifications') is not null as ok
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0]?.ok === true;
  });
  /* Unreachable is not "not migrated": that is the outage case, and it belongs
     to the database store so it can fail closed there. */
  if (!r.persisted) return true;
  tableReady = r.data;
  if (!tableReady && !announced) {
    announced = true;
    console.warn(
      "[seed:verify] phone_verifications is missing — run `npm run migrate`. " +
        "Verifications are in memory until then, so a deploy will drop them.",
    );
  }
  return tableReady;
}

/** One decision, made per call so a deployment can gain a database mid-run. */
async function store(): Promise<Store> {
  if (!isDbConfigured()) return memoryStore;
  return (await migrated()) ? dbStore : memoryStore;
}

/** Codes to one number per hour, across every session and cookie. */
export const VERIFICATION_SENDS_PER_HOUR = 5;

/** Milliseconds until this number can try again, or 0 when it is not locked. */
export async function lockRemaining(phone: string, now = Date.now()): Promise<number> {
  const until = await (await store()).lockedUntil(phone, now);
  return until > now ? until - now : 0;
}

export async function phoneSendLimitReached(
  phone: string,
  now = Date.now(),
): Promise<boolean> {
  return (await (await store()).sendsInLastHour(phone, now)) >= VERIFICATION_SENDS_PER_HOUR;
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
  | { ok: false; reason: "locked"; sends: number; retry_in_seconds: number }
  /** Configured and unreachable — see the header: this one fails closed. */
  | { ok: false; reason: "unavailable"; sends: number };

/**
 * Creates or refreshes a pending verification and returns the code so the caller
 * can hand it to the send layer. The code is never returned to the browser (the
 * one labelled exception is the dev-code switch in the route).
 */
export async function startVerification(
  phone: string,
  existingId: string | null,
): Promise<StartOutcome> {
  const now = Date.now();
  const s = await store();

  /* The lock comes first: a locked number must not be able to buy its way out of
     the lock by asking for a fresh code. */
  const lockedUntil = await s.lockedUntil(phone, now);
  if (lockedUntil > now) {
    return {
      ok: false,
      reason: "locked",
      sends: await s.sendsInLastHour(phone, now),
      retry_in_seconds: Math.ceil((lockedUntil - now) / 1000),
    };
  }

  // Checked before a code exists, so a rate-limited request costs nothing and no
  // number is burned.
  const sent = await s.sendsInLastHour(phone, now);
  if (sent >= VERIFICATION_SENDS_PER_HOUR) {
    return { ok: false, reason: "phone_send_limit", sends: sent };
  }

  const current = existingId ? await s.get(existingId) : null;

  // Same phone, still inside the window: this is a resend, and it is capped.
  if (current && current.phone === phone && current.expires_at > now) {
    if (current.sends >= VERIFICATION_MAX_SENDS) {
      return { ok: false, reason: "resend_limit", sends: current.sends };
    }
    const code = newCode();
    try {
      await s.resend(existingId!, hash(code), now);
    } catch {
      return { ok: false, reason: "unavailable", sends: current.sends };
    }
    return {
      ok: true,
      id: existingId!,
      code,
      sends: current.sends + 1,
      expires_at: new Date(current.expires_at).toISOString(),
    };
  }

  const code = newCode();
  const expires_at = now + VERIFICATION_TTL_MINUTES * 60 * 1000;
  let id: string;
  try {
    id = await s.create({
      phone,
      code_hash: hash(code),
      expires_at,
      sent_at: now,
    });
  } catch {
    return { ok: false, reason: "unavailable", sends: sent };
  }
  return { ok: true, id, code, sends: 1, expires_at: new Date(expires_at).toISOString() };
}

export type CheckOutcome =
  | { ok: true; verified_at: string }
  | {
      ok: false;
      reason:
        | "unknown"
        | "expired"
        | "wrong_code"
        | "too_many_attempts"
        | "locked"
        | "unavailable";
      attempts_left?: number;
      retry_in_seconds?: number;
    };

export async function checkVerification(
  id: string | null,
  code: string,
): Promise<CheckOutcome> {
  if (!id) return { ok: false, reason: "unknown" };
  const s = await store();

  const entry = await s.get(id);
  if (!entry) return { ok: false, reason: "unknown" };

  const now = Date.now();
  const lockedUntil = await s.lockedUntil(entry.phone, now);
  if (lockedUntil > now) {
    await s.invalidate(id);
    return {
      ok: false,
      reason: "locked",
      retry_in_seconds: Math.ceil((lockedUntil - now) / 1000),
    };
  }

  if (entry.expires_at < now) {
    await s.invalidate(id);
    return { ok: false, reason: "expired" };
  }
  if (entry.attempts >= VERIFICATION_MAX_ATTEMPTS) {
    await s.invalidate(id);
    await s.lock(entry.phone, now + VERIFICATION_LOCK_MINUTES * 60 * 1000);
    return { ok: false, reason: "too_many_attempts" };
  }

  const given = Buffer.from(hash(code));
  const wanted = Buffer.from(entry.code_hash);
  const same = given.length === wanted.length && timingSafeEqual(given, wanted);

  if (!same) {
    const attempts = await s.countAttempt(id);
    const left = VERIFICATION_MAX_ATTEMPTS - attempts;
    if (left <= 0) {
      await s.invalidate(id);
      /* §19's "then a 15-minute lock". Set here rather than on the next request,
         because the entry that was counting the attempts is now spent. */
      await s.lock(entry.phone, now + VERIFICATION_LOCK_MINUTES * 60 * 1000);
      return { ok: false, reason: "too_many_attempts", attempts_left: 0 };
    }
    return { ok: false, reason: "wrong_code", attempts_left: left };
  }

  const verified_at = new Date().toISOString();
  try {
    await s.confirm(id, verified_at);
  } catch {
    /* The one place a failed write must not report success: the gate reads this
       record, so a parent told "confirmed" whose record never landed would be
       refused on the very next write with nothing to explain it. */
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, verified_at };
}

/**
 * The submit gate. A write that claims a phone must present the cookie of a
 * verification that confirmed *that* phone — so a client can't set
 * `phone_verified: true` and a stale cookie can't carry a different number.
 */
export async function verifiedPhone(
  id: string | null,
): Promise<{ phone: string; verified_at: string } | null> {
  if (!id) return null;
  const entry = await (await store()).get(id);
  if (!entry || !entry.verified_at) return null;
  /* The window is applied by the store's own read; this is the belt on it, and
     it is what the constant's promise actually means. */
  if (entry.expires_at + SESSION_MS < Date.now()) return null;
  return { phone: entry.phone, verified_at: entry.verified_at };
}

/** True when the app must have a verified phone before it stores anything. */
export function verificationRequired(): boolean {
  return process.env.SEED_REQUIRE_VERIFICATION !== "0";
}

/**
 * QA switch. Returns the code in the response so the flow can be walked before the
 * A2P campaign clears — on a laptop, and **on the server too** (14 Aug). It used to
 * refuse under `NODE_ENV=production` whatever the env said. That was right about
 * the risk and wrong about the need: pilot-scale testing runs on the deployed app,
 * not on a laptop, and refusing there meant the server could store nothing at all
 * until Twilio was provisioned. One switch now, same behaviour everywhere.
 *
 * **What it switches off is not the OTP.** The code is still six digits, still
 * expires in 5 minutes, still capped at 3 sends and 3 guesses, and still locks the
 * number for 15 — the whole of §19 runs exactly as it will in production. What goes
 * is the *proof of possession*: anyone who can read the screen can confirm any
 * number they type. So while it is on, two things stop being true — invariant 11 no
 * longer means a real parent stands behind a stored profile, and a `consents` row
 * records permission for a number nobody proved they hold. The second is the
 * expensive half: `/admin/consents` is the A2P §3.3 defence file, and a TCPA
 * complaint arrives about a phone number.
 *
 * So it is **testing-only, and it comes out before the first real founding
 * contributor** — the same deadline as the `pando` starter password. Until then the
 * screen it lands on says so itself: "QA mode: the code is … Real parents never see
 * this." A hidden bypass would be worse than no bypass; this one is on screen.
 */
export function devCodesEnabled(): boolean {
  return process.env.SEED_VERIFY_DEV_CODES === "1";
}
