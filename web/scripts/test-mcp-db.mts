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
const { getDb, isTransientDbError, readWithRetry } = await load<typeof import("../lib/server/db.ts")>("../lib/server/db.ts");
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
/* 23 Nov: the route has no stream to open, and a client that re-opened it every second used up the minute's
   and the day's limits, so its next sign-in got a 429. A GET is 405, not counted. */
const gets: Response[] = [];
for (let i = 0; i < 130; i++) gets.push(await mcpRoute.GET(new Request(`${A}/api/mcp`, { headers: { accept: "text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${t4.access_token}` } })));
ok("a GET is 405 and uncounted: 130 of them leave the 120-a-minute budget whole", gets.every((r) => r.status === 405 && r.headers.get("allow") === "POST, DELETE") && (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status === 200);
const list = (await (await post({ jsonrpc: "2.0", id: ++id, method: "tools/list" })).json()) as { result: { tools: Array<{ name: string; annotations?: Record<string, unknown> }> } };
const tools = list.result.tools;
ok("27 tools, each with a title and read/destructive hints", tools.length === 27 && tools.every((t) => typeof t.annotations?.title === "string" && typeof t.annotations?.readOnlyHint === "boolean"), String(tools.length));
/* 24 Nov: a proposal is decided in the chat, so Claude must ask the person before each such call. */
ok("approve_proposal and reject_proposal exist, destructive and not read-only; nothing commits a skill",
  ["approve_proposal", "reject_proposal"].every((n) => tools.some((t) => t.name === n && t.annotations?.destructiveHint === true && t.annotations?.readOnlyHint === false)) &&
    !tools.some((t) => t.name === "save_skill"));
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
/* 23 Nov: delivery_health counted on a second connection of its own and turned any error into
   "configured: false". On the tool's own connection it answers here, on one session, as configured. */
const dh = JSON.parse((await call("delivery_health", { days: 7 })).text) as { configured: boolean; settled: number };
ok("delivery_health counts on the tool's own connection: configured, never \"not configured\" after a timeout", dh.configured === true && typeof dh.settled === "number", JSON.stringify(dh).slice(0, 80));
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
/* 23 Nov, the lab walk: a sub-category Pando does not have was taken, and failed only on Apply as a 502. */
const storytime = { kind: "activity", name: "CI Toddler Storytime", areas: ["altadena"], age_bands: ["toddler"], source_url: "https://example.org/ci-storytime" };
ok("a sub-category Pando does not have is refused when proposed", /expected one of|subcategory/i.test((await call("propose_new_record", { ...storytime, subcategory: "storytime" })).error ?? ""));
ok("and one of another kind's", /activity's subcategory is one of activities, classes, camps/.test((await call("propose_new_record", { ...storytime, subcategory: "restaurants" })).error ?? ""));
const [legacy] = await q(sql`insert into mcp_proposals (actor, kind, payload, source_url) values ('ci', 'new_record', ${JSON.stringify({ ...storytime, subcategory: "storytime" })}::jsonb, ${storytime.source_url}) returning id`);
const legacyApply = await decide("proposal.approve", { id: legacy.id });
ok("an older proposal with one is refused on Apply as invalid, not a database error", legacyApply.applied === false && (legacyApply as { reason?: string }).reason === "proposal_invalid");
await decide("proposal.reject", { id: legacy.id, reason: "propose again with classes" });
const asCamps = JSON.parse((await call("propose_new_record", { ...storytime, subcategory: "camps" })).text);
await decide("proposal.reject", { id: asCamps.proposal_id, reason: "it is a class, not a camp" });
ok("the same proposal again is still refused after a rejection", /rejected lately/.test((await call("propose_new_record", { ...storytime, subcategory: "camps" })).error ?? ""));
const corrected = await call("propose_new_record", { ...storytime, subcategory: "classes" });
ok("a corrected one gets through, and applies", corrected.error === null && (await decide("proposal.approve", { id: JSON.parse(corrected.text).proposal_id })).applied === true, corrected.error ?? "");
const skill = await call("propose_plugin_change", { target: "skill", action: "create", name: "ci-skill", description: "A skill the CI run proposes, to see it wait.", instructions: "Read the numbers and say what changed since last week, in three lines." });
ok("a plugin change without a plugin repo configured is refused, not saved", /not configured/.test(skill.error ?? ""));

console.log("\n=== a proposal, decided in the chat (24 Nov) ===");
const park = { kind: "place", name: "CI Chat Park", areas: ["pasadena"], source_url: "https://example.org/ci-chat-park" };
const parkProposed = JSON.parse((await call("propose_new_record", park)).text);
const yes = await call("approve_proposal", { id: parkProposed.proposal_id });
const [parkRow] = await q(sql`select decided_via, decided_by, status from mcp_proposals where id = ${parkProposed.proposal_id}::uuid`);
ok("approve_proposal applies it, recorded as decided in chat by the signed-in admin",
  yes.error === null && JSON.parse(yes.text).status === "applied" && parkRow?.decided_via === "chat" && parkRow?.status === "applied" && parkRow?.decided_by === "ci", yes.error ?? "");
ok("the record is there, as an admin's Apply would have made it", JSON.parse((await call("search_records", { query: "CI Chat Park", status: "any" })).text).results?.some((r: { name: string }) => r.name === "CI Chat Park"));
const [chatAudit] = await q(sql`select actor, after from audit_log where action = 'proposal.approve' and resource_id = ${parkProposed.proposal_id} order by at desc limit 1`);
ok("its audit row says it was the chat", chatAudit?.actor === "ci" && (chatAudit?.after as { via?: string } | null)?.via === "chat");
ok("the same yes twice applies nothing twice", /already decided/.test((await call("approve_proposal", { id: parkProposed.proposal_id })).error ?? ""));
const noProposal = JSON.parse((await call("propose_record_edit", { id: share.id, change: "rename", name: "CI Chat Rename" })).text);
const no = await call("reject_proposal", { id: noProposal.proposal_id, reason: "keep the name it has" });
const [noRow] = await q(sql`select decided_via, status, decision_note from mcp_proposals where id = ${noProposal.proposal_id}::uuid`);
ok("reject_proposal closes it with the person's reason, in chat", no.error === null && noRow?.status === "rejected" && noRow?.decided_via === "chat" && noRow?.decision_note === "keep the name it has", no.error ?? "");
/* A change to the plugin itself stays on /admin/proposals. Inserted directly: this run has no plugin repo. */
const [pluginRow] = await q(sql`insert into mcp_proposals (actor, kind, payload) values ('ci', 'plugin', ${JSON.stringify({ target: "skill", action: "create", name: "ci-chat-skill" })}::jsonb) returning id`);
const pluginYes = await call("approve_proposal", { id: pluginRow.id });
const pluginNo = await call("reject_proposal", { id: pluginRow.id });
const [pluginAfter] = await q(sql`select status from mcp_proposals where id = ${pluginRow.id}::uuid`);
ok("a change to the plugin is neither approved nor rejected from the chat, and still waits for the page",
  /only on pando\.is\/admin\/proposals/.test(pluginYes.error ?? "") && /only on pando\.is\/admin\/proposals/.test(pluginNo.error ?? "") && pluginAfter?.status === "proposed");
const adminCannotBeChat = await decide("proposal.reject", { id: pluginRow.id, via: "chat", reason: "ci" });
const [pluginDecided] = await q(sql`select status, decided_via from mcp_proposals where id = ${pluginRow.id}::uuid`);
ok("the page still decides it, and a request saying via chat is recorded as the page", adminCannotBeChat.applied === true && pluginDecided?.status === "rejected" && pluginDecided?.decided_via === "admin");
const roToken = "pma_" + randomBytes(32).toString("base64url");
const tokenHash = (s: string) => createHash("sha256").update(s).digest("base64url");
await q(sql`insert into mcp_tokens (access_hash, refresh_hash, admin_user, client_id, scope, access_expires_at, refresh_expires_at)
            values (${tokenHash(roToken)}, ${tokenHash("pmr_" + randomBytes(32).toString("base64url"))}, 'ci', 'ci-read-only', 'pando:read', now() + interval '10 minutes', now() + interval '10 minutes')`);
const roProposal = JSON.parse((await call("propose_record_edit", { id: share.id, change: "rename", name: "CI Read Only" })).text);
const roYes = (await (await post({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: "approve_proposal", arguments: { id: roProposal.proposal_id } } }, roToken)).json()) as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
ok("a read-only connection cannot decide", roYes.result?.isError === true && /may only read/.test(roYes.result?.content?.[0]?.text ?? ""));
await decide("proposal.reject", { id: roProposal.proposal_id, reason: "ci" });

console.log("\n=== the plugin, changed by the client (a GitHub stand-in on 127.0.0.1) ===");
/* Just enough of GitHub's git data API for plugin-repo.ts: a branch, commits as snapshots, trees,
   contents, and a ref that moves only forward. Nothing leaves this process. */
const { createServer } = await import("node:http");
const blobSha = (t: string) => createHash("sha1").update(`blob ${Buffer.byteLength(t)}\0${t}`).digest("hex");
const snapshots = new Map<string, Map<string, string>>();
const hexId = (k: string) => createHash("sha1").update(k).digest("hex");
let headSha = hexId("c0");
snapshots.set(headSha, new Map([
  [".claude-plugin/plugin.json", `${JSON.stringify({ name: "pando", version: "0.5.0" }, null, 2)}\n`],
  [".mcp.json", `${JSON.stringify({ mcpServers: { pando: { type: "http", url: "https://pando.is/api/mcp" }, supabase: { type: "http", url: "https://mcp.supabase.com/mcp?project_ref=ci&read_only=true" } } }, null, 2)}\n`],
  ["skills/pando-data/SKILL.md", "---\nname: pando-data\ndescription: \"The catalogue of Pando's tools.\"\n---\n\nThe catalogue.\n"],
  ["skills/old-brief/SKILL.md", "---\nname: old-brief\ndescription: \"An old brief nobody uses any more.\"\n---\n\nOld.\n"],
  ["skills/old-brief/references/notes.md", "notes\n"],
  ["agents/agent-builder.md", "---\nname: agent-builder\ndescription: \"Drafts skills.\"\ntools: Read\nmodel: sonnet\n---\n\nBuild.\n"],
]));
const trees = new Map<string, Map<string, string>>();
let n = 0;
const gh = createServer(async (req, res) => {
  const body = await new Promise<string>((done) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => done(b)); });
  const u = new URL(req.url ?? "/", "http://x");
  const p = u.pathname.replace(/^\/repos\/o\/r/, "");
  const send = (status: number, j: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
  if (req.method === "GET" && p === "/git/ref/heads/main") return send(200, { object: { sha: headSha } });
  if (req.method === "GET" && p.startsWith("/git/commits/")) return snapshots.has(p.slice(13)) ? send(200, { tree: { sha: `tree-${p.slice(13)}` } }) : send(404, {});
  if (req.method === "GET" && p.startsWith("/git/trees/tree-")) {
    const snap = snapshots.get(p.slice(16));
    return snap ? send(200, { tree: [...snap.entries()].map(([path, t]) => ({ path, type: "blob", sha: blobSha(t) })) }) : send(404, {});
  }
  if (req.method === "GET" && p.startsWith("/contents/")) {
    const t = snapshots.get(u.searchParams.get("ref") ?? "")?.get(decodeURIComponent(p.slice(10)));
    return t === undefined ? send(404, {}) : send(200, { content: Buffer.from(t).toString("base64"), sha: blobSha(t) });
  }
  if (req.method === "POST" && p === "/git/trees") {
    const j = JSON.parse(body) as { base_tree: string; tree: Array<{ path: string; content?: string; sha?: null }> };
    const next = new Map(snapshots.get(j.base_tree.replace(/^tree-/, "")) ?? []);
    for (const e of j.tree) if (e.sha === null) next.delete(e.path); else next.set(e.path, e.content ?? "");
    const id = `t${++n}`;
    trees.set(id, next);
    return send(201, { sha: id });
  }
  if (req.method === "POST" && p === "/git/commits") {
    const j = JSON.parse(body) as { tree: string; parents: string[] };
    const id = hexId(`c${++n}`);
    snapshots.set(id, trees.get(j.tree) ?? new Map());
    return send(201, { sha: id });
  }
  if (req.method === "PATCH" && p === "/git/refs/heads/main") {
    const j = JSON.parse(body) as { sha: string };
    headSha = j.sha;
    return send(200, { object: { sha: headSha } });
  }
  send(404, {});
});
await new Promise<void>((r) => gh.listen(0, "127.0.0.1", () => r()));
process.env.PLUGIN_GITHUB_TOKEN = "ci-token";
process.env.PLUGIN_GITHUB_REPO = "o/r";
process.env.GITHUB_API_BASE = `http://127.0.0.1:${(gh.address() as { port: number }).port}`;
const repoNow = () => snapshots.get(headSha)!;
const pluginRepo = await load<typeof import("../lib/server/mcp/plugin-repo.ts")>("../lib/server/mcp/plugin-repo.ts");
/* What /api/admin/action does on *Commit to plugin*: commit first, then mark the proposal applied. */
const commitProposal = async (proposalId: string) => {
  const [row] = await q(sql`select payload from mcp_proposals where id = ${proposalId}::uuid`);
  const pl = row.payload as { draft: import("../lib/server/mcp/plugin-repo.ts").PluginDraft; base_sha: string | null; after_text: string | null };
  const saved = await pluginRepo.commitPluginChange("ci", pl);
  if ("refused" in saved) return saved;
  return { ...saved, applied: (await decide("proposal.approve", { id: proposalId, commit: saved.commit, version: saved.version })).applied };
};
type Proposed = { proposal_id?: string; warnings?: string[]; error?: string };
const propose = async (a: Record<string, unknown>): Promise<Proposed> => {
  const r = await call("propose_plugin_change", a);
  return r.error ? { error: r.error } : (JSON.parse(r.text) as Proposed);
};

const index = JSON.parse((await call("read_plugin", {})).text);
ok("read_plugin lists the plugin: skills, agents, connectors, and what may be removed",
  index.version === "0.5.0" && index.skills?.some((s: { name: string; may_remove: boolean }) => s.name === "pando-data" && !s.may_remove) &&
    index.connectors?.[0]?.name === "pando" && index.agents?.[0]?.name === "agent-builder", JSON.stringify(index).slice(0, 200));
ok("and says the read-only supabase connector may be removed but not changed",
  index.connectors?.some((c: { name: string; may_change: boolean; may_remove: boolean; read_only?: boolean }) => c.name === "supabase" && !c.may_change && c.may_remove && c.read_only === true) &&
    index.connectors?.some((c: { name: string; may_change: boolean; may_remove: boolean }) => c.name === "pando" && !c.may_change && !c.may_remove), JSON.stringify(index.connectors));
ok("and reads one agent's file to start an edit from", /name: agent-builder/.test(JSON.parse((await call("read_plugin", { target: "agent", name: "agent-builder" })).text).text ?? ""));

const agentArgs = { target: "agent", action: "create", name: "ci-newsletter", description: "Drafts the school newsletter blurb from Pando's approved records. Use for newsletters.", instructions: "Read approved records with search_records and write three short lines for a school newsletter.", tools: ["Read", "search_records"] };
ok("an agent with Bash is refused", /never given to a Pando agent/.test(String((await propose({ ...agentArgs, tools: ["Bash"] })).error ?? "")));
ok("an agent with a tool Pando does not have is refused", /Pando has no tool/.test(String((await propose({ ...agentArgs, tools: ["save_skill"] })).error ?? "")));
/* The long name is read for the tool's own name, whatever connection it names (24 Nov) — so a decision cannot slip in under one. */
ok("an agent is never given a deciding tool, under any name", /approve_proposal is never given to an agent/.test(String((await propose({ ...agentArgs, tools: ["approve_proposal"] })).error ?? "")) &&
  /reject_proposal is never given to an agent/.test(String((await propose({ ...agentArgs, tools: ["mcp__claude_ai_Pando__reject_proposal"] })).error ?? "")) &&
  /approve_proposal is never given to an agent/.test(String((await propose({ ...agentArgs, tools: ["mcp__plugin_pando_pando__approve_proposal"] })).error ?? "")));
ok("a connector's tool that shares a Pando tool's name is refused: the list holds tools by name",
  /has the name of a Pando tool/.test(String((await propose({ ...agentArgs, tools: ["supabase:search_records"] })).error ?? "")));
ok("an agent told to approve is refused", /approves, rejects or saves/.test(String((await propose({ ...agentArgs, instructions: "Read everything, then call approve_proposal for each proposal you like." })).error ?? "")));
const newAgent = await propose(agentArgs);
ok("a new agent is proposed, and nothing is committed yet", !!newAgent.proposal_id && !repoNow().has("agents/ci-newsletter.md"));
const committed = newAgent.proposal_id ? await commitProposal(newAgent.proposal_id) : { refused: "not proposed" };
const agentFile = repoNow().get("agents/ci-newsletter.md") ?? "";
ok("Commit to plugin commits it with Pando's frontmatter and the version raised, and marks the proposal applied",
  "applied" in committed && committed.applied === true && /^---\nname: ci-newsletter\ndescription: ".+"\ndisallowedTools: Bash, Write, Edit, NotebookEdit\npando-tools: Read, search_records\nmodel: sonnet\n---\n/.test(agentFile) &&
    !/^tools:/m.test(agentFile) && !/mcp__/.test(agentFile) &&
    JSON.parse(repoNow().get(".claude-plugin/plugin.json") ?? "{}").version === "0.5.1", JSON.stringify(committed));
const [pluginAudit] = await q(sql`select after from audit_log where action = 'plugin.commit' order by at desc limit 1`);
ok("and the commit is in the audit log", (pluginAudit?.after as { name?: string } | null)?.name === "ci-newsletter");

const mail = await propose({ ...agentArgs, name: "ci-replies", tools: ["propose_source"], account_connectors: true });
const [mailRow] = await q(sql`select payload from mcp_proposals where id = ${mail.proposal_id ?? "00000000-0000-0000-0000-000000000000"}::uuid`);
const mailFile = String((mailRow?.payload as { after_text?: string } | undefined)?.after_text ?? "");
const mailList = /^pando-tools: (.*)$/m.exec(mailFile)?.[1]?.split(", ") ?? [];
ok("an agent that reads connected accounts: every read tool and Pando read, the one change it names, never another — and the accounts",
  /^disallowedTools: Bash, Write, Edit, NotebookEdit$/m.test(mailFile) && /^pando-accounts: true$/m.test(mailFile) &&
    ["Read", "WebFetch", "search_records", "list_sources", "propose_source"].every((t) => mailList.includes(t)) &&
    !mailList.some((t) => ["propose_record_edit", "propose_event", "approve_proposal", "reject_proposal"].includes(t)) &&
    (mail.warnings ?? []).some((w) => /every account connected/.test(w)), mailFile.slice(0, 400));

const edit = await propose({ target: "skill", action: "update", name: "pando-data", description: "The catalogue of Pando's tools, with the new ones.", instructions: "The catalogue, updated with read_plugin and propose_plugin_change." });
ok("a skill QuitCode made can be changed", !!edit.proposal_id);
ok("a second change to the same file waits for the first", /already waiting/.test(String((await propose({ target: "skill", action: "update", name: "pando-data", description: "Another change to the catalogue, made too soon.", instructions: "Another version of the catalogue's instructions." })).error ?? "")));
const live = repoNow();
live.set("skills/pando-data/SKILL.md", `${live.get("skills/pando-data/SKILL.md")}Edited by hand.\n`);
const stale = edit.proposal_id ? await commitProposal(edit.proposal_id) : { refused: "" };
const [staleRow] = await q(sql`select status from mcp_proposals where id = ${edit.proposal_id ?? "00000000-0000-0000-0000-000000000000"}::uuid`);
ok("a file changed since the proposal is not overwritten: refused, and the proposal still waits", "refused" in stale && /changed after this was proposed/.test(stale.refused) && staleRow?.status === "proposed");

ok("a connector over http is refused", /https only/.test(String((await propose({ target: "connector", action: "create", name: "notion", url: "http://mcp.notion.com/mcp" })).error ?? "")));
ok("a connector with a key in its address is refused", /No sign-in, key or query/.test(String((await propose({ target: "connector", action: "create", name: "notion", url: "https://mcp.notion.com/mcp?key=abc" })).error ?? "")));
ok("a connector on a local machine is refused", /public service/.test(String((await propose({ target: "connector", action: "create", name: "lab", url: "https://127.0.0.1/mcp" })).error ?? "")));
ok("the pando connector cannot be removed", /cannot be removed/.test(String((await propose({ target: "connector", action: "delete", name: "pando" })).error ?? "")));
const conn = await propose({ target: "connector", action: "create", name: "notion", url: "https://mcp.notion.com/mcp" });
const connDone = conn.proposal_id ? await commitProposal(conn.proposal_id) : { refused: "" };
const servers = JSON.parse(repoNow().get(".mcp.json") ?? "{}").mcpServers ?? {};
ok("a connector is added as a remote https server, last, the others untouched and in place", "committed" in connDone && Object.keys(servers).join(",") === "pando,supabase,notion" && servers.notion?.type === "http" && servers.notion?.url === "https://mcp.notion.com/mcp" && !("headers" in servers.notion) &&
  servers.supabase?.url === "https://mcp.supabase.com/mcp?project_ref=ci&read_only=true");
/* 23 Nov: Supabase and PostHog stay read-only — their address is what makes them so. */
ok("the read-only supabase connector's address cannot be changed", /kept read-only by QuitCode/.test(String((await propose({ target: "connector", action: "update", name: "supabase", url: "https://mcp.supabase.com/mcp" })).error ?? "")));
ok("no second connector to Supabase or PostHog", /would not be read-only/.test(String((await propose({ target: "connector", action: "create", name: "db", url: "https://mcp.supabase.com/mcp" })).error ?? "")) &&
  /would not be read-only/.test(String((await propose({ target: "connector", action: "create", name: "analytics", url: "https://mcp.posthog.com/mcp" })).error ?? "")));
const dropSupabase = await propose({ target: "connector", action: "delete", name: "supabase" });
ok("removing the read-only supabase connector is allowed (it only takes access away)", !!dropSupabase.proposal_id, dropSupabase.error ?? "");
if (dropSupabase.proposal_id) await decide("proposal.reject", { id: dropSupabase.proposal_id, reason: "test" });

ok("the agent-builder cannot be removed", /cannot be removed/.test(String((await propose({ target: "agent", action: "delete", name: "agent-builder" })).error ?? "")));
const gone = await propose({ target: "skill", action: "delete", name: "old-brief" });
const goneDone = gone.proposal_id ? await commitProposal(gone.proposal_id) : { refused: "" };
ok("removing a skill removes its whole folder", "committed" in goneDone && ![...repoNow().keys()].some((k) => k.startsWith("skills/old-brief/")) && repoNow().has("skills/pando-data/SKILL.md"));
gh.close();
delete process.env.PLUGIN_GITHUB_TOKEN;

console.log("\n=== sources & partners ===");
const src = JSON.parse((await call("propose_source", { role: "partner", kind: "school", name: "CI Elementary", url: "https://example.org/ci-school", area: "pasadena" })).text);
ok("an agent proposes a partner", typeof src.proposal_id === "string");
ok("a partner's note with a phone is refused", /phone or email/.test((await call("propose_source", { role: "partner", kind: "pta", name: "CI PTA", note: "call 626-555-0101" })).error ?? ""));
const srcApplied = await decide("proposal.approve", { id: src.proposal_id });
const listed = JSON.parse((await call("list_sources", { role: "partner" })).text);
const entry = listed.results?.find((s: { name: string }) => s.name === "CI Elementary");
ok("approved, it is on the list", srcApplied.applied === true && !!entry);
/* 0079: the area a source covers is `area`, not a market. */
ok("its area is kept as its area", entry?.area === "pasadena" && !("market_id" in (entry ?? {})), JSON.stringify(entry));
const checked = await call("record_source_check", { source_id: entry?.id, result: "failed" });
const [chk] = await q(sql`select last_check, last_checked_at from pando_sources where name = 'CI Elementary'`);
ok("a source check writes only its time and result", checked.error === null && chk?.last_check === "failed" && chk?.last_checked_at !== null);
ok("the same name again is refused as already listed", /already on the list/.test((await call("propose_source", { role: "partner", kind: "school", name: "ci elementary" })).error ?? ""));

console.log("\n=== the switch ===");
/* Switched the way an admin switches it, so the kept read is forgotten at once (24 Nov). */
await admin.applyAction(db, { actor: "ci", action: "mcp.switch", body: { on: false } });
const off = await call("records_totals");
ok("switched off, a tool says so — at once, not after the kept read runs out", off.error === "Pando MCP is switched off in the Pando admin.");
/* The log row is written after the answer, no longer before it: wait for it briefly. */
let offLogged = 0;
for (let i = 0; i < 20 && offLogged !== 1; i++) {
  offLogged = Number((await q(sql`select count(*) as n from mcp_calls where outcome = 'off'`))[0]?.n ?? 0);
  if (offLogged !== 1) await new Promise((r) => setTimeout(r, 50));
}
ok("and the call is logged as off", offLogged === 1, String(offLogged));

console.log("\n=== keeping it small, and watching it ===");
const [used1] = await q(sql`select last_used_at from mcp_tokens where admin_user = 'ci' and revoked_at is null order by created_at desc limit 1`);
await admin.applyAction(db, { actor: "ci", action: "mcp.switch", body: { on: true } });
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

console.log("\n=== a lost connection is tried once more, for reads only ===");
/* Shaped as the driver throws them: postgres.js sets `code`; drizzle wraps it with `query`/`params` and `cause`. */
const driverErr = (code: string, message = `write ${code}`) => Object.assign(new Error(message), { code });
const wrapped = (cause: Error) => Object.assign(new Error("Failed query: select 1\nparams: +15555550100"), { query: "select 1", params: ["+15555550100"], cause });
ok("a closed or refused connection is transient, also inside drizzle's wrapper",
  isTransientDbError(driverErr("CONNECTION_CLOSED")) && isTransientDbError(wrapped(driverErr("CONNECT_TIMEOUT"))) &&
    isTransientDbError(driverErr("57P01", "terminating connection due to administrator command")) && isTransientDbError(new Error("Max client connections reached")));
let realErr: unknown = null;
try { await q(sql`select * from no_such_table`); } catch (e) { realErr = e; }
ok("a statement's own error is not: a missing table, a statement timeout, a constraint",
  realErr !== null && !isTransientDbError(realErr) && !isTransientDbError(driverErr("57014", "canceling statement due to statement timeout")) &&
    !isTransientDbError(driverErr("23505", "duplicate key value")) && !isTransientDbError("CONNECTION_CLOSED"));
ok("a wrapper's message is never read — it carries the SQL and its parameters",
  !isTransientDbError(Object.assign(new Error("Failed query: … connection closed …"), { query: "x", params: [] })));
let tries = 0;
const once = await readWithRetry(async () => { tries++; if (tries === 1) throw wrapped(driverErr("CONNECTION_CLOSED")); return "read"; }, { delayMs: 1 });
ok("a read whose connection dropped is run again and answers", once === "read" && tries === 2, String(tries));
tries = 0;
let gaveUp = false;
try { await readWithRetry(async () => { tries++; throw driverErr("ECONNRESET"); }, { delayMs: 1 }); } catch { gaveUp = true; }
ok("…once: a second loss is the answer", gaveUp && tries === 2, String(tries));
tries = 0;
let refused = false;
try { await readWithRetry(async () => { tries++; throw driverErr("42P01", "relation does not exist"); }, { delayMs: 1 }); } catch { refused = true; }
ok("a statement's own error is not run again", refused && tries === 1, String(tries));

await stop();
console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
process.exit(fail ? 1 : 0);
