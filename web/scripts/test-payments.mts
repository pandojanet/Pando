/**
 * M13 — the pure halves: segmentation, payment rules, the Stripe signature, and
 * the retry policy.
 *
 * Four modules in one suite because they are one milestone and none of them can
 * be tested against a real provider: Stripe will not sign a forged webhook for
 * us, and a carrier will not fail a message on demand. What *can* be pinned is
 * every refusal, and in this milestone the refusals are the product — a retry
 * that fires on the wrong error code texts somebody who opted out, and a
 * signature check that passes a replay buys free Network Asks forever.
 *
 * Run: `npm run test:payments`
 */
const segments = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import(
  "../lib/sms-segments.ts"
);
const payments = (await import(`../lib/payments.ts?v=${Date.now()}`)) as typeof import(
  "../lib/payments.ts"
);
const stripeSig = (await import(`../lib/stripe-signature.ts?v=${Date.now()}`)) as typeof import(
  "../lib/stripe-signature.ts"
);
const delivery = (await import(`../lib/delivery.ts?v=${Date.now()}`)) as typeof import(
  "../lib/delivery.ts"
);
const tiers = (await import(`../lib/blast-tiers.ts?v=${Date.now()}`)) as typeof import(
  "../lib/blast-tiers.ts"
);

import { createHmac } from "node:crypto";

