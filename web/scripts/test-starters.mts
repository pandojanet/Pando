import type { Option } from "../lib/types.ts";

/**
 * Which starters a question offers as taps.
 *
 * **This rule has been reported wrong by the client twice**, and both times it
 * was invisible to everything but a pair of eyes on a phone: typecheck clean,
 * suite green, feature doing the opposite of what it was for. So the two faults
 * she found are pinned here by name, along with the behaviour that was correct
 * and must survive the fix.
 */

const s = (await import(`../lib/starters.ts?v=${Date.now()}`)) as typeof import("../lib/starters.ts");

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

const rec = (label: string, areaSlug: string): Option => ({
  id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  label,
  area: label,
  area_slug: areaSlug,
});

/** Her seventeen approved towns, as the neighborhood question receives them. */
const TOWNS = [
  "Alhambra",
  "Altadena",
  "Arcadia",
  "Duarte",
  "Eagle Rock",
  "Glendale",
  "Highland Park",
  "La Cañada Flintridge",
  "Monrovia",
  "Monterey Park",
  "Pasadena",
  "Rosemead",
  "San Gabriel",
  "San Marino",
  "Sierra Madre",
  "South Pasadena",
  "Temple City",
];

/**
 * The neighborhood directory as it really is: her seventeen towns curated as
 * starters, each carrying its **own** slug as its area — which is what made the
 * area filter circular — plus the intra-Pasadena values that all carry
 * `pasadena`. Verified against the live table on 1 Sep.
 */
const towns: Option[] = TOWNS.map((t) =>
  rec(t, t.toLowerCase().replace(/ñ/g, "n").replace(/[^a-z0-9]+/g, "-")),
);
const pasadenaSubs: Option[] = [
  "Old Pasadena",
  "Linda Vista",
  "San Rafael",
  "Madison Heights",
  "Northwest Pasadena",
  "Orange Heights",
  "Playhouse District",
  "Bungalow Heaven",
  "Hastings Ranch",
].map((n) => rec(n, "pasadena"));

const neighborhoodOptions = [...towns, ...pasadenaSubs];
const labelsOf = (list: Option[]) => list.map((o) => o.label);

console.log("\n=== 1 Sep, item 2: all seventeen towns are offered ===");
const unpicked = s.visibleStarters({
  options: neighborhoodOptions,
  area: null,
  selected: [],
  wholeList: true,
});
ok(
  "every approved town is a tap",
  TOWNS.every((t) => labelsOf(unpicked).includes(t)),
  TOWNS.filter((t) => !labelsOf(unpicked).includes(t)).join(", ") || "none missing",
);
ok(
  "including the five she reported missing",
  ["San Gabriel", "San Marino", "Sierra Madre", "South Pasadena", "Temple City"].every(
    (t) => labelsOf(unpicked).includes(t),
  ),
  "seventeen against STARTER_LIMIT = 12 cut exactly these, alphabetically",
);
/* The regression, stated as the arithmetic that caused it. */
ok(
  "seventeen is more than the cap, which is why this needed a rule and not a bigger number",
  TOWNS.length > s.STARTER_LIMIT,
  `${TOWNS.length} towns, cap ${s.STARTER_LIMIT}`,
);

console.log("\n=== and the list does not move when one is tapped ===");
const picked = s.visibleStarters({
  options: neighborhoodOptions,
  area: "pasadena",
  selected: ["pasadena"],
  wholeList: true,
});
ok(
  "nothing disappears",
  labelsOf(picked).length === labelsOf(unpicked).length,
  `${labelsOf(unpicked).length} before, ${labelsOf(picked).length} after`,
);
ok(
  "the order is identical",
  labelsOf(picked).join("|") === labelsOf(unpicked).join("|"),
  "the selected chip stays where the parent found it — item 2's own instruction",
);
ok(
  "Pasadena appears exactly once",
  labelsOf(picked).filter((l) => l === "Pasadena").length === 1,
);
ok(
  "and its sub-neighborhoods do not take the list over",
  labelsOf(picked).filter((l) => l.includes("Pasadena")).length ===
    labelsOf(unpicked).filter((l) => l.includes("Pasadena")).length,
  "with the area filter on, isHome matched all nine of them and cleared AREA_FLOOR alone",
);
const madre = s.visibleStarters({
  options: neighborhoodOptions,
  area: "sierra-madre",
  selected: ["sierra-madre"],
  wholeList: true,
});
ok(
  "a town with no sub-neighborhoods behaves the same",
  labelsOf(madre).join("|") === labelsOf(unpicked).join("|"),
  "filtered, this one matched a single record and was topped back up to eight",
);

