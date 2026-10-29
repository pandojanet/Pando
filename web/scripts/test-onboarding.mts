/**
 * M5.9 + M5.4 — the cold inbound, and the one question at a time.
 *
 * The parsing is where this can go quietly wrong, so most of what follows is
 * about **refusing to guess**. A wrong age is worse than no age: it silently
 * ranks the wrong parents for every question that person ever asks, and nothing
 * about the data looks broken afterwards.
 */

import fs from "node:fs";

const o = (await import(`../lib/onboarding.ts?v=${Date.now()}`)) as typeof import("../lib/onboarding.ts");

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

console.log("\n=== one question at a time, in the order that matters ===");
ok(
  "a stranger is asked their child's age first",
  o.nextQuestion({ child_birth_years: [], neighborhood: null }) === "child_age",
  "it changes what the answer should even contain",
);
ok(
  "then the area",
  o.nextQuestion({ child_birth_years: [2021], neighborhood: null }) === "neighborhood",
);
ok(
  "and then nothing — Pando has what matching needs",
  o.nextQuestion({ child_birth_years: [2021], neighborhood: "altadena" }) === null,
);
ok(
  "somebody who gave the area but not the age is still asked the age",
  o.nextQuestion({ child_birth_years: [], neighborhood: "altadena" }) === "child_age",
);
ok(
  "each question explains why it is being asked",
  Object.values(o.CLARIFYING_COPY).every((c) => c.length > 20 && /\?/.test(c)),
  "a bare question from a phone number reads as a form",
);

console.log("\n=== reading an age ===");
for (const [text, want] of [
  ["3", 3],
  ["she's 4", 4],
  ["2 years", 2],
  ["7 yrs", 7],
  ["11yo", 11],
  ["0", 0],
] as Array<[string, number]>) {
  ok(`"${text}" -> ${want}`, o.parseAge(text) === want, `got ${o.parseAge(text)}`);
}
ok('"18 months" is one, not eighteen', o.parseAge("18 months") === 1, `got ${o.parseAge("18 months")}`);
ok('"6 mo" is a baby, which is 0', o.parseAge("6 mo") === 0, `got ${o.parseAge("6 mo")}`);
ok('"10 months" rounds down to 0, not up to 1', o.parseAge("10 months") === 0);
ok("expecting is a real answer", o.parseAge("expecting in March") === -1);
ok("and so is 'pregnant'", o.parseAge("I'm pregnant") === -1);

console.log("\n=== and refusing to read one ===");
ok("no number at all", o.parseAge("a few") === null);
ok("empty", o.parseAge("") === null);
ok("just a name", o.parseAge("thanks!") === null);
ok(
  "a year is not an age",
  o.parseAge("2021") === null,
  "the range is bounded so a birth year cannot arrive as an age",
);
ok(
  "a phone number is not an age",
  o.parseAge("6265550143") === null,
);
ok("40 is out of range", o.parseAge("40") === null);

console.log("\n=== reading a neighborhood ===");
const AREAS = [
  { id: "pasadena", label: "Pasadena" },
  { id: "south-pasadena", label: "South Pasadena" },
  { id: "altadena", label: "Altadena" },
  { id: "la-canada-flintridge", label: "La Cañada Flintridge" },
];
const area = (text: string) => o.parseNeighborhood(text, AREAS);

ok("an exact label", area("Altadena") === "altadena");
ok("case does not matter", area("altadena") === "altadena");
ok("the id itself", area("south-pasadena") === "south-pasadena");
ok("inside a sentence", area("we're in Altadena") === "altadena");
ok(
  "South Pasadena is NOT filed as Pasadena",
  area("South Pasadena") === "south-pasadena",
  "the longer label is checked first, or every South Pasadena parent lands in Pasadena",
);
ok(
  "even inside a sentence",
  area("we just moved to south pasadena") === "south-pasadena",
);
ok("a shortening still finds it", area("we're in south pas") === "south-pasadena");
ok(
  "but 'pasadena' alone stays Pasadena",
  area("pasadena") === "pasadena",
  "the multi-word rule needs every part, so it cannot swallow the shorter name",
);
ok(
  "a diacritic is not required",
  area("la canada") === "la-canada-flintridge",
  "the slug folds it, so a parent typing without the ñ is understood",
);

