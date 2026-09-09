import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { MARKET_CATEGORIES } from "@/lib/types";
import type { MarketCategory, Option } from "@/lib/types";
import { withDb } from "@/lib/server/db";
import { cacheOptions, cachedOptions } from "@/lib/server/market-cache";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * Categories that became a *directory* on 24 Aug and are no longer a chip list.
 *
 * The master list carries 357 schools, 96 activities, 84 faith communities and 39
 * clubs for this one market. Rendering those as chips is not a long screen, it is
 * an unusable one — and the client's instruction for all four is the same
 * sentence: "tap first, search second". So this endpoint serves only the curated
 * starter set (8-12 per area, `starter = true`), and everything else is reached
 * through `GET /api/market/search`.
 *
 * The other categories — neighborhoods, camps, parent_groups — are short enough
 * to stay complete lists, and none has a starter curated for it, so filtering
 * them here would empty the screen.
 */
const SEARCHABLE = new Set([
  "schools",
  "baby_activities",
  "clubs",
  "worship",
  /**
   * Item 11's previous places. It has **no starters at all**, deliberately —
   * there is no plausible set of 8-12 familiar previous cities — so listing it
   * here is what makes the chips absent and the search box the whole control.
   *
   * Missing it was a real bug for one build: the category was added after this
   * filter was written, so all 182 places were served and the screen showed the
   * first twelve alphabetically ("Abu Dhabi, Accra, Albuquerque…") as if they
   * were suggestions for where a Pasadena parent used to live.
   */
  "previous_places",
  /**
   * Item 5's autopopulate made this a directory too: seventeen suggested cities
   * (`starter = true`) and sixty-odd more towns and Pasadena neighbourhoods
   * reachable by search. Without it here, all seventy-nine would render as chips
   * — which is the wall this whole pattern exists to avoid.
   */
  "neighborhoods",
]);

