/**
 * Put the client's §5 place list into `market_options.neighborhoods`.
 *
 *   npm run places:sync            # diff only, writes nothing
 *   npm run places:sync -- --commit
 *
 * Same shape as `options:import` and for the same reason: this rewrites the
 * reference data the required location question is built from, so it is a
 * deliberate act with a diff rather than something that happens on a deploy.
 *
 * ## What it will and will not touch
 *
 * Three kinds of row live in that category today and the script decides by
 * asking the data, not by a hardcoded list of 79:
 *
 * - **A place in `home-places.ts`** — upserted. Label and `area_slug` come
 *   from the module, which is the canonical list.
 * - **A district** — a row whose `area_slug` already points at *another* value
 *   that is a place. Bungalow Heaven → Pasadena, Altadena Foothills → Altadena.
 *   ⚠ **Left completely alone.** Ten of the twenty values live contributors are
 *   stored under are these, and the developer's call was that the district
 *   layer stays: her list is about cities.
 * - **Anything else** — outside the SGVCOG footprint. Retired, never deleted.
 *
 * ⚠ `SUBAREA_OF` is the one hardcoded judgement, and it exists because six rows
 * are districts wearing a district's name with a **self-referential**
 * `area_slug` — Alhambra Hills, Flintridge, Highland Park Hills, Rosemead
 * Heights, San Marino Heights, Verdugo Woodlands. By the rule above they would
 * read as out-of-footprint and be retired, which is wrong: each is part of a
 * place that *is* in her list, and each is somebody's honest answer to where
 * they live. So they are kept and their roll-up is corrected — which also fixes
 * a live matching fault, since an area of one matches nobody.
 *
 * ## Retiring, never deleting
 *
 * `active = false`, the 12 Aug rule: `market_options` is what a stored answer
 * resolves against, so a deleted row turns a parent's own neighborhood into an
 * unresolvable string. Retired means "not offered any more" and nothing else.
 * Measured before writing this: none of the rows it retires is in use.
 */

import { existsSync } from "node:fs";
import postgres from "postgres";

/* Dynamic, like the suites: a static `.ts` specifier needs
   `allowImportingTsExtensions`, and turning that on for one script would
   change how every import in the app resolves. */
const { PLACES, areaFor } = (await import(
  `../lib/home-places.ts?v=${Date.now()}`
)) as typeof import("../lib/home-places.ts");

for (const f of [".env.local", ".env"]) {
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(f);
    } catch {
      /* a malformed line is not worth failing the run over */
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.log("\n  DATABASE_URL is not set. Nothing to sync.\n");
  process.exit(0);
}

const COMMIT = process.argv.includes("--commit");
const MARKET = "pasadena";

/** The six districts whose `area_slug` points at themselves. See the header. */
const SUBAREA_OF: Record<string, string> = {
  "alhambra-hills": "alhambra",
  flintridge: "la-canada-flintridge",
  "highland-park-hills": "highland-park",
  "rosemead-heights": "rosemead",
  "san-marino-heights": "san-marino",
  "verdugo-woodlands": "glendale",
};

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require" });

type Row = {
  option_value: string;
  label: string;
  area_slug: string | null;
  active: boolean;
  starter: boolean;
};

const existing = (await sql`
  select option_value, label, area_slug, active, starter
    from market_options
   where market_id = ${MARKET} and category = 'neighborhoods'
   order by option_value
`) as unknown as Row[];

const byValue = new Map(existing.map((r) => [r.option_value, r]));
const placeIds = new Set(PLACES.map((p) => p.id));

const inserts: string[] = [];
const updates: Array<{ id: string; from: string; to: string }> = [];
const retires: string[] = [];
const districts: string[] = [];

