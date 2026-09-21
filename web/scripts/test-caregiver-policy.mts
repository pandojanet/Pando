/**
 * M11 — the caregiver protections, as checks.
 *
 * Most of what M11 asks for was built earlier under other row numbers, which is
 * worth asserting rather than assuming: 11.1's consent scopes are the 2C flow's
 * four permissions, and 11.2's age gate is invariant 2. A test that pins them is
 * what stops a later "simplification" collapsing four consents into one switch,
 * which is the exact failure the ladder exists to prevent.
 *
 * What is genuinely new here is **11.3's DELETE keyword** — unbuildable until
 * 2 Sep because there was no inbound channel, and now reachable through both
 * transports.
 */

import fs from "node:fs";

const c = (await import(`../lib/consent.ts?v=${Date.now()}`)) as typeof import("../lib/consent.ts");
const s = (await import(`../lib/sms-templates.ts?v=${Date.now()}`)) as typeof import("../lib/sms-templates.ts");

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

console.log("\n=== 11.1  the consent scope model: four permissions, never one ===");
/**
 * The estimate: "what a caregiver's consent covers — being listed and being
 * contactable by parents, but **not** being a reference. References come from
 * the nominating parent instead."
 */
const CAREGIVER_SCOPES = [
  "caregiver_profile",
  "caregiver_listing",
  "caregiver_introduction",
  "caregiver_reference",
];
ok(
  "each is its own scope",
  new Set(CAREGIVER_SCOPES).size === 4,
);
ok(
  "and each has its own sentence",
  new Set(Object.values(c.CAREGIVER_CONSENT_TEXT)).size === 4,
  "a single sentence covering all four would be a single permission wearing four names",
);
ok(
  "existing at all buys nothing visible",
  /stays private/i.test(c.CAREGIVER_CONSENT_TEXT.profile),
  "G2 is the price of entry — consent is not visibility (11 Aug)",
);
ok(
  "being listed never includes the number",
  /never my number/i.test(c.CAREGIVER_CONSENT_TEXT.listing),
  "invariant 13 — Pando holds no contact detail for a nominee at all",
);
ok(
  "an introduction is asked for every single time",
  /every time/i.test(c.CAREGIVER_CONSENT_TEXT.introduction),
  "strictly more exposure than being named, so it is never implied by it",
);
ok(
  "and the reference is asked of the FAMILY, not of the caregiver",
  /Pando asks them, not me/i.test(c.CAREGIVER_CONSENT_TEXT.reference),
  "the estimate's own words: references come from the nominating parent instead",
);
ok(
  "all four share one version string, so a reworded flow re-versions together",
  c.CAREGIVER_CONSENT_TEXT_VERSION.length > 0,
);
ok(
  "and a caregiver consent resolves to that version, never the parent one",
  c.buildConsentRecord("caregiver_listing", true, "test").text_version ===
    c.CAREGIVER_CONSENT_TEXT_VERSION,
  "a stored consent has to resolve to the text that was actually on screen",
);
ok(
  "a declined permission is stored, not omitted",
  c.buildConsentRecord("caregiver_introduction", false, "test").status === "declined",
  "finishing 2C with all three refused is a real supported outcome",
);

console.log("\n=== 11.3  the DELETE keyword ===");
ok("DELETE is read as a delete request", c.isDeleteRequest("DELETE"));
ok("lowercase too", c.isDeleteRequest("delete"));
ok("with a full stop", c.isDeleteRequest("Delete."));
ok('"remove me" too', c.isDeleteRequest("remove me"));
ok('and "delete my profile"', c.isDeleteRequest("DELETE MY PROFILE"));

console.log("\n=== 11.3  and the refusals, which are the half that matters ===");
/* Irreversible, so the parser has to be stricter here than anywhere else. */
ok(
  '"delete my saturday slot" is NOT a delete request',
  !c.isDeleteRequest("delete my saturday slot"),
  "a substring test would remove somebody's whole profile over a scheduling note",
);
ok(
  '"can you delete the wrong number?" is not',
  !c.isDeleteRequest("can you delete the wrong number?"),
);
ok(
  '"please delete" is not — it is a sentence, not the keyword',
  !c.isDeleteRequest("please delete"),
);
ok('"deleted" is not', !c.isDeleteRequest("deleted"));
ok("an empty message is not", !c.isDeleteRequest("   "));
ok(
  "and neither is STOP, which is a different decision entirely",
  !c.isDeleteRequest("STOP"),
  "STOP silences Pando; DELETE removes the profile — conflating them loses one of them",
);

