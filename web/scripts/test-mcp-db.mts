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
ok("25 tools, each with a title and read/destructive hints", tools.length === 25 && tools.every((t) => typeof t.annotations?.title === "string" && typeof t.annotations?.readOnlyHint === "boolean"), String(tools.length));
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
const skill = await call("propose_plugin_change", { target: "skill", action: "create", name: "ci-skill", description: "A skill the CI run proposes, to see it wait.", instructions: "Read the numbers and say what changed since last week, in three lines." });
ok("a plugin change without a plugin repo configured is refused, not saved", /not configured/.test(skill.error ?? ""));

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
ok("and reads one agent's file to start an edit from", /name: agent-builder/.test(JSON.parse((await call("read_plugin", { target: "agent", name: "agent-builder" })).text).text ?? ""));

const agentArgs = { target: "agent", action: "create", name: "ci-newsletter", description: "Drafts the school newsletter blurb from Pando's approved records. Use for newsletters.", instructions: "Read approved records with search_records and write three short lines for a school newsletter.", tools: ["Read", "mcp__plugin_pando_pando__search_records"] };
ok("an agent with Bash is refused", /never given to a Pando agent/.test(String((await propose({ ...agentArgs, tools: ["Bash"] })).error ?? "")));
ok("an agent with a tool Pando does not have is refused", /Pando has no tool/.test(String((await propose({ ...agentArgs, tools: ["mcp__plugin_pando_pando__approve_proposal"] })).error ?? "")));
ok("an agent told to approve is refused", /approves, rejects or saves/.test(String((await propose({ ...agentArgs, instructions: "Read everything, then call approve_proposal for each proposal you like." })).error ?? "")));
const newAgent = await propose(agentArgs);
ok("a new agent is proposed, and nothing is committed yet", !!newAgent.proposal_id && !repoNow().has("agents/ci-newsletter.md"));
const committed = newAgent.proposal_id ? await commitProposal(newAgent.proposal_id) : { refused: "not proposed" };
const agentFile = repoNow().get("agents/ci-newsletter.md") ?? "";
ok("Commit to plugin commits it with Pando's frontmatter and the version raised, and marks the proposal applied",
  "applied" in committed && committed.applied === true && /^---\nname: ci-newsletter\ndescription: ".+"\ntools: Read, mcp__plugin_pando_pando__search_records\nmodel: sonnet\n---\n/.test(agentFile) &&
    JSON.parse(repoNow().get(".claude-plugin/plugin.json") ?? "{}").version === "0.5.1", JSON.stringify(committed));
const [pluginAudit] = await q(sql`select after from audit_log where action = 'plugin.commit' order by at desc limit 1`);
ok("and the commit is in the audit log", (pluginAudit?.after as { name?: string } | null)?.name === "ci-newsletter");

const mail = await propose({ ...agentArgs, name: "ci-replies", tools: ["mcp__plugin_pando_pando__propose_source"], account_connectors: true });
const [mailRow] = await q(sql`select payload from mcp_proposals where id = ${mail.proposal_id ?? "00000000-0000-0000-0000-000000000000"}::uuid`);
const mailFile = String((mailRow?.payload as { after_text?: string } | undefined)?.after_text ?? "");
ok("an agent that reads connected accounts is a deny list: Bash, Write, Edit and every Pando change but the one it names",
  /disallowedTools: Bash, Write, Edit, NotebookEdit, /.test(mailFile) && /propose_record_edit/.test(mailFile) && !/propose_source/.test(mailFile) &&
    (mail.warnings ?? []).some((w) => /every account connected/.test(w)), mailFile.slice(0, 300));

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
ok("a connector is added as a remote https server, pando kept first, the others untouched", "committed" in connDone && Object.keys(servers).join(",") === "pando,notion,supabase" && servers.notion?.type === "http" && servers.notion?.url === "https://mcp.notion.com/mcp" && !("headers" in servers.notion) &&
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
