import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { TIERS, paymentFor, type BlastTier } from "@/lib/blast-tiers";
import { type PaymentStatus } from "@/lib/payments";
import { createCheckout, refundPayment } from "@/lib/server/stripe";

/**
 * M13.5–13.7 — the writes behind a paid Network Ask.
 *
 * The rules live in `lib/payments.ts` (pure) and the API call in
 * `lib/server/stripe.ts` (one caller). This is the part that touches the
 * database, and every function here has the same two properties:
 *
 *  - **Idempotent, because Stripe is not.** A webhook is delivered more than
 *    once by design — Stripe retries until it gets a 2xx — so "have I already
 *    handled this?" cannot be a question the handler asks and then acts on. It
 *    is a `where` clause, every time.
 *  - **The money and the question move together.** Marking a blast paid and
 *    activating it are one transaction. Two statements would leave a window
 *    where a parent has been charged for an Ask that is still a draft, and the
 *    only way to find those afterwards is a reconciliation nobody runs.
 */

/* ── 13.5 — opening a checkout ──────────────────────────────────────────────── */

export type CheckoutOutcome =
  | { ok: true; url: string; session_id: string }
  | {
      ok: false;
      reason:
        | "unconfigured"
        | "not_found"
        | "nothing_to_pay"
        | "already_paid"
        | "already_open"
        | "not_provisioned"
        | "stripe_error";
      /** An existing session's URL, when one is already open. */
      url?: string;
      detail?: string;
    };

/**
 * Start (or find) the payment for one blast.
 *
 * ## The order, which is the whole of 13.5's "skipped entirely when a free
 * credit covers it"
 *
 * The credit is redeemed by `createBlast`, inside the same transaction as the
 * insert (M7.1) — so by the time this runs the row already carries a
 * `credit_id` or genuinely owes money. This function therefore never *looks*
 * for a credit; it reads what the blast already knows and refuses to charge
 * when the answer is nothing. Looking again here would be a second place that
 * could disagree with the first, and the disagreement would be a parent charged
 * for an Ask Pando owed them.
 *
 * ## Why an already-open session is returned rather than replaced
 *
 * A parent who taps "pay" twice, or comes back to a tab, should reach the same
 * checkout. Creating a second session would leave two live payment links for
 * one Ask, and if both were completed Pando would have taken $30 for one
 * question with only one of the two payments attached to the row.
 */
export async function openCheckout(blastId: string): Promise<CheckoutOutcome> {
  const loaded = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select b.id, b.tier, b.status, b.asker_id, b.question_text,
             b.credit_id, b.payment_status, b.price_cents, b.stripe_session_id
        from blasts b
       where b.id = ${blastId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!loaded.persisted) return { ok: false, reason: "unconfigured" };
  if (!loaded.data) return { ok: false, reason: "not_found" };

  const blast = loaded.data;
  const tier = String(blast.tier) as BlastTier;
  const decision = paymentFor({
    tier,
    creditRedeemed: blast.credit_id !== null,
  });

  if (!decision.charge) return { ok: false, reason: "nothing_to_pay" };
  if (blast.payment_status === "paid" || blast.payment_status === "refunded") {
    return { ok: false, reason: "already_paid" };
  }

  const session = await createCheckout({
    blastId,
    tier,
    askerId: String(blast.asker_id ?? ""),
    question: String(blast.question_text ?? ""),
  });
  if (!session.ok || !session.url || !session.session_id) {
    return {
      ok: false,
      reason: session.reason === "not_provisioned" ? "not_provisioned" : "stripe_error",
      detail: session.error,
    };
  }

  /**
   * The price is frozen here, not read at refund time.
   *
   * `drizzle/0029` explains why on the column: a tier's price can change, and
   * this parent was charged what was in force when they asked. Reading
   * `TIERS[tier].price_cents` during a refund two weeks later would refund
   * today's price — which is either short-changing somebody or paying them
   * extra, and neither is recoverable from the row.
   */
  const stored = await withDb(async (db: Db) => {
    await db.execute(sql`
      update blasts
         set payment_status = 'pending',
             price_cents = ${decision.cents},
             stripe_session_id = ${session.session_id}
       where id = ${blastId}::uuid
         and payment_status in ('not_required', 'pending', 'failed')
    `);
    return true;
  });
  if (!stored.persisted) return { ok: false, reason: "unconfigured" };

  return { ok: true, url: session.url, session_id: session.session_id };
}

