/**
 * M13.5–13.7 — what a Network Ask costs, when it is owed back, and who decides.
 *
 * Pure rules, no Stripe and no database, for the reason `lib/blast-tiers.ts` and
 * `lib/outreach-policy.ts` are pure: money is the one place in this product
 * where being wrong is not recoverable by re-running a query, so the rules have
 * to be readable on their own and testable exhaustively.
 * `npm run test:payments` is that test.
 *
 * ## The price list, and a conflict that is recorded rather than guessed at
 *
 * Estimate 13.5 asks for "payment links using the configured tier prices
 * (**$5 / $12 / $20 / $35**)". Those are the estimate's own five-tier numbers,
 * identical in the 26 Aug and 3 Sep versions of the workbook — so they are not a
 * new decision, they are the pre-8.18 scheme the estimate was written against.
 * The client's *Pando Strategy — Current Direction* (8.18) §8 names four tiers
 * and different money: **Passive free · Board Ask $5 · Targeted Ask $15 ·
 * Last-Minute Care free in the pilot.**
 *
 * CLAUDE.md's rule for the source documents is that the newer client document
 * wins, and it has already been applied to these very tiers (`blast-tiers.ts`,
 * `drizzle/0021`). One consequence worth stating plainly: *$12, $20 and $35 are
 * charged by nothing in this codebase*, and if the client wants them the change
 * is one edit in `blast-tiers.ts` — not a migration, because `drizzle/0029`
 * freezes the charged amount onto the blast row rather than storing a price list.
 *
 * ## What is here, and what moved
 *
 * "What does this tier cost, given a credit" is `paymentFor`, and it lives in
 * `blast-tiers.ts` — beside the prices, where it is a fact about a tier. It was
 * written here first and had to move, because importing the tier list would have
 * made this file unloadable in a plain node test, which is the exact property
 * CLAUDE.md records `lib/matching.ts` protecting.
 *
 * So **this module imports nothing**, and what it holds is everything that is
 * not about a tier: whether a refund is coherent, whether the guarantee is owed,
 * and how to write cents as dollars.
 */

/**
 * The state of the *money*, kept apart from the state of the question.
 *
 * A blast can be `fulfilled` and `refund_due` at once — the guarantee is about
 * whether an answer was useful, not whether one arrived — so these are two
 * columns and two vocabularies. `drizzle/0029` has the CHECK.
 */
export type PaymentStatus =
  | "not_required"
  | "pending"
  | "paid"
  | "refund_due"
  | "refunded"
  | "failed";

/** `1500` → `"$15.00"`. One formatter, so no page invents its own. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * 13.7 — the manual refund window.
 *
 * The estimate says "the manual refund flow for the first ~60 days", and the
 * "~" is the interesting part: it is a *policy* about the pilot, not a law, so
 * it lives here as a named constant rather than a literal in a query, and the
 * refund action tells the admin when a blast is outside it rather than refusing
 * to show the button. **An admin can always refund** — the window governs what
 * the page says, never what the person is allowed to decide. Refusing a refund
 * on day 61 by hiding a control is how a support conversation becomes a bug
 * report.
 */
export const REFUND_WINDOW_DAYS = 60;

export type RefundBlock =
  | "nothing_paid"
  | "already_refunded"
  | "no_payment_reference";

export interface RefundAssessment {
  /** Whether a money refund is even a coherent action on this row. */
  refundable: boolean;
  /** Why not, when it isn't. */
  blocked?: RefundBlock;
  /** Days since payment, or null when nothing was paid. */
  age_days: number | null;
  /** Past `REFUND_WINDOW_DAYS`. Advisory — see the note above. */
  outside_window: boolean;
  /**
   * Whether Pando owes something *other* than money. A credit-funded Ask that
   * went unanswered is refunded as a credit (7.7), never as a card refund —
   * there is no charge to reverse.
   */
  credit_instead: boolean;
}

