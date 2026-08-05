# Supabase — how to stand this up

The schema for Pando Phase 1, built from the estimate rows, the spec, and the July
question set. The logic each workflow puts on top of it is in
[../docs/n8n-supabase-plan.md](../docs/n8n-supabase-plan.md) — read that alongside
this.

```
supabase/
  migrations/
    0001_schema.sql        25 tables, 7 enums, every CHECK
    0002_views.sql         the read paths + founding_checklist
    0003_write_ops.sql     decision-free writes + the facts n8n branches on
    0004_rls.sql           deny-by-default, plus self-asserting invariant checks
    0005_rpc.sql           admin_read and the HTTP/RPC surface
    0006_remaining_ops.sql 2C profiles, merging, retiring options, matching
  seed.sql                 affinity weights, freshness policy, placeholder tap lists
  tests/smoke.sql          one contributor end to end, 21 assertions, rolls back
  check.py                 static check over the SQL, for when there is no Postgres
```

## Verify it without a database

```bash
python supabase/check.py
```

Parses the DDL and walks every function and view, complaining when something refers to a
table, column, enum value or function that isn't defined. It is not a substitute for
running Postgres — it is what can be checked without one. Currently: 25 tables, 7 views,
48 functions, 7 enums, nothing unresolved.

## Verify it with one

After the migrations, paste `supabase/tests/smoke.sql` into the SQL editor. It walks one
contributor through profile → activity → caregiver nomination → completion → review →
Founding → her own 2C profile, asserts that all eight safety constraints actually fire,
checks that no phone number or restricted note leaks into an admin read, and **rolls
everything back**. It prints `ALL CHECKS PASSED` or stops with the rule that failed.

## Apply it

With the Supabase CLI, from the repo root:

```bash
supabase db reset
```

That runs the four migrations in order and then `seed.sql`. Against a hosted
project instead:

```bash
supabase link --project-ref <ref> && supabase db push
```

Or paste each file into the SQL editor **in filename order**. `0004` deliberately
fails the migration if an invariant was written wrongly, so a clean run is itself
the first test.

Nothing here has been executed against a live Postgres — there was no database or
container available in this environment. Expect to fix a typo or two on the first
run; the constraints are the part worth reviewing closely.

## Then connect n8n

1. **Postgres credential** in n8n: host, port 5432, database `postgres`, user
   `postgres`, the project's connection string. Use the **service-role** path — RLS
   denies everything else by design (see `0004_rls.sql`), and n8n is the only holder
   of that key. The Next.js app has no Supabase client at all.
2. **One node per write.**

   **The decisions belong on the canvas, not in these calls.** Each operation below
   takes values your workflow has already worked out — see
   [../docs/n8n-supabase-plan.md](../docs/n8n-supabase-plan.md) §3 for the node chains.

   | Step | Node body |
   | --- | --- |
   | save the profile | `select write_person($1::jsonb)` |
   | one "other" answer | `select write_pending_option($1,$2,$3,$4)` |
   | the raw card | `select write_submission($1::jsonb)` |
   | is this place known? | `select * from place_candidates($1,$2,$3)` |
   | a new place | `select write_place($1::jsonb)` |
   | one recommendation | `select write_place_contribution($1::jsonb)` |
   | is this caregiver known? | `select * from caregiver_candidates($1,$2,$3)` |
   | a new caregiver | `select write_caregiver($1::jsonb)` |
   | the nomination + its private notes | `select write_caregiver_nomination($1::jsonb)` |
   | a ladder step | `select set_caregiver_consent($1,$2,$3::jsonb,$4)` |
   | consent, allowance, demand, flags | `write_consent` · `set_allowance` · `write_demand_signal` · `write_flag` |
   | review outcomes | `set_contribution_status` · `set_nomination_status` · `set_place_status` |
   | Founding facts, then the outcome | `select * from founding_checklist where person_id = $1` → `set_founding` |
   | outreach facts | `select * from outreach_facts where person_id = $1` |

   `$1` is usually `{{ JSON.stringify($json.body) }}` or a value your Set node built.
   Compose the response yourself — `{ persisted: true, … }` — and pass it to `Respond
   to Webhook`; the route reports what the workflow says about itself and never
   upgrades it.

3. **Header Auth on both sides, in the same change as the first write.** The
   webhooks are open today and `N8N_WEBHOOK_TOKEN` is empty, which was harmless
   while nothing was stored. It stops being harmless now.

