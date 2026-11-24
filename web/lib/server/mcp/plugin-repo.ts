import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { hasContactDetail } from "@/lib/contact-details";
import { withDb } from "@/lib/server/db";
import { PANDO_DECIDE_TOOLS, PANDO_TOOLS, PANDO_TOOL_NAMES, PANDO_WRITE_TOOLS, ownToolName } from "@/lib/mcp/tool-names";

/**
 * The Pando plugin, changed by the client without QuitCode (23 Nov). The developer: *"має бути можливість
 * внести зміни в існуючих сабагентів, створити сабагента, скіл, додати можливо мсп, тобто щоб клієнт міг
 * вносити зміни без нашої допомоги"*. The Agent builder reads the plugin (`read_plugin`) and proposes a
 * change (`propose_plugin_change`): a skill, an agent or a connector — new, changed or removed. An admin
 * reads it on /admin/proposals as lines removed and added, and *Commit to plugin* commits it to the
 * plugin's branch (no pull request — the 20 Nov decision) with the version raised, so Cowork's sync and
 * Claude Code's update bring it to everyone's Claude.
 *
 * What makes that safe to hand to a non-technical admin is what this file refuses, whatever the
 * proposal says:
 *
 *  - **Pando writes every file's frontmatter** from plain fields. A skill gets a name, a description and
 *    an optional argument hint; an agent a name, a description, its tools and a model. No hooks, no
 *    `mcpServers`, no permission mode — nothing that runs code on an admin's computer.
 *  - **An agent never gets Bash, Write, Edit or NotebookEdit** (`disallowedTools`, in every agent). Its
 *    exact list is `pando-tools:`, each tool by its own name — read tools, Pando's tools
 *    (`search_records`), and the tools of connectors this plugin declares — held by the plugin's hook
 *    (`hooks/agent-tools.mjs`) on any connection. Not Claude's `tools:` (24 Nov): that needs the long name
 *    `mcp__<connection>__<tool>`, which changes with how Pando was connected, and an agent whose list
 *    named another connection got no tools and was refused. With `account_connectors` (an agent that reads
 *    Gmail, whose tool names are not known ahead) it also gets `pando-accounts: true` and every Pando read
 *    tool; Pando's changes only the ones named.
 *  - **A connector is a remote MCP server at an `https://` address**: a public host, no key in the address,
 *    no headers, no local command. Each person signs in to it in Claude, as with Pando.
 *  - **Locked:** the `pando` connector, the shared safety rules (no tool path reaches `shared/`), and the
 *    pieces that make further changes possible (the `customize` workflow, the `agent-builder` agent, the
 *    `pando-data` catalogue) cannot be removed — they can be changed.
 *  - **Text a skill or agent carries:** no phone number or email, and never a step that approves,
 *    rejects or commits — those happen only on /admin/proposals.
 *  - **The file must not have changed since the proposal.** The proposal keeps the blob it was made
 *    against (`base_sha`); a commit on top of a different file is refused, and the agent proposes again.
 *
 * Env: PLUGIN_GITHUB_TOKEN (Contents read/write on the plugin repo only), PLUGIN_GITHUB_REPO
 * (`owner/name`), PLUGIN_GITHUB_BRANCH (default `main`), GITHUB_API_BASE (tests only).
 */

export const PLUGIN_NAME = /^[a-z][a-z0-9-]{2,40}$/;
const CONNECTOR_NAME = /^[a-z][a-z0-9-]{1,30}$/;
const MANIFEST = ".claude-plugin/plugin.json";
const MCP_JSON = ".mcp.json";
const MAX_INSTRUCTIONS = 40_000;
const MODELS = ["sonnet", "opus", "haiku", "inherit"] as const;
/** Built-in tools an agent may have: they read. */
const SAFE_BUILTINS = ["Read", "Grep", "Glob", "WebFetch", "WebSearch"];
/** Built-in tools no agent of this plugin gets: they change files or run commands on the admin's computer. */
const NEVER = ["Bash", "Write", "Edit", "NotebookEdit"];
/** Removing these would take away the plugin's own way of changing itself, or its rules. */
export const LOCKED: Record<PluginTarget, string[]> = { skill: ["customize", "pando-data"], agent: ["agent-builder"], connector: ["pando"] };
/**
 * Words a skill or agent the client proposes never carries: the tools that decide, and the old flags. Since
 * 24 Nov a proposal is decided in the chat — by the person, in the main conversation, by the rule in the
 * plugin's `shared/safety.md`, which no proposal can reach. A proposed skill that scripts a decision
 * ("then approve it") would take the person out of it, so it is refused, as an agent with the tool is.
 */
