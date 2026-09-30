import type { AnswerCandidate } from "../lib/answer.ts";

/**
 * The answer about a caregiver, how she is ranked against the question, and
 * "any others?" (29 Sep).
 *
 * Most of what matters here is what the answer must NOT say: a parent's note
 * about her (invariant 12), a rate she never agreed to show, a fit nothing
 * checked. A suite that only proved the sentences read well would pass while
 * one of those leaked.
 */

const a = (await import(`../lib/answer.ts?v=${Date.now()}`)) as typeof import("../lib/answer.ts");
const c = (await import(`../lib/care-answer.ts?v=${Date.now()}`)) as typeof import("../lib/care-answer.ts");
const m = (await import(`../lib/more-options.ts?v=${Date.now()}`)) as typeof import("../lib/more-options.ts");
const t = (await import(`../lib/trust-labels.ts?v=${Date.now()}`)) as typeof import("../lib/trust-labels.ts");
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");

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

const profile = (over: Partial<import("../lib/care-answer.ts").CareProfile> = {}) => ({
  ages: ["toddler"],
  strengths: ["reliable"],
  roles: ["full_time"],
  rate: "22_26" as string | null,
  ...over,
});

console.log("\n=== what she agreed to have shown ===");
const facts = c.careFacts(profile({ ages: ["baby", "toddler"], strengths: ["reliable", "cpr"], rate: "26_32" }));
ok("ages, strengths and rate are all said", facts.full === "Works with babies and toddlers. Reliable and on time, CPR and first aid. Rate: $26-32/hr.", facts.full ?? "null");
ok("the short form carries ages and rate only", facts.brief === "works with babies and toddlers, $26-32/hr", facts.brief ?? "null");
ok("a strength that repeats the ages is dropped", !(c.careFacts(profile({ ages: ["toddler"], strengths: ["toddlers", "reliable"] })).full ?? "").includes("great with toddlers"));
ok("no more than three strengths", (c.careFacts(profile({ strengths: ["reliable", "cpr", "cooks", "homework", "drives"] })).full ?? "").split(",").length <= 3);
ok("salaried and prefer-not-to-say print no rate", !(c.careFacts(profile({ rate: "salaried" })).full ?? "").includes("Rate"));
ok("prefer-not-to-say prints no rate either", !(c.careFacts(profile({ rate: "prefer_not_to_say" })).full ?? "").includes("Rate"));
ok("an empty profile says nothing rather than something invented", c.careFacts(profile({ ages: [], strengths: [], roles: [], rate: null })).full === null);
ok("every phrase is GSM-7", seg.encodingFor(facts.full ?? "") === "gsm7", seg.encodingFor(facts.full ?? ""));

console.log("\n=== fit ranks and never filters ===");
const toddlerQ = "any good nanny for my 2 year old, full time?";
const good = c.careFit(toddlerQ, ["toddler"], profile({ roles: ["full_time"] }));
const wrongAge = c.careFit(toddlerQ, ["toddler"], profile({ ages: ["tween"], roles: ["before_after_school"] }));
const unknown = c.careFit(toddlerQ, ["toddler"], profile({ ages: [], roles: [] }));
ok("a matching age and kind of care scores highest", good.score > unknown.score && unknown.score > wrongAge.score, `${good.score}/${unknown.score}/${wrongAge.score}`);
ok("an empty profile is unknown, not a mismatch", unknown.score === 0);
ok("a wrong age is demoted and never removed - it still has a finite score", Number.isFinite(wrongAge.score));
ok("what she matches is named in a parent's words", good.fits.join("|") === "toddlers|full-time care", good.fits.join("|"));
ok("the kind of care asked for is reported", good.role === "full_time", String(good.role));
ok("after-school is read from the question", c.careFit("someone for after school pickups", [], profile({ roles: ["before_after_school"] })).role === "before_after_school");
ok("a newborn question reads night care", c.careFit("a night nurse for our newborn", ["baby"], profile({ ages: ["baby"], roles: ["night_newborn"] })).role === "night_newborn");
ok("a question that asks nothing matches nothing", c.careFit("any good nannies?", [], profile()).score === 0);
ok("a fit is never claimed for something not asked", c.careFit("any good nannies?", [], profile()).fits.length === 0);
ok("matcher bands map onto the caregiver's five", c.careFit("x", ["teen"], profile({ ages: ["tween"] })).score === 3 && c.careFit("x", ["expecting"], profile({ ages: ["baby"] })).score === 3);