/* 1. Every place in her list. */
for (const place of PLACES) {
  const area = areaFor(place)!;
  const row = byValue.get(place.id);
  if (!row) {
    inserts.push(`${place.id} (${place.name}, area=${area})`);
    continue;
  }
  const changes: string[] = [];
  if (row.label !== place.name) changes.push(`label "${row.label}" → "${place.name}"`);
  if (row.area_slug !== area) changes.push(`area ${row.area_slug ?? "null"} → ${area}`);
  if (!row.active) changes.push("active false → true");
  if (changes.length > 0) {
    updates.push({ id: place.id, from: row.label, to: changes.join(", ") });
  }
}

/* 2. Everything already in the table that is not a place. */
for (const row of existing) {
  if (placeIds.has(row.option_value)) continue;

  const corrected = SUBAREA_OF[row.option_value];
  if (corrected) {
    if (row.area_slug !== corrected) {
      updates.push({
        id: row.option_value,
        from: row.label,
        to: `area ${row.area_slug ?? "null"} → ${corrected} (sub-area, was its own island)`,
      });
    } else {
      districts.push(row.option_value);
    }
    continue;
  }

  /* A district: already rolls up to something that is a place. */
  if (row.area_slug && row.area_slug !== row.option_value && placeIds.has(row.area_slug)) {
    districts.push(row.option_value);
    continue;
  }

  if (row.active) retires.push(`${row.option_value} (${row.label})`);
}

/* Nothing may be retired out from under a parent who chose it. */
const inUse = (await sql`
  select neighborhood, count(*)::int as n
    from people
   where neighborhood is not null
   group by 1
`) as unknown as Array<{ neighborhood: string; n: number }>;
const used = new Map(inUse.map((r) => [r.neighborhood, r.n]));
const usedRetires = retires.filter((r) => used.has(r.split(" ")[0]));

console.log(`\n  market_options.neighborhoods — ${existing.length} rows today\n`);
console.log(`  ${inserts.length} to add:`);
for (const i of inserts) console.log(`     + ${i}`);
console.log(`\n  ${updates.length} to update:`);
for (const u of updates) console.log(`     ~ ${u.id}: ${u.to}`);
console.log(`\n  ${retires.length} to retire (active = false, never deleted):`);
for (const r of retires) console.log(`     - ${r}`);
console.log(`\n  ${districts.length} districts left untouched.`);

if (usedRetires.length > 0) {
  console.log(`\n  ⚠ REFUSING: these are somebody's stored answer:`);
  for (const r of usedRetires) console.log(`     ! ${r} — ${used.get(r.split(" ")[0])} parent(s)`);
  await sql.end();
  process.exit(1);
}
console.log(`  None of the retired values is any parent's stored answer.`);

if (!COMMIT) {
  console.log(`\n  Dry run. Re-run with --commit to write.\n`);
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  for (const place of PLACES) {
    const area = areaFor(place)!;
    await tx`
      insert into market_options (market_id, category, option_value, label, area_slug, active)
      values (${MARKET}, 'neighborhoods', ${place.id}, ${place.name}, ${area}, true)
      on conflict (market_id, category, option_value)
      do update set label = excluded.label, area_slug = excluded.area_slug, active = true
    `;
  }
  for (const [value, area] of Object.entries(SUBAREA_OF)) {
    await tx`
      update market_options set area_slug = ${area}
       where market_id = ${MARKET} and category = 'neighborhoods' and option_value = ${value}
    `;
  }
  for (const line of retires) {
    const value = line.split(" ")[0];
    await tx`
      update market_options set active = false
       where market_id = ${MARKET} and category = 'neighborhoods' and option_value = ${value}
    `;
  }
});

const after = (await sql`
  select count(*) filter (where active)::int as live,
         count(*)::int as total
    from market_options
   where market_id = ${MARKET} and category = 'neighborhoods'
`) as unknown as Array<{ live: number; total: number }>;
console.log(`\n  Written. ${after[0].live} offered, ${after[0].total} resolvable.\n`);

/* The runtime read is cached 60s in a different process — see the 12 Aug rule. */
console.log(`  The app's option cache clears within 60s.\n`);

await sql.end();
