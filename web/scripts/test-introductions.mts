/**
 * Introductions (21 Oct) — parent to parent, through a person at Pando.
 *
 * The triggers, the offer's words (never another parent's name), the status
 * moves an admin may make, and source checks on the parts this suite cannot
 * load (the inbound handler and the admin action route carry `server-only`).
 */

import fs from "node:fs";

const i = (await import(`../lib/introductions.ts?v=${Date.now()}`)) as typeof import("../lib/introductions");

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

console.log("\n=== taking the offer ===");
for (const t of ["INTRO", "intro please", "Yes intro", "introduce me", "Intro."]) ok(`"${t}" takes it`, i.acceptsIntro(t));
for (const t of ["yes", "introductions are scary", "no", "intro to coding classes?"]) ok(`"${t}" is not INTRO`, !i.acceptsIntro(t));

console.log("\n=== naming which record (any answer, 21 Oct) ===");
const targets: Array<[string, string | null]> = [
  ["INTRO Little Maestros", "Little Maestros"],
  ["intro for the swim class", "the swim class"],
  ["introduce me to someone at Tiny Tots Gym", "Tiny Tots Gym"],
  ["INTRO", null],
  ["intro please", null],
  ["intro to coding classes?", null],
];
for (const [t, want] of targets) {
  const got = i.introTarget(t);
  ok(`"${t}" -> ${want}`, got === want, `got ${got}`);
}
ok("a request reads two weeks of answers, not three days", i.INTRO_EXPLICIT_DAYS === 14);
const repo = fs.readFileSync(new URL("../lib/server/repo/introductions.ts", import.meta.url), "utf8");
ok("the record they named is chosen first", /case when \$\{named\} <> ''[\s\S]{0,200}like '%' \|\| \$\{named\} \|\| '%'/.test(repo));

console.log("\n=== doctors and products are in answers (21 Oct) ===");
const retrieval = fs.readFileSync(new URL("../lib/server/repo/retrieval.ts", import.meta.url), "utf8");
ok("doctors are a default kind", retrieval.includes('["activity", "place", "tip", "doctor"]'));
ok("products are no longer kept out", !retrieval.includes("subcategory is distinct from 'products'"));
ok("a No's 'what didn't work' is never quoted as praise", retrieval.includes("sc.recommendation in ('yes','yes_with_caveats')"));
const answer = (await import(`../lib/answer.ts?v=${Date.now()}`)) as typeof import("../lib/answer");
ok("a specialist is called one", answer.subcategoryWord("specialists") === "specialist");
ok("a party vendor is not called a doctor", answer.subcategoryWord("parties") === "party service");
ok("a product is a product", answer.subcategoryWord("products") === "product");
ok("no sub-category leaves the kind's own word", answer.subcategoryWord(null) === null);
const intentSrc = fs.readFileSync(new URL("../lib/server/intent.ts", import.meta.url), "utf8");
ok("asking which doctor is not sensitive by itself", intentSrc.includes("is a recommendation, not sensitive by itself"));
ok("a symptom still is", intentSrc.includes("It IS") && intentSrc.includes("sensitive once it describes a symptom"));
const fresh = fs.readFileSync(new URL("../drizzle/0060_doctor_freshness.sql", import.meta.url), "utf8");
ok("doctors have a freshness policy", /\('doctor', 180, 365\)/.test(fresh));

console.log("\n=== asking for one ===");
for (const t of ["can you introduce me to a parent who goes there?", "could you put me in touch with one of them", "I'd love to talk to a parent who's been"]) {
  ok(`"${t}" asks`, i.asksForIntro(t));
}
for (const t of ["any good swim classes?", "is there a parent and me class?", "thanks!"]) ok(`"${t}" does not`, !i.asksForIntro(t));

