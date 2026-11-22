import "server-only";
import { sql } from "drizzle-orm";
import { DIGEST_CONSENT_TEXT_VERSION } from "@/lib/consent";
import { DIGEST_AGENT_ATTEMPTS, candidatesForGroup, editionOutcome, editionWithCandidates, type DigestItem } from "@/lib/digest";
import type { CohortProfile } from "@/lib/digest-cohorts";
import type { MarketId } from "@/lib/types";
import { marketConfig } from "@/lib/markets";
import { findDigestItems } from "@/lib/server/digest-agent";
import { withDb, type Db } from "@/lib/server/db";

/**
 * The weekly digest's records (drizzle/0064): one edition per market per
 * Saturday — and, since 4 Nov (drizzle/0065), per group of alike families
 * (`lib/digest-cohorts.ts`) — its items, who was sent it, and the separate yes.
 */

export interface DigestEdition {
  id: string;
  status: "ready" | "empty" | "failed";
  attempts: number;
  /** Items an admin took out are not here (19 Nov): only what may be sent. */
  items: DigestItem[];
  /** May be sent: approved by a person, or from before approval existed (drizzle/0069). */
  approved: boolean;
}

/**
 * Whether drizzle/0069 (the approval columns) is applied. Until it is, the
 * digest runs exactly as before — prepared and sent on Saturday, no approval —
 * so a deploy that lands before the migration stops nothing (DEPLOY.md §3b).
 * Only a yes is remembered: a no is asked again, so the migration takes effect
 * without a restart.
 */
let approvalApplied = false;
export async function hasDigestApproval(db: Db): Promise<boolean> {
  if (approvalApplied) return true;
  const rows = (await db.execute(sql`
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'digest_editions' and column_name = 'approval_required'
  `)) as unknown as unknown[];
  approvalApplied = rows.length > 0;
  return approvalApplied;
}