const DECIDING = /\b(approve_proposal|reject_proposal|save_skill|admin_said_(yes|no|save))\b/;

export type PluginTarget = "skill" | "agent" | "connector";
export type PluginAction = "create" | "update" | "delete";

export interface PluginDraft {
  target: PluginTarget;
  action: PluginAction;
  name: string;
  description?: string;
  instructions?: string;
  argument_hint?: string;
  tools?: string[];
  model?: string;
  account_connectors?: boolean;
  url?: string;
}

const yaml = (v: string) => JSON.stringify(v);
const oneLine = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const isPandoWrite = (t: string) => (PANDO_WRITE_TOOLS as readonly string[]).includes(ownToolName(t));
/** A plugin connector's tool: `notion:search`, or the long name this plugin's connectors had (`mcp__plugin_pando_notion__search`). */
function connectorTool(t: string): { connector: string; tool: string } | null {
  const m = /^([a-z][a-z0-9-]{1,30}):([A-Za-z0-9_-]{1,80})$/.exec(t) ?? /^mcp__plugin_pando_([a-z][a-z0-9-]{1,30})__([A-Za-z0-9_-]{1,80})$/.exec(t);
  return m && m[1] !== "pando" ? { connector: m[1], tool: m[2] } : null;
}

function checkText(description: string, body: string): string | null {
  if (description.length < 20 || description.length > 1024) return "The description is one line, 20–1024 characters: what it does and when to use it.";
  if (body.length < 40) return "The instructions are too short.";
  if (body.length > MAX_INSTRUCTIONS) return `The instructions are over ${MAX_INSTRUCTIONS} characters.`;
  if (/^---\s*$/.test(body.split("\n")[0] ?? "")) return "Write the instructions only; Pando writes the frontmatter.";
  /* It goes to every Pando admin's Claude: no parent's phone or email in it (review, 20 Nov). */
  if (hasContactDetail(body) || hasContactDetail(description)) return "It carries a phone number or email. The plugin holds instructions, never a person's details.";
  if (DECIDING.test(`${description}\n${body}`)) return "It names a step that approves, rejects or saves. A proposal is decided only by the person's own word in the conversation, and a change to the plugin only on pando.is/admin/proposals — never as a step of a skill or an agent.";
  return null;
}

/** A skill's SKILL.md: frontmatter Pando writes, then the instructions. */
export function buildSkillFile(d: PluginDraft): string | { refused: string } {
  if (!PLUGIN_NAME.test(d.name)) return { refused: "A name is 3–41 lowercase letters, digits or hyphens, starting with a letter." };
  const description = oneLine(d.description);
  const body = (d.instructions ?? "").replace(/\r\n/g, "\n").trim();
  const bad = checkText(description, body);
  if (bad) return { refused: bad };
  const hint = oneLine(d.argument_hint);
  if (hint.length > 120) return { refused: "The argument hint is at most 120 characters." };
  return `---\nname: ${d.name}\ndescription: ${yaml(description)}\n${hint ? `argument-hint: ${yaml(hint)}\n` : ""}---\n\n${body}\n`;
}

/**
 * An agent's file. `connectors` are the connector names the plugin declares (from .mcp.json): an agent
 * may name `<connector>:<tool>` only for those.
 */
