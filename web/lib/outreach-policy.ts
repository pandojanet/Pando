/**
 * M8 — contributor protection, as pure rules.
 *
 * Invariant 5 says these numbers are "enforced **in code, never by judgement**",
 * and this is that code. It is separated from the send layer for the same reason
 * `matching.ts` is separated from its query: a rule that decides whether a real
 * person is contacted has to be testable exhaustively, including every case where
 * the answer is no.
 *
 * ## What this is protecting against
 *
 * Not spam in the legal sense — opt-out and quiet hours handle that, and they run
 * *before* any of this. This protects the thing the strategy calls the point of
 * the whole network: **"Being asked should feel like a compliment."** A helper who
 * gets four requests in a week stops reading them, and the estimate's own framing
 * of 8.4 is that a dropping response rate means Pando is asking wrong, not that
 * the person is unhelpful.
 */

/**
 * The gap between two proactive messages to one person. **48 hours.**
 *
 * ⚠️ **This reverses the five-day figure, on the client's own instruction of
 * 1 Sep.** The history matters, because it has now moved twice and the next
 * session should not move it back by reading an older document.
 *
 *  - Spec §14 and estimate row 8.2 (*titled* "48-hour gap"): 48 hours.
 *  - *Pando Strategy — Current Direction* (8.18), §6 and §7: five days, twice —
 *    "Pando spaces requests at least five days apart — so 'five a month'
 *    describes a real ceiling rather than a burst." Adopted on 27 Aug under
 *    CLAUDE.md's rule that the newer client document wins.
 *  - **Seed Feedback, 1 Sep, item 18: 48 hours, three times.** As an
 *    instruction — *"Apply the 48-hour gap across all contribution requests.
 *    Pando should never send more than one request within 48 hours"* — and
 *    twice more inside the page copy she wrote, including the Open Contributor
 *    tier's own line. Newest document, so it wins in turn.
 *
 * There is a second reason beyond recency, and it is the one that makes this
 * unambiguous: the allowance screen has been telling parents "with a 48-hour
 * gap between any two" since 18 Aug, and her page copy repeats it. Enforcing
 * five days behind copy that promises two was not a broken promise — a parent
 * got fewer messages, not more — but it did mean the number a parent agreed to
 * and the number the code kept were different, and only one of them is written
 * down where she can read it.
 *
 * One named constant, so the number is changed in one place and never inferred
 * from a comment.
 */
export const OUTREACH_GAP_DAYS = 2;

/**
 * The lowest a monthly allowance can go.
 *
 * Five is not a cautious opening offer, it is the floor of the community
 * agreement: §7 makes free access conditional on "up to five genuinely relevant
 * community questions a month". So the governor below may lower somebody from
 * `as_relevant` or 10, and stops here — dropping below five would quietly
 * withdraw the thing they were promised in exchange for their answers.
 */
export const ALLOWANCE_FLOOR = 5;

/** 8.4, and invariant 5's "response-rate governor at 25%/30 days". */
export const RESPONSE_WINDOW_DAYS = 30;
export const RESPONSE_RATE_FLOOR = 0.25;

/**
 * How many requests must be in the window before the governor may act.
 *
 * The estimate does not name one, and without it the rule is unfair in a way
 * that would show up immediately: one unanswered text out of one is a 0%
 * response rate, so a contributor's very first request could lower their tier
 * before they had a chance to answer a second. Four is the smallest sample where
 * "below a quarter" describes a pattern rather than a single missed message.
 */
export const RESPONSE_MIN_SAMPLE = 4;

/** v3.2 §10 — at most one freshness ping per contributor per month. */
export const PINGS_PER_MONTH = 1;

/**
 * M8.3 — changing the agreement by text.
 *
 * ## Why this lives here and not in its own file
 *
 * Because the numbers do. CLAUDE.md already records that 5/10/`as_relevant` has
 * to agree in three places — `ALLOWANCE` in `questions.ts`, the profile route's
 * allow-list, and the `allowance_shape` CHECK — and that widening one without the
 * others is what turned a value the route had just accepted into a write that
 * aborted a layer down. An SMS path is a **fourth** writer of the same fact, so
 * it reads the same constants rather than declaring its own.
 *
 * The module also has no runtime imports, which is what keeps it loadable in a
 * plain node test. A separate `settings-command.ts` importing this one would give
 * that up for nothing.
 */
