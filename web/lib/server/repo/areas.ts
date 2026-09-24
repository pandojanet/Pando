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
  __pandoAreaGroups?: Map<
    string,
    {
      at: number;
      groups: Map<string, string[]>;
      cities: Map<string, string>;
      /** city -> the cities that touch it, both directions. */
      adjacent: Map<string, string[]>;
    }
  >;
};
store.__pandoAreaGroups ??= new Map();
const cache = store.__pandoAreaGroups;

async function loadAreas(marketId: string) {
  const hit = cache.get(marketId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select option_value, coalesce(area_slug, option_value) as city
        from market_options
       where market_id = ${marketId}
         and category = 'neighborhoods'
         and active
    `)) as unknown as Array<Record<string, unknown>>;
    const pairs = (await db.execute(sql`
      select area_a, area_b from neighborhood_adjacency where market_id = ${marketId}
    `)) as unknown as Array<Record<string, unknown>>;
    return { rows, pairs };
  });

  const groups = new Map<string, string[]>();
  /* id -> the one id that *is* the place, which is what `place_id` stores. */
  const cities = new Map<string, string>();
  const adjacent = new Map<string, string[]>();
  if (result.persisted) {
    for (const pair of result.data.pairs) {
      const a = String(pair.area_a);
      const b = String(pair.area_b);
      (adjacent.get(a) ?? adjacent.set(a, []).get(a)!).push(b);
      (adjacent.get(b) ?? adjacent.set(b, []).get(b)!).push(a);
    }
    const byCity = new Map<string, string[]>();
    for (const row of result.data.rows) {
      const id = String(row.option_value);
      const city = String(row.city);
      cities.set(id, city);
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
  if (result.persisted) cache.set(marketId, { at: Date.now(), groups, cities, adjacent });
  return { at: Date.now(), groups, cities, adjacent };
}

async function groupsFor(marketId: string): Promise<Map<string, string[]>> {
  return (await loadAreas(marketId)).groups;
}

async function citiesFor(marketId: string): Promise<Map<string, string>> {
  return (await loadAreas(marketId)).cities;
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

/**
 * The **city** a neighborhood sits in — `area_slug`, or itself.
 *
 * `areaGroup` above answers "which ids mean the same place", which is what a
 * match needs. This answers "which one of them is the place", which is what
 * §5's `place_id` and its demand number need, and the two are genuinely
 * different: a group is a set with no head, and a stored fact has to be one id.
 *
 * Reuses the same cached read, so asking both costs one round trip. Returns
 * null for anything unknown rather than echoing the input — a caller storing
 * this wants *no place* rather than a place that is not in the list.
 */
export async function areaCity(
  marketId: string,
  area: string | null | undefined,
): Promise<string | null> {
  const id = (area ?? "").trim();
  if (id === "") return null;
  return (await citiesFor(marketId)).get(id) ?? null;
}

/**
 * Every neighborhood id **near** `area` (24 Sep): its own place and every place
 * that touches it, each rolled up to all its districts.
 *
 * "Near" is read from the database and nothing else — `market_options` for
 * the roll-up and `neighborhood_adjacency` for what touches what — so a place
 * an admin approves is near itself the moment it is approved, and near nothing
 * else until somebody records what it borders. That is the developer's rule:
 * no place list in code that one feature honours and another does not.
 *
 * It is what an answer's parent records, the web search's place, the Network
 * Ask offer and its pool all agree on. A place this market does not hold at all
 * returns just itself, which matches only records tagged with exactly it.
 */
export async function nearbyAreas(
  marketId: string,
  area: string | null | undefined,
): Promise<string[]> {
  const id = (area ?? "").trim();
  if (id === "") return [];
  const { groups, cities, adjacent } = await loadAreas(marketId);
  const city = cities.get(id) ?? id;
  const near = new Set<string>(groups.get(id) ?? [id]);
  near.add(city);
  for (const next of adjacent.get(city) ?? []) {
    near.add(next);
    for (const member of groups.get(next) ?? [next]) near.add(member);
  }
  return [...near];
}

/** Clears the roll-up, so an `option.*` admin write is visible immediately. */
export function clearAreaGroups(): void {
  cache.clear();
}
