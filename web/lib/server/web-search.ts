import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { looksLikePerson } from "@/lib/named-person";
import { readFindings, type PublicFinding } from "@/lib/public-info";

/**
 * General information about what a parent asked, from the open web.
 *
 * ## Why this exists, and what it is not
 *
 * The estimate says retrieval "falls back to clearly-labeled public info when
 * there is no parent-backed match", and `retrieval.ts` says in its own header
 * that raising the `parent_backed` flag is **all** that layer does about it —
 * inventing public text behind a retrieval function would put unsourced prose
 * where no label could later tell it apart from a parent's experience. This is
 * the other half, kept deliberately outside that module for the same reason.
 *
 * The client's instruction is that an answer carries **both**: what is generally
 * known, and what parents here have backed. So this is not a fallback for an
 * empty graph — it runs alongside it, and the composer puts the parents first.
 *
 * ## Five rules, and the first three are invariants rather than preferences
 *
 * **It can only ever produce public labels.** `publicTrust()` is the one shape
 * that leaves here, and it carries `TRUST_LABEL.PUBLIC` and nothing else
 * (invariant 3: never present public information as human trust). A web result
 * cannot be given a parent label by any caller, because the labels are built
 * here and the type gives no way to add to them.
 *
 * **It refuses to name a person.** A search for "toddler classes" can return an
 * individual tutor's page, and a name in an answer is the exposure invariants 2,
 * 12, 13 and 11.4 all exist around — none of which the open web has cleared.
 * `looksLikePerson` on the strong signals only, which is the same threshold the
 * SMS capture refuses on.
 *
 * **It never invents.** No key, a refusal, a malformed reply, a timeout: the
 * answer is *no public results*, never a plausible-looking one. Same honesty
 * rule as `persisted: false` and as `extract.ts` leaving `confidence` null.
 *
 * **It is bounded.** `max_uses: 2`, three results, short fields, one cheap
 * model. An answer is 459 characters and the parents' records come first, so a
 * fourth result could not have been rendered anyway.
 *
 * **It cannot fail the answer.** Every path returns; the caller composes with
 * whatever came back, including nothing.
 *
 * ⚠ **It sends the parent's question to a search engine.** Invariant 7 is about
 * logs and this is not one, but it is a third party seeing what a parent asked —
 * a wider disclosure than the classification call, which goes to the same model
 * vendor and no further. It is **on by default** wherever there is an API key —
 * see `isWebSearchConfigured` for why that direction changed on the day it
 * shipped — and `WEB_SEARCH_ENABLED=0` is how it is switched off.
 */

const MODEL = "claude-haiku-4-5";

/**
 * ⚠ **`web_search_20250305`, and not a newer one — this pairing is load-bearing.**
 *
 * The 2026 tool versions carry `allowed_callers`, and Haiku 4.5 refuses them:
 *
 *     'claude-haiku-4-5-20251001' does not support programmatic tool calling.
 *     The following tools have `allowed_callers` that…
 *
 * Every call was a 400, and because the catch below turns a failure into *no
 * public results*, the answer still composed, still looked right, and simply
 * never carried anything from the web. That is the third time this repository
 * has paid for a request the API rejects and a fallback that hides it —
 * `output_config` in `intent.ts` is the same shape, in the same file's sibling.
 *
 * Measured across both: `20250305` works with Haiku on this account, with and
 * without `user_location`. So **changing either half means re-testing the
 * other**: a newer tool needs a bigger model, and a bigger model on a call that
 * runs for every question asked is a cost decision rather than an upgrade.
 */
const SEARCH_TOOL = "web_search_20250305" as const;

export type { PublicFinding };

export interface PublicSearchResult {
  findings: PublicFinding[];
  /** False when the search never ran, so a caller can tell that from "nothing". */
  configured: boolean;
}

const NOTHING: PublicSearchResult = { findings: [], configured: false };

/**
 * On wherever there is a key, off only when somebody says so.
 *
 * ⚠ **This reverses the switch's direction, on the same day it was written, and
 * the reason is worth keeping.** It shipped as `=== "1"` — opt-in — because the
 * search sends the parent's question to a third party, and a disclosure like
 * that is the client's to make rather than mine to default. That reasoning still
 * holds for the *disclosure*; what it got wrong is who was being protected.
 *
 * The variable was set **nowhere**: not in `.env.local`, not on the VPS, not in
 * the deploy workflow. So the feature the client asked for was built, tested,
 * documented, deployed — and inert in every environment they could look at. They
 * asked twice why they could not see it. A switch that has to be found before a
 * feature exists is the "written and never called" fault dressed as caution.
 *
 * So the asymmetry follows `SEED_REQUIRE_VERIFICATION`'s, which is the same shape
 * for the same reason: **on unless the value is literally `"0"`**, so deleting
 * the line leaves the working setting and turning it off is a deliberate act. It
 * still needs `ANTHROPIC_API_KEY`, so an unconfigured deployment silently gets no
 * public information rather than an error — the ordinary honesty rule.
 *
 * The disclosure has not gone away and is not mine to close: a parent's question
 * reaches a search engine. It is written into `.env.example` next to the switch,
 * and it is on the list for the client.
 */
