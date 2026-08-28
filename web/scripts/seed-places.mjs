/**
 * Seeds the canonical `previous_places` list — item 11's "Add a city, state or
 * country".
 *
 *   npm run seed:places
 *   npm run seed:places -- --commit
 *
 * ## The one rule this file exists to enforce
 *
 * **The id carries the geography, in its PREFIX.** `us-san-francisco-ca`,
 * `intl-london-uk`. `lib/derive.ts` reads it to decide whether a place means
 * "elsewhere in California", "another state" or "another country" — the client's
 * instruction ("Pando can derive… from the actual location. The parent shouldn't
 * have to provide both").
 *
 * **The first attempt read the suffix, and this script's own check refused it.**
 * Country codes collide with US state codes, comprehensively: DE is Germany and
 * Delaware, IN India and Indiana, IL Israel and Illinois, MA Morocco and
 * Massachusetts, AR Argentina and Arkansas, ID Indonesia and Idaho, CA Canada and
 * California. Twelve rows would have filed a Berlin family as domestic. A
 * two-letter suffix cannot carry this, and no amount of special-casing fixes an
 * ambiguity that is in the vocabulary itself — hence a prefix we own.
 *
 * It reads the suffix rather than looking the place up because `derive.ts` is
 * pure and runs on the server over sanitised answers, with no access to this
 * table — the 11 Aug decision that the matching graph is derived from the
 * answers and never taken from the request depends on it staying that way. The
 * cost is that ids must be produced in exactly this shape, so this script checks
 * every one before writing and refuses the batch if any is wrong.
 *
 * ## What this list is and is not
 *
 * It is a **starting set**, not a gazetteer: the largest US metros plus the
 * cities the San Gabriel Valley actually draws families from. Her own instruction
 * covers the tail — "Users can add a missing location" — and a typed place lands
 * in `pending_options` for an admin, exactly like a school. Nothing here is a
 * starter chip: `previous_places` is search-only, because there is no plausible
 * set of 8-12 familiar *previous* cities to show a parent.
 */

import { existsSync } from "node:fs";
import postgres from "postgres";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(f);
    } catch {
      /* a malformed line is not worth failing over */
    }
  }
}

const COMMIT = process.argv.includes("--commit");
const MARKET = "pasadena";

/** US cities as `City, ST`. The state code is what the derivation reads. */
const US = [
  // California — these derive to `elsewhere_in_california`
  ["Los Angeles", "CA"], ["San Francisco", "CA"], ["San Diego", "CA"],
  ["San Jose", "CA"], ["Oakland", "CA"], ["Berkeley", "CA"],
  ["Sacramento", "CA"], ["Long Beach", "CA"], ["Santa Monica", "CA"],
  ["Irvine", "CA"], ["Santa Barbara", "CA"], ["Fresno", "CA"],
  ["Palo Alto", "CA"], ["Ventura", "CA"], ["Bakersfield", "CA"],
  ["Riverside", "CA"], ["San Luis Obispo", "CA"], ["Davis", "CA"],
  ["Claremont", "CA"], ["Glendora", "CA"], ["Whittier", "CA"],
  ["Torrance", "CA"], ["Burbank", "CA"], ["Culver City", "CA"],

  // Everywhere else — `another_us_state`
  ["New York", "NY"], ["Brooklyn", "NY"], ["Chicago", "IL"],
  ["Houston", "TX"], ["Austin", "TX"], ["Dallas", "TX"],
  ["Phoenix", "AZ"], ["Tucson", "AZ"], ["Philadelphia", "PA"],
  ["Pittsburgh", "PA"], ["San Antonio", "TX"], ["Seattle", "WA"],
  ["Portland", "OR"], ["Denver", "CO"], ["Boulder", "CO"],
  ["Boston", "MA"], ["Cambridge", "MA"], ["Washington", "DC"],
  ["Atlanta", "GA"], ["Miami", "FL"], ["Orlando", "FL"],
  ["Tampa", "FL"], ["Nashville", "TN"], ["Charlotte", "NC"],
  ["Raleigh", "NC"], ["Minneapolis", "MN"], ["Detroit", "MI"],
  ["Ann Arbor", "MI"], ["Columbus", "OH"], ["Cleveland", "OH"],
  ["Cincinnati", "OH"], ["Indianapolis", "IN"], ["Milwaukee", "WI"],
  ["Madison", "WI"], ["St. Louis", "MO"], ["Kansas City", "MO"],
  ["New Orleans", "LA"], ["Baltimore", "MD"], ["Richmond", "VA"],
  ["Arlington", "VA"], ["Las Vegas", "NV"], ["Reno", "NV"],
  ["Salt Lake City", "UT"], ["Boise", "ID"], ["Albuquerque", "NM"],
  ["Honolulu", "HI"], ["Anchorage", "AK"], ["Newark", "NJ"],
  ["Jersey City", "NJ"], ["Hartford", "CT"], ["New Haven", "CT"],
  ["Providence", "RI"], ["Omaha", "NE"], ["Des Moines", "IA"],
  ["Oklahoma City", "OK"], ["Little Rock", "AR"], ["Memphis", "TN"],
  ["Birmingham", "AL"], ["Jackson", "MS"], ["Louisville", "KY"],
  ["Charleston", "SC"], ["Wilmington", "DE"], ["Manchester", "NH"],
  ["Portland", "ME"], ["Burlington", "VT"], ["Fargo", "ND"],
  ["Sioux Falls", "SD"], ["Billings", "MT"], ["Cheyenne", "WY"],
  ["Wichita", "KS"], ["Charleston", "WV"],
];

