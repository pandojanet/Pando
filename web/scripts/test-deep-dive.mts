/**
 * Deep Dive (21 Oct) — the triggers, the distance estimate, the check on every
 * sentence the model writes, the report's fixed structure, and the warm rewrite
 * of ordinary answers.
 *
 * Most of what follows asserts a **refusal**: neither the report nor the
 * rewrite has a reviewer, so the only thing standing between a model's sentence
 * and a parent is `proseVerdict` / `acceptVoice`, and a check that only proves
 * the happy path would pass while a made-up price went out. Several cases are
 * the adversarial review's own scenarios (21 Oct), pinned so they stay closed.
 */

import fs from "node:fs";
const d = (await import(`../lib/deep-dive.ts?v=${Date.now()}`)) as typeof import("../lib/deep-dive");
const v = (await import(`../lib/answer-voice.ts?v=${Date.now()}`)) as typeof import("../lib/answer-voice");

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

console.log("\n=== the fast path: 'deep dive' by name; every other way is the classifier's deep_dive (26 Oct) ===");
for (const t of ["I want a deep dive", "deep dive on preschools near us", "Can you do a deep-dive into summer camps?"]) {
  ok(`"${t}" asks for one`, d.asksForDeepDive(t));
}
/* The lab walk, 26 Oct: these are requests, and they are read by the model
   (test:intent pins the deep_dive reading) — not by a growing phrase list. */
for (const t of [
  "any good swim classes for a 3 year old?",
  "is the deep end heated?",
  "how deep is the pool?",
  "can you give me a full breakdown of costs",
  "what's a deep dive?",
  "I want to make a deep research against these top 5 schools",
  "I want to make comparison for these top 3 swim schools for my child",
  "DEEP",
]) {
  ok(`"${t}" is not the fast path`, !d.asksForDeepDive(t));
}
const topics: Array<[string, string | null]> = [
  ["I want a deep dive on preschools near us", "preschools near us"],
  ["I want a deep dive", null],
  ["deep dive: swim classes for a 3 year old", "swim classes for a 3 year old"],
  ["Can you do a deep dive into summer camps?", "summer camps"],
  ["deep dive on camps", "camps"],
  ["deep-dive on preschools", "preschools"],
  /* Pointing back at what was just sent: the last question is the subject. */
  ["deep dive on these top 5", null],
  ["can you do a deep dive comparing them", null],
];
for (const [t, want] of topics) {
  const got = d.deepDiveTopic(t);
  ok(`topic of "${t}" -> ${want}`, got === want, `got ${got}`);
}

console.log("\n=== the proactive trigger, and the clear yes ===");
ok("'top 5 preschools in Pasadena' has grown deep", d.deepDiveWorthOffering("give me the top 5 preschools in Pasadena"));
ok("'which one should we pick' has", d.deepDiveWorthOffering("which one should we pick for a shy 4 year old"));
ok("'a full breakdown' is an offer, not a start", d.deepDiveWorthOffering("can you give me a full breakdown of camps"));
ok("asking for more has", d.deepDiveWorthOffering("swim classes", { more: true }));
ok("an ordinary question has not", !d.deepDiveWorthOffering("any swim classes near Altadena?"));
for (const t of ["DEEP", "deep dive", "Yes deep", "deep please", "Deep."]) ok(`"${t}" accepts`, d.acceptsDeepDive(t));
for (const t of ["yes", "deep end", "no", "what's a deep dive?"]) ok(`"${t}" is not the DEEP word`, !d.acceptsDeepDive(t));
for (const t of ["yes", "Sure!", "ok", "yes please"]) ok(`"${t}" is a plain yes`, d.plainYes(t));
ok("'yes but later' is not", !d.plainYes("yes but later"));
ok("the offer says nothing about money (22 Oct)", !/free|paid|pay|price|cost|[$]/i.test(d.DEEP_DIVE_OFFER));
ok("and says what to reply", /Reply DEEP\.$/.test(d.DEEP_DIVE_OFFER));
const started = d.deepDiveStarted("preschools near us");
ok("the start says it is on its way", started.includes("Your deep dive is on its way"));
ok("the offer is one segment", d.DEEP_DIVE_OFFER.length <= 160, String(d.DEEP_DIVE_OFFER.length));
ok("and so is the start", started.length <= 160, String(started.length));
ok("nor does the start", !/free|paid|pay|price|cost|[$]/i.test(started));
ok("a topic with an emoji cannot break GSM-7", !/[^\x20-\x7E]/.test(d.deepDiveStarted("camps \u{1F600} for July")));
for (const [name, copy] of Object.entries({ OFFER: d.DEEP_DIVE_OFFER, STARTED: started, ASK: d.DEEP_DIVE_ASK_TOPIC, FAILED: d.DEEP_DIVE_FAILED, UNSUPPORTED: d.DEEP_DIVE_UNSUPPORTED })) {
  ok(`${name} is plain GSM-7`, !/[^\x20-\x7E]/.test(copy));
}

console.log("\n=== distance, estimated ===");
const pasadena = { lat: 34.1478, lng: -118.1445 };
const altadena = { lat: 34.1897, lng: -118.1312 };
const km = d.haversineKm(pasadena, altadena);
ok("Pasadena to Altadena is about 5 km", km > 4 && km < 6, km.toFixed(2));
ok("which is about 10 minutes", d.driveMinutes(km) === 10, String(d.driveMinutes(km)));
ok("never under five", d.driveMinutes(0.3) === 5);
ok("same town reads as your area", d.distancePhrase(1) === "your area");
ok("no location, no distance", d.distancePhrase(null) === null);

console.log("\n=== the family, in words ===");
ok("4 and 7", d.childrenPhrase([7, 4]) === "4 and 7 year olds", String(d.childrenPhrase([7, 4])));
ok("one child", d.childrenPhrase([3]) === "a 3 year old");
ok("a baby and a four-year-old", d.childrenPhrase([0, 4]) === "a baby and a 4 year old", String(d.childrenPhrase([0, 4])));
ok("on the way", d.childrenPhrase([-1]) === "a baby on the way");
ok("nobody", d.childrenPhrase([]) === null);
const prefs = d.familyPreferences({ children: null, home: null, travel_time: "under_20_min", budget: "prioritize_value", logistics: ["easy_parking", "nonsense"] });
ok("preferences read from the profile's own ids", JSON.stringify(prefs) === JSON.stringify(["within 20 min", "good value for the money", "easy parking"]), JSON.stringify(prefs));
ok("and never say 'best', which the checker refuses", !prefs.join(" ").includes("best") && !d.familyPreferences({ children: null, home: null, travel_time: null, budget: "prioritize_fit", logistics: [] }).join(" ").includes("best"));

console.log("\n=== every sentence the writer writes is checked, one at a time (22 Oct) ===");
const allowed = {
  text: "Sunny Days Preschool a school in Altadena Oak Grove Montessori 4 year old within 20 min mornings only Small groups Parent & Me community pool edible garden",
  numbers: "a 4 year old 15 20 2 to 5",
  minutes: [15, 20],
};
const passes = (t: string, a: Parameters<typeof d.reportSentence>[1] = allowed) => "text" in d.reportSentence(t, a);
ok("a sentence built from the facts passes", passes("It's about 15 minutes from you and the morning schedule suits a 4 year old."));
ok("comparing with another option by name passes", passes("Unlike Oak Grove Montessori, Sunny Days runs mornings only."));
ok("a class's own name with 'Parent' in it passes (22 Oct: four of five swim reasons were lost to it)", passes("Its Parent & Me class takes ages 2 to 5."));
ok("'no drive at all' passes: quantity words are no longer refused", passes("There is no drive at all if you live in Altadena."));
ok("an ordinary word opening a sentence passes ('Drive', 'Nothing')", passes("Drive times are short from Altadena.") && passes("Nothing about the hours is listed."));
ok("'kids who love animals' is not vouching", passes("Small groups suit kids who love a quiet start."));
ok("22 Oct run: 'a community pool', 'your local backup', 'the best-fitting' are ordinary words", passes("Lessons are at a community pool in Altadena.") && passes("Keep Oak Grove Montessori as your local backup.") && passes("Sunny Days is the best-fitting of these."));
ok("22 Oct run: 'than the others' compares, it is not hearsay", passes("Sunny Days runs mornings only, unlike the others."));
ok("22 Oct run: a GSM-7 letter in a town's name passes ('La Cañada')", passes("It is in La Cañada, near Altadena.", { ...allowed, text: allowed.text + " La Cañada" }));
ok("22 Oct run: 'kids tend an edible garden' is a fact, 'kids tend to love it' is not", passes("Kids tend an edible garden in Altadena.") && !passes("Kids tend to love the garden."));
ok("22 Oct run: 'I have no hours for it' reports a gap, it is not experience", passes("I have no hours for it, so check before you go.") && passes("That is all I have on Sunny Days."));
ok("22 Oct run: '20-minute lessons' is a page's number, not a drive time", passes("It runs 15-minute lessons.") && !passes("It is about 5 min away."));
const refusals: Array<[string, string]> = [
  ["Parents love the teachers here.", "parents loving it"],
  ["Kids enjoy the garden every day.", "kids enjoying it"],
  ["It costs about $300 a month.", "a price the facts do not hold"],
  ["Ranked first by Yelp.", "a name nobody gave"],
  ["We took our kids here and it was lovely.", "Pando speaking as a parent"],
  ['It runs a "play-based" program.', "a quotation"],
  ["See www.sunnydays.com for hours.", "a link"],
  ["It is the best preschool in Altadena.", "'the best'"],
  ["It is popular and well-regarded in Altadena.", "social proof"],
  ["A go-to with locals near Altadena.", "a go-to with locals"],
  ["It opens at 7am for working families.", "a time nobody stated"],
  ["Only 8 kids per class.", "a number the facts do not hold"],
  ["Only 1 teacher for 5 kids.", "a number found only inside '15' (review H3)"],
  ["Ask for Dan at the front desk.", "a name mid-sentence nobody gave"],
  ["Uses a {curly} schedule.", "a GSM-7 two-slot character"],
  ["I'm told it fills up fast in spring.", "hearsay"],
  ["It was calm last summer.", "experience"],
  ["It is about 5 min away.", "a drive time other than the estimate"],
  ["Two parents near you have used it.", "the writer counting parents (Pando prints that)"],
  ["It has local parent history.", "the writer citing parents at all"],
  ["It goes first because it has local use behind it.", "'local use' (second 22 Oct run)"],
  ["Kids like it a lot.", "kids liking it"],
  ["I've been there and it was lovely.", "experience"],
];
for (const [t, why] of refusals) ok(`refuses ${why}`, !passes(t), JSON.stringify(d.reportSentence(t, allowed)));
ok("an opening name the person reader flags is refused", !passes("Jenny Smith runs the mornings.", { ...allowed, isPerson: (w) => w === "Jenny Smith" }));
ok("a verb before an option's name is not a person (second 22 Oct run: 'Call Legacy')", passes("Call Sunny Days first.", { ...allowed, isPerson: () => true }));
ok("a plural of a word the facts hold is not a new name (third 22 Oct run: 'National Parks')", passes("It runs Small Groups in the mornings."));
{
  const pil = (await import(`../lib/public-info.ts?v=${Date.now()}`)) as typeof import("../lib/public-info");
  const long = pil.readDeepFindings(JSON.stringify({ findings: [{ name: "Crowell Family YMCA (formerly South Pasadena San Marino YMCA branch)", what: "YMCA" }] }), () => ({ person: false }));
  ok("a long name loses its parenthesis whole, not half of it", long[0]?.name === "Crowell Family YMCA", long[0]?.name);
}
const kept = d.keepSentences("It runs mornings only in Altadena. Parents rave about it. Small groups suit a 4 year old.", { ...allowed, max: 400 });
ok("a refused sentence is dropped on its own, the rest of the paragraph stands", kept.text === "It runs mornings only in Altadena. Small groups suit a 4 year old." && kept.dropped.join() === "claim", JSON.stringify(kept));
ok("past the length, trailing sentences go first", d.keepSentences("Small groups. Mornings only. In Altadena.", { ...allowed, max: 30 }).text === "Small groups. Mornings only.");
ok("nothing left is null, never an empty paragraph", d.keepSentences("Parents rave about it.", { ...allowed, max: 400 }).text === null);
ok("a non-string is null", d.keepSentences(42, { ...allowed, max: 400 }).text === null);
ok("a refusal says why, for the retry", d.refusalHint("claim").includes("vouched"));

