---
name: db-migration
description: >-
  How a schema change reaches Pando's one Postgres database (hosted Supabase, which is
  production): web/lib/db/schema.ts, a new file in web/drizzle/, the journal entry, and
  `npm run migrate`. Use when adding or altering a table, column, enum, index,
  constraint, view or function, writing a seed or backfill, or deciding when a migration
  runs relative to a deploy. Triggers: "add a column", "new table", "migration",
  "drizzle", "alter enum", "backfill", "npm run migrate". Not for queries that only read
  or write rows through lib/server/repo/* — that is application code.
---

# Database migrations

There is one database and it is production, so a migration is a production change. The
repo is the only source of truth for the schema; Supabase's dashboard is not.

## How we do it

1. Change `web/lib/db/schema.ts` first, then write the next file in `web/drizzle/`
   (`NNNN_what_changed.sql`, the number after the last one). Since `0004` they are
   written by hand — snapshots stop at `0003`, so `drizzle-kit generate` would diff
   against a stale baseline. Separate statements with `--> statement-breakpoint`.
2. Append its entry to `web/drizzle/meta/_journal.json`: next `idx`, `"version": "7"`,
   `"tag"` = the file name without `.sql`, `"breakpoints": true`, and a `"when"`
   **greater than every earlier entry**. The migrator applies only entries whose `when`
   is newer than the last applied row (`drizzle-orm/pg-core/dialect.js`), so a smaller
   one is skipped silently — on every environment.
3. Head the file with a comment that says why, the way `0052_reward_paid.sql` does.
4. Derived changes only: data computed from rows already in this database. Data
   imported from elsewhere goes in `seed*` or a script under `web/scripts/`.
5. Prefer additive. If the code that reads the change may ship before the migration
   runs, make the read tolerate its absence (DEPLOY.md §3b, the `0052` example).
6. A new enum value: `ALTER TYPE … ADD VALUE` cannot be used in the transaction that
   adds it, and every pending migration runs in **one** transaction — two pending files
   share it. So the value is applied by its own `npm run migrate` run first; a migration
   or code that uses it comes after that run.

## Rules

- A committed migration is never edited, renamed or deleted — fix forward. The
  `protect-files` hook blocks Edit/Write on it and the git pre-commit hook refuses a
  commit that changes it; drizzle would not re-run an edited file, so the
  environments would drift apart without an error.
- No schema edits in the Supabase dashboard and no `drizzle-kit push`.
- `npm run migrate` uses `MIGRATE_DATABASE_URL` when set, otherwise `DATABASE_URL`, read
  from `web/.env.local`, then `web/.env` — both point at production. Port 5432 (session
  mode) is the one for migrations; 6543 is the app's (DEPLOY.md §3b).

## Stop and ask a person when

- the migration drops, renames or narrows anything, or rewrites existing rows;
- you are about to run `npm run migrate`, or any SQL that writes, against the hosted
  project — say which variable and host the command will use and wait for a "yes";
- the change needs a backfill of more than the rows this feature created.

The production-write rule, including when a backup table is needed, is
[validation §2](../../../docs/reference/validation.md#2-proof-by-area) → Database.

## Verify

- [ ] `npm --prefix web run gate` passes.
- [ ] The journal's new `when` is the largest, and `tag` matches the file name.
- [ ] After the user's "yes" and `npm run migrate`: the "N migration(s) applied in total"
      line equals the journal's entry count, and a read-only query on
      `information_schema` / `pg_enum` shows the object itself. (`npm run check` counts
      rows; it cannot see a schema change.)
- [ ] docs/status.md and, for a choice a later session could undo, docs/decisions.md.