/**
 * World cities as `City, CC`. Any suffix that is not a US state code derives to
 * `another_country`, so the country code needs no separate flag.
 */
const WORLD = [
  ["London", "UK"], ["Manchester", "UK"], ["Edinburgh", "UK"],
  ["Dublin", "IE"], ["Paris", "FR"], ["Lyon", "FR"],
  ["Berlin", "DE"], ["Munich", "DE"], ["Amsterdam", "NL"],
  ["Madrid", "ES"], ["Barcelona", "ES"], ["Lisbon", "PT"],
  ["Rome", "IT"], ["Milan", "IT"], ["Zurich", "CH"],
  ["Vienna", "AT"], ["Stockholm", "SE"], ["Copenhagen", "DK"],
  ["Oslo", "NO"], ["Helsinki", "FI"], ["Warsaw", "PL"],
  ["Prague", "CZ"], ["Budapest", "HU"], ["Kyiv", "UA"],
  ["Lviv", "UA"], ["Istanbul", "TR"], ["Athens", "GR"],
  ["Toronto", "CA"], ["Vancouver", "CA"], ["Montreal", "CA"],
  ["Mexico City", "MX"], ["Guadalajara", "MX"], ["Monterrey", "MX"],
  ["São Paulo", "BR"], ["Rio de Janeiro", "BR"], ["Buenos Aires", "AR"],
  ["Santiago", "CL"], ["Lima", "PE"], ["Bogotá", "CO"],
  ["Tokyo", "JP"], ["Osaka", "JP"], ["Seoul", "KR"],
  ["Beijing", "CN"], ["Shanghai", "CN"], ["Hong Kong", "HK"],
  ["Taipei", "TW"], ["Singapore", "SG"], ["Bangkok", "TH"],
  ["Manila", "PH"], ["Jakarta", "ID"], ["Ho Chi Minh City", "VN"],
  ["Mumbai", "IN"], ["Delhi", "IN"], ["Bangalore", "IN"],
  ["Chennai", "IN"], ["Hyderabad", "IN"], ["Karachi", "PK"],
  ["Lahore", "PK"], ["Dhaka", "BD"], ["Colombo", "LK"],
  ["Dubai", "AE"], ["Abu Dhabi", "AE"], ["Doha", "QA"],
  ["Riyadh", "SA"], ["Tel Aviv", "IL"], ["Jerusalem", "IL"],
  ["Cairo", "EG"], ["Lagos", "NG"], ["Nairobi", "KE"],
  ["Johannesburg", "ZA"], ["Cape Town", "ZA"], ["Accra", "GH"],
  ["Casablanca", "MA"], ["Sydney", "AU"], ["Melbourne", "AU"],
  ["Brisbane", "AU"], ["Perth", "AU"], ["Auckland", "NZ"],
  ["Wellington", "NZ"], ["Moscow", "RU"], ["Tbilisi", "GE"],
  ["Yerevan", "AM"], ["Almaty", "KZ"], ["Bucharest", "RO"],
  ["Sofia", "BG"], ["Belgrade", "RS"], ["Zagreb", "HR"],
];

