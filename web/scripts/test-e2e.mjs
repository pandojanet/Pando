/**
 * End-to-end walk of Phase 1, against a running dev server and a real database.
 *
 *   npm run dev          # in another terminal
 *   npm run test:e2e
 *
 * It signs up a parent, answers the profile, shares cards, finishes, registers a
 * caregiver, and then drives the admin — checking at each step both what the API
 * answered *and* what actually landed in Postgres. Everything it creates is named
 * `Audit…` and removed at the end.
 *
 * Two things it is deliberately strict about:
 *
 *  - **Refusals are checks too.** Half of these assert that something was *not*
 *    stored: a card before the code is confirmed, a secondhand nomination, a
 *    sensitive question nobody gave permission to keep. A suite that only proves
 *    the happy path would have passed while every one of those leaked.
 *  - **It lies to the server on purpose.** The profile payload carries fabricated
 *    affinities and smuggled caregiver contact details, and asserts they do not
 *    survive. That is the difference between "the feature works" and "the feature
 *    cannot be talked out of".
 *
 * A fresh phone number per run, because the send limit (5/hour/number) is real and
 * re-using one across runs trips it and reads like a failure.
 *
 * **And a fresh `client_id` per run, for a subtler reason.** A card is idempotent on
 * that id, so a fixed one meant a re-run upserted into the row a previous run had
 * already approved — and "a contribution is queued for review" then failed against
 * state this run did not create. Only visible after a run crashed before its
 * cleanup, which is exactly when a suite should be at its most trustworthy.
 */

import { existsSync } from "node:fs";
import { randomBytes, scrypt } from "node:crypto";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";

