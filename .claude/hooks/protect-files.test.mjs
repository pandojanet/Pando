// npm --prefix web run test:hooks
//
// Runs protect-files.mjs the way Claude Code does — JSON on stdin, exit code
// read back — against a throwaway git repository, so tracked and untracked are
// fixed by the test rather than by whatever Pando's tree holds.
// Then checks the wiring: a hook that is never called protects nothing, and unit
// cases cannot see that.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "protect-files.mjs");
const repo = mkdtempSync(join(tmpdir(), "protect-files-"));
const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });

function put(path, content) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

git("init", "-q");
git("config", "user.email", "fixture@example.com");
git("config", "user.name", "Fixture");
put("web/drizzle/0001_a.sql", "create table a ();\n");
put("web/drizzle/meta/0001_snapshot.json", "{}\n");
put("web/drizzle/meta/_journal.json", "{}\n");
put(".agents/skills/vendor/SKILL.md", "---\nname: vendor\n---\n");
put("web/lib/x.ts", "export const x = 1;\n");
git("add", ".");
git("commit", "-q", "-m", "fixture");
put("web/drizzle/0002_new.sql", "create table b ();\n");

const abs = (p) => join(repo, p);
const edit = (path, tool = "Edit") => JSON.stringify({ tool_name: tool, tool_input: { file_path: path } });
const bash = (command) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });
const run = (stdin) => spawnSync("node", [hook], { input: stdin, env: { ...process.env, CLAUDE_PROJECT_DIR: repo } }).status;

const cases = [
  // Edit / Write / NotebookEdit
  ["edit a committed migration", edit(abs("web/drizzle/0001_a.sql")), 2],
  ["edit a committed snapshot", edit(abs("web/drizzle/meta/0001_snapshot.json")), 2],
  ["edit through ../ into a migration", edit(abs("web/lib/../drizzle/0001_a.sql")), 2],
  ["relative path to a migration", edit("web/drizzle/0001_a.sql", "Write"), 2],
  ["notebook path into a migration", JSON.stringify({ tool_name: "NotebookEdit", tool_input: { notebook_path: abs("web/drizzle/0001_a.sql") } }), 2],
  ["edit a vendored skill", edit(abs(".agents/skills/vendor/SKILL.md")), 2],
  ["append to the journal", edit(abs("web/drizzle/meta/_journal.json")), 0],
  ["write a new, untracked migration", edit(abs("web/drizzle/0002_new.sql"), "Write"), 0],
  ["edit app code", edit(abs("web/lib/x.ts")), 0],
  ["path outside the project", edit("/tmp/elsewhere.ts", "Write"), 0],
  ["payload that is not JSON", "not json", 2],

  // Bash writes
  ["redirect into a migration", bash("echo x > web/drizzle/0001_a.sql"), 2],
  ["redirect through ../", bash("echo x >> web/lib/../drizzle/0001_a.sql"), 2],
  ["sed -i on a migration", bash("sed -i '' 's/a/b/' web/drizzle/0001_a.sql"), 2],
  ["git checkout of a migration", bash("git checkout -- web/drizzle/0001_a.sql"), 2],
  ["cp over a vendored skill", bash("cp /tmp/x .agents/skills/vendor/SKILL.md"), 2],
  ["rm an untracked migration", bash("rm web/drizzle/0002_new.sql"), 0],

  // Bash reads
  ["cat a migration", bash("cat web/drizzle/0001_a.sql"), 0],
  ["2>&1 is not a write", bash("cat web/drizzle/0001_a.sql 2>&1 | head"), 0],
  ["> /dev/null is not a write", bash("ls web/drizzle > /dev/null"), 0],
  ["heredoc body naming a migration", bash("cat <<'EOF' > /tmp/note.txt\nweb/drizzle/0001_a.sql\nEOF"), 0],

  // Skipping the pre-commit secret scan
  ["commit --no-verify", bash("git commit --no-verify -m 'x'"), 2],
  ["commit -n", bash("git add -A && git commit -n -m 'x'"), 2],
  ["commit -anm", bash("git commit -anm 'x'"), 2],
  ["git -c core.hooksPath", bash("git -c core.hooksPath=/dev/null commit -m 'x'"), 2],
  ["unset core.hooksPath", bash("git config --unset core.hooksPath"), 2],
  ["point core.hooksPath elsewhere", bash("git config core.hooksPath /tmp/none"), 2],
  ["install core.hooksPath", bash("git config core.hooksPath .githooks"), 0],
  ["read core.hooksPath", bash("git config --get core.hooksPath; git status"), 0],
  ["plain commit", bash("git commit -m 'x'"), 0],
  ["commit --amend --no-edit", bash("git commit --amend --no-edit"), 0],

  // Known limit, pinned so a change in it is noticed: a path assembled at run time.
  ["known limit: path built by printf", bash("echo x > \"$(printf 'web/dri%s' zzle/0001_a.sql)\""), 0],
];

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (got ${actual}, expected ${expected})`}`);
};

for (const [name, stdin, expected] of cases) check(name, run(stdin), expected);

// Wiring: the hook is registered for every tool that can write, by a path that
// survives the session's working directory moving.
const settings = JSON.parse(readFileSync(join(here, "..", "settings.json"), "utf8"));
const entry = (settings.hooks?.PreToolUse ?? []).find((e) =>
  e.hooks?.some((h) => h.command?.includes("protect-files.mjs"))
);
check("wired as a PreToolUse hook", Boolean(entry), true);
for (const tool of ["Edit", "Write", "NotebookEdit", "Bash"]) {
  check(`matcher covers ${tool}`, entry?.matcher?.split("|").includes(tool) ?? false, true);
}
check(
  "command is anchored to $CLAUDE_PROJECT_DIR",
  entry?.hooks?.some((h) => h.command.includes("$CLAUDE_PROJECT_DIR")) ?? false,
  true
);

rmSync(repo, { recursive: true, force: true });
console.log(`\n${failed ? `${failed} failed` : "all passed"}`);
process.exit(failed ? 1 : 0);
