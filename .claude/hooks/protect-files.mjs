#!/usr/bin/env node
// PreToolUse hook (Edit|Write|NotebookEdit|Bash). Exit 2 blocks the call; stderr
// is what the agent reads.
//
// Edit / Write / NotebookEdit — the path is exact, so these are blocked here:
//   - a committed migration or snapshot under web/drizzle/. Drizzle never re-runs
//     an applied file, so an edit desynchronises every environment silently. A new,
//     untracked migration passes; meta/_journal.json passes because a new
//     migration appends to it.
//   - vendored skills under .agents/skills/, updated only by moving skills-lock.json
//     to a new tag.
//   - .githooks/, the pre-commit check itself.
//
// Bash — a write can be spelled too many ways to find its target in the command
// text (quoted paths with spaces, perl -pi, a heredoc fed to node, a directory), and
// guessing also blocks plain reads. So Bash writes to those files are caught by the
// git pre-commit hook instead, which compares the staged change with HEAD. What is
// blocked here is switching that hook off: `git commit --no-verify`/`-n` (or any
// prefix git accepts), and pointing or unsetting core.hooksPath.
//
// Fail-closed: a payload that is not JSON blocks.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function block(message) {
  console.error(`protect-files: ${message}`);
  process.exit(2);
}

// Project-relative POSIX path, or null when it lies outside the project.
function toProjectPath(candidate) {
  const rel = relative(projectDir, resolve(projectDir, candidate));
  if (rel === "" || rel.startsWith("..")) return null;
  return rel.split(sep).join("/");
}

function isTracked(path) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: projectDir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function protectedReason(path) {
  if (path.startsWith(".agents/skills/")) {
    return "vendored skill — update it by moving skills-lock.json to a new tag, not by hand";
  }
  if (path.startsWith(".githooks/")) {
    return "the pre-commit check — a change to it is the user's to make";
  }
  if (path.startsWith("web/drizzle/") && path !== "web/drizzle/meta/_journal.json" && isTracked(path)) {
    return "committed migration — drizzle never re-runs an applied file, so an edit silently splits the environments; fix forward with a new migration (db-migration skill)";
  }
  return null;
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  block("could not parse the hook payload; blocking rather than guessing.");
}

const toolInput = input?.tool_input ?? {};

if (input?.tool_name !== "Bash") {
  for (const candidate of [toolInput.file_path, toolInput.notebook_path]) {
    if (typeof candidate !== "string" || candidate === "") continue;
    const path = toProjectPath(candidate);
    const reason = path && protectedReason(path);
    if (reason) block(`${path}: ${reason}.`);
  }
  process.exit(0);
}

// Heredoc bodies and quoted text (a commit message, a grep pattern) are data.
const unheredoc = String(toolInput.command ?? "").replace(/(<<-?\s*['"]?(\w+)['"]?[^\n]*)\n[\s\S]*?^\s*\2$/gm, "$1");
if (/\s-c\s+['"]core\.hookspath=(?!\.githooks['"\s])/i.test(unheredoc)) {
  block("pointing core.hooksPath elsewhere skips the pre-commit scan; fix what it found instead.");
}
const command = unheredoc.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");

for (const segment of command.split(/&&|\|\||[;|\n]/)) {
  const words = segment.trim().split(/\s+/);
  if (words[0] !== "git") continue;
  // git's global options come before the subcommand: -C <dir>, -c <key=value>, …
  let i = 1;
  const configOverrides = [];
  while (i < words.length && words[i].startsWith("-")) {
    if (words[i] === "-c" || words[i] === "-C") {
      if (words[i] === "-c") configOverrides.push(words[i + 1] ?? "");
      i += 2;
    } else i++;
  }
  const sub = words[i];
  const args = words.slice(i + 1);

  if (configOverrides.some((kv) => /^core\.hookspath=/i.test(kv) && kv.split("=")[1] !== ".githooks")) {
    block("pointing core.hooksPath elsewhere skips the pre-commit scan; fix what it found instead.");
  }

  if (sub === "commit") {
    for (const arg of args) {
      if (arg === "--") break;
      const noVerify = arg.length > 4 && "--no-verify".startsWith(arg);
      const shortN = /^-[A-Za-z]*n[A-Za-z]*$/.test(arg) && !arg.startsWith("--");
      if (noVerify || shortN) block(`\`git commit ${arg}\` skips the pre-commit scan; fix what it found instead.`);
    }
  }

  if (sub === "config") {
    const keyAt = args.findIndex((a) => /^core\.hookspath$/i.test(a));
    if (keyAt === -1) continue;
    const before = args.slice(0, keyAt);
    const value = args[keyAt + 1];
    const reading = before.some((a) => /^(--get|--get-all|--get-regexp|get|--list|-l|--show-origin)$/.test(a));
    const unsetting = before.some((a) => /^(--unset|--unset-all|unset)$/.test(a));
    if (unsetting || (!reading && value !== undefined && value !== ".githooks")) {
      block("changing core.hooksPath switches off the pre-commit scan; it is set by `npm install` in web/.");
    }
  }
}

process.exit(0);
