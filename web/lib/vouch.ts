/**
 * M10.2 — confirming an existing recommendation.
 *
 * Pure, like every rule in Phase 2 that decides what enters the graph.
 *
 * ## The distinction this file exists for
 *
 * "A parent confirms an existing recommendation" is **two different acts**, and
 * conflating them inflates the strongest trust label Pando has.
 *
 * **A refresh** is the parent who already contributed the record saying it still
 * holds. That is what a freshness ping asks for (10.3). It updates
 * `last_confirmed_at` and nothing else: the same parent saying "still good" is
 * not a second parent, and counting it as one would turn one person's continued
 * enthusiasm into "Validated by multiple parents" — a label invariant 4 says
 * needs a real contributor behind every claim it makes.
 *
 * **A vouch** is a *different* parent saying they used it too. That is a second
 * firsthand contribution and it is exactly how something becomes validated —
 * `trust-labels.ts` counts firsthand contributions, not `shares.validated_count`,
 * so a vouch has to arrive as a contribution or the label never moves.
 *
 * The estimate writes 10.2 as one sentence ("increases its validation count and
 * refreshes its last confirmed date"), which reads as one act. It is not, and
 * the difference is invisible until somebody notices that a record with one
 * parent behind it is being advertised as validated by several.
 */

export type ConfirmKind = "refresh" | "vouch";

/**
 * Which act is this?
 *
 * The only input that matters is whether this person is already behind the
 * record. Not who asked, not how it arrived — a parent who was pinged about
 * their own record refreshes it, and a parent who was pinged about somebody
 * else's is vouching for it.
 */
export function confirmKindFor(input: {
  /** Does this person already have an approved contribution on the record? */
  already_contributed: boolean;
}): ConfirmKind {
  return input.already_contributed ? "refresh" : "vouch";
}

export type PingReply = "still_good" | "no_longer" | "unclear";

/**
 * Reading a reply to "is X still worth recommending?".
 *
 * **Exact on the whole message**, the rule every parser in this app follows
 * (`keywordOf`, `yesOrNo`, the clarifying parser) and for the sharpest version
 * of the reason: a "yes" here refreshes a record that other parents will be
 * given, and a "no" starts the withdrawal of a recommendation. Reading "no idea,
 * we moved away" as a withdrawal would retire a good record on the strength of
 * somebody having moved house.
 *
 * `unclear` is not a failure — it is a parent who wrote a sentence, and the
 * sentence goes to ordinary handling where a person can read it. What must not
 * happen is a guess, because both outcomes are silent and both are wrong in a
 * way nobody would notice.
 */
const STILL_GOOD = [
  "YES",
  "Y",
  "YEP",
  "YEAH",
  "YUP",
  "STILL GOOD",
  "STILL GREAT",
  "STILL WORTH IT",
];

const NO_LONGER = ["NO", "N", "NOPE", "NOT ANY MORE", "NOT ANYMORE", "NO LONGER"];

export function readPingReply(body: string): PingReply {
  const word = body.trim().toUpperCase().replace(/[.!,]+$/, "");
  if (STILL_GOOD.includes(word)) return "still_good";
  if (NO_LONGER.includes(word)) return "no_longer";
  return "unclear";
}

/**
 * What a confirmation does to the record.
 *
 * Returned as a decision rather than executed here, so the whole of it is
 * testable without a database — and so the two acts stay visibly different at
 * the point somebody reads this file.
 */
export interface ConfirmEffect {
  /** Move `last_confirmed_at` to now and reset the freshness state. */
  refresh_freshness: boolean;
  /**
   * Write a second firsthand contribution — the thing that eventually makes a
   * record "Validated by multiple parents".
   *
   * **It enters `pending_review`**, never approved. The client's answer of
   * 27 Aug is that a contribution enters the graph only after approval, and
   * 7.6 already applies it to a blast reply: this admin-free path must not be
   * the one exception, or a text message becomes a way to add a validation
   * nobody read.
   */
  add_contribution: boolean;
  /** A `freshness_confirmed` impact event (9.3), worth a third of a response. */
  record_impact: boolean;
  /**
   * Mark the record stale and raise a flag for a person.
   *
   * A withdrawal is not applied automatically. One parent's changed mind is
   * evidence, not a verdict — the record may have three other parents behind
   * it — so the honest response is the spec's own answer to old knowledge:
   * **mark it, never hide it**, and put it in front of somebody.
   */
  mark_stale: boolean;
  flag_reason: string | null;
}

export function effectOf(reply: PingReply, kind: ConfirmKind): ConfirmEffect {
  if (reply === "still_good") {
    return {
      refresh_freshness: true,
      /* A refresh adds no contribution: the same parent is not a second parent. */
      add_contribution: kind === "vouch",
      record_impact: true,
      mark_stale: false,
      flag_reason: null,
    };
  }
  if (reply === "no_longer") {
    return {
      /* Not refreshed — that is the whole content of the answer. */
      refresh_freshness: false,
      add_contribution: false,
      /**
       * A "no" is still a confirmation in the sense that matters to 9.4: the
       * contributor answered a question Pando asked, and telling us something
       * has gone downhill is more useful than telling us it has not. Paying only
       * for good news is how a freshness loop stops hearing bad news.
       */
      record_impact: true,
      mark_stale: true,
      flag_reason: "recommendation_withdrawn",
    };
  }
  return {
    refresh_freshness: false,
    add_contribution: false,
    record_impact: false,
    mark_stale: false,
    flag_reason: null,
  };
}
