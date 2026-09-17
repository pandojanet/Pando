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
  /**
   * Where this place is, as Google gave it.
   *
   * ⚠⚠ **This is what makes "search inside the neighborhood" possible at all,
   * and until 17 Sep it was not parsed.** The developer's instruction is that a
   * parent who picks Detroit then gets Detroit's schools — and every
   * establishment lookup was biased to a rectangle around the San Gabriel
   * Valley, hard-coded, because `MARKETS` has one entry and an unknown market
   * falls back to it. A Detroit parent typing a school name was asking Google
   * to rank answers around Pasadena.
   *
   * So the centre rides on the place the parent chose, and `lookupPlaces`
   * biases the *next* question's search to a circle around it.
   *
   * ⚠ Null on a row parsed before this shipped — the cache holds whole places
   * as jsonb, so a 30-day-old row comes back without them. A missing centre
   * falls back to the market box, which is exactly today's behaviour, so the
   * cache heals itself rather than needing a purge.
   *
   * ⚠ And it is deliberately **not** read for an establishment: the bias needs
   * the centre of the *neighborhood*, never of each school, and asking Places
   * for `places.location` would widen a field mask that is a billing decision.
   */
  lat: number | null;
  lng: number | null;
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
  geometry?: unknown;
}

/**
 * The centre of a geocoded result, or nulls.
 *
 * ⚠ Bounds-checked rather than merely typed. `0, 0` is a valid float and a
 * point in the Atlantic, and a bias centred there would quietly rank every
 * school on earth equally — a wrong answer that looks like a working feature,
 * which is the failure this file keeps refusing elsewhere (`place_type`,
 * `includedType`). A result whose geometry is missing or malformed gets no
 * centre and falls back to the market box.
 */
function readCentre(v: unknown): { lat: number | null; lng: number | null } {
  const none = { lat: null, lng: null };
  if (typeof v !== "object" || v === null) return none;
  const loc = (v as { location?: unknown }).location;
  if (typeof loc !== "object" || loc === null) return none;
  const lat = (loc as { lat?: unknown }).lat;
  const lng = (loc as { lng?: unknown }).lng;
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return none;
  if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) return none;
  if (lat === 0 && lng === 0) return none;
  return { lat, lng };
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
  /**
   * Keep results outside the United States.
   *
   * ⚠⚠ **Off by default, and the default is the safe half.** The question this
   * reader was written for is *where do you live*, whose footprint is one
   * American county with a five-digit postcode under it — a Canadian match
   * there is a row a parent cannot act on and a pending option nobody can
   * promote.
   *
   * `previous_places` is the exact opposite and is why this exists: *"where
   * have you lived before?"* is answered by London, Lagos and Toronto far more
   * often than by anywhere in this county. Shipped on 16 Sep with the country
   * filter removed from the **request** and still in force in the **reader**,
   * so Google was asked worldwide, answered, and every row was dropped — an
   * empty list indistinguishable from *no such place*. Two halves of one rule,
   * one updated and one not, failing silently: the shape this repository keeps
   * paying for.
   */
  worldwide?: boolean;
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
    /* Only the US, unless the caller asked for anywhere — see `worldwide`. The
       footprint is one American county and the ZIP question under it is a
       five-digit American postcode, so a Canadian match on *that* question is a
       row a parent cannot act on and a pending option nobody can promote. */
    if (!opts.worldwide && country !== null && country !== "US") continue;
    const outsideUs = country !== null && country !== "US";
    const countryName = componentValue(components, "country");

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
      /**
       * ⚠ Abroad the **country** disambiguates, not the region or the postcode.
       * Measured on the live endpoint: Lagos came back under "LA" — which an
       * English reader takes for Los Angeles or Louisiana — and Kyiv under
       * "Kyiv city 02000". Both are the honest content of
       * `administrative_area_level_1` and neither tells a parent which of two
       * Londons they are tapping, which is the only job this line has.
       */
      where: outsideUs && countryName
        ? whereLine({ name: parts.name, city: parts.city, state: countryName, zip: null })
        : whereLine({ name: parts.name, city: parts.city, state, zip }),
      type: placeTypeFor(result, parts),
      city: parts.city,
      neighborhood: parts.neighborhood,
      zip,
      state,
      county: componentValue(components, "administrative_area_level_2"),
      inMarket,
      /* The state rides along out of market, because "Pasadena" on its own in
         the pending queue is a row an admin cannot safely promote — and outside
         the US it is the **country** that disambiguates, not the region: an
         admin reading "London, England" has to know that England is an
         `administrative_area_level_1`, while "London, United Kingdom" is a row
         they can promote without looking anything up. */
      storedValue: outsideUs && countryName
        ? `${parts.name}, ${countryName}`
        : inMarket || !state
          ? parts.name
          : `${parts.name}, ${state}`,
      ...readCentre(result.geometry),
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

