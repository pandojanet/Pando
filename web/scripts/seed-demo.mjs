/**
 * Fills the database with a realistic Pasadena founding cohort, so every admin
 * surface can be walked in front of the client without meeting an empty state.
 *
 *   npm run seed:demo          # add the cohort
 *   npm run seed:demo -- --clear   # remove it again, and nothing else
 *
 * ## Two decisions that shape the whole script
 *
 * **1. It is NOT `is_test`.** Every admin count filters test rows out, so a demo
 * cohort marked that way would show a dashboard of zeros — the opposite of the
 * point. These rows are ordinary rows, and that is deliberate.
 *
 * **2. So it needs a different marker, and the marker is `people.source`.**
 * Every seeded parent has `source = 'demo'`. It is a real column with real
 * values ('link' | 'qr' | 'direct'), it renders as "Arrived via: demo" on the
 * contributor page — which is honest rather than hidden — and it is what
 * `--clear` walks from. Everything else this script creates hangs off one of
 * those people, so deleting them by that marker takes the whole cohort with it
 * and touches nothing a real parent made.
 *
 * Phone numbers are all `626-555-0XXX`. The 555 exchange is the fiction
 * convention so they read as real without being real, and the `0` block is
 * chosen to stay clear of `test:e2e`, whose generated numbers never start those
 * three digits with a zero.
 *
 * ## What it covers
 *
 * Founding at every state (approved, one-short, gave-nothing, anonymous),
 * contributions in every review state including secondhand and answer-ready,
 * the full caregiver consent ladder plus a hold with a restricted note and a
 * near-duplicate pair, 2C claims pending and linked, all four D1 sensitivity
 * classes across several neighborhoods, flags at every severity, options waiting
 * to be promoted, referrals, an opt-out to prove the consent file shows a
 * sequence, and an audit trail underneath all of it.
 */

import { existsSync } from "node:fs";
import postgres from "postgres";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(f);
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set — put the Supabase pooler string in web/.env.local.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const CLEAR = process.argv.includes("--clear");
const MARKET = "pasadena";
const YEAR = new Date().getFullYear();

/* Timestamps spread over the last ten weeks, so "Joined" and the freshness
   columns read like a cohort that arrived over time rather than all at once. */
const daysAgo = (n) => sql`now() - ${`${n} days`}::interval`;

/* ── Clear ───────────────────────────────────────────────────────────────────
 *
 * Walks outward from `source = 'demo'`. Order matters: children before people,
 * notes before nominations, contributions before shares — and a share or a
 * caregiver is only removed once nothing points at it any more, so a real
 * parent's contribution to the same class keeps both alive.
 */
async function clear() {
  const ids = (await sql`select id from people where source = 'demo'`).map(
    (r) => r.id,
  );
  if (ids.length === 0) {
    console.log("nothing to clear — no demo rows found.");
    return;
  }

  await sql`delete from flags where person_id = any(${ids}::uuid[])`;
  await sql`
    delete from flags
    where (subject_kind in ('share_contribution', 'place_contribution')
             and not exists (select 1 from share_contributions c where c.id = flags.subject_id))
       or (subject_kind = 'demand_signal'
             and not exists (select 1 from demand_signals d where d.id = flags.subject_id))`;
  await sql`delete from restricted_notes where nomination_id in (
              select id from caregiver_nominations where person_id = any(${ids}::uuid[]))`;
  await sql`delete from caregiver_nominations where person_id = any(${ids}::uuid[])`;
  await sql`delete from caregiver_claims where person_id = any(${ids}::uuid[])`;
  /* Profiles and caregivers only once no nomination and no claim is left. */
  await sql`delete from caregiver_profiles where caregiver_id in (
              select id from caregivers c
              where not exists (select 1 from caregiver_nominations n where n.caregiver_id = c.id)
                and not exists (select 1 from caregiver_claims k where k.linked_caregiver_id = c.id))`;
  await sql`delete from caregivers c
            where not exists (select 1 from caregiver_nominations n where n.caregiver_id = c.id)
              and not exists (select 1 from caregiver_claims k where k.linked_caregiver_id = c.id)`;
  await sql`delete from share_contributions where person_id = any(${ids}::uuid[])`;
  await sql`delete from shares s
            where not exists (select 1 from share_contributions c where c.share_id = s.id)`;
  await sql`delete from submissions where person_id = any(${ids}::uuid[])`;
  await sql`delete from demand_signals where person_id = any(${ids}::uuid[])`;
  await sql`delete from referrals where referrer_id = any(${ids}::uuid[])
                                    or referred_id = any(${ids}::uuid[])`;
  await sql`delete from pending_options where submitted_by = any(${ids}::uuid[])`;
  await sql`delete from sms_opt_outs where phone in (
              select phone from people where id = any(${ids}::uuid[]) and phone is not null)`;
  await sql`delete from consents where person_id = any(${ids}::uuid[])`;
  await sql`delete from person_schools where person_id = any(${ids}::uuid[])`;
  await sql`delete from social_affinities where person_id = any(${ids}::uuid[])`;
  await sql`delete from life_relevance where person_id = any(${ids}::uuid[])`;
  await sql`delete from children where person_id = any(${ids}::uuid[])`;
  await sql`delete from people where id = any(${ids}::uuid[])`;
  await sql`delete from audit_log where actor in ('janet', 'andrii') and after ->> 'demo' = 'true'`;
  await sql`delete from invites where note = 'demo cohort'`;

  console.log(`cleared ${ids.length} demo contributor(s) and everything under them.`);
}

/* ── The cohort ──────────────────────────────────────────────────────────── */

/**
 * `founding` and the contribution mix below are chosen so the overview shows
 * every reward state at once: `earned` (an approved qualifying card), `started`
 * (submitted, nothing approved yet) and `none` (arrived, gave nothing).
 */
const PARENTS = [
  { first: "Sarah", last: "Chen", n: "south-pasadena", kids: [2019, 2022], area: "3_10_years", group: "school-pta", founding: "founding", allowance: 5, ear: "opted_in", joined: 68 },
  { first: "Maya", last: "Okonkwo", n: "altadena", kids: [2021], area: "1_3_years", group: "pasadena-moms-fb", founding: "founding", allowance: 10, ear: "opted_in", joined: 64 },
  { first: "Rachel", last: "Alvarez", n: "sierra-madre", kids: [2017, 2020], area: "10_plus_years", group: "school-pta", founding: "founding", allowance: 5, ear: "declined", joined: 61 },
  { first: "Priya", last: "Raman", n: "san-marino", kids: [2016, 2019, 2023], area: "3_10_years", group: "sgv-parents-whatsapp", founding: "founding", allowance: 10, ear: "opted_in", joined: 57 },
  { first: "Jessica", last: "Moreau", n: "bungalow-heaven", kids: [2020], area: "under_year", group: "pasadena-moms-fb", founding: "pending_founding", allowance: 5, ear: null, joined: 52, movedFrom: "another_us_state" },
  { first: "Dana", last: "Whitfield", n: "madison-heights", kids: [2015, 2018], area: "grew_up_here", group: "neighborhood-parents-chat", founding: "pending_founding", allowance: 5, ear: "opted_in", joined: 48 },
  { first: "Leah", last: "Fischer", n: "old-pasadena", kids: [2022], area: "1_3_years", group: "mops", founding: "pending_founding", allowance: 10, ear: "opted_in", joined: 44 },
  { first: "Noor", last: "Haddad", n: "east-pasadena", kids: [2018, 2021], area: "3_10_years", group: "sgv-parents-whatsapp", founding: "pending_founding", allowance: 5, ear: null, joined: 41 },
  { first: "Carmen", last: "Delgado", n: "northwest-pasadena", kids: [2014, 2017], area: "grew_up_here", group: "school-pta", founding: "pending_founding", allowance: 5, ear: "declined", joined: 37 },
  { first: "Amanda", last: "Boyle", n: "la-canada", kids: [2019], area: "3_10_years", group: "coop-preschool-parents", founding: "pending_founding", allowance: 10, ear: "opted_in", joined: 33 },
  { first: "Grace", last: "Kim", n: "arcadia", kids: [2023], area: "under_year", group: "mops", founding: "pending_founding", allowance: 5, ear: null, joined: 29, movedFrom: "another_country" },
  { first: "Tessa", last: "Nakamura", n: "linda-vista", kids: [2016, 2020], area: "3_10_years", group: "neighborhood-parents-chat", founding: "pending_founding", allowance: 5, ear: "opted_in", joined: 26 },
  { first: "Bianca", last: "Rossi", n: "hastings-ranch", kids: [2021], area: "1_3_years", group: "twin-multiples-group", founding: "pending_founding", allowance: 5, ear: null, joined: 22 },
  { first: "Helen", last: "Osei", n: "monrovia", kids: [2013, 2016], area: "10_plus_years", group: "nextdoor-parents", founding: "pending_founding", allowance: 5, ear: null, joined: 19 },
  { first: "Robin", last: "Feld", n: "eagle-rock", kids: [2019], area: "1_3_years", group: "pasadena-moms-fb", founding: "pending_founding", allowance: 10, ear: null, joined: 15, movedFrom: "elsewhere_in_california" },
  { first: "Nadia", last: "Farouk", n: "temple-city", kids: [2018], area: "3_10_years", group: "sgv-parents-whatsapp", founding: "pending_founding", allowance: 5, ear: null, joined: 11 },
  { first: "Corinne", last: "Baptiste", n: "playhouse-district", kids: [2022], area: "under_year", group: "mops", founding: "pending_founding", allowance: 5, ear: null, joined: 8 },
  /* Expecting — proves the age-band gating and the `year_shape` CHECK. */
  { first: "Alice", last: "Ferrand", n: "san-rafael", kids: [], expecting: true, area: "1_3_years", group: "coop-preschool-parents", founding: "none", allowance: 5, ear: "opted_in", joined: 6 },
];