console.log("\n=== the report: the writer's answer, with Pando's half where it has one ===");
const base = {
  named_by: null, last_confirmed: null, stale: false, quote: null, caveat: null, who_for: null, tip: null,
  price: null, worth: null, detail: null, km: null, web: null, warning: null, withdrawn: 0, answer_ready: false,
};
const opts = [
  {
    ...base, id: "p1", name: "Sunny Days Preschool", what: "a school", area: "Altadena", source: "parents" as const,
    firsthand: 2, last_confirmed: "Sep 2026", quote: "The teachers know every kid by name.",
    caveat: "The waitlist opens in January.", who_for: "Shy kids who need a slow start.", price: "about $900-1200 a month", km: 7,
  },
  {
    ...base, id: "p2", name: "Little Acorns Co-op", what: "a school", area: "Pasadena", source: "parents" as const,
    firsthand: 1, warning: "One parent recently said it may no longer be worth it, so check before you book.", withdrawn: 1, km: 1,
  },
  {
    ...base, id: "w1", name: "Oak Grove Montessori", what: "Montessori preschool", area: "Pasadena", source: "public" as const,
    firsthand: 0, km: 1,
    web: { what: "Montessori preschool", ages: "2 to 6", schedule: "half and full days", price: "$1,400 a month", highlights: ["outdoor classroom", "Spanish twice a week"], summary: "A Montessori preschool with mixed-age rooms and an outdoor classroom.", site: "oakgrove.org" },
  },
  {
    ...base, id: "w2", name: "Bright Start Learning Center", what: "preschool", area: "Pasadena", source: "public" as const, firsthand: 0,
    detail: "Ages 3 to 5.",
  },
];
const family = { children: "a 4 year old", home: "Altadena", travel_time: "under_20_min", budget: "prioritize_value", logistics: [] };
const draftIn = {
  opening: "For a 4 year old near Altadena the drive and the price matter most, so I weighed those first.",
  order: ["w1", "p2", "p1", "w2"],
  text: { w1: "Oak Grove Montessori is a short drive and takes ages 2 to 6, so your 4 year old fits. At $1,400 a month it is the priciest here." },
  watch: { w1: "whether half days have room", p1: "parking at drop-off" },
  bottom_line: "I'd start with Oak Grove Montessori and tour it, then compare Sunny Days Preschool on price.",
};
const text = d.renderDeepDive({ question: "top preschools near us", family, options: opts, draft: draftIn, offerAsk: true });
const at = (s: string) => text.indexOf(s);
ok("opens with what it is about", text.startsWith("Here's your deep dive: top preschools near us"));
ok("with the writer's opening, the 'I weighed it for' line is not printed too (22 Oct: it said the same twice)", !text.includes("I weighed it for"), text.split("\n")[1]);
ok("with no opening, it says who it was weighed for", d.renderDeepDive({ question: "top preschools near us", family, options: opts, draft: { ...draftIn, opening: undefined }, offerAsk: true }).includes("I weighed it for your 4 year old near Altadena: within 20 min, good value for the money."));
ok("the writer's opening follows", text.includes("the drive and the price matter most"));
ok("the verbatim label is said once, before any public fact", text.split("Public/general information").length === 2 && at("Public/general information") < at("1) "));
ok("and says where the parents' lines come from", text.includes("lines about parents near you are from Pando's local parents."));
ok("no at-a-glance directory", !text.includes("At a glance"));
ok("the writer's order is the report's order, not parents first", at("1) Oak Grove") < at("2) Sunny Days"), text);
ok("a withdrawn record is never ranked above a clean one, whatever the writer said", at(") Sunny Days") < at(") Little Acorns") && at(") Bright Start") < at(") Little Acorns"), text);
ok("the writer's paragraph is the option's body", text.includes("1) Oak Grove Montessori, Pasadena (your area)\nOak Grove Montessori is a short drive"));
ok("with the thing to check under it", text.includes("Worth checking: whether half days have room."));
ok("Pando's half follows on a parents' option, in the client's sentence", text.includes("2 parents near you have used it, last confirmed Sep 2026."));
ok("a withdrawal is never dropped (review H6)", text.includes("may no longer be worth it, so check before you book."));
ok("their words are verbatim, in quotes", text.includes('A parent said: "The teachers know every kid by name."'));
ok("who it suits, as parents said it", text.includes("Good for: Shy kids who need a slow start."));
ok("a parent's heads-up is printed as theirs", text.includes("Heads up: The waitlist opens in January."));
ok("what parents paid is labelled as theirs", text.includes("Parents paid: about $900-1200 a month."));
ok("a value rating alone reads as what they said, not a price", (() => {
  const t = d.renderDeepDive({ question: "x", family, options: [{ ...opts[0], price: null, worth: "Pricey but worth it" }], draft: null, offerAsk: false });
  return t.includes("Value for money: pricey but worth it.") && !t.includes("paid:");
})());
ok("with no paragraph, a public option says what its page says - never an empty 'It's in your area'", text.includes(") Bright Start Learning Center, Pasadena\nPreschool. Ages 3 to 5."), text);
ok("a page summary is the fallback paragraph when the writer's is missing", d.renderDeepDive({ question: "x", family, options: [opts[2]], draft: null, offerAsk: false }).includes("A Montessori preschool with mixed-age rooms and an outdoor classroom. Ages 2 to 6. Half and full days. $1,400 a month."));
ok("no site unless sites are on (carrier filtering)", !text.includes("oakgrove.org"));
ok("and printed when they are", d.renderDeepDive({ question: "x", family, options: opts, draft: null, offerAsk: false, sites: true }).includes("Site: oakgrove.org"));
ok("the bottom line names where to start", text.includes("My take: I'd start with Oak Grove Montessori and tour it"));
ok("offers an introduction when parents are behind an option", text.includes("Reply INTRO and the name, like INTRO Sunny Days Preschool."));
const intro = (await import(`../lib/introductions.ts?v=${Date.now()}`)) as typeof import("../lib/introductions");
ok("and the example it gives is a reply the intro step reads", intro.introTarget("INTRO Sunny Days Preschool") === "Sunny Days Preschool");
ok("drive times said once to be estimates", text.split("rough estimates").length === 2);
ok("the reply question is the last line", text.trimEnd().endsWith("Want me to ask nearby parents about these? Reply YES."));
ok("and it is plain GSM-7", !/[^\x20-\x7E\n]/.test(text));
const publicOnly = d.renderDeepDive({ question: "x", family, options: opts.filter((o) => o.source === "public"), draft: null, offerAsk: false });
ok("no INTRO line when no parent is behind it", !publicOnly.includes("INTRO"));
ok("with no parents the label line does not mention them", publicOnly.includes("Public/general information from its own pages.") && !publicOnly.includes("lines about parents"));
const parentsOnly = d.renderDeepDive({ question: "x", family, options: [{ ...opts[0] }], draft: null, offerAsk: false });
ok("with no page at all there is no public label", !parentsOnly.includes("Public/general information"));
const fallback = d.renderDeepDive({ question: "camps", family: { ...family, children: null, home: null, travel_time: null, budget: null }, options: opts, draft: null, offerAsk: false });
ok("with no draft it still goes out, a withdrawn record after the clean ones", fallback.indexOf("Sunny Days") < fallback.indexOf("Little Acorns"));
ok("an unknown id in the writer's order is ignored", d.renderDeepDive({ question: "x", family, options: opts, draft: { order: ["zz", "p1"], text: {}, watch: {}, bottom_line: null }, offerAsk: false }).includes("1) Sunny Days"));
const many = Array.from({ length: 9 }, (_, i) => ({ ...base, id: `w${i + 1}`, name: `Place ${i + 1}`, what: "a camp", area: "Pasadena", source: "public" as const, firsthand: 0 }));
const wide = d.renderDeepDive({ question: "camps", family, options: many, draft: null, offerAsk: false });
ok("with no writer, five in detail and the rest named in one line", wide.includes("5) Place 5") && !wide.includes("6) Place 6") && wide.includes("Also worth a look (Public/general information): Place 6 (Pasadena), Place 7 (Pasadena), Place 8 (Pasadena), Place 9 (Pasadena)."));

console.log("\n=== the shape is the question's: how many, and what kind of comparison (22 Oct) ===");
const shaped = (draft: Partial<NonNullable<Parameters<typeof d.renderDeepDive>[0]["draft"]>>) =>
  d.renderDeepDive({ question: "camps", family, options: many, draft: { order: [], text: {}, watch: {}, bottom_line: null, ...draft }, offerAsk: false });
const ten = shaped({ order: many.map((o) => o.id), also: [] });
ok("a 'top 10' style list details every place the writer chose, not five", ten.includes("9) Place 9") && !ten.includes("Also worth a look"));
const pair = shaped({ order: ["w3", "w7"], also: [], comparison: "Place 3 runs longer days; Place 7 is closer." });
ok("'X or Y' details just those two, in the writer's order", pair.includes("1) Place 3") && pair.includes("2) Place 7") && !pair.includes("3) "));
ok("and names nothing else when the writer's 'also' is empty", !pair.includes("Also worth a look"));
ok("the side-by-side is printed before the take", pair.includes("Side by side: Place 3 runs longer days; Place 7 is closer."));
const one = shaped({ order: ["w2"], also: ["w5", "w6"] });
ok("'is X good for us?' details one and names the alternatives it chose", one.includes("1) Place 2") && !one.includes("2) ") && one.includes("Also worth a look (Public/general information): Place 5 (Pasadena), Place 6 (Pasadena)."));
ok("never more than twelve blocks", d.DEEP_DIVE_MAX_DETAILED === 12 && d.detailCount({ options: Array.from({ length: 16 }, (_, i) => ({ ...many[0], id: `x${i}` })), draft: { order: Array.from({ length: 16 }, (_, i) => `x${i}`), text: {}, watch: {}, bottom_line: null } }) === 12);
const longTen = d.fitDeepDive({ question: "top 10 camps", family, options: many.map((o) => ({ ...o, web: { what: "camp", ages: "5 to 12", schedule: null, price: null, highlights: [], summary: "s".repeat(380), site: null } })), draft: { order: many.map((o) => o.id), also: [], text: {}, watch: {}, bottom_line: null }, offerAsk: false });
ok("a long list that cannot fit loses blocks from the end, and names them", longTen.parts.length <= d.DEEP_DIVE_MAX_PARTS && longTen.parts.every((p) => p.length <= 1600) && (longTen.shown.length === 9 || longTen.parts.join(" ").includes("Also worth a look")), `${longTen.parts.length} parts, ${longTen.shown.length} shown`);
ok("the writer is told the room, and what Pando's own lines cost", d.deepDiveRoom() > 7000 && d.pandoLines(opts[0]) > 100 && d.pandoLines(opts[2]) === 0);

console.log("\n=== the web half, matched to our records ===");
const pi = (await import(`../lib/public-info.ts?v=${Date.now()}`)) as typeof import("../lib/public-info");
const finding = (name: string, extra: Partial<import("../lib/deep-dive").WebFinding> = {}) => ({
  name, what: "preschool", area: "Pasadena", ages: null, schedule: null, price: null, highlights: [], site: null, ...extra,
});
const merged = d.withWebFacts(
  opts.filter((o) => o.source === "parents"),
  [finding("Sunny Days Preschool of Altadena", { area: "Altadena", ages: "2 to 5", schedule: "Mon-Fri 7:30am-6pm" }), finding("Oak Grove Montessori"), finding("Kidspace Nursery")],
  { same: pi.sameName, area: (a) => a, max: 12 },
);
const sunny = merged.find((o) => o.name === "Sunny Days Preschool");
ok("a finding with a record's name joins that record", sunny?.web?.ages === "2 to 5" && sunny?.source === "parents");
ok("and is not listed again as a public option (one place, one label)", merged.filter((o) => /Sunny Days/.test(o.name)).length === 1);
ok("the other findings become public options", merged.filter((o) => o.source === "public").map((o) => o.name).join("|") === "Oak Grove Montessori|Kidspace Nursery");
ok("a record with no match keeps no web half", merged.find((o) => o.name === "Little Acorns Co-op")?.web === null);
ok("no findings: the options as they were", d.withWebFacts(opts, [], { same: pi.sameName, area: (a) => a, max: 12 }) === opts);
const both = d.renderDeepDive({ question: "x", family, options: merged, draft: null, offerAsk: false });
const sunnyBlock = both.split("\n\n").find((b) => b.includes(") Sunny Days")) ?? "";
ok("in the report the page's facts open the block and the parents' half follows as theirs", sunnyBlock.indexOf("Preschool. Ages 2 to 5. Mon-Fri 7:30am-6pm.") > 0 && sunnyBlock.indexOf("Preschool. Ages 2 to 5. Mon-Fri 7:30am-6pm.") < sunnyBlock.indexOf("2 parents near you"), sunnyBlock);
ok("pi.readDeepFindings keeps fields and a bare domain", (() => {
  const got = pi.readDeepFindings('{"findings":[{"name":"Oak Grove Montessori","what":"Montessori preschool","area":"Pasadena","ages":"2 to 6","schedule":null,"price":"$1,400 a month","highlights":["outdoor classroom"],"site":"https://www.oakgrove.org/admissions?utm=x","known":false}]}', () => ({ person: false }));
  return got.length === 1 && got[0].site === "oakgrove.org" && got[0].ages === "2 to 6" && got[0].schedule === null;
})());
ok("and never a person", pi.readDeepFindings('{"findings":[{"name":"Jane Smith","what":"tutor"}]}', () => ({ person: true, strong: true })).length === 0);
/* 26 Oct, the SMS lab: "iD Tech Camps at Caltech (Pasadena (Caltech))". */
ok(
  "a deep finding's area is the place's name, without the model's aside",
  pi.readDeepFindings('{"findings":[{"name":"iD Tech Camps at Caltech","what":"tech camp","area":"Pasadena (Caltech)"}]}', () => ({ person: false }))[0]?.area === "Pasadena",
);

