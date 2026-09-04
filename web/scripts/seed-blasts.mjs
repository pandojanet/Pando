/**
 * A handful of Network Asks for the demo cohort, so 14.3 and 14.5 can be walked
 * with something on them.
 *
 * Same rules as `seed:demo`, which this deliberately mirrors rather than
 * reinventing: the rows are **not** `is_test`, because every admin count filters
 * those out and a page of zeros is the opposite of the point; the marker is
 * `blasts.market_id = 'pasadena'` plus an asker whose `people.source` is
 * `demo`, so `--clear` walks outward from the same place the cohort does.
 *
 * ## The one thing it will not fake
 *
 * **No Stripe ids, and no `paid` row that Stripe has never heard of.** A
 * `payment_status = 'paid'` row carrying a made-up `pi_…` would put revenue on
 * the payments page that does not exist in the account, which is the one
 * fabrication that answers "has anybody actually paid?" with a yes — the same
 * reason `/admin/conversations` has no sample rows. The paid row here uses an
 * obvious `pi_demo_…` reference, and the page's own "Stripe is in test mode" /
 * "not switched on" banners are what keep the reading honest.
 *
 * Run: `npm run seed:blasts` · `npm run seed:blasts -- --clear`
 */
import postgres from "postgres";

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });
const clearOnly = process.argv.includes("--clear");

const MARKER = "pi_demo_";

try {
  /* Clear first, always: re-running must not stack duplicates. */
  const gone = await sql`
    delete from blasts
     where question_text like 'DEMO %'
    returning id`;
  console.log(`cleared ${gone.length} demo Ask(s)`);
  if (clearOnly) process.exit(0);

  const askers = await sql`
    select id, first_name from people
     where source = 'demo' and phone is not null
     order by created_at
     limit 4`;
  if (askers.length === 0) {
    console.error("No demo cohort — run `npm run seed:demo` first.");
    process.exit(1);
  }

  const rows = [
    {
      question_text: "DEMO Anyone know a Saturday swim class that takes a nervous 4-year-old?",
      category: "activities",
      tier: "targeted",
      status: "active",
      pool_target: 5,
      payment_status: "paid",
      price_cents: 1500,
      note: "paid, out with parents",
    },
    {
      /* The row 14.5 exists for: paid, the window closed, nothing approved. */
      question_text: "DEMO Is there a nanny share in Altadena with a space in September?",
      category: "childcare",
      tier: "targeted",
      status: "expired",
      pool_target: 5,
      payment_status: "refund_due",
      price_cents: 1500,
      refund_reason: "The window closed with no approved answer.",
      note: "paid, expired, refund flagged",
    },
    {
      question_text: "DEMO Which preschools near Monrovia still have 2027 spots?",
      category: "schools",
      tier: "board",
      status: "active",
      pool_target: 1,
      payment_status: "pending",
      price_cents: 500,
      note: "checkout open, not paid",
    },
    {
      /* Free tier: contacts nobody, owes nothing, and the CHECK enforces both. */
      question_text: "DEMO Any tips for a first birthday party somewhere with shade?",
      category: "outings",
      tier: "passive",
      status: "active",
      pool_target: 0,
      payment_status: "not_required",
      price_cents: 0,
      note: "free, contacts nobody",
    },
  ];

  let made = 0;
  for (const [i, row] of rows.entries()) {
    const asker = askers[i % askers.length];
    const paid = row.payment_status === "paid" || row.payment_status === "refund_due";
    const [inserted] = await sql`
      insert into blasts (
        market_id, asker_id, question_text, category, neighborhood, tier, status,
        pool_target, expires_at, human_review, payment_status, price_cents,
        stripe_session_id, stripe_payment_intent_id, paid_at, refund_reason
      ) values (
        'pasadena',
        ${asker.id},
        ${row.question_text},
        ${row.category},
        (select neighborhood from people where id = ${asker.id}),
        ${row.tier},
        ${row.status},
        ${row.pool_target},
        ${row.status === "expired" ? sql`now() - interval '2 days'` : sql`now() + interval '2 days'`},
        false,
        ${row.payment_status},
        ${row.price_cents},
        ${paid ? `cs_demo_${i}` : row.payment_status === "pending" ? `cs_demo_open_${i}` : null},
        ${paid ? `${MARKER}${i}` : null},
        ${paid ? sql`now() - interval '3 days'` : null},
        ${row.refund_reason ?? null}
      )
      returning id`;
    made += 1;
    console.log(`  ${row.tier.padEnd(12)} ${row.note}`);

    /* One recipient on the active targeted Ask, so the "Replies" fact has
       something true to say. */
    if (row.tier === "targeted" && row.status === "active" && askers.length > 1) {
      const recipient = askers[(i + 1) % askers.length];
      await sql`
        insert into blast_recipients (blast_id, person_id, match_score, match_reasons, sent_at)
        values (${inserted.id}, ${recipient.id}, 7.5,
                ${sql.json([{ kind: "school", value: "field-elementary", points: 5 }])},
                now() - interval '1 day')
        on conflict do nothing`;
    }
  }

  console.log(`\nmade ${made} demo Ask(s). Clear them with: npm run seed:blasts -- --clear`);
} finally {
  await sql.end();
}
