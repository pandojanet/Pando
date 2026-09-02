import type { BlastTier } from "../lib/blast-tiers.ts";

/**
 * M7.2 / 7.7 — the tiers, and the guarantee attached to them.
 *
 * The numbers here are the **8.18 strategy's**, not the estimate's, and the two
 * disagree by more than naming: estimate 7.2 gives the core paid tier a pool of
 * ~25, while strategy §8 gives it "three to five carefully matched parents" and
 * §6 says why — *"Pando never sends a question to everyone — that's how group
 * chats train people to ignore things."* Twenty-five is a broadcast; five is a
 * request. If somebody restores the estimate's numbers, the checks below fail
 * rather than the pilot quietly turning into a mailing list.
 */

const t2 = (await import(`../lib/sms-templates.ts?v=${Date.now()}`)) as typeof import("../lib/sms-templates.ts");
const t = (await import(`../lib/blast-tiers.ts?v=${Date.now()}`)) as typeof import("../lib/blast-tiers.ts");

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

console.log("\n=== the four tiers are the strategy's four ===");
ok("there are exactly four", t.TIER_IDS.length === 4, t.TIER_IDS.join(", "));
ok(
  "and Precision is not among them",
  !t.TIER_IDS.includes("precision" as BlastTier),
  '§8: human review of an unusual match "absorbed what we once called Precision"',
);
ok("passive is free", t.TIERS.passive.price_cents === 0);
ok("a Board Ask is $5", t.TIERS.board.price_cents === 500);
ok("a Targeted Ask is $15", t.TIERS.targeted.price_cents === 1500);
ok(
  "Last-Minute Care is free during the pilot",
  t.TIERS.last_minute.price_cents === 0,
  "§8 calls it the single best advertisement for membership we have",
);

console.log("\n=== pool sizes: a request, not a broadcast ===");
ok(
  "passive contacts nobody",
  t.TIERS.passive.pool_target === 0,
  "the question is saved — this is also 7.11's demand map",
);
ok(
  "a Targeted Ask reaches five, not twenty-five",
  t.TIERS.targeted.pool_target === 5,
  "the estimate says ~25; the strategy says three to five, and explains why",
);
ok(
  "the board taps one parent only, and only as its safety net",
  t.TIERS.board.pool_target === 1,
  "§8: if the board has not cracked it in two days, one well-matched parent is asked",
);
ok(
  "no tier reaches more than five people directly",
  Object.values(t.TIERS).every((s) => s.pool_target <= 5),
  "being asked should feel like a compliment",
);

console.log("\n=== human review is a condition, not a tier you buy ===");
const review = (tier: BlastTier, matched: number, requirement_count = 0) =>
  t.needsHumanReview({ tier, matched, requirement_count });

ok(
  "Last-Minute Care always gets a person",
  review("last_minute", 5).required && review("last_minute", 5).reason === "tier",
  "somebody is about to leave a child with a person Pando named",
);
ok("a full targeted pool does not", !review("targeted", 5).required);
ok(
  "a short pool does",
  review("targeted", 2).required && review("targeted", 2).reason === "short_pool",
  "sending to two while charging for five is what the guarantee exists to prevent",
);
ok(
  "stacked requirements do",
  review("targeted", 5, 2).required &&
    review("targeted", 5, 2).reason === "stacked_requirements",
  "several hard constraints at once is where a scorer is confident and wrong",
);
ok("one requirement alone does not", !review("targeted", 5, 1).required);
ok(
  "passive never needs review — it contacts nobody",
  !review("passive", 0).required,
  "a pool of zero must not read as a short pool",
);

console.log("\n=== 7.7  the window ===");
ok("passive has none", t.expiryFor("passive", NOW) === null, "it promises nothing, so it can never be late");
ok(
  "a Targeted Ask expires in a day",
  t.expiryFor("targeted", NOW)?.toISOString() === "2026-08-28T12:00:00.000Z",
);
ok(
  "Last-Minute Care in four hours",
  t.expiryFor("last_minute", NOW)?.toISOString() === "2026-08-27T16:00:00.000Z",
);
ok(
  "the board gets two days, which is the strategy's own number",
  t.expiryFor("board", NOW)?.toISOString() === "2026-08-29T12:00:00.000Z",
);

