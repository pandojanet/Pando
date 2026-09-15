import type { PlaceType } from "./home-places";

/**
 * Reading a Google Geocoding answer into Pando's own vocabulary.
 *
 * `lib/home-places.ts` is the client's §5 table as data — 52 places and 62 ZIPs,
 * hand-transcribed and exhaustive *for the footprint she scoped*. It is
 * deliberately closed: a ZIP outside it resolves to nothing, and `searchPlaces`
 * answers a name it has never heard of with an empty list. That is correct for
 * matching and wrong for the one screen where a parent types where they live,
 * because the product's own answer to an out-of-footprint parent is **not** to
 * turn them away — `isSupportedZip` "is not a gate", and the whole reason is
 * that a parent Pando cannot serve yet is the demand signal saying where to
 * open next. Until now they met *"Nothing matching '91011'."*
 *
 * So this module is the other half: what to do when the closed list misses.
 *
 * ## Pure, and that is not a style preference
 *
 * No runtime imports at all — `PlaceType` is a type-only import, which erases —
 * so `node --experimental-strip-types` can load it and `npm run test:geo` can
 * put a recorded Google response through every branch. The same property
 * `matching.ts`, `payments.ts`, `home-places.ts` and `public-info.ts` keep, for
 * the same reason each time: everything that decides what a parent's answer
 * *means* has to be testable exhaustively, and a module that needs a network
 * call cannot be.
 *
 * ⚠ It is also what keeps the person check out of here. `lib/server/geocode.ts`
 * does the one HTTP call and nothing else; every judgement about what came back
 * is in this file, where it can be argued with.
 *
 * ## Three things Google's vocabulary can say, and one it cannot
 *
 * The API answers with `address_components`, each carrying `types`. What maps
 * cleanly onto Pando:
 *
 * - **`postal_code`** → the ZIP, which is what §5 is built on.
 * - **`locality`** → the town. This is the common case and the useful one.
 * - **`neighborhood` / `sublocality`** → a named area inside a town. Where that
 *   town is Los Angeles this *is* Pando's `la_neighborhood` — Eagle Rock and
 *   Highland Park, two of the five western places, come back exactly this way.
 *
 * ⚠⚠ **What it cannot say is `unincorporated`, and pretending otherwise is the
 * one tempting mistake here.** Google returns Altadena as a `locality` and
 * Pasadena as a `locality`; the distinction between an incorporated city and a
 * census-designated place is not in the response at all. Sixteen of the
 * client's 52 places are unincorporated, so a parser that mapped `locality` →
 * `"city"` would be writing a fact nobody stated onto roughly a third of
 * everything it resolves — the fault this repository has paid for repeatedly
 * (`freshness_state` read from a column nothing maintained; `requires_human_review`
 * describing a state nothing cleared). So `type` is **`null` whenever it is not
 * knowable**, and naming it is a judgement left to whoever promotes the place.
 *
 * ## Nothing here is written to `market_options`, and that is invariant 9
 *
 * *"Other answers are not matchable until an admin promotes them."* A geocoded
 * place has been verified by Google and by nobody at Pando, so it takes exactly
 * the path a typed answer already takes: it is stored as the parent's own
 * answer, it lands in `pending_options`, and it becomes matchable when a person
 * says so. ⚠ `key` exists to de-duplicate a result list and to notice that a
 * place is one Pando already has — it is **never stored**, because a slug is
 * what `market_options` keys on and writing one here would be promotion by the
 * back door. What gets stored is `storedValue`, a name.
 */

/** The statuses the Geocoding API answers with. Ours, not Google's, is the last. */
export type GeocodeFailure =
  /** `REQUEST_DENIED` — a bad key, or the API not enabled on the project. */
  | "denied"
  /** `OVER_QUERY_LIMIT` — the billing ceiling, or the per-second rate. */
  | "over_limit"
  /** `INVALID_REQUEST` — we built the query wrong. A bug, not a parent's typo. */
  | "bad_request"
  /** `UNKNOWN_ERROR`, a 5xx, a timeout, or a body that is not what it claims. */
  | "unavailable";

/**
 * One place Google recognised.
 *
 * Every field is either read straight out of the response or left null. Nothing
 * here is inferred, rounded or filled in — the rule `readFindings` already
 * follows for the web search: **drop rather than repair**, so a missing detail
 * is a page that did not say it rather than a guess wearing a fact's clothes.
 */
