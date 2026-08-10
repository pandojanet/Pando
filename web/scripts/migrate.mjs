/**
 * Applies web/drizzle/*.sql to the database in `DATABASE_URL`.
 *
 *   npm run migrate
 *
 * Why this exists: the migrations were written but there was no way to run them,
 * so "how the schema reaches Supabase" was an undocumented manual step. Drizzle
 * already tracks what has been applied in `drizzle/meta/_journal.json` and in a
 * `drizzle.__drizzle_migrations` table it creates itself, so this is safe to run
 * repeatedly — already-applied migrations are skipped, not re-run.
 *
 * Reads .env.local (then .env) the way `next dev` does, because on Windows the
 * `DATABASE_URL=… npm run migrate` form doesn't work in PowerShell.
 */

import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(file);
  }
}

/**
 * `MIGRATE_DATABASE_URL` is an escape hatch, not a second config: the app runs
 * against the transaction-mode pooler, and that is not the connection you want
 * for DDL (see below). Set it when the two differ; otherwise DATABASE_URL is used.
 */
const source = process.env.MIGRATE_DATABASE_URL
  ? "MIGRATE_DATABASE_URL"
  : "DATABASE_URL";
const url = process.env[source];

if (!url || url.trim() === "") {
  console.error(
    "DATABASE_URL is not set.\n\n" +
      "Put the Supabase **pooler** connection string in web/.env.local — the direct\n" +
      "host is IPv6-only without the paid add-on. See web/.env.example for the shape.",
  );
  process.exit(1);
}

/**
 * Port 6543 is the pooler's transaction mode — right for the app, wrong-ish here:
 * it multiplexes one server connection across clients, which is a poor fit for a
 * migration's DDL. Port 5432 on the same pooler host is session mode and is the
 * connection to use for this. We warn rather than refuse because it usually does
 * work; if it fails, the port is the first thing to change.
 */
if (/:6543(\/|\?|$)/.test(url)) {
  console.warn(
    `! ${source} points at port 6543 (transaction mode).\n` +
      "  Migrations prefer session mode — use port 5432 on the same pooler host.\n" +
      (source === "DATABASE_URL"
        ? "  Either change the port here, or set MIGRATE_DATABASE_URL to the 5432 form\n" +
          "  so the app keeps using 6543. Trying anyway.\n"
        : "  Change the port in MIGRATE_DATABASE_URL. Trying anyway.\n"),
  );
}

const client = postgres(url, {
  // One connection, no prepares: a migration is a single serial job, and the
  // pooler cannot keep prepared statements across it.
  max: 1,
  prepare: false,
  // Never let the driver print a statement — these carry no data yet, but the
  // same rule applies everywhere the app talks to Postgres (invariant 7).
  onnotice: () => {},
});

try {
  console.log("applying migrations from ./drizzle …");
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });

  const [{ count }] = await client`
    select count(*)::int as count from drizzle.__drizzle_migrations
  `;
  console.log(`✓ up to date — ${count} migration(s) applied in total`);
} catch (err) {
  console.error(
    "\n✗ migration failed:",
    err instanceof Error ? err.message : String(err),
  );
  console.error(
    "\nCommon causes:\n" +
      "  · wrong password in the connection string (Supabase shows it once — reset it)\n" +
      "  · using the direct host instead of the pooler (IPv6-only; a VPS can't reach it)\n" +
      "  · port 6543 instead of 5432 for this command (see the warning above)",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
