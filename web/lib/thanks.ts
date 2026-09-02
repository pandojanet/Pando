/**
 * M9.1 + M9.2 — when to ask whether it helped, and when to say thank you.
 *
 * Two loops that look alike and are not. **9.1 asks the parent who received an
 * answer**, a few days later, whether it worked. **9.2 thanks the contributors
 * whose recommendation it was**, batched so nobody hears from Pando twice in a
 * week for being helpful.
 *
 * Pure, and free of runtime imports, for the reason `outreach-policy.ts` is: it
 * decides whether a real person gets a text, and a rule like that has to be
 * exhaustively testable — including every case where the answer is "not yet"
 * and "not at all".
 *
 * ## The rule underneath both
 *
 * A thank-you is an unprompted message, so it spends the same protections as any
 * other: the 48-hour gap, the monthly ceiling, quiet hours, the opt-out list.
 * Nothing here re-implements them — `sendSms` runs them, and a refusal is a skip
 * rather than a failure. What this file decides is only *who is worth asking*,
 * which is the same division of labour `freshness_ping` follows.
 */

/**
 * How long to wait before asking whether a recommendation helped.
 *
 * 9.1's own numbers: 3–5 days for an activity, 7–14 for a caregiver. Two
 * bounds, not one, and both do work. The **floor** is politeness with a reason
 * behind it — a parent asked the evening they got the answer has not been
 * anywhere yet, and "did it help?" before they could find out reads as a
 * service talking to itself. The **ceiling** is honesty: past it the answer is a
 * memory rather than an experience, and a stale yes is worse evidence than no
 * answer, because it enters the ledger as though somebody had just used it.
 *
 * A caregiver waits longer because hiring one takes longer. A parent given three
 * names on Monday has not employed anybody by Thursday.
 */
export interface ThanksWindow {
  kind: string;
  after_days: number;
  before_days: number;
}

export const THANKS_WINDOWS: ThanksWindow[] = [
  { kind: "activity", after_days: 3, before_days: 5 },
  { kind: "place", after_days: 3, before_days: 5 },
  { kind: "tip", after_days: 3, before_days: 5 },
  { kind: "caregiver", after_days: 7, before_days: 14 },
];

/**
 * The window for an answer that drew on several kinds of record.
 *
 * **The slowest kind wins.** An answer naming a class and a sitter is asked
 * about on the sitter's clock, because asking on the class's would catch the
 * parent three days in, before they have done the slower half — and 9.1 asks
 * one question, not one per record. The cost of waiting is a later answer; the
 * cost of asking early is a "not yet" recorded as a verdict.
 */
export function windowFor(kinds: string[]): ThanksWindow {
  const known = kinds
    .map((k) => THANKS_WINDOWS.find((w) => w.kind === k))
    .filter((w): w is ThanksWindow => w !== undefined);
  if (known.length === 0) {
    /* An unknown kind takes the **slowest** window, the mirror of the strictest
       freshness policy in `trust-labels.ts`: a category nobody wrote a number
       for must not inherit the most impatient answer. */
    return THANKS_WINDOWS.reduce((slowest, w) =>
      w.after_days > slowest.after_days ? w : slowest,
    );
  }
  return known.reduce((slowest, w) => (w.after_days > slowest.after_days ? w : slowest));
}

export type PromptVerdict =
  | { ask: true }
  | { ask: false; reason: "too_soon" | "too_late" | "already_asked" | "not_sent" };

export interface AnswerState {
  /** When the answer actually reached the parent. Null means it did not. */
  sent_at: Date | string | null;
  /** Null means nobody has asked yet. */
  helped_asked_at: Date | string | null;
  /** The kinds of record it was composed from. */
  kinds: string[];
}

const daysSince = (at: Date | string, now: Date): number =>
  (now.getTime() - (at instanceof Date ? at : new Date(at)).getTime()) / 86_400_000;

/**
 * Is this answer due its "did it help?".
 *
 * Note what is **not** here: whether the parent may be texted at all. That is
 * `sendSms`'s answer and it is asked later, on purpose — a parent inside their
 * 48-hour gap is due and simply skipped, and folding the two questions
 * together would make a protection rule look like a scheduling decision.
 */
