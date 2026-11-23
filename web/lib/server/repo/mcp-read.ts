import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { maskContactDetails } from "@/lib/contact-details";
import { freshnessOf, labelsFor, lastConfirmedLabel } from "@/lib/trust-labels";
import { DEFAULT_MARKET_ID, marketConfig } from "@/lib/markets";

/**
 * What Pando MCP reads (20 Nov): totals with no names, and records with their facts. The rule on the
 * diagram — "Totals, no names" — is kept by what these queries select: never a person's name, phone,
 * email or id, never a question's text, never a caregiver. A record's approved contribution texts go
 * out without who wrote them (approved by an admin already, invariant 8), with contact details masked,
 * and never for a record flagged as a person's name. Test rows are always left out.
 */

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

/** The market's clock (Pasadena): weeks and days are counted on it, as a parent lives them. */
const TZ = marketConfig(DEFAULT_MARKET_ID).timeZone;

/**
 * Weeks as the moments their Mondays begin on the market's clock, newest last, for `weeks` weeks back
 * (review, 20 Nov: on the database's UTC a Sunday-evening sign-up in Pasadena counted in the next week).
 * Stepped on local (naive) Mondays and turned into moments one by one, so a week still starts at midnight
 * after a clock change (review round 2: stepping 168 hours in UTC drifted an hour at each change).
 */
const WEEKS = (weeks: number) =>
  sql`(select g at time zone ${TZ}::text as w, (g + interval '1 week') at time zone ${TZ}::text as w_end, g::date::text as label
         from generate_series(date_trunc('week', now() at time zone ${TZ}::text) - make_interval(weeks => ${weeks - 1}::int), date_trunc('week', now() at time zone ${TZ}::text), interval '1 week') g)`;

export async function parentsTotals(db: Db, weeks: number) {
  const [t] = await rows(db, sql`
    select count(*) as parents,
           count(*) filter (where founding = 'founding') as founding,
           count(*) filter (where phone_verified_at is not null) as verified,
           count(*) filter (where exists (select 1 from children c where c.person_id = p.id)) as with_children,
           count(*) filter (where (select k.status from consents k where k.person_id = p.id and k.scope = 'digest'
                                   order by k.captured_at desc limit 1) = 'opted_in') as digest_on,
           count(*) filter (where exists (select 1 from sms_opt_outs o where o.phone = p.phone and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at))) as opted_out,
           count(*) filter (where exists (select 1 from share_contributions sc where sc.person_id = p.id and sc.status = 'approved' and not sc.is_test)) as contributors
      from people p where not p.is_test
  `);
  const byWeek = await rows(db, sql`
    select ws.label as week, (select count(*) from people p where not p.is_test and p.created_at >= ws.w and p.created_at < ws.w_end) as joined
      from ${WEEKS(weeks)} ws order by ws.w
  `);
  return {
    parents: n(t?.parents), founding: n(t?.founding), phone_verified: n(t?.verified), with_children: n(t?.with_children),
    digest_on: n(t?.digest_on), opted_out: n(t?.opted_out), contributors: n(t?.contributors),
    joined_by_week: byWeek.map((r) => ({ week: String(r.week).slice(0, 10), joined: n(r.joined) })),
  };
}

