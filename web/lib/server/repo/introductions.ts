import "server-only";

import { sql } from "drizzle-orm";
import { INTRO_EXPLICIT_DAYS, INTRO_OFFER_DAYS, INTRO_OFFER_GAP_DAYS } from "@/lib/introductions";
import { withDb, type Db } from "@/lib/server/db";

/**
 * Introductions rows (`drizzle/0059`). Every write is a conditional UPDATE or
 * an insert guarded on the state it expects, so a retried webhook or a second
 * INTRO changes nothing. Never logs a name, a phone or a question (invariant 7).
 */

type Row = Record<string, unknown>;

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

/**
 * Parents who could be asked about this record: an approved, firsthand
 * contribution on it **that said yes to "if another parent asks about this one,
 * may Pando bring you their question?"** (`follow_up_ok`; unanswered is no), not
 * the asker, not a test row, not opted out (review, 21 Oct).
 */
export async function introCandidateCount(shareId: string, askerId: string): Promise<number> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select count(distinct sc.person_id) as n
          from share_contributions sc
          join people p on p.id = sc.person_id
         where sc.share_id = ${shareId}::uuid
           and sc.status = 'approved' and sc.firsthand and sc.follow_up_ok
           and sc.person_id <> ${askerId}::uuid
           and not p.is_test
           and not exists (select 1 from sms_opt_outs o
                            where o.phone = p.phone
                              and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at))
      `,
    );
    return Number(out[0]?.n ?? 0);
  });
  return r.persisted ? (r.data ?? 0) : 0;
}

/** Once a week at most, and never while one of theirs is still being worked. */
export async function mayOfferIntro(personId: string): Promise<boolean> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select 1 from introductions
         where requester_id = ${personId}::uuid
           and (created_at > now() - make_interval(days => ${INTRO_OFFER_GAP_DAYS})
                or status in ('requested', 'approved', 'contacted'))
         limit 1
      `,
    );
    return out.length === 0;
  });
  return r.persisted ? r.data === true : false;
}

export async function recordIntroOffer(input: {
  personId: string;
  shareId: string;
  shareName: string;
  answerId: string | null;
}): Promise<void> {
  await withDb(async (db) => {
    await db.execute(sql`
      insert into introductions (requester_id, share_id, share_name, answer_id, trigger, status, is_test)
      select ${input.personId}::uuid, ${input.shareId}::uuid, ${input.shareName},
             ${input.answerId}::uuid, 'proactive', 'offered', p.is_test
        from people p where p.id = ${input.personId}::uuid
    `);
    return true;
  });
}