/** The anonymous path: contributions welcome, no name, no phone, no Founding. */
const ANON_COUNT = 3;

const phoneFor = (i) => `+1626555${String(1000 + i).replace(/^1/, "0")}`;

async function seedInvites() {
  const rows = [
    ["poly-fall26", "Polytechnic — incoming families", "school-pta"],
    ["sgv-whatsapp", "SGV Parents (WhatsApp)", "sgv-parents-whatsapp"],
    ["pasadena-moms", "Pasadena Moms (Facebook)", "pasadena-moms-fb"],
    ["mops-altadena", "MOPS Altadena", "mops"],
    ["coop-preschool", "Co-op preschool parents", "coop-preschool-parents"],
    ["neighbors-bh", "Bungalow Heaven neighbors", "neighborhood-parents-chat"],
  ];
  for (const [code, label, group] of rows) {
    await sql`
      insert into invites (code, market_id, label, group_option_value, note, created_by, active)
      values (${code}, ${MARKET}, ${label}, ${group}, 'demo cohort', 'janet', true)
      on conflict (code) do update set label = excluded.label, note = 'demo cohort'`;
  }
  /* One retired, so the admin shows both states and the "a retired code still
     lets a parent in" rule has something to demonstrate. */
  await sql`
    insert into invites (code, market_id, label, group_option_value, note, created_by, active)
    values ('spring-open-house', ${MARKET}, 'Spring open house (retired)', 'school-pta',
            'demo cohort', 'janet', false)
    on conflict (code) do update set active = false, note = 'demo cohort'`;
  console.log(`  invites: ${rows.length + 1}`);
}

const INVITE_FOR_GROUP = {
  "school-pta": "poly-fall26",
  "sgv-parents-whatsapp": "sgv-whatsapp",
  "pasadena-moms-fb": "pasadena-moms",
  mops: "mops-altadena",
  "coop-preschool-parents": "coop-preschool",
  "neighborhood-parents-chat": "neighbors-bh",
  "nextdoor-parents": null,
  "twin-multiples-group": null,
};

async function seedPeople() {
  const made = [];
  for (const [i, p] of PARENTS.entries()) {
    const code = INVITE_FOR_GROUP[p.group] ?? null;
    const invite = code
      ? (await sql`select id from invites where code = ${code}`)[0]
      : null;

    const [person] = await sql`
      insert into people (
        phone, first_name, last_name, market_id, neighborhood,
        invite_code, invite_id, invited_via_group, source,
        time_in_area, moved_from, attribution, aggregate_display,
        monthly_contact_allowance, allowance_mode,
        topic_preferences, topics_lived_experience,
        child_ages_at_capture, phone_verified_at, founding,
        profile_completeness, profile_captured_at, is_test, created_at
      ) values (
        ${phoneFor(i)}, ${p.first}, ${p.last}, ${MARKET}, ${p.n},
        ${code}, ${invite?.id ?? null}, ${invite ? p.group : null}, 'demo',
        ${p.area}, ${p.movedFrom ?? null},
        ${i % 3 === 0 ? "first_name_safe" : "anonymous_verified"}, true,
        ${p.allowance}, 'fixed',
        ${i % 2 === 0 ? ["camps", "preschools_schools", "babysitters"] : ["activities", "nannies", "outings"]}::text[],
        ${p.ear === "opted_in" ? ["sleep_routines", "returning_to_work"] : []}::text[],
        ${p.kids.map((y) => YEAR - y)}::integer[],
        ${daysAgo(p.joined)}, ${p.founding},
        ${p.kids.length ? 70 + ((i * 7) % 30) : 45}, ${daysAgo(p.joined)},
        false, ${daysAgo(p.joined)}
      ) returning id`;

    for (const year of p.kids) {
      await sql`insert into children (person_id, birth_year, expecting)
                values (${person.id}, ${year}, false)`;
    }
    if (p.expecting) {
      await sql`insert into children (person_id, expecting, due_year, due_year_precision)
                values (${person.id}, true, ${YEAR}, 'assumed_capture_year')`;
    }

    /* The graph. Household edges carry no child; a school edge does. */
    await sql`insert into social_affinities (person_id, affinity_type, affinity_value, weight_at_capture)
              values (${person.id}, 'neighborhood', ${p.n}, 3)`;
    for (const band of ageBands(p.kids)) {
      await sql`insert into social_affinities (person_id, affinity_type, affinity_value, weight_at_capture)
                values (${person.id}, 'age_range', ${band}, 2)
                on conflict do nothing`;
    }
    const school = schoolFor(p.kids);
    if (school) {
      await sql`insert into social_affinities
                  (person_id, affinity_type, affinity_value, weight_at_capture, child_birth_years)
                values (${person.id}, 'school', ${school}, 5, ${[p.kids[0]]}::integer[])`;
      await sql`insert into person_schools (person_id, option_value, status, child_birth_years)
                values (${person.id}, ${school}, 'current', ${[p.kids[0]]}::integer[])`;
    }
    await sql`insert into life_relevance (person_id, dimension, value)
              values (${person.id}, 'tenure', ${p.area})`;
    await sql`insert into life_relevance (person_id, dimension, value)
              values (${person.id}, 'logistics', ${i % 2 ? "close_to_home" : "weekend_friendly"})`;
    await sql`insert into life_relevance (person_id, dimension, value)
              values (${person.id}, 'budget', ${i % 3 === 0 ? "compare_value" : "mid_range"})`;

    /* Consents — the A2P defence file, and it has to show real variety. */
    await sql`insert into consents (person_id, scope, status, source, text_version, captured_at)
              values (${person.id}, 'sms', 'opted_in', 'seed_entry_phone_field',
                      'seed-sms-2026-08-01', ${daysAgo(p.joined)})`;
    if (p.founding !== "none") {
      await sql`insert into consents (person_id, scope, status, source, text_version, captured_at)
                values (${person.id}, 'follow_up', ${i % 5 === 4 ? "declined" : "opted_in"},
                        'seed_completion_screen', 'seed-followup-2026-07-31', ${daysAgo(p.joined - 1)})`;
    }
    if (p.ear) {
      await sql`insert into consents (person_id, scope, status, source, text_version, captured_at)
                values (${person.id}, 'listening_ear', ${p.ear}, 'seed_tool_profile',
                        'seed-listening-ear-2026-08-18', ${daysAgo(p.joined)})`;
    }

    made.push({ ...p, id: person.id, phone: phoneFor(i) });
  }

  /* The anonymous path. No phone, no name — so `verified_if_named` is satisfied
     by there being nothing to verify, which is the shape that rule allows. */
  for (let i = 0; i < ANON_COUNT; i++) {
    const [person] = await sql`
      insert into people (market_id, neighborhood, source, invite_code,
                          monthly_contact_allowance, allowance_mode, wants_founding,
                          founding, profile_completeness, is_test, created_at)
      values (${MARKET}, ${["altadena", "south-pasadena", "arcadia"][i]}, 'demo',
              'pasadena-moms', 5, 'fixed', false, 'none', 55, false, ${daysAgo(20 - i * 4)})
      returning id`;
    made.push({ id: person.id, anonymous: true, n: ["altadena", "south-pasadena", "arcadia"][i] });
  }

  /* One parent who agreed and then texted STOP: the consent file has to be able
     to show the sequence, not just the agreement. */
  const optOut = made[13];
  await sql`insert into sms_opt_outs (phone, keyword, opted_out_at)
            values (${optOut.phone}, 'STOP', ${daysAgo(9)})
            on conflict (phone) do nothing`;

  console.log(`  people: ${PARENTS.length} named + ${ANON_COUNT} anonymous`);
  return made;
}

