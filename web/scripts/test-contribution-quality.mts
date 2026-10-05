/**
 * The one rule behind "Qualifies · Needs follow-up · Too thin" (5 Oct), the
 * Founding progress in the chat, and the admin's Counts-toward-Founding.
 *
 * Most checks assert a refusal: a card that is missing something must never read
 * as qualifying, because that is the sentence the client reported as a
 * contradiction ("Counts toward Founding" beside "Fully answered: Not yet").
 */
import {
  assessCaregiver,
  assessChatCard,
  assessContribution,
  countCompletePerPerson,
  isNothingToFlag,
  isThinAnswer,
  missingLine,
  type QualityInput,
} from "../lib/contribution-quality";
import { countsTowardFounding, qualityOf } from "../lib/admin/quality";
import { cleanContributionPatch } from "../lib/admin/contribution-edit";
import type { ContributionRow } from "../lib/admin/types";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const GOOD: QualityInput = {
  kind: "activity",
  firsthand: true,
  name: "Little Maestros",
  has_child_age: true,
  last_there: true,
  why: "Small groups and a teacher who remembers every child's name",
  caveat_answered: true,
  tip_text: null,
};

console.log("\n=== an activity ===");
ok("everything answered, firsthand, with a real reason, qualifies", assessContribution(GOOD).status === "qualifies");
ok("and says nothing is missing", assessContribution(GOOD).missing.length === 0);
const gaps: Array<[string, Partial<QualityInput>, string]> = [
  ["no child age", { has_child_age: false }, "how old their child was"],
  ["no 'when were you last there'", { last_there: false }, "when they were last there"],
  ["no reason at all", { why: null }, "what they liked about it"],
  ["a reason of two words", { why: "it's great" }, "more on what they liked about it"],
  ["no answer to what to know first", { caveat_answered: false }, "whether there's a catch"],
  ["an unnamed record", { name: "Untitled" }, "a name"],
];
for (const [label, patch, word] of gaps) {
  const q = assessContribution({ ...GOOD, ...patch });
  ok(`${label} does not qualify`, q.status !== "qualifies", q.status);
  ok(`  …and says exactly what is missing: ${word}`, q.missing.includes(word), q.missing.join(" + "));
}
ok(
  "two gaps read as one line an admin can act on",
  missingLine(assessContribution({ ...GOOD, has_child_age: false, caveat_answered: false })) ===
    "Need how old their child was + whether there's a catch",
);
ok("a friend's experience never qualifies, and says why", (() => {
  const q = assessContribution({ ...GOOD, firsthand: false });
  return q.status === "needs_follow_up" && /friend/.test(q.missing[0]);
})());
ok(
  "a name with nothing behind it is too thin, not a follow-up",
  assessContribution({ ...GOOD, why: null, caveat_answered: false, has_child_age: false, last_there: false }).status ===
    "too_thin",
);

console.log("\n=== a place and a tip ask less ===");
ok(
  "a place does not need the child's age or a last visit",
  assessContribution({ ...GOOD, kind: "place", has_child_age: false, last_there: false }).status === "qualifies",
);
ok(
  "but needs what to know before going",
  assessContribution({ ...GOOD, kind: "place", caveat_answered: false }).missing.includes("what to know before going"),
);
const TIP: QualityInput = {
  ...GOOD,
  kind: "tip",
  name: null,
  has_child_age: false,
  last_there: false,
  caveat_answered: false,
  tip_text: "Sign up the week registration opens",
  why: "It saved us a month on the waitlist",
};
ok("a tip needs the tip and why it helped, and no name", assessContribution(TIP).status === "qualifies");
ok("a tip without why it helped is a follow-up", assessContribution({ ...TIP, why: null }).missing.includes("why it helped"));
ok("a tip with neither is too thin", assessContribution({ ...TIP, why: null, tip_text: null }).status === "too_thin");

console.log("\n=== 'nothing to flag' is an answer, and not a caveat ===");
for (const t of ["None", "nope", "Nothing to flag", "nothing to flag.", "Nothing really", "No issues", "n/a"])
  ok(`"${t}" is read as declining`, isNothingToFlag(t));
for (const t of ["Parking is brutal after 10am", "no parking", "Nothing but the waitlist is long"])
  ok(`"${t}" is a real caveat`, !isNothingToFlag(t));
ok("praise with nothing in it is thin", isThinAnswer("great!") && isThinAnswer("we loved it") && isThinAnswer("good"));
ok("a sentence is not", !isThinAnswer("The teacher is why: patient with a shy three-year-old"));

