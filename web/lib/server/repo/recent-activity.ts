import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { RECENT_DAYS, type RecentRow } from "@/lib/recent-activity";

/**
 * The recent contributions behind `/join`'s live line (14 Oct) — see
 * `lib/recent-activity.ts` for what may be said about each.
 *
 * Only what the line needs leaves this query: when, the kind and sub-category,
 * the contributor's own town as its **curated** label (a free-text place a
 * parent typed is never a label here), and how many verified parents share it.
 * No id, no name, no record, no words.
 *
 * Counted only when real: a verified parent, not a test row, not a caregiver
 * card, in the last `RECENT_DAYS`.
 */
export async function recentActivity(db: Db, marketId: string, limit = 24): Promise<RecentRow[]> {
  const rows = (await db.execute(sql`
    with towns as (
      select p.neighborhood, count(*)::int as parents
        from people p
       where p.market_id = ${marketId} and not p.is_test
         and p.phone_verified_at is not null and p.neighborhood is not null
       group by p.neighborhood
    )
    select c.created_at, s.kind::text as kind, s.subcategory,
           mo.label as town, coalesce(t.parents, 0) as town_parents
      from share_contributions c
      join shares s on s.id = c.share_id
      join people p on p.id = c.person_id
      left join market_options mo
        on mo.market_id = p.market_id and mo.category = 'neighborhoods'
       and mo.option_value = p.neighborhood and mo.active
      left join towns t on t.neighborhood = p.neighborhood
     where s.market_id = ${marketId}
       and not c.is_test and not s.is_test and not p.is_test
       and p.phone_verified_at is not null
       and s.kind::text <> 'caregiver'
       and c.created_at > now() - make_interval(days => ${RECENT_DAYS})
     order by c.created_at desc
     limit ${limit}
  `)) as unknown as RecentRow[];
  return rows;
}

/* A minute's cache: the line is the same for everybody, and `/join` is the
   page a forwarded link lands a whole group chat on at once. */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rows: RecentRow[] }>();

export function cachedRecent(marketId: string): RecentRow[] | null {
  const hit = cache.get(marketId);
  return hit && Date.now() - hit.at < TTL_MS ? hit.rows : null;
}

export function cacheRecent(marketId: string, rows: RecentRow[]): void {
  /* Keyed by what the caller sent, so bounded: a run of made-up market ids
     must not grow it for the life of the process. */
  if (cache.size >= 20) cache.clear();
  cache.set(marketId, { at: Date.now(), rows });
}
