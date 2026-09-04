import type { AgeBand } from "./types";

/**
 * M6 — the two-layer matching mechanism, as pure functions.
 *
 * Phase 1 *writes* the graph (`lib/derive.ts`); this reads it. It answers one
 * question, the one CLAUDE.md §4 of the strategy states outright: **who is likely
 * to have experience genuinely useful to this parent?**
 *
 * ## Why this file is pure, like `derive.ts`
 *
 * Same reason, and it is not a style preference. The graph is the long-term
 * asset, and on 11 Aug `derive.ts` had to be moved off the client because whoever
 * computes these numbers decides whose questions reach whom. Keeping the scoring
 * free of a database connection means it can be tested exhaustively against
 * hand-built cases (`npm run test:matching`) — which is the only way to know that
 * a weight change did what it looked like. `lib/server/repo/matching.ts` does the
 * one query and hands the rows here.
 *
 * ## The two layers, and why the second cannot filter
 *
 * **Affinity** (6.1) is *connection*: a shared school, activity, neighborhood,
 * group, faith community or age band, each worth what `affinity_weights` says at
 * query time. **Life relevance** (6.2) is *context*: budget posture, logistics,
 * family setup, childcare, tenure. The estimate is explicit that the second is "a
 * boost, not a hard filter", and the reason is in the strategy: a recommendation
 * from a working mother with a same-age child three blocks away means more — but a
 * parent whose budget posture differs is not disqualified from knowing whether the
 * 9am class is calmer. Filtering on context would quietly shrink an already sparse
 * network, which is 6.6's whole problem.
 *
 * Hard exclusions exist (6.5) but only "when the request explicitly demands
 * them" — a question about a wheelchair-accessible class means something the
 * asker cannot compromise on, and that is a property of the *question*, never of
 * the scoring.
 */

/** One edge from `social_affinities`. */
export interface Edge {
  affinity_type: string;
  affinity_value: string;
  /**
   * Whose it is, for the edges that belong to a child — school, class, camp
   * (13 Aug). Null means the household's, or "they didn't say".
   */
  child_birth_years: number[] | null;
}

/** One row from `life_relevance`. */
export interface Relevance {
  dimension: string;
  value: string;
}

export interface Person {
  person_id: string;
  edges: Edge[];
  relevance: Relevance[];
  /**
   * Birth years from `children`, **not** from the stored `age_range` edge.
   *
   * `derive.ts` says it in so many words: the stored band is "as of capture" and
   * the backend recomputes it from `birth_year`. A toddler edge written in
   * February is a preschool child by the next summer, and matching on the stale
   * band would pair a parent with someone whose child has moved on — the exact
   * failure the per-child attribution work existed to prevent, arriving through
   * time instead of through the household.
   */
  child_birth_years: number[];
  neighborhood: string | null;
}

export interface MatchConfig {
  /** From `affinity_weights`, read at query time (spec §18.1 beats §8.1). */
  weights: Record<string, number>;
  /**
   * Symmetric pairs from `neighborhood_adjacency`, in either order — this
   * normalises them itself rather than trusting the caller to have looked both
   * ways.
   */
  adjacency: Array<{ area_a: string; area_b: string }>;
  /** How much one matching life-relevance value is worth. See `RELEVANCE_STEP`. */
  relevanceStep?: number;
}

export interface Requirements {
  /**
   * 6.5 — applied as a filter, and **only** because the question said so.
   * `{ affinity_type, affinity_value }` pairs a candidate must have.
   */
  mustHave?: Array<{ affinity_type: string; affinity_value: string }>;
  /** Bands the question is about, so an age edge is scored against the question. */
  bands?: AgeBand[];
}

export interface ScoredPerson {
  person_id: string;
  score: number;
  /** Every contribution, named — so a ranking can be explained to the client. */
  reasons: Array<{ kind: string; value: string; points: number }>;
  affinity: number;
  relevance: number;
}