const scryptAsync = promisify(scrypt);
for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const B = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const RUN = String((Math.floor(Date.now() / 1000) % 900) + 100);
const PHONE = `+1626555${RUN}1`;
const CG_PHONE = `+1626555${RUN}2`;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`);
  }
};
const head = (t) => console.log(`\n=== ${t} ===`);

function session() {
  const jar = new Map();
  const store = (r) =>
    (r.headers.getSetCookie() || []).forEach((c) => {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    });
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    async post(path, body) {
      const r = await fetch(B + path, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie() },
        body: JSON.stringify(body),
      });
      store(r);
      const t = await r.text();
      let j = null;
      try { j = JSON.parse(t); } catch {}
      return { status: r.status, json: j, text: t.slice(0, 130) };
    },
    async get(path) {
      const r = await fetch(B + path, { headers: { cookie: cookie() }, redirect: "manual" });
      return { status: r.status, location: r.headers.get("location") };
    },
    cookie,
  };
}

/* ── Part 1 · the parent-facing flow ─────────────────────────────────────── */

head("1.1  entry, invite, public site");
{
  const s = session();
  ok("/join renders", (await s.get("/join?i=sgv-founding")).status === 200);
  const r = await s.get("/?i=sgv-founding");
  ok("/?i= redirects to /join", r.status === 307 || r.status === 308, "-> " + r.location);
  for (const p of ["/", "/about", "/privacy", "/terms", "/caregiver"]) {
    ok(`${p} renders`, (await s.get(p)).status === 200);
  }
}

/* The order below — verify, then profile, then cards — is the *server's* order,
   and it is what these checks prove: nothing about a named parent exists before a
   confirmed code, whatever the client sends.

   On screen the code sits at the **end of the profile** (13 Aug): the answers are
   held on the phone until then, so the guarantee is the same, and everything after
   it is stored as it happens. It moved off the entry screen because asking a
   parent to prove a number before they have seen a single question is the friction
   the client asked us to keep off the front door. */
head("1.10  nothing is stored before the phone is verified");
const parent = session();
{
  const a = await parent.post("/api/seed/profile", { phone: PHONE, wants_founding: true, answers: { neighborhood: "altadena", child_ages: [3] } });
  ok("profile refused before OTP", a.status === 401, "-> " + (a.json && a.json.reason));
  const b = await parent.post("/api/seed/save", { invite_code: "sgv-founding", contributor_phone: PHONE, submission: { id: "x", kind: "activity", fields: { name: "X" } } });
  ok("card refused before OTP", b.status === 401);
  const c = await parent.post("/api/seed/complete", { phone: PHONE, follow_up_opt_in: true });
  ok("completion refused before OTP", c.status === 401);

  const start = await parent.post("/api/seed/verify/start", { phone: PHONE, sms_consent: true });
  ok("verification starts", start.status === 200, start.status === 200 ? "" : start.text);
  ok("no real SMS is sent (Twilio unprovisioned)", start.json && start.json.sent === false);
  ok("a dev code is offered for QA", start.json && typeof start.json.dev_code === "string");
  ok("a wrong code is refused", !((await parent.post("/api/seed/verify/check", { code: "000000" })).json || {}).ok);
  ok("the right code is accepted", ((await parent.post("/api/seed/verify/check", { code: start.json.dev_code })).json || {}).ok === true);
}

head("1.10  the §19 lock: three wrong guesses, then the number is out");
{
  /* Its own number, because the lock is keyed to the phone — running this on the
     parent's would lock the rest of the walk out of its own flow. */
  const s = session();
  const locked = `+1626555${RUN}9`;
  const st = await s.post("/api/seed/verify/start", { phone: locked, sms_consent: true });
  ok("a code was issued", st.status === 200 && typeof st.json.dev_code === "string");

  let last = null;
  for (let i = 0; i < 3; i++) {
    last = await s.post("/api/seed/verify/check", { code: "000000" });
  }
  ok("three wrong codes burn it", last.json && last.json.reason === "too_many_attempts");

  /* The point of the lock: a fresh code must not be a way around it. Checked from
     a *new* session, because a browser that throws away its cookie is exactly the
     case a per-verification counter would miss. */
  const again = await session().post("/api/seed/verify/start", { phone: locked, sms_consent: true });
  ok("a fresh code is refused while locked", again.status === 429 && again.json.reason === "locked");
  ok("and it says for how long", again.json.retry_in_seconds > 0, `${again.json.retry_in_seconds}s`);
  ok("even the right code is now refused", !((await s.post("/api/seed/verify/check", { code: st.json.dev_code })).json || {}).ok);
}

head("1.2 / 1.3  profile, and the graph derived from it");
{
  const res = await parent.post("/api/seed/profile", {
    invite_code: "sgv-founding",
    source: "link",
    phone: PHONE,
    wants_founding: true,
    first_name: "Audit",
    last_name: "Parent",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 5,
    allowance_mode: "fixed",
    children: [{ birth_year: 2022 }, { birth_year: 2019 }],
    child_ages_at_capture: [3, 6],
    attribution: "first_name_safe",
    aggregate_display: true,
    topic_preferences: ["camps"],
    school_status: { "walden-school": "current" },
    answers: {
      neighborhood: "altadena",
      child_ages: [3, 6],
      /* Month and year (3 Sep). Three entries and only the first is legitimate:
         13 is outside the CHECK and 11 is an age nobody tapped, and either one
         reaching `children` would abort the whole profile write on a
         constraint — a parent losing everything they answered because of one
         optional field. */
      child_months: { 3: 4, 6: 13, 11: 9 },
      schools: ["walden-school"],
      /* Whose it is. The 6-year-old's school, and a camp both children went to —
         plus an age nobody tapped, which must not survive. */
      child_of: {
        schools: { "walden-school": [6] },
        camps: { "tom-sawyer-camps": [3, 6, 11] },
      },
      classes: [], camps: ["tom-sawyer-camps"], faith: [], clubs: [],
      /* Removed as a question on 12 Aug — invites carry the group now. Still sent
         to prove the route ignores it rather than reviving a field. */
      invite_group: "altadena-moms",
      time_in_area: "3_10_years",
      family_structure: [], childcare_now: ["nanny_or_sitter"],
      logistics: ["close_to_home"], budget: ["compare_value"], trust_circles: [],
      topics: ["camps"], topics_lived: [],
      attribution: "first_name_safe",
      allowance: "5",
      other: { clubs: ["Audit Test Club"] },
    },
    /* Lies. None of these may survive — the server derives its own. */
    social_affinities: [
      { affinity_type: "school", affinity_value: "a-school-never-picked", score_weight: 99 },
      { affinity_type: "neighborhood", affinity_value: "somewhere-else", score_weight: 99 },
    ],
    life_relevance: [{ dimension: "budget", value: "fabricated" }],
    pending_options: [{ market_id: "another-market", category: "clubs", submitted_value: "Injected" }],
  });
  ok("profile persisted", res.status === 200 && res.json && res.json.persisted === true, "-> " + res.text);
}

head("1.4 / 1.5  cards, R1-R11, fix-a-field");
{
  const card = (fields, id) => parent.post("/api/seed/save", {
    invite_code: "sgv-founding", contributor_phone: PHONE,
    submission: { id, kind: fields.__kind, fields },
  });
  const full = {
    __kind: "activity", name: "Audit Swim School", venue: "on Mission",
    neighborhoods: ["altadena"], firsthand: "firsthand", child_age_at_time: [3],
    freshness: "recent", how_much: "a_term", recommendation: "yes",
    what_makes_it_great: "its good", caveat: "nothing comes to mind",
    who_for: "a nervous swimmer", price_band: "50_100", price_unit: "per_month",
    worth_it: "great_value", follow_up_ok: true, age_bands: ["preschool"],
  };
  const first = await card(full, `audit-activity-${RUN}`);
  ok("activity saved", first.status === 200 && first.json.persisted === true);

  const fixed = await card({ ...full, what_makes_it_great: "small groups and a very patient teacher", caveat: "Saturdays get packed" }, `audit-activity-${RUN}`);
  ok("fix-a-field re-saves the same card, not a second one", fixed.json.record_id === first.json.record_id);

  const place = await card({ __kind: "place", name: "Audit Park", place_type: "park", firsthand: "firsthand", child_age_at_time: [3], freshness: "over_year", what_makes_it_great: "shaded and fenced", caveat: "no toilets" }, `audit-place-${RUN}`);
  ok("a second card (stale place) saved", place.status === 200);

  /**
   * The card that made 1.8 wrong. It is concrete, first-hand and the most useful
   * of the three — and it praises one teacher by name, which used to cost it
   * roughly half its score and drop it into the low-confidence queue. Naming a
   * person is a *review* matter, never a *quality* one; the checks in 1.8 below
   * assert both halves of that.
   */
  const named = await card({
    __kind: "activity", name: "Audit Conservatory", neighborhoods: ["altadena"],
    firsthand: "firsthand", child_age_at_time: [7], freshness: "current",
    how_much: "a_year_plus", recommendation: "yes",
    what_makes_it_great: "Ms. Diane is extraordinary with anxious kids — she got my son playing in three weeks after a year of refusing to touch the piano.",
    caveat: "Her Tuesday slot goes first.", who_for: "A child who has given up on lessons before",
    price_band: "100_200", price_unit: "per_month", worth_it: "pricey_worth_it",
    follow_up_ok: true, age_bands: ["grade"],
  }, `audit-named-${RUN}`);
  ok("a card praising a named teacher saved", named.status === 200);
}

head("1.6  caregiver nomination — the refusals first");
{
  const nom = (fields, id) => parent.post("/api/seed/save", { invite_code: "sgv-founding", contributor_phone: PHONE, submission: { id, kind: "caregiver", fields } });
  ok("secondhand nomination refused (inv 14)", (await nom({ name: ["Nope", "N"], age_gate: "yes", worked_for_you: "no" }, `cg-bad-${RUN}a`)).status === 422);
  ok("under-18 nomination refused (inv 2)", (await nom({ name: ["Nope", "N"], age_gate: "no", worked_for_you: "yes" }, `cg-bad-${RUN}b`)).status === 422);
  const held = await nom({
    name: ["Auditcarer", "T"], age_gate: "yes", worked_for_you: "yes", type: "regular_part_time",
    strengths: ["reliable"], cared_for_ages: ["preschool"], last_worked: "current",
    hire_again: "hesitant", hesitation_reason: "a private reason recorded by the audit",
    private_note: "a private note recorded by the audit",
    /* Stage 1 — the shape of the week, its size and what came with it. A pay band
       on its own cannot tell a 40-hour role from ten hours of date nights. */
    schedule_pattern: ["weekday_afternoons"], hours_per_week: "10_20", benefits: ["paid_time_off"],
    pay_band: "22_26", pay_benchmark_ok: "yes", reference_willing: "yes", send_invite: "yes",
    /* Smuggled: must all be refused. */
    contact: "+15550000000", caregiver_phone: "+15550000000", consent_status: "consented", active: true,
  }, `audit-cg-${RUN}`);
  ok("a held nomination saved", held.status === 200 && held.json.persisted === true);
}

head("1.7  completion and D1 routing");
{
  const res = await parent.post("/api/seed/complete", {
    invite_code: "sgv-founding", phone: PHONE, name: "Audit Parent",
    follow_up_opt_in: true, monthly_contact_allowance: 5,
    shared: { activity: 1, place: 1, caregiver: 1 },
    /* The neighborhood is a lie the server must ignore — it reads the parent's own
       (v3.2 §9: this number decides which market Pando opens next). */
    demand: { question_text: "Any good swim schools near Audit Park?", category: "classes", neighborhood: "somewhere-else" },
  });
  ok("completion persisted", res.status === 200 && res.json.persisted === true, "-> " + res.text);

  let i = 0;
  for (const [label, demand] of [
    ["high stakes by category, no permission -> not kept", { question_text: "Who do I call about a custody question", category: "health_legal_safety" }],
    ["high stakes by category, permission given", { question_text: "Who do I call about a custody question", category: "health_legal_safety", may_save: true }],
    ["an ordinary category escalated by its words", { question_text: "The sitter left my child somewhere unsafe", category: "childcare", may_save: true }],
    ["peer support by category", { question_text: "Some days I feel completely alone in this", category: "the_emotional_side", may_save: true }],
    ["a claim about a named person, filed as ordinary", { question_text: "Our nanny screamed at my toddler and then lied about it", category: "childcare", may_save: true }],
  ]) {
    const s = session();
    const p = `+1626555${RUN}${3 + i}`;
    const st = await s.post("/api/seed/verify/start", { phone: p, sms_consent: true });
    await s.post("/api/seed/verify/check", { code: st.json.dev_code });
    await s.post("/api/seed/profile", { invite_code: "sgv-founding", phone: p, wants_founding: true, first_name: "AuditD1", sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" }, monthly_contact_allowance: 5, children: [{ birth_year: 2021 }], child_ages_at_capture: [4], answers: { neighborhood: "altadena", child_ages: [4], allowance: "5", other: {} } });
    const r = await s.post("/api/seed/complete", { invite_code: "sgv-founding", phone: p, follow_up_opt_in: true, monthly_contact_allowance: 5, demand });
    const kept = label.includes("not kept") ? r.json.demand_signal_id == null : r.status === 200 && r.json.persisted === true;
    ok("D1: " + label, kept);
    i++;
  }
}

head("the anonymous path");
{
  const anon = session();
  const res = await anon.post("/api/seed/save", { invite_code: "sgv-founding", submission: { id: `audit-anon-${RUN}`, kind: "tip", fields: { tip: "An audit anonymous tip", topic: "schedules" } } });
  ok("an anonymous card stores with no phone", res.status === 200 && res.json.persisted === true);
}

head("2C  the caregiver's own flow");
{
  const cg = session();
  ok("claim refused before OTP", (await cg.post("/api/caregiver/claim", { phone: CG_PHONE, profile_consent: true, first_name: "Auditcarer" })).status === 401);
  const st = await cg.post("/api/seed/verify/start", { phone: CG_PHONE, sms_consent: true });
  await cg.post("/api/seed/verify/check", { code: st.json.dev_code });
  ok("claim refused without G2 consent", (await cg.post("/api/caregiver/claim", { phone: CG_PHONE, profile_consent: false, first_name: "Auditcarer" })).status === 422);
  const claim = await cg.post("/api/caregiver/claim", {
    phone: CG_PHONE, profile_consent: true, first_name: "Auditcarer", last_initial: "t",
    roles_wanted: ["regular_part_time", "not-a-real-role"], age_experience: ["preschool"],
    strengths: ["reliable"], areas_served: ["altadena"], drives: "yes",
    days_available: ["weekday_afternoons"], available_from: "1_3_months", rate_band: "22_26",
    /* introduce without appear: the larger permission must be dropped, not the claim */
    appear_in_answers: false, open_to_introductions: true, open_to_reference_intros: true,
  });
  ok("claim stored", claim.status === 200 && claim.json.persisted === true, "-> " + claim.text);
}

head("honesty and health");
{
  const s = session();
  const h = await (await fetch(B + "/api/health")).json();
  ok("/api/health reports a reachable database", h.db.configured && h.db.reachable);
  const v = await (await fetch(B + "/api/seed/verify/status")).json();
  ok("verify status reports the real config", v.required === true && v.provisioned === false);
  const page = await s.get("/admin/contributors");
  ok("admin redirects an anonymous browser", page.status === 307, "-> " + page.location);
  ok("admin API refuses with no session", (await s.post("/api/admin/query", { resource: "overview", params: {} })).status === 401);
}

/* ── Part 2 · what actually landed in Postgres ───────────────────────────── */

const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });

/**
 * Extraction runs *after* the save response, so this waits for it — by polling
 * for the work rather than sleeping for a guessed nine seconds.
 *
 * The guess was the problem: when the model provider is briefly overloaded (529),
 * the SDK's own retries take longer than the sleep, and three checks that are
 * about *this app* went red for something upstream and temporary. Trained on
 * that, a red suite stops meaning anything.
 *
 * The bound is still real. If nothing is scored inside it, the checks below fail
 * exactly as they did — which is the honest answer when the provider is down.
 */
{
  const deadline = Date.now() + 60_000;
  for (;;) {
    const [{ waiting }] = await sql`
      select count(*)::int as waiting
      from share_contributions pc
      join submissions s on s.id = pc.submission_id
      where s.client_id like ${'audit-%' + RUN} and s.kind <> 'caregiver'
        and pc.confidence is null
    `;
    if (waiting === 0 || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/* A Ukrainian number, end to end (20 Aug).
 *
 * `scripts/test-phone.mts` proves the parsing in isolation; this proves the two
 * things it cannot reach — that the *national* form the field emits survives the
 * whole request chain, and that what lands in `people.phone` is E.164. Written as
 * its own walk because the number is the identity (invariant 10): a `+380` that
 * arrived as anything else would silently be a second person.
 *
 * `AuditUa`, not `Audit`: the assertions below this one find the walk's parent
 * with `first_name = 'Audit' order by created_at desc`, so a second row sharing
 * that first name is newer and wins — which failed eighteen checks that had
 * nothing to do with phone numbers. The prefix still matches the `like 'Audit%'`
 * cleanup. */
/* Per-affiliation visibility — the client's Privacy Guidance §A (24 Aug).
 *
 * The three cases below are the whole design, and the third is the one a
 * delete-and-rewrite would silently lose: a grant that disappears from the
 * payload is a **revocation with a timestamp**, not an absence. §G asks for the
 * effective time of the change, and this is the only derived table in the profile
 * write that is upserted rather than rebuilt, for exactly that reason. */
head("24 Aug  per-affiliation privacy: grant, keep, revoke");
{
  const s = session();
  const phone = `+1626557${RUN}1`;
  const st = await s.post("/api/seed/verify/start", { phone, sms_consent: true });
  await s.post("/api/seed/verify/check", { code: st.json.dev_code });

  const base = {
    invite_code: "sgv-founding", source: "link", phone,
    wants_founding: true, first_name: "AuditPriv", last_name: "Grant",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 5, allowance_mode: "fixed",
    children: [{ birth_year: 2019 }], child_ages_at_capture: [6],
    attribution: "name_private", aggregate_display: true,
  };
  const answers = (granted) => ({
    neighborhood: "altadena",
    child_ages: [6],
    schools: ["walden-school"],
    clubs: ["audit-priv-club"],
    shared_connections: "share_connection",
    shared_affiliations: granted,
  });

  /* Scoped by **phone**, not by first name.
     `= (select …)` on a name blew up with "more than one row returned by a
     subquery" the moment a previous run left a row behind — which is exactly when
     a suite should still be readable. The phone carries `RUN`, so it is unique to
     this run and matches exactly one person. */
  const rows = async () =>
    sql`select affiliation_type, affiliation_value, visibility,
               consent_text_version, consented_at, revoked_at
          from affiliation_visibility
         where person_id in (select id from people where phone = ${phone})
         order by affiliation_type`;

  /* 1 — granted. Both halves of the evidence are required by a CHECK, so a row
        that reached the table at all has them; assert them anyway, because the
        point of the column is that it can be produced later. */
  const a = await s.post("/api/seed/profile", {
    ...base,
    answers: answers(["schools:walden-school", "clubs:audit-priv-club"]),
  });
  ok("a profile with grants persists", a.status === 200 && a.json.persisted === true, "-> " + a.text);

  let got = await rows();
  ok("both grants are stored as shared", got.length === 2 && got.every((r) => r.visibility === "shared_anonymously"), `${got.length} row(s)`);
  ok("each carries the wording version it was given under", got.every((r) => r.consent_text_version === "seed-affiliation-2026-08-24"));
  ok("and the moment it was given", got.every((r) => r.consented_at !== null));
  /* The question ids are `schools` / `clubs`; the graph's are `school` /
     `social_group`. A grant filed under the questionnaire's word would name an
     edge nothing looks for. */
  ok(
    "stored in the graph's vocabulary, not the questionnaire's",
    got.some((r) => r.affiliation_type === "school") &&
      got.some((r) => r.affiliation_type === "social_group"),
    got.map((r) => r.affiliation_type).join(", "),
  );

  const firstGrantedAt = got.find((r) => r.affiliation_type === "school").consented_at;

  /* 2 — one kept, one dropped. The kept row must not be re-stamped: the parent
        decided once, and re-confirming is not a new decision. */
  const b = await s.post("/api/seed/profile", {
    ...base,
    answers: answers(["schools:walden-school"]),
  });
  ok("re-saving with one grant removed goes through", b.status === 200);

  got = await rows();
  const school = got.find((r) => r.affiliation_type === "school");
  const club = got.find((r) => r.affiliation_type === "social_group");

  ok("the kept grant is still shared", school.visibility === "shared_anonymously");
  ok(
    "and its original consent time is untouched",
    String(school.consented_at) === String(firstGrantedAt),
    `${firstGrantedAt} -> ${school.consented_at}`,
  );
  /* The case the whole design turns on. */
  ok("the dropped grant became private", club.visibility === "private");
  ok("and the revocation is timestamped, not silent", club.revoked_at !== null);
  ok("the row is kept rather than deleted", got.length === 2);

  /* 3 — granting it again clears the revocation. The CHECK refuses a row that is
        both revoked and shareable, so this would 500 if it did not. */
  const c = await s.post("/api/seed/profile", {
    ...base,
    answers: answers(["schools:walden-school", "clubs:audit-priv-club"]),
  });
  ok("re-granting a revoked connection goes through", c.status === 200, "-> " + c.text);
  got = await rows();
  const regranted = got.find((r) => r.affiliation_type === "social_group");
  ok("it is shared again", regranted.visibility === "shared_anonymously");
  ok("and no longer carries a revocation", regranted.revoked_at === null);

  /* Nothing a parent skips may grant anything — §A: "Continue is not consent." */
  const d = await s.post("/api/seed/profile", { ...base, answers: answers([]) });
  ok("an empty grant list revokes everything", d.status === 200);
  got = await rows();
  ok(
    "and leaves nothing shared",
    got.every((r) => r.visibility === "private" && r.revoked_at !== null),
    got.map((r) => r.visibility).join(", "),
  );

  /* A ref the client invented must not become a permission. */
  const e = await s.post("/api/seed/profile", {
    ...base,
    answers: answers(["topics:sleep_routines", "not-a-ref", "schools:walden-school"]),
  });
  ok("a ref for a question that is not a connection is refused", e.status === 200);
  got = await rows();
  ok(
    "only the real connection was granted",
    got.filter((r) => r.visibility === "shared_anonymously").length === 1,
    got.filter((r) => r.visibility === "shared_anonymously").map((r) => r.affiliation_type).join(", "),
  );
}

head("1.10  a Ukrainian number, from the field to the row");
{
  const s = session();
  const uaNational = `067 555 ${RUN.slice(0, 2)} ${RUN.slice(2)}1`;
  const uaE164 = `+38067555${RUN}1`;

  const st = await s.post("/api/seed/verify/start", { phone: uaNational, sms_consent: true });
  ok("a code is issued for a +380 number", st.status === 200 && typeof st.json.dev_code === "string", "-> " + st.text);
  ok("the code confirms", ((await s.post("/api/seed/verify/check", { code: st.json.dev_code })).json || {}).ok === true);

  /* The browser sends what the field holds — the national form, not E.164. The
     route has to normalise it, or the profile lands under a different key than
     the verification did. */
  const profile = {
    invite_code: "sgv-founding", source: "link",
    wants_founding: true, first_name: "AuditUa", last_name: "Kyiv",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 5, allowance_mode: "fixed",
    children: [{ birth_year: 2019 }], child_ages_at_capture: [6],
    attribution: "first_name_safe", aggregate_display: true,
    answers: { neighborhood: "altadena", child_ages: [6] },
  };
  const res = await s.post("/api/seed/profile", { ...profile, phone: uaNational });
  ok("the profile persists on a +380 number", res.status === 200 && res.json.persisted === true, "-> " + res.text);

  const row = (await sql`select phone, phone_verified_at from people where first_name = 'AuditUa'`)[0];
  ok("stored in E.164, not as it was typed", row && row.phone === uaE164, "-> " + (row && row.phone));
  ok("and verified", Boolean(row && row.phone_verified_at));

  /* The same number written the other way must reach the same row rather than a
     second one — which is the whole reason `toE164` is idempotent. */
  const again = await s.post("/api/seed/profile", { ...profile, phone: uaE164 });
  ok("re-sending it in E.164 is accepted", again.status === 200);
  const count = Number((await sql`select count(*)::int as n from people where phone = ${uaE164}`)[0].n);
  ok("one number, one person — not two", count === 1, `${count} rows`);
}

head("27 Aug  a neighborhood the parent typed is still an answer");
{
  /**
   * The bug this holds shut cost a real founding contributor a completed
   * session.
   *
   * P3 sets `allowOther`, and `isQuestionAnswered` counts a typed entry — so
   * the screen let them past, the review screen printed what they wrote, and the
   * flow told them it was saved. The route then asked `cleanId` for a canonical
   * id, got null, and refused the **entire profile** with "Neighborhood and child
   * age are required" for a question they had plainly answered. They verified
   * their phone with a correct code and watched three saves fail, with nothing on
   * screen that could suggest going back and tapping a listed area instead.
   *
   * A typed answer is an answer for §8.5's two required questions. What it is not
   * is matchable — invariant 9 — and that is handled without the route's help:
   * the text goes to `pending_options` for an admin, and `people.neighborhood`
   * stays null rather than holding words no taxonomy contains.
   */
  /* 626556 suffix 8: the D1 loop owns 3-7 on 626555, the allowance block takes
     626556 1-2, the referral block inserts 626556 3-6 directly and 7 is spoken
     for. Borrowing one of those inserts a second person on a number that is
     already a person, and the failure is a unique-violation forty checks later. */
  const typedPhone = `+1626556${RUN}8`;
  const s = session();
  const st = await s.post("/api/seed/verify/start", { phone: typedPhone, sms_consent: true });
  await s.post("/api/seed/verify/check", { code: st.json.dev_code });

  const res = await s.post("/api/seed/profile", {
    invite_code: "sgv-founding", phone: typedPhone, wants_founding: true,
    first_name: "AuditTypedHood", last_name: "Parent",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 5, children: [{ birth_year: 2021 }], child_ages_at_capture: [4],
    answers: {
      /* Exactly what the flow stores when they add their own: nothing in the
         canonical field, the words in `other`. */
      neighborhood: null,
      child_ages: [4],
      other: { neighborhood: ["Bungalow Heaven"] },
    },
  });
  ok(
    "a typed neighborhood no longer refuses the whole profile",
    res.status === 200 && res.json.persisted === true,
    "-> " + res.status + " " + res.text,
  );

  const [row] = await sql`select neighborhood from people where first_name = 'AuditTypedHood'`;
  ok("the person is stored", Boolean(row));
  ok(
    "and their neighborhood is null, not their own words",
    row && row.neighborhood === null,
    "-> " + JSON.stringify(row && row.neighborhood),
  );

  /* Invariant 9's half: unmatchable until an admin promotes it, and promotion
     then writes the affinity row for everyone who typed it (12 Aug). */
  const pending = await sql`select category, submitted_value, status
                              from pending_options
                             where submitted_value = 'Bungalow Heaven'`;
  ok(
    "the words are queued for an admin instead",
    pending.length === 1 && pending[0].category === "neighborhoods",
    "-> " + JSON.stringify(pending),
  );

  /* The presence check is only relaxed for a real answer — an empty string and a
     genuine absence must still be refused, or "required" means nothing. */
  const blank = await s.post("/api/seed/profile", {
    invite_code: "sgv-founding", phone: typedPhone, wants_founding: true,
    first_name: "AuditBlankHood",
    answers: { neighborhood: null, child_ages: [4], other: { neighborhood: ["   "] } },
  });
  ok(
    "whitespace is not an answer",
    blank.status === 422 && blank.json.fields.includes("neighborhood"),
    "-> " + blank.status + " " + blank.text,
  );
  const none = await s.post("/api/seed/profile", {
    invite_code: "sgv-founding", phone: typedPhone, wants_founding: true,
    first_name: "AuditNoHood",
    answers: { neighborhood: null, child_ages: [4], other: {} },
  });
  ok(
    "and no answer at all is still refused, naming the field",
    none.status === 422 && none.json.fields.includes("neighborhood"),
    "-> " + none.status + " " + none.text,
  );
  ok(
    "the 422 names which of the two failed, rather than blaming both",
    none.json.error.includes("neighborhood") && !none.json.error.includes("child age"),
    "-> " + none.json.error,
  );
}

head("18 Aug  five-question minimum (allowance) and the listening-ear opt-in");
{
  /* The 1/3/5 scheme is gone — 3 must no longer validate, and must fall back
     to 5, the new default, not to whatever number happens to be lowest. */
  /* A different exchange (626556, not 626555) — the D1 loop below already owns
     suffixes 3-7 on 626555, and every other single digit on it is spoken for
     too, so borrowing one here would collide with a person that test creates. */
  const oldScheme = `+1626556${RUN}1`;
  const s1 = session();
  const st1 = await s1.post("/api/seed/verify/start", { phone: oldScheme, sms_consent: true });
  await s1.post("/api/seed/verify/check", { code: st1.json.dev_code });
  await s1.post("/api/seed/profile", {
    invite_code: "sgv-founding", phone: oldScheme, wants_founding: true, first_name: "AuditOldAllowance",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 3, children: [{ birth_year: 2020 }], child_ages_at_capture: [5],
    listening_ear_consent: { status: "opted_in", text_version: "seed-listening-ear-2026-08-18" },
    recurring_messages_consent: { status: "opted_in", text_version: "seed-recurring-2026-09-02" },
    answers: { neighborhood: "altadena", child_ages: [5], allowance: "3", other: {} },
  });
  const [oldRow] = await sql`select monthly_contact_allowance from people where first_name = 'AuditOldAllowance'`;
  ok("3 no longer validates and falls back to 5, not 3", oldRow && oldRow.monthly_contact_allowance === 5, `-> ${oldRow?.monthly_contact_allowance}`);

  /* 10 is new and must be accepted as-is. */
  const tenPhone = `+1626556${RUN}2`;
  const s2 = session();
  const st2 = await s2.post("/api/seed/verify/start", { phone: tenPhone, sms_consent: true });
  await s2.post("/api/seed/verify/check", { code: st2.json.dev_code });
  await s2.post("/api/seed/profile", {
    invite_code: "sgv-founding", phone: tenPhone, wants_founding: true, first_name: "AuditTenAllowance",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 10, children: [{ birth_year: 2020 }], child_ages_at_capture: [5],
    /* A "declined" this consent cannot legitimately be: the checkbox gates the
       screen, so the route must drop it rather than store a refusal the flow
       cannot produce. Asserted below. */
    listening_ear_consent: { status: "declined", text_version: "seed-listening-ear-2026-08-18" },
    recurring_messages_consent: { status: "declined", text_version: "seed-recurring-2026-09-02" },
    answers: { neighborhood: "altadena", child_ages: [5], allowance: "10", other: {} },
  });
  const [tenRow] = await sql`select monthly_contact_allowance from people where first_name = 'AuditTenAllowance'`;
  ok("10 is accepted", tenRow && tenRow.monthly_contact_allowance === 10);

  /* The listening-ear opt-in is its own consent scope, recorded either way —
     "declined" is a real answer, not a non-answer, same rule as every consent. */
  const earConsents = await sql`
    select p.first_name, c.status, c.text_version from consents c
    join people p on p.id = c.person_id
    where c.scope = 'listening_ear' and p.first_name in ('AuditOldAllowance', 'AuditTenAllowance')
    order by p.first_name`;
  ok(
    "listening-ear consent recorded for both, opted_in and declined",
    earConsents.length === 2 &&
      earConsents[0].status === "opted_in" &&
      earConsents[1].status === "declined" &&
      earConsents.every((c) => c.text_version === "seed-listening-ear-2026-08-18"),
    JSON.stringify(earConsents),
  );

  /**
   * 2 Sep — the recurring SMS/RCS opt-in that rides with the participation
   * level. Asserted against the **landed row**, not the 200: it needed
   * `consents_scope_check` widened (drizzle 0028), and a route that accepted
   * the field while the CHECK still refused the scope would answer 502 from one
   * layer down — which is exactly how the 18 Aug allowance change was caught.
   */
  const recurring = await sql`
    select p.first_name, c.status, c.text_version from consents c
    join people p on p.id = c.person_id
    where c.scope = 'sms_recurring'
      and p.first_name in ('AuditOldAllowance', 'AuditTenAllowance')
    order by p.first_name`;
  ok(
    "the recurring SMS/RCS consent lands under its own scope and version",
    recurring.length === 1 &&
      recurring[0].first_name === "AuditOldAllowance" &&
      recurring[0].status === "opted_in" &&
      recurring[0].text_version === "seed-recurring-2026-09-02",
    JSON.stringify(recurring),
  );
  ok(
    "and a declined one is dropped rather than stored as a refusal",
    !recurring.some((c) => c.first_name === "AuditTenAllowance"),
    "the checkbox gates the screen, so 'declined' is a state the flow cannot produce",
  );
}

const [p] = await sql`select * from people where first_name = 'Audit' order by created_at desc limit 1`;

head("1.3  the derived graph — and the lies that did not survive");
ok("the person exists", !!p);
ok("phone_verified_at is a server fact", p && p.phone_verified_at !== null);
ok("founding is pending, never self-granted", p && p.founding === "pending_founding");
const aff = await sql`select affinity_type, affinity_value, weight_at_capture, child_birth_years from social_affinities where person_id = ${p.id} order by affinity_type`;
ok("the fabricated school affinity was ignored", !aff.some((a) => a.affinity_value === "a-school-never-picked"));
ok("the fabricated neighborhood was ignored", !aff.some((a) => a.affinity_value === "somewhere-else"));
ok("the real neighborhood was derived", aff.some((a) => a.affinity_value === "altadena"));
ok("the real school was derived", aff.some((a) => a.affinity_value === "walden-school"));
const camp = aff.find((a) => a.affinity_value === "tom-sawyer-camps");
ok("a camp is an activity edge, at the class weight (v3.2 §8.4)", !!camp && camp.affinity_type === "activity" && Number(camp.weight_at_capture) === 4);
const thisYear = new Date().getFullYear();
const school = aff.find((a) => a.affinity_value === "walden-school");
ok("a school edge says which child it belongs to", school && JSON.stringify(school.child_birth_years) === JSON.stringify([thisYear - 6]));
ok("a camp can belong to two children", camp && (camp.child_birth_years ?? []).length === 2);
ok("an age nobody tapped is not attributed to anybody", camp && !(camp.child_birth_years ?? []).includes(thisYear - 11));
ok("household edges carry no child at all", aff.filter((a) => a.affinity_type === "neighborhood").every((a) => a.child_birth_years === null));
ok("age bands were derived from the tapped ages", aff.some((a) => a.affinity_type === "age_range"));
ok("weights come from the question set, not the body", aff.every((a) => Number(a.weight_at_capture) < 99));
const rel = await sql`select dimension, value from life_relevance where person_id = ${p.id}`;
ok("the fabricated relevance row was ignored", !rel.some((r) => r.value === "fabricated"));
ok("relevance was derived, including rows the client never sent", rel.some((r) => r.dimension === "tenure"), JSON.stringify(rel.map((r) => r.dimension)));
const pend = await sql`select market_id, submitted_value, status from pending_options where submitted_by = ${p.id}`;
ok("the injected pending option was ignored", !pend.some((o) => o.submitted_value === "Injected"));
ok("the real 'other' answer is parked as pending (inv 9)", pend.some((o) => o.submitted_value === "Audit Test Club" && o.status === "pending"));
ok("its market came from the invite", pend.every((o) => o.market_id === "pasadena"));
const kids = await sql`select birth_year, birth_month from children where person_id = ${p.id} order by birth_year`;
ok("children stored as birth years", kids.length === 2);
ok("a birth month lands beside its year (3 Sep)", kids.some((k) => k.birth_year === thisYear - 3 && k.birth_month === 4), JSON.stringify(kids));
ok("a month outside 1-12 is dropped, not stored", kids.every((k) => k.birth_month === null || (k.birth_month >= 1 && k.birth_month <= 12)));
ok("and the 6-year-old keeps no month at all", kids.some((k) => k.birth_year === thisYear - 6 && k.birth_month === null));
const sch = await sql`select status, child_birth_years from person_schools where person_id = ${p.id}`;
ok("school carries its own status (P5)", sch.length === 1 && sch[0].status === "current");
ok("and the same child the affinity says", sch.length === 1 && JSON.stringify(sch[0].child_birth_years) === JSON.stringify([thisYear - 6]));

head("1.5  the activity card");
const [a] = await sql`select pc.* from share_contributions pc join shares pl on pl.id = pc.share_id where pl.name = 'Audit Swim School'`;
ok("firsthand recorded", a && a.firsthand === true);
ok("caveat_answered true", a && a.caveat_answered === true);
ok("price band kept with its unit", a && a.price_band === "50_100" && a.price_unit === "per_month");
ok("the correction replaced the text", a && /patient teacher/.test(a.what_makes_it_great ?? ""));
const nCards = await sql`select count(*)::int as n from share_contributions where person_id = ${p.id}`;
/* Three cards, four saves — the activity was re-saved once as a fix-a-field. */
ok("one contribution per card, not per save", nCards[0].n === 3, `${nCards[0].n} rows`);

/* Estimate 1.8's confirm-back leaves a marker on the card so it is never asked
   twice, and the client strips every `__`-prefixed key before sending. This is
   the belt: a build that forgot to strip must not break the save, and the marker
   must not reach a column. */
{
  const withMarker = await parent.post("/api/seed/save", {
    invite_code: "sgv-founding",
    contributor_phone: PHONE,
    submission: {
      id: "audit-cb-marker",
      kind: "tip",
      fields: {
        topic: "costs",
        tip: "good — book the park shelters through the city website",
        best_for: ["grade"],
        __confirm_back_asked: "yes",
      },
    },
  });
  ok("an internal marker does not break the save", withMarker.status === 200);
  const [row] = await sql`
    select tip_text from share_contributions
     where person_id = ${p.id} and tip_text like 'good — book the park%'`;
  ok("the card landed with the merged answer", Boolean(row), row ? "" : "no row");
  const leaked = await sql`
    select count(*)::int as n from submissions
     where person_id = ${p.id} and fields::text like '%__confirm_back_asked%'`;
  ok("and the marker is nowhere in what was stored", leaked[0].n === 0, `${leaked[0].n} row(s)`);
}

head("1.6  the nomination, holds and restricted notes");
const [n] = await sql`select cn.id as nomination_id, cn.*, c.consent_status, c.active, c.discoverable, c.introducible from caregiver_nominations cn join caregivers c on c.id = cn.caregiver_id where c.first_name = 'Auditcarer'`;
ok("worked_for_family forced true", n && n.worked_for_family === true);
ok("a hesitant answer held the card", n && n.review_hold === true, JSON.stringify(n && n.hold_reasons));
ok("the ladder starts at mentioned", n && n.consent_status === "mentioned");
ok("not active / discoverable / introducible", n && !n.active && !n.discoverable && !n.introducible);
ok("pay band and benchmark consent are separate", n && n.pay_band === "22_26" && n.pay_benchmark_consent === true);
ok("the job's shape, size and benefits landed with the rate (Stage 1)", n && n.hours_per_week === "10_20" && (n.schedule_pattern ?? []).includes("weekday_afternoons") && (n.benefits ?? []).includes("paid_time_off"), JSON.stringify([n && n.schedule_pattern, n && n.hours_per_week, n && n.benefits]));
const notes = await sql`select kind from restricted_notes where nomination_id = ${n.nomination_id} order by kind`;
ok("both restricted notes landed with it (inv 12)", notes.length === 2, JSON.stringify(notes.map((x) => x.kind)));
const cgCols = (await sql`select column_name from information_schema.columns where table_name = 'caregivers'`).map((c) => c.column_name);
ok("caregivers has no contact column at all (inv 13)", !cgCols.some((c) => /phone|email|address|contact/.test(c)));
const [nomJson] = await sql`select to_jsonb(cn) as j from caregiver_nominations cn where cn.id = ${n.nomination_id}`;
ok("the smuggled contact details were refused", !JSON.stringify(nomJson.j).includes("15550000000"));

head("1.7  consents and demand");
const cons = await sql`select scope, text_version from consents where person_id = ${p.id}`;
ok("sms consent recorded at phone capture", cons.some((c) => c.scope === "sms"));
ok("follow-up consent recorded", cons.some((c) => c.scope === "follow_up"));
ok("every consent carries a wording version", cons.every((c) => c.text_version));
const dem = await sql`select d.question_text, d.sensitivity, d.requires_human_review, d.neighborhood
  from demand_signals d join people p on p.id = d.person_id
  where p.first_name like 'Audit%'`;
const swim = dem.find((d) => /swim schools/.test(d.question_text));
ok("the demand's neighborhood is read from the profile, not the body", swim && swim.neighborhood === "altadena", swim ? String(swim.neighborhood) : "");
const custody = dem.filter((d) => /custody/.test(d.question_text));
ok("a sensitive question is kept only with permission", custody.length === 1, `${custody.length} of the 2 asked`);
const unsafe = dem.find((d) => /unsafe/.test(d.question_text));
ok("an ordinary category escalates on its words, never de-escalates", unsafe && unsafe.sensitivity === "high_stakes");
ok("high stakes needs a human", unsafe && unsafe.requires_human_review === true);
const peer = dem.find((d) => /completely alone/.test(d.question_text));
ok("peer support routed by category", peer && peer.sensitivity === "peer_support");
ok("high stakes raised an escalation flag", (await sql`select 1 from flags where reason = 'high_stakes_demand' and status = 'open'`).length > 0);
const allegation = dem.find((d) => /screamed/.test(d.question_text));
ok("a claim about a named person is its own class, not high stakes", allegation && allegation.sensitivity === "named_allegation");
ok("and it cannot be stored without a human attached", allegation && allegation.requires_human_review === true);
ok("it raised its own escalation, under its own reason", (await sql`select 1 from flags where reason = 'named_allegation' and status = 'open'`).length > 0);

head("1.8 / 1.9  extraction and flags");
const scored = await sql`select confidence, confidence_note from share_contributions where person_id = ${p.id} and confidence is not null`;
const shareCards = await sql`select count(*)::int as n from share_contributions where person_id = ${p.id}`;
/* Every share card this walk made, not a hardcoded three: the count moved the
   moment a card was added above, and an assertion that has to be edited whenever
   the fixtures grow will eventually be edited to match whatever the code did. */
ok(
  "every card was scored by the model",
  scored.length === shareCards[0].n,
  `${scored.length} of ${shareCards[0].n}`,
);
ok("the corrected card was re-scored, not left stale", a && Number(a.confidence) > 0.4, a ? String(a.confidence) : "");
ok("stale_at_capture raised without the model", (await sql`select 1 from flags where reason = 'stale_at_capture' and status = 'open'`).length > 0);

/**
 * The two halves of the defect found on 12 Aug by probing the model rather than
 * reading the code: naming a person is a review matter, not a quality one. The
 * prompt used to conflate them, so the single most useful card in the suite scored
 * 0.35 and sorted into the queue meant for vague ones.
 */
const [namedCard] = await sql`
  select sc.confidence, sc.id from share_contributions sc
  join shares sh on sh.id = sc.share_id
  where sh.name = 'Audit Conservatory'`;
ok("the named-teacher card is flagged for a human", (await sql`select 1 from flags where reason = 'possible_named_person' and subject_id = ${namedCard.id}::uuid`).length > 0);
ok("but it is NOT treated as low quality", namedCard && Number(namedCard.confidence) >= 0.6, namedCard ? String(namedCard.confidence) : "unscored");
/* No assertion on the swim-school card's number: after the fix-a-field it reads
   "small groups and a very patient teacher", which is neither vague nor detailed.
   A check that cannot fail is not a check. */
const cgExtract = await sql`select count(*)::int as n from share_contributions pc join submissions s on s.id = pc.submission_id where s.kind = 'caregiver'`;
ok("caregiver cards never enter extraction (inv 12)", cgExtract[0].n === 0);

head("the anonymous contribution");
const [anon] = await sql`select person_id from share_contributions where tip_text like '%audit anonymous%'`;
ok("stored with no person attached", anon && anon.person_id === null);

head("2C  the claim");
const [claim] = await sql`select c.* from caregiver_claims c join people p on p.id = c.person_id
  where p.first_name like 'Audit%' order by c.created_at desc limit 1`;
ok("stored as pending, against a verified identity", claim && claim.status === "pending");
ok("the initial was upper-cased", claim && claim.last_initial === "T");
ok("an unknown option id was dropped", claim && !claim.roles_wanted.includes("not-a-real-role"));
ok("introduce was demoted without appear", claim && claim.appear_in_answers === false && claim.open_to_introductions === false);
ok("four caregiver consents recorded", (await sql`select 1 from consents c join people p on p.id = c.person_id
  where c.source = 'caregiver_flow' and p.first_name like 'Audit%'`).length === 4);
ok("the claim created no caregivers row", (await sql`select count(*)::int as n from caregivers where first_name = 'Auditcarer'`)[0].n === 1);

head("invariants the database itself enforces");
for (const [label, stmt] of [
  ["a caregiver cannot be discoverable without consent (inv 1)", sql`update caregivers set discoverable = true where first_name = 'Auditcarer'`],
  ["a caregiver cannot be stored under 18 (inv 2)", sql`insert into caregivers (market_id, first_name, is_adult) values ('pasadena', 'AuditMinor', false)`],
  ["a nomination cannot be secondhand (inv 14)", sql`update caregiver_nominations set worked_for_family = false where id = ${n.nomination_id}`],
  ["a hesitant nomination cannot drop its hold", sql`update caregiver_nominations set review_hold = false where id = ${n.nomination_id}`],
  ["a claim cannot be introducible without being listed", sql`update caregiver_claims set open_to_introductions = true where id = ${claim.id}`],
  ["a plaintext password cannot be stored as an admin credential", sql`insert into admin_users (name, password_hash) values ('auditplain', 'correct-horse-battery-staple')`],
  ["an unreviewed record cannot be marked answer-ready (§17.1)", sql`update shares set answer_ready = true where name = 'Audit Park'`],
  ["a demand signal cannot name a person without a human on it", sql`update demand_signals set requires_human_review = false where sensitivity = 'named_allegation'`],
]) {
  try { await stmt; ok(label, false, "the database ACCEPTED it"); }
  catch (e) { ok(label, true, e.constraint_name ?? String(e.message).slice(0, 36)); }
}

/* ── Part 3 · the admin ──────────────────────────────────────────────────── */

head("2.1  admin sign-in and every read resource");

/**
 * The suite creates its own admin rather than borrowing an env one, for the
 * reason the store exists: a populated `admin_users` is **authoritative**, so an
 * `ADMIN_CREDENTIALS` / `ADMIN_PASSWORD` sign-in would be correctly refused here.
 * Inserted with SQL rather than the CLI so the checks below can assert exactly
 * what reached the column.
 */
const ADMIN = { name: `auditadmin${RUN}`, password: "audit-admin-passphrase-4417" };
/** The same record `npm run admin:user` writes: fresh salt, cost inside it. */
const adminRecord = async (password) => {
  const salt = randomBytes(16);
  const cost = { N: 65536, r: 8, p: 1 };
  const hash = await scryptAsync(password, salt, 32, { ...cost, maxmem: 256 * 1024 * 1024 });
  return `scrypt:${cost.N}:${cost.r}:${cost.p}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
};
const adminHash = await adminRecord(ADMIN.password);
await sql`insert into admin_users (name, password_hash, created_by) values (${ADMIN.name}, ${adminHash}, 'test:e2e')`;