export function isWebSearchConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return (
    process.env.WEB_SEARCH_ENABLED !== "0" &&
    typeof key === "string" &&
    key.trim().length > 0
  );
}

const SYSTEM = [
  "You look up general, publicly available information for a local parenting service.",
  "Search the web, then list what a parent would actually consider.",
  "",
  "Rules:",
  "- Only places, classes, camps, programmes or venues. Never an individual person,",
  "  tutor, nanny, sitter or coach, even if a page recommends one by name.",
  "- Only things that plainly exist and serve the area asked about.",
  "- `what` is three or four words saying what it is. No adjectives of praise,",
  "  no marketing language, no claim about quality.",
  "- `area` is the town or neighbourhood, or null if the page did not say.",
  "- If the search finds nothing solid, return an empty list. An empty list is a",
  "  correct answer; a plausible guess is not.",
  "",
  "Your final message must be the JSON object and nothing else — no summary,",
  "no citation sentence, no preamble. If you searched and found nothing solid,",
  "the object with an empty list is the correct final message.",
  "",
  "Return JSON only, with no prose around it:",
  '{"findings":[{"name":"...","what":"...","area":"..."|null}]}',
].join("\n");

/** Pasadena is the pilot market; anything else searches without a location. */
const MARKET_LOCATION: Record<
  string,
  { city: string; region: string; country: string; timezone: string }
> = {
  pasadena: {
    city: "Pasadena",
    region: "California",
    country: "US",
    timezone: "America/Los_Angeles",
  },
};

/**
 * What is generally known about this question.
 *
 * `area` is the asker's own neighborhood when Pando knows it — a hint for the
 * search, never a filter, the same rule the starter lists follow.
 */
export async function searchPublicInformation(input: {
  question: string;
  market: string;
  area?: string | null;
}): Promise<PublicSearchResult> {
  const question = input.question.trim();
  if (question.length === 0) return NOTHING;
  if (!isWebSearchConfigured()) return NOTHING;

  const where = input.area ? input.area.replace(/-/g, " ") : null;
  const location = MARKET_LOCATION[input.market] ?? null;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          type: SEARCH_TOOL,
          name: "web_search",
          max_uses: 2,
          ...(location
            ? { user_location: { type: "approximate" as const, ...location } }
            : {}),
        },
      ],
      messages: [
        {
          role: "user",
          content: where
            ? `${question}\n\n(The parent is in ${where}.)`
            : question,
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    const findings = readFindings(text, (name) => looksLikePerson(name));

    /**
     * ⚠ **A miss and a refusal look identical from the outside**, and both come
     * back as no public line. Measured: the same Glendora question returned a
     * finding on one run and nothing on the next, so the two have to be told
     * apart in the log or the next person debugging it has nothing to go on.
     *
     * Counts and a boolean only (invariant 7): never the question, never the
     * reply. `parsed: false` on a long reply means the model wrote prose instead
     * of the object it was asked for, which is a prompt problem; `parsed: true`
     * with nothing found means it searched and had nothing, which is an honest
     * answer and needs no fixing.
     */
    if (findings.length === 0) {
      console.info("[web-search] nothing to add", {
        parsed: text.includes("findings"),
        reply_length: text.length,
      });
    }

    return { findings, configured: true };
  } catch (err) {
    /**
     * Status and the API's own error *type*, and nothing else.
     *
     * Never `message`: the SDK builds it from the request, which here is the
     * parent's question — the `driverError()` leak (7 Aug) in a second library.
     * The type is an enum and cannot carry it, and without it a tool-version
     * mismatch and "the web had nothing" are the same silence, which is exactly
     * how the 400 above survived a build.
     */
    console.warn("[web-search] failed", {
      status: (err as { status?: number })?.status ?? null,
      kind:
        (err as { error?: { error?: { type?: string } } })?.error?.error?.type ?? null,
    });
    return { findings: [], configured: true };
  }
}