/**
 * What one matching life-relevance value adds.
 *
 * Deliberately small and flat. The lightest affinity edge is 1
 * (`adjacent_neighborhood`) and the heaviest is 5 (a shared school), so a step of
 * 1 would let four shared context values outweigh a shared school — which
 * inverts the strategy's own order, where relevant firsthand experience comes
 * first and context breaks the tie. At 0.5 the whole of life relevance (five
 * dimensions) tops out below a single school edge, which is the intended shape:
 * a boost, not a second scoring system.
 */
export const RELEVANCE_STEP = 0.5;

/**
 * The age ladder — **the only copy**, and it lives here rather than beside the
 * questionnaire for two reasons.
 *
 * The first is correctness: this side recomputes a band from a birth year at
 * query time, because the stored `age_range` edge is written "as of capture" and
 * a toddler edge from February is a preschool child by the summer. That
 * recomputation is the thing that must not disagree with what the parent was
 * asked.
 *
 * The second is that **this module has no runtime imports at all**, which is what
 * lets `npm run test:matching` load it in plain node: `import type` is erased,
 * so `./types` costs nothing, while any value import would need a file extension
 * node's ESM resolver demands and Next.js does not. An earlier attempt put the
 * ladder in its own `lib/age-bands.ts`; importing it from here made this file
 * unloadable in a test, which is the one property worth protecting. So
 * `questions.ts` — which Next bundles, and which can therefore import anything —
 * reads the ladder from here instead.
 */
export const AGE_BANDS: AgeBand[] = [
  "expecting",
  "baby",
  "toddler",
  "preschool",
  "grade",
  "tween",
  "teen",
];

/**
 * One age → the band(s) it belongs to.
 *
 * `expecting` returns **two**: a family expecting a baby is also, for matching,
 * a family about to be in the baby band — which is who they most want to hear
 * from. Deliberate, and it predates this module.
 *
 * A negative age is `EXPECTING` (-1). Compared as `< 0` rather than against the
 * constant so that nothing here is a value import.
 */
export function bandsForAge(age: number): AgeBand[] {
  if (age < 0) return ["expecting", "baby"];
  if (age < 1) return ["baby"];
  if (age < 3) return ["toddler"];
  if (age < 5) return ["preschool"];
  if (age < 11) return ["grade"];
  if (age < 14) return ["tween"];
  return ["teen"];
}

/**
 * The age bands a **question** is about, from the words in it.
 *
 * Retrieval takes its bands from the asker's own children, which is right for a
 * contributor Pando knows and useless for the cold inbound 5.9 is about — a
 * stranger has no children on file, so no band filter applied and the answer
 * padded itself with whatever ranked next. The live proof: *"any good toddler
 * classes near South Pasadena?"* came back naming Little Maestros (a class, in
 * South Pasadena, for toddlers — right on all three) **and Hahamongna Watershed
 * Park** (a trail, in Altadena, for preschool and up — wrong on all three),
 * both wearing the same trust chain, so the wrong one read as endorsed as the
 * right one.
 *
 * The band names are the taxonomy's own, so reading them is not guesswork the
 * way guessing a *kind* would be — "toddler" means exactly one thing here. The
 * synonyms are the words a parent actually types instead; a bare number goes
 * through `bandsForAge`, which is the same ladder everything else uses.
 *
 * Returns an empty array when the question says nothing about age, and the
 * caller then falls back to what it knows about the asker. Never guesses.
 */
const BAND_WORDS: ReadonlyArray<readonly [RegExp, AgeBand]> = [
  [/\b(expecting|pregnan\w*|due in|newborn on the way)\b/i, "expecting"],
  [/\b(baby|babies|infant|infants|newborn|newborns)\b/i, "baby"],
  [/\b(toddler|toddlers)\b/i, "toddler"],
  [/\b(preschool|pre-?k|nursery|kindergart\w+)\b/i, "preschool"],
  [/\b(grade ?school|elementary|primary)\b/i, "grade"],
  [/\b(tween|tweens|middle ?school)\b/i, "tween"],
  [/\b(teen|teens|teenager|teenagers|high ?school)\b/i, "teen"],
];