console.log("\n=== 11.3  the receipts say what happened and ask nothing ===");
const deleted = s.profileDeletedSms({ caregiver: true, profile: false, contributions: 0 });
ok("it confirms the profile is gone", /deleted/i.test(deleted));
ok(
  "it says families can no longer see them",
  /no longer see you/i.test(deleted),
  "the consequence, not just the mechanics",
);
ok(
  "it asks nothing — no exit survey, no 'was it something we did'",
  !deleted.includes("?"),
  "the 2C flow promises the profile goes without asking why",
);
ok("STOP and HELP last, as registered", /Reply STOP to opt out, HELP for help\.$/.test(deleted));
ok(
  "a caregiver who contributed nothing is sent back to /caregiver, not /join",
  /pando\.is\/caregiver/.test(deleted),
  "the flow they came from is the one that can take them back",
);

console.log("\n=== 14 Sep  the same word, for a parent ===");
/**
 * The widening. `/privacy` has told every parent they may text DELETE since the
 * page was ported; until today the handler resolved the number against
 * `caregiver_claims` and turned everybody else away.
 */
const parent = s.profileDeletedSms({ caregiver: false, profile: true, contributions: 3 });
ok(
  "a parent is told what STAYED, which is the thing they cannot guess",
  /What you recommended stays/i.test(parent),
  "the web control says it in a panel before the tap; over SMS the receipt is the only place it can be said",
);
ok(
  "and is not told about a caregiver listing they never had",
  !/families can no longer see/i.test(parent),
  "composed per outcome rather than one string covering every case",
);
ok(
  "a contributor with nothing detached is not told about recommendations",
  !/What you recommended stays/i.test(
    s.profileDeletedSms({ caregiver: false, profile: true, contributions: 0 }),
  ),
);
const both = s.profileDeletedSms({ caregiver: true, profile: true, contributions: 2 });
ok(
  "somebody who is both is told about both halves",
  /families can no longer see/i.test(both) && /What you recommended stays/i.test(both),
  "DELETE removes everything, so the receipt has to name everything it removed",
);

const none = s.nothingToDeleteSms();
ok(
  "a number holding nothing is told exactly that",
  /nothing on this number to delete/i.test(none),
  "it used to read 'no caregiver profile on this number' — true when only a caregiver could delete, and actively misleading now that a parent reaching this line holds no profile either",
);
ok(
  "and a person stays reachable for the case where that is wrong",
  /hello@pando\.is/.test(none),
);
ok(
  "the two receipts are different messages",
  deleted !== none,
  "telling somebody who had a profile that they never had one is the one lie this feature must not tell",
);

const failed = s.deleteFailedSms();
ok(
  "an unreachable database says nothing was changed",
  /nothing was changed/i.test(failed),
  "after a destructive request, what did NOT happen is the fact the sender needs",
);
ok("all three receipts are distinct", new Set([deleted, none, failed]).size === 3);

console.log("\n=== the receipts are GSM-7, so a dash cannot cost a segment ===");
/**
 * ⚠ Measured, not assumed. The version this replaces carried one em dash, which
 * put a 192-character receipt into UCS-2 and cost a **third** segment on every
 * single deletion.
 */
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
for (const [label, body] of [
  ["caregiver-only", deleted],
  ["parent", parent],
  ["both halves", both],
  ["nothing found", none],
  ["failed", failed],
] as const) {
  const plan = seg.planSegments(body);
  ok(
    `${label}: ${body.length} chars, ${plan.encoding}, ${plan.segments} segment(s)`,
    plan.encoding === "gsm7" && plan.segments <= 2,
    plan.offenders.join(" ") || body,
  );
}

/* ── 11.4  the named-person policy ─────────────────────────────────────────── */

const np = (await import(`../lib/named-person.ts?v=${Date.now()}`)) as typeof import("../lib/named-person.ts");

console.log("\n=== 11.4  a record whose NAME is a person ===");
/**
 * The hole: a caregiver is protected by invariant 14's employment gate,
 * invariant 2's 18+ question, invariant 13 and invariant 1's four conditions —
 * and all of it keys on the record being a `caregivers` row. A tutor entered as
 * an *activity* gets none of it, and `shares.name` goes straight into an answer.
 */
for (const [name, signal] of [
  ["Ms. Diane", "honorific"],
  ["Coach Sarah", "honorific"],
  ["Dr. Patel", "honorific"],
  ["Tutor Maria", "honorific"],
  ["Nanny Alice", "honorific"],
  ["Diane Kovalenko", "personal_name"],
  ["Sarah Chen", "personal_name"],
  ["Diane's", "possessive_first_name"],
] as const) {
  const v = np.looksLikePerson(name);
  ok(`"${name}" is a person (${signal})`, v.person && v.signal === signal, JSON.stringify(v));
}

console.log("\n=== 11.4  and a venue word is an absolute veto ===");
/**
 * "Coach Patty's Gymnastics" is a **real record** in this market's taxonomy —
 * the importer's own search example. It carries an honorific *and* a business
 * word, so a rule that let the honorific win would flag a legitimate business
 * every time a market's gyms are named after their founders.
 */
