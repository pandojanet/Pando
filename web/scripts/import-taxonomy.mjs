/**
 * Imports Janet's Seed Master Data List into `market_options`.
 *
 *   npm run taxonomy:import -- "path/to/Seed Master Data List - .xlsx"
 *   npm run taxonomy:import -- "…xlsx" --commit
 *   npm run taxonomy:import -- "…xlsx" --commit --retire-missing
 *
 * ## Why this is a second importer rather than a change to the first
 *
 * `import-market-options.mjs` implements QC Answers Q10: four columns
 * (market_id, category, option_value, active) from a CSV, rendered as a chip
 * list. The 24 Aug master list is a different artefact — ~390 schools plus
 * activities, clubs and faith communities, each carrying aliases, a city, an
 * entity type, an operational status and a curated starter flag, with the
 * instruction "tap first, search second" on all four sheets. That is a
 * directory, not a chip list, and it needs the columns drizzle/0014 added.
 *
 * The old importer stays: it is the format the client can still hand over from a
 * plain sheet, and it is what `--retire-missing` semantics were written against.
 * This one reads the workbook directly, so there is no CSV-export step in which
 * an em dash or a comma inside a club name can go wrong.
 *
 * ## What it will not do
 *
 *  - **Invent a category.** Only the four this workbook covers are written, and
 *    they map onto the §15.3 names the questionnaire already reads.
 *  - **Delete anything.** `--retire-missing` sets `active = false`; a parent may
 *    already have selected a row, and their stored answer resolves against it.
 *  - **Touch a hand-added row.** `user_added = true` rows are left alone even
 *    when the sheet no longer lists them — her data-maintenance note on every
 *    sheet asks for exactly that, because the next refresh comes from the CDE
 *    directory and would otherwise drop them.
 *  - **Write without a diff.** It prints what would change and needs `--commit`.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import postgres from "postgres";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(f);
    } catch {
      /* a malformed line is not worth failing the import over */
    }
  }
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const COMMIT = args.includes("--commit");
const RETIRE = args.includes("--retire-missing");
const MARKET = "pasadena";

if (!file) {
  console.error("usage: npm run taxonomy:import -- <file.xlsx> [--commit] [--retire-missing]");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`no such file: ${file}`);
  process.exit(1);
}

/* ── reading the workbook ──────────────────────────────────────────────────── */

const zipEntry = (entry) => {
  try {
    return execFileSync("unzip", ["-p", file, entry], { maxBuffer: 1 << 28 }).toString("utf8");
  } catch {
    return "";
  }
};

const unesc = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, " / ")
    .replace(/&amp;/g, "&");

const shared = [];
for (const m of zipEntry("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
}

const relMap = {};
for (const m of zipEntry("xl/_rels/workbook.xml.rels").matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  relMap[m[1]] = m[2].replace(/^\/?xl\//, "");
}
const sheets = new Map();
for (const m of zipEntry("xl/workbook.xml").matchAll(/<sheet\s[^>]*?>/g)) {
  const name = m[0].match(/name="([^"]+)"/);
  const rid = m[0].match(/r:id="([^"]+)"/);
  if (name && rid) sheets.set(unesc(name[1]), "xl/" + (relMap[rid[1]] || ""));
}

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * One sheet as an array of objects keyed by its header row.
 *
 * Empty cells are serialised self-closing (`<c r="E2" s="10"/>`), and a pattern
 * that requires `</c>` skips them — which shifts every later column of that row
 * one place left. That put a Notes string into the aliases column while looking
 * entirely plausible, so both forms are matched.
 */
function rows(sheetName) {
  const path = sheets.get(sheetName);
  if (!path) return [];
  const xml = zipEntry(path);
  const out = [];
  let header = null;
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+\d+)"([^>/]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[2] ?? "";
      const body = c[3] ?? "";
      let v = "";
      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      if (/t="s"/.test(attrs) && vm) v = shared[Number(vm[1])] ?? "";
      else if (/t="(inlineStr|str)"/.test(attrs))
        v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("");
      else if (vm) v = vm[1];
      cells[colIndex(c[1])] = unesc(v).replace(/[\t\r\n]+/g, " ").trim();
    }
    if (!cells.some((x) => x)) continue;
    if (!header) {
      header = cells.map((h) => (h || "").toLowerCase());
      continue;
    }
    const obj = {};
    header.forEach((h, i) => {
      if (h) obj[h] = cells[i] ?? "";
    });
    out.push(obj);
  }
  return out;
}

/* ── shaping ───────────────────────────────────────────────────────────────── */

