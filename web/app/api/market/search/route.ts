import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { MARKET_CATEGORIES } from "@/lib/types";
import type { MarketCategory, Option } from "@/lib/types";
import { withDb } from "@/lib/server/db";

/**
 * GET /api/market/search?category=schools&q=poly&area=pasadena
 *
 * The second half of "tap first, search second" (client, 24 Aug). `/options`
 * serves the 8-12 curated starters per category; this reaches the rest — 357
 * schools, 96 activity providers, 84 faith communities, 39 clubs in this one
 * market, which is a directory and not a chip list.
 *
 * ## Four rules from her instructions, each of which changes the query
 *
 * **Home area ranks, never filters.** Her closing note on all four sheets is that
 * Pasadena/SGV families routinely cross city lines for school, classes, clubs and
 * worship. So `area` is an ORDER BY term and never a WHERE term — a parent in
 * Alhambra searching for a Pasadena preschool must find it.
 *
 * **Aliases are searched, never shown.** "Poly" has to reach Polytechnic School,
 * "LCHS" La Cañada High School, "CPG" Coach Patty's Gymnastics. The parent sees
 * the canonical name; the alias is only a way in.
 *
 * **Inactive rows stay searchable.** A closed school is still selectable, because
 * a parent whose child went there has a real affiliation and their stored answer
 * resolves against this row. Only `starter` promotion is gated on being live —
 * which is why this endpoint does not filter on `status` at all.
 *
 * **Nothing about a person, so no auth.** Same reference data `/options` serves,
 * and the questionnaire needs it before there is any identity to check. It is
 * rate-limited by nothing today for the same reason the options route is not:
 * it is public reference data behind an invite-gated screen. Worth revisiting if
 * the pilot's URL ever leaks — the shape to add is a per-IP counter, not auth.
 */

export const dynamic = "force-dynamic";

/** Bounded so a long query cannot turn into an expensive scan. */
const MAX_QUERY = 60;
const LIMIT = 25;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const marketId = (url.searchParams.get("market_id") ?? "pasadena").toLowerCase().slice(0, 40);
  if (!/^[a-z0-9-]+$/.test(marketId)) {
    return NextResponse.json({ error: "Unknown market" }, { status: 400 });
  }

  const category = (url.searchParams.get("category") ?? "").toLowerCase() as MarketCategory;
  if (!MARKET_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }

  /**
   * Resolve-by-id mode, for the reload case.
   *
   * A parent who picked a searched record and came back has the id in their
   * answers and nothing on screen for it: the starters do not contain it, and
   * there is no query to find it with. This asks for those exact records.
   *
   * Same table, same `active` rule, so it cannot be used to reach something an
   * admin retired. Bounded to the per-question cap so a crafted URL cannot ask
   * for the whole directory in one call.
   */
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^[a-z0-9-]{1,80}$/.test(v))
    .slice(0, 24);

  if (ids.length > 0) {
    const byId = await withDb(async (db) => {
      const rows = (await db.execute(
        sql`select option_value, label, area, area_slug, section, status, bands
              from market_options
             where market_id = ${marketId}
               and category = ${category}
               and active
               and option_value = any(${sql.raw(
                 "ARRAY[" + ids.map((v) => "'" + v + "'").join(",") + "]::text[]",
               )})`,
      )) as unknown as Array<Record<string, unknown>>;
      return rows;
    });

    /* The ids are already regex-checked to `[a-z0-9-]`, so the array literal
       above cannot carry a quote — which is the reason the check is a whitelist
       rather than an escape. `sql.array` cannot infer `text[]` here; that trap
       is recorded in CLAUDE.md for `repo/caregiver.ts`. */
    return NextResponse.json({
      market_id: marketId,
      category,
      query: "",
      results: byId.persisted ? byId.data.map(toOption) : [],
      ...(byId.persisted ? {} : { configured: false }),
    });
  }

  const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);
  /* Two characters is the floor: one letter matches most of the directory, which
     is a slow query and a useless answer. Not an error — the screen shows its
     starters until there is enough to search on. */
  if (q.length < 2) {
    return NextResponse.json({ market_id: marketId, category, query: q, results: [] });
  }

  /* Ranking hint only. An unknown value simply ranks nothing higher. */
  const area = (url.searchParams.get("area") ?? "").toLowerCase().slice(0, 60);

  const like = `%${q}%`;
  /* Trigram similarity handles the misspellings a LIKE cannot ("polytecnic",
     "conservatry"). The LIKE stays as well, because it is what makes a short
     prefix like "poly" a certain hit rather than a similarity coin-flip. */
  const result = await withDb(async (db) => {
    const rows = (await db.execute(
      sql`select option_value, label, area, area_slug, section, entity_type, status, bands
            from market_options
           where market_id = ${marketId}
             and category = ${category}
             and active
             and (
               label ilike ${like}
               or exists (select 1 from unnest(aliases) a where a ilike ${like})
               or label % ${q}
             )
           order by
             /* Exact, then starts-with, then contains, then fuzzy. A parent who
                types the whole name should not have to scroll past a partial
                match on a different school. */
             case
               when lower(label) = lower(${q}) then 0
               when label ilike ${q + "%"} then 1
               when label ilike ${like} then 2
               else 3
             end,
             /* Their own area first — a hint, after relevance, never a filter.
                On area_slug, because area is the display name while the
                parameter is the neighborhood option id: comparing the two
                matched single-word names only, so this clause did nothing at all
                for La Canada Flintridge, Highland Park, South Pasadena and six
                others (drizzle 0017). No backticks in here — the whole clause
                sits inside a template literal. */
             case when coalesce(area_slug, '') = ${area} then 0 else 1 end,
             /* A live record ahead of a closed one with the same relevance. */
             case when status = 'active' then 0 else 1 end,
             label
           limit ${LIMIT}`,
    )) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!result.persisted) {
    /* Same honesty rule as everywhere else: an unconfigured or unreachable
       database returns no results rather than an error the screen would have to
       show a parent mid-question. The starter chips still work. */
    return NextResponse.json(
      { market_id: marketId, category, query: q, results: [], configured: false },
      { status: result.reason === "unconfigured" ? 200 : 502 },
    );
  }

  return NextResponse.json({
    market_id: marketId,
    category,
    query: q,
    results: result.data.map(toOption),
  });
}

/** One row → one `Option`, shared by the search and resolve-by-id paths. */
function toOption(row: Record<string, unknown>): Option {
  const bands = Array.isArray(row.bands) ? (row.bands as string[]) : null;
  return {
    id: String(row.option_value),
    label: String(row.label ?? row.option_value),
    ...(row.area ? { area: String(row.area) } : {}),
    ...(row.area_slug ? { area_slug: String(row.area_slug) } : {}),
    ...(row.section ? { section: String(row.section) } : {}),
    /* "Closed" is worth saying next to a school somebody is about to pick, and
       it is the only status that changes what the label means. */
    ...(row.status && row.status !== "active"
      ? { hint: String(row.status) === "closed" ? "closed" : "not verified" }
      : {}),
    ...(bands && bands.length > 0 ? { bands: bands as Option["bands"] } : {}),
  };
}