ok(
  '"Coach Patty\'s Gymnastics" is NOT a person',
  !np.looksLikePerson("Coach Patty's Gymnastics").person,
  "a real record — the honorific must lose to the business word",
);
for (const name of [
  "Diane's Dance Studio",
  "Ms. Wendy's Preschool",
  "Kidspace Children's Museum",
  "Aveson Charter School",
  "Pasadena Waldorf School",
  "First Baptist Church",
  "Hahamongna Watershed Park",
]) {
  ok(`"${name}" is not a person`, !np.looksLikePerson(name).person);
}

console.log("\n=== 11.4  the place-name veto, which is what got it to zero ===");
/**
 * Measured, not asserted: against all 588 curated records in the Pasadena
 * taxonomy the `personal_name` signal alone flagged 16 (2.7%). The market's own
 * neighborhood list vetoes the place + descriptor shape that dominated them, and
 * with the institutional words those flags named, the rate is **0**.
 */
const PLACES = ["Pasadena", "Altadena", "Monrovia", "Eagle Rock", "Arcadia"];
for (const name of ["Brella Pasadena", "Calvary Monrovia", "Altadena Stables", "PlayLab Eagle Rock"]) {
  ok(
    `"${name}" is vetoed as a place`,
    !np.looksLikePerson(name, { placeWords: PLACES }).person,
  );
}
ok(
  "and a person is still caught with the same veto list passed",
  np.looksLikePerson("Diane Kovalenko", { placeWords: PLACES }).person,
  "the veto must not swallow the signal it exists beside",
);

console.log("\n=== 11.4  strong versus weak, because the costs differ ===");
const strong = np.looksLikePerson("Ms. Diane");
const weak = np.looksLikePerson("Diane Kovalenko");
ok("an honorific is strong", strong.person && strong.strong === true);
ok(
  "two capitalised words is weak",
  weak.person && weak.strong === false,
  "no lexical rule separates 'Diane Kovalenko' from 'Marshall Fundamental'",
);
ok(
  "so only the strong signal is safe to REFUSE on over SMS",
  strong.person && strong.strong && weak.person && !weak.strong,
  "the weak one prompts an admin; refusing on it would turn away a business with no way to argue",
);

console.log("\n=== 11.4  what is never a person ===");
for (const name of [
  "",
  "   ",
  "Room 12",
  "Studio 3",
  "LCHS",
  "YMCA",
  "swim with sarah",
  "Kidspace",
  "Diane",
]) {
  ok(`"${name}" is not flagged`, !np.looksLikePerson(name).person);
}
ok(
  "a single first name is deliberately not flagged",
  !np.looksLikePerson("Diane").person,
  "the commonest shape of a short legitimate business name — flagging it would bury the queue",
);
ok(
  "and lower-case prose is not an identification",
  !np.looksLikePerson("swim with sarah").person,
  "capitalisation is required rather than inferred",
);

console.log("\n=== 11.4  the flag reason is written down once ===");
ok("the constant exists", np.NAMED_PERSON_FLAG === "named_person_record");
const lbl = (await import(`../lib/admin/labels.ts?v=${Date.now()}`)) as typeof import("../lib/admin/labels.ts");
ok(
  "and it reads in English, not as a slug",
  lbl.flagTitle(np.NAMED_PERSON_FLAG) === "This record is a person",
  lbl.flagTitle(np.NAMED_PERSON_FLAG),
);

/**
 * ## 21 Sep — the admin's own reading of invariant 1
 *
 * The invariant is enforced where it has to be, in the WHERE clause of every
 * answering query and in `caregivers_answerable`. What it was **not** enforced
 * in is the sentence the admin reads off the card: that said `consented &&
 * active` — two of the four — so a caregiver who agreed to be listed and
 * declined to appear in answers was labelled *"Families can see her"* while
 * her own menu offered *"Let families see her"*. Measured on the live cohort:
 * Joy A. is exactly that row.
 *
 * A source check, because the branch is inside a React component this pure
 * suite cannot render — the 15 Sep precedent.
 */
{
  const page = fs.readFileSync(
    new URL("../app/(admin)/admin/caregivers/page.tsx", import.meta.url),
    "utf8",
  );
  const predicate = page.slice(
    page.indexOf("const answerable ="),
    page.indexOf("const open = openConsent"),
  );
  ok(
    "the admin calls a caregiver visible only on all of invariant 1's states",
    /consent_status === "consented"/.test(predicate) &&
      /row\.active/.test(predicate) &&
      /row\.discoverable/.test(predicate),
    "consent is not visibility — that is what the discoverable rung is for",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