export interface GeocodedPlace {
  /**
   * A stable key for this result, folded the way `import-taxonomy.mjs` folds a
   * slug so it lines up with `market_options` when the place turns out to be
   * one Pando already has.
   *
   * ⚠ **Never stored.** See the header: writing this into `market_options`
   * would make a Google result matchable without anybody at Pando having looked
   * at it, which is invariant 9 with an extra step.
   */
  key: string;
  /** What the parent reads: "La Cañada Flintridge", "Eagle Rock". */
  name: string;
  /**
   * The line under the name, and it is load-bearing rather than decoration.
   *
   * Two "Pasadena"s exist and one of them is in Texas; a geocoder biased toward
   * the market still returns the other one when the market has no match. A row
   * that says only "Pasadena" gives a parent no way to tell which they tapped.
   */
  where: string;
  /** ⚠ Null wherever Google cannot say — see the header. Never guessed. */
  type: PlaceType | null;
  /** The town this sits in, where the result is a neighborhood inside one. */
  city: string | null;
  neighborhood: string | null;
  /** Five digits, or null when the result is a town rather than a postcode. */
  zip: string | null;
  /** Two letters, as Google's `short_name` gives it. */
  state: string | null;
  county: string | null;
  /**
   * The state matches the market's. **Ranking, never filtering** — the rule
   * `/api/market/search` already follows for the home area, and here it earns
   * itself twice over: a family that has genuinely just moved from Portland
   * must be able to name where they came from, and an out-of-state row that is
   * simply wrong is told apart by `where` rather than by being hidden.
   */
  inMarket: boolean;
  /**
   * What is written down if the parent picks this.
   *
   * A **name**, never a slug, for the reason in the header — and it carries the
   * state when the place is out of market, because "Pasadena" alone in the
   * pending queue is a row an admin cannot safely promote.
   */
  storedValue: string;
}

export type GeocodeOutcome =
  /**
   * Google answered. `places` may be empty, and that is a real answer: it means
   * *no such place*, which is worth caching and worth saying.
   */
  | { ok: true; places: GeocodedPlace[] }
  /**
   * Google did not answer, or answered with a fault of ours.
   *
   * ⚠ Kept apart from `{ ok: true, places: [] }` deliberately, and this is the
   * 9 Sep lesson stated before it can be repeated: `PublicSearchResult.configured`
   * was computed and read by nobody, so *"the search did not run"* and *"the
   * search found nothing"* were indistinguishable downstream — the
   * `persisted: false` honesty rule inverted. A failure must never be cached
   * and must never reach a parent as "there is no such place".
   */
  | { ok: false; reason: GeocodeFailure };

/* ── reading the response ──────────────────────────────────────────────────── */

interface RawComponent {
  long_name?: unknown;
  short_name?: unknown;
  types?: unknown;
}

interface RawResult {
  address_components?: unknown;
  formatted_address?: unknown;
  types?: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const typesOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];

/**
 * The same fold `import-taxonomy.mjs` uses, character for character.
 *
 * ⚠ It has to be, or a geocoded "La Cañada Flintridge" would key as something
 * other than the `la-canada-flintridge` already in `market_options` and the
 * de-duplication below would offer a parent a place that is on screen two
 * inches above. Diacritics fold because nobody reaches for `ñ` on a phone.
 */
export function placeKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Five digits. ZIP+4 is truncated, anything else is not a ZIP. */
export function readZip(raw: string | null | undefined): string | null {
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(raw ?? "");
  return m ? m[1] : null;
}

/** A query that is five digits is a postcode lookup, and takes a different request. */
export function looksLikeZip(query: string): boolean {
  return /^\s*\d{5}\s*$/.test(query);
}

