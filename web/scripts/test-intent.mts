import type { IntentContext } from "../lib/intent.ts";

/**
 * M5.3 — intent classification, the half that needs no model.
 *
 * The deterministic fallback is what runs when the model is unconfigured, unsure
 * or declined — three situations that all end with a parent waiting for a reply.
 * So it is tested as the primary path, not as an edge case.
 *
 * The two rules that matter most are both about **not guessing**: context beats
 * the words, and an unreadable message from a stranger goes to a person rather
 * than being filed as small talk.
 */

const m = (await import(`../lib/intent.ts?v=${Date.now()}`)) as typeof import("../lib/intent.ts");

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

const ctx = (over: Partial<IntentContext> = {}): IntentContext => ({
  awaiting_blast_reply: false,
  known_person: true,
  ...over,
});
const guess = (text: string, over: Partial<IntentContext> = {}) =>
  m.fallbackIntent(text, ctx(over));

console.log("\n=== context beats the words, always ===");
ok(
  "somebody Pando is waiting on is answering",
  guess("the 9am one", { awaiting_blast_reply: true }).intent === "answer_blast",
);
ok(
  "even when the reply reads like a question",
  guess("the 9am or the 10:30?", { awaiting_blast_reply: true }).intent === "answer_blast",
  '"the 9am or the 10:30?" is a perfectly ordinary way to answer',
);
ok(
  "even when it mentions a nanny",
  guess("our nanny took him there", { awaiting_blast_reply: true }).intent === "answer_blast",
);
ok(
  "and the source says it came from the records, not the words",
  guess("anything", { awaiting_blast_reply: true }).source === "context",
);

console.log("\n=== what the shape can honestly tell ===");
ok("a nanny question", guess("does anyone know a good nanny?").intent === "ask_caregiver");
ok("a sitter question", guess("looking for a babysitter for Friday").intent === "ask_caregiver");
ok("a night nurse", guess("night nurse recommendations?").intent === "ask_caregiver");
ok(
  "caregiver beats the generic question shape",
  guess("any good nanny agencies?").intent === "ask_caregiver",
  "the more specific reading wins",
);
ok("an ordinary recommendation", guess("any good music classes near Altadena?").intent === "ask_recommendation");
ok('"anyone know" without a question mark', guess("anyone know a swim teacher").intent === "ask_caregiver" || guess("anyone know a swim teacher").intent === "ask_recommendation");
ok("changing how often", guess("too many texts, can you send fewer").intent === "settings");
ok("stop asking is a setting, not an opt-out here", guess("please stop asking about camps").intent === "settings",
   "a real STOP never reaches this function — the webhook handles it first");

console.log("\n=== not guessing is a real answer ===");
ok(
  "an unreadable message from a stranger goes to a person",
  guess("hm", { known_person: false }).intent === "unclear",
);
ok(
  "and carries no confidence at all",
  guess("hm", { known_person: false }).confidence === 0,
);
ok(
  "a short pleasantry from somebody Pando knows is chitchat",
  guess("thanks!").intent === "chitchat",
);
ok(
  "but the same words from a stranger are not assumed",
  guess("thanks!", { known_person: false }).intent === "chitchat" ||
    guess("thanks!", { known_person: false }).intent === "unclear",
);
ok(
  "unclear and chitchat are different answers",
  m.INTENTS.includes("unclear") && m.INTENTS.includes("chitchat"),
  "collapsing them would make every failure look like small talk and drop questions on the floor",
);

console.log("\n=== the threshold ===");
const model = (intent: string, confidence: number) => ({ intent, confidence, reason: "r" });
ok(
  "the floor is the same 0.6 the extraction pass and the admin filter use",
  m.INTENT_CONFIDENCE_FLOOR === 0.6,
);
ok(
  "a confident model answer is used",
  m.applyThreshold(model("ask_caregiver", 0.9), "x", ctx()).intent === "ask_caregiver",
);
ok(
  "and is marked as the model's",
  m.applyThreshold(model("ask_caregiver", 0.9), "x", ctx()).source === "model",
);
ok(
  "below the floor falls back",
  m.applyThreshold(model("ask_caregiver", 0.4), "any good music classes?", ctx()).source ===
    "fallback",
);
ok(
  "exactly at the floor is used",
  m.applyThreshold(model("chitchat", 0.6), "x", ctx()).source === "model",
);
ok(
  "an intent the model invented falls back",
  m.applyThreshold(model("book_a_table", 0.99), "any good music classes?", ctx()).intent ===
    "ask_recommendation",
  "a high score on a value that does not exist is still nonsense",
);
ok(
  "no model answer at all falls back",
  m.applyThreshold(null, "any good nanny?", ctx()).intent === "ask_caregiver",
);
ok(
  "and context still wins over a confident model",
  m.applyThreshold(model("ask_recommendation", 0.99), "the 9am", ctx({ awaiting_blast_reply: true }))
    .intent === "answer_blast",
  "the records can see what the words cannot",
);

