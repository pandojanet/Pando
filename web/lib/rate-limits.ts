/**
 * M15.4 — how often one caller may hit each public endpoint.
 *
 * Pure: the policy, the arithmetic and the client-address rule, with no store
 * and no request object. `lib/server/rate-limit.ts` holds the counters and the
 * glue. `npm run test:security` tests this exhaustively, which is the point of
 * the split — a limiter you cannot test is a limiter nobody knows the shape of.
 *
 * ## What was already protected, and what this is for
 *
 * Two things were throttled before this: **admin sign-in** (5 attempts, then a
 * 15-minute lock, per name — `lib/admin/auth.ts`) and the **OTP** (3 sends an
 * hour, 3 wrong guesses, then a 15-minute lock keyed to the *phone* — spec §19,
 * enforced in the database so clearing a cookie is not a way round it).
 *
 * Both of those are per *identity*, and that is the right key for them. What
 * neither can do is stop one machine working through many identities: a script
 * asking for a code for ten thousand numbers, or hammering the market search
 * until the pooler gives up. That is what this adds, and it is why the key here
 * is the caller rather than the account.
 *
 * **It does not replace either.** The OTP's per-phone lock is the one that
 * matters for a targeted attack; this is the one that matters for a broad one.
 *
 * ## One address is often many parents, and that set every number here
 *
 * The first version of these limits was tuned for an attacker and would have
 * broken a **group of parents signing up in the same room** — which is not an
 * edge case, it is Pando's distribution model. The invite link is "shared
 * privately inside parent groups, not published" (1.1), and parent groups meet:
 * a mums' meetup, a school pickup, a preschool coffee morning. Ten of them
 * behind one café or office NAT is one address to this limiter.
 *
 * `npm run test:e2e` is what surfaced it — the walk needs eleven code sends and
 * twenty-four writes, and it started failing with "Too many code requests from
 * here". That is the honest signal: **if a QA walk trips a limit, real people
 * will.** So the numbers below are sized for "a roomful of parents at once" and
 * the job of the per-address limit is only to stop a *script*.
 *
 * The protection that actually bounds a targeted attack is unchanged and lives
 * elsewhere: **3 sends an hour per phone**, then a 15-minute lock on the number
 * (§19, enforced in the database). Nothing here needs to be tight, because that
 * is already tight where it counts.
 *
 * ## The costs being defended, which is why the limits differ so much
 *
 *  - **A code send costs money and reputation.** Every request that gets past
 *    `/verify/start` is an SMS segment billed to Pando and a message a stranger
 *    did not ask for — which is exactly what gets a 10DLC campaign flagged. So
 *    it is the tightest limit here by an order of magnitude.
 *  - **A search costs a round trip to the pooler**, which CLAUDE.md measures at
 *    ~200ms warm and 1.3s cold. It is public reference data behind an
 *    invite-gated screen, so the limit is generous — the aim is to stop a scrape
 *    from starving real parents of connections, not to police browsing.
 *  - **A profile write costs rows.** Bounded already by invariant 11 (nothing
 *    about a named parent before the phone is verified), but `SEED_REQUIRE_
 *    VERIFICATION=0` and `SEED_VERIFY_DEV_CODES=1` both exist and both open
 *    that door for QA — so the limit is what stands there while they are on.
 *
 * ## What is deliberately *not* rate-limited, and why each is safe
 *
 *  - **The four webhooks** (`/api/sms/inbound`, `/api/sms/status`,
 *    `/api/stripe/webhook`, `/api/slack/events`) verify a signature before
 *    anything reads the request, and all four refuse when their secret is
 *    unset. A limit there would throttle Twilio and Stripe's own retries, which
 *    is how a delivery status or a payment gets lost — the opposite of hardening.
 *  - **`/api/jobs/run`** requires `JOBS_SECRET` and holds a database lock that
 *    makes a second concurrent run impossible (9.5).
 *  - **The admin endpoints** are behind a session that `proxy.ts` checks before
 *    the route runs, and sign-in itself is throttled per name.
 *  - **`/api/health`** is what a monitor polls. Limiting it would page somebody
 *    at 3am about a limiter.
 *
 * That list is asserted mechanically by `npm run test:security`: every route
 * under `app/api` must either verify a signature, require a secret, sit behind
 * the admin session, or appear in `LIMITS`. A new public route that does none of
 * those fails the suite — which is the only way this stays true.
 */

export interface RateLimit {
  /** Requests allowed inside the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * What to say when it trips. Plain, and never "you have been rate limited" —
   * the reader is far more likely to be a parent on a slow train than an
   * attacker, so it says what to do rather than what they did wrong.
   */
  message: string;
}

