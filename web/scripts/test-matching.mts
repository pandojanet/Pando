import type { Person } from "../lib/matching.ts";

/**
 * M6 — the two-layer matching mechanism.
 *
 * This is the code that decides whose questions reach whom, which CLAUDE.md calls
 * the long-term asset. So it is tested against hand-built cases rather than only
 * against whatever the seed data happens to hold — and **half of what follows
 * asserts a non-match**: a suite that only proved the ranking finds people would
 * pass while pairing two families nine years apart at the same school.
 */

const m = (await import(`../lib/matching.ts?v=${Date.now()}`)) as typeof import("../lib/matching.ts");

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

const NOW = new Date("2026-08-27T00:00:00Z");
const YEAR = NOW.getFullYear();

/** The live weights, so this test moves when the config does. */
const WEIGHTS = {
  school: 5,
  activity: 4,
  faith_community: 3,
  neighborhood: 3,
  social_group: 3,
  age_range: 2,
  adjacent_neighborhood: 1,
};
const ADJACENCY = [
  { area_a: "altadena", area_b: "pasadena" },
  { area_a: "pasadena", area_b: "south-pasadena" },
];
const config = { weights: WEIGHTS, adjacency: ADJACENCY };

const person = (id: string, over: Partial<Person> = {}): Person => ({
  person_id: id,
  edges: [],
  relevance: [],
  child_birth_years: [],
  neighborhood: null,
  ...over,
});
const edge = (t: string, v: string, years: number[] | null = null) => ({
  affinity_type: t,
  affinity_value: v,
  child_birth_years: years,
});
const score = (a: Person, b: Person, req = {}) => m.scorePerson(a, b, config, req, NOW);

console.log("\n=== 6.4  the age ladder ===");
/**
 * There is no "do the two copies agree" check here, and its absence is the point.
 *
 * The first version asserted that `ageBandsOf` (ages, in `questions.ts`) and
 * `bandsForBirthYears` (years, here) produced the same band for one child. They
 * did — but that is the wrong fix for a duplicated constant: it proves they agree
 * today and says nothing about the morning somebody edits one of them. There is
 * one ladder now, in `matching.ts`, and `questions.ts` reads it — so nothing can
 * drift and there is nothing to assert. What is worth asserting is the ladder.
 */
for (const [age, want] of [
  [-1, "expecting,baby"], [0, "baby"], [1, "toddler"], [2, "toddler"],
  [3, "preschool"], [4, "preschool"], [5, "grade"], [10, "grade"],
  [11, "tween"], [13, "tween"], [14, "teen"], [17, "teen"],
] as Array<[number, string]>) {
  ok(`age ${age} -> ${want}`, m.bandsForAge(age).join(",") === want,
     `got ${m.bandsForAge(age).join(",")}`);
}
ok(
  "expecting is also baby, because that is who they most want to hear from",
  m.bandsForAge(-1).includes("baby"),
);
ok(
  "a birth year resolves through the same ladder",
  m.bandsForBirthYears([YEAR - 2], NOW).join(",") === "toddler",
);

console.log("\n=== 6.1  shared connections, at the config weights ===");
ok(
  "a shared school is the heaviest single edge",
  score(
    person("a", { edges: [edge("school", "walden-school")], child_birth_years: [YEAR - 3] }),
    person("b", { edges: [edge("school", "walden-school")], child_birth_years: [YEAR - 3] }),
  )!.affinity >= WEIGHTS.school,
);
ok(
  "an edge the asker does not have scores nothing",
  score(
    person("a", { edges: [edge("school", "walden-school")] }),
    person("b", { edges: [edge("school", "other-school")] }),
  ) === null,
);
ok(
  "an unknown affinity type contributes nothing rather than crashing",
  m.scorePerson(
    person("a", { edges: [edge("mystery", "x")] }),
    person("b", { edges: [edge("mystery", "x")] }),
    { weights: {}, adjacency: [] },
    {},
    NOW,
  ) === null,
);

console.log("\n=== 6.1  a shared school counts only when the children overlap ===");
const school = (id: string, years: number[]) =>
  person(id, {
    edges: [edge("school", "walden-school", years)],
    child_birth_years: years,
  });
const hasSchool = (a: Person, b: Person) =>
  (score(a, b)?.reasons ?? []).some((r) => r.kind === "school");

