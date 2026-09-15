/**
 * Reading Google's Geocoding answers (§5's third question, 15 Sep).
 *
 * Pure, so it runs in plain node with no server, no database and no API key —
 * which is the reason `lib/geo.ts` has no runtime imports. Every fixture here
 * is the **shape Google actually answers with**, trimmed to the components the
 * parser reads, so the branches being walked are the ones a live response takes.
 *
 * ⚠ Roughly half of these assert a **refusal**: a result dropped for having no
 * usable name, a non-US match ignored, a failure kept apart from an empty
 * answer, a partial ZIP never reaching the network. That ratio is deliberate
 * and it is the same one `test:e2e` keeps — a suite that only proved the happy
 * path would go green while every one of those cost money or told a parent
 * something untrue.
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

const g = (await import(`../lib/geo.ts?v=${Date.now()}`)) as typeof import("../lib/geo.ts");

/* ── fixtures ──────────────────────────────────────────────────────────────── */

type Component = { long_name: string; short_name: string; types: string[] };
const c = (long: string, short: string, ...types: string[]): Component => ({
  long_name: long,
  short_name: short,
  types,
});

const CA = c("California", "CA", "administrative_area_level_1", "political");
const LA_COUNTY = c("Los Angeles County", "Los Angeles County", "administrative_area_level_2", "political");
const US = c("United States", "US", "country", "political");

const result = (types: string[], components: Component[]) => ({
  address_components: components,
  formatted_address: "(trimmed)",
  types,
});

const okBody = (...results: unknown[]) => ({ status: "OK", results });

/** A postcode lookup: `components=postal_code:91011|country:US`. */
const ZIP_91011 = okBody(
  result(
    ["postal_code"],
    [
      c("91011", "91011", "postal_code"),
      c("La Cañada Flintridge", "La Cañada Flintridge", "locality", "political"),
      LA_COUNTY,
      CA,
      US,
    ],
  ),
);

/** A named area inside Los Angeles — Pando's one derivable `place_type`. */
const EAGLE_ROCK = okBody(
  result(
    ["neighborhood", "political"],
    [
      c("Eagle Rock", "Eagle Rock", "neighborhood", "political"),
      c("Los Angeles", "Los Angeles", "locality", "political"),
      LA_COUNTY,
      CA,
      US,
    ],
  ),
);

/** A named area inside *Pasadena*. Pando calls this a district, not a place. */
const BUNGALOW_HEAVEN = okBody(
  result(
    ["neighborhood", "political"],
    [
      c("Bungalow Heaven", "Bungalow Heaven", "neighborhood", "political"),
      c("Pasadena", "Pasadena", "locality", "political"),
      LA_COUNTY,
      CA,
      US,
    ],
  ),
);

/** Unincorporated, and Google says `locality` exactly as it does for a city. */
const ALTADENA = okBody(
  result(
    ["locality", "political"],
    [c("Altadena", "Altadena", "locality", "political"), LA_COUNTY, CA, US],
  ),
);

/** The wrong Pasadena, which a market-biased query still returns when asked. */
const PASADENA_TX = okBody(
  result(
    ["locality", "political"],
    [
      c("Pasadena", "Pasadena", "locality", "political"),
      c("Harris County", "Harris County", "administrative_area_level_2", "political"),
      c("Texas", "TX", "administrative_area_level_1", "political"),
      US,
    ],
  ),
);

console.log("\n=== a ZIP resolves to the town, not to itself ===");
{
  const out = g.readGeocode(ZIP_91011);
  ok("it succeeded", out.ok);
  const place = out.ok ? out.places[0] : null;
  /**
   * ⚠ The town, never the postcode. A postcode result carries **both**
   * components, and a row reading "91011" tells a parent nothing they did not
   * just type into the box themselves.
   */
  ok("the name is the town", place?.name === "La Cañada Flintridge", place?.name);
  ok("the ZIP rides along as context", place?.zip === "91011" && place.where.includes("91011"), place?.where);
  ok("the key folds the way the taxonomy folds a slug", place?.key === "la-canada-flintridge", place?.key);
  ok("in market", place?.inMarket === true);
  ok("stored as the plain name", place?.storedValue === "La Cañada Flintridge", place?.storedValue);
}

