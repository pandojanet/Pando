import type { DemandSensitivity } from "./demand";

/**
 * M5.8 — what holds an answer back from being sent.
 *
 * The estimate names three cases: "sensitive, caregiver-related, or
 * low-confidence answers" wait in an admin queue "instead of sending them
 * automatically". The strategy is stricter for the pilot, and deliberately so —
 * §19: *"for the first months every contribution is read by a person, because
 * that is how we learn what 'good' looks like well enough to safely automate any
 * of it."*
 *
 * So there are two layers here and they are not the same thing:
 *
 *  - **`PILOT_HOLD_EVERYTHING`** is the pilot's blanket rule. It is a named
 *    constant rather than a hard-coded `true` because it is meant to come off,
 *    and the day it does the specific rules below must already be right.
 *  - **The specific rules** are what remain when it does. They are written and
 *    tested now, while there is time to get them wrong cheaply.
 *
 * ## Why the reason is carried, not just the verdict
 *
 * Because "why is this waiting" is the reviewer's first question, and a queue
 * that cannot answer it is a queue that gets worked in arrival order. It is also
 * how the blanket rule stays honest: an answer held only because everything is
 * held reads differently from one held because it names a caregiver, and the
 * screen should not pretend otherwise.
 */

export type HoldReason =
  /** Nothing specific — the pilot reads everything. */
  | "pilot_review_all"
  /** Health, legal, safety, or a claim about a named person. */
  | "sensitive"
  /** Mentions a caregiver. Every caregiver path keeps human eyes permanently. */
  | "caregiver"
  /** Built only from public information — it says so, and that is worth checking. */
  | "public_only"
  /** Thin: one record, or none. */
  | "low_evidence"
  /** 5.7 asked for a person outright. */
  | "generator_asked";

/**
 * The pilot reads everything.
 *
 * Turning this off is a product decision, not a tuning change: it is the moment
 * Pando starts answering parents without anybody having read the answer. §19
 * calls that safe only once "the knowledge base grows" enough that "ordinary
 * recommendations from contributors with a track record can pass automatically" —
 * and even then, "anything sensitive, anything about a named person, and
 * everything caregiver-related keeps human eyes permanently".
 */
export const PILOT_HOLD_EVERYTHING = true;

export interface RoutingInput {
  /** From `classifyDemand` — rule-based, and it may only ever escalate. */
  sensitivity: DemandSensitivity;
  /** The answer mentions or is about a caregiver. */
  caregiver_related: boolean;
  /** From `composeAnswer`. */
  public_only: boolean;
  /** How many records the answer used. */
  used: number;
  next_step: "none" | "offer_blast" | "human_review";
}

export interface RoutingVerdict {
  hold: boolean;
  reason: HoldReason;
  /**
   * True when this would be held even with the blanket pilot rule off.
   *
   * The distinction the reviewer needs: an answer waiting only because everything
   * waits is a different thing from one that will always wait.
   */
  permanent: boolean;
}

/**
 * Should a person read this before it goes out?
 *
 * The specific reasons are checked **before** the blanket one, so the answer to
 * "why is this here" is the most specific true thing rather than "because
 * everything is". Order within them is by how much a mistake costs.
 */
export function routeAnswer(input: RoutingInput): RoutingVerdict {
  /* Health, legal, safety, and any claim about a named person. `classifyDemand`
     decides this from rules and its keyword scan may only escalate — so by the
     time it says sensitive, it is. */
  if (input.sensitivity !== "ordinary") {
    return { hold: true, reason: "sensitive", permanent: true };
  }

  /**
   * Caregivers keep human eyes permanently — §19 says so in as many words, and
   * invariants 1, 2, 12 and 13 are all about this one subject. An answer that
   * mentions a caregiver is the highest-stakes sentence Pando sends.
   */
  if (input.caregiver_related) {
    return { hold: true, reason: "caregiver", permanent: true };
  }

  if (input.next_step === "human_review") {
    return { hold: true, reason: "generator_asked", permanent: true };
  }

  /* Public-only and thin answers are the estimate's "low-confidence" case. They
     are not permanent holds: as the base fills, an answer built on four parents
     is exactly the ordinary recommendation §19 says can eventually pass. */
  if (input.public_only) {
    return { hold: true, reason: "public_only", permanent: false };
  }
  if (input.used < 2) {
    return { hold: true, reason: "low_evidence", permanent: false };
  }

  if (PILOT_HOLD_EVERYTHING) {
    return { hold: true, reason: "pilot_review_all", permanent: false };
  }

  return { hold: false, reason: "pilot_review_all", permanent: false };
}

/**
 * Does this answer talk about a caregiver?
 *
 * A word list, and deliberately generous: the cost of a false positive is one
 * extra answer read by a person, while the cost of a miss is a caregiver
 * mentioned to a parent with nobody having checked. That asymmetry is the whole
 * argument for scanning the text as well as trusting the retrieval layer to have
 * said so.
 */
const CAREGIVER_WORDS =
  /\b(nanny|nannies|sitter|babysitter|au ?pair|childminder|night nurse|newborn care|nanny share|caregiver)\b/i;

export function mentionsCaregiver(text: string): boolean {
  return CAREGIVER_WORDS.test(text);
}

/**
 * What Pando says while a person reads the answer.
 *
 * ## Why this exists at all
 *
 * `PILOT_HOLD_EVERYTHING` means every composed answer waits for a human, and
 * until now nothing told the parent that. They texted a question and got
 * **silence** — for as long as it took somebody to open `/admin/answers`. That
 * is indistinguishable from a dead number, on the one message that is a
 * stranger's entire first impression of Pando (5.9).
 *
 * ## Two rules in the wording
 *
 * **It names a person, not a system.** The wait is a person reading, which is
 * the product's own promise (§19), so saying so is both true and the reason a
 * parent should be willing to wait at all.
 *
 * **It promises no time.** Nobody can keep one during a pilot worked by hand,
 * and a broken "shortly" costs more than an unspecified wait.
 *
 * ## And it carries the clarifying question when there is one
 *
 * 5.4's question had a parser and a writer and **nothing that ever sent it**, so
 * `pendingClarification` could never find one. This is where it goes: one
 * outbound per inbound, and the acknowledgement is the natural place to ask the
 * one thing that makes the *next* answer better. Still one question at a time —
 * `nextQuestion` returns at most one, and the caller does not ask again while an
 * earlier one is still unanswered.
 *
 * ⚠ **New user-facing copy, on the list for the client.** Deliberately not in
 * `sms-templates.ts`: that file is registered A2P samples where a reword is a
 * compliance event, and this is conversational — the same call `CLARIFYING_COPY`
 * already makes, for the same reason.
 *
 * Written in GSM-7 on purpose (no em dash, no curly quotes): one character
 * outside it cuts the segment budget from 160 to 70, so the punctuation this
 * house style prefers would make a two-line reply cost three segments.
 */
export const HELD_ACK =
  "Got it. Someone at Pando is putting an answer together from local parents, and will text it to you.";

export function heldReply(clarifying: string | null): string {
  return clarifying ? `${HELD_ACK} ${clarifying}` : HELD_ACK;
}