console.log("\n=== the friendlier voice: advice passes, experience does not ===");
ok("'I'd start with' is advice and passes", passes("I'd start with the closest one and tour it first."));
ok("'I've been' is still refused", !passes("I've been there and it was lovely."));

console.log("\n=== in SMS-sized parts ===");
const bigOpt = (i: number) => `${i + 1}) Option ${i}\n${"x".repeat(500)}`;
const parts = d.splitBlocks({ header: "Here's your deep dive: x", options: Array.from({ length: 5 }, (_, i) => bigOpt(i)), footer: "Free during the pilot." });
ok("no part over Twilio's limit", parts.every((p) => p.length <= 1600), parts.map((p) => p.length).join(","));
ok("numbered", parts.length > 1 && parts[0].startsWith(`(1/${parts.length}) `));
const capped = d.splitBlocks({ header: "H", options: Array.from({ length: 12 }, (_, i) => bigOpt(i)), footer: "F" }, 3);
ok("never more than the cap", capped.length <= 3);
ok("six parts at most by default (22 Oct: a 'top 10' needs the room)", d.splitBlocks({ header: "H", options: Array.from({ length: 24 }, (_, i) => bigOpt(i)), footer: "F" }).length === 6);
ok("options drop from the end, the lowest-ranked first (review M8)", capped.join("\n").includes("1) Option 0") && !capped.join("\n").includes("12) Option 11"));
ok("the footer always survives", capped[capped.length - 1].endsWith("F"));
ok("a block too long for a part is left out whole, never cut", !d.splitBlocks({ header: "H", options: ["1) A\n" + "y".repeat(2000), "2) B"], footer: "F" }).join("").includes("yyyy"));
ok("a short report is one message, unnumbered", d.splitBlocks({ header: "H", options: ["1) A"], footer: "F" }).length === 1);

console.log("\n=== a warmer ordinary answer, and refusing one that moves a fact ===");
const draft = [
  "2 parents near you have used Rose Bowl Aquatics parent & me, a class in Old Pasadena, last confirmed Sep 2026.",
  "Best for: a baby who hates being cold.",
  'One said: "The water is genuinely warm."',
  "Heads up: Parking on a Rose Bowl event day is impossible.",
  "About $100-200 a term.",
  "Also nearby: La Pintoresca Library, a place in Northwest Pasadena, 1 parent, Free; Tiny Tots Gym, a class in Altadena, 2 parents, fair.",
  "",
  "Public/general information:",
  "Sunsational Swim School - At-home group baby swim in Pasadena.",
].join("\n");
const input = {
  draft,
  question: "baby swim classes?",
  parents: [
    { name: "Rose Bowl Aquatics parent & me", evidence: "2 parents near you", keep: ["a baby who hates being cold", "The water is genuinely warm", "Parking on a Rose Bowl event day is impossible"], tokens: [] },
    { name: "La Pintoresca Library", evidence: "1 parent", keep: [], tokens: [] },
    { name: "Tiny Tots Gym", evidence: "2 parents", keep: [], tokens: [] },
  ],
  publicNames: ["Sunsational Swim School"],
  mustKeep: ["Public/general information:", "Sunsational Swim School - At-home group baby swim in Pasadena."],
  mustContain: ["$100-200", "last confirmed Sep 2026"],
  max: 765,
};
const warm = [
  "Baby swim, good timing.",
  '2 parents near you have used Rose Bowl Aquatics parent & me, a class in Old Pasadena (last confirmed Sep 2026). It suits a baby who hates being cold. One said: "The water is genuinely warm." Heads up: parking on a Rose Bowl event day is impossible. About $100-200 a term.',
  "La Pintoresca Library in Northwest Pasadena is free, and 1 parent has been.",
  "Tiny Tots Gym in Altadena: 2 parents, fair value.",
  "",
  "Public/general information:",
  "Sunsational Swim School - At-home group baby swim in Pasadena.",
].join("\n");
ok("a rewrite that keeps every fact is accepted", v.acceptVoice(warm, input) !== null);
const moved: Array<[string, string]> = [
  [warm.replace("Rose Bowl Aquatics parent & me, ", ""), "a record's name dropped"],
  [warm.replace("genuinely warm", "really warm"), "a parent's words changed"],
  [warm.replace("2 parents near you have used ", "Parents have used "), "the evidence removed"],
  [warm.replace("free, and 1 parent has been.\nTiny Tots Gym in Altadena: 2 parents", "free, and 2 parents have been.\nTiny Tots Gym in Altadena: 1 parent"), "counts swapped between two records (review H2)"],
  [warm.replace("Tiny Tots Gym in Altadena: 2 parents, fair value.", "Tiny Tots Gym in Altadena: 2 parents, fair value, and plenty of other families recommend it."), "an inflated count (review H2)"],
  [warm.replace('One said: "The water is genuinely warm."', 'One said: "The water is genuinely warm." Another said: "Ms. Diane is the best, 10/10."'), "an invented quote (review H1)"],
  [warm.replace(' One said: "The water is genuinely warm."', "").replace("Tiny Tots Gym in Altadena: 2 parents, fair value.", 'Tiny Tots Gym in Altadena: 2 parents, fair value. One said: "The water is genuinely warm."'), "a quote moved to another record (review H4)"],
  [warm.replace("Sunsational Swim School - At-home", "Parents recommend Sunsational Swim School - At-home"), "a parent claim on the public block"],
  [warm.replace("Public/general information:\n", ""), "the public heading dropped"],
  [warm.replace(" About $100-200 a term.", ""), "a price dropped"],
  [warm.replace("About $100-200 a term.", "About $100-200 a term, and 3 sessions a week."), "a new number"],
  [warm.replace("Baby swim, good timing.", "Baby swim at Brookside, good timing."), "a new place name"],
  [warm.replace("Baby swim, good timing.", "I've heard great things."), "Pando speaking as a parent"],
  [warm.replace("Baby swim, good timing.", "Want to know more?"), "a question of its own"],
  [warm.replace("Baby swim, good timing.", "It's the best one around."), "praise the draft never made"],
  [warm.replace("Baby swim, good timing.", "Baby swim, good timing. See www.rosebowl.com."), "a link"],
];
for (const [text, why] of moved) ok(`refuses: ${why}`, v.acceptVoice(text, input) === null);
ok("refuses a rewrite over the budget", v.acceptVoice(warm, { ...input, max: 200 }) === null);
const named = {
  ...input,
  draft: input.draft.replace("2 parents near you have used Rose Bowl", "{n1} has used Rose Bowl"),
  parents: [{ ...input.parents[0], evidence: "{n1} has", tokens: ["{n1}"] }, input.parents[1], input.parents[2]],
};
const namedWarm = warm.replace("2 parents near you have used Rose Bowl", "{n1} has used Rose Bowl");
ok("a contributor's name token on its own record passes", v.acceptVoice(namedWarm, named) !== null);
ok("and moved onto another record is refused", v.acceptVoice(namedWarm.replace("Tiny Tots Gym in Altadena: 2 parents", "Tiny Tots Gym in Altadena: {n1} and 2 parents"), named) === null);

/* The prompt's own example (answer-voice.ts SYSTEM) must pass the check it teaches. */
const exampleIn = {
  draft: "2 parents near you have used Tiny Tots Gym, a class in Altadena.\nBest for: toddlers who climb everything.\nHeads up: Saturday classes fill fast.",
  question: "toddler classes?",
  parents: [{ name: "Tiny Tots Gym", evidence: "2 parents near you", keep: ["toddlers who climb everything", "Saturday classes fill fast"], tokens: [] }],
  publicNames: [],
  mustKeep: [],
  mustContain: [],
  max: 765,
};
ok(
  "the voice prompt's own example passes acceptVoice",
  v.acceptVoice("Happy to help with this.\n2 parents near you have used Tiny Tots Gym in Altadena - it suits toddlers who climb everything, but Saturday classes fill fast, so book early.", exampleIn) !== null,
);
ok(
  "and the other opening it gives",
  v.acceptVoice("Oh nice, good timing for this.\n2 parents near you have used Tiny Tots Gym in Altadena - it suits toddlers who climb everything, but Saturday classes fill fast.", exampleIn) !== null,
);
ok(
  "'this one' is refused, as the prompt warns",
  v.acceptVoice("Happy to help with this one.\n2 parents near you have used Tiny Tots Gym in Altadena - it suits toddlers who climb everything, but Saturday classes fill fast.", exampleIn) === null,
);


