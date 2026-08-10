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

export function cleanE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return /^\+[1-9]\d{7,14}$/.test(input) ? input : null;
}

export function cleanAges(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input)]
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n))
    .filter((n) => n >= -1 && n <= 25)
    .sort((a, b) => a - b)
    .slice(0, 12);
}
