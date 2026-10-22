/**
 * M7.2 — the Network Ask, as data. **One kind, and free** (21 Oct).
 *
 * ## What changed, and what did not
 *
 * The developer, 21 Oct: *"remove every kind of blast, keep one general blast
 * and make it free."* Until then there were four, from the client's 8.18
 * strategy §8 — Passive (free, contacts nobody), Board Ask ($5), Targeted Ask
 * ($15) and Last-Minute Care (free, 4 hours, always reviewed). Now there is one
 * **Network Ask**, with what the Targeted Ask did, because it was the only one
 * that worked end to end: the SMS yes already created it, the admin picker
 * defaulted to it, and the matcher's pool, the short-pool review and the
 * contributor protections are all built around it. The Board Ask's board was
 * never built (it was a one-person Targeted Ask with a longer clock), Passive
 * sent nothing, and Last-Minute's four hours with a forced review would have
 * expired most Asks before an admin pressed Send.
 *
 * ⚠ **The stored id is still `targeted`.** `blasts_tier_check` (`drizzle/0021`)
 * allows the four ids and `blasts_free_owes_nothing` (`0029`) accepts a
 * `targeted` row at price 0, so one free kind needs no migration — and a
 * migration is a write to the only database. Renaming the id is a later,
 * cosmetic change. The parent and the admin see "Network Ask".
 *
 * The three other ids stay in the type **only so old rows still read**: each is
 * described here, free, and none can be created (`TIER_IDS` is the one).
 *
 * Nothing about protecting contributors depends on the kind: the monthly cap,
 * the 48-hour gap and the response-rate governor run per person in
 * `selectPool` and `sms.ts` (invariant 5), and are unchanged.
 */

/** Every id a stored row may carry (`blasts_tier_check`). Only `GENERAL_TIER` is created. */
export type BlastTier = "passive" | "board" | "targeted" | "last_minute";

/** The one kind of Network Ask. The stored id is `targeted` — see above. */
export const GENERAL_TIER = "targeted" as const satisfies BlastTier;

export interface TierSpec {
  id: BlastTier;
  /** What the parent and the admin see it called. */
  label: string;
  /** US cents. 0 — every Network Ask is free (21 Oct). */
  price_cents: number;
  /** How many parents Pando contacts directly. Zero for the ones that contact nobody. */
  pool_target: number;
  /** Hours before it is unfulfilled — 7.7's window. */
  window_hours: number;
  /** A human checks the match before anything is sent. */
  always_human_review: boolean;
  /**
   * Which credit pays for this kind — null for all of them now that nothing is
   * charged. The names `credits_kind_check` allows (`network_ask`,
   * `targeted_network_ask`) are kept in the type for old rows.
   */
  credit_kind: "network_ask" | "targeted_network_ask" | null;
  /** Shown to the admin; not parent-facing copy. */
  note: string;
  /** 13.5 — the Stripe receipt line. Nothing is charged, so none has one. */
  receipt_description?: string;
  /** True for an id kept only so old rows read. */
  legacy?: boolean;
}

export const TIERS: Record<BlastTier, TierSpec> = {
  targeted: {
    id: "targeted",
    label: "Network Ask",
    price_cents: 0,
    /* "three to five carefully matched parents" — five, so the pool selector has
       room to lose some to the contributor-protection filters and still keep
       the promise. */
    pool_target: 5,
    window_hours: 24,
    always_human_review: false,
    credit_kind: null,
    note: "Free. Three to five carefully matched parents, asked personally.",
  },
  /* ---- old rows only: none of these can be created any more (21 Oct) ---- */
  passive: {
    id: "passive",
    label: "Passive (old)",
    price_cents: 0,
    /* `blasts_passive_contacts_nobody` keeps its rows at 0, and sendBlast refuses them. */
    pool_target: 0,
    window_hours: 0,
    always_human_review: false,
    credit_kind: null,
    note: "An old kind: nobody was contacted. Kept so old rows read.",
    legacy: true,
  },
  board: {
    id: "board",
    label: "Board Ask (old)",
    price_cents: 0,
    pool_target: 1,
    window_hours: 48,
    always_human_review: false,
    credit_kind: null,
    note: "An old kind, now free like every Ask. Kept so old rows read.",
    legacy: true,
  },
  last_minute: {
    id: "last_minute",
    label: "Last-Minute Care (old)",
    price_cents: 0,
    pool_target: 5,
    window_hours: 4,
    /* Old rows were created waiting for a person; that stays true of them. */
    always_human_review: true,
    credit_kind: null,
    note: "An old kind, always read by a person first. Kept so old rows read.",
    legacy: true,
  },
};