console.log("\n=== and refusing to place one ===");
ok("somewhere else entirely", area("Brooklyn") === null);
ok("empty", area("") === null);
ok(
  "nothing is stored as words no taxonomy contains",
  area("the nice bit near the park") === null,
  "the 27 Aug rule: a typed area is an answer, but it is never a matchable value",
);
ok(
  "a two-letter part matches a whole word, never the inside of one",
  area("I can't say exactly, planning to move later") === null,
  "'la' and 'can' were both found inside other words, filing La Canada Flintridge",
);

console.log("\n=== how Pando remembers what it asked ===");
ok(
  "the template names the question",
  o.clarifyTemplate("child_age") === "clarify_child_age",
);
ok("and reads back", o.questionFromTemplate("clarify_neighborhood") === "neighborhood");
ok("a round trip holds for both",
  o.questionFromTemplate(o.clarifyTemplate("child_age")) === "child_age" &&
  o.questionFromTemplate(o.clarifyTemplate("neighborhood")) === "neighborhood");
ok(
  "any other template is not a pending question",
  o.questionFromTemplate("answer") === null && o.questionFromTemplate(null) === null,
  "an ordinary reply must not be read as answering something nobody asked",
);

/**
 * ## 21 Sep — the answer is answered, and the question closes
 *
 * Reported from the live relay: the clarifying question went out with a real
 * answer, the developer replied *"4"*, and heard nothing — three times, which
 * is the second half of the same fault. Two of these read the **source** of
 * `inbound.ts`, which carries `import "server-only"` and cannot be loaded
 * here; both are branches rather than values, which is the 15 Sep precedent
 * for source checks over a module this suite cannot import.
 */
