import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Estimate 1.8 — the extraction pass.
 *
 * **What it is not:** it does not pull structured facts out of prose. The
 * estimate's word "extraction" assumed a parent would type a paragraph; our
 * capture asks closed questions instead, so age bands, price band and unit,
 * recency, how much they went and whether they recommend it all arrive as taps
 * (R1–R11). There is nothing left to extract. What remains is the handful of
 * sentences a parent chose to write, and the useful question about those is
 * *which ones need a human first* — so this classifies and flags, and never
 * rewrites (invariant 8).
 *
 * The score fills the admin's "low confidence first" queue. It answers one
 * question only: **how much does this text add, on its own terms.**
 *
 * Three rules constrain what this file is allowed to see and say, and none of
 * them are negotiable:
 *
 *  - **It never reads a restricted note.** C6b and the reason behind a hesitant
 *    "would you hire them again" are never AI-summarized (invariant 12). The
 *    caller passes free text explicitly; there is no code path from
 *    `restricted_notes` to here, and adding one would be a product-level bug.
 *  - **It never returns text to publish.** Anything a parent wrote about a
 *    named person needs a human first (invariant 8), so the model's job is to
 *    *classify and flag*, never to rewrite a sentence for display. What it
 *    returns is facts and a verdict.
 *  - **Nothing it sees is logged.** Prompts and responses carry a parent's own
 *    words about their own family (invariant 7). Failures log the error class
 *    and nothing else.
 */

/**
 * Haiku 4.5 — $1/$5 per MTok against Opus 5's $5/$25, for a job that is one
 * bounded classification per card: score 0–1, one boolean, one sentence.
 *
 * Two constraints this model puts on the request below, both currently satisfied:
 * Haiku 4.5 **rejects `output_config.effort`**, and it has no adaptive thinking
 * (the older `{type: "enabled", budget_tokens}` form is all it takes). So neither
 * may be added here without changing the model back.
 */
const MODEL = "claude-haiku-4-5";

export interface ExtractionInput {
  kind: "activity" | "place" | "tip";
  place_name: string;
  /** Free text the parent typed. Never restricted-note content. */
  what_makes_it_great: string | null;
  caveat: string | null;
  tip_text: string | null;
  who_for: string | null;
  who_not_for: string | null;
  /**
   * What the parent already answered **as taps**, passed as context so the model
   * stops marking a note down for omitting facts the card holds elsewhere.
   *
   * Found by probing it: given a complete card, the reasons it gave for a low
   * score were "lacks information about cost", "lacks age ranges" — both of which
   * were captured, neither of which was in front of it. A note is not worse
   * because the price lives in a different column.
   */
  /**
   * The market's `focus` values, as `{ id, label }`, so the model chooses from
   * the taxonomy rather than inventing a word.
   *
   * Passed in rather than read here for the reason every other list in this
   * codebase is: `market_options` is authoritative and an admin edits it (12
   * Aug), so a copy in this file would go stale the day a market is added.
   * Omitted or empty ⇒ no topic is asked for and none comes back.
   */
  focus_options?: ReadonlyArray<{ id: string; label: string }>;
  captured?: {
    price_band?: string | null;
    price_unit?: string | null;
    worth_it?: string | null;
    /** current | recent | over_year | unsure */
    last_there?: string | null;
    how_much?: string | null;
    recommendation?: string | null;
    child_ages?: number[] | null;
  };
}

export interface ExtractionResult {
  /** 0–1. Drives the admin's low-confidence queue. */
  confidence: number;
  /**
   * True when the free text appears to name or describe an identifiable
   * person. Nothing here is published on that basis — it raises a flag so a
   * human reads it first (invariant 8).
   */
  possible_named_person: boolean;
  /** Short, non-quoting reason for the score. Safe to show an admin. */
  note: string;
  /**
   * What a parent would ask about to reach this record — one `market_options.focus`
   * id, or **null**.
   *
   * ⚠ **Null is a real answer and the schema says so.** The developer chose the
   * model over an admin for this on 4 Sep with the cost stated back to them —
   * "дешево, і помиляється так, що ніхто не помітить" — and the single largest
   * source of that unnoticed error is forcing a pick. A model given thirteen
   * options and no way out will produce the nearest one for a record that
   * belongs to none, and nothing downstream can tell that apart from a real
   * answer. So "none of these" is explicitly offered.
   *
   * Validated against the list before it is written, so a value the model
   * invented is dropped rather than stored.
   */
  focus: string | null;
}

const SCHEMA = {
  type: "object",
  properties: {
    confidence: {
      type: "number",
      description:
        "0 to 1. How much a parent could act on this note: concrete, specific, first-hand. Low when vague, contradictory, or carrying no information. Naming a person does NOT lower this — that is reported separately and does not make a note less useful.",
    },
    possible_named_person: {
      type: "boolean",
      description:
        "True if the text names or clearly identifies an individual person — a teacher, a coach, a neighbour. Independent of the score: a note can be excellent and still name someone.",
    },
    note: {
      type: "string",
      description:
        "One short sentence saying WHY the score came out where it did — name what the text does or does not give another parent. Written for the reviewer, in your own words: never quote or paraphrase the parent's sentence back, and never list facts captured elsewhere as missing.",
    },
    focus: {
      type: "string",
      description:
        "Which topic a parent would ask about to reach this record. Use one of the ids listed under 'Topics' in the message, exactly as written, or the string 'none' when the record does not belong to any of them. 'none' is a real answer and is better than the nearest fit.",
    },
  },
  required: ["confidence", "possible_named_person", "note", "focus"],
  additionalProperties: false,
} as const;

