/**
 * `lib/admin/person-search.ts` — the admin person picker's ranking rule.
 *
 * Why a search box gets its own test suite: `lib/starters.ts` is the precedent
 * recorded in CLAUDE.md, and the reason is that a matching rule fails *silently*.
 * The area comparison there ran, found nothing, and left nine of seventeen towns
 * unreachable — typecheck clean, suite green, feature doing the opposite of its
 * purpose. A picker over ~350 parents has exactly that failure mode: it looks
 * like it works right up until the one name somebody types is the one it cannot
 * find.
 *
 * Run: `npm run test:person-search`
 */
/* Dynamic, with a cache-buster and a `typeof import` cast — the shape every
   other pure-module suite here uses, so `tsc` is happy without
   `allowImportingTsExtensions` and a re-run never serves a stale module. */
const m = (await import(`../lib/admin/person-search.ts?v=${Date.now()}`)) as typeof import(
  "../lib/admin/person-search.ts"
);
const { matchRanges, rankPeople, searchTerms, searchableText } = m;

let failures = 0;
let checks = 0;
function ok(what: string, cond: boolean, detail = "") {
  checks++;
  if (cond) console.log(`  ok    ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

type P = { person_id: string; name: string | null; neighborhood: string | null };

const PEOPLE: P[] = [
  { person_id: "1", name: "Sarah Chen", neighborhood: "south-pasadena" },
  { person_id: "2", name: "Priya Raman", neighborhood: "san-marino" },
  { person_id: "3", name: "Rachel Alvarez", neighborhood: "sierra-madre" },
  { person_id: "4", name: "Nadia Farouk", neighborhood: "temple-city" },
  { person_id: "5", name: "Marina Sanchez", neighborhood: "altadena" },
  { person_id: "6", name: null, neighborhood: null },
  { person_id: "7", name: "Grace Kim", neighborhood: "la-canada-flintridge" },
];

const ids = (rows: P[]) => rows.map((r) => r.person_id).join(",");

console.log("=== an empty query is not a filter ===");
ok(
  "everyone comes back",
  rankPeople(PEOPLE, "").length === PEOPLE.length,
  String(rankPeople(PEOPLE, "").length),
);
ok(
  "in the order the server sent",
  ids(rankPeople(PEOPLE, "")) === "1,2,3,4,5,6,7",
  ids(rankPeople(PEOPLE, "")),
);
ok("whitespace is not a query either", ids(rankPeople(PEOPLE, "   ")) === "1,2,3,4,5,6,7");

console.log("\n=== a slug is searched as words ===");
/**
 * The rule the inbound parser learned first: "south pas" is how a person types
 * it, and the stored value is `south-pasadena`. Comparing the raw slug is the
 * `area_slug` bug in a different file.
 */
ok(
  "“south pas” finds South Pasadena",
  ids(rankPeople(PEOPLE, "south pas")) === "1",
  ids(rankPeople(PEOPLE, "south pas")),
);
ok(
  "“temple city” too, across the hyphen",
  ids(rankPeople(PEOPLE, "temple city")) === "4",
  ids(rankPeople(PEOPLE, "temple city")),
);
ok(
  "and a partial third word: “la canada flint”",
  ids(rankPeople(PEOPLE, "la canada flint")) === "7",
  ids(rankPeople(PEOPLE, "la canada flint")),
);
ok(
  "the separator becomes exactly one space, so offsets survive",
  searchableText("south-pasadena").length === "south-pasadena".length,
);

console.log("\n=== every term has to match something ===");
/* An OR would return every Sarah *plus* everyone in South Pasadena — a longer
   list than the reader started with, which is the opposite of a search. */
ok(
  "“sarah south” is one person, not two groups",
  ids(rankPeople(PEOPLE, "sarah south")) === "1",
  ids(rankPeople(PEOPLE, "sarah south")),
);
ok(
  "“sarah marino” is nobody",
  rankPeople(PEOPLE, "sarah marino").length === 0,
  ids(rankPeople(PEOPLE, "sarah marino")),
);
ok("a term nothing holds is nobody", rankPeople(PEOPLE, "zzz").length === 0);

console.log("\n=== a name beats an area, and a word start beats a mid-word hit ===");
/**
 * "san" is a word start in "San Marino", mid-word in "Sanchez"… and "Sanchez"
 * is a *name*. The name wins: somebody typing three letters is far likelier to
 * be reaching for a person than for a town, and the town is one more keystroke
 * away either way.
 */
ok(
  "“san” puts Marina Sanchez above San Marino",
  ids(rankPeople(PEOPLE, "san")) === "5,2",
  ids(rankPeople(PEOPLE, "san")),
);
ok(
  "“ra” ranks the two names starting a word above the rest",
  rankPeople(PEOPLE, "ra")[0].person_id === "2",
  ids(rankPeople(PEOPLE, "ra")),
);
ok(
  "a surname is a word start: “chen” finds Sarah Chen first",
  rankPeople(PEOPLE, "chen")[0].person_id === "1",
  ids(rankPeople(PEOPLE, "chen")),
);

console.log("\n=== ties keep the server's order, so the list is stable ===");
/* An unstable order under a search box reads as the page fighting back. */
const tied = rankPeople(PEOPLE, "a");
const tiedAgain = rankPeople(PEOPLE, "a");
ok("the same query twice is the same order", ids(tied) === ids(tiedAgain));
ok(
  "and equal scores stay in input order",
  ids(rankPeople([PEOPLE[2], PEOPLE[3]], "a")) === "3,4",
  ids(rankPeople([PEOPLE[2], PEOPLE[3]], "a")),
);

console.log("\n=== a missing name or area is never a crash ===");
ok("an unnamed person simply does not match", rankPeople([PEOPLE[5]], "sarah").length === 0);
ok("and is included when nothing is typed", rankPeople([PEOPLE[5]], "").length === 1);
ok("case is ignored", ids(rankPeople(PEOPLE, "SARAH")) === "1");

console.log("\n=== the highlight says why a row is in the list ===");
ok(
  "one term, one range",
  JSON.stringify(matchRanges("Sarah Chen", "chen")) === JSON.stringify([[6, 10]]),
  JSON.stringify(matchRanges("Sarah Chen", "chen")),
);
ok(
  "overlapping terms merge rather than nest",
  JSON.stringify(matchRanges("Sanchez", "san anch")) === JSON.stringify([[0, 5]]),
  JSON.stringify(matchRanges("Sanchez", "san anch")),
);
ok(
  "ranges are in order however the terms were typed",
  JSON.stringify(matchRanges("Sarah Chen", "chen sar")) ===
    JSON.stringify([
      [0, 3],
      [6, 10],
    ]),
  JSON.stringify(matchRanges("Sarah Chen", "chen sar")),
);
/* The offsets are taken from the searchable form and applied to the rendered
   one, so they only hold while both are the same length. `slugLabel` replaces
   one separator with one space, exactly as `searchableText` does. */
const rendered = "south-pasadena".replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const range = matchRanges("south-pasadena", "pas")[0];
ok(
  "an offset holds against the display-cased area name",
  rendered.slice(range[0], range[1]) === "Pas",
  rendered.slice(range[0], range[1]),
);
ok("nothing typed highlights nothing", matchRanges("Sarah Chen", "").length === 0);
ok("terms are split on any whitespace run", searchTerms("  a   b ").join("|") === "a|b");

console.log(
  failures === 0
    ? `
  ${checks} checks passed.`
    : `
  ${failures} of ${checks} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
