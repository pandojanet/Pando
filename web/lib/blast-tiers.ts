/**
 * M7.2 — the Network Ask tiers, as data.
 *
 * ## These follow the 8.18 strategy, and the estimate says something else
 *
 * Estimate 7.2 lists five tiers: passive, standard (~20), targeted (~25),
 * precision (~15, auto-downgraded to targeted if fewer than five qualify) and
 * last-minute care (~35). The client's own *Pando Strategy — Current Direction*
 * (Aug 2026) §8 replaces that with four, names their prices, and says outright
 * that human review of an unusual match **"absorbed what we once called
 * Precision"**. The newer client document wins — CLAUDE.md's own rule for the
 * source documents, and the same call already taken for the request gap (twice — see `OUTREACH_GAP_DAYS`).
 *
 * **The pool sizes differ by more than the names, and that is the substance.**
 * The estimate's core paid tier reaches ~25 people; the strategy's reaches
 * "three to five carefully matched parents". §6 explains why in one sentence:
 * *"Pando never sends a question to everyone — that's how group chats train
 * people to ignore things."* Twenty-five is a broadcast. Five is a request, and
 * the strategy's whole claim is that being asked should feel like a compliment.
 *
 * Worth putting to the client before the first paid Ask, because it changes what
 * $15 buys — but the numbers live here, in one place, so changing them is an
 * edit rather than a migration.
 */

export type BlastTier = "passive" | "board" | "targeted" | "last_minute";

export interface TierSpec {
  id: BlastTier;
  /** What the parent sees it called. */
  label: string;
  /** US cents. 0 is free, and free is a decision rather than a placeholder. */
  price_cents: number;
  /** How many parents Pando contacts directly. Zero for the ones that contact nobody. */
  pool_target: number;
  /** Hours before it is unfulfilled — 7.7's window, and the guarantee's clock. */
  window_hours: number;
  /** A human checks the match before anything is sent. */
  always_human_review: boolean;
  /**
   * Which credit pays for this tier, or null when it is free.
   *
   * **The names are the ones `credits_kind_check` allows** — `network_ask` and
   * `targeted_network_ask` — not the tier ids. They are different vocabularies
   * and the first version of this conflated them: `createBlast` looked for a
   * credit of kind `targeted`, which the CHECK does not permit, so no credit
   * would ever have matched and every parent would have paid for an Ask they had
   * already earned. Silent, because "no credit found" is a legitimate answer.
   *
   * So the mapping lives here, once, beside the price it corresponds to.
   */
  credit_kind: "network_ask" | "targeted_network_ask" | null;
  /** Shown to the admin; not parent-facing copy. */
  note: string;
}

/**
 * The four, from strategy §8.
 *
 * `passive` contacts nobody by design: the question is saved and the parent hears
 * when the network can answer it well. That is also 7.11's demand map — an
 * unanswerable question logged against a neighborhood is the market-expansion
 * signal, which is why it is a tier rather than a refusal.
 */
export const TIERS: Record<BlastTier, TierSpec> = {
  passive: {
    id: "passive",
    label: "Passive",
    price_cents: 0,
    pool_target: 0,
    /* No promise to keep, so no clock. The parent hears when the answer exists. */
    window_hours: 0,
    always_human_review: false,
    credit_kind: null,
    note: "Free. Nobody is contacted — the question is saved and answered when the network can. Also the demand map.",
  },
  board: {
    id: "board",
    label: "Board Ask",
    price_cents: 500,
    /* The board is a surface, not a pool: the question goes into the daily digest
       that opted-in parents browse. §8 adds the safety net — if the board has not
       cracked it in two days, Pando taps one well-matched parent, and that one
       tap is the only direct contact this tier makes. */
    pool_target: 1,
    window_hours: 48,
    always_human_review: false,
    credit_kind: "network_ask",
    note: "$5. Anonymous on the once-a-day board. If two days pass with no answer, one well-matched parent is asked directly.",
  },
  targeted: {
    id: "targeted",
    label: "Targeted Ask",
    price_cents: 1500,
    /* "three to five carefully matched parents" — five, so the pool selector has
       room to lose some to the contributor-protection filters and still deliver
       the promise. */
    pool_target: 5,
    window_hours: 24,
    always_human_review: false,
    credit_kind: "targeted_network_ask",
    note: "$15. Three to five carefully matched parents, asked personally. The first one is free.",
  },
  last_minute: {
    id: "last_minute",
    label: "Last-Minute Care",
    price_cents: 0,
    pool_target: 5,
    window_hours: 4,
    /* §8: urgent same-day sitter help, and the estimate's own word for it is
       "mandatory human review". Somebody is about to leave a child with a person
       Pando named. */
    always_human_review: true,
    credit_kind: null,
    note: "Free during the pilot, strongest neighborhoods only. Urgent, and always read by a person before it goes out.",
  },
};

export const TIER_IDS = Object.keys(TIERS) as BlastTier[];

/**
 * Whether a question needs a human to check the match before it is sent.
 *
 * §8: "questions with unusual or stacked requirements automatically get a human
 * reviewing the match (this absorbed what we once called Precision)". So Precision
 * is not a tier a parent buys — it is a condition Pando detects.
 *
 * Three triggers, and each is a case where an automatic pool would be wrong
 * rather than merely imperfect:
 *
 *  - **the tier always requires it** (Last-Minute Care);
 *  - **the matcher could not fill the pool** — a short pool is 6.6's cold start,
 *    and sending to two people while charging for five is the thing the guarantee
 *    exists to prevent;
 *  - **the question stacks requirements** — several hard constraints at once is
 *    exactly where a scorer is confident and wrong.
 */
export function needsHumanReview(input: {
  tier: BlastTier;
  matched: number;
  /** Hard requirements the question demanded — see `Requirements.mustHave`. */
  requirement_count: number;
}): { required: boolean; reason?: "tier" | "short_pool" | "stacked_requirements" } {
  const spec = TIERS[input.tier];
  if (spec.always_human_review) return { required: true, reason: "tier" };
  if (spec.pool_target > 0 && input.matched < spec.pool_target) {
    return { required: true, reason: "short_pool" };
  }
  if (input.requirement_count >= 2) {
    return { required: true, reason: "stacked_requirements" };
  }
  return { required: false };
}

/**
 * 7.7 — when the promise runs out.
 *
 * Returns null for a tier with no window: `passive` promises nothing, so it can
 * never be late, and giving it an expiry would manufacture a broken promise out
 * of a free service working as described.
 */
export function expiryFor(tier: BlastTier, from: Date): Date | null {
  const hours = TIERS[tier].window_hours;
  return hours > 0 ? new Date(from.getTime() + hours * 3_600_000) : null;
}

/**
 * 7.7 — is this blast owed a refund?
 *
 * "Every paid Ask is guaranteed: no useful answer inside the promised window,
 * automatic credit" (§8). Two things follow, and both are in the shape:
 *
 *  - **a free tier is never refunded**, because nothing was taken;
 *  - **the test is an *approved* answer, not a reply.** A contributor writing
 *    back is not the promise being kept — the promise was a useful answer, and
 *    only the admin's approval says one arrived. Counting raw replies would let
 *    a "no idea, sorry" discharge the guarantee.
 */
export function owedRefund(input: {
  tier: BlastTier;
  approved_answers: number;
  expires_at: Date | null;
  now: Date;
}): boolean {
  if (TIERS[input.tier].price_cents === 0) return false;
  if (input.approved_answers > 0) return false;
  if (!input.expires_at) return false;
  return input.now.getTime() >= input.expires_at.getTime();
}