export async function questionsTotals(db: Db, weeks: number) {
  const status = await rows(db, sql`select status, count(*) as n from answers where not is_test group by 1 order by 2 desc`);
  const [h] = await rows(db, sql`
    select count(*) filter (where helped is true) as helped_yes, count(*) filter (where helped is false) as helped_no,
           count(*) filter (where helped_asked_at is not null and helped is null) as helped_awaiting,
           count(*) filter (where hold_reason is not null and hold_reason <> 'not_held') as held, count(*) filter (where public_only) as public_only
      from answers where not is_test
  `);
  const holds = await rows(db, sql`select hold_reason as reason, count(*) as n from answers where not is_test and hold_reason is not null and hold_reason <> 'not_held' group by 1 order by 2 desc`);
  const byWeek = await rows(db, sql`
    select ws.label as week, q.asked, q.sent, q.held, q.helped_yes, q.helped_no
      from ${WEEKS(weeks)} ws
      cross join lateral (
        select count(*) as asked,
               count(*) filter (where a.status = 'sent') as sent,
               count(*) filter (where coalesce(a.hold_reason, 'not_held') <> 'not_held') as held,
               count(*) filter (where a.helped is true) as helped_yes,
               count(*) filter (where a.helped is false) as helped_no
          from answers a where not a.is_test and a.created_at >= ws.w and a.created_at < ws.w_end
      ) q
     order by ws.w
  `);
  const demand = await rows(db, sql`select coalesce(category, 'uncategorised') as category, count(*) as n from demand_signals where not is_test group by 1 order by 2 desc`);
  return {
    answers_by_status: status.map((r) => ({ status: String(r.status), count: n(r.n) })),
    helped: { yes: n(h?.helped_yes), no: n(h?.helped_no), awaiting: n(h?.helped_awaiting) },
    held: n(h?.held),
    held_by_reason: holds.map((r) => ({ reason: String(r.reason), count: n(r.n) })),
    answered_from_public_only: n(h?.public_only),
    /* By the week a question was asked (dry run of the weekly review, 20 Nov: the status totals mixed weeks). */
    asked_by_week: byWeek.map((r) => ({ week: String(r.week).slice(0, 10), asked: n(r.asked), sent: n(r.sent), held: n(r.held), helped_yes: n(r.helped_yes), helped_no: n(r.helped_no) })),
    seed_tool_questions_by_category: demand.map((r) => ({ category: String(r.category), count: n(r.n) })),
  };
}

/**
 * "Did it help", counted in the database over every sent answer (23 Nov, the review): `impact_totals`
 * used to add up the admin's /impact list, which stops at the latest 200 and includes test answers —
 * the totals went flat at 200 and counted the QA walk. Optional days on Pasadena's clock.
 */
export async function impactTotals(db: Db, input: { from?: string; to?: string } = {}) {
  const [t] = await rows(db, sql`
    select count(*) filter (where helped is true) as yes,
           count(*) filter (where helped is false) as no,
           count(*) filter (where helped_asked_at is not null and helped is null) as awaiting,
           count(*) filter (where helped_asked_at is null) as unasked,
           count(*) as sent
      from answers
     where not is_test and status = 'sent'
       ${input.from ? sql`and (sent_at at time zone ${TZ}::text)::date >= ${input.from}::date` : sql``}
       ${input.to ? sql`and (sent_at at time zone ${TZ}::text)::date <= ${input.to}::date` : sql``}
  `);
  return { answered_yes: n(t?.yes), answered_no: n(t?.no), awaiting: n(t?.awaiting), unasked: n(t?.unasked), sent: n(t?.sent) };
}

export async function recordsTotals(db: Db) {
  const byKind = await rows(db, sql`
    select kind, status, count(*) as n, count(*) filter (where answer_ready) as answer_ready
      from shares where not is_test group by 1, 2 order by 1, 2
  `);
  const provenance = await rows(db, sql`select provenance, count(*) as n from shares where not is_test group by 1 order by 2 desc`);
  const conf = await rows(db, sql`select kind, last_confirmed_at from shares where not is_test and status = 'approved'`);
  const fresh: Record<string, number> = {};
  for (const r of conf) {
    const s = freshnessOf(r.last_confirmed_at as string | null, String(r.kind));
    fresh[s] = (fresh[s] ?? 0) + 1;
  }
  return {
    by_kind_and_status: byKind.map((r) => ({ kind: String(r.kind), status: String(r.status), count: n(r.n), answer_ready: n(r.answer_ready) })),
    by_provenance: provenance.map((r) => ({ provenance: String(r.provenance), count: n(r.n) })),
    approved_by_freshness: fresh,
  };
}

/* ── Records ────────────────────────────────────────────────────────────────── */

const TEXT_FIELDS = ["what_makes_it_great", "caveat", "who_for", "who_not_for", "tip_text", "extra_note", "detail_note", "timing_note"] as const;

