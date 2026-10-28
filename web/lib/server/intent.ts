import "server-only";
import { MODELS } from "@/lib/models";

import Anthropic from "@anthropic-ai/sdk";
import { tracedFetch, span } from "@/lib/server/trace";
import {
  INTENTS,
  applyThreshold,
  type IntentContext,
  type IntentResult,
} from "@/lib/intent";

/**
 * M5.3 — the classifier.
 *
 * The second file in the app that talks to an AI provider, and it follows the
 * first (`lib/server/extract.ts`) deliberately: same model, same structured
 * output, same honesty rule — **an unset `ANTHROPIC_API_KEY` produces no
 * classification rather than a fake one**, and the deterministic fallback in
 * `lib/intent.ts` answers instead.
 *
 * ## What it is not allowed to do
 *
 * **It never sees a compliance keyword.** STOP, START, HELP and PASS are handled
 * in the webhook before this is reached — 5.3's own requirement, and the reason
 * is that a classifier is probabilistic while a compliance keyword cannot be.
 *
 * **It cannot clear a message, only raise it.** Which *class* of sensitive a
 * question is — high-stakes, peer support, an allegation — remains
 * `classifyDemand`'s job (11 Aug), rule-based, where a keyword scan may only
 * ever escalate. What this model now also returns is a single `sensitive`
 * boolean, and the caller takes whichever of the two readings is higher, so the
 * model can add caution and can never remove it.
 *
 * ⚠ **Why that field was added on 8 Sep**, and it is the safety half of turning
 * `PILOT_HOLD_EVERYTHING` off. While every answer waited for a person,
 * `classifyDemand` missing something cost nothing. It is now the thing standing
 * between a health question and an unread automatic reply — and measured against
 * real phrasings it does not stand: *"my 4 year old keeps having nosebleeds, is
 * that normal?"* returns `ordinary`, because `HIGH_STAKES_TERMS` carries no
 * medical vocabulary whatsoever. That list was written as a net **under a
 * category tap**, and an SMS has no tap. One boolean on a request already being
 * made is the cheapest honest cover for the gap.
 *
 * **It never writes.** It returns a reading; the caller decides.
 */

/* Haiku 5.5, thinking off (12 Oct, the developer: "Haiku 5.5 everywhere"; was
   4.5): one label per message, on the path of every question asked. */
const MODEL = MODELS.fast;

/**
 * Per attempt, in milliseconds (28 Oct audit). Every other model call here has a
 * bound; this one, the first on the path of every inbound text, had the SDK's
 * ten minutes, so a stalled request left a parent with no reply at all. A timeout
 * lands in the `catch` below like any failure and routes the text to a person.
 */
const INTENT_TIMEOUT_MS = 15_000;

const SYSTEM = [
  "You classify a single SMS a parent sent to a local parenting recommendation service.",
  "Answer only what the person wants. Do not answer their question, do not judge",
  "the message, and do not infer anything about the person.",
  "",
  "The intents:",
  "- ask_recommendation: looking for a class, camp, activity, place, product, a doctor, dentist or",
  "  other specialist, or general local advice",
  "- ask_caregiver: looking for, or asking about finding, a nanny, sitter, night nurse, au pair or",
  "  nanny share",
  "- deep_dive: wants options compared, ranked or researched in depth rather than a quick list —",
  "  of what the service just sent ('compare these', 'deep research on these top 5', 'which of",
  "  them is best for us, in detail', 'DEEP') or of a subject they name ('a detailed comparison",
  "  of preschools in Altadena'). A plain question that only mentions 'best' or 'top 5' is",
  "  ask_recommendation; deep_dive is asking for the in-depth comparison itself.",
  "- answer_blast: replying to a question the service asked them",
  "- contribute: volunteering something unprompted — a place they liked, a tip, or a person of their",
  "  own they want to recommend or add, including their own nanny or sitter ('I want to add our nanny",
  "  Marisol', 'our sitter is amazing, can I recommend her?'). Telling about their own caregiver is",
  "  contribute; looking for one is ask_caregiver.",
  "- settings: changing how often they are contacted, or what the service knows",
  "- chitchat: thanks, a greeting, a wrong number, nothing to act on",
  "- unclear: you cannot tell",
  "",
  "Set sensitive when the message touches health, medical symptoms, medication,",
  "legal questions, a child's safety, or makes a claim about a named person.",
  "Asking WHICH doctor, dentist or specialist parents like ('a good pediatrician near us?',",
  "'who do you use for a dentist?') is a recommendation, not sensitive by itself. It IS",
  "sensitive once it describes a symptom, a condition, an injury or medication ('my son keeps",
  "getting ear infections, which ENT?').",
  "A named person is a PERSON (a sitter, a teacher, a coach). A business, class, camp or school",
  "named after someone ('Tom Sawyer Camps', 'Little Maestros', 'Dr. Seuss Library') is a place,",
  "and asking whether a place is good ('Is Tom Sawyer Camps any good?') is a recommendation,",
  "not sensitive.",
  "⚠ When you are unsure, set it. A sensitive message is read by a person before",
  "anything is sent, so a false positive costs one extra reading and a miss sends",
  "an unread answer about a child's health. The two are not comparable.",
  "",
  "For deep_dive, set subject: what to compare, as one standalone request a search could",
  "use, in plain words — e.g. 'swim schools for a 4 year old in Altadena'. Resolve 'these',",
  "'them', 'those schools' from the previous question. Leave out the request wording itself",
  "('I want to make a comparison of'). If you cannot tell what it is about, leave it empty.",
  "For every other intent leave subject empty.",
  "",
  "Use unclear whenever you are not sure. It is routed to a person, which is the",
  "correct outcome for an ambiguous message — a confident wrong guess is worse",
  "than admitting you cannot tell.",
].join("\n");

