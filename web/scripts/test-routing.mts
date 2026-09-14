import type { HoldReason, RoutingInput } from "../lib/answer-routing.ts";

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
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
const onb = (await import(`../lib/onboarding.ts?v=${Date.now()}`)) as typeof import("../lib/onboarding.ts");

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

console.log("\n=== only what needs a person waits for one ===");
/* The blanket rule came off on 8 Sep (the client: only sensitive messages go
   to the admin). These are the checks that the automation is exactly as wide
   as it was meant to be and no wider. */
ok(
  "the blanket rule is off",
  r.PILOT_HOLD_EVERYTHING === false,
  "and turning it back on is the response to a bad answer reaching a parent",
);
ok(
  "a solid ordinary answer goes out by itself",
  route().hold === false,
);
/**
 * ⚠ These three asserted the opposite until 14 Sep, and why they were inverted
 * rather than deleted is the finding: the condition they described is **the
 * same expression** that offers a Network Check, so holding on it meant M7's
 * automatic entry could never fire without an admin first releasing the answer
 * that carries the offer.
 */
ok(
  "a thin answer goes out by itself — one parent behind it is still an answer",
  route({ used: 1 }).hold === false && route({ used: 1 }).reason === "not_held",
  "it is an unhelpful answer, and the honest alternative to it was silence",
);
ok(
  "so does one with no parent behind it at all",
  route({ public_only: true }).hold === false,
  "the label says Public/general information, so it cannot pose as a parent",
);
ok(
  "and the two move together, because they are one set",
  route({ public_only: true, used: 0 }).hold === false,
  "composeAnswer offers a blast on publicOnly || parentUsed < 2 — the same test",
);

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
  "a thin answer has no reason to report, because it is not held",
  route({ used: 1 }).reason === "not_held",
);

console.log("\n=== order: the costlier mistake is checked first ===");
ok(
  "sensitive beats caregiver when both are true",
  route({ sensitivity: "named_allegation", caregiver_related: true }).reason === "sensitive",
  "a claim about a named person is owed silence, which is stricter than review",
);
ok(
  "a caregiver answer is still held even when it is thin",
  route({ caregiver_related: true, public_only: true, used: 0 }).reason === "caregiver",
  "dropping the thin holds must not drop the permanent one underneath them",
);
ok(
  "and a sensitive one likewise",
  route({ sensitivity: "high_stakes", used: 0 }).reason === "sensitive",
);

console.log("\n=== the two reasons stay readable for the rows that carry them ===");
/**
 * Nothing produces these any more, and they must not be deleted from the union:
 * answers written before 14 Sep carry them and `labels.ts` renders them, so
 * removing the values breaks the admin on its own history.
 */
for (const reason of ["public_only", "low_evidence"] as const) {
  const kept: HoldReason = reason;
  ok(`${reason} is still a hold reason an old row can carry`, kept === reason);
}
ok(
  "and nothing routes to either of them today",
  route({ public_only: true, used: 0 }).reason === "not_held",
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

console.log("\n=== what the parent hears while a person reads it ===");
{
  /* Every answer is held in the pilot, and until 4 Sep nothing said so: a
     parent texted a question and got silence until an admin opened the queue.
     On a stranger's first message that is indistinguishable from a dead
     number, which is the one thing 5.9 exists to prevent. */
  ok("it names a person rather than a system", r.HELD_ACK.includes("Someone at Pando"));
  ok(
    "and promises no time",
    !/shortly|soon|minutes|hour/i.test(r.HELD_ACK),
    "nobody can keep one during a pilot worked by hand",
  );
  ok(
    "the clarifying question rides along when there is one",
    r.heldReply("How old is your child?").endsWith("How old is your child?"),
  );
  ok("and nothing is appended when there is not", r.heldReply(null) === r.HELD_ACK);

  /* One character outside GSM-7 cuts the budget from 160 to 70, so the
     acknowledgement is written inside it deliberately. `sms-segments.ts` is
     the measurement; these two are what keep it true. */
  ok(
    "written in GSM-7, so it costs one segment on its own",
    seg.planSegments(r.HELD_ACK).encoding === "gsm7" &&
      seg.planSegments(r.HELD_ACK).segments === 1,
    JSON.stringify(seg.planSegments(r.HELD_ACK)),
  );
  ok(
    "and two with the age question, not three",
    seg.planSegments(r.heldReply(onb.CLARIFYING_COPY.child_age)).segments === 2,
    "an em dash in that question used to make it three",
  );
}

console.log("\n=== 9 Sep: a message that is not a question is answered, not ignored ===");
{
  /**
   * The 7 Sep review's first gap. `unclear` and a mid-exchange `chitchat` were
   * closed on 8 Sep; a **cold** `chitchat` and **any** free-form `contribute`
   * still fell off the end of `handleInboundMessage` in silence — verified live
   * against the built app on 9 Sep, with *"we loved Little Gym"* producing no
   * reply, no queued answer and no pending question.
   */
  const r = (await import(
    `../lib/replies.ts?v=${Date.now()}`
  )) as typeof import("../lib/replies.ts");
  const s = (await import(
    `../lib/sms-segments.ts?v=${Date.now()}`
  )) as typeof import("../lib/sms-segments.ts");

  for (const [name, text] of [
    ["the share invite", r.SHARE_INVITE],
    ["the small-talk reply", r.SMALL_TALK],
    ["the Ask acknowledgement", r.ASK_STARTED],
  ] as const) {
    const plan = s.planSegments(text);
    ok(
      `${name} is GSM-7`,
      plan.encoding === "gsm7",
      plan.offenders?.join("") ?? "",
    );
    ok(
      `${name} is one segment`,
      plan.segments === 1,
      `${text.length} chars, ${plan.segments} segments`,
    );
    ok(
      `${name} ends with the compliance line, like every other reply`,
      /Reply STOP to opt out, HELP for help\.$/.test(text),
    );
  }
  ok(
    "the share invite points at /share, never /caregiver",
    r.SHARE_INVITE.includes("pando.is/share") && !r.SHARE_INVITE.includes("/caregiver"),
    "sending a nominating parent to the caregiver's own sign-up is the wrong flow",
  );
  /**
   * M7's automatic entry, wired 14 Sep. The reply a parent gets for saying yes
   * to *"Want me to ask a few nearby parents for more?"*.
   *
   * It **promises no time**, for the same reason `heldReply` does not: an Ask
   * runs on a window the parent cannot see and an admin still presses Send, so
   * any number here is one nobody can keep.
   */
  ok(
    "the Ask acknowledgement says what will happen and promises no time",
    !/(minute|hour|today|shortly|soon)/i.test(r.ASK_STARTED),
    r.ASK_STARTED,
  );
  ok(
    "and it never says what an Ask costs",
    !r.ASK_STARTED.includes("$"),
    "payment is off for the pilot, and the price is not this message's to state",
  );
  ok(
    "and small talk asks no question of its own",
    !r.SMALL_TALK.includes("?"),
    "5.4 owns onboarding; a second question here makes the next reply ambiguous",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