export function bandsInQuestion(text: string): AgeBand[] {
  const found = new Set<AgeBand>();

  for (const [pattern, band] of BAND_WORDS) {
    if (pattern.test(text)) found.add(band);
  }

  /* "my 3 year old", "a 7yo". Anchored on the noun so a price, a house number
     or a time of day cannot be read as a child's age. */
  for (const match of text.matchAll(/\b(\d{1,2})\s*(?:-|\s)?\s*(?:year|yr|yo)\b/gi)) {
    for (const band of bandsForAge(Number(match[1]))) found.add(band);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*months?\b/gi)) {
    for (const band of bandsForAge(Number(match[1]) / 12)) found.add(band);
  }

  return AGE_BANDS.filter((band) => found.has(band));
}

/**
 * The `market_options.focus` topic a question is about, or null.
 *
 * The other half of `bandsInQuestion`, and the reason retrieval could not tell
 * "toddler swim classes" from "toddler music classes": the taxonomy existed and
 * nothing read it. These are the words a parent types for each of the thirteen
 * curated topics.
 *
 * ⚠ **The ids are checked against the caller's list, not assumed.** A market
 * that does not offer `special_needs_resources` must not have questions matched
 * against it, so the caller passes what `market_options` actually holds and
 * anything else is dropped — the same shape as the extraction pass's own
 * validation, and for the same reason.
 *
 * Order matters where two patterns can both fire: "nanny share" is care rather
 * than sharing, and "swim class" is sport rather than the generic activities
 * bucket, so the specific topics are tested before the general ones.
 */
const FOCUS_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(nanny|nannies|au ?pair|childminder|full ?time care)\b/i, "nannies"],
  [/\b(sitter|babysitter|babysitting|date ?night)\b/i, "babysitters"],
  [/\b(newborn|night nurse|postpartum|doula|new ?born care)\b/i, "newborn_care"],
  [/\b(pediatric\w*|paediatric\w*|doctor|dentist|therapist|speech|allerg\w+)\b/i, "pediatric_health"],
  [/\b(special ?needs|iep|autis\w+|adhd|sensory)\b/i, "special_needs_resources"],
  [/\b(preschool|pre-?k|school|kindergart\w+|nursery)\b/i, "preschools_schools"],
  [/\b(camp|camps)\b/i, "camps"],
  [/\b(swim\w*|soccer|football|gymnastic\w*|karate|martial arts|sport\w*|ballet|dance|tennis|basketball)\b/i, "sports"],
  [/\b(music|piano|guitar|violin|singing|art|arts|painting|drawing|pottery|theat\w+|drama)\b/i, "arts_music"],
  [/\b(park|playground|trail|hike|hiking|library|museum|outing|day ?trip|rainy ?day)\b/i, "outings"],
  [/\b(childcare logistics|after ?school|daycare hours|work\w* parent|commut\w+)\b/i, "working_parent_logistics"],
  [/\b(just moved|new to (the )?area|moving here|relocat\w+)\b/i, "new_to_area_help"],
  [/\b(class|classes|lesson|lessons|activit\w+|club)\b/i, "activities"],
];

export function focusInQuestion(
  text: string,
  offered: ReadonlyArray<string>,
): string | null {
  for (const [pattern, focus] of FOCUS_WORDS) {
    if (pattern.test(text) && offered.includes(focus)) return focus;
  }
  return null;
}

/** Distance in bands, for 6.4's "similar but not identical". */
export function bandDistance(a: AgeBand, b: AgeBand): number {
  const i = AGE_BANDS.indexOf(a);
  const j = AGE_BANDS.indexOf(b);
  if (i < 0 || j < 0) return Number.POSITIVE_INFINITY;
  return Math.abs(i - j);
}

/**
 * The bands a set of birth years falls into, recomputed now.
 *
 * Takes birth years where `ageBandsOf` takes ages, and both read the same ladder
 * from `lib/age-bands.ts` — so there is no second copy for a test to hold
 * together. Recomputed rather than read, because the stored `age_range` edge is
 * written "as of capture": a toddler edge from February is a preschool child by
 * the summer.
 */