const signIn = async (name, password) => {
  const r = await fetch(B + "/api/admin/session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: name, password }),
  });
  return { status: r.status, cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
};

const loginRes = await signIn(ADMIN.name, ADMIN.password);
const adminCookie = loginRes.cookie;
ok("admin sign-in against the database store", loginRes.status === 200);
ok("the password was never stored, only its scrypt record", (await sql`select password_hash from admin_users where name = ${ADMIN.name}`)[0].password_hash.startsWith("scrypt:65536:8:1:") && !adminHash.includes(ADMIN.password));
ok("signing in stamps last_sign_in_at", (await sql`select last_sign_in_at from admin_users where name = ${ADMIN.name}`)[0].last_sign_in_at !== null);
/* The sign-in page asks for the name; it must not offer it. The form used to be a
   <select> of everyone in the store, which published who holds admin access on an
   unauthenticated page — and made the timing equalisation in verifyCredentials
   pointless, since the list was right there. */
const loginHtml = await (await fetch(B + "/admin/login")).text();
ok("the sign-in page does not name who can sign in", !loginHtml.includes(ADMIN.name));
/* No picker at all. The form is a client component, so the served HTML carries the
   props rather than the rendered input — hence the check is for the *absence* of a
   <select>, which is the thing that would be wrong, plus the username hint that
   only the text field asks for. */
