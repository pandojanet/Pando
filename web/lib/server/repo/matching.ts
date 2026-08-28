import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import {
  rankCandidates,
  type MatchConfig,
  type Person,
  type RankResult,
  type Requirements,
} from "@/lib/matching";

/**
 * M6 — the one query that feeds the scorer.
 *
 * `lib/matching.ts` holds the arithmetic and knows nothing about a database; this
 * fetches the rows and hands them over. Same split as `lib/derive.ts` and
 * `repo/profile.ts`, for the same reason: the part that decides whose questions
 * reach whom stays testable without a connection.
 *
 * ## Why the candidate pool is bounded by the asker's edges
 *
 * The naive shape is "load every contributor's edges, then score" — which on a
 * live market means pulling the whole graph to discover that most of it shares
 * nothing with this parent. Instead the query starts from **the asker's own edge
 * values** and finds only the people who sit on one of them. That is an index
 * lookup on `social_affinities_lookup_idx`, and the result is bounded by how
 * connected the asker is rather than by how many contributors exist.
 *
 * Two candidates arrive that the edge join alone would miss, and both are
 * deliberate: someone in an **adjacent** area, and someone whose child is in a
 * **neighbouring age band**. Neither shares a literal edge value, and both are
 * real matches under 6.3 and 6.4 — so the query unions them in rather than
 * letting the scorer fail to see them.
 *
 * ## One statement, not five
 *
 * The 10 Aug lesson: against the pooler a round trip is ~200-250ms warm and the
 * query itself costs single-digit milliseconds, so `Promise.all` over five reads
 * is the slow shape however parallel it looks. Everything below is one statement
 * returning one row of JSON aggregates.
 */

export interface MatchQuery {
  askerId: string;
  marketId?: string;
  wanted?: number;
  requirements?: Requirements;
  /**
   * Include contributors who have not had a contribution approved yet.
   *
   * Default **false**, and that is the client's answer of 27 Aug: a contribution
   * enters the graph only after approval. The same rule `shares_answerable`
   * already enforces for records is applied here to people — a parent whose
   * cards are all still in the review queue is not yet someone Pando asks,
   * because nothing they said has been read.
   */
  includeUnapproved?: boolean;
}

export interface MatchOutcome extends RankResult {
  /** Echoed so a caller — and the 6.7 harness — can show what was scored against. */
  config: MatchConfig;
  asker: Person | null;
}

const EMPTY: MatchOutcome = {
  ranked: [],
  cold: true,
  wanted: 0,
  found: 0,
  config: { weights: {}, adjacency: [] },
  asker: null,
};

/**
 * Score the market against one asker.
 *
 * Returns the empty outcome when there is no database — the same honesty rule as
 * the rest of the app: a ranking nobody computed must not look like a ranking
 * that found nobody. The caller can tell them apart because `asker` is null.
 */