export function bandsForBirthYears(years: number[], now: Date): AgeBand[] {
  const bands = new Set<AgeBand>();
  const thisYear = now.getFullYear();
  for (const year of years) {
    for (const band of bandsForAge(thisYear - year)) bands.add(band);
  }
  return [...bands];
}

/**
 * 6.4 — similar but not identical.
 *
 * Two families are a full age match when they share a band, and a partial one
 * when their bands are next to each other: a 2-year-old and a 3-year-old are two
 * days apart in real life and fall either side of the toddler/preschool line. A
 * neighbouring band is worth **half** the weight, so "nearly the same stage"
 * ranks below "the same stage" and above a stranger.
 *
 * Families with several children take their **best** overlap rather than a sum —
 * otherwise a family with four children outranks a perfectly matched family with
 * one, which is a headcount and not a relevance.
 */
export function ageOverlap(a: AgeBand[], b: AgeBand[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  for (const x of a) {
    for (const y of b) {
      if (x === y) return 1;
      if (bandDistance(x, y) === 1) best = Math.max(best, 0.5);
    }
  }
  return best;
}

/** Symmetric lookup, built once per scoring run. */
function adjacencyIndex(pairs: MatchConfig["adjacency"]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!index.has(a)) index.set(a, new Set());
    index.get(a)!.add(b);
  };
  for (const { area_a, area_b } of pairs) {
    link(area_a, area_b);
    link(area_b, area_a);
  }
  return index;
}

/**
 * Which of a child-scoped edge's years the two families have in common.
 *
 * A shared school only means what §7.1 intends when the children are at it
 * together, so two families "at the same school" nine years apart score nothing
 * from it (13 Aug). **A null on either side is treated as a match**, not as a
 * miss: null means the household's, or that the parent skipped the "whose is it?"
 * question — and an unanswered question must never read as a denial.
 *
 * The tolerance is ±2 years, not exact: siblings a year apart are at the same
 * school in the way that matters, and demanding the same birth year would make
 * the strongest signal in the graph fire almost never.
 */
function childYearsMatch(a: number[] | null, b: number[] | null): boolean {
  if (a === null || b === null || a.length === 0 || b.length === 0) return true;
  return a.some((x) => b.some((y) => Math.abs(x - y) <= 2));
}

const CHILD_SCOPED = new Set(["school", "activity"]);

/**
 * Score one candidate against one asker.
 *
 * Exported on its own because it is the unit worth testing: a ranking is only as
 * trustworthy as one row of it.
 */
