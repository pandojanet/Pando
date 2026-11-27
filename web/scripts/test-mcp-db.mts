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
/* 26 Nov: the server names itself for people — a title, the site and the Pando mark on Pando's own origin. */
const init = (await (await post({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "1" } } })).json()) as { result?: { serverInfo?: { name?: string; title?: string; websiteUrl?: string; icons?: Array<{ src: string; mimeType?: string }> } } };
const info = init.result?.serverInfo;
ok("the server is named Pando, with its site and the Pando mark as icons",
  info?.name === "pando" && info.title === "Pando" && info.websiteUrl === A &&
    info.icons?.some((i) => i.src === `${A}/icon.svg` && i.mimeType === "image/svg+xml") === true &&
    info.icons?.some((i) => i.src === `${A}/apple-icon.png` && i.mimeType === "image/png") === true,
  JSON.stringify(info));
const list = (await (await post({ jsonrpc: "2.0", id: ++id, method: "tools/list" })).json()) as { result: { tools: Array<{ name: string; annotations?: Record<string, unknown> }> } };
const tools = list.result.tools;
ok("31 tools, each with a title and read/destructive hints (26-27 Nov: + contributor_load, set_budget, remove_digest_candidate, messages_summary)", tools.length === 31 && tools.every((t) => typeof t.annotations?.title === "string" && typeof t.annotations?.readOnlyHint === "boolean"), String(tools.length));
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
  /* 26 Nov: the Playbook's contributor load. */
  ["contributor_load", { days: 7 }], ["contributor_load", { days: 1 }],
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
  [".mcp.json", `${JSON.stringify({ mcpServers: { Pando: { type: "http", url: "https://pando.is/api/mcp" }, supabase: { type: "http", url: "https://mcp.supabase.com/mcp?project_ref=ci&read_only=true" } } }, null, 2)}\n`],
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
    index.connectors?.[0]?.name === "Pando" && index.agents?.[0]?.name === "agent-builder", JSON.stringify(index).slice(0, 200));