console.log("\n=== what the fix must NOT have broken: the four directories ===");
/**
 * Schools are the case the area rule exists for: her sheets curate exactly eight
 * per area, so ranking alone left a parent with their own eight plus four from
 * wherever sorted first — not familiar choices, just the top of a list.
 */
const schools: Option[] = [
  ...Array.from({ length: 8 }, (_, i) => rec(`LCF School ${i + 1}`, "la-canada-flintridge")),
  ...Array.from({ length: 8 }, (_, i) => rec(`Alhambra School ${i + 1}`, "alhambra")),
  ...Array.from({ length: 11 }, (_, i) => rec(`Pasadena School ${i + 1}`, "pasadena")),
];
const lcf = s.visibleStarters({ options: schools, area: "la-canada-flintridge", selected: [] });
ok(
  "a multi-word area still ranks its own city first",
  labelsOf(lcf)[0].startsWith("LCF"),
  "the 27 Aug bug: lower(area) = slug bridged single-word names and nothing else",
);
ok(
  "and it is filtered, not merely ranked",
  labelsOf(lcf).every((l) => l.startsWith("LCF")),
  `${labelsOf(lcf).length} shown`,
);
ok("never more than the cap", labelsOf(lcf).length <= s.STARTER_LIMIT);

console.log("\n=== the floor still tops up a thin area ===");
const thin: Option[] = [
  ...Array.from({ length: 2 }, (_, i) => rec(`Altadena Class ${i + 1}`, "altadena")),
  ...Array.from({ length: 11 }, (_, i) => rec(`Pasadena Class ${i + 1}`, "pasadena")),
  ...Array.from({ length: 4 }, (_, i) => rec(`Alhambra Class ${i + 1}`, "alhambra")),
];
const altadena = s.visibleStarters({ options: thin, area: "altadena", selected: [] });
ok(
  "two of your own is not a screen, so it fills to the floor",
  labelsOf(altadena).length === s.AREA_FLOOR,
  `${labelsOf(altadena).length} shown`,
);
ok(
  "your own area comes first",
  labelsOf(altadena).slice(0, 2).every((l) => l.startsWith("Altadena")),
);
ok(
  "and the fill prefers the biggest area, not the alphabet",
  labelsOf(altadena)[2].startsWith("Pasadena"),
  "alphabetical put Alhambra first, for no reason a parent could perceive",
);

console.log("\n=== item 5: a selection stays where the parent found it ===");
const inPlace = s.visibleStarters({ options: schools, area: "alhambra", selected: [] });
const afterTap = s.visibleStarters({
  options: schools,
  area: "alhambra",
  selected: ["alhambra-school-5"],
});
ok(
  "tapping a chip does not move it",
  labelsOf(inPlace).join("|") === labelsOf(afterTap).join("|"),
  "*Selected affiliations should appear only once rather than being duplicated above and inside the list*",
);
ok(
  "it appears once",
  labelsOf(afterTap).filter((l) => l === "Alhambra School 5").length === 1,
);

console.log("\n=== a selection is never dropped ===");
const moved = s.visibleStarters({
  options: schools,
  /* They picked an Alhambra school, then changed their neighborhood to LCF. */
  area: "la-canada-flintridge",
  selected: ["alhambra-school-3"],
});
ok(
  "a chip whose area no longer matches survives",
  labelsOf(moved).includes("Alhambra School 3"),
  "otherwise the answer is stored with nothing on screen representing it",
);

console.log("\n=== the question's own furniture is never touched ===");
const withSpecial = s.visibleStarters({
  options: [
    ...schools,
    { id: "homeschool", label: "Homeschool", exclusive: true },
    { id: "not_in_school_yet", label: "Not in school or daycare yet", exclusive: true },
  ],
  area: "la-canada-flintridge",
  selected: [],
});
ok(
  "a refusal is always reachable",
  labelsOf(withSpecial).includes("Homeschool") &&
    labelsOf(withSpecial).includes("Not in school or daycare yet"),
);
ok(
  "and comes after the records",
  labelsOf(withSpecial).indexOf("Homeschool") >
    labelsOf(withSpecial).findIndex((l) => l.startsWith("LCF")),
  "a refusal belongs to the whole question, not to the top of one area's list",
);
ok(
  "the cap counts records only, so furniture can never crowd it out",
  labelsOf(withSpecial).filter((l) => !l.startsWith("LCF")).length === 2,
);

console.log("\n=== an unanswered area filters nothing ===");
const noArea = s.visibleStarters({ options: schools, area: null, selected: [] });
ok(
  "it falls back to a capped list rather than an empty screen",
  labelsOf(noArea).length === s.STARTER_LIMIT,
  `${labelsOf(noArea).length} shown`,
);
ok("and includes more than one city", new Set(labelsOf(noArea).map((l) => l.split(" ")[0])).size > 1);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
