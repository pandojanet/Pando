import type { Candidate } from "../lib/trust-labels.ts";

/**
 * M5.6 — the trust labels and the freshness ladder.
 *
 * Invariants 3 and 4 are enforced in `lib/trust-labels.ts` and nowhere else, so
 * **most of what follows asserts that a label does not appear**. A suite that
 * only proved the right words come out would pass while "Vouched by a local
 * parent" sat on a record no parent ever touched — which is the single most
 * damaging thing this product could say.
 */

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

const NOW = new Date("2026-08-27T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  kind: "activity",
  provenance: "parent_submitted",
  firsthand_count: 1,
  secondhand_count: 0,
  recommending_count: 0,
  human_reviewed: true,
  last_confirmed_at: daysAgo(10),
  ...over,
});
const labels = (over: Partial<Candidate> = {}) =>
  t.labelsFor(candidate(over), { now: NOW }).labels;
const has = (over: Partial<Candidate>, label: string) => labels(over).includes(label);

console.log("\n=== the approved wording is verbatim ===");
/* Not a style test. The estimate and spec §11 quote these strings, and a label is
   Pando's whole claim about where a sentence came from — so a reword is a product
   decision and a re-approval, never a copy edit. */
for (const [key, want] of [
  ["PUBLIC", "Public/general information"],
  ["SHARED", "Shared by a local parent"],
  ["VOUCHED", "Vouched by a local parent"],
  ["VALIDATED", "Validated by multiple parents"],
  ["FRESH_NETWORK", "Fresh network answer"],
  ["HUMAN_REVIEWED", "Human-reviewed"],
  ["REFERENCE_AVAILABLE", "Reference available"],
] as Array<[keyof typeof t.TRUST_LABEL, string]>) {
  ok(`${key} is exactly "${want}"`, t.TRUST_LABEL[key] === want, `got "${t.TRUST_LABEL[key]}"`);
}
ok(
  'the confirmed line keeps the spec\'s "Last confirmed …" shape',
  (t.lastConfirmedLabel(daysAgo(40)) ?? "").startsWith("Last confirmed "),
  `got "${t.lastConfirmedLabel(daysAgo(40))}"`,
);

console.log("\n=== invariant 4  a parent-trust label needs a parent behind it ===");
ok(
  "an admin-entered record is public information, never shared-by-a-parent",
  has({ provenance: "admin_entered", firsthand_count: 0 }, t.TRUST_LABEL.PUBLIC) &&
    !has({ provenance: "admin_entered", firsthand_count: 0 }, t.TRUST_LABEL.SHARED),
);
ok(
  "a migrated record likewise",
  has({ provenance: "migrated", firsthand_count: 0 }, t.TRUST_LABEL.PUBLIC),
);
ok(
  "parent_submitted with NO firsthand experience is still public information",
  has({ firsthand_count: 0, secondhand_count: 3 }, t.TRUST_LABEL.PUBLIC),
  "secondhand is welcome and labelled — it is never a trust label on its own",
);
ok(
  "and it carries no parent label at all",
  !labels({ firsthand_count: 0, secondhand_count: 3 }).some((l) =>
    [t.TRUST_LABEL.SHARED, t.TRUST_LABEL.VOUCHED, t.TRUST_LABEL.VALIDATED].includes(
      l as never,
    ),
  ),
);
ok(
  "three secondhand reports never add up to one firsthand one",
  !has({ firsthand_count: 0, secondhand_count: 3 }, t.TRUST_LABEL.VALIDATED),
);

console.log("\n=== the guard  public info never wears a trust label ===");
const publicOnly = t.labelsFor(
  candidate({ provenance: "admin_entered", firsthand_count: 0 }),
  { now: NOW },
);
ok("public_only is stated as a fact, not left to be inferred", publicOnly.public_only === true);
ok(
  "a parent-backed record is not public_only",
  t.labelsFor(candidate(), { now: NOW }).public_only === false,
);
ok(
  '"Human-reviewed" may sit beside the public label, because it is about our process',
  has({ provenance: "admin_entered", firsthand_count: 0, human_reviewed: true },
      t.TRUST_LABEL.HUMAN_REVIEWED),
);
ok(
  "an unreviewed public record says only that it is public",
  JSON.stringify(labels({ provenance: "admin_entered", firsthand_count: 0, human_reviewed: false }))
    === JSON.stringify([t.TRUST_LABEL.PUBLIC]),
);

