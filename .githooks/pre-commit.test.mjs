// npm --prefix web run test:githooks
//
// Real commits in a throwaway repository wired to this .githooks/ directory, so
// what is tested is the hook git actually runs — including the case that made it
// a git hook: a file created and staged by the same command that commits it.

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hooks = dirname(fileURLToPath(import.meta.url));
const repo = mkdtempSync(join(tmpdir(), "pre-commit-"));
const sh = (command) => execSync(command, { cwd: repo, stdio: "ignore" });

sh("git init -q");
sh("git config user.email fixture@example.com && git config user.name Fixture");
sh(`git config core.hooksPath "${hooks}"`);
writeFileSync(join(repo, "base.txt"), "base\n");
sh("git add . && git commit -q -m base");

// Built at runtime so this file never carries a literal credential.
const stripeKey = "sk_" + "live_" + "a1B2".repeat(6);
const slackToken = "xoxb-" + "1234567890-" + "AbCdEfGhIjKl";
const databaseUrl = "postgresql://app:" + "hunter2@db.example.com/x";

const cases = [
  ["email in a new file, created and staged in one command", "printf 'owner: fixture@example.com\\n' > owner.md && git add owner.md && git commit -q -m x", false],
  ["Stripe key", `printf 'k=${stripeKey}\\n' > k.ts && git add k.ts && git commit -q -m x`, false],
  ["Slack token through commit -a", `printf 't=${slackToken}\\n' >> base.txt && git commit -qam x`, false],
  ["database URL with a password", `printf '${databaseUrl}\\n' > db.txt && git add db.txt && git commit -q -m x`, false],
  ["placeholder database URL", "printf 'postgresql://postgres.<ref>:<password>@host/x\\n' > ex.txt && git add ex.txt && git commit -q -m x", true],
  ["test-sized fake secret", "printf 'whsec_test\\n' > t.ts && git add t.ts && git commit -q -m x", true],
  ["clean change", "printf 'hello\\n' > ok.txt && git add ok.txt && git commit -q -m x", true],
];

let failed = 0;
for (const [name, command, shouldCommit] of cases) {
  sh("git reset -q --hard && git clean -qfd");
  let committed = true;
  try {
    execSync(command, { cwd: repo, stdio: "pipe", shell: "/bin/sh" });
  } catch {
    committed = false;
  }
  const ok = committed === shouldCommit;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (committed: ${committed})`}`);
  if (committed) sh("git reset -q --hard HEAD~1");
}

rmSync(repo, { recursive: true, force: true });
console.log(`\n${failed ? `${failed} failed` : "all passed"}`);
process.exit(failed ? 1 : 0);