export async function matchesFor(query: MatchQuery): Promise<MatchOutcome> {
  const marketId = query.marketId ?? "pasadena";
  const wanted = query.wanted ?? 5;

  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      with asker as (
        select p.id, p.neighborhood
          from people p
         where p.id = ${query.askerId}::uuid
      ),
      asker_edges as (
        select sa.affinity_type, sa.affinity_value, sa.child_birth_years
          from social_affinities sa
         where sa.person_id = ${query.askerId}::uuid
      ),
      asker_kids as (
        select coalesce(array_agg(c.birth_year), '{}') as years
          from children c
         where c.person_id = ${query.askerId}::uuid
      ),
      /* Who to consider. Bounded by the asker's own edges, plus the two kinds of
         match that share no literal edge value: an adjacent area (6.3) and a
         neighbouring age band (6.4). */
      pool as (
        select distinct sa.person_id
          from social_affinities sa
          join asker_edges ae
            on ae.affinity_type = sa.affinity_type
           and ae.affinity_value = sa.affinity_value
         where sa.person_id <> ${query.askerId}::uuid
        union
        select p.id
          from people p, asker a
         where p.id <> a.id
           and p.neighborhood is not null
           and a.neighborhood is not null
           and exists (
             select 1 from neighborhood_adjacency na
              where na.market_id = ${marketId}
                and ((na.area_a = a.neighborhood and na.area_b = p.neighborhood)
                  or (na.area_b = a.neighborhood and na.area_a = p.neighborhood))
           )
        union
        /* A neighbouring age band (6.4). Cheap because the children table is
           small, and this is the only way a near-stage match with no shared place
           gets in. No backticks in here: the whole statement is a template
           literal, and one would close it. */
        select c.person_id
          from children c
         where c.person_id <> ${query.askerId}::uuid
           and exists (
             select 1 from children mine
              where mine.person_id = ${query.askerId}::uuid
                and abs(mine.birth_year - c.birth_year) <= 4
           )
      ),
      eligible as (
        select p.id, p.neighborhood
          from people p
          join pool on pool.person_id = p.id
         where p.market_id = ${marketId}
           and not p.is_test
           and (
             ${query.includeUnapproved === true}
             or exists (
               select 1
                 from share_contributions sc
                 join shares s on s.id = sc.share_id
                where sc.person_id = p.id
                  and sc.status = 'approved'
                  and s.status = 'approved'
             )
           )
      )
      select
        (select json_build_object(
           'person_id', a.id::text,
           'neighborhood', a.neighborhood,
           'child_birth_years', (select years from asker_kids),
           'edges', coalesce((select json_agg(json_build_object(
                'affinity_type', affinity_type,
                'affinity_value', affinity_value,
                'child_birth_years', child_birth_years))
              from asker_edges), '[]'::json),
           'relevance', coalesce((select json_agg(json_build_object(
                'dimension', lr.dimension, 'value', lr.value))
              from life_relevance lr where lr.person_id = a.id), '[]'::json)
         ) from asker a)                                            as asker,
        coalesce((select json_agg(json_build_object(
             'person_id', e.id::text,
             'neighborhood', e.neighborhood,
             'child_birth_years', coalesce(
               (select array_agg(c.birth_year) from children c where c.person_id = e.id),
               '{}'),
             'edges', coalesce((select json_agg(json_build_object(
                  'affinity_type', sa.affinity_type,
                  'affinity_value', sa.affinity_value,
                  'child_birth_years', sa.child_birth_years))
                from social_affinities sa where sa.person_id = e.id), '[]'::json),
             'relevance', coalesce((select json_agg(json_build_object(
                  'dimension', lr.dimension, 'value', lr.value))
                from life_relevance lr where lr.person_id = e.id), '[]'::json)
           )) from eligible e), '[]'::json)                          as candidates,
        coalesce((select json_agg(json_build_object(
             'affinity_type', affinity_type, 'weight', weight))
           from affinity_weights), '[]'::json)                       as weights,
        coalesce((select json_agg(json_build_object(
             'area_a', area_a, 'area_b', area_b))
           from neighborhood_adjacency where market_id = ${marketId}), '[]'::json)
                                                                     as adjacency
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!result.persisted || !result.data) return EMPTY;
  const row = result.data;

  const asker = row.asker as Person | null;
  if (!asker) return EMPTY;

  const candidates = (row.candidates ?? []) as Person[];
  const weights: Record<string, number> = {};
  for (const w of (row.weights ?? []) as Array<{ affinity_type: string; weight: number }>) {
    weights[w.affinity_type] = Number(w.weight);
  }
  /* Weights come from the table on every call rather than from a cached copy —
     spec §18.1 over §8.1, so a config edit takes effect on the next question and
     never needs a backfill of `weight_at_capture`. */
  const config: MatchConfig = {
    weights,
    adjacency: (row.adjacency ?? []) as MatchConfig["adjacency"],
  };

  return {
    ...rankCandidates(asker, candidates, config, {
      wanted,
      requirements: query.requirements,
    }),
    config,
    asker,
  };
}