const ageBands = (years) =>
  [
    ...new Set(
      years.map((y) => {
        const age = YEAR - y;
        if (age <= 1) return "baby";
        if (age <= 3) return "toddler";
        if (age <= 5) return "preschool";
        if (age <= 11) return "grade";
        if (age <= 14) return "tween";
        return "teen";
      }),
    ),
  ];

function schoolFor(years) {
  if (years.length === 0) return null;
  const age = YEAR - years[0];
  if (age <= 2) return null;
  if (age <= 5) return "the-growing-place";
  if (age <= 11) return "field-elementary";
  if (age <= 14) return "sierra-madre-middle";
  return "pasadena-high";
}

/* ── Shares and contributions ────────────────────────────────────────────── */

/**
 * Written so the contributions queue has something in every filter: pending,
 * low confidence, one-detail-short, secondhand, and answer-ready. The
 * confidence notes are the sentences the extraction pass would have written —
 * every score carries one, because since 14 Aug a score without a reason is
 * treated as unscored and swept again.
 */
const SHARES = [
  {
    name: "Little Maestros", venue: "on Mission St", kind: "activity",
    hoods: ["south-pasadena"], bands: ["toddler", "preschool"],
    status: "approved", answerReady: true, fresh: "fresh", confirmed: 6,
    contributions: [
      { by: 0, ages: [3], last: "current", much: "a_term", rec: "yes", great: "Small groups and the teacher is unbelievably patient with the ones who won't join in for the first month.", caveat: "Saturdays are packed — take the 9am.", who: "A cautious toddler who warms up slowly", band: "50_100", unit: "per_month", worth: "great_value", conf: 0.92, note: "Concrete about the group size, the teacher's manner and which session to pick — another parent could act on this without asking anything.", approved: true },
      { by: 2, ages: [5], last: "recent", much: "a_year_plus", rec: "yes", great: "Two years in and my daughter still asks for it on the days it isn't on.", caveatAnswered: true, who: "A child who likes routine", band: "50_100", unit: "per_month", worth: "fair", conf: 0.78, note: "A strong signal of staying power, though it says more about her child's enthusiasm than about what happens in the room.", approved: true },
      { by: 5, ages: [6], last: "over_year", much: "few_sessions", rec: "yes_with_caveats", great: "Lovely for the little ones, but my six-year-old had outgrown it.", caveatAnswered: true, whoNot: "Anyone over about five", band: "50_100", unit: "per_month", worth: "fair", conf: 0.81, note: "Useful precisely because it names who it stopped working for — the age ceiling is the actionable part.", approved: true, stale: true },
    ],
  },
  {
    name: "Rose Bowl Aquatics parent & me", kind: "activity",
    hoods: ["old-pasadena"], bands: ["baby", "toddler"],
    status: "approved", answerReady: true, fresh: "fresh", confirmed: 4,
    contributions: [
      { by: 6, ages: [2], last: "current", much: "weekly_ongoing", rec: "yes", great: "The water is genuinely warm, which is the whole thing at this age — we tried two others where he screamed the entire time.", caveat: "Parking on a Rose Bowl event day is impossible. Check the calendar.", who: "A baby who hates being cold", band: "100_200", unit: "per_term", worth: "pricey_worth_it", conf: 0.94, note: "Names the one variable that decides whether a baby swim class works, and gives a specific logistical warning a newcomer would not know.", approved: true },
      { by: 10, ages: [1], last: "current", much: "a_term", rec: "yes", great: "Instructors remember your child's name by week two.", caveatAnswered: true, who: "First-time parents who want to be told what to do", band: "100_200", unit: "per_term", worth: "fair", conf: 0.72, note: "A real detail about the staff, but nothing about what the sessions actually involve.", approved: true },
    ],
  },
  {
    name: "Tom Sawyer Camps", kind: "activity",
    hoods: ["altadena", "la-canada"], bands: ["grade", "tween"],
    status: "approved", answerReady: true, fresh: "fresh", confirmed: 5,
    contributions: [
      { by: 3, ages: [8, 11], last: "recent", much: "a_year_plus", rec: "yes", great: "Both of mine went for three summers. It is outdoors, low-tech, and the counsellors are the same faces year after year — which matters more than the programme.", caveat: "Sign up the week registration opens or you are on a waitlist.", who: "A kid who would rather be outside", whoNot: "A child who needs air conditioning", band: "over_200", unit: "per_camp_week", worth: "pricey_worth_it", conf: 0.95, note: "Multi-year firsthand experience with a specific reason it works and an unambiguous registration warning — the most actionable card in this set.", approved: true },
      { by: 8, ages: [9], last: "recent", much: "a_term", rec: "yes", great: "The bus pickup saved my summer.", caveatAnswered: true, who: "Working parents without a driver", band: "over_200", unit: "per_camp_week", worth: "fair", conf: 0.68, note: "One useful logistical fact, and beyond that not much another parent could act on.", approved: true },
    ],
  },
  {
    name: "Kidspace summer camp", kind: "activity",
    hoods: ["playhouse-district"], bands: ["preschool", "grade"],
    status: "approved", fresh: "ageing", confirmed: 2,
    contributions: [
      { by: 1, ages: [4], last: "recent", much: "tried_once", rec: "yes_with_caveats", great: "Great for a first-ever camp — half days, and they are gentle with the ones who cry at drop-off.", caveat: "It is mostly outdoors and August was brutal.", who: "A first camp", whoNot: "August weeks", band: "100_200", unit: "per_camp_week", worth: "fair", conf: 0.88, note: "Specific about who it suits and names a seasonal caveat that would change when a parent books.", approved: true },
    ],
  },
  {
    name: "AYSO soccer", kind: "activity",
    hoods: ["sierra-madre", "east-pasadena"], bands: ["preschool", "grade", "tween"],
    status: "approved", fresh: "fresh", confirmed: 3,
    contributions: [
      { by: 2, ages: [7], last: "current", much: "a_term", rec: "yes", great: "Every child plays every game regardless of ability — that is written into how the league works, not just something the coach says.", caveat: "Volunteering is not really optional.", who: "A child who is not sporty yet", band: "under_25", unit: "per_month", worth: "great_value", conf: 0.9, note: "Distinguishes a structural rule of the league from a coach's goodwill, which is exactly the difference a parent choosing between leagues needs.", approved: true },
      { by: 11, ages: [5, 9], last: "current", much: "a_year_plus", rec: "yes", great: "Both kids, four seasons, never a bad coach.", caveatAnswered: true, who: "A family with kids at different ages in the same league", band: "under_25", unit: "per_month", worth: "great_value", conf: 0.55, note: "Positive and consistent, but it does not say what the sessions are like or who the league suits.", approved: true },
    ],
  },
  {
    name: "Pasadena Conservatory of Music", kind: "activity",
    hoods: ["madison-heights"], bands: ["grade", "tween", "teen"],
    status: "approved", fresh: "fresh", confirmed: 2,
    contributions: [
      { by: 5, ages: [10], last: "current", much: "a_year_plus", rec: "yes", great: "They matched my son with a teacher on his third try and did not make us feel difficult about asking.", caveat: "The recital schedule assumes a parent is free on weekday afternoons.", who: "A child who has already quit one instrument", band: "over_200", unit: "per_term", worth: "pricey_worth_it", conf: 0.91, note: "Describes how the institution handled a problem, which is more predictive than a description of the lessons.", approved: true },
    ],
  },
  /* Pending — the "To review" queue. */
  {
    name: "The Little Gym", venue: "Hastings Ranch", kind: "activity",
    hoods: ["hastings-ranch"], bands: ["toddler", "preschool", "grade"],
    status: "pending_review", fresh: "fresh", confirmed: 0,
    contributions: [
      { by: 12, ages: [4], last: "current", much: "a_term", rec: "yes", great: "Clean, bright, and the free-play half hour at the end is what my daughter actually comes for.", caveat: "Birthday parties take over the space at weekends.", who: "A high-energy preschooler", band: "50_100", unit: "per_month", worth: "fair", conf: 0.87, note: "Names the part of the session the child values and a weekend caveat — specific enough to choose a weekday slot on." },
    ],
  },
  {
    name: "Pasadena Dance Theatre", kind: "activity",
    hoods: ["san-marino"], bands: ["preschool", "grade", "tween"],
    status: "pending_review", fresh: "fresh", confirmed: 0,
    contributions: [
      { by: 3, ages: [6], last: "current", much: "a_year_plus", rec: "yes", great: "Serious training without the competition-mum atmosphere I was dreading.", who: "A child who wants real ballet", whoNot: "Anyone looking for a casual once-a-week thing", band: "100_200", unit: "per_month", worth: "pricey_worth_it", conf: 0.89, note: "Sets an expectation about the culture as well as the training, and is explicit about who would be disappointed." },
    ],
  },
  /* Low confidence — the queue that improves the prompt. */
  {
    name: "Gymboree Play & Music", kind: "activity",
    hoods: ["arcadia"], bands: ["baby", "toddler"],
    status: "pending_review", fresh: "fresh", confirmed: 0,
    contributions: [
      { by: 15, ages: [2], last: "recent", much: "few_sessions", rec: "yes", great: "It was good.", band: "50_100", unit: "per_month", worth: "fair", conf: 0.12, note: "Says nothing another parent could act on — no sense of what happens there, who it suits, or what stood out." },
    ],
  },
  {
    name: "Martial arts / taekwondo", venue: "on Colorado", kind: "activity",
    hoods: ["northwest-pasadena"], bands: ["preschool", "grade", "tween"],
    status: "pending_review", fresh: "ageing", confirmed: 0,
    contributions: [
      { by: 8, ages: [7], last: "recent", much: "a_term", rec: "yes_with_caveats", great: "Fine. Kids seemed happy enough.", caveat: "Nothing comes to mind.", caveatAnswered: true, band: "50_100", unit: "per_month", worth: "fair", conf: 0.22, note: "Vague and slightly contradictory — 'fine' with no detail leaves a parent knowing less than before they read it." },
    ],
  },
  /* Names a person and is excellent: must be flagged for review AND score high.
     This is the pair of signals the 12 Aug fix separated. */
  {
    name: "Kids yoga", venue: "at the Armory", kind: "activity",
    hoods: ["old-pasadena"], bands: ["toddler", "preschool", "grade"],
    status: "pending_review", fresh: "fresh", confirmed: 0,
    contributions: [
      { by: 6, ages: [5], last: "current", much: "a_term", rec: "yes", great: "Ms. Diane got my son lying still for ten minutes after a year of us failing at bedtime. Ask for her class specifically, not just the studio.", who: "A child who cannot switch off", band: "25_50", unit: "per_class", worth: "great_value", conf: 0.86, note: "Highly actionable — it names the specific outcome and tells a parent which class to ask for, which is the useful part.", namesPerson: true },
    ],
  },
  /* One detail short — no child age, so it cannot qualify for Founding. */
  {
    name: "Kidspace Museum classes", kind: "activity",
    hoods: ["playhouse-district"], bands: ["toddler", "preschool", "grade"],
    status: "needs_detail", fresh: "fresh", confirmed: 0,
    needsDetail: "Quick one — roughly how old was your child when you went?",
    contributions: [
      { by: 9, ages: [], last: "current", much: "few_sessions", rec: "yes", great: "Hands-on and she never wants to leave.", band: "25_50", unit: "per_session", worth: "fair", conf: 0.64, note: "A real reaction, but with no sense of the age this suits it is hard to place." },
    ],
  },
  /* Secondhand — welcome, labelled, never qualifying. */
  {
    name: "Pasadena Ice Skating Center", kind: "activity",
    hoods: ["east-pasadena"], bands: ["grade", "tween", "teen"],
    status: "pending_review", fresh: "ageing", confirmed: 0,
    contributions: [
      { by: 13, ages: [8], last: "unsure", much: "tried_once", rec: "yes_with_caveats", great: "A friend swears by the Saturday morning group lessons.", firsthand: false, band: "50_100", unit: "per_month", worth: "fair", conf: 0.38, note: "Secondhand and general — it points at a session without saying anything about it." },
    ],
  },
  /* Places. */
  {
    name: "Hahamongna Watershed Park", kind: "place", placeType: "trail",
    hoods: ["altadena"], bands: ["preschool", "grade", "tween"],
    status: "approved", answerReady: true, fresh: "fresh", confirmed: 4,
    contributions: [
      { by: 1, ages: [4], last: "current", much: "weekly_ongoing", rec: "yes", great: "Wide flat paths a scooter can handle, shade for the first mile, and it is never crowded before ten.", caveat: "No toilets past the car park.", who: "A family that wants a walk without a hike", band: "free", worth: "free", conf: 0.93, note: "Three concrete, checkable facts and a practical warning — the kind of card that can answer a question on its own.", approved: true },
      { by: 4, ages: [6], last: "recent", much: "few_sessions", rec: "yes", great: "The dry riverbed is the whole attraction for my six-year-old.", caveatAnswered: true, who: "A child who invents their own game out of a landscape", band: "free", worth: "free", conf: 0.7, note: "One specific feature and the age it lands with, though little else.", approved: true },
    ],
  },
  {
    name: "La Pintoresca Branch Library", kind: "place", placeType: "library",
    hoods: ["northwest-pasadena"], bands: ["baby", "toddler", "preschool"],
    status: "approved", fresh: "fresh", confirmed: 2,
    contributions: [
      { by: 16, ages: [3], last: "current", much: "weekly_ongoing", rec: "yes", great: "The Tuesday storytime is bilingual and the librarian actually sings.", caveatAnswered: true, who: "A Spanish-speaking household", band: "free", worth: "free", conf: 0.9, note: "Names the day, the language and what makes the session different — immediately usable.", approved: true },
    ],
  },
  {
    name: "Victory Park playground", kind: "place", placeType: "playground",
    hoods: ["hastings-ranch"], bands: ["toddler", "preschool", "grade"],
    status: "pending_review", fresh: "fresh", confirmed: 0,
    contributions: [
      { by: 11, ages: [3, 7], last: "current", much: "weekly_ongoing", rec: "yes", great: "Separate fenced area for the under-fives, which means I can let both of them loose at once.", caveat: "The shade is gone by two in the afternoon.", who: "Two kids at different stages", band: "free", worth: "free", conf: 0.91, note: "Solves the specific problem of supervising two ages at once, with a timing caveat." },
    ],
  },
  /* Tips. */
  {
    name: "Camp registration timing", kind: "tip", topic: "schedules",
    hoods: [], bands: ["grade", "tween"],
    status: "approved", answerReady: true, fresh: "fresh", confirmed: 3,
    contributions: [
      { by: 3, ages: [8], last: "current", rec: "yes", tip: "Most Pasadena day camps open registration in the second half of January and the good weeks are gone by mid-February. Put a calendar reminder on 15 January — not February.", caveatAnswered: true, who: "Anyone booking their first summer here", band: null, worth: null, conf: 0.94, note: "A dated, specific piece of local timing that is exactly what a newcomer would get wrong.", approved: true },
    ],
  },
  {
    name: "Preschool waitlists", kind: "tip", topic: "new_to_area",
    hoods: [], bands: ["toddler", "preschool"],
    status: "approved", fresh: "fresh", confirmed: 2,
    contributions: [
      { by: 0, ages: [2], last: "current", rec: "yes", tip: "Get on preschool waitlists a full year before you want a place, and phone rather than emailing — three of the four that never replied to my email had space when I rang.", caveatAnswered: true, who: "A family new to the area", band: null, worth: null, conf: 0.92, note: "Concrete tactic with the reasoning behind it, drawn from the parent's own attempts.", approved: true },
    ],
  },
  {
    name: "Birthday party venues", kind: "tip", topic: "birthdays",
    hoods: [], bands: ["preschool", "grade"],
    status: "pending_review", fresh: "fresh", confirmed: 0,
    contributions: [
      { by: 7, ages: [5], last: "recent", rec: "yes_with_caveats", tip: "Book the park shelters through the city website — they are a fraction of a venue and nobody knows they exist.", band: "under_25", unit: "per_session", worth: "great_value", conf: 0.85, note: "Names a specific, cheap option and where to book it." },
    ],
  },
  /* From the anonymous path: a real contribution with no contributor name
     attached anywhere. The admin has to render that without breaking, and the
     card must never carry a name it does not have. */
  {
    name: "Cheaper swim lessons", kind: "tip", topic: "costs",
    hoods: [], bands: ["preschool", "grade"],
    status: "approved", fresh: "fresh", confirmed: 1,
    contributions: [
      { by: 18, ages: [5], last: "current", rec: "yes", tip: "The city pools run the same lesson syllabus as the private clubs for about a third of the price — the catch is you have to register the morning enrolment opens.", caveatAnswered: true, who: "Anyone put off by club prices", band: "under_25", unit: "per_session", worth: "great_value", conf: 0.89, note: "A concrete cost comparison with the trade-off named — actionable, and not something a newcomer would find on a website.", approved: true },
    ],
  },
  /* Rejected — so the "All" filter shows the full lifecycle. */
  {
    name: "A tutoring place downtown", kind: "activity",
    hoods: ["old-pasadena"], bands: ["grade", "tween"],
    status: "rejected", fresh: "stale", confirmed: 0,
    contributions: [
      { by: 14, ages: [9], last: "over_year", much: "tried_once", rec: "probably_not", great: "Honestly cannot remember much, it was a while ago.", band: "100_200", unit: "per_month", worth: "pricey_not_worth_it", conf: 0.09, note: "The parent says themselves they cannot recall it — there is nothing here to reuse.", rejected: true, stale: true },
    ],
  },
];

