import { sql } from "drizzle-orm";
import { JOBS, isDue, outcomeFor, type JobName, type JobResult } from "@/lib/jobs";
import { TIERS } from "@/lib/blast-tiers";
import { deliveryHealth } from "@/lib/delivery";
import { withDb, type Db } from "@/lib/server/db";
import { deliveryCounts } from "@/lib/server/repo/outreach";
import { syncImpact } from "@/lib/server/repo/impact";
import { recordPingSent } from "@/lib/server/repo/vouch";
import {
  answersDuePrompt,
  contributorsToThank,
  markPrompted,
} from "@/lib/server/repo/thanks";
import { thanksList } from "@/lib/thanks";
import {
  SMS_TEMPLATE_VERSION,
  thanksPromptSms,
  thanksSms,
} from "@/lib/sms-templates";
import { sendSms } from "@/lib/server/sms";

/**
 * M9.5 — running a scheduled job, and the three jobs themselves.
 *
 * ## Claim, then work, then close
 *
 * The run is inserted **before** any work happens, and the partial unique index
 * on `job_runs` is what makes that a lock: a second attempt while one is in
 * flight fails on the constraint rather than racing it. That ordering is the
 * whole protection — a cron that fires twice, a container restarted mid-run, two
 * hosts briefly overlapping are all the same event to this table, and the
 * expensive version of getting it wrong is a parent receiving two freshness
 * pings.
 *
 * ## What a job is allowed to assume
 *
 * Nothing about the rules. `freshness_ping` decides only *who is worth asking*;
 * whether that person may actually be texted is `sendSms`'s answer, and it
 * re-runs opt-out, quiet hours, the 48-hour gap, the monthly ceiling and the
 * one-ping-a-month rule. A job that duplicated any of those would be a second
 * place for them to be wrong.
 */

export interface RunOutcome extends JobResult {
  ran: boolean;
  /** Why not, when it did not run. */
  reason?: "too_soon" | "already_running" | "unconfigured";
}