export function scorePerson(
  asker: Person,
  candidate: Person,
  config: MatchConfig,
  requirements: Requirements = {},
  now: Date = new Date(),
): ScoredPerson | null {
  /* Nobody is their own match. Cheap, and it would otherwise top every list. */
  if (candidate.person_id === asker.person_id) return null;

  const weight = (type: string) => config.weights[type] ?? 0;
  const reasons: ScoredPerson["reasons"] = [];
  let affinity = 0;

  /* 6.5 — hard excludes, and only what the request demanded. */
  for (const need of requirements.mustHave ?? []) {
    const has = candidate.edges.some(
      (e) =>
        e.affinity_type === need.affinity_type &&
        e.affinity_value === need.affinity_value,
    );
    if (!has) return null;
  }

  /* ── Layer one: shared connections (6.1) ──────────────────────────────── */
  const askerByType = new Map<string, Edge[]>();
  for (const e of asker.edges) {
    if (e.affinity_type === "age_range") continue; // recomputed below (6.4)
    const list = askerByType.get(e.affinity_type) ?? [];
    list.push(e);
    askerByType.set(e.affinity_type, list);
  }

  for (const e of candidate.edges) {
    if (e.affinity_type === "age_range") continue;
    const mine = askerByType.get(e.affinity_type);
    if (!mine) continue;
    const shared = mine.find((m) => m.affinity_value === e.affinity_value);
    if (!shared) continue;
    if (
      CHILD_SCOPED.has(e.affinity_type) &&
      !childYearsMatch(shared.child_birth_years, e.child_birth_years)
    ) {
      continue;
    }
    const points = weight(e.affinity_type);
    if (points <= 0) continue;
    affinity += points;
    reasons.push({ kind: e.affinity_type, value: e.affinity_value, points });
  }

  /* ── 6.3 — the adjacent credit, and never on top of the same-area one ──── */
  const sameArea =
    asker.neighborhood !== null && asker.neighborhood === candidate.neighborhood;
  if (!sameArea && asker.neighborhood && candidate.neighborhood) {
    const neighbours = adjacencyIndex(config.adjacency).get(asker.neighborhood);
    if (neighbours?.has(candidate.neighborhood)) {
      const points = weight("adjacent_neighborhood");
      if (points > 0) {
        affinity += points;
        reasons.push({
          kind: "adjacent_neighborhood",
          value: candidate.neighborhood,
          points,
        });
      }
    }
  }

  /* ── 6.4 — age, recomputed from birth years rather than read ───────────── */
  const askerBands =
    requirements.bands && requirements.bands.length > 0
      ? requirements.bands
      : bandsForBirthYears(asker.child_birth_years, now);
  const candidateBands = bandsForBirthYears(candidate.child_birth_years, now);
  const overlap = ageOverlap(askerBands, candidateBands);
  if (overlap > 0) {
    const points = weight("age_range") * overlap;
    if (points > 0) {
      affinity += points;
      reasons.push({
        kind: overlap === 1 ? "age_range" : "age_range_near",
        value: candidateBands.join("+"),
        points,
      });
    }
  }

  /* ── Layer two: life relevance, as a boost (6.2) ───────────────────────── */
  const step = config.relevanceStep ?? RELEVANCE_STEP;
  const mineRelevance = new Set(asker.relevance.map((r) => `${r.dimension}|${r.value}`));
  let relevance = 0;
  const countedDimensions = new Set<string>();
  for (const r of candidate.relevance) {
    if (!mineRelevance.has(`${r.dimension}|${r.value}`)) continue;
    /**
     * One point per **dimension**, not per value.
     *
     * `logistics` and `budget` are multi-select, so two parents who both ticked
     * four of the same logistics answers would otherwise collect four boosts
     * from one kind of similarity — and that is a chattier questionnaire, not a
     * better match.
     */
    if (countedDimensions.has(r.dimension)) continue;
    countedDimensions.add(r.dimension);
    relevance += step;
    reasons.push({ kind: `relevance:${r.dimension}`, value: r.value, points: step });
  }

  const score = affinity + relevance;
  if (score <= 0) return null;

  return { person_id: candidate.person_id, score, reasons, affinity, relevance };
}

export interface RankResult {
  ranked: ScoredPerson[];
  /**
   * 6.6 — cold start, reported rather than papered over.
   *
   * The estimate asks the mechanism to "tell the parent honestly" when too few
   * people qualify, so the shape has to carry that instead of returning a short
   * list and letting the caller guess whether it is short because the network is
   * thin or because the question was narrow. `wanted` is what the tier asked for.
   */
  cold: boolean;
  wanted: number;
  found: number;
}

/**
 * 6.5 — the ordered list.
 *
 * Ties break on affinity before relevance, and then on person id. The last one is
 * not arbitrary: an unstable order would make the admin harness (6.7) show a
 * different ranking each time it ran, and "did my weight change do anything"
 * becomes unanswerable. Rotation between equally suitable people is a *sending*
 * decision (strategy §6, M8) and deliberately not done here — a ranking that
 * shuffles itself cannot be reviewed.
 */
export function rankCandidates(
  asker: Person,
  candidates: Person[],
  config: MatchConfig,
  options: { wanted?: number; requirements?: Requirements; now?: Date } = {},
): RankResult {
  const wanted = options.wanted ?? 5;
  const now = options.now ?? new Date();
  const scored: ScoredPerson[] = [];
  for (const c of candidates) {
    const s = scorePerson(asker, c, config, options.requirements ?? {}, now);
    if (s) scored.push(s);
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.affinity - a.affinity ||
      b.relevance - a.relevance ||
      a.person_id.localeCompare(b.person_id),
  );
  return {
    ranked: scored,
    cold: scored.length < wanted,
    wanted,
    found: scored.length,
  };
}
