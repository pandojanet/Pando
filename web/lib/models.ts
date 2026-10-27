/**
 * The Claude models Pando calls, and what each costs, in one place (27 Oct).
 *
 * The model ids used to be written into seven modules and the prices into
 * `trace.ts`, so changing a model meant finding every copy and remembering the
 * price table — a model with no row there is traced with no cost at all. Every
 * caller now names a **role**; the role names the model; `test:markets` refuses
 * a model without a price.
 *
 * Roles, not models, because the choice is per job (12 Oct, the developer:
 * "Haiku 5.5 everywhere except Deep Dive"): the quick reads are one model, the
 * Deep Dive's report and its search another.
 *
 * Pure and import-free, so the test suites can read it.
 */

export const MODELS = {
  /** Intent, the warm rewrite, the ordinary web search, extraction, the seed chat, provider checks. */
  fast: "claude-haiku-5-5",
  /** The Deep Dive's report and its deep search. */
  deep: "claude-sonnet-5-5",
} as const;

export type ModelRole = keyof typeof MODELS;

/**
 * Anthropic list prices, $ per million tokens (input, output). Cache reads and
 * writes are priced as multiples of input in `trace.ts`'s `costOf`. Every model
 * in `MODELS` must have a row (`test:markets`).
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/** $ per web search request, on top of tokens. */
export const WEB_SEARCH_USD = 0.01;