ok("same school, same-age children — a match", hasSchool(school("a", [YEAR - 6]), school("b", [YEAR - 6])));
ok("same school, siblings a year apart — still a match (the ±2 tolerance)", hasSchool(school("a", [YEAR - 6]), school("b", [YEAR - 7])));
ok(
  "same school, children NINE years apart — the school scores nothing",
  !hasSchool(school("a", [YEAR - 6]), school("b", [YEAR - 15])),
  "the 13 Aug rule: two families at one school nine years apart are not the match 7.1 is for",
);
ok(
  "an unanswered whose-is-it is not a denial — a null side matches",
  hasSchool(
    person("a", { edges: [edge("school", "walden-school", null)], child_birth_years: [YEAR - 6] }),
    person("b", { edges: [edge("school", "walden-school", [YEAR - 15])], child_birth_years: [YEAR - 15] }),
  ),
);

console.log("\n=== 6.3  adjacency, and never doubled ===");
const inArea = (id: string, area: string) => person(id, { neighborhood: area });
ok(
  "the same area does NOT also collect the adjacent credit",
  !(score(inArea("a", "pasadena"), inArea("b", "pasadena"))?.reasons ?? []).some(
    (r) => r.kind === "adjacent_neighborhood",
  ),
  "6.3 own words: without double-counting the same-neighborhood credit",
);
ok(
  "a neighbouring area collects 1",
  score(inArea("a", "pasadena"), inArea("b", "altadena"))!.affinity === WEIGHTS.adjacent_neighborhood,
);
ok(
  "adjacency is symmetric — the pair is stored one way only",
  score(inArea("a", "altadena"), inArea("b", "pasadena"))!.affinity === WEIGHTS.adjacent_neighborhood,
);
ok("a far area collects nothing", score(inArea("a", "pasadena"), inArea("b", "alhambra")) === null);
ok(
  "the same neighborhood is worth more than an adjacent one",
  score(
    person("a", { edges: [edge("neighborhood", "pasadena")], neighborhood: "pasadena" }),
    person("b", { edges: [edge("neighborhood", "pasadena")], neighborhood: "pasadena" }),
  )!.affinity > score(inArea("a", "pasadena"), inArea("b", "altadena"))!.affinity,
);

console.log("\n=== 6.4  similar but not identical, and no headcount advantage ===");
const kids = (id: string, years: number[]) => person(id, { child_birth_years: years });
ok("the same band is a full age match", score(kids("a", [YEAR - 2]), kids("b", [YEAR - 2]))!.affinity === WEIGHTS.age_range);
ok("a neighbouring band is worth half", score(kids("a", [YEAR - 2]), kids("b", [YEAR - 4]))!.affinity === WEIGHTS.age_range / 2);
ok("two bands apart is nothing", score(kids("a", [YEAR - 1]), kids("b", [YEAR - 8])) === null);
ok(
  "four children do not outrank one perfect match",
  score(kids("a", [YEAR - 2]), kids("b", [YEAR - 2, YEAR - 4, YEAR - 6, YEAR - 8]))!.affinity ===
    score(kids("a", [YEAR - 2]), kids("b", [YEAR - 2]))!.affinity,
  "best overlap, never a sum — otherwise the ranking rewards family size",
);

console.log("\n=== 6.2  life relevance boosts, and cannot outweigh a connection ===");
const rel = (id: string, rows: Array<[string, string]>) =>
  person(id, { relevance: rows.map(([dimension, value]) => ({ dimension, value })) });
const FIVE: Array<[string, string]> = [
  ["budget", "compare_value"],
  ["logistics", "close_to_home"],
  ["family_setup", "two_parents"],
  ["childcare", "nanny"],
  ["tenure", "3_10_years"],
];
ok(
  "a shared context value is a boost",
  score(rel("a", [["budget", "compare_value"]]), rel("b", [["budget", "compare_value"]]))!.relevance ===
    m.RELEVANCE_STEP,
);
ok(
  "all five dimensions together stay below one shared school",
  score(rel("a", FIVE), rel("b", FIVE))!.relevance < WEIGHTS.school,
  "relevant firsthand experience comes first; context breaks the tie",
);
ok(
  "two values in one dimension count once, not twice",
  score(
    rel("a", [["logistics", "close_to_home"], ["logistics", "weekends"]]),
    rel("b", [["logistics", "close_to_home"], ["logistics", "weekends"]]),
  )!.relevance === m.RELEVANCE_STEP,
  "otherwise a chattier questionnaire reads as a better match",
);
ok(
  "context alone is never a filter — it still produces a match",
  score(rel("a", [["budget", "compare_value"]]), rel("b", [["budget", "compare_value"]])) !== null,
);