async function readEdition(db: Db, marketId: string, editionDate: string, isTest: boolean, cohortKey: string): Promise<DigestEdition | null> {
  const approval = await hasDigestApproval(db);
  const rows = (await db.execute(sql`
    select id, status, attempts,
           ${approval ? sql`(not approval_required or approved_at is not null)` : sql`true`} as approved
      from digest_editions
     where market_id = ${marketId} and edition_date = ${editionDate}::date and is_test = ${isTest}
       and cohort_key = ${cohortKey} limit 1
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) return null;
  const id = String(rows[0].id);
  const items = (await db.execute(sql`
    select id::text as id, kind, title, when_text, starts_on::text as starts_on, ends_on::text as ends_on, place,
           age_min, age_max, summary, url
      from digest_items where edition_id = ${id}::uuid ${approval ? sql`and removed_at is null` : sql``} order by position
  `)) as unknown as DigestItem[];
  return {
    id,
    status: rows[0].status as DigestEdition["status"],
    attempts: Number(rows[0].attempts ?? 1),
    items,
    approved: rows[0].approved === true,
  };
}

/**
 * This Saturday's edition for a market — read if it is settled, found by the
 * agent if not. Settled is `ready` (items) or `empty` (the agent finished and
 * found nothing). A run that ended badly — a deadline, a cut-off reply, a
 * network error (`editionOutcome`) — is stored as `failed` and tried again by
 * the next hourly run, up to `DIGEST_AGENT_ATTEMPTS` a Saturday (review, 3 Nov:
 * the first version stored every bad run as `empty`, and one timeout cost the
 * whole week). Null means: nothing to send from this run — a failed run
 * that will be tried again. A settled edition with no items (`empty`, or
 * `failed` with every attempt spent) is returned with none, so its families
 * are still sent what other groups found for their children (11 Nov,
 * `poolForFamily`; the review: they were skipped while a ready edition for
 * the same ages sat beside theirs).
 *
 * The agent runs outside any transaction (it takes a minute or two); the job's
 * own lock (`job_runs`) keeps two runs from racing. A test run (`isTest`) has
 * its own edition, marked, so nothing it found is ever what a real Saturday
 * sends.
 */
/** The approved digest candidates of a market still ahead (0073); none when the table is not there yet. */
async function approvedCandidates(marketId: MarketId): Promise<DigestItem[]> {
  const r = await withDb(async (db: Db) => {
    const exists = (await db.execute(sql`select to_regclass('public.digest_candidates') is not null as ok`)) as unknown as Array<{ ok: boolean }>;
    if (!exists[0]?.ok) return [];
    return (await db.execute(sql`
      select kind, title, when_text, starts_on::text, ends_on::text, place, age_min, age_max, summary, url
        from digest_candidates
       where market_id = ${marketId} and removed_at is null
         and coalesce(ends_on, starts_on, (now() at time zone ${marketConfig(marketId).timeZone}::text)::date) >= (now() at time zone ${marketConfig(marketId).timeZone}::text)::date - 1
       order by coalesce(starts_on, ends_on) nulls last, created_at
       limit 100
    `)) as unknown as Array<Record<string, unknown>>;
  });
  if (!r.persisted) return [];
  return r.data.map((c) => ({
    kind: c.kind as DigestItem["kind"],
    title: String(c.title),
    when_text: String(c.when_text),
    starts_on: c.starts_on ? String(c.starts_on) : null,
    ends_on: c.ends_on ? String(c.ends_on) : null,
    place: c.place ? String(c.place) : null,
    age_min: c.age_min === null ? null : Number(c.age_min),
    age_max: c.age_max === null ? null : Number(c.age_max),
    summary: String(c.summary),
    url: String(c.url),
  }));
}

export async function digestEdition(
  marketId: MarketId,
  editionDate: string,
  cohort: CohortProfile,
  isTest = false,
): Promise<DigestEdition | null> {
  const existing = await withDb((db: Db) => readEdition(db, marketId, editionDate, isTest, cohort.key));
  if (!existing.persisted) return null;
  const before = existing.data;
  if (before && before.status !== "failed") return before;
  if (before && before.attempts >= DIGEST_AGENT_ATTEMPTS) return { ...before, items: [] };

  const found = await findDigestItems(marketId, editionDate, cohort);
  /* The Researcher's events an admin approved (20 Nov, 0073) go first for every group they fit. A run
     that failed is still tried again; on the last attempt, the candidates alone are this group's week. */
  const candidates = candidatesForGroup(await approvedCandidates(marketId), editionDate, cohort.ages);
  const lastAttempt = (before?.attempts ?? 0) + 1 >= DIGEST_AGENT_ATTEMPTS;
  const agentStatus = editionOutcome({ end: found.end, parsed: found.parsed, returned: found.returned, kept: found.items.length });
  const merged = editionWithCandidates({ status: agentStatus, items: found.items }, candidates, lastAttempt);
  const run = { ...found, items: merged.items };
  const status = merged.status;
  console.info("[digest] agent", {
    market: marketId,
    test: isTest,
    /* The group's size and shape, never who is in it (invariant 7). */
    cohort_members: cohort.members,
    cohort_stages: cohort.stages.length,
    end: run.end,
    status,
    attempt: (before?.attempts ?? 0) + 1,
    searches: run.searches,
    pages: run.pages,
    returned: run.returned,
    kept: run.items.length,
    candidates: candidates.length,
    relinked: run.relinked,
    text_length: run.shape.length,
    text_fence: run.shape.fence,
    text_objects: run.shape.objects,
    ...Object.fromEntries(Object.entries(run.dropped).map(([k, v]) => [`dropped_${k}`, v])),
  });

  const stored = await withDb(async (db: Db) => {
    /* Every new edition waits for a person (19 Nov), once drizzle/0069 is applied. */
    const approval = await hasDigestApproval(db);
    return db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        insert into digest_editions (market_id, edition_date, status, is_test, cohort_key, cohort_label, cohort_profile
                                     ${approval ? sql`, approval_required` : sql``})
        values (${marketId}, ${editionDate}::date, ${status}, ${isTest},
                ${cohort.key}, ${cohort.label}, ${JSON.stringify(cohort)}::jsonb
                ${approval ? sql`, true` : sql``})
        on conflict (market_id, edition_date, is_test, cohort_key) do update
           set status = excluded.status, attempts = digest_editions.attempts + 1
         where digest_editions.status = 'failed'
        returning id
      `)) as unknown as Array<Record<string, unknown>>;
      if (rows[0] && status === "ready") {
        const id = String(rows[0].id);
        for (const [position, item] of run.items.entries()) {
          await tx.execute(sql`
            insert into digest_items
              (edition_id, position, kind, title, when_text, starts_on, ends_on, place, age_min, age_max, summary, url)
            values
              (${id}::uuid, ${position}, ${item.kind}, ${item.title}, ${item.when_text},
               ${item.starts_on}::date, ${item.ends_on}::date, ${item.place},
               ${item.age_min}, ${item.age_max}, ${item.summary}, ${item.url})
          `);
        }
      }
      return readEdition(tx as unknown as Db, marketId, editionDate, isTest, cohort.key);
    });
  });
  if (!stored.persisted || !stored.data) return null;
  const settled = stored.data.status !== "failed" || stored.data.attempts >= DIGEST_AGENT_ATTEMPTS;
  return settled ? { ...stored.data, items: stored.data.status === "ready" ? stored.data.items : [] } : null;
}

/**
 * Every ready edition of this Saturday, by group (11 Nov): what a family with
 * children in more than one group's ages may also be sent (`poolForFamily`).
 */
