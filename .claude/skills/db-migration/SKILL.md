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
   adds it, and every pending migration runs in **one** transaction. Ship the value in
   one migration and anything that writes it in a later one.

## Rules

- A committed migration is never edited, renamed or deleted — fix forward. The
  `protect-files` hook blocks it; drizzle would not re-run an edited file, so the
  environments would drift apart without an error.
- No schema edits in the Supabase dashboard and no `drizzle-kit push`.
- `npm run migrate` reads `web/.env.local`, then `web/.env`, which point at production.

## Stop and ask a person when

- the migration drops, renames or narrows anything, or rewrites existing rows;
- you are about to run `npm run migrate`, or any SQL that writes, against the hosted
  project — say which host the command resolved to and wait for a "yes";
- the change needs a backfill of more than the rows this feature created.

Before a destructive step the user approved: copy the affected table first
(`create table backup_<date>_<table> as table <table>`).

## Verify

- [ ] `npm --prefix web run gate` passes.
- [ ] The journal's new `when` is the largest, and `tag` matches the file name.
- [ ] After the user's "yes" and `npm run migrate`: it reports the expected total, and
      `npm --prefix web run check` (read-only) shows the change.
- [ ] docs/status.md and, for a choice a later session could undo, docs/decisions.md.