ok("and says the read-only supabase connector may be removed but not changed",
  index.connectors?.some((c: { name: string; may_change: boolean; may_remove: boolean; read_only?: boolean }) => c.name === "supabase" && !c.may_change && c.may_remove && c.read_only === true) &&
    index.connectors?.some((c: { name: string; may_change: boolean; may_remove: boolean }) => c.name === "Pando" && !c.may_change && !c.may_remove), JSON.stringify(index.connectors));
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
/* 27 Nov: the key is "Pando" (Claude shows it), and it stays locked whatever the case it is named in. */
ok("the Pando connector cannot be removed, in either case", /cannot be removed/.test(String((await propose({ target: "connector", action: "delete", name: "pando" })).error ?? "")) && /cannot be removed|lowercase/.test(String((await propose({ target: "connector", action: "delete", name: "Pando" })).error ?? "")));
const conn = await propose({ target: "connector", action: "create", name: "notion", url: "https://mcp.notion.com/mcp" });
const connDone = conn.proposal_id ? await commitProposal(conn.proposal_id) : { refused: "" };
const servers = JSON.parse(repoNow().get(".mcp.json") ?? "{}").mcpServers ?? {};
ok("a connector is added as a remote https server, last, the others untouched and in place", "committed" in connDone && Object.keys(servers).join(",") === "Pando,supabase,notion" && servers.notion?.type === "http" && servers.notion?.url === "https://mcp.notion.com/mcp" && !("headers" in servers.notion) &&
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

console.log("\n=== the admin's calls page (24 Nov) ===");
/* Two calls from another admin ten days ago, one slow; one from five weeks ago — outside every period. */
await q(sql`insert into mcp_calls (at, actor, client_id, tool, outcome, ms, rows) values
  (now() - interval '10 days', 'janet', 'x', 'digest_weeks', 'ok', 9000, 4),
  (now() - interval '10 days', 'janet', 'x', 'search_records', 'refused', 20, null),
  (now() - interval '35 days', 'janet', 'x', 'search_records', 'ok', 5, 1)`);
const adminRead = await load<typeof import("../lib/server/repo/admin-read.ts")>("../lib/server/repo/admin-read.ts");
const day = await adminRead.readResource(db, "mcp", { days: 1 });
const month = await adminRead.readResource(db, "mcp", { days: 30 });
const [inDay] = await q(sql`select count(*) as n, count(*) filter (where outcome = 'error') as e from mcp_calls where at > now() - interval '1 day'`);
const [inMonth] = await q(sql`select count(*) as n from mcp_calls where at > now() - interval '30 days'`);
const sumOf = (xs: Array<{ calls: number }>) => xs.reduce((s, x) => s + x.calls, 0);
ok("a period's totals are its calls; the per-tool, per-person and timeline counts add up to them",
  day.period_days === 1 && day.totals.calls === Number(inDay.n) && day.totals.error === Number(inDay.e) &&
    sumOf(day.tools) === day.totals.calls && sumOf(day.people) === day.totals.calls && sumOf(day.timeline) === day.totals.calls,
  JSON.stringify({ totals: day.totals, tools: sumOf(day.tools), people: sumOf(day.people), timeline: sumOf(day.timeline) }));
ok("a day is 24 hourly buckets and a month 30 daily ones, empty ones kept",
  day.timeline.length === 24 && month.timeline.length === 30 && /^\d{4}-\d\d-\d\dT\d\d:00$/.test(day.timeline[0]?.at ?? "") && month.timeline.some((b) => b.calls === 0));
ok("thirty days hold the calls of ten days ago and not of five weeks ago; the slowest comes first",
  month.totals.calls === Number(inMonth.n) && month.people.some((p) => p.admin_user === "janet" && p.calls === 2 && p.refused === 1) &&
    month.slowest[0]?.ms === 9000 && month.slowest[0]?.tool === "digest_weeks" &&
    month.tools.find((t) => t.tool === "digest_weeks")?.calls === Number((await q(sql`select count(*) as n from mcp_calls where tool = 'digest_weeks' and at > now() - interval '30 days'`))[0].n),
  JSON.stringify({ calls: month.totals.calls, n: Number(inMonth.n), janet: month.people.find((p) => p.admin_user === "janet"), dw: month.tools.find((t) => t.tool === "digest_weeks") }));
ok("the period before is counted for comparison, and an unknown period reads as seven days",
  (await adminRead.readResource(db, "mcp", { days: 7 })).totals.prev_calls === 2 && (await adminRead.readResource(db, "mcp", { days: "x" })).period_days === 7);

/* Why a call did not answer (0080): a code the wrapper chose, never a message. The suite's own calls above
   made each kind — switched off, a read-only connection proposing, Pando's rule refusing. */
const byReason = await q(sql`select outcome, reason, count(*) as n from mcp_calls where at > now() - interval '1 hour' group by 1, 2`);
const has = (outcome: string, reason: string | null) => byReason.some((r) => r.outcome === outcome && (r.reason ?? null) === reason);
ok("each call that did not answer is logged with why: switched off, read-only connection, Pando's rule",
  has("off", "switched_off") && has("refused", "read_only") && has("refused", "rule"), JSON.stringify(byReason));
ok("an answered call has no reason, and no reason is ever anything but a code from the list",
  !byReason.some((r) => r.outcome === "ok" && r.reason !== null) &&
    byReason.every((r) => r.reason === null || ["deadline", "database_unreachable", "query_timeout", "database_error", "outside_service", "unexpected", "read_only", "rule", "switched_off", "off_on_server"].includes(String(r.reason))));
await mcp.logCall({ actor: "ci", clientId: null, tool: "records_totals", outcome: "error", reason: "not a code" as never, ms: 1 });
const [odd] = await q(sql`select reason from mcp_calls where actor = 'ci' and outcome = 'error' order by id desc limit 1`);
ok("a reason that is not on the list is stored as none, never as text", odd?.reason === null);
const why = await adminRead.readResource(db, "mcp", { days: 1 });
ok("the calls page reads why: a row per outcome and reason, and the reason beside a recent call",
  why.keeps_reason && why.reasons.some((r) => r.outcome === "refused" && r.reason === "rule" && r.calls > 0) &&
    why.recent.some((c) => c.outcome === "off" && c.reason === "switched_off"), JSON.stringify(why.reasons));

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

{
  /* 26 Nov: what the Playbook's daily report reads. */
  const load = JSON.parse((await call("contributor_load", { days: 30 })).text || "{}");
  ok("contributor_load: requests by kind, replies, rate, passes, who is resting and why — counts only",
    typeof load.requests?.total === "number" && typeof load.requests?.network_asks === "number" && typeof load.replies === "number" &&
      (load.reply_rate === null || typeof load.reply_rate === "number") && typeof load.resting_now?.total === "number" &&
      typeof load.ceiling_lowered_by_governor === "number" && !/\+1\d{10}|"name"|"phone"/.test(JSON.stringify(load)),
    JSON.stringify(load).slice(0, 200));
  const daily = JSON.parse((await call("daily_activity", { days: 8 })).text || "{}");
  ok("daily_activity carries the digest's reminders sent and not delivered",
    typeof daily.yesterday?.reminders_sent?.count === "number" && typeof daily.yesterday?.reminders_undelivered?.count === "number",
    JSON.stringify(daily.yesterday ?? {}).slice(0, 160));
  const listed = JSON.parse((await call("list_sources", { status: "any" })).text || "{}");
  const first = (Array.isArray(listed) ? listed : listed.results ?? [])[0];
  ok("list_sources says when each was added", first === undefined || "added_at" in first, JSON.stringify(first ?? {}).slice(0, 160));
}

{
  /* 26 Nov: sign-ups by the channel they came through. */
  const [grp] = await q(sql`insert into invites (code, market_id, label, kind) values ('ci-pta', 'pasadena', 'CI PTA group', 'group') returning id`);
  const [one] = await q(sql`insert into invites (code, market_id, label, kind) values ('ci-dana', 'pasadena', 'Dana Example link', 'personal') returning id`);
  const person = (phone: string, source: string | null, invite: unknown = null) =>
    q(sql`insert into people (phone, market_id, source, invite_id, invite_code, phone_verified_at) values (${phone}, 'pasadena', ${source}, ${invite as string | null}::uuid, ${invite ? "ci" : null}, now()) returning id`);
  const [texter] = await person("+15555550201", "sms_inbound");
  await person("+15555550202", "sms_inbound");
  for (const p of ["+15555550203", "+15555550204", "+15555550205"]) await person(p, "link", grp.id);
  await person("+15555550206", "link", one.id);
  await person("+15555550207", "direct");
  await q(sql`insert into children (person_id, birth_year) values (${texter.id as string}::uuid, 2022)`);
  const pt = JSON.parse((await call("parents_totals", { weeks: 2 })).text || "{}");
  const ch = (c: string) => (pt.by_channel ?? []).find((r: { channel: string }) => r.channel === c);
  ok("parents_totals counts sign-ups by channel: texted, a group's link, a parent's link, the website",
    ch("texted")?.joined === 2 && ch("group_link")?.joined === 3 && ch("parent_link")?.joined === 1 && ch("website")?.joined >= 1,
    JSON.stringify(pt.by_channel));
  ok("…with what each channel's parents went on to do", ["with_children", "asked_by_text", "contributors"].every((k) => typeof ch("texted")?.[k] === "number") && ch("texted")?.with_children === 1);
  ok("a group's link by its label; a parent's own link only as counts, never its label",
    pt.group_links?.some((g: { group: string; joined: unknown }) => g.group === "CI PTA group" && g.joined === 3) &&
      pt.parent_links?.joined === 1 && pt.parent_links?.links === 1 && !JSON.stringify(pt).includes("Dana"),
    JSON.stringify({ g: pt.group_links, p: pt.parent_links }));
  ok("this week's sign-ups split by channel, adding up to the week's total",
    (() => {
      const w = pt.joined_by_week?.at(-1);
      return w && Object.values(w.by_channel as Record<string, number>).reduce((a, b) => a + b, 0) === w.joined && w.by_channel.texted === 2;
    })(),
    JSON.stringify(pt.joined_by_week?.at(-1)));
  ok("no phone in it", !/\+1555555/.test(JSON.stringify(pt)));
}

{
  /* 26 Nov: the monthly budgets, said in the chat and kept in Pando. */
  const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const range = { from: `${month.slice(0, 8)}01`, to: month };
  const budgetOf = async () => JSON.parse((await call("costs_summary", range)).text || "{}").budget;
  ok("no budget set: costs_summary says none", (await budgetOf()) === null);
  const first = await call("set_budget", { sms_usd: 200 });
  ok("set_budget keeps the SMS budget the person named", first.error === null && JSON.parse(first.text).budget?.sms_usd === 200 && JSON.parse(first.text).budget?.ai_usd === null, first.error ?? first.text);
  const shown = await budgetOf();
  ok("costs_summary shows it even with the spend not configured", shown?.sms?.budget === 200 && shown?.sms?.spent === null && shown?.ai === null, JSON.stringify(shown));
  await call("set_budget", { ai_usd: 80.5 });
  const both = await budgetOf();
  ok("naming the AI half leaves the SMS half as it was", both?.sms?.budget === 200 && both?.ai?.budget === 80.5, JSON.stringify(both));
  const [row] = await q(sql`select actor, after from audit_log where action = 'budget.set' order by at desc limit 1`);
  ok("each change is an audit row, as set in chat", (row?.after as { via?: string } | undefined)?.via === "chat" && typeof row?.actor === "string", JSON.stringify(row));
  ok("nothing named is refused, and so is an amount out of range",
    (await call("set_budget", {})).error === "Name a budget: sms_usd, ai_usd or both." && (await call("set_budget", { sms_usd: -1 })).error !== null);
  await call("set_budget", { sms_usd: null });
  const cleared = await budgetOf();
  ok("null removes one budget, the other stays", cleared?.sms === null && cleared?.ai?.budget === 80.5, JSON.stringify(cleared));
}

{
  /* 26 Nov: an event out of the digest's candidates, in the chat — no trip to /admin/proposals. */
  const listed = JSON.parse((await call("digest_candidates")).text).results as Array<{ id: string; title: string }>;
  const walk = listed.find((c) => c.title === "CI Winter Walk");
  ok("each candidate carries its id", typeof walk?.id === "string");
  const removed = await call("remove_digest_candidate", { id: walk!.id });
  ok("remove_digest_candidate takes it out, as decided in chat", removed.error === null && JSON.parse(removed.text).removed === walk!.id && JSON.parse(removed.text).via === "chat", removed.error ?? removed.text);
  const after = JSON.parse((await call("digest_candidates")).text).results as Array<{ id: string }>;
  ok("it is no longer a candidate", !after.some((c) => c.id === walk!.id));
  const [kept] = await q(sql`select removed_at, removed_by from digest_candidates where id = ${walk!.id}::uuid`);
  ok("kept in Pando, never deleted, with who took it out", kept?.removed_at !== null && kept?.removed_by === "ci", JSON.stringify(kept));
  const [row] = await q(sql`select actor, after from audit_log where action = 'digest_candidate.remove' order by at desc limit 1`);
  ok("an audit row, as decided in chat", (row?.after as { via?: string } | undefined)?.via === "chat", JSON.stringify(row));
  ok("taking it out twice is refused in words", /not among the digest's candidates/.test((await call("remove_digest_candidate", { id: walk!.id })).error ?? ""));
}

{
  /* 27 Nov: Twilio's record beside Pando's log, through a stand-in for Twilio's API on 127.0.0.1. The failed
     message is NOT in the period's list (a message that failed inside Twilio may carry no date sent): only the
     fetch by SID finds it — the 24 Nov hole. Twilio's answers carry numbers and text, which must not get out. */
  const http = await import("node:http");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const ok1 = `SM${"a".repeat(32)}`;
  const failed = `MM${"b".repeat(32)}`;
  const elsewhere = `SM${"c".repeat(32)}`;
  await q(sql`insert into message_log (direction, category, template, provider_message_id, status) values
    ('out', 'transactional', 'answer_sent', ${ok1}, 'delivered'), ('out', 'transactional', 'answer_sent', ${failed}, null)`);
  const created = new Date().toUTCString();
  const paths: string[] = [];
  const stub = http.createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    const send = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url?.includes(`/Messages/${failed}.json`)) return send({ sid: failed, status: "failed", error_code: 19023, direction: "outbound-api", from: "+16265550142", to: "+16265550100", body: "Hi Dana, Elena can sit Friday", num_segments: "1", num_media: "0", price: null, price_unit: "USD", date_created: created });
    if (req.url?.includes("/Messages.json")) return send({ messages: [
      { sid: ok1, status: "delivered", error_code: null, direction: "outbound-api", from: "rcs:pando_agent", to: "+16265550100", body: "Your answer", num_segments: "2", num_media: "0", price: "-0.0158", price_unit: "USD", date_created: created },
      { sid: elsewhere, status: "delivered", error_code: null, direction: "outbound-api", from: "+16265550142", to: "+16265550199", body: "console test", num_segments: "1", num_media: "0", price: "-0.0079", price_unit: "USD", date_created: created },
    ], next_page_uri: null });
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  const port = (stub.address() as { port: number }).port;
  const saved = { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, base: process.env.TWILIO_API_BASE };
  process.env.TWILIO_ACCOUNT_SID = "ACci";
  process.env.TWILIO_AUTH_TOKEN = "ci-token";
  process.env.TWILIO_API_BASE = `http://127.0.0.1:${port}`;
  try {
    const r = await call("messages_summary", { from: day, to: day });
    const s = JSON.parse(r.text || "{}");
    ok("messages_summary reads Twilio and sums it: statuses, channels, segments", r.error === null && s.configured === true && s.outbound === 3 && s.outbound_by_status?.delivered === 2 && s.outbound_by_status?.failed === 1 && s.outbound_by_channel?.rcs === 1, r.error ?? r.text.slice(0, 300));
    ok("the 24 Nov hole: Twilio failed it (found by SID), Pando holds no status — said, with the template",
      s.pando_out_of_step?.examples?.some((x: { sid: string; twilio: string; pando: string | null; error_code: number; template: string }) => x.sid === failed && x.twilio === "failed" && x.pando === null && x.error_code === 19023 && x.template === "answer_sent") &&
        paths.some((p) => p.includes(`/Messages/${failed}.json`)), JSON.stringify(s.pando_out_of_step));
    ok("error 19023 with its docs; a message Pando did not send is counted as such", s.errors?.some((e: { code: number; docs: string }) => e.code === 19023 && e.docs.endsWith("/19023")) && s.not_sent_by_pando?.count === 1);
    ok("no phone number, recipient or text from Twilio's answers gets out", !/\+1\d{10}|Dana|Elena|console test|Your answer|pando_agent/.test(r.text), r.text.slice(0, 300));
    ok("only GET requests reached Twilio, the period filtered by date sent", paths.every((p) => p.startsWith("GET ")) && paths.some((p) => /DateSent%3E=/.test(p) && /DateSent%3C=/.test(p)), paths.join(" | "));
    ok("more than 31 days is refused", /At most 31 days/.test((await call("messages_summary", { from: "2026-01-01", to: "2026-03-01" })).error ?? ""));
  } finally {
    stub.close();
    process.env.TWILIO_ACCOUNT_SID = saved.sid;
    process.env.TWILIO_AUTH_TOKEN = saved.token;
    process.env.TWILIO_API_BASE = saved.base;
    if (saved.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    if (saved.base === undefined) delete process.env.TWILIO_API_BASE;
  }
}

await stop();
console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
process.exit(fail ? 1 : 0);