export async function readyEditionsOfDay(marketId: MarketId, editionDate: string, isTest = false): Promise<Array<{ key: string; items: DigestItem[] }>> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select cohort_key from digest_editions
       where market_id = ${marketId} and edition_date = ${editionDate}::date and is_test = ${isTest} and status = 'ready'
       order by cohort_key
    `)) as unknown as Array<Record<string, unknown>>;
    const out: Array<{ key: string; items: DigestItem[] }> = [];
    for (const r of rows) {
      const edition = await readEdition(db, marketId, editionDate, isTest, String(r.cohort_key));
      /* Only what a person approved is anyone's to be sent (19 Nov). */
      if (edition?.approved) out.push({ key: String(r.cohort_key), items: edition.items });
    }
    return out;
  });
  return result.persisted && result.data ? result.data : [];
}

/**
 * How many of this Saturday's editions with items still wait for approval
 * (19 Nov). While any do, a family whose digest would come out empty is not
 * claimed as "nothing suited": an edition approved an hour later may hold
 * something for their children (`poolForFamily`), and a claim is final.
 */
export async function unapprovedEditionsOfDay(marketId: MarketId, editionDate: string, isTest = false): Promise<number> {
  const result = await withDb(async (db: Db) => {
    if (!(await hasDigestApproval(db))) return 0;
    const rows = (await db.execute(sql`
      select count(*)::int as n from digest_editions e
       where e.market_id = ${marketId} and e.edition_date = ${editionDate}::date and e.is_test = ${isTest}
         and e.status = 'ready' and e.approval_required and e.approved_at is null
         and exists (select 1 from digest_items i where i.edition_id = e.id and i.removed_at is null)
    `)) as unknown as Array<Record<string, unknown>>;
    return Number(rows[0]?.n ?? 0);
  });
  return result.persisted ? Number(result.data ?? 0) : 0;
}

/**
 * The groups already drawn for this Saturday, as their editions recorded them
 * (`cohort_profile`), so a later hourly run keeps them (`joinDrawn`). The
 * pre-group edition ('all') is not one.
 */
export async function drawnCohorts(marketId: MarketId, editionDate: string, isTest = false): Promise<CohortProfile[]> {
  const result = await withDb(async (db: Db) =>
    (await db.execute(sql`
      select cohort_profile from digest_editions
       where market_id = ${marketId} and edition_date = ${editionDate}::date and is_test = ${isTest}
         and cohort_key <> 'all' and cohort_profile is not null
       order by cohort_key
    `)) as unknown as Array<Record<string, unknown>>,
  );
  if (!result.persisted || !result.data) return [];
  return result.data.map((r) => r.cohort_profile as CohortProfile).filter((p) => p && typeof p.key === "string");
}

/**
 * Is there anybody to send to? Checked before the agent runs, so a Saturday
 * with nobody signed up costs nothing (review, 3 Nov).
 */
export async function hasDigestRecipients(marketId: MarketId, isTest = false): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select 1 from people p
       where p.market_id = ${marketId} and p.is_test = ${isTest} and p.phone is not null
         and (select k.status from consents k
               where k.person_id = p.id and k.scope = 'digest'
               order by k.captured_at desc limit 1) = 'opted_in'
       limit 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  });
  return result.persisted && result.data === true;
}

export interface DigestRecipient {
  person_id: string;
  phone: string;
  /** Their children, by birth (or due) year and the month when given; empty for nobody listed. */
  children: Array<{ year: number; month: number | null }>;
  /** What the graph knows, for grouping (4 Nov): the neighborhood and its town, the social edges, the logistics and budget answers. */
  neighborhood: string | null;
  area: string | null;
  affinities: string[];
  relevance: string[];
  /** Already sent a digest this Saturday, from any group's edition. */
  sent: boolean;
}

/**
 * Everybody this Saturday's digest is for: a phone, the market, a newest
 * `digest` consent that is a yes — **sent or not**, because the groups are
 * drawn over all of them, so every hourly run of the day draws the same ones
 * (4 Nov); `sent` says who already has theirs, from any group's edition, so
 * nobody is sent two. Opt-out (STOP) and quiet hours are the send layer's to
 * refuse, as for every message. A test edition goes to test people only, and a
 * real one never to them.
 */
export async function digestAudience(marketId: MarketId, editionDate: string, isTest = false): Promise<DigestRecipient[]> {
  return familyRows(editionDate, isTest, sql`
         p.market_id = ${marketId}
         and p.is_test = ${isTest}
         and p.phone is not null
         and (select k.status from consents k
               where k.person_id = p.id and k.scope = 'digest'
               order by k.captured_at desc limit 1) = 'opted_in'`);
}

/**
 * One family by its phone, for the admin's one-number test (19 Nov): **no
 * digest consent asked** (the developer's choice for testing) and test or not;
 * the market is the person's own. `sent` reads the test editions of that
 * Saturday, which are what the test sends from. STOP and quiet hours are still
 * the send layer's.
 */
export async function digestFamilyByPhone(phone: string, editionDate: string): Promise<(DigestRecipient & { market_id: string }) | null> {
  const found = await familyRows(editionDate, true, sql`p.phone = ${phone}`, true);
  return (found[0] as (DigestRecipient & { market_id: string }) | undefined) ?? null;
}

/**
 * The audit row for the one-number test (19 Nov): who pressed it, which person,
 * the Saturday and what came of it — never the phone (invariant 7).
 */
export async function auditDigestOne(actor: string, action: "digest.prepare_for" | "digest.send_to", personId: string | null, after: Record<string, unknown>): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      insert into audit_log (actor, action, resource, resource_id, after)
      values (${actor}, ${action}, 'person', ${personId}, ${JSON.stringify(after)}::jsonb)
    `);
    return true;
  });
}

