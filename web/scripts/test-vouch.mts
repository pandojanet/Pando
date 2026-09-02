/**
 * M10.2 — confirming a recommendation, and the distinction that makes it safe.
 *
 * The estimate writes 10.2 as one sentence ("increases its validation count and
 * refreshes its last confirmed date"), which reads as one act. It is two, and
 * the checks below are mostly about keeping them apart: a refresh moves a date,
 * a vouch adds a parent, and letting the first do the second would advertise a
 * record with one parent behind it as "Validated by multiple parents".
 */

const v = (await import(`../lib/vouch.ts?v=${Date.now()}`)) as typeof import("../lib/vouch.ts");
const tl = (await import(`../lib/trust-labels.ts?v=${Date.now()}`)) as typeof import("../lib/trust-labels.ts");

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

console.log("\n=== a refresh and a vouch are different acts ===");
ok(
  "the parent already behind the record is refreshing it",
  v.confirmKindFor({ already_contributed: true }) === "refresh",
);
ok(
  "anybody else is vouching for it",
  v.confirmKindFor({ already_contributed: false }) === "vouch",
);

const refresh = v.effectOf("still_good", "refresh");
const vouch = v.effectOf("still_good", "vouch");

ok("a refresh moves the date", refresh.refresh_freshness);
ok(
  "and adds no contribution",
  !refresh.add_contribution,
  "the same parent saying still-good is not a second parent",
);
ok("a vouch also moves the date", vouch.refresh_freshness);
ok(
  "and does add one",
  vouch.add_contribution,
  "trust-labels counts firsthand contributions, so a vouch that adds none does nothing at all",
);
ok("both earn an impact event", refresh.record_impact && vouch.record_impact);

console.log("\n=== which is exactly what makes something validated ===");
/**
 * The reason a vouch has to arrive as a *contribution* rather than as a counter:
 * `labelsFor` reads `firsthand_count`, and nothing anywhere reads
 * `shares.validated_count` when it decides what to say about a record. A vouch
 * that only bumped the counter would leave the label exactly where it was.
 */
const base = {
  kind: "activity",
  provenance: "parent_submitted" as const,
  secondhand_count: 0,
  recommending_count: 1,
  human_reviewed: true,
  last_confirmed_at: new Date(),
};
const oneParent = tl.labelsFor({ ...base, firsthand_count: 1 });
const twoParents = tl.labelsFor({ ...base, firsthand_count: 2, recommending_count: 2 });
ok(
  "one parent is not validated",
  !oneParent.labels.includes(tl.TRUST_LABEL.VALIDATED),
  oneParent.labels.join(" · "),
);
ok(
  "two parents is",
  twoParents.labels.includes(tl.TRUST_LABEL.VALIDATED),
  twoParents.labels.join(" · "),
);
ok(
  "so the vouch's contribution is the whole mechanism",
  vouch.add_contribution && !refresh.add_contribution,
  "a refresh must never be able to produce that second parent",
);

console.log("\n=== a withdrawal is marked, never applied ===");
const no = v.effectOf("no_longer", "refresh");
ok("it does not refresh the date", !no.refresh_freshness, "that is the content of the answer");
ok("it marks the record stale", no.mark_stale);
ok(
  "it raises a flag for a person",
  no.flag_reason === "recommendation_withdrawn",
  "one parent's changed mind is evidence, not a verdict — others may still stand behind it",
);
ok("it adds no contribution", !no.add_contribution);
ok(
  "and it still counts as a response",
  no.record_impact,
  "paying only for good news is how a freshness loop stops hearing bad news",
);
ok(
  "a vouching stranger's no does not add a contribution either",
  !v.effectOf("no_longer", "vouch").add_contribution,
);

console.log("\n=== an unreadable reply changes nothing ===");
const unclear = v.effectOf("unclear", "refresh");
ok(
  "nothing at all",
  !unclear.refresh_freshness &&
    !unclear.add_contribution &&
    !unclear.record_impact &&
    !unclear.mark_stale &&
    unclear.flag_reason === null,
);

console.log("\n=== reading the reply ===");
ok("YES is still-good", v.readPingReply("YES") === "still_good");
ok("a lowercase yes with a full stop is too", v.readPingReply("yes.") === "still_good");
ok('"still great" counts', v.readPingReply("Still great") === "still_good");
ok("NO is a withdrawal", v.readPingReply("no") === "no_longer");
ok('"not anymore" is too', v.readPingReply("not anymore") === "no_longer");
ok(
  '"no idea, we moved away" is neither',
  v.readPingReply("no idea, we moved away") === "unclear",
  "a substring test would retire a good record because somebody moved house",
);
ok(
  '"yes but the price went up" is neither',
  v.readPingReply("yes but the price went up") === "unclear",
  "that is a sentence for a person to read, not a refresh",
);
ok("and an unrelated question is neither", v.readPingReply("when does it start?") === "unclear");

console.log("\n=== every outcome is total ===");
/* A verdict this file cannot express is one the repo would have to invent. */
for (const reply of ["still_good", "no_longer", "unclear"] as const) {
  for (const kind of ["refresh", "vouch"] as const) {
    const e = v.effectOf(reply, kind);
    ok(
      `${reply} / ${kind} decides every field`,
      typeof e.refresh_freshness === "boolean" &&
        typeof e.add_contribution === "boolean" &&
        typeof e.record_impact === "boolean" &&
        typeof e.mark_stale === "boolean",
    );
  }
}
ok(
  "and nothing both refreshes and marks stale",
  (["still_good", "no_longer", "unclear"] as const).every((r) =>
    (["refresh", "vouch"] as const).every((k) => {
      const e = v.effectOf(r, k);
      return !(e.refresh_freshness && e.mark_stale);
    }),
  ),
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
