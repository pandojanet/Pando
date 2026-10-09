import { readFileSync } from "node:fs";

/**
 * The Slack notifications (30 Sep): a parent, an activity, a caregiver.
 *
 * Most of what matters is what a notification must NOT contain — Slack is a third
 * party's storage — so most of these checks assert an absence, against the builder
 * itself. The sender needs a webhook and a network and carries `server-only`, so
 * what it promises (inert when unset, never throws, fixed host, no test rows) is
 * read off its source, and the three routes are read for the two rules that keep a
 * correction from announcing twice.
 */

const n = (await import(`../lib/notify-message.ts?v=${Date.now()}`)) as typeof import("../lib/notify-message.ts");

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** Code without comments — these files say what they leave out, and a check for a
 *  forbidden word must read the code rather than the sentence forbidding it. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const BASE = "https://pando.is";
const personId = "8a2b1c3d-0000-4000-8000-000000000001";

/* ── The messages ─────────────────────────────────────────────────────────── */
const parent = n.notifyText({ kind: "parent", person_id: personId, neighborhood: "south-pasadena" }, BASE);
ok("a new parent says so, and where", /New parent joined/.test(parent) && /South Pasadena/.test(parent), parent);
ok("and links straight to that parent in the admin", parent.includes(`<${BASE}/admin/contributors/${personId}|`), parent);
ok("a parent with no neighborhood still reads cleanly",
  !/undefined|null|—\s*$/m.test(n.notifyText({ kind: "parent", person_id: personId, neighborhood: null }, BASE)));

for (const kind of ["activity", "place", "tip", "doctor"] as const) {
  const t = n.notifyText({ kind }, BASE);
  ok(`a new ${kind} names its kind and links to the review queue`,
    /recommendation/.test(t) && t.includes(`<${BASE}/admin/activities|`), t);
}
ok("an activity is called an activity or class", /activity or class/.test(n.notifyText({ kind: "activity" }, BASE)));

const cg = n.notifyText({ kind: "caregiver" }, BASE);
ok("a nominated caregiver is announced and linked", /caregiver was nominated/.test(cg) && cg.includes(`<${BASE}/admin/caregivers|`), cg);
const signup = n.notifyText({ kind: "caregiver_signup" }, BASE);
ok("a caregiver's own sign-up points at the Sign-ups tab, where it is matched",
  /needs matching/.test(signup) && signup.includes("/admin/caregivers?view=signups|"), signup);

/* ── What must never be in one ────────────────────────────────────────────── */
const all = [parent, cg, signup, ...(["activity", "place", "tip"] as const).map((k) => n.notifyText({ kind: k }, BASE))].join("\n");
ok("no phone number, in any form", !/\+?\d[\d\s().-]{8,}\d/.test(all.replace(personId, "").replace(/https?:\/\/\S+/g, "")));
ok("no caregiver detail: the caregiver messages name nobody, no area, no rate",
  !/\$|\/hr|rate|area|first name/i.test(`${cg}\n${signup}`));
ok("the builder cannot carry free text or a name — its events have no such field",
  !/\b(name|phone|note|text|body|caveat)\b\s*[:?]/.test(
    code("../lib/notify-message.ts").slice(code("../lib/notify-message.ts").indexOf("export type NotifyEvent"), code("../lib/notify-message.ts").indexOf("function slugLabel")),
  ));
ok("a trailing slash on the base does not double up", !/\/\/admin/.test(n.notifyText({ kind: "caregiver" }, "https://pando.is/")));

/* ── The webhook address ──────────────────────────────────────────────────── */
ok("only a hooks.slack.com address is accepted", n.isSlackWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXX"));
ok("any other host is refused, so the env file cannot aim this server elsewhere",
  !n.isSlackWebhookUrl("https://evil.example/hooks.slack.com/") &&
    !n.isSlackWebhookUrl("http://hooks.slack.com/services/x") &&
    !n.isSlackWebhookUrl("") && !n.isSlackWebhookUrl(undefined) && !n.isSlackWebhookUrl("https://hooks.slack.com.evil.example/x"));

/* ── The sender ───────────────────────────────────────────────────────────── */
const sender = code("../lib/server/notify.ts");
ok("it is inert without the webhook — no request is made", /if \(!isSlackWebhookUrl\(url\)\) return;/.test(sender));
ok("test rows never notify", /opts\.is_test === true\) return;/.test(sender));
ok("it cannot throw into a save: the request is inside try/catch", /try \{[\s\S]*await fetch\(url[\s\S]*\} catch \(err\)/.test(sender));
ok("and it is bounded, with no retry that could post twice", /AbortSignal\.timeout\(4000\)/.test(sender) && !/retry|attempt/i.test(sender));
ok("the log carries the kind and a status, never the URL or the text",
  /console\.info\("\[notify\]", \{ kind: event\.kind, ok: res\.ok, status: res\.status \}\)/.test(sender) &&
    !/console\.\w+\([^)]*\burl\b/.test(sender) && /err instanceof Error \? err\.name/.test(sender));
ok("it does not share code with the Slack relay, which must never face real parents",
  !/from "@\/lib\/server\/slack"/.test(sender) && !/SLACK_BOT_TOKEN|SLACK_CHANNEL_ID|MESSAGING_RELAY/.test(sender));

/* ── The three doors ──────────────────────────────────────────────────────── */
const save = code("../app/api/seed/save/route.ts");
ok("a card notifies only when it is new, not when a recap fix or the name toggle re-sends it",
  /if \(!result\.data\.updated\) \{\s*after\(\(\) =>\s*notifyAdmins\(/.test(save));
const profile = code("../app/api/seed/profile/route.ts");
ok("a parent notifies only on the first capture of their profile, never on an edit",
  /if \(result\.data\.created\) \{[\s\S]*after\(\(\) =>[\s\S]*notifyAdmins\(/.test(profile));
const claim = code("../app/api/caregiver/claim/route.ts");
ok("a caregiver's sign-up notifies once, not when she revises it",
  /if \(!result\.data\.updated\) after\(\(\) => notifyAdmins\(/.test(claim));
ok("all three run after the response, so Slack can never cost anybody a save",
  [save, profile, claim].every((s) => /import \{ NextResponse, after \} from "next\/server"/.test(s)));
ok("and every one passes is_test through, or the QA walk would fill the channel",
  /is_test: raw\.is_test === true/.test(save) && /is_test: payload\.is_test/.test(profile));

const repo = code("../lib/server/repo/profile.ts");
ok("'first capture' is read from profile_captured_at before the upsert overwrites it, not from the insert",
  /capturedAt: people\.profileCapturedAt/.test(repo) && /firstCapture = !before \|\| before\.capturedAt === null/.test(repo));

/* ── The money box that shipped with it ───────────────────────────────────── */
const write = code("../lib/server/repo/admin-write.ts");
ok("reward paid: only a Founding-approved person can be ticked, and ticking twice keeps the first date",
  /case "contributor\.reward_paid"/.test(write) &&
    /coalesce\(reward_paid_at, now\(\)\)/.test(write) && /founding = 'founding'/.test(write));
ok("and it is reachable through the one admin endpoint",
  /"contributor\.reward_paid"/.test(code("../app/api/admin/action/route.ts")));
ok("the migration refuses a date without a name, and a name without a date",
  /reward_paid_pair/.test(read("../drizzle/0052_reward_paid.sql")));

console.log(`\n${pass} checks passed${fail ? `, ${fail} FAILED` : "."}`);
process.exit(fail ? 1 : 0);
