import "server-only";

import { sql } from "drizzle-orm";
import {
  DEEP_DIVE_OFFER_GAP_DAYS,
  DEEP_DIVE_OFFER_HOURS,
  DEEP_DIVE_OFFER_VERSION,
  DEEP_DIVE_TOPIC_HOURS,
  type DeepFamily,
} from "@/lib/deep-dive";
import { baseQuestion } from "@/lib/more-options";
import { withDb, type Db } from "@/lib/server/db";

/**
 * Deep Dive rows (`drizzle/0058`) — the offer, the yes, the report.
 *
 * Every write is a conditional UPDATE on the state it expects, so a second DEEP
 * or a retried webhook changes nothing. Questions are stored, never logged
 * (invariant 7).
 */

type Row = Record<string, unknown>;

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

/** Pando offered one at the end of an answer. */
export async function recordDeepDiveOffer(input: {
  personId: string;
  question: string;
  sourceAnswerId: string | null;
}): Promise<string | null> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        insert into deep_dives (person_id, question, trigger, status, source_answer_id, offer_version, is_test)
        select ${input.personId}::uuid, ${input.question}, 'proactive', 'offered',
               ${input.sourceAnswerId}::uuid, ${DEEP_DIVE_OFFER_VERSION}, p.is_test
          from people p where p.id = ${input.personId}::uuid
        returning id
      `,
    );
    return out[0]?.id ? String(out[0].id) : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/**
 * May Pando offer again? Not within a week of an offer the parent left
 * unanswered, and never over one still being built or waiting for a topic —
 * each with an age limit, so a row a crash left behind cannot silence the
 * offer for ever.
 *
 * ⚠ **Only an offer not taken counts toward the week** (26 Oct). Counting every
 * row meant a parent who had just read a report and asked "top 5 camps" next
 * got no offer for seven days — the week is there so an offer is not a sales
 * line, and a parent who said yes last time is not being sold to.
 */
export async function mayOfferDeepDive(personId: string): Promise<boolean> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select 1 from deep_dives
         where person_id = ${personId}::uuid
           and ((status = 'offered' and created_at > now() - make_interval(days => ${DEEP_DIVE_OFFER_GAP_DAYS}))
                or (status = 'generating' and created_at > now() - interval '30 minutes')
                or (status = 'awaiting_topic'
                    and created_at > now() - make_interval(hours => ${DEEP_DIVE_TOPIC_HOURS})))
         limit 1
      `,
    );
    return out.length === 0;
  });
  return r.persisted ? r.data === true : false;
}

/**
 * The open offer, if this person has one. A plain yes accepts within the
 * offer's 48 hours; DEEP, the word it asked for, for longer (the caller says).
 */
export async function openDeepDiveOffer(
  personId: string,
  hours: number = DEEP_DIVE_OFFER_HOURS,
): Promise<{ id: string; question: string; created_at: string } | null> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select o.id, o.question, o.created_at from deep_dives o
         where o.person_id = ${personId}::uuid and o.status = 'offered'
           and o.created_at > now() - make_interval(hours => ${hours})
           -- An offer older than a deep dive they have since had is spent: a
           -- later yes must not build a second one (review, 21 Oct).
           and not exists (select 1 from deep_dives d
                             where d.person_id = o.person_id and d.status <> 'offered'
                               and d.created_at > o.created_at)
         order by o.created_at desc limit 1
      `,
    );
    return out[0]
      ? { id: String(out[0].id), question: String(out[0].question ?? ""), created_at: String(out[0].created_at) }
      : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/** The deep dive waiting for "what should it be about?". */
export async function deepDiveAwaitingTopic(personId: string): Promise<string | null> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select id from deep_dives
         where person_id = ${personId}::uuid and status = 'awaiting_topic'
           and created_at > now() - make_interval(hours => ${DEEP_DIVE_TOPIC_HOURS})
         order by created_at desc limit 1
      `,
    );
    return out[0]?.id ? String(out[0].id) : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/**
 * Is one already on its way (`building`), or did one just land (`just_sent`,
 * the last ten minutes)? A second DEEP or a retried webhook builds nothing in
 * either case.
 *
 * ⚠ **Two answers, not one** (26 Oct): it was a boolean, so a parent who read a
 * report and asked for another on a new subject two minutes later was told
 * *"Your deep dive is still on its way"* — about one that had already arrived.
 * Only `building` is "on its way"; after `just_sent` a request that names its
 * own subject starts a new one.
 */
export async function deepDiveInFlight(personId: string): Promise<"building" | "just_sent" | null> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select case when status = 'generating' then 'building' else 'just_sent' end as state
          from deep_dives
         where person_id = ${personId}::uuid
           and ((status = 'generating' and created_at > now() - interval '30 minutes')
                or (status = 'sent' and sent_at > now() - interval '10 minutes'))
         order by (status = 'generating') desc
         limit 1
      `,
    );
    return out[0]?.state === "building" ? "building" : out[0]?.state === "just_sent" ? "just_sent" : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/** Accept an offer. False when it was already accepted (a second DEEP). */
export async function acceptDeepDive(id: string): Promise<boolean> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        update deep_dives set status = 'generating', accepted_at = now()
         where id = ${id}::uuid and status = 'offered'
        returning id
      `,
    );
    return out.length > 0;
  });
  return r.persisted ? r.data === true : false;
}