async function seedShares(people) {
  let contributions = 0;
  const scored = [];

  for (const [si, s] of SHARES.entries()) {
    const [share] = await sql`
      insert into shares (market_id, kind, name, venue, neighborhoods, age_bands,
                          place_type, topic, status, provenance, answer_ready,
                          last_confirmed_at, freshness_state, validated_count,
                          is_test, created_at)
      values (${MARKET}, ${s.kind}, ${s.name}, ${s.venue ?? null},
              ${s.hoods}::text[], ${s.bands}::text[],
              ${s.placeType ?? null}, ${s.topic ?? null},
              ${s.status}, 'parent_submitted', ${s.answerReady === true},
              ${s.status === "approved" ? daysAgo(4 + si) : null},
              ${s.fresh}, ${s.confirmed}, false, ${daysAgo(50 - si * 2)})
      returning id`;

    for (const [ci, c] of s.contributions.entries()) {
      const author = people[c.by];
      const [sub] = await sql`
        insert into submissions (client_id, person_id, kind, fields, is_test, received_at)
        values (${`demo-${si}-${ci}`}, ${author.id}, ${s.kind},
                ${sql.json({ name: s.name, demo: true })}, false, ${daysAgo(48 - si * 2)})
        returning id`;

      const [contribution] = await sql`
        insert into share_contributions (
          share_id, person_id, submission_id, firsthand, child_age_at_time,
          last_there, how_much, recommendation, what_makes_it_great, caveat,
          caveat_answered, who_for, who_not_for, price_band, price_unit, worth_it,
          follow_up_ok, tip_text, confidence, confidence_note, needs_detail_note,
          status, approved_at, approved_by, is_test, created_at
        ) values (
          ${share.id}, ${author.id}, ${sub.id}, ${c.firsthand !== false},
          ${c.ages ?? []}::integer[], ${c.last ?? null}, ${c.much ?? null},
          ${c.rec ?? null}, ${c.great ?? null}, ${c.caveat ?? null},
          ${c.caveat !== undefined || c.caveatAnswered === true},
          ${c.who ?? null}, ${c.whoNot ?? null}, ${c.band ?? null},
          ${c.unit ?? null}, ${c.worth ?? null}, ${ci % 2 === 0}, ${c.tip ?? null},
          ${c.conf ?? null}, ${c.note ?? null}, ${s.needsDetail ?? null},
          ${c.rejected ? "rejected" : c.approved ? "approved" : s.status},
          ${c.approved ? daysAgo(3 + si) : null}, ${c.approved ? (si % 2 ? "janet" : "andrii") : null},
          false, ${daysAgo(48 - si * 2)}
        ) returning id`;

      contributions++;
      scored.push({ id: contribution.id, personId: author.id, ...c });
    }
  }

  console.log(`  shares: ${SHARES.length}, contributions: ${contributions}`);
  return scored;
}

