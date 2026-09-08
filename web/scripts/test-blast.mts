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

console.log("\n=== 7.7's automatic credit is not a second compensation ===");
/* Both of these were live on 7 Sep, and one run of `expire_blasts` against the
   real database did both: it credited a card-paid Ask the payments page was
   already reporting as owed a refund, and it credited a Board Ask whose
   checkout had never completed. */
ok(
  "a credit-funded Ask that timed out gets a fresh credit",
  t.automaticCredit({ tier: "targeted", payment_status: "not_required", credit_funded: true })
    .grant,
);
ok(
  "and it is the tier's credit kind, never the tier id",
  t.automaticCredit({ tier: "targeted", payment_status: "not_required", credit_funded: true })
    .kind === t.TIERS.targeted.credit_kind,
  "credits_kind_check does not admit tier ids",
);
ok(
  "a card-paid Ask is owed money, so it is NOT also credited",
  !t.automaticCredit({ tier: "targeted", payment_status: "paid", credit_funded: false }).grant,
  "one failure, one compensation - the refund is 13.7's manual step",
);
ok(
  "nor is one already flagged for refund",
  !t.automaticCredit({ tier: "targeted", payment_status: "refund_due", credit_funded: false })
    .grant,
);
ok(
  "an Ask whose checkout never completed mints nothing",
  !t.automaticCredit({ tier: "board", payment_status: "pending", credit_funded: false }).grant,
  "otherwise a free credit is farmable by creating an Ask and not paying for it",
);
ok(
  "and neither does a failed checkout",
  !t.automaticCredit({ tier: "board", payment_status: "failed", credit_funded: false }).grant,
);
ok(
  "a free tier is owed nothing, because nothing was taken",
  t.TIER_IDS.filter((id) => t.TIERS[id].price_cents === 0).every(
    (id) =>
      !t.automaticCredit({ tier: id, payment_status: "not_required", credit_funded: false })
        .grant,
  ),
);
ok(
  "the two halves of the guarantee never both fire",
  t.TIER_IDS.every((id) =>
    (["paid", "refund_due", "pending", "failed", "not_required"] as const).every((status) => {
      const credit = t.automaticCredit({
        tier: id,
        payment_status: status,
        credit_funded: false,
      }).grant;
      const money =
        t.owedRefund({
          tier: id,
          approved_answers: 0,
          expires_at: new Date("2026-08-01T00:00:00Z"),
          now: new Date("2026-09-01T00:00:00Z"),
        }) && (status === "paid" || status === "refund_due");
      return !(credit && money);
    }),
  ),
  "a credit and a refund for one failure is paying twice",
);

console.log("\n=== M7's exit: what the asker is finally told ===");
{
  const a = (await import(
    `../lib/blast-answer.ts?v=${Date.now()}`
  )) as typeof import("../lib/blast-answer.ts");
  const answer = (await import(
    `../lib/answer.ts?v=${Date.now()}`
  )) as typeof import("../lib/answer.ts");

  const reply = (text: string, quality: number | null = null) => ({ text, quality });

  ok(
    "no replies is nothing to send, not an empty message",
    a.composeBlastAnswer({ budget: answer.SMS_BUDGET, replies: [] }) === null,
    "a bare header reads as 'we asked and nobody helped' to somebody who paid",
  );
  ok(
    "a reply that is only whitespace does not count as one",
    a.composeBlastAnswer({ budget: answer.SMS_BUDGET, replies: [reply("   ")] }) === null,
  );

  const one = a.composeBlastAnswer({ budget: answer.SMS_BUDGET, replies: [reply("Try Rose Bowl Aquatics.")] });
  ok("one reply is 'One parent', not '1 parents'", one?.text.startsWith("One parent") === true, one?.text);
  ok("and the reply travels in the parent's own words", one?.text.includes("Try Rose Bowl Aquatics.") === true);
  ok("with the source stated", one?.text.includes("local parents Pando matched") === true);

  /* Rated first, unrated last, and never dropped for being unrated. */
  const ranked = a.composeBlastAnswer({
    budget: answer.SMS_BUDGET,
    replies: [reply("unrated one"), reply("rated five", 5), reply("rated two", 2)],
  });
  ok(
    "an admin's rating orders the replies",
    ranked !== null &&
      ranked.text.indexOf("rated five") < ranked.text.indexOf("rated two") &&
      ranked.text.indexOf("rated two") < ranked.text.indexOf("unrated one"),
    ranked?.text,
  );
  ok("an unrated reply is still sent", ranked?.used === 3);

  /* Ties keep arrival order, so a second send composes the same message. */
  const tied = { budget: answer.SMS_BUDGET, replies: [reply("first", 3), reply("second", 3)] };
  ok(
    "ties are stable, so sending twice would say the same thing",
    a.composeBlastAnswer(tied)?.text === a.composeBlastAnswer(tied)?.text &&
      a.composeBlastAnswer(tied)!.text.indexOf("first") <
        a.composeBlastAnswer(tied)!.text.indexOf("second"),
  );

  /* Whole replies are dropped, never truncated — the `composeAnswer` rule. */
  const long = a.composeBlastAnswer({
    budget: answer.SMS_BUDGET,
    replies: [reply("A".repeat(300)), reply("B".repeat(300)), reply("C".repeat(300))],
  });
  ok("a message too long drops whole replies", long?.used === 1 && long?.dropped === 2, String(long?.used));
  ok("and stays inside the budget", (long?.text.length ?? 0) <= answer.SMS_BUDGET, String(long?.text.length));
  ok(
    "the count is what was sent, not what was approved",
    long?.text.startsWith("One parent") === true,
    "counting before the budget loop is the 4 Sep fault this repeats",
  );

  /* A parent's own newline would read as a second answer. */
  const messy = a.composeBlastAnswer({ budget: answer.SMS_BUDGET, replies: [reply("line one\nline two")] });
  ok(
    "a reply's own line breaks are flattened",
    messy?.text.split("\n").filter((l) => l.startsWith('"')).length === 1,
    messy?.text,
  );

  /* One character outside GSM-7 cuts the per-segment budget from 153 to 67. */
  const seg = (await import(
    `../lib/sms-segments.ts?v=${Date.now()}`
  )) as typeof import("../lib/sms-segments.ts");
  const plain = a.composeBlastAnswer({
    budget: answer.SMS_BUDGET,
    replies: [reply("Kidspace is great for a 3 year old.")],
  })!;
  ok(
    "the wrapper is GSM-7, so a short answer is one segment",
    seg.planSegments(plain.text).encoding === "gsm7",
    seg.planSegments(plain.text).offenders?.join("") ?? "",
  );
  ok(
    "and a parent's own em dash is their cost, not the wrapper's",
    seg.planSegments(a.composeBlastAnswer({ budget: answer.SMS_BUDGET, replies: [reply("great — really")] })!.text)
      .encoding === "ucs2",
    "the reply is verbatim on purpose; only the words Pando adds are constrained",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
