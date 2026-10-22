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

const allowBlock = route.slice(
  route.indexOf("const ACTIONS = new Set(["),
  route.indexOf("]);", route.indexOf("const ACTIONS = new Set([")),
);
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
  "blast.checkout":
    "every Network Ask is free since 21 Oct, so the blasts page has no 'Take payment' button; the action stays allowlisted and refuses a free Ask (payment_nothing_to_pay), so prices coming back is a decision, not a rewire",
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
  ok(
    "a checkout Stripe cannot make is not reported as a stale page",
    /payment_not_provisioned/.test(section("blast.checkout")) &&
      /payment_nothing_to_pay/.test(section("blast.checkout")),
  );
  ok(
    "a refund Stripe took and Pando could not record says the money has moved",
    /refund_not_recorded/.test(section("blast.refund")) &&
      /The money has gone back/.test(map),
  );
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

/* ── 4. the money ───────────────────────────────────────────────────────────── */

console.log("\n=== Stripe returns a parent to a page that exists, and one link at a time ===");
{
  const stripe = readFileSync("lib/server/stripe.ts", "utf8");
  const payments = readFileSync("lib/server/repo/payments.ts", "utf8");
  const returns = [...stripe.matchAll(/_url: `\$\{site\}(\/[a-z/]+)\?/g)].map((m) => m[1]);
  ok("both return URLs were read", returns.length === 2, returns.join(", "));
  for (const path of returns) {
    ok(
      `${path} is a page`,
      existsSync(join("app", "(site)", ...path.split("/").filter(Boolean), "page.tsx")),
    );
  }
  ok(
    "the idempotency key and the expiry move together, so a second press is the same request",
    /blast-checkout-\$\{input\.blastId\}-\$\{step\}/.test(stripe) &&
      /expires_at: String\(\(step \+ 1\) \* STEP \+ 1800\)/.test(stripe),
  );
  const open = payments.slice(
    payments.indexOf("export async function openCheckout"),
    payments.indexOf("export type ConfirmOutcome"),
  );
  ok(
    "the link already out is asked about before another is made",
    open.indexOf("checkoutState(") !== -1 &&
      open.indexOf("checkoutState(") < open.indexOf("createCheckout("),
  );
  ok(
    "a paid session waiting on its webhook is never given a second link",
    /state\.status === "complete"\) return \{ ok: false, reason: "already_paid" \}/.test(open),
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
}

console.log(
  failures === 0
    ? `\n  ${checks} checks passed.`
    : `\n  ${failures} of ${checks} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