/** The kinds that can be created: one (21 Oct). */
export const TIER_IDS: BlastTier[] = [GENERAL_TIER];

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
 *  - **the kind always requires it** (old Last-Minute Care rows only, since 21 Oct);
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
  /**
   * What was actually charged (`blasts.price_cents`). An old row that was
   * really card-paid is owed its guarantee even though no Ask costs anything
   * now (review, 21 Oct); without it, the kind's price — 0 — is used.
   */
  price_cents?: number;
}): boolean {
  if ((input.price_cents ?? TIERS[input.tier].price_cents) === 0) return false;
  if (input.approved_answers > 0) return false;
  if (!input.expires_at) return false;
  return input.now.getTime() >= input.expires_at.getTime();
}

/**
 * 7.7's other half — does `expire_blasts` owe this Ask an automatic credit?
 *
 * The guarantee has **two** currencies and they must not both be spent on one
 * failure. `owedRefund` above answers the money question; this answers the
 * credit one, and the split is the same one `refundOwed` in `lib/payments.ts`
 * already draws for the admin: *a credit-funded Ask gets a fresh credit, a
 * card-funded one gets money back*.
 *
 * ## What it refuses, and both were live
 *
 * **A card payment is not answered with a credit.** The job granted one to any
 * expired paid tier, while the blast manager simultaneously reported "Pando
 * owes this parent a refund" — so a $15 Ask that timed out produced a credit
 * *and* a refund for one failure. Measured on the live database: of four
 * expired Asks the job credited three, one of them card-paid.
 *
 * **An Ask nobody paid for is owed nothing.** This is the one with teeth.
 * `createBlast` started a paid tier at `payment_status = 'pending'` (until 21
 * Oct; every Ask is free and `not_required` now), and the
 * old rule looked only at the tier — so a Board Ask created, never paid, never
 * sent, and left to expire **minted a free credit**, repeatably. The same live
 * run credited exactly such a row. Nothing was taken, so nothing is owed.
 *
 * A free tier is unchanged and needs no branch of its own: `passive` and
 * `last_minute` are `price_cents === 0`, so they can never have been paid and
 * can never carry a credit.
 */
export function automaticCredit(input: {
  tier: BlastTier;
  payment_status: string;
  credit_funded: boolean;
  /** The kind of the credit that was actually spent on it (`credits.kind`). */
  credit_kind?: string | null;
}): { grant: boolean; kind: string | null } {
  /**
   * ⚠ **Paid with a credit: give it back — checked before the price** (review,
   * 21 Oct). No new Ask can be credit-funded now that every Ask is free, so
   * `credit_funded` only ever describes an old row where a parent really spent
   * a credit; making Asks free must not quietly keep it. The kind returned is
   * the one that was spent, so the parent gets back exactly what they gave.
   */
  if (input.credit_funded) {
    const kind = input.credit_kind ?? TIERS[input.tier]?.credit_kind ?? null;
    return kind ? { grant: true, kind } : { grant: false, kind: null };
  }
  const spec = TIERS[input.tier];
  if (!spec || spec.credit_kind === null || spec.price_cents === 0) {
    return { grant: false, kind: null };
  }
  /* Paid with a card (owed money, a person's decision, 13.7 — a credit would be
     the second compensation) or never paid at all: no credit either way. */
  return { grant: false, kind: null };
}

