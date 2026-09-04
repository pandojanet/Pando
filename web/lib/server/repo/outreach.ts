import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import type { DeliveryCounts } from "@/lib/delivery";
import {
  decideOutreach,
  type OutreachHistory,
  type OutreachKind,
} from "@/lib/outreach-policy";

/**
 * M8 + M12.3 — the counters and the opt-out mirror the send layer reads.
 *
 * `lib/outreach-policy.ts` holds the rules and knows nothing about a database;
 * this fetches what they judge. Same split as `matching.ts` / `repo/matching.ts`
 * and for the same reason: a rule that decides whether a real person is contacted
 * has to be testable without a connection.
 *
 * ## Fail closed, every time
 *
 * Every function here refuses when the database cannot be reached. That is the
 * opposite of the app's usual `persisted: false` honesty rule, and deliberately
 * so: elsewhere an outage means "we could not save your answer", which is
 * recoverable. Here an outage would mean "we could not check whether she asked us
 * to stop" — and sending anyway is the failure that cannot be taken back.
 */

/** One row for `message_log`. */
export interface SendRecord {
  personId: string;
  direction: "in" | "out";
  /**
   * Constrained to the two the CHECK allows. An inbound reply to a blast is
   * `outreach` — it belongs to that conversation — and what marks it as an answer
   * is `respondedTo`, not the category.
   */
  category: "transactional" | "outreach";
  template: string | null;
  templateVersion: string | null;
  providerMessageId: string | null;
  /** The inbound message this answers, for the response-rate governor. */
  respondedTo: string | null;
  /**
   * 13.4 — the `message_log` row this attempt is retrying, when it is one.
   *
   * It exists for a promise rather than for bookkeeping: every counter in this
   * file reads this table, so a retry written as an ordinary row would spend a
   * parent's monthly allowance **twice for one message they received once**, and
   * restart their 48-hour gap. Rows carrying this are excluded from all of them.
   */
  retryOf?: string | null;
  /** How many attempts preceded this one. Zero for a first send. */
  retryCount?: number;
}

/**
 * 12.3 — has this number asked us to stop?
 *
 * Mirrors Twilio's own list so Pando never spends a request finding out, and so
 * the same fact can be joined against at the query level when a pool is built.
 * **Unreachable database means opted out**, per the fail-closed rule above.
 */
export async function isOptedOut(phone: string): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select 1
        from sms_opt_outs
       where phone = ${phone}
         and opted_out_at is not null
         and (opted_in_at is null or opted_in_at < opted_out_at)
       limit 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  });
  if (!result.persisted) {
    console.warn("[sms] opt-out list unreadable — refusing to send");
    return true;
  }
  return result.data === true;
}