/**
 * A record flagged as possibly a person's name (invariant 8): its name, venue and texts never leave
 * the admin until an admin resolves the flag. Search leaves it out entirely, so a query cannot test
 * a guessed name against it; reading it by id returns the facts without them.
 */
export const FLAGGED_PERSON = sql`exists (select 1 from flags f where f.subject_id = s.id and f.reason = 'possible_named_person' and f.status in ('open', 'escalated'))`;
const WITHHELD = "withheld: flagged as a person's name";

/**
 * Who stands behind a record, counted as the answer path counts it (23 Nov, the review: search gave an
 * agent the provenance word and no label, so a Writer could call a public listing "parent-vouched").
 * Approved, firsthand, real contributions; recommending = said yes or yes with caveats.
 */
const BACKING = sql`
  (select count(*) from share_contributions sc where sc.share_id = s.id and sc.status = 'approved' and not sc.is_test and sc.firsthand) as firsthand_count,
  (select count(*) from share_contributions sc where sc.share_id = s.id and sc.status = 'approved' and not sc.is_test and sc.firsthand
      and sc.recommendation in ('yes', 'yes_with_caveats')) as recommending_count`;

function recordFacts(r: Row) {
  const flagged = r.flagged_person === true;
  /* The labels an answer to a parent would carry, verbatim (invariants 3 and 4): what a post or an
     email may say about where this came from — and public_only when no parent stands behind it. */
  const trust = labelsFor({
    kind: String(r.kind),
    provenance: String(r.provenance) as "parent_submitted" | "admin_entered" | "migrated",
    firsthand_count: n(r.firsthand_count),
    secondhand_count: 0,
    recommending_count: n(r.recommending_count),
    human_reviewed: r.status === "approved",
    last_confirmed_at: (r.last_confirmed_at as string | null) ?? null,
    marked_stale: r.freshness_state === "stale",
  });
  return {
    id: String(r.id),
    name: flagged ? null : String(r.name),
    ...(flagged ? { withheld: WITHHELD } : {}),
    kind: String(r.kind),
    subcategory: r.subcategory ? String(r.subcategory) : null,
    focus: r.focus ? String(r.focus) : null,
    venue: r.venue && !flagged ? String(r.venue) : null,
    areas: (r.neighborhoods as string[] | null) ?? [],
    age_bands: (r.age_bands as string[] | null) ?? [],
    status: String(r.status),
    provenance: String(r.provenance),
    answer_ready: r.answer_ready === true,
    freshness: trust.freshness,
    trust_labels: trust.labels,
    public_only: trust.public_only,
    last_confirmed: lastConfirmedLabel(r.last_confirmed_at as string | null),
    parents_who_shared: n(r.parents),
    /* The page its facts come from (0071), else the doctor check's page; and the last approved check. */
    source_url: r.source_url ? String(r.source_url) : r.provider_check_url ? String(r.provider_check_url) : null,
    source_check: r.source_check ? String(r.source_check) : null,
    source_checked_at: r.source_checked_at ? new Date(String(r.source_checked_at)).toISOString().slice(0, 10) : null,
  };
}

/** Records by name, kind, area or status — never a caregiver (shares hold none, by CHECK). */
/**
 * Records by words and facts. `status` is "approved" unless asked (23 Nov, the review: the default was
 * every status, so a Marketing or Writer agent could quote a record nobody had reviewed); "any" for all.
 * `source_check` and `not_checked_since` are the Fact-checker's: what the last check of the record's
 * page found ("never" = not checked), and records not checked since a date.
 */
