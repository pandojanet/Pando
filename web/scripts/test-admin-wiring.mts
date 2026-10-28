/**
 * Every admin action reaches a handler, from a screen, in a shape the route
 * accepts — asserted by reading the source, because that is the only way it
 * stays true.
 *
 * The fault this guards is the one `docs/decisions.md` records more often than
 * any other: something implemented and never called, or called in a shape its
 * own route refuses. On 13 Oct an audit found four more at once —
 * `blast_response.approve` answered 422 on both of its buttons, the two
 * nomination decisions had no control anywhere, "Not Founding" had no way back,
 * and Stripe was told to return parents to two pages that did not exist. None
 * was visible to the typechecker, and each had a passing suite beside it.
 *
 * So the first half is mechanical: the allowlist, the handlers and the callers
 * are three lists, and they must agree. An action with no screen is allowed
 * only by being named in `NO_SCREEN` with its reason — which is what makes the
 * next one a failing check rather than a finding.
 *
 * Run: `npm run test:wiring`
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
let checks = 0;
function ok(what: string, cond: boolean, detail = "") {
  checks++;
  if (cond) console.log(`  ok    ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

const route = readFileSync("app/api/admin/action/route.ts", "utf8");
/* The allowlist moved out of the route on 27 Oct; the route imports it. */
const names = readFileSync("lib/admin/action-names.ts", "utf8");
const write = readFileSync("lib/server/repo/admin-write.ts", "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/* ── 1. three lists that must agree ─────────────────────────────────────────── */

console.log("=== the allowlist, the handlers and the screens agree ===");

const allowBlock = names.slice(
  names.indexOf("export const ADMIN_ACTION_NAMES = ["),
  names.indexOf("] as const;"),
);
ok("the route checks against that list", route.includes("if (!isAdminActionName(action))"));
const allowed = new Set(
  [...allowBlock.matchAll(/^\s*"([a-z_]+\.[a-z_]+)",/gm)].map((m) => m[1]),
);
const handled = new Set(
  [...write.matchAll(/case "([a-z_]+\.[a-z_]+)":/g)].map((m) => m[1]),
);

ok("the allowlist was read", allowed.size > 40, `${allowed.size} actions`);
ok(
  "every allowlisted action has a handler",
  [...allowed].every((a) => handled.has(a)),
  [...allowed].filter((a) => !handled.has(a)).join(", "),
);
ok(
  "every handler is allowlisted — one that is not answers 400 from every screen",
  [...handled].every((a) => allowed.has(a)),
  [...handled].filter((a) => !allowed.has(a)).join(", "),
);

/* A screen names its action as a string literal, sometimes handed through a
   variable (`act("founding.approve", …)`), so any literal that is an action
   name counts as a call. */
const screens = [...walk("app/(admin)"), ...walk("components/admin")];
const called = new Set<string>();
for (const file of screens) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/"([a-z_]+\.[a-z_]+)"/g)) {
    if (allowed.has(m[1]) || handled.has(m[1])) called.add(m[1]);
  }
}

/**
 * Implemented on purpose, with no screen on purpose. Each entry needs its
 * reason: an action that is merely forgotten must not be parked here.
 */
const NO_SCREEN: Record<string, string> = {
  "option.retire":
    "needs a screen listing the live tap-list options, which the admin does not have yet",
};

const uncalled = [...allowed].filter((a) => !called.has(a));
ok(
  "every action a screen cannot reach is a recorded exception",
  uncalled.every((a) => a in NO_SCREEN),
  uncalled.filter((a) => !(a in NO_SCREEN)).join(", "),
);
ok(
  "and no recorded exception has quietly gained a screen",
  Object.keys(NO_SCREEN).every((a) => !called.has(a)),
  Object.keys(NO_SCREEN).filter((a) => called.has(a)).join(", "),
);
ok(
  "no screen calls an action the route does not know",
  [...called].every((a) => allowed.has(a)),
  [...called].filter((a) => !allowed.has(a)).join(", "),
);

/* ── 2. a refusal an admin can hit has a sentence ───────────────────────────── */