/**
 * M13.5 — what this Ask owes, given its tier and whether a credit paid for it.
 *
 * ## Why this lives here and not in `lib/payments.ts`
 *
 * It was written there first, and it could not stay: `payments.ts` would have
 * needed to import this file, and an import is the one thing that stops a module
 * being loadable by `node --experimental-strip-types`. CLAUDE.md records the
 * same trade for `lib/matching.ts` — "deliberately free of *runtime* imports so
 * `npm run test:matching` can load it in plain node" — and an earlier attempt at
 * that file lost the property by giving the age ladder its own module.
 *
 * The factoring that fell out is better than the one it replaced, which is worth
 * saying: **"what does this tier cost" is a fact about a tier**, and tiers and
 * their prices live here. What stayed in `payments.ts` is everything that is
 * *not* about a tier — whether a refund is coherent, whether the guarantee is
 * owed, how to write cents as dollars.
 *
 * ## The three answers are exhaustive on purpose
 *
 * There is no "unknown" branch, because a blast whose payment state cannot be
 * determined must not be creatable in the first place.
 *
 * And the credit is checked **before** the price, which is 13.5's own
 * requirement ("skipped entirely when a free credit covers it") rather than an
 * optimisation: the strategy's guarantee is that a paid Ask producing no useful
 * answer earns an automatic credit, so charging before looking would bill a
 * parent for the Ask Pando owed them. `createBlast` redeems the credit inside
 * the same transaction as the insert, so by the time this is asked the row
 * already knows.
 */
export interface PaymentDecision {
  /** Whether a card payment has to happen before this blast can be sent. */
  charge: boolean;
  /** US cents. Zero whenever `charge` is false. */
  cents: number;
  /** The `blasts.payment_status` this implies. */
  status: "not_required" | "pending";
  /** Why, in words an admin can read on the payments page. */
  reason: "free_tier" | "credit_redeemed" | "checkout_required";
}

/**
 * Whether an unpaid Ask is refused at the moment of sending. **Off, 14 Sep.**
 *
 * The developer's call, to walk the whole Network Check chain end to end on the
 * pilot deployment without the economics in the way: *"поки повністю вимкни, а
 * я як попрошу, то повернеш ціни"*. Restoring it is this one line.
 *
 * ## What it does and does not change
 *
 * **Prices are untouched.** `TIERS` still says $5 and $15, `paymentFor` still
 * returns `charge: true` for them, a new Ask is still created `pending`, and
 * `/admin/payments` still reports it as unpaid. Only the refusal in `sendBlast`
 * is relaxed, and it logs when it is.
 *
 * That shape is deliberate, and the tempting alternative is worse: making
 * `paymentFor` return `not_required` would have the row *say* no payment was
 * required, and `blasts` stores only `payment.status` and never the `reason` —
 * so nothing would ever tell that row apart from a genuinely free tier, long
 * after this flag came off. Relaxing enforcement writes nothing false.
 *
 * ## Why it is safe today, and exactly when it stops being
 *
 * **Only an admin can create an Ask.** `blast.create` is an admin action behind
 * the session gate, and M7's automatic entry — the thin answer's *"Want me to
 * ask a few nearby parents for more?"* — reads nobody's yes (see CLAUDE.md).
 * So there is no path by which a parent can either be charged or get something
 * free while this is off.
 *
 * ⚠ **The day that automatic entry is wired, this has to be back on**, or the
 * first thing it does is hand out $15 Asks. It is on the switch-off list with
 * `MESSAGING_RELAY=slack` and the `pando` starter password.
 *
 * A named constant rather than an env var, on `PILOT_HOLD_EVERYTHING`'s
 * precedent: it is meant to come off, and a constant comes back through a diff
 * somebody reviews rather than through a file on a VPS that nobody re-reads.
 */
export const PAYMENTS_ENFORCED = false;
/*
 * ⚠ 21 Oct: every Network Ask is free, so `paymentFor` below never charges and
 * this flag has nothing left to relax. The 14 Sep text above describes the
 * priced world it was written for: prices are no longer "untouched", a new
 * Ask is created `not_required`, and there is no $15 Ask to hand out. It stays false and is kept only so the
 * one line that read it still compiles; prices coming back would be a new
 * decision, not this flag.
 */

export function paymentFor(input: {
  tier: BlastTier;
  creditRedeemed: boolean;
}): PaymentDecision {
  const spec = TIERS[input.tier];

  /* Free by design. `passive` contacts nobody (it is 7.11's demand map) and
     `last_minute` is free during the pilot — a decision, not a placeholder. */
  if (spec.price_cents === 0) {
    return { charge: false, cents: 0, status: "not_required", reason: "free_tier" };
  }

  if (input.creditRedeemed) {
    return { charge: false, cents: 0, status: "not_required", reason: "credit_redeemed" };
  }

  return {
    charge: true,
    cents: spec.price_cents,
    status: "pending",
    reason: "checkout_required",
  };
}