export async function searchRecords(db: Db, input: { query?: string; kind?: string; area?: string; age_band?: string; status?: string; source_check?: string; not_checked_since?: string; limit: number }) {
  const status = input.status ?? "approved";
  const q = input.query?.trim() ? `%${input.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const out = await rows(db, sql`
    select s.*, (select count(distinct sc.person_id) from share_contributions sc where sc.share_id = s.id and sc.status = 'approved' and not sc.is_test) as parents,
           ${BACKING}
      from shares s
     where not s.is_test and not ${FLAGGED_PERSON}
       ${q ? sql`and (s.name ilike ${q} or coalesce(s.venue, '') ilike ${q} or coalesce(s.subcategory, '') ilike ${q} or coalesce(s.focus, '') ilike ${q})` : sql``}
       ${input.kind ? sql`and s.kind = ${input.kind}` : sql``}
       ${status !== "any" ? sql`and s.status = ${status}` : sql``}
       ${input.source_check === "never" ? sql`and s.source_check is null` : input.source_check ? sql`and s.source_check = ${input.source_check}` : sql``}
       ${input.not_checked_since ? sql`and (s.source_checked_at is null or s.source_checked_at < ${input.not_checked_since}::date)` : sql``}
       ${input.area ? sql`and ${input.area} = any(s.neighborhoods)` : sql``}
       ${input.age_band ? sql`and ${input.age_band} = any(s.age_bands)` : sql``}
     order by s.updated_at desc
     limit ${input.limit}
  `);
  return out.map(recordFacts);
}

/** One record: its facts and what parents said about it, approved, without who said it. */
export async function getRecord(db: Db, id: string) {
  const [r] = await rows(db, sql`
    select s.*, ${FLAGGED_PERSON} as flagged_person, ${BACKING},
           (select count(distinct sc.person_id) from share_contributions sc where sc.share_id = s.id and sc.status = 'approved' and not sc.is_test) as parents
      from shares s where s.id = ${id}::uuid and not s.is_test
  `);
  if (!r) return null;
  const facts = recordFacts(r);
  if (r.flagged_person === true) return { ...facts, parents_said: [] };
  const said = await rows(db, sql`
    select recommendation, firsthand, price_band, price_unit, worth_it, last_there, ${sql.raw(TEXT_FIELDS.join(", "))}
      from share_contributions where share_id = ${id}::uuid and status = 'approved' and not is_test
     order by approved_at desc nulls last limit 20
  `);
  return {
    ...facts,
    parents_said: said.map((c) => {
      const texts: Record<string, string> = {};
      for (const f of TEXT_FIELDS) if (typeof c[f] === "string" && String(c[f]).trim()) texts[f] = maskContactDetails(String(c[f]).trim());
      return {
        recommendation: c.recommendation ? String(c.recommendation) : null,
        firsthand: c.firsthand === true,
        price: c.price_band ? `${c.price_band}${c.price_unit ? ` / ${c.price_unit}` : ""}` : null,
        worth_it: c.worth_it ? String(c.worth_it) : null,
        last_there: c.last_there ? String(c.last_there) : null,
        ...texts,
      };
    }),
  };
}

/* ── What went wrong ──────────────────────────────────────────────────────── */

/**
 * What went wrong in the last `days` days, for the Report builder's daily brief — kinds and counts
 * only: background jobs that failed or only partly ran (never their notes), texts the carrier
 * refused or could not deliver (by category and the carrier's error code), digest weeks that did not
 * reach "ready", answers held for a person for more than a day, and Pando MCP's own tool errors.
 */
export async function whatWentWrong(db: Db, days: number) {
  const since = sql`now() - make_interval(days => ${days})`;
  const jobs = await rows(db, sql`
    select job, outcome, count(*) as runs, coalesce(sum(failed), 0) as failed_items, max(started_at) as last_at
      from job_runs where started_at > ${since} and outcome in ('error', 'partial')
     group by job, outcome order by max(started_at) desc
  `);
  const stuck = await rows(db, sql`
    select job, count(*) as runs from job_runs
     where started_at > ${since} and finished_at is null and started_at < now() - interval '1 hour'
     group by job
  `);
  const sends = await rows(db, sql`
    select coalesce(category, 'unknown') as category, coalesce(error_code::text, 'none') as error_code, count(*) as texts
      from message_log
     where direction = 'out' and status in ('failed', 'undelivered') and coalesce(status_at, sent_at) > ${since}
     group by 1, 2 order by 3 desc limit 20
  `);
  const digests = await rows(db, sql`
    select edition_date::text as week, status, count(*) as groups
      from digest_editions where not is_test and created_at > ${since} and status <> 'ready'
     group by 1, 2 order by 1 desc
  `);
  const [held] = await rows(db, sql`
    select count(*) as waiting, min(created_at) as oldest from answers where not is_test and status = 'pending_review' and created_at < now() - interval '1 day'
  `);
  const tools = await rows(db, sql`
    select tool, outcome, count(*) as calls from mcp_calls where at > ${since} and outcome in ('error', 'refused') group by tool, outcome order by 3 desc
  `);
  return {
    days,
    failed_jobs: jobs.map((r) => ({ job: String(r.job), outcome: String(r.outcome), runs: n(r.runs), failed_items: n(r.failed_items), last_at: new Date(String(r.last_at)).toISOString() })),
    unfinished_jobs: stuck.map((r) => ({ job: String(r.job), runs: n(r.runs) })),
    undelivered_texts: sends.map((r) => ({ category: String(r.category), error_code: String(r.error_code), texts: n(r.texts) })),
    digest_groups_not_ready: digests.map((r) => ({ week: String(r.week), status: String(r.status), groups: n(r.groups) })),
    answers_held_over_a_day: n(held?.waiting),
    /* The oldest of them, so the daily brief can say how long it has waited (dry run of the brief, 20 Nov). */
    oldest_held_since: held?.oldest ? new Date(String(held.oldest)).toISOString().slice(0, 10) : null,
    /* Errors, and refusals — a proposal refused, a read-only connection writing, a quota reached ("(rate limited)"). */
    mcp_tool_problems: tools.map((r) => ({ tool: String(r.tool), outcome: String(r.outcome), calls: n(r.calls) })),
  };
}

/* ── Questions Pando can't answer yet ─────────────────────────────────────── */

/**
 * The Strategy analyst's "questions Pando can't answer yet" (20 Nov: the developer, *"тексти питань
 * можна бачити"*). The one place Pando MCP returns a question's text: masked for phones and emails,
 * never who asked (no person, phone, name or area of theirs), and never the answer. A question held
 * because it is about a caregiver, or as sensitive (health, legal, safety, a claim about a named
 * person — `lib/answer-routing.ts`), is counted by reason, not quoted (security review, 20 Nov: masking
 * catches phones and emails, not a child's name or a diagnosis). Seed Tool questions likewise: only
 * the ordinary ones that need no person's review are quoted.
 * "Can't answer yet" is a question no Pando record stood behind: held for a person, or answered only
 * from public information.
 */
export async function unansweredQuestions(db: Db, input: { days: number; limit: number }) {
  const since = sql`now() - make_interval(days => ${input.days})`;
  const asked = await rows(db, sql`
    select a.question_text, a.created_at, a.status, a.hold_reason, a.public_only
      from answers a
     where not a.is_test and a.created_at > ${since}
       and coalesce(array_length(a.share_ids, 1), 0) = 0
       and coalesce(a.hold_reason, 'not_held') not in ('caregiver', 'sensitive', 'generator_asked')
     order by a.created_at desc
     limit ${input.limit}
  `);
  const unquoted = await rows(db, sql`
    select hold_reason as reason, count(*) as n from answers
     where not is_test and created_at > ${since} and coalesce(array_length(share_ids, 1), 0) = 0
       and hold_reason in ('caregiver', 'sensitive', 'generator_asked')
     group by 1
  `);
  const seed = await rows(db, sql`
    select question_text, category, created_at from demand_signals
     where not is_test and created_at > ${since} and status = 'open'
       and not requires_human_review and coalesce(sensitivity, 'ordinary') in ('ordinary', 'peer_support')
     order by created_at desc limit ${input.limit}
  `);
  const [seedUnquoted] = await rows(db, sql`
    select count(*) as n from demand_signals
     where not is_test and created_at > ${since} and status = 'open'
       and (requires_human_review or coalesce(sensitivity, 'ordinary') not in ('ordinary', 'peer_support'))
  `);
  const why = (r: Row) =>
    r.hold_reason && r.hold_reason !== "not_held" ? `held for a person: ${String(r.hold_reason)}` : r.public_only === true ? "answered from public information only" : "no Pando record behind the answer";
  return {
    days: input.days,
    texted: asked.map((r) => ({
      asked_on: new Date(String(r.created_at)).toISOString().slice(0, 10),
      question: maskContactDetails(String(r.question_text ?? "").trim()).slice(0, 600),
      why: why(r),
    })),
    /* Counted, never quoted: about a caregiver, or sensitive. */
    held_not_quoted: Object.fromEntries(unquoted.map((r) => [String(r.reason), n(r.n)])),
    seed_tool_open: seed.map((r) => ({
      asked_on: new Date(String(r.created_at)).toISOString().slice(0, 10),
      category: r.category ? String(r.category) : null,
      question: maskContactDetails(String(r.question_text ?? "").trim()).slice(0, 600),
    })),
    seed_tool_not_quoted: n(seedUnquoted?.n),
  };
}

/* ── Day by day ───────────────────────────────────────────────────────────── */

const DAILY_KEYS = ["joined", "verified", "contributions", "questions", "answers_sent", "held", "helped_yes", "helped_no", "digest_texts", "undelivered_texts"] as const;
type DailyKey = (typeof DAILY_KEYS)[number];

/**
 * The daily brief's numbers (20 Nov, the founder's Playbook: "yesterday vs 7-day baseline"): each of
 * the last `days` days on the market's clock (Pasadena, `timeZone`), counts only, and yesterday beside
 * the average of the seven days before it. Today so far is its own line, never in the baseline.
 * "Helped" is counted on the day Pando asked. Test rows are left out.
 */
export async function dailyActivity(db: Db, input: { days: number; timeZone: string }) {
  const tz = input.timeZone;
  const local = (col: string) => sql.raw(`(${col} at time zone '${tz.replace(/'/g, "")}')::date`);
  const out = await rows(db, sql`
    with days as (
      select d::date as day from generate_series((now() at time zone ${tz}::text)::date - ${input.days}::int, (now() at time zone ${tz}::text)::date, interval '1 day') d
    )
    select day::text as day,
      (select count(*) from people p where not p.is_test and ${local("p.created_at")} = day) as joined,
      (select count(*) from people p where not p.is_test and ${local("p.phone_verified_at")} = day) as verified,
      (select count(*) from share_contributions c where not c.is_test and ${local("c.created_at")} = day) as contributions,
      (select count(*) from answers a where not a.is_test and ${local("a.created_at")} = day) as questions,
      (select count(*) from answers a where not a.is_test and a.sent_at is not null and ${local("a.sent_at")} = day) as answers_sent,
      (select count(*) from answers a where not a.is_test and coalesce(a.hold_reason, 'not_held') <> 'not_held' and ${local("a.created_at")} = day) as held,
      (select count(*) from answers a where not a.is_test and a.helped is true and ${local("a.helped_asked_at")} = day) as helped_yes,
      (select count(*) from answers a where not a.is_test and a.helped is false and ${local("a.helped_asked_at")} = day) as helped_no,
      (select count(*) from digest_sends ds join digest_editions de on de.id = ds.edition_id where not de.is_test and ${local("ds.sent_at")} = day) as digest_texts,
      (select count(*) from message_log m where m.direction = 'out' and m.status in ('failed', 'undelivered') and ${local("coalesce(m.status_at, m.sent_at)")} = day) as undelivered_texts
      from days order by day
  `);
  const series = out.map((r) => ({ day: String(r.day), ...Object.fromEntries(DAILY_KEYS.map((k) => [k, n(r[k])])) }) as { day: string } & Record<DailyKey, number>);
  const today = series[series.length - 1] ?? null;
  const yesterday = series[series.length - 2] ?? null;
  const before = series.slice(Math.max(0, series.length - 9), series.length - 2);
  const avg = (k: DailyKey) => (before.length ? Math.round((before.reduce((s2, d) => s2 + d[k], 0) / before.length) * 10) / 10 : null);
  return {
    time_zone: tz,
    yesterday: yesterday
      ? { day: yesterday.day, ...Object.fromEntries(DAILY_KEYS.map((k) => [k, { count: yesterday[k], baseline_7_day_avg: avg(k) }])) }
      : null,
    today_so_far: today,
    days: series.slice(0, -1),
  };
}
