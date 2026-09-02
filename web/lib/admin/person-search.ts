/**
 * Ranking for the admin's person pickers (6.7's harness today, anything else
 * that has to find one parent among hundreds tomorrow).
 *
 * ## Why this is its own module
 *
 * It was four lines inside a `useMemo` in `/admin/matching`, and this file's own
 * history says what happens to a matching rule that lives inside a component:
 * `lib/starters.ts` was extracted for exactly that reason after the client
 * reported the same class of fault twice — typecheck clean, suite green, the
 * feature quietly doing the opposite of its purpose, visible only to somebody
 * holding a phone. A search box is a *rule* (what counts as a match, and what
 * ranks above what), so it is pure, it is here, and `npm run test:person-search`
 * pins it.
 *
 * ## The rules, and the reason for each
 *
 * 1. **A slug is searched as words.** `people.neighborhood` is stored as
 *    `south-pasadena`, and "south pas" is how somebody actually types it — the
 *    lesson `lib/onboarding.ts` already learned from the inbound parser. So
 *    hyphens and underscores are spaces before anything is compared.
 * 2. **Every term must match something** (AND, not OR). "sarah south" should
 *    find Sarah Chen in South Pasadena and nobody else; an OR would return
 *    every parent named Sarah *plus* everyone in South Pasadena, which is a
 *    longer list than the one the reader started with.
 * 3. **A word start beats a mid-word hit, and a name beats an area.** Typing
 *    "chen" wants Sarah Chen at the top, not the four parents whose street
 *    happens to contain the letters. Ties keep the order the server sent, which
 *    is what makes the list stable while a reader types — an unstable order
 *    under a search box reads as the page fighting back.
 * 4. **No selected-row special case.** The old `<select>` needed one: the
 *    chosen option had to stay in the list or the control would blank itself.
 *    A combobox shows the selection in its own input, so the list is purely
 *    suggestions and nothing has to be pinned into it.
 */

export interface SearchablePerson {
  person_id: string;
  name: string | null;
  neighborhood: string | null;
}

/** Points, highest first — a name's word start is the strongest signal there is. */
const NAME_WORD_START = 4;
const NAME_ANYWHERE = 3;
const AREA_WORD_START = 2;
const AREA_ANYWHERE = 1;

/**
 * `south-pasadena` → `south pasadena`, so a slug is searchable as words.
 *
 * **Length-preserving, deliberately**: one space per separator and no trim, so
 * an index into this string is also an index into the original — which is what
 * lets `matchRanges` return offsets a caller can apply to the text it renders.
 * `slugLabel` preserves length the same way, so the ranges hold for a
 * display-cased area name too.
 */
export function searchableText(value: string | null): string {
  return (value ?? "").replace(/[-_]/g, " ").toLowerCase();
}

/** The words a reader typed, empties dropped. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Does `haystack` contain `term` at the start of one of its words? */
function atWordStart(haystack: string, term: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at === -1) return false;
    if (at === 0 || haystack[at - 1] === " ") return true;
    from = at + 1;
  }
}

/**
 * How well one person answers one term. `0` means they do not, which — per rule
 * 2 — disqualifies them from the whole query.
 */
function scoreTerm(name: string, area: string, term: string): number {
  if (atWordStart(name, term)) return NAME_WORD_START;
  if (name.includes(term)) return NAME_ANYWHERE;
  if (atWordStart(area, term)) return AREA_WORD_START;
  if (area.includes(term)) return AREA_ANYWHERE;
  return 0;
}

/**
 * The people who match `query`, best first. An empty query returns the input
 * untouched — the server's order is already meaningful (contributors first),
 * and re-sorting an unfiltered list would throw that away.
 */
export function rankPeople<T extends SearchablePerson>(people: readonly T[], query: string): T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [...people];

  const scored: Array<{ person: T; score: number; at: number }> = [];
  people.forEach((person, at) => {
    const name = searchableText(person.name);
    const area = searchableText(person.neighborhood);
    let total = 0;
    for (const term of terms) {
      const points = scoreTerm(name, area, term);
      if (points === 0) return; // rule 2 — one unmatched term is a miss
      total += points;
    }
    scored.push({ person, score: total, at });
  });

  /* `at` is the tiebreak, so equal scores keep the server's order (rule 3). */
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.map((s) => s.person);
}

/**
 * Where `query`'s terms land inside `text`, merged and in order — so a picker
 * row can show *why* it matched instead of leaving the reader to spot it.
 *
 * Returned as ranges rather than as marked-up text on purpose: this module is
 * pure and knows nothing about how the caller renders an emphasis.
 */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const haystack = searchableText(text);
  const ranges: Array<[number, number]> = [];
  for (const term of searchTerms(query)) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(term, from);
      if (at === -1) break;
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (ranges.length === 0) return ranges;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
