/**
 * "Reset profile" (3 Nov): an admin erases a person and everything they
 * shared, so the flow can be walked again from scratch — and the phone that
 * still holds the old session throws it away on its own.
 *
 * Read as source: the action runs in Postgres and the device half in a
 * browser. The lab walk is the live proof (docs/decisions.md, 3 Nov).
 */
import fs from "node:fs";

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
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const write = read("lib/server/repo/admin-write.ts");
const erase = read("lib/server/repo/parent-delete.ts");
const names = read("lib/admin/action-names.ts");
const button = read("components/admin/ResetProfile.tsx");
const page = read("app/(admin)/admin/contributors/[id]/page.tsx");
const client = read("lib/api-client.ts");
const flow = read("components/seed/ProfileFlow.tsx");
const chat = read("components/seed/chat/ChatSeeding.tsx");

console.log("\n=== admin only, and never by accident ===");
ok("an admin action, so it goes through the admin route's sign-in and audit", /"person\.reset"/.test(names) && /case "person\.reset":/.test(write));
ok("refused unless RESET was typed — on the server, not only on the button",
  /if \(text\(b\.confirm\) !== "RESET"\) return \{ applied: false, reason: "reset_not_confirmed" \}/.test(write));
ok("the button stays disabled until RESET is typed", /disabled=\{busy \|\| typed\.trim\(\) !== "RESET"\}/.test(button));
ok("it is on the person's admin page", /<ResetProfile id=\{id\}/.test(page));
const seedFiles = fs.readdirSync(new URL("../components/seed", import.meta.url), { recursive: true }) as string[];
ok("and on no page a parent can reach",
  !seedFiles.some((f) => /\.tsx$/.test(f) && /person\.reset|ResetProfile/.test(read(`components/seed/${f.replace(/\\/g, "/")}`))));

console.log("\n=== what goes ===");
ok("the person's own DELETE and the reset share one erase",
  /await erasePersonIn\(tx, \{ id, phone, caregiver \}, \{ withContributions: false \}\)/.test(erase) &&
    /erasePersonIn\(\s+tx,[\s\S]{0,200}\{ withContributions: true \}/.test(write));
ok("the reset takes what they shared: recommendations, nominations, submissions",
  /delete from share_contributions where person_id/.test(erase) &&
    /delete from caregiver_nominations where person_id/.test(erase) &&
    /delete from submissions where person_id/.test(erase));
ok("a place goes only when nobody else has a word about it",
  /delete from shares s[\s\S]{0,200}not exists \(select 1 from share_contributions sc where sc\.share_id = s\.id\)/.test(erase));
ok("a caregiver only when nobody else nominated them and they have not claimed the listing",
  /c\.profile_person_id is null[\s\S]{0,200}not exists \(select 1 from caregiver_nominations n[\s\S]{0,200}not exists \(select 1 from caregiver_claims cc/.test(erase));
ok("the audit row carries counts, never the number", /before: \{ had_profile: person\.had_profile === true, \.\.\.removed \}/.test(write) &&
  !/before: \{[^}]*phone/.test(write.slice(write.indexOf('case "person.reset"'), write.indexOf('case "referral.void"'))));

console.log("\n=== the phone starts over ===");
ok("only on a definite answer: a saved profile on the device, and nobody on the server",
  /if \(!session\?\.profile_saved_at\) return false;[\s\S]{0,80}return me\.ok && !me\.found;/.test(client));
ok("the questionnaire drops its copy and goes to the invite link",
  /if \(me\.ok && !me\.found\) \{\s+clearSession\(\);\s+router\.replace\(joinAgainHref\(existing\)\);/.test(flow));
ok("so does the chat, so no card is added for nobody",
  /profileErasedOnServer\(existing\)\.then\(\(erased\) => \{\s+if \(!erased\) return;\s+clearSession\(\);\s+router\.replace\(joinAgainHref\(existing\)\);/.test(chat));
ok("the invite link is the one kept on the device", /\/join\?i=\$\{encodeURIComponent\(session\.invite_code\)\}/.test(client));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);