console.log("\n=== the 21 Oct reviews, pinned ===");
{
  const pi2 = (await import(`../lib/public-info.ts?v=${Date.now()}`)) as typeof import("../lib/public-info");
  const np = (await import(`../lib/named-person.ts?v=${Date.now()}`)) as typeof import("../lib/named-person");
  const person = (n: string) => np.looksLikePerson(n);
  const read = (row: Record<string, unknown>) =>
    pi2.readDeepFindings(JSON.stringify({ findings: [{ name: "Oak Grove Montessori", what: "Montessori preschool", ...row }] }), person);
  const hl = read({ highlights: ["Director Maria Lopez, 20 years", "Parents rave about it", "Call 626-555-1234", "see sunnydays.org", "Voted best in Pasadena", "outdoor classroom"] })[0]?.highlights ?? [];
  ok("H1: a page's highlights lose a named person, praise, a phone and a link", JSON.stringify(hl) === JSON.stringify(["outdoor classroom"]), JSON.stringify(hl));
  ok("H1: kids enjoying it is reported experience, refused", (read({ highlights: ["kids enjoy the garden"] })[0]?.highlights ?? []).length === 0);
  ok("H1: a fact about parents is not a claim", (read({ highlights: ["parents help in class weekly"] })[0]?.highlights ?? []).length === 1);
  ok("H1: a price field with a phone in it is dropped", read({ price: "call (626) 555-1234" })[0]?.price === null);
  ok("H1: a name that is itself a claim is not a place to print", pi2.readDeepFindings(JSON.stringify({ findings: [{ name: "#1 Rated Swim School", what: "swim school" }] }), person).length === 0);

  const one = (extra: Partial<import("../lib/deep-dive").DeepOption>) => ({ ...base, id: "p1", name: "Little Gym", what: "a class", area: "Pasadena", source: "parents" as const, firsthand: 2, ...extra });
  const f2 = (name: string, area: string | null = "Pasadena") => ({ name, what: "gym", area, ages: "1 to 5", schedule: null, price: "$200 a month", highlights: [], site: null });
  const m = (o: import("../lib/deep-dive").DeepOption, fs: ReturnType<typeof f2>[]) => d.withWebFacts([o], fs, { same: pi2.sameName, area: (a) => a, max: 12 });
  ok("M1: 'The Little Gym of Pasadena' joins 'Little Gym'", m(one({}), [f2("The Little Gym of Pasadena")])[0].web?.price === "$200 a month");
  ok("M1: another town's branch does not join", m(one({}), [f2("The Little Gym of Glendale", "Glendale")])[0].web === null);
  ok("M1: 'Montessori Academy' is not 'Montessori School'", m(one({ name: "Pasadena Montessori School" }), [f2("Pasadena Montessori Academy")])[0].web === null);
  ok("M1: 'Kumon - Arcadia' does not join 'Kumon - Pasadena'", m(one({ name: "Kumon - Pasadena" }), [f2("Kumon - Arcadia", "Arcadia")])[0].web === null);
  const two = m(one({ name: "Rose Bowl Aquatics" }), [f2("Rose Bowl Aquatics Center"), f2("Rose Bowl Aquatics Swim Team")]);
  ok("M2: one place is never listed twice under two labels", two.length === 1 && two[0].source === "parents", two.map((o) => o.name).join("|"));
  ok("M1/M2: a branch that does not join is not listed as public either", m(one({ name: "Kumon - Pasadena" }), [f2("Kumon - Arcadia", "Arcadia")]).length === 1);

  /* H3: the header describes only what was sent */
  const long = (i: number, extra: Partial<import("../lib/deep-dive").DeepOption> = {}) => ({
    ...base, id: `p${i}`, name: `Place ${i}`, what: "a school", area: "Pasadena", source: "parents" as const, firsthand: 2, km: 5,
    quote: "x".repeat(700), who_for: "y".repeat(300), ...extra,
  });
  const fitted = d.fitDeepDive({ question: "schools", family, options: [1, 2, 3, 4, 5, 6].map((i) => long(i)), draft: null, offerAsk: false }, 3);
  const sent = fitted.parts.join("\n\n");
  ok("H3: it fits the cap", fitted.parts.length <= 3, String(fitted.parts.length));
  ok("H3: no part over Twilio's limit", fitted.parts.every((p) => p.length <= 1600));
  ok("H3: every option shown has its block", fitted.shown.every((o, i) => sent.includes(`${i + 1}) ${o.name}`)) && !sent.includes(`${fitted.shown.length + 1}) Place`));
  ok("H3: the ones that lost their block are named", fitted.named.length > 0 && sent.includes("Also used by parents near you:"));
  const warned = d.fitDeepDive({ question: "schools", family, options: [1, 2, 3, 4, 5, 6].map((i) => long(i, i === 6 ? { warning: "One parent recently said it may no longer be worth it, so check before you book.", withdrawn: 1 } : {})), draft: null, offerAsk: false }, 3);
  ok("L1: a withdrawn record without its block is left out, never listed bare", !warned.parts.join(" ").includes("Place 6") || warned.parts.join(" ").includes("may no longer be worth it"));

  /* M4 and the second review: what the model may say */
  const fam = { children: "a 4 year old", home: "Altadena", travel_time: "under_20_min", budget: null, logistics: [] };
  const opt = { km: 12 }; /* 25 min */
  const mins = d.minutesFor(opt, fam);
  const allowedX = { text: "Oak Tree Preschool a school Pasadena top 5 under $500 a 4 year old 2 to 5", minutes: mins, numbers: `a 4 year old Oak Tree Preschool 2 to 5 ${mins.join(" ")}`, prices: "" };
  const says = (t: string, a: Parameters<typeof d.reportSentence>[1] = allowedX) => "text" in d.reportSentence(t, a);
  ok("M4: 'I'm told it fills fast' is hearsay", !says("I'm told it fills up fast in spring."));
  ok("M4: 'others say' is hearsay", !says("It is a calm place, others say."));
  ok("M4: 'kids enjoy it' is reported experience", !says("Close by and kids enjoy the garden."));
  ok("M4: 'my toddler' is experience", !says("It worked well for my toddler."));
  ok("M4: 'when we were there' is experience", !says("It was calm when we were there."));
  ok("M4: a drive time other than the estimate is refused", !says("It is about 5 min away."));
  ok("M4: the estimate itself passes", says(`It is about ${mins[0]} min away.`));
  ok("review 2: the question's price cannot back a sentence", !says("It's $500 a month, right at your budget."));
  ok("review 2: the option's own ages can", says("It takes 2 to 5, so your 4 year old fits."));
  ok("review 2: an option whose name holds a vouching word is still named, as written", says("Little Stars is close and runs half days.", { text: "Little Stars half days", numbers: "", names: ["Little Stars"] }));
  ok("review 2: 'You'll' and 'They' open a sentence without naming anything", d.keepSentences("You'll be close by. They run half days.", { text: "half days", numbers: "", max: 200 }).text === "You'll be close by. They run half days.");
  ok("review 2: 'Pando' names nobody", says("You told Pando drive time matters, so this is close.", { text: "drive time", numbers: "" }));
  ok("review 2: a watch keeps a name's capital and loses its '?'", d.watchPhrase("Spanish immersion days have room?") === "Spanish immersion days have room" && d.watchPhrase("Whether it has room?") === "whether it has room");

  /* the second review: copy */
  const noKids = d.renderDeepDive({ question: "x", family: { ...fam, children: null, home: "Pasadena" }, options: opts, draft: null, offerAsk: false });
  ok("review 2: no 'I weighed it for near'", noKids.includes("I weighed it for your family near Pasadena"), noKids.split("\n")[1]);
  const notTheirs = d.renderDeepDive({ question: "x", family: { ...fam, home: "Pasadena", home_is_theirs: false }, options: opts, draft: null, offerAsk: false });
  ok("review 2: 'your area' only when it is theirs", !notTheirs.includes("your area") && notTheirs.includes("close by"));
  const one1 = d.renderDeepDive({ question: "x", family, options: [{ ...opts[0], firsthand: 1, price: "under $600 a month" }], draft: null, offerAsk: false });
  ok("review 2: one parent's price is one parent's", one1.includes("One parent paid: under $600 a month.") && !one1.includes("Parents paid"));
  const ages = (a: string) => d.factsParagraph({ ...opts[2], web: { what: "preschool", ages: a, schedule: null, price: null, highlights: [], site: null } }) ?? "";
  ok("review 2: 'Ages' only before a number", ages("2 to 5").includes("Ages 2 to 5.") && ages("Grades K-5").includes("Grades K-5.") && !ages("all ages").includes("Ages all"));
  ok("review 2: 'iPad lab' keeps its case", (d.factsParagraph({ ...opts[2], web: { what: "iPad lab", ages: null, schedule: null, price: null, highlights: [], site: null } }) ?? "").includes("iPad lab"));
  ok("review 2: a parent's line gets its full stop", d.renderDeepDive({ question: "x", family, options: [{ ...opts[0], caveat: "fills fast" }], draft: null, offerAsk: false }).includes("Heads up: fills fast."));
}
{
  /* High 2: a first-person quote no longer refuses the rewrite; the withdrawal sentence stays whole */
  const q = {
    draft: '2 parents near you have used Tiny Tots Gym, a class in Altadena.\nOne said: "My kids loved it and we have been going for a year."',
    question: "toddler classes?",
    parents: [{ name: "Tiny Tots Gym", evidence: "2 parents near you", keep: [], tokens: [] }],
    publicNames: [], mustKeep: [], mustContain: [], max: 765,
  };
  ok("review 2: the unchanged draft with a first-person quote is accepted", v.acceptVoice(q.draft, q) !== null);
  ok("review 2: but the model's own 'my kids' is still refused", v.acceptVoice(q.draft + "\nMy kids would like it too.", q) === null);
}

{
  const h = d.renderDeepDive({ question: "camps near La Cañada for my niña, ¿qué más? 😀", family, options: opts, draft: null, offerAsk: false }).split("\n")[0];
  ok("GSM-7 letters stay in the header, others lose their accent, emoji go", h.includes("La Cañada") && h.includes("niña") && h.includes("qué mas") && !/\u{1F600}/u.test(h), h);
  const intro2 = (await import(`../lib/introductions.ts?v=${Date.now()}`)) as typeof import("../lib/introductions");
  ok("and in the intro offer", intro2.introOffer("Café Niño", 2).includes("Café Niño") && intro2.introOffer("Ánimo Kids", 2).includes("Animo Kids"));
}


{
  /* 22 Oct, live: the warm rewrite measured against Haiku 5.5 — 5 of 12 passed */
  const draftV = '4 parents near you have used Kidspace Children\'s Museum, a museum in Pasadena, last confirmed Oct 2026.\nOne said: "The indoor water play saved us on a wet Sunday."\nHeads up: Gets busy after 11am on weekends.\nAbout $19 a person.\nAlso nearby: My Gym Pasadena, a class in Pasadena, 1 parent.';
  const inV = {
    draft: draftV,
    question: "where can I take a toddler on a rainy day around South Pasadena?",
    parents: [
      { name: "Kidspace Children's Museum", evidence: "4 parents near you", keep: ["The indoor water play saved us on a wet Sunday", "Gets busy after 11am on weekends"], tokens: [] },
      { name: "My Gym Pasadena", evidence: "1 parent", keep: [], tokens: [] },
    ],
    publicNames: [], mustKeep: [], mustContain: ["$19", "last confirmed Oct 2026"], max: 765,
  };
  const live1 = 'Happy to help with this. 4 parents near you have used Kidspace Children\'s Museum in Pasadena, last confirmed Oct 2026, and one said "The indoor water play saved us on a wet Sunday." Just know it gets busy after 11am on weekends, and it\'s about $19 a person.\nAlso nearby: My Gym Pasadena in Pasadena, 1 parent.';
  ok("22 Oct live: a word after a quote starts a sentence of its own ('Just know')", v.acceptVoice(live1, inV) !== null);
  ok("22 Oct live: 'Expect about $19' opens a sentence", v.acceptVoice(live1.replace("and it's about $19 a person", "expect about $19 a person"), inV) !== null);
  ok("22 Oct live: a record run onto the previous line is put back on its own", v.acceptVoice(live1.replace("\nAlso nearby:", " Also nearby:"), inV) !== null);
  ok("but a name nobody gave is still refused after a quote", v.acceptVoice(live1.replace("Just know it", "Jenny Smith says it"), inV) === null);
  ok("and an invented parent claim still is", v.acceptVoice(live1 + " Another parent said they'd recommend it.", inV) === null);
  ok("22 Oct live: 'here's what other parents passed along' says where it comes from, it claims nothing", v.acceptVoice("Rainy days with a toddler - here's what other parents passed along.\n" + live1.replace("Happy to help with this. ", ""), inV) !== null);
  ok("22 Oct live: a closing mark moved inside a quote is still the quote", v.acceptVoice(live1.replace('wet Sunday."', 'wet Sunday,"'), inV) !== null);
  ok("22 Oct live: an empty heading the draft never had is dropped, not refused", v.acceptVoice(live1 + "\nPublic/general information:", inV) !== null);
  ok("22 Oct live: the question's own words are not praise ('a toddler who loves water')", v.acceptVoice("A toddler who loves water on a rainy day, got it.\n" + live1.replace("Happy to help with this. ", ""), { ...inV, question: "rainy day ideas for a toddler who loves water?" }) !== null);
  ok("22 Oct live: 'Animal-loving' and 'Looking for' open a sentence", v.acceptVoice("Animal-loving toddlers on a rainy day, got it.\nLooking for a wet-day plan, here it is.\n" + live1.replace("Happy to help with this. ", ""), { ...inV, question: "rainy day ideas for a toddler who loves animals?" }) !== null);
  ok("22 Oct live: 'a few solid options' counts nothing, it passes", v.acceptVoice("Rainy day with a toddler - a few solid options here.\n" + live1.replace("Happy to help with this. ", ""), inV) !== null);
  ok("but 'many families go' still is a count", v.acceptVoice(live1 + " Many families go there.", inV) === null);
  ok("but praise of the model's own still is ('a great museum')", v.acceptVoice(live1.replace("Happy to help with this.", "A great museum for this."), inV) === null);
  const labelled = { ...inV, draft: inV.draft + "\nRecommended by a local parent.", mustKeep: ["Recommended by a local parent."] };
  ok("22 Oct live: a trust label line is kept verbatim - a rewrite without it is refused", v.acceptVoice(live1, labelled) === null);
  ok("and a rewrite that keeps it is not refused for the label's own parent words", v.acceptVoice(live1 + "\nRecommended by a local parent.", labelled) !== null);
  const voiceSrc = fs.readFileSync(new URL("../lib/server/answer-voice.ts", import.meta.url), "utf8");
  /* 26 Oct: the reader moved into `lib/answer-voice.ts` (`readVoiceInput`), where `test:answer` runs it on real drafts. */
  ok("voiceInputFor puts every trust-label line of the draft into mustKeep", voiceSrc.includes("readVoiceInput({ ...input, labels: LABELS })") && voiceSrc.includes("Object.values(TRUST_LABEL)") && v.readVoiceInput({ draft: "2 parents near you have used X, a class.\nReference available.", question: "q", candidates: [{ name: "X", kind: "activity", firsthand_count: 2, trust: { labels: [], freshness: "fresh", public_only: false } }], max: 900, labels: ["Reference available"] }).mustKeep.includes("Reference available."));
}

