import { sql, type SQL } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import {
  responseEquivalents,
  tierFor,
  type ImpactEvent,
  type ImpactKind,
  type TierId,
} from "@/lib/tiers";

/**
 * M9.3 + M9.4 — writing impact events, and reading a contributor's standing.
 *
 * `lib/tiers.ts` holds the ladder and knows nothing about a database; this
 * fetches what it judges. Same split as `matching.ts` / `repo/matching.ts`, and
 * the reason is the same one: what somebody has earned is a rule, and a rule
 * that needs a connection cannot be tested exhaustively.
 *
 * ## Nothing here fails a caller
 *
 * The opposite of `repo/outreach.ts`, deliberately. There, an unreadable
 * database has to mean "do not send", because sending cannot be taken back.
 * Here a missed event means a tier is briefly low, which `syncImpact` repairs on
 * its next run — so a failed write must never abort the approval it accompanies.
 * An admin's decision is the important thing in that transaction; the ledger
 * entry is bookkeeping about it.
 */

/**
 * Anything that can run a statement — a connection or an open transaction.
 *
 * Structural on purpose: the live writes below run **inside the same
 * transaction as the admin decision they accompany**, the way every audit row
 * has since 6 Aug, and `Db["transaction"]`'s argument is not a `Db`.
 */
interface Executor {
  execute(query: SQL): Promise<unknown>;
}

export interface ImpactWrite {
  personId: string;
  kind: ImpactKind;
  shareId?: string | null;
  blastId?: string | null;
  /** The admin's 1-5 rating, where one exists. */
  quality?: number | null;
  isTest?: boolean;
}

/**
 * One statement, safe to run twice.
 *
 * `impact_events_once` is a unique index on (person, kind, subject), so an admin
 * who approves a contribution, rejects it and approves it again does not mint a
 * second event — and neither does the catch-up sweep. Idempotence is the whole
 * reason the index exists rather than a check in code: the sweep and the live
 * write race by design.
 */
export function insertImpact(tx: Executor, write: ImpactWrite) {
  return tx.execute(sql`
    insert into impact_events (person_id, kind, share_id, blast_id, quality, is_test)
    values (${write.personId}::uuid, ${write.kind},
            ${write.shareId ?? null}::uuid, ${write.blastId ?? null}::uuid,
            ${write.quality ?? null}, ${write.isTest ?? false})
    on conflict do nothing
  `);
}

/**
 * The same, for a contribution whose owner the caller has not read.
 *
 * An insert-select rather than a read followed by a write: against the pooler a
 * round trip is the only cost that matters (10 Aug), and the admin action this
 * runs inside is already paying for several. It also cannot race — the person,
 * the share and the test flag are read at the moment they are written.
 */
export function insertContributionImpact(tx: Executor, contributionId: string) {
  return tx.execute(sql`
    insert into impact_events (person_id, kind, share_id, is_test)
    select sc.person_id, 'contribution_approved', sc.share_id, sc.is_test
      from share_contributions sc
     where sc.id = ${contributionId}::uuid
       and sc.person_id is not null
    on conflict do nothing
  `);
}

/**
 * The rating arrived after the event did.
 *
 * 7.6 rates a reply and approves it as two separate actions, in either order, so
 * the ledger has to be able to learn a rating late. **The event keeps its own
 * copy** rather than joining `blast_recipients` at read time: a ledger that has
 * to reach into four tables to say what an entry was worth is one nobody can
 * audit, and a rating changes rarely and always through this one path.
 */
export function updateImpactQuality(
  tx: Executor,
  personId: string,
  blastId: string,
  quality: number,
) {
  return tx.execute(sql`
    update impact_events
       set quality = ${quality}
     where person_id = ${personId}::uuid
       and blast_id = ${blastId}::uuid
       and kind = 'blast_answered'
  `);
}

export interface Standing {
  person_id: string;
  tier: TierId;
  /** Lifetime quality responses. Admin-side: never shown to the contributor. */
  equivalents: number;
  /** What the ledger holds, by kind — the raw material of an impact receipt. */
  counts: Record<ImpactKind, number>;
}

