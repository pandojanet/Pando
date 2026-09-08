/**
 * Reading what a web search came back with.
 *
 * Split out of `lib/server/web-search.ts` so it can be loaded by a plain node
 * test: that module imports the Anthropic SDK and `server-only`, and the half
 * worth testing is this one — the half that can be wrong with no API involved.
 * Same shape as `lib/capture.ts` and `lib/matching.ts` — and, like them, it has
 * **no runtime imports at all**, which is what lets node load it. That is why the
 * person check arrives as a required argument rather than being imported: a
 * required one cannot be forgotten by a call site, and the compiler names every
 * caller if it ever changes.
 *
 * **Every branch drops rather than repairs.** A repaired finding is a finding
 * nobody wrote, and it would reach a parent wearing the same label as one that
 * was actually on a page.
 */

/** Bounded on purpose: an answer is 459 characters and parents come first. */
export const MAX_PUBLIC_FINDINGS = 3;

export interface PublicFinding {
  /** The place, class or programme. Never a person. */
  name: string;
  /** Three or four words: what it is. Not a sentence, not a sales line. */
  what: string;
  /** Where, if the page said so plainly. */
  area: string | null;
}
/**
 * Read the model's reply, refusing anything that is not plainly a finding.
 *
 * Exported for the suite: this is the half that can be wrong without the API
 * being involved, and every branch of it drops rather than repairs. A repaired
 * result is a result nobody wrote.
 */
export function readFindings(
  text: string,
  /** `looksLikePerson`, passed in — see the header. Required, never defaulted. */
  isPerson: (name: string) => { person: boolean; strong?: boolean },
): PublicFinding[] {
  /* The tool's own citations often leave prose around the JSON, so the object is
     found rather than assumed to be the whole reply. */
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];

  const out: PublicFinding[] = [];
  const seen = new Set<string>();

  for (const row of list) {
    if (typeof row !== "object" || row === null) continue;
    const name = clean((row as Record<string, unknown>).name, 60);
    const what = clean((row as Record<string, unknown>).what, 40);
    if (!name || !what) continue;

    /* Strong signals only — an honorific or a bare possessive. The weak
       two-capitalised-words signal flags 16 of this market's 588 curated records
       ("Marshall Fundamental", "Altadena Stables"), so refusing on it would drop
       ordinary businesses. */
    const verdict = isPerson(name);
    if (verdict.person && verdict.strong) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, what, area: clean((row as Record<string, unknown>).area, 40) });
    if (out.length === MAX_PUBLIC_FINDINGS) break;
  }

  return out;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  /* Newlines and control characters would break the one-line-per-record shape
     the composer renders into. */
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  return flat.slice(0, max);
}
