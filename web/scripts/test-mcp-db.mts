// npm --prefix web run test:mcp-db — Pando MCP against a real Postgres (20 Nov). An in-memory PGlite
// on 127.0.0.1 (scripts/lib/pglite-server.mjs), every migration applied, then the real route handlers
// called as Claude calls them: registration, a code, tokens, refresh, every read tool with the
// arguments the plugin's skills use, a proposal applied in chat with its audit row, the switch, the
// 401 and a refused batch. It exists because several SQL faults (a column's type, a wrong enum value,
// a parameter Postgres could not type) were only ever caught by hand in the lab.
//
// Never reaches a real database: DATABASE_URL is set here to the in-memory one, and the test stops if
// anything else is in it.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { startDb } from "./lib/pglite-server.mjs";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : detail ? `  (${detail})` : ""}`);
};

const { url, stop } = await startDb();
if (!/^postgres:\/\/postgres@127\.0\.0\.1:\d+\/postgres/.test(url)) throw new Error("refusing: not the in-memory database");
const env = { ...process.env, DATABASE_URL: url, MIGRATE_DATABASE_URL: url };
/* Asynchronous: the database answers from this same process, so a blocking spawn would starve it. */
const migrated = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
  const child = spawn(process.execPath, ["scripts/migrate.mjs"], { env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  child.on("close", (status) => done({ status, stdout, stderr }));
});
const applied = /(\d+) migration\(s\) applied in total/.exec(migrated.stdout ?? "")?.[1];
ok("every migration applies to a fresh database", migrated.status === 0 && Number(applied) > 70, (migrated.stderr || migrated.stdout || "").slice(-300));

/* The app reads its database from here from now on; nothing else may be set. */
process.env.DATABASE_URL = url;
delete process.env.MIGRATE_DATABASE_URL;
process.env.PANDO_MCP = "";
process.env.MCP_BASE_URL = "http://localhost:3100";

/* A path in a variable: TypeScript checks the types, the loader resolves the file. */
const load = <T,>(file: string) => import(file) as Promise<T>;
const { sql } = await import("drizzle-orm");
const { getDb } = await load<typeof import("../lib/server/db.ts")>("../lib/server/db.ts");
const db = getDb()!;
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as Array<Record<string, unknown>>;

await q(sql`insert into admin_users (name, password_hash) values ('ci', ${"scrypt:16384:8:1:" + randomBytes(16).toString("base64url") + ":" + randomBytes(32).toString("base64url")})`);
await q(sql`insert into app_settings (key, value, updated_by) values ('mcp_enabled', 'true'::jsonb, 'ci')`);
const [share] = await q(sql`
  insert into shares (market_id, kind, name, status, provenance, neighborhoods, age_bands, last_confirmed_at, freshness_state)
  values ('pasadena', 'activity', 'CI Toddler Music', 'approved', 'admin_entered', '{east-pasadena}', '{toddler}', now(), 'fresh')
  returning id
`);

const repo = await load<typeof import("../lib/server/repo/mcp.ts")>("../lib/server/repo/mcp.ts");
const register = await load<typeof import("../app/api/oauth/register/route.ts")>("../app/api/oauth/register/route.ts");
const token = await load<typeof import("../app/api/oauth/token/route.ts")>("../app/api/oauth/token/route.ts");
const mcpRoute = await load<typeof import("../app/api/mcp/route.ts")>("../app/api/mcp/route.ts");
const resource = await load<typeof import("../app/api/oauth/resource/route.ts")>("../app/api/oauth/resource/route.ts");
const A = "http://localhost:3100";

