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
    inbound.includes("body: CLARIFY_THANKS"),
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

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
