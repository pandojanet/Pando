import type { Allowance, OutreachHistory } from "../lib/outreach-policy.ts";

/**
 * M8 — contributor protection.
 *
 * Invariant 5's numbers are "enforced in code, never by judgement", so most of
 * what follows asserts a **refusal**: a suite that only proved Pando can send
 * would pass while it sent four times in a week to the same tired parent.
 *
 * The gap is the number to watch, and it has moved twice. Spec §14 and estimate
 * row 8.2 say 48 hours; the 8.18 strategy said five days and was adopted on
 * 27 Aug; the **1 Sep feedback says 48 hours three times**, in an instruction
 * and twice in the page copy she wrote, and is the newest document. The checks
 * below pin it there, so a session reading the 8.18 strategy on its own cannot
 * quietly halve the pilot's request rate again.
 */

const p = (await import(`../lib/outreach-policy.ts?v=${Date.now()}`)) as typeof import("../lib/outreach-policy.ts");

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

const NOW = new Date("2026-08-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const allowance = (over: Partial<Allowance> = {}): Allowance => ({
  monthly_contact_allowance: 5,
  allowance_mode: "fixed",
  ...over,
});
const history = (over: Partial<OutreachHistory> = {}): OutreachHistory => ({
  sent_last_30_days: 0,
  responded_last_30_days: 0,
  last_outreach_at: null,
  pings_this_month: 0,
  blast_today: false,
  ...over,
});
const decide = (
  kind: "blast" | "ping" | "thanks",
  a: Partial<Allowance> = {},
  h: Partial<OutreachHistory> = {},
) => p.decideOutreach(kind, allowance(a), history(h), NOW);

console.log("\n=== the gap is 48 hours (1 Sep, item 18) ===");
ok("the constant is 2 days", p.OUTREACH_GAP_DAYS === 2, `got ${p.OUTREACH_GAP_DAYS}`);
ok(
  "the next morning is refused",
  decide("blast", {}, { last_outreach_at: daysAgo(1) }).ok === false,
  "one request per 48 hours means a day later is still inside it",
);
ok(
  "three days later is allowed",
  decide("blast", {}, { last_outreach_at: daysAgo(3) }).ok === true,
  "the five-day figure refused this — see OUTREACH_GAP_DAYS for the history",
);
ok("two days clears it exactly", decide("blast", {}, { last_outreach_at: daysAgo(2) }).ok === true);
ok(
  "and it says how long is left, so a caller can reschedule",
  (() => {
    const d = decide("blast", {}, { last_outreach_at: daysAgo(1) });
    return !d.ok && d.reason === "too_soon" && d.retry_in_days === 1;
  })(),
);
ok("nobody contacted before is not blocked", decide("blast").ok === true);

console.log("\n=== the monthly ceiling ===");
ok("under the cap is fine", decide("blast", {}, { sent_last_30_days: 4 }).ok === true);
ok(
  "at the cap is refused",
  (() => {
    const d = decide("blast", {}, { sent_last_30_days: 5 });
    return !d.ok && d.reason === "monthly_cap";
  })(),
);
/* Answered, deliberately: with eight requests and no replies the governor fires
   and lowers them to 5, which is a different rule being tested below. The first
   version of this fixture left `responded` at 0 and failed — the code was right. */
ok(
  "a parent who chose 10 gets 10",
  decide("blast", { monthly_contact_allowance: 10 },
         { sent_last_30_days: 8, responded_last_30_days: 8 }).ok === true,
);
ok(
  "as_relevant has no ceiling",
  decide("blast", { allowance_mode: "as_relevant", monthly_contact_allowance: null },
         { sent_last_30_days: 40, responded_last_30_days: 40 }).ok === true,
);
ok(
  "but an unresponsive as_relevant contributor IS governed down to 10",
  (() => {
    const d = decide("blast", { allowance_mode: "as_relevant", monthly_contact_allowance: null },
                     { sent_last_30_days: 40, responded_last_30_days: 0 });
    return !d.ok && d.reason === "monthly_cap" && d.allowance === 10;
  })(),
  "'ask me anytime' is an offer, not an exemption from 8.4",
);
ok(
  "but as_relevant is still spaced five days apart",
  decide("blast", { allowance_mode: "as_relevant", monthly_contact_allowance: null },
         { last_outreach_at: daysAgo(1) }).ok === false,
  "no ceiling must not mean no protection",
);
ok(
  "the gap is checked before the cap — budget left is not permission to burst",
  (() => {
    const d = decide("blast", {}, { sent_last_30_days: 0, last_outreach_at: daysAgo(1) });
    return !d.ok && d.reason === "too_soon";
  })(),
);

console.log("\n=== 8.4  the response-rate governor ===");
const gov = (sent: number, responded: number, a: Partial<Allowance> = {}) =>
  p.effectiveAllowance(allowance(a), history({ sent_last_30_days: sent, responded_last_30_days: responded }));

ok(
  "one unanswered request out of one does NOT lower anyone",
  gov(1, 0).lowered === false,
  "without a minimum sample, a first request could punish someone before they could answer a second",
);
ok("three is still too few", gov(3, 0).lowered === false);
/* On a tier above the floor: at 5 there is nothing left to lower, which the
   check further down asserts on purpose. */