console.log("\n=== answering it is not met with silence ===");
{
  const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
  const plan = seg.planSegments(o.CLARIFY_THANKS);
  ok(
    "the thank-you is one GSM-7 segment",
    plan.segments === 1 && plan.encoding === "gsm7",
    `${plan.segments} segment(s), ${plan.encoding}`,
  );
  /* It must not restart the exchange it is closing: a question here makes the
     next message ambiguous all over again, which is the fault one turn later. */
  ok("and it asks nothing", !o.CLARIFY_THANKS.includes("?"));
  ok(
    "it promises nothing about the answer they already have",
    !/\b(again|resend|re-?send|new answer)\b/i.test(o.CLARIFY_THANKS),
    "re-answering with the new age is a second bill and the client's call",
  );

  const inbound = fs.readFileSync(
    new URL("../lib/server/inbound.ts", import.meta.url),
    "utf8",
  );
  ok(
    "a saved clarification replies rather than returning quietly",
    /* `question` since 26 Oct: the one asked, or the fact said unasked. Built
       first and then sent since 29 Oct, so its RCS card can be read from it. */
    /const reply = clarifyReply\(\{\s*question,\s*text: body,\s*next,[\s\S]{0,600}?body: reply,/.test(inbound),
  );
  ok(
    "and the next question it carries is remembered by its template",
    inbound.includes('template: next ? clarifyTemplate(next) : "clarification_saved"'),
    "without it the next reply could not be read as that question's answer",
  );
  /* ⚠⚠ The close. Without it `pendingClarification` stayed open for seven days
     and re-read every short message as an answer — three `children` rows, all
     born 2022, for one four-year-old. */
  ok(
    "and the question is closed by the fact it asked for",
    inbound.includes("pending === nextQuestion(person.profile)"),
    "nothing else ever closed it",
  );
  const repo = fs.readFileSync(
    new URL("../lib/server/repo/onboarding.ts", import.meta.url),
    "utf8",
  );
  ok(
    "the inert on-conflict guard is gone rather than left reassuring",
    !/insert into children[\s\S]{0,160}on conflict/.test(repo),
    "children has no unique key: twins are a supported answer",
  );
}

/**
 * 21 Oct — the profile is built over SMS: the client's *"the bot asks for their
 * name, children's ages, etc."*, answer-first and one at a time.
 */
console.log("\n=== the whole profile over SMS, one question at a time ===");
{
  const full = { child_birth_years: [2021], neighborhood: "altadena" };
  ok(
    "after the area, the first name",
    o.nextQuestion({ ...full, first_name: null, allowance_chosen: false }) === "first_name",
  );
  ok(
    "then how many requests they will take",
    o.nextQuestion({ ...full, first_name: "Anna", allowance_chosen: false }) === "participation",
  );
  ok(
    "and nothing once both are known",
    o.nextQuestion({ ...full, first_name: "Anna", allowance_chosen: true }) === null,
  );
  ok(
    "a caller that did not read them never asks them",
    o.nextQuestion(full) === null,
    "a parent who gave their name on /join must not be asked it",
  );
  ok(
    "the age still comes first for a stranger",
    o.nextQuestion({ child_birth_years: [], neighborhood: null, first_name: null, allowance_chosen: false }) === "child_age",
  );
  ok(
    "the two questions that change an answer open with the client's words",
    o.CLARIFYING_COPY.child_age.startsWith("Mind if I ask one more thing so I can give you a better answer?") &&
      o.CLARIFYING_COPY.neighborhood.startsWith("Mind if I ask one more thing so I can give you a better answer?"),
  );

  console.log("\n=== every child in one reply ===");
  const ages: Array<[string, number[]]> = [
    ["3 and 7", [3, 7]],
    ["4, 9 and 18 months", [4, 9, 1]],
    ["18 months", [1]],
    ["he's 3", [3]],
    ["twins, 4 and 4", [4, 4]],
    ["a 6 year old and one on the way", [6, -1]],
    ["11yo and 2yo", [11, 2]],
    ["born 2021", []],
    ["6265550143", []],
    ["not sure", []],
    /* 26 Oct, adversarial review: a count of children is not an age, and each
       of these used to invent a child. */
    ["I have 2 kids, 3 and 7", [3, 7]],
    ["we have 3 kids: 2, 5 and 9", [2, 5, 9]],
    ["2 kids ages 3 and 5", [3, 5]],
    ["3 kids ages 3, 5 and 8", [3, 5, 8]],
    ["1 kid, age 4", [4]],
    ["2 kids", []],
    ["3 kids", []],
    ["three children", []],
    ["2 boys", []],
    ["2 little ones", []],
    ["2 under 5", []],
    ["in 3rd grade", []],
    ["grade 2", []],
    ["born 3/15/2020", []],
    ["2 1/2", [2]],
    ["2.5 and 5", [2, 5]],
    ["pick up at 3pm", []],
    /* What parents actually send. */
    ["3 and 7", [3, 7]],
    ["my son is 4", [4]],
    ["8, 5, 2", [8, 5, 2]],
    ["boys 4 and 6", [4, 6]],
    ["4yo and 18 months", [4, 1]],
    ["10 and 12, plus a 3 month old", [10, 12, 0]],
    ["6 months", [0]],
    ["6 weeks", [0]],
    ["10 days old", [0]],
    ["twins, both 2", [2, 2]],
    ["4 year old twins", [4, 4]],
    ["6 month old twins", [0, 0]],
    ["twin girls aged 3", [3, 3]],
    ["2 boys, both 6", [6, 6]],
    ["twins and a 5 year old", [5]],
    ["triplets, 1", [1, 1, 1]],
    ["expecting in March", [-1]],
    ["expecting twins", [-1, -1]],
    ["none yet", []],
    ["no kids yet", []],
  ];
  for (const [text, want] of ages) {
    const got = o.parseAges(text);
    ok(`"${text}" -> [${want.join(", ")}]`, JSON.stringify(got) === JSON.stringify(want), `got [${got.join(", ")}]`);
  }
  ok(
    "the answered profile closes the age question",
    o.nextQuestion(o.withAnswer({ child_birth_years: [], neighborhood: "altadena" }, "child_age", "3 and 7")) === null,
  );

  console.log("\n=== a first name, and refusing to invent one ===");
  const names: Array<[string, string | null]> = [
    ["Anna", "Anna"],
    ["anna", "Anna"],
    ["I'm Anna", "Anna"],
    ["sure, it's maria-josé", "Maria-josé"],
    ["My name is Anna Lee.", "Anna"],
    ["Hi! This is O'Neil", "O'Neil"],
    ["rather not", null],
    ["sure", null],
    ["skip", null],
    ["what's this for", null],
    ["Anna 3", "Anna"],
    ["we just moved here from the valley last year", null],
    /* The 21 Oct routing review: each of these was saved as a first name. */
    ["cool", null],
    ["awesome", null],
    ["great, thanks", null],
    ["sounds good", null],
    ["got it", null],
    ["lol", null],
    ["swim lessons", null],
    ["camps near Altadena", null],
    ["ballet for my 5yo", null],
    ["any others", null],
    ["more please", null],
    /* 26 Oct, adversarial review: a place, an activity and a "where" were
       each saved as a first name and greeted by it. */
    ["I am in Pasadena", null],
    ["I'm from Altadena", null],
    ["in Pasadena", null],
    ["Pasadena", null],
    ["pasadena.", null],
    ["Pasadena, CA", null],
    ["South Pasadena", null],
    ["it's South Pas", null],
    ["Temple City", null],
    ["La Cañada", null],
    ["dance", null],
    ["soccer", null],
    ["swimming", null],
    ["I'm Maya's mom", null],
    ["Maya mom", null],
    ["hey there", null],
    ["yup", null],
    ["Y", null],
    ["n", null],
    ["yes", null],
    ["no", null],
    ["hi", null],
    ["I'm new", null],
    /* And the real names still come through. */
    ["Maya", "Maya"],
    ["it's Maya", "Maya"],
    ["I'm Maya", "Maya"],
    ["maya here", "Maya"],
    ["Mary Ann", "Mary"],
    ["José", "José"],
    ["josé", "José"],
    ["Vincent", "Vincent"],
    ["Art", "Art"],
    ["Madison", "Madison"],
    ["Linda", "Linda"],
    ["Jo", "Jo"],
  ];
  for (const [text, want] of names) {
    const got = o.parseFirstName(text);
    ok(`"${text}" -> ${want}`, got === want, `got ${got}`);
  }
  {
    /* The place list in onboarding.ts is a copy (the module may not import);
       every place the market knows must be refused, so one added there and
       not here fails here. Vincent is the one exception, named in the code. */
    const hp = (await import(`../lib/home-places.ts?v=${Date.now()}`)) as typeof import("../lib/home-places.ts");
    const mo = (await import(`../lib/market-options.ts?v=${Date.now()}`)) as typeof import("../lib/market-options.ts");
    const labels = [
      ...hp.PLACES.map((p) => p.name),
      ...mo.marketOptions("pasadena", "neighborhoods").map((n) => n.label),
    ].filter((label) => label !== "Vincent");
    const taken = labels.filter((label) => o.parseFirstName(label) !== null);
    ok(
      `no place the market knows is a first name (${labels.length} checked)`,
      taken.length === 0,
      taken.join(", "),
    );
    ok(
      "and a place is never thanked by name",
      o.clarifyReply({ question: "first_name", text: "Pasadena", next: null }) === o.CLARIFY_THANKS,
    );
  }

  console.log("\n=== the reply that closes one question and asks the next ===");
  const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
  const chained = o.clarifyReply({ question: "child_age", text: "3 and 7", next: "neighborhood" });
  ok(
    "it thanks and asks the next question in the same message",
    chained.startsWith("Got it, thanks!") && chained.endsWith(o.CLARIFYING_COPY.neighborhood),
  );
  const named = o.clarifyReply({ question: "first_name", text: "i'm anna", next: "participation" });
  ok("a name is answered by name", named.startsWith("Nice to meet you, Anna!"), named);
  ok(
    "the last answer asks nothing",
    !o.clarifyReply({ question: "first_name", text: "Anna", next: null }).includes("?"),
  );
  const closing = o.clarifyReply({ question: "participation", text: "2", next: null, confirmed: "CONFIRMED" });
  ok(
    "the participation answer is confirmed with the SETTINGS confirmation it is handed",
    closing.startsWith("CONFIRMED "),
    closing,
  );
  /* 22 Oct: the onboarding ended on "Done: up to 5 a month..." and nothing else. */
  ok(
    "and closes the onboarding: how to change it, and that they can ask anything now",
    /\bText SETTINGS\b/.test(closing) && /any question/i.test(closing) && !closing.includes("?"),
    closing,
  );
  for (const choice of [
    { allowance: 5, mode: "fixed" as const },
    { allowance: 10, mode: "fixed" as const },
    { allowance: null, mode: "as_relevant" as const },
  ]) {
    const policyMod = (await import(`../lib/outreach-policy.ts?v=${Date.now()}`)) as typeof import("../lib/outreach-policy.ts");
    const last = o.clarifyReply({ question: "participation", text: "1", next: null, confirmed: policyMod.settingsConfirmation(choice) });
    const plan = seg.planSegments(last);
    ok(`the closing after ${choice.mode} ${choice.allowance ?? ""} is one GSM-7 segment`, plan.encoding === "gsm7" && plan.segments === 1, `${last.length} chars`);
  }
  const policy = (await import(`../lib/outreach-policy.ts?v=${Date.now()}`)) as typeof import("../lib/outreach-policy.ts");
  ok(
    "the weekly number in the question is the send layer's",
    o.CLARIFYING_COPY.participation.includes(`3 for up to ${policy.OPEN_WEEKLY_LIMIT} a week`),
  );
  ok(
    "and every digit it offers means what SETTINGS means by it",
    policy.parseAllowanceChoice("1")?.allowance === 5 &&
      policy.parseAllowanceChoice("2")?.allowance === 10 &&
      policy.parseAllowanceChoice("3")?.mode === "as_relevant",
  );
  const labels = (await import(`../lib/admin/labels.ts?v=${Date.now()}`)) as typeof import("../lib/admin/labels.ts");
  ok(
    "the admin names the weekly level with the send layer's number",
    labels.allowanceLabel({ monthly_contact_allowance: null, allowance_mode: "as_relevant" }) ===
      `Up to ${policy.OPEN_WEEKLY_LIMIT} a week`,
  );
  ok(
    "and a parent who never chose reads as not chosen, not as five",
    labels.allowanceLabel({ monthly_contact_allowance: null, allowance_mode: "fixed" }) === "Not chosen" &&
      labels.allowanceLabel({ monthly_contact_allowance: 10, allowance_mode: "fixed" }) === "Up to 10 a month",
  );
  const inboundSrc = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  ok(
    "and the server hands it that confirmation",
    inboundSrc.includes("confirmed: choice ? settingsConfirmation(choice) : undefined"),
  );
  for (const q of Object.keys(o.CLARIFYING_COPY) as Array<keyof typeof o.CLARIFYING_COPY>) {
    const longest = `Nice to meet you, Maria-Jose! ${o.CLARIFYING_COPY[q]}`;
    const plan = seg.planSegments(longest);
    ok(
      `"${q}" stays GSM-7 and within two segments, even chained`,
      plan.encoding === "gsm7" && plan.segments <= 2,
      `${plan.segments} segment(s), ${plan.encoding}`,
    );
  }
  for (const q of Object.keys(o.CLARIFYING_COPY) as Array<keyof typeof o.CLARIFYING_COPY>) {
    /* Riding on an answer at the composer's full budget, no question may add
       more than one segment (the budget is eight since 26 Oct, so nine). */
    const plan = seg.planSegments(`${"x".repeat(1224)}\n\n${o.CLARIFYING_COPY[q]}`);
    ok(`"${q}" on a full answer adds at most one segment`, plan.segments <= 9, `${plan.segments}`);
  }
  ok(
    "the participation question offers the SETTINGS menu's digits",
    /Reply 1 for up to 5 a month, 2 for up to 10, or 3 for up to \d+ a week/.test(o.CLARIFYING_COPY.participation),
  );
  ok(
    "an answered participation question closes the exchange",
    o.nextQuestion(
      o.withAnswer({ child_birth_years: [2021], neighborhood: "x", first_name: "A", allowance_chosen: false }, "participation", "2"),
    ) === null,
  );

  const repo = fs.readFileSync(new URL("../lib/server/repo/onboarding.ts", import.meta.url), "utf8");
  ok(
    "a name from a text never overwrites one given on /join",
    /update people set first_name[\s\S]{0,160}first_name is null/.test(repo),
  );
  ok(
    "the participation answer is written by the SETTINGS write",
    repo.includes("parseAllowanceChoice(input.text)") && repo.includes("return setAllowance("),
  );
  ok(
    "a later clarifying question closes an open SETTINGS menu",
    repo.includes("or template like 'clarify_%'"),
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
