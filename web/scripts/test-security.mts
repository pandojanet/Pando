/**
 * M15.4 — security hardening, asserted rather than asserted-in-a-comment.
 *
 * The estimate's row is "Rate limiting, database access rules, verifying
 * caregivers can't be queried unless consented and active, ensuring personal
 * data isn't logged, and validating all webhooks." Four of those five are
 * properties of the *whole codebase* rather than of one function, which is why
 * most of this suite reads the source tree instead of calling anything.
 *
 * That is the only way any of it stays true. A comment saying "every webhook is
 * signed" is true on the day it is written; a test that walks `app/api` and
 * fails on a route that is neither signed, secret-gated, session-gated nor
 * rate-limited is true on the day somebody adds the next one.
 *
 * Run: `npm run test:security`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const limits = (await import(`../lib/rate-limits.ts?v=${Date.now()}`)) as typeof import(
  "../lib/rate-limits.ts"
);

let failures = 0;
let checks = 0;
function ok(what: string, cond: boolean, detail = "") {
  checks++;
  if (cond) console.log(`  ok    ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ── 1. the limiter's arithmetic ────────────────────────────────────────────── */

console.log("=== 15.4: the fixed window ===");
{
  const limit = { max: 3, windowSeconds: 60, message: "" };
  const t0 = 1_000_000;

  let bucket: { count: number; resetAt: number } | undefined;
  const step = (at: number) => {
    const result = limits.consume(bucket, limit, at);
    bucket = result.bucket;
    return result.verdict;
  };

  const first = step(t0);
  ok("the first request is allowed", first.ok);
  ok("and reports what is left", first.remaining === 2, String(first.remaining));
  ok("the second and third too", step(t0 + 1).ok && step(t0 + 2).ok);

  const fourth = step(t0 + 3);
  ok("the fourth is refused", !fourth.ok);
  ok("with nothing remaining", fourth.remaining === 0);
  ok(
    "and a Retry-After a client can act on",
    fourth.retryAfter > 0 && fourth.retryAfter <= 60,
    String(fourth.retryAfter),
  );

  /**
   * The rule that stops a limiter becoming its own denial of service: hammering
   * a locked key must not push the reset further out, or an impatient
   * double-tap turns into a five-minute wait.
   */
  const countBefore = bucket!.count;
  step(t0 + 4);
  step(t0 + 5);
  ok("a refused request does not increment the count", bucket!.count === countBefore);
  ok("nor move the reset", bucket!.resetAt === t0 + 60_000);

  /* The window is fixed, so it opens fresh rather than sliding. */
  const afterWindow = step(t0 + 60_001);
  ok("the window resets", afterWindow.ok && afterWindow.remaining === 2);

  ok(
    "a limit of zero refuses everything",
    !limits.consume(undefined, { max: 0, windowSeconds: 60, message: "" }, t0).verdict.ok,
  );
}

/* ── 2. the client address, which is the part that is easy to invert ───────── */

console.log("\n=== 15.4: X-Forwarded-For is read from the right ===");
{
  /**
   * The whole point. A proxy **appends** the address it saw, so for a request
   * that reached Traefik directly the header is `<whatever the client made up>,
   * <the client's real address>`. Taking the leftmost — which every tutorial
   * does — is trusting a value the caller controls, and a limiter that can be
   * bypassed with one header is worse than none: it looks like protection.
   */
  ok(
    "with one trusted proxy, the last entry wins",
    limits.clientAddress("1.2.3.4, 203.0.113.9", null, 1) === "203.0.113.9",
    String(limits.clientAddress("1.2.3.4, 203.0.113.9", null, 1)),
  );
  ok(
    "so a forged leading entry is ignored",
    limits.clientAddress("9.9.9.9, 9.9.9.9, 203.0.113.9", null, 1) === "203.0.113.9",
  );
  ok(
    "two trusted proxies skip two hops",
    limits.clientAddress("1.1.1.1, 203.0.113.9, 10.0.0.1", null, 2) === "203.0.113.9",
  );
  ok(
    "a single entry is the client",
    limits.clientAddress("203.0.113.9", null, 1) === "203.0.113.9",
  );
  /* A header shorter than the configured hop count means fewer proxies than
     expected; the leftmost is then the only candidate there is. */
  ok(
    "a short header falls back to the leftmost rather than to nothing",
    limits.clientAddress("203.0.113.9", null, 3) === "203.0.113.9",
  );
  ok("whitespace is trimmed", limits.clientAddress("  203.0.113.9  ", null, 1) === "203.0.113.9");
  ok(
    "x-real-ip is the fallback",
    limits.clientAddress(null, "203.0.113.9", 1) === "203.0.113.9",
  );
  ok("and nothing means nothing", limits.clientAddress(null, null, 1) === null);
  ok("an empty header is not an address", limits.clientAddress("", "", 1) === null);
  ok(
    "nor is a header of separators",
    limits.clientAddress(", ,", null, 1) === null,
    String(limits.clientAddress(", ,", null, 1)),
  );
}