/**
 * The stored key. Matching joins on this, so it is created here, deliberately,
 * and never re-derived elsewhere — the same rule the "other"-promotion path
 * follows (CLAUDE.md, 12 Aug).
 *
 * Diacritics are folded (`La Cañada` → `la-canada`) because the parent typing in
 * search will not reach for `ñ`, and the label keeps the correct spelling.
 */
const slug = (value) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const aliasList = (raw) =>
  (raw || "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");

/** Her four operational states, mapped from whatever the sheet says. */
function statusOf(raw) {
  const s = (raw || "").toLowerCase();
  if (!s) return "active";
  if (s.includes("closed")) return "closed";
  if (s.includes("paused") || s.includes("rebuild")) return "paused";
  if (s.includes("verification") || s.includes("unverified")) return "unverified";
  if (s.includes("active")) return "active";
  return "unverified";
}

/**
 * The rows in her sheets that are controls rather than places.
 *
 * The starter sheets list the screen's furniture alongside the suggestions —
 * "Search all institutions", "None", "Prefer not to say", "Can't find it? Add
 * it", "Homeschool", "Not doing any yet". They belong in the question definition
 * next to the other exclusive options, and they are matched here so the
 * unmatched-starter report only shows what it is for: a suggestion she curated
 * that has no record behind it.
 */
const CONTROL_ROW =
  /^(search-all|none$|prefer-not-to-say|cant-find-it|homeschool|not-in-school|not-doing-any)/;

const isoDate = (raw) => (/^\d{4}-\d{2}-\d{2}$/.test((raw || "").trim()) ? raw.trim() : null);

/**
 * The four sheets, and which questionnaire category each feeds.
 *
 * `starterSheet` is a separate list of names per area — she curated the 8–12
 * tap-first suggestions by hand rather than deriving them, so they are matched
 * back by name and set as a flag rather than imported as their own rows.
 */
const SOURCES = [
  {
    category: "schools",
    sheet: "Searchable Master List",
    starterSheet: "Starter Suggestions",
    starterNameKey: "suggested institution",
    map: (r) => ({
      label: r["institution"],
      area: r["area"],
      entityType: r["type"],
      section: r["sector"] || null,
      aliases: aliasList(r["common aliases"]),
      status: "active",
      sourceUrl: r["source url"] || null,
      lastVerifiedAt: null,
    }),
  },
  {
    category: "baby_activities",
    sheet: "Activities Seed List",
    starterSheet: "Activities Starter",
    starterNameKey: "suggested activity / provider",
    map: (r) => ({
      label: r["canonical name"],
      area: r["area"],
      entityType: r["entity type"],
      section: null,
      aliases: aliasList(r["common aliases"]),
      status: statusOf(r["active status"]),
      sourceUrl: r["source url"] || null,
      lastVerifiedAt: isoDate(r["last verified"]),
      /**
       * **Deliberately not stored.** The sheet's "Typical ages" is a human range
       * — "6 weeks–10 years", "Walking–teen", "Preschool–teen" — and the first
       * version of this importer put it straight into `bands`.
       *
       * That broke the activities screen completely. `bands` is the questionnaire's
       * *eligibility filter*: `optionsForBands` keeps an option only if one of its
       * bands matches the parent's children, and the valid values are `baby`,
       * `toddler`, `preschool`, `grade`, `tween`, `teen`. "Preschool–teen" matches
       * none of them, so **every** activity was hidden from **every** parent who
       * had answered the child-age question — which is all of them, since it is
       * required.
       *
       * Parsing the range into real bands is not the fix either. Her instruction
       * is "Rank by child age, distance and familiarity" and, for area, "never use
       * home area as an eligibility filter" — age deserves the same treatment, and
       * a mis-parsed range would *hide* a provider from a family who could use it.
       * Ranking by age needs structured min/max columns and belongs with the
       * matching work; the human string stays in her sheet until then.
       */
    }),
  },
  {
    category: "clubs",
    sheet: "Member Orgs Seed List",
    starterSheet: "Member Orgs Starter",
    starterNameKey: "suggested organization",
    map: (r) => ({
      label: r["canonical name"],
      area: r["area"],
      entityType: r["type"],
      /* Her two visible groups inside one question. */
      section: r["section"] || null,
      aliases: aliasList(r["common aliases"]),
      status: statusOf(r["active status"]),
      sourceUrl: r["source url"] || null,
      lastVerifiedAt: isoDate(r["last verified"]),
    }),
  },
  {
    category: "worship",
    sheet: "Faith Communities Seed List",
    starterSheet: "Faith Communities Starter",
    starterNameKey: "suggested faith community",
    map: (r) => ({
      label: r["canonical name"],
      area: r["area"],
      entityType: r["entity type"],
      /* The tradition, which is metadata and never the displayed identity — she
         is explicit that the stored thing is the named community, not
         "Christian" or "Jewish". */
      section: r["tradition / affiliation"] || null,
      aliases: aliasList(r["common aliases"]),
      status: statusOf(r["active status"]),
      sourceUrl: r["source url"] || null,
      lastVerifiedAt: isoDate(r["last verified"]),
      /* This sheet carries its own starter column as well as a starter sheet. */
      starterEligible: /^y/i.test(r["starter eligible"] || ""),
    }),
  },
];