/* ── an establishment: a school, a class, a club, a place of worship ───────── */

/**
 * ## 16 Sep — Google for the rest of the directories, and why it is a second API
 *
 * The developer's instruction was to integrate Google *"for places, schools and
 * so on — for everything"*. The first thing to know is that the layer above
 * cannot do it: the **Geocoding** API resolves an address, so asking it about
 * "Field Elementary" returns a street, a route, or nothing at all. A named
 * establishment is the **Places** API's question (`places:searchText`) — a
 * different endpoint, a different response shape, and a different bill, roughly
 * six times a geocode per call. That is why `worthPlaceSearch` exists beside
 * `worthGeocoding` rather than being folded into it.
 *
 * What is deliberately shared is everything below the request: one `placeKey`
 * fold, one failure vocabulary, one freshness clock, one cache. Two modules
 * would have been two of each, and the pair that drifts is always the one
 * nobody is looking at.
 *
 * ## The refusal this rests on, and it is the same one as `place_type`
 *
 * **A Google result never says which of Pando's categories it belongs to.**
 * Google answers `types: ["primary_school", "school", …]`, while the client's
 * own taxonomy distinguishes a preschool from a daycare from an elementary
 * school, carries an entity type, an operational status and a curated starter
 * flag, and was imported from her sheets (`taxonomy:import`, 588 records).
 * Mapping `school` onto `schools` looks harmless and then writes a fact nobody
 * stated onto every record a parent adds — which is exactly what §5 spent
 * 14 Sep refusing to do for `place_type`, and what this file's own header
 * refuses for a town.
 *
 * So the category comes from **the question the parent was answering**, which
 * is the only honest source of it: they were on the schools question, so it is
 * filed as a school. `GeocodedPlace.type` stays `null` here for the same reason
 * it is null for an unincorporated community — there is no field for it and
 * there must not be one.
 *
 * ⚠ **And no `includedType` on the request either.** Constraining the search to
 * Google's `school` would hide a preschool Google files under
 * `child_care_agency` and a class it files under `gymnastics_club` — a filter
 * that removes correct answers, which is the rule this app states everywhere
 * else as *rank, never filter*. The parent's own words carry the subject; the
 * market carries the location bias, and that is the whole of the narrowing.
 */

/** A name that is worth paying Places for. */
export function worthPlaceSearch(query: string): boolean {
  const q = query.trim();
  /**
   * ⚠ Three letters, and **never a bare number**, which is where this differs
   * from `worthGeocoding`: there a whole ZIP is the most precise question a
   * parent can ask, and here it is the least — "91001" in the schools box asks
   * Google for whatever sits near a postcode, which is a paid answer to a
   * question nobody asked. A parent looking for a school types its name.
   */
  if (/^\d+$/.test(q)) return false;
  return q.length >= 3;
}

/** How many establishment rows a parent is offered. */
export const PLACE_SEARCH_LIMIT = 4;

interface RawNewComponent {
  longText?: unknown;
  shortText?: unknown;
  types?: unknown;
}

interface RawPlace {
  displayName?: unknown;
  formattedAddress?: unknown;
  addressComponents?: unknown;
}

export interface PlaceSearchOptions {
  /** Two-letter code. Decides `inMarket`, which ranks and never filters. */
  marketState?: string;
  limit?: number;
  /**
   * Does this name read as an individual person?
   *
   * ⚠ **A required argument, never an import**, for the two reasons
   * `public-info.ts` states for the same check: it keeps this module free of
   * runtime imports so `npm run test:geo` can load it in plain node, and it
   * makes the decision impossible for a call site to forget.
   *
   * The caller passes the **strong** half of `looksLikePerson` — an honorific
   * or a bare possessive — because that is the threshold measured as safe to
   * refuse on (11.4: the weak signal flags 16 of 588 real records, "Marshall
   * Fundamental" and "Altadena Stables" among them). A Google search for a
   * child's after-school teacher would otherwise offer "Ms. Diane" as a school
   * to add, which is a named individual entering the graph through a door with
   * none of invariants 1, 2, 12 or 13 on it.
   */
  isPerson: (name: string) => boolean;
}

