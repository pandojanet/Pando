import "server-only";
import { sql } from "drizzle-orm";
import { askAt, feedbackOn, remindAt, remindOn, runningUntil, type Feedback, type FollowupItem, type PickOutcome } from "@/lib/digest-followup";
import { withDb, type Db } from "@/lib/server/db";
import { textDates } from "@/lib/digest";
import { detailColumns, hasDigestDetails } from "@/lib/server/repo/digest";

/**
 * The weekly digest, answered (11 Nov, drizzle/0067; the rules are in
 * `lib/digest-followup.ts`): what a family was sent and picked, the reminder
 * they asked for, and the feedback buttons. Counts and enums only in the log.
 */

type Row = Record<string, unknown>;
const rows = async (db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];

/** What the digest's own sweeps send, at a moment of their choosing — not a turn of the conversation. */
const SWEEP_TEMPLATES = new Set(["digest_reminder", "digest_feedback_ask"]);

/**
 * The templates a reply may answer: `last`, the last text Pando sent this
 * person (a feedback tap answers "how was it?"), and `conversation`, the last
 * one that was not a reminder or question the sweeps sent — so a "2" to
 * Saturday's digest is still a pick when last week's "how was it?" went out at
 * 10:00, and a YES still answers the details when a reminder arrived first
 * (review, 11 Nov).
 */
export async function lastOutboundTemplates(personId: string): Promise<{ last: string | null; conversation: string | null }> {
  const r = await withDb(async (db: Db) => {
    const out = await rows(db, sql`
      select template from message_log
       where person_id = ${personId}::uuid and direction = 'out' and template is not null
       order by sent_at desc nulls last limit 6
    `);
    const templates = out.map((o) => String(o.template));
    return { last: templates[0] ?? null, conversation: templates.find((t) => !SWEEP_TEMPLATES.has(t)) ?? null };
  });
  return r.persisted && r.data ? r.data : { last: null, conversation: null };
}

/** Their weekly digest is on: the latest digest consent is a yes — the same test the sweeps send by (`DIGEST_ON`). */
export async function digestIsOn(personId: string): Promise<boolean> {
  const r = await withDb(async (db: Db) => {
    const out = await rows(db, sql`
      select status from consents where person_id = ${personId}::uuid and scope = 'digest'
       order by captured_at desc limit 1
    `);
    return out[0]?.status === "opted_in";
  });
  return r.persisted && r.data === true;
}

/** How many of the newest texts to this person, in a row, were this template (13 Nov: a capture question asked twice). */
export async function repeatsOfLastOutbound(personId: string, template: string): Promise<number> {
  const r = await withDb(async (db: Db) => {
    const out = await rows(db, sql`
      select template from message_log
       where person_id = ${personId}::uuid and direction = 'out' and template is not null
       order by sent_at desc nulls last limit 3
    `);
    let n = 0;
    for (const o of out) {
      if (String(o.template) !== template) break;
      n++;
    }
    return n;
  });
  return r.persisted ? (r.data ?? 0) : 0;
}

export interface SentDigest {
  editionDate: string;
  items: Array<FollowupItem & { id: string }>;
}

/**
 * Their last digest of the past eight days: its date and its items, in their
 * numbers' order. With `editionDate` (a tapped number that carries it, 11 Nov),
 * the digest of that Saturday, however old.
 */