console.log("\n=== the offer: the client's words, and no names ===");
ok("two is 'a couple'", i.introOffer("Little Maestros", 2).startsWith("By the way, a couple of parents Pando knows have used Little Maestros."));
ok("one is 'a parent'", i.introOffer("Little Maestros", 1).startsWith("By the way, a parent Pando knows has used Little Maestros."));
ok("more is a number", i.introOffer("Little Maestros", 4).includes("4 parents Pando knows have used"));
ok("never 'near you': nothing checks where they live (review, 21 Oct)", !i.introOffer("X", 2).includes("near you"));
ok("'used' fits a doctor or a product", !i.introOffer("Graco stroller", 1).includes("been to"));
for (const t of ["Any good intro to ballet classes?", "intro to coding classes?", "Can you connect me with a good pediatrician?"]) {
  ok(`"${t}" is a question, not an intro request (review, 21 Oct)`, !i.asksForIntro(t));
}
ok("it says how to take it, and that they are asked first", /Reply INTRO and someone at Pando will ask them first\.$/.test(i.introOffer("X", 2)));
ok("a name outside GSM-7 cannot break the encoding", !/[^\x20-\x7E]/.test(i.introOffer("Zoë’s Studio \u{1F600}", 2)));
for (const [name, copy] of Object.entries({ REQUESTED: i.INTRO_REQUESTED, NOTHING: i.INTRO_NOTHING, ALREADY: i.INTRO_ALREADY })) {
  ok(`${name} is plain GSM-7`, !/[^\x20-\x7E]/.test(copy));
}
ok("the reply promises consent first", /only if they say yes/.test(i.INTRO_REQUESTED));

console.log("\n=== the statuses, and the only moves an admin may make ===");
ok("requested can be approved", i.canMove("intro.approve", "requested"));
ok("approved can be marked contacted", i.canMove("intro.contacted", "approved"));
ok("contacted can be connected", i.canMove("intro.connected", "contacted"));
ok("or declined", i.canMove("intro.declined", "contacted"));
ok("requested or approved can be rejected", i.canMove("intro.reject", "requested") && i.canMove("intro.reject", "approved"));
ok("nobody is connected before being contacted", !i.canMove("intro.connected", "approved") && !i.canMove("intro.connected", "requested"));
ok("an offer nobody took cannot be approved", !i.canMove("intro.approve", "offered"));
ok("a closed request cannot move", !i.canMove("intro.approve", "connected") && !i.canMove("intro.reject", "connected"));
ok("every status has words for the admin", i.INTRO_STATUSES.every((s) => typeof i.INTRO_STATUS_LABEL[s] === "string"));

