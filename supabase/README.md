# Supabase

Supabase is the database and nothing else. The schema, the migrations and every
line of business logic live in the app — see `web/lib/db/schema.ts`,
`web/drizzle/` and `web/lib/server/repo/*`.

This directory holds the one thing that is neither schema nor logic: the seed
data for the tap lists.

```
seed.sql    affinity weights, freshness policy, and the placeholder Pasadena tap lists
```

## Setting up a project

1. Create the project. Note the region: it decides the pooler hostname.

2. Take the **pooler** connection string, not the direct one. Project settings →
   Database → Connection string → *Transaction* mode:

   ```
   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

   The direct host (`db.<ref>.supabase.co`) is IPv6-only unless you pay for the
   IPv4 add-on, and the VPS is IPv4. This is the same constraint that shaped the
   old n8n transport, and it has not gone away.

3. Put it in `DATABASE_URL` — `web/.env.local` locally, `/docker/pando/.env` on
   the server.

4. Apply the migrations, from `web/`:

   ```bash
   npm run migrate
   ```

   This wraps `drizzle-kit`'s migrator: it reads `web/.env.local` itself (so the
   command works unchanged in PowerShell, where `VAR=… cmd` is not a thing), and
   warns if the URL is the 6543 transaction-mode form — migrations want session
   mode on port 5432. Re-running is safe; applied migrations are skipped.

   Three files run, in order:

   | Migration | What it does |
   | --- | --- |
   | `0000_baseline` | `pg_trgm`, 7 enums, 25 tables, 23 indexes, 32 CHECKs |
   | `0001_triggers_and_views` | the `updated_at` triggers and the 5 read views |
   | `0002_rls` | deny-by-default RLS, and 8 invariant assertions |

   `0002` is worth watching go by: it deliberately tries to insert a minor, an
   unverified named parent, a caregiver visible without consent, a secondhand
   nomination and four other things the product forbids. If any of them succeeds,
   the migration fails. That is currently the only automated test in this repo.

5. Seed the tap lists — from `web/`:

   ```bash
   npm run seed
   ```

   Runs this directory's `seed.sql` through the app's own Postgres driver, so no
   `psql` install is needed. One transaction: the reference data all lands or none
   of it does. Meant to run **once** — `seed.sql` is not fully idempotent.

## Why RLS still matters

The app connects as a role that bypasses RLS, so none of it protects our own
queries. It protects the *other* door: a Supabase project always exposes
PostgREST publicly with an `anon` key, and a table without RLS is readable by
anyone holding that key. `0002_rls.sql` enables RLS with no policies on all 25
tables — Postgres for "deny" — and additionally revokes `restricted_notes` and
`audit_log`, the two tables where a leak is a product-level bug (invariants 12
and 13).

## Changing the schema

Edit `web/lib/db/schema.ts`, then from `web/`:

```bash
npx drizzle-kit generate --name=what_changed
```

Read the generated SQL before applying it. Two things drizzle-kit cannot express
and will omit without saying so if the baseline is ever regenerated from scratch:
`CREATE EXTENSION` and triggers. Both are flagged in the migration files
themselves.