const wanted = [];
const problems = [];
/** Two records with one name — the UI must show the area for these. */
const sameName = [];

for (const src of SOURCES) {
  const raw = rows(src.sheet);
  if (raw.length === 0) {
    problems.push(`sheet "${src.sheet}" is empty or missing`);
    continue;
  }

  /* Which names she curated as starters, by area, normalised so a stray space or
     a curly apostrophe does not silently drop one. */
  const starters = new Set(
    rows(src.starterSheet)
      .map((r) => r[src.starterNameKey])
      .filter(Boolean)
      .map((n) => slug(n)),
  );

  const seen = new Set();
  /* Which starter names we actually found in the seed list. A name she curated
     that matches nothing is a typo on one side or the other, and it silently
     costs a tap-first suggestion — so it gets reported rather than swallowed. */
  const matchedStarters = new Set();
  for (const r of raw) {
    const shaped = src.map(r);
    if (!shaped.label) continue;

    /* Her own marker for the rows that are UI options rather than places:
       "Homeschool", "Not in school/daycare yet", "Can't find it? Add it". They
       repeat once per area in the schools sheet, which is why they showed up as
       duplicate keys. They belong in the question definition — where "None" and
       "Prefer not to say" already live — not in a directory of institutions,
       because nothing about them is searchable, rankable or verifiable. */
    if (/special option/i.test(shaped.entityType || "")) continue;

    /**
     * Two rows can share a canonical name — a Willard Elementary in two
     * districts, a National Charity League chapter listed for two areas. Her
     * rule is explicit: do not merge different campuses or chapters just because
     * they share a name or a parent organisation. So the second one takes the
     * area into its key, which is also what she asks the UI to do ("show
     * city/area where needed to distinguish similarly named congregations").
     *
     * Dropping the collision instead would silently lose a school, and keeping
     * one of the two arbitrarily is worse than either.
     */
    let optionValue = slug(shaped.label);
    if (!optionValue) {
      problems.push(`${src.category}: "${shaped.label}" produces an empty key`);
      continue;
    }
    if (seen.has(optionValue)) {
      const areaSlug = slug(shaped.area || "");
      const disambiguated = areaSlug ? `${optionValue}-${areaSlug}` : "";
      if (disambiguated && !seen.has(disambiguated)) {
        optionValue = disambiguated;
        /* Not a problem, but worth printing: the label a parent sees is still
           the bare name, so two identical chips would be indistinguishable on
           screen. The UI has to show the area for these. */
        sameName.push(`${src.category}: "${shaped.label}" also exists elsewhere — kept as ${optionValue}`);
      } else {
        problems.push(
          `${src.category}: cannot tell two "${shaped.label}" apart (same area "${shaped.area}")`,
        );
        continue;
      }
    }
    seen.add(optionValue);
    matchedStarters.add(slug(shaped.label));

    const starter =
      (shaped.starterEligible ?? true) &&
      starters.has(optionValue) &&
      shaped.status === "active";

    wanted.push({
      market_id: MARKET,
      category: src.category,
      option_value: optionValue,
      label: shaped.label,
      aliases: shaped.aliases,
      area: shaped.area || null,
      /* The same value as a slug, so it can be compared to the neighborhood id a
         parent tapped. Written here rather than derived at query time because
         `area` is a display name ("La Cañada Flintridge") and the answer is an
         option id ("la-canada-flintridge") — comparing the two with lower()
         matched single-word names only, and nine of seventeen areas silently
         never ranked (drizzle 0017). */
      area_slug: shaped.area ? slug(shaped.area) : null,
      entity_type: shaped.entityType || null,
      section: shaped.section,
      starter,
      status: shaped.status,
      source_url: shaped.sourceUrl,
      last_verified_at: shaped.lastVerifiedAt,
      bands: shaped.bands ?? null,
    });
  }

  const matched = wanted.filter((w) => w.category === src.category && w.starter).length;
  console.log(
    `  ${src.sheet.padEnd(30)} ${String(raw.length).padStart(4)} rows -> ` +
      `${String(seen.size).padStart(4)} options, ${matched} starters ` +
      `(sheet listed ${starters.size})`,
  );
  for (const s of starters) {
    if (CONTROL_ROW.test(s)) continue;
    if (!matchedStarters.has(s)) {
      problems.push(`${src.category}: starter "${s}" is not in the seed list — no suggestion for it`);
    }
  }
}

