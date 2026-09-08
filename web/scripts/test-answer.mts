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
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
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
/* The label set is what the hoisting checks vary, and `parent` takes a whole
   `trust` — this is the shim, not a second fixture. */
const backed = (name: string, labels: string[], over: Partial<AnswerCandidate> = {}) =>
  parent({ name, trust: { labels, freshness: "fresh", public_only: false }, ...over });

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

console.log("\n=== the opening claims nothing it cannot stand behind ===");
/* These three used to assert the opposite, which is how the fault survived: the
   suite was written from the same misreading as the code. The opener counted
   *records* and called them *parents*, and counted them before the budget loop
   dropped the ones that did not fit — a live walk printed "10 local parents have
   shared something on this" above two records. */
ok(
  "it does not count people, because a candidate cannot say how many there are",
  !/\d+ local parents/.test(
    compose([parent(), parent({ name: "Little Maestros" })]).text,
  ),
  "firsthand_count is per record, and one parent can stand behind several",
);
ok(
  "one record and two read the same way",
  compose([parent()]).text.split("\n")[0] ===
    compose([parent(), parent({ name: "Little Maestros" })]).text.split("\n")[0],
);
ok(
  "and it still never says parents about public information",
  /general information, not from a parent/.test(compose([publicRecord()]).text) &&
    !/local parent/.test(compose([publicRecord()]).text.split("\n")[0]),
  "5.6's guard arriving in the prose, where it is easiest to lose",
);
ok(
  "a parent-backed record still opens as parent-backed",
  /^Here's what local parents have shared/.test(compose([parent(), publicRecord()]).text),
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

console.log("\n=== a record says what it is, and the whole answer stays in GSM-7 ===");
{
  /* The live answer read "Little Maestros (on Mission St): Validated by multiple
     parents · Human-reviewed · Last confirmed Aug 2026" — which tells a parent
     who does not already know what Little Maestros is precisely nothing, and
     the identical chain on the next line made both look machine-generated. */
  const one = compose([
    parent({ name: "Little Maestros", venue: "on Mission St", kind: "activity", area: "south-pasadena" }),
  ]).text;
  ok("it names the kind in a word a parent would use", /class/.test(one), one);
  ok("and where it is, from the slug", /South Pasadena/.test(one), one);
  ok(
    "the labels themselves are untouched",
    /Validated by multiple parents/.test(one),
    "approved copy, verbatim - only the punctuation between them is ours",
  );

  /* One character outside GSM-7 halves the budget, and the old separator was
     one: 130 chars/UCS-2/two segments with the interpunct against 128/GSM-7/one
     without. Across a two-record answer that was five segments against two. */
  const two = compose([
    parent({ name: "Little Maestros", venue: "on Mission St", kind: "activity", area: "south-pasadena" }),
    parent({ name: "Rose Bowl Aquatics parent & me", kind: "activity", area: "old-pasadena" }),
  ]).text;
  ok(
    "a two-record answer is GSM-7, not UCS-2",
    seg.planSegments(two).encoding === "gsm7",
    JSON.stringify(seg.planSegments(two)),
  );
  ok(
    "and stays inside the budget's own segment count",
    seg.planSegments(two).segments <= 3,
    `${seg.planSegments(two).segments} segments, budget ${a.SMS_BUDGET}`,
  );
  ok(
    "which is a whole number of segments, not a number somebody typed",
    a.SMS_BUDGET % 153 === 0,
    "153 is a concatenated GSM-7 segment; a budget between two is a budget that wastes one",
  );
  ok(
    "and nothing the composer writes reaches for an em dash",
    !/\u2014|\u00b7/.test(two),
    "the design system allows both on a screen; sms-segments.ts is why not here",
  );
}

console.log("\n=== a claim every record shares is made once, not on each line ===");
{
  /* The trust chain is approved copy and cannot be shortened, so what was
     shortened is the repetition: 70 characters per line saying the same thing,
     roughly half the message. Nothing is reworded and no record loses a claim
     - the identical string is printed once about the set. */
  const same = ["Validated by multiple parents", "Human-reviewed"];
  const three = compose([
    backed("A", same),
    backed("B", same),
    backed("C", same),
  ]).text;
  ok(
    "the shared chain appears once",
    three.match(/Human-reviewed/g)?.length === 1,
    three,
  );
  ok("and it is still verbatim", /Validated by multiple parents/.test(three));

  /* The interesting case, and the one that must not be flattened: two records
     of different strength. What they share hoists; what distinguishes them
     stays where a reader can see which is which. */
  const mixed = compose([
    backed("Strong", ["Validated by multiple parents", "Human-reviewed"]),
    backed("Weaker", ["Shared by a local parent", "Human-reviewed"]),
  ]).text;
  const strongLine = mixed.split("\n").find((l) => l.startsWith("Strong")) ?? "";
  const weakLine = mixed.split("\n").find((l) => l.startsWith("Weaker")) ?? "";
  ok(
    "the distinction stays on the lines",
    /Validated by multiple parents/.test(strongLine) &&
      /Shared by a local parent/.test(weakLine),
    "hoisting what differs would tell the reader both were equally backed",
  );
  ok(
    "and only what they share is hoisted",
    !/Human-reviewed/.test(strongLine) && /All of these: Human-reviewed/.test(mixed),
  );

  ok(
    "a single record keeps its own labels and gets no footer",
    !/All of these/.test(compose([backed("Alone", same)]).text),
    "a shared claim about one thing has nothing to share it with",
  );

  /* The space it buys is the point: three records where two fit before. */
  ok(
    "three records fit where the repetition would have cost one",
    compose([
      backed("Little Maestros", same, { area: "south-pasadena", price: "$50-100 a month" }),
      backed("Rose Bowl Aquatics parent & me", same, { area: "old-pasadena", price: "$100-200 a term" }),
      backed("AYSO soccer", same, { area: "sierra-madre", price: "$50-100 a term" }),
    ]).used === 3,
  );
}

console.log("\n=== general information sits under the parents, never over them ===");
/* The client's instruction is that an answer carries both: what is generally
   known, and what parents here have backed. These are the checks that keep the
   second half from being diluted by the first. */
const web = (name: string, over: Partial<AnswerCandidate> = {}): AnswerCandidate => ({
  name,
  kind: "indoor play space",
  firsthand_count: 0,
  trust: { labels: [t.TRUST_LABEL.PUBLIC], freshness: "fresh", public_only: true },
  ...over,
});

ok(
  "a parent-backed record outranks a web result",
  a.rankForAnswer([web("Kidspace"), parent()])[0].name === "Toddler Tunes",
);
ok(
  "even a secondhand, stale one",
  a.rankForAnswer([
    web("Kidspace"),
    parent({ name: "Old Gym", firsthand_count: 0, trust: { labels: [t.TRUST_LABEL.SHARED], freshness: "stale", public_only: false } }),
  ])[0].name === "Old Gym",
  "firsthand_count 0 + stale would lose on every other key — this is why public_only is its own",
);
ok(
  "an answer built from both is not public_only",
  a.composeAnswer({ candidates: [parent(), web("Kidspace")], has_question: true }).public_only === false,
);
ok(
  "and a web result never wears a parent label",
  (() => {
    const out = a.composeAnswer({ candidates: [web("Kidspace")], has_question: true });
    return PARENT_LABELS.every((l) => !out.text.includes(l));
  })(),
);
ok(
  "parent_used counts the parents, not the pages",
  (() => {
    const out = a.composeAnswer({
      candidates: [parent(), web("Kidspace"), web("Rose Bowl"), web("The Arroyo")],
      has_question: true,
    });
    return out.used > out.parent_used && out.parent_used === 1;
  })(),
);
ok(
  "so one parent plus three pages still offers to ask the network",
  a.composeAnswer({
    candidates: [parent(), web("Kidspace"), web("Rose Bowl"), web("The Arroyo")],
    has_question: true,
  }).next_step === "offer_blast",
  "without parent_used this reads as four records and stops offering",
);
ok(
  "two parents do not",
  a.composeAnswer({
    candidates: [parent(), parent({ name: "Baby Beats" }), web("Kidspace")],
    has_question: true,
  }).next_step === "none",
);

console.log("\n=== reading what came back from the web ===");
const pi = (await import(`../lib/public-info.ts?v=${Date.now()}`)) as typeof import("../lib/public-info.ts");
const np = (await import(`../lib/named-person.ts?v=${Date.now()}`)) as typeof import("../lib/named-person.ts");
const found = (json: string) => pi.readFindings(json, (n) => np.looksLikePerson(n));

ok(
  "prose around the JSON is tolerated",
  found('Here is what I found:\n{"findings":[{"name":"Kidspace","what":"childrens museum","area":"Pasadena"}]}\nHope that helps.').length === 1,
);
ok("nothing parseable is nothing", found("I could not find anything useful.").length === 0);
ok("a findings key that is not a list is nothing", found('{"findings":"lots"}').length === 0);
ok(
  "a row missing what it is gets dropped",
  found('{"findings":[{"name":"Kidspace"},{"name":"Rose Bowl","what":"public park"}]}').length === 1,
);
ok(
  "a person is refused",
  found('{"findings":[{"name":"Ms. Diane Kovalenko","what":"piano tutor"}]}').length === 0,
  "invariant 11.4 — a record whose own name is a person, arriving from a page nobody vetted",
);
ok(
  "a business named after its founder is not",
  found('{"findings":[{"name":"Coach Pattys Gymnastics","what":"gymnastics classes"}]}').length === 1,
  "the venue-word veto: this is a real record in this market",
);
ok(
  "the same place twice is once",
  found('{"findings":[{"name":"Kidspace","what":"museum"},{"name":"kidspace","what":"childrens museum"}]}').length === 1,
);
ok(
  "and it stops at three",
  found(
    '{"findings":[' +
      ["A Place", "B Place", "C Place", "D Place"].map((n) => `{"name":"${n}","what":"indoor play"}`).join(",") +
      "]}",
  ).length === pi.MAX_PUBLIC_FINDINGS,
);
ok(
  "a name spread over lines is flattened",
  found(String.raw`{"findings":[{"name":"Kidspace\n  Museum","what":"indoor play"}]}`)[0]
    ?.name === "Kidspace Museum",
  "a newline would break the one-line-per-record shape the composer renders into",
);
ok(
  "and a raw newline in the JSON is dropped, not repaired",
  found(`{"findings":[{"name":"Kidspace${"\n"}Museum","what":"x"}]}`).length === 0,
  "an unescaped control character makes the whole reply unparseable, and the honest reading of that is nothing rather than a guess at what was meant",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