/* ── Caregivers ──────────────────────────────────────────────────────────── */

/**
 * The whole consent ladder, plus the two cases the admin exists to handle: a
 * hesitant nomination held with a restricted note, and a near-duplicate pair
 * ("Maria G." and "Mariah G.") that must be shown as candidates and never
 * merged automatically.
 */
const CAREGIVERS = [
  {
    first: "Maria", initial: "G", by: 0, consent: "consented",
    active: true, discoverable: true, introducible: true,
    evidence: { method: "sms_reply", note: "Replied YES to the invite text on 2 Aug.", at: "2026-08-02T17:20:00.000Z" },
    nom: { careType: "regular_part_time", howKnown: "watched_my_kids", howLong: "1_3y", lastWorked: "current", ages: ["toddler", "preschool"], strengths: ["reliable", "toddlers", "plays_actively", "bilingual"], words: "She turns up early and my toddler runs to the door.", fit: ["regular_schedule", "work_from_home"], hire: "yes", band: "22_26", benchmark: true, ref: "yes", horizon: "6_months", changeType: "fewer_hours", recontact: true, schedule: ["weekday_mornings", "weekday_afternoons"], hours: "20_35", benefits: ["guaranteed_hours", "paid_holidays", "on_payroll"], status: "approved", invited: true },
  },
  {
    /* The near-duplicate. Same initial, similar name, a different person. */
    first: "Mariah", initial: "G", by: 7, consent: "invited",
    nom: { careType: "occasional_sitting", howKnown: "neighbor", howLong: "under_6m", lastWorked: "within_3m", ages: ["grade"], strengths: ["big_kids", "homework", "drives"], fit: ["school_runs", "occasional_nights"], hire: "yes", band: "18_22", benchmark: false, ref: "maybe", horizon: "no_change", recontact: false, schedule: ["weekday_evenings", "saturday"], hours: "under_10", benefits: ["none"], status: "pending_review", invited: true },
  },
  {
    first: "Elena", initial: "V", by: 3, consent: "consented",
    active: true, discoverable: true, introducible: false,
    evidence: { method: "in_person", note: "Signed the printed consent sheet at the Polytechnic coffee morning; Janet witnessed.", at: "2026-07-28T16:00:00.000Z" },
    nom: { careType: "full_time", howKnown: "watched_my_kids", howLong: "over_3y", lastWorked: "current", ages: ["baby", "toddler", "preschool"], strengths: ["newborns", "cooks", "cpr", "reliable"], words: "Three years and I have never once worried.", fit: ["multiple_kids", "first_time_parents"], hire: "yes", band: "26_32", benchmark: true, ref: "yes", horizon: "12_months", changeType: "child_starting_school", recontact: true, schedule: ["weekday_mornings", "weekday_afternoons", "weekday_evenings"], hours: "35_45", benefits: ["guaranteed_hours", "paid_time_off", "paid_holidays", "health_contribution", "on_payroll"], status: "approved", invited: true },
  },
  {
    first: "Joy", initial: "A", by: 1, consent: "consented",
    active: true, discoverable: false, introducible: false,
    evidence: { method: "sms_reply", note: "Confirmed by text, asked to stay unlisted for now.", at: "2026-08-11T19:05:00.000Z" },
    nom: { careType: "night_newborn", howKnown: "friends_caregiver", howLong: "under_6m", lastWorked: "within_3m", ages: ["baby"], strengths: ["newborns", "calm_with_shy", "cpr"], words: "She got us through the first eight weeks.", fit: ["first_time_parents"], hire: "yes", band: "over_32", benchmark: true, ref: "yes", horizon: "3_months", changeType: "role_ending", recontact: true, schedule: ["weeknights"], hours: "20_35", benefits: ["paid_holidays"], status: "approved", invited: true },
  },
  {
    /* Hesitant → held, with the reason in a restricted note. */
    first: "Tanya", initial: "R", by: 8, consent: "mentioned",
    nom: { careType: "before_after_school", howKnown: "through_school", howLong: "6_12m", lastWorked: "within_year", ages: ["grade"], strengths: ["homework", "drives"], fit: ["school_runs"], hire: "hesitant", hold: true, holdReasons: ["hire_again_hesitant", "private_note"], band: "18_22", benchmark: false, ref: "no", horizon: "unsure", recontact: false, schedule: ["weekday_afternoons"], hours: "under_10", benefits: ["mileage"], status: "pending_review", invited: false },
    notes: [
      { kind: "hesitation_reason", body: "Reliable with the children but repeatedly late for pickup, and defensive when I raised it. I would not use her for a hard deadline." },
      { kind: "private_note", body: "Asked me twice for an advance on wages. Nothing came of it and I do not want this shared, but a family should probably know to be clear about pay dates." },
    ],
  },
  {
    first: "Beatriz", initial: "S", by: 5, consent: "declined",
    nom: { careType: "occasional_sitting", howKnown: "family_friend", howLong: "1_3y", lastWorked: "within_year", ages: ["preschool", "grade"], strengths: ["plays_actively", "no_screens"], fit: ["occasional_nights"], hire: "yes", band: "18_22", benchmark: false, ref: "maybe", horizon: "no_change", recontact: false, schedule: ["weekday_evenings", "saturday"], hours: "under_10", benefits: ["none"], status: "approved", invited: true },
  },
  {
    first: "Priscilla", initial: "N", by: 2, consent: "revoked",
    nom: { careType: "regular_part_time", howKnown: "watched_my_kids", howLong: "1_3y", lastWorked: "over_year", ages: ["toddler"], strengths: ["toddlers", "reliable"], fit: ["regular_schedule"], hire: "yes", band: "22_26", benchmark: true, ref: "yes", horizon: "no_change", recontact: false, schedule: ["weekday_mornings"], hours: "10_20", benefits: ["paid_holidays"], status: "approved", invited: true },
  },
  {
    first: "Aisha", initial: "M", by: 9, consent: "invited",
    nom: { careType: "regular_part_time", howKnown: "watched_my_kids", howLong: "6_12m", lastWorked: "current", ages: ["preschool", "grade"], strengths: ["calm_with_shy", "homework", "bilingual", "flexible_hours"], words: "Endlessly patient with a child who takes a long time to trust anyone.", fit: ["shy_or_anxious", "regular_schedule"], hire: "yes", band: "22_26", benchmark: true, ref: "yes", horizon: "6_months", changeType: "full_to_part", recontact: true, schedule: ["weekday_afternoons"], hours: "10_20", benefits: ["guaranteed_hours", "mileage"], status: "pending_review", invited: true },
  },
  {
    first: "Grace", initial: "T", by: 11, consent: "mentioned",
    nom: { careType: "occasional_sitting", howKnown: "neighbor", howLong: "under_6m", lastWorked: "within_3m", ages: ["baby", "toddler"], strengths: ["reliable", "cpr", "drives"], fit: ["occasional_nights", "first_time_parents"], hire: "yes", band: "18_22", benchmark: false, ref: "maybe", horizon: "unsure", recontact: false, schedule: ["saturday", "sunday"], hours: "under_10", benefits: ["none"], status: "pending_review", invited: false },
  },
  {
    /* Wouldn't hire again — held, never dropped, and the reason is restricted. */
    first: "Colette", initial: "B", by: 13, consent: "mentioned",
    nom: { careType: "occasional_sitting", howKnown: "friends_caregiver", howLong: "under_6m", lastWorked: "over_year", ages: ["preschool"], strengths: ["plays_actively"], fit: ["occasional_nights"], hire: "no", hold: true, holdReasons: ["hire_again_no"], band: "prefer_not_to_say", benchmark: false, ref: "no", horizon: "no_change", recontact: false, schedule: ["varied"], hours: "varied", benefits: ["prefer_not_to_say"], status: "pending_review", invited: false },
    notes: [
      { kind: "hesitation_reason", body: "Left my four-year-old with an older sibling to answer the door to a delivery. Nothing happened, but I will not use her again." },
    ],
  },
];