const SYSTEM = `You review short notes that parents write about local classes, camps, places and tips, so a human reviewer knows which ones need attention first.

Score how much another parent could act on the note:
- High: concrete and specific — what happens there, who it suits, what to know first, what surprised them.
- Low: vague ("it's good"), contradictory, or carrying no information at all.

Two things must not lower the score.

1. **Naming a person does not lower it.** A parent praising one teacher by name is often the most useful note there is. Report that separately in possible_named_person, because a human has to read it before it can be used — but score the note on what it tells a parent.
2. **Facts listed under "Already answered" do not lower it.** Those were captured as taps on other screens. A note is not worse for leaving out a price that is already recorded.

Always explain the score. The note is shown next to the number to the person deciding what to read first, so it has to say what drove it — what this text gives a parent, or what it leaves them still not knowing. "Vague" on its own is not a reason.

You are classifying, not rewriting. Never reproduce the parent's wording in your note, and never suggest what is missing from a card — only what this text does or does not tell a parent.

When a list of topics is given, also say which one a parent would ask about to reach this record — judged from the name and the kind first, and the note second. Answer "none" whenever the record does not clearly belong to one: a wrong topic is worse than no topic, because it puts a record in front of a parent who asked about something else, and nobody downstream can tell it apart from a right one.`;

/** Unset key ⇒ no extraction. The column stays null; nothing is invented. */
export function isExtractionConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!isExtractionConfigured()) return null;
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Returns null when extraction is unavailable or fails — the caller leaves
 * `confidence` null, which the admin renders as "no extraction run yet". A
 * wrong score is worse than no score: it would sort a card out of the queue
 * that exists to catch it.
 */
export async function extractCard(
  input: ExtractionInput,
): Promise<ExtractionResult | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const text = [
    input.what_makes_it_great && `What makes it great: ${input.what_makes_it_great}`,
    input.caveat && `Know first: ${input.caveat}`,
    input.tip_text && `Tip: ${input.tip_text}`,
    input.who_for && `Good for: ${input.who_for}`,
    input.who_not_for && `Not for: ${input.who_not_for}`,
  ]
    .filter(Boolean)
    .join("\n");

  /* Nothing to judge. Not a failure — a card of pure taps is perfectly valid,
     and scoring it against an empty string would put it in the low-confidence
     queue for no reason. */
  if (text.trim() === "") return null;

  /* The taps, so the model judges what the sentences add rather than what the
     card as a whole is missing. */
  const c = input.captured ?? {};
  const focusOptions = input.focus_options ?? [];
  const captured = [
    c.recommendation && `recommends: ${c.recommendation}`,
    c.last_there && `last there: ${c.last_there}`,
    c.how_much && `how much they went: ${c.how_much}`,
    c.price_band &&
      `price: ${c.price_band}${c.price_unit ? ` per ${c.price_unit}` : ""}`,
    c.worth_it && `worth it: ${c.worth_it}`,
    c.child_ages && c.child_ages.length > 0
      ? `child age at the time: ${c.child_ages.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            `Kind: ${input.kind}`,
            `Name: ${input.place_name}`,
            captured ? `Already answered as taps — ${captured}` : null,
            /* The market's own vocabulary, ids and labels, so the answer can be
               checked against the list rather than interpreted. */
            focusOptions.length > 0
              ? `Topics (answer with one id, or "none"): ${focusOptions
                  .map((o) => `${o.id} (${o.label})`)
                  .join(", ")}`
              : null,
            "",
            "What the parent wrote:",
            text,
          ]
            .filter((line) => line !== null)
            .join("\n"),
        },
      ],
    });

    /**
     * A safety decline is a real outcome, not an error: it means the text
     * tripped a classifier, which is itself worth a human's attention. Return
     * null so the card stays unscored and visible rather than being given a
     * number nobody stands behind.
     */
    if (response.stop_reason === "refusal") {
      console.warn("[extract] declined by the model; leaving unscored");
      return null;
    }

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;

    const parsed = JSON.parse(block.text) as ExtractionResult;
    const note = typeof parsed.note === "string" ? parsed.note.trim() : "";

    /**
     * **A number with no reason is not a result.** The schema requires `note`, so
     * a blank one is a malformed response rather than a quiet edge case — and
     * storing the score anyway is precisely how a card ends up reading "0%" with
     * nothing an admin can interrogate. Returning null leaves it unscored, which
     * is honest and which the sweep will retry; the alternative wrote a number
     * nobody could stand behind and no pass could ever repair.
     */
    if (note === "") {
      console.warn("[extract] response carried no reason; leaving unscored");
      return null;
    }

    /**
     * Checked against the list it was given, never trusted.
     *
     * "none" is the documented way out and lands as null; so does anything the
     * model invented, which is the same protection `applyThreshold` gives the
     * intent classifier — a confident answer naming a value that does not exist
     * is still nonsense. Written this way round so that adding a topic to
     * `market_options` is all it takes for records to start using it.
     */
    const claimed = typeof parsed.focus === "string" ? parsed.focus.trim() : "";
    const focus =
      claimed !== "" && focusOptions.some((o) => o.id === claimed) ? claimed : null;

    return {
      // Clamp rather than trust: the column has a 0–1 CHECK, and a value
      // outside it would abort the update instead of just being wrong.
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence))),
      possible_named_person: parsed.possible_named_person === true,
      note: note.slice(0, 300),
      focus,
    };
  } catch (err) {
    // Error class only. The request body is a parent's own words.
    console.error(
      "[extract] failed:",
      err instanceof Error ? err.constructor.name : "unknown",
    );
    return null;
  }
}
