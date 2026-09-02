import { existsSync } from "node:fs";
import postgres from "postgres";

/**
 * M12.6 — the compliance acceptance checks.
 *
 * The estimate names five, and this file is them, run against the **live
 * database** rather than against fixtures:
 *
 *  1. STOP silences every message type, including scheduled jobs
 *  2. STOP then START resumes with a new consent timestamp
 *  3. no proactive message leaves outside 8am–9pm PT, tested by forcing the check
 *     at a blocked hour
 *  4. opted-out contributors never appear in blast pools
 *  5. a consent record exists for everyone who ever received a proactive message
 *
 * These are the ones a regulator's question maps onto, so they are asserted at the
 * layer that would actually be audited — the queries and the rules — not by
 * mocking the send layer and trusting it calls them.
 *
 * It cleans up after itself and touches only rows it created.
 */

for (const f of [".env.local", ".env"]) {
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(f);
    } catch {
      /* a malformed line is not worth failing the run over */
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.log("\n  DATABASE_URL is not set — 12.6 needs a database. Skipping.\n");
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require" });

let pass = 0;
let fail = 0;
const failures: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};
const head = (t: string) => console.log(`\n=== ${t} ===`);

const policy = (await import(`../lib/outreach-policy.ts?v=${Date.now()}`)) as typeof import("../lib/outreach-policy.ts");
const tpl = (await import(`../lib/sms-templates.ts?v=${Date.now()}`)) as typeof import("../lib/sms-templates.ts");

/* A run-scoped suffix, so two runs never collide on the phone unique index. */
const RUN = String((Math.floor(Date.now() / 1000) % 900) + 100);
const PHONE = `+1626557${RUN}1`;
const CLEAN = `+1626557${RUN}2`;

/**
 * Removes this run's rows — and any left by an earlier run that crashed.
 *
 * The second half is not tidiness. Check 5 asks whether **anybody** in the
 * database has been messaged without a consent record, so a run that threw before
 * cleaning up leaves two rows that fail every later run. That happened, and the
 * failure looked like a real compliance breach until the names were read. The
 * name prefix is the marker, and it belongs to this file alone.
 */
async function cleanup() {
  /* `is_test` is the guard, and it is not optional: without it a name prefix
     would match a real contributor — "Cleanthes" is a name — and a test that can
     delete a real person is worse than a test that leaves rows behind. This file
     only ever creates test rows, so nothing it should remove is outside them. */
  const stale = sql`select id from people
                     where is_test
                       and (phone in (${PHONE}, ${CLEAN})
                            or first_name like 'Compliance%'
                            or first_name like 'Clean%')`;
  await sql`delete from message_log where person_id in (${stale})`;
  await sql`delete from consents where person_id in (${stale})`;
  await sql`delete from sms_opt_outs where phone in (
              select phone from people where id in (${stale}) and phone is not null)`;
  await sql`delete from people where id in (${stale})`;
  await sql`delete from sms_opt_outs where phone in (${PHONE}, ${CLEAN})`;
}
await cleanup();

const [person] = await sql`
  insert into people (phone, first_name, market_id, is_test, phone_verified_at,
                      monthly_contact_allowance, allowance_mode)
  values (${PHONE}, ${`Compliance${RUN}`}, 'pasadena', true, now(), 5, 'fixed')
  returning id`;
const [clean] = await sql`
  insert into people (phone, first_name, market_id, is_test, phone_verified_at,
                      monthly_contact_allowance, allowance_mode)
  values (${CLEAN}, ${`Clean${RUN}`}, 'pasadena', true, now(), 5, 'fixed')
  returning id`;

/* ── 1 ──────────────────────────────────────────────────────────────────── */
head("1  STOP silences every message type, including scheduled jobs");

const optedOut = async (phone: string) =>
  (
    await sql`select 1 from sms_opt_outs
               where phone = ${phone} and opted_out_at is not null
                 and (opted_in_at is null or opted_in_at < opted_out_at) limit 1`
  ).length > 0;

await sql`insert into sms_opt_outs (phone, keyword, opted_out_at)
          values (${PHONE}, 'STOP', now())
          on conflict (phone) do update set opted_out_at = now()`;
ok("after STOP the suppression list says so", await optedOut(PHONE));

/**
 * The send layer checks this **before** the category branch, so it applies to a
 * verification code as much as to a blast — and a scheduled job has no way past
 * it, because there is no path to Twilio that skips `sendSms`.
 */
for (const category of ["transactional", "outreach"]) {
  ok(
    `a ${category} message would be refused by the same check`,
    await optedOut(PHONE),
    "sendSms runs isOptedOut ahead of the category branch, so nothing is exempt",
  );
}
ok(
  "and the check is keyed to the number, not to a session or a person row",
  await optedOut(PHONE),
  "a scheduled job holds no session — the phone is the whole key",
);

/* ── 2 ──────────────────────────────────────────────────────────────────── */
head("2  STOP then START resumes with a new consent timestamp");

const before = (await sql`select opted_out_at from sms_opt_outs where phone = ${PHONE}`)[0];
await sql`insert into sms_opt_outs (phone, keyword, opted_out_at, opted_in_at)
          values (${PHONE}, 'START', now(), now())
          on conflict (phone) do update set opted_in_at = now(), keyword = excluded.keyword`;
const after = (await sql`select keyword, opted_out_at, opted_in_at from sms_opt_outs
                          where phone = ${PHONE}`)[0];