export function shouldPrompt(state: AnswerState, now: Date = new Date()): PromptVerdict {
  if (!state.sent_at) return { ask: false, reason: "not_sent" };
  if (state.helped_asked_at) return { ask: false, reason: "already_asked" };

  const window = windowFor(state.kinds);
  const age = daysSince(state.sent_at, now);
  if (age < window.after_days) return { ask: false, reason: "too_soon" };
  if (age > window.before_days) return { ask: false, reason: "too_late" };
  return { ask: true };
}

/**
 * 9.2 — at most one thank-you per contributor per week.
 *
 * The estimate's own number, and the reason it is a *batching* rule rather than
 * a rate limit: a contributor whose three recommendations all landed in one week
 * should hear that once, warmly, not three times. Three messages saying thank
 * you is not three times the gratitude — it is Pando being noisy at the person
 * being helpful, which is the failure 9.2 exists to prevent.
 */
export const THANKS_GAP_DAYS = 7;

/**
 * How many items go into one message.
 *
 * Two, and then "and more". An SMS has to stay one segment, and a list of six
 * places reads like a report rather than a thank-you. The count is still stated
 * so nothing is hidden: "three of your recommendations" is the honest version of
 * silently dropping four.
 */
export const THANKS_ITEMS_SHOWN = 2;

export interface ThanksCandidate {
  person_id: string;
  /** What to thank them for, newest first. Names of records, already resolved. */
  items: string[];
  /** When they were last thanked. Null means never. */
  last_thanked_at: Date | string | null;
}

export type ThanksVerdict =
  | { send: true; items: string[] }
  | { send: false; reason: "nothing_to_thank" | "thanked_recently" };

export function shouldThank(
  candidate: ThanksCandidate,
  now: Date = new Date(),
): ThanksVerdict {
  if (candidate.items.length === 0) return { send: false, reason: "nothing_to_thank" };
  if (
    candidate.last_thanked_at &&
    daysSince(candidate.last_thanked_at, now) < THANKS_GAP_DAYS
  ) {
    /* Not dropped — the batch is still owed and will be picked up next run, with
       whatever else has accumulated by then. That is what makes this batching
       rather than throttling. */
    return { send: false, reason: "thanked_recently" };
  }
  return { send: true, items: candidate.items };
}

/**
 * Did they say yes, no, or something else?
 *
 * **Exact on the whole message**, the same rule `keywordOf` follows and for a
 * related reason. A substring test would read "no idea, we never got round to
 * it" as a verdict that the recommendation failed, and "yes we're still deciding"
 * as one that it worked — and a yes writes an impact event and a thank-you to a
 * third person, so a wrong reading reaches somebody who was never in the
 * conversation.
 *
 * Anything it cannot place returns **null**, which means the answer stays
 * unresolved and the message is handled as ordinary text. That is the 27 Aug
 * rule the clarifying parser follows: null stores nothing, because a guess here
 * is silent and permanent.
 *
 * `YES` is safe to ask for precisely because it is **not** an opt-in keyword —
 * that was removed from the carrier list deliberately (see `sms-templates.ts`),
 * so a parent answering yes to a question cannot read as a re-subscribe.
 */
const YES_WORDS = ["YES", "Y", "YEP", "YEAH", "YUP", "IT HELPED", "HELPED"];
const NO_WORDS = ["NO", "N", "NOPE", "NOT REALLY", "DIDNT HELP", "DIDN'T HELP"];

export function yesOrNo(body: string): boolean | null {
  const word = body.trim().toUpperCase().replace(/[.!,]+$/, "");
  if (YES_WORDS.includes(word)) return true;
  if (NO_WORDS.includes(word)) return false;
  return null;
}

/**
 * The list, as one clause.
 *
 * Never a bare count: "3 recommendations" tells a contributor nothing about what
 * they did, and the whole point of an impact receipt (strategy 13) is that it
 * names the thing. Never a bare list either, past two — see the constant above.
 */
export function thanksList(items: string[]): string {
  const shown = items.slice(0, THANKS_ITEMS_SHOWN);
  const rest = items.length - shown.length;
  const joined = shown.length === 2 ? `${shown[0]} and ${shown[1]}` : shown[0];
  if (rest <= 0) return joined;
  return `${joined} (and ${rest} more)`;
}