console.log("\n=== the one place_type Google can actually say ===");
{
  const eagle = g.readGeocode(EAGLE_ROCK);
  ok(
    "a neighborhood of Los Angeles is an la_neighborhood",
    eagle.ok && eagle.places[0]?.type === "la_neighborhood",
    eagle.ok ? String(eagle.places[0]?.type) : "",
  );
  ok(
    "and it carries its city, which is what tells it from a town",
    eagle.ok && eagle.places[0]?.city === "Los Angeles",
  );

  /**
   * ⚠⚠ The two assertions this whole module turns on.
   *
   * Google's vocabulary has no word for *unincorporated*: Altadena and Pasadena
   * are both `locality`, and sixteen of the client's 52 places are the former.
   * A parser that mapped `locality` → `"city"` would write a fact nobody stated
   * onto a third of everything it ever resolves. And a neighborhood of a town
   * that is not Los Angeles is a **district** in Pando's model — it lives in
   * `market_options` with an `area_slug`, and is not a `Place` at all.
   */
  const alt = g.readGeocode(ALTADENA);
  ok(
    "an unincorporated community is NOT typed as a city",
    alt.ok && alt.places[0]?.type === null,
    alt.ok ? String(alt.places[0]?.type) : "",
  );
  const bh = g.readGeocode(BUNGALOW_HEAVEN);
  ok(
    "a district of Pasadena is NOT typed as an LA neighborhood",
    bh.ok && bh.places[0]?.type === null,
    bh.ok ? String(bh.places[0]?.type) : "",
  );
  ok("but it still resolves, and names its city", bh.ok && bh.places[0]?.city === "Pasadena");
}

console.log("\n=== out of market ranks and is labelled — never hidden ===");
{
  const out = g.readGeocode(PASADENA_TX);
  const place = out.ok ? out.places[0] : null;
  ok("it is returned rather than dropped", out.ok && out.places.length === 1);
  ok("marked out of market", place?.inMarket === false);
  /**
   * The disambiguator, and it is load-bearing: a parent handed a bare
   * "Pasadena" has no way to tell which of the two they just tapped.
   */
  ok("the state is in the line under the name", place?.where.includes("TX") === true, place?.where);
  ok(
    "and in what gets stored, so the pending row can be promoted safely",
    place?.storedValue === "Pasadena, TX",
    place?.storedValue,
  );

  /* In-market first, out-of-market after — ranking, never filtering, which is
     the rule the directory search already applies to the home area. */
  const mixed = g.readGeocode({
    status: "OK",
    results: [...PASADENA_TX.results, ...ALTADENA.results],
  });
  ok(
    "in-market sorts first",
    mixed.ok && mixed.places[0]?.name === "Altadena" && mixed.places[1]?.name === "Pasadena",
    mixed.ok ? mixed.places.map((p) => p.name).join(" → ") : "",
  );
}

console.log("\n=== what is dropped rather than repaired ===");
{
  const canada = g.readGeocode(
    okBody(
      result(
        ["locality", "political"],
        [
          c("London", "London", "locality", "political"),
          c("Ontario", "ON", "administrative_area_level_1", "political"),
          c("Canada", "CA", "country", "political"),
        ],
      ),
    ),
  );
  /**
   * ⚠ `CA` is Canada's country code *and* California's state code — the exact
   * collision `lib/places.ts` already paid for once, where twelve seeded cities
   * would have filed a Berlin family as living in another US state. The country
   * is read from `country`, never inferred from a two-letter match anywhere.
   */
  ok("a non-US match is dropped", canada.ok && canada.places.length === 0);

  const nameless = g.readGeocode(okBody(result(["country", "political"], [US])));
  ok("a result with no usable name is dropped", nameless.ok && nameless.places.length === 0);

  const empty = g.readGeocode(okBody(result([], [])));
  ok("so is one with no components at all", empty.ok && empty.places.length === 0);

  const dupes = g.readGeocode({
    status: "OK",
    results: [...ALTADENA.results, ...ALTADENA.results],
  });
  ok("the same place twice is one row", dupes.ok && dupes.places.length === 1);
}

