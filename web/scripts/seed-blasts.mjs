/**
 * A handful of Network Asks for the demo cohort, so 14.3 can be walked with
 * something on them.
 *
 * Same rules as `seed:demo`, which this deliberately mirrors rather than
 * reinventing: the rows are **not** `is_test`, because every admin count filters
 * those out and a page of zeros is the opposite of the point; the marker is
 * `blasts.market_id = 'pasadena'` plus an asker whose `people.source` is
 * `demo`, so `--clear` walks outward from the same place the cohort does.
 *
 * Every Ask is the one free kind (`lib/blast-tiers.ts`); nothing is priced.
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
      status: "active",
      note: "out with parents",
    },
    {
      question_text: "DEMO Is there a nanny share in Altadena with a space in September?",
      category: "childcare",
      status: "expired",
      note: "window closed, nothing approved",
    },
    {
      question_text: "DEMO Which preschools near Monrovia still have 2027 spots?",
      category: "schools",
      status: "draft",
      note: "waiting for an admin to send",
    },
  ];

  let made = 0;
  for (const [i, row] of rows.entries()) {
    const asker = askers[i % askers.length];
    const [inserted] = await sql`
      insert into blasts (
        market_id, asker_id, question_text, category, neighborhood, tier, status,
        pool_target, expires_at, human_review
      ) values (
        'pasadena',
        ${asker.id},
        ${row.question_text},
        ${row.category},
        (select neighborhood from people where id = ${asker.id}),
        'targeted',
        ${row.status},
        5,
        ${row.status === "expired" ? sql`now() - interval '2 days'` : sql`now() + interval '2 days'`},
        false
      )
      returning id`;
    made += 1;
    console.log(`  ${row.note}`);

    /* One recipient on the active Ask, so the "Replies" fact has something true to say. */
    if (row.status === "active" && askers.length > 1) {
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