/**
 * ⚠ **`confidence` carries no `minimum`/`maximum`, and that is not an
 * oversight — it is a bug fix.**
 *
 * It had both, and the API refuses them:
 *
 *     output_config.format.schema: For 'number' type, properties maximum,
 *     minimum are not supported
 *
 * So **every** call was a 400 and the model half of 5.3 had never run once. The
 * `catch` below turned each one into the rule-based fallback, which is a
 * legitimate outcome, so nothing anywhere looked wrong: `test:intent` exercises
 * the pure fallback and never the request. The same shape as `bands` and
 * `area_slug` — written, reviewed, and silently never executed — and it is worth
 * knowing that the difference it hides is real: the fallback mapped **any**
 * caregiver word to `ask_caregiver`. (12 Oct: measured, neither model read
 * "I want to add our nanny Marisol" as `contribute` either — 4.5 said
 * `settings`, 5.5 `ask_caregiver` — until the intents above said that telling
 * about their own caregiver is a contribution, and the fallback learnt
 * `OFFER_SHAPE`.)
 *
 * The range is not lost. `applyThreshold` compares against
 * `INTENT_CONFIDENCE_FLOOR` and falls back on anything under it, so a value
 * outside 0–1 cannot promote a reading — and a schema the API rejects enforces
 * nothing at all.
 */
const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: INTENTS },
    confidence: { type: "number" },
    sensitive: {
      type: "boolean",
      description:
        "Health, legal, safety, or a claim about a named person. When unsure, true.",
    },
    reason: {
      type: "string",
      maxLength: 200,
      description: "One short clause. Never quote the message.",
    },
    subject: {
      type: "string",
      description: "deep_dive only: what to compare, as a standalone request. Otherwise empty.",
    },
  },
  required: ["intent", "confidence", "reason", "sensitive", "subject"],
  additionalProperties: false,
} as const;

export function isIntentConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Read one inbound message.
 *
 * `recent` is the last few messages for context, as the estimate asks. It is
 * capped hard: three turns is enough to tell a reply from a new question, and
 * more would start to be a transcript sent to a model for no added accuracy.
 */
