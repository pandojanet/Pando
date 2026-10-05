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
 * The chat's Founding progress (5 Oct), the client's own sentences. Read from
 * FOUNDING_MIN_APPROVED, and none of them promises a payment date: the last
 * step is an admin's, not the parent's.
 */
const progress = (completed: number, justCompleted: boolean, profileReady = true) =>
  r.foundingProgressLine({ completed, justCompleted, profileReady });
ok("nothing completed says what to do", progress(0, false) === "Complete 2 contributions to become a Founding Contributor.", String(progress(0, false)));
ok(
  "the first completed card is a moment, in her words",
  progress(1, true) ===
    "Great — this counts. You’re 1 of 2 contributions in and 50% of the way to becoming a Founding Contributor.",
  String(progress(1, true)),
);
ok(
  "a card that did not complete, with one already done, reads the plain progress",
  progress(1, false) === "1 of 2 complete — you’re 50% of the way there.",
  String(progress(1, false)),
);
ok("the second completed card is the Founding line", progress(2, true) === "You did it — you’re a Founding Contributor.", String(progress(2, true)));
ok("but not while the profile is below the bar", progress(2, true, false) === null);
ok("and a third card repeats nothing", progress(3, true) === null && progress(3, false) === null);
ok(
  "no line promises a payment date",
  [progress(0, false), progress(1, true), progress(1, false), progress(2, true)].every(
    (line) => !/this week|payment|reward|[$][0-9]/i.test(String(line)),
  ),
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

/* 4 Oct — a parent who never reached the last screen is still owed a decision.
   Only `/done/ask` writes pending_founding, and the one parent who met every
   requirement on the live cohort had closed the tab before it. */
{
  const fs = await import("node:fs");
  const read = fs.readFileSync(new URL("../lib/server/repo/admin-read.ts", import.meta.url), "utf8");
  ok(
    "the Founding queue takes 'none' as well as 'pending_founding'",
    /AWAITING_FOUNDING_DECISION = sql`fc\.founding in \('none', 'pending_founding'\)`/.test(read),
  );
  ok(
    "and the queue and its badge read that one expression",
    /where \$\{AWAITING_FOUNDING_DECISION\}/.test(read) &&
      /\$\{AWAITING_FOUNDING_DECISION\} and \$\{meetsFoundingRequirements\(completeCount\)\}/.test(read) &&
      /and \$\{meetsFoundingRequirements\(completeCount\)\}\s+group by fc\.person_id/.test(read) &&
      !/founding = 'pending_founding'/.test(read),
  );
  /* 5 Oct — Founding counts COMPLETE contributions, not approved ones: the
     predicate takes the count as a parameter, and nothing in the file still
     reads the view's approved_contributions as the number that decides. */
  ok(
    "the requirements predicate counts complete contributions, from one TypeScript rule",
    /function meetsFoundingRequirements\(completeCount: SQL\)/.test(read) &&
      /\(\$\{completeCount\}\) >= \$\{FOUNDING_MIN_APPROVED\}/.test(read) &&
      !/fc\.approved_contributions >= /.test(read) &&
      !/MEETS_FOUNDING_REQUIREMENTS/.test(read),
  );
  ok(
    "and the list, the detail page, the queue and the overview all take the count from it",
    (read.match(/completeCounts\(db/g) ?? []).length >= 4,
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