ok("and asks for the name rather than offering a list", !/<select/.test(loginHtml) && /username/.test(loginHtml));
ok("a real name with a wrong password is refused like any other", (await signIn(ADMIN.name, "wrong-on-purpose-1")).status === 401);
ok("and so is a name that does not exist", (await signIn("nobody-by-that-name", ADMIN.password)).status === 401);
const call = async (path, body) => {
  const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t.slice(0, 120) };
};
const q = (resource, params = {}) => call("/api/admin/query", { resource, params });
const act = (body) => call("/api/admin/action", body);

for (const r of ["overview", "contributors", "contributions", "caregivers", "caregiver_claims", "duplicates", "options", "flags", "demand", "founding", "consents", "audit"]) {
  const res = await q(r);
  ok(r, res.status === 200 && res.json && res.json.configured === true, res.status === 200 ? "" : res.text);
}
const people = (await q("contributors")).json.rows;
ok("contributor (detail)", (await q("contributor", { id: people[0].id })).json.rows !== null);

head("2.1  the overview numbers hold together");
const o = (await q("overview")).json.rows;
ok("reward states add up to every contributor", o.reward.eligible + o.reward.started + o.reward.none === o.contributors.total, `${o.reward.eligible}+${o.reward.started}+${o.reward.none} = ${o.contributors.total}`);
ok("escalations are a subset of open flags", o.quality.escalations <= o.quality.open_flags);
ok("the sidebar counts exist", typeof o.quality.pending_contributions === "number" && typeof o.quality.pending_claims === "number");

