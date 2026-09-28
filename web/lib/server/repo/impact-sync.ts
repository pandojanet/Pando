import { sql, type SQL } from "drizzle-orm";

/**
 * The catch-up sweep's two statements (9.3, run by the `impact_sync` job).
 *
 * Its own module, importing nothing but `drizzle-orm`, so `test:impact-live`
 * can run the real statements inside a transaction it rolls back. `impact.ts`
 * reaches the database through `db.ts`, which carries `server-only`, and a
 * test that ran a copy of this SQL would be checking the copy.
 */

interface Executor {
  execute(query: SQL): Promise<unknown>;
}

export interface SyncResult {
  contributions: number;
  blast_answers: number;
}

export async function syncImpactIn(tx: Executor): Promise<SyncResult> {
  const contributions = (await tx.execute(sql`
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
     and counting it would let somebody earn a tier by texting back "no idea".

     Two things `test:impact-live` found (25 Sep). A reply to a test Ask is a
     test event — `blast_recipients` has no flag of its own, so it is the
     blast's, and without it a test Ask counted toward a real tier. And the
     date falls back to the Ask itself, which always has one: a row carrying
     neither a send nor a reply time (a seed script can write one) made the
     insert violate NOT NULL and took the whole sweep down with it. */
  const answers = (await tx.execute(sql`
    insert into impact_events (person_id, kind, blast_id, quality, is_test, created_at)
    select br.person_id, 'blast_answered', br.blast_id, br.quality, b.is_test,
           coalesce(br.responded_at, br.sent_at, b.created_at)
      from blast_recipients br
      join blasts b on b.id = br.blast_id
     where br.review_status = 'approved'
    on conflict do nothing
    returning 1
  `)) as unknown as unknown[];

  return { contributions: contributions.length, blast_answers: answers.length };
}
