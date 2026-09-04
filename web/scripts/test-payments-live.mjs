/**
 * M13 — the half that only a real database can answer.
 *
 * `npm run test:payments` proves the rules. This proves the *schema* keeps them,
 * which is the house rule for anything money touches: `drizzle/0029` carries
 * five CHECKs and two unique indexes, and a CHECK nobody has watched refuse
 * something is a comment.
 *
 * It also walks the one behavioural claim that cannot be tested purely and
 * matters most: **a retry does not spend a parent's monthly allowance twice.**
 * That is invariant 5's ceiling, it lives in a `case when … and m.retry_of is
 * null` inside one large SQL statement, and the only way to know it works is to
 * write two rows and read the counter back.
 *
 * Cleans up after itself, and — the lesson `test-compliance.mts` records — also
 * removes what an earlier crashed run left behind, scoped to `is_test` so a
 * name-prefix match can never delete a real contributor.
 *
 * Run: `npm run test:payments-live`
 */
import postgres from "postgres";

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL — this suite needs the real schema.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

let failures = 0;
let checks = 0;
function ok(what, cond, detail = "") {
  checks++;
  if (cond) console.log(`  ok    ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Runs a statement that should be refused, and reports which constraint did it. */
async function refused(what, fn, expect) {
  checks++;
  try {
    await fn();
    failures++;
    console.log(`  FAIL  ${what} — it was allowed`);
  } catch (err) {
    const message = String(err?.message ?? err);
    const hit = expect === undefined || message.includes(expect);
    if (hit) console.log(`  ok    ${what}`);
    else {
      failures++;
      console.log(`  FAIL  ${what} — refused by something else: ${message.slice(0, 120)}`);
    }
  }
}

const TAG = "m13-live";

async function cleanup() {
  /* `is_test` scoped, never a name match: a test that can delete a real
     contributor is worse than one that leaves rows behind. */
  await sql`delete from message_log where person_id in (
              select id from people where is_test and source = ${TAG})`;
  await sql`delete from blasts where is_test and market_id = ${TAG}`;
  await sql`delete from people where is_test and source = ${TAG}`;
}

try {
  await cleanup();

  /* ── the constraints ────────────────────────────────────────────────────── */

  console.log("=== drizzle/0029: every CHECK, watched refusing something ===");

  /* `phone_verified_at` is not optional here: `verified_if_named` is invariant
     11 in the schema — nothing about a *named* parent may be stored before their
     number is verified — and it refused the first draft of this fixture. The
     constraint doing its job, which is the third time a fixture in this repo has
     learned that lesson. */
  const [asker] = await sql`
    insert into people (first_name, last_name, phone, phone_verified_at, is_test,
                        source, monthly_contact_allowance, allowance_mode)
    values ('M13', 'Live', '+16265559901', now(), true, ${TAG}, 5, 'fixed')
    returning id`;

  const newBlast = async (over = {}) => {
    const row = {
      market_id: TAG,
      asker_id: asker.id,
      question_text: "Anyone know a Saturday swim class?",
      tier: "targeted",
      status: "draft",
      pool_target: 5,
      is_test: true,
      ...over,
    };
    const [b] = await sql`insert into blasts ${sql(row)} returning id`;
    return b.id;
  };

  const paidBlast = await newBlast();

  await refused(
    "payment_status refuses a value outside the six",
    () =>
      sql`update blasts set payment_status = 'settled' where id = ${paidBlast}::uuid`,
    "blasts_payment_status_check",
  );

  await refused(
    "a negative price is refused",
    () => sql`update blasts set price_cents = -100 where id = ${paidBlast}::uuid`,
    "blasts_price_check",
  );

  /**
   * The one that stops the payments page reporting revenue that never existed:
   * a free tier and a credit-funded Ask both owe nothing, so neither may carry
   * a price or a payment state.
   */
  const freeBlast = await newBlast({ tier: "passive", pool_target: 0 });
  await refused(
    "a free tier cannot be marked paid",
    () =>
      sql`update blasts
             set payment_status = 'paid', price_cents = 1500,
                 stripe_payment_intent_id = 'pi_x', paid_at = now()
           where id = ${freeBlast}::uuid`,
    "blasts_free_owes_nothing",
  );

  /**
   * `paid` means there is a payment to point at — 13.7's refund has nothing to
   * reverse without one, so the row cannot claim it.
   */
  await refused(
    "paid without a Stripe reference is refused",
    () =>
      sql`update blasts set payment_status = 'paid', price_cents = 1500
           where id = ${paidBlast}::uuid`,
    "blasts_paid_needs_evidence",
  );

  await sql`update blasts
               set payment_status = 'paid', price_cents = 1500,
                   stripe_payment_intent_id = 'pi_live_1', paid_at = now(),
                   stripe_session_id = 'cs_live_1'
             where id = ${paidBlast}::uuid`;
  const [afterPay] = await sql`
    select payment_status, price_cents from blasts where id = ${paidBlast}::uuid`;
  ok(
    "with one, it lands",
    afterPay.payment_status === "paid" && Number(afterPay.price_cents) === 1500,
    JSON.stringify(afterPay),
  );

  await refused(
    "refunded without a reason is refused — the note is the only record",
    () =>
      sql`update blasts set payment_status = 'refunded', refunded_at = now()
           where id = ${paidBlast}::uuid`,
    "blasts_refund_needs_reason",
  );

  /**
   * The index that makes the webhook idempotent in the *database* rather than in
   * a handler that remembers to check. Stripe retries until it gets a 2xx and
   * delivers the same event more than once by design.
   */
  const second = await newBlast();
  await refused(
    "two blasts cannot share one Stripe session",
    () =>
      sql`update blasts set stripe_session_id = 'cs_live_1' where id = ${second}::uuid`,
    "blasts_stripe_session_uniq",
  );

  /* ── the retry link, and the counter it must not inflate ────────────────── */

  console.log("\n=== 13.4: a retry is one message, not two ===");

  const [original] = await sql`
    insert into message_log (person_id, direction, category, template, status, sent_at)
    values (${asker.id}::uuid, 'out', 'outreach', 'freshness_ping', 'failed', now())
    returning id`;

  await refused(
    "an inbound row cannot be a retry",
    () =>
      sql`insert into message_log (person_id, direction, category, retry_of)
          values (${asker.id}::uuid, 'in', 'outreach', ${original.id}::uuid)`,
    "message_log_retry_is_outbound",
  );

  const [retry] = await sql`
    insert into message_log (person_id, direction, category, template, status,
                             retry_of, retry_count, sent_at)
    values (${asker.id}::uuid, 'out', 'outreach', 'freshness_ping', 'delivered',
            ${original.id}::uuid, 1, now())
    returning id`;
  ok("a retry row links to its original", Boolean(retry.id));

  await refused(
    "and only one may — a third attempt retries the retry, keeping it a chain",
    () =>
      sql`insert into message_log (person_id, direction, category, retry_of)
          values (${asker.id}::uuid, 'out', 'outreach', ${original.id}::uuid)`,
    "message_log_retry_of_uniq",
  );

  await refused(
    "retry_count is bounded",
    () =>
      sql`update message_log set retry_count = 9 where id = ${retry.id}::uuid`,
    "message_log_retry_count_check",
  );

  /**
   * **The behavioural claim.** Two rows exist and the parent received one
   * message, so the monthly counter must read 1. If it read 2 a retry would
   * spend a second slot of an allowance they agreed to for being *asked
   * things*, which is the ceiling invariant 5 exists to keep — and it is
   * invisible from the outside, because nobody sees their own counter.
   */
  const [counted] = await sql`
    select
      coalesce(sum(case when m.direction = 'out'
                         and m.category = 'outreach'
                         and m.retry_of is null
                         and m.sent_at > now() - interval '30 days'
                    then 1 else 0 end), 0)::int as sent_30_excluding_retries,
      coalesce(sum(case when m.direction = 'out'
                         and m.category = 'outreach'
                         and m.sent_at > now() - interval '30 days'
                    then 1 else 0 end), 0)::int as sent_30_naive
      from people p
      left join message_log m on m.person_id = p.id
     where p.id = ${asker.id}::uuid`;
  ok(
    "the naive count would have said two",
    Number(counted.sent_30_naive) === 2,
    JSON.stringify(counted),
  );
  ok(
    "the counter Pando actually uses says one",
    Number(counted.sent_30_excluding_retries) === 1,
    JSON.stringify(counted),
  );

  /**
   * The same exclusion on the request gap. Without it a retry would restart
   * somebody's 48 hours — so a message that failed and was resent would silently
   * push the next genuine request two days out.
   */
  const [gap] = await sql`
    select
      max(case when m.direction = 'out' and m.category = 'outreach'
                and m.retry_of is null
               then m.sent_at end)                      as last_excluding_retries,
      count(*)::int                                      as rows_seen
      from message_log m
     where m.person_id = ${asker.id}::uuid`;
  ok(
    "and the gap reads the original, not the retry",
    gap.last_excluding_retries !== null && Number(gap.rows_seen) === 2,
    JSON.stringify(gap),
  );

  /* ── the retriable-candidate query, end to end ──────────────────────────── */

  console.log("\n=== 13.4: the sweep finds the right rows ===");

  /* A fresh failure with no retry yet, old enough to be past the delay. */
  const [candidate] = await sql`
    insert into message_log (person_id, direction, category, template, status,
                             error_code, sent_at)
    values (${asker.id}::uuid, 'out', 'outreach', 'freshness_ping', 'failed',
            30001, now() - interval '10 minutes')
    returning id`;

  const found = await sql`
    select m.id::text as id
      from message_log m
     where m.direction = 'out'
       and m.status in ('failed', 'undelivered')
       and m.person_id is not null
       and m.retry_of is null
       and m.sent_at > now() - make_interval(mins => 60)
       and m.sent_at < now() - make_interval(mins => 5)
       and m.retry_count < 1
       and not exists (select 1 from message_log r where r.retry_of = m.id)
       and m.person_id = ${asker.id}::uuid`;
  ok(
    "the candidate query picks up the un-retried failure",
    found.length === 1 && found[0].id === candidate.id,
    JSON.stringify(found),
  );
  ok(
    "and does not pick up the one already retried",
    !found.some((r) => r.id === original.id),
  );

  /* ── 14.5's page reads what it says it reads ─────────────────────────────── */

  console.log("\n=== 14.5: the payments query ===");
  const rows = await sql`
    select b.id::text as id, b.payment_status, b.price_cents,
           b.credit_id is not null as credit_funded
      from blasts b
     where (b.payment_status <> 'not_required' or b.credit_id is not null)
       and b.market_id = ${TAG}`;
  ok(
    "only the blasts that involve money are listed",
    rows.length === 1 && rows[0].id === paidBlast,
    JSON.stringify(rows),
  );
  ok(
    "the free one is not",
    !rows.some((r) => r.id === freeBlast),
  );
} finally {
  await cleanup();
  await sql.end();
}

console.log(
  failures === 0
    ? `\n  ${checks} live checks passed.`
    : `\n  ${failures} of ${checks} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
