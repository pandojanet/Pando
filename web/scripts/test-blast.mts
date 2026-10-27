/**
 * M7.2 / 7.7 — the one Network Ask: its pool, its window, its text.
 *
 * The pool is the 8.18 strategy's, not the estimate's: three to five carefully
 * matched parents (§8, §6), not ~25. If somebody restores the estimate's number,
 * the checks below fail rather than the pilot quietly turning into a mailing list.
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

console.log("\n=== one kind of Network Ask, and nothing is priced (22 Oct) ===");
ok("only one kind can be created", t.TIER_IDS.length === 1 && t.TIER_IDS[0] === t.GENERAL_TIER, t.TIER_IDS.join(", "));
ok("its stored id is still 'targeted' - no migration (blasts_tier_check)", t.GENERAL_TIER === "targeted");
ok("it is called a Network Ask", t.TIERS[t.GENERAL_TIER].label === "Network Ask");
ok("it carries no price, credit or refund fields at all", !Object.values(t.TIERS).some((s) => "price_cents" in s || "credit_kind" in s));
ok("the payment helpers are gone from the module", !("paymentFor" in t) && !("owedRefund" in t) && !("automaticCredit" in t));
ok("an old row with another id reads as the one kind", t.tierSpec("passive").id === "targeted" && t.tierSpec(null).id === "targeted");

console.log("\n=== pool size: a request, not a broadcast ===");
ok(
  "a Network Ask reaches five, not twenty-five",
  t.TIERS.targeted.pool_target === 5,
  "the estimate says ~25; the strategy says three to five, and explains why",
);

console.log("\n=== human review is a condition ===");
const review = (matched: number, requirement_count = 0) =>
  t.needsHumanReview({ tier: "targeted", matched, requirement_count });
ok("a full pool does not need a person", !review(5).required);
ok(
  "a short pool does",
  review(2).required && review(2).reason === "short_pool",
  "sending to two while promising five is what a person should look at first",
);
ok(
  "stacked requirements do",
  review(5, 2).required && review(5, 2).reason === "stacked_requirements",
  "several hard constraints at once is where a scorer is confident and wrong",
);
ok("one requirement alone does not", !review(5, 1).required);

console.log("\n=== 7.7  the window ===");
ok(
  "a Network Ask expires in a day",
  t.expiryFor("targeted", NOW).toISOString() === "2026-08-28T12:00:00.000Z",
);
ok(
  "a live Ask past its date reads as closed, a settled one is left alone",
  t.windowClosed({ status: "active", expires_at: "2026-08-01T00:00:00Z" }, NOW.getTime()) &&
    !t.windowClosed({ status: "fulfilled", expires_at: "2026-08-01T00:00:00Z" }, NOW.getTime()),
);
ok(
  "an answered Ask past its date is not closed - expire_blasts never expires one with an approved reply",
  !t.windowClosed({ status: "active", expires_at: "2026-08-01T00:00:00Z", approved_responses: 1 }, NOW.getTime()) &&
    t.windowClosed({ status: "active", expires_at: "2026-08-01T00:00:00Z", approved_responses: 0 }, NOW.getTime()),
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
  "somebody asked only because they live near is told exactly that (25 Sep)",
  t2.askReason([]) === "you live nearby",
  t2.askReason([]),
);
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

console.log("\n=== the kind says what it is, for the admin ===");
ok("it carries a label", t.TIERS[t.GENERAL_TIER].label.length > 0);
ok(
  "and the id matches its key, so a lookup cannot drift",
  t.TIER_IDS.every((id) => t.TIERS[id].id === id),
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
  /* ⚠ Sized **from** the budget rather than hard-coded at 300, which is what
     broke here when `SMS_BUDGET` went 459 -> 765 on 9 Sep: the fixture was
     testing the constant instead of the dropping rule. Each reply is comfortably
     over half the budget, so exactly one can ever fit whatever the budget is. */
  const tooLong = Math.ceil(answer.SMS_BUDGET * 0.7);
  const long = a.composeBlastAnswer({
    budget: answer.SMS_BUDGET,
    replies: [
      reply("A".repeat(tooLong)),
      reply("B".repeat(tooLong)),
      reply("C".repeat(tooLong)),
    ],
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
