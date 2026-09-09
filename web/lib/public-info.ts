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

/**
 * Bounded on purpose, and raised from three to five on 9 Sep.
 *
 * The client asked for more general information twice, and the budget stopped
 * being the constraint the same day. Parents still come first — the composer
 * reserves the public block and fills the rest around it, never the other way
 * round — so this is a ceiling on what the search may offer rather than a
 * promise about how much gets sent.
 */
export const MAX_PUBLIC_FINDINGS = 5;

export interface PublicFinding {
  /** The place, class or programme. Never a person. */
  name: string;
  /** Three or four words: what it is. Not a sentence, not a sales line. */
  what: string;
  /** Where, if the page said so plainly. */
  area: string | null;
  /**
   * One short factual thing the page states and a parent would want: the ages
   * it takes, when it runs, drop-in or a term, a published price.
   *
   * The prompt forbids inferring, rounding or guessing, and this reader drops
   * rather than repairs — so a missing detail is a page that did not say it,
   * never Pando filling a gap. It sits under the "Public/general information"
   * heading, which is what makes stating a price here honest where stating one
   * as a parent's claim would not be.
   */
  detail: string | null;
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
  /**
   * Names the parents' half of the answer already carries.
   *
   * ⚠ **This is a correctness filter, not a tidy-up.** Without it one place can
   * reach a parent **twice in one answer wearing two different trust labels** —
   * "Rose Bowl Aquatics · Validated by multiple parents" on one line and "Rose
   * Bowl Aquatics · Public/general information" on the next. That is not a
   * repetition, it is the answer contradicting itself about how well backed the
   * thing is, on the one axis the whole product sells. It also spends a slot on
   * a record the parent has already been given.
   *
   * The prompt asks for the same thing, and the prompt is the half that saves a
   * wasted search rather than the half that guarantees anything: a model told
   * not to repeat a name will still return it under a longer legal name or a
   * branch suffix. `normaliseName` is what actually catches those.
   */
  exclude: readonly string[] = [],
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
  /* What the answer already names — the parents' records first, then each
     finding as it is accepted, so the reply cannot repeat itself either. */
  const taken: string[] = [...exclude];

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

    if (taken.some((already) => sameName(already, name))) continue;
    taken.push(name);

    out.push(
      placed(
        name,
        what,
        clean((row as Record<string, unknown>).area, 40),
        clean((row as Record<string, unknown>).detail, 60),
      ),
    );
    if (out.length === MAX_PUBLIC_FINDINGS) break;
  }

  return out;
}

/**
 * Two names for the same place, reduced to one key.
 *
 * Deliberately blunt, and blunt in one direction only: it may collapse two
 * genuinely different records, and the cost of that is one public line
 * suppressed. The cost of the other direction is the double-labelled answer
 * described above, so this errs toward suppressing.
 *
 * What it strips is what a web page adds and a parent does not type: the legal
 * suffix, the possessive, the ampersand written out, everything after a dash,
 * and the words every second business in this taxonomy carries. "Little Gym,
 * Inc." and "The Little Gym" come out the same; "Kidspace Children's Museum"
 * comes out as "kidspace museum" rather than "kidspace s museum".
 *
 * ⚠ It deliberately does **not** try to strip a town — that is `sameName`'s
 * job, and it is a different question. Cutting "Pasadena" here would need this
 * module to know the market's areas, and it has no runtime imports by design.
 */