/**
 * Keyed by a name the route passes in, not by its path.
 *
 * A path would tie the policy to the URL, and two routes that should share a
 * budget (the two halves of verification) would then need two entries that can
 * drift apart. A name also survives a route being moved.
 */
export type RateLimitName =
  | "verify_start"
  | "verify_check"
  | "seed_write"
  | "market_read"
  | "caregiver_claim"
  | "invite_check";

export const LIMITS: Record<RateLimitName, RateLimit> = {
  /**
   * Three a minute, which is a roomful of parents rather than one.
   *
   * Still the tightest *write* here, because it is the only limit where every
   * request that gets through is billed and is a message somebody did not ask
   * for — and unsolicited volume is exactly what flags a 10DLC campaign. But it
   * is deliberately nowhere near as tight as it first was: at five in ten
   * minutes, six parents at one meetup would have locked each other out, and
   * the per-phone cap (3 an hour, then a 15-minute lock on the number) is what
   * makes a *targeted* attack pointless anyway.
   *
   * What thirty in ten minutes does stop is the thing this exists for: a script
   * working through a list wants thousands a minute, not three.
   */
  verify_start: {
    max: 30,
    windowSeconds: 600,
    message: "Too many code requests from here just now. Try again in a few minutes.",
  },

  /**
   * **Looser than the send, and that ordering is asserted.** A wrong code costs
   * Pando nothing, each send legitimately produces two or three checks (a
   * mistyped digit, a code read off a lock screen), and the per-phone rule
   * already ends the attempt after three guesses with a 15-minute lock on the
   * number. A check limit *tighter* than the send limit would refuse a parent
   * the second attempt at a code Pando had just charged itself to send.
   */
  verify_check: {
    max: 90,
    windowSeconds: 600,
    message: "Too many attempts from here. Wait a few minutes and try again.",
  },

  /**
   * A profile, a card, a completion. Generous, because the seed flow legitimately
   * writes several times as a parent works through it — cards save as they are
   * finished (13 Aug), so a chatty session is a dozen requests and a *shared
   * office network* could be several parents at once.
   */
  seed_write: {
    /* A single honest session is a dozen or so writes — cards save as they are
       finished (13 Aug) — so ten parents at one table is ~120, and the `test:e2e`
       walk alone makes twenty-four. */
    max: 200,
    windowSeconds: 300,
    message:
      "That didn't go through — too many saves from here at once. Your answers are safe on this phone; try again in a moment.",
  },

  /**
   * Search and the tap lists. The highest ceiling here: this fires on every
   * keystroke behind a debounce, and a parent picking a school from 357 records
   * genuinely makes a lot of requests.
   */
  market_read: {
    /* The highest ceiling here, and it has to be: this fires on every keystroke
       behind a debounce, a parent picking a school from 357 records makes a lot
       of requests, and several of them may be doing it at once from one
       address. */
    max: 600,
    windowSeconds: 60,
    message: "Too many searches at once. Give it a second.",
  },

  caregiver_claim: {
    /* A caregiver usually signs herself up alone, so this could be tight — but
       "usually" is not a reason to refuse the second one, and the flow already
       requires her own verified number. */
    max: 40,
    windowSeconds: 600,
    message: "Too many attempts from here. Wait a few minutes and try again.",
  },

  /**
   * The invite code check. Tighter than the rest of the seed flow because it is
   * the one endpoint whose answer tells you whether a guess was right — and a
   * code is a short string. It is a *soft* gate by design (12 Aug: an unknown
   * code still lets the parent in, without attribution), so guessing buys very
   * little; this makes it slow anyway.
   */
  invite_check: {
    /* Ten parents pasting a code and mistyping it once is twenty attempts, so
       twenty was exactly the wrong number. Guessing buys very little anyway —
       an unknown code still lets the parent in, without attribution (12 Aug) —
       and this only needs to make a dictionary attack slow. */
    max: 60,
    windowSeconds: 600,
    message: "Too many tries from here. Check the message the code came in, then try again.",
  },
};

export interface RateVerdict {
  ok: boolean;
  /** Requests left in this window. Zero when refused. */
  remaining: number;
  /** Seconds until the window resets — the `Retry-After` header's value. */
  retryAfter: number;
}

