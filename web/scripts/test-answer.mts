import type { AnswerCandidate } from "../lib/answer.ts";

/**
 * M5.7 — composing the answer.
 *
 * This is the only code in Pando that speaks to a parent in Pando's own voice, so
 * the checks that matter are the ones about **not claiming something**. A suite
 * that proved the sentences read nicely would pass while an answer built entirely
 * from public information told a parent that three of her neighbours recommend a
 * nursery none of them has heard of.
 */

const PARENT_LABELS = ["Shared by a local parent","Vouched by a local parent","Validated by multiple parents"] as const;

const a = (await import(`../lib/answer.ts?v=${Date.now()}`)) as typeof import("../lib/answer.ts");
const t = (await import(`../lib/trust-labels.ts?v=${Date.now()}`)) as typeof import("../lib/trust-labels.ts");

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};

const parent = (over: Partial<AnswerCandidate> = {}): AnswerCandidate => ({
  name: "Toddler Tunes",
  kind: "activity",
  firsthand_count: 2,
  trust: {
    labels: [t.TRUST_LABEL.VALIDATED, t.TRUST_LABEL.HUMAN_REVIEWED],
    freshness: "fresh",
    public_only: false,
  },
  ...over,
});
const publicRecord = (over: Partial<AnswerCandidate> = {}): AnswerCandidate =>
  parent({
    name: "City parks list",
    firsthand_count: 0,
    trust: { labels: [t.TRUST_LABEL.PUBLIC], freshness: "fresh", public_only: true },
    ...over,
  });

const compose = (candidates: AnswerCandidate[], over = {}) =>
  a.composeAnswer({ candidates, has_question: true, ...over });

console.log("\n=== the labels this suite checks for are the approved ones ===");
/**
 * `PARENT_LABELS` is written out above so that `answer.ts` can stay free of
 * runtime imports — `import type` is erased, a value import is not, and a module
 * with one cannot be loaded in a plain node test.
 *
 * That makes it a second copy of approved copy, which is the thing invariant 3
 * exists to prevent. So it is checked against the one file that holds the
 * wording: if somebody edits a label there and not here, this fails rather than
 * the suite quietly testing for a string the product no longer says.
 */
ok(
  "the local copy matches trust-labels.ts exactly",
  PARENT_LABELS[0] === t.TRUST_LABEL.SHARED &&
    PARENT_LABELS[1] === t.TRUST_LABEL.VOUCHED &&
    PARENT_LABELS[2] === t.TRUST_LABEL.VALIDATED,
  PARENT_LABELS.join(" | "),
);

console.log("\n=== invariant 3  the labels are pasted, never reworded ===");
const one = compose([parent()]);
ok(
  "the exact approved string appears",
  one.text.includes(t.TRUST_LABEL.VALIDATED),
  one.text,
);
ok(
  "and nothing paraphrases it",
  !/several parents|lots of parents|many parents|highly rated/i.test(one.text),
  "a paraphrase is a new claim nobody approved",
);

console.log("\n=== invariant 4  public information never claims a parent ===");
const pub = compose([publicRecord()]);
ok("it says so in the opening", /general information/i.test(pub.text), pub.text);
ok(
  "and carries no parent-trust label at all",
  !a.claimsAParent(pub.text, PARENT_LABELS),
  "this is the single most damaging sentence Pando could send",
);
ok("the flag is carried out, not left to be read from the text", pub.public_only === true);
ok(
  "a parent-backed answer is not flagged public",
  compose([parent()]).public_only === false,
);
ok(
  "one public record beside two parent ones does not make the answer public",
  compose([parent(), parent({ name: "Little Maestros" }), publicRecord()]).public_only === false,
);

console.log("\n=== the count in the opening is the count it can stand behind ===");
ok(
  "one parent reads as one",
  /^One local parent/.test(compose([parent()]).text),
);
ok(
  "two read as two",
  /^2 local parents/.test(compose([parent(), parent({ name: "Little Maestros" })]).text),
);
ok(
  "a public record is not counted among them",
  /^One local parent/.test(compose([parent(), publicRecord()]).text),
  "counting it would be the guard failing in the prose, where it is easiest to lose",
);

