// npm --prefix web run test:githooks
//
// Real commits in a throwaway repository wired to this .githooks/ directory, so
// what is tested is the hook git actually runs — including the cases that made it
// a git hook: a file created and staged by the same command that commits it, and
// a migration changed by a command no PreToolUse hook can read a path out of.

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hooks = dirname(fileURLToPath(import.meta.url));
const repo = mkdtempSync(join(tmpdir(), "pre commit-"));
const sh = (command) => execSync(command, { cwd: repo, stdio: "ignore", shell: "/bin/sh" });

sh("git init -q");
sh("git config user.email fixture@example.com && git config user.name Fixture && git config commit.gpgsign false");
sh(`git config core.hooksPath "${hooks}"`);
sh("mkdir -p web/drizzle/meta .agents/skills/vendor");
writeFileSync(join(repo, "base.txt"), "base\n");
writeFileSync(join(repo, "web/drizzle/0001_a.sql"), "create table a ();\n");
writeFileSync(join(repo, "web/drizzle/meta/_journal.json"), "{}\n");
writeFileSync(join(repo, ".agents/skills/vendor/SKILL.md"), "v1\n");
writeFileSync(join(repo, "skills-lock.json"), "{}\n");
sh("git add . && git commit -q -m base");

// Built at runtime so this file never carries a literal credential.
const stripeKey = "sk_" + "live_" + "a1B2".repeat(6);
const slackToken = "xoxb-" + "1234567890-" + "AbCdEfGhIjKl";
const databaseUrl = "postgresql://app:" + "hunter2@db.example.com/x";
const bigFile = "line of ordinary text\n".repeat(70000); // ~1.5 MB staged

const cases = [
  // credentials and the committer's own email
  ["email in a new file, created and staged in one command", "printf 'owner: fixture@example.com\\n' > owner.md && git add owner.md && git commit -q -m x", false],
  ["Stripe key", `printf 'k=${stripeKey}\\n' > k.ts && git add k.ts && git commit -q -m x`, false],
  ["Slack token through commit -a", `printf 't=${slackToken}\\n' >> base.txt && git commit -qam x`, false],
  ["database URL with a password", `printf '${databaseUrl}\\n' > db.txt && git add db.txt && git commit -q -m x`, false],
  ["a key on a line that starts with '++ '", `printf '++ ${stripeKey}\\n' > pp.txt && git add pp.txt && git commit -q -m x`, false],
  ["placeholder database URL", "printf 'postgresql://postgres.<ref>:<password>@host/x\\n' > ex.txt && git add ex.txt && git commit -q -m x", true],
  ["test-sized fake secret", "printf 'whsec_test\\n' > t.ts && git add t.ts && git commit -q -m x", true],
  ["a staged diff over 1 MB", "git add big.txt && git commit -q -m x", true, () => writeFileSync(join(repo, "big.txt"), bigFile)],

  // committed migrations and vendored skills
  ["perl -pi on a committed migration", "perl -pi -e 's/a/b/' web/drizzle/0001_a.sql && git commit -qam x", false],
  ["rm -rf web/drizzle", "rm -rf web/drizzle && git add -A && git commit -q -m x", false],
  ["a new migration and its journal entry", "printf 'create table b ();\\n' > web/drizzle/0002_b.sql && printf '{\"x\":1}\\n' > web/drizzle/meta/_journal.json && git add -A && git commit -q -m x", true],
  ["a vendored skill edited by hand", "printf 'v2\\n' > .agents/skills/vendor/SKILL.md && git commit -qam x", false],
  ["a vendored skill moved with its lock", "printf 'v2\\n' > .agents/skills/vendor/SKILL.md && printf '{\"v\":2}\\n' > skills-lock.json && git commit -qam x", true],

  ["clean change", "printf 'hello\\n' > ok.txt && git add ok.txt && git commit -q -m x", true],
];

let failed = 0;
for (const [name, command, shouldCommit, prepare] of cases) {
  sh("git reset -q --hard && git clean -qfd");
  prepare?.();
  const head = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" });
  try {
    execSync(command, { cwd: repo, stdio: "pipe", shell: "/bin/sh" });
  } catch {
    /* a refused commit exits non-zero; HEAD below is the verdict */
  }
  const committed = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }) !== head;
  const ok = committed === shouldCommit;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (committed: ${committed})`}`);
  if (committed) sh("git reset -q --hard HEAD~1");
}

rmSync(repo, { recursive: true, force: true });
console.log(`\n${failed ? `${failed} failed` : "all passed"}`);
process.exit(failed ? 1 : 0);
