# Importable workflows

Eight ready workflows — all of M1 and M2 that runs in n8n. Import them, set one
credential, activate. The logic is on the canvas: every decision is an IF, a Switch or
a Code node with a comment saying why it is there.

| File | Trigger | Node count |
| --- | --- | --- |
| `pando-1.3-profile.json` | webhook `profile-affinity-derivation` | 9 |
| `pando-1.5-card-save.json` | webhook `seed-card-save` | 39 |
| `pando-1.7-complete.json` | webhook `seed-complete` | 18 |
| `pando-founding-check.json` | webhook `founding-check` | 8 |
| `pando-1.8-extraction.json` | cron, every 5 min | 12 |
| `pando-1.9-flags.json` | cron, every 15 min | 6 |
| `pando-2.x-admin-read.json` | webhook `admin-read` | 16 |
| `pando-2.x-admin-write.json` | webhook `admin-write` | 41 |

## What to do

**1. Apply the database first.** Nothing here works without it.

```bash
supabase db reset
```

**2. Create one Postgres credential in n8n**, named exactly **`Pando Supabase`**
(host, port 5432, database `postgres`, user `postgres`, the project's password, SSL
on). The workflows reference it by name; if you name it differently, n8n will ask you
to pick a credential the first time you open each Postgres node.

**3. Import each file** — *Workflows → ⋯ → Import from File*. The credential id in
the JSON is the placeholder `REPLACE_WITH_CREDENTIAL_ID`; n8n resolves by name on
import, so the nodes should light up green. If one shows a red credential warning,
open it and pick `Pando Supabase` once — the rest of the nodes in that workflow
follow.

**4. Copy the production webhook URLs** into `web/.env.local`:

```
N8N_WEBHOOK_PROFILE=https://n8n-dxmd.srv1576782.hstgr.cloud/webhook/profile-affinity-derivation
N8N_WEBHOOK_SAVE=https://n8n-dxmd.srv1576782.hstgr.cloud/webhook/seed-card-save
N8N_WEBHOOK_COMPLETE=https://n8n-dxmd.srv1576782.hstgr.cloud/webhook/seed-complete
N8N_WEBHOOK_ADMIN_READ=https://n8n-dxmd.srv1576782.hstgr.cloud/webhook/admin-read
N8N_WEBHOOK_ADMIN_WRITE=https://n8n-dxmd.srv1576782.hstgr.cloud/webhook/admin-write
```

The moment `ADMIN_READ` is set, the admin stops offering sample rows and shows the
pilot. That is the single most useful switch to flip.

While testing, use the `/webhook-test/…` URL instead — that one accepts a single call
per *Execute workflow* click, which is what you want for the first run of each.

**5. Activate** each workflow. An inactive workflow's production URL returns 404, and
the app will report a clean 502 rather than pretending anything was saved.

**6. Add Header Auth.** Create a *Header Auth* credential (name it `Pando app token`,
header `X-Pando-Token`, any long random value), set it on each Webhook node's
*Authentication*, and put the same value in `N8N_WEBHOOK_TOKEN`. **Do this in the same
sitting as step 4** — it was harmless while nothing was stored, and it stops being
harmless the moment `write_person` runs.

## Try it end to end

With the app running (`npm --prefix web run dev`) open
`http://localhost:3000/join?i=sgv-founding&test=1`, walk the flow, and watch the
executions list. `?test=1` marks everything `is_test`, so your walkthroughs stay out
of the pilot's numbers.

Then check what landed:

```sql
select first_name, phone_verified_at, founding, topic_preferences from people;
select kind, status, firsthand, caveat_answered from place_contributions;
select first_name, consent_status, active from caregivers;      -- active must be false
select reason, severity, status from flags;
```

## The decisions you can now see and change

- **1.5 · "Exact match?" → "Similar one already there?"** — an exact name in the same
  market attaches to the existing place; anything else creates a new one, and a
  *near* match also raises `possible_duplicate_place`. Merging is a human's call.
- **1.5 · "18+ and firsthand?"** — the two gates from C1 and the no-minors rule. Both
  are also CHECK constraints, so if you loosen this IF the database still refuses.
- **1.5 · "Decide the hold"** — the whole hold rule in one Code node: anything other
  than a clear "yes" to *would you hire them again*, or any restricted note, holds the
  card. Editing this node is how the rule changes.
- **1.5 · "Parent sent the invite?"** — deliberately requires `held === false`. A held
  nomination is never offered the invite step; offering it would undo the hold.
- **1.7 · "Did they ask something?" → "Health, legal or safety?"** — D1's routing. The
  app already showed the parent professional resources; this raises the escalation so
  a person follows up.
- **founding-check · "Qualifies?"** — the client's rule as five conditions over
  `founding_checklist`. Add `caregiver_approved >= 1` for the
  exceptional-nomination override.