console.log("\n=== a failure is never an empty answer ===");
/**
 * ⚠⚠ The 9 Sep fault, pinned so it cannot be committed again.
 * `PublicSearchResult.configured` was computed, carried and read by nobody, so
 * *"the search did not run"* and *"the search found nothing"* were one thing
 * downstream — the `persisted: false` honesty rule inverted. Here they are two
 * shapes, and only one of them is ever cached.
 */
{
  const zero = g.readGeocode({ status: "ZERO_RESULTS", results: [] });
  ok("ZERO_RESULTS is a real answer meaning no such place", zero.ok && zero.places.length === 0);

  for (const [status, reason] of [
    ["REQUEST_DENIED", "denied"],
    ["OVER_QUERY_LIMIT", "over_limit"],
    ["INVALID_REQUEST", "bad_request"],
    ["UNKNOWN_ERROR", "unavailable"],
  ] as const) {
    const out = g.readGeocode({ status });
    ok(`${status} is a failure, named ${reason}`, !out.ok && out.reason === reason);
  }

  ok("a body that is not an object is a failure", !g.readGeocode("nope").ok);
  ok("so is OK with no results array", !g.readGeocode({ status: "OK" }).ok);
}

console.log("\n=== the guard that keeps a billed call off the keystroke path ===");
/**
 * ⚠ A parent typing `91011` passes through `9`, `91`, `910` and `9101`. Without
 * this, one postcode is five lookups and four of them are for strings that
 * cannot mean a place — the invoice rather than a list of noise, which is why
 * the rule is repeated here rather than left to `searchPlaces`.
 */
{
  ok("a whole ZIP is worth asking about", g.worthGeocoding("91011"));
  for (const partial of ["9", "91", "910", "9101", "910115"]) {
    ok(`“${partial}” is not`, !g.worthGeocoding(partial));
  }
  ok("a name needs three characters", g.worthGeocoding("syl") && !g.worthGeocoding("sy"));
  ok("and blank never is", !g.worthGeocoding("   "));
}

console.log("\n=== the cache key folds three spellings into one paid lookup ===");
{
  const k = g.cacheKey("  La Cañada  ");
  ok("trimmed, folded, single-spaced", k === "la canada", k);
  ok("and the accent is the same key", g.cacheKey("la canada") === k);
  ok(
    "bounded to what the column CHECKs",
    g.cacheKey("x".repeat(200)).length === 60,
    String(g.cacheKey("x".repeat(200)).length),
  );
}

console.log("\n=== a hit stands for a month, a miss for a week ===");
/**
 * The asymmetry is the point: a town does not move, but `ZERO_RESULTS` is
 * sometimes a place Google learned about last week — and caching that for a
 * month would make Pando wrong for a month with nothing saying so.
 */
{
  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-09-15T00:00:00Z");
  const at = (d: number) => new Date(now.getTime() - d * day).toISOString();

  ok("a hit 20 days old is fresh", g.isFresh({ places: [{}], fetchedAt: at(20) }, now));
  ok("a hit 40 days old is not", !g.isFresh({ places: [{}], fetchedAt: at(40) }, now));
  ok("a miss 3 days old is fresh", g.isFresh({ places: [], fetchedAt: at(3) }, now));
  ok(
    "a miss 20 days old is NOT — the asymmetry",
    !g.isFresh({ places: [], fetchedAt: at(20) }, now),
  );
  ok("an unreadable date is never fresh", !g.isFresh({ places: [{}], fetchedAt: "nonsense" }, now));
}

console.log("\n=== the small parsers ===");
{
  ok("a ZIP+4 truncates", g.readZip("91011-4321") === "91011");
  ok("five digits pass", g.readZip("91011") === "91011");
  ok("four do not", g.readZip("9101") === null);
  ok("and neither does a house number", g.readZip("91011 Foothill") === null);
  ok("looksLikeZip is exactly five digits", g.looksLikeZip("91011") && !g.looksLikeZip("9101a"));
  ok("placeKey folds an ampersand the way the taxonomy does", g.placeKey("R & D") === "r-and-d");
  ok("and an apostrophe vanishes rather than becoming a dash", g.placeKey("O'Brien") === "obrien");
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
if (fail > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
