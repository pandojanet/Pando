// git pre-commit: refuse a commit whose staged diff adds the committer's own
// email or a credential. Runs at commit time, when the index is final — a
// Claude Code PreToolUse hook cannot do this, because in `printf … > f && git
// add f && git commit` the file does not exist yet when that hook looks.
//
// Prints file:line and the kind of finding, never the value.

import { execFileSync } from "node:child_process";

const SECRETS = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["Stripe key", /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{24,}/],
  ["Slack token", /\bxox[abps]-\d+-[A-Za-z0-9-]{10,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["database URL with a password", /postgres(?:ql)?:\/\/[^:/\s<]+:[^@\s<]+@/],
];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

let email = "";
try {
  email = git("config", "user.email").trim().toLowerCase();
} catch {
  /* no configured email, nothing to look for */
}

const findings = [];
let file = "";
let line = 0;
for (const row of git("diff", "--cached", "-U0", "--no-color", "--no-ext-diff").split("\n")) {
  if (row.startsWith("+++ ")) {
    file = row.replace(/^\+\+\+ (b\/)?/, "");
  } else if (row.startsWith("@@")) {
    line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
  } else if (row.startsWith("+")) {
    const added = row.slice(1);
    if (email && added.toLowerCase().includes(email)) findings.push(`${file}:${line}  the committer's email`);
    for (const [kind, pattern] of SECRETS) {
      if (pattern.test(added)) findings.push(`${file}:${line}  ${kind}`);
    }
    line++;
  }
}

if (findings.length) {
  console.error(
    `pre-commit: the staged change adds what must not reach git:\n  ${findings.join("\n  ")}\n` +
      "Remove it and stage again. A credential that reached a diff is rotated, not just deleted."
  );
  process.exit(1);
}