export const ALLOWANCE_CHOICES = [
  { value: 5 as number | null, mode: "fixed" as const, label: "Now and then", hint: "up to 5 a month" },
  { value: 10 as number | null, mode: "fixed" as const, label: "Happy to help more", hint: "up to 10 a month" },
  { value: null as number | null, mode: "as_relevant" as const, label: "Anytime it's genuinely relevant", hint: "no fixed limit" },
];

/**
 * Does this message open the settings conversation?
 *
 * Two words, both of them things a parent would plausibly text, and neither of
 * them a bare number — because a bare number is how somebody answers the
 * clarifying question about a child's age, and the two must never collide.
 */
export function isSettingsCommand(text: string): boolean {
  const body = text.trim().toUpperCase().replace(/[.!?]+$/, "");
  return body === "SETTINGS" || body === "BLAST SETTINGS";
}

/**
 * Read a choice out of a reply to the settings question.
 *
 * **Only called when Pando just asked** — that is the whole safety of it. "5" on
 * its own means five a month here and a five-year-old in the clarifying flow, and
 * nothing in the words can tell those apart. The records can: whichever question
 * was last put to this person is the one being answered, which is the same rule
 * `intent.ts` follows and the same reason.
 */
export function parseAllowanceChoice(
  text: string,
): { allowance: number | null; mode: "fixed" | "as_relevant" } | null {
  const body = text.trim().toUpperCase().replace(/[.!?]+$/, "");

  if (/^(ANYTIME|ALWAYS|ANY TIME|RELEVANT|3)$/.test(body)) {
    return { allowance: null, mode: "as_relevant" };
  }
  if (/^(5|FIVE|1)$/.test(body)) return { allowance: 5, mode: "fixed" };
  if (/^(10|TEN|2)$/.test(body)) return { allowance: 10, mode: "fixed" };
  return null;
}

/**
 * What Pando texts back when asked.
 *
 * The current setting is stated first, because the commonest reason to text
 * SETTINGS is to find out what it is — and a menu that does not say where you
 * are is a menu you have to guess your way out of.
 */
export function settingsPrompt(current: Allowance): string {
  const now =
    current.allowance_mode === "as_relevant"
      ? "anytime it's genuinely relevant"
      : `up to ${current.monthly_contact_allowance ?? ALLOWANCE_FLOOR} a month`;
  return [
    `Right now Pando may ask you ${now}.`,
    "Reply 1 for up to 5 a month, 2 for up to 10, or 3 for anytime it's genuinely relevant.",
    "However you set it, you'll never get two requests within 48 hours.",
  ].join(" ");
}

/** The confirmation, so a change is never silent. */
export function settingsConfirmation(choice: {
  allowance: number | null;
  mode: "fixed" | "as_relevant";
}): string {
  return choice.mode === "as_relevant"
    ? "Done — Pando will ask anytime a question is genuinely relevant, and never twice within 48 hours."
    : `Done — up to ${choice.allowance} a month, and never twice within 48 hours.`;
}

/** What a contributor agreed to. Straight from `people`. */
export interface Allowance {
  /** 5 or 10; **null** means `as_relevant` — no fixed ceiling. */
  monthly_contact_allowance: number | null;
  allowance_mode: "fixed" | "as_relevant";
}

/** What has already happened to them, from `message_log`. */
export interface OutreachHistory {
  /** Proactive messages in the last 30 days. Replies and codes do not count. */
  sent_last_30_days: number;
  /** How many of those they answered — the governor's numerator. */
  responded_last_30_days: number;
  last_outreach_at: Date | string | null;
  /** Freshness pings already sent this calendar month. */
  pings_this_month: number;
  /** A blast went to them today — v3.2 §10 forbids a ping on the same day. */
  blast_today: boolean;
}

