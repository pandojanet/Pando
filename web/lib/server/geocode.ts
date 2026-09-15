import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import {
  cacheKey,
  isFresh,
  looksLikeZip,
  readGeocode,
  worthGeocoding,
  type GeocodeFailure,
  type GeocodedPlace,
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
 * ## What it costs, and the two things that bound it
 *
 * Geocoding is billed per request. Two bounds, and neither is optional:
 *
 * 1. **It only runs on a miss.** `SearchableChipGroup` asks the closed list
 *    first — 52 places, 62 ZIPs, already in the bundle — and comes here only
 *    when that answers nothing. Most parents' text never leaves the building.
 * 2. **Every answer is cached in Postgres**, keyed on the folded query and not
 *    on the person, so the second parent to type a ZIP costs nothing. A miss is
 *    cached too: without that, one typo is a paid lookup on every keystroke of
 *    every session that ever repeats it.
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

const ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

/** Four seconds. A parent is typing; a hang is worse than a miss. */
const TIMEOUT_MS = 4000;

export type GeocodeLookup =
  | { ok: true; places: GeocodedPlace[]; cached: boolean }
  | { ok: false; reason: GeocodeFailure | "not_configured" };

/**
 * Where a market's geocoder looks first.
 *
 * ⚠ A **bias, never a filter** — Google's own `bounds` parameter ranks inside
 * the box and still answers outside it, which is the rule `/api/market/search`
 * already applies to the home area and the rule this module's own `inMarket`
 * flag applies to the state. A family naming where they moved from must still
 * find it.
 *
 * The box is the SGV plus the western places the client kept: roughly Whittier
 * up to La Cañada, Eagle Rock across to Pomona.
 */
const MARKETS: Record<string, { state: string; bounds: string }> = {
  pasadena: { state: "CA", bounds: "33.90,-118.40|34.32,-117.60" },
};

export function geocodeConfigured(): boolean {
  return typeof process.env.GOOGLE_MAPS_API_KEY === "string"
    && process.env.GOOGLE_MAPS_API_KEY.trim() !== "";
}

/**
 * Resolve a town, neighborhood or ZIP the closed list does not hold.
 *
 * The request differs by shape, and that is the one thing a single "address"
 * parameter gets wrong: a bare five-digit string handed to `address` is matched
 * as free text and comes back as whatever Google thinks it might be — a street
 * number, a building, a route. `components=postal_code:` asks the question
 * that was actually asked.
 */
export async function lookupPlaces(input: {
  query: string;
  marketId?: string;
}): Promise<GeocodeLookup> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };

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
  if (!worthGeocoding(folded)) return { ok: true, places: [], cached: true };

  const hit = await readCache(marketId, folded);
  if (hit) return { ok: true, places: hit, cached: true };

  const url = new URL(ENDPOINT);
  url.searchParams.set("key", key);
  if (looksLikeZip(folded)) {
    url.searchParams.set("components", `postal_code:${folded.trim()}|country:US`);
  } else {
    url.searchParams.set("address", folded);
    url.searchParams.set("components", "country:US");
    url.searchParams.set("bounds", market.bounds);
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
      console.warn("[geocode] http", { status: res.status });
      return { ok: false, reason: res.status === 403 ? "denied" : "unavailable" };
    }
    body = await res.json();
  } catch {
    console.warn("[geocode] unreachable", { timeout_ms: TIMEOUT_MS });
    return { ok: false, reason: "unavailable" };
  }

  const outcome = readGeocode(body, { marketState: market.state });
  if (!outcome.ok) {
    console.warn("[geocode] refused", { reason: outcome.reason });
    /**
     * ⚠ **A failure is never cached.** Caching `denied` would mean that fixing
     * the key left the feature broken for a month with nothing saying why, and
     * caching `over_limit` would turn one bad minute into a bad fortnight.
     * Only an answer is worth keeping.
     */
    return { ok: false, reason: outcome.reason };
  }

  await writeCache(marketId, folded, outcome.places);
  console.info("[geocode] resolved", { found: outcome.places.length, zip: looksLikeZip(folded) });
  return { ok: true, places: outcome.places, cached: false };
}

async function readCache(marketId: string, query: string): Promise<GeocodedPlace[] | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select places, fetched_at from geocode_cache
       where market_id = ${marketId} and query = ${query}
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
  query: string,
  places: GeocodedPlace[],
): Promise<void> {
  /* Deliberately not allowed to fail the lookup: the answer is already in hand,
     and reporting a cache miss as a geocoding failure would hide a working
     result behind a database hiccup. The only cost of a failed write is that
     the next parent pays for the same place again. */
  await withDb(async (db: Db) =>
    db.execute(sql`
      insert into geocode_cache (market_id, query, places, fetched_at)
      values (${marketId}, ${query}, ${JSON.stringify(places)}::jsonb, now())
      on conflict (market_id, query)
        do update set places = excluded.places, fetched_at = now()
    `),
  );
}
