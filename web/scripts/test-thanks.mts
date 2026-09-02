import type { AnswerState, ThanksCandidate } from "../lib/thanks.ts";

/**
 * M9.1 / 9.2 — the two loops, and mostly the cases where they must stay quiet.
 *
 * Both of these send unprompted texts to real people, so the interesting checks
 * are the refusals: too soon, too late, already asked, already thanked, and a
 * reply that cannot be read. A loop that is merely too eager does not throw —
 * it just messages somebody who did not need messaging, which is the one thing
 * a contributor-protection system is for.
 */

const t = (await import(`../lib/thanks.ts?v=${Date.now()}`)) as typeof import("../lib/thanks.ts");
const s = (await import(`../lib/sms-templates.ts?v=${Date.now()}`)) as typeof import("../lib/sms-templates.ts");

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

const NOW = new Date("2026-09-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const state = (days: number, kinds: string[], asked = false): AnswerState => ({
  sent_at: daysAgo(days),
  helped_asked_at: asked ? daysAgo(1) : null,
  kinds,
});

console.log("\n=== 9.1  the windows are the estimate's own numbers ===");
ok(
  "an activity is asked about after 3 days and no later than 5",
  t.windowFor(["activity"]).after_days === 3 && t.windowFor(["activity"]).before_days === 5,
);
ok(
  "a caregiver after 7 and no later than 14",
  t.windowFor(["caregiver"]).after_days === 7 && t.windowFor(["caregiver"]).before_days === 14,
  "hiring somebody takes longer than trying a class",
);
ok(
  "an answer that used both waits on the caregiver's clock",
  t.windowFor(["activity", "caregiver"]).after_days === 7,
  "9.1 asks one question, so asking early would catch the slower half undone",
);
ok(
  "however the kinds arrive",
  t.windowFor(["caregiver", "activity"]).after_days === t.windowFor(["activity", "caregiver"]).after_days,
);
ok(
  "an unknown kind takes the slowest window, not the most impatient",
  t.windowFor(["mystery"]).after_days === 7,
  "the mirror of the strictest freshness policy in trust-labels.ts",
);

console.log("\n=== 9.1  when to ask, and when not to ===");
ok("four days after an activity answer, ask", t.shouldPrompt(state(4, ["activity"]), NOW).ask);
const tooSoon = t.shouldPrompt(state(1, ["activity"]), NOW);
ok(
  "the next morning, do not",
  !tooSoon.ask && !tooSoon.ask && tooSoon.reason === "too_soon",
  "they have not been anywhere yet",
);
const tooLate = t.shouldPrompt(state(30, ["activity"]), NOW);
ok(
  "a month later, do not",
  !tooLate.ask && tooLate.reason === "too_late",
  "a stale yes is worse evidence than none — it enters the ledger as a fresh use",
);
const asked = t.shouldPrompt(state(4, ["activity"], true), NOW);
ok("never twice", !asked.ask && asked.reason === "already_asked");
const unsent = t.shouldPrompt({ sent_at: null, helped_asked_at: null, kinds: ["activity"] }, NOW);
ok(
  "and never about an answer that was never sent",
  !unsent.ask && unsent.reason === "not_sent",
  "an approved answer nobody sent is a parent still waiting, not one to survey",
);
ok(
  "a caregiver answer at day 4 is still too soon",
  !t.shouldPrompt(state(4, ["caregiver"]), NOW).ask,
);
ok("and at day 10 it is due", t.shouldPrompt(state(10, ["caregiver"]), NOW).ask);

console.log("\n=== 9.1  the reply, and what it refuses to read ===");
ok("YES is a yes", t.yesOrNo("YES") === true);
ok("a lowercase yes with a full stop is too", t.yesOrNo("yes.") === true);
ok("NO is a no", t.yesOrNo("no") === false);
ok('"it helped" counts', t.yesOrNo("It helped") === true);
ok(
  '"no idea, we never got round to it" is neither',
  t.yesOrNo("no idea, we never got round to it") === null,
  "a substring test would file that as a recommendation that failed",
);
ok(
  '"yes we are still deciding" is neither',
  t.yesOrNo("yes we're still deciding") === null,
  "a yes writes an impact event and texts a third person — a wrong read reaches somebody else",
);
ok("and an unrelated question is neither", t.yesOrNo("do you know any swim classes?") === null);