console.log("\n=== OAuth through the real routes ===");
const prm = await (await resource.GET(new Request(`${A}/.well-known/oauth-protected-resource`))).json();
ok("discovery names this MCP endpoint", prm.resource === `${A}/api/mcp`);
const reg = await register.POST(new Request(`${A}/api/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "ci", redirect_uris: ["http://localhost/callback"] }) }));
const client = await reg.json();
ok("a client registers (DCR)", reg.status === 201 && typeof client.client_id === "string");
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const code = await repo.issueCode({ clientId: client.client_id, adminUser: "ci", redirectUri: "http://localhost:4999/callback", codeChallenge: challenge, scope: "pando:read pando:propose", resource: `${A}/api/mcp` });
const form = (f: Record<string, string>) => new Request(`${A}/api/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(f) });
const t1 = await (await token.POST(form({ grant_type: "authorization_code", code: code!, code_verifier: verifier, client_id: client.client_id, redirect_uri: "http://localhost:4999/callback" }))).json();
ok("the code becomes tokens", typeof t1.access_token === "string" && typeof t1.refresh_token === "string", JSON.stringify(t1).slice(0, 120));
const t2 = await (await token.POST(form({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: client.client_id }))).json();
ok("a refresh rotates the pair", typeof t2.access_token === "string" && t2.access_token !== t1.access_token);
const reuse = await token.POST(form({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: client.client_id }));
ok("the old refresh token is refused", reuse.status === 400);
/* 23 Nov, the security review: no grace — a second use at once revokes the pair it was rotated into. */
const [liveAfterReplay] = await q(sql`select count(*) as n from mcp_tokens where admin_user = 'ci' and revoked_at is null`);
ok("and its replay, even at once, revokes the pair it was rotated into", Number(liveAfterReplay.n) === 0);

const exchange = (c: string, v: string) => token.POST(form({ grant_type: "authorization_code", code: c, code_verifier: v, client_id: client.client_id, redirect_uri: "http://localhost:4999/callback" }));
const newCode = async () => {
  const v = randomBytes(32).toString("base64url");
  const c = await repo.issueCode({ clientId: client.client_id, adminUser: "ci", redirectUri: "http://localhost:4999/callback", codeChallenge: createHash("sha256").update(v).digest("base64url"), scope: "pando:read pando:propose", resource: `${A}/api/mcp` });
  return { c: c!, v };
};
const second = await newCode();
const t3 = await (await exchange(second.c, second.v)).json();
const replayCode = await exchange(second.c, second.v);
const [t3Row] = await q(sql`select revoked_at from mcp_tokens where admin_user = 'ci' order by created_at desc limit 1`);
ok("a code exchanged twice is refused, and the tokens it bought are revoked", typeof t3.access_token === "string" && replayCode.status === 400 && t3Row?.revoked_at !== null);
const third = await newCode();
const wrong = await exchange(third.c, randomBytes(32).toString("base64url"));
const t4res = await exchange(third.c, third.v);
const t4 = await t4res.json();
ok("a wrong verifier does not spend the code: its owner can still exchange it", wrong.status === 400 && t4res.status === 200 && typeof t4.access_token === "string");

