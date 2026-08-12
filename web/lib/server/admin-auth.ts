import "server-only";

import {
  databaseCredentials,
  envCredentials,
  readToken,
  unavailableCredentials,
  verifyCredentials,
  type AdminSession,
  type CredentialSet,
} from "@/lib/admin/auth";
import { getDb } from "@/lib/server/db";
import { activeCredentials, stampSignIn } from "@/lib/server/repo/admin-users";

/**
 * Where the admin's credentials come from, and the only module that asks.
 *
 * `lib/admin/auth.ts` verifies against a `CredentialSet` and has no idea where it
 * was read; this resolves one, caches it, and is what every admin surface calls.
 *
 * ## The three answers, in order
 *
 *  1. **`DATABASE_URL` set and `admin_users` has somebody in it** → that table,
 *     and nothing else. The env vars are not consulted: a person deactivated in
 *     the table must not be let back in by an `ADMIN_CREDENTIALS` entry nobody
 *     remembered to remove.
 *  2. **Set, but the table is empty** → the environment. This is bootstrap, and
 *     the only reason the env path still exists: the deploy that creates the
 *     table must not take the admin dark before anyone has been added to it.
 *  3. **Set, and the read failed** → `unavailable`. Fails **closed** — no
 *     sign-in, no session accepted, the sign-in screen says so. Falling back to
 *     the environment here is precisely how a revoked admin gets their access
 *     back for the length of an outage. It costs nothing real: every admin page
 *     reads through the same database, so an admin who could sign in during an
 *     outage would have nothing to look at.
 *
 * With no `DATABASE_URL` at all there is no store to fail, so the environment is
 * the whole answer — which is what keeps the admin walkable on a laptop with
 * sample data.
 *
 * ## Why a cache, and what it costs
 *
 * `proxy.ts` runs before every admin request. Against the pooler a round trip is
 * ~200ms warm and ~1.3s cold (CLAUDE.md), so resolving credentials per request
 * would put that in front of every page and every asset. One read per minute per
 * process is the trade, and the two consequences are stated rather than hidden:
 *
 *  - a password rotation or a deactivation takes effect **within a minute**, not
 *    instantly — except on the sign-in path, which always re-reads;
 *  - a failed read is cached for five seconds only, so an outage recovers on its
 *    own rather than needing a restart.
 */

const TTL_MS = 60_000;
const ERROR_TTL_MS = 5_000;

const store = globalThis as typeof globalThis & {
  __pandoAdminCreds?: { at: number; ttl: number; set: CredentialSet } | null;
};

/** Called after anything that changes who may sign in. */
export function invalidateAdminCredentials(): void {
  store.__pandoAdminCreds = null;
}

async function resolve(): Promise<CredentialSet> {
  const db = getDb();
  if (!db) return envCredentials();

  try {
    const rows = await activeCredentials(db);
    if (rows.length === 0) return envCredentials();
    return databaseCredentials(rows);
  } catch (err) {
    /* No arguments logged, and never the driver's rendered query: this one
       carries password hashes (invariant 7's sibling). */
    console.error(
      "[admin:auth] credential store unreadable",
      err instanceof Error ? err.constructor.name : typeof err,
    );
    return unavailableCredentials();
  }
}

/**
 * The current credential set. `force` skips the cache — used by the sign-in
 * route, so somebody added a moment ago can sign in a moment later.
 */
export async function adminCredentials(force = false): Promise<CredentialSet> {
  const hit = store.__pandoAdminCreds;
  if (!force && hit && Date.now() - hit.at < hit.ttl) return hit.set;

  const set = await resolve();
  store.__pandoAdminCreds = {
    at: Date.now(),
    ttl: set.mode === "unavailable" ? ERROR_TTL_MS : TTL_MS,
    set,
  };
  return set;
}

/** The session a request carries, or null. Every admin surface starts here. */
export async function readAdminSession(
  token: string | undefined,
): Promise<AdminSession | null> {
  return readToken(token, await adminCredentials());
}

/**
 * Verifies a sign-in against the live store, and records that it happened.
 *
 * The stamp is deliberately not awaited into the result: it is a fact about a
 * sign-in already proved, and a write failure must not turn a correct password
 * into a rejection.
 */
export async function verifyAdminSignIn(
  user: unknown,
  password: unknown,
): Promise<{ ok: boolean; set: CredentialSet }> {
  const set = await adminCredentials(true);
  const ok = await verifyCredentials(user, password, set);

  if (ok && set.mode === "database" && typeof user === "string") {
    const db = getDb();
    if (db) {
      stampSignIn(db, user).catch(() => {
        /* Nothing to do and nothing to say: the sign-in stands. */
      });
    }
  }

  return { ok, set };
}
