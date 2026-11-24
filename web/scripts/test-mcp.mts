// npm --prefix web run test:mcp — Pando MCP (20 Nov): the OAuth rules Claude's connectors need, and the
// promises on the diagram (totals with no names, every call logged, one off switch, writes only after a
// yes) held by the code that keeps them. No database: the pure helpers run, the rest is read as source.
import fs from "node:fs";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : detail ? `  (${detail})` : ""}`);
};
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const o = (await import(`../lib/mcp/oauth.ts?v=${Math.random()}`)) as typeof import("../lib/mcp/oauth.ts");
const { createHash, randomBytes } = await import("node:crypto");

console.log("\n=== OAuth, as Claude's connectors require it ===");
{
  const base0 = "https://pando.is";
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  ok("PKCE S256: the verifier that made the challenge passes", o.pkceMatches(verifier, challenge));
  ok("and any other does not, nor a malformed one", !o.pkceMatches(randomBytes(32).toString("base64url"), challenge) && !o.pkceMatches("short", challenge) && !o.pkceMatches(verifier, "nope"));
  ok("a secret is stored as a hash, never as itself", o.hashSecret("pma_x") !== "pma_x" && o.hashSecret("pma_x") === o.hashSecret("pma_x") && o.hashSecret("pma_x").length === 43);
  ok("secrets say what they are and are long", /^pma_[A-Za-z0-9_-]{43}$/.test(o.newSecret("access")) && /^pmr_/.test(o.newSecret("refresh")) && /^pmc_/.test(o.newSecret("code")));
  ok("Claude's hosted callback is the one documented", o.CLAUDE_CALLBACK === "https://claude.ai/api/mcp/auth_callback");
  ok("redirects: Claude's callback or http on loopback — no other https host, never with a fragment",
    o.acceptableRedirect("https://claude.ai/api/mcp/auth_callback") && o.acceptableRedirect("http://localhost/callback") && o.acceptableRedirect("http://127.0.0.1:3118/callback") &&
      !o.acceptableRedirect("https://evil.example/cb") && !o.acceptableRedirect("https://claude.ai/other") && !o.acceptableRedirect("https://claude.ai.evil/api/mcp/auth_callback") &&
      !o.acceptableRedirect("http://evil.example/callback") && !o.acceptableRedirect("https://claude.ai/cb#x") && !o.acceptableRedirect("javascript:alert(1)"));
  ok("a registered https redirect that is not Claude's never matches, even if it was stored", !o.redirectMatches(["https://evil.example/cb"], "https://evil.example/cb"));
  ok("Claude Code's loopback matches on any port, localhost and 127.0.0.1 alike",
    o.redirectMatches(["http://localhost/callback"], "http://localhost:3118/callback") && o.redirectMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:60123/callback"));
  ok("but only on its own path, and never another host's",
    !o.redirectMatches(["http://localhost/callback"], "http://localhost:3118/other") && !o.redirectMatches(["https://claude.ai/api/mcp/auth_callback"], "https://claude.ai.evil/api/mcp/auth_callback") &&
      !o.redirectMatches(["http://localhost/callback"], "http://127.0.0.1:9/callback"));
  ok("a metadata document is fetched only from Claude's own host: never another host, a loopback, an IP or a port",
    o.isMetadataDocumentUrl("https://claude.ai/oauth/claude-code-client-metadata") && !o.isMetadataDocumentUrl("https://claude.ai") && !o.isMetadataDocumentUrl("http://claude.ai/x") &&
      !o.isMetadataDocumentUrl("https://127.0.0.1/x") && !o.isMetadataDocumentUrl("https://evil.example/meta") && !o.isMetadataDocumentUrl("https://[::ffff:a9fe:a9fe]/x") &&
      !o.isMetadataDocumentUrl("https://claude.ai:8443/x") && !o.isMetadataDocumentUrl("https://localhost./x"));
  const base = "https://pando.is";
  const prm = o.protectedResourceMetadata(base);
  ok("protected resource metadata: the resource is exactly the MCP URL, the issuer first", prm.resource === "https://pando.is/api/mcp" && prm.authorization_servers[0] === base);
  const asm = o.authorizationServerMetadata(base) as Record<string, unknown>;
  ok("authorization server metadata advertises S256, CIMD with public clients, DCR and offline_access",
    JSON.stringify(asm.code_challenge_methods_supported) === '["S256"]' && asm.client_id_metadata_document_supported === true &&
      JSON.stringify(asm.token_endpoint_auth_methods_supported) === '["none"]' && typeof asm.registration_endpoint === "string" &&
      (asm.scopes_supported as string[]).includes("offline_access"));
  ok("the 401's header points at the metadata, as Claude reads it", o.unauthorizedHeader(base).startsWith('Bearer resource_metadata="https://pando.is/.well-known/oauth-protected-resource"'));
  ok("a scope asked for is only what Pando grants; none asked is all of it; an unknown one is refused, never widened",
    o.grantedScope("pando:read offline_access") === "pando:read" && o.grantedScope(null) === "pando:read pando:propose" && o.grantedScope("offline_access") === "pando:read pando:propose" &&
      o.grantedScope("pando:read admin:all") === null && o.grantedScope("foo") === null);
  ok("a read-only token may not write; resource must be this MCP endpoint; a challenge is 43 base64url characters",
    !o.mayPropose(["pando:read"]) && o.mayPropose(["pando:read", "pando:propose"]) && o.resourceMatches(base0, null) && o.resourceMatches(base0, "https://pando.is/api/mcp") &&
      !o.resourceMatches(base0, "https://other.example/api/mcp") && o.wellFormedChallenge("a".repeat(43)) && !o.wellFormedChallenge("short"));
}

console.log("\n=== the routes ===");
{
  const token = read("app/api/oauth/token/route.ts");
  ok("tokens: form-urlencoded, a code once with its verifier, client and redirect; refusals are invalid_grant",
    /request\.formData\(\)/.test(token) && /takeCode\(\{ code, clientId, redirectUri: field\("redirect_uri"\), verifier \}\)/.test(token) &&
      /"invalid_grant"/.test(token) && /no-store/.test(token));
  const repo = read("lib/server/repo/mcp.ts");
  /* 23 Nov, the security review: client, redirect and PKCE are checked in the statement that spends the
     code, so a request without the verifier cannot burn it; a spent code presented again revokes what it bought. */
  ok("a code is spent only by its own client, redirect and verifier, in one statement; a refresh locks, revokes and replaces its pair in one transaction",
    /update mcp_auth_codes set used_at = now\(\)\s+where code_hash = \$\{codeHash\} and used_at is null and expires_at > now\(\)\s+and client_id = \$\{input\.clientId\} and redirect_uri = \$\{input\.redirectUri\} and code_challenge = \$\{challenge\}/.test(repo) &&
      /createHash\("sha256"\)\.update\(input\.verifier\)\.digest\("base64url"\)/.test(repo) &&
      /db\.transaction\(async \(tx\): Promise<RefreshOutcome>/.test(repo) && /refresh_hash = \$\{hashSecret\(refreshToken\)\} and client_id = \$\{clientId\}\s+for update/.test(repo));
  ok("a code exchanged twice revokes the tokens it bought, and every pair rotated from them (RFC 6749 §4.1.2)",
    /select token_id from mcp_auth_codes where code_hash = \$\{codeHash\} and used_at is not null and token_id is not null/.test(repo) &&
      /update mcp_auth_codes set token_id = \$\{String\(pair\.id\)\}::uuid where code_hash = \$\{input\.codeHash\}/.test(repo) &&
      /codeHash: taken\.codeHash/.test(token) && /ADD COLUMN IF NOT EXISTS token_id uuid/.test(read("drizzle/0077_mcp_review_fixes.sql")));
  ok("the token endpoint has a budget per client, beside the address-wide one", /rateLimitedKey\(clientId, "oauth_token"\)/.test(token) && /rateLimited\(request, "oauth"\)/.test(token));
  const oauthSrc = read("lib/mcp/oauth.ts");
  ok("the public origin never comes from the request's Host in production", /if \(process\.env\.NODE_ENV === "production"\) return "https:\/\/pando\.is";/.test(oauthSrc) &&
    oauthSrc.indexOf('process.env.NODE_ENV === "production"') < oauthSrc.indexOf("return new URL(requestUrl).origin") && /process\.env\.MCP_BASE_URL \|\| process\.env\.NOTIFY_BASE_URL/.test(oauthSrc));
  const bearerSrc = read("lib/server/mcp/bearer.ts");
  ok("a token not shaped like Pando's is never looked up; an address guessing tokens is refused before the database",
    /ACCESS_SHAPE = \/\^pma_\[A-Za-z0-9_-\]\{43\}\$\//.test(bearerSrc) && /const owner = shaped \? await tokenOwner\(token\) : null;/.test(bearerSrc) &&
      bearerSrc.indexOf('rateBlocked(request, "mcp_bad_token")') > -1 && bearerSrc.indexOf('rateBlocked(request, "mcp_bad_token")') < bearerSrc.indexOf("await tokenOwner(") &&
      /if \(shaped\) rateLimited\(request, "mcp_bad_token"\);/.test(bearerSrc));
  ok("a new password ends the admin's Claude connections (their own change, and the CLI's)",
    /update mcp_tokens set revoked_at = now\(\) where admin_user = \$\{name\} and revoked_at is null/.test(read("lib/server/repo/admin-users.ts")) &&
      (read("scripts/admin-user.mjs").match(/update mcp_tokens set revoked_at = now\(\) where admin_user = \$\{name\} and revoked_at is null/g) ?? []).length === 2);
  ok("the consent screen says to allow only a connection you started", /If someone sent you this link, cancel\./.test(read("components/admin/ConnectScreen.tsx")));
  ok("a rotated refresh token used again revokes its whole family", /with recursive family\(id\)/.test(repo) && /refused: "replayed"/.test(repo));
  ok("an unreadable database is a 503, not a 401 that sends the person through sign-in again",
    /"unavailable"/.test(repo) && /status: 503/.test(read("lib/server/mcp/bearer.ts")));
  ok("only hashes are written; the admin must still be one who may sign in", !/values \(\$\{accessToken\}|values \(\$\{code\}/.test(repo) && /isActiveAdmin\(/.test(repo) && /adminCredentials\(\)/.test(repo));
  const auth = read("app/api/oauth/authorize/route.ts");
  ok("consent: a signed-in admin on Pando's own origin, the request checked again before a code is made",
    /refuseForeignAdminWrite\(request/.test(auth) && /readAdminSession\(/.test(auth) && (auth.match(/checkAuthorize\(/g) ?? []).length === 2 && /decision !== "allow"/.test(auth));
  const config = read("next.config.ts");
  ok("the .well-known paths reach the metadata routes", /"\/\.well-known\/oauth-protected-resource\/:path\*"/.test(config) && /"\/\.well-known\/oauth-authorization-server"/.test(config));
  const bearer = read("lib/server/mcp/bearer.ts");
  const route = read("app/api/mcp/route.ts");
  ok("/api/mcp checks the Bearer token first and answers 401 with the pointer", /const auth = await mcpBearer\(request\)/.test(route) && /status: 401/.test(bearer) && /"WWW-Authenticate": unauthorizedHeader/.test(bearer));
  ok("stateless: a server per request, no session id", /sessionIdGenerator: undefined/.test(route));
}

console.log("\n=== the diagram's promises ===");
{
  const server = read("lib/server/mcp/server.ts");
  ok("every tool goes through one wrapper: the switch, the call log, errors by class only",
    (server.match(/server\.registerTool\(/g) ?? []).length === 1 && /const sw = await mcpSwitch\(\);/.test(server) && /finally \{[\s\S]{0,300}void logCall\(/.test(server) &&
      /error: err instanceof Error \? err\.constructor\.name : "unknown"/.test(server));
  const repo = read("lib/server/repo/mcp.ts");
  /* 24 Nov: unreadable still refuses, but as what it is — "switched off" was said when the database had not answered. */
  ok("one off switch: the admin's setting, and the server's PANDO_MCP=off over it; unreadable refuses as unknown, never as off",
    /PANDO_MCP/.test(repo) && /key = 'mcp_enabled'/.test(repo) && /if \(!r\.persisted\) return "unknown";/.test(repo) &&
      /if \(sw === "unknown"\) \{\s+outcome = "error";\s+return \{ \.\.\.text\("Pando's database didn't answer just now/.test(server) &&
      /if \(sw === "off"\) \{\s+outcome = "off";/.test(server));
  ok("a read of the switch is kept 30 s, never reused after a failed read, and the admin's change forgets it at once",
    /const SWITCH_TTL_MS = 30_000;/.test(repo) && /case "mcp\.switch": \{[\s\S]{0,600}forgetMcpSwitch\(\);/.test(read("lib/server/repo/admin-write.ts")));
  ok("a call answers within 30 s, and its answer never waits for its own log row",
    /const CALL_DEADLINE_MS = 30_000;/.test(server) && /void logCall\(\{ actor: ctx\.actor/.test(server) && !/await logCall\(/.test(server) &&
      /if \(err instanceof DeadlineError\)/.test(server));
  const logAt = repo.indexOf("export async function logCall");
  ok("the call log keeps who, which tool, the outcome, time and rows — never the arguments",
    logAt !== -1 && /insert into mcp_calls \(actor, client_id, tool, outcome, ms, rows\)/.test(repo) && !/args/.test(repo.slice(logAt)));
  /* Code only: comments and SQL text name what is kept out, which is not what is returned. */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/sql`[\s\S]*?`/g, "");
  const readSrc = read("lib/server/repo/mcp-read.ts");
  const outputs = code(readSrc + read("lib/server/repo/mcp-proposals.ts"));
  const forbidden = ["first_name", "last_name", "phone:", "email", "person_id:", "asker", "contributor:", "question_text:", "answer_text:"];
  const leaked = forbidden.filter((k) => new RegExp(`\\b${k.replace(":", "\\s*:")}`).test(outputs));
  ok("no tool output carries a parent's name, phone, email, id or question text", leaked.length === 0, leaked.join(", "));
  ok("a record's texts go out without who wrote them, masked, and never for a record flagged as a person",
    /texts\[f\] = maskNames\(maskContactDetails\(String\(c\[f\]\)\.trim\(\)\)\)/.test(readSrc) && /possible_named_person/.test(readSrc) && /parents_said: \[\]/.test(readSrc) && !/\bapproved_by\b|show_first_name/.test(code(readSrc)));
  ok("a record flagged as a person's name: out of search, and without its name or venue when read or proposed",
    /where not s\.is_test and not \$\{FLAGGED_PERSON\}/.test(readSrc) && /name: flagged \? null : String\(r\.name\)/.test(readSrc) && /r\.venue && !flagged/.test(readSrc) &&
      /flagged_person === true \? null : String\(r\.share_name/.test(read("lib/server/repo/mcp-proposals.ts")));
  ok("a tool that writes needs pando:propose; source links are http(s) only",
    /if \(!config\.readOnly && !mayPropose\(ctx\.scopes\)\)/.test(server) && /regex\(\/\^https\?:/.test(server) && !/source_url: z\.string\(\)\.url\(\)/.test(server));
  ok("the digest tool drops the texts and the families each set went to", /\(\{ variants: _v, \.\.\.g \}\) => g/.test(server));
  /* 24 Nov, the developer: proposals are decided in the chat; the plugin's own changes stay on /admin/proposals.
     The 23 Nov review's objection — the chat's "admin said yes" was a value the agent filled in — still holds,
     so there is no such flag: the yes is the person allowing a destructive call. */
  ok("writes are proposals; the chat decides one only through approve_proposal / reject_proposal — one applyAction, via chat, no admin_said flag, no save tool",
    /tool\("approve_proposal"/.test(server) && /tool\("reject_proposal"/.test(server) && !/tool\("save_skill"/.test(server) &&
      !/admin_said_|saveSkill\(/.test(code(server)) && (code(server).match(/applyAction\(/g) ?? []).length === 1 &&
      /applyAction\(db\(\), \{ actor: ctx\.actor, action, via: "chat", body: \{ id, /.test(server) &&
      !/insert into shares|update shares|insert into digest|commitSkill/.test(server));
  ok("both are destructive, so Claude asks the person for each call; and at most mcp_decide an hour per connection",
    /tool\("approve_proposal", \{[\s\S]{0,800}readOnly: false,\s+destructive: true,/.test(server) &&
      /tool\("reject_proposal", \{[\s\S]{0,800}readOnly: false,\s+destructive: true,/.test(server) &&
      /rateLimitedKey\(`\$\{ctx\.actor\}\|\$\{ctx\.clientId\}`, "mcp_decide"\)/.test(server) &&
      /mcp_decide: \{\s[\s\S]{0,400}max: 30,\s+windowSeconds: 60 \* 60,/.test(read("lib/rate-limits.ts")));
  const write = read("lib/server/repo/admin-write.ts");
  ok("where a decision was made is set by the server, never by the request; the chat cannot decide a change to the plugin",
    (write.match(/const via = ctx\.via === "chat" \? "chat" : "admin";/g) ?? []).length === 2 && !/b\.via\b/.test(write) &&
      /if \(via === "chat" && \(p\.kind === "plugin" \|\| p\.kind === "skill"\)\) return \{ applied: false, reason: "plugin_admin_only" \};/.test(write) &&
      /and \(\$\{via\} = 'admin' or kind not in \('plugin', 'skill'\)\)/.test(write) &&
      !/via:/.test(read("app/api/admin/action/route.ts").slice(read("app/api/admin/action/route.ts").indexOf("applyAction(db, {"), read("app/api/admin/action/route.ts").indexOf("applyAction(db, {") + 300)));
  ok("no agent is ever given a deciding tool: the tool list marks them, the plugin's agent check refuses them",
    /approve_proposal: "decide",\s+reject_proposal: "decide",/.test(read("lib/mcp/tool-names.ts")) &&
      /if \(\(PANDO_DECIDE_TOOLS as readonly string\[\]\)\.includes\(pt\)\) return \{ refused:/.test(read("lib/server/mcp/plugin-repo.ts")) &&
      /\.\.\.PANDO_DECIDE_TOOLS\.map\(\(d\) => PANDO_TOOL_PREFIX \+ d\)/.test(read("lib/server/mcp/plugin-repo.ts")));
  const actionRoute = read("app/api/admin/action/route.ts");
  /* 23 Nov, the developer: the client changes the plugin — skills, agents, connectors — without QuitCode. */
  ok("a plugin change is committed only by an admin's Commit on /admin/proposals: the route commits first, the proposal is marked with the commit",
    /tool\("propose_plugin_change"/.test(server) && /kind: "plugin", shareId: null/.test(server) && /const prepared = await preparePluginChange\(a\);/.test(server) &&
      /waiting\.data\?\.kind === "plugin"/.test(actionRoute) && /const saved = await commitPluginChange\(session\.user,/.test(actionRoute) && /body\.commit = saved\.commit;/.test(actionRoute) &&
      /\} else if \(p\.kind === "plugin"\) \{[\s\S]{0,700}reason: "plugin_not_committed"/.test(write) && /'plugin'\)\);/.test(read("drizzle/0078_plugin_changes.sql")));
  const toolNames = read("lib/mcp/tool-names.ts");
  ok("one list of Pando's tools: the server cannot register a tool missing from it or listed as the other kind",
    /const kind = PANDO_TOOLS\[name as keyof typeof PANDO_TOOLS\];\s+if \(!kind \|\| \(kind === "read"\) !== config\.readOnly\) throw/.test(server) &&
      [...server.matchAll(/tool\("([a-z_]+)"/g)].every((m) => toolNames.includes(`  ${m[1]}: "`)) &&
      (toolNames.match(/^  [a-z_]+: "(read|write|decide)",$/gm) ?? []).length === [...server.matchAll(/tool\("([a-z_]+)"/g)].length &&
      /if \(kind === "decide" && config\.destructive !== true\) throw/.test(server));
  ok("the sources & partners list: read by agents, changed by an admin's yes, only a check's time and result written directly",
    /tool\("list_sources"/.test(server) && /tool\("propose_source"/.test(server) && /kind: "source", shareId: null/.test(server) && /tool\("record_source_check"/.test(server) &&
      /update pando_sources set last_checked_at = now\(\), last_check = \$\{result\}/.test(read("lib/server/repo/mcp-sources.ts")) &&
      /\} else if \(p\.kind === "source"\) \{[\s\S]{0,2500}insert into pando_sources/.test(write) && /CREATE TABLE IF NOT EXISTS pando_sources/.test(read("drizzle/0077_mcp_review_fixes.sql")) &&
      /REVOKE ALL ON pando_sources FROM anon, authenticated/.test(read("drizzle/0077_mcp_review_fixes.sql")));
  ok("an approval applies through the action an admin would use, each with its own audit row, then marks the proposal",
    /case "proposal\.approve":/.test(write) && /action: "share\.rename"/.test(write) && /const out = await run\(tx, sub\);\s+if \(!out\.applied\) return out;\s+await audit\(tx, sub/.test(write) &&
      /update mcp_proposals set status = 'applied'/.test(write) && /'admin_entered'/.test(write));
  ok("the diagram's chain keeps its source: a new record keeps its page; a check keeps its verdict and date, and only a confirmed one replaces the source",
    /freshness_state, source_url\)/.test(write) && /'admin_entered', now\(\), 'fresh', \$\{sourceUrl\}\)/.test(write) &&
      /source_check = \$\{verdict\}, source_checked_at = now\(\),\s+\$\{verdict === "confirmed" \? sql`source_url = coalesce\(\$\{sourceUrl\}, source_url\),` : sql``\}/.test(write) &&
      /source_url: r\.source_url \? String\(r\.source_url\)/.test(readSrc));
  ok("\"couldn't confirm\" is its own verdict and changes no freshness", /z\.enum\(\["confirmed", "stale", "unreachable"\]\)/.test(server) &&
    /verdict === "confirmed" \? sql`last_confirmed_at = now\(\), freshness_state = 'fresh',` : verdict === "stale" \? sql`freshness_state = 'stale',` : sql``/.test(write));
  ok("a fact correction needs its page, keeps what was there in the audit row, and takes only Pando's areas and age bands",
    /A facts change needs the page it comes from/.test(server) && /before = \{ venue: was\.venue/.test(write) && /const isBand = \(x: string\) => \(AGE_BANDS as string\[\]\)\.includes\(x\)/.test(write) &&
      /z\.enum\(AGE_BANDS as/.test(server));
  ok("search filters by age band; what went wrong is kinds and counts — never a job's note",
    /\$\{input\.age_band\} = any\(s\.age_bands\)/.test(readSrc) && /export async function whatWentWrong/.test(readSrc) &&
      !/\bnote\b/.test(code(readSrc.slice(readSrc.indexOf("export async function whatWentWrong")))) && /tool\("what_went_wrong"/.test(server));
  ok("delivery_health and the admin's delivery page count on the caller's connection, so an error is an error, never \"not configured\"",
    /delivery: \(db, params\) => deliveryHealthRow\(db, params\)/.test(read("lib/server/repo/admin-read.ts")) &&
      /const counts = await deliveryCountsOn\(db, windowDays\);/.test(read("lib/server/repo/admin-read.ts")) &&
      !/configured: false/.test(read("lib/server/repo/admin-read.ts").slice(read("lib/server/repo/admin-read.ts").indexOf("async function deliveryHealthRow"), read("lib/server/repo/admin-read.ts").indexOf("14.1 Conversations"))) &&
      /export async function deliveryCountsOn\(db: Db, days = 7\): Promise<DeliveryCounts> \{\s+return toDeliveryCounts\(await deliveryRow\(db, deliveryWindow\(days\)\)\);/.test(read("lib/server/repo/outreach.ts")));
  const uq = readSrc.slice(readSrc.indexOf("export async function unansweredQuestions"));
  ok("question texts only from unanswered_questions: masked, never who asked or the answer; sensitive, caregiver and person-asking ones only counted; Seed Tool only ordinary",
    /maskContactDetails\(String\(r\.question_text/.test(uq) && (uq.match(/maskNames\(maskContactDetails\(String\(r\.question_text/g) ?? []).length === 2 && !/person_id|phone|answer_text|neighborhood/.test(code(uq)) &&
      /coalesce\(a\.hold_reason, 'not_held'\) not in \('caregiver', 'sensitive', 'generator_asked'\)/.test(uq) &&
      /not requires_human_review and coalesce\(sensitivity, 'ordinary'\) in \('ordinary', 'peer_support'\)/.test(uq) && (readSrc.match(/question_text/g) ?? []).length === (uq.match(/question_text/g) ?? []).length);
  const skills = read("lib/server/mcp/plugin-repo.ts");
  ok("a plugin change: Pando writes every file's frontmatter, only skills/<name>/SKILL.md, agents/<name>.md or .mcp.json, version raised in the same commit",
    /return `---\\nname: \$\{d\.name\}\\ndescription: \$\{yaml\(description\)\}\\n\$\{hint/.test(skills) &&
      /target === "skill" \? `skills\/\$\{name\}\/SKILL\.md` : target === "agent" \? `agents\/\$\{name\}\.md` : MCP_JSON/.test(skills) &&
      /\{ path: MANIFEST, mode: "100644", type: "blob", content: `\$\{JSON\.stringify\(\{ \.\.\.plugin, version \}/.test(skills) && /Pando writes the frontmatter/.test(skills));
  ok("never force-pushes; a file changed since the proposal, or a render that differs from what the admin read, is refused; every commit audited",
    /force: false/.test(skills) && !/force: true/.test(skills) && /if \(\(file\?\.sha \?\? null\) !== p\.base_sha\)/.test(skills) && /if \(after !== p\.after_text\)/.test(skills) &&
      /'plugin\.commit', 'plugin'/.test(skills) && /"plugin\.commit":/.test(read("lib/admin/labels.ts")));
  ok("an agent never gets Bash, Write, Edit or NotebookEdit; a connector is https, public and keyless; the means of change cannot be removed",
    /const NEVER = \["Bash", "Write", "Edit", "NotebookEdit"\];/.test(skills) && /if \(u\.protocol !== "https:"\)/.test(skills) && /u\.username \|\| u\.password \|\| u\.search \|\| u\.hash/.test(skills) &&
      /LOCKED: Record<PluginTarget, string\[\]> = \{ skill: \["customize", "pando-data"\], agent: \["agent-builder"\], connector: \["pando"\] \}/.test(skills) &&
      /servers\[d\.name\] = \{ type: "http", url:/.test(skills) && !/\b(command|args|env)\s*:/.test(code(skills)));
  ok("Supabase and PostHog stay read-only: their address is never changed by a proposal, and no second connector to them",
    /READ_ONLY_CONNECTORS: Record<string, string> = \{ supabase: "mcp\.supabase\.com", posthog: "mcp\.posthog\.com" \}/.test(skills) &&
      /if \(d\.action !== "delete" && d\.name in READ_ONLY_CONNECTORS\)/.test(skills) && /a second connector to it would not be read-only/.test(skills));
  const ld = (await import(`../lib/admin/line-diff.ts?v=${Math.random()}`)) as typeof import("../lib/admin/line-diff.ts");
  const dl = ld.diffLines("a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nX\ne\nf\ng\nh", 1);
  ok("the admin's line diff: removed and added lines, unchanged ones far from a change folded",
    JSON.stringify(dl) === JSON.stringify([{ op: "skip", count: 2 }, { op: "same", text: "c" }, { op: "del", text: "d" }, { op: "add", text: "X" }, { op: "same", text: "e" }, { op: "skip", count: 3 }]) &&
      ld.diffLines(null, "x\ny").every((l) => l.op === "add") && ld.diffLines("x", null).every((l) => l.op === "del"), JSON.stringify(dl));
  const sql0072 = read("drizzle/0072_plugin_skills.sql");
  ok("migration 0072: plugin_skills with RLS, in the journal after 0071",
    /CREATE TABLE IF NOT EXISTS plugin_skills/.test(sql0072) && /ENABLE ROW LEVEL SECURITY/.test(sql0072) && /REVOKE ALL ON plugin_skills FROM anon, authenticated/.test(sql0072) &&
      /"tag": "0071_record_source",[\s\S]*"tag": "0072_plugin_skills"/.test(read("drizzle/meta/_journal.json")));
  ok("an event is proposed, never written: approved it becomes a digest candidate; an admin can take one out (never deleted)",
    /tool\("propose_event"/.test(server) && /kind: "event", shareId: null/.test(server) && /} else if \(p\.kind === "event"\) \{[\s\S]*?insert into digest_candidates/.test(write) &&
      /case "digest_candidate\.remove":[\s\S]*?set removed_at = now\(\)/.test(write) && !/delete from digest_candidates/.test(write));
  const sql0073 = read("drizzle/0073_digest_candidates.sql");
  ok("migration 0073: digest_candidates with RLS, proposals may be events, in the journal after 0072",
    /CREATE TABLE IF NOT EXISTS digest_candidates/.test(sql0073) && /REVOKE ALL ON digest_candidates FROM anon, authenticated/.test(sql0073) &&
      /'record_edit', 'new_record', 'fact_check', 'event'/.test(sql0073) && /"tag": "0072_plugin_skills",[\s\S]*"tag": "0073_digest_candidates"/.test(read("drizzle/meta/_journal.json")));
  ok("the daily brief's numbers: by day on the market's clock, yesterday beside the 7 days before, counts only",
    /tool\("daily_activity"/.test(server) && /timeZone: marketConfig\(DEFAULT_MARKET_ID\)\.timeZone/.test(server) &&
      /baseline_7_day_avg/.test(readSrc) && /series\.slice\(Math\.max\(0, series\.length - 9\), series\.length - 2\)/.test(readSrc));
  const mcpRoute = read("app/api/mcp/route.ts");
  const limits = read("lib/rate-limits.ts");
  ok("quotas: a minute's ceiling and a day's quota per connection, checked after the token and before any tool",
    /rateLimitedKey\(connection, "mcp"\) \?\? rateLimitedKey\(connection, "mcp_day"\)/.test(mcpRoute) &&
      mcpRoute.indexOf("mcpBearer(request)") < mcpRoute.indexOf("rateLimitedKey(") && mcpRoute.indexOf("rateLimitedKey(") < mcpRoute.indexOf("pandoMcpServer(") &&
      /mcp: \{[\s\S]*?max: 120,\s+windowSeconds: 60,/.test(limits) && /mcp_day: \{[\s\S]*?max: 3000,\s+windowSeconds: 24 \* 60 \* 60,/.test(limits));
  const doc = fs.readFileSync(new URL("../../docs/reference/pando-mcp.md", import.meta.url), "utf8");
  const tools = [...server.matchAll(/tool\("([a-z_]+)"/g)].map((m) => m[1]);
  const undocumented = tools.filter((t) => !doc.includes(`\`${t}\``));
  ok("the interface document names every tool the server has (the playbook's ask of QC)", tools.length >= 20 && undocumented.length === 0, undocumented.join(", "));
  ok("and covers auth, data rules, audit, errors, quotas, test mode and ownership",
    ["## Ownership", "## Auth", "## Data rules", "## Audit", "## Error behaviour", "## Quotas", "## Test mode"].every((h) => doc.includes(h)));
  /* Round 1 of the review (20 Nov). */
  const cand = read("lib/server/mcp/candidate.ts");
  ok("an event for parents' texts: plain-ASCII link, no punycode or user@host, ≤400 characters, not a listing; no contact or link in its words; real dates",
    /\[\^\\x21-\\x7e\]/.test(cand) && /startsWith\("xn--"\)/.test(cand) && /u\.username \|\| u\.password/.test(cand) && /url\.length > 400/.test(cand) &&
      /isListingUrl\(url\)/.test(cand) && /hasContactDetail\(value\.replace\(ISO_DATES, ""\)\)/.test(cand) && /LINK_IN_TEXT\.test\(value\)/.test(cand) && /export const realDay/.test(cand) &&
      /const checked = checkCandidate\(a\)/.test(server) && /checkCandidate\(\{ \.\.\.\(payload/.test(write));
  ok("one message per request: a JSON-RPC batch is refused before the quota and the tools", /Batches are not accepted/.test(mcpRoute) && mcpRoute.indexOf("Batches are not accepted") < mcpRoute.indexOf("pandoMcpServer("));
  ok("a quota refusal is in the call log, once a minute per connection", /tool: "\(rate limited\)", outcome: "refused"/.test(mcpRoute));
  ok("undelivered texts are the log's outbound rows ('out', as the table's CHECK has it)", !/direction = 'outbound'/.test(readSrc) && (readSrc.match(/direction = 'out'/g) ?? []).length === 2);
  ok("a skill's save: no contact details, a version that is not x.y.z refused, the hash returned and audited, recording retried and a failure said",
    /hasContactDetail\(body\) \|\| hasContactDetail\(description\)/.test(skills) && /return m \? `\$\{m\[1\]\}\.\$\{m\[2\]\}\.\$\{Number\(m\[3\]\) \+ 1\}` : null;/.test(skills) &&
      /sha256/.test(skills) && /\(await record\(\)\)\.persisted \|\| \(await record\(\)\)\.persisted/.test(skills) && /warning:/.test(skills) && /res\.status === 404 && method === "GET"/.test(skills));
  const repoSrc = read("lib/server/repo/mcp.ts");
  /* 23 Nov, the security review: the 30-second grace kept a thief's racing refresh alive; it is gone. */
  ok("an unreadable admin list is a 503, never a sign-out; any second use of a refresh token revokes the family, with no grace",
    /if \(set\.mode === "unavailable"\) return "unavailable";/.test(repoSrc) && !/REFRESH_GRACE_MS|just_rotated|rotated_just_now/.test(code(repoSrc)));
  ok("registration: its own hourly limit, and clients never used for a sign-in dropped after a day",
    /rateLimited\(request, "oauth_register"\)/.test(read("app/api/oauth/register/route.ts")) && /delete from mcp_clients c where c\.kind = 'dcr' and c\.created_at < now\(\) - interval '1 day'/.test(repoSrc));
  ok("a proposal is checked against the record as it is now: a test row never, \"ready\" only on an approved record; 100 waiting at most",
    /if \(!now \|\| now\.is_test\) return \{ applied: false, reason: "proposal_closed" \}/.test(write) && /reason: "record_not_approved"/.test(write) &&
      /MAX_WAITING = 100/.test(read("lib/server/repo/mcp-proposals.ts")));
  /* Round 2 of the review (20 Nov). */
  const journalEntries = (JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; when: number; tag: string }> }).entries;
  const outOfOrder = journalEntries.filter((e, k) => k > 0 && !(e.when > journalEntries[k - 1].when && e.idx === journalEntries[k - 1].idx + 1));
  ok("every migration's \"when\" is newer than the one before it (drizzle skips an older one silently)", outOfOrder.length === 0, outOfOrder.map((e) => e.tag).join(", "));
  ok("the off switch reads the env first and the admin's setting second, in code, not a comment",
    /if \(\(process\.env\.PANDO_MCP \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "off"\) return "off";/.test(code(repo)));
  ok("an event approved after the digests were prepared joins the prepared, unapproved, unsent editions it fits; a taken-out one leaves only those",
    /e\.status in \('ready', 'empty'\) and e\.approved_at is null/.test(write) && /candidatesForGroup\(\[e\], ed\.day, ed\.cohort_profile\?\.ages \?\? null\)/.test(write) &&
      /and e\.approved_at is null\s+and not exists \(select 1 from digest_sends s where s\.edition_id = e\.id\)/.test(write));
  ok("weeks are stepped on local Mondays (no drift at a clock change); today is the market's", /generate_series\(date_trunc\('week', now\(\) at time zone/.test(readSrc) && /as w_end/.test(readSrc) &&
    /const TODAY = sql`\(now\(\) at time zone/.test(read("lib/server/repo/mcp-proposals.ts")));
  /* Round 3 of the review (20 Nov). */
  ok("the MCP admin page renders its not-set-up state as components, not as text", /<Card>\{!configured \? <NotConfigured/.test(read("app/(admin)/admin/mcp/page.tsx")));
  ok("a later event also reaches a group the agent found nothing for, and the prepared editions are locked while it is added",
    /e\.status in \('ready', 'empty'\) and e\.approved_at is null/.test(write) && /for update of e/.test(write) && /set status = 'ready' where id = \$\{ed\.id\}::uuid and status = 'empty'/.test(write));
  ok("taking an event out says when an approved digest still carries it; the digests page marks only live candidates",
    /still_in_approved/.test(write) && /still_in_approved/.test(read("app/(admin)/admin/proposals/page.tsx")) && /c\.url = digest_items\.url and c\.removed_at is null/.test(read("lib/server/repo/admin-read.ts")));
  ok("a record's name, venue and subcategory carry no phone, email or link; a host with a trailing dot is judged without it",
    /export function plainWordsRefusal/.test(cand) && (server.match(/plainWordsRefusal\(\{ name: a\.name, venue: a\.venue, subcategory: a\.subcategory \}\)/g) ?? []).length === 2 &&
      /if \(u\.hostname\.endsWith\("\."\)\) u\.hostname = u\.hostname\.slice\(0, -1\);/.test(cand));
  ok("a saved skill never tells Claude to approve, reject or save", /approve_proposal\|reject_proposal\|save_skill\|admin_said_/.test(skills));
  /* The pattern review (20 Nov): Anthropic's "Writing tools for agents", the MCP spec, Claude's connector review. */
  const ann = server.slice(server.indexOf("annotations: {"), server.indexOf("annotations: {") + 400);
  ok("every tool carries title, readOnlyHint, destructiveHint, idempotentHint and openWorldHint false (reads run without a prompt)",
    /title: config\.title/.test(ann) && /readOnlyHint: config\.readOnly/.test(ann) && /destructiveHint: config\.destructive === true/.test(ann) && /idempotentHint: config\.idempotent \?\? config\.readOnly/.test(ann) && /openWorldHint: false/.test(ann));
  const descs = [...server.matchAll(/description: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  ok("tool descriptions say what a tool does, not how Claude must behave (no \"only after\", \"never on your own\", \"always\")",
    descs.length >= 23 && descs.every((d) => !/\b(only after|never on your own|always call|you must|do not call)\b/i.test(d)), descs.filter((d) => /\b(only after|never on your own|always call|you must|do not call)\b/i.test(d)).join(" | ").slice(0, 200));
  ok("lists say when they were cut and how to narrow them (has_more + narrow)", /const paged = </.test(server) && (server.match(/paged\(await /g) ?? []).length === 4 && /has_more: true, narrow/.test(server));
  /* 23 Nov, the review's data findings. */
  ok("impact counts every sent answer in the database, without test rows (not the admin list's latest 200)",
    /export async function impactTotals/.test(readSrc) && /where not is_test and status = 'sent'/.test(readSrc) && /impactTotals\(db\(\), \{ from, to \}\)/.test(server) && !/readResource\(db\(\), "impact"/.test(server));
  ok("the digest tool leaves the admin's test editions out", /d\.index\.filter\(\(w\) => w\.is_test !== true\)/.test(server) && /w\.edition_date === week && w\.is_test !== true/.test(server));
  ok("search: approved unless asked, verbatim trust labels, and the Fact-checker's filters",
    /z\.enum\(\["approved", "pending_review", "needs_detail", "rejected", "any"\]\)\.default\("approved"\)/.test(server) && /const status = input\.status \?\? "approved";/.test(readSrc) &&
      /trust_labels: trust\.labels/.test(readSrc) && /labelsFor\(\{/.test(readSrc) && /source_check: z\.enum\(\["confirmed", "stale", "unreachable", "never"\]\)/.test(server) && /not_checked_since/.test(readSrc));
  ok("\"already known\" never confirms a name flagged as a person's", /lower\(s\.name\) = lower\(\$\{r\.name\}\) and not \$\{FLAGGED_PERSON\}/.test(read("lib/server/repo/mcp-proposals.ts")));
  const props = read("lib/server/repo/mcp-proposals.ts");
  ok("waiting proposals oldest first; the cap of 100 under a lock per actor", /p\.created_at asc/.test(props) && /pg_advisory_xact_lock\(hashtext\('mcp_proposals:' \|\| \$\{p\.actor\}\)\)/.test(props) && /db\.transaction\(async \(tx\) => createLocked\(/.test(props));
  ok("an approved event joins a prepared digest first, and a taken-out item does not count toward the cap",
    /const live = have\.filter\(\(i\) => !i\.removed\);/.test(write) && /if \(live\.length >= DIGEST_EDITION_MAX\)/.test(write) && /Math\.min\(0, \.\.\.have\.map\(\(i\) => i\.position\)\) - 1/.test(write));
  ok("the call log counts rows inside an answer's list", /for \(const key of \["results", "weeks", "groups", "questions"\]\)/.test(server));
  ok("costs: AI on Pasadena days, Twilio's UTC days said, useful answers and the cost per one",
    /toDateTime\('\$\{from\} 00:00:00', '\$\{TZ\}'\)/.test(read("lib/server/mcp/costs.ts")) && /days: \{ sms: "UTC days/.test(read("lib/server/mcp/costs.ts")) &&
      /useful_answers: helped/.test(server) && /cost_per_useful_answer:/.test(server));
  ok("the server instructions are short and factual (under 4,096 characters, names the proposal flow)", (() => {
    const at = server.indexOf("const INSTRUCTIONS = ["); const body = server.slice(at, server.indexOf('].join(" ")', at));
    return body.length < 4096 && /proposal/.test(body) && !/\bNever change\b|\bCall approve_proposal or reject_proposal only after\b/.test(body);
  })());
  ok("a proposal keeps the record as the agent saw it, and a rejection its reason (0075)",
    /insert into mcp_proposals \(actor, kind, share_id, payload, source_url, before\)/.test(read("lib/server/repo/mcp-proposals.ts")) && /decision_note = \$\{cleanText\(b\.reason, 300\)\}/.test(write) &&
      /ADD COLUMN IF NOT EXISTS before jsonb/.test(read("drizzle/0075_proposal_before.sql")));
  ok("revoke ends an app's every session (its client ids), and the MCP page groups connections by admin and app",
    /client_id in \(select jsonb_array_elements_text\(\$\{list\}::jsonb\)\)/.test(write) && /array_agg\(distinct t\.client_id\) as client_ids/.test(read("lib/server/repo/admin-read.ts")));
  ok("what went wrong says since when the oldest held answer has waited (the daily brief's \"oldest\")", /oldest_held_since:/.test(readSrc) && /min\(created_at\) as oldest/.test(readSrc));
  ok("the weekly review's numbers: answers split by the week asked; a digest week's totals in one place",
    /helped_yes: n\(r\.helped_yes\), helped_no: n\(r\.helped_no\)/.test(readSrc) && /cross join lateral/.test(readSrc) &&
      /const totals = \{\s+groups: groups\.length,\s+families_texted:/.test(server) && /return \{ totals, \.\.\.week_, groups: shaped \};/.test(server) && /detail: z\.enum\(\["summary", "items"\]\)\.default\("summary"\)/.test(server));
  /* The senior pass (20 Nov). */
  ok("a read tool runs in a read-only transaction with a 10 s statement limit; costs, which wait on others, outside",
    /accessMode: "read only"/.test(server) && /set local statement_timeout = '\$\{READ_LIMIT\}'/.test(server) && /const READ_LIMIT = "10s"/.test(server) &&
      /withinDeadline\(config\.readOnly && !config\.outside \? asRead\(/.test(server) && /outside: true,/.test(server));
  ok("a place count of 1 or 2 is \"<3\"", /v > 0 && v < 3 \? "<3"/.test(server) && /fewerThanThree\(await readResource\(db\(\), "demand_places"/.test(server));
  ok("revoking an admin ends their Claude connections at once", /update mcp_tokens set revoked_at = now\(\) where admin_user = \$\{name\}/.test(read("scripts/admin-user.mjs")));
  ok("the refresh checks the admin before its transaction, not while holding the row lock",
    repoSrc.indexOf("const active = await isActiveAdmin(String(owner.data.admin_user))") > -1 &&
      repoSrc.indexOf("const active = await isActiveAdmin(String(owner.data.admin_user))") < repoSrc.indexOf("db.transaction(async (tx): Promise<RefreshOutcome>"));
  const sql0071 = read("drizzle/0071_record_source.sql");
  ok("migration 0071: additive source columns on records, in the journal after 0070",
    /ADD COLUMN IF NOT EXISTS source_url text/.test(sql0071) && !/DROP|RENAME/i.test(sql0071.replace(/^--.*$/gm, "")) &&
      /"tag": "0070_pando_mcp",[\s\S]*"tag": "0071_record_source"/.test(read("drizzle/meta/_journal.json")));
  const sql = read("drizzle/0070_pando_mcp.sql");
  ok("migration 0070: six tables, RLS on each, MCP off until switched on", (sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length === 6 && (sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length === 6 && !/'mcp_enabled'/.test(sql));
  const journal = read("drizzle/meta/_journal.json");
  ok("in the journal after 0069", /"tag": "0069_digest_approval",[\s\S]*"tag": "0070_pando_mcp"/.test(journal));
  const shell = read("components/admin/Shell.tsx");
  ok("the admin has Proposals (counted) and Pando MCP", /href: "\/admin\/proposals"[\s\S]{0,120}count: \(o\) => o\.proposals\?\.open/.test(shell) && /href: "\/admin\/mcp"/.test(shell));
}

console.log("\n=== critical alerts to Slack (20 Nov) ===");
{
  const al = (await import(`../lib/alerts.ts?v=${Math.random()}`)) as typeof import("../lib/alerts.ts");
  const none = { failedJobs: [], stuckJobs: [], texts: { out: 0, undelivered: 0 }, digest: null };
  ok("nothing broke, nothing is said", al.criticalAlerts(none, "2026-11-21").length === 0);
  const a = al.criticalAlerts({
    failedJobs: [{ job: "digest_reminders", failed: 3, sends: true }, { job: "expire_memory", failed: 0, sends: false }],
    stuckJobs: [], texts: { out: 20, undelivered: 6 }, digest: { awaitingApproval: 2, failedGroups: 0 },
  }, "2026-11-21");
  ok("a failed job that texts parents is critical, one that does not is high; owner QuitCode",
    a.find((x) => x.key.startsWith("job_failed:digest_reminders"))?.severity === "critical" && a.find((x) => x.key.startsWith("job_failed:expire_memory"))?.severity === "high" &&
      a.filter((x) => x.key.startsWith("job_failed")).every((x) => x.owner === "QuitCode"));
  ok("undelivered texts: at least 5 and a fifth of what went out", a.some((x) => x.key.startsWith("texts_undelivered")) &&
    !al.criticalAlerts({ ...none, texts: { out: 100, undelivered: 6 } }, "d").length && !al.criticalAlerts({ ...none, texts: { out: 4, undelivered: 4 } }, "d").length);
  ok("a Saturday digest still unapproved is Janet's, with her yes needed and the Digests page",
    a.some((x) => x.key.startsWith("digest_unapproved") && x.owner === "Janet" && x.approval && x.page === "/admin/digests"));
  const now = new Date("2026-11-21T18:00:00Z");
  ok("said once: the same alert waits six hours before it is said again",
    al.alertsDue(a, { [a[0].key]: "2026-11-21T15:00:00Z" }, now).length === a.length - 1 && al.alertsDue(a, { [a[0].key]: "2026-11-21T11:00:00Z" }, now).length === a.length);
  const text = al.alertsText(a, "https://pando.is/");
  ok("the message: most severe first, who is affected, who can fix it, Janet's yes, a link into the admin — no phone, no name",
    text.indexOf(":rotating_light:") < text.indexOf(":warning:") && /Who is affected:/.test(text) && /Who can fix it: QuitCode/.test(text) &&
      /Janet's yes needed: yes/.test(text) && /<https:\/\/pando\.is\/admin\/digests\|Open in admin>/.test(text) && !/\d{3}[-. ]\d{3}[-. ]\d{4}/.test(text));
  const srv = read("lib/server/alerts.ts");
  ok("the job: inert without a Slack webhook, nothing before the settings table, remembered only after Slack took it, never a parent's data",
    /note: "not_configured"/.test(srv) && /note: "not_migrated"/.test(srv) && srv.indexOf("await fetch(url") < srv.indexOf("insert into app_settings (key, value, updated_by, updated_at) values ('alerts_said'") &&
      !/phone|first_name|question_text|person_id/.test(srv.replace(/\/\*[\s\S]*?\*\//g, "")) && /SLACK_ALERTS_WEBHOOK_URL/.test(srv) && /isSlackWebhookUrl\(own\)/.test(srv));
}

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);
