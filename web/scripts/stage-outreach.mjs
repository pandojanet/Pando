/**
 * M8 — staging the conditions the contributor-protection rules refuse on.
 *
 * ## Why this exists
 *
 * Three of the four M8 rows are walkable by hand today: a parent picks their
 * allowance on the participation screen (8.1), texts SETTINGS to change it
 * (8.3), and the admin's standing view reports the response rate (8.4). The
 * two that are **not** walkable are the two that matter most, and for the same
 * reason — the 48-hour gap (8.2) and the response-rate governor (8.4) are read
 * out of `message_log`, so producing them by hand means either waiting a month
 * or sending real texts to real contributors.
 *
 * This writes those rows. It **asserts nothing** beyond the rows landing, and
 * that is deliberate: every judgement is then made by production code — the
 * counters in `repo/outreach.ts`, the standing view in `admin-read.ts`, the
 * pool preview on `/admin/blasts`, and `sendSms` itself. A script that also
 * re-stated the counter SQL would be checking a copy of the thing under test,
 * which is the fault `test-relay.mts` already records paying for.
 *
 * Usage:
 *
 *   node scripts/stage-outreach.mjs gap         # inside the 48 hours
 *   node scripts/stage-outreach.mjs cap         # allowance spent
 *   node scripts/stage-outreach.mjs governed    # asked five, answered none
 *   node scripts/stage-outreach.mjs responsive  # asked five, answered four
 *   node scripts/stage-outreach.mjs clear
 *
 *   ... --phone +16265550003     (default: Priya, the demo cohort's 10-a-month)
 *
 * Every row it writes carries `template = 'staged_outreach'`, so `clear`
 * removes exactly what it made and nothing a real send produced.
 */
import postgres from "postgres";

for (const f of [".env.local", ".env"]) {
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(f);
    } catch {
      /* missing or malformed is not worth failing over */
    }
  }
}

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL — these counters live in the database.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith("--")) ?? "";
const phoneAt = argv.indexOf("--phone");
const PHONE = phoneAt >= 0 && argv[phoneAt + 1] ? argv[phoneAt + 1] : "+16265550003";

const CASES = ["gap", "cap", "governed", "responsive", "clear"];
if (!CASES.includes(mode)) {
  console.error(`Pick one of: ${CASES.join(" · ")}`);
  process.exit(1);
}

/** The marker. Narrow on purpose — see the header. */
const TAG = "staged_outreach";

const sql = postgres(url, { max: 1, prepare: false });

/**
 * A contributor whose allowance is what the case is about.
 *
 * Staged against an existing person rather than a fresh one, because the point
 * is to read the result off the admin screens in context — a person invented
 * by this script would sit alone at the bottom of every queue.
 */
async function person() {
  const rows = await sql`
    select id, first_name, monthly_contact_allowance, allowance_mode
      from people where phone = ${PHONE} limit 1
  `;
  if (!rows[0]) {
    console.error(
      `No person on ${PHONE}. Run \`npm run seed:demo\` first, or pass --phone.`,
    );
    process.exit(1);
  }
  return rows[0];
}

async function clear(id) {
  /* The inbound rows first: they point at the outbound ones. */
  await sql`delete from message_log
             where person_id = ${id}::uuid
               and responded_to in (select id from message_log
                                     where person_id = ${id}::uuid
                                       and template = ${TAG})`;
  const gone = await sql`delete from message_log
                          where person_id = ${id}::uuid and template = ${TAG}
                      returning id`;
  return gone.length;
}

/** One outbound request, `hours` ago. Returns its id so a reply can name it. */
async function asked(id, hours) {
  const rows = await sql`
    insert into message_log (person_id, direction, category, template, status, sent_at)
    values (${id}::uuid, 'out', 'outreach', ${TAG}, 'delivered',
            now() - make_interval(hours => ${hours}))
    returning id
  `;
  return rows[0].id;
}

/**
 * Their reply to one of them.
 *
 * `responded_to` is the whole mechanism: 8.4 asks how many of the requests they
 * answered, and SMS carries no thread id, so this column is the only link
 * between a question and its answer.
 */
