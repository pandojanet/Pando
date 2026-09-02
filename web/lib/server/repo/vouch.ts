import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { confirmKindFor, effectOf, type ConfirmKind, type PingReply } from "@/lib/vouch";

/**
 * M10.2 — recording a confirmation, and the writes each kind of it earns.
 *
 * `lib/vouch.ts` decides *what* a confirmation does; this does it. The rule
 * worth keeping in view while reading: a **refresh** moves a date and a **vouch**
 * adds a contribution, and only the second one can ever make a record
 * "Validated by multiple parents".
 */

export interface PendingPing {
  ping_id: string;
  share_id: string;
  share_name: string;
  person_id: string;
  /** Whether this person already has an approved contribution on the record. */
  already_contributed: boolean;
  /** When the ping went out — see `PendingHelped.asked_at` for why. */
  asked_at: string | null;
}

/**
 * The ping a reply belongs to.
 *
 * Same honest approximation the rest of the inbound path makes: SMS carries no
 * thread id, so it is the most recent unanswered ping put to this number. A
 * second reply does not overwrite the first — `answered_at is null` — because a
 * parent who confirms and then texts again is saying something new.
 */
export async function pendingPing(phone: string): Promise<PendingPing | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select fp.id::text        as ping_id,
             fp.share_id::text  as share_id,
             s.name             as share_name,
             p.id::text         as person_id,
             fp.asked_at        as asked_at,
             exists (
               select 1 from share_contributions sc
                where sc.share_id = fp.share_id
                  and sc.person_id = p.id
                  and sc.status = 'approved'
             )                  as already_contributed
        from freshness_pings fp
        join people p on p.id = fp.person_id
        join shares s on s.id = fp.share_id
       where p.phone = ${phone}
         and fp.answered_at is null
       order by fp.asked_at desc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      ping_id: String(row.ping_id),
      share_id: String(row.share_id),
      share_name: String(row.share_name ?? ""),
      person_id: String(row.person_id),
      already_contributed: row.already_contributed === true,
      asked_at: (row.asked_at as string | null) ?? null,
    };
  });
  return result.persisted ? (result.data ?? null) : null;
}

/** Written after a ping actually went out — never before. */
export async function recordPingSent(personId: string, shareId: string): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      insert into freshness_pings (person_id, share_id)
      values (${personId}::uuid, ${shareId}::uuid)
    `);
    return true;
  });
}

export interface ConfirmOutcome {
  kind: ConfirmKind;
  refreshed: boolean;
  vouched: boolean;
  withdrawn: boolean;
}

/**
 * Apply a reply to a freshness ping.
 *
 * Everything in one transaction, because the parts are one fact: a confirmation
 * that moved the date but lost its impact event, or a withdrawal that marked a
 * record stale without flagging it for a person, is a half-recorded decision
 * about something other parents will be shown.
 *
 * `unclear` writes nothing at all — not even that the ping was answered. The
 * question stays open, the message goes to ordinary handling where a person can
 * read it, and the parent is not asked again (the ping job's own monthly limit
 * sees to that).
 */
export async function applyPingReply(
  ping: PendingPing,
  reply: PingReply,
): Promise<ConfirmOutcome | null> {
  const kind = confirmKindFor({ already_contributed: ping.already_contributed });
  const effect = effectOf(reply, kind);

  if (reply === "unclear") {
    return { kind, refreshed: false, vouched: false, withdrawn: false };
  }

  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        update freshness_pings
           set answered_at = now(), still_good = ${reply === "still_good"}
         where id = ${ping.ping_id}::uuid
      `);

      if (effect.refresh_freshness) {
        await tx.execute(sql`
          update shares
             set last_confirmed_at = now(), freshness_state = 'fresh'
           where id = ${ping.share_id}::uuid
        `);
      }

      if (effect.add_contribution) {
        /**
         * A second parent, arriving as `pending_review`.
         *
         * `firsthand` is **true** here and false for a blast reply, and the
         * difference is what was actually asked. A ping asks "is it still worth
         * recommending?" of somebody the matcher picked as connected to it; a
         * blast reply is an unprompted opinion about a place. Neither is
         * certainty, which is why this waits for an admin — but a vouch that
         * arrived as secondhand could never become the validation 10.2 exists
         * to produce, and would silently make the feature do nothing.
         */
        await tx.execute(sql`
          insert into share_contributions
            (share_id, person_id, firsthand, recommendation, status)
          values (${ping.share_id}::uuid, ${ping.person_id}::uuid, true, 'yes',
                  'pending_review')
          on conflict do nothing
        `);
      }

      if (effect.mark_stale) {
        /* Marked, never hidden — the spec's answer to old knowledge, and here it
           is one parent's changed mind rather than the network's verdict. */
        await tx.execute(sql`
          update shares set freshness_state = 'stale' where id = ${ping.share_id}::uuid
        `);
      }

      if (effect.flag_reason) {
        await tx.execute(sql`
          insert into flags (severity, reason, subject_kind, subject_id, person_id)
          select 'review', ${effect.flag_reason}, 'share', ${ping.share_id}::uuid,
                 ${ping.person_id}::uuid
           where not exists (
             select 1 from flags f
              where f.reason = ${effect.flag_reason}
                and f.subject_id = ${ping.share_id}::uuid
                and f.status = 'open'
           )
        `);
      }

      if (effect.record_impact) {
        await tx.execute(sql`
          insert into impact_events (person_id, kind, share_id)
          values (${ping.person_id}::uuid, 'freshness_confirmed', ${ping.share_id}::uuid)
          on conflict do nothing
        `);
      }

      return true;
    }),
  );

  if (!result.persisted) return null;
  return {
    kind,
    refreshed: effect.refresh_freshness,
    vouched: effect.add_contribution,
    withdrawn: effect.mark_stale,
  };
}
