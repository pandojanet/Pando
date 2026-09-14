/**
 * The SGV place list and its ZIP index (client §5, 9 Sep).
 *
 * Pure, so it runs in plain node with no server and no database — which is the
 * reason `lib/home-places.ts` has no runtime imports. Everything here is a rule
 * rather than a count, except where the count *is* the client's instruction.
 */

let pass = 0;
let fail = 0;
const failures: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const p = (await import(
  `../lib/home-places.ts?v=${Date.now()}`
)) as typeof import("../lib/home-places.ts");

console.log("\n=== the list is hers ===");
/**
 * Her table, counted: 31 incorporated cities, 16 unincorporated communities,
 * 5 adjacent western places. A count is normally the wrong thing to assert —
 * this file's own recurring lesson — and here the count **is** the instruction,
 * because the scope sentence is hers and a place appearing in it or leaving it
 * is a decision rather than a refactor.
 */
ok(
  "52 places, and her scope sentence is 31 cities + 16 unincorporated + 5 western",
  p.PLACES.length === 52 &&
    p.PLACES.filter((x) => !x.adjacent && x.type === "city").length === 31 &&
    p.PLACES.filter((x) => !x.adjacent && x.type === "unincorporated").length === 16 &&
    p.PLACES.filter((x) => x.adjacent).length === 5,
  `${p.PLACES.length} total`,
);
/**
 * ⚠ The five western places are **not** a fourth `place_type`, and the first
 * cut made them one. On her own vocabulary they are three different things —
 * Glendale is an incorporated city, Eagle Rock and Highland Park are LA
 * neighborhoods, La Crescenta and Montrose are unincorporated — so what they
 * share is scope, not kind. Two axes, because one could answer neither.
 */
ok(
  "and 'adjacent' is a scope flag rather than a kind",
  p.placeById("glendale")?.type === "city" &&
    p.placeById("eagle-rock")?.type === "la_neighborhood" &&
    p.placeById("montrose")?.type === "unincorporated" &&
    p.PLACES.filter((x) => x.adjacent).every((x) => x.type !== undefined),
);
ok(
  "place_type uses her three words and invents no fourth",
  p.PLACES.every((x) => ["city", "unincorporated", "la_neighborhood"].includes(x.type)),
  "her storage note: incorporated city / unincorporated community / LA neighborhood",
);
ok(
  "62 residential ZIPs reach them, and 15 are shared between places",
  p.SUPPORTED_ZIPS.length === 62 &&
    p.SUPPORTED_ZIPS.filter((z) => p.placesForZip(z).length > 1).length === 15,
  `${p.SUPPORTED_ZIPS.length} ZIPs`,
);
ok(
  "every place carries at least one residential ZIP",
  p.PLACES.every((x) => x.zips.length > 0),
  "a place with no ZIP cannot be reached by the one field that asks for one",
);
ok(
  "no id appears twice",
  new Set(p.PLACES.map((x) => x.id)).size === p.PLACES.length,
);
ok(
  "every id is a slug",
  p.PLACES.every((x) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x.id)),
  "matching keys on slugs everywhere in this app; a display name breaks on a respelling",
);
ok(
  "every ZIP is five digits",
  p.PLACES.every((x) => x.zips.every((z) => /^\d{5}$/.test(z))),
);

ok(
  "Glendale's 91201–91208 is expanded, not stored as a range",
  p.placeById("glendale")?.zips.length === 8,
  String(p.placeById("glendale")?.zips.length),
);
ok(
  "City of Industry is the one deprioritised place",
  p.PLACES.filter((x) => x.deprioritised).map((x) => x.id).join() === "industry",
  "her table: shared ZIPs, low value as a residential choice",
);

console.log("\n=== which area a community matches on ===");
/**
 * The 9 Sep district roll-up arriving at the unincorporated layer. Without it
 * each of the twelve new communities is an area of one and matches nobody —
 * the fault that left fourteen of thirty-nine contributors on an island.
 */
ok(
  "a community that shares its ZIP matches on the city it shares it with",
  p.areaFor(p.placeById("valinda")) === "la-puente" &&
    p.areaFor(p.placeById("mayflower-village")) === "monrovia" &&
    p.areaFor(p.placeById("citrus")) === "azusa",
);
ok(
  "and every roll-up target is a real place",
  p.PLACES.filter((x) => x.rollsUpTo).every((x) => p.placeById(x.rollsUpTo!) !== null),
  "a dangling target is an area nothing else is in — the island, one remove along",
);
ok(
  "a roll-up never points at another roll-up",
  p.PLACES.filter((x) => x.rollsUpTo).every((x) => !p.placeById(x.rollsUpTo!)?.rollsUpTo),
  "two hops would make the area depend on resolution order",
);
ok(
  "a place with no roll-up is its own area",
  p.areaFor(p.placeById("pasadena")) === "pasadena" &&
    p.areaFor(p.placeById("altadena")) === "altadena",
);
ok(
  "the big communities keep their own area",
  ["altadena", "hacienda-heights", "rowland-heights"].every(
    (id) => p.areaFor(p.placeById(id)) === id,
  ),
  "tens of thousands of residents each; folding them in matches a parent on a place they do not live in",
);
ok("and nothing is nothing", p.areaFor(null) === null);
ok(
  "⚠ rolling up never widens a ZIP",
  p.placesForZip("91744").map((x) => x.id).includes("valinda") &&
    !p.placesForZip("91744").map((x) => x.id).includes("covina"),
  "where somebody lives and who they match are different questions",
);

console.log("\n=== a ZIP names a place only sometimes ===");
/**
 * ⚠ The estimate sketches this as "91106 → Pasadena", which holds for Pasadena
 * and fails across a third of the footprint. These five are the collisions in
 * her own table, and they are why nothing resolves a ZIP to a single place.
 */