console.log("\n=== 6.5  ranking, hard excludes and stability ===");
const pool = [
  /* Genuinely unconnected: a far area **and** a stage three bands away. The
     first version of this fixture shared the asker's age band and therefore
     scored 2 — a shared stage is a real connection, so the label "unconnected"
     was the thing that was wrong. */
  person("far", { neighborhood: "alhambra", child_birth_years: [YEAR - 16] }),
  person("near", { neighborhood: "altadena", child_birth_years: [YEAR - 3] }),
  person("same", {
    edges: [edge("school", "walden-school", [YEAR - 3])],
    neighborhood: "pasadena",
    child_birth_years: [YEAR - 3],
  }),
];
const asker = person("asker", {
  edges: [edge("school", "walden-school", [YEAR - 3])],
  neighborhood: "pasadena",
  child_birth_years: [YEAR - 3],
});
const ranked = m.rankCandidates(asker, pool, config, { wanted: 3, now: NOW });
ok("the shared school ranks first", ranked.ranked[0]?.person_id === "same");
ok("nobody unconnected is in the list", !ranked.ranked.some((r) => r.person_id === "far"));
ok(
  "the asker is never their own match",
  !m.rankCandidates(asker, [asker, ...pool], config, { now: NOW }).ranked.some((r) => r.person_id === "asker"),
);
const order = (list: Person[]) =>
  JSON.stringify(m.rankCandidates(asker, list, config, { now: NOW }).ranked.map((r) => r.person_id));
ok(
  "the order does not depend on the input order",
  order(pool) === order([...pool].reverse()),
  "an unstable order makes 'did my weight change do anything' unanswerable in the 6.7 harness",
);
ok(
  "a hard exclude the question demanded removes a candidate",
  m.rankCandidates(asker, pool, config, {
    now: NOW,
    requirements: { mustHave: [{ affinity_type: "school", affinity_value: "a-school-nobody-has" }] },
  }).ranked.length === 0,
);

console.log("\n=== 6.6  cold start is reported, not hidden ===");
ok(
  "too few qualify -> cold, carrying both numbers",
  (() => {
    const r = m.rankCandidates(asker, pool, config, { wanted: 5, now: NOW });
    return r.cold && r.wanted === 5 && r.found === r.ranked.length;
  })(),
);
ok("enough qualify -> not cold", !m.rankCandidates(asker, pool, config, { wanted: 1, now: NOW }).cold);
ok("an empty pool is cold rather than an error", m.rankCandidates(asker, [], config, { wanted: 3, now: NOW }).cold);

console.log("\n=== every score can be explained ===");
const explained = score(asker, pool[2])!;
ok(
  "the reasons add up to the score",
  Math.abs(explained.reasons.reduce((n, r) => n + r.points, 0) - explained.score) < 1e-9,
  `reasons ${explained.reasons.reduce((n, r) => n + r.points, 0)} vs score ${explained.score}`,
);
ok("and each carries what it was for", explained.reasons.every((r) => r.kind && r.value));

console.log("\n=== what a question is about, in the market's own vocabulary ===");
{
  /* Retrieval read no subject at all, so "toddler swim classes" and "toddler
     music classes" returned the same activities. The vocabulary existed the
     whole time - market_options.focus, thirteen curated topics - and a grep
     for it over the repository returned nothing. */
  const OFFERED = [
    "activities", "arts_music", "babysitters", "camps", "nannies",
    "new_to_area_help", "newborn_care", "outings", "pediatric_health",
    "preschools_schools", "special_needs_resources", "sports",
    "working_parent_logistics",
  ];
  const read = (q: string) => m.focusInQuestion(q, OFFERED);

  ok("a swim class is sport", read("toddler swim classes near me") === "sports");
  ok("a music class is arts", read("music classes for a 3 year old") === "arts_music");
  ok(
    "and a bare class is neither",
    read("any good toddler classes near South Pasadena?") === "activities",
    "the generic bucket, which is the honest answer to a generic question",
  );
  ok("a nanny is care, not sharing", read("we need a nanny three days a week") === "nannies");
  ok("a rainy day is an outing", read("somewhere to take a toddler on a rainy day") === "outings");
  ok("and nothing is read out of nothing", read("thanks!") === null);

  /* Specific before general, or every sport and every instrument collapses
     into the activities bucket and the whole exercise buys nothing. */
  ok(
    "the specific topic wins over the general one",
    read("swim class") === "sports" && read("piano lessons") === "arts_music",
  );

  /* A market that does not offer a topic must not have questions matched
     against it - market_options decides, not this file. */
  ok(
    "a topic the market does not offer is not returned",
    m.focusInQuestion("we need a nanny", ["activities", "camps"]) === null,
    "the same validation the extraction pass does on the way in",
  );
  ok(
    "but the next offered one still is",
    m.focusInQuestion("swim classes", ["activities", "camps"]) === "activities",
    "a market with no sports still has a class - degrading is better than nothing",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