async function familyRows(editionDate: string, isTest: boolean, where: ReturnType<typeof sql>, withMarket = false): Promise<DigestRecipient[]> {
  const result = await withDb(async (db: Db) =>
    (await db.execute(sql`
      select p.id as person_id, p.phone, p.neighborhood, p.market_id,
             (select o.area from market_options o
               where o.market_id = p.market_id and o.category = 'neighborhoods'
                 and o.option_value = p.neighborhood limit 1) as area,
             coalesce((select json_agg(a.affinity_type || ':' || a.affinity_value)
                         from social_affinities a where a.person_id = p.id), '[]'::json) as affinities,
             coalesce((select json_agg(l.dimension || ':' || l.value)
                         from life_relevance l where l.person_id = p.id), '[]'::json) as relevance,
             exists (select 1 from digest_sends s join digest_editions e on e.id = s.edition_id
                      where s.person_id = p.id and e.market_id = p.market_id
                        and e.edition_date = ${editionDate}::date and e.is_test = ${isTest}) as sent,
             coalesce((select json_agg(json_build_object(
                         'year', coalesce(c.birth_year, c.due_year),
                         'month', coalesce(c.birth_month, c.due_month)))
                         from children c where c.person_id = p.id
                          and coalesce(c.birth_year, c.due_year) is not null), '[]'::json) as children
        from people p
       where ${where}
       order by p.id
    `)) as unknown as Array<Record<string, unknown>>,
  );
  if (!result.persisted || !result.data) return [];
  return result.data.map((r) => ({
    ...(withMarket ? { market_id: String(r.market_id) } : {}),
    person_id: String(r.person_id),
    phone: String(r.phone),
    children: ((r.children as Array<{ year: number; month: number | null }> | null) ?? []).map((c) => ({
      year: Number(c.year),
      month: c.month === null || c.month === undefined ? null : Number(c.month),
    })),
    neighborhood: r.neighborhood ? String(r.neighborhood) : null,
    area: r.area ? String(r.area) : null,
    affinities: ((r.affinities as string[] | null) ?? []).map(String),
    relevance: ((r.relevance as string[] | null) ?? []).map(String),
    sent: r.sent === true,
  }));
}

/**
 * Claims a person's digest for an edition **before** it is sent (review, 3 Nov):
 * true only for the run that inserted the row. A send that then fails for a
 * reason that may pass gives the claim back (`releaseDigestSend`); a crash
 * between the two leaves the claim, so a parent can miss a week but is never
 * sent the same digest twice.
 */
export async function claimDigestSend(editionId: string, personId: string, itemCount: number, itemIds: readonly string[] = []): Promise<boolean> {
  /* What they were sent, in its numbers' order (11 Nov, drizzle/0067): "2" is the second of these. */
  const ids = itemIds.length ? sql`array[${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]` : sql`'{}'::uuid[]`;
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      insert into digest_sends (edition_id, person_id, item_count, item_ids)
      values (${editionId}::uuid, ${personId}::uuid, ${itemCount}, ${ids})
      on conflict do nothing
      returning person_id
    `)) as unknown as unknown[];
    return rows.length > 0;
  });
  return result.persisted && result.data === true;
}

export async function releaseDigestSend(editionId: string, personId: string): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      delete from digest_sends where edition_id = ${editionId}::uuid and person_id = ${personId}::uuid
    `);
    return true;
  });
}

/** DIGEST / DIGEST OFF over SMS: the separate yes and its undo, appended like every consent. */
export async function setDigestConsent(personId: string, on: boolean): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    await db.execute(sql`
      insert into consents (person_id, scope, status, source, text_version)
      values (${personId}::uuid, 'digest', ${on ? "opted_in" : "revoked"}, 'sms_command', ${DIGEST_CONSENT_TEXT_VERSION})
    `);
    return true;
  });
  return result.persisted === true;
}
