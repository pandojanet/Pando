// npm --prefix web run test:account-sync — the phone's copy against the database (24 Nov,
// lib/account-sync.ts). The decision is a pure function of the phone's copy and what /api/seed/me said,
// so every case is walked here with literal expectations; the screens' wiring is checked from source.
//
// Why: a client "deleted" her profile and walked back in through storage — every screen trusted the
// phone's copy and nothing asked whether the server still stood behind it.
import fs from "node:fs";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : detail ? `  (${detail})` : ""}`);
};
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const load = <T,>(file: string) => import(file) as Promise<T>;
const sync = await load<typeof import("../lib/account-sync.ts")>("../lib/account-sync.ts");
const storage = await load<typeof import("../lib/storage.ts")>("../lib/storage.ts");
const templates = await load<typeof import("../lib/sms-templates.ts")>("../lib/sms-templates.ts");

const NOW = new Date("2026-11-24T10:00:00.000Z");
const base = storage.newSession({ invite_code: "mops-altadena", market_id: "pasadena", source: "join" });
const saved = {
  ...base,
  phone: "+16265550101",
  phone_verified: true,
  name: "Alice Probe",
  first_name: "Alice",
  profile_saved_at: "2026-11-20T09:00:00.000Z",
  referral_code: "alice-1",
  follow_up_opt_in: true,
  chat: { mode: "menu", draft: null, submissions: [], messages: [] },
  answers: { ...base.answers, neighborhood: "altadena" },
} as typeof base;
const serverAnswers = { ...base.answers, neighborhood: "pasadena" };
const found = (extra: Record<string, unknown> = {}) => ({
  ok: true, found: true, phone: "+16265550101", first_name: "Alice", wants_founding: true, profile_saved: true,
  referral_code: "alice-1", answers: serverAnswers, ...extra,
});

console.log("\n=== which copies are checked ===");
ok("a saved profile under a confirmed number is an account", sync.claimsAccount(saved));
ok("a questionnaire not yet saved is not", !sync.claimsAccount({ ...saved, profile_saved_at: null }));
ok("a profile held on the phone until its code is not (its code comes at the end, as before)",
  !sync.claimsAccount({ ...saved, phone_verified: false, referral_code: null, server_saved_at: null }));
ok("no copy at all is not", !sync.claimsAccount(null));
/* 24 Nov, the hole the developer named: a refused write turns phone_verified off, and the profile in the
   database then opened from the phone without a code. */
ok("a profile the database holds stays an account after a refused write turned the flag off (seen on the server)",
  sync.claimsAccount({ ...saved, phone_verified: false, referral_code: null, server_saved_at: "2026-11-20T09:00:00.000Z" }));
ok("and on a phone from before that stamp, its referral link — only the server mints one — says the same",
  sync.claimsAccount({ ...saved, phone_verified: false, referral_code: "alice-1", server_saved_at: null }));
ok("such a copy, checked against a lapsed confirmation, is sent to sign in",
  sync.reconcile({ ...saved, phone_verified: false }, { ok: false, found: false, reason: "expired" }, NOW).state === "signed_out");
ok("a check that finds the profile stamps it as seen on the server",
  (() => { const r = sync.reconcile({ ...saved, server_saved_at: null }, found(), NOW); return r.state === "in_step" && r.session.server_saved_at === NOW.toISOString(); })());

console.log("\n=== the five answers ===");
ok("Pando unreachable: offline, the phone's copy is kept", sync.reconcile(saved, { ok: false, found: false, reason: "unavailable" }, NOW).state === "offline");
ok("a network error: offline too", sync.reconcile(saved, { ok: false, found: false, reason: "failed" }, NOW).state === "offline");
ok("the confirmation lapsed: signed out, sign in with a code", sync.reconcile(saved, { ok: false, found: false, reason: "expired" }, NOW).state === "signed_out");
ok("confirmed, nobody on the number: erased", sync.reconcile(saved, { ok: true, found: false }, NOW).state === "erased");

const step = sync.reconcile(saved, found(), NOW);
const s = step.state === "in_step" ? step.session : null;
ok("confirmed and found: in step", step.state === "in_step" && step.replaced === false);
ok("the answers are the database's", s?.answers.neighborhood === "pasadena", String(s?.answers.neighborhood));
ok("and a difference is said (changed)", step.state === "in_step" && step.changed === true);
ok("the phone keeps what only it has: the chat, the follow-up choice, the name in full",
  s?.chat === saved.chat && s?.follow_up_opt_in === true && s?.name === "Alice Probe");
ok("a copy that matches the database is not reported as changed",
  (() => { const r = sync.reconcile({ ...saved, answers: serverAnswers }, found(), NOW); return r.state === "in_step" && r.changed === false; })());
ok("a profile written before raw_answers leaves the phone's answers alone",
  (() => { const r = sync.reconcile(saved, found({ answers: null }), NOW); return r.state === "in_step" && r.session.answers.neighborhood === "altadena"; })());
ok("the referral code and Founding come from the database",
  (() => { const r = sync.reconcile(saved, found({ referral_code: "alice-9", wants_founding: false }), NOW); return r.state === "in_step" && r.session.referral_code === "alice-9" && r.session.wants_founding === false; })());

console.log("\n=== two parents, one phone ===");
const other = sync.reconcile(saved, found({ phone: "+16265550202", first_name: "Bea", referral_code: "bea-1" }), NOW);
ok("a copy made under another number is replaced, not merged", other.state === "in_step" && other.replaced === true && other.changed === true);
ok("nothing of the first parent's is left: no chat, no follow-up choice, no name",
  other.state === "in_step" && other.session.chat === null && other.session.follow_up_opt_in !== true && other.session.name === "Bea" && other.session.phone === "+16265550202",
  other.state === "in_step" ? JSON.stringify({ chat: other.session.chat, follow_up: other.session.follow_up_opt_in, name: other.session.name }) : "");
ok("and the second parent's profile is theirs from the database", other.state === "in_step" && other.session.answers.neighborhood === "pasadena" && other.session.referral_code === "bea-1");

console.log("\n=== where a sign-in returns ===");
ok("back to the screen that sent them, when it is one of ours", sync.signInHref("/profile") === "/signin?next=%2Fprofile" && sync.safeNext("/share") === "/share");
ok("never to an address from elsewhere", sync.safeNext("https://evil.example") === "/done" && sync.safeNext("//evil.example") === "/done" && sync.safeNext(null) === "/done" && sync.signInHref("/admin") === "/signin");

console.log("\n=== a week, and the screens that use it ===");
ok("a confirmed number lasts seven days", templates.VERIFICATION_SESSION_HOURS === 24 * 7);
const shared = read("components/seed/done/shared.tsx");
ok("the completion screens wait for the answer before showing a saved profile",
  /useAccountSync\(\{ session, setSession, returnTo: pathname \?\? "\/done" \}\)/.test(shared) && /const loaded = read && \(checked \|\| !claimsAccount\(session\)\);/.test(shared));
ok("so do the profile and the chat",
  /claimsAccount\(session\) && !accountChecked/.test(read("components/seed/ProfileFlow.tsx")) && /session && claimsAccount\(session\) && !accountChecked/.test(read("components/seed/chat/ChatSeeding.tsx")));
ok("the profile checks again on coming back only while on the review, never mid-question", /live: stage === "review",/.test(read("components/seed/ProfileFlow.tsx")));
const hook = read("components/seed/useAccountSync.ts");
ok("an in-step answer is applied to the screen's latest state; another number's copy replaces it whole",
  /if \(check\.replaced\) return saveSession\(check\.session\);\s+return saveSession\(\{ \.\.\.prev, \.\.\.pick\(check\.session\) \}\);/.test(hook));
ok("signing in goes through the same reconcile and returns to next",
  /reconcile\(/.test(read("components/seed/SignIn.tsx")) && /router\.push\(safeNext\(new URLSearchParams\(window\.location\.search\)\.get\("next"\)\)\);/.test(read("components/seed/SignIn.tsx")));
ok("/api/seed/me tells the caller its own confirmed number", /phone: verified\.phone,/.test(read("app/api/seed/me/route.ts")));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);