/**
 * GET /api/market/options?market_id=pasadena — the tap lists (spec §16.2, §8.5).
 *
 * This is what makes the questionnaire *data*: an admin promoting an "other"
 * answer, or `npm run options:import` loading Janet's sheet, changes what the next
 * parent sees without a deploy. Before it existed the chips were compiled into the
 * client bundle, so `market_options` was a table the app wrote to and never read.
 *
 * Three deliberate properties:
 *
 *  - **Anonymous.** It serves the same reference data that used to ship inside the
 *    JavaScript bundle — neighborhood and school names, nothing about a person. An
 *    auth check here would be theatre, and the questionnaire needs it before there
 *    is any identity to check.
 *  - **Inactive rows are excluded, never deleted.** `option.retire` sets
 *    `active = false` precisely because profiles already point at the value; it
 *    stops being offered without breaking what it meant.
 *  - **Unconfigured answers honestly.** No `DATABASE_URL` ⇒ `configured: false`
 *    and no options, and the client keeps the built-in placeholder lists rather
 *    than rendering empty screens.
 *
 * Cached in-process for a minute (`lib/server/market-cache.ts`). The read is tiny,
 * but it is on the critical path of the first screen a parent sees, and against
 * the pooler the cost that matters is the round trip (see CLAUDE.md). Admin writes
 * clear the cache, so a promotion is visible on the next request rather than a
 * minute later; only `npm run options:import` waits out the TTL, because it runs
 * in a different process.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /* Shares the search budget. Cheap in itself (cached 60s), but it is the
     other half of the same screen and a limit that only covered one of them
     would just move the scrape. */
  const limited = rateLimited(request, "market_read");
  if (limited) return limited;

  const url = new URL(request.url);
  /* Same shape as every other id we accept from a URL: lowercase, hyphenated,
     bounded. An unknown market simply comes back empty. */
  const marketId = (url.searchParams.get("market_id") ?? "pasadena")
    .toLowerCase()
    .slice(0, 40);
  if (!/^[a-z0-9-]+$/.test(marketId)) {
    return NextResponse.json({ error: "Unknown market" }, { status: 400 });
  }

  const hit = cachedOptions(marketId);
  if (hit) return NextResponse.json(hit);

  const result = await withDb(async (db) => {
    const rows = (await db.execute(
      // Bound as a parameter, not interpolated — the regex above is a shape check,
      // never the thing standing between a URL and the database.
      // Ordered by label so the chip list reads the same on every render.
      /* The starter filter is in the WHERE, not applied after: a query that
         returned 357 schools so the server could throw 224 away would pay the
         transfer for nothing, and this read is on the critical path of the first
         screen a parent sees. `area` comes back so a starter can be ranked
         against where the parent said they live — she is explicit that the home
         area affects ranking and never eligibility. */
      /* ⚠ **Every** active neighborhood comes back, starter or not** — and only
         the starters are rendered. The extra rows build `areas` below, the
         id → city roll-up without which a parent living in a Pasadena district
         is treated as living nowhere (8 Sep). One query rather than two,
         because against the pooler the cost that matters is the round trip. */
      sql`select category, option_value, label, bands, area, area_slug, section,
                 starter, status
            from market_options
           where market_id = ${marketId}
             and active
             and (category = 'neighborhoods'
                  or category not in ('schools', 'baby_activities', 'clubs',
                                      'worship', 'previous_places')
                  or (starter and status = 'active'))
           order by label`,
    )) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!result.persisted) {
    /* Unconfigured is a supported state, not an error: the client falls back to
       its built-in lists and the flow stays walkable. */
    const body = {
      configured: false,
      market_id: marketId,
      options: {} as Partial<Record<MarketCategory, Option[]>>,
    };
    return NextResponse.json(body, { status: result.reason === "unconfigured" ? 200 : 502 });
  }

  const options: Partial<Record<MarketCategory, Option[]>> = {};
  /**
   * Which **city** each neighborhood belongs to — the roll-up the chip lists,
   * the matcher and retrieval all need and none of them had (8 Sep).
   *
   * `market_options.neighborhoods` holds 79 values for this market: the
   * seventeen curated towns **plus** fourteen Pasadena districts (Old Pasadena,
   * Bungalow Heaven, Linda Vista, Hastings Ranch…) and Altadena Foothills, each
   * of which already carries `area_slug = 'pasadena'` / `'altadena'`. Every
   * starter in every other category is tagged with the **city**, so a parent who
   * picked a district matched nothing: measured on the live cohort, fourteen of
   * thirty-nine contributors were offered eight schools from Highland Park,
   * Alhambra and Monterey Park while seven curated Pasadena schools went
   * unoffered. That is the 27 Aug report arriving through a second door — not
   * display-name-versus-slug this time, but district-versus-city.
   *
   * ⚠ **It has to be served rather than derived on the client**: only the
   * seventeen starters are in `options.neighborhoods`, so a district reaches the
   * browser only if the parent happened to search for it, and on the *next*
   * screen it would be gone again.
   *
   * Only the entries that actually roll up are sent — a town whose city is
   * itself says nothing, and `neighborhoodCity` falls back to the id.
   */
  const areas: Record<string, string> = {};
  for (const row of result.data) {
    const category = String(row.category ?? "") as MarketCategory;

    if (category === "neighborhoods") {
      const id = String(row.option_value);
      const city = row.area_slug ? String(row.area_slug) : null;
      if (city && city !== id) areas[id] = city;
      /* The chip list is still the curated seventeen; the rest are searchable
         and are here only for the map above. */
      if (!(row.starter === true && row.status === "active")) continue;
    }
    /* Only the categories the questionnaire draws chips from. `focus` and any
       future value live in the table for promotion and import, and are not
       something a screen knows how to render. */
    if (!MARKET_CATEGORIES.includes(category)) continue;

    const bands = Array.isArray(row.bands) ? (row.bands as string[]) : null;
    const area = row.area ? String(row.area) : null;
    const areaSlug = row.area_slug ? String(row.area_slug) : null;
    (options[category] ??= []).push({
      id: String(row.option_value),
      label: String(row.label ?? row.option_value),
      ...(bands && bands.length > 0 ? { bands: bands as Option["bands"] } : {}),
      /* Only for the searchable categories, and only as a hint: two records can
         share a name (three "Willard Elementary School"s across districts), so
         the screen needs somewhere to say which. */
      ...(area && SEARCHABLE.has(category) ? { area } : {}),
      /* And the same value as a slug, which is what the chip list filters on.
         `area` is for reading; `area_slug` is for matching. */
      ...(areaSlug && SEARCHABLE.has(category) ? { area_slug: areaSlug } : {}),
      /* Clubs use this to render her two visible groups; faith carries the
         tradition, which is metadata and must never become the displayed
         identity — so it is passed only where a screen groups by it. */
      ...(row.section && category === "clubs" ? { section: String(row.section) } : {}),
    });
  }

  const body = { configured: true, market_id: marketId, options, areas };
  cacheOptions(marketId, body);
  return NextResponse.json(body);
}