console.log("\n=== the answer itself ===");
const parentClass = (): AnswerCandidate => ({ name: "Toddler Tunes", kind: "activity", firsthand_count: 2, trust: { labels: [t.TRUST_LABEL.VALIDATED], freshness: "fresh", public_only: false } });
const t2 = (name: string, n: number, over: Partial<AnswerCandidate> = {}): AnswerCandidate => ({
  name,
  kind: "caregiver",
  care: "Full-time",
  area: "san-marino",
  firsthand_count: n,
  trust: { labels: n > 1 ? [t.TRUST_LABEL.VALIDATED] : [t.TRUST_LABEL.SHARED], freshness: "fresh", public_only: false },
  ...over,
});
const lead = a.composeAnswer({
  candidates: [
    t2("Elena V.", 2, {
      last_confirmed: "2026-08-20",
      fit: "toddlers, full-time care",
      care_facts: facts.full,
      care_brief: facts.brief,
    }),
  ],
  has_question: true,
}).text;
ok("she is employed, not used", lead.includes("2 parents near you have employed Elena V."), lead.split("\n")[0]);
ok("what she matches is stated", lead.includes("Fits what you asked: toddlers, full-time care."));
ok("what she agreed to have shown is in the lead", lead.includes("Works with babies and toddlers.") && lead.includes("Rate: $26-32/hr."));
ok("no fit line when nothing was checked", !a.composeAnswer({ candidates: [t2("Elena V.", 2)], has_question: true }).text.includes("Fits what you asked"));
ok("the answer is GSM-7 and inside the budget", seg.encodingFor(lead) === "gsm7" && lead.length <= a.SMS_BUDGET, `${seg.encodingFor(lead)} ${lead.length}`);
ok("a note about her never appears - the type has no field for it", !("notes" in t2("Elena V.", 1)) && !/private note|would not hire|hire again/i.test(lead));
const two = a.composeAnswer({
  candidates: [
    t2("Elena V.", 2, { care_facts: facts.full, care_brief: facts.brief, fit: "toddlers, full-time care", trust: { labels: [t.TRUST_LABEL.VALIDATED, t.TRUST_LABEL.REFERENCE_AVAILABLE], freshness: "fresh", public_only: false } }),
    t2("Maria G.", 1, { care: "Before / after school", area: "altadena", care_facts: "Works with school-age and older kids. Rate: $18-22/hr.", care_brief: "works with school-age and older kids, $18-22/hr" }),
    t2("Tessa N.", 1, { area: "pasadena" }),
  ],
  has_question: true,
});
ok("two caregivers are offered as a choice", two.text.startsWith("Two options:" + String.fromCharCode(10) + "1) Elena V.") && two.text.includes(String.fromCharCode(10) + "2) Maria G."), two.text);
ok("and only two, even with a third to hand", !two.text.includes("Tessa N.") && two.used === 2 && two.parent_used === 2);
ok("each option says who, what kind and where, and how many parents", two.text.includes("1) Elena V., full-time care in San Marino. Employed by 2 parents near you") && two.text.includes("2) Maria G., before and after-school care in Altadena. Employed by one parent near you"));
ok("both carry what they work with and charge", two.text.includes("Rate: $26-32/hr") && two.text.includes("Rate: $18-22/hr"));
ok("a label the prose does not say still prints verbatim in its option", two.text.includes(t.TRUST_LABEL.REFERENCE_AVAILABLE));
ok("no Network Ask is offered on top of a choice", !two.text.includes("Want me to ask") && two.next_step === "none");
ok("the choice is GSM-7 and inside the budget", seg.encodingFor(two.text) === "gsm7" && two.text.length <= a.SMS_BUDGET, `${seg.encodingFor(two.text)} ${two.text.length}`);
ok("one caregiver alone is still one lead", !a.composeAnswer({ candidates: [t2("Elena V.", 2)], has_question: true }).text.startsWith("Two options"));
ok("a caregiver among other kinds of record is not a choice of two people", !a.composeAnswer({ candidates: [t2("Elena V.", 2), t2("Maria G.", 1), { ...parentClass(), name: "Toddler Tunes" }], has_question: true }).text.startsWith("Two options"));
const longFacts = "Works with babies. " + "Reliable and on time, plays actively, drives and can do pickups. ".repeat(6);
const squeezed = a.composeAnswer({ candidates: [t2("Elena V.", 2, { care_facts: longFacts, care_brief: "works with babies" }), t2("Maria G.", 1, { care_facts: longFacts, care_brief: "works with toddlers" })], has_question: true });
ok("when the full facts do not fit, the short form does - never a cut sentence", squeezed.text.length <= a.SMS_BUDGET && squeezed.text.includes("Works with babies.") && !squeezed.text.includes("Reliable and on time, plays actively, drives and can do pickups. Reliable"), squeezed.text.slice(0, 200));
ok("the opening for a follow-up replaces the default", a.composeAnswer({ candidates: [t2("Elena V.", 2), t2("Maria G.", 1)], has_question: true, opening: "A few more that may fit:" }).text.startsWith("A few more that may fit:" + String.fromCharCode(10) + "1)"));
ok("school-age and tween read as one range", (c.careFacts(profile({ ages: ["grade", "tween"] })).full ?? "").startsWith("Works with school-age and older kids."), c.careFacts(profile({ ages: ["grade", "tween"] })).full ?? "");
ok("an occasional sitter takes an article", a.composeAnswer({ candidates: [t2("Tessa N.", 1, { care: "Occasional sitting" })], has_question: true }).text.includes("an occasional sitter in San Marino"));
ok(
  "a label the prose does not say stays verbatim on a caregiver",
  a.composeAnswer({
    candidates: [t2("Elena V.", 1, { trust: { labels: [t.TRUST_LABEL.SHARED, t.TRUST_LABEL.REFERENCE_AVAILABLE], freshness: "fresh", public_only: false } })],
    has_question: true,
  }).text.includes(t.TRUST_LABEL.REFERENCE_AVAILABLE),
);
ok("a class still says used", a.composeAnswer({ candidates: [{ ...t2("Toddler Tunes", 2), kind: "activity", care: null }], has_question: true }).text.includes("2 parents near you have used Toddler Tunes"));

