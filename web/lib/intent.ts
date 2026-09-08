/**
 * M5.3 — what an inbound message is asking for.
 *
 * Two halves, and this is the one that needs no model: the intents themselves,
 * and the **deterministic fallback** the estimate asks for ("a confidence
 * threshold and a sensible fallback when unsure"). `lib/server/intent.ts` adds
 * the classifier on top.
 *
 * ## Why the fallback is a real answer rather than an error
 *
 * Three situations produce one: the model is unconfigured, the model is unsure,
 * and the model declined. In all three a parent has texted a phone number and is
 * waiting, so "we could not classify that" is not an outcome the product can
 * have. The fallback is deliberately dull — it routes to a human or to the
 * safest reading — and that is the point: it must never be the *interesting*
 * path, because it is the one that runs when everything else has failed.
 *
 * ## What never reaches here
 *
 * Keywords. STOP, START, HELP and PASS are handled in the webhook before this is
 * called, which is 5.3's own requirement ("opt-out keywords are handled before
 * this step and never reach the AI") and 12.3's precedence. A classifier is
 * probabilistic; a compliance keyword cannot be.
 */

export type Intent =
  /** Looking for a class, camp, place, sitter — the ordinary case. */
  | "ask_recommendation"
  /** Specifically about a caregiver: nanny, sitter, night nurse, nanny share. */
  | "ask_caregiver"
  /** A reply to a Network Ask Pando sent them. */
  | "answer_blast"
  /** Offering something unprompted — a place they loved, a tip. */
  | "contribute"
  /** Changing how often Pando may ask, or what it knows about them. */
  | "settings"
  /** Not a question about local life: thanks, a greeting, a wrong number. */
  | "chitchat"
  /**
   * Nobody should guess. Routed to a person.
   *
   * Distinct from `chitchat`: that is a confident reading of a harmless message,
   * while this is the absence of a reading. Collapsing them would make every
   * failure look like small talk and quietly drop questions on the floor.
   */
  | "unclear";

export const INTENTS: Intent[] = [
  "ask_recommendation",
  "ask_caregiver",
  "answer_blast",
  "contribute",
  "settings",
  "chitchat",
  "unclear",
];

/**
 * Below this, the model's answer is not used.
 *
 * 0.6 is the same threshold the extraction pass and the admin's low-confidence
 * filter already use, and keeping it identical is worth more than tuning it
 * separately: an admin who has learned what "low confidence" means here should
 * not have to learn a second number.
 */
export const INTENT_CONFIDENCE_FLOOR = 0.6;

export interface IntentContext {
  /**
   * They were asked something and have not answered or passed.
   *
   * This is the single strongest signal there is, and it comes from Pando's own
   * records rather than from the words: a person Pando texted an hour ago who
   * writes back is answering, whatever the sentence looks like.
   */
  awaiting_blast_reply: boolean;
  /** Whether Pando knows them at all — a cold inbound is 5.9's subject. */
  known_person: boolean;
}

export interface IntentResult {
  intent: Intent;
  confidence: number;
  /** Where the answer came from, so a wrong one can be traced. */
  source: "context" | "model" | "fallback";
  /** One line, for the log and the admin. Never the message itself. */
  reason: string;
  /**
   * The message reads as health, legal, safety or a claim about a named
   * person.
   *
   * ⚠ **This is an escalation signal and never a clearance.** `false` means
   * "the model did not say so", not "checked and safe": the rule-based scan in
   * `classifyDemand` still runs and can raise the sensitivity on its own, and
   * the caller takes whichever of the two is higher.
   *
   * It exists because turning `PILOT_HOLD_EVERYTHING` off (8 Sep) made
   * `classifyDemand` the only thing between a health question and an
   * unread automatic answer — and measured against real phrasings it is not
   * enough on its own: *"my 4 year old keeps having nosebleeds, is that
   * normal?"* came back `ordinary`, because that list carries no medical
   * vocabulary at all. It was written as a safety net **on top of a category
   * tap**, and over SMS there is no tap.
   *
   * Free: the model is already reading this message for its intent, so this
   * is one more field on a request that was being made anyway.
   */
  sensitive: boolean;
}

const CAREGIVER_WORDS =
  /\b(nanny|nannies|sitter|babysitter|au ?pair|childminder|night nurse|newborn care|nanny share|childcare|daycare provider)\b/i;

const SETTINGS_WORDS =
  /\b(unsubscribe me|fewer|less often|too many|stop asking|blast settings|settings|preferences|my profile|update my)\b/i;