/** Write one row. Never throws: the caller has already sent the text. */
export async function recordSend(record: SendRecord): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      insert into message_log
        (person_id, direction, category, template, template_version,
         provider_message_id, responded_to, retry_of, retry_count, sent_at)
      values
        (${record.personId}::uuid, ${record.direction}, ${record.category},
         ${record.template}, ${record.templateVersion},
         ${record.providerMessageId}, ${record.respondedTo}::uuid,
         ${record.retryOf ?? null}::uuid, ${record.retryCount ?? 0}, now())
    `);
    return true;
  });
}

export type OutreachVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Invariant 5, applied to one person.
 *
 * One statement for every counter — the 10 Aug lesson that against the pooler a
 * round trip costs ~200ms and the query itself costs single digits, so four
 * separate reads are the slow shape however parallel they look.
 *
 * **A person who is not in `people` is refused**, not waved through: the whole
 * point of the per-person limits is that nobody is contacted without them.
 */
export async function outreachAllowed(
  personId: string,
  kind: OutreachKind,
): Promise<OutreachVerdict> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select
        p.monthly_contact_allowance,
        p.allowance_mode,
        -- Proactive messages only. A verification code is not a request for help,
        -- and counting it would spend somebody's monthly allowance on their own
        -- sign-up.
        -- 13.4: every outbound branch below carries "m.retry_of is null", and
        --
        -- A retry is the *same message* reaching the same parent once. Counting
        -- it twice would spend a second slot of an allowance they agreed to for
        -- being asked things, which is the ceiling invariant 5 exists to keep —
        -- and it would make the response-rate governor read a parent as less
        -- responsive because Pando's carrier had a bad minute.
        coalesce(sum(case when m.direction = 'out'
                           and m.category = 'outreach'
                           and m.retry_of is null
                           and m.sent_at > now() - interval '30 days'
                      then 1 else 0 end), 0)::int                     as sent_30,
        -- Answered: an inbound message that names an outbound one. That is what
        -- responded_to is for, and it is why the column exists on the log.
        coalesce(sum(case when m.direction = 'in'
                           and m.responded_to is not null
                           and m.sent_at > now() - interval '30 days'
                      then 1 else 0 end), 0)::int                     as answered_30,
        max(case when m.direction = 'out' and m.category = 'outreach'
                  and m.retry_of is null
                 then m.sent_at end)                                  as last_outreach,
        coalesce(sum(case when m.direction = 'out'
                           and m.template = 'freshness_ping'
                           and m.retry_of is null
                           and date_trunc('month', m.sent_at)
                             = date_trunc('month', now())
                      then 1 else 0 end), 0)::int                     as pings_month,
        coalesce(bool_or(m.direction = 'out'
                     and m.category = 'outreach'
                     and m.retry_of is null
                     and m.template is distinct from 'freshness_ping'
                     and m.sent_at::date = now()::date), false)       as blast_today
      from people p
      left join message_log m on m.person_id = p.id
      where p.id = ${personId}::uuid
      group by p.id, p.monthly_contact_allowance, p.allowance_mode
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!result.persisted) {
    console.warn("[sms] outreach counters unreadable — refusing to send");
    return { ok: false, reason: "counters_unavailable" };
  }
  if (!result.data) return { ok: false, reason: "unknown_person" };

  const row = result.data;
  const history: OutreachHistory = {
    sent_last_30_days: Number(row.sent_30 ?? 0),
    responded_last_30_days: Number(row.answered_30 ?? 0),
    last_outreach_at: (row.last_outreach as string | null) ?? null,
    pings_this_month: Number(row.pings_month ?? 0),
    blast_today: row.blast_today === true,
  };

  const decision = decideOutreach(
    kind,
    {
      monthly_contact_allowance:
        row.monthly_contact_allowance === null
          ? null
          : Number(row.monthly_contact_allowance),
      allowance_mode:
        row.allowance_mode === "as_relevant" ? "as_relevant" : "fixed",
    },
    history,
  );

  return decision.ok ? { ok: true } : { ok: false, reason: decision.reason };
}

/**
 * 12.3 — STOP and START, mirrored.
 *
 * Both write to the same row so the two timestamps can be compared: "opted out
 * unless they opted back in later" is one comparison rather than a status
 * somebody has to keep correct. START stamps a **fresh** consent time, which is
 * what 12.6's acceptance check looks for.
 */
export async function setOptOut(
  phone: string,
  state: "out" | "in",
  /**
   * What they actually texted. Stored because it is the evidence: STOP, STOPALL,
   * UNSUBSCRIBE, CANCEL, END and QUIT are all opt-outs, and a complaint may quote
   * the exact word back at us.
   */
  keyword: string,
): Promise<boolean> {
  const word = keyword.trim().toUpperCase().slice(0, 24) || "STOP";
  const result = await withDb(async (db: Db) => {
    if (state === "out") {
      await db.execute(sql`
        insert into sms_opt_outs (phone, keyword, opted_out_at)
        values (${phone}, ${word}, now())
        on conflict (phone) do update
          set opted_out_at = now(), keyword = excluded.keyword
      `);
    } else {
      /* The row may not exist: somebody can text START without ever having
         texted STOP, and refusing that would leave a consent moment unrecorded. */
      await db.execute(sql`
        insert into sms_opt_outs (phone, keyword, opted_out_at, opted_in_at)
        values (${phone}, ${word}, now(), now())
        on conflict (phone) do update
          set opted_in_at = now(), keyword = excluded.keyword
      `);
    }
    return true;
  });
  return result.persisted === true;
}

/**
 * One inbound message, logged — and linked to what it answers.
 *
 * The link is the point. 8.4's response rate is "how many of the requests we sent
 * did they answer", and the only way to know is to name the outbound message an
 * inbound one replies to. SMS carries no thread id, so the rule is the honest
 * approximation: **the most recent proactive message to this person, within the
 * response window.** Anything older is not a reply, it is a new conversation.
 *
 * A number Pando does not know is still logged with a null person — a cold
 * inbound text is 5.9's whole subject, and dropping it would lose the arrival.
 */
export async function recordInbound(input: {
  phone: string;
  category: "transactional" | "outreach";
  /**
   * Which keyword it was, or null for ordinary text. Never the body itself.
   *
   * `delete` is Pando's own (11.3), not a carrier-standard one like the four
   * above it — it is in the same union because this column answers "what kind of
   * message was this", and a self-service deletion is exactly the kind worth
   * being able to count.
   */
  keyword: "opt_out" | "opt_in" | "help" | "pass" | "delete" | null;
}): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      with sender as (
        select id from people where phone = ${input.phone} limit 1
      ),
      answered as (
        -- The most recent proactive message to them, if it is recent enough to
        -- be what this replies to. STOP, START and HELP are never replies: they
        -- are decisions about Pando, not answers to a question.
        --
        -- PASS is the exception, and deliberately so. Strategy 6 promises
        -- "nothing recorded against you", so a polite decline has to count as a
        -- response for the governor — otherwise passing three times lowers the
        -- allowance of somebody who was being helpful about it.
        select m.id
          from message_log m, sender s
         where m.person_id = s.id
           and m.direction = 'out'
           and m.category = 'outreach'
           and m.sent_at > now() - interval '30 days'
           and ${input.keyword === null || input.keyword === "pass"}
         order by m.sent_at desc
         limit 1
      )
      insert into message_log
        (person_id, direction, category, template, responded_to, sent_at)
      select s.id, 'in', ${input.category}, ${input.keyword}, (select id from answered), now()
        from sender s
      union all
      -- No such person: a cold inbound (5.9). Logged without one rather than
      -- dropped, because the arrival is the thing worth keeping.
      select null, 'in', ${input.category}, ${input.keyword}, null, now()
       where not exists (select 1 from sender)
    `);
    return true;
  });
}