console.log("\n=== the third round of reviews, pinned ===");
{
  const pi3 = (await import(`../lib/public-info.ts?v=${Date.now()}`)) as typeof import("../lib/public-info");
  const np3 = (await import(`../lib/named-person.ts?v=${Date.now()}`)) as typeof import("../lib/named-person");
  const hl3 = (h: string[]) =>
    pi3.readDeepFindings(JSON.stringify({ findings: [{ name: "Oak Grove Montessori", what: "Montessori preschool", highlights: h }] }), (n) => np3.looksLikePerson(n))[0]?.highlights ?? [];
  const named = ["Run by Jenny, a former Olympian", "Led by Jenny since 2004", "Founded by Maria in 1999", "Taught by Ms. Lee", "Director: Jenny"];
  ok("H3: a role in any case, then a name, is a person (dropped)", hl3(named).length === 0, JSON.stringify(hl3(named)));
  const praise = ["Parent-approved since 1990", "According to parents, the staff are kind", "Parents tell us it is magical", "Families keep coming back", "Well-regarded in the area", "4.9 on Yelp", "Over 1,000 happy campers", "Sought-after"];
  ok("M1: praise that reads as parent trust is dropped", hl3(praise).length === 0, JSON.stringify(hl3(praise)));
  ok("but plain facts stay", hl3(["outdoor classroom", "teacher ratio 1:6", "run by the city parks department"]).length === 3, JSON.stringify(hl3(["outdoor classroom", "teacher ratio 1:6", "run by the city parks department"])));
  const area = pi3.readDeepFindings(JSON.stringify({ findings: [{ name: "Oak Grove Montessori", what: "preschool", area: "Pasadena - voted best by parents" }] }), (n) => np3.looksLikePerson(n))[0];
  /* Since 26 Oct the area ends where the aside begins, so the claim after the
     dash is cut away and the town alone is printed. */
  ok("an area that is a claim is not printed", area?.area === "Pasadena", String(area?.area));

  /* M4: strict merge */
  const rec = (name: string, area: string | null) => ({ name, area });
  ok("M4: another town's branch with no area does not join", !d.samePlace({ name: "The Little Gym of Arcadia", area: null }, rec("Little Gym", "Pasadena")));
  ok("M4: nor 'Sunny Days Preschool - Arcadia'", !d.samePlace({ name: "Sunny Days Preschool - Arcadia", area: null }, rec("Sunny Days Preschool", "Pasadena")));
  ok("M4: 'Pasadena, CA' is Pasadena", d.samePlace({ name: "Little Gym", area: "Pasadena, CA" }, rec("Little Gym", "Pasadena")));
  ok("M4: the record's own town in the name joins", d.samePlace({ name: "Sunny Days Preschool of Altadena", area: null }, rec("Sunny Days Preschool", "Altadena")));
  ok("M4: the same branch, both towns named, joins", d.samePlace({ name: "The Little Gym of Pasadena", area: "Pasadena" }, rec("Little Gym", "Pasadena")));

  /* M3: a price only as a price */
  const fam3 = { children: "a 4 year old", home: "Altadena", travel_time: "under_20_min", budget: null, logistics: [] };
  const priced = { text: "Oak Tree 2 to 5 $1,150 a month", numbers: "a 4 year old 2 to 5 $1,150 20", minutes: [20], prices: "$1,150 a month" };
  const ok3 = (t: string, a: Parameters<typeof d.reportSentence>[1]) => "text" in d.reportSentence(t, a);
  ok("M3: '$4 a day' cannot borrow the child's age", !ok3("It costs $4 a day.", priced));
  ok("M3: '$20 a session' cannot borrow the travel limit", !ok3("It's $20 a session.", priced));
  ok("M3: the stated price passes", ok3("At $1,150 a month it fits a value budget.", priced));

  /* M7: ordinary sentences that were refused */
  const plain = { text: "Oak Tree Montessori preschool June August mornings in small groups", numbers: "" };
  ok("M7: months name nobody", ok3("It runs June to August, mornings only.", plain));
  ok("M7: 'kids like yours' is not hearsay", ok3("Good for kids like yours who need a slow start.", plain));
  ok("M7: 'the most convenient' is not a count", ok3("It is the most convenient of these for mornings.", plain));
  ok("M7: 'the last week of August' is not experience", ok3("Sign-ups close the last week of August.", plain) && ok3("It fills up by the last week of August.", plain));
  ok("M7: 'last summer' still is", !ok3("It was calm last summer.", plain));
  ok("M7: 'Great', 'Small', 'Flexible' open a sentence", ["Great for mornings.", "Small groups in the mornings.", "Flexible mornings."].every((t) => ok3(t, plain)));
  ok("an option called 'Our Kids Montessori' can be named", ok3("Our Kids Montessori runs mornings.", { text: "Our Kids Montessori mornings", numbers: "", names: ["Our Kids Montessori"] }));
  ok("but 'kids like it' is still reported experience", !ok3("Kids like it a lot.", plain));

  /* M2: a block too long for a part is left out before fitting, never glanced */
  const huge = { ...base, id: "p9", name: "Huge Place", what: "a school", area: "Pasadena", source: "parents" as const, firsthand: 2, km: 5, quote: "q".repeat(1600), warning: "One parent recently said it may no longer be worth it, so check before you book.", withdrawn: 1 };
  const small = { ...base, id: "p8", name: "Small Place", what: "a school", area: "Pasadena", source: "parents" as const, firsthand: 1, km: 5 };
  const fit = d.fitDeepDive({ question: "x", family, options: [huge, small], draft: null, offerAsk: false });
  const sentAll = fit.parts.join("\n");
  ok("M2: the oversize option is not glanced, counted or shown", !sentAll.includes("Huge Place") && fit.shown.every((o) => o.name !== "Huge Place") && sentAll.includes("I compared 1 place"), sentAll.slice(0, 300));
  ok("M2: and the one that fits is sent whole", sentAll.includes("1) Small Place"));

  /* M5: INTRO only for an option somebody can be asked about */
  const two = [{ ...small, id: "p1", name: "Asked Place" }, { ...small, id: "p2", name: "Quiet Place" }];
  const withIntro = d.renderDeepDive({ question: "x", family, options: two, draft: null, offerAsk: false, introducible: ["Quiet Place"] });
  ok("M5: the INTRO example is an option with somebody to ask", withIntro.includes("like INTRO Quiet Place."));
  ok("M5: and none when nobody can be asked", !d.renderDeepDive({ question: "x", family, options: two, draft: null, offerAsk: false, introducible: [] }).includes("INTRO"));
}
{
  /* H2: an attribution must be followed by a draft quote */
  const q = {
    draft: '2 parents near you have used Tiny Tots Gym, a class in Altadena.\nOne said: "The coaches are patient."',
    question: "toddler classes?",
    parents: [{ name: "Tiny Tots Gym", evidence: "2 parents near you", keep: [], tokens: [] }],
    publicNames: [], mustKeep: [], mustContain: [], max: 765,
  };
  ok("H2: the unchanged draft passes", v.acceptVoice(q.draft, q) !== null);
  ok("H2: 'another parent said <invented>' is refused", v.acceptVoice(q.draft + " And another parent said the coaches are kind.", q) === null);
  ok("H2: a name token saying invented words is refused", v.acceptVoice(q.draft.replace("2 parents near you have used Tiny Tots Gym", "{n1} has used Tiny Tots Gym") + " {n1} said the coaches are kind.", { ...q, parents: [{ name: "Tiny Tots Gym", evidence: "{n1} has", keep: [], tokens: ["{n1}"] }] }) === null);
  ok("H2: 'one parent said' before the draft's own quote passes", v.acceptVoice(q.draft.replace('One said: "The coaches are patient."', 'One parent said: "The coaches are patient."'), q) !== null);
}
{
  /* routing, as source: commands reach their own step */
  const inbound = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  ok("H3/M3: INTRO or DEEP is never taken as a capture answer or a Network Ask reply", inbound.includes("if (capture && !isCommand(body))") && inbound.includes("const attached = isCommand(body)"));
  ok("M1: a yes for a newer deep-dive or intro offer is left for it", inbound.includes("const ours = latest > newerOffer;"));
  ok("H2: no 'any others?' answer after another step answered the message", inbound.includes("!answeredSomething && !clarified && asksForMore(body)"));
  ok("H1: a short question is not a first name", inbound.includes('pending === "first_name" &&'));
  const step = fs.readFileSync(new URL("../lib/server/deep-dive.ts", import.meta.url), "utf8");
  ok("M2: a bare yes is the deep dive's only when no newer intro offer is open", step.includes("newerIntro"));
  ok("M4: a person's name or an INTRO is not a deep-dive topic", step.includes("if (looksLikePerson(body).person) return false;") && step.includes("if (acceptsIntro(body) || introTarget(body) !== null) return false;"));
  ok("L3: a new subject while one is in flight is told why", step.includes("DEEP_DIVE_BUSY"));
  const repoDd = fs.readFileSync(new URL("../lib/server/repo/deep-dives.ts", import.meta.url), "utf8");
  ok("L2: an offer older than a deep dive they have since had is spent", repoDd.includes("and d.created_at > o.created_at"));
}


console.log("\n=== the deep dive runs on Sonnet 5.5 (22 Oct) ===");
{
  const dd = fs.readFileSync(new URL("../lib/server/deep-dive.ts", import.meta.url), "utf8");
  const ws = fs.readFileSync(new URL("../lib/server/web-search.ts", import.meta.url), "utf8");
  ok("the report is drafted on Sonnet 5.5", /const MODEL = "claude-sonnet-5-5";/.test(dd));
  const factsFn = dd.slice(dd.indexOf("function factsOf("), dd.indexOf("async function draft("));
  ok("the writer never sees a parent's count, words or price (22 Oct)", !/firsthand|quote|caveat|who_for|o\.price|named_by/.test(factsFn));
  ok("and never asks it to disable thinking (a 400 on Sonnet 5.5)", !/thinking: \{ type: "disabled" \}/.test(dd));
  ok("with the server-side refusal fallback on", dd.includes('fallbacks: "default"') && dd.includes('"server-side-fallback-2026-07-01"'));
  ok("and room for thinking in max_tokens", /max_tokens: 16000/.test(dd));
  const deepFn = ws.slice(ws.indexOf("async function deepSearchText("), ws.indexOf("async function searchOnce("));
  ok("the deep search is Sonnet 5.5 with the newer web search tool", ws.includes('const DEEP_MODEL = "claude-sonnet-5-5";') && ws.includes('const DEEP_SEARCH_TOOL = "web_search_20260209"') && deepFn.includes("model: DEEP_MODEL"));
  ok("it resumes a paused server-side search instead of dropping it", deepFn.includes('response.stop_reason === "pause_turn"'));
  ok("the ordinary search stays on Haiku 5.5 with web_search_20250305", ws.includes('const MODEL = "claude-haiku-5-5";') && ws.includes('const SEARCH_TOOL = "web_search_20250305"'));
}


console.log("\n=== a thin deep search runs once more (22 Oct, measured live: 1 place one run, 8 the next) ===");
{
  const wsSrc = fs.readFileSync(new URL("../lib/server/web-search.ts", import.meta.url), "utf8");
  ok("a deep search with too few places that say something is searched again", wsSrc.includes("const said = (first.deep ?? []).filter(substantive).length;") && wsSrc.includes("if (input.deep && first.configured && said < DEEP_MIN_FINDINGS && (!namesItsPlaces || said === 0))"));
  ok("the minimum is a real number of options (3 to 6)", (() => { const m = wsSrc.match(/const DEEP_MIN_FINDINGS = (\d+);/); return !!m && Number(m[1]) >= 3 && Number(m[1]) <= 6; })());
  ok("and the two are joined, one place never twice, the fuller copy kept", wsSrc.includes("const i = deep.findIndex((d) => sameName(d.name, f.name));") && wsSrc.includes("if (fieldCount(f) > fieldCount(deep[i])) deep[i] = f;"));
  ok("22 Oct: a question that names its places is not searched again unless nothing said anything", wsSrc.includes('const namesItsPlaces = shape === "compare" || shape === "single";'));
  ok("22 Oct: the retry is smaller than the first search (6 searches, 4 pages)", wsSrc.includes("const DEEP_RETRY: DeepLimits = { searches: 6, fetches: 4 };") && wsSrc.includes("await searchOnce(input, DEEP_RETRY)") && wsSrc.includes("max_uses: limits.searches") && wsSrc.includes("max_uses: limits.fetches"));
  ok("22 Oct: places the question names are researched fully, outside the two-search cap", wsSrc.includes("Places the question itself NAMES are not under that limit"));
  ok("22 Oct: the deep search is told about past seasons", wsSrc.includes("never report a past season's sold out, closed or wait list"));
}


