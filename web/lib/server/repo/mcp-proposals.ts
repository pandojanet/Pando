import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { FLAGGED_PERSON } from "@/lib/server/repo/mcp-read";
import { detailColumns, hasDigestDetails } from "@/lib/server/repo/digest";
import { DEFAULT_MARKET_ID, marketConfig } from "@/lib/markets";

/** Today on the market's clock (review round 2: the database's current_date is UTC, a day ahead after 4pm in Pasadena). */
const TODAY = sql`(now() at time zone ${marketConfig(DEFAULT_MARKET_ID).timeZone}::text)::date`;

/**
 * What an agent proposes through Pando MCP (20 Nov). A proposal changes nothing: it waits for an
 * admin's yes on /admin/proposals, and is then applied by `proposal.approve` in `applyAction` — the
 * same function and audit trail as an admin's own edits. Since 23 Nov (the security review) only
 * there: a yes "from the conversation" was a flag the agent itself set, so the chat no longer decides.
 */

type Row = Record<string, unknown>;

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

export type ProposalKind = "record_edit" | "new_record" | "fact_check" | "event" | "source" | "plugin";

export interface NewProposal {
  actor: string;
  kind: ProposalKind;
  shareId: string | null;
  payload: Record<string, unknown>;
  sourceUrl: string | null;
}

/** Waiting proposals one admin's agents may have at once: a loop cannot bury /admin/proposals (review, 20 Nov). */
const MAX_WAITING = 100;

/**
 * Saves a proposal; a record it names must exist and be a real (not test) record. One transaction
 * holding a lock on the actor (23 Nov, the review): count-then-insert let parallel calls pass the cap.
 */
export async function createProposal(db: Db, p: NewProposal): Promise<{ id: string } | { refused: string }> {
  return db.transaction(async (tx) => createLocked(tx as unknown as Db, p));
}

