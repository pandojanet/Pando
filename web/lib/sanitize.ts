/**
 * Text hygiene for anything a parent typed (spec §19: "Sanitize all user text").
 * Applied in the route before the payload reaches the repo layer, so no free text reaches
 * the database with control characters or unbounded length.
 */

const MAX_OPTION = 80;
const MAX_NAME = 60;

/** Built from a string so no raw control bytes end up in this source file. */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

export function cleanText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned.length > 0 ? cleaned : null;
}

export function cleanOptionValue(input: unknown): string | null {
  return cleanText(input, MAX_OPTION);
}

export function cleanName(input: unknown): string | null {
  return cleanText(input, MAX_NAME);
}

/** Canonical option ids we generate ourselves — reject anything else. */
export function cleanId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return /^[a-z0-9_-]{1,64}$/i.test(input) ? input : null;
}

/**
 * A `type:value` reference to one of the parent's own connections, for the
 * per-affiliation privacy grants (Privacy Guidance §A).
 *
 * `cleanId` cannot be used and this is not a widening of it: `cleanId` refuses a
 * colon, so routing these through it dropped **every** grant silently — the
 * parent ticked four connections and none reached the database. A composite id
 * needs its own shape check, not a looser one for every id in the app.
 *
 * Both halves are constrained: the left is a question id, the right an option
 * slug. Nothing free-text can pass, which matters because the value has to name
 * one edge in the matching graph.
 */
export function cleanAffiliationRef(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return /^[a-z][a-z0-9_]{0,31}:[a-z0-9][a-z0-9-]{0,79}$/.test(input) ? input : null;
}

export function cleanE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return /^\+[1-9]\d{7,14}$/.test(input) ? input : null;
}

/**
 * What counts as a child's age, written once.
 *
 * -1 is `EXPECTING`. The ceiling is 25 because the question offers eighteen
 * birth years and a parent may have an older child; past that it is not the
 * question being answered.
 *
 * This lives here rather than beside the questionnaire because **two different
 * layers have to agree on it**: the route that refuses a payload and the client
 * normaliser that repairs its own stored session. They disagreed — the client
 * kept any finite number, the server took -1..25 — and the gap cost a founding
 * contributor their whole session (see `childAgeFromStored`).
 */
export const CHILD_AGE_MIN = -1;
export const CHILD_AGE_MAX = 25;

/** Below this, a number is an age; at or above it, it is a year. */
const EARLIEST_PLAUSIBLE_YEAR = 1900;

/**
 * One stored value → the age it means, or null.
 *
 * ## Why this recovers a birth year and `cleanAges` does not
 *
 * The parent taps a **birth year** as a label and the session stores the **age**.
 * A stored `[2025]` is therefore a value from a session that got it the wrong
 * way round — and it is invisible: it is a finite number, so a shape check keeps
 * it, and it renders as "2025" on the review screen exactly as a correct `[1]`
 * does. The server refused it every time, so the parent verified their phone and
 * then watched every save fail with no way out, because retrying re-sent the
 * same value.
 *
 * The two ranges cannot overlap — an age stops at 25, a year starts at four
 * digits — so `CURRENT_YEAR - value` is unambiguously the age they meant, and
 * repairing it keeps the answer rather than emptying a required question.
 *
 * **This is for the client repairing its own storage, never for the route.** A
 * server that reinterprets what a client sent is masking a client bug, and the
 * whole point of `cleanAges` is to refuse rather than guess — so it stays
 * strict, and the two behaviours are deliberate rather than an oversight.
 */
export function childAgeFromStored(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  const n = Math.trunc(input);
  const age = n >= EARLIEST_PLAUSIBLE_YEAR ? new Date().getFullYear() - n : n;
  return age >= CHILD_AGE_MIN && age <= CHILD_AGE_MAX ? age : null;
}

export function cleanAges(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input)]
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n))
    .filter((n) => n >= CHILD_AGE_MIN && n <= CHILD_AGE_MAX)
    .sort((a, b) => a - b)
    .slice(0, 12);
}