console.log("\n=== the deep search researches the question, not a form (22 Oct, the developer: like ChatGPT) ===");
{
  const free = () => ({ person: false });
  const raw = JSON.stringify({
    focus: ["how anxious young children are handled", "what the first visit is like", "parents rave about it", "see happykids.com", "sedation options", "fifth point"],
    findings: [
      {
        name: "Bright Teeth Pediatric Dentistry",
        what: "pediatric dental practice",
        area: "Pasadena",
        answers: [
          "The first visit is a tour and a ride in the chair, with no treatment.",
          "Parents say the staff are so gentle.",
          "Book at happyteeth.com/first-visit.",
          "Nitrous oxide is offered for anxious children.",
          "Kids sit with a parent for the whole exam.",
          "Treatment rooms have ceiling TVs.",
        ],
        ages: null,
        schedule: null,
        price: null,
        highlights: [],
        summary: null,
        site: null,
      },
      { name: "Tony S. Hwang DDS", what: "pediatric dentist", answers: ["Sees children from age 1."] },
      { name: "Dr. Lee Kids Dental", what: "pediatric dentist", answers: [] },
      { name: "Arroyo Kids Dental", what: "pediatric dental practice", answers: "not a list" },
    ],
  });
  const got = pi.readDeepFindings(raw, free);
  const teeth = got.find((f) => f.name === "Bright Teeth Pediatric Dentistry");
  ok("a place's answers are read", (teeth?.answers ?? []).includes("The first visit is a tour and a ride in the chair, with no treatment."));
  ok("an answer that reports what parents say is dropped (invariant 3)", !(teeth?.answers ?? []).some((a) => /parents say/i.test(a)));
  ok("an answer carrying a link is dropped", !(teeth?.answers ?? []).some((a) => /happyteeth/i.test(a)));
  ok("at most four answers", (teeth?.answers.length ?? 0) <= 4 && (teeth?.answers.length ?? 0) >= 3);
  ok("a practice named after its practitioner is never a finding (DDS)", !got.some((f) => /Hwang/.test(f.name)));
  ok("nor one that opens with Dr.", !got.some((f) => /^Dr\.? /.test(f.name)));
  ok("answers that are not a list read as none", got.find((f) => f.name === "Arroyo Kids Dental")?.answers.length === 0);
  const focus = pi.readDeepFocus(raw);
  ok("the focus is read", focus.includes("how anxious young children are handled") && focus.includes("sedation options"));
  ok("a focus that is praise or a link is dropped", !focus.some((f) => /rave|happykids/.test(f)));
  ok("at most four focus points", focus.length <= 4);
  ok("no focus, no JSON: an empty list", pi.readDeepFocus("nothing here").length === 0 && pi.readDeepFocus('{"findings":[]}').length === 0);

  /* The ordinary search's credential filter was a regex with a literal backspace
     byte where \b was meant, so it matched nothing (found 22 Oct). */
  const plain = pi.readFindings(JSON.stringify({ findings: [{ name: "Tony S. Hwang DDS", what: "pediatric dentist" }, { name: "Pasadena Children's Dentistry", what: "pediatric dental practice" }] }), free);
  ok("the ordinary search drops a DDS practice too", !plain.some((f) => /Hwang/.test(f.name)));
  ok("and keeps a practice with an ordinary name", plain.some((f) => f.name === "Pasadena Children's Dentistry"));
  ok("and a name merely containing DO or MD in a word is kept", pi.readFindings(JSON.stringify({ findings: [{ name: "Kiddo Swim Academy", what: "swim school" }] }), free).length === 1);
  const piSrc = fs.readFileSync(new URL("../lib/public-info.ts", import.meta.url), "utf8");
  ok("public-info.ts carries no control characters", !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(piSrc));

  /* The answers travel to the writer and into the facts paragraph. */
  const finding = { name: "Bright Teeth Pediatric Dentistry", what: "pediatric dental practice", area: "Pasadena", ages: null, schedule: null, price: null, highlights: [], summary: null, answers: ["The first visit is a tour and a ride in the chair, with no treatment."], site: null };
  const joined = d.withWebFacts([], [finding], { same: pi.sameName, area: (a) => a, max: 12 });
  ok("withWebFacts carries the answers", joined[0]?.web?.answers?.[0] === finding.answers[0]);
  const para = d.factsParagraph({ ...opts[2], web: { what: "pediatric dental practice", ages: null, schedule: null, price: null, highlights: [], answers: finding.answers, site: null } }) ?? "";
  ok("the facts paragraph leads with what the question turns on", para.includes("The first visit is a tour and a ride in the chair, with no treatment."));

  const wsSrc = fs.readFileSync(new URL("../lib/server/web-search.ts", import.meta.url), "utf8");
  ok("the deep brief asks what the question turns on first", wsSrc.includes("First decide what this parent needs to know to choose"));
  ok("and reads the places' own pages", /type: DEEP_FETCH_TOOL, name: "web_fetch"/.test(wsSrc) && /const DEEP_FETCH_TOOL = "web_fetch_20260209"/.test(wsSrc));
  ok("the brief still refuses praise, ratings and reviews", wsSrc.includes("No praise, ratings, reviews, testimonials"));
  ok("the search returns its focus", wsSrc.includes("focus: readDeepFocus(text)"));
  const ddSrc = fs.readFileSync(new URL("../lib/server/deep-dive.ts", import.meta.url), "utf8");
  ok("the writer is given what the question turns on", ddSrc.includes("question_turns_on: input.focus ?? []") && ddSrc.includes("on_what_the_question_turns_on: w.answers ?? []"));
  ok("the answers are facts a sentence may draw on", ddSrc.includes("...(w.answers ?? [])"));
  ok("and the writer is told not to list everything a page leaves out", ddSrc.includes("never list everything a page leaves"));
  const inSrc = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  ok("inbound makes the answers GSM-7 and passes the focus", inSrc.includes("answers: f.answers.map(sendableNote)") && inSrc.includes("focus: publicInfo.focus ?? []"));
}


console.log("\n=== a sentence never ends at an abbreviation (22 Oct run: \"Jr. Vets\" went out as \"Vets\") ===");
{
  const a = {
    text: "Jr. Vets at Pasadena Humane a camp St. Mark's School Pasadena a 7 year old 7 to 10 9 a.m. 3 p.m.",
    numbers: "a 7 year old 7 to 10 9 3",
    minutes: [15, 20],
    max: 900,
  };
  const jr = d.keepSentences("Jr. Vets at Pasadena Humane is a camp for ages 7 to 10. Your 7 year old is at the youngest end.", a);
  ok("\"Jr. Vets\" keeps its \"Jr.\"", (jr.text ?? "").startsWith("Jr. Vets at Pasadena Humane"), JSON.stringify(jr.text));
  const st = d.keepSentences("It runs at St. Mark's School in Pasadena. Drop-off is at 9 a.m. Pickup is at 3 p.m.", a);
  ok("\"St. Mark's\" stays one sentence", (st.text ?? "").includes("It runs at St. Mark's School in Pasadena."), JSON.stringify(st.text));
  ok("but a sentence ending \"9 a.m.\" still ends there", (st.text ?? "").includes("Drop-off is at 9 a.m. Pickup is at 3 p.m."), JSON.stringify(st.text));
  const plainTwo = d.keepSentences("It is a camp in Pasadena. It suits a 7 year old.", a);
  ok("ordinary sentences still split and both stay", plainTwo.text === "It is a camp in Pasadena. It suits a 7 year old.", JSON.stringify(plainTwo.text));
}


console.log("\n=== web text: praise, testimony and named staff refused; towns, streets and grades kept (safety + Deep Dive reviews, 22 Oct) ===");
{
  const npx = (await import(`../lib/named-person.ts?v=${Date.now()}`)) as typeof import("../lib/named-person");
  const piS = (await import(`../lib/public-info.ts?v=${Date.now()}`)) as typeof import("../lib/public-info");
  const towns = ["South Pasadena", "Pasadena", "Altadena", "San Marino", "La Canada Flintridge"];
  const isP = (n: string) => npx.looksLikePerson(n, { placeWords: towns });
  const answersOf = (answers: string[], name = "Bright Teeth Pediatric Dentistry") =>
    piS.readDeepFindings(JSON.stringify({ findings: [{ name, what: "pediatric dental practice", answers }] }), isP)[0]?.answers ?? [];
  const refused = [
    "Families keep returning year after year for the calm rooms.",
    "Parents appreciate the gentle, unhurried first visit.",
    "Kids absolutely adore the hygienists.",
    "Kids can't stop talking about the treasure chest.",
    "Our families describe the staff as patient.",
    "Many families find the first visit easy.",
    "Parents consistently say the staff are kind.",
    "Widely praised for its calm approach.",
    "Children look forward to every visit.",
    "Glowing feedback from parents about the first visit.",
    "Scores 4.9 on Facebook from over 300 families.",
    "Sarah walks nervous kids through each step.",
    "Our hygienist, Maria, explains every tool before using it.",
    "Pediatric dentist Kim sees every new patient herself.",
    "The doctor, Kim, uses tell-show-do with every child.",
    "Kim, DDS, sees children from age 1.",
    "José Muñoz leads the toddler swim class.",
  ];
  for (const t of refused) ok(`refused: ${t}`, answersOf([t]).length === 0);
  const kept = [
    "The first visit is a tour and a ride in the chair, with no treatment.",
    "Parents stay in the room for the whole exam.",
    "Kids sit with a parent for the whole exam.",
    "Classes run on Saturdays at the South Pasadena pool.",
    "Grades K-8 are offered in weekly sessions.",
    "The office is on Fair Oaks Avenue near Arroyo Blvd.",
    "Extended care runs to 6pm for an extra fee.",
    "Built for kids who are new to the water.",
    "Nitrous oxide is offered for anxious children.",
  ];
  for (const t of kept) ok(`kept: ${t}`, answersOf([t]).length === 1, JSON.stringify(answersOf([t])));
  ok("the place's own name is never a person: \"Kidspace runs weekly themed camps.\"", answersOf(["Kidspace runs weekly themed camps."], "Kidspace Children's Museum").length === 1);

  const names = (n: string) => piS.readDeepFindings(JSON.stringify({ findings: [{ name: n, what: "pediatric dentist" }] }), isP).length;
  for (const n of ["Tony Hwang, D.D.S.", "Kim Pediatrics, M.D.", "Smiles by Dr. Kim", "The Office of Dr. Sarah Kim", "Hwang dds"]) ok(`a practitioner's practice is not a place: ${n}`, names(n) === 0);
  for (const n of ["Pasadena Children's Dentistry", "Kiddo Swim Academy", "Rose Bowl Aquatics Center", "Do Re Mi Music Studio"]) ok(`an ordinary place name is kept: ${n}`, names(n) === 1);
  ok("the ordinary search drops them too", piS.readFindings(JSON.stringify({ findings: [{ name: "Smiles by Dr. Kim", what: "dentist" }] }), isP).length === 0);
  ok("and drops a detail that is a testimony", (piS.readFindings(JSON.stringify({ findings: [{ name: "Bright Teeth", what: "dentist", detail: "Families keep returning; kids absolutely adore the hygienists" }] }), isP)[0]?.detail ?? null) === null);

  ok("the report's testimony pattern is the same as the web reader's", piS.TESTIMONY.source === d.REPORT_TESTIMONY.source && piS.TESTIMONY.flags === d.REPORT_TESTIMONY.flags);

  /* The writer's sentences. */
  const a = {
    text: "Bright Teeth Pediatric Dentistry Kim a dental practice Pasadena a 3 year old first visit Kidspace Galileo",
    numbers: "a 3 year old 95 470 540 15 20",
    minutes: [15, 20],
    prices: "$95 $470 $540",
    isPerson: (w: string) => npx.looksLikePerson(w).person === true,
  };
  const pass = (t: string) => "text" in d.reportSentence(t, a);
  ok("\"Dr. Kim sees every child\" is refused even with Kim in the facts", !pass("Dr. Kim sees every child in a private room."));
  for (const t of [
    "Families describe the staff as patient.",
    "It was voted the top practice in Pasadena.",
    "Its testimonials mention a calm first visit.",
    "Kids absolutely adore the hygienists here.",
    "Parents consistently say the first visit is calm.",
  ]) ok(`writer refused: ${t}`, !pass(t));
  for (const t of [
    "So I can't say yes or no without the price.",
    "Then I'd call Kidspace first.",
    "It runs $470 to $540, the lowest here.",
    "It is the best match for your hours.",
  ]) ok(`writer kept: ${t}`, pass(t), JSON.stringify(d.reportSentence(t, a)));
  const brace = d.keepSentences("I'd start with Kidspace for the hours.}", { ...a, max: 400 });
  ok("a stray brace off the JSON does not cost the sentence", brace.text === "I'd start with Kidspace for the hours.", JSON.stringify(brace));
}

