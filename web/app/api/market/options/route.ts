import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { MARKET_CATEGORIES } from "@/lib/types";
import type { MarketCategory, Option } from "@/lib/types";
import { withDb } from "@/lib/server/db";
import { cacheOptions, cachedOptions } from "@/lib/server/market-cache";

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
      sql`select category, option_value, label, bands
            from market_options
           where market_id = ${marketId} and active
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
  for (const row of result.data) {
    const category = String(row.category ?? "") as MarketCategory;
    /* Only the categories the questionnaire draws chips from. `focus` and any
       future value live in the table for promotion and import, and are not
       something a screen knows how to render. */
    if (!MARKET_CATEGORIES.includes(category)) continue;

    const bands = Array.isArray(row.bands) ? (row.bands as string[]) : null;
    (options[category] ??= []).push({
      id: String(row.option_value),
      label: String(row.label ?? row.option_value),
      ...(bands && bands.length > 0 ? { bands: bands as Option["bands"] } : {}),
    });
  }

  const body = { configured: true, market_id: marketId, options };
  cacheOptions(marketId, body);
  return NextResponse.json(body);
}