/** When the open intro offer was made, or null — for "which offer is this yes for?". */
export async function openIntroOfferAt(personId: string): Promise<string | null> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select created_at from introductions
         where requester_id = ${personId}::uuid and status = 'offered'
           and created_at > now() - make_interval(days => ${INTRO_OFFER_DAYS})
         order by created_at desc limit 1
      `,
    );
    return out[0]?.created_at ? String(out[0].created_at) : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/** Take the open offer: offered → requested. Null when there is none (or it was already taken). */
export async function takeIntroOffer(personId: string): Promise<{ id: string; already: boolean } | null> {
  const r = await withDb(async (db) => {
    const taken = await rows(
      db,
      sql`
        update introductions i set status = 'requested', requested_at = now()
         where not exists (select 1 from introductions o
                            where o.requester_id = i.requester_id and o.share_id = i.share_id
                              and o.status in ('requested', 'approved', 'contacted'))
           and id = (
           select id from introductions
            where requester_id = ${personId}::uuid and status = 'offered'
              and created_at > now() - make_interval(days => ${INTRO_OFFER_DAYS})
            order by created_at desc limit 1)
           and status = 'offered'
        returning id
      `,
    );
    if (taken[0]?.id) return { id: String(taken[0].id), already: false };
    /* A second INTRO, or a retried webhook, finds the request it already made. */
    const recent = await rows(
      db,
      sql`
        select id from introductions
         where requester_id = ${personId}::uuid and status in ('requested', 'approved', 'contacted')
           and requested_at > now() - interval '1 day'
         order by requested_at desc limit 1
      `,
    );
    return recent[0]?.id ? { id: String(recent[0].id), already: true } : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/**
 * "Can you introduce me to a parent who goes there?" — about the answer they
 * were sent in the last three days: its first record that has somebody to ask.
 * Null when there is nothing to ask about.
 */
export async function requestIntroExplicitly(input: {
  personId: string;
  phone: string;
  /** What the parent named ("Little Maestros"), matched against the records they were sent. */
  named?: string | null;
  /**
   * "INTRO <name>": only that record. Without it a name matching nothing fell
   * through to the latest answer's first record and asked about a place the
   * parent never named (review L1). A sentence ("introduce me to a parent who
   * goes there") is not strict: it names no record, and means the latest.
   */
  strict?: boolean;
}): Promise<{ id: string; already: boolean } | null> {
  /* LIKE's own wildcards escaped, and a name of four letters or more: "intro
     the" must not match every record with "the" in it (review, 21 Oct). */
  const named = (input.named ?? "").trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const strict = input.strict === true && named !== "";
  if (strict && named.replace(/\\/g, "").length < 4) return null;
  const r = await withDb(async (db) =>
    db.transaction(async (tx) => {
      const found = await rows(
        tx as unknown as Db,
        sql`
          select a.id as answer_id, s.id as share_id, s.name
            from answers a
            cross join lateral unnest(a.share_ids) with ordinality as u(share_id, ord)
            join shares s on s.id = u.share_id
           where a.phone = ${input.phone} and a.status = 'sent'
             and s.kind not in ('caregiver', 'tip')
             and a.sent_at > now() - make_interval(days => ${INTRO_EXPLICIT_DAYS})
             and exists (
               select 1 from share_contributions sc join people p on p.id = sc.person_id
                where sc.share_id = s.id and sc.status = 'approved' and sc.firsthand and sc.follow_up_ok
                  and sc.person_id <> ${input.personId}::uuid and not p.is_test
                  and not exists (select 1 from sms_opt_outs o
                                   where o.phone = p.phone
                                     and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at)))
             and (not ${strict}
                  or lower(s.name) like '%' || ${named} || '%'
                  or ${named} like '%' || lower(s.name) || '%')
           order by
             -- The record they named first, either way round ("maestros" in
             -- "Little Maestros", or the whole name inside their sentence).
             case when ${named} <> ''
                       and (lower(s.name) like '%' || ${named} || '%'
                            or ${named} like '%' || lower(s.name) || '%')
                  then 0 else 1 end,
             a.sent_at desc, u.ord
           limit 1
        `,
      );
      if (!found[0]) return null;
      /* Already asked about this record and still open: say so (keyed on the
         record, not on any request at all - review, 21 Oct). */
      const open = await rows(
        tx as unknown as Db,
        sql`
          select id from introductions
           where requester_id = ${input.personId}::uuid and share_id = ${String(found[0].share_id)}::uuid
             and status in ('requested', 'approved', 'contacted')
           limit 1
        `,
      );
      if (open[0]?.id) return { id: String(open[0].id), already: true };
      /* ⚠ An open offer for this record is taken, not shadowed (27 Oct).
         "INTRO Little Maestros" after the offer named Little Maestros inserted a
         second, explicit row beside it and left the offer `offered`, so
         /admin/introductions read "0 of 1 offers taken" for a parent who took
         it. Promote the offer — the same move
         `takeIntroOffer` makes — and insert only when there is none. */
      const promoted = await rows(
        tx as unknown as Db,
        sql`
          update introductions set status = 'requested', requested_at = now()
           where id = (
             select id from introductions
              where requester_id = ${input.personId}::uuid
                and share_id = ${String(found[0].share_id)}::uuid
                and status = 'offered'
                and created_at > now() - make_interval(days => ${INTRO_OFFER_DAYS})
              order by created_at desc limit 1)
             and status = 'offered'
          returning id
        `,
      );
      if (promoted[0]?.id) return { id: String(promoted[0].id), already: false };
      const made = await rows(
        tx as unknown as Db,
        sql`
          insert into introductions
            (requester_id, share_id, share_name, answer_id, trigger, status, requested_at, is_test)
          select ${input.personId}::uuid, ${String(found[0].share_id)}::uuid, ${String(found[0].name)},
                 ${String(found[0].answer_id)}::uuid, 'explicit', 'requested', now(), p.is_test
            from people p where p.id = ${input.personId}::uuid
          on conflict do nothing
          returning id
        `,
      );
      /* A concurrent delivery made it first (introductions_one_open). */
      if (!made[0]?.id) return { id: "", already: true };
      return { id: String(made[0].id), already: false };
    }),
  );
  return r.persisted ? (r.data ?? null) : null;
}
