import "server-only";

import { sql } from "drizzle-orm";
import { alertsDue, alertsText, criticalAlerts, type AlertFacts } from "@/lib/alerts";
import { localParts } from "@/lib/digest";
import { JOBS, type JobName, type JobResult } from "@/lib/jobs";
import { DEFAULT_MARKET_ID, marketConfig } from "@/lib/markets";
import { isSlackWebhookUrl } from "@/lib/notify-message";
import { withDb, type Db } from "@/lib/server/db";

/**
 * The `critical_alerts` job (20 Nov): reads what broke in the last minutes — counts only — and tells the
 * team in Slack once (`lib/alerts.ts` decides what is critical and writes the message).
 *
 * - **Its own channel if set:** `SLACK_ALERTS_WEBHOOK_URL`, else the team's heads-up webhook
 *   (`SLACK_NOTIFY_WEBHOOK_URL`). Inert when neither is set: the run is `skipped`, nothing is sent.
 * - **Said once:** each alert's key and when it was said are kept in `app_settings.alerts_said`; the same
 *   alert is said again only after `ALERT_REPEAT_HOURS` if it still holds. Without that table (before
 *   migration 0070) the job does nothing, rather than post every ten minutes.
 * - **Never a parent's anything:** the facts are counts and job names; the log says how many were sent.
 */

const WINDOW_MINUTES = 30;
type Row = Record<string, unknown>;

async function rows(db: Db, q: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(q)) as unknown as Row[];
}

function webhook(): string | null {
  const own = process.env.SLACK_ALERTS_WEBHOOK_URL?.trim();
  if (isSlackWebhookUrl(own)) return own;
  const shared = process.env.SLACK_NOTIFY_WEBHOOK_URL?.trim();
  return isSlackWebhookUrl(shared) ? shared : null;
}

function siteBase(): string {
  return process.env.NOTIFY_BASE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://pando.is";
}

const sends = (job: string) => (job in JOBS ? JOBS[job as JobName].sends : false);

/** What broke, as counts. Exported for the lab. */
export async function alertFacts(db: Db, now: Date): Promise<AlertFacts> {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000).toISOString();
  const failed = await rows(db, sql`
    select job, coalesce(sum(failed), 0) as failed from job_runs
     where started_at > ${since}::timestamptz and outcome = 'error' and job <> 'critical_alerts'
     group by job
  `);
  const stuck = await rows(db, sql`
    select job, floor(extract(epoch from (${now.toISOString()}::timestamptz - min(started_at))) / 60) as minutes from job_runs
     where finished_at is null and started_at < ${now.toISOString()}::timestamptz - interval '60 minutes'
       and started_at > ${now.toISOString()}::timestamptz - interval '24 hours' and job <> 'critical_alerts'
     group by job
  `);
  const [texts] = await rows(db, sql`
    select count(*) as out, count(*) filter (where status in ('failed', 'undelivered')) as undelivered
      from message_log where direction = 'out' and coalesce(status_at, sent_at) > ${since}::timestamptz
  `);
  const market = marketConfig(DEFAULT_MARKET_ID);
  const local = localParts(now, market.timeZone);
  /* Saturday (weekday 6) from 10:00 on the market's clock: by then a group still waiting is late. */
  let digest: AlertFacts["digest"] = null;
  if (local.weekday === 6 && local.hour >= 10) {
    const [d] = await rows(db, sql`
      select count(*) filter (where e.approval_required and e.approved_at is null and e.status = 'ready'
                                and not exists (select 1 from digest_sends s where s.edition_id = e.id)) as awaiting,
             count(*) filter (where e.status = 'failed' and e.attempts >= 3) as failed
        from digest_editions e
       where e.market_id = ${market.id} and e.edition_date = ${local.date}::date and not e.is_test
    `);
    digest = { awaitingApproval: Number(d?.awaiting ?? 0), failedGroups: Number(d?.failed ?? 0) };
  }
  const [mcpTable] = await rows(db, sql`select to_regclass('public.mcp_calls') is not null as ok`);
  const [mcp] = mcpTable?.ok === true
    ? await rows(db, sql`
        select count(*) filter (where outcome = 'error') as errors,
               count(distinct client_id) filter (where tool = '(rate limited)') as limited
          from mcp_calls where at > ${since}::timestamptz
      `)
    : [];
  return {
    mcp: { errors: Number(mcp?.errors ?? 0), limited: Number(mcp?.limited ?? 0) },
    failedJobs: failed.map((r) => ({ job: String(r.job), failed: Number(r.failed ?? 0), sends: sends(String(r.job)) })),
    stuckJobs: stuck.map((r) => ({ job: String(r.job), minutes: Number(r.minutes ?? 0), sends: sends(String(r.job)) })),
    texts: { out: Number(texts?.out ?? 0), undelivered: Number(texts?.undelivered ?? 0) },
    digest,
  };
}

export async function runCriticalAlerts(now = new Date()): Promise<JobResult> {
  const url = webhook();
  if (!url) return { outcome: "skipped", processed: 0, skipped: 0, failed: 0, note: "not_configured" };
  const r = await withDb(async (db) => {
    const [ready] = await rows(db, sql`select to_regclass('public.app_settings') is not null as ok`);
    if (ready?.ok !== true) return { due: [], said: {} as Record<string, string>, settingsMissing: true };
    const facts = await alertFacts(db, now);
    const [saved] = await rows(db, sql`select value from app_settings where key = 'alerts_said'`);
    const said = (saved?.value as Record<string, string> | undefined) ?? {};
    const day = localParts(now, marketConfig(DEFAULT_MARKET_ID).timeZone).date;
    return { due: alertsDue(criticalAlerts(facts, day), said, now), said, settingsMissing: false };
  });
  if (!r.persisted) return { outcome: "error", processed: 0, skipped: 0, failed: 1, note: "facts_unreadable" };
  if (r.data.settingsMissing) return { outcome: "skipped", processed: 0, skipped: 0, failed: 0, note: "not_migrated" };
  const { due, said } = r.data;
  if (due.length === 0) return { outcome: "ok", processed: 0, skipped: 0, failed: 0 };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: alertsText(due, siteBase()) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { outcome: "error", processed: 0, skipped: 0, failed: due.length, note: `slack_${res.status}` };
  } catch (err) {
    /* The class only: a fetch error can carry the URL, and the URL is the secret. */
    return { outcome: "error", processed: 0, skipped: 0, failed: due.length, note: err instanceof Error ? err.constructor.name : "unknown" };
  }

  /* Remembered after Slack took it; keys older than two days are dropped so the setting stays small. */
  const keep: Record<string, string> = {};
  const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
  for (const [k, at] of Object.entries(said)) if (new Date(at).getTime() > cutoff) keep[k] = at;
  for (const a of due) keep[a.key] = now.toISOString();
  await withDb(async (db) => {
    await db.execute(sql`
      insert into app_settings (key, value, updated_by, updated_at) values ('alerts_said', ${JSON.stringify(keep)}::jsonb, 'critical_alerts', now())
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
    `);
    return true;
  });
  console.info("[alerts] said", { alerts: due.length, critical: due.filter((a) => a.severity === "critical").length });
  return { outcome: "ok", processed: due.length, skipped: 0, failed: 0 };
}
