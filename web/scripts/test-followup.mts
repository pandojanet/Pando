/**
 * The chat's follow-ups (9 Oct) — `lib/seed-chat/follow-up.ts`.
 *
 * Replaces `test-confirm-back.mts` with the confirm-back. The developer's rule:
 * a required or descriptive answer that is empty or too thin gets **one**
 * follow-up, straight away, and never a second for the same question. The
 * cases are mostly about where it must **not** ask: a name, the card's own last
 * question, a tap, a caregiver card, "nothing to flag", and a question asked
 * once already.
 *
 *     npm run test:followup
 */
const { followUpFor, mergeFollowUp, withoutMarkers } = (await import(
  `../lib/seed-chat/follow-up.ts?v=${Date.now()}`
)) as typeof import("../lib/seed-chat/follow-up.ts");
const { buildScripts, buildSubScripts, followUpMark } = (await import(
  `../lib/seed-chat/scripts.ts?v=${Date.now()}`
)) as typeof import("../lib/seed-chat/scripts.ts");

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

const scripts = buildScripts("pasadena");
const subs = buildSubScripts("pasadena");
const stepOf = (script: { steps: { id: string }[] }, id: string) => {
  const s = script.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s as (typeof scripts)["activity"]["steps"][number];
};

const why = stepOf(scripts.activity, "what_makes_it_great");
const caveat = stepOf(scripts.activity, "caveat");
const whoFor = stepOf(scripts.activity, "who_for");

/* ── asks, where it should ── */
for (const thin of ["good", "great!", "we loved it", "nice", "amazing"]) {
  ok(`a thin "why" (“${thin}”) is followed up`, followUpFor("activity", why, thin, { name: "Little Maestros" }) !== null);
}
ok(
  "praise that only repeats the name is thin",
  followUpFor("activity", why, "Little Maestros is excellent", { name: "Little Maestros" }) !== null,
);
ok("a skipped descriptive question is followed up — it used not to be", followUpFor("activity", whoFor, "", {}) !== null);
ok("a thin caveat is followed up", followUpFor("activity", caveat, "parking", {}) !== null);
ok(
  "the tip button's context answer is followed up when thin",
  followUpFor("tip", stepOf(scripts.tip, "what_is_it"), "book", {}) !== null,
);
ok(
  "a sub-category's own descriptive step is followed up when skipped",
  followUpFor("activity", stepOf(subs.camps, "timing_note"), "", {}) !== null,
);
ok(
  "the doctor card's follow-up is worded for a doctor",
  /doctor/i.test(followUpFor("doctor", stepOf(scripts.doctor, "what_makes_it_great"), "good", {}) ?? ""),
);

/* ── does not ask, where it should not ── */
ok(
  "a real answer is not followed up",
  followUpFor("activity", why, "Small groups and a teacher who learned every child's name", {}) === null,
);
ok("“Nothing to flag” is an answer to the caveat", followUpFor("activity", caveat, "Nothing to flag", {}) === null);
ok(
  "never twice for the same question",
  followUpFor("activity", why, "good", { [followUpMark("what_makes_it_great")]: "yes" }) === null,
);
ok(
  "a second question on the same card still gets its own",
  followUpFor("activity", caveat, "parking", { [followUpMark("what_makes_it_great")]: "yes" }) !== null,
);
ok("the name is never followed up", followUpFor("activity", stepOf(scripts.activity, "name"), "LM", {}) === null);
ok(
  "the card's own last question is never followed up",
  followUpFor("activity", stepOf(scripts.activity, "extra_note"), "", {}) === null,
);
ok(
  "a tap is never followed up",
  followUpFor("activity", stepOf(scripts.activity, "recommendation"), "yes", {}) === null,
);
ok(
  "a caregiver card is never followed up (invariant 12)",
  followUpFor("caregiver", { ...why, id: "what_makes_special" }, "good", {}) === null,
);
ok(
  "the activity and place context questions are answered in a few words, not followed up",
  followUpFor("activity", stepOf(scripts.activity, "what_is_it"), "swim", {}) === null &&
    followUpFor("place", stepOf(scripts.place, "what_is_it"), "park", {}) === null,
);

/* ── which steps carry one ── */
{
  const allScripts = [...Object.values(scripts), ...Object.values(subs)].filter((s) => s.kind !== "caregiver");
  const textSteps = allScripts.flatMap((s) => s.steps.filter((x) => x.widget === "text").map((x) => ({ s, x })));
  const missing = textSteps
    .filter(({ x }) => !["name", "extra_note"].includes(x.id) && !x.followUp && !x.classifyAfter)
    .map(({ s, x }) => `${s.subcategory ?? s.kind}.${x.id}`);
  ok("every descriptive text step carries a follow-up", missing.length === 0, missing.join(", "));
  const extra = textSteps
    .filter(({ x }) => ["name", "extra_note"].includes(x.id) && x.followUp)
    .map(({ s, x }) => `${s.subcategory ?? s.kind}.${x.id}`);
  ok("and no name or last question does", extra.length === 0, extra.join(", "));
  const caregiverAsks = scripts.caregiver.steps.filter((x) => x.followUp).map((x) => x.id);
  ok("and no caregiver step does", caregiverAsks.length === 0, caregiverAsks.join(", "));
}

/* ── merging and markers ── */
ok("what they add is appended to what they said", mergeFollowUp("good", "the teacher is why") === "good — the teacher is why");
ok("a skip leaves it as it was", mergeFollowUp("good", "  ") === "good");
ok("a skipped question gets the addition alone", mergeFollowUp("", "toddlers") === "toddlers");
ok(
  "the markers never reach the server",
  JSON.stringify(withoutMarkers({ name: "x", [followUpMark("caveat")]: "yes" })) === JSON.stringify({ name: "x" }),
);

console.log(`\n  ${passed} checks passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);
