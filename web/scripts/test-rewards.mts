/**
 * The launch incentive (client, 10 Sep §6) — one guaranteed $10 payment.
 *
 * Its own suite for the reason `test:payments` has one: this decides whether a
 * real person is owed real money, and the rule has **six** conditions where the
 * one it replaced had one. Every condition is exercised on its own, because a
 * rule that ANDs six things passes every test that only ever fails one.
 *
 * The reward is a decision now, not an arithmetic (16 Sep). The developer
 * folded it into the Founding queue - a full profile plus two contributions an
 * admin approved - so the states are approved / in_review / not_met, and
 * approved is read off people.founding rather than computed.
 */
const r = (await import(`../lib/rewards.ts?v=${Date.now()}`)) as typeof import("../lib/rewards.ts");

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};

/** Every requirement met, nobody has decided yet, well before the deadline. */
const qualified = {
  phone_verified: true,
  neighborhood_answered: true,
  children_answered: true,
  profile_depth: 100,
  approved_contributions: 2,
  reason: "Small groups and a very patient teacher.",
  founding_approved: false,
  at: new Date("2026-10-01T12:00:00-07:00"),
};

console.log("\n=== the offer is one sentence, said the same way twice ===");
ok("it names the amount", /\$10 reward/.test(r.REWARD_OFFER), r.REWARD_OFFER);
ok("and the deadline", /Oct 31, 2026/.test(r.REWARD_OFFER));
ok("and both required questions", /two required questions/.test(r.REWARD_OFFER));
ok("and that the recommendation needs a reason", /with a reason/.test(r.REWARD_OFFER));
/**
 * ⚠ Terms is a **link** on every surface, so it must not be inside the
 * sentence: a promise whose terms are plain text is a promise nobody can read
 * the terms of. Her instruction is "link Terms to the page".
 */
ok(
  "and it does not carry the word Terms as text",
  !/Terms/.test(r.REWARD_OFFER),
  r.REWARD_OFFER,
);
/**
 * ⚠ **Read in Pacific, never in UTC** — and the first version of this check
 * got it wrong, which is the point of keeping it. The deadline is the last
 * second of 31 October *in Pasadena*, which is already 1 November in UTC, so
 * `getUTCMonth()` reports November and a reader concludes the label is a day
 * out. It is not; the timezone is.
 */
const deadlineInPacific = new Date(r.REWARD_DEADLINE).toLocaleDateString("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
});
ok(
  "the deadline label and the date cannot disagree",
  deadlineInPacific === r.REWARD_DEADLINE_LABEL,
  `${deadlineInPacific} vs ${r.REWARD_DEADLINE_LABEL}`,
);
/**
 * Her sentence promised payment *that week*, and under the Founding
 * requirements a saved card is no longer the last step: two admin approvals
 * are. So the check is that the copy no longer commits somebody else's
 * decision - not that it matches a string, which would only pin our own
 * provisional wording in place.
 */
ok(
  "the confirmation no longer promises a payment date",
  !/this week|payment/i.test(r.REWARD_CONFIRMATION),
  r.REWARD_CONFIRMATION,
);

console.log("\n=== all six conditions, and each one alone ===");
ok(
  "everything met, nobody decided yet, is in_review",
  r.rewardStatus(qualified) === "in_review",
  r.rewardStatus(qualified),
);
ok("and meetsFoundingRequirements agrees", r.meetsFoundingRequirements(qualified));

/* One at a time, because ANDing six things hides five of them. */
const without = (
  patch: Partial<import("../lib/rewards.ts").RewardInput>,
  label: string,
) =>
  ok(
    label,
    r.rewardStatus({ ...qualified, ...patch }) === "not_met" &&
      !r.meetsFoundingRequirements({ ...qualified, ...patch }),
    r.rewardStatus({ ...qualified, ...patch }),
  );

without({ phone_verified: false }, "an unverified number does not qualify");
without({ neighborhood_answered: false }, "no neighborhood does not qualify");
without({ children_answered: false }, "no children answered does not qualify");
without({ reason: null }, "no reason on any contribution does not qualify");

