/**
 * M5.9 + M5.4 — the cold inbound, and the one question at a time.
 *
 * The parsing is where this can go quietly wrong, so most of what follows is
 * about **refusing to guess**. A wrong age is worse than no age: it silently
 * ranks the wrong parents for every question that person ever asks, and nothing
 * about the data looks broken afterwards.
 */

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

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