/**
 * Turn one `places:searchText` response into places, or into a named failure.
 *
 * Unlike Geocoding — which answers 200 with a `status` string — Places (New)
 * reports faults as HTTP codes with an `error` object, so most failures are
 * already decided by the time a body reaches here. What this still has to catch
 * is an error body arriving with a 200, which is why `error.status` is read at
 * all rather than assumed away.
 */
export function readPlaceSearch(
  body: unknown,
  opts: PlaceSearchOptions,
): GeocodeOutcome {
  const marketState = (opts.marketState ?? "CA").toUpperCase();
  const limit = opts.limit ?? PLACE_SEARCH_LIMIT;

  if (typeof body !== "object" || body === null) return { ok: false, reason: "unavailable" };

  const err = (body as { error?: unknown }).error;
  if (typeof err === "object" && err !== null) {
    const status = str((err as { status?: unknown }).status);
    if (status === "PERMISSION_DENIED" || status === "UNAUTHENTICATED") {
      return { ok: false, reason: "denied" };
    }
    if (status === "RESOURCE_EXHAUSTED") return { ok: false, reason: "over_limit" };
    if (status === "INVALID_ARGUMENT") return { ok: false, reason: "bad_request" };
    return { ok: false, reason: "unavailable" };
  }

  const raw = (body as { places?: unknown }).places;
  /**
   * ⚠ **A missing `places` key is an empty answer, not a fault**, and it is the
   * one place the two APIs disagree in a way worth writing down: Geocoding says
   * `ZERO_RESULTS` out loud, while Places (New) simply omits the array. A body
   * with neither `error` nor `places` is Google saying it knows nothing — a
   * real answer, and worth caching. That is the `{ ok: true, places: [] }` this
   * file's header insists on keeping apart from a failure.
   */
  if (raw === undefined || raw === null) return { ok: true, places: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "unavailable" };

  const out: GeocodedPlace[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const place = entry as RawPlace;

    const display = place.displayName;
    const name =
      typeof display === "object" && display !== null
        ? str((display as { text?: unknown }).text)
        : str(display);
    /* Dropped rather than repaired: a row with no name is a row with nothing to
       show a parent and nothing to store. */
    if (!name) continue;

    /* The refusal above, applied before anything else is read about the row. */
    if (opts.isPerson(name)) continue;

    const components: RawNewComponent[] = Array.isArray(place.addressComponents)
      ? (place.addressComponents as RawNewComponent[])
      : [];
    const pick = (type: string, form: "long" | "short" = "long"): string | null => {
      for (const c of components) {
        if (typesOf(c.types).includes(type)) {
          return str(form === "short" ? c.shortText : c.longText);
        }
      }
      return null;
    };

    const city = pick("locality") ?? pick("postal_town");
    const state = pick("administrative_area_level_1", "short");
    const zip = readZip(pick("postal_code"));

    const key = placeKey(name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);

    /**
     * Google's own one-line address, and it is the disambiguator rather than
     * decoration: three "The Little Gym"s inside one market is the ordinary
     * case, and a list of three identical names is worse than no list. It falls
     * back to the composed line when `formattedAddress` is absent, so a row
     * never loses its only means of being told apart.
     */
    const address = str(place.formattedAddress);
    const where = address ?? whereLine({ name, city, state, zip });

    out.push({
      key,
      name,
      where,
      /* Null, always. See the section header: Google cannot say which of
         Pando's categories this is, and the question already knows. */
      type: null,
      city,
      neighborhood: null,
      zip,
      state,
      county: null,
      inMarket: (state ?? "").toUpperCase() === marketState,
      /**
       * The name, with the town when the place is outside the market — the same
       * rule the geocoder follows, and for the same reason: "The Little Gym"
       * alone in the pending queue is a row an admin cannot safely promote,
       * while "The Little Gym, Monrovia" is one they can.
       */
      storedValue:
        city && (state ?? "").toUpperCase() !== marketState
          ? `${name}, ${city}`
          : name,
      /* ⚠ Never read for an establishment — see `GeocodedPlace.lat`. The bias
         is centred on the *neighborhood*, and asking Places for
         `places.location` would widen the field mask for nothing. */
      lat: null,
      lng: null,
    });

    if (out.length >= limit) break;
  }

  return { ok: true, places: out };
}

/* ── which Google question a directory asks ────────────────────────────────── */

