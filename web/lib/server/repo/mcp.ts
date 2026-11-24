import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { adminCredentials } from "@/lib/server/admin-auth";
import { readWithRetry, withDb, type Db } from "@/lib/server/db";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  REFRESH_TTL_MS,
  hashSecret,
  newSecret,
} from "@/lib/mcp/oauth";

/**
 * Pando MCP's rows (`drizzle/0070`, 20 Nov): OAuth clients, codes and tokens, the on/off switch and
 * the call log. Every secret is stored as a SHA-256 hash and never logged; an admin is named by
 * `admin_users.name`, as `audit_log` does. Nothing here logs a name, a phone or an argument
 * (invariant 7).
 */

type Row = Record<string, unknown>;

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

/** A text[] from a list, bound as one JSON parameter — never spliced into the SQL. */
const uriArray = (uris: readonly string[]) =>
  sql`(select coalesce(array_agg(u), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(uris)}::jsonb) u)`;

/* ── Clients ────────────────────────────────────────────────────────────────── */

export interface McpClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  kind: "dcr" | "cimd";
}

const toClient = (r: Row): McpClient => ({
  clientId: String(r.client_id),
  clientName: r.client_name ? String(r.client_name) : null,
  redirectUris: (r.redirect_uris as string[]) ?? [],
  kind: r.kind === "cimd" ? "cimd" : "dcr",
});

/** At most this many clients registered (DCR) in 30 days: registration cannot fill the table. */
const MAX_RECENT_CLIENTS = 500;

/** A client Claude registered (DCR): a new public client ID for these redirect URIs; "full" past the cap. */
export async function registerClient(input: { clientName: string | null; redirectUris: string[] }): Promise<McpClient | "full" | null> {
  const clientId = newSecret("client");
  const r = await withDb(async (db) => {
    /* Registrations that never led to a sign-in are dropped after a day (review, 20 Nov), so the cap counts
       clients in use and a burst of empty registrations cannot close registration for a month. */
    await db.execute(sql`
      delete from mcp_clients c where c.kind = 'dcr' and c.created_at < now() - interval '1 day'
         and not exists (select 1 from mcp_auth_codes a where a.client_id = c.client_id)
         and not exists (select 1 from mcp_tokens t where t.client_id = c.client_id)
    `);
    const made = await rows(db, sql`
      insert into mcp_clients (client_id, client_name, redirect_uris, kind)
      select ${clientId}, ${input.clientName}, ${uriArray(input.redirectUris)}, 'dcr'
       where (select count(*) from mcp_clients where kind = 'dcr' and created_at > now() - interval '30 days') < ${MAX_RECENT_CLIENTS}
      returning client_id
    `);
    return made.length > 0;
  });
  if (!r.persisted) return null;
  return r.data ? { clientId, clientName: input.clientName, redirectUris: input.redirectUris, kind: "dcr" } : "full";
}

/** A client named by its metadata document URL (CIMD), kept so its redirects are known next time. */
export async function rememberMetadataClient(client: McpClient): Promise<void> {
  await withDb(async (db) => {
    await db.execute(sql`
      insert into mcp_clients (client_id, client_name, redirect_uris, kind)
      values (${client.clientId}, ${client.clientName}, ${uriArray(client.redirectUris)}, 'cimd')
      on conflict (client_id) do update set client_name = excluded.client_name, redirect_uris = excluded.redirect_uris
    `);
    return true;
  });
}

export async function findClient(clientId: string): Promise<McpClient | null> {
  const r = await withDb(async (db) => (await rows(db, sql`select * from mcp_clients where client_id = ${clientId}`))[0] ?? null);
  return r.persisted && r.data ? toClient(r.data) : null;
}

/* ── Authorization codes ───────────────────────────────────────────────────── */

/** A single-use code for this admin, client, redirect and PKCE challenge; the code itself goes back once. */
export async function issueCode(input: {
  clientId: string;
  adminUser: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
}): Promise<string | null> {
  const code = newSecret("code");
  const r = await withDb(async (db) => {
    await db.execute(sql`
      insert into mcp_auth_codes (code_hash, client_id, admin_user, redirect_uri, code_challenge, scope, resource, expires_at)
      values (${hashSecret(code)}, ${input.clientId}, ${input.adminUser}, ${input.redirectUri}, ${input.codeChallenge},
              ${input.scope}, ${input.resource}, ${new Date(Date.now() + CODE_TTL_MS).toISOString()}::timestamptz)
    `);
    return true;
  });
  return r.persisted ? code : null;
}

export interface CodeGrant {
  clientId: string;
  adminUser: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
}

