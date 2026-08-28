import type { Submission } from "./types";

/**
 * Estimate 1.8's confirm-back: *"asks a short confirm-back question when
 * confidence is low or an answer is vague or spans several fields"*.
 *
 * ## Why this is not a model call
 *
 * The obvious reading is "score the card, then ask if the score is low". It does
 * not work here, for two reasons that are both about *when*:
 *
 *  - Extraction runs **after** the save response and deliberately does not block
 *    the parent (CLAUDE.md, 6 Aug). By the time a score exists, the chat has
 *    moved on — and making the save wait on a model round trip to ask a follow-up
 *    is a worse trade than asking a slightly less well-aimed question instantly.
 *  - The trigger she names is "low confidence **or an answer is vague**", and
 *    vagueness is the half that does not need a model. "It's good" is thin by
 *    length and by the absence of anything specific; that is measurable here, for
 *    free, before the card is even sent.
 *
 * So this is the vague half, asked at the moment it can still be answered. The
 * low-confidence half stays where it already works: `confidence < 0.6` puts the
 * card in the admin's read queue, which is the backstop for text this cannot
 * judge.
 *
 * ## What it will not do
 *
 * **Never twice for one card.** A parent who answered and is still under the bar
 * has said what they have to say; asking again reads as not listening.
 *
 * **Never on a caregiver card.** Its free text *is* the restricted note
 * (invariant 12), and a prompt to say more about a named person is the opposite
 * of what that invariant is for.
 *
 * **Never when the field was skipped.** Skipping is an answer. Re-asking a
 * question the parent declined is the one thing that makes a flow feel like it is
 * arguing.
 */

/**
 * The free-text fields worth a second look, in the order they are asked about.
 *
 * **These are the chat's step ids, not the database's column names**, and the
 * distinction cost a working feature: the first version listed `tip_text`, which
 * is what `share_contributions` calls the column, while the script step is `tip`
 * (`repo/cards.ts` maps one to the other). So nothing ever matched, the
 * confirm-back never fired, and the unit test passed — because it had been written
 * against the same wrong names.
 *
 * `what_makes_special` is the caregiver script's equivalent and is listed for
 * completeness only: a caregiver card returns early, because its free text *is*
 * the restricted note (invariant 12).
 */
const TEXT_FIELDS = [
  "what_makes_it_great",
  "tip",
  "caveat",
  "who_for",
  "who_not_for",
] as const;

/**
 * Below this, a sentence carries almost nothing another parent could act on.
 *
 * Twelve characters, not a word count: "good" and "it's fine" and "great!" are
 * all under it, and any real recommendation clears it easily. Deliberately
 * generous — the cost of asking unnecessarily is one extra tap, and the cost of
 * not asking is a card that reaches an admin thin.
 */
const THIN = 12;

/**
 * Words that fill a sentence without saying anything. Only counted *with* the
 * length test, never alone: "we loved it" is short and vague, while "we loved it
 * because the teacher remembers every child's name" is neither.
 */
const EMPTY_PRAISE =
  /^(it'?s |we |they |i )?(really |very |so )?(good|great|nice|fine|ok|okay|lovely|amazing|the best|fun|loved it|liked it|recommend)[.!]?$/i;

export interface ConfirmBack {
  /** Which field the question is about. */
  field: string;
  /** What to ask. One sentence, and it names what would make the answer useful. */
  question: string;
}

const QUESTIONS: Record<string, string> = {
  tip:
    "Can you say a bit more? The tips parents act on are the specific ones — a name, a time, a number.",
  what_makes_it_great:
    "One more thing and this becomes really useful — what would you tell a friend who was deciding? The teacher, the room, the price, the thing you didn't expect.",
  caveat:
    "Anything worth knowing before someone else tries it? Parking, the age it stops working, a cost that isn't obvious.",
  who_for: "Who would you send there? An age, a temperament, a situation.",
  who_not_for: "And who would you steer away from it?",
};

/**
 * The one question worth asking about this card, or null.
 *
 * Returns the **first** thin field rather than all of them: this is one extra
 * turn in a two-minute flow, and a card that needs three follow-ups needs a human
 * rather than a chatbot.
 */
export function confirmBackFor(submission: Submission): ConfirmBack | null {
  /* Invariant 12: a caregiver's free text is the restricted note. */
  if (submission.kind === "caregiver") return null;

  const fields = submission.fields as Record<string, unknown>;

  /* Already asked once for this card. Set by the caller when it asks. */
  if (fields.__confirm_back_asked) return null;

  for (const field of TEXT_FIELDS) {
    const raw = fields[field];
    /* Absent means skipped, and skipping is an answer. Only a field the parent
       actually wrote in is worth coming back to. */
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value === "") continue;

    if (value.length < THIN || EMPTY_PRAISE.test(value)) {
      return { field, question: QUESTIONS[field] ?? QUESTIONS.what_makes_it_great };
    }
  }

  return null;
}