export function buildAgentFile(d: PluginDraft, connectors: readonly string[]): string | { refused: string } {
  if (!PLUGIN_NAME.test(d.name)) return { refused: "A name is 3–41 lowercase letters, digits or hyphens, starting with a letter." };
  const description = oneLine(d.description);
  const body = (d.instructions ?? "").replace(/\r\n/g, "\n").trim();
  const bad = checkText(description, body);
  if (bad) return { refused: bad };
  const model = d.model ?? "sonnet";
  if (!(MODELS as readonly string[]).includes(model)) return { refused: `model is one of ${MODELS.join(", ")}.` };
  const tools = [...new Set((d.tools ?? []).map((t) => t.trim()).filter(Boolean))];
  if (tools.length > 60) return { refused: "At most 60 tools." };
  /* Each tool by its own name (24 Nov): the long name of a Pando tool is taken whatever connection it names. */
  const own: string[] = [];
  for (const t of tools) {
    if (NEVER.includes(t)) return { refused: `${t} is never given to a Pando agent: it changes files or runs commands on the admin's computer.` };
    if (SAFE_BUILTINS.includes(t)) {
      own.push(t);
      continue;
    }
    const outside = connectorTool(t);
    if (outside) {
      if (!connectors.includes(outside.connector)) return { refused: `The plugin has no connector ${outside.connector}; propose the connector first.` };
      if (outside.tool in PANDO_TOOLS) return { refused: `${outside.connector}'s ${outside.tool} has the name of a Pando tool; an agent's list holds tools by name, so it cannot tell them apart.` };
      own.push(outside.tool);
      continue;
    }
    const pt = ownToolName(t);
    if (/^[a-z][a-z0-9_]{1,40}$/.test(pt)) {
      if (!(pt in PANDO_TOOLS)) return { refused: `Pando has no tool ${pt}.` };
      if ((PANDO_DECIDE_TOOLS as readonly string[]).includes(pt)) return { refused: `${pt} is never given to an agent: a proposal is decided by the person, in the main conversation.` };
      own.push(pt);
      continue;
    }
    return { refused: `${t} is not a tool a Pando agent may have. Use ${SAFE_BUILTINS.join(", ")}, Pando's tools by name (search_records), or a plugin connector's as <connector>:<tool>.` };
  }
  if (!d.account_connectors && own.length === 0) return { refused: "Name the agent's tools (or set account_connectors for one that reads Gmail and other connected accounts)." };
  /* One that reads connected accounts keeps what the deny list gave it before: the read tools and every Pando read. */
  const list = d.account_connectors
    ? [...new Set([...SAFE_BUILTINS, ...PANDO_TOOL_NAMES.filter((t) => PANDO_TOOLS[t] === "read"), ...own])]
    : [...new Set(own)];
  const lines = [`disallowedTools: ${NEVER.join(", ")}`, `pando-tools: ${list.join(", ")}`, ...(d.account_connectors ? ["pando-accounts: true"] : [])];
  return `---\nname: ${d.name}\ndescription: ${yaml(description)}\n${lines.join("\n")}\nmodel: ${model}\n---\n\n${body}\n`;
}

/** A connector's address: https, a public host by name, nothing secret in it. */
export function connectorUrlRefusal(raw: string | undefined): string | null {
  const url = (raw ?? "").trim();
  if (url.length > 300) return "The address is at most 300 characters.";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "The connector's address is not a web address.";
  }
  if (u.protocol !== "https:") return "A connector is reached over https only.";
  if (u.username || u.password || u.search || u.hash) return "No sign-in, key or query in the address: each person signs in to the connector in Claude.";
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || host === "localhost" || /\.(local|localhost|internal|lan|home|test)$/.test(host) || !host.includes(".")) {
    return "A connector is a public service on the internet, named by its host — not an address in numbers or a local machine.";
  }
  return null;
}

/**
 * Connectors QuitCode keeps read-only (23 Nov, the developer: Supabase and PostHog in the plugin "тільки на
 * читання, без зміни даних"). Their read-only switch is a query parameter in the address
 * (`read_only=true`, `readonly=true`), so the address is what keeps them read-only: no proposal may
 * change it, and no connector may be added for the same services, which would arrive with write tools.
 * Removing one only takes access away, so that stays possible.
 */
export const READ_ONLY_CONNECTORS: Record<string, string> = { supabase: "mcp.supabase.com", posthog: "mcp.posthog.com" };

