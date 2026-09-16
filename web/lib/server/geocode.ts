import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { looksLikePerson } from "@/lib/named-person";
import {
  PLACE_SEARCH_LIMIT,
  cacheKey,
  isFresh,
  looksLikeZip,
  readGeocode,
  readPlaceSearch,
  worthGeocoding,
  worthPlaceSearch,
  type GeocodeFailure,
  type GeocodedPlace,
  type LookupKind,
} from "@/lib/geo";

/**
 * The **only** place Pando talks to Google.
 *
 * Same shape as `lib/server/stripe.ts`: one caller, plain `fetch`, no SDK. A
 * client library here would bring its own retry policy, its own timeout and its
 * own idea of what an error is, on a path where all three are decisions this
 * file is making deliberately.
 *
 * `lib/geo.ts` holds every judgement about what came back. This holds the
 * request, the clock and the money.
 *
 * ## Two Google APIs, one module (16 Sep)
 *
 * The file is still called `geocode.ts` and now makes two different requests,
 * because the developer's *"integrate Google for places, schools and so on"*
 * cannot be answered by one:
 *
 * - **Geocoding** (`maps.googleapis.com/maps/api/geocode/json`) resolves a
 *   town, a neighborhood or a postcode. It is what `kind: "place"` and
 *   `kind: "world"` ask.
 * - **Places Text Search** (`places.googleapis.com/v1/places:searchText`) is
 *   the only one that can find a *named establishment* — a school, a class, a
 *   club, a place of worship. A geocoder handed "Field Elementary" answers with
 *   a street or with nothing.
 *
 * They share this file on purpose: one timeout, one cost policy, one cache, one
 * log rule, one place to look. Two modules would have been two of each, and the
 * copy that drifts is always the one nobody is reading.
 *
 * ## Inert without a key, and it says so rather than pretending
 *
 * No `GOOGLE_MAPS_API_KEY` ⇒ `{ ok: false, reason: "not_configured" }`, which
 * the endpoint passes through and the screen renders as *nothing at all* —
 * exactly what a parent sees today. The honesty rule this whole app is built on
 * (`persisted: false`, `sendSms`'s `not_provisioned`, `/admin/delivery` naming
 * an unconfigured Stripe before it shows a total): never report an empty answer
 * for a question that was never asked.
 *
 * ⚠⚠ **And "not configured" is kept apart from "found nothing" all the way to
 * the screen.** That is the 9 Sep fault written down before it can be repeated:
 * `PublicSearchResult.configured` was computed, carried and read by nobody, so
 * a search that never ran and a search that found nothing were the same thing
 * downstream. Here the three states have three different sentences.
 *
 * ## What it costs, and the three things that bound it
 *
 * Both APIs are billed per request, and Places is the dearer of the two —
 * roughly six times a geocode, because a text search returns records rather
 * than coordinates. Three bounds, and none is optional:
 *
 * 1. **It only runs on a miss.** `SearchableChipGroup` asks the curated
 *    starters first, then the market's own directory, and comes here only when
 *    both have answered nothing. Most parents' text never leaves the building.
 * 2. **Every answer is cached in Postgres**, keyed on the folded query and the
 *    kind of question, never on the person, so the second parent to type a ZIP
 *    or a school costs nothing. A miss is cached too: without that, one typo is
 *    a paid lookup on every keystroke of every session that ever repeats it.
 * 3. **The query has to be worth asking about.** `worthGeocoding` declines the
 *    four fragments on the way to a postcode; `worthPlaceSearch` declines a
 *    bare number outright, because a school is looked up by name.
 *
 * ⚠ The cache is a **dictionary of place names**, and that is why it is allowed
 * to hold what somebody typed. There is no `person_id` on it and there must not
 * be: `pending_options.submitted_value` already records *who* typed *what*, and
 * a second row saying the same thing with a timestamp would be a log of what
 * parents write — which is the thing invariant 7 exists to prevent.
 *
 * ## Invariant 7 holds on the log line
 *
 * Never the query, never the response body. A status and an enum, which is what
 * `intent.ts` and `extract.ts` were both fixed to do after this repository paid
 * three times for logging an API failure by its class name alone.
 */

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/**
 * What Places is asked to return, and it is a billing decision as much as a
 * data one: the field mask is what puts a Text Search in one SKU rather than
 * another, so nothing is requested that the screen does not render or that
 * `readPlaceSearch` does not read.
 *
 * ⚠ In particular there is no `places.id`, no rating, no opening hours and no
 * photo. An establishment reaches Pando as a **name** awaiting an admin
 * (invariant 9) — a Google place id stored against it would be a second
 * identity for a record Pando has not accepted yet, and the rest is a product
 * nobody asked for.
 */
const PLACES_FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
].join(",");

/** Four seconds. A parent is typing; a hang is worse than a miss. */
const TIMEOUT_MS = 4000;

export type { LookupKind };

