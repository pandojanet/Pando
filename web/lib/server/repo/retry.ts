import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import {
  RETRY_DELAY_MINUTES,
  RETRY_GIVE_UP_MINUTES,
  RETRY_LIMIT,
  shouldRetry,
} from "@/lib/delivery";
import { sendSms } from "@/lib/server/sms";

/**
 * M13.4 — the sweep that sends a transiently-failed message again.
 *
 * The policy is in `lib/delivery.ts` (pure, and mostly a list of refusals); this
 * finds the candidates and sends. It runs as a scheduled job rather than inline,
 * for a reason that is not convenience: the failure is only *known* when Twilio's
 * status callback arrives, which is seconds to minutes after the send returned
 * successfully. There is no request still open to retry inside.
 *
 * ## The one thing this cannot do, and says so
 *
 * `message_log` **stores no message body** — that is invariant 7 holding at the
 * schema level, and `/admin/conversations` already documents the consequence.
 * So a retry cannot resend the original text: there is nothing to resend.
 *
 * What it can do is re-send the messages Pando can *reconstruct* from a
 * template, which is what `template` on the row is for. That covers the ones
 * where a failure actually costs something:
 *
 *  - a **freshness ping** — reconstructable, and 10.2's whole loop depends on it
 *    arriving;
 *  - a **thank-you** — reconstructable from the impact events behind it;
 *  - a **blast request** — reconstructable from the blast.
 *
 * And it deliberately excludes the ones where a retry would be wrong even though
 * the text is reconstructable:
 *
 *  - a **verification code** (§19) — the code has a five-minute life and its own
 *    send budget of three, which the parent controls by tapping "send another".
 *    A background job quietly spending one of those three is worse than the
 *    failure: the parent's own retry is right there, and it produces a *fresh*
 *    code rather than one that may already have expired.
 *  - an **answer** — 5.8 stores `answer_text` and sends it verbatim on approval,
 *    with its own `sent` status and its own gold card on `/admin/answers` for
 *    "approved but not sent". That queue is the retry, and it is worked by a
 *    person who can see whether the answer is still true.
 *
 * So this is narrower than "retry failed messages", and the narrowness is the
 * design: **a retry is only ever offered where the same message can be rebuilt
 * and nobody is better placed to decide than a timer.**
 */

/** Templates a retry can rebuild, and should. */
const RETRIABLE_TEMPLATES = new Set(["freshness_ping", "thanks", "blast_request"]);

export interface RetryCandidate {
  message_id: string;
  person_id: string;
  template: string | null;
  error_code: number | null;
  status: string | null;
  age_minutes: number;
  retry_count: number;
}

export interface RetrySweepResult {
  /** Failed outbound rows the sweep looked at. */
  considered: number;
  /** Sent again. */
  retried: number;
  /** Refused by the policy — not a failure. */
  skipped: number;
  /** Failed again, or refused by the send layer. */
  failed: number;
  /** Why each skip happened, for the job's own log line. Counts only. */
  reasons: Record<string, number>;
}

/**
 * Outbound messages that failed recently, have not been retried, and whose text
 * can be rebuilt.
 *
 * The window is `RETRY_GIVE_UP_MINUTES` — the same ceiling the policy applies,
 * pushed into the query so the sweep does not read a week of history to reject
 * all of it. `retry_count` comes from the row itself, and the unique index on
 * `retry_of` is the belt: even if two sweeps overlapped, the second insert for
 * the same original would be refused by the database rather than by timing.
 */
export async function retryCandidates(limit = 50): Promise<RetryCandidate[]> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select m.id::text                                            as message_id,
             m.person_id::text                                     as person_id,
             m.template                                            as template,
             m.error_code                                           as error_code,
             m.status                                               as status,
             m.retry_count                                          as retry_count,
             (extract(epoch from (now() - m.sent_at)) / 60)::int    as age_minutes
        from message_log m
       where m.direction = 'out'
         and m.status in ('failed', 'undelivered')
         and m.person_id is not null
         and m.retry_of is null
         and m.sent_at > now() - make_interval(mins => ${RETRY_GIVE_UP_MINUTES})
         and m.sent_at < now() - make_interval(mins => ${RETRY_DELAY_MINUTES})
         and m.retry_count < ${RETRY_LIMIT}
         -- Nothing already retried. A left join rather than NOT EXISTS so the
         -- partial unique index on retry_of does the work.
         and not exists (
           select 1 from message_log r where r.retry_of = m.id
         )
       order by m.sent_at
       limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      message_id: String(r.message_id),
      person_id: String(r.person_id),
      template: (r.template as string | null) ?? null,
      error_code: r.error_code === null ? null : Number(r.error_code),
      status: (r.status as string | null) ?? null,
      age_minutes: Number(r.age_minutes ?? 0),
      retry_count: Number(r.retry_count ?? 0),
    }));
  });
  return result.persisted ? (result.data ?? []) : [];
}

/**
 * Rebuild and re-send what can be rebuilt.
 *
 * The bodies are composed by the same modules that composed them the first time,
 * so a retry is the *same message* rather than a paraphrase — which matters for
 * the registered templates, where what is sent must match what was registered
 * (A2P §3.7).
 *
 * **Every retry goes through `sendSms`**, so opt-out, quiet hours and the whole
 * of invariant 5 are re-checked. That is not belt and braces here, it is the
 * point: the minutes since the original send are exactly long enough for
 * somebody to have texted STOP, and a retry that skipped the check would be the
 * one message in the system that ignored it.
 */