/** A parent asked for one. `question` null means Pando must ask what about. */
export async function startExplicitDeepDive(input: {
  personId: string;
  question: string | null;
}): Promise<string | null> {
  const r = await withDb(async (db) => {
    /* A new request closes any older one still waiting for its topic, so the
       old one cannot catch the parent's next message. */
    await db.execute(sql`
      update deep_dives set status = 'failed'
       where person_id = ${input.personId}::uuid and status = 'awaiting_topic'
    `);
    const out = await rows(
      db,
      sql`
        insert into deep_dives (person_id, question, trigger, status, accepted_at, is_test)
        select ${input.personId}::uuid, ${input.question}, 'explicit',
               ${input.question ? "generating" : "awaiting_topic"},
               ${input.question ? sql`now()` : sql`null`}, p.is_test
          from people p where p.id = ${input.personId}::uuid
        returning id
      `,
    );
    return out[0]?.id ? String(out[0].id) : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/** The topic arrived for a deep dive that asked for one. */
export async function setDeepDiveTopic(id: string, question: string): Promise<boolean> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        update deep_dives set question = ${question}, status = 'generating', accepted_at = now()
         where id = ${id}::uuid and status = 'awaiting_topic'
        returning id
      `,
    );
    return out.length > 0;
  });
  return r.persisted ? r.data === true : false;
}

/** The parent said never mind to "what should it be about?". Recorded as failed: nothing was built. */
export async function cancelAwaitingDeepDive(id: string): Promise<void> {
  await withDb(async (db) => {
    await db.execute(sql`
      update deep_dives set status = 'failed'
       where id = ${id}::uuid and status = 'awaiting_topic'
    `);
    return true;
  });
}

/** Close one: sent (with the report's answer row and its quality counts), failed, or unsupported. */
export async function finishDeepDive(input: {
  id: string;
  status: "sent" | "failed" | "unsupported";
  answerId?: string | null;
  parts?: number | null;
  drafted?: boolean;
  reasonsKept?: number;
  parentOptions?: number;
  publicOptions?: number;
}): Promise<void> {
  await withDb(async (db) => {
    await db.execute(sql`
      update deep_dives
         set status = ${input.status},
             answer_id = coalesce(${input.answerId ?? null}::uuid, answer_id),
             parts = coalesce(${input.parts ?? null}::int, parts),
             drafted = coalesce(${input.drafted ?? null}::boolean, drafted),
             reasons_kept = coalesce(${input.reasonsKept ?? null}::int, reasons_kept),
             parent_options = coalesce(${input.parentOptions ?? null}::int, parent_options),
             public_options = coalesce(${input.publicOptions ?? null}::int, public_options),
             sent_at = case when ${input.status} = 'sent' then now() else sent_at end
       where id = ${input.id}::uuid and status = 'generating'
    `);
    return true;
  });
}

/**
 * The parent's last question, for "I want a deep dive" with no subject — the
 * thing they were just asking about, if they asked within three days.
 *
 * ⚠ Only one that went out unheld: a health, legal or safety question, a
 * claim about a person or a care question was held for a reason, and a deep
 * dive (no reviewer) must never be built on it.
 */
export async function lastQuestionFor(phone: string): Promise<string | null> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select question_text from answers
         where phone = ${phone} and created_at > now() - interval '3 days'
           and question_text is not null
           and status = 'sent' and hold_reason = 'not_held'
         order by created_at desc limit 1
      `,
    );
    const q = out[0]?.question_text ? String(out[0].question_text) : null;
    /* A follow-up is stored with a suffix (`withMoreSuffix`); the topic is the question before it. */
    return q ? baseQuestion(q).trim() || null : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/**
 * What the family told Pando that a report should weigh (`questions.ts` ids):
 * travel time, budget preference, logistics. Read from `raw_answers`, where the
 * profile keeps every tap; absent keys are simply absent.
 */
export async function deepDiveFamily(personId: string): Promise<Omit<DeepFamily, "children" | "home">> {
  const r = await withDb(async (db) => {
    const out = await rows(
      db,
      sql`
        select raw_answers -> 'travel_time' as travel_time,
               raw_answers -> 'budget'      as budget,
               raw_answers -> 'logistics'   as logistics
          from people where id = ${personId}::uuid
      `,
    );
    return out[0] ?? null;
  });
  const row = r.persisted ? r.data : null;
  const one = (v: unknown): string | null =>
    typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
  const many = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
  return {
    travel_time: one(row?.travel_time),
    budget: one(row?.budget),
    logistics: many(row?.logistics),
  };
}