let failures = 0;
let checks = 0;
function ok(what: string, cond: boolean, detail = "") {
  checks++;
  if (cond) console.log(`  ok    ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ── 13.3 segmentation ─────────────────────────────────────────────────────── */

console.log("=== 13.3: one character can triple the bill ===");
{
  const plain = "a".repeat(160);
  const p1 = segments.planSegments(plain);
  ok("160 GSM-7 characters is one segment", p1.segments === 1, String(p1.segments));
  ok("and reports no headroom left", p1.headroom === 0, String(p1.headroom));

  const p2 = segments.planSegments("a".repeat(161));
  ok(
    "161 is two, at 153 each — not 160",
    p2.segments === 2 && p2.slots === 161,
    `${p2.segments}/${p2.slots}`,
  );

  /**
   * The finding this module exists for. The design system says "Em dashes are
   * fine" and the copy voice uses curly quotes, so this is not a hypothetical:
   * a template that reads as one segment of plain English is three the moment
   * one character leaves the GSM-7 alphabet.
   */
  const dash = segments.planSegments("a".repeat(150) + "—");
  ok(
    "the same message with one em dash is three segments",
    dash.encoding === "ucs2" && dash.segments === 3,
    `${dash.encoding}/${dash.segments}`,
  );
  ok("and it names the character that did it", dash.offenders.join("") === "—");

  const curly = segments.planSegments("It’s fine");
  ok("a curly apostrophe alone forces UCS-2", curly.encoding === "ucs2");
  ok("a straight one does not", segments.planSegments("It's fine").encoding === "gsm7");
}

console.log("\n=== 13.3: the seven that cost two slots ===");
{
  /* GSM-7 sends these as an escape pair, so `length` under-reports them. */
  for (const ch of ["^", "{", "}", "[", "]", "~", "\\", "€"]) {
    const plan = segments.planSegments(ch);
    ok(`"${ch}" is one character and two slots`, plan.slots === 2, String(plan.slots));
  }
  const many = segments.planSegments("~".repeat(80));
  ok(
    "80 of them is 160 slots — still one segment, but only just",
    many.slots === 160 && many.segments === 1,
    `${many.slots}/${many.segments}`,
  );
  ok("81 tips it over", segments.planSegments("~".repeat(81)).segments === 2);
}

console.log("\n=== 13.3: UCS-2 counts code units, not characters ===");
{
  /* An emoji outside the BMP is a surrogate pair on the wire. Counting
     characters would under-report the message by half. */
  const emoji = segments.planSegments("🙂");
  ok("one astral emoji is two slots", emoji.slots === 2, String(emoji.slots));
  /**
   * A Cyrillic ж, not an é — and that distinction is the point rather than a
   * detail. `é` **is** in the GSM-7 alphabet (it sits in the same row as è, ù,
   * ì and ò), so a message of 71 of them is still one 160-slot segment. The
   * first draft of this test assumed otherwise and failed, which is the module
   * being right about the thing it exists to know: "has an accent" is not the
   * same question as "needs UCS-2".
   */
  ok("ж is outside GSM-7", segments.encodingFor("ж") === "ucs2");
  ok("é is inside it", segments.encodingFor("é") === "gsm7");
  ok("70 UCS-2 code units is one segment", segments.planSegments("ж".repeat(70)).segments === 1);
  ok("71 is two", segments.planSegments("ж".repeat(71)).segments === 2);
}

console.log("\n=== 13.3: toGsm7 fixes typography and nothing else ===");
{
  ok("it returns null when there is nothing to fix", segments.toGsm7("plain") === null);
  const fixed = segments.toGsm7("It’s fine — really… “yes”");
  ok(
    "curly quotes, an em dash and an ellipsis all become GSM-7",
    fixed !== null && segments.encodingFor(fixed) === "gsm7",
    String(fixed),
  );
  ok("and the words are untouched", fixed === `It's fine - really... "yes"`, String(fixed));
  /* The line it will not cross: an emoji is content, not typography. */
  ok("an emoji is refused rather than dropped", segments.toGsm7("great 🙂") === null);
}

console.log("\n=== 13.3: splitting numbers the pieces and never breaks a word ===");
{
  const long = ("word ".repeat(80)).trim();
  const pieces = segments.splitForSms(long);
  ok("a long message splits", pieces.length > 1, String(pieces.length));
  ok(
    "every piece fits one concatenated segment",
    pieces.every((p) => segments.slotsFor(p) <= segments.GSM7_CONCATENATED),
    pieces.map((p) => segments.slotsFor(p)).join(","),
  );
  ok(
    "each is numbered, so out-of-order arrival is still readable",
    pieces.every((p, i) => p.endsWith(`(${i + 1}/${pieces.length})`)),
    pieces[0]?.slice(-8),
  );
  ok(
    "no word is cut",
    pieces.every((p) => !/\bwor$|\bwo$/.test(p.replace(/ \(\d+\/\d+\)$/, ""))),
  );
  ok("a short message is returned whole", segments.splitForSms("short")[0] === "short");
}

/* ── 13.5 payment rules ────────────────────────────────────────────────────── */

console.log("\n=== 13.5: what a tier owes, and the credit that skips it ===");
{
  const free = tiers.paymentFor({ tier: "passive", creditRedeemed: false });
  ok("passive is free", !free.charge && free.cents === 0 && free.reason === "free_tier");
  const lastMinute = tiers.paymentFor({ tier: "last_minute", creditRedeemed: false });
  ok("last-minute care is free in the pilot", !lastMinute.charge);

  const board = tiers.paymentFor({ tier: "board", creditRedeemed: false });
  ok("the board ask charges $5", board.charge && board.cents === 500, String(board.cents));
  const targeted = tiers.paymentFor({ tier: "targeted", creditRedeemed: false });
  ok(
    "the targeted ask charges $15 — the 8.18 strategy's number",
    targeted.charge && targeted.cents === 1500,
    String(targeted.cents),
  );

  /**
   * The estimate asks for "$5 / $12 / $20 / $35". Those are its own older
   * five-tier numbers, unchanged between the 26 Aug and 3 Sep workbooks, and
   * CLAUDE.md's rule is that the newer client document wins — the 8.18 strategy
   * names four tiers and different money. Asserted so a future session cannot
   * "fix" the prices back without meeting this test.
   */
  const charged = Object.values(tiers.TIERS)
    .map((t) => t.price_cents)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  ok(
    "only $5 and $15 are chargeable anywhere in the app",
    JSON.stringify(charged) === JSON.stringify([500, 1500]),
    JSON.stringify(charged),
  );

  /* 13.5's own words: "skipped entirely when a free credit covers it". */
  const credited = tiers.paymentFor({ tier: "targeted", creditRedeemed: true });
  ok(
    "a redeemed credit means nothing to charge",
    !credited.charge && credited.cents === 0 && credited.reason === "credit_redeemed",
  );
  ok("and it is not_required rather than paid", credited.status === "not_required");
}

console.log("\n=== 13.7: whether a refund is even coherent ===");
{
  const paid = {
    payment_status: "paid" as const,
    paid_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    stripe_payment_intent_id: "pi_1",
    credit_id: null,
  };
  const a = payments.assessRefund(paid);
  ok("a paid Ask is refundable", a.refundable && a.blocked === undefined);
  ok("and its age is reported", a.age_days === 5, String(a.age_days));
  ok("inside the window", !a.outside_window);

  const old = payments.assessRefund({
    ...paid,
    paid_at: new Date(Date.now() - 90 * 86_400_000).toISOString(),
  });
  /* Advisory, never a block: refusing a refund on day 61 by hiding a control is
     how a support conversation becomes a bug report. */
  ok("past 60 days it is flagged but still refundable", old.outside_window && old.refundable);

  ok(
    "an unpaid Ask is not",
    payments.assessRefund({ ...paid, payment_status: "pending" }).blocked === "nothing_paid",
  );
  ok(
    "one already refunded is not",
    payments.assessRefund({ ...paid, payment_status: "refunded" }).blocked ===
      "already_refunded",
  );
  ok(
    "and a paid row with no Stripe reference says so by name",
    payments.assessRefund({ ...paid, stripe_payment_intent_id: null }).blocked ===
      "no_payment_reference",
  );
  ok(
    "a credit-funded Ask is flagged as owing a credit rather than money",
    payments.assessRefund({ ...paid, credit_id: "c1" }).credit_instead,
  );
}

console.log("\n=== 7.7: the guarantee, and its clock ===");
{
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  const expired = payments.refundOwed({
    status: "expired",
    payment_status: "paid",
    credit_id: null,
    approved_responses: 0,
    expires_at: past,
  });
  ok("an expired paid Ask owes money", expired.owed && expired.as === "money");

  /**
   * The bug this pins, found by putting the blast manager on screen with real
   * rows. The first version asked only whether anything had been *approved*, so
   * a paid Ask sent an hour earlier — still live, its five parents still
   * thinking — rendered "Pando owes this parent a refund" in alert red.
   *
   * That is not cosmetic: it tells an admin Pando has failed a promise it is
   * currently keeping, and the obvious response is to refund money nobody owes.
   * The guarantee's own wording is the fix — no useful answer **in the window**.
   */
  const stillOpen = payments.refundOwed({
    status: "active",
    payment_status: "paid",
    credit_id: null,
    approved_responses: 0,
    expires_at: future,
  });
  ok("a live Ask inside its window owes nothing yet", !stillOpen.owed);

  /* Once the window has passed, it does — even if the status has not caught up,
     because `expire_blasts` runs on a schedule and the page is read live. */
  const windowPassed = payments.refundOwed({
    status: "active",
    payment_status: "paid",
    credit_id: null,
    approved_responses: 0,
    expires_at: past,
  });
  ok(
    "a window that has passed owes money even before the job marks it expired",
    windowPassed.owed && windowPassed.as === "money",
  );

  /* And the guarantee is about a *useful* answer: replies that arrived and were
     never approved still leave it owed. */
  const repliedNotApproved = payments.refundOwed({
    status: "expired",
    payment_status: "paid",
    credit_id: null,
    approved_responses: 0,
    expires_at: past,
  });
  ok("replies that were never approved do not discharge it", repliedNotApproved.owed);

  const answered = payments.refundOwed({
    status: "expired",
    payment_status: "paid",
    credit_id: null,
    approved_responses: 2,
    expires_at: past,
  });
  ok("two approved replies discharge it", !answered.owed);

  const credit = payments.refundOwed({
    status: "expired",
    payment_status: "not_required",
    credit_id: "c1",
    approved_responses: 0,
    expires_at: past,
  });
  ok(
    "a credit-funded Ask is owed a credit, never a card refund",
    credit.owed && credit.as === "credit",
  );

  const freeTier = payments.refundOwed({
    status: "expired",
    payment_status: "not_required",
    credit_id: null,
    approved_responses: 0,
    expires_at: past,
  });
  ok("a free tier is owed nothing", !freeTier.owed);

  /* A passive Ask has no window because it contacts nobody. Nothing was
     promised and nothing was charged, so nothing is owed. */
  const noWindow = payments.refundOwed({
    status: "active",
    payment_status: "not_required",
    credit_id: null,
    approved_responses: 0,
    expires_at: null,
  });
  ok("an Ask with no window is never owed anything", !noWindow.owed);
}

console.log("\n=== formatting ===");
ok("1500 cents reads as $15.00", payments.formatCents(1500) === "$15.00");
ok("0 reads as $0.00", payments.formatCents(0) === "$0.00");

/* ── 13.6 the Stripe signature ─────────────────────────────────────────────── */

console.log("\n=== 13.6: a forged webhook buys free Network Asks ===");
{
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_700_000_000;
  const sign = (t: number, b: string, s = secret) =>
    createHmac("sha256", s).update(`${t}.${b}`, "utf8").digest("hex");

  const good = stripeSig.verifyStripeSignature({
    rawBody: body,
    header: `t=${now},v1=${sign(now, body)}`,
    secret,
    now,
  });
  ok("a correctly signed webhook passes", good.ok);

  ok(
    "no secret refuses — fail closed, like the Twilio webhook and JOBS_SECRET",
    !stripeSig.verifyStripeSignature({ rawBody: body, header: `t=${now},v1=x`, secret: null, now })
      .ok,
  );
  ok(
    "and says which",
    stripeSig.verifyStripeSignature({
      rawBody: body,
      header: `t=${now},v1=x`,
      secret: null,
      now,
    }).ok === false &&
      (
        stripeSig.verifyStripeSignature({
          rawBody: body,
          header: `t=${now},v1=x`,
          secret: null,
          now,
        }) as { reason: string }
      ).reason === "not_configured",
  );

  ok(
    "a missing header refuses",
    !stripeSig.verifyStripeSignature({ rawBody: body, header: null, secret, now }).ok,
  );
  ok(
    "a header with no v1 is malformed, not a mismatch",
    (
      stripeSig.verifyStripeSignature({
        rawBody: body,
        header: `t=${now}`,
        secret,
        now,
      }) as { reason: string }
    ).reason === "malformed_signature",
  );
  ok(
    "a non-numeric timestamp is malformed rather than expired",
    (
      stripeSig.verifyStripeSignature({
        rawBody: body,
        header: `t=abc,v1=${sign(now, body)}`,
        secret,
        now,
      }) as { reason: string }
    ).reason === "malformed_signature",
  );

  /* The rule the Twilio verifier has no equivalent of: without it, one captured
     webhook activates a new blast every day, forever. */
  ok(
    "a signature older than the tolerance is refused",
    (
      stripeSig.verifyStripeSignature({
        rawBody: body,
        header: `t=${now - 600},v1=${sign(now - 600, body)}`,
        secret,
        now,
      }) as { reason: string }
    ).reason === "expired",
  );
  ok(
    "and so is one from the future — clock skew must not widen the window",
    (
      stripeSig.verifyStripeSignature({
        rawBody: body,
        header: `t=${now + 600},v1=${sign(now + 600, body)}`,
        secret,
        now,
      }) as { reason: string }
    ).reason === "expired",
  );

  ok(
    "a body changed by one byte fails",
    !stripeSig.verifyStripeSignature({
      rawBody: body + " ",
      header: `t=${now},v1=${sign(now, body)}`,
      secret,
      now,
    }).ok,
  );
  ok(
    "a signature made with another secret fails",
    !stripeSig.verifyStripeSignature({
      rawBody: body,
      header: `t=${now},v1=${sign(now, body, "whsec_other")}`,
      secret,
      now,
    }).ok,
  );

  /**
   * During a secret rotation Stripe signs with both, so a verifier that reads
   * the first `v1` and stops rejects half of all traffic for the duration.
   */
  ok(
    "the second v1 is checked too, which is what makes a rotation survivable",
    stripeSig.verifyStripeSignature({
      rawBody: body,
      header: `t=${now},v1=${sign(now, body, "whsec_old")},v1=${sign(now, body)}`,
      secret,
      now,
    }).ok,
  );
  ok(
    "an unknown scheme is ignored rather than fatal",
    stripeSig.verifyStripeSignature({
      rawBody: body,
      header: `t=${now},v0=whatever,v1=${sign(now, body)}`,
      secret,
      now,
    }).ok,
  );
}

/* ── 13.4 the retry policy ─────────────────────────────────────────────────── */

console.log("\n=== 13.4: mostly a list of refusals ===");
{
  const base = { retry_count: 0, age_minutes: 10 };
  const verdict = (code: number | null, over: Partial<typeof base> = {}) =>
    delivery.shouldRetry({
      status: "failed",
      error_code: code,
      ...base,
      ...over,
    });

  ok("a delivered message is not retried", !delivery.shouldRetry({
    status: "delivered",
    error_code: null,
    ...base,
  }).retry);

  /* The three from `CARRIER_ERRORS`, and the first is a compliance rule rather
     than economics. */
  const optedOut = verdict(21610);
  ok(
    "21610 is never retried — it would text somebody who asked Pando to stop",
    !optedOut.retry && optedOut.reason === "permanent",
  );
  ok(
    "30034 is never retried — 'retrying makes it worse with the carriers'",
    !verdict(30034).retry,
  );
  ok("30007 is never retried — the same wording fails the same way", !verdict(30007).retry);
  for (const code of [30002, 30003, 30005, 30006]) {
    ok(`${code} is about the number, not the moment`, !verdict(code).retry);
  }

  /* What is retried: failures about this attempt. */
  ok("30001 (queue overflow) is retried", verdict(30001).retry);
  ok("30008 (unknown) is retried", verdict(30008).retry);
  ok(
    "and no code at all — a timeout or a 5xx — is the clearest transient case",
    verdict(null).retry,
  );
  const timing = verdict(null);
  ok(
    "after a delay, because a queue that overflowed a second ago still is",
    timing.retry && timing.after_minutes === delivery.RETRY_DELAY_MINUTES,
  );

  ok("once and once only", !verdict(30001, { retry_count: 1 }).retry);
  ok(
    "and that refusal has its own name",
    (verdict(30001, { retry_count: 1 }) as { reason: string }).reason === "already_retried",
  );
  ok("the limit is one", delivery.RETRY_LIMIT === 1);

  ok(
    "past the ceiling it is left alone — a ping two days late cannot be placed",
    !verdict(30001, { age_minutes: delivery.RETRY_GIVE_UP_MINUTES + 1 }).retry,
  );
  /* Ordering: the page should say "this will never work" about an old permanent
     failure rather than the less useful "this was too old to try". */
  ok(
    "a permanent code beats the age check, so the reason stays useful",
    (
      verdict(21610, { age_minutes: 5_000 }) as { reason: string }
    ).reason === "permanent",
  );

  /**
   * The default that matters most. Twilio's 30xxx range is mostly reasons a
   * message can never arrive, and the two costs are not symmetric: not retrying
   * loses one message and shows on the delivery page, while retrying a
   * permanent failure spends money forever and teaches the carrier that Pando
   * does not listen.
   */
  const unknown = verdict(31999);
  ok("an unrecognised code is NOT retried", !unknown.retry);
  ok(
    "and it says so in a sentence somebody can act on",
    !unknown.retry && unknown.reason === "unknown_code" && typeof unknown.note === "string",
  );
}

console.log(
  failures === 0
    ? `\n  ${checks} checks passed.`
    : `\n  ${failures} of ${checks} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