console.log("\n=== the length review (22 Oct): the shape is decided in code and caps the report ===");
{
  const towns = ["Altadena", "Pasadena", "South Pasadena", "La Canada Flintridge", "Arcadia"];
  const kind = (q: string) => d.deepDiveShape(q, { towns }).kind;
  const live: Array<[string, string]> = [
    ["what are the best preschools near Pasadena for a shy 4 year old?", "open"],
    ["summer day camps for my 7 year old in Altadena or Pasadena in July", "open"],
    ["which pediatric dentist near South Pasadena is good with a nervous 3 year old?", "open"],
    ["weekend swim lessons for a 2 year old in Pasadena", "open"],
    ["give me the top 8 after-school programs for my 9 year old near Pasadena", "top"],
    ["Kidspace camp or Camp Galileo for my 7 year old this July - which is better for us?", "compare"],
    ["is Rose Bowl Aquatics a good place for my 2 year old to learn to swim?", "single"],
  ];
  for (const [q, want] of live) ok(`the live question "${q.slice(0, 50)}..." is ${want}`, kind(q) === want, kind(q));
  const more: Array<[string, string]> = [
    ["Kidspace vs Galileo for July", "compare"],
    ["compare Kidspace and Galileo for my 7 year old", "compare"],
    ["Kidspace or Galileo?", "compare"],
    ["what about Kidspace?", "single"],
    ["Is the Pasadena Humane camp any good for an 8 year old?", "single"],
    ["is there a good swim school near us?", "open"],
    ["swim or gymnastics for a 3 year old?", "open"],
    ["the best 2 year old swim classes near Altadena", "open"],
    ["top five camps near Altadena", "top"],
    ["which is better for us?", "open"],
  ];
  for (const [q, want] of more) ok(`"${q}" is ${want}`, kind(q) === want, kind(q));
  const top8 = d.deepDiveShape("give me the top 8 after-school programs for my 9 year old", { towns });
  ok("a top-N question gets N blocks, never capped below the number asked", top8.n === 8 && top8.detailed === 8 && top8.maxParts === d.DEEP_DIVE_MAX_PARTS);
  ok("top 20 is held to the twelve-block ceiling", d.deepDiveShape("top 20 camps").detailed === d.DEEP_DIVE_MAX_DETAILED);
  const open = d.deepDiveShape("preschools near us");
  ok("an open question: five blocks at most, about three parts", open.detailed === 5 && open.parts === 3 && open.maxParts === 4);
  const cmp = d.deepDiveShape("Kidspace vs Galileo");
  ok("compare and single: about two parts", cmp.parts === 2 && d.deepDiveShape("is Kidspace any good?").parts === 2);
  ok("the writer's room follows the shape", d.deepDiveRoom(cmp) < d.deepDiveRoom(open) && d.deepDiveRoom(open) < d.deepDiveRoom());

  const o = (id: string, name: string, extra: Partial<import("../lib/deep-dive").DeepOption> = {}) =>
    ({ ...base, id, name, what: "a camp", area: "Pasadena", source: (id.startsWith("p") ? "parents" : "public") as "parents" | "public", firsthand: id.startsWith("p") ? 1 : 0, ...extra });
  const vs = [o("p1", "Kidspace Children's Museum"), o("p2", "Camp Galileo Pasadena"), o("w1", "Stratford School Altadena Allen summer camp"), o("w2", "Steve & Kate's Camp Pasadena"), o("w3", "Camp Galileo South Pasadena (Holy Family School)")];
  const named = d.namedInQuestion("Kidspace camp or Camp Galileo for my 7 year old this July - which is better for us?", vs, towns);
  ok("the places the question names: Kidspace and one Galileo, not both branches", JSON.stringify(named) === JSON.stringify(["p1", "p2"]), JSON.stringify(named));
  const vsOrder = d.shapeOrder({ order: ["p1", "p2", "w2", "w3", "w1"], also: [] }, vs, d.deepDiveShape("Kidspace camp or Camp Galileo - which is better?", { towns }), named);
  ok("compare: only the named places get a block; the rest are named in one line", JSON.stringify(vsOrder.order) === JSON.stringify(["p1", "p2"]) && vsOrder.also.join() === "w2,w3,w1", JSON.stringify(vsOrder));

  const answered = { what: "a camp", ages: null, schedule: null, price: null, highlights: [], answers: ["Small groups of six."], site: null };
  const pre = [
    o("w1", "Altadena Nursery School", { web: { what: "nursery school", ages: null, schedule: null, price: null, highlights: [], site: "a.org" } }),
    o("p1", "Pasadena Waldorf School", { quote: "A slow, gentle start." }),
    o("w2", "Pasadena Montessori School", { web: { ...answered } }),
    o("w3", "Bridge Montessori", { web: { what: "Montessori", ages: null, schedule: null, price: null, highlights: [], site: null } }),
    o("p2", "Walden School", { quote: "Paired my son with a buddy." }),
  ];
  const openOrder = d.shapeOrder({ order: ["w1", "p1", "w2", "w3", "p2"], also: [] }, pre, open, []);
  ok("open: a place with nothing on the question and no parent record goes to 'also', not a block", JSON.stringify(openOrder.order) === JSON.stringify(["p1", "w2", "p2"]) && openOrder.also.includes("w1") && openOrder.also.includes("w3"), JSON.stringify(openOrder));
  const thin = d.shapeOrder({ order: ["w1", "w3"], also: [] }, [pre[0], { ...pre[3], web: { ...pre[3].web!, summary: "A Montessori school." } }], open, []);
  ok("open: with too few, a place whose page at least describes it tops up - one with a name only never does", JSON.stringify(thin.order) === JSON.stringify(["w3"]), JSON.stringify(thin));
  const many12 = Array.from({ length: 10 }, (_, i) => o(`w${i + 1}`, `Place ${i + 1}`, { web: { ...answered } }));
  ok("top N: the writer's order is cut to N", d.shapeOrder({ order: many12.map((x) => x.id), also: [] }, many12, top8, []).order.length === 8);
  const single = d.shapeOrder({ order: ["w1", "w2", "w3", "p1"], also: [] }, [o("p1", "Rose Bowl Aquatics Center"), ...many12.slice(0, 3)], d.deepDiveShape("is Rose Bowl Aquatics any good?", { towns }), ["p1"]);
  ok("single: the named place first, then at most two alternatives", JSON.stringify(single.order) === JSON.stringify(["p1", "w1", "w2"]), JSON.stringify(single));

  /* 26 Oct, the SMS lab: every report had parent_options 0 — the writer ranked pages only. */
  const top5 = d.deepDiveShape("what are the top 5 summer camps for a 7 year old near Pasadena?", { towns });
  const camps = [...many12.slice(0, 7), o("p1", "Tom Sawyer Camps", { quote: "Outdoors, low-tech." }), o("p2", "Kidspace summer camp", { quote: "Hands-on science." })];
  const webOnly = d.shapeOrder({ order: ["w1", "w2", "w3", "w4", "w5", "w6"], also: [] }, camps, top5, []);
  ok(
    "top N with no parents' place in the writer's order: two are added at the end, the writer's order kept",
    JSON.stringify(webOnly.order) === JSON.stringify(["w1", "w2", "w3", "p1", "p2"]) && webOnly.also.includes("w4"),
    JSON.stringify(webOnly),
  );
  ok("and never first", webOnly.order[0] === "w1");
  const kept = d.shapeOrder({ order: ["w1", "p2", "w2", "w3", "w4"], also: [] }, camps, top5, []);
  ok("a writer's order that already has one is left alone", JSON.stringify(kept.order) === JSON.stringify(["w1", "p2", "w2", "w3", "w4"]), JSON.stringify(kept));
  const cautioned = [...many12.slice(0, 7), o("p1", "Tom Sawyer Camps", { withdrawn: 1 }), o("p2", "Old Camp", { stale: true })];
  ok(
    "a withdrawn or old parents' record is never added",
    JSON.stringify(d.shapeOrder({ order: ["w1", "w2", "w3", "w4", "w5"], also: [] }, cautioned, top5, []).order) === JSON.stringify(["w1", "w2", "w3", "w4", "w5"]),
  );
  const small = d.shapeOrder({ order: ["w1", "w2"], also: [] }, camps, { ...open, detailed: 3 }, []);
  ok("three or fewer blocks: one is added, in the free slot", JSON.stringify(small.order) === JSON.stringify(["w1", "w2", "p1"]), JSON.stringify(small));

  /* The parents' tie-break: one place up, past a thin public one, never into first place. */
  const tb = [o("w1", "A", { web: { ...answered } }), o("w2", "B", { web: { ...answered, answers: [] } }), o("p1", "C"), o("w3", "D", { web: { ...answered } }), o("p2", "E")];
  ok("tie-break: a clean parents' option moves above a public one with nothing on the question, ranked right above it", d.parentTieBreak(["w1", "w2", "p1"], tb).join() === "w1,p1,w2");
  ok("tie-break: never past a public place whose pages answer the question", d.parentTieBreak(["w1", "w3", "p2"], tb).join() === "w1,w3,p2");
  ok("tie-break: never into first place - the writer's first pick is what its bottom line names", d.parentTieBreak(["w2", "p1"], tb).join() === "w2,p1");
  ok("tie-break: one place only, not a climb", d.parentTieBreak(["w1", "w2", "w2b", "p1"].filter((x) => x !== "w2b"), tb).join() === "w1,p1,w2");
  const withdrawn = [...tb.slice(0, 2), o("p1", "C", { withdrawn: 1, warning: "One parent recently said it may no longer be worth it, so check before you book." })];
  ok("tie-break: a withdrawn record never moves up", d.parentTieBreak(["w1", "w2", "p1"], withdrawn).join() === "w1,w2,p1");

  /* What the writer is told Pando prints below: kinds, never words or counts. */
  const kinds = d.pandoPrintsBelow({ ...opts[0], tip: "Ask about the 3-day option." });
  ok("pando_prints_below names the kinds of line", JSON.stringify(kinds) === JSON.stringify(["a parent's words", "who it suits", "a heads-up", "a tip", "what parents paid"]), JSON.stringify(kinds));
  ok("and never a parent's words or a number", !/teachers|waitlist|Shy|\d/.test(kinds.join(" ")));
  ok("a public place has none", d.pandoPrintsBelow(opts[2]).length === 0);
  const ddSrc = fs.readFileSync(new URL("../lib/server/deep-dive.ts", import.meta.url), "utf8");
  ok("the writer is given them, and told not to call a covered thing unknown", ddSrc.includes("pando_prints_below: pandoPrintsBelow(o)") && ddSrc.includes("missing when `pando_prints_below` covers it"));
  ok("the writer gets today's month and the season rule", ddSrc.includes("today: todayPhrase()") && ddSrc.includes("Sold out, closed or wait-listed in a past season is not current advice"));
  ok("the opening starts with the answer and never restates the family's details", ddSrc.includes("START WITH THE ANSWER") && ddSrc.includes("Never restate the child's age, the area"));
  ok("no word about a missing drive time; a watch never repeats the paragraph", ddSrc.includes("Never mention a missing drive time") && ddSrc.includes("Never repeat what the"));
  ok("the writer's order is held to the shape in readDraft", ddSrc.includes("const held = shapeOrder("));
  ok("a record with no page gets one short sentence, never 'I found no page for it'", ddSrc.includes("never 'I found no page for it'"));

  /* One option's price is never pinned on another (safety review, proved). */
  const teeth = [
    { names: d.optionAliases("Bright Teeth Pediatric Dentistry", towns), prices: "Bright Teeth Pediatric Dentistry pediatric dental practice", numbers: "Bright Teeth Pediatric Dentistry" },
    { names: d.optionAliases("Arroyo Kids Dental", towns), prices: "The first visit costs $95.", numbers: "The first visit costs $95." },
  ];
  const across = { text: "Bright Teeth Pediatric Dentistry Arroyo Kids Dental first visit a 3 year old", numbers: "a 3 year old Bright Teeth $95 95 15 20", minutes: [15, 20], byOption: teeth, common: "a 3 year old 15 20 2026" };
  const say = (t: string) => "text" in d.reportSentence(t, across);
  ok("refused: another option's price on the place the sentence names", !say("Bright Teeth Pediatric Dentistry charges $95 for the first visit."));
  ok("refused: by its short name too", !say("Bright Teeth charges $95 for the first visit."));
  ok("kept: the price beside its own place", say("Arroyo Kids Dental charges $95 for the first visit."));
  ok("kept: a comparison naming both, each price after its own place", say("Arroyo Kids Dental charges $95 for the first visit, and Bright Teeth lists no price."));
  ok("refused: a price after the other place's name", !say("Arroyo Kids Dental lists the first visit, while Bright Teeth charges $95."));
  ok("refused: a price no place in the sentence owns", !say("The first visit costs $95."));
  ok("kept: the child's age and a drive time are anyone's", say("Bright Teeth is about 15 minutes away for a 3 year old."));
  ok("a paragraph about a place may cite its own price with no name before it", "text" in d.reportSentence("The first visit costs $95.", { ...across, self: 1 }) && !("text" in d.reportSentence("The first visit costs $95.", { ...across, self: 0 })));
  ok("aliases are the distinguishing words, never a town or a generic word", JSON.stringify(d.optionAliases("Camp Galileo South Pasadena (Holy Family School)", towns)) === JSON.stringify(["Camp Galileo South Pasadena (Holy Family School)", "Galileo", "Holy"]), JSON.stringify(d.optionAliases("Camp Galileo South Pasadena (Holy Family School)", towns)));

  /* A parents' record always appears. */
  const conservatory = { ...base, id: "p2", name: "Pasadena Conservatory of Music", what: "a class", area: "Pasadena", source: "parents" as const, firsthand: 1 };
  const robots = { ...base, id: "w1", name: "Rolling Robots", what: "a class", area: "Pasadena", source: "public" as const, firsthand: 0 };
  const lost = d.renderDeepDive({ question: "top 8", family, options: [robots, conservatory], draft: { order: ["w1"], also: [], text: {}, watch: {}, bottom_line: null }, offerAsk: false });
  ok("a clean parents' record the writer left out is named in 'Also used by parents near you'", lost.includes("Also used by parents near you: Pasadena Conservatory of Music (Pasadena)."), lost);
  const lostWithdrawn = d.renderDeepDive({ question: "top 8", family, options: [robots, { ...conservatory, withdrawn: 1, warning: "One parent recently said it may no longer be worth it, so check before you book." }], draft: { order: ["w1"], also: [], text: {}, watch: {}, bottom_line: null }, offerAsk: false });
  ok("but a withdrawn one is still never listed bare", !lostWithdrawn.includes("Conservatory"));
  ok("the verbatim label line stays when the opening replaces the 'weighed' line", lost.includes("I compared 2 places. What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents.") || lost.includes("I compared 2 places."));

  /* The same name in another town: words only. */
  const waldorf = { ...base, id: "p1", name: "Pasadena Waldorf School", what: "a school", area: "Altadena", source: "parents" as const, firsthand: 2 };
  const wf = { name: "Pasadena Waldorf School", what: "Waldorf early childhood program", area: "Pasadena", ages: "3 to 6", schedule: "8am-1pm", price: "$1,800 a month", highlights: ["forest days"], summary: "A Waldorf kindergarten with a long outdoor morning.", answers: ["New children start with short mornings and a parent nearby.", "Classes have 12 children and 2 teachers."], site: "pasadenawaldorf.org" };
  const joinedW = d.withWebFacts([waldorf], [wf], { same: pi.sameName, area: (a) => a, max: 12 });
  const ww = joinedW[0]?.web;
  ok("same name, another town: the page's words join the parents' record", ww?.summary === wf.summary && ww?.what === wf.what && (ww?.answers ?? []).includes(wf.answers[0]));
  ok("but never its price, ages, hours, numbers or site", ww?.price === null && ww?.ages === null && ww?.schedule === null && ww?.site === null && !(ww?.answers ?? []).some((a) => /\d/.test(a)) && (ww?.highlights.length ?? 1) === 0);
  ok("and the finding is not listed again as a public option", joinedW.length === 1);
  ok("a branch with extra words is still never joined loosely", d.withWebFacts([{ ...waldorf, name: "Kumon" }], [{ ...wf, name: "Kumon - Arcadia", area: "Arcadia" }], { same: pi.sameName, area: (a) => a, max: 12 })[0].web === null);
  ok("a strict join still wins over a loose one", d.withWebFacts([waldorf, { ...waldorf, id: "p2", area: "Pasadena" }], [wf], { same: pi.sameName, area: (a) => a, max: 12 }).find((x) => x.id === "p2")?.web?.price === "$1,800 a month");

  /* Small ones. */
  ok("'about about' never: a record that already says about", d.pricePhrase("about $500 a week") === "about $500 a week" && d.pricePhrase("$500 a week") === "about $500 a week" && d.pricePhrase("free") === "free" && d.pricePhrase("around $20") === "around $20" && d.pricePhrase(null) === null);
  ok("refused: 'a solid care option' is praise", !passes("It's a solid care option for a 4 year old."));
  ok("refused: 'a solid second look'", !passes("Oak Grove Montessori is a solid second look."));
  ok("kept: 'solid foods' is a plain word", passes("The class introduces solid foods in Altadena."));
  ok("kept: a place called 'Solid Rock' is named", passes("Solid Rock runs mornings only.", { ...allowed, text: allowed.text + " Solid Rock", names: ["Solid Rock"] }));
  ok("a year passes as a number when given (the season rule)", "text" in d.reportSentence("Its 2026 summer weeks are over.", { text: "summer weeks", numbers: "2025 2026 2027" }));
  ok("'last summer' is still refused - the writer is told to use the year", !passes("It was wait-listed last summer."));

  /* The fit holds to the shape's parts. */
  const longOpts = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `w${i + 1}`, name: `Place ${i + 1}`, what: "a camp", area: "Pasadena", source: "public" as const, firsthand: 0, web: { what: "camp", ages: "5 to 12", schedule: null, price: null, highlights: [], summary: "s".repeat(1000), site: null } }));
  const fit2 = d.fitDeepDive({ question: "x", family, options: longOpts, draft: { order: longOpts.map((x) => x.id), also: [], text: {}, watch: {}, bottom_line: null, max_parts: 2 }, offerAsk: false });
  ok("fitDeepDive holds to the shape's most parts", fit2.parts.length <= 2, String(fit2.parts.length));
}

