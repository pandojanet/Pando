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
/**
 * ⚠ **Re-approved by the client on 9 Sep.** The three parent-strength labels and
 * the confirmation date are said in prose now — *"2 parents near you have used
 * it, last confirmed Aug 2026"* — which is her strategy's own wording and says
 * *more* than "Validated by multiple parents" did, because it carries a number.
 * What still has to hold is that the claim is exact and never paraphrased upward.
 */
ok(
  "the count is stated, not described",
  /^2 parents near you have used /.test(one.text),
  one.text,
);
ok(
  "the local copy of what prose replaced matches trust-labels.ts exactly",
  a.SAID_IN_PROSE.includes(t.TRUST_LABEL.SHARED) &&
    a.SAID_IN_PROSE.includes(t.TRUST_LABEL.VOUCHED) &&
    a.SAID_IN_PROSE.includes(t.TRUST_LABEL.VALIDATED) &&
    a.SAID_IN_PROSE.includes(t.TRUST_LABEL.HUMAN_REVIEWED),
  a.SAID_IN_PROSE.join(" | "),
);
ok(
  "and none of them is printed as well",
  a.SAID_IN_PROSE.every((l) => !one.text.includes(l)),
  "saying one claim twice is how a reader stops believing either",
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
  "a lower-ranked second record does not displace the lead",
  compose([parent({ rank: 0 })]).text.split("\n")[0] ===
    compose([parent({ rank: 0 }), parent({ name: "Little Maestros", rank: 5 })]).text.split(
      "\n",
    )[0],
  "the first sentence is the lead record's own evidence, so only relevance may move it",
);
ok(
  "and it still never says parents about public information - the head carries the verbatim label once (22 Oct)",
  compose([publicRecord()]).text.split("\n")[0] === `Here's what I found. ${t.TRUST_LABEL.PUBLIC}:` &&
    !/local parent/.test(compose([publicRecord()]).text.split("\n")[0]),
  "5.6's guard arriving in the prose, where it is easiest to lose",
);
ok(
  "a parent-backed answer opens on the evidence, with no preamble",
  /^\d+ parents? near you (have|has) used /.test(compose([parent(), publicRecord()]).text),
  "the old 38-character opening said what the next sentence says, with a number in it",
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

console.log("\n=== relevance outranks evidence, which is what the client reported ===");
/**
 * ⚠ **The whole of 5.5's relevance work reached no parent until 9 Sep.**
 * `retrieveFor` orders by the question's topic and the asker's area and hands
 * the list over in that order; `rankForAnswer` re-sorted by evidence and
 * reversed it. Every band holds fewer records than retrieval's own limit, so
 * the SQL could not even change *which* rows came back — it ordered them and
 * the composer threw the order away.
 *
 * From `answers` on 8 Sep, sent to a real phone: *"Please give me some great
 * school in Passadena"* answered with a watershed park and a summer camp, the
 * only school on the page being the single public line.
 */
ok(
  "the most relevant record leads, even against more evidence",
  a.rankForAnswer([
    parent({ name: "Popular park", rank: 2, firsthand_count: 9 }),
    parent({ name: "The actual school", rank: 0, firsthand_count: 1 }),
  ])[0].name === "The actual school",
  "count is not relevance; a park two parents used is not an answer about schools",
);
ok(
  "and even against an admin's golden flag",
  a.rankForAnswer([
    parent({ name: "Golden but off-topic", rank: 3, answer_ready: true }),
    parent({ name: "On topic", rank: 0 }),
  ])[0].name === "On topic",
  "17.1 says complete enough to answer WITH, which says nothing about this question",
);
ok(
  "evidence still decides among equally relevant records",
  a.rankForAnswer([
    parent({ name: "One parent", rank: 1, firsthand_count: 1 }),
    parent({ name: "Three parents", rank: 1, firsthand_count: 3 }),
  ])[0].name === "Three parents",
);
ok(
  "an unranked record sorts last rather than first",
  a.rankForAnswer([
    parent({ name: "Unranked", firsthand_count: 9 }),
    parent({ name: "Ranked", rank: 5, firsthand_count: 0 }),
  ])[0].name === "Ranked",
  "a missing rank must not read as rank 0",
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
{
  /* A parent's very long note must cost the note, never the record or its age
     warning: the lead used to be skipped (or the block cut mid-sentence, with the
     "check before you book" line at its end lost). */
  const wordy = compose([
    parent({
      name: "Wordy Studio",
      firsthand_count: 1,
      withdrawn: 1,
      notes: { great: "loved it ".repeat(120).trim(), caveat: "parking is hard" },
    }),
  ]);
  ok("a long note drops the note, not the record", wordy.text.includes("Wordy Studio"));
  ok("and never cuts it mid-sentence", !wordy.text.includes("loved it loved"));
  ok(
    "the withdrawal warning survives",
    wordy.text.includes("no longer be worth it"),
    "it sits at the end of the block, which is exactly what a cut removes first",
  );
}

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
{
  /* 24 Sep: nobody near the place is not "no budget". Sent to a person it
     became "someone is putting an answer together" for New York, which nobody
     can keep. */
  const nobody = compose([], { can_offer_blast: false, nobody_near: { place: "New York, NY" } });
  ok("nobody near to ask ends the exchange, not a person's queue", nobody.next_step === "none");
  ok("and says where, without the state", nobody.text.includes("near New York on this"));
  ok("and promises no answer later", !/come back|putting an answer/i.test(nobody.text));
  ok(
    "a place with nothing near still answers from what was found",
    compose([parent()], { can_offer_blast: false, nobody_near: { place: "New York" } }).used === 1,
  );
  const general = compose([publicRecord()], { can_offer_blast: false, nobody_near: { place: "New York, NY" } });
  ok("with general information, it says first that parents near there have nothing yet",
    general.text.startsWith("There's nothing from parents near New York yet."), general.text);
  ok("and the information is still marked as not from a parent", general.text.includes("not from a parent"));
  ok("and it is sent, not queued for a person", general.next_step === "none");
}

{
  /* 25 Sep: a record confirmed this month and then withdrawn by one parent read
     "last confirmed Sep 2026 ... This one is old". A withdrawal is said as one. */
  const stale = { labels: [t.TRUST_LABEL.VALIDATED], freshness: "stale" as const, public_only: false };
  const disputed = compose([parent({ withdrawn: 1, trust: stale })]);
  ok("a withdrawal is not called old", !/This one is old/.test(disputed.text), disputed.text);
  ok(
    "it says a parent said it may no longer be worth it",
    /One parent recently said it may no longer be worth it/.test(disputed.text),
  );
  const old = compose([parent({ trust: stale })]);
  ok("age alone still reads as old", /This one is old/.test(old.text));
  ok("two withdrawals are counted", a.withdrawalNote(2).startsWith("2 parents"));
}

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
    "the strength is a number now, and it is the right number",
    /^2 parents near you have used Little Maestros, a class in South Pasadena/.test(one),
    one,
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
  /* ⚠ Hoisting now applies only to the labels prose did **not** absorb.
     `Reference available` is the live one: a caregiver carries it, it is
     approved copy, and it says something the evidence sentence does not. */
  const same = ["Reference available"];
  const three = compose([
    backed("A", same),
    backed("B", same),
    backed("C", same),
  ]).text;
  ok(
    "a label prose did not absorb still hoists, once",
    three.match(/Reference available/g)?.length === 1,
    three,
  );
  ok("and it is still verbatim", /All of these: Reference available\./.test(three), three);
  ok(
    "while the ones prose absorbed are never printed at all",
    !/Validated by multiple parents|Human-reviewed/.test(
      compose([backed("A", ["Validated by multiple parents", "Human-reviewed"])]).text,
    ),
  );

  /* The interesting case, and the one that must not be flattened: two records
     of different strength. What they share hoists; what distinguishes them
     stays where a reader can see which is which. */
  /* ⚠ **The distinction survived the rewrite, and it is carried better.** It
     used to be "Validated by multiple parents" against "Shared by a local
     parent"; it is now three parents against one, on the face of each line. */
  const mixed = compose([
    backed("Strong", ["Reference available"], { firsthand_count: 3, rank: 0 }),
    backed("Weaker", ["Reference available"], { firsthand_count: 1, rank: 1 }),
  ]).text;
  ok(
    "the difference in strength is visible per record",
    /3 parents near you have used Strong/.test(mixed) &&
      /One parent near you has used Weaker/.test(mixed),
    mixed,
  );
  ok(
    "and what they genuinely share is still hoisted once",
    mixed.match(/Reference available/g)?.length === 1,
    mixed,
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
  a.rankForAnswer([web("Kidspace"), parent({ rank: 99 })])[0].name === "Toddler Tunes",
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
  "a detail that already ends in a full stop gets one, not two (25 Sep)",
  (() => {
    const out = a.composeAnswer({
      candidates: [web("Code Ninjas", { detail: "Belt-based progression system." })],
      has_question: true,
    });
    return out.text.includes("progression system.") && !out.text.includes("system..");
  })(),
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
  "and it stops at the cap, whatever the cap is",
  found(
    '{"findings":[' +
      Array.from(
        { length: pi.MAX_PUBLIC_FINDINGS + 2 },
        (_, i) => `{"name":"Place ${i}","what":"indoor play"}`,
      ).join(",") +
      "]}",
  ).length === pi.MAX_PUBLIC_FINDINGS,
  /* Sized from the constant rather than hard-coded at four, which is what broke
     here when the cap went three -> five on 9 Sep: the fixture was testing the
     number instead of the rule. */
  `cap is ${pi.MAX_PUBLIC_FINDINGS}`,
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

/**
 * Naming one place twice under two different trust labels.
 *
 * The worst thing this half of the answer can do, and the reason the exclusion
 * exists at all: the record from a parent says "Validated by multiple parents"
 * and the web line says "Public/general information" about the same class, so
 * the answer contradicts itself on the one axis the product sells.
 */
const withExclude = (json: string, exclude: string[]) =>
  pi.readFindings(json, (n) => np.looksLikePerson(n), exclude);

const three = JSON.stringify({
  findings: [
    { name: "The Little Gym of Pasadena", what: "toddler gym classes", area: "Pasadena" },
    { name: "Rose Bowl Aquatics", what: "swim lessons", area: "Pasadena" },
    { name: "Kidspace Museum", what: "indoor play", area: "Pasadena" },
  ],
});

ok("with nothing to exclude, all three come back", withExclude(three, []).length === 3);
ok(
  "a record the parents already backed is dropped",
  withExclude(three, ["Rose Bowl Aquatics"]).every((f) => f.name !== "Rose Bowl Aquatics"),
);
ok(
  "even when the page writes it longer",
  withExclude(three, ["Little Gym"]).every((f) => !/Little Gym/.test(f.name)),
  "the page's 'The Little Gym of Pasadena' is the same place, and an exact key would miss it",
);
ok(
  "and when the record writes it longer",
  withExclude(three, ["Kidspace Museum, Pasadena"]).every((f) => f.name !== "Kidspace Museum"),
);
ok(
  "a different business sharing a first word is kept",
  withExclude(three, ["Little Gymnastics Academy"]).some((f) => /Little Gym of/.test(f.name)),
  "token prefix, never string prefix: 'little gymnastics' starts with 'little gym' as a string, and they are two businesses",
);
ok(
  "a one-word exclusion has to match exactly",
  pi.sameName("Waldorf", "Waldorf Early Childhood") === false,
  "or one common word would swallow every place beginning with it",
);
ok(
  "the possessive does not leave a stray letter",
  pi.normaliseName("Kidspace Children's Museum") === pi.normaliseName("Kidspace Museum"),
);
ok(
  "an accent is not a different place",
  pi.normaliseName("Café Con Leche") === pi.normaliseName("Cafe Con Leche"),
  "NFKD leaves a combining mark, and the alphanumeric pass would otherwise turn it into a space",
);
ok(
  "a name made only of shared words still dedupes against itself",
  pi.sameName("The Kids Club", "the kids club") && !pi.sameName("The Kids Club", "The Play Club"),
  "it normalises to nothing, so it falls back to the plain name rather than colliding with every other",
);
ok(
  "the reply cannot repeat itself either",
  pi.readFindings(
    '{"findings":[{"name":"Rose Bowl Aquatics","what":"swim"},{"name":"Rose Bowl Aquatics - Pasadena","what":"swim lessons"}]}',
    (n) => np.looksLikePerson(n),
  ).length === 1,
);

/**
 * The town, said once — and what it is, said at all.
 */
const oneFinding = (row: Record<string, unknown>) =>
  pi.readFindings(JSON.stringify({ findings: [row] }), (n) => np.looksLikePerson(n))[0];

/* 26 Oct, the SMS lab: an aside in the middle of the area leaked an address. */
ok(
  "an area ends where the model's aside begins, wherever it is",
  oneFinding({ name: "British Swim School", what: "toddler swim classes", area: "Pasadena (Hastings Ranch), 355 N Rosemead Blvd" })?.area === "Pasadena" &&
    oneFinding({ name: "Camp Galileo", what: "STEAM day camp", area: "Pasadena (New Horizon School), also Altadena" })?.area === "Pasadena" &&
    oneFinding({ name: "Little Gym", what: "gym classes", area: "South Pasadena, CA" })?.area === "South Pasadena" &&
    oneFinding({ name: "Little Gym", what: "gym classes", area: "Altadena" })?.area === "Altadena",
  JSON.stringify(oneFinding({ name: "British Swim School", what: "toddler swim classes", area: "Pasadena (Hastings Ranch), 355 N Rosemead Blvd" })),
);
ok(
  "a name that already carries the town does not repeat it",
  oneFinding({ name: "Encore Music South Pasadena", what: "music classes", area: "South Pasadena" })
    ?.area === null,
  "the composer renders `Name - what in Area`, so this read 'Encore Music South Pasadena in South Pasadena'",
);
ok(
  "a trailing branch suffix that is the town comes off the name",
  oneFinding({ name: "Wonderland 4 Kids - Pasadena", what: "indoor playspace", area: "Pasadena" })
    ?.name === "Wonderland 4 Kids",
);
ok(
  "but a trailing half that says what it is stays",
  oneFinding({ name: "Rose Bowl Aquatics - Parent & Me", what: "swim lessons", area: "Pasadena" })
    ?.name === "Rose Bowl Aquatics - Parent & Me",
);
ok(
  "a neighbouring town is not the same town",
  oneFinding({ name: "Pasadena Humane", what: "family events", area: "South Pasadena" })?.area ===
    "South Pasadena",
  "matched token-wise, or 'Pasadena' would count as carrying 'South Pasadena'",
);
ok(
  "a disagreement is left visible rather than guessed away",
  oneFinding({ name: "Swimphi Altadena", what: "swim lessons", area: "Pasadena" })?.area === "Pasadena",
  "this module has no list of the market's areas, so a town inside a name cannot be told from a brand word",
);

/**
 * The three words saying what it is, which the renderer silently dropped.
 *
 * `KIND_WORD` translates a `share_kind` and a public finding carries its own
 * words, so a miss used to render the area alone: eight of eight live public
 * lines read "Tinkergarten in South Pasadena" with the description thrown away
 * one function after it was validated and capped.
 */
{
  const composed = a.composeAnswer({
    has_question: true,
    candidates: [
      {
        name: "Tinkergarten",
        kind: "outdoor play classes",
        area: "south-pasadena",
        trust: { labels: [t.TRUST_LABEL.PUBLIC], freshness: "fresh", public_only: true },
        firsthand_count: 0,
      },
    ],
  });
  ok(
    "general information says what the thing is",
    composed.text.includes("outdoor play classes"),
    composed.text,
  );
  ok(
    "and a record's own kind is still translated, not printed raw",
    a
      .composeAnswer({
        has_question: true,
        candidates: [
          {
            name: "Little Maestros",
            kind: "activity",
            area: "south-pasadena",
            trust: { labels: [t.TRUST_LABEL.SHARED], freshness: "fresh", public_only: false },
            firsthand_count: 1,
          },
        ],
      })
      .text.includes("a class in South Pasadena"),
    "a parent asks about a class, never an 'activity' - the wording moved into the evidence sentence on 9 Sep; the translation itself did not change",
  );
}

console.log("\n=== 10 Sep: one name per record, and only where it was granted ===");
{
  /**
   * The client's per-recommendation toggle, at the end of its chain.
   *
   * `named_by` arrives already meaning *this parent said yes for this record*
   * — the SQL is where the permission and the flag are read, and it hands over
   * the lead contributor's name or null. What is checked here is the only
   * thing the composer decides: **where** the name goes, and that it never
   * goes in two places at once.
   */
  const named = (over: Partial<AnswerCandidate> = {}) =>
    parent({ named_by: "Janet", firsthand_count: 1, ...over });

  ok(
    "with no name granted, the evidence sentence counts parents as it always did",
    compose([parent({ firsthand_count: 1 })]).text.includes("One parent near you has used"),
  );
  ok(
    "a granted name replaces the count when they are the only parent",
    compose([named()]).text.includes("Janet has used Toddler Tunes"),
    compose([named()]).text,
  );
  ok(
    "and it attributes their own sentence when there is one",
    compose([named({ notes: { great: "The water is genuinely warm" } })]).text.includes(
      'Janet said: "The water is genuinely warm"',
    ),
    compose([named({ notes: { great: "The water is genuinely warm" } })]).text,
  );
  /* The rule that stops the answer reading like a testimonial: one record, one
     name, and the quote wins it. */
  const both = compose([named({ notes: { great: "The water is genuinely warm" } })]).text;
  ok(
    "never in both places on one record",
    both.split("Janet").length - 1 === 1,
    both,
  );
  ok(
    "and never in place of a count — three parents is the stronger claim",
    compose([named({ firsthand_count: 3 })]).text.includes("3 parents near you have used") &&
      !compose([named({ firsthand_count: 3 })]).text.includes("Janet"),
    "a permission is not a promise of appearance; the card says 'can', not 'will'",
  );
  ok(
    "an ungranted record with a quote reads 'They said' with one parent behind it, 'One said' with more (22 Oct)",
    compose([
      parent({ firsthand_count: 1, notes: { great: "Small groups" } }),
    ]).text.includes('They said: "Small groups"') &&
      compose([parent({ firsthand_count: 3, notes: { great: "Small groups" } })]).text.includes('One said: "Small groups"'),
  );
}

/**
 * ## 17 Sep — three faults the live probe found and reading could not
 *
 * Each is pinned on the pure half, which is where all three actually live.
 */
{
  /* The record the question names is exempt from the exclusion. Without it the
     9 Sep fix — exempt the *lead* — was defeated whenever retrieval led with
     something off-topic, and the public half of that answer vanished whole. */
  ok(
    "a question that names a record exempts it from the exclusion",
    pi.mentionsName("What locals tell about Tom Sawyer Camps?", "Tom Sawyer Camps"),
  );
  ok(
    "and a record it does not name stays excluded",
    !pi.mentionsName("any good toddler classes near South Pasadena?", "Tom Sawyer Camps"),
  );
  /* ⚠ The floor that keeps this from reinstating the fault it fixes: a
     one-word record would exempt itself out of any sentence containing that
     word, and the answer would then offer one place under two trust labels. */
  ok(
    "a one-word record cannot exempt itself",
    !pi.mentionsName("any good camps near Altadena?", "Camps"),
  );
  ok(
    "the words have to be together, and in order",
    !pi.mentionsName("Sawyer went to camps with Tom", "Tom Sawyer Camps"),
  );

  /* A detail that does not fit is dropped, never shortened — the prompt asks
     for ten words and this used to cut at sixty characters, so a compliant
     answer came back as "…art, music, and parent." */
  /* Past the budget, and the shape the model returns when it overruns the
     prompt's "under ten words". */
  /* Longer than the three-fact budget (170) since 22 Oct, which this one
     sentence (92) now fits. */
  const long =
    "Ages 0-3, includes open-ended play, art, music, and parent participation throughout the term; runs Monday to Friday mornings from 9 to noon all year; $25 a drop-in visit, with a covered outdoor garden";
  const withDetail = (detail: string) =>
    found(JSON.stringify({ findings: [{ name: "Big Little Mornings", what: "open play", area: null, detail }] }))[0];
  ok(
    "a detail past the budget is dropped rather than cut mid-phrase",
    withDetail(long)?.detail === null,
    String(withDetail(long)?.detail),
  );
  ok(
    "and a detail the prompt's own ten words fit is kept whole",
    withDetail("Ages 3 and up; sessions every Sunday; $60 each")?.detail ===
      "Ages 3 and up; sessions every Sunday; $60 each",
  );
  /* The finding survives either way: `detail` is optional by construction, so
     dropping it costs a clause and never the row. */
  ok("the finding itself survives a dropped detail", withDetail(long)?.name === "Big Little Mornings");

  /* "care" is a mass noun. `article` was written for the countable kinds and
     the care branch arrived later. */
  const care = compose([
    {
      ...parent({ firsthand_count: 1 }),
      name: "Elena V.",
      kind: "caregiver",
      care: "Full-time",
      area: "san-marino",
    },
  ]).text;
  ok("a caregiver line takes no article", care.includes("Elena V., full-time care in San Marino"), care.split("\n")[0]);
  ok(
    "and a countable kind still takes one",
    compose([parent({ area: "altadena" })]).text.includes(", a class in Altadena"),
    compose([parent({ area: "altadena" })]).text.split("\n")[0],
  );
}

console.log("\n=== the M5/M6 relay walk (25 Sep) ===");
{
  /* "About fair." went out: the hedge belongs to a price, never to an opinion. */
  const worthOnly = compose([parent({ worth: "fair" })]).text;
  ok("a worth with no price is not hedged", !/About fair/i.test(worthOnly), worthOnly);
  ok("and says what it is", worthOnly.includes("Value for money: fair."), worthOnly);
  const both = compose([parent({ price: "$50-100 a month", worth: "great value" })]).text;
  ok("a price keeps its About", both.includes("About $50-100 a month, great value."), both);
  /* The recorded walk caught a backspace byte where \b should have been, and
     "About Over $200 a camp week" went out. */
  const over = compose([parent({ price: "Over $200 a camp week" })]).text;
  ok("an Over band is not hedged twice", over.includes("Over $200 a camp week.") && !/About Over/.test(over), over);
  const free = compose([parent({ price: "Free" })]).text;
  ok("nor is Free", !/About Free/.test(free), free);

  /* A stale record one line down read exactly like a fresh one. */
  const stale = parent({ name: "Tom Sawyer Camps", rank: 1, trust: { labels: [t.TRUST_LABEL.VALIDATED], freshness: "stale", public_only: false } });
  const lead = parent({ name: "Kidspace summer camp", rank: 0 });
  const out = compose([lead, stale]).text;
  /* 22 Oct: the second place has a block of its own now, and its age travels with it. */
  ok("a stale second place says so", /Tom Sawyer Camps[^\n]*\nThis one is old/.test(out), out);
  const disputed = compose([lead, parent({ name: "AYSO soccer", rank: 1, withdrawn: 1 })]).text;
  ok("and a withdrawn one says it may no longer be worth it", /AYSO soccer[^\n]*\nOne parent recently said it may no longer be worth it/.test(disputed), disputed);

  /* 22 Oct, the developer: "short and not substantive — there used to be at least three places, now one". */
  const note = (name: string, rank: number, notes: Record<string, string>, firsthand = 2) =>
    parent({ name, rank, firsthand_count: firsthand, notes });
  const three = compose([
    note("Rose Bowl Aquatics", 0, { great: "The water is warm.", caveat: "Parking is hard on game days.", who_for: "First-timers.", tip: "Go early." }, 3),
    note("Waterworks Aquatics", 1, { great: "Tiny classes." }),
    note("Pasadena YMCA", 2, { who_for: "Families on a budget." }, 1),
  ]).text;
  ok("a second and third place each carry a parent's sentence, not a directory line", three.includes('One said: "Tiny classes."') && three.includes("Best for: families on a budget.") && !three.includes("Also nearby"), three);
  ok("with others waiting the lead keeps two notes - what a parent said and the heads-up", three.includes('One said: "The water is warm."') && three.includes("Heads up: Parking is hard on game days.") && !/first-timers/i.test(three) && !/go early/i.test(three), three);
  const alone = compose([note("Rose Bowl Aquatics", 0, { great: "The water is warm.", caveat: "Parking is hard on game days.", who_for: "First-timers.", tip: "Go early." }, 3)]).text;
  ok("alone, the lead keeps every note", /first-timers/i.test(alone) && /go early/i.test(alone), alone);

  /* 22 Oct: "a bit too little from the public web search" — up to three facts a place, cut whole. */
  ok("a page's facts are cut to whole facts, never mid-fact", a.wholeFacts("Ages 2 to 4; Mon-Fri 7am-6pm; small classes", 30) === "Ages 2 to 4; Mon-Fri 7am-6pm" && a.wholeFacts("Ages 2 to 4; Mon-Fri 7am-6pm", 200) === "Ages 2 to 4; Mon-Fri 7am-6pm" && a.wholeFacts("A very long single fact that does not fit", 10) === null);
  const pubRich = publicRecord({ name: "Firehouse School", detail: "Ages 2 to 4; Monday to Friday 7am to 6pm; $1,200 a month; small class sizes and an outdoor yard; a garden, a library corner and weekly music with a visiting teacher" });
  const many = compose([note("Rose Bowl Aquatics", 0, { great: "Warm." }, 3), note("Waterworks", 1, { great: "Tiny classes." }), pubRich]).text;
  ok("with several parents' places, a public line keeps the facts that fit", many.includes("Ages 2 to 4, Monday to Friday 7am to 6pm, $1,200 a month and small class sizes and an outdoor yard.") && !many.includes("library corner"), many);
  const few = compose([note("Rose Bowl Aquatics", 0, { great: "Warm." }, 3), pubRich]).text;
  ok("with one, it keeps them all", few.includes("small class sizes and an outdoor yard and a garden, a library corner and weekly music with a visiting teacher."), few);
  const fresh = compose([lead, parent({ name: "AYSO soccer", rank: 1 })]).text;
  ok("a fresh one carries no age at all", !/out of date|questioned/.test(fresh), fresh);

  /* The named record leads because inbound gives it rank -1. */
  const named = a.rankForAnswer([lead, { ...stale, rank: -1 }]);
  ok("a record ranked -1 (named in the question) leads", named[0].name === "Tom Sawyer Camps");
}

console.log("\n=== 22 Oct review: ordinary answers ===");
{
  const v = (await import(`../lib/answer-voice.ts?v=${Date.now()}`)) as typeof import("../lib/answer-voice.ts");
  const pubT = { labels: [t.TRUST_LABEL.PUBLIC], freshness: "fresh" as const, public_only: true };
  const web = (name: string, kind: string, detail: string | null, area: string | null = "pasadena"): AnswerCandidate => ({
    name, kind, area, detail, trust: pubT, firsthand_count: 0,
  });

  /* (2) A rewrite may not move a fact from the public block or another record. */
  const cands: AnswerCandidate[] = [
    parent({ name: "Tiny Tots Gym", area: "altadena", price: "$100-200 a term", rank: 0, last_confirmed: "2026-09-10T12:00:00Z", notes: { who_for: "toddlers who climb everything", caveat: "Saturday classes fill fast" } }),
    parent({ name: "Waterworks Aquatics", area: "pasadena", firsthand_count: 1, rank: 1, trust: { labels: [t.TRUST_LABEL.SHARED], freshness: "fresh", public_only: false } }),
    web("Kidspace Museum", "children's museum", "Ages 1 to 10; indoor heated pool"),
  ];
  const draft = compose(cands, { headroom: a.VOICE_HEADROOM }).text;
  const pubBlock = draft.slice(draft.indexOf(t.TRUST_LABEL.PUBLIC));
  /* What `voiceInputFor` builds for this draft (it is server-only, so not loadable here): a
     record's price and date are keep-items of its own span (22 Oct). */
  const input = (priceKeep: boolean) => ({
    draft,
    question: "toddler classes near altadena?",
    parents: [
      { name: "Tiny Tots Gym", evidence: "2 parents near you", keep: ["Saturday classes fill fast", "toddlers who climb everything", ...(priceKeep ? ["$100-200", "last confirmed Sep 2026"] : [])], tokens: [] },
      { name: "Waterworks Aquatics", evidence: "One parent near you", keep: [], tokens: [] },
    ],
    publicNames: ["Kidspace Museum"],
    mustKeep: pubBlock.split("\n").filter((l) => l.trim()),
    mustContain: ["$100-200", "last confirmed Sep 2026"],
    max: a.SMS_BUDGET,
  });
  const good = `Toddler classes around Altadena - here you go.\n2 parents near you have used Tiny Tots Gym, a class in Altadena, last confirmed Sep 2026 - it suits toddlers who climb everything, but Saturday classes fill fast, so book early. About $100-200 a term.\nOne parent near you has used Waterworks Aquatics, a class in Pasadena.\n\n${pubBlock}`;
  ok("voice: a rewrite that keeps every fact with its record is accepted", v.acceptVoice(good, input(true)) !== null, draft);
  const pageFacts = good.replace("a class in Altadena,", "a class in Altadena for ages 1 to 10 with an indoor heated pool,");
  ok("voice: the public page's facts given to a parent's record are refused (safety review)", v.acceptVoice(pageFacts, input(true)) === null && v.acceptVoice(pageFacts, input(false)) === null);
  const movedPrice = good.replace(" About $100-200 a term.", "").replace("a class in Pasadena.", "a class in Pasadena, about $100-200 a term.");
  ok("voice: one record's price moved onto another is refused, by its keep-item", v.acceptVoice(movedPrice, input(true)) === null);
  ok("voice: and by the span rule alone, without the keep-item", v.acceptVoice(movedPrice, input(false)) === null);
  ok("voice: a dropped 'last confirmed' date is refused", v.acceptVoice(good.replace(", last confirmed Sep 2026", ""), input(true)) === null);
  /* 26 Oct, the SMS lab: "a gentle start ... with a little one" for a question that said neither. */
  ok("voice: the child described in words nobody said is refused", v.acceptVoice(good.replace("Toddler classes around Altadena - here you go.", "A gentle start for your little one around Altadena - here you go."), input(true)) === null);
  ok("voice: the child described in the question's or draft's own words is fine", v.acceptVoice(good.replace("Toddler classes around Altadena - here you go.", "Classes for toddlers around Altadena - here you go."), input(true)) !== null);

  /* (3) With one parent place, the parent's words never give way to the web's facts. */
  const priya = parent({ name: "Jump Junction Party Barn", kind: "place", kind_word: "party service", area: "san-marino", firsthand_count: 1, named_by: "Priya", price: "Over $200", worth: "pricey but worth it", notes: { great: "They ran the whole thing, I did not lift a finger." }, trust: { labels: [t.TRUST_LABEL.SHARED], freshness: "stale", public_only: false } });
  const long = "Package from $99.99 covers 6 kids, $19.99 per additional kid; no guest cap at all on weekends; aimed at ages 3 to 8 years old; party host, invitations and a goody bag for every child are included in the price";
  const party = compose([
    priya,
    web("Chuck E. Cheese Pasadena birthday parties", "arcade birthday party package", long),
    web("Kidspace Children's Museum birthday parties", "museum birthday party space", "Space reserved for two hours; all-day admission included for 20, 50, or 100 guests; parties offered Fridays, Saturdays, and Sundays"),
    web("Lucky Strike Pasadena kids parties", "bowling kids party package", "Kids parties for ages 5 and up; 1.5 hours of bowling, cheese pizza, and soft drinks for kids 12 and under; online booking for 1-25 guests; shoe rental included and a private lane host"),
    /* A fourth line since 26 Oct: four web lines at eight segments still crowd her sentence. */
    web("Pump It Up Arcadia birthday parties", "inflatable party arena", "Private arena for two hours; ages 2 to 12; up to 30 kids; pizza and juice packages; a dedicated party host and a party room for cake and presents afterwards"),
  ], { headroom: a.VOICE_HEADROOM }).text;
  ok("one parent place: her own sentence stays when the web's facts would push it out", party.includes('Priya said: "They ran the whole thing, I did not lift a finger."'), party);
  ok("by cutting the web's facts whole first", party.includes("aimed at ages 3 to 8 years old") && !party.includes("goody bag"), party);
  ok("and the web keeps at least one line beside it", party.includes(t.TRUST_LABEL.PUBLIC) && party.includes("Chuck E. Cheese"), party);

  /* (4) Which note goes out follows the question. */
  const acorn = parent({ name: "Acorn Hill Nature Preschool", rank: 0, notes: { great: "Lots of outdoor time and a slow, gentle start to each morning.", who_for: "Quieter kids who need time to warm up.", caveat: "The waitlist opens in January and fills within weeks." } });
  const maple = parent({ name: "Maple Room Cooperative", rank: 1, notes: { great: "The teachers are kind." } });
  const shy = compose([acorn, maple], { question: "looking for a preschool for my shy 4 year old near Altadena, somewhere gentle" }).text;
  ok("a shy child's question keeps 'who it suits: quieter kids'", shy.includes("Best for: quieter kids who need time to warm up."), shy);
  const noQ = compose([acorn, maple]).text;
  ok("without a question the fixed order holds (quote and heads-up)", !noQ.includes("quieter kids") && noQ.includes("Heads up: The waitlist"), noQ);
  const arroyo = parent({ name: "Arroyo Explorers Day Camp", rank: 0, notes: { great: "Hands-on science every day, my daughter came home buzzing.", caveat: "Weeks sell out by April.", tip: "The extended care to 6pm has to be booked separately." } });
  const work = compose([arroyo, maple], { question: "I work full time - what summer day camps in July would suit my 7 year old?" }).text;
  ok("a working parent's question keeps the extended-care tip", work.includes("One tip: the extended care to 6pm has to be booked separately."), work);
  const second = compose([parent({ name: "Sunny Day", rank: 0 }), parent({ name: "Little Wren", rank: 1, notes: { great: "Lovely garden.", who_for: "Kids who are shy at first." } })], { question: "a preschool for a shy 3 year old?" }).text;
  ok("a second place's one sentence follows the question too", second.includes("Best for: kids who are shy at first.") && !second.includes("Lovely garden"), second);

  /* (5) A web line reads as a sentence, and a name cut inside a parenthesis is not printed half. */
  const lines = compose([
    parent({ name: "Rose Bowl Aquatics", rank: 0 }),
    parent({ name: "Little Otters", rank: 1 }),
    web("British Swim School of East Pasadena (LA Fitness - Hastings", "toddler water survival classes", "Indoor heated pool; 4:1 ratio for toddler classes", null),
    web("Waterworks Aquatics Pasadena - Parent & Me", "parent and toddler swim classes", "Ages 3 to 36 months; 20-minute lessons; one parent permitted in the water", null),
  ]).text;
  ok("an unclosed parenthesis in a web name loses it whole", lines.includes("British Swim School of East Pasadena, toddler water survival classes: Indoor heated pool and 4:1 ratio for toddler classes.") && !lines.includes("(LA Fitness"), lines);
  ok("'Name, what: a, b and c.' - no stacked dashes, no '; '", lines.includes("Waterworks Aquatics Pasadena - Parent & Me, parent and toddler swim classes: Ages 3 to 36 months, 20-minute lessons and one parent permitted in the water.") && !/; /.test(lines.slice(lines.indexOf(t.TRUST_LABEL.PUBLIC))), lines);

  /* (6) A web-only answer says its label once. */
  const webOnly = compose([web("Hangar 18", "indoor climbing gym", "Kid-friendly; top-rope and bouldering", "arcadia"), web("Sender One", "climbing gym", "Youth classes from age 6", "glendale")]).text;
  ok("web-only: the verbatim label once, in the head", webOnly.startsWith(`Here's what I found. ${t.TRUST_LABEL.PUBLIC}:\n`) && webOnly.split(t.TRUST_LABEL.PUBLIC).length === 2 && !webOnly.includes("All of these"), webOnly);

  /* (7) Small copy. */
  ok("worth alone that names the value is its own sentence", compose([parent({ worth: "great value" })]).text.includes("\nGreat value.") && !compose([parent({ worth: "great value" })]).text.includes("Value for money: great value"));
  ok("a doctors-card record named as an office is a practice", compose([parent({ name: "Brightside Kids Dental", kind: "place", kind_word: "doctor", area: "south-pasadena" })]).text.includes("Brightside Kids Dental, a practice in South Pasadena"));
  ok("and one named after a person is still a doctor (21 Oct row)", compose([parent({ name: "Dr. Sarah Kim", kind: "place", kind_word: "doctor", area: "pasadena" })]).text.includes("Dr. Sarah Kim, a doctor in Pasadena"));
}

console.log("\n=== 26 Oct review: the rewrite check and the composer's room ===");
{
  const v = (await import(`../lib/answer-voice.ts?v=${Date.now()}`)) as typeof import("../lib/answer-voice.ts");
  /* The server passes these (`voiceInputFor`); the same strings, from the one file that holds them. */
  const labels = [...Object.values(t.TRUST_LABEL), "Recommended by a local parent"].filter((l) => l !== t.TRUST_LABEL.PUBLIC);
  const pubT = { labels: [t.TRUST_LABEL.PUBLIC], freshness: "fresh" as const, public_only: true };
  const q = "toddler classes?";
  const read = (draft: string, candidates: AnswerCandidate[]) => v.readVoiceInput({ draft, question: q, candidates, max: a.SMS_BUDGET, labels });
  const bodyOf = (text: string) => text.replace(/\nWant me to ask a few nearby parents for more\?$/, "");

  /* (1) A record parents only shared secondhand (count 0) is a parent record. */
  const tiny = parent({ name: "Tiny Tots Gym", area: "altadena", rank: 0, notes: { caveat: "Saturday classes fill fast" }, trust: { labels: [t.TRUST_LABEL.VALIDATED, t.TRUST_LABEL.REFERENCE_AVAILABLE], freshness: "fresh", public_only: false } });
  const water = parent({ name: "Waterworks", area: "pasadena", firsthand_count: 0, rank: 1, notes: { caveat: "The pool is cold in winter" }, trust: { labels: [t.TRUST_LABEL.SHARED], freshness: "fresh", public_only: false } });
  const otters = parent({ name: "Little Otters", area: "pasadena", firsthand_count: 1, rank: 2, trust: { labels: [t.TRUST_LABEL.SHARED], freshness: "fresh", public_only: false } });
  const kidspace: AnswerCandidate = { name: "Kidspace Museum", kind: "children's museum", area: "pasadena", detail: "Ages 1 to 10", trust: pubT, firsthand_count: 0 };
  const cands = [tiny, water, otters, kidspace];
  const draft = bodyOf(compose(cands, { headroom: a.VOICE_HEADROOM, question: q }).text);
  const input = read(draft, cands);
  ok("voice 26 Oct: a count-0 parent record is a parent record, with its own evidence and notes", input.parents.some((r) => r.name === "Waterworks" && r.evidence === "A local parent has shared" && r.keep.includes("The pool is cold in winter")) && !input.publicNames.includes("Waterworks"), JSON.stringify(input.parents));
  ok("voice 26 Oct: the unchanged draft is accepted", v.acceptVoice(draft, input) !== null, draft);
  const warm = draft
    .replace("2 parents near you have used Tiny Tots Gym, a class in Altadena.\nHeads up: Saturday classes fill fast", "Toddler classes, here you go.\n2 parents near you have used Tiny Tots Gym in Altadena, but Saturday classes fill fast, so book early.")
    .replace("A local parent has shared Waterworks, a class in Pasadena.\nHeads up: The pool is cold in winter", "A local parent has shared Waterworks in Pasadena - just know the pool is cold in winter.");
  ok("voice 26 Oct: a warm rewrite that keeps each fact home is accepted", v.acceptVoice(warm, input) !== null, warm);
  const swapped = warm.replace("Saturday classes fill fast, so", "the pool is cold in winter, so").replace("the pool is cold in winter.", "Saturday classes fill fast.");
  ok("voice 26 Oct: two places' heads-ups swapped are refused", v.acceptVoice(swapped, input) === null, swapped);
  ok("voice 26 Oct: a count-0 place's heads-up reworded is refused", v.acceptVoice(warm.replace("the pool is cold in winter", "the water runs chilly in winter"), input) === null);
  ok("voice 26 Oct: its evidence dropped ('And Waterworks…') is refused", v.acceptVoice(warm.replace("A local parent has shared Waterworks", "And Waterworks"), input) === null);

  /* (3) The evidence keeps its verb; a label line stays under its own place. */
  ok("voice 26 Oct: the evidence clause is a keep-item, verb included", input.parents[0].evidence === "2 parents near you have used", String(input.parents[0].evidence));
  for (const verb of ["skipped", "stopped going to", "asked about"]) {
    ok(`voice 26 Oct: '2 parents near you ${verb} Tiny Tots Gym' is refused`, v.acceptVoice(warm.replace("2 parents near you have used Tiny Tots Gym", `2 parents near you ${verb} Tiny Tots Gym`), input) === null);
  }
  ok("voice 26 Oct: '…have used it' after the name is still the clause", v.acceptVoice(warm.replace("2 parents near you have used Tiny Tots Gym in Altadena,", "Tiny Tots Gym in Altadena - 2 parents near you have used it,"), input) !== null);
  ok("voice 26 Oct: the clause then another verb is refused", v.acceptVoice(warm.replace("2 parents near you have used Tiny Tots Gym", "2 parents near you have used and quit Tiny Tots Gym"), input) === null);
  ok("voice 26 Oct: a trust label line is that record's keep-item", input.parents[0].keep.includes("Reference available.") && !input.parents[1].keep.includes("Reference available."), JSON.stringify(input.parents.map((r) => r.keep)));
  const movedLabel = warm.replace("\nReference available.", "").replace("cold in winter.", "cold in winter.\nReference available.");
  ok("voice 26 Oct: a label moved from Tiny Tots Gym to Waterworks is refused (invariants 3, 4)", v.acceptVoice(movedLabel, input) === null, movedLabel);

  /* An "Also nearby" count may be followed only by punctuation or having been there. */
  const alsoDraft = "2 parents near you have used Tiny Tots Gym, a class in Altadena.\nAlso nearby: My Gym Pasadena, a class in Pasadena, 1 parent.";
  const myGym = parent({ name: "My Gym Pasadena", area: "pasadena", firsthand_count: 1, rank: 1 });
  const alsoIn = read(alsoDraft, [parent({ name: "Tiny Tots Gym", rank: 0 }), myGym]);
  const alsoWarm = "Toddler classes, here you go.\n2 parents near you have used Tiny Tots Gym in Altadena.\nAlso nearby: My Gym Pasadena in Pasadena - 1 parent has used it.";
  ok("voice 26 Oct: 'Also nearby … 1 parent has used it' is accepted", alsoIn.parents[1]?.evidence === "1 parent" && v.acceptVoice(alsoWarm, alsoIn) !== null, JSON.stringify(alsoIn.parents));
  ok("voice 26 Oct: '1 parent skipped it' is refused", v.acceptVoice(alsoWarm.replace("1 parent has used it", "1 parent skipped it"), alsoIn) === null);

  /* (2) A parent's place never gives way to a web line beyond the first. */
  const longWeb = (i: number, len: number): AnswerCandidate => ({ name: `Swim Spot ${i}`, kind: "swim school", area: "pasadena", firsthand_count: 0, detail: `Ages 1 to 5 with small groups; ${"x".repeat(len)}`.slice(0, len), trust: pubT });
  const bareLead = parent({ name: "Tiny Tots Gym", area: "altadena", rank: 0 });
  const aOut = compose([bareLead, longWeb(1, 220), longWeb(2, 220), longWeb(3, 220), longWeb(4, 220)]);
  ok("26 Oct (a): a lead with no notes is not pushed out by four long web lines", aOut.parent_used === 1 && aOut.text.startsWith("2 parents near you have used Tiny Tots Gym") && aOut.text.includes(t.TRUST_LABEL.PUBLIC), aOut.text);
  const quoted = (name: string, rank: number, great: string) => parent({ name, area: "altadena", rank, notes: { great } });
  const bOut = compose([
    quoted("Alpha Gym", 0, "The coaches are patient and the room is calm, my son loved the warm-up songs every week."),
    quoted("Beta Swim", 1, "Small classes with the same teacher every week, so the kids settle in quickly."),
    quoted("Gamma Art", 2, "They let toddlers make a real mess and the cleanup is part of the fun for everyone."),
    ...[1, 2, 3, 4, 5].map((i): AnswerCandidate => ({ ...longWeb(i, 10), detail: "Ages 1 to 5 with small groups; heated indoor pool open all year; parent and child classes on weekends; a free trial lesson for new families" })),
  ], { headroom: 90 });
  const webLines = bOut.text.slice(bOut.text.indexOf(t.TRUST_LABEL.PUBLIC)).split("\n").filter((l) => l.startsWith("Swim Spot")).length;
  ok("26 Oct (b): three parents' places all appear, web lines cut first", bOut.parent_used === 3 && ["Alpha Gym", "Beta Swim", "Gamma Art"].every((n) => bOut.text.includes(n)) && webLines >= 1 && webLines < 5, bOut.text);
  ok("26 Oct (b): within the budget", bOut.text.length <= a.SMS_BUDGET - 90, String(bOut.text.length));

  /* (4) The fallback cuts whole words and prints no "All of these" over one record. */
  const ref = (name: string, rank: number) => parent({ name, rank, notes: { great: "A parent sentence that is long enough to matter here." }, trust: { labels: [t.TRUST_LABEL.VALIDATED, t.TRUST_LABEL.REFERENCE_AVAILABLE], freshness: "fresh", public_only: false } });
  const tight = compose([ref("Alpha Gym With A Rather Long Name", 0), ref("Beta Swim With Another Long Name", 1)], { headroom: a.SMS_BUDGET - 68 }).text; /* 850 of 918 until the 26 Oct budget */
  const first = tight.split("\n")[0];
  ok("26 Oct (4): nothing fits - the one record is cut at a word, never inside one", first.endsWith("...") && !/\s\.\.\.$/.test(first) && "2 parents near you have used Alpha Gym With A Rather Long Name, a class".startsWith(first.replace(/\.\.\.$/, "")), JSON.stringify(tight));
  ok("26 Oct (4): and no parent's sentence is cut", !tight.includes("A parent sentence") || tight.includes('"A parent sentence that is long enough to matter here."'));
  ok("26 Oct (4): no 'All of these' over the single record shown", !tight.includes("All of these"), JSON.stringify(tight));
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