console.log("\n=== 15.4: the limits themselves are sane ===");
{
  for (const [name, limit] of Object.entries(limits.LIMITS)) {
    ok(`${name} allows something`, limit.max > 0, String(limit.max));
    ok(`${name} has a window`, limit.windowSeconds > 0);
    /* A message a parent might read, not a status code. */
    ok(
      `${name} says what to do`,
      limit.message.length > 20 && !/rate limit/i.test(limit.message),
      limit.message,
    );
  }
  /**
   * The **relationships** that matter, not a global minimum.
   *
   * The first version of this asserted "sending a code is the tightest limit in
   * the app", which was true and was the wrong shape: it made the send limit
   * hostage to every other number, so loosening the search ceiling for a
   * roomful of parents would have failed a test about SMS billing. What
   * actually has to hold is a pair of orderings, each with its own reason.
   */
  const perMinute = (n: keyof typeof limits.LIMITS) =>
    limits.LIMITS[n].max / (limits.LIMITS[n].windowSeconds / 60);
  const rates = JSON.stringify(
    Object.fromEntries(
      Object.keys(limits.LIMITS).map((n) => [
        n,
        perMinute(n as keyof typeof limits.LIMITS),
      ]),
    ),
  );

  /* A send is billed and is an unsolicited message; a check is free. A check
     limit tighter than the send limit would refuse a parent the second attempt
     at a code Pando had just paid to send them. */
  ok(
    "sending a code is tighter than checking one",
    perMinute("verify_start") < perMinute("verify_check"),
    rates,
  );

  /* Reads are cheap and constant; writes cost rows, money or messages. */
  ok(
    "every write limit is tighter than the read limit",
    (["verify_start", "verify_check", "seed_write", "caregiver_claim", "invite_check"] as const)
      .every((n) => perMinute(n) < perMinute("market_read")),
    rates,
  );

  /**
   * And the floor that keeps this honest about real use. Pando's invite link is
   * shared inside parent groups and parent groups *meet*, so one café or office
   * NAT is routinely ten parents. Any limit that cannot absorb that is a limit
   * that will refuse a real signup — and `test:e2e` is the canary: its walk
   * needs eleven code sends and twenty-four writes from one address.
   */
  ok(
    "no limit is tight enough to refuse a roomful of parents",
    Object.entries(limits.LIMITS).every(([, l]) => l.max >= 30),
    rates,
  );
}

/* ── 3. every route is protected by something ──────────────────────────────── */

