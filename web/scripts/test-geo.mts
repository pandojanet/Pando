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


/**
 * ## 16 Sep — the Places half
 *
 * The developer asked for Google across every directory, and a geocoder cannot
 * answer that: "Field Elementary" handed to the Geocoding API is a street or
 * nothing. `readPlaceSearch` reads the other API, and what is pinned here is
 * mostly what it **refuses** — the category it will not infer, the person it
 * will not offer, the failure it will not report as an empty answer.
 */
console.log("\n=== the places search: what it reads, and what it refuses ===");
{
  const comp = (long: string, short: string, ...types: string[]) => ({
    longText: long,
    shortText: short,
    types,
  });
  const CA_NEW = comp("California", "CA", "administrative_area_level_1", "political");
  const place = (name: string, address: string, components: unknown[] = []) => ({
    displayName: { text: name, languageCode: "en" },
    formattedAddress: address,
    addressComponents: components,
  });
  /* The market's own detector is not importable here (this suite loads one pure
     module in plain node), so the refusal is exercised through the argument the
     reader takes — which is the point of it being an argument. */
  const isPerson = (name: string) => /^(ms|mr|mrs|dr|coach)\.?\s/i.test(name);
  const read = (body: unknown, opts: Record<string, unknown> = {}) =>
    g.readPlaceSearch(body, { isPerson, marketState: "CA", ...opts });

  const one = read({
    places: [
      place("Field Elementary School", "3600 Sierra Madre Blvd, Pasadena, CA 91107, USA", [
        comp("Pasadena", "Pasadena", "locality", "political"),
        CA_NEW,
        comp("91107", "91107", "postal_code"),
      ]),
    ],
  });
  ok("a school comes back", one.ok && one.places.length === 1);
  if (one.ok && one.places[0]) {
    const p = one.places[0];
    /* The refusal this whole feature rests on. Google says `primary_school`;
       Pando's taxonomy distinguishes a preschool from a daycare from an
       elementary, so the category comes from the question the parent was
       answering and never from the response. */
    ok("and it is never typed from Google's vocabulary", p.type === null);
    ok("the town is read from the components", p.city === "Pasadena");
    ok("and the ZIP with it", p.zip === "91107");
    ok(
      "Google's own address line is what tells two of a name apart",
      p.where === "3600 Sierra Madre Blvd, Pasadena, CA 91107, USA",
    );
    ok("in-market is decided by the state, not by the bounds", p.inMarket === true);
    ok("what gets stored is the name, never the key", p.storedValue === "Field Elementary School");
  }

  /* 11.4, at the one door that had none of it: a Places search for a child's
     teacher would otherwise offer a named individual as a school to add. */
  const person = read({
    places: [
      place("Ms. Diane", "123 Foothill Blvd, Altadena, CA, USA"),
      place("Altadena Stables", "3064 Ridgeview Dr, Altadena, CA, USA"),
    ],
  });
  ok("a name that reads as a person is dropped", person.ok && person.places.length === 1);
  ok(
    "and the business beside it is kept",
    person.ok && person.places[0]?.name === "Altadena Stables",
  );

  const out = read({
    places: [
      place("The Little Gym", "1 Main St, Portland, OR 97201, USA", [
        comp("Portland", "Portland", "locality", "political"),
        comp("Oregon", "OR", "administrative_area_level_1", "political"),
      ]),
    ],
  });
  ok("an out-of-market row is kept, not filtered", out.ok && out.places.length === 1);
  ok(
    "and it stores the town with it, so an admin can promote it",
    out.ok && out.places[0]?.storedValue === "The Little Gym, Portland",
  );

  const dupes = read({
    places: [place("Kidspace", "480 N Arroyo Blvd, Pasadena, CA"), place("KIDSPACE", "elsewhere")],
  });
  ok("one name is one row", dupes.ok && dupes.places.length === 1);

  ok("a row with no name is dropped rather than repaired", (() => {
    const r = read({ places: [{ formattedAddress: "somewhere" }, place("Real", "here")] });
    return r.ok && r.places.length === 1 && r.places[0]?.name === "Real";
  })());

  ok("the list is capped", (() => {
    const many = Array.from({ length: 12 }, (_, i) => place(`Place ${i}`, `${i} Street`));
    const r = read({ places: many });
    return r.ok && r.places.length === g.PLACE_SEARCH_LIMIT;
  })());

  /**
   * ⚠ The two APIs disagree here and it is worth pinning: Geocoding says
   * `ZERO_RESULTS` out loud, Places (New) simply omits the array. A missing key
   * is an empty **answer** — worth caching — and a failure is not.
   */
  ok("no places key is an empty answer, not a fault", (() => {
    const r = read({});
    return r.ok && r.places.length === 0;
  })());

  for (const [status, reason] of [
    ["PERMISSION_DENIED", "denied"],
    ["UNAUTHENTICATED", "denied"],
    ["RESOURCE_EXHAUSTED", "over_limit"],
    ["INVALID_ARGUMENT", "bad_request"],
    ["SOMETHING_NEW", "unavailable"],
  ] as const) {
    const r = read({ error: { status, code: 400, message: "(trimmed)" } });
    ok(`${status} reads as ${reason}`, !r.ok && r.reason === reason);
  }

  ok("a body that is not an object is a failure, never an empty list", (() => {
    const r = read("nope");
    return !r.ok && r.reason === "unavailable";
  })());
}

