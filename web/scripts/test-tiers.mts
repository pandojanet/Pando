import type { ImpactEvent, TierId } from "../lib/tiers.ts";

/**
 * M9.3 / 9.4 — the ladder, and the things it must refuse to do.
 *
 * Most of the value is in the refusals, as with `test:trust`: a tier that is too
 * generous hands out access nobody earned, and a tier that moves backwards takes
 * away access somebody did. Both are silent failures — nothing throws, a number
 * is just wrong — so they are asserted rather than reasoned about.
 */

const t = (await import(`../lib/tiers.ts?v=${Date.now()}`)) as typeof import("../lib/tiers.ts");

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

/** n events of one kind, at one rating. */
const many = (kind: ImpactEvent["kind"], n: number, quality: number | null = null) =>
  Array.from({ length: n }, () => ({ kind, quality }));

const tierOf = (events: ImpactEvent[], founding = false): TierId =>
  t.tierFor({ founding, equivalents: t.responseEquivalents(events) });

console.log("\n=== the ladder is the estimate's five, in order ===");
ok("there are exactly five", t.TIER_IDS.length === 5, t.TIER_IDS.join(" -> "));
ok(
  "and they are named as the estimate names them",
  t.TIER_IDS.join(",") === "member,contributor,trusted,local_expert,founding",
  t.TIER_IDS.join(","),
);
ok(
  "each id matches its key, so a lookup cannot drift",
  t.TIER_IDS.every((id) => t.TIERS[id].id === id),
);
ok(
  "the thresholds only ever increase",
  t.TIER_IDS.map((id) => t.TIERS[id].threshold)
    .filter((v): v is number => v !== null)
    .every((v, i, all) => i === 0 || v > all[i - 1]),
);
ok(
  "founding has no threshold at all",
  t.TIERS.founding.threshold === null,
  "it is granted by a person on the second approved contribution, not earned by volume",
);

console.log("\n=== what somebody has to do to move ===");
ok("a parent who has given nothing is a Member", tierOf([]) === "member");
ok(
  "one approved contribution makes a Contributor",
  tierOf(many("contribution_approved", 1)) === "contributor",
);
ok("three makes Trusted", tierOf(many("contribution_approved", 3)) === "trusted");
ok("eight makes a Local Expert", tierOf(many("contribution_approved", 8)) === "local_expert");
ok(
  "seven does not",
  tierOf(many("contribution_approved", 7)) === "trusted",
  "a threshold that rounds up is a threshold nobody agreed to",
);

console.log("\n=== 9.4  three confirmations are one quality response ===");
ok(
  "the ratio is a named constant, not a 3 in a query",
  t.FRESHNESS_PER_RESPONSE === 3,
  "9.4 calls it configurable, which means it has to have a name",
);
ok(
  "three confirmations reach Contributor",
  tierOf(many("freshness_confirmed", 3)) === "contributor",
);
ok(
  "two do not",
  tierOf(many("freshness_confirmed", 2)) === "member",
  "confirming is one tap — it cannot be worth what writing an answer is worth",
);
ok(
  "and the remainder is kept rather than rounded away",
  t.responseEquivalents(many("freshness_confirmed", 2)) > 0.66,
  "rounding each one down would leave a monthly confirmer at zero forever",
);
ok(
  "nine confirmations are worth three responses",
  Math.abs(t.responseEquivalents(many("freshness_confirmed", 9)) - 3) < 1e-9,
);

console.log("\n=== a rated reply, and an unrated one ===");
ok(
  "a reply an admin rated 3 is a full quality response",
  t.weightOf({ kind: "blast_answered", quality: 3 }) === 1,
);
ok(
  "a reply rated 1 is worth nothing",
  t.weightOf({ kind: "blast_answered", quality: 1 }) === 0,
  "somebody has read it and said it was not useful",
);
ok(
  "an unrated reply is worth half",
  t.weightOf({ kind: "blast_answered", quality: null }) === 0.5,
  'answering is giving, but nobody has yet said it was a "quality response"',
);
ok(
  "so two unrated replies make a Contributor and one does not",
  tierOf(many("blast_answered", 2)) === "contributor" &&
    tierOf(many("blast_answered", 1)) === "member",
);

console.log("\n=== usage is impact, and is deliberately not a rung ===");
ok(
  "answer_used is worth nothing toward a tier",
  t.EVENT_WEIGHT.answer_used === 0,
  "one popular share used fifty times would otherwise mint a Local Expert",
);
ok(
  "fifty uses leave a Member a Member",
  tierOf(many("answer_used", 50)) === "member",
);
ok(
  "and it still cannot lift somebody past a rung they did not earn",
  tierOf([...many("contribution_approved", 2), ...many("answer_used", 99)]) === "contributor",
);

console.log("\n=== founding is permanent, and wins outright ===");
ok("a founding contributor with no events is still Founding", tierOf([], true) === "founding");
ok(
  "and stays Founding however much they later do",
  tierOf(many("contribution_approved", 40), true) === "founding",
  "the estimate: founding contributors keep permanent status",
);
ok(
  "it is checked before the ladder, so the ledger's start date cannot demote anybody",
  tierOf([], true) === "founding",
  "the seed cohort's contributions predate the impact table",
);

console.log("\n=== the ladder never goes backwards ===");
/**
 * A tier computed over a rolling window would swing — Local Expert in March,
 * Contributor in May, having done nothing wrong. Access earned is not access
 * rented; current engagement is the response-rate governor's job, in
 * `outreach-policy.ts`, and punishing the same silence twice is the failure
 * this asserts against.
 */
const growing = [
  many("contribution_approved", 1),
  many("contribution_approved", 3),
  many("contribution_approved", 8),
  many("contribution_approved", 20),
];
const reached = growing.map((events) => t.TIER_IDS.indexOf(tierOf(events)));
ok(
  "more activity never lowers a tier",
  reached.every((v, i) => i === 0 || v >= reached[i - 1]),
  reached.join(" "),
);
ok(
  "and the total is lifetime, not a window",
  tierOf(many("contribution_approved", 8)) === "local_expert",
  "nothing here takes a date, which is what makes that true by construction",
);

console.log("\n=== nextTier is for the admin, never for the parent ===");
ok("a Member's next rung is Contributor", t.nextTier("member")?.id === "contributor");
ok("a Local Expert has no next rung", t.nextTier("local_expert") === null, "founding is not earned by volume");
ok("and neither does Founding", t.nextTier("founding") === null);

console.log("\n=== every tier says what it is ===");
ok(
  "each carries a label and a note an admin can act on",
  t.TIER_IDS.every((id) => t.TIERS[id].label.length > 0 && t.TIERS[id].note.length > 0),
);
ok(
  "and no label is a number",
  t.TIER_IDS.every((id) => !/\d/.test(t.TIERS[id].label)),
  "9.4: the reward is better access rather than points",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