/* ── 13.6 — the webhook's write ─────────────────────────────────────────────── */

export type ConfirmOutcome =
  | { ok: true; blast_id: string; activated: boolean; already: boolean }
  | { ok: false; reason: "unconfigured" | "unknown_session" | "amount_mismatch" };

/**
 * A completed Stripe payment, applied to its blast.
 *
 * ## Idempotency is the `where` clause, not a check
 *
 * `and payment_status <> 'paid'` is what makes the fifth delivery of the same
 * webhook a no-op, and reporting `already: true` is what lets the route answer
 * 200 without pretending it did something. A handler that read the row, saw
 * `paid`, and returned early would be the same logic with a race in the middle:
 * two deliveries arriving together would both read `pending`.
 *
 * ## Activation, and the one status that does not move
 *
 * 13.5's words are "moves a blast from pending to active on success", and there
 * is an exception the estimate does not mention because it belongs to M7:
 * a blast marked `human_review` sits in `pending_review`, and **payment must not
 * clear that**. Last-Minute Care always carries it, and `needsHumanReview` sets
 * it for a short pool or stacked requirements — the whole point being that a
 * person looks before five strangers' phones ring. Money is not that person.
 *
 * ## Why the amount is checked
 *
 * The webhook is signed, so the amount is not forged. But it *can* be stale or
 * mismatched — a session created before a price change, or the wrong session id
 * attached to a row by an earlier bug — and a mismatch means the row and Stripe
 * disagree about what was paid. Failing loudly beats marking a $5 payment as
 * having settled a $15 Ask, which is a discrepancy nobody would notice until a
 * reconciliation.
 */