ok(
  "four unanswered out of four is a pattern",
  gov(4, 0, { monthly_contact_allowance: 10 }).lowered === true,
);
ok(
  "exactly 25% is not below the floor",
  gov(4, 1).lowered === false,
  "the rule is 'drops below 25%', not 'is at most'",
);
ok("below it lowers by one tier", gov(8, 1).allowance === p.ALLOWANCE_FLOOR);
ok(
  "as_relevant drops to 10, not straight to the floor",
  gov(8, 1, { allowance_mode: "as_relevant", monthly_contact_allowance: null }).allowance === 10,
);
ok(
  "10 drops to 5",
  gov(8, 1, { monthly_contact_allowance: 10 }).allowance === 5,
);
ok(
  "5 is the floor and the governor stops there",
  (() => {
    const g = gov(8, 0, { monthly_contact_allowance: 5 });
    return g.allowance === 5 && g.lowered === false;
  })(),
  "five is the community agreement's own minimum — taking it withdraws what they were promised",
);
ok(
  "a lowered ceiling is what the cap is then measured against",
  (() => {
    const d = decide("blast", { monthly_contact_allowance: 10 },
                     { sent_last_30_days: 6, responded_last_30_days: 0 });
    return !d.ok && d.reason === "monthly_cap" && d.allowance === 5;
  })(),
  "the governor is not advisory — it moves the number the gate uses",
);

console.log("\n=== v3.2 §10  freshness pings ===");
ok(
  "one ping a month",
  (() => {
    const d = decide("ping", {}, { pings_this_month: 1, last_outreach_at: daysAgo(30) });
    return !d.ok && d.reason === "ping_this_month";
  })(),
);
ok(
  "none yet this month is fine",
  decide("ping", {}, { pings_this_month: 0, last_outreach_at: daysAgo(30) }).ok === true,
);
ok(
  "never on the same day as a blast",
  (() => {
    const d = decide("ping", {}, { blast_today: true, last_outreach_at: daysAgo(30) });
    return !d.ok && d.reason === "ping_same_day_as_blast";
  })(),
);
ok(
  "the same-day rule is checked before the monthly one, so the reason is the specific one",
  (() => {
    const d = decide("ping", {}, { blast_today: true, pings_this_month: 1, last_outreach_at: daysAgo(30) });
    return !d.ok && d.reason === "ping_same_day_as_blast";
  })(),
);
ok(
  "a ping is still subject to the 48-hour gap",
  decide("ping", {}, { last_outreach_at: daysAgo(1) }).ok === false,
);
ok(
  "and a blast is not limited by the ping rules",
  decide("blast", {}, { pings_this_month: 5, blast_today: true }).ok === true,
  "blast_today matters to a ping, not to the next blast — the gap governs that",
);

console.log("\n=== 8.3  changing the agreement by text ===");
ok("SETTINGS opens it", p.isSettingsCommand("settings"));
ok("BLAST SETTINGS too", p.isSettingsCommand("Blast Settings"));
ok("a trailing question mark is fine", p.isSettingsCommand("settings?"));
ok(
  "a bare number does NOT",
  !p.isSettingsCommand("5"),
  "5 is how somebody answers the clarifying question about a child's age",
);
ok("nor an ordinary sentence", !p.isSettingsCommand("can you change my settings"));

const choice = (text: string) => p.parseAllowanceChoice(text);
ok("1 is five a month", choice("1")?.allowance === 5);
ok("5 is five a month", choice("5")?.allowance === 5);
ok("2 is ten", choice("2")?.allowance === 10);
ok("10 is ten", choice("10")?.allowance === 10);
ok(
  "3 is anytime, with no number",
  choice("3")?.mode === "as_relevant" && choice("3")?.allowance === null,
);
ok("so is the word", choice("anytime")?.mode === "as_relevant");
ok("case and punctuation do not matter", choice("Anytime.")?.mode === "as_relevant");
ok("anything else is not a choice", choice("maybe later") === null);
ok("nor is a number outside the menu", choice("7") === null,
   "7 is not an option, and inventing one would write a value the CHECK refuses");

ok(
  "the choices are exactly what the CHECK allows",
  p.ALLOWANCE_CHOICES.every((c) => c.value === 5 || c.value === 10 || c.value === null),
  "a fourth writer of 5/10/as_relevant must not widen it — that is what broke on 18 Aug",
);
ok(
  "and every choice is reachable from a reply",
  p.ALLOWANCE_CHOICES.every((c, i) => {
    const parsed = choice(String(i + 1));
    return parsed !== null && parsed.allowance === c.value && parsed.mode === c.mode;
  }),
  "a menu with an unreachable option is a menu that lies",
);

console.log("\n=== what Pando says back ===");
const prompt = p.settingsPrompt({ monthly_contact_allowance: 5, allowance_mode: "fixed" });
ok("it states the current setting first", /up to 5 a month/.test(prompt), prompt);
ok(
  "as_relevant reads as words, not as a number",
  /anytime/i.test(p.settingsPrompt({ monthly_contact_allowance: null, allowance_mode: "as_relevant" })),
);
ok(
  "and the 48-hour gap is stated whichever they pick",
  /48 hours/.test(prompt) &&
    /48 hours/.test(p.settingsConfirmation({ allowance: 10, mode: "fixed" })) &&
    /48 hours/.test(p.settingsConfirmation({ allowance: null, mode: "as_relevant" })),
  "'no fixed limit' must never read as 'as often as Pando likes'",
);
ok(
  "a change is confirmed, never silent",
  p.settingsConfirmation({ allowance: 10, mode: "fixed" }).includes("10"),
);

console.log("\n=== every decision carries the number it judged against ===");
ok(
  "an allowed send reports the ceiling in force",
  decide("blast", { monthly_contact_allowance: 10 }).allowance === 10,
);
ok(
  "a refusal does too, so a log line can explain itself",
  (() => {
    const d = decide("blast", {}, { sent_last_30_days: 5 });
    return !d.ok && d.allowance === 5;
  })(),
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