console.log("\n=== every reading says where it came from ===");
for (const [label, r] of [
  ["context", m.applyThreshold(null, "x", ctx({ awaiting_blast_reply: true }))],
  ["model", m.applyThreshold(model("chitchat", 0.9), "x", ctx())],
  ["fallback", m.applyThreshold(null, "hm", ctx({ known_person: false }))],
] as const) {
  ok(`${label} is labelled as such`, r.source === label, `got ${r.source}`);
  ok(`${label} carries a reason`, r.reason.length > 0);
}

const d = (await import(`../lib/demand.ts?v=${Date.now()}`)) as typeof import("../lib/demand.ts");
console.log("\n=== the model can raise the sensitivity, never lower it ===");
/* Added with `PILOT_HOLD_EVERYTHING` coming off (8 Sep): the keyword net was a
   safety net *under a category tap*, and over SMS it runs alone. */
const esc = d.escalateSensitivity;
ok(
  "an ordinary reading is lifted when the model says sensitive",
  esc("ordinary", true) === "high_stakes",
);
ok("and left alone when it does not", esc("ordinary", false) === "ordinary");
ok(
  "peer support is never quietly upgraded past its own class",
  esc("peer_support", true) === "peer_support",
  "each class is owed something different; a boolean has not said which",
);
ok(
  "and an allegation is never invented from a boolean",
  esc("ordinary", true) !== "named_allegation",
  "that class carries a storage rule of its own — never circulated, review only",
);
ok(
  "nothing is ever lowered",
  (["ordinary", "peer_support", "high_stakes", "named_allegation"] as const).every(
    (s) => esc(s, false) === s && esc(s, true) !== "ordinary" || s === "ordinary",
  ),
);

ok(
  "a low-confidence reading is dropped and its caution is not",
  m.applyThreshold(
    { intent: "ask_recommendation", confidence: 0.35, reason: "unsure", sensitive: true },
    "my 4 year old keeps having nosebleeds, is that normal?",
    { awaiting_blast_reply: false, known_person: false },
  ).sensitive === true,
  "measured: that message really does come back sensitive at 0.35, and the floor is about which intent it is, not whether a child is ill",
);
ok(
  "and the intent itself still falls back",
  m.applyThreshold(
    { intent: "chitchat", confidence: 0.2, reason: "unsure", sensitive: true },
    "any good camps near Altadena?",
    { awaiting_blast_reply: false, known_person: false },
  ).source === "fallback",
);
ok(
  "a confident reading that is not sensitive stays that way",
  m.applyThreshold(
    { intent: "ask_recommendation", confidence: 0.95, reason: "clear", sensitive: false },
    "any good camps near Altadena?",
    { awaiting_blast_reply: false, known_person: false },
  ).sensitive === false,
);

console.log("\n=== what an SMS reads as, with no category tap behind it ===");
/* Over SMS there is no tap, so `classifyDemand` runs on the words alone — and
   since 8 Sep, with the blanket hold off, it is one of only two things between
   a health question and an unread automatic answer. Every one of these was
   measured against the real classifier before being written down; the first
   two are the ones it got wrong. */
for (const [text, want] of [
  ["my 4 year old keeps having nosebleeds, is that normal?", "high_stakes"],
  ["is it legal to leave a 9 year old home alone?", "high_stakes"],
  ["she has had a fever for three days", "high_stakes"],
  ["he keeps vomiting after dairy, any allergies clinic?", "high_stakes"],
  ["my son was diagnosed with asthma, any swim classes that suit?", "high_stakes"],
  ["he has had seizures before, is swimming safe?", "high_stakes"],
  ["feeling really isolated since we moved", "peer_support"],
  ["the school has a lovely courtyard for pickup", "ordinary"],
  ["best legal-sized soccer field for 8 year olds?", "ordinary"],
  ["any classes near the courthouse?", "ordinary"],
  ["any good pediatricians near me?", "ordinary"],
  ["looking for a dentist who is good with kids", "ordinary"],
  ["any good toddler classes near South Pasadena?", "ordinary"],
  ["best summer camps in Altadena?", "ordinary"],
  ["where can I take a 3 year old on a rainy day?", "ordinary"],
  ["looking for a nanny share in Altadena", "ordinary"],
  ["our nanny stole from us", "named_allegation"],
  ["the teacher yelled at my son", "named_allegation"],
] as const) {
  ok(
    `${want} — ${text.slice(0, 46)}`,
    d.classifyDemand(text, null) === want,
    `got ${d.classifyDemand(text, null)}`,
  );
}
ok(
  "a plural still matches its singular",
  d.classifyDemand("she gets nosebleeds", null) === "high_stakes" &&
    d.classifyDemand("he has had seizures", null) === "high_stakes",
  "the list is nouns and parents write plurals — it matched whole words only until 8 Sep",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