async function seedCaregivers(people) {
  const made = [];
  for (const [i, c] of CAREGIVERS.entries()) {
    const parent = people[c.by];
    const [caregiver] = await sql`
      insert into caregivers (market_id, first_name, last_initial, is_adult,
                              consent_status, active, discoverable, introducible,
                              consent_evidence, provenance, is_test, created_at)
      values (${MARKET}, ${c.first}, ${c.initial}, true,
              ${c.consent}, ${c.active === true}, ${c.discoverable === true},
              ${c.introducible === true},
              ${c.evidence ? sql.json(c.evidence) : null},
              'parent_submitted', false, ${daysAgo(45 - i * 3)})
      returning id`;

    const [sub] = await sql`
      insert into submissions (client_id, person_id, kind, fields, is_test, received_at)
      values (${`demo-cg-${i}`}, ${parent.id}, 'caregiver',
              ${sql.json({ first_name: c.first, demo: true })}, false, ${daysAgo(45 - i * 3)})
      returning id`;

    const n = c.nom;
    const [nomination] = await sql`
      insert into caregiver_nominations (
        caregiver_id, person_id, submission_id, worked_for_family, care_type,
        how_known, how_long, last_worked, schedule_pattern, hours_per_week,
        benefits, cared_for_ages, strengths, in_their_words, good_fit_for,
        hire_again, needs_horizon, needs_change_type, recontact_ok, pay_band,
        pay_benchmark_consent, reference_willing, invite_sent_by_parent,
        review_hold, hold_reasons, status, approved_at, approved_by,
        is_test, created_at
      ) values (
        ${caregiver.id}, ${parent.id}, ${sub.id}, true, ${n.careType},
        ${n.howKnown}, ${n.howLong}, ${n.lastWorked}, ${n.schedule}::text[],
        ${n.hours}, ${n.benefits}::text[], ${n.ages}::text[],
        ${n.strengths}::text[], ${n.words ?? null}, ${n.fit}::text[],
        ${n.hire}, ${n.horizon}, ${n.changeType ?? null}, ${n.recontact},
        ${n.band}, ${n.benchmark}, ${n.ref}, ${n.invited},
        ${n.hold === true}, ${n.holdReasons ?? []}::text[],
        ${n.status}, ${n.status === "approved" ? daysAgo(20 - i) : null},
        ${n.status === "approved" ? "janet" : null}, false, ${daysAgo(45 - i * 3)}
      ) returning id`;

    for (const note of c.notes ?? []) {
      await sql`insert into restricted_notes (nomination_id, kind, body, created_at)
                values (${nomination.id}, ${note.kind}, ${note.body}, ${daysAgo(45 - i * 3)})`;
    }

    made.push({ id: caregiver.id, ...c });
  }

  console.log(`  caregivers: ${CAREGIVERS.length} (ladder: mentioned → consented, 2 held)`);
  return made;
}

