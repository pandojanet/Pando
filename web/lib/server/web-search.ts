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
 * vendor and no further. Worth the client knowing before it is switched on: it
 * is off unless `WEB_SEARCH_ENABLED=1`, so shipping this does not turn it on.
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

export function isWebSearchConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return (
    process.env.WEB_SEARCH_ENABLED === "1" &&
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

    return { findings: readFindings(text, (name) => looksLikePerson(name)), configured: true };
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