/** .mcp.json after a connector change: the servers object, sorted, `pando` first. */
export function buildMcpJson(current: string, d: PluginDraft): string | { refused: string } {
  if (!CONNECTOR_NAME.test(d.name)) return { refused: "A connector's name is 2–31 lowercase letters, digits or hyphens." };
  if (d.name === "pando") return { refused: "The Pando connector is the plugin's own; it is not changed here." };
  if (d.action !== "delete" && d.name in READ_ONLY_CONNECTORS) {
    return { refused: `The ${d.name} connector is kept read-only by QuitCode; its address is not changed from here. It can be removed.` };
  }
  if (d.action !== "delete") {
    let host = "";
    try {
      host = new URL((d.url ?? "").trim()).hostname.toLowerCase();
    } catch {
      /* connectorUrlRefusal says why */
    }
    const same = Object.entries(READ_ONLY_CONNECTORS).find(([, h]) => host === h || host.endsWith(`.${h}`));
    if (same) return { refused: `${same[1]} is in the plugin already as the read-only ${same[0]} connector; a second connector to it would not be read-only.` };
  }
  let parsed: { mcpServers?: Record<string, unknown> };
  try {
    parsed = JSON.parse(current) as { mcpServers?: Record<string, unknown> };
  } catch {
    return { refused: "The plugin's .mcp.json is not valid JSON; QuitCode has to fix it first." };
  }
  const servers = { ...(parsed.mcpServers ?? {}) };
  const exists = d.name in servers;
  if (d.action === "create" && exists) return { refused: `A connector named ${d.name} is already in the plugin; propose an update.` };
  if (d.action !== "create" && !exists) return { refused: `The plugin has no connector named ${d.name}.` };
  if (d.action === "delete") delete servers[d.name];
  else {
    const bad = connectorUrlRefusal(d.url);
    if (bad) return { refused: bad };
    servers[d.name] = { type: "http", url: (d.url ?? "").trim() };
  }
  /* The file's own order, `pando` first, a new connector last (23 Nov, the lab walk: sorting by name
     moved untouched connectors, and the admin read their lines as removed and added). */
  const ordered = Object.fromEntries(Object.entries(servers).sort(([a], [b]) => (a === "pando" ? -1 : b === "pando" ? 1 : 0)));
  return `${JSON.stringify({ ...parsed, mcpServers: ordered }, null, 2)}\n`;
}

/**
 * 0.1.0 → 0.1.1. Anything that is not plain x.y.z is null and the commit is refused (review, 20 Nov): a
 * guess could go lower than the current version, and Cowork would never bring the change.
 */
export function nextPatch(version: unknown): string | null {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim()) : null;
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : null;
}

export const pathOf = (target: PluginTarget, name: string) => (target === "skill" ? `skills/${name}/SKILL.md` : target === "agent" ? `agents/${name}.md` : MCP_JSON);

/* ── GitHub ─────────────────────────────────────────────────────────────── */

function config() {
  const token = process.env.PLUGIN_GITHUB_TOKEN?.trim();
  const repo = process.env.PLUGIN_GITHUB_REPO?.trim();
  if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { token, repo, branch: process.env.PLUGIN_GITHUB_BRANCH?.trim() || "main", api: (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/+$/, "") };
}
type Repo = NonNullable<ReturnType<typeof config>>;

export const pluginRepoConfigured = () => config() !== null;
const NOT_CONFIGURED = "Changing the plugin is not configured on this Pando server (PLUGIN_GITHUB_TOKEN, PLUGIN_GITHUB_REPO).";

class GitHubError extends Error {
  constructor(readonly status: number) {
    super(`GitHub answered ${status}`);
  }
}

async function gh<T>(c: Repo, method: string, path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`${c.api}/repos/${c.repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  /* A missing file is an answer for a read; for a write it is a failure (review, 20 Nov). */
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new GitHubError(res.status);
  return (await res.json()) as T;
}

const branchPath = (c: Repo) => c.branch.split("/").map(encodeURIComponent).join("/");
const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

async function head(c: Repo): Promise<string | null> {
  return (await gh<{ object: { sha: string } }>(c, "GET", `/git/ref/heads/${branchPath(c)}`))?.object.sha ?? null;
}

/** Every file path in the plugin at a commit (one tree request). */
async function tree(c: Repo, commitSha: string): Promise<string[]> {
  const commit = await gh<{ tree: { sha: string } }>(c, "GET", `/git/commits/${commitSha}`);
  if (!commit?.tree?.sha) throw new GitHubError(502);
  const t = await gh<{ tree: Array<{ path: string; type: string }> }>(c, "GET", `/git/trees/${commit.tree.sha}?recursive=1`);
  return (t?.tree ?? []).filter((e) => e.type === "blob").map((e) => e.path);
}

async function fileAt(c: Repo, path: string, at: string): Promise<{ text: string; sha: string } | null> {
  const f = await gh<{ content: string; sha: string }>(c, "GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${at}`);
  return f ? { text: decode(f.content), sha: f.sha } : null;
}