/** Run one job, if it is due. Everything about "is it due" is in the database. */
export async function runJob(name: JobName): Promise<RunOutcome> {
  const spec = JOBS[name];

  const claim = await withDb(async (db: Db) => {
    const history = (await db.execute(sql`
      select
        max(started_at)                                          as last_started,
        bool_or(finished_at is null)                             as in_flight
      from job_runs where job = ${name}
    `)) as unknown as Array<Record<string, unknown>>;

    const verdict = isDue(spec, {
      last_started_at: (history[0]?.last_started as string | null) ?? null,
      in_flight: history[0]?.in_flight === true,
    });
    if (!verdict.due) return { claimed: false as const, verdict };

    /* Claimed before the work. The unique index refuses a second one. */
    const rows = (await db.execute(sql`
      insert into job_runs (job) values (${name}) returning id
    `)) as unknown as Array<Record<string, unknown>>;
    return { claimed: true as const, runId: String(rows[0]?.id ?? "") };
  });

  if (!claim.persisted || !claim.data) {
    return { ran: false, reason: "unconfigured", outcome: "error", processed: 0, skipped: 0, failed: 0 };
  }
  if (!claim.data.claimed) {
    const v = claim.data.verdict;
    return {
      ran: false,
      reason: v.due ? undefined : v.reason,
      outcome: "skipped",
      processed: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const runId = claim.data.runId;
  let result: JobResult;
  try {
    result = await BODIES[name]();
  } catch (err) {
    /* Enums only — never what the job was carrying (invariant 7). */
    console.error("[job] failed", {
      job: name,
      error: err instanceof Error ? err.constructor.name : "unknown",
    });
    result = { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }

  /* Closed however it ended. A run left open blocks the next one, which is the
     intended behaviour for a crash and would be a bug for an ordinary failure. */
  await withDb(async (db: Db) => {
    await db.execute(sql`
      update job_runs
         set finished_at = now(), outcome = ${result.outcome},
             processed = ${result.processed}, skipped = ${result.skipped},
             failed = ${result.failed}, note = ${result.note ?? null}
       where id = ${runId}::uuid
    `);
    return true;
  });

  console.info("[job] ran", { job: name, ...result });
  return { ran: true, ...result };
}

const BODIES: Record<JobName, () => Promise<JobResult>> = {
  expire_blasts,
  delivery_check,
  freshness_ping,
  impact_sync,
  thanks_prompt,
  thanks_delivery,
};

/**
 * 9.1 — ask the parent who got an answer whether it helped.
 *
 * The prompt is **stamped after the send**, so a refusal leaves the answer on
 * the queue for tomorrow — which matters because the window closes: a parent
 * inside their 48-hour gap today may still be inside the window on Thursday,
 * and stamping first would spend their one chance on a message that never went.
 *
 * Nothing here checks whether they may be texted. `sendSms` does, and a refusal
 * is a skip: somebody who opted out is the system working.
 */
async function thanks_prompt(): Promise<JobResult> {
  const due = await answersDuePrompt();
  let sent = 0;
  let skipped = 0;

  for (const answer of due) {
    const result = await sendSms({
      to: answer.phone,
      body: thanksPromptSms(),
      category: "outreach",
      outreachKind: "thanks",
      personId: answer.person_id ?? undefined,
      template: "thanks_prompt",
      templateVersion: SMS_TEMPLATE_VERSION,
    });
    if (!result.sent) {
      skipped += 1;
      continue;
    }
    await markPrompted(answer.answer_id);
    sent += 1;
  }

  return {
    outcome: outcomeFor({ processed: sent, skipped, failed: 0 }),
    processed: sent,
    skipped,
    failed: 0,
  };
}

/**
 * 9.2 — the batched thank-you.
 *
 * One message per contributor per week, carrying everything owed since the last
 * one. Nothing is marked as thanked here: the week is measured from
 * `message_log`, which `sendSms` writes only after the provider accepted — so a
 * refused send leaves the batch owed rather than silently discharged, and the
 * next run picks it up with whatever else has accumulated.
 */
async function thanks_delivery(): Promise<JobResult> {
  const targets = await contributorsToThank();
  let sent = 0;
  let skipped = 0;

  for (const target of targets) {
    const result = await sendSms({
      to: target.phone,
      body: thanksSms(thanksList(target.items)),
      category: "outreach",
      outreachKind: "thanks",
      personId: target.person_id,
      template: "thanks",
      templateVersion: SMS_TEMPLATE_VERSION,
    });
    if (result.sent) sent += 1;
    else skipped += 1;
  }

  return {
    outcome: outcomeFor({ processed: sent, skipped, failed: 0 }),
    processed: sent,
    skipped,
    failed: 0,
  };
}

/**
 * 9.3 — the ledger's catch-up sweep.
 *
 * `processed` is what it had to add, so a healthy run reports **zero**: every
 * event the live path already wrote is a conflict this skips. A run that keeps
 * finding work is the signal worth reading — it means approvals are landing
 * without their ledger entry, which the live write is allowed to do and nothing
 * else would notice.
 */
async function impact_sync(): Promise<JobResult> {
  const result = await syncImpact();
  if (!result) {
    return { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }
  const added = result.contributions + result.blast_answers;
  return {
    outcome: outcomeFor({ processed: added, skipped: 0, failed: 0 }),
    processed: added,
    skipped: 0,
    failed: 0,
  };
}

/**
 * 7.7 — close what ran out of time, and credit the paid ones.
 *
 * "No useful answer inside the promised window, automatic credit" (§8), and the
 * test is an **approved** answer rather than a reply: a contributor writing back
 * is not the promise being kept, only the admin's approval says one arrived.
 *
 * A credit is granted in the same statement that expires the blast, so a blast
 * cannot be marked expired without the credit that owes the parent. The tier's
 * own credit kind is used, which is why the mapping lives on `TierSpec` — the
 * `credits_kind_check` vocabulary is not the tier ids.
 */
async function expire_blasts(): Promise<JobResult> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const due = (await tx.execute(sql`
        select b.id, b.tier, b.asker_id
          from blasts b
         where b.status in ('active', 'pending_review')
           and b.expires_at is not null
           and b.expires_at < now()
           and not exists (
             select 1 from blast_recipients r
              where r.blast_id = b.id and r.review_status = 'approved')
         for update skip locked
      `)) as unknown as Array<Record<string, unknown>>;

      let credited = 0;
      for (const row of due) {
        const tier = TIERS[String(row.tier) as keyof typeof TIERS];
        await tx.execute(sql`
          update blasts set status = 'expired' where id = ${String(row.id)}::uuid
        `);
        /* Free tiers are never refunded — nothing was taken. */
        if (tier?.credit_kind && tier.price_cents > 0 && row.asker_id) {
          await tx.execute(sql`
            insert into credits (person_id, kind, reason)
            values (${String(row.asker_id)}::uuid, ${tier.credit_kind},
                    'blast_expired_unanswered')
          `);
          credited += 1;
        }
      }
      return { expired: due.length, credited };
    }),
  );

  if (!result.persisted || !result.data) {
    return { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }
  const { expired, credited } = result.data;
  return {
    outcome: outcomeFor({ processed: expired, skipped: 0, failed: 0 }),
    processed: expired,
    skipped: 0,
    failed: 0,
    note: `${credited} credited`,
  };
}

/** 12.5 — the daily rate, reported. Reads only. */
async function delivery_check(): Promise<JobResult> {
  const counts = await deliveryCounts(1);
  if (!counts) return { outcome: "error", processed: 0, skipped: 0, failed: 1 };

  const health = deliveryHealth(counts);
  if (health.below_floor) {
    console.error("[job] delivery below floor", {
      rate: health.rate,
      settled: health.settled,
      alerts: health.alerts.map((a) => a.code),
    });
  }
  return {
    outcome: health.below_floor ? "partial" : "ok",
    processed: health.settled,
    skipped: health.in_flight,
    failed: health.settled - health.delivered,
    note: health.rate === null ? "nothing settled" : `${Math.round(health.rate * 100)}%`,
  };
}

/**
 * 10.3 — ask whether an ageing recommendation still holds.
 *
 * Picks the oldest ageing records and asks the parent who shared each one. The
 * job's only judgement is **who is worth asking**; every protection is enforced
 * below it, and a refusal is counted as a skip rather than a failure — somebody
 * inside their 48-hour gap is the system working.
 *
 * Capped hard per run. A freshness sweep that texts forty people in a minute is
 * indistinguishable from a bug, and the point of the ladder is that Pando is
 * scarce.
 */
async function freshness_ping(): Promise<JobResult> {
  const PER_RUN = 5;

  const candidates = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select distinct on (sc.person_id)
             sc.person_id, p.phone, s.id as share_id, s.name, s.kind
        from share_contributions sc
        join shares s on s.id = sc.share_id
        join people p on p.id = sc.person_id
       where sc.status = 'approved'
         and s.status = 'approved'
         and not s.is_test
         and p.phone is not null
         and s.last_confirmed_at is not null
         and s.last_confirmed_at < now() - interval '90 days'
       order by sc.person_id, s.last_confirmed_at asc
       limit ${PER_RUN}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!candidates.persisted || !candidates.data) {
    return { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }

  let sent = 0;
  let skipped = 0;
  for (const row of candidates.data) {
    const result = await sendSms({
      to: String(row.phone),
      body: `Quick one — is ${String(row.name)} still worth recommending? Reply yes, no, or PASS to skip.`,
      category: "outreach",
      personId: String(row.person_id),
      outreachKind: "ping",
      template: "freshness_ping",
    });
    if (result.sent) {
      /**
       * 10.2 — record **which** record was asked about, and only after it went.
       *
       * Without this row the reply has nowhere to land: `message_log` says a
       * ping was sent and never what it was about, so a "yes" could be received
       * and not attributed. Written after the send for the same reason
       * `helped_asked_at` is — a row saying we asked, for a message the carrier
       * refused, would take the record out of the queue having asked nobody.
       */
      await recordPingSent(String(row.person_id), String(row.share_id));
      sent += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    outcome: outcomeFor({ processed: sent, skipped, failed: 0 }),
    processed: sent,
    skipped,
    failed: 0,
  };
}
