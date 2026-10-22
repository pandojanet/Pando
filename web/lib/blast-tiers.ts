/**
 * M7.2 — the Network Ask, as data. **One kind, and nothing in the app is
 * priced** (22 Oct).
 *
 * The four kinds of the 8.18 strategy §8 (Passive, Board Ask, Targeted Ask,
 * Last-Minute Care) are gone from the code, and with them prices, credits,
 * refunds and Stripe: the pilot is free and a parent is never told otherwise.
 * Payments come back later as a new decision; the removed code is in git
 * (the commit before "Remove every payment and price from the app").
 *
 * ⚠ **The stored id is still `targeted`.** `blasts_tier_check` (`drizzle/0021`)
 * allows the four ids and `blasts_free_owes_nothing` (`0029`) accepts a
 * `targeted` row at price 0, so one kind needs no migration — and a migration is
 * a write to the only database. The payment columns on `blasts` stay, unused. An
 * old row with another id reads through `tierSpec`, which answers with the one
 * kind rather than throwing.
 *
 * Nothing about protecting contributors depends on the kind: the monthly cap,
 * the 48-hour gap and the response-rate governor run per person in `selectPool`
 * and `sms.ts` (invariant 5), and are unchanged.
 */

/** The one kind of Network Ask. The stored id is `targeted` — see above. */
export type BlastTier = "targeted";

export const GENERAL_TIER: BlastTier = "targeted";

export interface TierSpec {
  id: BlastTier;
  /** What the parent and the admin see it called. */
  label: string;
  /** How many parents Pando contacts directly. */
  pool_target: number;
  /** Hours before it is unfulfilled — 7.7's window. */
  window_hours: number;
}

export const TIERS: Record<BlastTier, TierSpec> = {
  targeted: {
    id: "targeted",
    label: "Network Ask",
    /* "three to five carefully matched parents" — five, so the pool selector has
       room to lose some to the contributor-protection filters and still keep
       the promise. */
    pool_target: 5,
    window_hours: 24,
  },
};

/** The kinds that can be created: one. */
export const TIER_IDS: BlastTier[] = [GENERAL_TIER];

/** A stored tier id → its spec. An old row carrying another id reads as the one kind. */
export function tierSpec(id: string | null | undefined): TierSpec {
  return TIERS[id as BlastTier] ?? TIERS[GENERAL_TIER];
}

/**
 * Whether a question needs a human to check the match before it is sent.
 *
 * §8: "questions with unusual or stacked requirements automatically get a human
 * reviewing the match". Two triggers, and each is a case where an automatic
 * pool would be wrong rather than merely imperfect:
 *
 *  - **the matcher could not fill the pool** — a short pool is 6.6's cold start;
 *  - **the question stacks requirements** — several hard constraints at once is
 *    exactly where a scorer is confident and wrong.
 */
export function needsHumanReview(input: {
  tier: BlastTier;
  matched: number;
  /** Hard requirements the question demanded — see `Requirements.mustHave`. */
  requirement_count: number;
}): { required: boolean; reason?: "short_pool" | "stacked_requirements" } {
  const spec = tierSpec(input.tier);
  if (spec.pool_target > 0 && input.matched < spec.pool_target) {
    return { required: true, reason: "short_pool" };
  }
  if (input.requirement_count >= 2) {
    return { required: true, reason: "stacked_requirements" };
  }
  return { required: false };
}

/** 7.7 — when the promise runs out. */
export function expiryFor(tier: BlastTier, from: Date): Date {
  return new Date(from.getTime() + tierSpec(tier).window_hours * 3_600_000);
}

/**
 * Has this Ask's window run out while it is still live? The admin reads the date
 * rather than the status, because `expire_blasts` runs on a schedule and the
 * page is read live. A settled Ask is already the truth.
 */
export function windowClosed(
  row: { status: string; expires_at: string | null },
  now = Date.now(),
): boolean {
  return (
    row.expires_at !== null &&
    new Date(row.expires_at).getTime() < now &&
    (row.status === "draft" || row.status === "active" || row.status === "pending_review")
  );
}
