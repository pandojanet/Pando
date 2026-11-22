import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { hasContactDetail } from "@/lib/contact-details";
import { withDb } from "@/lib/server/db";

/**
 * `save_skill` (20 Nov): the diagram's Agent builder saves a skill "through Pando MCP" into GitHub
 * `pando-plugin`, and the plugin's next update brings it to everyone's Claude. The developer chose no
 * pull request — one build mechanism, committed straight to the plugin's branch, fixed afterwards if
 * something is wrong.
 *
 * One mechanism, so every saved skill has the same shape: Pando writes the SKILL.md itself from a
 * name, a one-line description and the instructions — the agent cannot add frontmatter (tools, hooks,
 * models) or write anywhere but `skills/<name>/SKILL.md`. The same commit raises the plugin's patch
 * version, because Cowork's org sync and Claude Code's update both key on it. A skill QuitCode
 * maintains (in the plugin, not in `plugin_skills`) is never overwritten.
 *
 * Env: PLUGIN_GITHUB_TOKEN (a fine-grained token or GitHub App token with Contents read/write on the
 * plugin repo only), PLUGIN_GITHUB_REPO (`owner/name`), PLUGIN_GITHUB_BRANCH (default `main`),
 * GITHUB_API_BASE (tests only). Unset → "not configured", nothing is sent.
 */

export const SKILL_NAME = /^[a-z][a-z0-9-]{2,40}$/;
const MANIFEST = ".claude-plugin/plugin.json";
const MAX_INSTRUCTIONS = 40_000;

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
}

export type SaveOutcome =
  | { saved: true; name: string; path: string; created: boolean; version: string; commit: string; sha256: string; warning?: string }
  | { refused: string };

/** The one SKILL.md shape every saved skill has: frontmatter Pando writes, then the instructions. */
export function buildSkillFile(d: SkillDraft): string | { refused: string } {
  if (!SKILL_NAME.test(d.name)) return { refused: "A skill name is 3–41 lowercase letters, digits or hyphens, starting with a letter." };
  const description = d.description.replace(/\s+/g, " ").trim();
  if (description.length < 20 || description.length > 1024) return { refused: "The description is one line, 20–1024 characters: what the skill does and when to use it." };
  const body = d.instructions.replace(/\r\n/g, "\n").trim();
  if (body.length < 40) return { refused: "The instructions are too short to be a skill." };
  if (body.length > MAX_INSTRUCTIONS) return { refused: `The instructions are over ${MAX_INSTRUCTIONS} characters.` };
  if (/^---\s*$/m.test(body.split("\n")[0] ?? "")) return { refused: "Write the instructions only; Pando writes the frontmatter." };
  /* A skill goes to every Pando admin's Claude: no parent's phone or email in it (review, 20 Nov). */
  if (hasContactDetail(body) || hasContactDetail(description)) return { refused: "The skill carries a phone number or email. Skills hold instructions, never a parent's details." };
  /* A saved skill reaches every admin's Claude (review round 3): it never tells Claude to approve,
     reject or save anything — those wait for a person, every time, and are never a skill's step. */
  if (/\b(approve_proposal|reject_proposal|save_skill|admin_said_(yes|no|save))\b/.test(`${description}\n${body}`)) {
    return { refused: "A skill may not call approve_proposal, reject_proposal or save_skill; those wait for a person every time." };
  }
  const yaml = (v: string) => JSON.stringify(v);
  return `---\nname: ${d.name}\ndescription: ${yaml(description)}\n---\n\n${body}\n`;
}

/**
 * 0.1.0 → 0.1.1. Anything that is not plain x.y.z is null and the save is refused (review, 20 Nov): a
 * guess could go lower than the current version, and Cowork would never bring the skill.
 */
export function nextPatch(version: unknown): string | null {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim()) : null;
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : null;
}

function config() {
  const token = process.env.PLUGIN_GITHUB_TOKEN?.trim();
  const repo = process.env.PLUGIN_GITHUB_REPO?.trim();
  if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { token, repo, branch: process.env.PLUGIN_GITHUB_BRANCH?.trim() || "main", api: (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/+$/, "") };
}

export const pluginRepoConfigured = () => config() !== null;

class GitHubError extends Error {
  constructor(readonly status: number) {
    super(`GitHub answered ${status}`);
  }
}

