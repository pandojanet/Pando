import assert from "node:assert/strict";

/**
 * Item 11's derivation: a canonical place → the coarse tenure signal.
 *
 * This has its own file because the first design of it was **wrong in a way that
 * looked right**. The geography was encoded in the id's suffix, and country codes
 * collide with US state codes across the board — DE is Germany and Delaware, IN
 * India and Indiana, IL Israel and Illinois, MA Morocco and Massachusetts, AR
 * Argentina and Arkansas, ID Indonesia and Idaho, CA Canada and California. Twelve
 * of the seeded cities would have filed a Berlin family as living in another US
 * state, and nothing about the code would have looked suspicious.
 *
 * So half the cases below are those collisions, in both directions: the foreign
 * city must be foreign, and its domestic namesake must still be domestic.
 */

const { movedFromPlaces } = (await import(
  `../lib/places.ts?v=${Date.now()}`
)) as typeof import("../lib/places.ts");

let pass = 0;
const ok = (label: string) => {
  pass++;
  console.log(`  ok    ${label}`);
};
const same = (got: string[], want: string[]) =>
  assert.deepEqual([...got].sort(), [...want].sort());

// ── the three signals ──────────────────────────────────────────────────────
same(movedFromPlaces(["us-san-francisco-ca"]), ["elsewhere_in_california"]);
same(movedFromPlaces(["us-new-york-ny"]), ["another_us_state"]);
same(movedFromPlaces(["intl-london-uk"]), ["another_country"]);
ok("California, another state and another country each derive");

// ── the collisions that broke the first design ─────────────────────────────
for (const [id, city] of [
  ["intl-berlin-de", "Berlin (vs Delaware)"],
  ["intl-mumbai-in", "Mumbai (vs Indiana)"],
  ["intl-tel-aviv-il", "Tel Aviv (vs Illinois)"],
  ["intl-casablanca-ma", "Casablanca (vs Massachusetts)"],
  ["intl-buenos-aires-ar", "Buenos Aires (vs Arkansas)"],
  ["intl-jakarta-id", "Jakarta (vs Idaho)"],
  ["intl-toronto-ca", "Toronto (vs California)"],
  ["intl-bogota-co", "Bogotá (vs Colorado)"],
] as const) {
  same(movedFromPlaces([id]), ["another_country"]);
  ok(`${city} is abroad`);
}

for (const [id, city] of [
  ["us-wilmington-de", "Wilmington DE"],
  ["us-indianapolis-in", "Indianapolis IN"],
  ["us-chicago-il", "Chicago IL"],
  ["us-boston-ma", "Boston MA"],
  ["us-little-rock-ar", "Little Rock AR"],
  ["us-boise-id", "Boise ID"],
  ["us-los-angeles-ca", "Los Angeles CA"],
] as const) {
  const got = movedFromPlaces([id]);
  assert.ok(
    got.length === 1 && got[0] !== "another_country",
    `${city} came out as ${got.join(",")}`,
  );
  ok(`${city} is still domestic`);
}

// ── one experience, one row ────────────────────────────────────────────────
same(movedFromPlaces(["us-oakland-ca", "us-berkeley-ca", "us-davis-ca"]), [
  "elsewhere_in_california",
]);
ok("three Californian cities are one signal, not three");
same(movedFromPlaces(["us-oakland-ca", "us-austin-tx", "intl-paris-fr"]), [
  "elsewhere_in_california",
  "another_us_state",
  "another_country",
]);
ok("but three different kinds of place are three signals");

// ── what must contribute nothing ───────────────────────────────────────────
same(movedFromPlaces([]), []);
ok("no places, no rows");
/* A place the parent typed sits in `pending_options` until an admin gives it a
   canonical id. Guessing its geography would be exactly what invariant 9 forbids
   for every other "other" answer. */
same(movedFromPlaces(["some-place-they-typed"]), []);
ok("an un-promoted typed place contributes nothing");
same(movedFromPlaces(["us-nowhere-zz"]), []);
ok("a US id with an unreal state code is skipped, not guessed");

console.log(`\n${pass} checks passed.`);
