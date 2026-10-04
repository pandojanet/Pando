// git pre-commit. Refuses a commit that
//   1. changes or deletes a committed migration or snapshot under web/drizzle/
//      (drizzle never re-runs an applied file), or changes a vendored skill under
//      .agents/skills/ without skills-lock.json moving with it;
//   2. adds the committer's own email or a credential.
// It runs at commit time, when the index is final, so it does not matter how a
// file was changed — a PreToolUse hook sees only the command text, and
// `printf … > f && git add f && git commit` creates the file after that hook looked.
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

// A vendored-skills commit can be megabytes; the default 1 MB buffer would crash.
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

const findings = [];

// 1. Files that never change once committed. With no HEAD (the first commit)
//    nothing is committed yet, so nothing can be changed.
let changed = [];
try {
  git("rev-parse", "--verify", "-q", "HEAD");
  changed = git("diff", "--cached", "--name-only", "--no-renames", "--diff-filter=MD", "HEAD").split("\n").filter(Boolean);
} catch {
  /* no HEAD */
}
const lockMoved = git("diff", "--cached", "--name-only").split("\n").includes("skills-lock.json");
for (const path of changed) {
  if (path.startsWith("web/drizzle/") && path !== "web/drizzle/meta/_journal.json") {
    findings.push(`${path}  committed migration changed or deleted — fix forward with a new one`);
  } else if (path.startsWith(".agents/skills/") && !lockMoved) {
    findings.push(`${path}  vendored skill changed without skills-lock.json`);
  }
}

// 2. Added lines carrying the committer's email or a credential.
let email = "";
try {
  email = git("config", "user.email").trim().toLowerCase();
} catch {
  /* no configured email, nothing to look for */
}

let file = "";
let line = 0;
let inHeader = false;
for (const row of git("diff", "--cached", "-U0", "--no-color", "--no-ext-diff").split("\n")) {
  if (row.startsWith("diff --git ")) {
    inHeader = true;
  } else if (inHeader && row.startsWith("+++ ")) {
    file = row.replace(/^\+\+\+ (b\/)?/, "");
  } else if (row.startsWith("@@")) {
    inHeader = false;
    line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
  } else if (!inHeader && row.startsWith("+")) {
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
    `pre-commit: refusing this commit:\n  ${findings.join("\n  ")}\n` +
      "Unstage or undo it and commit again. A credential that reached a diff is rotated, not just deleted."
  );
  process.exit(1);
}