console.log("\n=== a card as the chat holds it ===");
const card = {
  name: "Little Maestros",
  firsthand: "yes",
  child_age: [3],
  freshness: "current",
  recommendation: "yes",
  what_makes_it_great: "Small groups and a very patient teacher",
  caveat: "Nothing to flag",
};
ok("a finished activity card qualifies", assessChatCard("activity", card).status === "qualifies");
ok(
  "a card from before 5 Oct that skipped the caveat (empty string) still counts as asked",
  assessChatCard("activity", { ...card, caveat: "" }).status === "qualifies",
);
ok("one that was never asked does not", assessChatCard("activity", { ...card, caveat: undefined }).status !== "qualifies");
ok("a secondhand activity does not", assessChatCard("activity", { ...card, firsthand: "secondhand" }).status !== "qualifies");
ok(
  "a place card in the chat's own step ids qualifies",
  assessChatCard("place", {
    name: "Victory Park",
    type: "park",
    what_makes_it_great: "Shade and a fence, and the splash pad",
    caveat: "Parking",
  }).status === "qualifies",
);
ok(
  "a tip card in the chat's own step ids qualifies",
  assessChatCard("tip", {
    topic: "schedules",
    tip: "Book the shelters early",
    what_makes_it_great: "Saturdays fill up by Wednesday",
  }).status === "qualifies",
);

console.log("\n=== a caregiver ===");
const CG = {
  name: true,
  type: true,
  ages: true,
  strengths: true,
  how_long: true,
  last_worked: true,
  recommend: "yes",
  reference_answered: true,
  know_first_answered: true,
};
ok("a complete recommendation qualifies", assessCaregiver(CG).status === "qualifies");
ok(
  "'with some context' still counts — it is held for a person, not refused",
  assessCaregiver({ ...CG, recommend: "hesitant" }).status === "qualifies",
);
ok("a No is too thin and says it is not a recommendation", (() => {
  const q = assessCaregiver({ ...CG, recommend: "no" });
  return q.status === "too_thin" && /recommend/.test(q.missing[0]);
})());
ok("no reference answer does not qualify", assessCaregiver({ ...CG, reference_answered: false }).status === "needs_follow_up");
ok(
  "neither does no 'anything a family should know'",
  assessCaregiver({ ...CG, know_first_answered: false }).status === "needs_follow_up",
);
ok(
  "in the chat's own step ids",
  assessChatCard("caregiver", {
    name: ["Maria", "G"],
    type: "nanny",
    cared_for_ages: ["toddler"],
    strengths: ["calm"],
    how_long: "1_3y",
    last_worked: "current",
    hire_again: "yes",
    reference_willing: "yes",
    know_first: "Nothing to flag",
  }).status === "qualifies",
);

console.log("\n=== the admin: added to Pando is not counting toward Founding ===");
const row = {
  id: "r1",
  kind: "activity",
  share: {
    id: "s1",
    name: "Little Maestros",
    venue: null,
    neighborhoods: [],
    age_bands: [],
    freshness_state: "fresh",
    last_confirmed_at: null,
    validated_count: 0,
    answer_ready: false,
  },
  firsthand: true,
  child_age_at_time: [3],
  last_there: "current",
  how_much: null,
  recommendation: "yes",
  what_makes_it_great: "Small groups and a very patient teacher",
  caveat: null,
  caveat_answered: true,
  who_for: null,
  who_not_for: null,
  price_band: null,
  price_unit: null,
  worth_it: null,
  follow_up_ok: false,
  tip_text: null,
  extra_note: null,
  status: "approved",
  confidence: null,
  confidence_note: null,
  needs_detail_note: null,
  provenance: "parent_submitted",
  contributor: null,
  is_test: false,
  created_at: "2026-10-05T00:00:00Z",
} as unknown as ContributionRow;
ok("approved and complete counts", countsTowardFounding(row) && qualityOf(row).status === "qualifies");
ok("approved but missing the age does not — it stays in Pando", !countsTowardFounding({ ...row, child_age_at_time: [] }));
ok("complete but not yet approved does not", !countsTowardFounding({ ...row, status: "pending_review" }));
ok("and a test row never does", !countsTowardFounding({ ...row, is_test: true }));

console.log("\n=== Founding counts complete cards, not merely approved ones ===");
const share = (person_id: string, patch: Record<string, unknown> = {}) => ({
  person_id,
  kind: "activity" as const,
  firsthand: true,
  name: "Little Maestros",
  child_age_at_time: [3],
  last_there: "current",
  what_makes_it_great: "Small groups and a very patient teacher",
  caveat_answered: true,
  tip_text: null,
  ...patch,
});
const nomination = (person_id: string, patch: Record<string, unknown> = {}) => ({
  person_id,
  first_name: "Maria",
  care_type: "nanny",
  cared_for_ages: ["toddler"],
  strengths: ["calm"],
  how_long: "1_3y",
  last_worked: "current",
  hire_again: "yes",
  reference_willing: "yes",
  ...patch,
});
const counted = countCompletePerPerson({
  shares: [
    share("a"),
    share("a", { child_age_at_time: [] }),
    share("b"),
    share("b", { what_makes_it_great: "good" }),
    share("c", { firsthand: false }),
  ],
  nominations: [nomination("a"), nomination("b", { hire_again: "no" }), nomination("c", { reference_willing: null })],
});
ok("a complete card, one with no age, and a complete caregiver: a counts two", counted.get("a") === 2, String(counted.get("a")));
ok("a thin reason, and a caregiver the family would not recommend, do not count", counted.get("b") === 1, String(counted.get("b")));
ok("a friend's experience, and a caregiver with no reference answer, count for nothing", !counted.has("c"));
ok("an approved card that does not qualify stays out of the count, so it cannot earn Founding",
  countCompletePerPerson({ shares: [share("d", { caveat_answered: false }), share("d", { last_there: null })], nominations: [] }).get("d") === undefined);

