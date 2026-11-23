import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";

/**
 * The sources & partners list (0077, 23 Nov): the agent features sheet gives the Source agent "Pando
 * data via Pando MCP: sources & partners list" and the Partner analyst "Keeps the partner list". Before
 * this there was no such list anywhere in Pando, so both agents kept it in their own heads.
 *
 * Organisations and feeds only — a name, a link, what kind it is, the area, a short note — never a
 * person's name, email or phone: a partner's contact stays in the admin's inbox. Adding or changing an
 * entry is a proposal (`propose_source`) an admin approves on /admin/proposals. The one thing an
 * agent writes itself is the result of reading a source (`record_source_check`: when, and ok / failed /
 * changed / gone) — operational, never shown to a parent, and counted on /admin/mcp like every call.
 */

type Row = Record<string, unknown>;

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

export const SOURCE_ROLES = ["source", "partner"] as const;
export const SOURCE_KINDS = ["api", "ical", "rss", "page", "sheet", "newsletter", "school", "camp", "pta", "group", "venue", "other"] as const;
export const SOURCE_STATUSES = ["active", "paused", "retired"] as const;
export const SOURCE_CHECKS = ["ok", "failed", "changed", "gone"] as const;

export interface SourceRow {
  id: string;
  role: string;
  kind: string;
  name: string;
  url: string | null;
  area: string | null;
  note: string | null;
  status: string;
  last_checked_at: string | null;
  last_check: string | null;
  added_by: string;
}

const toSource = (r: Row): SourceRow => ({
  id: String(r.id),
  role: String(r.role),
  kind: String(r.kind),
  name: String(r.name),
  url: r.url ? String(r.url) : null,
  area: r.area ? String(r.area) : null,
  note: r.note ? String(r.note) : null,
  status: String(r.status),
  last_checked_at: r.last_checked_at ? new Date(String(r.last_checked_at)).toISOString() : null,
  last_check: r.last_check ? String(r.last_check) : null,
  added_by: String(r.added_by),
});

/** The list, by role and status (active by default); least recently checked first, so a run starts with what is due. */
export async function listSources(db: Db, input: { role?: string; status?: string; kind?: string; limit: number }): Promise<SourceRow[]> {
  const status = input.status ?? "active";
  const out = await rows(db, sql`
    select * from pando_sources
     where true
       ${input.role ? sql`and role = ${input.role}` : sql``}
       ${status !== "any" ? sql`and status = ${status}` : sql``}
       ${input.kind ? sql`and kind = ${input.kind}` : sql``}
     order by last_checked_at asc nulls first, lower(name)
     limit ${input.limit}
  `);
  return out.map(toSource);
}

export async function getSource(db: Db, id: string): Promise<SourceRow | null> {
  const [r] = await rows(db, sql`select * from pando_sources where id = ${id}::uuid`);
  return r ? toSource(r) : null;
}

/** An active or paused source of the same role and name, for "already on the list". */
export async function sourceNamed(db: Db, role: string, name: string): Promise<SourceRow | null> {
  const [r] = await rows(db, sql`select * from pando_sources where role = ${role} and lower(name) = lower(${name})`);
  return r ? toSource(r) : null;
}

/** What reading one source found; only these two columns, never the entry itself. */
export async function recordSourceCheck(db: Db, id: string, result: string): Promise<boolean> {
  const out = await rows(db, sql`
    update pando_sources set last_checked_at = now(), last_check = ${result}
     where id = ${id}::uuid and status <> 'retired'
    returning id
  `);
  return out.length > 0;
}