console.log("\n=== the SQL keeps the same moves (source checks) ===");
const write = fs.readFileSync(new URL("../lib/server/repo/admin-write.ts", import.meta.url), "utf8");
for (const [action, move] of Object.entries(i.INTRO_MOVES)) {
  const at = write.indexOf(`case "${action}"`);
  const block = at >= 0 ? write.slice(at, at + 1600) : "";
  const fromSql = move.from.length === 1 ? `status = '${move.from[0]}'` : `status in (${move.from.map((s) => `'${s}'`).join(", ")})`;
  ok(`${action} only moves from ${move.from.join(" or ")}`, block.includes(fromSql), fromSql);
}
ok("contacted only names a parent who has been there", /intro\.contacted[\s\S]{0,1400}sc\.status = 'approved' and sc\.firsthand/.test(write));
ok("and never the requester", /intro\.contacted[\s\S]{0,1400}<> i\.requester_id/.test(write));
const route = fs.readFileSync(new URL("../app/api/admin/action/route.ts", import.meta.url), "utf8");
ok("rejecting needs a reason", /action === "intro\.reject"[\s\S]{0,200}cleanText\(body\?\.reason/.test(route));
ok("contacted needs the parent", /action === "intro\.contacted"[\s\S]{0,300}parent_id/.test(route));
const migration = fs.readFileSync(new URL("../drizzle/0059_introductions.sql", import.meta.url), "utf8");
ok("the table holds no contact detail", !/\bphone\b|\bemail\b/.test(migration.replace(/--.*$/gm, "")));
ok("nobody is contacted, connected or declined without a contact time, and the other parent's DELETE is not blocked (review, 21 Oct)", migration.includes("introductions_contacted_has_time") && !migration.includes("introductions_contacted_has_parent"));
ok("one open request per parent and record, the index created exactly once (it was in three times, review 21 Oct)", (migration.match(/CREATE UNIQUE INDEX introductions_one_open/g) ?? []).length === 1);
const repoNow = fs.readFileSync(new URL("../lib/server/repo/introductions.ts", import.meta.url), "utf8");
ok("only parents who said yes to being asked are candidates (follow_up_ok)", (repoNow.match(/sc\.follow_up_ok/g) ?? []).length >= 2);
ok("and never an opted-out one", (repoNow.match(/sms_opt_outs/g) ?? []).length >= 2);
ok("INTRO <name> asks only about that record", repoNow.includes("not ${strict}"));
/* 27 Oct: "INTRO Little Maestros" after the offer named it inserted a second row
   and left the offer `offered` — "0 of 1 offers taken" for a parent who took it. */
const explicitFn = repoNow.slice(repoNow.indexOf("export async function requestIntroExplicitly"));
const promoteAt = explicitFn.indexOf("update introductions set status = 'requested'");
const insertAt = explicitFn.indexOf("insert into introductions");
ok(
  "a named INTRO takes the open offer for that record before it would insert one",
  promoteAt > 0 && insertAt > promoteAt &&
    /status = 'offered'[\s\S]{0,200}status = 'offered'\s*returning id/.test(explicitFn.slice(promoteAt, insertAt)) &&
    /share_id = \$\{String\(found\[0\]\.share_id\)\}::uuid\s*and status = 'offered'/.test(explicitFn.slice(promoteAt, insertAt)),
);
ok(
  "and the promoted offer is a fresh request, not 'already asked'",
  /if \(promoted\[0\]\?\.id\) return \{ id: String\(promoted\[0\]\.id\), already: false \};/.test(explicitFn),
);
const stepNow = fs.readFileSync(new URL("../lib/server/introductions.ts", import.meta.url), "utf8");
ok("'intro classes for toddlers' that names no record is answered as a question (review, 21 Oct)", stepNow.includes("if (!made && target && /\\b(class|classes|lessons?"));
ok("a named search escapes LIKE and needs four letters", repoNow.includes(".replace(/[\\\\%_]/g") && repoNow.includes("length < 4) return null;"));
ok("a bare yes takes an open intro offer and nothing else - never an explicit request", /if \(!word && plainYes\(body\)\) \{\s*const taken = await takeIntroOffer\(input\.personId\);\s*if \(!taken\) return null;/.test(stepNow));
const writeNow = fs.readFileSync(new URL("../lib/server/repo/admin-write.ts", import.meta.url), "utf8");
ok("the admin cannot pair a test requester with a real parent", writeNow.includes("and p.is_test = i.is_test") && fs.readFileSync(new URL("../lib/server/repo/admin-read.ts", import.meta.url), "utf8").includes("and p.id <> i.requester_id and p.is_test = i.is_test"));
/* Audit, 22 Oct: a parent who texted STOP was listed (with a badge) and accepted as the contact. */
const contacted = writeNow.slice(writeNow.indexOf('case "intro.contacted": {'), writeNow.indexOf('case "intro.connected"'));
ok("'I contacted this parent' refuses somebody who texted STOP", contacted.includes("from sms_opt_outs o"));
const readNow = fs.readFileSync(new URL("../lib/server/repo/admin-read.ts", import.meta.url), "utf8");
const introRead = readNow.slice(readNow.indexOf("from introductions i"), readNow.length).length > 0
  ? readNow.slice(readNow.lastIndexOf("select json_agg(c"), readNow.lastIndexOf(") c), '[]'::json) as candidates"))
  : "";
ok("and the admin's candidate list leaves them out", /and not exists \(select 1 from sms_opt_outs o2/.test(introRead), introRead.slice(0, 80));
/* 27 Oct: the page's default pick is the first candidate, which was planner order. */
ok(
  "the candidates are ordered on purpose: goes there now, then recently, then the latest to vouch",
  introRead.startsWith("select json_agg(c order by c.recency_rank, c.vouched_at desc, c.person_id)") &&
    /when 'current' then 0 when 'recent' then 1/.test(introRead),
  introRead.slice(0, 80),
);
const inboundNow = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
ok("a 'no' is checked against a newer deep-dive or intro offer too, not only a 'yes'", inboundNow.includes('const [deepOffer, introAt] = helpedReply !== null || pingReply !== "unclear"'));

console.log("\n=== the answer offers it with one ask per message (source checks) ===");
const inbound = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
ok("never beside a deep-dive offer", /const introOthers =\s*!offerDeepEligible/.test(inbound));
ok("never beside the Network Ask offer", /!draftText\.includes\("Want me to ask"\)/.test(inbound));
ok("never on a held, care or sensitive answer", /const introOthers =[\s\S]{0,200}!verdict\.hold[\s\S]{0,60}!ownsAPerson[\s\S]{0,60}!caregiverRelated/.test(inbound));
ok("it takes the clarifying question's place", inbound.includes("asking && !urgent && !offerDeep && !offerIntro && nextStep !== \"offer_blast\""));
ok("the offer is recorded only once it was sent", /if \(offerIntro && sending && result\.sent && person && lead\?\.id\)/.test(inbound));
ok("INTRO is read before the clarifying step (never a first name)", inbound.indexOf("introStep({") < inbound.indexOf("5.4 — if Pando asked them something"));

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