/**
 * Takes a code: unused, unexpired **and** presented by its own client, redirect and PKCE verifier —
 * all checked in the statement that marks it used, so it works once and a request without the
 * verifier cannot spend it (23 Nov, the security review: it used to be burnt before the checks, so
 * anyone who saw a code could cancel the admin's sign-in).
 *
 * A code that was already exchanged and is presented again is a stolen one (RFC 6749 §4.1.2): the pair
 * it bought and every pair rotated from it are revoked, and the answer is `null` like any refusal.
 */
export async function takeCode(input: { code: string; clientId: string; redirectUri: string | null; verifier: string }): Promise<(CodeGrant & { codeHash: string }) | null | "unavailable"> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier) || !input.redirectUri) return null;
  const codeHash = hashSecret(input.code);
  const challenge = createHash("sha256").update(input.verifier).digest("base64url");
  const r = await withDb(async (db) => {
    const out = await rows(db, sql`
      update mcp_auth_codes set used_at = now()
       where code_hash = ${codeHash} and used_at is null and expires_at > now()
         and client_id = ${input.clientId} and redirect_uri = ${input.redirectUri} and code_challenge = ${challenge}
      returning client_id, admin_user, redirect_uri, code_challenge, scope, resource
    `);
    if (out[0]) return out[0];
    /* Not taken. Was it exchanged before? Then whatever it bought is revoked. */
    const [spent] = await rows(db, sql`select token_id from mcp_auth_codes where code_hash = ${codeHash} and used_at is not null and token_id is not null`);
    if (spent) {
      await db.execute(sql`
        with recursive family(id) as (
          select ${String(spent.token_id)}::uuid
          union all
          select m.id from mcp_tokens m join family f on m.rotated_from = f.id
        )
        update mcp_tokens set revoked_at = now() where id in (select id from family) and revoked_at is null
      `);
      console.warn("[mcp:oauth] a used code came back — its tokens are revoked");
    }
    return null;
  });
  if (!r.persisted) return r.reason === "unconfigured" ? null : "unavailable";
  if (!r.data) return null;
  const row = r.data;
  return {
    codeHash,
    clientId: String(row.client_id),
    adminUser: String(row.admin_user),
    redirectUri: String(row.redirect_uri),
    codeChallenge: String(row.code_challenge),
    scope: String(row.scope),
    resource: row.resource ? String(row.resource) : null,
  };
}

/**
 * Still an admin who may sign in: the same set the admin login reads (the `admin_users` table, or the
 * env credentials before it has rows), so taking someone's admin access also ends their MCP tokens.
 */
async function isActiveAdmin(name: string): Promise<boolean | "unavailable"> {
  const set = await adminCredentials();
  /* The admin list could not be read (review, 20 Nov): "unavailable", a 503 — not "no", which would
     send every connected admin through sign-in again for a database blip. */
  if (set.mode === "unavailable") return "unavailable";
  return set.users.includes(name);
}

/* ── Tokens ─────────────────────────────────────────────────────────────────── */

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

/** The insert for a new access + refresh pair; `rotatedFrom` names the pair a refresh replaced. */
function insertPair(input: { adminUser: string; clientId: string; scope: string; rotatedFrom?: string | null }, accessToken: string, refreshToken: string) {
  return sql`
    insert into mcp_tokens (access_hash, refresh_hash, admin_user, client_id, scope, access_expires_at, refresh_expires_at, rotated_from)
    values (${hashSecret(accessToken)}, ${hashSecret(refreshToken)}, ${input.adminUser}, ${input.clientId}, ${input.scope},
            ${new Date(Date.now() + ACCESS_TTL_MS).toISOString()}::timestamptz,
            ${new Date(Date.now() + REFRESH_TTL_MS).toISOString()}::timestamptz,
            ${input.rotatedFrom ?? null})
    returning id
  `;
}

/** A new access + refresh pair, after a code; the code remembers the pair, so a replay of it can revoke it. */
export async function issueTokens(input: { adminUser: string; clientId: string; scope: string; codeHash?: string }): Promise<IssuedTokens | null> {
  const accessToken = newSecret("access");
  const refreshToken = newSecret("refresh");
  const r = await withDb(async (db) => {
    const [pair] = await rows(db, insertPair(input, accessToken, refreshToken));
    if (input.codeHash && pair) await db.execute(sql`update mcp_auth_codes set token_id = ${String(pair.id)}::uuid where code_hash = ${input.codeHash}`);
    return true;
  });
  return r.persisted ? { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), scope: input.scope } : null;
}

export type RefreshOutcome = { tokens: IssuedTokens } | { refused: "unknown" | "replayed" | "expired" | "not_admin" } | { unavailable: true };

