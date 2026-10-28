/**
 * The 22 Oct audit's fixes that change behaviour, pinned as source — each one
 * is a rule in SQL or in the send path that a future edit could quietly undo.
 * Pure: reads files, touches no database and sends nothing.
 */
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

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

console.log("\n=== caregivers: who counts behind her ===");
const retrieval = read("../lib/server/repo/retrieval.ts");
ok(
  "only an approved, unheld family counts as a parent who employed her",
  /count\(n\.id\) filter \(where n\.worked_for_family and n\.status = 'approved'\s+and not n\.review_hold\)/.test(retrieval),
);
ok("and only such a family can be the reference", /bool_or\(n\.reference_willing = 'yes' and n\.status = 'approved'\s+and not n\.review_hold\)/.test(retrieval));

console.log("\n=== DELETE removes what they asked ===");
const del = read("../lib/server/repo/parent-delete.ts");
const delAnswers = del.indexOf("delete from answers where phone = ${phone}");
const delPeople = del.indexOf("delete from people where id = ${id}::uuid");
ok("their answers (phone and question) are deleted", delAnswers > 0);
ok("before the person, in the same transaction", delAnswers > 0 && delPeople > delAnswers);
ok("an introduction where they were contacted loses the admin's note about them", del.includes("update introductions set note = null where other_parent_id = ${id}::uuid"));

console.log("\n=== PostHog never gets a first name ===");
const analytics = read("../lib/analytics.ts");
ok("a personal referral code is sent as the word 'personal'", analytics.includes('invite_code: props.personal ? "personal" : props.invite_code'));
ok("the landing page says which links are personal", read("../components/seed/InviteLanding.tsx").includes("personal: invite.has_inviter === true"));
const provider = read("../lib/posthog-provider.tsx");
/* 28 Oct: one scrubber for every URL property, its behaviour checked in test:security. */
ok("and the invite code is stripped from the page URL", provider.includes("scrubAnalyticsUrl(") && analytics.includes('const SECRET_PARAMS = ["i", "invite"]'));

console.log("\n=== freshness pings at each kind's threshold ===");
const jobs = read("../lib/server/repo/jobs.ts");
ok("the ping job reads freshness_policy", jobs.includes("left join freshness_policy fp on fp.kind = shares.kind"));
ok("and asks at the kind's ageing threshold, 90 days only as the fallback", jobs.includes("make_interval(days => coalesce(fp.ageing_days, 90))"));
ok("no hardcoded 90-day threshold left in the stale set", !/last_confirmed_at < now\(\) - interval '90 days'/.test(jobs));

console.log("\n=== 'any others?' is held as the first answer was ===");
const followup = read("../lib/server/repo/answers-followup.ts");
ok("the follow-up reads the first answer's hold reason", followup.includes("select question_text, hold_reason"));
const inbound = read("../lib/server/inbound.ts");
ok("a sensitive question's follow-up is sensitive", inbound.includes('sensitive: prior.holdReason === "sensitive"'));
ok("a care question's follow-up is care", inbound.includes('careBefore || prior.holdReason === "caregiver"'));
ok("nothing passes a hard-coded sensitive: false into a follow-up", !/more: \{ texts: prior\.texts[\s\S]{0,40}\}/.test("") && !inbound.includes("          sensitive: false,\n          more:"));

console.log("\n=== one send per Ask ===");
const blast = read("../lib/server/repo/blast.ts");
ok("a second press while sending is refused as already sent", /if \(SENDING\.has\(blastId\)\) return \{ ok: false, sent: 0, skipped: 0, reason: "already_sent" \}/.test(blast));
ok("and the guard is released however the send ends", /finally \{\s+SENDING\.delete\(blastId\);/.test(blast));

console.log("\n=== invariant 6: the throttle step ===");
const sms = read("../lib/server/sms.ts");
const throttleAt = sms.indexOf("await throttle();");
const providerAt = sms.indexOf("4. Provider");
const frequencyAt = sms.indexOf('reason: "frequency_cap"');
ok("sendSms throttles", throttleAt > 0);
ok("after the frequency check and before the provider", frequencyAt > 0 && throttleAt > frequencyAt && throttleAt < providerAt);
const throttleMs = Number(sms.match(/export const THROTTLE_MS = (\d+);/)?.[1] ?? 0);
ok("at a spacing that is a real limit (100–1000 ms)", throttleMs >= 100 && throttleMs <= 1000, String(throttleMs));

console.log("\n=== the server's env template ===");
const deployEnv = read("../../deploy/.env.example");
for (const name of ["TRUSTED_PROXIES", "JOBS_SECRET", "ANSWER_VOICE_ENABLED", "DEEP_DIVE_SITES", "MESSAGING_RELAY", "WEB_SEARCH_ENABLED"]) {
  ok(`deploy/.env.example lists ${name}`, new RegExp(`^#?\\s*${name}=`, "m").test(deployEnv));
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