console.log("\n=== 7.7  the guarantee ===");
const refund = (tier: BlastTier, approved: number, expired: boolean) =>
  t.owedRefund({
    tier,
    approved_answers: approved,
    expires_at: expired ? new Date(NOW.getTime() - 1000) : new Date(NOW.getTime() + 1000),
    now: NOW,
  });

ok("a paid Ask with no answer, past its window, is owed a credit", refund("targeted", 0, true));
ok("inside the window it is not — not yet", !refund("targeted", 0, false));
ok("with an approved answer it is not", !refund("targeted", 1, true));
ok(
  "a free tier is never refunded",
  !refund("passive", 0, true) && !refund("last_minute", 0, true),
  "nothing was taken",
);
ok(
  "the test is an APPROVED answer, not a reply",
  refund("targeted", 0, true),
  'a "no idea, sorry" must not discharge the guarantee — only the admin says an answer arrived',
);

console.log("\n=== the credit that pays for a tier ===");
/**
 * Two vocabularies, and conflating them fails silently.
 *
 * `credits_kind_check` allows `network_ask` and `targeted_network_ask`. The first
 * version of `createBlast` looked for a credit whose kind was the *tier id*,
 * which the CHECK does not permit — so no credit would ever have matched and
 * every parent would have paid for an Ask they had already earned. Nothing would
 * have thrown: "no unspent credit found" is a legitimate answer.
 */
ok(
  "a paid tier names a credit kind the CHECK actually allows",
  Object.values(t.TIERS)
    .filter((s) => s.price_cents > 0)
    .every((s) => s.credit_kind === "network_ask" || s.credit_kind === "targeted_network_ask"),
  Object.values(t.TIERS).map((s) => `${s.id}=${s.credit_kind}`).join(" "),
);
ok(
  "and it is never just the tier id",
  Object.values(t.TIERS).every((s) => (s.credit_kind as string | null) !== s.id),
);
ok(
  "a free tier has none — there is nothing to redeem",
  t.TIERS.passive.credit_kind === null && t.TIERS.last_minute.credit_kind === null,
);
ok(
  "a Targeted Ask redeems the targeted credit, not the generic one",
  t.TIERS.targeted.credit_kind === "targeted_network_ask",
  "the first Ask free, a referral and the grove all grant this one specifically",
);

console.log("\n=== 7.8  the text a Network Ask actually sends ===");
const ask = t2.blastRequestSms({
  question: "any good swim classes?",
  because: "you're at the same school",
});
ok("it names the service first, like the registered samples", ask.startsWith("Pando:"), ask);
ok("it carries the question", ask.includes("any good swim classes?"));
ok(
  "it says why them",
  ask.includes("same school"),
  "§6: being asked should feel like a compliment — you specifically, because your kid did this",
);
ok(
  "it offers PASS",
  /PASS/.test(ask),
  "§6 promises an effortless exit, and an exit nobody was told about is not one",
);
ok("STOP and HELP are last, as registered", /Reply STOP to opt out, HELP for help\.$/.test(ask));
ok(
  "it never names the asker",
  !/asked by/i.test(ask),
  "a Network Ask is anonymous — that is most of why a parent uses one",
);

console.log("\n=== the reason is a clause, never the record ===");
ok("a shared school", t2.askReason(["school", "age_range"]).includes("same school"));
ok(
  "the strongest reason wins whatever order they arrive in",
  t2.askReason(["age_range", "school"]) === t2.askReason(["school", "age_range"]),
);
ok("a near age band still reads naturally", /similar age/.test(t2.askReason(["age_range_near"])));
ok(
  "an unknown reason falls back rather than leaking one",
  /relevant/.test(t2.askReason(["mystery"])),
);
ok(
  "and no reason names a place",
  ["school", "activity", "neighborhood", "faith_community", "social_group"].every(
    (k) => !/[A-Z]/.test(t2.askReason([k])),
  ),
  "telling somebody which class would leak what the asker is asking about",
);

console.log("\n=== every tier says what it is, for the admin ===");
ok(
  "each carries a note and a label",
  Object.values(t.TIERS).every((s) => s.label.length > 0 && s.note.length > 0),
);
ok(
  "and the id matches its key, so a lookup cannot drift",
  t.TIER_IDS.every((id) => t.TIERS[id].id === id),
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