/**
 * A fixed-window counter, and the choice is deliberate.
 *
 * A sliding window or a token bucket is smoother and needs either a timestamp
 * list per key or a background refill — more memory and more moving parts for a
 * property nobody here needs. The known weakness of a fixed window is a burst
 * across the boundary (up to 2× `max` in one instant); at these limits that is
 * ten code requests rather than five, which is still nothing, and the per-phone
 * caps are what actually bound the damage.
 *
 * Pure so it can be stepped through in a test: given a bucket and a moment, it
 * returns the next bucket and the verdict. The store never decides anything.
 */
export function consume(
  bucket: { count: number; resetAt: number } | undefined,
  limit: RateLimit,
  now: number,
): { bucket: { count: number; resetAt: number }; verdict: RateVerdict } {
  const windowMs = limit.windowSeconds * 1000;

  /**
   * A limit of zero refuses everything, checked before anything else.
   *
   * Found by a test rather than by reading: the first version treated a missing
   * bucket as "fresh window, count 1, allow" without consulting `max`, so
   * `max: 0` let **one request through per window** — silently, and forever,
   * because the fresh-window branch never looks at the ceiling.
   *
   * Not reachable from `LIMITS` today, and worth fixing anyway: `max: 0` is the
   * obvious way to close an endpoint in a hurry (a scrape in progress, an
   * abused route), and a switch labelled "off" that is really "one at a time"
   * is the kind of quiet wrongness nobody would think to check for under
   * pressure.
   */
  if (limit.max <= 0) {
    return {
      bucket: bucket ?? { count: 0, resetAt: now + windowMs },
      verdict: { ok: false, remaining: 0, retryAfter: limit.windowSeconds },
    };
  }

  /* A missing or expired bucket starts a fresh window. Expiry is checked
     against `now` rather than swept on a timer, so a key nobody has touched
     since yesterday costs nothing to be right about. */
  if (!bucket || bucket.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    return {
      bucket: fresh,
      verdict: {
        ok: true,
        remaining: limit.max - 1,
        retryAfter: limit.windowSeconds,
      },
    };
  }

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  if (bucket.count >= limit.max) {
    /**
     * The count is **not** incremented on a refusal, so hammering a locked key
     * cannot push the reset further out. A limiter that punishes retries turns
     * a parent's impatient double-tap into a five-minute wait, and it is also
     * how a limiter becomes its own denial of service.
     */
    return { bucket, verdict: { ok: false, remaining: 0, retryAfter } };
  }

  const next = { count: bucket.count + 1, resetAt: bucket.resetAt };
  return {
    bucket: next,
    verdict: { ok: true, remaining: limit.max - next.count, retryAfter },
  };
}

/**
 * Which address in `x-forwarded-for` is the caller's.
 *
 * ## This is the part that is easy to get exactly backwards
 *
 * A reverse proxy **appends** the address it saw to any `X-Forwarded-For` the
 * request arrived with. So for a request that reached Traefik directly, the
 * header the app sees is `<whatever the client made up>, <the client's real
 * address>` — and the *leftmost* entry, which is the one every tutorial reaches
 * for, is entirely under the caller's control.
 *
 * Trusting it means a limiter that can be bypassed by sending one header, which
 * is worse than having no limiter at all: it looks like protection and is not.
 * So the address is taken **from the right**, skipping one entry per trusted
 * proxy — with exactly one in front of this app (Traefik owns 80/443 on the
 * VPS, per CLAUDE.md), that is the last entry.
 *
 * `TRUSTED_PROXIES` exists because that count is a deployment fact rather than
 * a code fact: putting Cloudflare in front would make it two, and getting it
 * wrong in that direction is the same bypass again.
 *
 * Returns null when there is no usable address, and the caller treats that as
 * **allow**. That is the one place this fails open, and it is deliberate: the
 * alternative is refusing every request from a deployment whose proxy headers
 * are shaped unexpectedly, which is the tool offline for people who did nothing
 * wrong — the same reasoning as the invite-code fallback.
 */
export function clientAddress(
  forwardedFor: string | null,
  realIp: string | null,
  trustedProxies = 1,
): string | null {
  if (forwardedFor) {
    const parts = forwardedFor
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    if (parts.length > 0) {
      /* From the right, one hop per trusted proxy. Clamped so a header with
         fewer entries than expected yields the leftmost rather than nothing —
         a short header means fewer proxies than configured, and the leftmost is
         then the only candidate there is. */
      const index = Math.max(0, parts.length - trustedProxies);
      return parts[index] ?? parts[0] ?? null;
    }
  }
  /* `x-real-ip` is set by the proxy itself rather than appended to, so it is not
     client-controllable in the same way — but it is only consulted second,
     because a proxy that sets both is telling us more with the appended list. */
  return realIp && realIp.trim() !== "" ? realIp.trim() : null;
}
