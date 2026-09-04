import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { maskPhoneRecognisable } from "@/lib/phone";

/**
 * The two queries the Slack relay needs, and nothing else.
 *
 * Kept out of `lib/server/slack.ts` for the reason every other module here is
 * split that way: the transport is given its facts and never asks a database
 * for them, so it stays loadable in a plain node test.
 *
 * **These fail open, unlike `repo/outreach.ts`.** There, an unreachable database
 * means "we could not check whether she asked us to stop", and sending anyway
 * cannot be taken back — so it refuses. Here the worst case is a message that
 * lands in the channel labelled "unknown recipient" or outside its thread, which
 * is a cosmetic loss in a test channel. Refusing the send instead would make the
 * relay less reliable than the thing it stands in for.
 */

export interface RelayTarget {
  person_id: string | null;
  name: string | null;
  phone_masked: string | null;
  /** The root of this person's thread, or null if Pando has not written yet. */
  thread_ts: string | null;
}

/**
 * Everything the relay needs to address a message: who it is for, and which
 * thread that conversation lives in.
 *
 * **Resolvable by phone, not only by person id, and that is the fix for a real
 * hole.** A keyword reply — HELP, the START confirmation — is sent before the
 * pipeline has ensured a person, so it carries no `personId`: on SMS that is
 * fine, because the phone number *is* the address. In one Slack channel it made
 * the post read "unknown recipient" and left it out of any thread, so the
 * parent's next reply could not be attributed to anybody. The relay now
 * addresses the way SMS does.
 *
 * One query for both facts, per the 10 Aug rule that against the pooler the
 * round trips are the cost and the query itself is single digits.
 *
 * The thread is the **first** message Pando ever sent them, not the most recent:
 * a thread key is the root message's `ts`, and Slack has no reply-to-a-reply, so
 * threading onto the latest post would start a new thread every time.
 *
 * Masked, deliberately — see the invariant 7 note in `lib/server/slack.ts`. The
 * first name rides along because a masked number alone makes a transcript of
 * several parents unreadable, and it is the pairing every admin list uses.
 */
export async function relayTargetFor(input: {
  personId?: string;
  phone?: string;
}): Promise<RelayTarget | null> {
  const { personId, phone } = input;
  if (!personId && !phone) return null;

  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select p.id,
             p.first_name,
             p.phone,
             (select m.provider_message_id
                from message_log m
               where m.person_id = p.id
                 and m.direction = 'out'
                 and m.provider_message_id is not null
               order by m.sent_at asc
               limit 1)                                as thread_ts
        from people p
       where ${personId ? sql`p.id = ${personId}::uuid` : sql`p.phone = ${phone}`}
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!result.persisted || !result.data) return null;
  const row = result.data;
  return {
    person_id: row.id ? String(row.id) : null,
    name: row.first_name ? String(row.first_name) : null,
    /* `maskPhoneRecognisable` rather than `maskPhone`: it keeps the shape of the
       country the number is in, which is the difference between a US and a
       Ukrainian tester being distinguishable in the channel at all. */
    phone_masked: row.phone ? maskPhoneRecognisable(String(row.phone)) : null,
    thread_ts: row.thread_ts ? String(row.thread_ts) : null,
  };
}

/**
 * The Slack thread this person's conversation lives in.
 *
 * The **first** message Pando ever sent them, not the most recent: a thread key
 * is the root message's `ts`, and Slack has no notion of a reply to a reply — so
 * threading onto the latest message would start a new thread every time and the
 * channel would flatten out again.
 *
 * `provider_message_id` is where the relay stores that `ts`. It is the same
 * column Twilio's message SID goes in, which is right rather than a shortcut:
 * both are "what the provider called this message", and only one provider is
 * ever in play for a given deployment.
 */
export async function threadForPerson(personId: string): Promise<string | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select provider_message_id
        from message_log
       where person_id = ${personId}::uuid
         and direction = 'out'
         and provider_message_id is not null
       order by sent_at asc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!result.persisted || !result.data?.provider_message_id) return null;
  return String(result.data.provider_message_id);
}

/**
 * Whose thread this is — the inverse, for an inbound reply.
 *
 * A tester replying inside a thread is replying to whoever that thread was
 * addressed to, and this is what turns Slack's `thread_ts` back into the phone
 * number the inbound pipeline works in. Null when the thread is not one of ours,
 * which the events route treats as a message to ignore rather than an error: a
 * human talking in the channel is not an inbound text.
 */
export async function personForThread(
  threadTs: string,
): Promise<{ person_id: string; phone: string } | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select p.id, p.phone
        from message_log m
        join people p on p.id = m.person_id
       where m.provider_message_id = ${threadTs}
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!result.persisted || !result.data?.phone) return null;
  return {
    person_id: String(result.data.id),
    phone: String(result.data.phone),
  };
}
