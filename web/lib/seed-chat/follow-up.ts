import { isNothingToFlag, isThinAnswer } from "../contribution-quality";
import { isEmptyValue } from "./engine";
import { followUpMark } from "./scripts";
import type { FieldValue, Fields, ShareKind, Step } from "./types";

/**
 * The chat's follow-ups (9 Oct) — one question asked straight after a required
 * or descriptive answer that came back empty or too thin, and never twice for
 * the same question.
 *
 * It replaces estimate 1.8's confirm-back, and reverses three of its rules on
 * the developer's instruction (*"if someone didn't fill it in, or not enough,
 * the flow should follow up with these questions — but obviously not more
 * than once per question"*):
 *
 *  - **once per question, not once per card** — a card can carry several;
 *  - **a skipped descriptive question is followed up too** — it used to count a
 *    skip as an answer and never come back to it;
 *  - **straight after the answer, not at the end** — while the question is
 *    still on screen, and so the card is saved once, as it is, at the end.
 *
 * What it keeps: never on a caregiver card (invariant 12 — its free text *is*
 * the restricted note), and "nothing to flag" is an answer to the caveat.
 *
 * Which steps carry one is a property of the step (`followUp` in `scripts.ts`):
 * every descriptive text step except the name and the card's own last
 * question. The bar for "too thin" is `isThinAnswer`, the same one the quality
 * rule uses, so the chat and Founding cannot disagree about it.
 */

/** The canonical follow-up for this answer, or null when none is due. */
export function followUpFor(
  kind: ShareKind,
  step: Step,
  value: FieldValue,
  fields: Fields,
): string | null {
  if (kind === "caregiver") return null;
  const rule = step.followUp;
  if (!rule) return null;
  if (followUpMark(step.id) in fields) return null;

  if (isEmptyValue(value)) return rule.ask;
  if (rule.on !== "empty_or_thin" || typeof value !== "string") return null;

  const text = value.trim();
  if (step.id === "caveat" && isNothingToFlag(text)) return null;

  /* "Why" is also judged on what is left once the record's own name and the
     praise are taken out (5 Oct): "The Family Room is excellent" says nothing. */
  const why = step.id === "what_makes_it_great" || step.id === "what_didnt_work";
  const own = typeof fields.name === "string" ? fields.name : null;
  return isThinAnswer(text, { name: own, content: why }) ? rule.ask : null;
}

/**
 * The answer after the follow-up. Appended rather than replaced: what they wrote
 * first was still their answer, and a follow-up usually adds to it ("good" + "the
 * teacher is why") rather than correcting it. A skip leaves it as it was.
 */
export function mergeFollowUp(before: FieldValue, addition: string): FieldValue {
  const more = addition.trim();
  if (more === "") return before;
  const first = typeof before === "string" ? before.trim() : "";
  return first === "" ? more : `${first} — ${more}`;
}

/** Card fields as they are sent: the chat's own `__` markers stripped. */
export function withoutMarkers(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !key.startsWith("__")),
  ) as Fields;
}