export type GeocodeLookup =
  | { ok: true; places: GeocodedPlace[]; cached: boolean }
  | { ok: false; reason: GeocodeFailure | "not_configured" };

/**
 * Where a market's lookups look first.
 *
 * ⚠ A **bias, never a filter** — Google's `bounds` and `locationBias` both rank
 * inside the box and still answer outside it, which is the rule
 * `/api/market/search` already applies to the home area and the rule this
 * module's own `inMarket` flag applies to the state. A family naming where they
 * moved from must still find it, and a school two towns over is an ordinary
 * answer rather than a mistake.
 *
 * The box is the SGV plus the western places the client kept: roughly Whittier
 * up to La Cañada, Eagle Rock across to Pomona. Held once as numbers and
 * rendered into each API's own spelling below, because two hand-written copies
 * of one rectangle is a rectangle that stops being one.
 */
const MARKETS: Record<
  string,
  { state: string; sw: { lat: number; lng: number }; ne: { lat: number; lng: number } }
> = {
  pasadena: {
    state: "CA",
    sw: { lat: 33.9, lng: -118.4 },
    ne: { lat: 34.32, lng: -117.6 },
  },
};

type Market = (typeof MARKETS)[string];

export function geocodeConfigured(): boolean {
  return typeof process.env.GOOGLE_MAPS_API_KEY === "string"
    && process.env.GOOGLE_MAPS_API_KEY.trim() !== "";
}

/**
 * Resolve something the curated lists do not hold.
 *
 * `kind` picks both the API and the shape of the request, and the shapes are
 * genuinely different questions rather than variations on one:
 *
 * - `place` — a town, neighborhood or ZIP in this market. A bare five-digit
 *   string handed to `address` is matched as free text and comes back as
 *   whatever Google thinks it might be, so a postcode asks
 *   `components=postal_code:` instead. US only, biased to the market.
 * - `world` — *"where have you lived before?"*. ⚠ **No country filter and no
 *   bounds**: with either, a parent who moved from London is offered London,
 *   Ontario, and one who moved from Lagos is offered nothing at all. This is
 *   the one lookup that must not prefer the market.
 * - `establishment` — a named school, class, club or place of worship, through
 *   Places Text Search. Biased to the market, never filtered by type; see
 *   `lib/geo.ts` for why the category comes from the question rather than from
 *   Google.
 */
export async function lookupPlaces(input: {
  query: string;
  marketId?: string;
  kind?: LookupKind;
}): Promise<GeocodeLookup> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };

  const kind: LookupKind = input.kind ?? "place";
  const marketId = (input.marketId ?? "pasadena").toLowerCase();
  const market = MARKETS[marketId] ?? MARKETS.pasadena;
  const folded = cacheKey(input.query);

  /**
   * ⚠ **The cost guard lives here, not only in the search box.**
   *
   * `SearchableChipGroup` already declines to ask about `9`, `91`, `910` and
   * `9101` on the way to a postcode — but a rule enforced only in the browser
   * is a rule until somebody writes a second caller or crafts a request, and
   * the thing on the other side of it is an invoice. Same reasoning as the
   * `geocode_cache_query_shape` CHECK holding a bound the endpoint also holds:
   * a limit checked once is checked until it isn't.
   *
   * Reported as an empty answer rather than a failure, because it is one:
   * nothing went wrong, there is simply no place a two-character fragment
   * could name.
   */
  const worth = kind === "establishment" ? worthPlaceSearch(folded) : worthGeocoding(folded);
  if (!worth) return { ok: true, places: [], cached: true };

  const hit = await readCache(marketId, kind, folded);
  if (hit) return { ok: true, places: hit, cached: true };

  const outcome =
    kind === "establishment"
      ? await askPlaces(key, folded, market)
      : await askGeocoder(key, folded, market, kind);

  if (!outcome.ok) {
    console.warn("[geocode] refused", { kind, reason: outcome.reason });
    /**
     * ⚠ **A failure is never cached.** Caching `denied` would mean that fixing
     * the key left the feature broken for a month with nothing saying why, and
     * caching `over_limit` would turn one bad minute into a bad fortnight.
     * Only an answer is worth keeping.
     */
    return { ok: false, reason: outcome.reason };
  }

  await writeCache(marketId, kind, folded, outcome.places);
  console.info("[geocode] resolved", { kind, found: outcome.places.length });
  return { ok: true, places: outcome.places, cached: false };
}

/* ── the two requests ──────────────────────────────────────────────────────── */

type Answer =
  | { ok: true; places: GeocodedPlace[] }
  | { ok: false; reason: GeocodeFailure };

