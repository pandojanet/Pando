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

/* The order below — verify, then profile, then cards — is now the order a parent
   meets on screen too (12 Aug): the code is asked for at the entry screen, and
   everything after it is stored as it happens. The suite drove it this way from
   the start because it is the *server's* order; what changed is that the UI stopped
   holding everything until the last screen. So these checks now prove the normal
   path rather than an API shortcut. */
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
    monthly_contact_allowance: 3,
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
      schools: ["walden-school"],
      classes: [], camps: ["tom-sawyer-camps"], faith: [], clubs: [], parent_groups: [],
      invite_group: "altadena-moms",
      time_in_area: "3_10_years",
      family_structure: [], childcare_now: ["nanny_or_sitter"],
      logistics: ["close_to_home"], budget: ["compare_value"], trust_circles: [],
      topics: ["camps"], topics_lived: [],
      attribution: "first_name_safe",
      allowance: "3",
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
  const first = await card(full, "audit-activity-1");
  ok("activity saved", first.status === 200 && first.json.persisted === true);

  const fixed = await card({ ...full, what_makes_it_great: "small groups and a very patient teacher", caveat: "Saturdays get packed" }, "audit-activity-1");
  ok("fix-a-field re-saves the same card, not a second one", fixed.json.record_id === first.json.record_id);

  const place = await card({ __kind: "place", name: "Audit Park", place_type: "park", firsthand: "firsthand", child_age_at_time: [3], freshness: "over_year", what_makes_it_great: "shaded and fenced", caveat: "no toilets" }, "audit-place-1");
  ok("a second card (stale place) saved", place.status === 200);
}

head("1.6  caregiver nomination — the refusals first");
{
  const nom = (fields, id) => parent.post("/api/seed/save", { invite_code: "sgv-founding", contributor_phone: PHONE, submission: { id, kind: "caregiver", fields } });
  ok("secondhand nomination refused (inv 14)", (await nom({ name: ["Nope", "N"], age_gate: "yes", worked_for_you: "no" }, "cg-bad-1")).status === 422);
  ok("under-18 nomination refused (inv 2)", (await nom({ name: ["Nope", "N"], age_gate: "no", worked_for_you: "yes" }, "cg-bad-2")).status === 422);
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
  }, "audit-cg-1");
  ok("a held nomination saved", held.status === 200 && held.json.persisted === true);
}