head("2.4-2.8  the write guards");
const pendingContrib = (await q("contributions")).json.rows.find((c) => c.status === "pending_review");
ok("a contribution is queued for review", !!pendingContrib);
ok("needs_detail without a question is refused", (await act({ action: "contribution.needs_detail", id: pendingContrib.id })).status === 422);
ok("approve works", (await act({ action: "contribution.approve", id: pendingContrib.id })).status === 200);

/* §17.1 golden answers — the flag exists to say "this record could answer a
   question today", so it may only ever sit on a record a human has approved. The
   page cannot be trusted to know that: it may have been open since before a
   rejection. */
const [park] = await sql`select id from shares where name = 'Audit Park'`;
ok("marking an unreviewed record answer-ready is refused quietly", (await act({ action: "share.answer_ready", id: park.id, to: true })).status === 200);
ok("and it did not become answer-ready", (await sql`select answer_ready from shares where id = ${park.id}`)[0].answer_ready === false);
const [swimContrib] = await sql`select pc.id from share_contributions pc join shares pl on pl.id = pc.share_id where pl.name = 'Audit Swim School'`;
await act({ action: "contribution.approve", id: swimContrib.id });
ok("an approved record can be marked answer-ready", (await act({ action: "share.answer_ready", id: (await sql`select id from shares where name = 'Audit Swim School'`)[0].id, to: true })).status === 200);
ok("and the flag landed", (await sql`select answer_ready from shares where name = 'Audit Swim School'`)[0].answer_ready === true);
const held = (await q("caregivers")).json.rows.find((c) => c.review_hold);
ok("the held nomination is listed", !!held);
ok("the list says a note exists, never its text", held.has_restricted_notes === true && !JSON.stringify(held).includes("private note recorded"));
ok("the note body is its own resource", (await q("restricted_note", { nomination_id: held.id })).status === 200);
ok("visibility before consent is refused in words", (await act({ action: "caregiver.visibility", id: held.id, consent_status: "mentioned", discoverable: true })).status === 422);
ok("consent without evidence is refused", (await act({ action: "caregiver.consent", id: held.id, to: "consented", method: "" })).status === 422);
ok("a phone consent with no note is refused", (await act({ action: "caregiver.consent", id: held.id, to: "consented", method: "call_logged" })).status === 422);
ok("releasing a hold without a reason is refused", (await act({ action: "nomination.release_hold", id: held.id })).status === 422);
ok("self-referral is refused", (await act({ action: "referral.link", referrer: people[0].id, referred: people[0].id })).status === 422);

