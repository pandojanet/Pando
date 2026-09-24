/**
 * Which place a question is about (24 Sep).
 *
 * The developer asked Pando about New York and was answered with a class in
 * South Pasadena. These are the two readers that decide "where is this about"
 * before anything is retrieved, plus the source checks that hold the answer
 * path to them — `inbound.ts` and `retrieval.ts` carry `server-only`, so they
 * are read rather than imported.
 */

import fs from "node:fs";

const m = (await import(`../lib/place-in-question.ts?v=${Date.now()}`)) as typeof import("../lib/place-in-question.ts");

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

const AREAS = [
  { id: "pasadena", label: "Pasadena" },
  { id: "south-pasadena", label: "South Pasadena" },
  { id: "san-gabriel", label: "San Gabriel" },
  { id: "la-canada-flintridge", label: "La Cañada Flintridge" },
  { id: "new-york", label: "New York, NY" },
];

console.log("\n=== a place the market knows ===");
{
  const id = (q: string) => m.knownPlaceIn(q, AREAS)?.id ?? null;
  ok("New York, once approved, is found", id("any toddler classes in New York?") === "new-york");
  ok("case and punctuation do not matter", id("NEW YORK swim lessons") === "new-york");
  ok("the longest name wins", id("music class in South Pasadena") === "south-pasadena");
  ok("an accent is folded", id("preschools in la canada flintridge") === "la-canada-flintridge");
  ok("the market's own name is not the city", id("best parks in the San Gabriel Valley") === null);
  ok("a whole word only", id("pasadenas finest") === null);
  ok("nothing named, nothing found", id("any good toddler classes?") === null);
}

console.log("\n=== a phrase to geocode ===");
{
  const p = m.placePhraseIn;
  ok("in New York", p("any toddler classes in New York?") === "New York");
  ok("stops at 'for'", p("swim lessons in Boston for a 4 year old") === "Boston");
  ok("near", p("playgrounds near Long Beach") === "Long Beach");
  ok("three words at most", p("camps in Salt Lake City Utah area") === "Salt Lake City");
  ok("a ZIP", p("daycare in 10001") === "10001");
  ok("not 'in the morning'", p("classes in the morning") === null);
  ok("not a month", p("camps in June") === null);
  ok("not 'in advance'", p("book in advance?") === null);
  ok("not a digit-word", p("in 4th grade") === null);
  ok("no preposition, no phrase", p("toddler classes Pasadena") === null);
}

console.log("\n=== a stored place as a search location ===");
{
  const l = m.locationFromLabel("New York, NY");
  ok("city and state", l.city === "New York" && l.region === "NY" && l.country === "US");
  const d = m.locationFromLabel("Detroit");
  ok("a bare name is still the US", d.city === "Detroit" && d.region === undefined && d.country === "US");
}

console.log("\n=== the answer path reads it (source checks) ===");
{
  const inbound = fs.readFileSync("lib/server/inbound.ts", "utf8");
  ok("the place is resolved before retrieval", /placeForQuestion\(/.test(inbound)
    && inbound.indexOf("placeForQuestion(") < inbound.indexOf("retrieveFor({"));
  const has = (src: string, text: string) => src.replace(/\s+/g, " ").includes(text);
  ok("retrieval gets the resolved area and its near set",
    has(inbound, "retrieveFor({ area: place.area, near: place.near,"));
  ok("the search is told where", has(inbound, "location: searchLocationFor(place)"));
  ok("the offer needs parents near the place",
    has(inbound, "askable === null || askable >= MIN_ASKABLE_NEAR")
      && has(inbound, "canAsk ? {} : { can_offer_blast: false, nobody_near:"));
  ok("the Ask created from a yes is about the question's place",
    has(inbound, "neighborhood: asked.area,"));

  const retrieval = fs.readFileSync("lib/server/repo/retrieval.ts", "utf8");
  ok("shares are filtered to the near set",
    has(retrieval, "nearList === null ? sql`` : sql`and s.neighborhoods && ${nearList}::text[]`"));
  ok("caregivers too",
    has(retrieval, "nearList === null ? sql`` : sql`and cp.areas_served && ${nearList}::text[]`"));

  const areas = fs.readFileSync("lib/server/repo/areas.ts", "utf8");
  ok("near is read from neighborhood_adjacency", has(areas, "from neighborhood_adjacency where market_id"));

  const nearCall = "near: blast.neighborhood ? await nearbyAreas(market, String(blast.neighborhood)) : null";
  ok("the send restricts its pool to the near set",
    has(fs.readFileSync("lib/server/repo/blast.ts", "utf8"), nearCall));
  ok("and the preview the same way",
    has(fs.readFileSync("lib/server/repo/admin-read.ts", "utf8"), nearCall));

  const place = fs.readFileSync("lib/server/place-for-question.ts", "utf8");
  ok("no place list in code decides support", !/\bPLACES\b/.test(place) && !place.includes("inMarket ?"));
  ok("nothing known searches the US", has(place, 'return { country: "US", inMarket: false }'));
  ok("a geocode must be the place named", has(place, "sameStart(first.name, phrase)"));

  const write = fs.readFileSync("lib/server/repo/admin-write.ts", "utf8");
  ok("promoting a neighborhood sets it on its submitters",
    /update people set neighborhood = \$\{slug\}\s+where id = any\(\$\{idArray\}::uuid\[\]\) and neighborhood is null/.test(write));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