const connectorNames = (mcp: string | undefined) => {
  try {
    return Object.keys((JSON.parse(mcp ?? "{}") as { mcpServers?: object }).mcpServers ?? {});
  } catch {
    return [];
  }
};
const describe = (text: string) => /^description:\s*(.+)$/m.exec(text)?.[1]?.replace(/^"(.*)"$/, "$1") ?? null;
const failure = (err: unknown) =>
  err instanceof GitHubError && (err.status === 401 || err.status === 403) ? "GitHub refused Pando's token for the plugin repo." : "GitHub did not answer just now; try again.";

/** What the plugin holds now: its version, skills and agents (with descriptions), connectors. */
export async function readPluginIndex(): Promise<Record<string, unknown> | { refused: string }> {
  const c = config();
  if (!c) return { refused: NOT_CONFIGURED };
  try {
    const at = await head(c);
    if (!at) return { refused: `The plugin repo has no branch ${c.branch}.` };
    const paths = await tree(c, at);
    const skills = paths.map((p) => /^skills\/([^/]+)\/SKILL\.md$/.exec(p)?.[1]).filter((n): n is string => !!n);
    const agents = paths.map((p) => /^agents\/([^/]+)\.md$/.exec(p)?.[1]).filter((n): n is string => !!n);
    const read = async (p: string) => (await fileAt(c, p, at))?.text ?? "";
    const [manifest, mcp, ...texts] = await Promise.all([read(MANIFEST), read(MCP_JSON), ...skills.map((n) => read(pathOf("skill", n))), ...agents.map((n) => read(pathOf("agent", n)))]);
    const servers = (() => {
      try {
        return (JSON.parse(mcp) as { mcpServers?: Record<string, { url?: string }> }).mcpServers ?? {};
      } catch {
        return {};
      }
    })();
    let version: string | null = null;
    try {
      version = (JSON.parse(manifest) as { version?: string }).version ?? null;
    } catch {
      /* stays null */
    }
    return {
      version,
      skills: skills.map((name, k) => ({ name, description: describe(texts[k]), may_remove: !LOCKED.skill.includes(name) })),
      agents: agents.map((name, k) => ({ name, description: describe(texts[skills.length + k]), may_remove: !LOCKED.agent.includes(name) })),
      /* What a proposal may do to each (23 Nov, the lab check: supabase and posthog read "may_change"
         though buildMcpJson refuses any change to them). */
      connectors: Object.entries(servers).map(([name, s]) => ({
        name,
        url: s?.url ?? null,
        may_change: !LOCKED.connector.includes(name) && !(name in READ_ONLY_CONNECTORS),
        may_remove: !LOCKED.connector.includes(name),
        ...(name in READ_ONLY_CONNECTORS ? { read_only: true } : {}),
      })),
    };
  } catch (err) {
    return { refused: failure(err) };
  }
}

/** One skill's, agent's or the connectors' file as it is now. */
export async function readPluginFile(target: PluginTarget, name: string): Promise<{ path: string; text: string } | { refused: string }> {
  const c = config();
  if (!c) return { refused: NOT_CONFIGURED };
  if (target !== "connector" && !PLUGIN_NAME.test(name)) return { refused: "Not a name a skill or agent can have." };
  try {
    const at = await head(c);
    if (!at) return { refused: `The plugin repo has no branch ${c.branch}.` };
    const f = await fileAt(c, pathOf(target, name), at);
    return f ? { path: pathOf(target, name), text: f.text } : { refused: `The plugin has no ${target} named ${name}.` };
  } catch (err) {
    return { refused: failure(err) };
  }
}

/** What a proposal keeps: the change as Pando will commit it, against the file it was made on. */
export interface PreparedChange {
  target: PluginTarget;
  action: PluginAction;
  name: string;
  path: string;
  draft: PluginDraft;
  before_text: string | null;
  after_text: string | null;
  base_sha: string | null;
  /** For the admin: what this change lets the plugin do, in plain words. */
  warnings: string[];
}

function render(d: PluginDraft, current: string | null, connectors: readonly string[]): string | null | { refused: string } {
  if (d.action === "delete" && d.target !== "connector") return null;
  if (d.target === "skill") return buildSkillFile(d);
  if (d.target === "agent") return buildAgentFile(d, connectors);
  return buildMcpJson(current ?? "{}", d);
}