for (const [zip, n] of [
  ["91702", 3], // Azusa · Irwindale · Citrus
  ["91746", 4], // La Puente · Avocado Heights · Bassett · West Puente Valley
  ["91744", 4], // City of Industry · La Puente · South San Jose Hills · Valinda
  ["91016", 3], // Monrovia · Mayflower Village · South Monrovia Island
  ["91789", 3], // Diamond Bar · City of Industry · Walnut
] as const) {
  ok(
    `${zip} serves ${n} places, and all of them come back`,
    p.placesForZip(zip).length === n,
    p.placesForZip(zip).map((x) => x.name).join(", "),
  );
}
ok(
  "91106 is Pasadena and only Pasadena",
  p.placesForZip("91106").map((x) => x.id).join() === "pasadena",
);
ok(
  "a shared ZIP does not open on the deprioritised place",
  p.placesForZip("91744")[0]?.id !== "industry",
  p.placesForZip("91744").map((x) => x.name).join(", "),
);

console.log("\n=== reading a ZIP the way a field receives one ===");
ok("plain", p.normaliseZip("91106") === "91106");
ok("ZIP+4 is truncated, never refused", p.normaliseZip("91106-1234") === "91106");
ok("whitespace", p.normaliseZip("  91106 ") === "91106");
ok("four digits is not a ZIP", p.normaliseZip("9110") === null);
ok("six digits is not a ZIP", p.normaliseZip("911061") === null);
ok("words are not a ZIP", p.normaliseZip("Pasadena") === null);
ok("empty", p.normaliseZip("") === null && p.normaliseZip(null) === null);

console.log("\n=== supported is a fact, never a gate ===");
ok("91106 is in the footprint", p.isSupportedZip("91106"));
ok("91744 is too, shared or not", p.isSupportedZip("91744"));
ok("90210 is not", !p.isSupportedZip("90210"));
ok("nor is junk", !p.isSupportedZip("hello") && !p.isSupportedZip(null));
ok(
  "the footprint is published as a sorted list",
  p.SUPPORTED_ZIPS.length > 50 &&
    p.SUPPORTED_ZIPS.every((z, i) => i === 0 || p.SUPPORTED_ZIPS[i - 1] < z),
  `${p.SUPPORTED_ZIPS.length} ZIPs`,
);
ok(
  "and every ZIP on a place is in it",
  p.PLACES.every((x) => x.zips.every((z) => p.SUPPORTED_ZIPS.includes(z))),
);

console.log("\n=== the ZIP follow-up, and the pairing it produces ===");
ok(
  "Pasadena needs the question — six ZIPs",
  p.needsZipChoice(p.placeById("pasadena")),
);
ok(
  "Altadena does not — one ZIP",
  !p.needsZipChoice(p.placeById("altadena")),
);
ok("and neither does nothing", !p.needsZipChoice(null));
ok(
  "a ZIP is checked against the place it was chosen for",
  p.zipBelongsTo(p.placeById("pasadena"), "91106"),
);
ok(
  "a mismatched pair is refused rather than stored",
  !p.zipBelongsTo(p.placeById("pasadena"), "91001"),
  "one place for matching and another for demand is the failure this prevents",
);

console.log("\n=== her combobox: town, neighborhood or ZIP ===");
ok(
  "accents fold — 'la canada' finds La Cañada Flintridge",
  p.searchPlaces("la canada")[0]?.id === "la-canada-flintridge",
  p.searchPlaces("la canada").map((x) => x.name).join(", "),
);
ok(
  "and so does the accented spelling",
  p.searchPlaces("cañada")[0]?.id === "la-canada-flintridge",
);
ok(
  "'south pas' works, because that is how it gets typed",
  p.searchPlaces("south pas")[0]?.id === "south-pasadena",
);
ok(
  "'monte' returns all three El Montes",
  p.searchPlaces("monte").length >= 3,
  p.searchPlaces("monte").map((x) => x.name).join(", "),
);
ok(
  "'san g' opens on San Gabriel, not East San Gabriel",
  p.searchPlaces("san g")[0]?.id === "san-gabriel",
  p.searchPlaces("san g").map((x) => x.name).join(", "),
);
ok(
  "a full ZIP searches as a ZIP",
  p.searchPlaces("91001")[0]?.id === "altadena",
);
ok(
  "a ZIP being typed returns nothing rather than noise",
  p.searchPlaces("911").length === 0,
  "three digits matching names fills the list with rows that vanish on the 5th key",
);
ok(
  "an unknown ZIP returns nothing to pick",
  p.searchPlaces("90210").length === 0,
  "and the caller offers to continue unsupported instead",
);
ok("an empty query returns nothing", p.searchPlaces("").length === 0);
ok(
  "the limit is honoured",
  p.searchPlaces("a", 3).length <= 3,
);

console.log("\n=== the live cohort still resolves ===");
/**
 * ⚠ Measured against `people.neighborhood` on 14 Sep. The other ten values in
 * use are Pasadena districts, which are **not** this module's concern — the
 * developer's call — and reach their city through `market_options.area_slug`.
 * This asserts only that no *city* a real contributor chose has been dropped.
 */
for (const id of [
  "altadena",
  "south-pasadena",
  "east-pasadena",
  "arcadia",
  "san-marino",
  "monrovia",
  "sierra-madre",
  "eagle-rock",
  "monterey-park",
  "pasadena",
  "temple-city",
]) {
  ok(`${id} is still a place`, p.placeById(id) !== null);
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
if (fail > 0) console.log(`  ${failures.join("\n  ")}\n`);
process.exit(fail > 0 ? 1 : 0);