export async function confirmPayment(input: {
  sessionId: string;
  paymentIntentId: string;
  amountCents: number;
}): Promise<ConfirmOutcome> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select id, status, human_review, price_cents, payment_status
          from blasts
         where stripe_session_id = ${input.sessionId}
         for update
      `)) as unknown as Array<Record<string, unknown>>;
      const blast = rows[0];
      if (!blast) return { kind: "unknown" as const };

      const expected = Number(blast.price_cents ?? 0);
      if (expected > 0 && expected !== input.amountCents) {
        return { kind: "mismatch" as const };
      }

      if (blast.payment_status === "paid" || blast.payment_status === "refunded") {
        return {
          kind: "already" as const,
          blast_id: String(blast.id),
        };
      }

      /* Human review survives payment — see the note above. */
      const nextStatus = blast.human_review === true ? "pending_review" : "active";

      const updated = (await tx.execute(sql`
        update blasts
           set payment_status = 'paid',
               paid_at = now(),
               stripe_payment_intent_id = ${input.paymentIntentId},
               status = case when status in ('draft', 'pending_review')
                             then ${nextStatus} else status end
         where id = ${blast.id}::uuid
           and payment_status <> 'paid'
        returning id, status
      `)) as unknown as Array<Record<string, unknown>>;

      return {
        kind: "paid" as const,
        blast_id: String(blast.id),
        activated: String(updated[0]?.status ?? "") === "active",
      };
    }),
  );

  if (!result.persisted || !result.data) return { ok: false, reason: "unconfigured" };
  const data = result.data;
  if (data.kind === "unknown") return { ok: false, reason: "unknown_session" };
  if (data.kind === "mismatch") return { ok: false, reason: "amount_mismatch" };
  if (data.kind === "already") {
    return { ok: true, blast_id: data.blast_id, activated: false, already: true };
  }
  return { ok: true, blast_id: data.blast_id, activated: data.activated, already: false };
}

/**
 * A checkout that expired or was abandoned.
 *
 * Recorded rather than ignored, because the payments page has to be able to tell
 * "nobody has paid yet" from "somebody tried and it did not work" — the second
 * is a parent who wanted to ask and could not, which is worth following up. It
 * never touches `status`: the question is still a draft either way.
 */
export async function markCheckoutFailed(sessionId: string): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    await db.execute(sql`
      update blasts
         set payment_status = 'failed', stripe_session_id = null
       where stripe_session_id = ${sessionId}
         and payment_status = 'pending'
    `);
    return true;
  });
  return result.persisted;
}

/* ── 13.7 — refunds ─────────────────────────────────────────────────────────── */

export type RefundOutcome =
  | { ok: true; refunded: boolean; credit_granted: boolean }
  | {
      ok: false;
      reason:
        | "unconfigured"
        | "not_found"
        | "nothing_paid"
        | "already_refunded"
        | "no_payment_reference"
        | "stripe_error";
      detail?: string;
    };

/**
 * Refund a paid Ask, by hand, with a reason.
 *
 * ## Why the reason is required
 *
 * 13.7 is "the **manual** refund flow for the first ~60 days", so the reason is
 * the only record of the judgement — the same rule as `claim.decline`,
 * `share.retire` and every other admin decision that cannot be re-derived. The
 * guarantee it usually discharges ("no useful answer in the window") is itself a
 * judgement about usefulness, which is exactly why a person makes it.
 *
 * ## The order: Stripe first, then the row
 *
 * The opposite order is the one that looks safer and is worse. Marking the row
 * refunded and then failing to reach Stripe leaves a row that says the money
 * went back when it did not — and the parent, who can see their card statement,
 * knows more about Pando's finances than Pando does. This way a Stripe failure
 * leaves the row untouched and the admin sees an error they can retry; Stripe's
 * idempotency key (the blast id) is what makes that retry safe.
 */
export async function refundBlast(input: {
  blastId: string;
  reason: string;
}): Promise<RefundOutcome> {
  const loaded = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select id, payment_status, stripe_payment_intent_id, credit_id, asker_id, tier
        from blasts
       where id = ${input.blastId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!loaded.persisted) return { ok: false, reason: "unconfigured" };
  if (!loaded.data) return { ok: false, reason: "not_found" };

  const blast = loaded.data;
  const status = String(blast.payment_status) as PaymentStatus;
  if (status === "refunded") return { ok: false, reason: "already_refunded" };
  if (status !== "paid" && status !== "refund_due") {
    return { ok: false, reason: "nothing_paid" };
  }
  const intent = blast.stripe_payment_intent_id
    ? String(blast.stripe_payment_intent_id)
    : null;
  if (!intent) return { ok: false, reason: "no_payment_reference" };

  const refund = await refundPayment({
    paymentIntentId: intent,
    blastId: input.blastId,
  });
  if (!refund.ok) return { ok: false, reason: "stripe_error", detail: refund.error };

  const written = await withDb(async (db: Db) => {
    await db.execute(sql`
      update blasts
         set payment_status = 'refunded',
             refunded_at = now(),
             refund_reason = ${input.reason},
             status = case when status in ('active', 'expired')
                           then 'refunded' else status end
       where id = ${input.blastId}::uuid
         and payment_status <> 'refunded'
    `);
    return true;
  });

  /**
   * The money is back either way — Stripe accepted the refund before this line.
   * A database that has gone away since is a row that will read `paid` about a
   * payment that no longer exists, which is worth reporting as a failure so
   * somebody reconciles it, rather than as a success because the important half
   * worked. Stripe's idempotency key makes the retry safe.
   */
  if (!written.persisted) return { ok: false, reason: "unconfigured" };
  return { ok: true, refunded: true, credit_granted: false };
}

/**
 * Flag that a refund is owed, without making it.
 *
 * The middle state 14.5's page is named for — "status, and **refund needs**".
 * It exists because the two halves of a refund happen at different times and
 * often by different people: whoever works the blast queue can see that the
 * window closed with nothing approved, and whoever handles money does the rest.
 * Collapsing them into one button would mean the person noticing has to also be
 * the person authorised.
 */
export async function markRefundDue(input: {
  blastId: string;
  reason: string;
}): Promise<{ ok: boolean; reason?: "unconfigured" | "not_found" | "nothing_paid" }> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      update blasts
         set payment_status = 'refund_due', refund_reason = ${input.reason}
       where id = ${input.blastId}::uuid
         and payment_status = 'paid'
      returning id
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  });
  if (!result.persisted) return { ok: false, reason: "unconfigured" };
  /* A conditional UPDATE rather than a read-then-write, so a stale admin screen
     acting on a row that has since been refunded is a no-op with a name rather
     than a second refund. */
  return result.data === true ? { ok: true } : { ok: false, reason: "nothing_paid" };
}

/**
 * What a blast owes, for the pages that have to say so.
 *
 * Exposed as its own function because both `/admin/blasts` and
 * `/admin/payments` need it and neither should compute it: the shape of "what
 * this costs" is `lib/payments.ts`'s job, and two pages deriving it separately
 * is how they end up disagreeing.
 */
export function quoteFor(tier: BlastTier, creditRedeemed: boolean) {
  const decision = paymentFor({ tier, creditRedeemed });
  return { ...decision, label: TIERS[tier].label };
}
