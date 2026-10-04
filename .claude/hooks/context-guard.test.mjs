// Part of npm --prefix web run test:hooks.
//
// The guard in a throwaway repository: work that was dirty before the turn must
// not trip it, work done during the turn must, and touching a context file or a
// second stop must let the turn end.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, "context-guard.mjs");
const repo = mkdtempSync(join(tmpdir(), "context-guard-"));
const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
const put = (path, content) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};

git("init", "-q");
git("config", "user.email", "fixture@example.com");
git("config", "user.name", "Fixture");
for (const f of ["web/lib/a.ts", "web/lib/b.ts", "web/lib/c.ts", "web/app/d.tsx", "docs/status.md"]) put(f, "1\n");
git("add", ".");
git("commit", "-q", "-m", "fixture");

const session = `test${process.pid}`;
const run = (mode, extra = {}) =>
  spawnSync("node", [guard, mode], {
    input: JSON.stringify({ session_id: session, ...extra }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  }).status;
const turn = (before, during) => {
  git("reset", "-q", "--hard");
  git("clean", "-qfd");
  before();
  run("snapshot");
  during();
};

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (got ${actual}, expected ${expected})`}`);
};

const three = () => ["web/lib/a.ts", "web/lib/b.ts", "web/lib/c.ts"].forEach((f) => put(f, "2\n"));

turn(three, () => {});
check("three files dirty before the turn, none touched during it", run("check"), 0);

turn(() => {}, three);
check("three files changed during the turn", run("check"), 2);
check("the second stop in the same turn", run("check", { stop_hook_active: true }), 0);

turn(three, () => ["web/lib/a.ts", "web/lib/b.ts", "web/lib/c.ts"].forEach((f) => put(f, "3\n")));
check("files already dirty, changed again during the turn", run("check"), 2);

turn(() => {}, () => { three(); put("docs/status.md", "2\n"); });
check("status.md updated in the same turn", run("check"), 0);

turn(() => {}, () => { put("web/lib/a.ts", "2\n"); put("web/lib/b.ts", "2\n"); });
check("two files is a tweak", run("check"), 0);

turn(() => {}, () => ["web/lib/new/x.ts", "web/lib/new/y.ts", "web/lib/new/z.ts"].forEach((f) => put(f, "1\n")));
check("three new files in one new folder", run("check"), 2);

turn(() => {}, () => ["web/lib/a.test.ts", "web/lib/b.test.ts", "web/lib/c.test.ts"].forEach((f) => put(f, "1\n")));
check("tests alone do not count", run("check"), 0);

const settings = JSON.parse(readFileSync(join(here, "..", "settings.json"), "utf8"));
const wired = (event, mode) =>
  (settings.hooks?.[event] ?? []).some((e) =>
    e.hooks?.some((h) => h.command?.includes("$CLAUDE_PROJECT_DIR") && h.command.includes(`context-guard.mjs\" ${mode}`))
  );
check("snapshot wired to UserPromptSubmit", wired("UserPromptSubmit", "snapshot"), true);
check("check wired to Stop", wired("Stop", "check"), true);

rmSync(repo, { recursive: true, force: true });
rmSync(join(tmpdir(), `pando-context-${session}.json`), { force: true });
console.log(`\n${failed ? `${failed} failed` : "all passed"}`);
process.exit(failed ? 1 : 0);