if (sameName.length > 0) {
  console.log(`
${sameName.length} name(s) used by more than one record:`);
  for (const n of sameName) console.log(`  · ${n}`);
}

if (problems.length > 0) {
  console.log(`\n${problems.length} thing(s) to look at:`);
  for (const p of problems.slice(0, 25)) console.log(`  - ${p}`);
  if (problems.length > 25) console.log(`  … and ${problems.length - 25} more`);
}

if (wanted.length === 0) {
  console.error("\nnothing to import — check the sheet names");
  process.exit(1);
}

/* ── the diff ──────────────────────────────────────────────────────────────── */

if (!process.env.DATABASE_URL) {
  console.error("\nDATABASE_URL is not set, so there is nothing to compare against.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

try {
  const categories = [...new Set(wanted.map((w) => w.category))];
  const existing = await sql`
    select option_value, category, label, aliases, area, area_slug, entity_type, section,
           starter, status, source_url, last_verified_at::text as last_verified_at,
           bands, active, user_added
      from market_options
     where market_id = ${MARKET}
       and category in ${sql(categories)}`;

  const byKey = new Map(existing.map((r) => [`${r.category}/${r.option_value}`, r]));

  const inserts = [];
  const updates = [];
  for (const w of wanted) {
    const cur = byKey.get(`${w.category}/${w.option_value}`);
    if (!cur) {
      inserts.push(w);
      continue;
    }
    const changed = [];
    for (const k of ["label", "area", "entity_type", "section", "status", "source_url", "last_verified_at"]) {
      if (!same(cur[k], w[k])) changed.push(k);
    }
    if (!same(cur.aliases ?? [], w.aliases)) changed.push("aliases");
    if (cur.starter !== w.starter) changed.push("starter");
    if (!cur.active) changed.push("active");
    if (changed.length > 0) updates.push({ ...w, changed });
  }

  const wantedKeys = new Set(wanted.map((w) => `${w.category}/${w.option_value}`));
  /* Never a hand-added row: the next refresh comes from an external directory and
     must not quietly undo an admin's work. */
  const retire = existing.filter(
    (r) => r.active && !r.user_added && !wantedKeys.has(`${r.category}/${r.option_value}`),
  );

  console.log(
    `\n${inserts.length} to add · ${updates.length} to change · ` +
      `${retire.length} in the table but not in the sheet` +
      (RETIRE ? " (will be retired)" : " (left alone — pass --retire-missing)"),
  );

  for (const u of updates.slice(0, 15)) {
    console.log(`  ~ ${u.category}/${u.option_value}: ${u.changed.join(", ")}`);
  }
  if (updates.length > 15) console.log(`  … and ${updates.length - 15} more`);
  for (const r of retire.slice(0, 10)) console.log(`  - ${r.category}/${r.option_value}`);
  if (retire.length > 10) console.log(`  … and ${retire.length - 10} more`);

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write.");
    await sql.end();
    process.exit(0);
  }

  /* One transaction: a half-imported taxonomy is a questionnaire with holes in
     it, and the whole point of the table being authoritative is that a parent
     never sees one. */
  await sql.begin(async (tx) => {
    for (const w of wanted) {
      await tx`
        insert into market_options
          (market_id, category, option_value, label, aliases, area, area_slug,
           entity_type, section, starter, status, source_url, last_verified_at,
           bands, active)
        values
          (${w.market_id}, ${w.category}, ${w.option_value}, ${w.label},
           ${w.aliases}, ${w.area}, ${w.area_slug}, ${w.entity_type},
           ${w.section}, ${w.starter}, ${w.status}, ${w.source_url},
           ${w.last_verified_at}, ${w.bands}, true)
        on conflict (market_id, category, option_value) do update set
          label = excluded.label,
          aliases = excluded.aliases,
          area = excluded.area,
          area_slug = excluded.area_slug,
          entity_type = excluded.entity_type,
          section = excluded.section,
          starter = excluded.starter,
          status = excluded.status,
          source_url = excluded.source_url,
          last_verified_at = excluded.last_verified_at,
          bands = coalesce(excluded.bands, market_options.bands),
          active = true`;
    }

    if (RETIRE && retire.length > 0) {
      for (const r of retire) {
        await tx`
          update market_options set active = false
           where market_id = ${MARKET}
             and category = ${r.category}
             and option_value = ${r.option_value}
             and not user_added`;
      }
    }
  });

  console.log(`\n✓ written. ${wanted.length} option(s) in ${categories.length} categories.`);
  console.log(
    "The questionnaire reads this table through a 60s cache " +
      "(lib/server/market-cache.ts), so the next parent sees it within a minute.",
  );
} catch (err) {
  console.error("\n✗ import failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