console.log("\n=== asking for more ===");
for (const s of ["any others?", "what else?", "any other nannies", "more options please", "show me more", "anything else?", "one more", "do you have anything else for that", "ok what else"]) {
  ok(`${JSON.stringify(s)} asks for more`, m.asksForMore(s));
}
for (const s of ["thanks!", "any good camps for a 6 year old in Altadena", "we loved Little Gym", "STOP", "5", "yes", "how old should she be before we hire someone from outside the family for weekends", ""]) {
  ok(`${JSON.stringify(s)} does not`, !m.asksForMore(s));
}
const given = { ids: ["s1"], texts: ["2 parents near you have employed Elena V., full-time care in San Marino."] };
ok("a record already sent is excluded by id", m.alreadyGiven({ id: "s1", name: "Whatever" }, given));
ok("a caregiver already sent is excluded by the name in the text", m.alreadyGiven({ name: "Elena V." }, given));
ok("one not sent is kept", !m.alreadyGiven({ id: "s2", name: "Maria G." }, given));
ok("a short name never matches by substring", !m.alreadyGiven({ name: "Al" }, { ids: [], texts: ["Also nearby: Maria G."] }));
const more = a.composeAnswer({ candidates: [t2("Maria G.", 1)], has_question: true, opening: "A few more that may fit:" }).text;
ok("the opening sits above the first record", more.startsWith("A few more that may fit:\n"), more);
ok("nothing left says so and does not claim there was nothing", a.composeAnswer({ candidates: [], has_question: true, can_offer_blast: true, nothing_left: true }).text.startsWith("That's everything I have on this so far."));
ok("nothing left without budget makes no offer", !a.composeAnswer({ candidates: [], has_question: true, can_offer_blast: false, nothing_left: true }).text.includes("Want me"));
ok("an opening never replaces the public guard", a.composeAnswer({
  candidates: [{ name: "City parks", kind: "x", firsthand_count: 0, trust: { labels: [t.TRUST_LABEL.PUBLIC], freshness: "fresh", public_only: true } }],
  has_question: true,
  opening: "A few more that may fit:",
}).text.includes("general information, not from a parent"));

