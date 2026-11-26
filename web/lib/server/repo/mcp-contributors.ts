import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import {
  ALLOWANCE_WINDOW_DAYS,
  OPEN_WEEKLY_WINDOW_DAYS,
  RESPONSE_WINDOW_DAYS,
  decideOutreach,
  effectiveAllowance,
  type OutreachHistory,
} from "@/lib/outreach-policy";
import { marketZoneOf } from "@/lib/server/repo/outreach";

type Row = Record<string, unknown>;
const rows = async (db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
const n = (v: unknown) => Number(v ?? 0);

/**
 * How hard Pando is leaning on its contributors (26 Nov — the founder's Playbook, daily report:
 * "contributor pings / replies / fatigue"). Counts only, never a person (invariant 7).
 *
 * The window (`days`) is what was asked and answered in it. "Resting now" is decided exactly as
 * the send layer decides it — the same counters as `outreachAllowed` (`repo/outreach.ts`) and the
 * same `decideOutreach` — for everybody asked in the last 30 days: who Pando could not ask today,
 * and why (the monthly or weekly ceiling, the 48-hour gap), and how many of them have their ceiling
 * lowered by the response-rate governor (8.4). A thank-you asks nothing and is not a request.
 */
export async function contributorLoad(db: Db, input: { days: number }) {
  const w = input.days;
  const isRequest = sql`m.direction = 'out' and m.category = 'outreach' and m.retry_of is null and m.template is distinct from 'thanks'`;
  const inWindow = sql`m.sent_at > now() - make_interval(days => ${w}::int)`;
  const per = await rows(db, sql`
    select p.monthly_contact_allowance, p.allowance_mode,
      coalesce(sum(case when ${isRequest} and m.sent_at > now() - make_interval(days => ${ALLOWANCE_WINDOW_DAYS}::int) then 1 else 0 end), 0)::int as sent_30,
      coalesce(sum(case when ${isRequest} and m.sent_at > now() - make_interval(days => ${OPEN_WEEKLY_WINDOW_DAYS}::int) then 1 else 0 end), 0)::int as sent_7,
      count(distinct case when m.direction = 'in' and m.responded_to is not null
                           and m.sent_at > now() - make_interval(days => ${RESPONSE_WINDOW_DAYS}::int) then m.responded_to end)::int as answered_30,
      max(case when ${isRequest} then m.sent_at end) as last_outreach,
      coalesce(sum(case when m.direction = 'out' and m.template = 'freshness_ping' and m.retry_of is null
                         and date_trunc('month', m.sent_at at time zone z.tz) = date_trunc('month', now() at time zone z.tz) then 1 else 0 end), 0)::int as pings_month,
      coalesce(bool_or(${isRequest} and m.template is distinct from 'freshness_ping'
                       and (m.sent_at at time zone z.tz)::date = (now() at time zone z.tz)::date), false) as blast_today,
      coalesce(sum(case when ${isRequest} and ${inWindow} then 1 else 0 end), 0)::int as asked_w,
      coalesce(sum(case when ${isRequest} and m.template = 'blast_request' and ${inWindow} then 1 else 0 end), 0)::int as asks_w,
      coalesce(sum(case when ${isRequest} and m.template = 'freshness_ping' and ${inWindow} then 1 else 0 end), 0)::int as pings_w,
      coalesce(sum(case when ${isRequest} and m.template = 'thanks_prompt' and ${inWindow} then 1 else 0 end), 0)::int as prompts_w,
      coalesce(sum(case when m.direction = 'out' and m.template = 'thanks' and m.retry_of is null and ${inWindow} then 1 else 0 end), 0)::int as thanks_w,
      count(distinct case when m.direction = 'in' and m.responded_to is not null and ${inWindow} then m.responded_to end)::int as replies_w,
      coalesce(bool_or(m.direction = 'in' and m.template = 'opt_out' and ${inWindow}), false) as opted_out_w
      from people p
      cross join lateral (select ${marketZoneOf(sql`p.market_id`)} as tz) z
      join message_log m on m.person_id = p.id
     where not p.is_test
     group by p.id, p.monthly_contact_allowance, p.allowance_mode, z.tz
    having bool_or(${isRequest} and m.sent_at > now() - make_interval(days => ${ALLOWANCE_WINDOW_DAYS}::int))
  `);
  const [passed] = await rows(db, sql`
    select count(*)::int as n from blast_recipients r join people p on p.id = r.person_id
     where not p.is_test and r.passed_at > now() - make_interval(days => ${w}::int)
  `);

  const resting: Record<string, number> = {};
  let lowered = 0;
  let askedInWindow = 0;
  for (const r of per) {
    if (n(r.asked_w) > 0) askedInWindow += 1;
    if (r.opted_out_w === true) continue;
    const history: OutreachHistory = {
      sent_last_30_days: n(r.sent_30),
      sent_last_7_days: n(r.sent_7),
      responded_last_30_days: n(r.answered_30),
      last_outreach_at: (r.last_outreach as string | null) ?? null,
      pings_this_month: n(r.pings_month),
      blast_today: r.blast_today === true,
    };
    const stated = {
      monthly_contact_allowance: r.monthly_contact_allowance === null ? null : n(r.monthly_contact_allowance),
      allowance_mode: (r.allowance_mode === "as_relevant" ? "as_relevant" : "fixed") as "as_relevant" | "fixed",
    };
    if (effectiveAllowance(stated, history).lowered) lowered += 1;
    const d = decideOutreach("blast", stated, history);
    if (!d.ok) resting[d.reason] = (resting[d.reason] ?? 0) + 1;
  }
  const sum = (k: string) => per.reduce((s, r) => s + n(r[k]), 0);
  const asked = sum("asked_w");
  const replies = sum("replies_w");
  return {
    window_days: w,
    requests: { total: asked, network_asks: sum("asks_w"), freshness_pings: sum("pings_w"), did_it_help: sum("prompts_w"), other: asked - sum("asks_w") - sum("pings_w") - sum("prompts_w") },
    contributors_asked: askedInWindow,
    replies,
    /* Requests that got an answer, of those asked in the window; null with none asked. */
    reply_rate: asked > 0 ? Math.round((replies / asked) * 100) / 100 : null,
    passes: n(passed?.n),
    thanks_sent: sum("thanks_w"),
    /* Of everyone asked in the last 30 days: who could not be asked a Network Ask today, and why. */
    asked_last_30_days: per.length,
    resting_now: { total: Object.values(resting).reduce((s, v) => s + v, 0), by_reason: resting },
    ceiling_lowered_by_governor: lowered,
    opted_out_after_a_request: per.filter((r) => r.opted_out_w === true).length,
  };
}