{
  /* The strategy's "up to three" (18 Aug), never enforced before — lightweight
     rows are enough here, since referral.link only needs valid person ids.
     `phone_verified_at` has to be set alongside a phone + name, or the insert
     trips invariant 11's own CHECK (verified_if_named) — a good sign the
     constraint works, and a reminder this is a real row, not a stub.
     626556, not 626555: the D1 loop above owns every single-digit suffix on
     the usual exchange, and the allowance block just above took .1 and .2 on
     this one, so this starts at .3. */
  const referrer = (
    await sql`insert into people (phone, first_name, market_id, is_test, phone_verified_at)
              values (${`+1626556${RUN}3`}, 'AuditReferrer', 'pasadena', true, now())
              returning id`
  )[0].id;
  const referred = [];
  for (const n of [4, 5, 6]) {
    referred.push(
      (
        await sql`insert into people (phone, first_name, market_id, is_test, phone_verified_at)
                  values (${`+1626556${RUN}${n}`}, ${`AuditReferred${n}`}, 'pasadena', true, now())
                  returning id`
      )[0].id,
    );
  }
  const fourth = (
    await sql`insert into people (phone, first_name, market_id, is_test, phone_verified_at)
              values (${`+1626556${RUN}7`}, 'AuditReferredFourth', 'pasadena', true, now())
              returning id`
  )[0].id;

  for (const r of referred) {
    ok(
      `referral ${referred.indexOf(r) + 1} of 3 links`,
      (await act({ action: "referral.link", referrer, referred: r })).status === 200,
    );
  }
  const capped = await act({ action: "referral.link", referrer, referred: fourth });
  ok("a fourth referral is refused, not silently ignored", capped.status === 501);
  ok(
    "with the honest reason, not the generic one",
    capped.json?.reason === "referral_cap_reached" &&
      !/isn't implemented/.test(capped.json?.error ?? ""),
    JSON.stringify(capped.json),
  );
  const linked = await sql`select count(*)::int as n from referrals where referrer_id = ${referrer}`;
  ok("exactly three landed, not four", linked[0].n === 3);
}
ok("declining a claim without a reason is refused", (await act({ action: "claim.decline", id: (await q("caregiver_claims")).json.rows[0].id })).status === 422);
ok("promoting an option needs a proper slug", (await act({ action: "option.promote", id: (await q("options")).json.rows[0].id, option_value: "Not A Slug", label: "x" })).status === 422);

head("invites — one per group, never per parent");
{
  /* The code is a soft gate and an attribution key. What matters here is the
     boundary: it records which *group* somebody came through, and it never
     asserts a membership on its own. */
  ok("a code needs to be link-shaped", (await act({ action: "invite.create", code: "Not A Code", label: "x" })).status === 422);
  ok("and the group needs a name the parent can read", (await act({ action: "invite.create", code: "audit-group", label: "  " })).status === 422);

  const made = await act({
    action: "invite.create", code: "audit-group", label: "Audit Group PTA",
    market_id: "pasadena", group_option_value: "school-pta", note: "e2e",
  });
  ok("an invite is created", made.status === 200);

  /* Live immediately: the admin write clears the resolution cache, because the
     first thing anyone does after making a link is open it. */
  const resolved = await (await fetch(B + "/api/seed/invite", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "audit-group" }),
  })).json();
  ok("the code resolves straight away", resolved.valid === true);
  ok("and carries its group", resolved.group_option_value === "school-pta" && resolved.group_label === "Audit Group PTA");

  /**
   * The point of the table being authoritative (12 Aug): while a real invite
   * exists, the built-in `SEED_INVITE_CODES` list is not consulted at all. Without
   * this, `sgv-founding` stays a way in forever — which is how a code an admin
   * never created, and cannot retire, keeps admitting people.
   *
   * **The subject has to be chosen, not hard-coded** (20 Aug). This asserted on
   * `sgv-founding`, which is both a built-in *and* the working invite the rest of
   * this walk uses — so the day somebody created it in `/admin/invites` for real,
   * it started resolving from the table, correctly, and this check failed while
   * describing behaviour that was right. It now picks a built-in the table does
   * not hold, and says so rather than failing if there is no such code left.
   */
  /* Read the whole column and filter in JS rather than passing an array down:
     `sql.array` cannot infer `text[]` here and errors at bind time — the same trap
     CLAUDE.md records for `repo/caregiver.ts`. The table has single digits of rows. */
  const builtIns = ["sgv-founding", "pasadena"];
  const held = (await sql`select code from invites`).map((r) => r.code);
  const orphan = builtIns.find((c) => !held.includes(c));
  if (!orphan) {
    ok("a populated invites table makes the env-var codes inert", true,
      "-> skipped: every built-in exists as a real invite, so there is nothing env-only to test");
  } else {
    const envCode = await (await fetch(B + "/api/seed/invite", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: orphan }),
    })).json();
    ok("a populated invites table makes the env-var codes inert", envCode.valid === false, `${orphan} -> ${envCode.reason ?? "valid"}`);
  }

  /* A parent arriving on it is attributed to the invite — from the code the
     server validated, never from the body. */
  const s = session();
  const p2 = `+1626555${RUN}8`;
  const st = await s.post("/api/seed/verify/start", { phone: p2, sms_consent: true });
  await s.post("/api/seed/verify/check", { code: st.json.dev_code });
  await s.post("/api/seed/profile", {
    invite_code: "audit-group", phone: p2, wants_founding: true, first_name: "Auditinvite",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 5, children: [{ birth_year: 2020 }], child_ages_at_capture: [5],
    answers: { neighborhood: "altadena", child_ages: [5], allowance: "5", other: {} },
  });
  const [attributed] = await sql`select p.invite_id, i.code from people p join invites i on i.id = p.invite_id where p.first_name = 'Auditinvite'`;
  ok("the contributor is attributed to the invite", attributed && attributed.code === "audit-group");
  /* The group comes off the invite server-side, not from a question the parent
     answers — that question was removed on 12 Aug. */
  ok("and the group is recorded from the code, not asked for", (await sql`select invited_via_group from people where first_name = 'Auditinvite'`)[0].invited_via_group === "school-pta");

  /* The link is not evidence of membership: this parent never confirmed the
     group, so there must be no edge to it. */
  ok("but the link alone writes no affinity", (await sql`select 1 from social_affinities a join people p on p.id = a.person_id where p.first_name = 'Auditinvite' and a.affinity_value = 'school-pta'`).length === 0);

  const listed = (await q("invites")).json.rows.find((i) => i.code === "audit-group");
  ok("the admin list counts who arrived", listed && listed.contributors >= 1);
  ok("and how many of them delivered anything", listed && listed.delivered === 0, listed ? `${listed.delivered}/${listed.contributors}` : "");

  /* Retiring stops it being handed out; it must not strand a parent who already
     has the link in a group chat. */
  ok("retiring works", (await act({ action: "invite.retire", id: listed.id })).status === 200);
  const afterRetire = await (await fetch(B + "/api/seed/invite", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "audit-group" }),
  })).json();
  ok("a retired code is no longer a valid invite", afterRetire.valid === false);
  ok("but the market still falls back, so nobody is stranded", afterRetire.market_id === "pasadena");
  /* And the built-in codes stay inert — the store is the answer even when the
     answer is "no invites yet". A code nobody created is a code nobody can retire.
     Same choose-don't-hard-code rule as above: `sgv-founding` is a real row in this
     database, so asserting on it tests the opposite of what this line claims. */
  if (!orphan) {
    ok("a built-in code is not a way in while a store exists", true,
      "-> skipped: no built-in is env-only in this database");
  } else {
    const builtIn = await (await fetch(B + "/api/seed/invite", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: orphan }),
    })).json();
    ok("a built-in code is not a way in while a store exists", builtIn.valid === false, `${orphan} -> ${builtIn.reason ?? "valid"}`);
    /* Inert as an *invite* is not the same as a dead end: the parent still lands in
       a market, they just carry no attribution. That distinction is the whole
       reason an unknown code is soft-refused rather than rejected. */
    ok("and a parent who has one still reaches the market", builtIn.market_id === "pasadena");
  }
}