async function createLocked(db: Db, p: NewProposal): Promise<{ id: string } | { refused: string }> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('mcp_proposals:' || ${p.actor}))`);
  const [waiting] = await rows(db, sql`select count(*) as n from mcp_proposals where actor = ${p.actor} and status = 'proposed'`);
  if (Number(waiting?.n ?? 0) >= MAX_WAITING) return { refused: `${MAX_WAITING} proposals are already waiting for an admin; wait until some are decided.` };
  let before: Record<string, unknown> | null = null;
  if (p.shareId) {
    /* What the record is now (0075): the admin sees "was → becomes", and a later change shows as "changed since". */
    const [s] = await rows(db, sql`
      select name, venue, neighborhoods, age_bands, subcategory, status, answer_ready, freshness_state
        from shares where id = ${p.shareId}::uuid and not is_test
    `);
    if (!s) return { refused: "No record with that id. Find it with search_records first." };
    before = {
      name: s.name ?? null, venue: s.venue ?? null, areas: s.neighborhoods ?? [], age_bands: s.age_bands ?? [],
      subcategory: s.subcategory ?? null, status: s.status ?? null, answer_ready: s.answer_ready === true, freshness: s.freshness_state ?? null,
    };
    const [open] = await rows(db, sql`
      select 1 from mcp_proposals where share_id = ${p.shareId}::uuid and kind = ${p.kind} and status = 'proposed'
         and payload = ${JSON.stringify(p.payload)}::jsonb
    `);
    if (open) return { refused: "the same proposal is already waiting for an admin" };
  } else if (p.kind === "plugin" || p.kind === "source") {
    /* One waiting change per plugin file (two would be made against the same file, and the second could
       never commit), or per source (by its id, else its name). */
    const key = p.kind === "plugin" ? sql`payload->>'path' = ${String(p.payload.path ?? "")}`
      : p.payload.source_id ? sql`payload->>'source_id' = ${String(p.payload.source_id)}` : sql`lower(payload->>'name') = lower(${String(p.payload.name ?? "")})`;
    const [open] = await rows(db, sql`select 1 from mcp_proposals where kind = ${p.kind} and status = 'proposed' and ${key}`);
    if (open) return { refused: p.kind === "plugin" ? `A change to ${String(p.payload.path)} is already waiting for an admin; propose again after they decide.` : "A change to that source is already waiting for an admin." };
  }
  const [made] = await rows(db, sql`
    insert into mcp_proposals (actor, kind, share_id, payload, source_url, before)
    values (${p.actor}, ${p.kind}, ${p.shareId}::uuid, ${JSON.stringify(p.payload)}::jsonb, ${p.sourceUrl}, ${before ? JSON.stringify(before) : null}::jsonb)
    returning id
  `);
  return { id: String(made?.id) };
}

export interface ProposalRow {
  id: string;
  created_at: string;
  proposed_by: string;
  kind: ProposalKind;
  record: { id: string; name: string | null; kind: string } | null;
  change: Record<string, unknown>;
  source_url: string | null;
  status: string;
  decided_by: string | null;
  decided_via: string | null;
  decided_at: string | null;
  /** Why an admin rejected it, when they said (0075). */
  reason: string | null;
}

/**
 * Proposals; `status` narrows (proposed by default). Waiting ones oldest first — the order an admin
 * works through them, as the tool says (23 Nov, the review: it said oldest and sorted newest) — and
 * decided ones newest first. Admins are named; parents never, and a record flagged as a person's name
 * goes without its name (`FLAGGED_PERSON`). A plugin change comes back as what it changes, not the
 * files: they are long, and an admin reads them on /admin/proposals.
 */
export async function listProposals(db: Db, input: { status?: string | null; limit: number }): Promise<ProposalRow[]> {
  const out = await rows(db, sql`
    select p.*, s.name as share_name, s.kind as share_kind, ${FLAGGED_PERSON} as flagged_person
      from mcp_proposals p left join shares s on s.id = p.share_id
     ${input.status === "all" ? sql`` : sql`where p.status = ${input.status ?? "proposed"}`}
     order by ${(input.status ?? "proposed") === "proposed" ? sql`p.created_at asc` : sql`coalesce(p.decided_at, p.created_at) desc`}
     limit ${input.limit}
  `);
  return out.map((r) => ({
    id: String(r.id),
    created_at: new Date(String(r.created_at)).toISOString(),
    proposed_by: String(r.actor),
    kind: String(r.kind) as ProposalKind,
    record: r.share_id ? { id: String(r.share_id), name: r.flagged_person === true ? null : String(r.share_name ?? ""), kind: String(r.share_kind ?? "") } : null,
    change: r.kind === "plugin" ? pluginSummary(r.payload as Record<string, unknown>) : ((r.payload as Record<string, unknown>) ?? {}),
    source_url: r.source_url ? String(r.source_url) : null,
    status: String(r.status),
    decided_by: r.decided_by ? String(r.decided_by) : null,
    decided_via: r.decided_via ? String(r.decided_via) : null,
    decided_at: r.decided_at ? new Date(String(r.decided_at)).toISOString() : null,
    reason: r.decision_note ? String(r.decision_note) : null,
  }));
}

function pluginSummary(p: Record<string, unknown> | null): Record<string, unknown> {
  return { target: p?.target ?? null, action: p?.action ?? null, name: p?.name ?? null, path: p?.path ?? null, warnings: p?.warnings ?? [] };
}

/**
 * An event the Researcher proposes for the digest is new unless Pando has it or had it lately (20 Nov;
 * widened by the review the same day): a candidate (live or taken out), a waiting or rejected proposal,
 * with its title or its page, or the same occurrence (title and start date) already in a digest of the last
 * 60 days — a weekly storytime's next date is still new. A rejected one is not proposed again every day.
 */
export async function eventAlreadyKnown(db: Db, e: { title: string; url: string; starts_on: string | null }): Promise<boolean> {
  const out = await rows(db, sql`
    select 1 from digest_candidates
     where (lower(title) = lower(${e.title}) or url = ${e.url}) and created_at > now() - interval '60 days'
    union all
    select 1 from mcp_proposals
     where kind = 'event' and status in ('proposed', 'rejected') and created_at > now() - interval '60 days'
       and (lower(payload->>'title') = lower(${e.title}) or source_url = ${e.url})
    union all
    select 1 from digest_items i join digest_editions de on de.id = i.edition_id
     where de.created_at > now() - interval '60 days' and lower(i.title) = lower(${e.title})
       and i.starts_on is not distinct from ${e.starts_on}::date
    limit 1
  `);
  return out.length > 0;
}

/**
 * A new record Pando already has (same kind and name) or that is already waiting as a proposal.
 * A record flagged as a person's name is not counted (23 Nov, the review): otherwise "already has"
 * would confirm a guessed name that search_records deliberately never shows. Such a duplicate reaches
 * the admin as a proposal, who sees both.
 */
export async function recordAlreadyKnown(db: Db, r: { kind: string; name: string; url: string; facts: Record<string, unknown> }): Promise<boolean> {
  /* A rejected one blocks only the same proposal again (23 Nov, the lab walk): one that could not be
     applied — a sub-category Pando does not have — is rejected with "propose it again correctly", and
     the corrected one must get through. Waiting ones still block by name or page. */
  const facts = JSON.stringify(SAME_FACTS(r.facts));
  const out = await rows(db, sql`
    select 1 from shares s where not s.is_test and s.kind::text = ${r.kind} and lower(s.name) = lower(${r.name}) and not ${FLAGGED_PERSON}
    union all
    select 1 from mcp_proposals
     where kind = 'new_record' and created_at > now() - interval '60 days'
       and ((payload->>'kind' = ${r.kind} and lower(payload->>'name') = lower(${r.name})) or source_url = ${r.url})
       and (status = 'proposed'
            or (status = 'rejected' and jsonb_build_object('venue', payload->'venue', 'areas', payload->'areas', 'age_bands', payload->'age_bands',
                                                            'subcategory', payload->'subcategory', 'url', to_jsonb(source_url)) = ${facts}::jsonb))
    limit 1
  `);
  return out.length > 0;
}

/** The facts that make two new-record proposals the same one: what an admin would judge differently. */
const SAME_FACTS = (f: Record<string, unknown>) => ({
  venue: f.venue ?? null,
  areas: f.areas ?? null,
  age_bands: f.age_bands ?? null,
  subcategory: f.subcategory ?? null,
  url: f.url ?? null,
});

/** The digest's approved candidates still ahead, soonest first — what the Researcher checks before proposing. */
export async function liveCandidates(db: Db, limit: number) {
  const out = await rows(db, sql`
    select id, kind, title, when_text, starts_on::text, ends_on::text, place, age_min, age_max, url, created_at
           ${detailColumns(await hasDigestDetails(db))}
      from digest_candidates
     where removed_at is null and coalesce(ends_on, starts_on, ${TODAY}) >= ${TODAY}
     order by coalesce(starts_on, ends_on) nulls last, created_at
     limit ${limit}
  `);
  return out.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: String(r.title),
    when: String(r.when_text),
    starts_on: r.starts_on ? String(r.starts_on) : null,
    ends_on: r.ends_on ? String(r.ends_on) : null,
    place: r.place ? String(r.place) : null,
    ages: r.age_min === null && r.age_max === null ? null : `${r.age_min ?? 0}-${r.age_max ?? 18}`,
    url: String(r.url),
    /* 25 Nov (drizzle/0081): so an agent sees what a candidate already carries. */
    price: r.price ? String(r.price) : null,
    popular: r.popular === true,
  }));
}
