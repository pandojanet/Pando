#!/usr/bin/env node
// PreToolUse hook (Edit|Write|NotebookEdit|Bash). Exit 2 blocks the call; stderr
// is what the agent reads.
//
// 1. Files that are never edited in place:
//    - a committed migration or snapshot under web/drizzle/. Drizzle hashes each
//      applied file, so an edit desynchronises every environment silently. A new,
//      untracked migration passes; meta/_journal.json passes because a new
//      migration appends to it.
//    - vendored skills under .agents/skills/. They are updated by moving
//      skills-lock.json to a new tag, never by hand.
// 2. Skipping the pre-commit secret scan (--no-verify, -n, core.hooksPath).
//
// Fail-closed: a payload that is not JSON blocks. Known gaps, by design a filter
// and not a sandbox: a path assembled from variables or encodings, and a write
// made by a script whose source does not name the path.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function block(message) {
  console.error(`protect-files: ${message}`);
  process.exit(2);
}

function git(args) {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

// Project-relative POSIX path, or null when it lies outside the project.
function toProjectPath(candidate) {
  const rel = relative(projectDir, resolve(projectDir, candidate));
  if (rel === "" || rel.startsWith("..")) return null;
  return rel.split(sep).join("/");
}

function isTracked(path) {
  try {
    git(["ls-files", "--error-unmatch", "--", path]);
    return true;
  } catch {
    return false;
  }
}

function protectedReason(path) {
  if (path.startsWith(".agents/skills/")) {
    return "vendored skill — update it by moving skills-lock.json to a new tag, not by hand";
  }
  if (path.startsWith("web/drizzle/") && path !== "web/drizzle/meta/_journal.json" && isTracked(path)) {
    return "committed migration — drizzle hashes it; fix forward with a new migration (db-migration skill)";
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

// A heredoc body is data (a commit message, a file's content), not an operation;
// the line that opens it stays, since `cat <<EOF > file` writes on that line.
const command = String(toolInput.command ?? "").replace(/(<<-?\s*['"]?(\w+)['"]?[^\n]*)\n[\s\S]*?^\s*\2$/gm, "$1");

// `2>&1` duplicates a descriptor and `> /dev/null` discards; neither writes a file.
const redirectsToFile = [...command.matchAll(/(?:^|\s)\d?>>?\s*([^\s|;&]+)/g)].some(
  ([, target]) => target !== "/dev/null" && !target.startsWith("&")
);
const WRITE_HINTS =
  /\btee\b|\bsed\b[^|;]*\s-i|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bdd\b|\bchmod\b|writeFileSync|appendFileSync|createWriteStream|\bpatch\b|git\s+(?:checkout|restore|apply|clean|rm|mv)\b/;

if (redirectsToFile || WRITE_HINTS.test(command)) {
  // Normalised, not matched as text: web/lib/../drizzle/0001_x.sql is a migration.
  const tokens = command.match(/[A-Za-z0-9._~@+-]*(?:\/[A-Za-z0-9._~@*+-]+)+\/?/g) ?? [];
  for (const token of tokens) {
    const path = toProjectPath(token);
    const reason = path && protectedReason(path);
    if (reason) block(`${path}: ${reason}. Reading is fine; changing it is not.`);
  }
}

// The secret scan is the git pre-commit hook (.githooks/); skipping it or
// pointing git elsewhere is the same as committing the secret.
// Setting it to .githooks is the install (web/package.json → prepare), not a bypass.
const skipsScan = /\bgit\b[^|;&]*\bcommit\b[^|;&]*\s(?:--no-verify|-[A-Za-z]*n[A-Za-z]*)\b/.test(command);
// Reading it (`git config --get core.hooksPath`) is fine.
const movesHooks =
  /--unset(?:-all)?\s+core\.hooksPath/.test(command) ||
  [...command.matchAll(/core\.hooksPath(?:[\s=]+['"]?([^\s'";&|]*))?/g)].some(
    ([, value]) => value !== undefined && value !== ".githooks"
  );
if (skipsScan || movesHooks) {
  block("bypassing the pre-commit scan is blocked; fix what it found instead.");
}

process.exit(0);