console.log("\n=== what is worth paying for ===");
{
  ok("three letters is a name worth searching", g.worthPlaceSearch("gym"));
  ok("two is not", !g.worthPlaceSearch("gy"));
  /* Where this differs from `worthGeocoding`, and the difference is the whole
     reason there are two: a whole ZIP is the most precise question a parent can
     ask the geocoder and the least useful one to ask Places. */
  ok("a whole postcode is worth geocoding", g.worthGeocoding("91001"));
  ok("and is never worth a places search", !g.worthPlaceSearch("91001"));
  ok("nor is a partial one, either way", !g.worthGeocoding("910") && !g.worthPlaceSearch("910"));
}

console.log("\n=== which directory asks Google what ===");
{
  ok("where a parent lives is geocoded in this market", g.lookupKindFor("neighborhoods") === "place");
  /* ⚠ The one lookup that must not prefer the market: with a country filter a
     parent who moved from London is offered London, Ontario. */
  ok("where they lived before is geocoded worldwide", g.lookupKindFor("previous_places") === "world");
  for (const c of ["schools", "baby_activities", "clubs", "worship", "camps"]) {
    ok(`${c} is a named-establishment search`, g.lookupKindFor(c) === "establishment");
  }
  /**
   * ⚠ Null is a decision rather than a gap: a WhatsApp group for the mums at a
   * preschool is not a place on a map, and asking Google about one buys a
   * coffee shop with a similar name.
   */
  ok("a parent group asks Google nothing", g.lookupKindFor("parent_groups") === null);
  ok("and neither does a category nobody has heard of", g.lookupKindFor("nonsense") === null);
}

/**
 * ## 16 Sep — the worldwide lookup, which shipped dropping every answer
 *
 * `previous_places` asks Google with no country filter, and `readGeocode` still
 * dropped every non-US row — so "london" reached Google, came back, and left as
 * an empty list, which downstream is indistinguishable from *no such place*.
 * Found by curling the live endpoint after the deploy rather than by reading
 * either half, because each half is correct on its own.
 *
 * Pinned in both directions: the default still refuses (the neighborhood
 * question's footprint is one American county with a five-digit postcode under
 * it), and `worldwide` keeps.
 */
console.log("\n=== where a parent lived before: anywhere, not just the US ===");
{
  const gb = (long: string, short: string, ...types: string[]) => ({
    long_name: long,
    short_name: short,
    types,
  });
  const london = {
    address_components: [
      gb("London", "London", "locality", "political"),
      gb("Greater London", "Greater London", "administrative_area_level_2", "political"),
      gb("England", "England", "administrative_area_level_1", "political"),
      gb("United Kingdom", "GB", "country", "political"),
    ],
    formatted_address: "London, UK",
    types: ["locality", "political"],
  };
  const body = { status: "OK", results: [london] };

  const refused = g.readGeocode(body, { marketState: "CA" });
  ok(
    "the default still keeps this reader inside the US",
    refused.ok && refused.places.length === 0,
    "the question it was written for is where you live, and the ZIP under it is American",
  );

  const kept = g.readGeocode(body, { worldwide: true });
  ok("worldwide keeps it", kept.ok && kept.places.length === 1);
  if (kept.ok && kept.places[0]) {
    const p = kept.places[0];
    ok("and it is the place, not the country", p.name === "London");
    /**
     * ⚠ The **country**, never the region. An admin reading "London, England"
     * in the pending queue has to know that England is an
     * `administrative_area_level_1`; "London, United Kingdom" is a row they can
     * promote without looking anything up.
     */
    ok(
      "what gets stored names the country",
      p.storedValue === "London, United Kingdom",
      p.storedValue,
    );
    ok("a place abroad is never in market", p.inMarket === false);
    /* The line a parent reads to tell two results apart. Abroad that is the
       country: live, Lagos came back under "LA" and Kyiv under
       "Kyiv city 02000", neither of which says which country it is. */
    ok("and the line under it names the country", p.where === "United Kingdom", p.where);
    /* The 15 Sep refusal still holds: Google cannot say what kind of place this
       is in Pando's vocabulary, and a foreign locality is no exception. */
    ok("and it is still not typed", p.type === null);
  }

  /* A US row keeps its state, on either setting — this is a widening. */
  const portland = {
    address_components: [
      gb("Portland", "Portland", "locality", "political"),
      gb("Oregon", "OR", "administrative_area_level_1", "political"),
      gb("United States", "US", "country", "political"),
    ],
    formatted_address: "Portland, OR, USA",
    types: ["locality", "political"],
  };
  const us = g.readGeocode({ status: "OK", results: [portland] }, { worldwide: true });
  ok(
    "an American place out of market still carries its state",
    us.ok && us.places[0]?.storedValue === "Portland, OR",
    us.ok ? us.places[0]?.storedValue : "not ok",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
if (fail > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
