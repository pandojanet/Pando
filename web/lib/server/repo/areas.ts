import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";

/**
 * Which neighborhoods count as "the same place" — the roll-up nothing had.
 *
 * ## The fault this exists to close
 *
 * `market_options.neighborhoods` holds **79** values for Pasadena: the seventeen
 * curated towns plus fourteen Pasadena districts (Old Pasadena, Bungalow Heaven,
 * Linda Vista, Hastings Ranch, San Rafael…) and Altadena Foothills. Every one of
 * them already carries an `area_slug` naming its city — the roll-up is in the
 * data and **nothing read it**.
 *
 * So a district was an island. Measured on the live cohort (8 Sep):
 *
 *  - **14 of 39** contributors live in a district, and their stored neighborhood
 *    appears nowhere in `neighborhood_adjacency`, which is keyed on the towns —
 *    so a parent in Old Pasadena and one in Madison Heights, adjoining districts,
 *    scored **zero** neighborhood points. Not same-area (different slug), not
 *    adjacent (both absent). `altadena↔pasadena` is seeded and unusable, because
 *    nobody's stored neighborhood is the bare `pasadena`.
 *  - **13 of 39** matched no approved record's area, because `shares.neighborhoods`
 *    is tagged with the same mixed vocabulary. Rolled up, the five Pasadena
 *    district records serve all thirteen Pasadena-district parents instead of one
 *    each.
 *
 * This is the third time one comparison has silently matched nothing — 27 Aug was
 * a display name against a slug, 1 Sep was a list capped before the area was
 * known — and all three share a shape: typecheck clean, suites green, feature
 * doing the opposite of its purpose, visible only against real rows.
 *
 * ## Two rules
 *
 * **The group always contains the area itself**, so an unknown value, an
 * unconfigured database and a plain town all behave exactly as the bare
 * comparison did. Nothing this returns can make a match *narrower*.
 *
 * **It is a group, not a city**, because both sides need rolling up: a record
 * tagged `old-pasadena` has to reach a parent in `bungalow-heaven`, which naming
 * only the city would not do. `array &&` against the whole group is one operator
 * and covers both directions.
 *
 * Cached for the same minute as the option lists, and for the same reason: this
 * sits on the retrieval path of every inbound question, and against the pooler
 * the cost that matters is the round trip.
 */

const TTL_MS = 60_000;

const store = globalThis as typeof globalThis & {
  __pandoAreaGroups?: Map<string, { at: number; groups: Map<string, string[]> }>;
};
store.__pandoAreaGroups ??= new Map();
const cache = store.__pandoAreaGroups;

async function groupsFor(marketId: string): Promise<Map<string, string[]>> {
  const hit = cache.get(marketId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.groups;

  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select option_value, coalesce(area_slug, option_value) as city
        from market_options
       where market_id = ${marketId}
         and category = 'neighborhoods'
         and active
    `)) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  const groups = new Map<string, string[]>();
  if (result.persisted) {
    const byCity = new Map<string, string[]>();
    for (const row of result.data) {
      const id = String(row.option_value);
      const city = String(row.city);
      (byCity.get(city) ?? byCity.set(city, []).get(city)!).push(id);
    }
    for (const [city, members] of byCity) {
      /* The city itself is a member even when no row is named after it, so a
         record tagged with the bare town still matches a parent in a district. */
      const all = members.includes(city) ? members : [...members, city];
      for (const id of members) groups.set(id, all);
    }
  }

  /* An unreachable database caches nothing — this is a ranking hint, and a
     minute of a wrong empty map is worse than a second round trip. */
  if (result.persisted) cache.set(marketId, { at: Date.now(), groups });
  return groups;
}

/**
 * Every neighborhood id that means the same place as `area`, including itself.
 *
 * Returns `[area]` for anything unknown, which is the old behaviour exactly.
 */
export async function areaGroup(
  marketId: string,
  area: string | null | undefined,
): Promise<string[]> {
  const id = (area ?? "").trim();
  if (id === "") return [];
  const groups = await groupsFor(marketId);
  return groups.get(id) ?? [id];
}

/** Clears the roll-up, so an `option.*` admin write is visible immediately. */
export function clearAreaGroups(): void {
  cache.clear();
}