/**
 * Is this query worth paying for?
 *
 * The guard that keeps a billed call off the keystroke path, and the case it
 * exists for is not hypothetical: a parent typing `91011` passes through `9`,
 * `91`, `910` and `9101` on the way, and every one of those is a query the
 * local list answers with nothing. Without this, one ZIP costs five lookups —
 * four of them for strings that cannot mean a place.
 *
 * ⚠ **A partial number is the whole point.** `searchPlaces` already declines to
 * name-match a bare number for the same reason one level down ("three or four
 * digits is a ZIP being typed, not a name"), and the rule has to be repeated
 * here rather than inferred, because the cost of getting it wrong is different:
 * there it was a list of noise, here it is the invoice.
 *
 * Kept pure and beside the parser so `npm run test:geo` walks it, rather than
 * living as a condition inside a `useEffect` where it fails silently — the
 * `lib/starters.ts` lesson, which this repository has paid for twice.
 */
export function worthGeocoding(query: string): boolean {
  const q = query.trim();
  if (q.length < 2) return false;
  /* All digits: only a whole postcode. Anything shorter is one still being
     typed, anything longer is not a US ZIP. */
  if (/^\d+$/.test(q)) return q.length === 5;
  /* A name needs enough of itself to mean something. Two letters is "LA" and
     also the first half of every town in the county. */
  return q.length >= 3;
}

function componentValue(
  components: RawComponent[],
  type: string,
  form: "long" | "short" = "long",
): string | null {
  for (const c of components) {
    if (typesOf(c.types).includes(type)) {
      return str(form === "short" ? c.short_name : c.long_name);
    }
  }
  return null;
}

/**
 * Which of the components is the thing the parent means.
 *
 * Order matters and is not arbitrary: a postcode result carries *both* a
 * `postal_code` and a `locality`, and the town is the answer — a row reading
 * "91011" tells a parent nothing they did not just type. The neighborhood wins
 * over the locality only when it is a real named area inside a town, which is
 * how Eagle Rock is reachable at all.
 */
function primaryName(components: RawComponent[]): {
  name: string | null;
  neighborhood: string | null;
  city: string | null;
} {
  const neighborhood =
    componentValue(components, "neighborhood") ??
    componentValue(components, "sublocality_level_1") ??
    componentValue(components, "sublocality");
  const city =
    componentValue(components, "locality") ??
    /* Some unincorporated communities carry no `locality` at all and arrive as
       a level-3 area instead. Reading it is what keeps them findable; it is
       still not evidence of being unincorporated — see the header. */
    componentValue(components, "administrative_area_level_3");

  return { name: neighborhood ?? city, neighborhood, city };
}

/**
 * `la_neighborhood` where Google says so, and `null` everywhere else.
 *
 * ⚠ **A neighborhood of any town other than Los Angeles is deliberately not a
 * type here.** Pando calls those *districts* — Bungalow Heaven, Linda Vista,
 * San Rafael — and a district is not a `Place`: it lives in `market_options`
 * with an `area_slug` pointing at its city, which is the roll-up the 9 Sep
 * matching fix rests on. Typing one would claim a shape the data does not have.
 */
function placeTypeFor(
  result: RawResult,
  parts: { neighborhood: string | null; city: string | null },
): PlaceType | null {
  const types = typesOf(result.types);
  const isNeighborhood =
    types.includes("neighborhood") ||
    types.includes("sublocality") ||
    types.includes("sublocality_level_1");

  if (isNeighborhood && parts.neighborhood && parts.city === "Los Angeles") {
    return "la_neighborhood";
  }
  /* Everything else is unknowable from this response, including the whole of
     `city` vs `unincorporated`. Stated in the header; not guessed here. */
  return null;
}