4. **Point the app at it** — `web/.env.local`:

   ```
   N8N_WEBHOOK_PROFILE=https://n8n-dxmd.srv1576782.hstgr.cloud/webhook/profile-affinity-derivation
   N8N_WEBHOOK_SAVE=…
   N8N_WEBHOOK_COMPLETE=…
   N8N_WEBHOOK_ADMIN_READ=…
   N8N_WEBHOOK_ADMIN_WRITE=…
   N8N_WEBHOOK_TOKEN=<the same secret as the Header Auth credential>
   ```

   An unset hook still answers `persisted: false`, so you can wire them one at a
   time and the UI stays honest about which half is live.

## Check it worked

```sql
-- 1. A profile round-trip. Use a real payload from the app's own logs, or this:
select write_person('{
  "phone": "+16265550143", "first_name": "Janet", "last_name": "Alvarez",
  "market_id": "pasadena", "neighborhood": "bungalow-heaven",
  "phone_verified_at": "2026-08-03T13:00:00Z", "profile_captured_at": "2026-08-03T13:00:00Z",
  "monthly_contact_allowance": 3, "allowance_mode": "fixed",
  "attribution": "anonymous_verified", "profile_completeness": 92,
  "children": [{"birth_year": 2019, "expecting": false, "due_year": null}],
  "social_affinities": [{"affinity_type":"school","affinity_value":"walden-school","score_weight":5}],
  "life_relevance": [{"dimension":"budget","value":"compare_value"}],
  "school_status": {"walden-school": "former"},
  "pending_options": [],
  "sms_consent": {"status":"opted_in","source":"seed_entry_phone_field",
                  "text_version":"seed-sms-2026-08-01","captured_at":"2026-08-03T13:00:00Z"}
}'::jsonb);

-- 2. The invariants actually bite.
insert into caregivers (market_id, first_name, is_adult, active, consent_status)
values ('pasadena', 'Rosa', true, true, 'mentioned');     -- must fail
insert into people (phone, first_name) values ('+15551234567', 'Nope');  -- must fail

-- 3. Nothing user-facing leaks an unconsented caregiver.
select count(*) from caregivers_answerable;               -- 0 until someone consents
```

## Two things this schema decides for you

**Founding is decided in n8n, recorded here.** `founding_checklist` is a view with
every criterion as a column — verified phone, neighborhood, a child, allowance at 3 or
more, and `qualifying_approved`, the count of approved firsthand contributions that
each carry child-age context, recency, a specific strength, fit context and an answered
caveat prompt. The IF that reads it lives on the canvas, so Janet can see the rule.
`set_founding` only records the outcome — and refuses to downgrade somebody, because
the client promised founding is permanent.

**A caregiver's visibility only ever increases, and only by her own action.** The
ladder is `mentioned → invited → consented → discoverable → introducible`. A parent's
nomination can reach `invited` (they sent the invite themselves) and no further;
`consented` needs `consent_evidence`, and `active` is impossible without it — that is
a CHECK, not a convention. `caregivers_answerable` is the only view an answer may
read.

## One gap to close early: the anonymous path has no key

`people.phone` is the identity, and `on conflict (phone)` is what makes every save
idempotent. An anonymous contributor has no phone, so nothing conflicts — and a
parent on that path who edits their profile and saves again creates a **second
person row**.

Three ways out, in the order I'd take them:

1. **Send a stable session id.** The browser already has one session object; adding
   `client_session_id` to the profile payload and a `unique` column here makes the
   anonymous path idempotent too. Two small changes, no product decision.
2. Accept the duplicates and let the admin merge them — cheap now, annoying at 350
   contributors.
3. Drop the anonymous path. Not recommended: it is the client's own labelled
   alternative to the founding route.

Until (1) lands, treat anonymous rows as append-only and de-duplicate in the admin.

## Not in here yet

- **2C, the caregiver's own flow** — `caregiver_profiles` and the ladder columns
  exist, but the G1–G10 write function does not, because the app side isn't built.
- **The matcher.** `affinity_weights` and `life_relevance` are the inputs, and
  weights are resolved at query time on purpose; the two-layer query itself belongs
  with the Phase 2 test harness rather than guessed at now.
- **Transcripts.** `seed_conversations` is there for the admin's data-quality view,
  but the app keeps the chat on the device. Sending it should be a deliberate
  decision, not a side effect of this table existing.
- **`market_options` for real.** Everything in `seed.sql` under that table is a
  placeholder generated from `web/lib/market-options.ts`, awaiting Janet's CSV.