console.log("\n=== the admin may edit every field of a contribution ===");
const clean = (patch: unknown) => cleanContributionPatch(patch);
const okPatch = (patch: unknown) => {
  const r = clean(patch);
  return r.ok ? r.patch : null;
};
ok("an age, a last visit and a recommendation can be supplied on a card that had none", (() => {
  const r = okPatch({ child_age_at_time: [6, 3], last_there: "recent", recommendation: "yes" });
  return r?.child_age_at_time?.join() === "3,6" && r?.last_there === "recent" && r?.recommendation === "yes";
})());
ok("an empty value clears a field that had one, where it used to be ignored", okPatch({ what_makes_it_great: "" })?.what_makes_it_great === null);
ok("a key that is absent is left alone", !("caveat" in (okPatch({ who_for: "a shy toddler" }) ?? {})));
ok("a value no question offered is refused, in words", (() => {
  const r = clean({ last_there: "last century" });
  return !r.ok && /choices parents were offered/.test(r.error);
})());
ok("an impossible age is refused", !clean({ child_age_at_time: [3, 40] }).ok && !clean({ child_age_at_time: ["x"] }).ok);
ok("a paid price needs what it is per, as the database says", !clean({ price_band: "50_100" }).ok);
ok("and a price with its unit is accepted", okPatch({ price_band: "50_100", price_unit: "per_month" })?.price_unit === "per_month");
ok("a free class drops any unit, so the price_shape CHECK cannot be tripped", okPatch({ price_band: "free", price_unit: "per_month" })?.price_unit === null);
ok("typed 'nothing to flag' is the answer, not a caveat", (() => {
  const r = okPatch({ caveat: "Nothing to flag" });
  return r?.caveat === null && r?.caveat_answered === true;
})());
ok("a real caveat also marks the question answered", okPatch({ caveat: "Parking is brutal" })?.caveat_answered === true);
ok("firsthand is not editable — it is the parent's own statement", !("firsthand" in (okPatch({ firsthand: false, who_for: "x" }) ?? {})));
ok("a patch that changes nothing is refused", !clean({}).ok && !clean(null).ok && !clean({ firsthand: false }).ok);
ok("whitespace is collapsed and a long text is cut", (okPatch({ extra_note: "a   b\n\n c" })?.extra_note === "a b c") && ((okPatch({ extra_note: "x".repeat(900) })?.extra_note ?? "").length === 400));

console.log("\n=== a compliment is not an experience (the client's Family Room example) ===");
const FR = "The Family Room";
const strong =
  "The Family Room was invaluable postpartum because I met mothers with babies the same age; the community was the main value, although it is expensive";
ok('"The Family Room is excellent" is incomplete', isThinAnswer("The Family Room is excellent", { name: FR, content: true }));
ok("her qualifying version is not", !isThinAnswer(strong, { name: FR, content: true }));
ok("as a whole contribution: the first needs follow-up and says what to add",
  (() => {
    const q = assessContribution({ ...GOOD, name: FR, why: "The Family Room is excellent" });
    return q.status === "needs_follow_up" && q.missing.includes("more on what they liked about it");
  })());
ok("and the second qualifies", assessContribution({ ...GOOD, name: FR, why: strong }).status === "qualifies");
for (const t of ["It's great", "Great teacher", "We loved it here", "Really good value", "The class is great"])
  ok('"' + t + '" says nothing a parent can act on', isThinAnswer(t, { name: "Little Maestros", content: true }));
for (const t of [
  "Small groups and a very patient teacher",
  "The teacher remembers every child's name",
  "Saturdays fill up by Wednesday",
  "It cost $30 a class and the 9am is calmer",
])
  ok('"' + t + '" is an experience', !isThinAnswer(t, { name: "Little Maestros", content: true }));
ok("the record's own name is not counted as something said, wherever it appears",
  isThinAnswer("Little Maestros is excellent", { name: "Little Maestros", content: true }));
ok("the rule is for 'what makes it good' only — a short caveat is still a caveat",
  !isThinAnswer("Parking is brutal", {}));

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