console.log("\n=== 9.2  one thank-you per contributor per week ===");
ok("the gap is seven days", t.THANKS_GAP_DAYS === 7);
const candidate = (items: string[], lastThanked: number | null): ThanksCandidate => ({
  person_id: "p1",
  items,
  last_thanked_at: lastThanked === null ? null : daysAgo(lastThanked),
});
ok("never thanked, with something to thank for: send", t.shouldThank(candidate(["Aveson"], null), NOW).send);
const recent = t.shouldThank(candidate(["Aveson"], 2), NOW);
ok(
  "thanked on Saturday, nothing on Monday",
  !recent.send && recent.reason === "thanked_recently",
  "three messages is not three times the gratitude — it is Pando being noisy at the helpful",
);
ok("thanked eight days ago: send again", t.shouldThank(candidate(["Aveson"], 8), NOW).send);
const nothing = t.shouldThank(candidate([], null), NOW);
ok("nothing to thank for: silence", !nothing.send && nothing.reason === "nothing_to_thank");
ok(
  "and a held batch is owed rather than dropped",
  t.shouldThank(candidate(["A", "B", "C"], 2), NOW).send === false &&
    t.shouldThank(candidate(["A", "B", "C"], 8), NOW).send === true,
  "which is what makes it batching rather than throttling",
);

console.log("\n=== 9.2  the list names things, and never runs long ===");
ok("one item reads as itself", t.thanksList(["Aveson Charter"]) === "Aveson Charter");
ok("two are joined", t.thanksList(["Aveson", "Kidspace"]) === "Aveson and Kidspace");
ok(
  "four say so rather than hiding two",
  t.thanksList(["A", "B", "C", "D"]) === "A and B (and 2 more)",
  "silently dropping the rest would make the receipt a lie by omission",
);
ok(
  "the shown count is a named constant",
  t.THANKS_ITEMS_SHOWN === 2,
  "a list of six reads as a report, not a thank-you",
);
ok(
  "and it is never a bare number",
  !/^\d+$/.test(t.thanksList(["A", "B", "C", "D"])),
  "strategy 13: an impact receipt names the thing",
);

console.log("\n=== the copy ===");
const prompt = s.thanksPromptSms();
ok("the prompt names the service first, like the registered samples", prompt.startsWith("Pando:"));
ok("it is answerable in one word", /YES or NO/.test(prompt), "a question needing a sentence gets no reply");
ok(
  "it says what a yes does",
  /thank/i.test(prompt),
  "a parent who does not know their yes becomes a thank-you has been asked to rate something",
);
ok("STOP and HELP are last, as registered", /Reply STOP to opt out, HELP for help\.$/.test(prompt));

const thanks = s.thanksSms(t.thanksList(["Aveson", "Kidspace"]));
ok("the thank-you names what they did", thanks.includes("Aveson and Kidspace"));
ok("it says a parent used it", /parent nearby used your recommendation/.test(thanks));
ok(
  "it asks for nothing",
  !thanks.includes("?"),
  "a thank-you carrying a request is a request wearing a thank-you",
);
ok(
  "it never names the parent who used it",
  !/asked by|from [A-Z]/.test(thanks),
  "the asker is anonymous in every direction",
);
ok("STOP and HELP are last here too", /Reply STOP to opt out, HELP for help\.$/.test(thanks));

console.log("\n=== both messages stay inside one segment ===");
/* Not a compliance rule — a cost and a readability one. A thank-you that
   arrives as two texts spends two messages of somebody's monthly allowance. */
ok(`the prompt is ${prompt.length} characters`, prompt.length <= 320, prompt);
ok(`the thank-you is ${thanks.length} characters`, thanks.length <= 320, thanks);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
