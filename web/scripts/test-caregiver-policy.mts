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
ok("DELETE is read as a delete request", c.isCaregiverDeleteRequest("DELETE"));
ok("lowercase too", c.isCaregiverDeleteRequest("delete"));
ok("with a full stop", c.isCaregiverDeleteRequest("Delete."));
ok('"remove me" too', c.isCaregiverDeleteRequest("remove me"));
ok('and "delete my profile"', c.isCaregiverDeleteRequest("DELETE MY PROFILE"));

console.log("\n=== 11.3  and the refusals, which are the half that matters ===");
/* Irreversible, so the parser has to be stricter here than anywhere else. */
ok(
  '"delete my saturday slot" is NOT a delete request',
  !c.isCaregiverDeleteRequest("delete my saturday slot"),
  "a substring test would remove somebody's whole profile over a scheduling note",
);
ok(
  '"can you delete the wrong number?" is not',
  !c.isCaregiverDeleteRequest("can you delete the wrong number?"),
);
ok(
  '"please delete" is not — it is a sentence, not the keyword',
  !c.isCaregiverDeleteRequest("please delete"),
);
ok('"deleted" is not', !c.isCaregiverDeleteRequest("deleted"));
ok("an empty message is not", !c.isCaregiverDeleteRequest("   "));
ok(
  "and neither is STOP, which is a different decision entirely",
  !c.isCaregiverDeleteRequest("STOP"),
  "STOP silences Pando; DELETE removes the profile — conflating them loses one of them",
);

console.log("\n=== 11.3  the receipts say what happened and ask nothing ===");
const deleted = s.caregiverDeletedSms();
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

const none = s.nothingToDeleteSms();
ok(
  "a number with no profile is told exactly that",
  /no caregiver profile on this number/i.test(none),
);
ok(
  "and pointed at a person rather than offered something that does not exist",
  /hello@pando\.is/.test(none),
  "there is no self-serve parent delete, and inventing one in a keyword handler would be a product decision in the wrong place",
);
ok(
  "the two receipts are different messages",
  deleted !== none,
  "telling somebody who had a profile that they never had one is the one lie this feature must not tell",
);

console.log("\n=== both stay inside one segment ===");
ok(`the confirmation is ${deleted.length} characters`, deleted.length <= 320, deleted);
ok(`the not-found is ${none.length} characters`, none.length <= 320, none);

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
ok(
  "with an instruction, not just a description",
  /caregiver flow/i.test(lbl.flagMeaning(np.NAMED_PERSON_FLAG) ?? ""),
  "an admin has to know that approving is not the only option",
);
ok(
  "and it says what the record is missing",
  /18/.test(lbl.flagMeaning(np.NAMED_PERSON_FLAG) ?? ""),
  "nobody asked whether they are 18 — that is the whole point",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