export function normaliseName(value: string): string {
  const key = value
    .toLowerCase()
    .normalize("NFKD")
    /**
     * The combining marks NFKD just produced, **before** the alphanumeric pass
     * below — that pass turns anything else into a space, so leaving them would
     * make "café" into "caf e" rather than "cafe" and the two spellings would
     * stop matching. Written as an escape rather than as literal marks: they are
     * invisible in a diff, and an editor that normalises the file would delete
     * the class without anything failing.
     */
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    /* Everything after a dash or a comma: "Rose Bowl Aquatics - Pasadena". */
    .replace(/\s+[-–—,|/].*$/, "")
    /* The possessive, before the pass below splits it into a stray "s" —
       "Children's" would otherwise survive the stop-word cut as one letter. */
    .replace(/['’´]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(the|a|an|of|at|in|inc|llc|ltd|co|corp|company|center|centre|studio|studios|academy|school|schools|program|programs|programme|class|classes|club|kids|children|childrens|and)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  /**
   * A name made **entirely** of the shared words normalises to nothing — "The
   * Kids Club", "Children's Academy" — and an empty key would either drop a
   * legitimate finding or collide every such name with every other. Fall back
   * to the plain lowercase name, which still dedupes exactly and never matches
   * anything it should not.
   */
  return key.length > 0 ? key : value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Are these two names the same place?
 *
 * Exact keys are not enough on their own, and the miss is the common case
 * rather than an edge one: a parent's record is "Little Gym" and the page that
 * a search returns is "The Little Gym of Pasadena", which normalises to
 * `little gym pasadena`. Left there, the answer names it twice — once
 * "Validated by multiple parents", once "Public/general information".
 *
 * So one key may be a **token prefix** of the other. ⚠ Token prefix, never
 * string prefix: `"little gymnastics".startsWith("little gym")` is true, and
 * those are two different businesses. Comparing word by word refuses it.
 *
 * A one-word key has to match exactly, or "Waldorf" would swallow "Waldorf
 * Early Childhood" and any other place beginning with the same word. Two words
 * is where a name starts being specific enough that a longer version of it is
 * the same thing with a town or a branch on the end.
 */
export function sameName(a: string, b: string): boolean {
  const x = normaliseName(a).split(" ").filter(Boolean);
  const y = normaliseName(b).split(" ").filter(Boolean);
  if (x.length === 0 || y.length === 0) return false;

  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 2 && short.length !== long.length) return false;
  return short.every((word, i) => word === long[i]);
}

/**
 * The town, said once.
 *
 * The composer renders `Name - what in Area`, and a great many businesses put
 * their town in their own name — so the line came out as *"Encore Music South
 * Pasadena in South Pasadena"*, *"Monrovia Preschool & Daycare Center in
 * Monrovia"*, *"Wonderland 4 Kids - Pasadena in Pasadena"*. Measured across ten
 * live questions: **four of eight** public lines repeated the town, and one of
 * them contradicted itself — *"Swimphi Altadena in Pasadena"*.
 *
 * Two fixes, and each is a deletion rather than a rewrite, because a finding
 * that has been repaired is a finding nobody wrote:
 *
 *  - a trailing branch suffix that **is** the area comes off the name, so
 *    "Wonderland 4 Kids - Pasadena" is "Wonderland 4 Kids". Only when it matches
 *    the area: "Rose Bowl Aquatics - Parent & Me" keeps its half, because that
 *    one is what the thing *is*;
 *  - and the area is dropped when the name still carries it.
 *
 * ⚠ **A disagreement is left exactly as it is**, which is the *"Swimphi
 * Altadena in Pasadena"* case above: the name names one town and the page said
 * another, and this module cannot tell which is right — it has no runtime
 * imports and therefore no list of the market's areas, so "Altadena" inside a
 * name is indistinguishable from a brand word. Suppressing the area on a hunch
 * would delete a fact the page actually stated. Saying the town **twice** is a
 * defect worth fixing; saying two different ones is a signal worth leaving
 * visible.
 */
function placed(
  name: string,
  what: string,
  area: string | null,
  detail: string | null,
): PublicFinding {
  if (!area) return { name, what, area: null, detail };

  const areaKey = normaliseName(area);
  if (areaKey.length === 0) return { name, what, area, detail };

  /* "Wonderland 4 Kids - Pasadena" → "Wonderland 4 Kids". */
  const trimmed = name.replace(/\s+[-–—,]\s*([^-–—,]+)$/, (whole, tail: string) =>
    normaliseName(tail) === areaKey ? "" : whole,
  );
  const shown = trimmed.trim().length > 0 ? trimmed.trim() : name;

  /* Token-wise, so "Pasadena" in "South Pasadena" does not count as carrying
     it — those are two different towns and the shorter is not the longer. */
  const words = new Set(normaliseName(shown).split(" ").filter(Boolean));
  const carries = areaKey.split(" ").filter(Boolean).every((w) => words.has(w));

  return { name: shown, what, area: carries ? null : area, detail };
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  /* Newlines and control characters would break the one-line-per-record shape
     the composer renders into. */
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  return flat.slice(0, max);
}