/**
 * Whether a money refund makes sense for this blast, and what to say if not.
 *
 * Three blocks, and each is a different sentence on the page rather than one
 * disabled button: nothing was ever charged, it has already been refunded, or
 * the row claims to be paid but carries no Stripe reference — which is a data
 * problem worth naming out loud rather than a refund that silently does nothing.
 */
export function assessRefund(
  input: {
    payment_status: PaymentStatus;
    paid_at: string | null;
    stripe_payment_intent_id: string | null;
    credit_id: string | null;
  },
  now = new Date(),
): RefundAssessment {
  const paidAt = input.paid_at ? new Date(input.paid_at) : null;
  const ageDays =
    paidAt && !Number.isNaN(paidAt.getTime())
      ? Math.floor((now.getTime() - paidAt.getTime()) / 86_400_000)
      : null;
  const base = {
    age_days: ageDays,
    outside_window: ageDays !== null && ageDays > REFUND_WINDOW_DAYS,
    credit_instead: input.credit_id !== null,
  };

  if (input.payment_status === "refunded") {
    return { refundable: false, blocked: "already_refunded", ...base };
  }
  if (input.payment_status !== "paid" && input.payment_status !== "refund_due") {
    return { refundable: false, blocked: "nothing_paid", ...base };
  }
  if (!input.stripe_payment_intent_id) {
    return { refundable: false, blocked: "no_payment_reference", ...base };
  }
  return { refundable: true, ...base };
}

/**
 * 7.7's guarantee, read from the payment side.
 *
 * A paid Ask that expires without a useful answer is owed something back, and
 * *which* something depends on how it was paid: a credit-funded Ask gets a fresh
 * credit (which `expire_blasts` already grants), and a card-funded one is a
 * refund an admin has to make by hand for the pilot's first sixty days. This is
 * the function that says which — so the payments page can list "refund needs"
 * without every reader having to remember the rule.
 */
export function refundOwed(
  input: {
    status: string;
    payment_status: PaymentStatus;
    credit_id: string | null;
    approved_responses: number;
    /**
     * 7.7's clock. **Required**, because the guarantee is "no useful answer *in
     * the window*" and without it this function cannot tell an Ask that failed
     * from one that has not finished.
     */
    expires_at: string | null;
  },
  now = new Date(),
): { owed: boolean; as: "money" | "credit" | null; why: string | null } {
  /**
   * The window has to have closed. Found by putting the blast manager on screen
   * with real rows: the first version asked only whether anything had been
   * approved, so a paid Ask sent an hour earlier — still live, still inside its
   * window, its five parents still thinking — rendered "Pando owes this parent a
   * refund" in alert red.
   *
   * That is worse than a cosmetic error. It is the page telling an admin that
   * Pando has failed a promise it is currently in the middle of keeping, and the
   * obvious response is to refund money nobody owes. The guarantee's own wording
   * is what fixes it: **no useful answer in the window** — so until the window
   * closes, there is nothing to say.
   *
   * An Ask with no window at all (`passive` contacts nobody) never reaches this
   * branch, which is right: nothing was promised and nothing was charged.
   */
  const expired =
    input.status === "expired" ||
    (input.expires_at !== null &&
      !Number.isNaN(new Date(input.expires_at).getTime()) &&
      new Date(input.expires_at) < now);
  if (!expired) return { owed: false, as: null, why: null };

  const unfulfilled = input.approved_responses === 0;
  if (!unfulfilled) return { owed: false, as: null, why: null };

  if (input.payment_status === "paid" || input.payment_status === "refund_due") {
    return {
      owed: true,
      as: "money",
      /* The wording matters: the guarantee is about a *useful* answer, so "no
         approved answer" is the honest reason rather than "no answer". A reply
         that arrived and was rated unusable still leaves the guarantee owed. */
      why: "The window closed with no approved answer.",
    };
  }
  if (input.credit_id !== null) {
    return {
      owed: true,
      as: "credit",
      why: "Paid with a credit, so the guarantee is a fresh credit rather than money.",
    };
  }
  return { owed: false, as: null, why: null };
}
