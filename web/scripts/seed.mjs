/**
 * Loads ../supabase/seed.sql — the reference data the tap lists read.
 *
 *   npm run seed
 *
 * The walkthrough used to say `psql "$DATABASE_URL" -f supabase/seed.sql`, which
 * assumes psql is installed. It usually isn't on a Windows dev machine, and the
 * app already ships a Postgres driver, so this runs the same file through that.
 *
 * Run it once, after `npm run migrate`. The file is not fully idempotent — most
 * inserts carry `on conflict`, but not all — so it runs inside a transaction and
 * rolls back as a whole if anything conflicts, rather than leaving half the
 * reference data in place.
 */

import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(file);
  }
}

const source = process.env.MIGRATE_DATABASE_URL
  ? "MIGRATE_DATABASE_URL"
  : "DATABASE_URL";
const url = process.env[source];

if (!url || url.trim() === "") {
  console.error(
    "DATABASE_URL is not set. See web/.env.example, then run `npm run migrate` first.",
  );
  process.exit(1);
}

const FILE = "../supabase/seed.sql";
if (!existsSync(FILE)) {
  console.error(`${FILE} is missing — run this from web/.`);
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  const sql = readFileSync(FILE, "utf8");
  console.log(`loading ${FILE} …`);

  /* One transaction, simple protocol: the file is many statements, and either all
     of the reference data lands or none of it does. */
  await client.begin((tx) => [tx.unsafe(sql).simple()]);

  const [weights] = await client`select count(*)::int as n from affinity_weights`;
  const [options] = await client`select count(*)::int as n from market_options`;
  console.log(
    `✓ seeded — ${weights.n} affinity weights, ${options.n} market options`,
  );
  console.log(
    "\nNote: the market_options taxonomy is a PLACEHOLDER until Janet's Pasadena\n" +
      "lists arrive. Replacing it is a data import, not a code change.",
  );
} catch (err) {
  console.error(
    "\n✗ seed failed (rolled back):",
    err instanceof Error ? err.message : String(err),
  );
  console.error(
    "\nIf this says a row already exists, the reference data is already loaded —\n" +
      "seed.sql is meant to run once.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