/**
 * Which question is asked of Google, per directory.
 *
 * Three kinds, because the three are genuinely different requests rather than
 * one request with a flag: `place` geocodes inside the market, `world` geocodes
 * with no country and no bounds at all, and `establishment` is a Places text
 * search. See `lib/server/geocode.ts` for the shapes.
 */
export type LookupKind = "place" | "world" | "establishment";

/**
 * ⚠ **Named per category, never derived** — the rule `dropdown` already states
 * one file along, after the first cut of *that* one said "everywhere except
 * `wholeList`" and swept in a question nobody had asked about.
 *
 * Deciding by absence would be worse here than there, because the thing on the
 * other side is billed: a directory added tomorrow would start paying Google on
 * the day it was added, with nothing on any screen looking different.
 *
 * `parent_groups` is the one directory with **no** entry and that is the whole
 * point of returning null: a WhatsApp group for the mums at a preschool is not
 * a place on a map, and asking Google about one buys a coffee shop with a
 * similar name. The taxonomy's own answer — a curated list plus a typed
 * "+ Something else" — is the right one there.
 */
/**
 * ## 17 Sep — offering options rather than waiting to be typed at
 *
 * The developer, after picking Detroit on the neighborhood question and
 * finding the schools box empty: *"всі школи, активності мають шукатись по
 * цьому нейборхуду, так як в нас локально підтягується … пропонувати декілька
 * опцій з цього нейборхуду"*.
 *
 * Until now Google was asked **only** on a typed query of three letters or
 * more, and only once the local directory had answered nothing. That is right
 * for a parent in Pasadena, where eight curated starters are already on screen
 * — and it is an empty screen for a parent anywhere else, because the curated
 * list is one market and there is nothing to fall back to.
 *
 * So a directory with no curated starters for this parent's place asks Google
 * for a handful up front, in **our** words rather than theirs.
 *
 * ⚠⚠ **Rewriting the query is forbidden elsewhere and is the whole mechanism
 * here, and the difference is whose words they are.** `web-search.ts` records
 * why: *"the parent's own words are what a search engine reads best, and
 * rewriting them is how a question about swim classes quietly becomes one
 * about swimming pools."* That rule protects a sentence somebody typed. In
 * suggestion mode nobody has typed anything — the question on screen is the
 * only subject there is, so naming it is the honest query rather than a
 * rewrite of one. The moment a parent types, their words are used untouched
 * and this vocabulary is not consulted.
 *
 * ⚠ **Still no `includedType`.** Constraining to Google's `school` hides a
 * preschool it files under `child_care_agency`; the phrasing below leans the
 * ranking the same way without removing a correct answer, which is this app's
 * rule everywhere: *rank, never filter*.
 */
const SUGGEST_QUERY: Record<string, string> = {
  schools: "schools, preschools and daycares",
  baby_activities: "kids classes and activities",
  clubs: "kids clubs, sports and leagues",
  worship: "churches, synagogues and mosques",
  camps: "kids camps",
};

/**
 * What to ask Google when a parent has typed nothing, or null for a directory
 * that has no such question.
 *
 * ⚠ Keyed by the same category strings `lookupKindFor` names one by one, and
 * for the same reason: a directory reaches Google only by being written down
 * here, so widening the bill is a deliberate line in a diff rather than a
 * pattern somebody's new category quietly matches.
 */
export function suggestQueryFor(category: string): string | null {
  return SUGGEST_QUERY[category] ?? null;
}

/**
 * How many options a cold directory offers.
 *
 * Eight rather than `PLACE_SEARCH_LIMIT`'s four: this is standing in for the
 * curated chip list, which the client curates at **eight per area** for
 * schools, so the same handful is what a parent outside the market should
 * meet. A typed search stays at four — there the parent has named the thing
 * and a long list is noise.
 */
export const SUGGEST_LIMIT = 8;

export function lookupKindFor(category: string): LookupKind | null {
  switch (category) {
    /* Where a parent lives: her seventeen towns, then the 52 places and 62 ZIPs
       in the bundle, then this. */
    case "neighborhoods":
      return "place";
    /* Where they lived before, which is frequently neither in this market nor
       in this country. */
    case "previous_places":
      return "world";
    /* Named things: the five directories a parent picks a record from. */
    case "schools":
    case "baby_activities":
    case "clubs":
    case "worship":
    case "camps":
      return "establishment";
    default:
      return null;
  }
}
