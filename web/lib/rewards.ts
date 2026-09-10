/**
 * The launch incentive — the client, 10 Sep, section 6.
 *
 * *"Use one guaranteed $10 payment for every qualifying parent. This is the
 * only launch incentive."*
 *
 * ## Why this is its own module and imports nothing
 *
 * The offer sentence has to appear **identically** in two places she named —
 * the invite a parent sends and the join page — and a payment promise written
 * twice is a payment promise that eventually disagrees with itself about the
 * amount or the deadline. It is also the one string here that has legal weight,
 * so it is stored once and linked to Terms rather than retyped.
 *
 * No runtime imports, so `test:rewards` can load it in plain node — the same
 * property `lib/payments.ts` and `lib/matching.ts` keep, and for the same
 * reason: money and eligibility are the last places to trade an exhaustive test
 * for a tidier import path.
 */

/** The amount, in whole dollars. One number, used by every sentence below. */
export const REWARD_AMOUNT_USD = 10;

/**
 * The hard deadline, from her own sentence.
 *
 * ⚠ **An ISO date rather than the words**, with the display form derived — the
 * offer text and the eligibility check must not be able to disagree about which
 * day it is, and they would the first time somebody edited one string.
 */
export const REWARD_DEADLINE = "2026-10-31T23:59:59-07:00";

/** "Oct 31, 2026" — the way her sentence writes it. */
export const REWARD_DEADLINE_LABEL = "Oct 31, 2026";

/**
 * **Her exact sentence**, used verbatim in both places she named.
 *
 * ⚠ *"Use this exact sentence in both places and link Terms to the page."* So
 * the trailing "Terms." is **not** in this string: it is a link, and a link
 * rendered as text inside a promise is a promise nobody can read the terms of.
 * Every surface below appends it as a real anchor.
 *
 * ⚠ It is deliberately **not** in `sms-templates.ts`. That file is registered
 * A2P copy where a reword is a compliance event; this is an offer a parent
 * types into a message themselves, and the client owns its wording.
 */
export const REWARD_OFFER =
  `Verify your number, answer the two required questions and share one real recommendation with a reason by ${REWARD_DEADLINE_LABEL}, and we’ll send a $${REWARD_AMOUNT_USD} reward.`;

/** Her confirmation copy, once the qualifying recommendation is in. */
export const REWARD_CONFIRMATION = "Done — watch out for your payment this week";

/**
 * The four conditions, and **all four** — her completion trigger.
 *
 * *"Mark a founding contributor eligible only when all four are true: phone
 * verified; both required questions answered; one real recommendation saved;
 * and a reason included."*
 *
 * ⚠⚠ **This is stricter than the rule it replaces, in the one direction that
 * costs money.** `reward_status` has said `eligible` on *one approved
 * contribution* since 10 Aug — no phone check, no required-questions check, and
 * nothing at all about a reason. Her fourth condition is the substance: a card
 * with a name and no sentence is a row, not a recommendation, and *"blank or
 * nonsense recommendations do not qualify."*
 *
 * ⚠ **A reason is the parent's own words, not any free text.** `hasReason`
 * checks the field the composer actually reads and would actually send — a
 * caveat or a tip is welcome and is not the thing being paid for.
 *
 * ⚠ **Nonsense is not detectable here and this does not pretend to be.** The
 * length floor catches "good" and "ok"; it cannot catch "asdfgh", which is a
 * judgement and belongs to whoever approves the contribution. The rule below is
 * *necessary* and never sufficient — the admin still decides.
 */
export interface RewardInput {
  /** Invariant 11 — a server fact, never a field the client sets. */
  phone_verified: boolean;
  /** §8.5's two: where they live and who their children are. */
  neighborhood_answered: boolean;
  children_answered: boolean;
  /** One saved, non-test recommendation of any share kind. */
  recommendations: number;
  /** Its own words — `what_makes_it_great`, trimmed. */
  reason: string | null;
  /** Arrived on an invite link. *"invite-code holders only."* */
  has_invite: boolean;
  /** When the qualifying recommendation landed. */
  at?: Date;
}

export type RewardStatus = "eligible" | "started" | "none" | "missed_deadline";

/**
 * The shortest sentence that could be called a reason.
 *
 * ⚠ Twelve characters rather than one: *"good"* and *"we loved it"* are what
 * the 26 Aug confirm-back was written for, and neither is what a parent is
 * being paid ten dollars to write. It is a floor and not a judgement — see the
 * note above about nonsense.
 */
export const REASON_MIN_LENGTH = 12;

export function hasReason(reason: string | null | undefined): boolean {
  return (reason ?? "").trim().length >= REASON_MIN_LENGTH;
}

export function rewardStatus(input: RewardInput): RewardStatus {
  const started =
    input.recommendations > 0 || input.neighborhood_answered || input.children_answered;

  const qualifies =
    input.has_invite &&
    input.phone_verified &&
    input.neighborhood_answered &&
    input.children_answered &&
    input.recommendations > 0 &&
    hasReason(input.reason);

  if (!qualifies) return started ? "started" : "none";

  /* The deadline is checked **last**, so a parent who did everything and did it
     late reads as `missed_deadline` rather than as `started` — the two are
     different conversations, and only one of them is about the offer having
     closed. */
  const at = input.at ?? new Date();
  if (at.getTime() > new Date(REWARD_DEADLINE).getTime()) return "missed_deadline";

  return "eligible";
}

/**
 * The offer, as it appears in a message a parent sends.
 *
 * Its own function because the invite message is assembled from pieces so that
 * the link stays byte-identical on the clipboard (8 Sep) — a promise about
 * money must not be the thing that breaks that.
 */
export function rewardOfferForInvite(): string {
  return REWARD_OFFER;
}