let id = 0;
const post = (body: unknown, auth = t4.access_token) =>
  mcpRoute.POST(new Request(`${A}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const j = (await (await post({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } })).json()) as { result?: { isError?: boolean; content?: Array<{ text: string }> }; error?: { message: string } };
  return { error: j.error?.message ?? (j.result?.isError ? j.result.content?.[0]?.text : null), text: j.result?.content?.[0]?.text ?? "" };
};

console.log("\n=== the MCP endpoint ===");
ok("no token: 401 with the pointer Claude reads", (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "")).status === 401);
ok("a batch is refused", (await post([{ jsonrpc: "2.0", id: 1, method: "tools/list" }])).status === 400);
const list = (await (await post({ jsonrpc: "2.0", id: ++id, method: "tools/list" })).json()) as { result: { tools: Array<{ name: string; annotations?: Record<string, unknown> }> } };
const tools = list.result.tools;
ok("24 tools, each with a title and read/destructive hints", tools.length === 24 && tools.every((t) => typeof t.annotations?.title === "string" && typeof t.annotations?.readOnlyHint === "boolean"), String(tools.length));
ok("no tool decides a proposal or commits a skill", !tools.some((t) => ["approve_proposal", "reject_proposal", "save_skill"].includes(t.name)));
ok("a token not shaped like Pando's is a 401 without a lookup", (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "not-a-pando-token")).status === 401);

const today = new Date().toISOString().slice(0, 10);
const reads: Array<[string, Record<string, unknown>]> = [
  ["pando_overview", {}], ["parents_totals", { weeks: 9 }], ["questions_totals", { weeks: 9 }], ["records_totals", {}],
  ["demand_by_place", {}], ["delivery_health", { days: 7 }], ["impact_totals", {}], ["digest_weeks", {}],
  ["digest_weeks", { week: "2026-11-14" }], ["daily_activity", { days: 8 }], ["unanswered_questions", { days: 30, limit: 10 }],
  ["what_went_wrong", { days: 7 }], ["search_records", { query: "toddler", age_band: "toddler", limit: 5 }],
  ["get_record", { id: share.id }], ["list_proposals", { status: "all" }], ["digest_candidates", {}], ["list_sources", {}],
  ["search_records", { status: "any", source_check: "never", not_checked_since: "2026-01-01" }], ["impact_totals", { from: "2026-01-01", to: today }],
  ["costs_summary", { from: `${today.slice(0, 8)}01`, to: today }],
];
for (const [name, args] of reads) {
  const r = await call(name, args);
  const plain = name === "digest_weeks" && args.week ? r.error === "No digest for that Saturday." : r.error === null;
  ok(`${name} ${JSON.stringify(args)} runs against Postgres`, plain, r.error ?? "");
}
const search = JSON.parse((await call("search_records", { query: "toddler" })).text);
ok("search finds the record by its words, with has_more", search.results?.[0]?.name === "CI Toddler Music" && search.has_more === false);
ok("and gives its trust labels verbatim: an admin's record is public information", search.results?.[0]?.public_only === true && Array.isArray(search.results?.[0]?.trust_labels) && search.results[0].trust_labels.length > 0);

console.log("\n=== a proposal, applied on /admin/proposals ===");
const admin = await load<typeof import("../lib/server/repo/admin-write.ts")>("../lib/server/repo/admin-write.ts");
const decide = (action: "proposal.approve" | "proposal.reject", body: Record<string, unknown>) => admin.applyAction(db, { actor: "ci", action, body });
const proposed = JSON.parse((await call("propose_record_edit", { id: share.id, change: "facts", venue: "Pasadena Music Hall", age_bands: ["toddler", "preschool"], source_url: "https://example.org/ci" })).text);
ok("an agent proposes a fact correction", typeof proposed.proposal_id === "string");
const [before] = await q(sql`select before from mcp_proposals where id = ${proposed.proposal_id}::uuid`);
ok("the proposal keeps the record as the agent saw it", (before?.before as { venue?: unknown } | null)?.venue === null);
const approved = await decide("proposal.approve", { id: proposed.proposal_id, via: "chat" });
const [via] = await q(sql`select decided_via from mcp_proposals where id = ${proposed.proposal_id}::uuid`);
ok("an admin's Apply applies it, recorded as decided here whatever the request says", approved.applied === true && via?.decided_via === "admin");
const [rec] = await q(sql`select venue, age_bands from shares where id = ${share.id}::uuid`);
ok("the record changed", rec.venue === "Pasadena Music Hall" && JSON.stringify(rec.age_bands) === '["toddler","preschool"]');
const [audit] = await q(sql`select actor, before from audit_log where action = 'proposal.approve' order by at desc limit 1`);
ok("an audit row names the admin and keeps what was there", audit?.actor === "ci" && audit?.before !== null);
const event = JSON.parse((await call("propose_event", { kind: "event", title: "CI Winter Walk", when_text: "Sat Dec 26, 10am", starts_on: "2099-12-26", place: "Pasadena", summary: "A walk for families in the park.", url: "https://example.org/ci-walk" })).text);
await decide("proposal.approve", { id: event.proposal_id });
const candidates = JSON.parse((await call("digest_candidates")).text);
ok("an approved event becomes a digest candidate", candidates.results?.some((c: { title: string }) => c.title === "CI Winter Walk"));
const rejected = JSON.parse((await call("propose_record_edit", { id: share.id, change: "rename", name: "CI Music" })).text);
await decide("proposal.reject", { id: rejected.proposal_id, reason: "the page uses the long name" });
const decided = JSON.parse((await call("list_proposals", { status: "rejected" })).text);
ok("a rejection keeps its reason for the agent", decided.results?.[0]?.reason === "the page uses the long name");
const skill = await call("propose_skill", { name: "ci-skill", description: "A skill the CI run proposes, to see it wait.", instructions: "Read the numbers and say what changed since last week, in three lines." });
ok("a skill without a plugin repo configured is refused, not saved", /not configured/.test(skill.error ?? ""));

console.log("\n=== sources & partners ===");
const src = JSON.parse((await call("propose_source", { role: "partner", kind: "school", name: "CI Elementary", url: "https://example.org/ci-school", area: "pasadena" })).text);
ok("an agent proposes a partner", typeof src.proposal_id === "string");
ok("a partner's note with a phone is refused", /phone or email/.test((await call("propose_source", { role: "partner", kind: "pta", name: "CI PTA", note: "call 626-555-0101" })).error ?? ""));
const srcApplied = await decide("proposal.approve", { id: src.proposal_id });
const listed = JSON.parse((await call("list_sources", { role: "partner" })).text);
const entry = listed.results?.find((s: { name: string }) => s.name === "CI Elementary");
ok("approved, it is on the list", srcApplied.applied === true && !!entry);
const checked = await call("record_source_check", { source_id: entry?.id, result: "failed" });
const [chk] = await q(sql`select last_check, last_checked_at from pando_sources where name = 'CI Elementary'`);
ok("a source check writes only its time and result", checked.error === null && chk?.last_check === "failed" && chk?.last_checked_at !== null);
ok("the same name again is refused as already listed", /already on the list/.test((await call("propose_source", { role: "partner", kind: "school", name: "ci elementary" })).error ?? ""));

console.log("\n=== the switch ===");
await q(sql`update app_settings set value = 'false'::jsonb where key = 'mcp_enabled'`);
const off = await call("records_totals");
ok("switched off, a tool says so", off.error === "Pando MCP is switched off in the Pando admin.");
const [logged] = await q(sql`select count(*) as n from mcp_calls where outcome = 'off'`);
ok("and the call is logged as off", Number(logged.n) === 1);

console.log("\n=== keeping it small, and watching it ===");
const [used1] = await q(sql`select last_used_at from mcp_tokens where admin_user = 'ci' and revoked_at is null order by created_at desc limit 1`);
await q(sql`update app_settings set value = 'true'::jsonb where key = 'mcp_enabled'`);
await call("impact_totals");
const [used2] = await q(sql`select last_used_at from mcp_tokens where admin_user = 'ci' and revoked_at is null order by created_at desc limit 1`);
ok("a token's last use is written at most every five minutes, not on every call", used1?.last_used_at !== null && String(used1?.last_used_at) === String(used2?.last_used_at));
await q(sql`insert into mcp_auth_codes (code_hash, client_id, admin_user, redirect_uri, code_challenge, scope, expires_at) values ('old-code', 'old', 'ci', 'http://localhost/cb', 'x', 'pando:read', now() - interval '3 days')`);
await q(sql`insert into mcp_tokens (access_hash, refresh_hash, admin_user, client_id, scope, access_expires_at, refresh_expires_at, revoked_at) values ('old-a', 'old-r', 'ci', 'old', 'pando:read', now() - interval '40 days', now() - interval '35 days', now() - interval '35 days')`);
await q(sql`insert into mcp_calls (at, actor, client_id, tool, outcome, ms) values (now() - interval '100 days', 'ci', 'old', 'records_totals', 'ok', 1)`);
const mcp = await load<typeof import("../lib/server/repo/mcp.ts")>("../lib/server/repo/mcp.ts");
const pruned = await mcp.pruneMcp();
const [left] = await q(sql`select (select count(*) from mcp_auth_codes where code_hash = 'old-code') + (select count(*) from mcp_tokens where access_hash = 'old-a') + (select count(*) from mcp_calls where at < now() - interval '90 days') as n, (select count(*) from mcp_tokens where admin_user = 'ci' and revoked_at is null) as live`);
ok("the nightly cleanup removes old codes, tokens and calls and keeps the live ones", (pruned ?? 0) >= 3 && Number(left.n) === 0 && Number(left.live) >= 1, `pruned ${pruned}, left ${left.n}, live ${left.live}`);
for (let k = 0; k < 5; k++) await q(sql`insert into mcp_calls (actor, client_id, tool, outcome, ms) values ('ci', ${client.client_id}, 'records_totals', 'error', 3)`);
const alertsSrv = await load<typeof import("../lib/server/alerts.ts")>("../lib/server/alerts.ts");
const alertsLib = await load<typeof import("../lib/alerts.ts")>("../lib/alerts.ts");
const facts = await alertsSrv.alertFacts(db, new Date());
ok("five tool failures in 30 minutes make a Slack alert for QuitCode", alertsLib.criticalAlerts(facts, "d").some((a) => a.key.startsWith("mcp_errors") && a.owner === "QuitCode"), JSON.stringify(facts.mcp));

await stop();
console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
process.exit(fail ? 1 : 0);