/* ── 2C claims ───────────────────────────────────────────────────────────── */

async function seedClaims(caregivers) {
  /* Each claim needs its own verified `people` row — invariant 10 applies to a
     caregiver too. These are people, so they get the same `source = 'demo'`. */
  const rows = [
    {
      first: "Elena", initial: "V", phone: "+16265550901", status: "linked",
      link: caregivers.find((c) => c.first === "Elena"),
      roles: ["full_time", "regular_part_time"], ages: ["baby", "toddler", "preschool"],
      strengths: ["newborns", "cooks", "cpr", "reliable"],
      areas: ["san-marino", "south-pasadena", "arcadia"], drives: true,
      days: ["weekday_mornings", "weekday_afternoons"], rate: "26_32",
      from: "3_6_months", appear: true, intro: true, ref: true,
      hours: "Prefer to be done by 5.30 so I can collect my own daughter.",
    },
    {
      first: "Aisha", initial: "M", phone: "+16265550902", status: "pending",
      roles: ["regular_part_time", "before_after_school"], ages: ["preschool", "grade"],
      strengths: ["calm_with_shy", "homework", "bilingual", "flexible_hours"],
      areas: ["altadena", "northwest-pasadena"], drives: false,
      days: ["weekday_afternoons"], rate: "22_26", from: "1_3_months",
      appear: true, intro: false, ref: true,
      hours: "Afternoons only during term, more flexible in the summer.",
    },
    {
      /* Everything refused — a profile that exists and is visible to nobody.
         The flow promises this is a real outcome, so the demo has to show it. */
      first: "Yolanda", initial: "P", phone: "+16265550903", status: "pending",
      roles: ["occasional_sitting"], ages: ["grade", "tween"],
      strengths: ["big_kids", "drives", "no_screens"],
      areas: ["sierra-madre"], drives: true, days: ["saturday", "sunday"],
      rate: "18_22", from: "now", appear: false, intro: false, ref: false,
      hours: null,
    },
  ];

  for (const r of rows) {
    const [person] = await sql`
      insert into people (phone, first_name, market_id, source, phone_verified_at,
                          monthly_contact_allowance, allowance_mode, wants_founding,
                          founding, is_test, created_at)
      values (${r.phone}, ${r.first}, ${MARKET}, 'demo', ${daysAgo(12)},
              5, 'fixed', false, 'none', false, ${daysAgo(12)})
      returning id`;

    await sql`
      insert into consents (person_id, scope, status, source, text_version, captured_at)
      values (${person.id}, 'caregiver_profile', 'opted_in', 'caregiver_flow',
              'caregiver-2026-08-10', ${daysAgo(12)})`;
    if (r.appear) {
      await sql`insert into consents (person_id, scope, status, source, text_version, captured_at)
                values (${person.id}, 'caregiver_listing', 'opted_in', 'caregiver_flow',
                        'caregiver-2026-08-10', ${daysAgo(12)})`;
    }
    if (r.intro) {
      await sql`insert into consents (person_id, scope, status, source, text_version, captured_at)
                values (${person.id}, 'caregiver_introduction', 'opted_in', 'caregiver_flow',
                        'caregiver-2026-08-10', ${daysAgo(12)})`;
    }
    if (r.ref) {
      await sql`insert into consents (person_id, scope, status, source, text_version, captured_at)
                values (${person.id}, 'caregiver_reference', 'opted_in', 'caregiver_flow',
                        'caregiver-2026-08-10', ${daysAgo(12)})`;
    }

    await sql`
      insert into caregiver_claims (
        person_id, market_id, first_name, last_initial, roles_wanted,
        age_experience, strengths, areas_served, drives, days_available,
        hours_note, rate_band, available_from, open_to_reference_intros,
        appear_in_answers, open_to_introductions, consent_text_version,
        status, linked_caregiver_id, resolved_at, resolved_by, is_test, created_at
      ) values (
        ${person.id}, ${MARKET}, ${r.first}, ${r.initial}, ${r.roles}::text[],
        ${r.ages}::text[], ${r.strengths}::text[], ${r.areas}::text[],
        ${r.drives}, ${r.days}::text[], ${r.hours}, ${r.rate}, ${r.from},
        ${r.ref}, ${r.appear}, ${r.intro}, 'caregiver-2026-08-10',
        ${r.status}, ${r.link?.id ?? null},
        ${r.status === "linked" ? daysAgo(10) : null},
        ${r.status === "linked" ? "janet" : null}, false, ${daysAgo(12)}
      )`;

    /* A linked claim is what copies the caregiver's own answers onto her row. */
    if (r.link) {
      await sql`
        insert into caregiver_profiles (caregiver_id, roles_wanted, age_experience,
                                        strengths, areas_served, drives,
                                        days_available, hours_note, rate_band,
                                        available_from, open_to_reference_intros)
        values (${r.link.id}, ${r.roles}::text[], ${r.ages}::text[],
                ${r.strengths}::text[], ${r.areas}::text[], ${r.drives},
                ${r.days}::text[], ${r.hours}, ${r.rate}, ${r.from}, ${r.ref})
        on conflict (caregiver_id) do nothing`;
      await sql`update caregivers set profile_person_id = ${person.id}
                where id = ${r.link.id}`;
    }
  }

  console.log(`  2C claims: ${rows.length} (1 linked, 2 pending — one visible to nobody)`);
}

/* ── Demand (D1) ─────────────────────────────────────────────────────────── */

/**
 * All four sensitivity classes, spread across neighborhoods so "demand by area"
 * has a shape. `named_allegation` always carries `requires_human_review` — the
 * DB CHECK refuses it otherwise, which is the point of that constraint.
 */
const DEMAND = [
  { by: 0, q: "Is there a good music class for a really active 18-month-old near South Pas?", cat: "activities", s: "ordinary", review: false, status: "answered" },
  { by: 2, q: "Which of the Sierra Madre summer camps actually take a shy kid seriously?", cat: "camps", s: "ordinary", review: false, status: "answered" },
  { by: 3, q: "Is $28 an hour normal for a full-time nanny in San Marino now?", cat: "nannies", s: "ordinary", review: false, status: "matched" },
  { by: 5, q: "Anyone know a swim teacher who is patient with a genuinely scared five-year-old?", cat: "activities", s: "ordinary", review: false, status: "open" },
  { by: 8, q: "Which preschools near Altadena still have space for a January start?", cat: "preschools_schools", s: "ordinary", review: false, status: "open" },
  { by: 10, q: "Where do people find a sitter for a weekday evening at short notice?", cat: "babysitters", s: "ordinary", review: false, status: "open" },
  { by: 11, q: "What do the after-school options at Field actually cost once you add everything up?", cat: "working_parent_logistics", s: "ordinary", review: false, status: "open" },
  { by: 6, q: "Does anyone else secretly find this stage really lonely?", cat: "the_emotional_side", s: "peer_support", review: false, status: "answered" },
  { by: 9, q: "How did people manage going back to work without feeling like they were failing at both?", cat: "returning_to_work", s: "peer_support", review: false, status: "matched" },
  { by: 4, q: "I am struggling more than I let on and I do not know who to tell.", cat: "the_emotional_side", s: "peer_support", review: true, status: "open" },
  { by: 1, q: "Who do I call about a custody question in Los Angeles County?", cat: "health_legal_safety", s: "high_stakes", review: true, status: "open" },
  { by: 7, q: "My toddler is not talking yet and our doctor was dismissive — what do people do next?", cat: "pediatric_health", s: "high_stakes", review: true, status: "matched" },
  { by: 12, q: "Our nanny screamed at my child and then denied it. I do not know what to do.", cat: "childcare", s: "named_allegation", review: true, status: "open" },
];