console.log("\n=== shared vs vouched vs validated ===");
ok(
  "one parent who used it but did not recommend it — shared",
  has({ firsthand_count: 1, recommending_count: 0 }, t.TRUST_LABEL.SHARED),
);
ok(
  "one parent who would recommend it — vouched",
  has({ firsthand_count: 1, recommending_count: 1 }, t.TRUST_LABEL.VOUCHED),
);
ok(
  "shared and vouched are never both claimed",
  labels({ firsthand_count: 1, recommending_count: 1 }).filter((l) =>
    [t.TRUST_LABEL.SHARED, t.TRUST_LABEL.VOUCHED].includes(l as never),
  ).length === 1,
);
ok(
  "two firsthand parents — validated",
  has({ firsthand_count: 2, recommending_count: 2 }, t.TRUST_LABEL.VALIDATED),
);
ok(
  "validated replaces the singular claims rather than stacking on them",
  labels({ firsthand_count: 2, recommending_count: 2 }).filter((l) =>
    [t.TRUST_LABEL.SHARED, t.TRUST_LABEL.VOUCHED, t.TRUST_LABEL.VALIDATED].includes(
      l as never,
    ),
  ).length === 1,
);
ok(
  "two parents who both declined to recommend are still validated as experience",
  has({ firsthand_count: 2, recommending_count: 0 }, t.TRUST_LABEL.VALIDATED),
  "the label reports how many have used it, not how enthusiastic they were",
);

console.log("\n=== labels that only appear when earned ===");
ok(
  '"Fresh network answer" is absent until a live Ask sets it',
  !labels().includes(t.TRUST_LABEL.FRESH_NETWORK),
);
ok("and present when it does", has({ from_network_ask: true }, t.TRUST_LABEL.FRESH_NETWORK));
ok(
  '"Reference available" is absent by default',
  !labels().includes(t.TRUST_LABEL.REFERENCE_AVAILABLE),
);
ok(
  "and present for a caregiver whose family will vouch",
  has({ kind: "caregiver", reference_available: true }, t.TRUST_LABEL.REFERENCE_AVAILABLE),
);
ok(
  '"Human-reviewed" is absent when nobody has read it',
  !labels({ human_reviewed: false }).includes(t.TRUST_LABEL.HUMAN_REVIEWED),
);

console.log("\n=== freshness, per category and from the record's own date ===");
ok("10 days old — fresh", t.freshnessOf(daysAgo(10), "activity", undefined, NOW) === "fresh");
ok("95 days — ageing for an activity", t.freshnessOf(daysAgo(95), "activity", undefined, NOW) === "ageing");
ok("130 days — stale for an activity", t.freshnessOf(daysAgo(130), "activity", undefined, NOW) === "stale");
ok(
  "the same 130 days is still fresh for a place",
  t.freshnessOf(daysAgo(130), "place", undefined, NOW) === "fresh",
  "camps and playgrounds do not age like a class — that is why the policy is per category",
);
ok(
  "a caregiver ages on her own clock",
  t.freshnessOf(daysAgo(130), "caregiver", undefined, NOW) === "ageing",
);
ok(
  "no date at all is stale, never fresh",
  t.freshnessOf(null, "activity", undefined, NOW) === "stale",
  "an unknown age must not inherit the most generous answer",
);
ok(
  "an unparseable date is stale too",
  t.freshnessOf("not a date", "activity", undefined, NOW) === "stale",
);
ok(
  "an unknown category takes the strictest policy, not a default of fresh",
  t.freshnessOf(daysAgo(100), "something-new", undefined, NOW) !== "fresh",
);
ok(
  "the policy table wins over the fallback",
  t.freshnessOf(daysAgo(10), "activity", [{ kind: "activity", stale_days: 5, ageing_days: 2 }], NOW)
    === "stale",
  "the seeded freshness_policy is the authority at query time",
);

console.log("\n=== a stale record is marked, never hidden ===");
const old = t.labelsFor(candidate({ last_confirmed_at: daysAgo(300) }), { now: NOW });
ok("it is stale", old.freshness === "stale");
ok(
  "it keeps its parent label",
  old.labels.includes(t.TRUST_LABEL.SHARED) || old.labels.includes(t.TRUST_LABEL.VOUCHED),
);
ok(
  "and it carries the date, so the reader can judge it",
  old.labels.some((l) => l.startsWith("Last confirmed ")),
  "the spec's answer to old knowledge is to mark it old, not to drop it",
);
ok(
  "usable() does not exclude it for being stale",
  t.usable(candidate({ last_confirmed_at: daysAgo(300) })).ok,
);

console.log("\n=== usable() — what no label can fix ===");
ok("an unreviewed record is not usable in the pilot", !t.usable(candidate({ human_reviewed: false })).ok);
ok(
  "and says why",
  t.usable(candidate({ human_reviewed: false })).reason === "not_reviewed",
);
ok(
  "firsthand experience on a non-parent record is a data fault, not a label choice",
  !t.usable(candidate({ provenance: "admin_entered", firsthand_count: 2 })).ok,
);
ok("an ordinary reviewed parent record is usable", t.usable(candidate()).ok);

console.log("\n=== nothing load-bearing is last ===");
/* The generator renders for SMS length and may drop from the end, so the
   strongest claim has to be first. */
ok(
  "the parent claim leads",
  labels({ firsthand_count: 2, recommending_count: 2, from_network_ask: true })[0] ===
    t.TRUST_LABEL.VALIDATED,
);
ok(
  "and the date is last, where a trim costs least",
  (() => {
    const l = labels({ firsthand_count: 2, recommending_count: 2, from_network_ask: true });
    return l[l.length - 1].startsWith("Last confirmed ");
  })(),
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