function warningsFor(d: PluginDraft, connectors: readonly string[]): string[] {
  const w: string[] = [];
  if (d.action === "delete") return [`Removes the ${d.target} ${d.name} from everyone's Claude with the next update.`];
  if (d.target === "agent") {
    const writes = (d.tools ?? []).filter(isPandoWrite).map(ownToolName);
    if (writes.length) w.push(`This agent can propose changes in Pando (${writes.join(", ")}); each still waits for an admin.`);
    if (d.account_connectors) w.push("This agent can use every account connected to Claude (Gmail, Calendar and others) and every read tool.");
    const outside = [...new Set((d.tools ?? []).map((t) => connectorTool(t)?.connector).filter((n): n is string => !!n && connectors.includes(n)))];
    if (outside.length) w.push(`This agent uses the connector${outside.length === 1 ? "" : "s"} ${outside.join(", ")}.`);
  }
  if (d.target === "connector") {
    let host = d.url ?? "";
    try {
      host = new URL(host).host;
    } catch {
      /* the address as given */
    }
    w.push(`Adds the outside service ${host} to everyone's Claude; each person signs in to it themselves, and what it can see is up to that service.`);
  }
  return w;
}

/** Checks a change against the plugin as it is now and renders it, for the proposal (and the admin). */
export async function preparePluginChange(d: PluginDraft): Promise<PreparedChange | { refused: string }> {
  const c = config();
  if (!c) return { refused: NOT_CONFIGURED };
  if (d.target !== "connector" && !PLUGIN_NAME.test(d.name)) return { refused: "A name is 3–41 lowercase letters, digits or hyphens, starting with a letter." };
  if (d.action === "delete" && LOCKED[d.target].includes(d.name)) return { refused: `${d.name} cannot be removed: the plugin needs it to keep its rules and to change itself. It can be changed.` };
  try {
    const at = await head(c);
    if (!at) return { refused: `The plugin repo has no branch ${c.branch}.` };
    const path = pathOf(d.target, d.name);
    const [file, mcp] = await Promise.all([fileAt(c, path, at), fileAt(c, MCP_JSON, at)]);
    if (d.target !== "connector") {
      if (d.action === "create" && file) return { refused: `The plugin already has a ${d.target} named ${d.name}; propose an update.` };
      if (d.action !== "create" && !file) return { refused: `The plugin has no ${d.target} named ${d.name}.` };
    }
    const connectors = connectorNames(mcp?.text);
    const after = render(d, file?.text ?? null, connectors);
    if (after && typeof after === "object") return after;
    if (after !== null && file && after === file.text.replace(/\r\n/g, "\n")) return { refused: "That is what the plugin already has; nothing would change." };
    return { target: d.target, action: d.action, name: d.name, path, draft: d, before_text: file?.text ?? null, after_text: after, base_sha: file?.sha ?? null, warnings: warningsFor(d, connectors) };
  } catch (err) {
    return { refused: failure(err) };
  }
}

export type CommitOutcome = { committed: true; path: string; version: string; commit: string; sha256: string | null; warning?: string } | { refused: string };

/**
 * Commits one approved change for `actor` (called by /api/admin/action on *Commit to plugin*): the file
 * must still be the one the proposal was made on, the change is rendered again under today's rules and
 * must equal what the admin read, and it lands in one commit with the version raised; retried once if
 * the branch moved meanwhile.
 */