async function seedDemand(people) {
  let flags = 0;
  for (const [i, d] of DEMAND.entries()) {
    const person = people[d.by];
    const [signal] = await sql`
      insert into demand_signals (person_id, question_text, category, neighborhood,
                                  sensitivity, requires_human_review, status,
                                  is_test, created_at)
      values (${person.id}, ${d.q}, ${d.cat}, ${person.n},
              ${d.s}, ${d.review}, ${d.status}, false, ${daysAgo(30 - i * 2)})
      returning id`;

    /* Anything owed a person today raises a flag — the red badge in the nav is
       driven by these, so the demo has to have some. */
    if (d.s === "named_allegation") {
      await sql`insert into flags (severity, reason, subject_kind, subject_id,
                                   person_id, excerpt, status, created_at)
                values ('escalation', 'named_allegation', 'demand_signal',
                        ${signal.id}, ${person.id},
                        'A claim about a named caregiver — human review only, never circulated.',
                        'open', ${daysAgo(30 - i * 2)})`;
      flags++;
    } else if (d.s === "high_stakes") {
      await sql`insert into flags (severity, reason, subject_kind, subject_id,
                                   person_id, excerpt, status, created_at)
                values ('escalation', 'high_stakes_demand', 'demand_signal',
                        ${signal.id}, ${person.id},
                        'Professional resources were shown immediately; a person should follow up.',
                        ${i % 2 ? "open" : "resolved"}, ${daysAgo(30 - i * 2)})`;
      flags++;
    }
  }
  console.log(`  demand: ${DEMAND.length} across 4 sensitivity classes, ${flags} escalations`);
}

/* ── Flags on contributions, pending options, referrals, audit ────────────── */

async function seedFlags(contributions) {
  let n = 0;
  for (const c of contributions) {
    if (c.namesPerson) {
      await sql`insert into flags (severity, reason, subject_kind, subject_id,
                                   person_id, excerpt, confidence, status, created_at)
                values ('review', 'possible_named_person', 'share_contribution',
                        ${c.id}, ${c.personId},
                        'Names an individual teacher. Excellent card — needs a human before it is used, not a lower score.',
                        ${c.conf}, 'open', ${daysAgo(14)})`;
      n++;
    }
    if (c.conf !== null && c.conf !== undefined && c.conf < 0.6) {
      await sql`insert into flags (severity, reason, subject_kind, subject_id,
                                   person_id, excerpt, confidence, status, created_at)
                values ('note', 'low_confidence', 'share_contribution',
                        ${c.id}, ${c.personId}, ${c.note}, ${c.conf}, 'open', ${daysAgo(13)})`;
      n++;
    }
    if (c.stale) {
      await sql`insert into flags (severity, reason, subject_kind, subject_id,
                                   person_id, field, status, created_at)
                values ('note', 'stale_at_capture', 'share_contribution',
                        ${c.id}, ${c.personId}, 'last_there', 'open', ${daysAgo(12)})`;
      n++;
    }
  }
  /* One resolved, so the flags page shows both states and who cleared it. */
  await sql`
    update flags set status = 'resolved', resolved_at = ${daysAgo(2)},
                     resolved_by = 'janet',
                     resolution_note = 'Read it — the teacher is named positively and the parent chose first-name attribution. Fine to use.'
    where reason = 'possible_named_person' and status = 'open'
      and id = (select id from flags where reason = 'possible_named_person' order by created_at limit 1)`;
  console.log(`  flags on contributions: ${n}`);
}

async function seedOptions(people) {
  const rows = [
    ["baby_activities", "Pasadena Rock Gym kids climbing", 3, "pending", 1],
    ["camps", "Caltech summer science week", 2, "pending", 3],
    ["schools", "Sequoyah High School", 1, "pending", 5],
    ["clubs", "Arroyo Seco Hiking Club families", 1, "pending", 7],
    ["worship", "Pasadena Buddhist Temple", 1, "pending", 9],
    ["neighborhoods", "Chapman Woods", 2, "approved", 0],
  ];
  for (const [category, value, occurrences, status, by] of rows) {
    await sql`
      insert into pending_options (market_id, category, submitted_value,
                                   submitted_by, occurrences, status, created_at)
      values (${MARKET}, ${category}, ${value}, ${people[by].id},
              ${occurrences}, ${status}, ${daysAgo(18)})
      on conflict (market_id, category, submitted_value) do nothing`;
  }
  console.log(`  pending options: ${rows.length}`);
}

async function seedReferrals(people) {
  /* Sarah brought three parents in — which is also the cap, so the demo shows a
     referrer sitting exactly on it. */
  const pairs = [
    [0, 4, "profile_complete"],
    [0, 6, "profile_complete"],
    [0, 9, "profile_complete"],
    [2, 11, "profile_complete"],
    [3, 12, "void"],
  ];
  for (const [a, b, status] of pairs) {
    await sql`
      insert into referrals (referrer_id, referred_id, status, created_at)
      values (${people[a].id}, ${people[b].id}, ${status}, ${daysAgo(25)})
      on conflict (referrer_id, referred_id) do nothing`;
  }
  console.log(`  referrals: ${pairs.length} (Sarah is on the cap of 3)`);
}

async function seedAudit() {
  /* `demo: true` in `after` is what --clear matches on, so this script can
     remove its own trail without touching a real admin's history. */
  const rows = [
    ["janet", "contribution.approve", "share_contribution", "Approved — clear, firsthand, age given."],
    ["janet", "share.answer_ready", "share", "Good enough to answer a question with on its own."],
    ["andrii", "contribution.approve", "share_contribution", "Approved."],
    ["janet", "caregiver.consent", "caregiver", "Replied YES by text; evidence recorded."],
    ["janet", "nomination.hold", "caregiver_nomination", "Hesitant rehire plus a private note — holding for a person."],
    ["janet", "claim.link", "caregiver_claim", "Matched to the nomination from her former family. Same first name, same initial, and the areas line up."],
    ["andrii", "option.promote", "market_option", "Two parents named it independently — promoting."],
    ["janet", "flag.resolve", "flag", "Read the note; the teacher is named positively."],
    ["janet", "invite.create", "invite", "Polytechnic incoming-families link for the autumn intake."],
    ["janet", "demand.mark_reviewed", "demand_signal", "Called her. Signposted to the county family-law line."],
  ];
  for (const [i, [actor, action, resource, note]] of rows.entries()) {
    await sql`
      insert into audit_log (at, actor, action, resource, resource_id, after)
      values (${daysAgo(20 - i)}, ${actor}, ${action}, ${resource}, null,
              ${sql.json({ note, demo: true })})`;
  }
  console.log(`  audit rows: ${rows.length}`);
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

try {
  if (CLEAR) {
    await clear();
  } else {
    const existing = await sql`select count(*)::int as n from people where source = 'demo'`;
    if (existing[0].n > 0) {
      console.error(
        `\n✗ ${existing[0].n} demo row(s) already exist.\n` +
          "  Run `npm run seed:demo -- --clear` first — seeding twice would double the cohort.\n",
      );
      process.exit(1);
    }

    console.log("\nseeding the demo cohort …\n");
    await seedInvites();
    const people = await seedPeople();
    const contributions = await seedShares(people);
    const caregivers = await seedCaregivers(people);
    await seedClaims(caregivers);
    await seedDemand(people);
    await seedFlags(contributions);
    await seedOptions(people);
    await seedReferrals(people);
    await seedAudit();
    console.log("\n✓ done. Every admin page now has something to show.\n");
  }
} catch (err) {
  console.error(
    "\n✗ seed failed:",
    err instanceof Error ? err.message : String(err),
  );
  if (err?.constraint_name) console.error("  constraint:", err.constraint_name);
  if (err?.detail) console.error("  detail:", err.detail);
  process.exitCode = 1;
} finally {
  await sql.end();
}