/* Canada's `CA` and Colombia's `CO` sit here untouched, which is the point of the
   prefix: `intl-toronto-ca` is unambiguous where `toronto-ca` was not. */

const slug = (value) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const US_STATES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "dc", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo",
  "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa",
  "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
]);

const rows = [];
const problems = [];
const seen = new Set();

for (const [source, list] of [["us", US], ["world", WORLD]]) {
  for (const [city, code] of list) {
    /* The prefix is the geography. Everything after it is for humans. */
    const id = `${source === "us" ? "us" : "intl"}-${slug(city)}-${slug(code)}`;
    const label = `${city}, ${code}`;

    if (seen.has(id)) {
      /* Two "Portland"s and two "Charleston"s are real, and their state codes
         keep them apart. A genuine collision would mean two records the
         derivation could not tell apart, so it is refused rather than merged. */
      problems.push(`duplicate id "${id}" (${label})`);
      continue;
    }
    seen.add(id);

    /**
     * The check the whole file exists for.
     *
     * `derive.ts` reads the prefix, then — for a US place only — the state code
     * after the last hyphen, to separate California from the rest. So a US row
     * whose suffix is not a real state code would be filed as "another state"
     * when it might be Californian, and any row missing its prefix would be
     * unclassifiable. Both are refused rather than written.
     */
    const suffix = id.slice(id.lastIndexOf("-") + 1);
    if (source === "us" && !US_STATES.has(suffix)) {
      problems.push(`US row "${label}" ends in "${suffix}", which is not a state code`);
      continue;
    }
    if (!id.startsWith("us-") && !id.startsWith("intl-")) {
      problems.push(`"${label}" has no geography prefix — it cannot be classified`);
      continue;
    }

    rows.push({
      option_value: id,
      label,
      area: code,
      entity_type: source === "us" ? "US city" : "City",
      derives_to:
        source !== "us"
          ? "another_country"
          : suffix === "ca"
            ? "elsewhere_in_california"
            : "another_us_state",
    });
  }
}

const byDerivation = rows.reduce((acc, r) => {
  acc[r.derives_to] = (acc[r.derives_to] ?? 0) + 1;
  return acc;
}, {});

console.log(`${rows.length} place(s) ready:`);
for (const [k, v] of Object.entries(byDerivation)) console.log(`  ${k.padEnd(26)} ${v}`);

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} id(s) would be misfiled — refusing the batch:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("\nDATABASE_URL is not set.");
  process.exit(1);
}

if (!COMMIT) {
  console.log("\nDry run. Re-run with --commit to write.");
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        insert into market_options
          (market_id, category, option_value, label, area, entity_type, starter, status, active)
        values
          (${MARKET}, 'previous_places', ${r.option_value}, ${r.label}, ${r.area},
           ${r.entity_type}, false, 'active', true)
        on conflict (market_id, category, option_value) do update set
          label = excluded.label,
          area = excluded.area,
          entity_type = excluded.entity_type,
          active = true`;
    }
  });
  const [{ n }] = await sql`
    select count(*)::int as n from market_options
     where market_id = ${MARKET} and category = 'previous_places' and active`;
  console.log(`\n✓ written. ${n} place(s) searchable.`);
  console.log("None is a starter — this question is search-only, by design.");
} catch (err) {
  console.error("\n✗ failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