export async function commitPluginChange(actor: string, p: { draft: PluginDraft; base_sha: string | null; after_text: string | null }): Promise<CommitOutcome> {
  const c = config();
  if (!c) return { refused: NOT_CONFIGURED };
  const d = p.draft;
  if (!d || !["skill", "agent", "connector"].includes(d.target) || !["create", "update", "delete"].includes(d.action)) return { refused: "This proposal is not a plugin change Pando can read." };
  if (d.action === "delete" && LOCKED[d.target].includes(d.name)) return { refused: `${d.name} cannot be removed.` };
  const path = pathOf(d.target, d.name);
  let done: { version: string; commit: string; after: string | null } | null = null;
  try {
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      const at = await head(c);
      if (!at) return { refused: `The plugin repo has no branch ${c.branch}.` };
      const [paths, manifest, mcp, file] = await Promise.all([tree(c, at), fileAt(c, MANIFEST, at), fileAt(c, MCP_JSON, at), fileAt(c, path, at)]);
      if ((file?.sha ?? null) !== p.base_sha) return { refused: `The plugin's ${path} changed after this was proposed. Reject it; the Agent builder can propose it again against the plugin as it is now.` };
      if (!manifest) return { refused: "The plugin repo has no .claude-plugin/plugin.json." };
      const after = render(d, file?.text ?? null, connectorNames(mcp?.text));
      if (after && typeof after === "object") return { refused: `Today's rules refuse it: ${after.refused}` };
      /* What the admin read is what is committed. */
      if (after !== p.after_text) return { refused: "What would be committed is not what was shown. Reject it, and propose it again." };
      const plugin = JSON.parse(manifest.text) as Record<string, unknown>;
      const version = nextPatch(plugin.version);
      if (!version) return { refused: "The plugin's version is not x.y.z; QuitCode has to set it before the plugin can be changed." };
      /* A skill is a folder: removing it removes every file in it. */
      const removed = d.action !== "delete" || d.target === "connector" ? [] : d.target === "skill" ? paths.filter((k) => k.startsWith(`skills/${d.name}/`)) : [path];
      const commit = await gh<{ tree: { sha: string } }>(c, "GET", `/git/commits/${at}`);
      /* Without the branch's own tree as the base, the new tree would hold only these files (review round 2). */
      if (!commit?.tree?.sha) return { refused: "GitHub did not return the plugin's current commit; try again." };
      const t = await gh<{ sha: string }>(c, "POST", "/git/trees", {
        base_tree: commit.tree.sha,
        tree: [
          ...(after !== null ? [{ path, mode: "100644", type: "blob", content: after }] : []),
          ...removed.map((r) => ({ path: r, mode: "100644", type: "blob", sha: null })),
          { path: MANIFEST, mode: "100644", type: "blob", content: `${JSON.stringify({ ...plugin, version }, null, 2)}\n` },
        ],
      });
      const verb = d.action === "create" ? "Add" : d.action === "update" ? "Update" : "Remove";
      const made = await gh<{ sha: string }>(c, "POST", "/git/commits", { message: `${verb} ${d.target} ${d.name} (approved by ${actor} on /admin/proposals)\n\nPlugin ${version}.`, tree: t?.sha, parents: [at] });
      try {
        await gh(c, "PATCH", `/git/refs/heads/${branchPath(c)}`, { sha: made?.sha, force: false });
        done = { version, commit: String(made?.sha), after };
      } catch (err) {
        if (err instanceof GitHubError && err.status === 422 && attempt === 0) continue;
        throw err;
      }
    }
  } catch (err) {
    console.error("[mcp] plugin commit failed", { error: err instanceof GitHubError ? `github ${err.status}` : err instanceof Error ? err.constructor.name : "unknown" });
    return { refused: failure(err) };
  }
  if (!done) return { refused: "The plugin repo kept changing; try again." };
  const result = done;
  /* What was committed, so the admin can compare it with what they read. */
  const sha256 = result.after === null ? null : createHash("sha256").update(result.after).digest("hex");
  const record = () =>
    withDb(async (db) =>
      db.transaction(async (tx) => {
        if (d.target === "skill") {
          if (d.action === "delete") await tx.execute(sql`delete from plugin_skills where name = ${d.name}`);
          else
            await tx.execute(sql`
              insert into plugin_skills (name, description, created_by, updated_by, commit_sha, version)
              values (${d.name}, ${oneLine(d.description)}, ${actor}, ${actor}, ${result.commit}, ${result.version})
              on conflict (name) do update set description = excluded.description, updated_by = excluded.updated_by,
                updated_at = now(), commit_sha = excluded.commit_sha, version = excluded.version
            `);
        }
        await tx.execute(sql`
          insert into audit_log (actor, action, resource, resource_id, before, after)
          values (${actor}, 'plugin.commit', 'plugin', null, null,
                  ${JSON.stringify({ target: d.target, action: d.action, name: d.name, version: result.version, commit: result.commit, sha256 })}::jsonb)
        `);
        return true;
      }),
    );
  /* The commit is already in the plugin: recording it is retried once, and a failure is said (review, 20 Nov). */
  const recorded = (await record()).persisted || (await record()).persisted;
  console.info("[mcp] plugin committed", { target: d.target, action: d.action, recorded });
  return {
    committed: true,
    path,
    version: result.version,
    commit: result.commit,
    sha256,
    ...(recorded ? {} : { warning: `Committed (${result.commit.slice(0, 12)}) but Pando could not record it in its log.` }),
  };
}