async function gh<T>(c: NonNullable<ReturnType<typeof config>>, method: string, path: string, body?: unknown): Promise<T | null> {
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

/** One commit on the branch: the skill and the raised version together; retried once if the branch moved. */
type Committed = { path: string; created: boolean; version: string; commit: string } | { refused: string };

async function commitSkill(c: NonNullable<ReturnType<typeof config>>, input: { name: string; file: string; message: string; mayOverwrite: boolean }): Promise<Committed> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await gh<{ object: { sha: string } }>(c, "GET", `/git/ref/heads/${c.branch.split("/").map(encodeURIComponent).join("/")}`);
    if (!ref) return { refused: `The plugin repo has no branch ${c.branch}.` }
    const head = ref.object.sha;
    const at = `?ref=${head}`;
    const manifest = await gh<{ content: string }>(c, "GET", `/contents/${MANIFEST}${at}`);
    if (!manifest) return { refused: "The plugin repo has no .claude-plugin/plugin.json." }
    const plugin = JSON.parse(Buffer.from(manifest.content, "base64").toString("utf8")) as Record<string, unknown>;
    const path = `skills/${input.name}/SKILL.md`;
    const existing = await gh<{ sha: string }>(c, "GET", `/contents/${path}${at}`);
    if (existing && !input.mayOverwrite) return { refused: `A skill named ${input.name} is one QuitCode maintains; choose another name.` }
    const version = nextPatch(plugin.version);
    if (!version) return { refused: "The plugin's version is not x.y.z; QuitCode has to set it before skills can be saved." };
    const commit = await gh<{ tree: { sha: string } }>(c, "GET", `/git/commits/${head}`);
    /* Without the branch's own tree as the base, the new tree would hold only these two files (review round 2). */
    if (!commit?.tree?.sha) return { refused: "GitHub did not return the plugin's current commit; try again." };
    const tree = await gh<{ sha: string }>(c, "POST", "/git/trees", {
      base_tree: commit.tree.sha,
      tree: [
        { path, mode: "100644", type: "blob", content: input.file },
        { path: MANIFEST, mode: "100644", type: "blob", content: `${JSON.stringify({ ...plugin, version }, null, 2)}\n` },
      ],
    });
    const made = await gh<{ sha: string }>(c, "POST", "/git/commits", { message: `${input.message}\n\nPlugin ${version}.`, tree: tree?.sha, parents: [head] });
    try {
      await gh(c, "PATCH", `/git/refs/heads/${c.branch.split("/").map(encodeURIComponent).join("/")}`, { sha: made?.sha, force: false });
      return { path, created: !existing, version, commit: String(made?.sha) }
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422 && attempt === 0) continue;
      throw err;
    }
  }
  return { refused: "The plugin repo kept changing; try again." }
}

/** Saves one skill for `actor`: built in the one shape, committed with the version raised, recorded and audited. */
export async function saveSkill(actor: string, draft: SkillDraft): Promise<SaveOutcome> {
  const c = config();
  if (!c) return { refused: "Saving skills is not configured on this Pando server (PLUGIN_GITHUB_TOKEN, PLUGIN_GITHUB_REPO)." };
  const file = buildSkillFile(draft);
  if (typeof file !== "string") return file;
  const known = await withDb(async (db) => ((await db.execute(sql`select 1 from plugin_skills where name = ${draft.name}`)) as unknown as unknown[]).length > 0);
  if (!known.persisted) return { refused: "Pando could not read its list of skills just now; try again." };
  const description = draft.description.replace(/\s+/g, " ").trim();
  let out: Awaited<ReturnType<typeof commitSkill>>;
  try {
    out = await commitSkill(c, { name: draft.name, file, message: `${known.data ? "Update" : "Add"} skill ${draft.name} (Agent builder, saved by ${actor})`, mayOverwrite: known.data });
  } catch (err) {
    console.error("[mcp] save_skill failed", { error: err instanceof GitHubError ? `github ${err.status}` : err instanceof Error ? err.constructor.name : "unknown" });
    return { refused: err instanceof GitHubError && (err.status === 401 || err.status === 403) ? "GitHub refused Pando's token for the plugin repo." : "GitHub did not take the skill just now; try again." };
  }
  if ("refused" in out) return { refused: out.refused };
  const done = out;
  /* What was committed, so the admin can compare it with what the agent showed them. */
  const sha256 = createHash("sha256").update(file).digest("hex");
  const record = () =>
    withDb(async (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into plugin_skills (name, description, created_by, updated_by, commit_sha, version)
          values (${draft.name}, ${description}, ${actor}, ${actor}, ${done.commit}, ${done.version})
          on conflict (name) do update set description = excluded.description, updated_by = excluded.updated_by,
            updated_at = now(), commit_sha = excluded.commit_sha, version = excluded.version
        `);
        await tx.execute(sql`
          insert into audit_log (actor, action, resource, resource_id, before, after)
          values (${actor}, 'skill.save', 'plugin_skill', null, null,
                  ${JSON.stringify({ name: draft.name, created: done.created, version: done.version, commit: done.commit, sha256 })}::jsonb)
        `);
        return true;
      }),
    );
  /* The commit is already in the plugin: recording it is retried once, and a failure is said in the
     answer, not only in a log (review, 20 Nov) — unrecorded, its next save would be refused as QuitCode's. */
  const recorded = (await record()).persisted || (await record()).persisted;
  console.info("[mcp] skill saved", { created: done.created, recorded });
  return {
    saved: true,
    name: draft.name,
    ...done,
    sha256,
    ...(recorded ? {} : { warning: `Committed (${done.commit.slice(0, 12)}) but Pando could not record it; tell QuitCode, or the next save of this skill will be refused.` }),
  };
}