/**
 * The two the developer added on 16 Sep, each checked one under the line as
 * well as at it - an off-by-one here is a parent told they earned nothing.
 */
without(
  { profile_depth: r.FOUNDING_MIN_PROFILE_DEPTH - 1 },
  "one point short of the profile bar does not qualify",
);
without(
  { approved_contributions: r.FOUNDING_MIN_APPROVED - 1 },
  "one approved contribution short does not qualify",
);
ok(
  "exactly the profile bar does qualify",
  r.meetsFoundingRequirements({
    ...qualified,
    profile_depth: r.FOUNDING_MIN_PROFILE_DEPTH,
  }),
);
ok(
  "exactly two approved contributions do qualify",
  r.meetsFoundingRequirements({
    ...qualified,
    approved_contributions: r.FOUNDING_MIN_APPROVED,
  }),
);

/**
 * An invite is no longer a condition, and that is deliberate. Her section 6
 * said invite-code holders only, while entry has been open since 7 Sep -
 * measured on the live cohort, ten of twelve real parents arrived without
 * one, so the clause silently put the reward out of reach for most of the
 * people it was written for. Pinned as an absence so it cannot creep back in
 * without somebody also re-closing the door it depends on.
 */
ok(
  "arriving on no invite is not by itself disqualifying",
  r.meetsFoundingRequirements(qualified),
);

/**
 * The admin's yes outranks every condition above, permanently. A record
 * retired by the freshness queue must not un-approve somebody who has already
 * been told they earned it - the monotonic-ladder rule of 1 Sep.
 */
ok(
  "an approved parent stays approved even if a requirement lapses",
  r.rewardStatus({
    ...qualified,
    founding_approved: true,
    approved_contributions: 0,
    profile_depth: 0,
  }) === "approved",
);

console.log("\n=== a reason is a sentence, not a word ===");
/**
 * ⚠ The floor is what stops *"good"* and *"ok"* being worth ten dollars — the
 * same thin answers the 26 Aug confirm-back was written for. It is deliberately
 * **necessary and not sufficient**: it cannot tell "asdfghjkl" from a real
 * sentence, which is a judgement and stays with whoever approves the card.
 */
for (const thin of ["", "  ", "good", "ok", "we loved it"]) {
  ok(`“${thin.trim() || "(blank)"}” is not a reason`, !r.hasReason(thin));
}
ok("a real sentence is", r.hasReason("Small groups and the teacher is patient."));
ok(
  "and the floor is stated once, not typed into a condition",
  r.REASON_MIN_LENGTH === 12,
  String(r.REASON_MIN_LENGTH),
);

console.log("\n=== the deadline, and why it is checked last ===");
ok(
  "everything done, after Oct 31, reads as missed rather than unfinished",
  r.rewardStatus({ ...qualified, at: new Date("2026-11-01T09:00:00-07:00") }) ===
    "missed_deadline",
  r.rewardStatus({ ...qualified, at: new Date("2026-11-01T09:00:00-07:00") }),
);
ok(
  "the last minute of Oct 31 Pacific still qualifies",
  r.rewardStatus({ ...qualified, at: new Date("2026-10-31T23:59:00-07:00") }) ===
    "in_review",
);
/* Unfinished and late is unfinished — the offer closing is not the reason they
   are not being paid, and saying so would be the wrong conversation. */
ok(
  "but somebody who never finished is `not_met`, deadline or no deadline",
  r.rewardStatus({
    ...qualified,
    reason: null,
    at: new Date("2026-12-01T09:00:00-07:00"),
  }) === "not_met",
);
/* And an admin who approves somebody late has still approved them: the
   deadline is about the offer, never about a decision already taken. */
ok(
  "an approval after the deadline is still an approval",
  r.rewardStatus({
    ...qualified,
    founding_approved: true,
    at: new Date("2026-12-01T09:00:00-07:00"),
  }) === "approved",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