console.log("\n=== 15.4: no public route is unguarded ===");
{
  const API = "app/api";
  const routes: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") routes.push(full);
    }
  })(API);

  ok("there are routes to check", routes.length > 10, String(routes.length));

  /**
   * The four ways a route may be reachable, and every route must use one.
   *
   *  - a **signature** over the request (the webhooks)
   *  - a **secret** it requires (the jobs runner)
   *  - the **admin session**, which `proxy.ts` checks before the route runs
   *  - a **rate limit**, for the genuinely public ones
   *
   * `/api/health` is the single exception, named here rather than pattern-
   * matched: it is what a monitor polls, and limiting it would page somebody at
   * 3am about a limiter.
   */
  const EXEMPT = new Set([
    /* What a monitor polls. Limiting it would page somebody at 3am about a
       limiter. */
    "health",
    /**
     * Configuration, not data: three booleans that are the same for every
     * caller, no database, no writes, no body, and `export function GET()`
     * takes no request to key a limit on. Cached 15 seconds.
     *
     * It does disclose `dev_codes: true` while QA mode is on, which is a real
     * signal — but not a secret one: the flow says "QA mode … real parents
     * never see this" on screen throughout (14 Aug), and that switch comes off
     * before the first real founding contributor either way.
     */
    "seed/verify/status",
  ]);
  const unguarded: string[] = [];
  const guards: Record<string, string> = {};

  for (const path of routes) {
    const name = relative(API, path).replace(/[\\/]route\.ts$/, "").replace(/\\/g, "/");
    if (EXEMPT.has(name)) {
      guards[name] = "exempt (monitored endpoint)";
      continue;
    }
    const src = readFileSync(path, "utf8");
    /* Deliberately loose: any function whose name ends in `Signature`. The
       first version listed the four by name and missed `checkSlackSignature` —
       reporting a signed route as unguarded, which is the way a structural test
       cries wolf and then gets ignored. */
    const signed = /\b\w*Signature\b/.test(src);
    const secret = /JOBS_SECRET/.test(src);
    const session = /readAdminSession|ADMIN_COOKIE/.test(src);
    const limited = /rateLimited\(request/.test(src);

    if (signed) guards[name] = "signature";
    else if (secret) guards[name] = "secret";
    else if (session) guards[name] = "admin session";
    else if (limited) guards[name] = "rate limit";
    else unguarded.push(name);
  }

  for (const [name, guard] of Object.entries(guards).sort()) {
    console.log(`        ${name.padEnd(24)} ${guard}`);
  }
  ok(
    "every route is behind a signature, a secret, the session, or a limit",
    unguarded.length === 0,
    unguarded.join(", "),
  );

  /**
   * And the four webhooks specifically, by name — because "is signed" is not
   * enough for these: an endpoint that skips verification when its secret is
   * missing is unauthenticated the moment somebody mis-deploys, and silently.
   * All four must **refuse** in that case, which is the `not_configured` branch.
   */
  const WEBHOOKS = [
    "sms/inbound",
    "sms/status",
    "stripe/webhook",
    "slack/events",
  ];
  for (const hook of WEBHOOKS) {
    const src = readFileSync(join(API, hook, "route.ts"), "utf8");
    ok(`${hook} verifies before reading the request`, /Signature/.test(src));
    ok(
      `${hook} refuses rather than proceeding`,
      /40[03]|403|Unverified|Unauthorized/.test(src),
      "no refusal branch found",
    );
  }
}

/* ── 4. invariant 1, at the query level ────────────────────────────────────── */