const QUESTION_SHAPE =
  /\?|\b(anyone know|does anyone|looking for|any recommendations?|can anyone|who do you|where can|is there a|any good)\b/i;

/**
 * The answer when no model is available, or when the model was not sure enough.
 *
 * Rules only, in the order that matters most.
 *
 * **Context beats words, always.** If Pando asked this person something and is
 * waiting, a reply is an answer — even one that reads like a question, because
 * "the 9am or the 10:30?" is a perfectly ordinary way to answer.
 *
 * After that it reads shape rather than meaning, and it is honest about how
 * little that is: a caregiver word, a settings phrase, a question mark. Anything
 * else from a person Pando does not know is `unclear` and goes to a human —
 * guessing at a stranger's first message is exactly where a wrong guess costs
 * the most.
 */
export function fallbackIntent(text: string, context: IntentContext): IntentResult {
  const body = text.trim();

  if (context.awaiting_blast_reply) {
    return {
      intent: "answer_blast",
      confidence: 1,
      source: "context",
      reason: "they were asked something and have not answered or passed",
      sensitive: false,
    };
  }

  if (CAREGIVER_WORDS.test(body)) {
    return {
      intent: "ask_caregiver",
      confidence: 0.7,
      source: "fallback",
      reason: "names a kind of care",
      sensitive: false,
    };
  }

  if (SETTINGS_WORDS.test(body)) {
    return {
      intent: "settings",
      confidence: 0.7,
      source: "fallback",
      reason: "asks to change how often Pando writes",
      sensitive: false,
    };
  }

  if (QUESTION_SHAPE.test(body)) {
    return {
      intent: "ask_recommendation",
      confidence: 0.65,
      source: "fallback",
      reason: "reads as a question",
      sensitive: false,
    };
  }

  /* A very short message from somebody Pando knows is usually a pleasantry; from
     a stranger it is the opening of a conversation nobody should guess at. */
  if (context.known_person && body.length <= 24) {
    return {
      intent: "chitchat",
      confidence: 0.6,
      source: "fallback",
      reason: "short message from a known contributor",
      sensitive: false,
    };
  }

  return {
    intent: "unclear",
    confidence: 0,
    source: "fallback",
    reason: "no confident reading — routed to a person",
    sensitive: false,
  };
}

/**
 * Apply the threshold to whatever the model said.
 *
 * Kept out of the server module so the rule is testable on its own, and so the
 * two ways of being unsure — a low score, and an intent the model invented —
 * fall to the same place.
 */
export function applyThreshold(
  model: {
    intent: string;
    confidence: number;
    reason?: string;
    /** See `IntentResult.sensitive` — an escalation signal, never a clearance. */
    sensitive?: boolean;
  } | null,
  text: string,
  context: IntentContext,
): IntentResult {
  if (!model) return fallbackIntent(text, context);

  /* Context still wins. A model that reads "yes please, the 9am" as a new
     question is wrong in a way the records can see and it cannot. */
  if (context.awaiting_blast_reply) {
    return {
      intent: "answer_blast",
      confidence: 1,
      source: "context",
      reason: "they were asked something and have not answered or passed",
      sensitive: false,
    };
  }

  const known = (INTENTS as string[]).includes(model.intent);
  if (!known || model.confidence < INTENT_CONFIDENCE_FLOOR) {
    /**
     * The reading is discarded; the **caution is not**.
     *
     * ⚠ This one line is the difference between a health question being read by
     * a person and being answered automatically, and getting it wrong is how it
     * behaved for its first hour. The floor is about *which intent* this is —
     * a low score there means the model could not tell a question from a
     * contribution, and the rules are better at that than a hesitant guess. It
     * says nothing about whether the message touches a child's health.
     *
     * Measured, which is the only reason it was caught: *"my 4 year old keeps
     * having nosebleeds, is that normal?"* comes back `sensitive: true` at
     * **confidence 0.35** — correctly unsure what the parent wants, correctly
     * certain it is medical. Dropping the whole result threw the flag away at
     * precisely the moment it mattered most, and the answer went out unread.
     *
     * So the flag survives the fallback. It can only ever escalate, so carrying
     * it forward can only ever hold something back.
     */
    const ruled = fallbackIntent(text, context);
    return model.sensitive === true ? { ...ruled, sensitive: true } : ruled;
  }

  return {
    intent: model.intent as Intent,
    confidence: model.confidence,
    source: "model",
    reason: model.reason?.slice(0, 200) ?? "",
    sensitive: model.sensitive === true,
  };
}