console.log("\n=== a follow-up is stored apart from the answer it follows ===");
ok("the suffix round-trips", m.baseQuestion(m.withMoreSuffix("any good nanny?")) === "any good nanny?");
ok("it is never added twice", m.withMoreSuffix(m.withMoreSuffix("q")) === m.withMoreSuffix("q"));
const { readFileSync } = await import("node:fs");
const inbound = readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
ok("the queue stores a follow-up under the suffixed text", /question:\s*input\.more\s*\?\s*withMoreSuffix\(body\)\s*:\s*body/.test(inbound));
ok("the follow-up branch runs before the classifier is called", inbound.indexOf("asksForMore(body)") > 0 && inbound.indexOf("asksForMore(body)") < inbound.indexOf("await classifyIntent("));
ok("a follow-up is only for a message no open question has claimed", /pending === null && !attached\.attached && asksForMore\(body\)/.test(inbound));
ok("a follow-up that names an age, a place or another topic is a new question", /bandsInQuestion\(body\)\.length > 0/.test(inbound) && /placePhraseIn\(body\) !== null/.test(inbound));
const retrieval = readFileSync(new URL("../lib/server/repo/retrieval.ts", import.meta.url), "utf8");
const careSql = retrieval.slice(retrieval.indexOf("const caregiverRows"), retrieval.indexOf("return { policies, shareRows, caregiverRows }"));
ok("the caregiver query never selects a private note or the hire-again answer (invariant 12)", !/restricted|hire_again|in_their_words|pay_band/.test(careSql));
/* 30 Sep: the parent's "anything a family should know up front" is public by the
   developer's decision, and it is the nomination's `caveat`. The one place it is
   read is gated three ways: no hold on the card, made after the question's
   promise changed, and only the newest — so the test is no longer "never
   caveat" but "caveat only through that gate". */
ok("the public note is read only from a card with no hold, made after the cut-off",
  (careSql.match(/caveat/g) ?? []).length === 3 &&
    /not n\.review_hold/.test(careSql) && /PUBLIC_NOTE_SINCE/.test(careSql),
  `${(careSql.match(/caveat/g) ?? []).length} mentions`);
ok("a caregiver who is not looking right now is never in an answer",
  /coalesce\(cp\.available_from, ''\) <> 'not_looking'/.test(careSql));
ok("and still carries all four conditions of invariant 1", /consent_status = 'consented'/.test(careSql) && /c\.active/.test(careSql) && /c\.discoverable/.test(careSql) && /c\.is_adult/.test(careSql));

console.log(`\n${pass} checks passed${fail ? `, ${fail} FAILED` : "."}`);
process.exit(fail ? 1 : 0);
