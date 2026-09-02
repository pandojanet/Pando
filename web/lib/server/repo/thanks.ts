import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { shouldPrompt, shouldThank, type AnswerState } from "@/lib/thanks";

/**
 * M9.1 + M9.2 — the queries behind the thanks loop.
 *
 * `lib/thanks.ts` holds the windows and the batching rule and knows nothing
 * about a database; this fetches what they judge. Same split as everywhere else
 * in Phase 2, and the same reason.
 *
 * ## Neither half decides whether to send
 *
 * Both of these return *who is worth asking*. Whether that person may actually
 * be texted is `sendSms`'s answer — opt-out, quiet hours, the 48-hour gap, the
 * monthly ceiling — and it is asked at send time, where a refusal counts as a
 * skip rather than a failure. A contributor inside their gap is the system
 * working, and a thank-you is the message it is least costly to delay.
 */

export interface DueAnswer {
  answer_id: string;
  person_id: string | null;
  phone: string;
}

/**
 * 9.1 — the answers whose window has opened.
 *
 * The window is decided in `lib/thanks.ts` rather than in SQL, deliberately: it
 * differs by the kind of record the answer used, "the slowest kind wins" is a
 * rule with a reason attached, and a `case` expression buried in a query is
 * where that reason goes to die. The query's job is to bring back the kinds.
 *
 * A cap, because this sends: it is a daily job and a backlog that texted two
 * hundred parents in one run would be a very loud way to discover a bug.
 */
export async function answersDuePrompt(limit = 25): Promise<DueAnswer[]> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select a.id::text          as answer_id,
             a.person_id::text   as person_id,
             a.phone             as phone,
             a.sent_at           as sent_at,
             coalesce(
               array_agg(distinct s.kind::text) filter (where s.kind is not null),
               '{}'
             )                   as kinds
        from answers a
        left join shares s on s.id = any(a.share_ids)
       where a.status = 'sent'
         and a.sent_at is not null
         and a.helped_asked_at is null
         and not a.is_test
       group by a.id, a.person_id, a.phone, a.sent_at
       order by a.sent_at asc
       limit ${limit * 4}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!result.persisted || !result.data) return [];

  const due: DueAnswer[] = [];
  for (const row of result.data) {
    const state: AnswerState = {
      sent_at: (row.sent_at as string | null) ?? null,
      helped_asked_at: null,
      kinds: Array.isArray(row.kinds) ? (row.kinds as string[]) : [],
    };
    if (!shouldPrompt(state).ask) continue;
    const phone = typeof row.phone === "string" ? row.phone : "";
    if (!phone) continue;
    due.push({
      answer_id: String(row.answer_id),
      person_id: (row.person_id as string | null) ?? null,
      phone,
    });
    if (due.length >= limit) break;
  }
  return due;
}

/**
 * Stamped **after** the send, never before.
 *
 * The column is the job's own queue, so stamping first would mean a send the
 * carrier refused still took the answer off the list — and 9.1 gets exactly one
 * chance to ask, because past the window the question is not worth asking. Same
 * ordering rule as `message_log` in the send layer, for the same reason.
 */
