import type { RoutingInput } from "../lib/answer-routing.ts";

/**
 * M5.8 — what holds an answer back.
 *
 * Two layers are tested separately on purpose. The **pilot's blanket rule** holds
 * everything (strategy §19), and it is meant to come off one day; the **specific
 * rules** are what remain when it does. Testing only the blanket one would mean
 * discovering the specific ones are wrong on the day they start being the only
 * thing standing between a parent and an unread answer.
 *
 * So most of what follows checks that a rule fires **for the right reason** and
 * is marked `permanent` correctly — that flag is what says "this would still be
 * held with the pilot rule off".
 */

const r = (await import(`../lib/answer-routing.ts?v=${Date.now()}`)) as typeof import("../lib/answer-routing.ts");

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

/** A solid, ordinary answer: two parent-backed records, nothing sensitive. */
const good = (over: Partial<RoutingInput> = {}): RoutingInput => ({
  sensitivity: "ordinary",
  caregiver_related: false,
  public_only: false,
  used: 3,
  next_step: "none",
  ...over,
});
const route = (over: Partial<RoutingInput> = {}) => r.routeAnswer(good(over));

console.log("\n=== the pilot reads everything ===");
ok("the blanket rule is on", r.PILOT_HOLD_EVERYTHING === true, "strategy §19");
ok(
  "so even a solid ordinary answer waits",
  route().hold === true,
  "for the first months every answer is read by a person",
);
ok(
  "and it says that is the only reason",
  route().reason === "pilot_review_all",
  "an answer held only because everything is held reads differently from one that will always wait",
);
ok("which is not permanent", route().permanent === false);

console.log("\n=== the rules that will still hold when the blanket comes off ===");
for (const sensitivity of ["high_stakes", "peer_support", "named_allegation"] as const) {
  const v = route({ sensitivity });
  ok(`${sensitivity} is held`, v.hold && v.reason === "sensitive");
  ok(`${sensitivity} is held permanently`, v.permanent === true);
}
ok(
  "a caregiver answer is held permanently",
  (() => {
    const v = route({ caregiver_related: true });
    return v.hold && v.reason === "caregiver" && v.permanent;
  })(),
  "§19: everything caregiver-related keeps human eyes permanently",
);
ok(
  "and the generator asking for a person is permanent too",
  (() => {
    const v = route({ next_step: "human_review" });
    return v.hold && v.reason === "generator_asked" && v.permanent;
  })(),
);

console.log("\n=== the specific reason beats the blanket one ===");
ok(
  "sensitive is reported as sensitive, not as pilot_review_all",
  route({ sensitivity: "high_stakes" }).reason === "sensitive",
  "the reviewer's first question is why this one is here",
);
ok(
  "caregiver likewise",
  route({ caregiver_related: true }).reason === "caregiver",
);
ok(
  "and a thin answer is reported as thin",
  route({ used: 1 }).reason === "low_evidence",
);
ok(
  "public-only is its own reason, not folded into thin",
  route({ public_only: true, used: 4 }).reason === "public_only",
  "it changes what the reviewer is checking, not just how it reads",
);

console.log("\n=== order: the costlier mistake is checked first ===");
ok(
  "sensitive beats caregiver when both are true",
  route({ sensitivity: "named_allegation", caregiver_related: true }).reason === "sensitive",
  "a claim about a named person is owed silence, which is stricter than review",
);
ok(
  "caregiver beats public_only",
  route({ caregiver_related: true, public_only: true }).reason === "caregiver",
);
ok(
  "public_only beats low_evidence",
  route({ public_only: true, used: 1 }).reason === "public_only",
);

console.log("\n=== the temporary holds are marked temporary ===");
ok("public_only is not permanent", route({ public_only: true }).permanent === false);
ok("low_evidence is not permanent", route({ used: 1 }).permanent === false);
ok(
  "because a four-parent answer is exactly what §19 says can eventually pass",
  route({ used: 4 }).permanent === false,
);

console.log("\n=== the caregiver word scan is generous on purpose ===");
for (const text of [
  "our nanny loved it",
  "a great babysitter for date nights",
  "we used an au pair that year",
  "night nurse for the first six weeks",
  "the nanny share fell through",
  "ask their childminder",
]) {
  ok(`"${text.slice(0, 28)}…" is caught`, r.mentionsCaregiver(text));
}
ok(
  "an ordinary class answer is not",
  !r.mentionsCaregiver("Toddler Tunes on Lake — the 9am is calmer"),
);
ok(
  "and the asymmetry is the argument",
  r.mentionsCaregiver("NANNY") && !r.mentionsCaregiver("nan bread"),
  "a false positive costs one extra read; a miss costs a caregiver named to a parent unchecked",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