## Honest limits

- **Not run against a live n8n.** There was no instance or database available here, so
  these are structurally validated, not executed: unique node names and ids, no
  dangling connections, no unreachable nodes, both branches of every IF wired, every
  expression prefixed with `=`, every Postgres node carrying a credential and a `$1`.
  Expect to nudge a node or two on first run.
- **Node typeVersions target n8n 1.x** (webhook 2, postgres 2.5, if 2.2, code 2,
  respondToWebhook 1.1). On an older instance n8n offers to downgrade on import.
- **`founding-check` is not called automatically.** Add an HTTP Request node to the
  `contribution.approve` branch of `admin_write` pointing at its webhook — that is the
  moment somebody's second approved contribution should promote them. It is left
  unwired so you decide whether approval promotes immediately or on a nightly pass.
- **1.8 has a placeholder where the model goes.** The node named *AI node goes here*
  is a NoOp: drop in your AI node, have it return `output` as JSON, and the validator
  after it keeps only the fields on the allow-list. Everything around it — the poll,
  the prompt, the allow-list, the low-confidence flag — is built.
- **An unimplemented admin action answers 501**, not success. `caregiver.merge`,
  `option.retire` and `founding.approve` for more than one id at a time have no branch
  yet, and they will say so rather than pretend.
- **Not generated:** 2C (the caregiver's own flow — the app side isn't built), the
  freshness-ping and demand-matching crons, and `sms-inbound`. Their node chains are
  written out in [../../docs/n8n-supabase-plan.md](../../docs/n8n-supabase-plan.md) §3.

---

# If the Postgres node can't reach Supabase

Almost certainly not your fault: Supabase's direct database host
(`db.<ref>.supabase.co`) is **IPv6-only** unless the project has the IPv4 add-on, and
most VPSes are IPv4-only. The Postgres node has nothing to dial.

Two ways out. Try the first — it's two minutes — and use the second if it doesn't work
or you'd rather not depend on the pooler.

## Option A · the pooler (keeps the Postgres nodes)

Supabase's Supavisor pooler *is* reachable over IPv4. In the dashboard →
**Connect → Connection pooling**, take the *Session* mode values:

```
Host      aws-0-<region>.pooler.supabase.com
Port      5432          (6543 for transaction mode — use 5432, we run functions)
Database  postgres
User      postgres.<project-ref>      ← the ref matters, this is not just "postgres"
SSL       on
```

Nothing else changes: import `n8n/workflows/*.json` as they are.

## Option B · HTTP only, no database connection at all

`n8n/workflows/http/*.json` — the same eight workflows, node for node, with every
database call replaced by an HTTP Request to Supabase's REST endpoint. This works
anywhere n8n can make an HTTPS request.

It leans on something the schema already had: every write operation takes a single
`payload jsonb` argument, which is exactly PostgREST's RPC convention.

```
POST https://<ref>.supabase.co/rest/v1/rpc/write_person
apikey: <service-role key>
{ "payload": { … } }
```

**Setting it up**

1. Apply `supabase/migrations/0005_rpc.sql` as well as the first four. It adds
   `admin_read` (the eleven admin projections in one function) and the four reads the
   cron workflows needed, so nothing is left needing raw SQL.
2. n8n → **Settings → Variables**: `SUPABASE_URL = https://<ref>.supabase.co`. The
   nodes read `{{ $vars.SUPABASE_URL }}`, so the project ref lives in one place.
3. n8n → **Credentials → Header Auth**, named exactly **`Pando Supabase RPC`**:
   header `apikey`, value = the **service-role** key. RLS denies everything else by
   design, and this key bypasses it — treat it like a root password.
   *If your project's gateway also insists on `Authorization`, add a second header
   `Authorization: Bearer <same key>` to the credential.*
4. Import `n8n/workflows/http/*.json`. Their webhook paths end in `-http`
   (`seed-card-save-http`, …) so both transports can coexist while you pick one — put
   those URLs in `web/.env.local`.

**The one behavioural difference**, handled for you: a Postgres node returned a row, so
`select write_person(…) as person_id` arrived as `{ person_id: … }`. PostgREST returns
the function's value on its own. The converter rewrites the downstream expressions
accordingly, which is why the two folders are not textually identical.

**Regenerating.** The HTTP set is generated, not hand-maintained:

```bash
python n8n/to-http.py
```

Edit the Postgres versions, re-run that, and both stay in step. It fails loudly if a
node uses raw SQL with no RPC equivalent, rather than emitting something that silently
does nothing.

**What this costs.** PostgREST is one HTTPS round trip per call instead of one
connection for the workflow, so `admin_write` does a little more network work. At pilot
volume that is invisible. What it buys is that n8n needs no database credentials, no
connection pooling, and no IPv6.