export type OutreachKind = "blast" | "ping" | "thanks";

export type OutreachDecision =
  | { ok: true; allowance: number | null }
  | {
      ok: false;
      reason:
        | "monthly_cap"
        | "too_soon"
        | "ping_this_month"
        | "ping_same_day_as_blast";
      /** Whole days until the gap clears, for a caller that wants to reschedule. */
      retry_in_days?: number;
      allowance: number | null;
    };

/**
 * 8.4 — the governor.
 *
 * A response rate under 25% over 30 days lowers the ceiling **by one tier**, and
 * the estimate says a friendly note goes with it (that is the caller's job; this
 * only decides the number). `as_relevant` → 10 → 5, and never below the floor.
 *
 * Returns the stated allowance unchanged when the sample is too small, which is
 * the case that matters most in an early pilot: almost nobody will have four
 * requests behind them for weeks.
 */
export function effectiveAllowance(
  stated: Allowance,
  history: OutreachHistory,
): { allowance: number | null; lowered: boolean } {
  const asked = history.sent_last_30_days;
  if (asked < RESPONSE_MIN_SAMPLE) {
    return { allowance: statedCeiling(stated), lowered: false };
  }
  const rate = history.responded_last_30_days / asked;
  if (rate >= RESPONSE_RATE_FLOOR) {
    return { allowance: statedCeiling(stated), lowered: false };
  }

  /* One tier down. `as_relevant` has no number, so its tier below is 10. */
  const ceiling = statedCeiling(stated);
  if (ceiling === null) return { allowance: 10, lowered: true };
  if (ceiling > 10) return { allowance: 10, lowered: true };
  if (ceiling > ALLOWANCE_FLOOR) return { allowance: ALLOWANCE_FLOOR, lowered: true };
  /* Already at the floor: the governor has nothing left to take, and taking the
     floor would withdraw the community access they earned. */
  return { allowance: ALLOWANCE_FLOOR, lowered: false };
}

function statedCeiling(stated: Allowance): number | null {
  if (stated.allowance_mode === "as_relevant") return null;
  return stated.monthly_contact_allowance ?? ALLOWANCE_FLOOR;
}

/**
 * May Pando send this person a proactive message right now?
 *
 * The order is deliberate and matches invariant 5's own list. **The gap is
 * checked before the cap** so that somebody with budget left is still spaced out
 * — that is the whole point of the strategy's sentence about five a month
 * describing a ceiling "rather than a burst".
 *
 * Opt-out and quiet hours are **not** here: they run earlier, in the send layer,
 * and they apply to messages this function never sees.
 */
export function decideOutreach(
  kind: OutreachKind,
  stated: Allowance,
  history: OutreachHistory,
  now: Date = new Date(),
): OutreachDecision {
  const { allowance } = effectiveAllowance(stated, history);

  /* v3.2 §10's two ping rules, checked first because they are the narrowest. */
  if (kind === "ping") {
    if (history.blast_today) {
      return { ok: false, reason: "ping_same_day_as_blast", allowance };
    }
    if (history.pings_this_month >= PINGS_PER_MONTH) {
      return { ok: false, reason: "ping_this_month", allowance };
    }
  }

  const since = daysSince(history.last_outreach_at, now);
  if (since !== null && since < OUTREACH_GAP_DAYS) {
    return {
      ok: false,
      reason: "too_soon",
      retry_in_days: OUTREACH_GAP_DAYS - since,
      allowance,
    };
  }

  /**
   * `as_relevant` has no fixed ceiling — the parent's own words are "ask me
   * anytime it's genuinely relevant". The 48-hour gap still applies to them,
   * which is what stops "no ceiling" from meaning "no protection".
   */
  if (allowance !== null && history.sent_last_30_days >= allowance) {
    return { ok: false, reason: "monthly_cap", allowance };
  }

  return { ok: true, allowance };
}

/** Whole days elapsed, or null when there is no previous message. */
function daysSince(at: Date | string | null, now: Date): number | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}