async function answered(id, outboundId, hours) {
  await sql`
    insert into message_log (person_id, direction, category, template, responded_to, sent_at)
    values (${id}::uuid, 'in', 'outreach', null, ${outboundId}::uuid,
            now() - make_interval(hours => ${hours}))
  `;
}

/** Set what they *say* they agreed to, so the case reads cleanly. */
async function setAllowance(id, allowance, allowanceMode) {
  await sql`update people
               set monthly_contact_allowance = ${allowance},
                   allowance_mode = ${allowanceMode}
             where id = ${id}::uuid`;
}

/** Five requests, spread over the window, the most recent well past the gap. */
const SPREAD = [24 * 5, 24 * 9, 24 * 14, 24 * 19, 24 * 25];

try {
  const who = await person();
  const name = who.first_name ?? PHONE;
  const removed = await clear(who.id);
  if (removed > 0) console.log(`  cleared ${removed} staged row(s)`);

  if (mode === "clear") {
    /**
     * Their allowance is deliberately **not** put back, and the reason is worth
     * stating rather than quietly guessing: the `cap` and `governed` cases move
     * it, and this script never knew what it was before the first of them ran.
     * Restoring an invented default would be the fault this repo keeps
     * recording — a value nobody chose, written by code that could not know.
     * So it is reported instead.
     */
    const now =
      who.allowance_mode === "as_relevant"
        ? "anytime it's genuinely relevant"
        : `${who.monthly_contact_allowance ?? 5} a month`;
    console.log(`
  ${name} is back to whatever real sends left behind.

  Their allowance is **${now}** — a staged case may have changed it. Put it
  back from the standing view, by texting SETTINGS (which is 8.3, so it is
  worth doing that way), or with \`npm run seed:demo\`.
`);
  }

  if (mode === "gap") {
    await asked(who.id, 6);
    console.log(`
  ${name} was asked something **six hours ago**.

  Expect, without waiting two days:
    · /admin/blasts — create an Ask whose pool would include them, then
      "Preview the pool": they are on the **held** list, not the chosen one.
    · A real send skips them, and the skip reason is "too_soon".

  The number to check is 48 hours, not five days — it has moved twice, and the
  1 Sep feedback is the newest document.

  Then: node scripts/stage-outreach.mjs clear
`);
  }

  if (mode === "cap") {
    await setAllowance(who.id, 5, "fixed");
    for (const h of SPREAD) await asked(who.id, h);
    console.log(`
  ${name} is on **5 a month** and has been asked **5 times** in 30 days — the
  most recent five days ago, so the 48-hour gap is clear and the only thing
  left to refuse them is the ceiling.

  Expect:
    · the pool preview holds them, reason "monthly_cap";
    · /admin/conversations shows 5 asked against the allowance they chose.

  Then: node scripts/stage-outreach.mjs clear
`);
  }

  if (mode === "governed") {
    await setAllowance(who.id, 10, "fixed");
    for (const h of SPREAD) await asked(who.id, h);
    console.log(`
  ${name} is on **10 a month**, has been asked **5 times** and answered
  **none**. The gap is clear.

  This is the one observation that can only be the governor: five is well
  inside a stated ten, so a refusal here is the 0% response rate lowering the
  ceiling by one tier — 10 → 5 — and the cap then being measured against 5.

  Expect:
    · /admin/contributors → "How they're doing": response rate 0%, row marked
      as governed;
    · the pool preview holds them, reason "monthly_cap", **while the standing
      view still says 10** — that distance between stated and effective is the
      rule doing its job.

  What will NOT happen is the "friendly note" the estimate names. Only the
  number moves; nothing texts them about it.

  Then: node scripts/stage-outreach.mjs clear
`);
  }

  if (mode === "responsive") {
    await setAllowance(who.id, 10, "fixed");
    const ids = [];
    for (const h of SPREAD) ids.push(await asked(who.id, h));
    for (const [i, h] of [24 * 4, 24 * 8, 24 * 13, 24 * 18].entries()) {
      await answered(who.id, ids[i], h);
    }
    console.log(`
  ${name} is on **10 a month**, asked **5 times**, answered **4**.

  The control for the case above: same volume, same allowance, 80% response
  rate. Expect them **not** governed and still contactable — which is what
  proves the governor reads the rate rather than the volume.

  Then: node scripts/stage-outreach.mjs clear
`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