console.log("\n=== numbers in words, and what a place has (adversarial review, 26 Oct) ===");
{
  /* The review's own cases: each was kept while "$50" was refused. */
  const kid = { names: d.optionAliases("Kidspace Children's Museum", []), prices: "Kidspace Children's Museum camp $595 a week ages 5 to 8", numbers: "Kidspace Children's Museum camp $595 a week ages 5 to 8" };
  const gal = { names: d.optionAliases("Camp Galileo Pasadena", []), prices: "Camp Galileo $450 to $540 a week, 9am-3pm, two campuses", numbers: "Camp Galileo $450 to $540 a week, 9am-3pm, two campuses", facts: "Camp Galileo STEAM day camp, nut-free snack breaks, before and after care, two campuses" };
  const a = { text: "Kidspace Children's Museum Camp Galileo Pasadena camp a 7 year old", numbers: "a 7 year old 595 450 540 15 20", minutes: [15, 20], byOption: [kid, gal], common: "a 7 year old 15 20 2026", names: ["Kidspace Children's Museum", "Camp Galileo Pasadena"] };
  const says = (t: string, x: Parameters<typeof d.reportSentence>[1] = a) => "text" in d.reportSentence(t, x);
  const why = (t: string, x: Parameters<typeof d.reportSentence>[1] = a) => JSON.stringify(d.reportSentence(t, x));
  ok("refused: 'fifty dollars a visit' — a price in words no page holds", !says("Kidspace costs fifty dollars a visit."), why("Kidspace costs fifty dollars a visit."));
  ok("refused: 'twelve minutes away' — a drive time in words", !says("Kidspace is twelve minutes away."), why("Kidspace is twelve minutes away."));
  ok("refused: 'twenty-five kids', 'a dozen campers', 'fifteen hundred dollars'", !says("Kidspace takes twenty-five kids a week.") && !says("Kidspace groups a dozen campers.") && !says("Galileo costs fifteen hundred dollars."));
  ok("refused: 'four campuses' when its page says two; a measure two words on still counts", !says("Galileo runs on four campuses.") && !says("Kidspace has two Olympic-size pools."));
  ok("refused: 'one week' is a number when a measure follows", !says("Kidspace sells one week at a time."), why("Kidspace sells one week at a time."));
  ok("refused: another place's price in words", !says("Kidspace costs four hundred and fifty dollars a week."));
  ok("kept: its own price in words ('five hundred and ninety-five dollars')", says("Kidspace costs five hundred and ninety-five dollars a week."), why("Kidspace costs five hundred and ninety-five dollars a week."));
  ok("kept: the drive estimate in words", says("Kidspace is fifteen minutes away."), why("Kidspace is fifteen minutes away."));
  ok("kept: the page's own number written the other way ('two campuses' backs '2 campuses')", says("Galileo runs on 2 campuses.") && says("Galileo runs on two campuses."));
  ok("kept: the child's age in words", says("Kidspace takes ages 5 to 8, so your seven-year-old fits."), why("Kidspace takes ages 5 to 8, so your seven-year-old fits."));
  for (const t of [
    "Kidspace is the only one with hours listed.",
    "One of them is Kidspace.",
    "You asked for eight, and I found eight that fit.",
    "Nine places fit your area, not ten.",
    "Ask the same three questions everywhere.",
    "Of the two, Galileo runs later.",
  ]) ok(`kept: a count or a pronoun is not a fact: ${t}`, says(t), why(t));
  ok("a name with a number word stays a name", says("Two Bit Circus runs weekend camps.", { ...a, text: a.text + " Two Bit Circus weekend", names: ["Two Bit Circus"] }));
  ok("spelledToDigits: compounds, 'and a half', two numbers side by side", d.spelledToDigits("fifteen hundred, one hundred and fifty, twenty-five, two and a half hours, between two and three hours", { every: true }) === "1500, 150, 25, 2.5 hours, between 2 and 3 hours", d.spelledToDigits("fifteen hundred, one hundred and fifty, twenty-five, two and a half hours, between two and three hours", { every: true }));
  ok("spelledToDigits: 'fifty dollars' and '50 bucks' are prices", d.spelledToDigits("fifty dollars or 50 bucks") === "$50 or $50");

  /* What a place has: the review's "heated pool and a free trial class". */
  const self0 = { ...a, self: 0 };
  ok("refused: a heated pool and a free trial no page holds", !says("It has a heated pool and a free trial class.", self0), why("It has a heated pool and a free trial class.", self0));
  ok("refused: lunch moved onto the place that has none", !says("Kidspace includes lunch and snacks."));
  ok("refused: another place's feature ('snack breaks' are Galileo's)", !says("Kidspace has nut-free snack breaks."));
  ok("kept: the feature beside its own place", says("Galileo has nut-free snack breaks.") && says("Unlike Kidspace, Galileo has nut-free snack breaks."));
  ok("kept: what a page does not say ('no lunch listed', 'nothing about parking', 'whether it has a pool')", says("Kidspace lists no lunch.") && says("Its pages say nothing about parking.", self0) && says("I can't tell whether it has a pool.", self0));
  ok("refused: a 'no' before a turn does not cover what follows", !says("It has no parking, but a heated pool.", self0));
  ok("kept: a sentence about no place says what to look for", says("What matters most is a small group and a heated pool."));
  ok("kept: a watch names a thing to check, not a thing it has", d.keepSentences("whether it has a heated pool", { ...self0, verify: true, max: 160 }).text !== null);
  ok("kept: 'one-on-one' for a page's private lessons", says("Its lessons are one-on-one.", { ...a, byOption: [{ ...kid, facts: "private swim lessons at your home" }, gal], self: 0 }));
  ok("kept: 'wait list' and 'waitlist' are one thing", says("Kidspace has a waitlist.", { ...a, byOption: [{ ...kid, facts: "July weeks are wait list only" }, gal] }));
  ok("the retry is told why", d.refusalHint("feature").includes("own facts do not mention") && d.refusalHint("number").includes("in words"));
}

console.log("\n=== readDraft and the merge of two attempts, run (26 Oct) ===");
{
  /* lib/server/deep-dive.ts carries `server-only`; Next's own empty stub stands in for it, as Next does on the server. */
  /* Node 24 has `registerHooks`; the installed @types/node predates it. */
  type Resolve = (spec: string, ctx: unknown, next: (spec: string, ctx: unknown) => unknown) => unknown;
  const { registerHooks } = (await import("node:module")) as unknown as { registerHooks: (hooks: { resolve: Resolve }) => void };
  const stub = new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href;
  registerHooks({ resolve: (spec, ctx, next) => (spec === "server-only" ? { url: stub, format: "commonjs", shortCircuit: true } : next(spec, ctx)) });
  const dd = (await import(`../lib/server/deep-dive.ts?v=${Date.now()}`)) as typeof import("../lib/server/deep-dive");
  const blank = {
    named_by: null, last_confirmed: null, stale: false, quote: null, caveat: null, who_for: null, tip: null,
    price: null, worth: null, detail: null, warning: null, withdrawn: 0, answer_ready: false,
  };
  const page = (summary: string, price: string | null) => ({ what: "day camp", ages: "5 to 8", schedule: "9am-3pm", price, highlights: [], summary, answers: [], site: null });
  const options = [
    { ...blank, id: "w1", name: "Kidspace Children's Museum", what: "museum day camp", area: "Pasadena", source: "public" as const, firsthand: 0, km: 5.2, web: page("Weekly camps on the museum campus.", "$595 a week") },
    { ...blank, id: "w2", name: "Camp Galileo Pasadena", what: "STEAM day camp", area: "Pasadena", source: "public" as const, firsthand: 0, km: 5.2, web: page("Weekly STEAM camps with nut-free snack breaks.", "$450 to $540 a week") },
  ];
  const fam = { children: "a 7 year old", home: "Altadena", travel_time: "under_20_min", budget: null, logistics: [] };
  const raw = {
    opening: "I'd start with Kidspace for its museum campus. Galileo costs fifty dollars less.",
    order: ["w1", "w2"],
    also: [],
    comparison: "",
    options: [
      { id: "w1", text: "Kidspace runs weekly camps on the museum campus for ages 5 to 8, at $595 a week. It has a heated pool and a free trial day. Parents rave about it.", watch: "whether it has a wait list" },
      { id: "w2", text: "Galileo runs weekly STEAM camps with nut-free snack breaks. It is twelve minutes away.", watch: "" },
    ],
    bottom_line: "I'd start with Kidspace.",
  };
  const r = dd.readDraft(raw, { question: "summer camps for my 7 year old in Pasadena", family: fam, options, now: new Date("2026-10-26T12:00:00Z") });
  ok("readDraft: the page's facts are kept", r?.checked.text.w1 === "Kidspace runs weekly camps on the museum campus for ages 5 to 8, at $595 a week." && r?.checked.text.w2 === "Galileo runs weekly STEAM camps with nut-free snack breaks.", JSON.stringify(r?.checked.text));
  const reasons = (r?.removed ?? []).map((x) => `${x.id}:${x.reason}`).sort().join(",");
  ok("readDraft: a feature, a vouch, a drive time and a price in words are each removed and named", reasons === "opening:number,w1:claim,w1:feature,w2:number", reasons);
  ok("readDraft: the opening keeps the sentence that passed", r?.checked.opening === "I'd start with Kidspace for its museum campus.", String(r?.checked.opening));
  ok("readDraft: a watch about a wait list is kept", r?.checked.watch.w1 === "whether it has a wait list", JSON.stringify(r?.checked.watch));
  ok("readDraft: the order is held", r?.checked.order.join() === "w1,w2");

  /* The merge: an opening goes with the ranking it was written for. */
  const attempt = (order: string[], opening: string | null, words: number) => ({
    opening, order, also: [], comparison: opening ? `${order[0]} decides it.` : null, text: Object.fromEntries(order.map((id) => [id, "x".repeat(words)])), watch: {}, bottom_line: opening ? `Start with ${order[0]}.` : null, shape: "open" as const, max_parts: 4,
  });
  const m1 = dd.mergeDrafts(attempt(["w1", "w2"], "Kidspace first.", 50), attempt(["w2", "w1"], null, 80));
  ok("merge: the retry's order wins, and the first attempt's opening, written for the other order, is not used", m1.order.join() === "w2,w1" && m1.opening === null && m1.bottom_line === null && m1.comparison === null, JSON.stringify(m1));
  const m2 = dd.mergeDrafts(attempt(["w1", "w2"], "Kidspace first.", 50), attempt(["w1", "w2"], null, 80));
  ok("merge: with the same order the other attempt's opening stands in", m2.opening === "Kidspace first." && m2.bottom_line === "Start with w1." && m2.comparison === "w1 decides it.", JSON.stringify(m2));
  const m3 = dd.mergeDrafts(attempt(["w1", "w2"], "Kidspace first.", 90), attempt(["w2", "w1"], "Galileo first.", 50));
  ok("merge: the attempt that kept more text gives the order and its own opening", m3.order.join() === "w1,w2" && m3.opening === "Kidspace first.");
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