console.log("\n=== order: evidence first, freshness only as a tiebreak ===");
const stale = parent({
  name: "Stale but proven",
  firsthand_count: 3,
  trust: { labels: [t.TRUST_LABEL.VALIDATED], freshness: "stale", public_only: false },
});
const freshOne = parent({
  name: "Fresh but single",
  firsthand_count: 1,
  trust: { labels: [t.TRUST_LABEL.SHARED], freshness: "fresh", public_only: false },
});
ok(
  "three parents beat one, even when the three are stale",
  a.rankForAnswer([freshOne, stale])[0].name === "Stale but proven",
  "the spec marks old knowledge, it does not hide it",
);
ok(
  "freshness breaks a tie on equal evidence",
  a.rankForAnswer([
    parent({ name: "B", trust: { labels: [], freshness: "stale", public_only: false } }),
    parent({ name: "A", trust: { labels: [], freshness: "fresh", public_only: false } }),
  ])[0].name === "A",
);
ok(
  "an admin's answer-ready judgement outranks the count",
  a.rankForAnswer([
    parent({ name: "Busy", firsthand_count: 9 }),
    parent({ name: "Golden", firsthand_count: 1, answer_ready: true }),
  ])[0].name === "Golden",
  "it is a human having already looked",
);

console.log("\n=== a stale record is marked in the words, not dropped ===");
const staleText = compose([stale]).text;
ok("it is still in the answer", staleText.includes("Stale but proven"));
ok("and the reader is told", /this one is old/i.test(staleText));
ok(
  "an ageing one gets a softer warning, not the same one",
  /worth checking/i.test(
    compose([parent({ trust: { labels: [], freshness: "ageing", public_only: false } })]).text,
  ),
);
ok(
  "a fresh one says nothing about its age",
  !/old|worth checking/i.test(compose([parent()]).text),
  "saying 'fresh' out loud is noise",
);

console.log("\n=== length: whole records, never a cut sentence ===");
const many = Array.from({ length: 12 }, (_, i) =>
  parent({ name: `Place number ${i} with a fairly long name` }),
);
const long = compose(many);
ok("the answer fits the budget", long.text.length <= a.SMS_BUDGET, `${long.text.length}`);
ok("it dropped records rather than truncating", long.used < many.length, `used ${long.used}`);
ok(
  "and no line ends mid-word",
  !/\b\w+-$/.test(long.text.trim()) && !long.text.endsWith("…"),
);
ok(
  "the forwardable line still fits when asked for",
  (() => {
    const f = compose(many, { forwardable: true });
    return f.text.includes(a.SHARE_LINE) && f.text.length <= a.SMS_BUDGET;
  })(),
  "the budget is checked with the tail included, not after it is appended",
);

console.log("\n=== the next step ===");
ok(
  "a thin answer offers to ask the network",
  compose([parent()]).next_step === "offer_blast",
  "one record is not the answer they came for",
);
ok(
  "a solid one does not",
  compose([parent(), parent({ name: "Little Maestros" })]).next_step === "none",
  "offering when Pando already answered is selling something they do not need",
);
ok(
  "public information alone always offers",
  compose([publicRecord(), publicRecord({ name: "Another list" })]).next_step === "offer_blast",
);
ok(
  "nothing at all offers too",
  compose([]).next_step === "offer_blast",
);
ok(
  "unless they cannot be offered one, and then it goes to a person",
  compose([], { can_offer_blast: false }).next_step === "human_review",
  "a parent with no budget and no answer must not simply be left",
);
ok(
  "and an answer never offers when the caller says it cannot",
  compose([parent()], { can_offer_blast: false }).next_step === "none",
);

console.log("\n=== the empty answer says so honestly ===");
const empty = compose([]);
ok("it does not invent anything", empty.used === 0 && empty.labels.length === 0);
ok("it admits Pando does not know", /don't have anything/i.test(empty.text));
ok("and it claims no parent", !a.claimsAParent(empty.text, PARENT_LABELS));

console.log("\n=== the share line is only on an answer worth forwarding ===");
ok("absent by default", !compose([parent()]).text.includes(a.SHARE_LINE));
ok("present when asked", compose([parent()], { forwardable: true }).text.includes(a.SHARE_LINE));
ok(
  "it names the service, since a forwarded answer is a stranger's first contact",
  /Pando/.test(a.SHARE_LINE) && /ask your own/i.test(a.SHARE_LINE),
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