async function askGeocoder(
  key: string,
  folded: string,
  market: Market,
  kind: LookupKind,
): Promise<Answer> {
  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("key", key);

  if (kind === "world") {
    /* Deliberately bare: no `components`, no `bounds`. See `lookupPlaces`. */
    url.searchParams.set("address", folded);
  } else if (looksLikeZip(folded)) {
    url.searchParams.set("components", `postal_code:${folded.trim()}|country:US`);
  } else {
    url.searchParams.set("address", folded);
    url.searchParams.set("components", "country:US");
    url.searchParams.set(
      "bounds",
      `${market.sw.lat},${market.sw.lng}|${market.ne.lat},${market.ne.lng}`,
    );
  }

  let body: unknown;
  try {
    const res = await fetch(url, {
      /* Next would otherwise cache this route-side on its own schedule, which
         would be a second cache with a different clock beside the one below. */
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      /* Counts and enums (invariant 7). The status is a number and survives
         minification, which `err.constructor.name` did not. */
      console.warn("[geocode] http", { api: "geocode", status: res.status });
      return { ok: false, reason: res.status === 403 ? "denied" : "unavailable" };
    }
    body = await res.json();
  } catch {
    console.warn("[geocode] unreachable", { api: "geocode", timeout_ms: TIMEOUT_MS });
    return { ok: false, reason: "unavailable" };
  }

  /**
   * ⚠ `world` passes no `marketState`, so `inMarket` comes back false for every
   * row — which is correct rather than a gap: a previous home is by definition
   * somewhere else, and `storedValue` then carries the state or country, which
   * is what makes "Portland, OR" and "Portland, ME" two promotable rows rather
   * than one ambiguous one.
   */
  return readGeocode(
    body,
    kind === "world" ? { worldwide: true } : { marketState: market.state },
  );
}

async function askPlaces(key: string, folded: string, market: Market): Promise<Answer> {
  let body: unknown;
  try {
    const res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": PLACES_FIELDS,
      },
      body: JSON.stringify({
        /**
         * The parent's own words, unrewritten.
         *
         * ⚠ Appending the category — "little gym **school**" — is the obvious
         * way to sharpen this and is the mistake `web-search.ts` already
         * records paying for: *"the parent's own words are what a search engine
         * reads best, and rewriting them is how a question about swim classes
         * quietly becomes one about swimming pools."*
         */
        textQuery: folded,
        maxResultCount: PLACE_SEARCH_LIMIT,
        languageCode: "en",
        locationBias: {
          rectangle: {
            low: { latitude: market.sw.lat, longitude: market.sw.lng },
            high: { latitude: market.ne.lat, longitude: market.ne.lng },
          },
        },
      }),
    });
    if (!res.ok) {
      console.warn("[geocode] http", { api: "places", status: res.status });
      if (res.status === 403 || res.status === 401) return { ok: false, reason: "denied" };
      if (res.status === 429) return { ok: false, reason: "over_limit" };
      if (res.status === 400) return { ok: false, reason: "bad_request" };
      return { ok: false, reason: "unavailable" };
    }
    body = await res.json();
  } catch {
    console.warn("[geocode] unreachable", { api: "places", timeout_ms: TIMEOUT_MS });
    return { ok: false, reason: "unavailable" };
  }

  return readPlaceSearch(body, {
    marketState: market.state,
    /**
     * The **strong** half of 11.4 and nothing weaker.
     *
     * A Places search for a child's teacher would otherwise offer "Ms. Diane"
     * as a school to add — a named individual entering the graph through a door
     * with none of invariants 1, 2, 12 or 13 on it. The weak signal is
     * deliberately not used: measured against all 588 curated records it flags
     * 16 of them ("Marshall Fundamental", "Altadena Stables"), so refusing on
     * it would hide real schools.
     */
    isPerson: (name) => {
      const verdict = looksLikePerson(name);
      return verdict.person && verdict.strong;
    },
  });
}

/* ── the cache ─────────────────────────────────────────────────────────────── */

async function readCache(
  marketId: string,
  kind: LookupKind,
  query: string,
): Promise<GeocodedPlace[] | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select places, fetched_at from geocode_cache
       where market_id = ${marketId} and kind = ${kind} and query = ${query}
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  /* No database is not an empty cache — it is a cache we could not read, and
     the honest consequence is to ask Google rather than to answer "nothing". */
  if (!result.persisted || !result.data) return null;

  const places = result.data.places;
  if (!Array.isArray(places)) return null;
  if (!isFresh({ places, fetchedAt: result.data.fetched_at as string })) return null;
  return places as GeocodedPlace[];
}

async function writeCache(
  marketId: string,
  kind: LookupKind,
  query: string,
  places: GeocodedPlace[],
): Promise<void> {
  /* Deliberately not allowed to fail the lookup: the answer is already in hand,
     and reporting a cache miss as a geocoding failure would hide a working
     result behind a database hiccup. The only cost of a failed write is that
     the next parent pays for the same place again. */
  await withDb(async (db: Db) =>
    db.execute(sql`
      insert into geocode_cache (market_id, kind, query, places, fetched_at)
      values (${marketId}, ${kind}, ${query}, ${JSON.stringify(places)}::jsonb, now())
      on conflict (market_id, kind, query)
        do update set places = excluded.places, fetched_at = now()
    `),
  );
}
