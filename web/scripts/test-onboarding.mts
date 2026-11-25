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
/* 3 Nov, open signup: "no kids" is an answer, and the questions after it are asked. */
ok(
  "somebody with no children is not asked the age again, and is asked the area",
  o.nextQuestion({ child_birth_years: [], neighborhood: null, children_declined: true }) === "neighborhood",
);
for (const said of ["no kids", "None", "I don't have any kids", "no children yet", "not a parent", "I'm a grandma", "rather not say", "nope"]) {
  ok(`"${said}" answers the age question with no child`, o.declinesChildren(said));
}
for (const said of ["3 and 7", "no, just one, she's 4", "expecting in March", "my son is 6"]) {
  ok(`"${said}" is a child, not a refusal`, !o.declinesChildren(said));
}
ok(
  "and the profile after it moves on",
  o.nextQuestion(o.withAnswer({ child_birth_years: [], neighborhood: null }, "child_age", "no kids")) === "neighborhood",
);
ok(
  "the age question says the kids may not exist",
  /reply NONE if you don't have kids/.test(o.CLARIFYING_COPY.child_age),
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
  /* 3 Nov — "expecting" was written as a child born this year, an infant. */
  ok(
    "a baby on the way is written as expecting, with a due year and no birth year",
    /insert into children \(person_id, expecting, due_year, due_year_precision\)/.test(repo) &&
      !repo.includes("Math.max(0, age)"),
    "the year_shape CHECK and derive.ts write it this way",
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

console.log("\n=== the age first, when the answer turns on it (18 Nov, Janet live: taekwondo 4-11 for an 18-month-old) ===");
{
  const none = { child_birth_years: [], children_declined: false };
  ok("no age known, an activity question: ask first", o.asksAgeFirst({ profile: none, bandsInQuestion: 0, focus: "activities" }));
  ok("no topic read: ask first too", o.asksAgeFirst({ profile: none, bandsInQuestion: 0, focus: null }));
  ok("the question says an age: answer", !o.asksAgeFirst({ profile: none, bandsInQuestion: 1, focus: "activities" }));
  ok("the profile has the ages: answer", !o.asksAgeFirst({ profile: { child_birth_years: [2025], children_declined: false }, bandsInQuestion: 0, focus: "camps" }));
  ok("they said they have no children: answer", !o.asksAgeFirst({ profile: { child_birth_years: [], children_declined: true }, bandsInQuestion: 0, focus: "camps" }));
  ok("a doctor, special needs, logistics, settling in: one list fits every age", ["pediatric_health", "special_needs_resources", "working_parent_logistics", "new_to_area_help"].every((f) => !o.asksAgeFirst({ profile: none, bandsInQuestion: 0, focus: f })));
  ok("the question names the child", o.ageFirstQuestion("jasper") === "Happy to help! How old is Jasper? Then I can pick things that fit.");
  ok("or asks for every child, with a way to say none (25 Nov)", o.ageFirstQuestion(null) === "Happy to help! How old are your kids? Like 3 and 7, or reply NONE if you don't have kids.");
  ok("on RCS every child's question carries the No kids button, a named child's none", o.ageFirstCard(null) === "Happy to help! How old are your kids? Like 3 and 7." && o.ageFirstCard("jasper") === null);
  ok("all are plain GSM-7 (one segment each)", [o.ageFirstQuestion("jasper"), o.ageFirstQuestion(null), o.areaFirstQuestion()].every((s) => /^[\x20-\x7E]+$/.test(s) && s.length <= 160));
  ok("the held question takes the age as an age", o.withAgeSaid("Hi is there a good activity for Jasper today", o.parseAges("18 months")) === "Hi is there a good activity for Jasper today, for a 1 year old");
  ok("under one is a baby; two children are two", o.withAgeSaid("camps?", [0]) === "camps, for a baby under 1" && o.withAgeSaid("camps?", [3, 7]) === "camps, for a 3 year old and a 7 year old");
  ok("no age (\"none\") leaves the question as it was", o.withAgeSaid("camps?", []) === "camps?");
  const src = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  ok("asked as the ordinary profile question, with the request held as an open exchange", src.includes("await rememberTurn({ personId: person.person_id, text: asked });") && src.includes("const askedFirst = clarifyTemplate(firstAsk);") && src.includes("template: askedFirst,") && src.includes('body: firstAsk === "child_age" ? ageFirstQuestion(name) : areaFirstQuestion(),'));
  ok("never mid-exchange, held or sensitive, and each question at most once a week", /!pending &&\r?\n\s*!followsHeld &&/.test(src) &&src.includes("!reading.sensitive &&") && src.includes("(await pendingClarificationAt(person.person_id))?.question !== firstAsk"));
  ok("the age that arrives answers the held question, instead of a thank-you — unless the area is still owed", src.includes("body: withAgeSaid(combined(held, \"\"), parseAges(body)),") && src.indexOf('if (saved && question === "child_age" && !areaOwed)') > 0 && src.indexOf('if (saved && question === "child_age" && !areaOwed)') < src.indexOf("const next = nextQuestion(alsoKept"));
  ok("the area that arrives answers the held question, read with the person again (25 Nov)", src.indexOf('if (saved && question === "neighborhood")') > 0 && src.indexOf('if (saved && question === "neighborhood")') < src.indexOf("const next = nextQuestion(alsoKept") && src.includes("person: (await ensureInboundPerson({ phone: from })) ?? person,"));
  ok("\"18 months\" is an age when the age was asked", src.includes("const monthsAsked = open && pending === \"child_age\" && AGE_IN_MONTHS.test("));
}

console.log("\n=== the ages a question states for their own children (25 Nov) ===");
{
  const own = (t: string) => o.ownChildAges(t).join(",");
  ok("'for my 8 year old'", own("horse dressage lessons in Pasadena for my 8 year old") === "8");
  ok("'my 4-year-old' and 'my 8yo'", own("swim for my 4-year-old?") === "4" && own("camps for my 8yo") === "8");
  ok("'my 3 and 7 year olds' is two", own("art classes for my 3 and 7 year olds") === "3,7");
  ok("'my son is 6'", own("my son is 6, any soccer?") === "6");
  ok("'my kids are 3 and 7'", own("my kids are 3 and 7 - ideas for Saturday?") === "3,7");
  ok("'my daughter (4)' and 'my son, 5'", own("ballet for my daughter (4)") === "4" && own("my son, 5, loves trains") === "5");
  ok("two children in one sentence", own("my son is 6 and my daughter is 4") === "6,4");
  ok("'my 18 month old' is 1", own("music for my 18 month old") === "1");
  ok("not 'a 5 year old'", own("anything for a 5 year old?") === "");
  ok("not a friend's, a niece or a grandchild", own("a gift for my friend's 4 year old") === "" && own("my niece is 9") === "" && own("my grandson is 5") === "");
  ok("not a grade, a count or a time", own("my 3rd grader") === "" && own("my 2 kids") === "" && own("my son is in 3rd grade") === "");
  ok("not an adult child", own("my son is 24") === "");

  const fs = await import("node:fs");
  const inbound = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  ok("source pin: a picture's or voice note's words are marked, and the mark survives a typed remainder",
    /body: read, channel: input\.channel, confirmedMedia: true, fromMedia: true \}/.test(inbound) &&
      /body: remainder, channel: input\.channel, confirmedMedia: true, fromMedia: input\.fromMedia \}/.test(inbound));
  ok("source pin: facts are kept from the parent's typed words only, before the profile is read, into an empty field",
    /if \(person && profileNow && !fromMedia && reading\.intent === "ask_recommendation"\) \{/.test(inbound) &&
      /const own = ownChildAges\(body\);/.test(inbound) &&
      /homeAreaPhrase\(body\)/.test(inbound) &&
      inbound.indexOf("const own = ownChildAges(body);") < inbound.indexOf("const firstAsk ="));
  ok("source pin: the gate reads the profile as kept this turn", /profileFirst\(\{\s+profile: profileNow,\s+askedBefore: await hasAskedBefore\(person\.person_id\),/.test(inbound));
}

console.log("\n=== the second question needs a profile (25 Nov) ===");
{
  const none = { child_birth_years: [] as number[], children_declined: false, neighborhood: null as string | null, pending_place: null as string | null };
  const pf = (over: Partial<typeof none>, askedBefore: boolean, bands = 0, focus: string | null = "activities") =>
    o.profileFirst({ profile: { ...none, ...over }, askedBefore, bandsInQuestion: bands, focus });
  ok("the first question: the age only where it turns on it (18 Nov), never the area", pf({}, false) === "child_age" && pf({}, false, 0, "pediatric_health") === null && pf({ child_birth_years: [2018] }, false) === null);
  ok("the second: the ages first, whatever the topic", pf({}, true, 0, "pediatric_health") === "child_age");
  ok("then the area", pf({ child_birth_years: [2018] }, true) === "neighborhood" && pf({ children_declined: true }, true, 0, null) === "neighborhood");
  ok("an age the question names is not their ages: those first, so the area reply is read as one (the lab walk)", pf({}, true, 1) === "child_age");
  ok("the order is always nextQuestion's, so the clarifying step finds the question open", (["child_age", "neighborhood"] as const).every((q) => {
    const p = q === "child_age" ? { ...none } : { ...none, child_birth_years: [2018] };
    return pf(p, true) === o.nextQuestion({ ...p, first_name: "x", allowance_chosen: true });
  }));
  ok("a place awaiting an admin is an answer", pf({ child_birth_years: [2018], pending_place: "New York, NY" }, true) === null);
  ok("a full profile asks nothing", pf({ child_birth_years: [2018], neighborhood: "altadena" }, true) === null);

  const self = (over: Partial<typeof none>, askedBefore: boolean) => o.profileFirst({ profile: { ...none, ...over }, askedBefore, bandsInQuestion: 0, focus: "activities", forSelf: true });
  ok("for the adult asking: never the children's ages, first question or second (25 Nov)", self({}, false) === null && self({ children_declined: true }, true) === "neighborhood");
  ok("the area for an adult only once it is the next question (ages known or declined)", self({}, true) === null && self({ child_birth_years: [2018] }, true) === "neighborhood");
  ok("who it is for is asked in one plain message", /^[\x20-\x7E]+$/.test(o.forWhomQuestion()) && o.forWhomQuestion().length <= 160 && o.forWhomQuestion().includes("for you or for a child"));
  const inb = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  ok("source pin: asked only when nothing says, nothing is known and the question names no age — once a week",
    /forWhom === "unknown" &&\s+!forSelf &&\s+profileNow\.child_birth_years\.length === 0 &&\s+bandsInQuestion\(asked\)\.length === 0 &&\s+!\(await sentTemplateWithin\(person\.person_id, "ask_for_whom", 7\)\)/.test(inb));
  ok("source pin: for the adult, the profile's children do not narrow the answer and the search is told",
    /const known = profile && !input\.forSelf \? bandsForBirthYears/.test(inb) && /forAdult: input\.forSelf === true,/.test(inb));

  const home = (t: string) => o.homeAreaPhrase(t);
  ok("'we live in Altadena'", home("we live in Altadena, any swim lessons?") === "Altadena");
  ok("'I'm based in South Pasadena'", home("I'm based in South Pasadena and looking for camps") === "South Pasadena");
  ok("'we just moved to Arcadia'", home("We just moved to Arcadia! ideas for the weekend?") === "Arcadia");
  ok("'we're living near the Rose Bowl area'", home("we're living near the Rose Bowl area") === "Rose Bowl");
  ok("a place asked about is not home", home("swim lessons in Arcadia?") === null && home("we're going to Arcadia") === null);
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