head("1.7  completion and D1 routing");
{
  const res = await parent.post("/api/seed/complete", {
    invite_code: "sgv-founding", phone: PHONE, name: "Audit Parent",
    follow_up_opt_in: true, monthly_contact_allowance: 3,
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
    await s.post("/api/seed/profile", { invite_code: "sgv-founding", phone: p, wants_founding: true, first_name: "AuditD1", sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" }, monthly_contact_allowance: 3, children: [{ birth_year: 2021 }], child_ages_at_capture: [4], answers: { neighborhood: "altadena", child_ages: [4], allowance: "3", other: {} } });
    const r = await s.post("/api/seed/complete", { invite_code: "sgv-founding", phone: p, follow_up_opt_in: true, monthly_contact_allowance: 3, demand });
    const kept = label.includes("not kept") ? r.json.demand_signal_id == null : r.status === 200 && r.json.persisted === true;
    ok("D1: " + label, kept);
    i++;
  }
}

head("the anonymous path");
{
  const anon = session();
  const res = await anon.post("/api/seed/save", { invite_code: "sgv-founding", submission: { id: "audit-anon-1", kind: "tip", fields: { tip: "An audit anonymous tip", topic: "schedules" } } });
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
await new Promise((r) => setTimeout(r, 9000)); // extraction runs after the response

const [p] = await sql`select * from people where first_name = 'Audit' order by created_at desc limit 1`;

head("1.3  the derived graph — and the lies that did not survive");
ok("the person exists", !!p);
ok("phone_verified_at is a server fact", p && p.phone_verified_at !== null);
ok("founding is pending, never self-granted", p && p.founding === "pending_founding");
const aff = await sql`select affinity_type, affinity_value, weight_at_capture from social_affinities where person_id = ${p.id} order by affinity_type`;
ok("the fabricated school affinity was ignored", !aff.some((a) => a.affinity_value === "a-school-never-picked"));
ok("the fabricated neighborhood was ignored", !aff.some((a) => a.affinity_value === "somewhere-else"));
ok("the real neighborhood was derived", aff.some((a) => a.affinity_value === "altadena"));
ok("the real school was derived", aff.some((a) => a.affinity_value === "walden-school"));
const camp = aff.find((a) => a.affinity_value === "tom-sawyer-camps");
ok("a camp is an activity edge, at the class weight (v3.2 §8.4)", !!camp && camp.affinity_type === "activity" && Number(camp.weight_at_capture) === 4);
ok("age bands were derived from the tapped ages", aff.some((a) => a.affinity_type === "age_range"));
ok("weights come from the question set, not the body", aff.every((a) => Number(a.weight_at_capture) < 99));
const rel = await sql`select dimension, value from life_relevance where person_id = ${p.id}`;
ok("the fabricated relevance row was ignored", !rel.some((r) => r.value === "fabricated"));
ok("relevance was derived, including rows the client never sent", rel.some((r) => r.dimension === "tenure"), JSON.stringify(rel.map((r) => r.dimension)));
const pend = await sql`select market_id, submitted_value, status from pending_options where submitted_by = ${p.id}`;
ok("the injected pending option was ignored", !pend.some((o) => o.submitted_value === "Injected"));
ok("the real 'other' answer is parked as pending (inv 9)", pend.some((o) => o.submitted_value === "Audit Test Club" && o.status === "pending"));
ok("its market came from the invite", pend.every((o) => o.market_id === "pasadena"));
const kids = await sql`select birth_year from children where person_id = ${p.id}`;
ok("children stored as birth years", kids.length === 2);
const sch = await sql`select status from person_schools where person_id = ${p.id}`;
ok("school carries its own status (P5)", sch.length === 1 && sch[0].status === "current");

head("1.5  the activity card");
const [a] = await sql`select pc.* from place_contributions pc join places pl on pl.id = pc.place_id where pl.name = 'Audit Swim School'`;
ok("firsthand recorded", a && a.firsthand === true);
ok("caveat_answered true", a && a.caveat_answered === true);
ok("price band kept with its unit", a && a.price_band === "50_100" && a.price_unit === "per_month");
ok("the correction replaced the text", a && /patient teacher/.test(a.what_makes_it_great ?? ""));
const nCards = await sql`select count(*)::int as n from place_contributions where person_id = ${p.id}`;
ok("one contribution per card, not per save", nCards[0].n === 2);

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
const dem = await sql`select question_text, sensitivity, requires_human_review, neighborhood from demand_signals`;
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
const scored = await sql`select confidence from place_contributions where person_id = ${p.id} and confidence is not null`;
ok("cards were scored by the model", scored.length === 2, `${scored.length} of 2`);
ok("the corrected card was re-scored, not left stale", a && Number(a.confidence) > 0.4, a ? String(a.confidence) : "");
ok("stale_at_capture raised without the model", (await sql`select 1 from flags where reason = 'stale_at_capture' and status = 'open'`).length > 0);
const cgExtract = await sql`select count(*)::int as n from place_contributions pc join submissions s on s.id = pc.submission_id where s.kind = 'caregiver'`;
ok("caregiver cards never enter extraction (inv 12)", cgExtract[0].n === 0);

head("the anonymous contribution");
const [anon] = await sql`select person_id from place_contributions where tip_text like '%audit anonymous%'`;
ok("stored with no person attached", anon && anon.person_id === null);

head("2C  the claim");
const [claim] = await sql`select * from caregiver_claims order by created_at desc limit 1`;
ok("stored as pending, against a verified identity", claim && claim.status === "pending");
ok("the initial was upper-cased", claim && claim.last_initial === "T");
ok("an unknown option id was dropped", claim && !claim.roles_wanted.includes("not-a-real-role"));
ok("introduce was demoted without appear", claim && claim.appear_in_answers === false && claim.open_to_introductions === false);
ok("four caregiver consents recorded", (await sql`select 1 from consents where source = 'caregiver_flow'`).length === 4);
ok("the claim created no caregivers row", (await sql`select count(*)::int as n from caregivers where first_name = 'Auditcarer'`)[0].n === 1);

head("invariants the database itself enforces");
for (const [label, stmt] of [
  ["a caregiver cannot be discoverable without consent (inv 1)", sql`update caregivers set discoverable = true where first_name = 'Auditcarer'`],
  ["a caregiver cannot be stored under 18 (inv 2)", sql`insert into caregivers (market_id, first_name, is_adult) values ('pasadena', 'AuditMinor', false)`],
  ["a nomination cannot be secondhand (inv 14)", sql`update caregiver_nominations set worked_for_family = false where id = ${n.nomination_id}`],
  ["a hesitant nomination cannot drop its hold", sql`update caregiver_nominations set review_hold = false where id = ${n.nomination_id}`],
  ["a claim cannot be introducible without being listed", sql`update caregiver_claims set open_to_introductions = true where id = ${claim.id}`],
  ["a plaintext password cannot be stored as an admin credential", sql`insert into admin_users (name, password_hash) values ('auditplain', 'correct-horse-battery-staple')`],
  ["an unreviewed record cannot be marked answer-ready (§17.1)", sql`update places set answer_ready = true where name = 'Audit Park'`],
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
const [park] = await sql`select id from places where name = 'Audit Park'`;
ok("marking an unreviewed record answer-ready is refused quietly", (await act({ action: "place.answer_ready", id: park.id, to: true })).status === 200);
ok("and it did not become answer-ready", (await sql`select answer_ready from places where id = ${park.id}`)[0].answer_ready === false);
const [swimContrib] = await sql`select pc.id from place_contributions pc join places pl on pl.id = pc.place_id where pl.name = 'Audit Swim School'`;
await act({ action: "contribution.approve", id: swimContrib.id });
ok("an approved record can be marked answer-ready", (await act({ action: "place.answer_ready", id: (await sql`select id from places where name = 'Audit Swim School'`)[0].id, to: true })).status === 200);
ok("and the flag landed", (await sql`select answer_ready from places where name = 'Audit Swim School'`)[0].answer_ready === true);
const held = (await q("caregivers")).json.rows.find((c) => c.review_hold);
ok("the held nomination is listed", !!held);
ok("the list says a note exists, never its text", held.has_restricted_notes === true && !JSON.stringify(held).includes("private note recorded"));
ok("the note body is its own resource", (await q("restricted_note", { nomination_id: held.id })).status === 200);
ok("visibility before consent is refused in words", (await act({ action: "caregiver.visibility", id: held.id, consent_status: "mentioned", discoverable: true })).status === 422);
ok("consent without evidence is refused", (await act({ action: "caregiver.consent", id: held.id, to: "consented", method: "" })).status === 422);
ok("a phone consent with no note is refused", (await act({ action: "caregiver.consent", id: held.id, to: "consented", method: "call_logged" })).status === 422);
ok("releasing a hold without a reason is refused", (await act({ action: "nomination.release_hold", id: held.id })).status === 422);
ok("self-referral is refused", (await act({ action: "referral.link", referrer: people[0].id, referred: people[0].id })).status === 422);
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
  ok("and carries its group, for P6 to confirm", resolved.group_option_value === "school-pta" && resolved.group_label === "Audit Group PTA");

  /* A parent arriving on it is attributed to the invite — from the code the
     server validated, never from the body. */
  const s = session();
  const p2 = `+1626555${RUN}8`;
  const st = await s.post("/api/seed/verify/start", { phone: p2, sms_consent: true });
  await s.post("/api/seed/verify/check", { code: st.json.dev_code });
  await s.post("/api/seed/profile", {
    invite_code: "audit-group", phone: p2, wants_founding: true, first_name: "Auditinvite",
    sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
    monthly_contact_allowance: 3, children: [{ birth_year: 2020 }], child_ages_at_capture: [5],
    answers: { neighborhood: "altadena", child_ages: [5], allowance: "3", other: {} },
  });
  const [attributed] = await sql`select p.invite_id, i.code from people p join invites i on i.id = p.invite_id where p.first_name = 'Auditinvite'`;
  ok("the contributor is attributed to the invite", attributed && attributed.code === "audit-group");

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
  ok("and the env-var codes still work", (await (await fetch(B + "/api/seed/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "sgv-founding" }) })).json()).valid === true);
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
  ok("the promoted option is served immediately", (live.options.clubs ?? []).some((o) => o.id === "audit-test-club"));
  ok("bands survive the round trip", (live.options.schools ?? []).some((o) => Array.isArray(o.bands) && o.bands.length > 0));
  ok("categories the questionnaire can't render are excluded", live.options.focus === undefined);
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
  ok("their consent records went with it", (await sql`select count(*)::int as n from consents where source = 'caregiver_flow'`)[0].n === 0);
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
await sql`delete from flags where subject_id in (select id from place_contributions where person_id = any(${ids}::uuid[])) or subject_id in (select id from demand_signals where person_id = any(${ids}::uuid[])) or subject_id in (select id from places where name like 'Audit%')`;
await sql`delete from restricted_notes where nomination_id in (select cn.id from caregiver_nominations cn join caregivers c on c.id = cn.caregiver_id where c.first_name like 'Audit%')`;
await sql`delete from caregiver_nominations where caregiver_id in (select id from caregivers where first_name like 'Audit%')`;
await sql`delete from caregiver_profiles where caregiver_id in (select id from caregivers where first_name like 'Audit%')`;
await sql`delete from caregiver_claims where person_id = any(${ids}::uuid[])`;
await sql`delete from caregivers where first_name like 'Audit%'`;
await sql`delete from place_contributions where person_id = any(${ids}::uuid[]) or place_id in (select id from places where name like 'Audit%') or tip_text like '%audit anonymous%'`;
await sql`delete from places where name like 'Audit%'`;
await sql`delete from submissions where person_id = any(${ids}::uuid[]) or client_id like 'audit-%' or client_id like 'cg-bad-%'`;
await sql`delete from demand_signals where person_id = any(${ids}::uuid[])`;
await sql`delete from pending_options where submitted_by = any(${ids}::uuid[])`;
await sql`delete from market_options where option_value = 'audit-test-club'`;
await sql`delete from invites where code = 'audit-group'`;
await sql`delete from consents where person_id = any(${ids}::uuid[])`;
await sql`delete from person_schools where person_id = any(${ids}::uuid[])`;
await sql`delete from social_affinities where person_id = any(${ids}::uuid[])`;
await sql`delete from life_relevance where person_id = any(${ids}::uuid[])`;
await sql`delete from children where person_id = any(${ids}::uuid[])`;
await sql`delete from people where id = any(${ids}::uuid[])`;
await sql`delete from referrals`;
await sql`delete from admin_users where created_by = 'test:e2e' or name like 'auditadmin%'`;
/* Flags and audit rows whose subject this run deleted — a queue entry pointing at
   nothing is worse than no entry. */
const orphans = await sql`delete from flags f where (f.subject_kind = 'place_contribution' and not exists (select 1 from place_contributions pc where pc.id = f.subject_id)) or (f.subject_kind = 'demand_signal' and not exists (select 1 from demand_signals d where d.id = f.subject_id)) or (f.subject_kind = 'place' and not exists (select 1 from places pl where pl.id = f.subject_id)) returning f.id`;
await sql`delete from audit_log where action in ('contribution.approve','referral.link','place.answer_ready','claim.delete','invite.create','invite.retire') and at > now() - interval '1 hour'`;

console.log(`\n  cleaned up: ${ids.length} test parent(s), ${orphans.length} orphaned flag(s)`);
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) console.log("  failed:\n" + failures.map((f) => "    - " + f).join("\n"));
await sql.end();
process.exitCode = fail === 0 ? 0 : 1;
