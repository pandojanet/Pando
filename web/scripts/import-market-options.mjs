/**
 * Imports Janet's Pasadena taxonomy into `market_options`.
 *
 *   npm run options:import -- ../path/to/pasadena.csv
 *   npm run options:import -- ../path/to/pasadena.csv --retire-missing
 *
 * QC Answers Q10 settles the format: "Janet supplies, as a Google Sheet (QC can
 * import to CSV) with columns: market_id, category, option_value, active." Two
 * optional columns are accepted on top of those, because our table has them and a
 * chip with no label reads as a slug: `label` (defaults to a title-cased
 * option_value) and `bands` (a `|`-separated list of age bands).
 *
 * Why a script rather than an admin upload: this replaces the *reference data the
 * whole questionnaire is built from*, so it is a deliberate act with a diff and a
 * dry run, not a button. It prints what it would change and asks for the file
 * again with `--commit` before writing anything.
 *
 * What it will not do:
 *  - invent a category. Only the eight the spec names (§15.3) are accepted, so a
 *    typo in a sheet cannot create `nieghborhoods` and quietly empty a screen.
 *  - delete anything. `--retire-missing` sets `active = false` on rows the sheet no
 *    longer lists; a parent may already have selected one, and `market_options` is
 *    what their stored value resolves against.
 */

import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(file);
  }
}

/** Spec §15.3 plus `camps`, which v3.2 added and QC Answers Q10 does not list. */
const CATEGORIES = new Set([
  "neighborhoods",
  "schools",
  "worship",
  "clubs",
  "parent_groups",
  "baby_activities",
  "camps",
  "focus",
]);

const BANDS = new Set(["baby", "toddler", "preschool", "grade", "tween", "teen"]);

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
const retireMissing = args.includes("--retire-missing");

if (!file) {
  console.error(
    "Usage: npm run options:import -- <file.csv> [--commit] [--retire-missing]",
  );
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`${file} does not exist.`);
  process.exit(1);
}

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url || url.trim() === "") {
  console.error("DATABASE_URL is not set. See web/.env.example.");
  process.exit(1);
}

/**
 * A CSV parser rather than `split(",")`, because a sheet of school names contains
 * "St. Mark's Episcopal, Altadena" sooner or later, and splitting on the comma
 * inside it shifts every column after it — which would import a school as a
 * neighborhood without erroring.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const titleCase = (slug) =>
  slug
    .split(/[-_]/)
    .map((w) => (w === "" ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

const rows = parseCsv(readFileSync(file, "utf8"));
if (rows.length < 2) {
  console.error("That file has a header and no rows.");
  process.exit(1);
}

const header = rows[0].map((h) => h.trim().toLowerCase());
const need = ["market_id", "category", "option_value"];
const missing = need.filter((c) => !header.includes(c));
if (missing.length > 0) {
  console.error(`Missing column(s): ${missing.join(", ")}`);
  console.error(`Found: ${header.join(", ")}`);
  process.exit(1);
}

const col = (r, name) => {
  const i = header.indexOf(name);
  return i === -1 ? "" : (r[i] ?? "").trim();
};

const parsed = [];
const problems = [];

rows.slice(1).forEach((r, index) => {
  const line = index + 2;
  const marketId = col(r, "market_id").toLowerCase();
  const category = col(r, "category").toLowerCase();
  const optionValue = col(r, "option_value").toLowerCase();
  const activeRaw = col(r, "active").toLowerCase();
  const label = col(r, "label") || titleCase(optionValue);
  const bandsRaw = col(r, "bands");

  if (!marketId) problems.push(`line ${line}: no market_id`);
  if (!CATEGORIES.has(category)) {
    problems.push(`line ${line}: unknown category "${category}"`);
  }
  /* Matching keys on this string, so it is chosen deliberately rather than
     derived twice — the same rule the admin's option.promote follows. */
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(optionValue) && !/^[a-z0-9_]+$/.test(optionValue)) {
    problems.push(
      `line ${line}: option_value "${optionValue}" must be lowercase, hyphen- or underscore-separated`,
    );
  }

  const bands = bandsRaw
    ? bandsRaw
        .split("|")
        .map((b) => b.trim().toLowerCase())
        .filter((b) => b !== "")
    : null;
  for (const band of bands ?? []) {
    if (!BANDS.has(band)) problems.push(`line ${line}: unknown age band "${band}"`);
  }

  parsed.push({
    marketId,
    category,
    optionValue,
    label,
    bands,
    /* Absent means active. A sheet that has never had the column should import. */
    active: activeRaw === "" ? true : !["false", "0", "no", "n"].includes(activeRaw),
  });
});

if (problems.length > 0) {
  console.error(`✗ ${problems.length} problem(s) — nothing was imported:\n`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const markets = [...new Set(parsed.map((p) => p.marketId))];

try {
  const existing = await client`
    select market_id, category, option_value, label, active
    from market_options
    where market_id = any(${markets})
  `;
  const key = (r) => `${r.market_id ?? r.marketId}/${r.category}/${r.option_value ?? r.optionValue}`;
  const before = new Map(existing.map((r) => [key(r), r]));

  const added = parsed.filter((p) => !before.has(key(p)));
  const changed = parsed.filter((p) => {
    const was = before.has(key(p)) ? before.get(key(p)) : null;
    return was !== null && (was.label !== p.label || was.active !== p.active);
  });
  const incoming = new Set(parsed.map(key));
  const absent = existing.filter((r) => r.active && !incoming.has(key(r)));

  console.log(`${file} → ${parsed.length} rows across ${markets.join(", ")}`);
  console.log(`  new:        ${added.length}`);
  console.log(`  changed:    ${changed.length}`);
  console.log(
    `  not in file: ${absent.length}${retireMissing ? " (will be retired)" : " (left as they are)"}`,
  );
  for (const r of added.slice(0, 10)) {
    console.log(`    + ${r.category}/${r.optionValue}`);
  }
  if (added.length > 10) console.log(`    … and ${added.length - 10} more`);

  if (!commit) {
    console.log("\nDry run. Re-run with --commit to write it.");
    process.exit(0);
  }

  await client.begin(async (tx) => {
    for (const p of parsed) {
      await tx`
        insert into market_options (market_id, category, option_value, label, bands, active)
        values (${p.marketId}, ${p.category}, ${p.optionValue}, ${p.label},
                ${p.bands}, ${p.active})
        on conflict (market_id, category, option_value) do update set
          label = excluded.label,
          bands = excluded.bands,
          active = excluded.active
      `;
    }

    if (retireMissing) {
      for (const r of absent) {
        await tx`
          update market_options set active = false
          where market_id = ${r.market_id}
            and category = ${r.category}
            and option_value = ${r.option_value}
        `;
      }
    }
  });

  const [count] = await client`
    select count(*)::int as n from market_options
    where active and market_id = any(${markets})
  `;
  console.log(`\n✓ imported. ${count.n} active options in ${markets.join(", ")}.`);
} catch (err) {
  console.error(
    "\n✗ import failed (rolled back):",
    err instanceof Error ? err.message : String(err),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