export async function markPrompted(answerId: string): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      update answers set helped_asked_at = now() where id = ${answerId}::uuid
    `);
    return true;
  });
}

/**
 * The answer a "YES" or "NO" belongs to.
 *
 * SMS carries no thread id, so this is the same honest approximation the inbound
 * webhook already makes for a blast reply: the most recent question of this kind
 * put to this number, and only one that is still unanswered. **A second reply
 * does not overwrite the first** — the `helped is null` clause — because a
 * parent who says yes and then texts again is telling us something new, not
 * revising their verdict.
 */
export interface PendingHelped {
  answer_id: string;
  /**
   * When it was asked.
   *
   * Carried because a bare "yes" is ambiguous the moment two questions are
   * outstanding: 9.1 asks "did it help?" and 10.3 asks "is it still worth
   * recommending?", and both are answered with the same word. The inbound route
   * resolves that by **which question was asked more recently**, which is the
   * same mechanism `message_log.template` provides for the other collisions
   * (8.3's bare "5", the clarifying flow) — the words cannot separate them, so
   * the records do.
   */
  asked_at: string | null;
}

export async function pendingHelpedAnswer(phone: string): Promise<PendingHelped | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select a.id::text as answer_id, a.helped_asked_at as asked_at
        from answers a
       where a.phone = ${phone}
         and a.helped_asked_at is not null
         and a.helped is null
       order by a.helped_asked_at desc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      answer_id: String(row.answer_id),
      asked_at: (row.asked_at as string | null) ?? null,
    };
  });
  return result.persisted ? (result.data ?? null) : null;
}

/**
 * 9.1 closing, and 9.3 recording.
 *
 * A **yes** is the one moment Pando learns that a recommendation actually
 * reached somebody and worked, so it writes `answer_used` for every contributor
 * behind it — in the same transaction as the verdict, the way an audit row is,
 * so a ledger entry cannot be lost separately from the fact it records.
 *
 * A **no** records the verdict and writes nothing. It is not evidence against
 * the contributor: a recommendation can be excellent and wrong for one family,
 * and a negative ledger is not a thing this system has. What a "no" is for is
 * the admin reading the answers queue.
 */
export async function recordHelped(answerId: string, helped: boolean): Promise<boolean> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        update answers set helped = ${helped} where id = ${answerId}::uuid
      `);
      if (!helped) return true;

      /* Every parent with an approved contribution behind a record this answer
         used. `on conflict do nothing` means a second answer drawing on the same
         record does not double-count the same contributor for the same share —
         which is right: the ledger says a recommendation of theirs was used, and
         `answer_used` is worth nothing toward a tier in any case (see
         `lib/tiers.ts`). It is a receipt, not a score. */
      await tx.execute(sql`
        insert into impact_events (person_id, kind, share_id)
        select distinct sc.person_id, 'answer_used', sc.share_id
          from answers a
          join share_contributions sc on sc.share_id = any(a.share_ids)
         where a.id = ${answerId}::uuid
           and sc.status = 'approved'
           and sc.person_id is not null
        on conflict do nothing
      `);
      return true;
    }),
  );
  return result.persisted === true;
}

export interface ThanksTarget {
  person_id: string;
  phone: string;
  items: string[];
}

/**
 * 9.2 — who is owed a thank-you, and for what.
 *
 * The trigger is 9.1's yes: a contributor is thanked when a parent said their
 * recommendation helped, never merely for having contributed. Approving a card
 * is already acknowledged on screen; this message exists to carry the one fact
 * nobody else can tell them, which is that it reached somebody.
 *
 * **The week is measured from `message_log`**, not from a column on the person.
 * That table is already the record of every proactive message, so a second
 * counter would be a second thing to keep true — the same reasoning as the
 * monthly ping limit.
 */
export async function contributorsToThank(limit = 25): Promise<ThanksTarget[]> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      with last_thanks as (
        select person_id, max(sent_at) as at
          from message_log
         where direction = 'out' and template = 'thanks'
         group by person_id
      )
      select p.id::text                                as person_id,
             p.phone                                   as phone,
             lt.at                                     as last_thanked_at,
             array_agg(s.name order by e.created_at desc)
               filter (where s.name is not null)       as items
        from impact_events e
        join people p  on p.id = e.person_id
        left join shares s on s.id = e.share_id
        left join last_thanks lt on lt.person_id = p.id
       where e.kind = 'answer_used'
         and not e.is_test
         and (lt.at is null or e.created_at > lt.at)
       group by p.id, p.phone, lt.at
       limit ${limit * 2}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!result.persisted || !result.data) return [];

  const targets: ThanksTarget[] = [];
  for (const row of result.data) {
    const phone = typeof row.phone === "string" ? row.phone : "";
    if (!phone) continue;
    const items = Array.isArray(row.items) ? (row.items as string[]) : [];
    const verdict = shouldThank({
      person_id: String(row.person_id),
      items,
      last_thanked_at: (row.last_thanked_at as string | null) ?? null,
    });
    if (!verdict.send) continue;
    targets.push({ person_id: String(row.person_id), phone, items: verdict.items });
    if (targets.length >= limit) break;
  }
  return targets;
}