export async function runRetrySweep(limit = 50): Promise<RetrySweepResult> {
  const candidates = await retryCandidates(limit);
  const out: RetrySweepResult = {
    considered: candidates.length,
    retried: 0,
    skipped: 0,
    failed: 0,
    reasons: {},
  };

  const note = (reason: string) => {
    out.reasons[reason] = (out.reasons[reason] ?? 0) + 1;
  };

  for (const candidate of candidates) {
    const verdict = shouldRetry({
      status: candidate.status as never,
      error_code: candidate.error_code,
      retry_count: candidate.retry_count,
      age_minutes: candidate.age_minutes,
    });
    if (!verdict.retry) {
      out.skipped += 1;
      note(verdict.reason);
      continue;
    }
    if (!candidate.template || !RETRIABLE_TEMPLATES.has(candidate.template)) {
      /* Nothing to rebuild. Not a failure — see the module note on why the two
         other reconstructable templates are deliberately left to a person. */
      out.skipped += 1;
      note("not_rebuildable");
      continue;
    }

    const rebuilt = await rebuild(candidate);
    if (!rebuilt) {
      out.skipped += 1;
      note("nothing_to_rebuild");
      continue;
    }

    const sent = await sendSms({
      to: rebuilt.to,
      body: rebuilt.body,
      category: rebuilt.category,
      personId: candidate.person_id,
      template: candidate.template,
      outreachKind: rebuilt.outreachKind,
      /* The link that keeps one message from spending two slots of a parent's
         allowance. See `drizzle/0029` and `repo/outreach.ts`. */
      retryOf: candidate.message_id,
      retryCount: candidate.retry_count + 1,
    });

    if (sent.sent) out.retried += 1;
    else {
      out.failed += 1;
      note(sent.reason ?? "send_failed");
    }
  }

  return out;
}

/**
 * Rebuild one message from its template and the records behind it.
 *
 * Returns null when the thing it was about has moved on — a share that has since
 * been retired, a blast that expired, a person with no phone. That is a skip
 * rather than a failure: re-sending a ping about a record nobody wants confirmed
 * any more would be worse than the original failure.
 */
async function rebuild(candidate: RetryCandidate): Promise<
  | {
      to: string;
      body: string;
      category: "transactional" | "outreach";
      /* The three `OutreachKind` allows. A freshness ping is `ping` — the
         policy's own vocabulary, which is not the template's name. */
      outreachKind?: "blast" | "ping" | "thanks";
    }
  | null
> {
  const { freshnessPingSms, thanksSms, blastRequestSms, askReason } = await import(
    "@/lib/sms-templates"
  );
  const { thanksList } = await import("@/lib/thanks");

  const loaded = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select phone from people where id = ${candidate.person_id}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0]?.phone ? String(rows[0].phone) : null;
  });
  if (!loaded.persisted || !loaded.data) return null;
  const to = loaded.data;

  if (candidate.template === "freshness_ping") {
    /* Which record the ping was about lives in `freshness_pings` (0027) — the
       table added precisely because `message_log` records that a ping went out
       and never what it was about. */
    const ping = await withDb(async (db: Db) => {
      const rows = (await db.execute(sql`
        select s.name as name
          from freshness_pings f
          join shares s on s.id = f.share_id
         where f.person_id = ${candidate.person_id}::uuid
           and f.answered_at is null
         order by f.asked_at desc
         limit 1
      `)) as unknown as Array<Record<string, unknown>>;
      return rows[0]?.name ? String(rows[0].name) : null;
    });
    if (!ping.persisted || !ping.data) return null;
    return {
      to,
      body: freshnessPingSms({ name: ping.data }),
      category: "outreach",
      outreachKind: "ping",
    };
  }

  if (candidate.template === "thanks") {
    const items = await withDb(async (db: Db) => {
      const rows = (await db.execute(sql`
        select array_agg(distinct s.name) filter (where s.name is not null) as names
          from impact_events e
          left join shares s on s.id = e.share_id
         where e.person_id = ${candidate.person_id}::uuid
           and e.kind = 'answer_used'
           and e.created_at > now() - interval '14 days'
      `)) as unknown as Array<Record<string, unknown>>;
      const names = rows[0]?.names;
      return Array.isArray(names) ? (names as string[]) : [];
    });
    if (!items.persisted || items.data === null || items.data.length === 0) return null;
    return {
      to,
      /* Through `thanksList` for the same reason as the ping: it is what
         composed the original, and a retry has to be the same message. */
      body: thanksSms(thanksList(items.data)),
      category: "outreach",
      outreachKind: "thanks",
    };
  }

  if (candidate.template === "blast_request") {
    const blast = await withDb(async (db: Db) => {
      const rows = (await db.execute(sql`
        select b.question_text as question, r.match_reasons as reasons
          from blast_recipients r
          join blasts b on b.id = r.blast_id
         where r.person_id = ${candidate.person_id}::uuid
           and r.passed_at is null
           and b.status = 'active'
         order by r.sent_at desc
         limit 1
      `)) as unknown as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row?.question) return null;
      return {
        question: String(row.question),
        /* `match_reasons` was stored when the pool was chosen (0021), which is
           what makes a faithful rebuild possible: the "why them" clause is one
           of the three things the copy must carry (strategy §6), so composing
           the message without it would send different registered text, and
           re-running the matcher would risk a *wrong* reason against a graph
           that has moved since. */
        reasons: Array.isArray(row.reasons)
          ? (row.reasons as Array<{ kind?: unknown }>)
              .map((r) => String(r?.kind ?? ""))
              .filter(Boolean)
          : [],
      };
    });
    if (!blast.persisted || !blast.data) return null;
    return {
      to,
      body: blastRequestSms({
        question: blast.data.question,
        because: askReason(blast.data.reasons),
      }),
      category: "outreach",
      outreachKind: "blast",
    };
  }

  return null;
}