/**
 * A refresh, in one transaction: the pair is locked, revoked and replaced together, so a refresh
 * token works once (rotation, OAuth 2.1 for public clients) and a failed write leaves the old pair
 * alive rather than signing the person out. A refresh token presented **again** after it was
 * rotated is a stolen or replayed one: every pair descended from it is revoked too, so whoever holds
 * the newer one loses it as well. A revoked admin, or one no longer active, gets nothing.
 *
 * 23 Nov, the security review: the 30-second grace for a second presentation is gone. It refused the
 * retry but kept the new pair alive — exactly what a thief racing the real client needs. Claude
 * refreshes once per connector; a lost answer now costs one sign-in, a theft costs the thief.
 */
export async function rotateRefresh(refreshToken: string, clientId: string): Promise<RefreshOutcome> {
  const accessToken = newSecret("access");
  const nextRefresh = newSecret("refresh");
  /* Whose token it is, and whether they may still sign in — read before the transaction (the database
     test, 20 Nov): checking inside it held the row lock across a second connection's read. */
  const owner = await withDb(async (db) => ((await db.execute(sql`select admin_user from mcp_tokens where refresh_hash = ${hashSecret(refreshToken)} and client_id = ${clientId}`)) as unknown as Row[])[0] ?? null);
  if (!owner.persisted) return { unavailable: true };
  if (!owner.data) return { refused: "unknown" };
  const active = await isActiveAdmin(String(owner.data.admin_user));
  if (active === "unavailable") return { unavailable: true };
  const r = await withDb((db) =>
    db.transaction(async (tx): Promise<RefreshOutcome> => {
      const [t] = (await tx.execute(sql`
        select id, admin_user, scope, revoked_at, refresh_expires_at > now() as live
          from mcp_tokens where refresh_hash = ${hashSecret(refreshToken)} and client_id = ${clientId}
           for update
      `)) as unknown as Row[];
      if (!t) return { refused: "unknown" };
      if (t.revoked_at) {
        await tx.execute(sql`
          with recursive family(id) as (
            select ${String(t.id)}::uuid
            union all
            select m.id from mcp_tokens m join family f on m.rotated_from = f.id
          )
          update mcp_tokens set revoked_at = now() where id in (select id from family) and revoked_at is null
        `);
        return { refused: "replayed" };
      }
      if (t.live !== true) return { refused: "expired" };
      const adminUser = String(t.admin_user);
      if (!active || adminUser !== String(owner.data.admin_user)) return { refused: "not_admin" };
      const scope = String(t.scope);
      await tx.execute(sql`update mcp_tokens set revoked_at = now() where id = ${String(t.id)}::uuid`);
      await tx.execute(insertPair({ adminUser, clientId, scope, rotatedFrom: String(t.id) }, accessToken, nextRefresh));
      return { tokens: { accessToken, refreshToken: nextRefresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), scope } };
    }),
  );
  return r.persisted ? r.data : { unavailable: true };
}