head("2.6  promotion: the chip, the queue and the graph");
{
  /* The parent typed "Audit Test Club" as an "other" club. While it sits here it
     is deliberately unmatchable (invariant 9) — so the row that every other club
     answer got does not exist for them. Promotion is what repairs that. */
  const pending = (await q("options")).json.rows.find((o) => o.submitted_value === "Audit Test Club");
  ok("the parent's 'other' answer is queued", !!pending);
  const before = await sql`select 1 from social_affinities where person_id = ${p.id} and affinity_value = 'audit-test-club'`;
  ok("and it has no affinity while it waits (inv 9)", before.length === 0);

  ok("promotion goes through", (await act({ action: "option.promote", id: pending.id, option_value: "audit-test-club", label: "Audit Test Club" })).status === 200);

  const [opt] = await sql`select category, label, active from market_options where market_id = 'pasadena' and option_value = 'audit-test-club'`;
  ok("the option exists and is active", !!opt && opt.active === true && opt.category === "clubs");
  ok("the pending row is approved", (await sql`select status from pending_options where id = ${pending.id}::uuid`)[0].status === "approved");

  /* C — the backfill. The value stored is the admin's slug, never the free text:
     matching keys on the slug. */
  const [edge] = await sql`select affinity_type, weight_at_capture from social_affinities where person_id = ${p.id} and affinity_value = 'audit-test-club'`;
  ok("the parent who typed it now has the edge", !!edge, edge ? `${edge.affinity_type} w${edge.weight_at_capture}` : "none");
  ok("at the weight the question set gives clubs", edge && edge.affinity_type === "social_group" && Number(edge.weight_at_capture) === 3);
  ok("and never under their raw text", (await sql`select 1 from social_affinities where affinity_value = 'Audit Test Club'`).length === 0);

  /* B — the questionnaire reads the table at request time, and an admin write
     clears the read cache, so the chip is there on the next request rather than
     after the TTL. Before this existed the chips were compiled into the bundle and
     this endpoint did not exist at all. */
  const live = await (await fetch(B + "/api/market/options?market_id=pasadena")).json();
  ok("the options endpoint serves the database", live.configured === true);
  /**
   * **What promotion means changed on 24 Aug**, and this is where it shows.
   *
   * Clubs, schools, activities and faith are now directories of hundreds of
   * records, so `/options` serves only the 8-12 curated starters per category and
   * everything else is reached by search. A promoted "other" answer is therefore
   * *findable*, not *featured*: putting it in the starter set would grow that set
   * unboundedly, one typed answer at a time, which is the opposite of the
   * client's "about 8-12 familiar choices".
   */
  ok(
    "a promotion does not force its way into the curated starter set",
    !(live.options.clubs ?? []).some((o) => o.id === "audit-test-club"),
    `${(live.options.clubs ?? []).length} starter club(s)`,
  );
  const found = await (
    await fetch(B + "/api/market/search?category=clubs&q=Audit%20Test%20Club")
  ).json();
  ok(
    "but it is immediately findable by search",
    (found.results ?? []).some((o) => o.id === "audit-test-club"),
    `${(found.results ?? []).length} result(s)`,
  );
  /* `active` is what stops an option being offered, and it has to hold on both
     paths — a search that reached a retired option would be a second door into
     something an admin closed. */
  ok("bands survive the round trip", (live.options.schools ?? []).some((o) => Array.isArray(o.bands) && o.bands.length > 0));
  ok("categories the questionnaire can't render are excluded", live.options.focus === undefined);

  /* ── "Tap first, search second" (24 Aug) ─────────────────────────────────
     Three of the client's rules for the four searchable directories, each of
     which the query has to implement rather than the screen. */
  const search = async (params) =>
    (await (await fetch(`${B}/api/market/search?${new URLSearchParams(params)}`)).json())
      .results ?? [];

  /* Only starters are served as chips — the whole reason search exists. */
  const starters = (live.options.schools ?? []).length;
  ok(
    "the options endpoint serves starters, not the whole directory",
    starters > 0 && starters < 200,
    `${starters} starter school(s)`,
  );

  /* An alias is a way *in*, never a label: "LCHS" has to reach the school and
     the parent has to see its real name. */
  const byAlias = await search({ category: "schools", q: "LCHS" });
  ok(
    "an alias finds the canonical record",
    byAlias.some((o) => /La Ca.ada High School/.test(o.label)),
    byAlias.map((o) => o.label).join(", ") || "none",
  );
  ok(
    "and the alias itself is never shown as the label",
    !byAlias.some((o) => o.label.toUpperCase() === "LCHS"),
  );

  /* Trigram, not just LIKE. A parent typing from memory misspells things. */
  ok(
    "a misspelling still finds it",
    (await search({ category: "schools", q: "polytecnic" })).some((o) =>
      /Polytechnic/.test(o.label),
    ),
  );

  /* Her closing note on all four sheets: the home area ranks and must never
     filter, because SGV families cross city lines for school. */
  const crossCity = await search({
    category: "schools",
    q: "La Cañada High",
    area: "alhambra",
  });
  ok(
    "the home area ranks but never filters",
    crossCity.some((o) => /La Ca.ada High School/.test(o.label)),
    `searched as an Alhambra parent, found ${crossCity.length}`,
  );

  /**
   * And the other half of that sentence, which had never been asserted — which
   * is exactly why it was broken for nine of the seventeen areas.
   *
   * `market_options.area` is the client's display name ("La Cañada
   * Flintridge") and the parameter is the neighborhood option id
   * ("la-canada-flintridge"). The comparison was `lower(area) = $area`, which
   * bridges a single-word name and nothing else — so Altadena and Arcadia
   * ranked, while La Cañada Flintridge, Highland Park, South Pasadena, Sierra
   * Madre, Monterey Park, San Marino, San Gabriel, Eagle Rock and Temple City
   * silently did not. The test above passed throughout, because it only ever
   * checked that the *other* areas were still present.
   *
   * A multi-word area on purpose: a single-word one passes either way.
   */
  const ownArea = await search({
    category: "schools",
    q: "elementary",
    area: "la-canada-flintridge",
  });
  const firstThree = ownArea.slice(0, 3);
  ok(
    "a multi-word home area actually ranks its own schools first",
    firstThree.length === 3 &&
      firstThree.every((o) => o.area_slug === "la-canada-flintridge"),
    `top three were ${firstThree.map((o) => `${o.label} [${o.area_slug}]`).join(", ")}`,
  );
  ok(
    "and the slug comes back, since that is what the chip list filters on",
    ownArea.every((o) => !o.area || typeof o.area_slug === "string"),
  );

  /* Resolve-by-id, which is what stops a searched selection losing its chip on
     reload — and it must obey `active` exactly as the search does. */
  const resolved = await search({
    category: "schools",
    ids: "polytechnic-school,not-a-real-school",
  });
  ok(
    "ids resolve to their records",
    resolved.length === 1 && /Polytechnic/.test(resolved[0].label),
    `${resolved.length} resolved`,
  );
  ok(
    "and an unknown id resolves to nothing rather than erroring",
    !resolved.some((o) => o.id === "not-a-real-school"),
  );
  /* One character is not a search — it would match most of the directory. */
  ok(
    "a one-character query returns nothing rather than everything",
    (await search({ category: "schools", q: "a" })).length === 0,
  );

  /**
   * The subject is an option this run created and now retires, rather than a
   * fixture from the taxonomy.
   *
   * It was `bungalow-heaven`, which stopped being retired the moment item 5's
   * autopopulate brought Pasadena's own neighbourhoods back as searchable
   * non-starters — so the check began failing while testing nothing. A test that
   * depends on reference data staying retired is a test that breaks when the data
   * becomes right.
   */
  await sql`update market_options set active = false
             where market_id = 'pasadena' and category = 'clubs'
               and option_value = 'audit-test-club'`;
  const afterRetire = await search({ category: "clubs", q: "Audit Test Club" });
  ok(
    "a retired option is not offered by search either",
    !afterRetire.some((o) => o.id === "audit-test-club"),
    `${afterRetire.length} result(s)`,
  );
  /* Both doors, and this one is the easier to forget: resolve-by-id exists so a
     selection keeps its chip on reload, which makes it a second path into the
     table — it has to honour `active` exactly as the search does. */
  ok(
    "a retired option cannot be reached by id either",
    (await search({ category: "clubs", ids: "audit-test-club" })).length === 0,
  );
}
ok("an unknown action is rejected", (await act({ action: "not.a.real.action", id: "x" })).status === 400);

head("2.2 / 2.3  queues");
const founding = (await q("founding")).json.rows;
ok("the founding queue shows the checklist", founding.length > 0 && typeof founding[0].checklist.qualifying_approved === "number");
ok("phones are masked before they leave the server", founding.every((f) => !f.phone_masked || f.phone_masked.startsWith("•")));
ok("every contributor carries a reward state", people.every((r) => ["none", "started", "eligible"].includes(r.reward_status)));
/* A2P §3.3 — the consent file is the defence against a TCPA complaint, and a
   complaint arrives as a phone number. So this one resource answers with the
   number unmasked and with the wording version that number agreed to. */
const consentRows = (await q("consents")).json.rows;
ok("every consent record carries its wording version", consentRows.length > 0 && consentRows.every((c) => c.text_version));
ok("the number is readable here, and only here", consentRows.some((c) => c.phone && c.phone.startsWith("+")));
ok("an sms consent exists for the parent who was texted", consentRows.some((c) => c.scope === "sms"));

const claims = (await q("caregiver_claims")).json.rows;
ok("the claim is queued for matching", claims.length > 0 && claims[0].status === "pending");
ok("the claims page carries nothing a family wrote", !JSON.stringify(claims).includes("private note recorded") && !JSON.stringify(claims).includes("private reason"));

head("2C  “text DELETE and the whole profile goes”");
{
  /* The last line of the caregiver flow promises this, so it has to be a real
     delete and not a status change. Run last, because everything above needs the
     claim to still exist. */
  const claimId = claims[0].id;
  ok("deleting without recording how they asked is refused", (await act({ action: "claim.delete", id: claimId })).status === 422);
  ok("the delete goes through", (await act({ action: "claim.delete", id: claimId, requested_via: "texted DELETE (audit)" })).status === 200);
  ok("the claim is gone, not marked", (await sql`select count(*)::int as n from caregiver_claims where id = ${claimId}::uuid`)[0].n === 0);
  ok("their consent records went with it", (await sql`select count(*)::int as n from consents c
  join people p on p.id = c.person_id
  where c.source = 'caregiver_flow' and p.first_name like 'Audit%'`)[0].n === 0);
  ok("and so did the identity they made for it", (await sql`select count(*)::int as n from people where phone = ${CG_PHONE}`)[0].n === 0);
  /* What survives, and must: the family's own card. It is that parent's
     contribution, and it holds no way to contact anybody. */
  ok("the family's nomination survives", (await sql`select count(*)::int as n from caregivers where first_name = 'Auditcarer'`)[0].n === 1);
  ok("the deletion left a trace of itself", (await q("audit")).json.rows.some((r) => r.action === "claim.delete"));
}

