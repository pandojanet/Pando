/**
 * The launch incentive (client, 10 Sep §6) — one guaranteed $10 payment.
 *
 * Its own suite for the reason `test:payments` has one: this decides whether a
 * real person is owed real money, and the rule has **four** conditions where
 * the one it replaces had one. Every condition is exercised on its own, because
 * a rule that ANDs four things passes every test that only ever fails one.
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

/** Everything true, well before the deadline. */
const qualified = {
  phone_verified: true,
  neighborhood_answered: true,
  children_answered: true,
  recommendations: 1,
  reason: "Small groups and a very patient teacher.",
  has_invite: true,
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
ok(
  "her confirmation copy, verbatim",
  r.REWARD_CONFIRMATION === "Done — watch out for your payment this week",
  r.REWARD_CONFIRMATION,
);

console.log("\n=== all four conditions, and each one alone ===");
ok("everything true is eligible", r.rewardStatus(qualified) === "eligible");

/* One at a time, because ANDing four things hides three of them. */
const without = (
  patch: Partial<import("../lib/rewards.ts").RewardInput>,
  label: string,
) =>
  ok(
    label,
    r.rewardStatus({ ...qualified, ...patch }) !== "eligible",
    r.rewardStatus({ ...qualified, ...patch }),
  );

without({ phone_verified: false }, "an unverified number is not eligible");
without({ neighborhood_answered: false }, "no neighborhood is not eligible");
without({ children_answered: false }, "no children answered is not eligible");
without({ recommendations: 0 }, "no recommendation is not eligible");
without({ reason: null }, "a recommendation with no reason is not eligible");
without({ has_invite: false }, "somebody who arrived on no invite is not eligible");

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
  r.rewardStatus({ ...qualified, at: new Date("2026-10-31T23:59:00-07:00") }) === "eligible",
);
/* Unfinished and late is unfinished — the offer closing is not the reason they
   are not being paid, and saying so would be the wrong conversation. */
ok(
  "but somebody who never finished is `started`, deadline or no deadline",
  r.rewardStatus({
    ...qualified,
    reason: null,
    at: new Date("2026-12-01T09:00:00-07:00"),
  }) === "started",
);
ok(
  "and somebody who did nothing at all is `none`",
  r.rewardStatus({
    phone_verified: false,
    neighborhood_answered: false,
    children_answered: false,
    recommendations: 0,
    reason: null,
    has_invite: true,
  }) === "none",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
