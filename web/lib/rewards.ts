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

/**
 * What the chat says once a parent has done their own half.
 *
 * ⚠⚠ **Her sentence was *"Done — watch out for your payment this week"*, and it
 * stopped being true on 16 Sep.** It was written when one approved contribution
 * earned the $10, so a saved card really was the last step. Under the Founding
 * requirements the parent's card is not the last step: an admin has to approve
 * **two** of them, and a screen promising money that week would be the product
 * committing somebody else's decision — the third time this file has recorded a
 * surface promising something nothing grants.
 *
 * So it says what is true at that moment and names the step that is left.
 * ⚠ The wording is ours and provisional: hers was approved copy, and the
 * replacement is on the list for her.
 */
export const REWARD_CONFIRMATION =
  "That's everything we need from you — once both of your recommendations are checked, we'll be in touch about the reward";

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
/**
 * How full a profile has to be before the reward is in play.
 *
 * ⚠⚠ **Eighty, not a hundred, and the developer chose the number after it was
 * measured.** Their instruction was *"повністю заповнений профіль"*, whose
 * literal reading is 100% — and measured against the live cohort on 16 Sep that
 * is **one parent in twelve**, with nine of the twelve sitting at ~20% because
 * they tapped Continue at the optional fork. That fork is the client's own
 * 10 Sep decision, so a 100% gate would withhold the $10 from parents who did
 * exactly what the flow asked of them. Eighty means *almost everything* and
 * leaves one or two skipped questions survivable.
 *
 * ⚠⚠ **It is measured by `profileDepth`, never by `profileCompleteness`.** The
 * stored `profile_completeness` counts the screens a parent can *see*, so a
 * Continue-at-the-fork profile reports **100%** on two answers — as a gate it
 * would pass precisely the parents it exists to catch. `people.profile_depth`
 * is the second number, written beside it by the profile write.
 */
export const FOUNDING_MIN_PROFILE_DEPTH = 80;

/**
 * How many contributions an admin has to have approved.
 *
 * ⚠⚠ **Plain `status = 'approved'`, not `qualifying_approved`.** The
 * developer's words were *"2 активності/няні/тощо, які апрувнуті адміном"* —
 * the admin pressed **Add to Pando**, and that is the whole test.
 * `founding_checklist` also carries a six-field `qualifying_approved`, and it
 * is deliberately **not** what gates this: four of those six (the caveat,
 * who-for, who-not-for, and the child's age at the time) moved **behind the
 * optional fork** on 10 Sep, so a card captured by today's flow frequently
 * cannot satisfy it. Gating on it would have made Founding unreachable through
 * the product's own shortest path.
 */
export const FOUNDING_MIN_APPROVED = 2;

/**
 * What a parent must have done before an admin is asked to decide.
 *
 * ⚠⚠ **This is the 16 Sep reshaping of the Founding queue, and it changes what
 * that queue is for.** It used to answer *"is this really Sarah from our parent
 * group?"* — a question that stopped meaning anything when entry opened on
 * 7 Sep and everyone began arriving directly. It now answers *"has this parent
 * earned the badge and the $10?"*: a record reaches the queue only once both
 * new requirements hold, and a person decides from there.
 *
 * **The two new conditions are the developer's.** The three older ones are the
 * client's 10 Sep completion trigger, kept rather than quietly dropped: phone
 * verified (invariant 11), both §8.5 required questions answered, and a real
 * reason in the parent's own words. A card with a name and no sentence is a row
 * rather than a recommendation, and *"blank or nonsense recommendations do not
 * qualify."*
 *
 * ⚠⚠ **One of her conditions is deliberately gone: `has_invite`.** Her §6 said
 * *"invite-code holders only"*, and entry has been open since 7 Sep — measured
 * on the live cohort, **ten of twelve** real parents arrived with no invite at
 * all, so that clause silently put the reward out of reach for most of the
 * people it was written for. The developer's *"немає концепції груп, всі
 * напряму приєднуються"* is what removes it. ⚠ It is hers to restore, and
 * restoring it means closing entry again: the two are one decision.
 *
 * ⚠⚠ **And her offer sentence now promises less than this asks.**
 * `REWARD_OFFER` is on `/join` and in every invite a parent sends, and it names
 * *one* recommendation and the two required questions. It has to be re-approved
 * against these requirements, or the product is making a promise it will not
 * keep — the 20 Aug rule with the sentence missing rather than the write.
 *
 * ⚠ **Nonsense is still not detectable here and this does not pretend to be.**
 * The length floor catches "good" and "ok" and cannot catch "asdfgh" — much
 * less of a hole than it was, because two admin approvals now stand between a
 * parent and the money. The rule is *necessary* and never sufficient.
 */
export interface RewardInput {
  /** Invariant 11 — a server fact, never a field the client sets. */
  phone_verified: boolean;
  /** §8.5's two: where they live and who their children are. */
  neighborhood_answered: boolean;
  children_answered: boolean;
  /** `profileDepth` as a percentage, stored on the person by the profile write. */
  profile_depth: number;
  /** Contributions an admin approved — shares and caregiver nominations alike. */
  approved_contributions: number;
  /** Its own words — `what_makes_it_great`, trimmed. */
  reason: string | null;
  /** The admin's decision. Once taken, nothing below can unmake it. */
  founding_approved: boolean;
  /** When the judgement is being made. */
  at?: Date;
}

/**
 * `approved` is a person's decision · `in_review` is the queue · `not_met` is
 * everything else · `missed_deadline` is everything done, and done too late.
 *
 * ⚠ The names changed with the meaning on 16 Sep. `eligible` / `started` /
 * `none` described a rule the app computed by itself; these describe a decision
 * somebody takes, which is what the Founding queue now is.
 */
export type RewardStatus = "approved" | "in_review" | "missed_deadline" | "not_met";

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

/**
 * Has this parent done everything the queue asks, before anybody looks?
 *
 * Exported on its own because two surfaces need the answer without needing a
 * status: the Founding queue filters on it, and the contributor page explains
 * which half is missing. One function, so the queue can never contain somebody
 * the reward column calls unqualified.
 */
export function meetsFoundingRequirements(input: RewardInput): boolean {
  return (
    input.phone_verified &&
    input.neighborhood_answered &&
    input.children_answered &&
    input.profile_depth >= FOUNDING_MIN_PROFILE_DEPTH &&
    input.approved_contributions >= FOUNDING_MIN_APPROVED &&
    hasReason(input.reason)
  );
}

export function rewardStatus(input: RewardInput): RewardStatus {
  /**
   * ⚠ **The admin's decision is checked first and is final.** Founding is
   * granted by a person, and a requirement that later stops holding — a
   * contribution retired by the freshness queue, say — must not silently
   * un-approve somebody who has already been told they earned it. This is the
   * same reasoning that makes the tier ladder monotonic (1 Sep): access earned
   * is not access rented.
   */
  if (input.founding_approved) return "approved";

  if (!meetsFoundingRequirements(input)) return "not_met";

  /* The deadline is checked **last**, so a parent who did everything and did it
     late reads as `missed_deadline` rather than as `not_met` — the two are
     different conversations, and only one of them is about the offer having
     closed. */
  const at = input.at ?? new Date();
  if (at.getTime() > new Date(REWARD_DEADLINE).getTime()) return "missed_deadline";

  return "in_review";
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