head("2.8  audit trail");
const auditRows = (await q("audit")).json.rows;
ok("every action wrote a row naming who did it", auditRows.length > 0 && auditRows.every((r) => r.user));
ok("the approve just made is in there", auditRows.some((r) => r.action === "contribution.approve"));
ok("and it names the person who proved who they were", auditRows.some((r) => r.user === ADMIN.name));

head("2.1  taking access away");
/* The reason the credentials moved into the database: revoking is a statement,
   not a deploy — and it has to end sessions that are already open, not wait for
   a token to expire. */
ok("a password nobody set is refused", (await signIn(ADMIN.name, "not-the-passphrase")).status === 401);
await sql`update admin_users set active = false where name = ${ADMIN.name}`;
ok("a revoked admin cannot sign in", (await signIn(ADMIN.name, ADMIN.password)).status === 401);
ok("and the session they already had stops working", (await call("/api/admin/query", { resource: "overview", params: {} })).status === 401);
ok("the admin pages redirect them out", (await fetch(B + "/admin", { headers: { cookie: adminCookie }, redirect: "manual" })).status === 307);
await sql`update admin_users set active = true where name = ${ADMIN.name}`;
const back = await signIn(ADMIN.name, ADMIN.password);
ok("putting them back works, and clears the attempt counter", back.status === 200);
/* Rotation. A real new record — a fresh salt and hash, exactly what the CLI's
   `password` command writes. (Flipping a character of the old hash is not the
   same test: base64url's last character carries padding bits, so half the time
   it decodes to the very same 32 bytes and the old password still verifies.) */
await sql`update admin_users set password_hash = ${await adminRecord("audit-admin-rotated-9008")}, password_changed_at = now() where name = ${ADMIN.name}`;
ok("the old password stops working the moment the record changes", (await signIn(ADMIN.name, ADMIN.password)).status === 401);
ok("and the new one works", (await signIn(ADMIN.name, "audit-admin-rotated-9008")).status === 200);
ok("and the session issued against the old one is over", (await fetch(B + "/api/admin/query", { method: "POST", headers: { "content-type": "application/json", cookie: back.cookie }, body: JSON.stringify({ resource: "overview", params: {} }) })).status === 401);

head("2.1  changing your own password from inside the admin");
{
  /* The one write the app is allowed to make to its own credential store. It can
     only ever touch the person already signed in — creating and revoking stay in
     the CLI. */
  const CURRENT = "audit-admin-rotated-9008";
  const NEXT = "audit-admin-self-changed-2201";
  const fresh = await signIn(ADMIN.name, CURRENT);
  const change = async (cookie, payload) => {
    const r = await fetch(B + "/api/admin/password", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(payload),
    });
    return { status: r.status, cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  };

  ok("a signed-out browser cannot change a password", (await change(null, { current: CURRENT, next: NEXT })).status === 401);
  /* A session alone is not enough: a live tab on a borrowed laptop must not be
     able to lock the owner out of their own account. */
  ok("the current password is required, not just the session", (await change(fresh.cookie, { current: "not-it", next: NEXT })).status === 401);
  ok("a short new password is refused", (await change(fresh.cookie, { current: CURRENT, next: "short" })).status === 422);
  ok("and so is the one they already have", (await change(fresh.cookie, { current: CURRENT, next: CURRENT })).status === 422);

  const changed = await change(fresh.cookie, { current: CURRENT, next: NEXT });
  ok("a correct change goes through", changed.status === 200);
  /* Rotating the hash changes the session key, so the response has to hand back a
     new cookie — otherwise a successful change looks like being logged out. */
  ok("and hands back a session that still works", (await fetch(B + "/api/admin/query", { method: "POST", headers: { "content-type": "application/json", cookie: changed.cookie }, body: JSON.stringify({ resource: "overview", params: {} }) })).status === 200);
  ok("the old password stops working", (await signIn(ADMIN.name, CURRENT)).status === 401);
  ok("the new one works", (await signIn(ADMIN.name, NEXT)).status === 200);
  ok("the column still holds a scrypt record, never the password", (await sql`select password_hash from admin_users where name = ${ADMIN.name}`)[0].password_hash.startsWith("scrypt:") === true);
  ok("and the password itself is nowhere in the audit log", (await sql`select 1 from audit_log where at > now() - interval '10 minutes' and (after::text like ${"%" + NEXT + "%"} or resource_id like ${"%" + NEXT + "%"})`).length === 0);
  ok("but the change itself is", (await sql`select 1 from audit_log where action = 'admin.password' and actor = ${ADMIN.name}`).length > 0);
}

head("2.1  the CLI that is the only way in or out of that table");
{
  /**
   * The checks above insert with SQL so they can assert exactly what reached the
   * column. This one runs the thing an operator actually types — `npm run
   * admin:user` — because it is the only interface for granting or revoking
   * access, and a script nothing exercises is a script that breaks quietly.
   *
   * The password is generated here, piped in on stdin and never printed: the
   * discipline the CLI itself keeps, kept by its test too.
   */
  const NAME = `auditcli${RUN}`;
  const password = randomBytes(24).toString("base64url");

  const cli = (args, stdin) =>
    new Promise((resolve) => {
      const child = spawn("node", ["scripts/admin-user.mjs", ...args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
      child.on("close", (code) => resolve({ code, out }));
    });

  const added = await cli(["add", NAME, "--stdin", "--by", "test:e2e"], password);
  ok("the CLI creates a person", added.code === 0, added.code === 0 ? "" : added.out.slice(0, 100));

  const [record] = await sql`select password_hash, active from admin_users where name = ${NAME}`;
  ok("writing a scrypt record, never the password", !!record && /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/.test(record.password_hash) && !record.password_hash.includes(password));
  ok("they sign in with it", (await signIn(NAME, password)).status === 200);

  ok("disable revokes them", (await cli(["disable", NAME, "--by", "test:e2e"])).code === 0);
  ok("and the password stops working straight away", (await signIn(NAME, password)).status === 401);
  ok("every access change wrote an audit row", (await sql`select 1 from audit_log where resource = 'admin_user' and at > now() - interval '10 minutes'`).length >= 2);

  await sql`delete from admin_users where name = ${NAME}`;
  await sql`delete from audit_log where resource = 'admin_user' and at > now() - interval '10 minutes'`;
}

/* ── Cleanup ─────────────────────────────────────────────────────────────── */

const ids = (await sql`select id from people where first_name like 'Audit%'`).map((r) => r.id);
await sql`delete from flags where subject_id in (select id from share_contributions where person_id = any(${ids}::uuid[])) or subject_id in (select id from demand_signals where person_id = any(${ids}::uuid[])) or subject_id in (select id from shares where name like 'Audit%')`;
await sql`delete from restricted_notes where nomination_id in (select cn.id from caregiver_nominations cn join caregivers c on c.id = cn.caregiver_id where c.first_name like 'Audit%')`;
await sql`delete from caregiver_nominations where caregiver_id in (select id from caregivers where first_name like 'Audit%')`;
await sql`delete from caregiver_profiles where caregiver_id in (select id from caregivers where first_name like 'Audit%')`;
await sql`delete from caregiver_claims where person_id = any(${ids}::uuid[])`;
await sql`delete from caregivers where first_name like 'Audit%'`;
await sql`delete from share_contributions where person_id = any(${ids}::uuid[]) or share_id in (select id from shares where name like 'Audit%') or tip_text like '%audit anonymous%'`;
await sql`delete from shares where name like 'Audit%'`;
await sql`delete from submissions where person_id = any(${ids}::uuid[]) or client_id like 'audit-%' or client_id like 'cg-bad-%'`;
await sql`delete from demand_signals where person_id = any(${ids}::uuid[])`;
await sql`delete from pending_options where submitted_by = any(${ids}::uuid[])`;
await sql`delete from market_options where option_value = 'audit-test-club'`;
await sql`delete from invites where code = 'audit-group'`;
await sql`delete from affiliation_visibility where person_id = any(${ids}::uuid[])`;
await sql`delete from consents where person_id = any(${ids}::uuid[])`;
await sql`delete from person_schools where person_id = any(${ids}::uuid[])`;
await sql`delete from social_affinities where person_id = any(${ids}::uuid[])`;
await sql`delete from life_relevance where person_id = any(${ids}::uuid[])`;
await sql`delete from children where person_id = any(${ids}::uuid[])`;
await sql`delete from people where id = any(${ids}::uuid[])`;
await sql`delete from referrals`;
await sql`delete from admin_users where created_by = 'test:e2e' or name like 'auditadmin%'`;
/**
 * Flags whose subject this run deleted — a queue entry pointing at nothing is
 * worse than no entry.
 *
 * **The kind names here were stale, and it showed on a real screen** (19 Aug):
 * this matched `place_contribution` and `place`, the names from before the
 * 12 Aug rename, so nothing had been cleaned since. Every run left its
 * low-confidence flags behind, and the review queue had filled with items about
 * cards that no longer existed. Both spellings are matched now — the current one
 * because it is what gets written, the old one because a long-lived database may
 * still hold pre-rename rows.
 */
const orphans = await sql`
  delete from flags f
  where (f.subject_kind in ('share_contribution', 'place_contribution')
           and not exists (select 1 from share_contributions pc where pc.id = f.subject_id))
     or (f.subject_kind in ('share', 'place')
           and not exists (select 1 from shares pl where pl.id = f.subject_id))
     or (f.subject_kind = 'demand_signal'
           and not exists (select 1 from demand_signals d where d.id = f.subject_id))
  returning f.id`;
await sql`delete from audit_log where action in ('contribution.approve','referral.link','share.answer_ready','claim.delete','invite.create','invite.retire') and at > now() - interval '1 hour'`;

console.log(`\n  cleaned up: ${ids.length} test parent(s), ${orphans.length} orphaned flag(s)`);
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) console.log("  failed:\n" + failures.map((f) => "    - " + f).join("\n"));
await sql.end();
process.exitCode = fail === 0 ? 0 : 1;