/** "CA 91011" · "Los Angeles, CA" · "Pasadena, TX" — whatever tells two apart. */
function whereLine(parts: {
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string {
  const bits: string[] = [];
  if (parts.city && parts.city !== parts.name) bits.push(parts.city);
  if (parts.state) bits.push(parts.state);
  const head = bits.join(", ");
  return parts.zip ? (head ? `${head} ${parts.zip}` : parts.zip) : head;
}

export interface ReadOptions {
  /**
   * The state the market is in, as a two-letter code. Decides `inMarket`, which
   * ranks and never filters.
   */
  marketState?: string;
  /** Results to keep. A parent choosing where they live is not browsing. */
  limit?: number;
}

/**
 * Turn one Geocoding response body into places, or into a named failure.
 *
 * `body` is `unknown` on purpose: this is a third party's JSON, and every field
 * it claims is checked rather than trusted. A result that carries no usable
 * name is **dropped**, not repaired — the same rule as `readFindings`.
 */
export function readGeocode(body: unknown, opts: ReadOptions = {}): GeocodeOutcome {
  const marketState = (opts.marketState ?? "CA").toUpperCase();
  const limit = opts.limit ?? 5;

  if (typeof body !== "object" || body === null) return { ok: false, reason: "unavailable" };
  const status = str((body as { status?: unknown }).status);

  if (status === "ZERO_RESULTS") return { ok: true, places: [] };
  if (status === "REQUEST_DENIED") return { ok: false, reason: "denied" };
  if (status === "OVER_QUERY_LIMIT") return { ok: false, reason: "over_limit" };
  if (status === "INVALID_REQUEST") return { ok: false, reason: "bad_request" };
  if (status !== "OK") return { ok: false, reason: "unavailable" };

  const raw = (body as { results?: unknown }).results;
  if (!Array.isArray(raw)) return { ok: false, reason: "unavailable" };

  const places: GeocodedPlace[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const result = entry as RawResult;
    const components = Array.isArray(result.address_components)
      ? (result.address_components as RawComponent[])
      : [];
    if (components.length === 0) continue;

    const country = componentValue(components, "country", "short");
    /* Only the US. The footprint is one American county and the ZIP question
       under it is a five-digit American postcode; a Canadian match would be a
       row a parent cannot act on and a pending option nobody can promote. */
    if (country !== null && country !== "US") continue;

    const parts = primaryName(components);
    /* No name, no row. A result that is only a county or only a country is
       real and is not an answer to "where do you live". */
    if (!parts.name) continue;

    const state = componentValue(components, "administrative_area_level_1", "short");
    const zip = readZip(componentValue(components, "postal_code"));
    const inMarket = state !== null && state.toUpperCase() === marketState;

    const key = placeKey(parts.name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);

    places.push({
      key,
      name: parts.name,
      where: whereLine({ name: parts.name, city: parts.city, state, zip }),
      type: placeTypeFor(result, parts),
      city: parts.city,
      neighborhood: parts.neighborhood,
      zip,
      state,
      county: componentValue(components, "administrative_area_level_2"),
      inMarket,
      /* The state rides along out of market, because "Pasadena" on its own in
         the pending queue is a row an admin cannot safely promote. */
      storedValue: inMarket || !state ? parts.name : `${parts.name}, ${state}`,
    });
  }

  /* In-market first, and stably — the same ranking rule the directory search
     uses for the home area, and for the same reason: never a filter. */
  const ranked = [
    ...places.filter((p) => p.inMarket),
    ...places.filter((p) => !p.inMarket),
  ];
  return { ok: true, places: ranked.slice(0, limit) };
}

/* ── the cache clock ───────────────────────────────────────────────────────── */

/**
 * How long a cached answer stands.
 *
 * A town does not move, so a hit is good for a month — long enough that a
 * market's worth of parents pays for each place once. ⚠ A **miss** expires much
 * sooner and the asymmetry is the point: `ZERO_RESULTS` is frequently a typo,
 * which is harmless to keep, but it is sometimes a place Google learned about
 * last week, and caching that answer for a month would make Pando wrong for a
 * month with nothing on screen saying so.
 */
export const GEOCODE_TTL_DAYS = 30;
export const GEOCODE_MISS_TTL_DAYS = 7;

export function isFresh(
  row: { places: unknown[]; fetchedAt: Date | string },
  now: Date = new Date(),
): boolean {
  const at = row.fetchedAt instanceof Date ? row.fetchedAt : new Date(row.fetchedAt);
  if (Number.isNaN(at.getTime())) return false;
  const days = row.places.length > 0 ? GEOCODE_TTL_DAYS : GEOCODE_MISS_TTL_DAYS;
  return now.getTime() - at.getTime() < days * 24 * 60 * 60 * 1000;
}

/**
 * The cache key.
 *
 * Folded so "La Cañada", "la canada" and "  LA CANADA  " are one paid lookup
 * rather than three. ⚠ Bounded to the same 60 characters the endpoint accepts,
 * so a crafted caller cannot fill the table with long strings — the column
 * carries the same CHECK, because a bound enforced in one place is a bound
 * until somebody adds a second caller.
 */
export function cacheKey(query: string): string {
  return query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