/**
 * 13.4 — record what Twilio says happened to one message.
 *
 * Keyed by the provider SID, which is why `sendSms` stores it. **Terminal states
 * are never overwritten by an earlier one**: callbacks can arrive out of order,
 * and a late `sent` landing on top of a `delivered` would quietly lower the
 * delivery rate for a message that arrived.
 */
export async function recordDeliveryStatus(input: {
  providerMessageId: string;
  status: string;
  errorCode: number | null;
}): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      update message_log
         set status = ${input.status},
             error_code = coalesce(${input.errorCode}, error_code),
             status_at = now()
       where provider_message_id = ${input.providerMessageId}
         and (status is null
              or status not in ('delivered', 'undelivered', 'failed'))
    `);
    return true;
  });
}

/**
 * 12.5 — the delivery picture over a window.
 *
 * One statement, and the three numbers are kept apart on purpose: settled,
 * delivered, and still in flight. A message Twilio has accepted and not yet
 * reported on is neither a success nor a failure, so it is excluded from the rate
 * rather than counted against it — otherwise the number swings with how recently
 * somebody opened the page.
 */
export async function deliveryCounts(days = 7): Promise<DeliveryCounts | null> {
  const window = Math.min(90, Math.max(1, Math.trunc(days)));
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select
        count(*) filter (
          where status in ('delivered', 'undelivered', 'failed'))::int      as settled,
        count(*) filter (where status = 'delivered')::int                   as delivered,
        count(*) filter (
          where status is null or status in ('queued', 'sent'))::int        as in_flight,
        coalesce(
          (select json_agg(json_build_object('code', code, 'count', n))
             from (select error_code as code, count(*)::int as n
                     from message_log
                    where direction = 'out'
                      and error_code is not null
                      and sent_at > now() - make_interval(days => ${window})
                    group by error_code
                    order by n desc) e),
          '[]'::json)                                                       as by_error
      from message_log
      where direction = 'out'
        and sent_at > now() - make_interval(days => ${window})
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!result.persisted || !result.data) return null;
  const row = result.data;
  return {
    settled: Number(row.settled ?? 0),
    delivered: Number(row.delivered ?? 0),
    in_flight: Number(row.in_flight ?? 0),
    by_error: (row.by_error ?? []) as DeliveryCounts["by_error"],
  };
}