console.log("\n=== every named refusal is said in words ===");
{
  const union = write.slice(
    write.indexOf("applied: false;"),
    write.indexOf("type Tx ="),
  );
  const reasons = [...union.matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1]);
  /* These three are answered by their own branch in the route. */
  const OWN_BRANCH = new Set(["not_implemented", "not_found", "referral_cap_reached"]);
  const map = route.slice(
    route.indexOf("const SEND_REFUSALS"),
    route.indexOf("const refusal = SEND_REFUSALS"),
  );
  const unsaid = reasons.filter(
    (r) => !OWN_BRANCH.has(r) && !new RegExp(`^\\s*${r}:`, "m").test(map),
  );
  ok("the refusal reasons were read", reasons.length > 20, `${reasons.length}`);
  ok(
    "each one has a sentence — otherwise it reads as \"not implemented\"",
    unsaid.length === 0,
    unsaid.join(", "),
  );

  const section = (name: string) => {
    const at = write.indexOf(`case "${name}": {`);
    return at === -1 ? "" : write.slice(at, at + 1400);
  };
}

/* ── 3. a blast reply can be approved from its page ─────────────────────────── */

console.log("\n=== /admin/responses sends what the route asks for ===");
{
  const page = readFileSync("app/(admin)/admin/responses/page.tsx", "utf8");
  const check = route.slice(
    route.indexOf('if (action === "blast_response.approve")'),
    route.indexOf('if (action === "matching.weight")'),
  );
  ok(
    "\"Useful, nothing to add\" is accepted: neither a name nor a merge is not an error",
    !/!merge && !name/.test(check),
  );
  ok(
    "a new record still needs its kind — a name alone would be filed as a guess",
    /!merge && name && !SHARE_KINDS\.has/.test(check),
  );
  ok(
    "the page sends the kind with the name",
    /share_name: typed\.trim\(\), share_kind: kind/.test(page),
  );
  const routeKinds = new Set(
    [...(route.match(/const SHARE_KINDS = new Set\(\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map(
      (m) => m[1],
    ),
  );
  const offered = [
    ...page
      .slice(page.indexOf("const NEW_RECORD_KINDS"), page.indexOf("] as const"))
      .matchAll(/id: "([a-z]+)"/g),
  ].map((m) => m[1]);
  ok(
    "every kind the page offers is one the route accepts",
    offered.length > 0 && offered.every((k) => routeKinds.has(k)),
    offered.join(", "),
  );
  ok(
    "and a caregiver or a doctor is never created from a reply",
    !offered.includes("caregiver") && !offered.includes("doctor"),
  );
}

/* ── 5. decisions that had no control ───────────────────────────────────────── */

console.log("\n=== a decision an admin can take, an admin can reach ===");
{
  const panel = readFileSync("components/admin/caregivers/CaregiversPanel.tsx", "utf8");
  ok(
    "a nomination is not offered for approval while its hold stands",
    /canApproveNomination =[\s\S]{0,200}!row\.review_hold/.test(panel),
  );
  ok(
    "the menu's count knows about the item that sets a nomination aside",
    /canRejectNomination \? \["reject_nomination"\]/.test(panel),
  );
  const retrieval = readFileSync("lib/server/repo/retrieval.ts", "utf8");
  ok(
    "a nomination set aside is not counted or quoted in an answer",
    /join caregiver_nominations n on n\.caregiver_id = c\.id and not n\.is_test\s+and n\.status <> 'rejected'/.test(
      retrieval,
    ),
  );

  const reopen = write.slice(
    write.indexOf('case "founding.reopen": {'),
    write.indexOf('case "founding.reopen": {') + 700,
  );
  ok(
    "\"Not Founding\" goes back to the queue, never straight to Founding",
    /set founding = 'pending_founding'/.test(reopen) &&
      /and founding = 'request_invite'/.test(reopen) &&
      !/set founding = 'founding'/.test(reopen),
  );
  ok(
    "and says so when there was nothing to undo",
    /rows\.length === 0\) return \{ applied: false, reason: "not_found" \}/.test(reopen),
  );

  const options = readFileSync("app/(admin)/admin/options/page.tsx", "utf8");
  ok(
    "a name with no Latin letter in it can still be promoted",
    /slugify\(row\.submitted_value\) \|\|\s+`option-\$\{row\.id\.slice\(0, 8\)\}`/.test(options),
  );
}

{
  /**
   * The audit log reads every action and resource as a sentence (22 Oct audit:
   * 29 actions and 8 resources showed as raw ids). Pinned as a set, so an
   * action added to the allowlist without its sentence fails here.
   */
  const labels = readFileSync("lib/admin/labels.ts", "utf8");
  const block = (name: string) => {
    const at = labels.indexOf(`export const ${name}`);
    return labels.slice(at, labels.indexOf("\n};", at));
  };
  const actionLabels = block("AUDIT_ACTION");
  const resourceLabels = block("AUDIT_RESOURCE");
  const unlabelled = [...allowed].filter((a) => !actionLabels.includes(`"${a}":`));
  ok("every allowlisted action has an audit-log sentence", unlabelled.length === 0, unlabelled.join(", "));
  const resources = [...new Set([...write.matchAll(/resource: "([a-z_]+)"/g)].map((m) => m[1]))];
  const bare = resources.filter((r) => !new RegExp(`^\\s*${r}:`, "m").test(resourceLabels));
  ok("every resource admin-write records has a name", bare.length === 0, bare.join(", "));

  /* 26 Oct: two audit rows are written outside admin-write — an admin's own
     password change and a parent deleting their profile — and both read as raw
     ids. Every literal `insert into audit_log … values (actor, 'action',
     'resource'` under lib/server is held to the same rule. */
  const outside: Array<[string, string]> = [];
  for (const file of walk("lib/server")) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(
      /insert into audit_log[^`]*?values\s*\(\s*(?:\$\{[^}]*\}|'[a-z_]+')\s*,\s*'([a-z_.]+)'\s*,\s*'([a-z_]+)'/g,
    )) {
      outside.push([m[1], m[2]]);
    }
  }
  ok(
    "the audit rows written outside admin-write are found (admin.password, profile.delete)",
    outside.some(([a]) => a === "admin.password") && outside.some(([a]) => a === "profile.delete"),
    JSON.stringify(outside),
  );
  const unsaid = outside.filter(
    ([a, r]) =>
      !actionLabels.includes(`"${a}":`) ||
      !new RegExp(`^\\s*${r}:`, "m").test(resourceLabels),
  );
  ok("and each has its sentence and its resource name", unsaid.length === 0, JSON.stringify(unsaid));
}

{
  /* 27 Oct: /admin/conversations read eighteen templates the code sends as
     "Answer deep offer", "Deep dive started" — the stored id with capitals.
     Every literal template under lib/server must have its words. */
  const labels = readFileSync("lib/admin/labels.ts", "utf8");
  const at = labels.indexOf("export const MESSAGE_LABEL");
  const messageLabels = labels.slice(at, labels.indexOf("\n};", at));
  const templates = new Set<string>();
  for (const file of walk("lib/server")) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(file, "utf8");
    /* Up to the end of the property: a ternary spans lines (`template: urgent
       ? "answer_high_stakes" : …`), so stop at `;`, the next `key:` or a `}`. */
    for (const m of src.matchAll(/\btemplate:([^;]*?)(?=;|\n\s*\}|\n\s*[a-zA-Z_]+:)/g)) {
      /* Not the operand of a comparison (`urgent === "high_stakes" ? …`). */
      for (const lit of m[0].matchAll(/(?<![=!]==\s*)"([a-z][a-z_]+)"/g)) templates.add(lit[1]);
    }
  }
  const unworded = [...templates].filter((t) => !new RegExp(`^\\s*${t}:`, "m").test(messageLabels));
  ok("the templates are found (answer_deep_offer, deep_dive_report)", templates.has("answer_deep_offer") && templates.has("deep_dive_report"), [...templates].join(", "));
  ok("every template the send paths use has words on /admin/conversations", unworded.length === 0, unworded.join(", "));

  /* 27 Oct — the network pages. */
  const demandAt = write.indexOf('case "demand.status"');
  const demand = write.slice(demandAt, write.indexOf("case ", demandAt + 10));
  ok("demand.status answers not_found for an id that changed nothing", /returning id/.test(demand) && /reason: "not_found"/.test(demand));
  const read = readFileSync("lib/server/repo/admin-read.ts", "utf8");
  const pool = read.slice(read.indexOf("async function blastPool("));
  ok(
    "a sent Ask shows who was asked (blast_recipients) before any selectPool re-run",
    pool.indexOf("from blast_recipients r") > 0 &&
      pool.indexOf("from blast_recipients r") < pool.indexOf('const { selectPool } = await import'),
  );
  const blasts = readFileSync("app/(admin)/admin/blasts/page.tsx", "utf8");
  ok("an SMS-only asker is a masked number, never 'No profile'", blasts.includes("maskPhoneRecognisable(row.asker.phone)") && !blasts.includes('?? "No profile"'));
}

console.log("\n=== the queues: the overview, the answers and the flags agree (26 Oct) ===");
{
  const caseBody = (name: string) => {
    const at = write.indexOf(`case "${name}":`);
    return write.slice(at, write.indexOf("\n    case ", at + 10));
  };
  /* A no-op must not write an audit row saying a decision was taken. */
  for (const name of ["answer.approve", "answer.reject", "answer.edit"]) {
    const body = caseBody(name);
    ok(`${name} answers not_found when no row changed`, /returning id/.test(body) && /reason: "not_found"/.test(body));
  }
  ok(
    "answer.reject takes back an approved answer, never a sent one",
    /status in \('pending_review', 'approved'\)/.test(caseBody("answer.reject")),
  );
  ok("the route words an answer's not_found", /action\.startsWith\("answer\."\)/.test(route));

  const answers = readFileSync("app/(admin)/admin/answers/page.tsx", "utf8");
  const approvedBlock = answers.slice(answers.indexOf('row.status === "approved" && ('));
  ok(
    "an approved answer card offers Don't send",
    /action: "answer\.reject"/.test(approvedBlock.slice(0, approvedBlock.indexOf('row.status === "sent"'))),
  );
  ok("the answers page says Network Ask, not Network Check", !/Network Check/.test(answers));
  ok("the rewrite is counted against SMS_BUDGET with planSegments", /SMS_BUDGET/.test(answers) && /planSegments\(/.test(answers));
  ok("a Deep Dive report is named rather than claiming nothing", /deep_dive/.test(answers) && /Deep Dive report/.test(answers));

  const read = readFileSync("lib/server/repo/admin-read.ts", "utf8");
  const flagRows = read.slice(read.indexOf("async function flagRows"), read.indexOf("async function demandRows"));
  ok(
    "a flag on an SMS answer or a record carries its words or name",
    /left join answers ans/.test(flagRows) && /f\.subject_kind = 'share'/.test(flagRows),
  );
  const flagSql = flagRows
    .slice(0, flagRows.indexOf("return list.map"))
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok("and the flag read never selects a phone", !/\bphone\b/.test(flagSql));

  const overviewPage = readFileSync("app/(admin)/admin/page.tsx", "utf8");
  const shell = readFileSync("components/admin/Shell.tsx", "utf8");
  /* Every count the sidebar badges is a row on the overview's worklist. */
  const badged = [...shell.matchAll(/count: \(o\) =>\s*([\s\S]*?),\n/g)].map((m) => m[1]);
  const fields = new Set(
    badged.flatMap((expr) => [...expr.matchAll(/o\.([a-z_]+)\??\.([a-z_]+)/g)].map((m) => `${m[1]}.${m[2]}`)),
  );
  const missing = [...fields].filter((f) => {
    const [a, b] = f.split(".");
    return !new RegExp(`o\\.${a}\\??\\.${b}`).test(overviewPage);
  });
  ok("every sidebar badge's count is on the overview's worklist", fields.size > 5 && missing.length === 0, missing.join(", "));

  const activities = readFileSync("app/(admin)/admin/activities/page.tsx", "utf8");
  ok("a card from an Ask reply says so", /source_blast_id/.test(activities) && /From a Network Ask reply/.test(activities));
  ok("a card shows its open flag", /row\.open_flag/.test(activities));
}

console.log(
  failures === 0
    ? `\n  ${checks} checks passed.`
    : `\n  ${failures} of ${checks} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
