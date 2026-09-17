/**
 * Give every stored profile a `people.profile_depth`, computed from the answers
 * that parent actually tapped.
 *
 *   npm run depth:backfill              # diff only, writes nothing
 *   npm run depth:backfill -- --commit
 *
 * ## Why it has to exist at all
 *
 * `drizzle/0045` adds the column with `DEFAULT 0`, which is the honest value for
 * a row nobody has measured — and since 16 Sep this number decides whether a
 * parent reaches the Founding queue and is paid. So on the day that migration
 * lands **every existing contributor reads 0% and qualifies for nothing**, which
 * is a wrong answer about money rather than a missing feature. The column is
 * filled from now on by the profile write; this is the one run that catches up.
 *
 * ## Why a script rather than a default or a trigger
 *
 * The number is `profileDepth(answers)` — the questionnaire measured as if the
 * optional fork had been opened — and that rule lives in TypeScript, in
 * `lib/questions.ts`, where the screens and their gates are. Restating it in SQL
 * would be the same rule in two languages, which is the fault this repository
 * has already paid for more than once: the SQL copy would look right and would
 * quietly disagree the first time a question moved behind a gate.
 *
 * Run with `tsx` rather than `node --experimental-strip-types`, because
 * `questions.ts` has runtime imports and plain node cannot load it.
 *
 * ## What it will not do
 *
 * **It never lowers a value that is already there.** `where profile_depth = 0`
 * in the update as well as in the select, so a profile the parent has re-saved
 * since the migration keeps the number the route derived — and a second run of
 * this script is a no-op rather than a recomputation against an older build.
 * ⚠ The consequence, stated rather than discovered: a profile that genuinely
 * measures 0% is indistinguishable from one nobody has measured, so it is
 * written every time. That is harmless — 0 is what it would write anyway.
 *
 * **It skips a row with no `raw_answers`.** The demo cohort has none (it is
 * inserted directly, not walked), and a cold inbound (5.9) has no profile at
 * all. Inventing a depth for either would put a number in the record that no
 * parent produced. `seed:demo` sets the demo cohort's own.
 *
 * ⚠ **It prints counts and percentages, never a name or an answer** —
 * invariant 7. A row is identified by the first eight characters of its id.
 */

import { existsSync } from "node:fs";
import postgres from "postgres";

/* Dynamic, like the suites and `places:sync`: a static `.ts` specifier needs
   `allowImportingTsExtensions`, and turning that on for one script would change
   how every import in the app resolves. */
const { profileDepth } = (await import(
  `../lib/questions.ts?v=${Date.now()}`
)) as typeof import("../lib/questions.ts");
const { normaliseAnswers } = (await import(
  `../lib/storage.ts?v=${Date.now()}`
)) as typeof import("../lib/storage.ts");

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
  console.log("\n  DATABASE_URL is not set. Nothing to back-fill against.\n");
  process.exit(0);
}

const COMMIT = process.argv.includes("--commit");

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});

type Row = { id: string; raw_answers: unknown; profile_depth: number };

const rows: Row[] = await sql<Row[]>`
  select id, raw_answers, profile_depth
    from people
   where profile_depth = 0
   order by profile_captured_at nulls last, id
`;

console.log(
  `\n${rows.length} profile(s) at 0%${COMMIT ? "" : " — dry run, nothing will be written"}.\n`,
);

let written = 0;
let skipped = 0;
const buckets = new Map<string, number>();

for (const row of rows) {
  if (row.raw_answers === null || typeof row.raw_answers !== "object") {
    skipped += 1;
    continue;
  }

  /* The same reader the flow uses on load: it keeps a stored value only while
     its shape still matches, so an answer written by an older build cannot
     inflate the count with something no question would accept today. */
  const depth = profileDepth(normaliseAnswers(row.raw_answers));

  /* Bands of twenty, with 100 its own — it is the only value anybody reads as
     a state rather than a range, and folding it into 80–99 would hide how many
     profiles are actually complete. */
  const floor = Math.min(Math.floor(depth.percent / 20) * 20, 80);
  const band = depth.percent === 100 ? "100%" : `${floor}–${floor + 19}%`;
  buckets.set(band, (buckets.get(band) ?? 0) + 1);

  console.log(
    `  ${row.id.slice(0, 8)}  ${String(depth.percent).padStart(3)}%  ` +
      `(${depth.answered} of ${depth.total} questions)`,
  );

  if (COMMIT) {
    /* `profile_depth = 0` in the update too, not only in the select: a parent
       who re-saved their profile while this was running must keep the number
       the route derived. */
    await sql`update people
                 set profile_depth = ${depth.percent}
               where id = ${row.id} and profile_depth = 0`;
  }
  written += 1;
}

console.log(
  `\n${written} measured, ${skipped} skipped for having no stored answers.`,
);
for (const band of [...buckets.keys()].sort()) {
  console.log(`  ${band.padEnd(8)} ${buckets.get(band)}`);
}

/* The number that actually matters on the day this runs, so it is printed
   rather than left to be worked out from the bands above. */
const { FOUNDING_MIN_PROFILE_DEPTH } = (await import(
  `../lib/rewards.ts?v=${Date.now()}`
)) as typeof import("../lib/rewards.ts");
const over = [...buckets.entries()].length
  ? rows.filter(
      (r) =>
        r.raw_answers !== null &&
        typeof r.raw_answers === "object" &&
        profileDepth(normaliseAnswers(r.raw_answers)).percent >=
          FOUNDING_MIN_PROFILE_DEPTH,
    ).length
  : 0;
console.log(
  `\n${over} of ${written} clear the ${FOUNDING_MIN_PROFILE_DEPTH}% Founding bar.`,
);

if (!COMMIT && written > 0) console.log("\nRe-run with --commit to write.\n");
else console.log("");

await sql.end();