console.log("\n=== invariant 1: a caregiver reaches an answer only when all four hold ===");
{
  /**
   * The estimate names this one explicitly: "verifying caregivers can't be
   * queried unless consented and active". The invariant is stronger than that
   * — `consent_status = 'consented' AND active AND discoverable AND is_adult` —
   * and CLAUDE.md records the measurement that shows why the extra two matter:
   * of ten caregivers in the demo cohort, three pass consented+active and only
   * **two** also pass discoverable, so the estimate's two-condition version
   * would surface a caregiver who had said no to exactly this.
   *
   * Checked in the source of the one module that retrieves them, because that
   * is where it has to be true — enforced "at the query level" rather than
   * filtered afterwards.
   */
  const src = readFileSync("lib/server/repo/retrieval.ts", "utf8");
  for (const condition of ["consented", "active", "discoverable", "is_adult"]) {
    ok(`retrieval requires ${condition}`, src.includes(condition));
  }
  /**
   * And `caregivers_answerable`, the view whose comment calls it the safe read.
   *
   * **This is the check that found something.** The view was created in
   * `0001` filtering on `consented AND active` only, while its own comment
   * said "matching, SMS answers and exports all read this — never
   * `caregivers`". Two conditions short of invariant 1, and `discoverable` is
   * the one that matters: measured against the live demo cohort, **three**
   * caregivers pass consented+active and only **two** also pass discoverable —
   * so a caller that believed the comment would have surfaced somebody who
   * consented to being listed and declined to appear in answers.
   *
   * Not a live bug (nothing read the view, and `retrieval.ts` carries the
   * conditions inline), but a dormant trap with a reassuring label, which is
   * worse than no view: the next person needing "the safe read" would find it
   * and it would look right. `drizzle/0030` fixes it, and this reads the
   * latest definition rather than `0001` — a migration is never edited in
   * place, so the newest `CREATE OR REPLACE` is the one in force.
   */
  const views = readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join("drizzle", f), "utf8"))
    .filter((sql) => /CREATE OR REPLACE VIEW caregivers_answerable/.test(sql));
  const view = views[views.length - 1] ?? "";
  ok("the answerable view exists", view !== "");
  /* The clause, not the word: `discoverable` appears in the SELECT list too,
     so a bare `includes` would pass on the broken version. */
  for (const condition of [
    /consent_status\s*=\s*'consented'/,
    /AND\s+c\.active/,
    /AND\s+c\.discoverable/,
    /AND\s+c\.is_adult/,
  ]) {
    ok(`the view filters on ${String(condition)}`, condition.test(view));
  }
  /**
   * `introducible` must **not** be a filter. Invariant 1 excludes it in so many
   * words — being in an answer and being introduced are different amounts of
   * exposure — so it stays a selected column a caller can read.
   */
  ok(
    "and does not filter on introducible, which is a further step",
    !/AND\s+c\.introducible/.test(view) && /c\.introducible/.test(view),
  );

  /**
   * Invariant 2 is the table's job rather than the view's: `is_adult` is
   * NOT NULL with `CHECK (is_adult)`, so a non-adult caregiver cannot be
   * stored at all. The view's condition above is belt and braces against a
   * future migration relaxing the CHECK.
   */
  const baseline = readFileSync("drizzle/0000_baseline.sql", "utf8");
  ok(
    "no caregiver under 18 can be stored in the first place",
    /CONSTRAINT "adults_only" CHECK/.test(baseline),
  );
}

/* ── 5. invariant 7, in the code that logs ─────────────────────────────────── */

console.log("\n=== invariant 7: no phone, no name, no free text in a log ===");
{
  /**
   * "Ensuring personal data isn't logged", and the reason this is a *test* is
   * that the repo has already paid for it once: CLAUDE.md records `withDb`
   * falling back to a wrapper's `message`, which drizzle builds from the
   * rendered SQL **and every bind parameter** — so one failed profile write put
   * a parent's phone, both names, their neighborhood, their child's age and the
   * whole `raw_answers` blob on stdout.
   *
   * A grep is a blunt instrument, so it looks for the specific shapes that went
   * wrong rather than for the word "log": a console call whose argument
   * mentions a phone, a name or a body.
   */
  const suspicious: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        const src = readFileSync(full, "utf8");
        for (const call of src.match(/console\.(log|info|warn|error)\([^;]*/g) ?? []) {
          /* `phone:`, `body:`, `name:` as a *logged field* — not the words in a
             comment, and not `has_phone`/`length` which are counts. */
          if (/\b(phone|body|first_name|last_name|question_text|answer_text)\s*:/.test(call)) {
            suspicious.push(`${full}: ${call.slice(0, 90).replace(/\s+/g, " ")}`);
          }
        }
      }
    }
  };
  walk("lib");
  walk("app");
  ok(
    "no console call logs a phone, a name or a message body",
    suspicious.length === 0,
    suspicious.join(" | "),
  );

  /* And the specific defence that was added after the leak: an unidentifiable
     error contributes its class name and nothing else. */
  const db = readFileSync("lib/server/db.ts", "utf8");
  ok(
    "a database error is still logged by its driver message only",
    /driverError/.test(db),
    "the `err.message` fallback must never come back — it renders every bind parameter",
  );
}

console.log(
  failures === 0
    ? `\n  ${checks} checks passed.`
    : `\n  ${failures} of ${checks} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
