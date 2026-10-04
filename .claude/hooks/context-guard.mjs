#!/usr/bin/env node
// Keeps CLAUDE.md, docs/status.md and docs/decisions.md from going stale.
//
//   context-guard.mjs snapshot   UserPromptSubmit: record what is already dirty
//   context-guard.mjs check      Stop: block once if this turn changed three or
//                                more app/docs files and none of the context files
//
// Only what changed after the snapshot counts, so uncommitted work left by another
// session or an earlier turn does not trip it. A path counts as changed when its
// content hash differs from the snapshot (or it was not dirty then).
//
// To disable: remove both entries from .claude/settings.json.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONTEXT = /^(CLAUDE\.md|docs\/status\.md|docs\/decisions\.md|\.claude\/rules\/)/;
const COUNTED = /^(web\/(app|lib|components|scripts|drizzle)\/|docs\/)/;

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const git = (args) =>
  execFileSync("git", args, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

function dirtyFiles() {
  let porcelain;
  try {
    porcelain = git(["status", "--porcelain=v1", "-z", "-uall"]);
  } catch {
    return null;
  }
  const paths = [];
  const fields = porcelain.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i++; // the next field is the old path
  }
  const state = {};
  for (const path of paths) {
    state[path] = existsSync(join(projectDir, path)) ? git(["hash-object", "--", path]).trim() : "deleted";
  }
  return state;
}

const stateFile = join(tmpdir(), `pando-context-${String(payload.session_id ?? "none").replace(/\W/g, "")}.json`);
const now = dirtyFiles();
if (now === null) process.exit(0);

if (process.argv[2] === "snapshot") {
  writeFileSync(stateFile, JSON.stringify(now));
  process.exit(0);
}

if (payload.stop_hook_active || !existsSync(stateFile)) process.exit(0);

const before = JSON.parse(readFileSync(stateFile, "utf8"));
const changed = Object.keys(now).filter((path) => before[path] !== now[path]);

if (changed.some((path) => CONTEXT.test(path))) process.exit(0);

const counted = changed.filter((path) => COUNTED.test(path) && !/\.(test|spec)\./.test(path));
if (counted.length < 3) process.exit(0);

console.error(
  `Project context was not updated, but ${counted.length} files under web/ or docs/ changed this turn.\n` +
    "Before finishing: update docs/status.md, and add a docs/decisions.md row if a choice was made\n" +
    'that a future session could unknowingly undo (see CLAUDE.md → "Keeping this file current").\n' +
    "If this turn genuinely needs no context change, say so explicitly."
);
process.exit(2);