const EMPTY_COUNTS: Record<ImpactKind, number> = {
  contribution_approved: 0,
  blast_answered: 0,
  freshness_confirmed: 0,
  answer_used: 0,
};

/**
 * Where a set of people stand.
 *
 * Takes a list because every caller that wants one wants a page of them — the
 * 10 Aug lesson that against the pooler a round trip is the only cost that
 * matters, so a per-person query inside a loop is the slow shape however it is
 * written. An empty list is answered without a query at all.
 */
export async function standingsFor(personIds: string[]): Promise<Standing[]> {
  const ids = personIds.filter((v) => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return [];

  /* A Postgres array literal, not a JS array: drizzle expands the latter into a
     record and the cast then fails — the same trap as `repo/caregiver.ts`. */
  const list = "{" + ids.map((v) => '"' + v + '"').join(",") + "}";

  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select p.id::text                         as person_id,
             p.founding::text                   as founding,
             coalesce(e.kind, '')               as kind,
             e.quality                          as quality,
             count(e.id)::int                   as n
        from people p
        left join impact_events e
               on e.person_id = p.id
              and not e.is_test
       where p.id = any(${list}::uuid[])
       group by p.id, p.founding, e.kind, e.quality
    `)) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!result.persisted || !result.data) return [];

  const byPerson = new Map<
    string,
    { founding: boolean; events: ImpactEvent[]; counts: Record<ImpactKind, number> }
  >();

  for (const row of result.data) {
    const personId = String(row.person_id);
    let entry = byPerson.get(personId);
    if (!entry) {
      entry = {
        founding: row.founding === "founding",
        events: [],
        counts: { ...EMPTY_COUNTS },
      };
      byPerson.set(personId, entry);
    }
    const kind = String(row.kind) as ImpactKind;
    if (!(kind in EMPTY_COUNTS)) continue;
    const n = Number(row.n ?? 0);
    const quality =
      row.quality === null || row.quality === undefined ? null : Number(row.quality);
    entry.counts[kind] += n;
    for (let i = 0; i < n; i++) entry.events.push({ kind, quality });
  }

  return ids
    .filter((personId) => byPerson.has(personId))
    .map((personId) => {
      const entry = byPerson.get(personId)!;
      const equivalents = responseEquivalents(entry.events);
      return {
        person_id: personId,
        tier: tierFor({ founding: entry.founding, equivalents }),
        equivalents,
        counts: entry.counts,
      };
    });
}

export interface SyncResult {
  contributions: number;
  blast_answers: number;
}

/**
 * The catch-up sweep (a 9.5 job).
 *
 * Two things make it necessary rather than tidy. The ledger starts empty while
 * the seed cohort's contributions were approved months earlier, so without a
 * backfill every founding contributor would read as a Member on day one. And a
 * live write can be lost — it is deliberately allowed to fail without failing
 * the admin action it accompanies, per the header — so something has to notice.
 *
 * Both inserts are `on conflict do nothing` against `impact_events_once`, which
 * is what lets this run beside the live path without coordinating with it.
 */
export async function syncImpact(): Promise<SyncResult | null> {
  const result = await withDb(async (db: Db) => {
    const contributions = (await db.execute(sql`
      insert into impact_events (person_id, kind, share_id, is_test, created_at)
      select sc.person_id, 'contribution_approved', sc.share_id, sc.is_test,
             coalesce(sc.approved_at, sc.created_at)
        from share_contributions sc
       where sc.status = 'approved'
         and sc.person_id is not null
      on conflict do nothing
      returning 1
    `)) as unknown as unknown[];

    /* An answered Ask enters the ledger when the reply was approved (7.6), not
       when it arrived: an unread reply is not yet a contribution to anything,
       and counting it would let somebody earn a tier by texting back "no idea". */
    const answers = (await db.execute(sql`
      insert into impact_events (person_id, kind, blast_id, quality, created_at)
      select br.person_id, 'blast_answered', br.blast_id, br.quality,
             coalesce(br.responded_at, br.sent_at)
        from blast_recipients br
       where br.review_status = 'approved'
      on conflict do nothing
      returning 1
    `)) as unknown as unknown[];

    return { contributions: contributions.length, blast_answers: answers.length };
  });

  return result.persisted ? (result.data ?? null) : null;
}