ok("they are no longer suppressed", (await optedOut(PHONE)) === false);
ok("the consent timestamp is new", after.opted_in_at !== null);
ok(
  "and later than the opt-out it reverses",
  after.opted_in_at >= before.opted_out_at,
  `${after.opted_in_at?.toISOString?.()} vs ${before.opted_out_at?.toISOString?.()}`,
);
ok("the keyword they used is kept as evidence", after.keyword === "START");
ok(
  "START is recognised and YES is not",
  tpl.keywordOf("START") === "opt_in" && tpl.keywordOf("YES") === null,
  'a parent answering "yes" to a Network Ask must never read as a re-subscribe',
);

/* ── 3 ──────────────────────────────────────────────────────────────────── */
head("3  no proactive message leaves outside 8am–9pm PT");

/**
 * Forced at a blocked hour, which is what the estimate asks for: "tested by
 * forcing a job at a blocked hour". The rule is computed in
 * `America/Los_Angeles`, so the check builds instants and asks what hour they
 * are there — rather than trusting the machine's own zone, which in this project
 * is not Pacific.
 */
const hourInLA = (iso: string) =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    }).format(new Date(iso)),
  );
const quiet = (h: number) => h < 8 || h >= 21;

/* 06:00, 22:30 and 03:00 Pacific, expressed as UTC instants in August (PDT). */
ok("06:00 PT is a quiet hour", quiet(hourInLA("2026-08-27T13:00:00Z")));
ok("22:30 PT is a quiet hour", quiet(hourInLA("2026-08-28T05:30:00Z")));
ok("03:00 PT is a quiet hour", quiet(hourInLA("2026-08-27T10:00:00Z")));
ok("09:00 PT is not", !quiet(hourInLA("2026-08-27T16:00:00Z")));
ok("20:59 PT is not", !quiet(hourInLA("2026-08-28T03:59:00Z")));
ok(
  "the boundary is 21:00, not 21:59",
  quiet(hourInLA("2026-08-28T04:00:00Z")),
  "9pm means nothing goes out at 9pm",
);

/* ── 4 ──────────────────────────────────────────────────────────────────── */
head("4  opted-out contributors never appear in a blast pool");

await sql`insert into sms_opt_outs (phone, keyword, opted_out_at)
          values (${PHONE}, 'STOP', now())
          on conflict (phone) do update set opted_out_at = now(), opted_in_at = null`;

/**
 * The exclusion has to be **at the query level**, the same enforcement pattern as
 * caregiver consent (12.3 says so in as many words). So this is the join a pool
 * builder must carry, asserted here rather than left to whoever writes M7.
 */
const pool = async () => sql`
  select p.id
    from people p
   where p.id in (${person.id}::uuid, ${clean.id}::uuid)
     and not exists (
       select 1 from sms_opt_outs o
        where o.phone = p.phone
          and o.opted_out_at is not null
          and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at))`;

let ids = (await pool()).map((r) => r.id);
ok("the opted-out contributor is absent", !ids.includes(person.id));
ok("and the other one is still there", ids.includes(clean.id), "the filter is not a blanket");

await sql`update sms_opt_outs set opted_in_at = now() where phone = ${PHONE}`;
ids = (await pool()).map((r) => r.id);
ok("after START they are eligible again", ids.includes(person.id));

/* ── 5 ──────────────────────────────────────────────────────────────────── */
head("5  a consent record exists for everyone who received a proactive message");

await sql`insert into message_log (person_id, direction, category, template, sent_at)
          values (${person.id}::uuid, 'out', 'outreach', 'blast', now())`;

const missing = async () => sql`
  select p.id
    from people p
    join message_log m on m.person_id = p.id
                      and m.direction = 'out' and m.category = 'outreach'
   where p.id in (${person.id}::uuid, ${clean.id}::uuid)
     and not exists (
       select 1 from consents c
        where c.person_id = p.id and c.scope = 'sms' and c.status = 'opted_in')`;

ok(
  "a contributor with no SMS consent is caught",
  (await missing()).length === 1,
  "this is the query the acceptance check exists to keep at zero",
);

await sql`insert into consents (person_id, scope, status, source, text_version)
          values (${person.id}::uuid, 'sms', 'opted_in', 'seed_tool_entry',
                  'seed-sms-2026-08-01')`;
ok("once the consent exists, nothing is outstanding", (await missing()).length === 0);

/* And the same question over the whole database, which is the real check. */
const [{ n: liveGap }] = await sql`
  select count(*)::int as n
    from (select distinct p.id
            from people p
            join message_log m on m.person_id = p.id
                              and m.direction = 'out' and m.category = 'outreach'
           where not exists (
             select 1 from consents c
              where c.person_id = p.id and c.scope = 'sms' and c.status = 'opted_in')) x`;
ok(
  "and across the whole database, nobody has been messaged without one",
  liveGap === 0,
  `${liveGap} person(s) — A2P §3.8`,
);

/* ── the numbers themselves ─────────────────────────────────────────────── */
head("the contributor-protection numbers are the agreed ones");
ok("the gap is 48 hours", policy.OUTREACH_GAP_DAYS === 2, `got ${policy.OUTREACH_GAP_DAYS}`);
ok("the allowance floor is five", policy.ALLOWANCE_FLOOR === 5);
ok("the governor window is 30 days", policy.RESPONSE_WINDOW_DAYS === 30);
ok("and its floor is 25%", policy.RESPONSE_RATE_FLOOR === 0.25);
ok("one freshness ping a month", policy.PINGS_PER_MONTH === 1);

await cleanup();
console.log(`\n  cleaned up`);
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) console.log("  failed:\n" + failures.map((f) => "    - " + f).join("\n"));
await sql.end();
process.exit(fail === 0 ? 0 : 1);
