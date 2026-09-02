import "server-only";

import Anthropic from "@anthropic-ai/sdk";
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
 * **It never decides anything sensitive.** Whether a question is high-stakes,
 * peer support or an allegation is `classifyDemand`'s job (11 Aug), it is rule-
 * based, and a keyword scan there may only ever *escalate*. This model answers
 * one narrow question — what does this person want — and a wrong answer routes a
 * message to the wrong queue rather than mislabelling a safety question.
 *
 * **It never writes.** It returns a reading; the caller decides.
 */

const MODEL = "claude-haiku-4-5";

const SYSTEM = [
  "You classify a single SMS a parent sent to a local parenting recommendation service.",
  "Answer only what the person wants. Do not answer their question, do not judge",
  "the message, and do not infer anything about the person.",
  "",
  "The intents:",
  "- ask_recommendation: looking for a class, camp, activity, place or general local advice",
  "- ask_caregiver: specifically about a nanny, sitter, night nurse, au pair or nanny share",
  "- answer_blast: replying to a question the service asked them",
  "- contribute: volunteering something unprompted — a place they liked, a tip",
  "- settings: changing how often they are contacted, or what the service knows",
  "- chitchat: thanks, a greeting, a wrong number, nothing to act on",
  "- unclear: you cannot tell",
  "",
  "Use unclear whenever you are not sure. It is routed to a person, which is the",
  "correct outcome for an ambiguous message — a confident wrong guess is worse",
  "than admitting you cannot tell.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: INTENTS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: {
      type: "string",
      maxLength: 200,
      description: "One short clause. Never quote the message.",
    },
  },
  required: ["intent", "confidence", "reason"],
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
export async function classifyIntent(input: {
  text: string;
  context: IntentContext;
  recent?: string[];
}): Promise<IntentResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    return {
      intent: "unclear",
      confidence: 0,
      source: "fallback",
      reason: "empty message",
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
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
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
    /* Counts and enums only — never the message (invariant 7). */
    console.error("[intent] classification failed", {
      error: err instanceof Error ? err.constructor.name : "unknown",
    });
    return applyThreshold(null, text, input.context);
  }
}

function safeParse(
  raw: string,
): { intent: string; confidence: number; reason?: string } | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.intent !== "string" || typeof value.confidence !== "number") {
      return null;
    }
    return {
      intent: value.intent,
      confidence: value.confidence,
      reason: typeof value.reason === "string" ? value.reason : undefined,
    };
  } catch {
    return null;
  }
}