export interface TokenOwner {
  tokenId: string;
  adminUser: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

/**
 * Who an access token belongs to: unexpired, not revoked, and an admin who is still active.
 * `"unavailable"` when the database could not be read — a 503, not a 401 that would send the person
 * through sign-in again for nothing.
 */
export async function tokenOwner(accessToken: string): Promise<TokenOwner | null | "unavailable"> {
  const r = await withDb(async (db) => {
    /* The read is tried again once on a lost connection (24 Nov) — a dropped socket is not a reason to
       answer 503 to a token that is fine. */
    const out = await readWithRetry(() => rows(db, sql`
      select t.id, t.admin_user, t.client_id, t.scope, t.access_expires_at,
             (t.last_used_at is null or t.last_used_at < now() - interval '5 minutes') as stale_use
        from mcp_tokens t
       where t.access_hash = ${hashSecret(accessToken)} and t.revoked_at is null and t.access_expires_at > now()
    `));
    const row = out[0] ?? null;
    /* "Last used" to the nearest five minutes (20 Nov): a write on every call was a write per tool call
       on the database the SMS side shares, for a column read only by /admin/mcp. It is a note, not a
       check (24 Nov): when it fails the token still works, and the failure is logged as a class name. */
    if (row?.stale_use === true) {
      await db.execute(sql`update mcp_tokens set last_used_at = now() where id = ${String(row.id)}::uuid`).catch((err: unknown) => {
        console.error("[mcp] last used not kept", { error: err instanceof Error ? err.constructor.name : "unknown" });
      });
    }
    return row;
  });
  if (!r.persisted) return r.reason === "unconfigured" ? null : "unavailable";
  if (!r.data) return null;
  const active = await isActiveAdmin(String(r.data.admin_user));
  if (active === "unavailable") return "unavailable";
  if (!active) return null;
  return {
    tokenId: String(r.data.id),
    adminUser: String(r.data.admin_user),
    clientId: String(r.data.client_id),
    scopes: String(r.data.scope).split(" ").filter(Boolean),
    expiresAt: Math.floor(new Date(String(r.data.access_expires_at)).getTime() / 1000),
  };
}

/** Revokes a token by either of its secrets (RFC 7009): unknown is not an error. */
export async function revokeBySecret(secret: string): Promise<void> {
  const h = hashSecret(secret);
  await withDb(async (db) => {
    await db.execute(sql`update mcp_tokens set revoked_at = now() where revoked_at is null and (access_hash = ${h} or refresh_hash = ${h})`);
    return true;
  });
}

/* ── The switch ─────────────────────────────────────────────────────────────── */

/**
 * Pando MCP is on only when an admin switched it on (`app_settings.mcp_enabled`) **and** the server's
 * emergency override `PANDO_MCP` is not `off`. Unreadable is not on: a switch that cannot be read must
 * not leave the door open.
 *
 * ⚠ **But unreadable is not "off" either (24 Nov).** The developer: *"сервіс не виключений, а воно
 * часто пише, що він вимкнений"*. A database that did not answer came back as `false`, and every tool
 * then told Claude *"Pando MCP is switched off in the Pando admin"* — a false statement about a setting,
 * when the truth was a database that did not answer. Now `unknown` refuses just the same, and says so.
 *
 * A read is kept for `SWITCH_TTL_MS` so a run of tool calls does not spend a connection each on the
 * same row (the pool is shared with the SMS side); the admin's own change forgets it at once
 * (`forgetMcpSwitch`, called by the admin's `mcp.switch`). A failed read never uses an old value; a
 * read whose connection dropped is tried once more first (`readWithRetry`, 24 Nov).
 */
export type McpSwitch = "on" | "off" | "unknown";

const SWITCH_TTL_MS = 30_000;
let switchRead: { on: boolean; at: number } | null = null;

export function forgetMcpSwitch(): void {
  switchRead = null;
}

export async function mcpSwitch(now = Date.now()): Promise<McpSwitch> {
  if ((process.env.PANDO_MCP ?? "").trim().toLowerCase() === "off") return "off";
  if (switchRead && now - switchRead.at < SWITCH_TTL_MS) return switchRead.on ? "on" : "off";
  const r = await withDb(async (db) => (await readWithRetry(() => rows(db, sql`select value from app_settings where key = 'mcp_enabled'`)))[0] ?? null);
  if (!r.persisted) return "unknown";
  const on = r.data?.value === true;
  switchRead = { on, at: now };
  return on ? "on" : "off";
}

export async function mcpEnabled(): Promise<boolean> {
  return (await mcpSwitch()) === "on";
}

/* ── The call log ───────────────────────────────────────────────────────────── */

export type CallOutcome = "ok" | "error" | "refused" | "off";

/** One row per tool call: who, which tool, how it ended, how long, how many rows. Never the arguments. */
export async function logCall(input: { actor: string; clientId: string | null; tool: string; outcome: CallOutcome; ms: number; rows?: number | null }): Promise<void> {
  await withDb(async (db) => {
    await db.execute(sql`
      insert into mcp_calls (actor, client_id, tool, outcome, ms, rows)
      values (${input.actor}, ${input.clientId}, ${input.tool}, ${input.outcome}, ${Math.max(0, Math.round(input.ms))}, ${input.rows ?? null})
    `);
    return true;
  });
}

/* ── Keeping the tables small ─────────────────────────────────────────────────── */

/**
 * The `mcp_prune` job (20 Nov): codes a day after they expired, tokens 30 days after they were revoked
 * or ran out, registered clients nobody holds a token or code for after 30 days, and the call log after
 * 90 days. Proposals, the audit log and the settings are kept. Returns how many rows went; null when the
 * database could not be read (before 0070, nothing to do: 0).
 */
export async function pruneMcp(): Promise<number | null> {
  const r = await withDb(async (db) => {
    const [ready] = await rows(db, sql`select to_regclass('public.mcp_calls') is not null as ok`);
    if (ready?.ok !== true) return 0;
    const n = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as unknown[]).length;
    let gone = 0;
    gone += await n(sql`delete from mcp_auth_codes where expires_at < now() - interval '1 day' returning 1`);
    gone += await n(sql`delete from mcp_tokens where coalesce(revoked_at, refresh_expires_at) < now() - interval '30 days' returning 1`);
    gone += await n(sql`
      delete from mcp_clients c where c.created_at < now() - interval '30 days'
         and not exists (select 1 from mcp_tokens t where t.client_id = c.client_id)
         and not exists (select 1 from mcp_auth_codes a where a.client_id = c.client_id)
      returning 1
    `);
    gone += await n(sql`delete from mcp_calls where at < now() - interval '90 days' returning 1`);
    return gone;
  });
  return r.persisted ? r.data : null;
}
