import "server-only";

import { NextResponse } from "next/server";
import {
  LIMITS,
  clientAddress,
  consume,
  type RateLimitName,
  type RateVerdict,
} from "@/lib/rate-limits";

/**
 * M15.4 — the counters, and one call a route makes.
 *
 * The policy is in `lib/rate-limits.ts` (pure, tested). This is the store and
 * the glue, and it is deliberately the smaller half.
 *
 * ## Why in-process, and what that honestly does not do
 *
 * A `Map`, in the app's own memory. That is the same store the admin login
 * throttle has used since 31 July, and it is adequate here for one specific
 * reason: **Pando runs as a single standalone container** behind Traefik on one
 * VPS (CLAUDE.md, 5 Aug), so there is one process and it sees every request.
 *
 * The two things it cannot do, stated rather than discovered later:
 *
 *  - **It forgets on deploy.** A restart clears every counter, so somebody being
 *    limited gets a fresh budget. At pilot scale that is an inconvenience for an
 *    attacker and invisible to everybody else.
 *  - **It does not span replicas.** The day this runs as two containers, each
 *    enforces its own copy of the limit and the effective ceiling doubles. That
 *    is the moment to move the counters into Postgres or Redis — and the shape
 *    to move is exactly `consume`, which is pure and takes a bucket, so the
 *    store is the only thing that changes.
 *
 * Redis was not added for this. It would be a new dependency, a new thing to
 * deploy and a new outage mode (what does the app do when the limiter is down?)
 * in exchange for a property this deployment does not have yet.
 *
 * ## Memory is bounded
 *
 * One entry per (limit, address) pair, swept lazily: every call drops expired
 * buckets for its own key, and `MAX_KEYS` caps the map so a scan across many
 * spoofed addresses cannot grow it without limit. When the cap is hit the
 * oldest-resetting entries go first — which is the least damaging thing to
 * forget, because they were closest to expiring anyway.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Enough for every real caller in a pilot of ~350 parents many times over, and
 * small enough that a spray of forged addresses cannot exhaust the container's
 * memory before the cap bites.
 */
const MAX_KEYS = 20_000;

function evictIfNeeded(now: number): void {
  if (buckets.size <= MAX_KEYS) return;
  /* Expired first — free, and correct. */
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size <= MAX_KEYS) return;
  /* Still over: drop the soonest-to-reset, which is the least information lost. */
  const byReset = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of byReset.slice(0, Math.ceil(buckets.size - MAX_KEYS))) {
    buckets.delete(key);
  }
}

/** The number of proxies between the internet and this process. */
function trustedProxies(): number {
  const raw = process.env.TRUSTED_PROXIES;
  const n = raw === undefined ? 1 : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/**
 * Count one request against a limit.
 *
 * Exported separately from the response helper so a route that wants to do
 * something other than return a 429 — log, degrade, serve a cached answer — can.
 * Nothing does today; it is exported because the alternative is a helper that
 * both counts and returns, which is impossible to test without a fake response.
 */
export function checkRate(
  request: Request,
  name: RateLimitName,
  now = Date.now(),
): RateVerdict & { address: string | null } {
  const address = clientAddress(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    trustedProxies(),
  );

  /**
   * No usable address ⇒ allowed. The one place this fails open, and
   * `lib/rate-limits.ts` explains why: refusing every request from a deployment
   * whose proxy headers are shaped unexpectedly takes the tool offline for
   * people who did nothing wrong, which is a worse failure than a missing
   * limit behind an invite-gated screen.
   *
   * It is logged, because a deployment where this is always null has a
   * misconfigured proxy and nobody would otherwise find out.
   */
  if (!address) {
    console.warn("[rate] no client address — request allowed", { limit: name });
    return { ok: true, remaining: LIMITS[name].max, retryAfter: 0, address: null };
  }

  const key = `${name}:${address}`;
  const { bucket, verdict } = consume(buckets.get(key), LIMITS[name], now);
  buckets.set(key, bucket);
  evictIfNeeded(now);

  if (!verdict.ok) {
    /* Counts and enums only (invariant 7). An IP is not in the list that
       invariant names — it is not a phone, a name or free text — but it is
       still identifying, so only the limit and the wait are logged. */
    console.warn("[rate] refused", { limit: name, retry_after: verdict.retryAfter });
  }

  return { ...verdict, address };
}

/**
 * The one line a route adds: `const limited = rateLimited(request, "…"); if
 * (limited) return limited;`
 *
 * Returns a response only when the caller should be refused, so the happy path
 * reads as a guard clause and there is no wrapper to forget to unwrap.
 *
 * **429 with `Retry-After`**, which is the part that matters for a well-behaved
 * client: Twilio, Stripe and every fetch library know what to do with it, and
 * without it a retry loop hammers a locked key forever. The body carries the
 * same `error` shape every other route in this app uses, so the client's
 * existing error handling shows the message rather than "something went wrong".
 */
export function rateLimited(
  request: Request,
  name: RateLimitName,
): NextResponse | null {
  const verdict = checkRate(request, name);
  if (verdict.ok) return null;
  return NextResponse.json(
    { error: LIMITS[name].message, retry_after: verdict.retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(verdict.retryAfter),
        /* Draft-standard, and worth sending: a client that reads them can back
           off before being refused rather than after. */
        "RateLimit-Limit": String(LIMITS[name].max),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(verdict.retryAfter),
      },
    },
  );
}

/** Test seam. Never called by the app. */
export function __resetRateLimits(): void {
  buckets.clear();
}