async function classifyIntentUntraced(input: {
  text: string;
  context: IntentContext;
  recent?: string[];
  /**
   * The question Pando last answered for them (26 Oct), so "compare these" and
   * "deep research on these top 5" have something to point at. The parent's
   * own words, sent to the same model already reading this message.
   */
  lastQuestion?: string | null;
  /**
   * What Pando's last message asked them, when it is still waiting for the
   * answer — "How old are your kids?" (26 Oct). A reply that answers it reads
   * `answer_blast`; a new request does not, whatever number is in it.
   */
  askedThem?: string | null;
  /**
   * Another parent's question the service sent them to help with — an open
   * Network Ask (26 Oct). A suggestion for it reads `answer_blast` even put as
   * a question ("have you looked at the YMCA camp?"); a request for their own
   * family on something else is that request.
   */
  othersQuestion?: string | null;
}): Promise<IntentResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    return {
      intent: "unclear",
      confidence: 0,
      source: "fallback",
      reason: "empty message",
      sensitive: false,
    };
  }

  /* Context first, and without a round trip: if Pando asked them something and
     is waiting, the records already know what this is. Spending a model call to
     be told the same thing would be slower and no more certain. */
  if (input.context.awaiting_blast_reply) {
    return applyThreshold(null, text, input.context);
  }

  if (!isIntentConfigured()) {
    return applyThreshold(null, text, input.context);
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: tracedFetch("intent") });
    const response = await anthropic.messages.create({
      model: MODEL,
      thinking: { type: "disabled" },
      max_tokens: 256,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            input.lastQuestion
              ? `Their previous question, which the service already answered with a list:\n${input.lastQuestion.slice(0, 500)}`
              : null,
            input.askedThem
              ? `The service's last message asked them: "${input.askedThem.slice(0, 300)}". If this message answers that, the intent is answer_blast; if it is a new request instead, classify the request.`
              : null,
            input.othersQuestion
              ? `The service asked them to help ANOTHER parent, who asked: "${input.othersQuestion.slice(0, 300)}". A message suggesting, naming or asking about a place or option for that parent is answer_blast, even when it is put as a question ("have you tried X?", "maybe the 9am?"). Only a request for their OWN family about something else is a new request - classify that request.`
              : null,
            input.recent && input.recent.length > 0
              ? `Earlier in this conversation:\n${input.recent.slice(-3).join("\n")}`
              : null,
            "",
            "The message to classify:",
            text.slice(0, 1000),
          ]
            .filter((line) => line !== null)
            .join("\n"),
        },
      ],
    });

    /**
     * A refusal is a real outcome, not an error. It means the text tripped a
     * safety classifier — which is itself a reason for a person to look, so the
     * fallback routes it exactly where it should go.
     */
    if (response.stop_reason === "refusal") {
      console.warn("[intent] declined by the model; falling back");
      return applyThreshold(null, text, input.context);
    }

    const block = response.content.find((c) => c.type === "text");
    const parsed = block && "text" in block ? safeParse(block.text) : null;
    return applyThreshold(parsed, text, input.context);
  } catch (err) {
    /**
     * Counts and enums only — never the message (invariant 7), and never the
     * SDK's own `message` either: it can carry the request body, which is the
     * parent's text. That is the `withDb` leak in a different library.
     *
     * ⚠ **The status is logged because the class name is not usable.** This runs
     * from the standalone bundle, where `err.constructor.name` is minified — the
     * 400 above was reported for weeks as `{ error: 'a' }`, which is why nobody
     * could see that every call was failing. A status is a number and survives.
     */
    const status = (err as { status?: unknown })?.status;
    console.error("[intent] classification failed", {
      status: typeof status === "number" ? status : null,
    }, { timeout: INTENT_TIMEOUT_MS });
    return applyThreshold(null, text, input.context);
  }
}

function safeParse(
  raw: string,
): {
  intent: string;
  confidence: number;
  reason?: string;
  sensitive?: boolean;
  subject?: string | null;
} | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.intent !== "string" || typeof value.confidence !== "number") {
      return null;
    }
    return {
      intent: value.intent,
      confidence: value.confidence,
      reason: typeof value.reason === "string" ? value.reason : undefined,
      /**
       * ⚠⚠ **This read `false` unconditionally until 14 Sep, and that discarded
       * the whole of the 8 Sep safety change.**
       *
       * The schema asks for `sensitive`, the prompt spends four lines telling
       * the model to set it when unsure, and `applyThreshold` is written to take
       * whichever of the two readings is higher — and the value never got that
       * far, because it was dropped here on the way past. So the first rung of
       * `routeAnswer`'s ladder rested on `classifyDemand` alone, whose word list
       * carries **no medical vocabulary at all**: *"my 4 year old keeps having
       * nosebleeds, is that normal?"* comes back `ordinary`, and with
       * `PILOT_HOLD_EVERYTHING` off that answer sends itself.
       *
       * Invisible for two reasons worth knowing. The model half has been failing
       * on a credit balance since 9 Sep, so the fallback ran every time and this
       * line was never reached; and the only place the flag surfaces is a
       * boolean in one log line, which reads the same whether the model said so
       * or nobody asked.
       */
      sensitive: value.sensitive === true,
      subject: typeof value.subject === "string" ? value.subject : null,
    };
  } catch {
    return null;
  }
}

/** classifyIntent, as one step of the trace (27 Oct, lib/server/trace.ts). */
export async function classifyIntent(input: Parameters<typeof classifyIntentUntraced>[0]): ReturnType<typeof classifyIntentUntraced> {
  return span("classify", () => classifyIntentUntraced(input), (r) => ({ intent: r.intent, source: r.source, sensitive: r.sensitive, confidence: r.confidence }));
}