export async function lastDigestSent(personId: string, editionDate?: string | null): Promise<SentDigest | null> {
  const r = await withDb(async (db: Db) => {
    const send = await rows(db, editionDate
      ? sql`
      select s.item_ids::text[] as item_ids, e.edition_date::text as edition_date
        from digest_sends s join digest_editions e on e.id = s.edition_id
       where s.person_id = ${personId}::uuid and s.item_count > 0 and e.edition_date = ${editionDate}::date
       order by s.sent_at desc limit 1`
      : sql`
      select s.item_ids::text[] as item_ids, e.edition_date::text as edition_date
        from digest_sends s join digest_editions e on e.id = s.edition_id
       where s.person_id = ${personId}::uuid and s.item_count > 0 and s.sent_at > now() - interval '8 days'
       order by s.sent_at desc limit 1`);
    const ids = (send[0]?.item_ids as string[] | undefined) ?? [];
    if (!send[0] || ids.length === 0) return null;
    const found = await rows(db, sql`
      select id::text as id, kind, title, when_text, starts_on::text as starts_on, ends_on::text as ends_on, place, summary, url
             ${detailColumns(await hasDigestDetails(db))}
        from digest_items where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    const byId = new Map(found.map((f) => [String(f.id), f]));
    const items = ids.map((id) => byId.get(id)).filter((f): f is Row => !!f).map((f) => ({
      id: String(f.id),
      kind: String(f.kind),
      title: String(f.title),
      when_text: String(f.when_text),
      starts_on: f.starts_on ? String(f.starts_on) : null,
      ends_on: f.ends_on ? String(f.ends_on) : null,
      place: f.place ? String(f.place) : null,
      summary: String(f.summary),
      url: String(f.url),
      price: f.price ? String(f.price) : null,
      about: f.about ? String(f.about) : null,
      popular: f.popular === true,
      popular_why: f.popular_why ? String(f.popular_why) : null,
    }));
    /* An item gone since (its edition deleted) would move every later number
       up one: then the digest is not read as picks at all (review, 11 Nov). */
    if (items.length !== ids.length) return null;
    return { editionDate: String(send[0].edition_date), items };
  });
  return r.persisted ? (r.data ?? null) : null;
}

/**
 * The details of a pick were sent (25 Nov — the developer: *a tap on a number
 * opens the details, and then the reminder Yes/No*): the interest row is made
 * if it is not there and stamped, so the YES or NO that follows is read
 * against this item (`lastDetailsItem`). A reminder already set is left set.
 */
export async function markDetailsShown(personId: string, itemId: string): Promise<{ reminderSet: boolean } | null> {
  const r = await withDb(async (db: Db) => {
    const found = await rows(db, sql`
      insert into digest_interests (person_id, item_id) values (${personId}::uuid, ${itemId}::uuid)
      on conflict (person_id, item_id) do update set updated_at = now()
      returning status, reminded_at
    `);
    return { reminderSet: found[0]?.status === "going" && !found[0]?.reminded_at };
  });
  return r.persisted ? (r.data ?? null) : null;
}

/** NO to the details' reminder question: a reminder set and not yet sent is taken off. True when one was. */
export async function clearPick(personId: string, itemId: string): Promise<boolean> {
  const r = await withDb(async (db: Db) => {
    const found = await rows(db, sql`
      update digest_interests set status = 'declined', updated_at = now()
       where person_id = ${personId}::uuid and item_id = ${itemId}::uuid and status = 'going' and reminded_at is null
      returning 1 as one
    `);
    return found.length > 0;
  });
  return r.persisted ? r.data === true : false;
}

/** The item whose details were sent last, within a week, and the edition it is in — what a YES or NO answers. */
export async function lastDetailsItem(personId: string): Promise<{ itemId: string; editionDate: string } | null> {
  const r = await withDb(async (db: Db) => {
    const found = await rows(db, sql`
      select i.item_id::text as item_id, e.edition_date::text as edition_date
        from digest_interests i
        join digest_items d on d.id = i.item_id
        join digest_editions e on e.id = d.edition_id
       where i.person_id = ${personId}::uuid and i.updated_at > now() - interval '7 days'
       order by i.updated_at desc limit 1
    `);
    return found[0] ? { itemId: String(found[0].item_id), editionDate: String(found[0].edition_date) } : null;
  });
  return r.persisted ? (r.data ?? null) : null;
}

/**
 * One pick (11 Nov, evening): a tap sets the reminder, the same tap again takes
 * it off. Set: the row is `going` with its moments (on the market's clock,
 * `remindAt` / `askAt`). Taken off: `declined`. A pick whose day is past or
 * today says so (`too_late`); one with no date at all, `no_day` — both kept as
 * `picked` with no moments. One already reminded is left as it is.
 *
 * In one transaction holding the row (review, 11 Nov): two quick taps, or a tap
 * while the sweep claims the reminder, are taken one after the other — never
 * both "set", never "taken off" while the reminder goes. Null when the database
 * could not be reached.
 *
 * `mode: "set"` (the developer, 11 Nov: *"so that 1 and 3 both get
 * reminders"*): several numbers typed at once only set — one already set stays
 * set and is said to be (`already_set`); only a single pick takes one off.
 */
export async function togglePick(
  personId: string,
  editionDate: string,
  today: string,
  timeZone: string,
  item: FollowupItem & { id: string },
  n: number,
  mode: "toggle" | "set" = "toggle",
): Promise<PickOutcome | null> {
  const r = await withDb((db: Db) =>
    db.transaction(async (tx): Promise<PickOutcome> => {
      await tx.execute(sql`
        insert into digest_interests (person_id, item_id) values (${personId}::uuid, ${item.id}::uuid)
        on conflict (person_id, item_id) do nothing
      `);
      const held = (await tx.execute(sql`
        select status, reminded_at is not null as reminded, remind_at, remind_on::text as remind_on from digest_interests
         where person_id = ${personId}::uuid and item_id = ${item.id}::uuid
         for update
      `)) as unknown as Row[];
      const was = held[0];
      if (was?.reminded === true) return { n, title: item.title, state: "reminded" };
      if (was?.status === "going" && mode === "set" && was.remind_at) {
        const running = was.remind_on ? runningUntil(item, String(was.remind_on)) : undefined;
        return { n, title: item.title, state: "already_set", at: new Date(String(was.remind_at)), weekly: textDates(item.when_text).weekly.size > 0, ...(running ? { running } : {}) };
      }
      if (was?.status === "going") {
        await tx.execute(sql`
          update digest_interests set status = 'declined', updated_at = now()
           where person_id = ${personId}::uuid and item_id = ${item.id}::uuid
        `);
        return { n, title: item.title, state: "unset" };
      }
      const remind = remindOn(item, editionDate, today);
      const at = remind ? remindAt(item, remind, timeZone) : null;
      if (!remind || !at || at.getTime() <= Date.now()) {
        return { n, title: item.title, state: item.starts_on || item.ends_on ? "too_late" : "no_day" };
      }
      const ask = askAt(feedbackOn(remind, item), timeZone);
      await tx.execute(sql`
        update digest_interests
           set status = 'going', remind_on = ${remind}::date, remind_at = ${at.toISOString()}::timestamptz,
               ask_at = ${ask.toISOString()}::timestamptz, updated_at = now()
         where person_id = ${personId}::uuid and item_id = ${item.id}::uuid
      `);
      const running = runningUntil(item, remind);
      return { n, title: item.title, state: "set", at, weekly: textDates(item.when_text).weekly.size > 0, ...(running ? { running } : {}) };
    }),
  );
  return r.persisted && r.data ? r.data : null;
}

export interface DueFollowup extends FollowupItem {
  interestId: string;
  personId: string;
  phone: string;
}

/* The digest's own yes, as the weekly audience reads it: DIGEST OFF stops the reminders and questions too (review, 11 Nov). */
const DIGEST_ON = sql`(select k.status from consents k
                        where k.person_id = p.id and k.scope = 'digest'
                        order by k.captured_at desc limit 1) = 'opted_in'`;

/**
 * A reminder later than this past its moment is not sent: the event has
 * begun, or is about to (two hours is the lead it was set with).
 */
const REMIND_LATE = "2 hours";
/** A feedback question up to two days late is still asked, then dropped. */
const ASK_LATE = "2 days";

const due = async (kind: "remind" | "feedback", now: Date): Promise<DueFollowup[]> => {
  const at = now.toISOString();
  const r = await withDb(async (db: Db) => {
    const out = await rows(db, kind === "remind"
      ? sql`
        select i.id::text as interest_id, p.id::text as person_id, p.phone,
               it.title, it.when_text, it.starts_on::text as starts_on, it.ends_on::text as ends_on, it.place, it.summary, it.url
          from digest_interests i join people p on p.id = i.person_id join digest_items it on it.id = i.item_id
         where i.status = 'going' and i.reminded_at is null
           and i.remind_at <= ${at}::timestamptz and i.remind_at > ${at}::timestamptz - ${REMIND_LATE}::interval
           and p.phone is not null and ${DIGEST_ON}
         order by i.remind_at, i.id`
      : sql`
        select i.id::text as interest_id, p.id::text as person_id, p.phone,
               it.title, it.when_text, it.starts_on::text as starts_on, it.ends_on::text as ends_on, it.place, it.summary, it.url
          from digest_interests i join people p on p.id = i.person_id join digest_items it on it.id = i.item_id
         where i.status = 'going' and i.reminded_at is not null and i.feedback_asked_at is null
           and i.ask_at <= ${at}::timestamptz and i.ask_at > ${at}::timestamptz - ${ASK_LATE}::interval
           and p.phone is not null and ${DIGEST_ON}
           /* One question a day per family, so a tap answers the one they were asked; a
              second waits a full day — to its own 10:00, never into the night (review, 11 Nov). */
           and not exists (select 1 from digest_interests o
                            where o.person_id = i.person_id and o.feedback is null
                              and o.feedback_asked_at > ${at}::timestamptz - interval '24 hours')
         order by i.ask_at, i.id`);
    return out.map((o) => ({
      interestId: String(o.interest_id),
      personId: String(o.person_id),
      phone: String(o.phone),
      title: String(o.title),
      when_text: String(o.when_text),
      starts_on: o.starts_on ? String(o.starts_on) : null,
      ends_on: o.ends_on ? String(o.ends_on) : null,
      place: o.place ? String(o.place) : null,
      summary: String(o.summary),
      url: String(o.url),
    }));
  });
  return r.persisted ? (r.data ?? []) : [];
};

/** The reminders whose moment has come (and is not two hours gone). */
export const dueReminders = (now: Date) => due("remind", now);
/**
 * The feedback questions whose moment has come (up to two days late, then
 * dropped). One per family at a time: a second the same day waits about a day.
 */
export const dueFeedback = (now: Date) => due("feedback", now);

/**
 * Claims a reminder or a feedback question before it is sent, as the digest
 * claims its sends: true only for the run that set it, so a second run never
 * sends it twice; `releaseFollowup` gives it back when a send may pass later.
 * Only while still `going` (review, 11 Nov): one taken off after the sweep
 * listed it is not sent.
 */
export async function claimFollowup(kind: "remind" | "feedback", interestId: string, now: Date): Promise<boolean> {
  /* The run's own moment, the one `due` compared with — so "one open question a family" reads one clock. */
  const at = now.toISOString();
  const r = await withDb(async (db: Db) => {
    const out = await rows(db, kind === "remind"
      ? sql`update digest_interests set reminded_at = ${at}::timestamptz, updated_at = now() where id = ${interestId}::uuid and reminded_at is null and status = 'going' returning id`
      : sql`update digest_interests set feedback_asked_at = ${at}::timestamptz, updated_at = now() where id = ${interestId}::uuid and feedback_asked_at is null and status = 'going' returning id`);
    return out.length > 0;
  });
  return r.persisted === true && r.data === true;
}

export async function releaseFollowup(kind: "remind" | "feedback", interestId: string): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(kind === "remind"
      ? sql`update digest_interests set reminded_at = null where id = ${interestId}::uuid`
      : sql`update digest_interests set feedback_asked_at = null where id = ${interestId}::uuid`);
    return true;
  });
}

/** A feedback button: onto the question they were asked last, within three days. False when there was none open. */
export async function recordFeedback(personId: string, value: Feedback): Promise<boolean> {
  const r = await withDb(async (db: Db) => {
    const out = await rows(db, sql`
      update digest_interests set feedback = ${value}, feedback_at = now(), updated_at = now()
       where id = (select id from digest_interests
                    where person_id = ${personId}::uuid and feedback_asked_at is not null and feedback is null
                      and feedback_asked_at > now() - interval '3 days'
                    order by feedback_asked_at desc limit 1)
      returning id
    `);
    return out.length > 0;
  });
  return r.persisted === true && r.data === true;
}
