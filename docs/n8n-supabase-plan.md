# n8n + Supabase — every scenario, and the logic in each

Companion to [n8n-build-plan.md](n8n-build-plan.md), which described the workflows
while there was no database. This one assumes **Supabase**, and it is the reference to
build from: the schema first, then one section per workflow with its trigger, its SQL,
its response contract and the things that must *not* be in it.

Written 3 Aug 2026, against the app as it stands after the client's July question set.

---

## 0. Ground rules

**One seam, one direction.**

```
browser → Next.js route handler → n8n webhook → Supabase (Postgres function)
```

Every arrow points one way, and only the middle box holds credentials for the box to
its right. The browser never sees a webhook URL; n8n never talks to the browser or
reads a cookie; **Supabase never calls anything** — it has no n8n URL, no secret, and
no outbound trigger. When work has to start without a request behind it (extraction,
freshness pings, demand matching), it is a **cron inside n8n** that reads the
database, never the database reaching out.

Each route forwards to exactly one webhook, named by an env var
(`web/lib/server/n8n.ts` is the only file that knows a URL).

| Route | Hook env var | Scenario |
| --- | --- | --- |
| `POST /api/seed/profile` | `N8N_WEBHOOK_PROFILE` | §3.1 |
| `POST /api/seed/save` | `N8N_WEBHOOK_SAVE` | §3.2 |
| `POST /api/seed/complete` | `N8N_WEBHOOK_COMPLETE` | §3.3 |
| `POST /api/admin/query` | `N8N_WEBHOOK_ADMIN_READ` | §3.6 |
| `POST /api/admin/action` | `N8N_WEBHOOK_ADMIN_WRITE` | §3.7 |
| — (cron only) | — | §3.8–§3.12 |

**Answer honestly.** Every workflow returns `{ status, response }` where the response
carries `persisted: true|false`. A workflow that validated but did not write says
`false`. The route reports what the workflow said and never upgrades it. This is a
decision on record in CLAUDE.md — derive-only scenarios exist on purpose.

**Auth.** The webhooks have none today, so `N8N_WEBHOOK_TOKEN` is empty and the app
omits the header. **Add Header Auth on both sides in the same change as the first
workflow that writes to the database** — that is the moment an open webhook stops being
a harmless demo. Supabase credentials live only in n8n (service-role key, Postgres
node); they never reach our app, and the app has no Supabase client at all.

**Idempotency.** Every payload carries a client-generated id: `client_id` on cards,
`phone` on people. Every write is an upsert on that key. A parent who taps Save twice,
or a retried flush after a dropped connection, must not create two rows. There is no
"insert" anywhere in this document that isn't `on conflict … do update`.

**Test rows.** `is_test` travels with every payload. It is a column, not a filter
applied later: every admin count and every matching query excludes it by default.

**PII discipline.** n8n nodes must not log payload bodies. Set every Code node's
`Always Output Data` off and never `console.log($json)` — phone numbers and free text
about named people are in these payloads (invariant 7).

---

## 1. Schema

The DDL is not repeated here — it lives in
[`../supabase/migrations/`](../supabase/migrations/) and would drift the moment
somebody edited one copy. What belongs in a plan is the shape and the reasoning.

| File | What is in it |
| --- | --- |
| `0001_schema.sql` | 25 tables, enums, indexes, and every CHECK |
| `0002_views.sql` | the read paths, plus `founding_checklist` |
| `0003_write_ops.sql` | decision-free write operations + the facts n8n branches on |
| `0004_rls.sql` | deny-by-default, and three self-asserting invariant checks |
| `../supabase/seed.sql` | affinity weights, freshness policy, placeholder tap lists |

### The shape

**Identity.** `people`, keyed by phone, one row per person — "contributor" is a
derived status, never a second table. `consents` is append-only with a `text_version`
on every row, because the wording someone agreed to is the artefact, not a boolean.
`children` stores **birth years**, and an expecting parent's `due_year` records that
it was assumed from the capture date rather than asked.

**Matching.** `social_affinities` and `life_relevance`, one row per selection, plus
`affinity_weights` as a table so a weight change is a config edit and not a backfill.
`person_schools` keeps a status per school, because a parent who has *been* through
admissions is exactly who somebody needs. `market_options` is the matchable taxonomy;
`pending_options` is the "other" queue, and nothing in a matching path may read it.

**Contributions.** `submissions` holds the card exactly as captured and is never
edited — it is the answer to "did the parent actually say that". `places` is the
subject (activity, place or tip), `place_contributions` is one parent's experience of
it, so five parents recommending the same class is five rows and one place.

**Caregivers.** `caregivers` carries the visibility ladder and, deliberately, no way
to contact anyone. `caregiver_nominations` is one parent's nomination. `restricted_notes`
is its own table with `revoke all`, so `select *` on nominations cannot leak C6b or
the reason behind a hesitant C7.

**Everything else.** `flags`, `demand_signals`, `audit_log`, `message_log`,
`freshness_policy`, `referrals`, `credits`, `caregiver_profiles` (2C), and
`seed_conversations` (empty until sending transcripts is a deliberate decision).

### The constraints that carry the invariants

These are the reason the database is not just a bucket. Each one makes a rule
impossible to write rather than merely unlikely to be forgotten.

| Constraint | Invariant |
| --- | --- |
| `adults_only` | 2 — no minors, ever; refused, not stored as pending |
| `firsthand_only` | 14 — a caregiver nomination is firsthand-only |
| `visibility_requires_consent` | 1 — never active or discoverable without consent |
| `ladder_order` | 2C — introducible implies discoverable |
| `consent_needs_evidence` | recording consent requires the artefact |
| `verified_if_named` | 11 — nothing about a named parent before verification |
| `hold_when_hesitant` | a hesitant "hire again" cannot be released automatically |
| `price_shape` | a price band without a unit is unusable |
| `allowance_shape` | "as many as relevant" has no number, and must not get one |

## 2. Where the logic lives

**The business rules are on the n8n canvas.** Supabase is the database: it stores
what a workflow decided, and it refuses anything unsafe. Nothing in it classifies,
derives, or chooses.

| In n8n, as nodes | In Postgres, and only this |
| --- | --- |
| Is this place already in the database, or a new one? | the lookup that lists candidates |
| Does this caregiver card need a human before anyone sees it? | the CHECK that refuses a released hold |
| Does this parent now qualify as Founding? | the view with the facts, and a setter that records the outcome |
| Which flags to raise, and at what severity | a single-row insert |
| Whether an outreach text is due | the view with the five counters |
| Which questions to bring which parent | nothing — it is a query the matcher writes |

Three things stay in the database because a workflow cannot be trusted to remember
them, and none of them is a business rule:

1. **CHECK constraints.** No minors, firsthand-only nominations, never active
   without consent, a named parent only with a verified phone. If a workflow's logic
   is wrong, the write fails instead of storing something unsafe. This is the
   decision already on record in CLAUDE.md — safety invariants belong in constraints,
   not in a Code node edited in a browser.
2. **One bundled write.** `write_caregiver_nomination` writes the nomination and its
   restricted notes in one transaction. Split across two nodes, a failure between
   them leaves a card that reads as clean while the parent's private concern is
   missing — the one silent failure here that would actually hurt somebody.
3. **An audit row inside each setter.** Bookkeeping, so a new branch on the canvas
   cannot forget it.

### The write operations (0003_write_ops.sql)

Each takes values the workflow already decided. Call them from a Postgres node with
`select fn($1::jsonb)` or `select fn($1, $2, …)`.

| Operation | Writes |
| --- | --- |
| `write_person(payload)` → uuid | upsert `people`, replace children / affinities / relevance / school statuses. Never touches `founding`. |
| `write_pending_option(market, category, value, person)` | one "other" answer |
| `write_consent(person, scope, status, source, version, at)` | one consent record |
| `set_allowance(person, n, mode)` | P14 |
| `write_submission(payload)` → uuid | the card as captured, upsert on `client_id` |
| `write_place(payload)` → uuid | a new place |
| `write_place_contribution(payload)` → uuid | one parent's experience of it |
| `write_caregiver(payload)` → uuid | a new caregiver, always at `mentioned` |
| `write_caregiver_nomination(payload)` → uuid | nomination **+ restricted notes**, atomic |
| `set_caregiver_consent(id, status, evidence, actor)` | ladder step, evidence required for `consented` |
| `set_caregiver_visibility(id, active, discoverable, introducible, actor)` | ladder step |
| `write_demand_signal(payload)` → uuid | D1 |
| `write_flag(payload)` → uuid · `resolve_flag(id, status, note, actor)` | 1.9 / 2.7 |
| `set_contribution_status` · `set_nomination_status` · `set_place_status` | review outcomes |
| `set_founding(person, status, actor)` | records the outcome; refuses to downgrade |
| `promote_option(id, slug, label, actor)` | 2.6 |
| `write_credit(person, kind, reason)` | D2/D3 |
| `write_message_log(payload)` · `set_opt_out` · `clear_opt_out` · `set_aggregate_display` | Phase 2 |

### The facts to branch on

| Read | Answers |
| --- | --- |
| `place_candidates(market, kind, name)` | "is this place already here?" — exact match first, then near-matches with a score |
| `caregiver_candidates(market, first_name, last_initial)` | the same, for people |
| `founding_checklist` (view) | every Founding criterion per person, plus `qualifying_approved` |
| `outreach_facts` (view) | opted_out · hour_pt · allowance · outreach_30d · last_outreach_at · replies_30d |
| `places_due_for_ping` (view) | the freshness work list, per category threshold |
| `caregivers_answerable` (view) | the only caregiver rows an answer may use |
| `contribution_labels` (view) | the trust label — never composed in a node |

---

## 3. The scenarios

Each one is the node chain, in order. Where a node makes a decision, the decision is
written out — that is the part you will be reading in six months.

### 3.1 `profile-affinity-derivation` — 1.3

```
Webhook  POST /webhook/profile-affinity-derivation
  → Postgres   select write_person($1::jsonb)                      $1 = {{ JSON.stringify($json.body) }}
  → IF         {{ $json.body.pending_options.length > 0 }}
       true  → Split Out  pending_options
             → Postgres   select write_pending_option($1,$2,$3,$4)
  → Respond to Webhook   { persisted: true, person_id, written: … }
```

Decisions on the canvas, none of them in SQL:

- **Is this a new contributor or a returning one?** You don't have to decide —
  `write_person` upserts on phone. But if you want different behaviour for a return
  visit (say, not resetting `neighborhood`), that is an IF here on
  `person_by_phone($1)` before the write.
- **Should the derived rows be trusted?** The app sends `social_affinities` and
  `life_relevance` ready to insert, and the payload's `answers` is the authoritative
  part. If you want the workflow to re-derive them instead of trusting the client,
  that is a Code node here — and keeping the app's version alongside it is how the
  `derivation_agrees` check works today.

### 3.2 `seed-card-save` — 1.5 / 1.6

```
Webhook  POST /webhook/seed-card-save
  → Postgres   select write_submission($1::jsonb)                  → submission_id
  → Switch     {{ $json.body.kind }}
      ├─ activity | place | tip  → (A)
      └─ caregiver               → (B)
```

**(A) place-like cards**

```
  → Postgres   select * from place_candidates($1,$2,$3)
  → IF         exact_match = true
       true  → Set  place_id = candidate.id
       false → IF   score > 0.6                       ← "close, but not the same"
                  true  → Postgres write_place(…)  → Postgres write_flag(
                                                       severity 'review',
                                                       reason 'possible_duplicate_place')
                  false → Postgres write_place(…)
  → Set        firsthand       = {{ $json.body.fields.firsthand === 'yes' }}
               caveat_answered = {{ 'caveat' in $json.body.fields }}
               follow_up_ok    = {{ $json.body.fields.follow_up_ok === 'yes' }}
  → Postgres   select write_place_contribution($1::jsonb)
  → IF         {{ ['probably_not','no'].includes($json.body.fields.recommendation) }}
       true  → Postgres write_flag(severity 'review', reason 'negative_recommendation')
  → Respond    { persisted: true, record_id, place_id }
```

The two judgements worth naming: **a near-match is never merged silently** (a wrong
merge is invisible and permanent; a duplicate is neither), and **`caveat_answered`
comes from the key being present, not from the text being non-empty** — "nothing
comes to mind" is an answer, and Founding depends on the difference.

**(B) caregiver nominations**

```
  → IF         {{ $json.body.fields.age_gate === 'yes'
                  && $json.body.fields.worked_for_you === 'yes' }}
       false → Respond 422   { error: 'refused', reason: 'age_gate' | 'not_firsthand' }
  → Postgres   select * from caregiver_candidates($1,$2,$3)
  → IF         exact_match = true
       true  → Set caregiver_id = candidate.id
       false → Postgres write_caregiver({ is_adult: true, … })
  → Code       hold = []
               if (f.hire_again !== 'yes')            hold.push('hire_again_' + f.hire_again)
               if (body.private_note)                 hold.push('private_note')
               if (body.hesitation_reason)            hold.push('hesitation_reason')
               notes = [private_note, hesitation_reason].filter(Boolean)
  → Postgres   select write_caregiver_nomination($1::jsonb)
                 review_hold: hold.length > 0, hold_reasons: hold, restricted_notes: notes
  → IF         {{ $json.fields.send_invite === 'yes' && hold.length === 0 }}
       true  → Postgres set_caregiver_consent(id, 'invited', null, 'parent')
  → IF         hold.length > 0
       true  → Postgres write_flag(severity 'review', reason 'caregiver_review_hold')
  → Respond    { persisted: true, record_id, review_queued }
```

Three refusals live in the IF at the top — and the same three are CHECK constraints,
so a mistake on the canvas fails loudly instead of storing a minor, a secondhand
nomination, or a released hold. **The invite step is skipped while a card is held**:
offering it would undo the hold.

### 3.3 `seed-complete` — 1.7

```
Webhook  POST /webhook/seed-complete
  → Postgres   select person_by_phone($1)                          → person_id
  → Postgres   select set_allowance($1,$2,$3)
  → Postgres   select write_consent($1,'follow_up',…)
  → IF         {{ $json.body.demand && $json.body.demand.question_text }}
       true  → Postgres write_demand_signal($1::jsonb)
             → IF  {{ $json.body.demand.sensitivity === 'high_stakes' }}
                  true → Postgres write_flag(severity 'escalation',
                                             reason 'high_stakes_demand')
  → Postgres   select set_founding($1,'pending_founding','workflow')
  → Respond    { persisted: true, contributor_id, contributor_status }
```

`pending_founding`, never `founding` — that decision belongs to §3.11, on approval.

### 3.4 `extraction-engine` — 1.8

**Trigger:** a cron in n8n, every 5 minutes, over
`place_contributions where status = 'pending_review' and confidence is null`.

**Not** a Postgres trigger calling out to n8n. An earlier draft of this document
offered `pg_notify` as an option and that was wrong: it inverts the direction every
other scenario uses, and it buys nothing here because nobody is waiting on the
result. It would also put an n8n URL and its secret inside the database, and give the
extraction its own failure mode — a webhook that was down when the row was written
loses that row silently, whereas a poll picks it up on the next pass. **Supabase never
calls out. n8n always initiates.**

```
Cron → Postgres: select pending rows
  → Loop Over Items
      → AI node (structured output, temperature 0)
      → Code: validate against an allow-list
      → Postgres: update … set confidence, extracted
      → IF confidence < 0.7 → insert flag('low_confidence')
```

What it extracts, and only this: age band from free text where the tap is missing,
neighborhood mentions, category, and a normalised name. What it must **not** do:

- never write a trust label (that is the view in §1.6);
- never invent a `market_options` value — an unmatched name becomes a
  `pending_options` row (invariant 9);
- never rewrite the parent's words. `what_makes_it_great` and `caveat` are stored
  verbatim; the extraction adds columns beside them.

Free text about a named person never reaches the model at all: `restricted_notes` is
excluded from the select (invariant 8 plus the client's "never AI-summarized").

### 3.5 `annotation-and-flags` — 1.9

Same shape, different job: rules, not a model, so it is cheap and predictable.

| Rule | Flag |
| --- | --- |
| Contribution about a place whose `last_confirmed_at` is older than its category threshold | `review`, `stale_at_capture` |
| `recommendation in ('probably_not','no')` | `review`, `negative_recommendation` |
| Free text mentioning a capitalised name that is not in `market_options` | `review`, `possible_named_person` |
| A contributor's fifth submission inside an hour | `note`, `volume_spike` |
| Duplicate `(place, person)` pair | `review`, `duplicate_contribution` |
| `demand_signals.sensitivity = 'high_stakes'` | `escalation` |

The "possible named person" rule is the only defence against D1's fourth row (a
complaint about a named person filed as ordinary). It over-flags on purpose.

### 3.6 `admin_read` — one webhook, one Switch

**Trigger:** `POST /api/admin/query` with `{ resource, params }`.

```
Webhook → Switch on resource → one Postgres node per resource → Respond
```

The contract is `web/lib/admin/types.ts`, and the pages need no reshaping — the SQL
returns the exact field names. Every query filters `is_test = false` unless
`params.include_test`. Notes on the ones with real logic:

- **overview** — one `select` with subqueries. `with_two_plus` counts people with two
  *approved qualifying* contributions, not two submissions.
- **caregivers** — must return `review_hold`, `hold_reasons` and *whether* restricted
  notes exist (`has_restricted_notes boolean`), with their bodies fetched by a separate
  `resource: 'restricted_note'` call, so the list view cannot leak them.
- **duplicates** — `pg_trgm` similarity on `(first_name, last_initial, care_type)` and
  on place names, grouped, returning `score` and `reason[]`.
- **founding** — the qualification checklist per person (§3.11), so the admin sees
  *why* someone is or is not eligible rather than a bare count.
- **audit** — read-only, newest first, never joined to anything that could rewrite it.

### 3.7 `admin_write` — one webhook, one Switch, one audit row

**Trigger:** `POST /api/admin/action` with `{ action, actor, ...args }`.

```
Webhook
  → Postgres: select … (the "before" snapshot)
  → Switch on action → the write
  → Postgres: insert into audit_log (actor, action, resource, resource_id, before, after)
  → Respond
```

The audit insert is **after the Switch, on the shared path**, not duplicated inside
each branch — that is the entire reason there is one write endpoint. If a branch needs
its own audit shape, it returns `after` and lets the shared node write it.

Rules that live here and not in the UI:

- `caregiver.consent → 'consented'` requires a method, and a note when the method is a
  call or an in-person yes. Reject the action otherwise: that note is the only
  artefact of consent that exists.
- `caregiver.active = true` is refused unless `consent_status = 'consented'` — the
  constraint would refuse it anyway; the workflow should return a readable message
  instead of a Postgres error.
- `caregiver.merge` moves nominations and restricted notes, then keeps the **lowest**
  visibility of the two rows, never the highest.
- `option.promote` inserts into `market_options` and marks the `pending_options` row
  approved in one transaction. Until it runs, that value is not matchable.
- `founding.approve` is allowed only when the `founding_checklist` IF passes,
  or `override_reason` is supplied — and the override goes in the audit row.

### 3.8 `caregiver-invite-accept` — 2C, the caregiver's own flow

**Not built on the app side yet** (G1–G10), but the workflow is the same shape as the
seed tool's, and the ladder is the whole point.

```
Webhook (POST caregiver-profile)
  → Postgres: match the caregiver row by invite token
  → Postgres: select apply_caregiver_profile($1)
  → Respond
```

Order of writes, and each one is a separate consent:

1. **G1** identity + mobile verification. Reuses the OTP layer in code
   (`lib/server/verify.ts`); the workflow only ever receives an already-verified phone.
2. **G2** consent to create a private profile → `consents(scope => 'caregiver_profile')`
   and `consent_status = 'consented'`. Declining at any point deletes the row.
3. **G3–G7** roles, child-age experience, areas + driving, days/hours, rate — plain
   profile columns on a `caregiver_profiles` table.
4. **G8** reference introductions → its own consent row.
5. **G9** may she appear in answers → `active = true`. This is the flag the
   `caregivers_answerable` view reads.
6. **G10** may she be introduced → `discoverable`, then `introducible`.

**Invariant to enforce in SQL:** visibility only increases, and only from this
workflow. A downgrade is allowed (a revoke), but an upgrade must never come from an
admin action or a parent's nomination.

### 3.9 `freshness-pings` — cron

**Trigger:** daily, 09:00 PT (inside quiet hours by definition).

```
Cron → Postgres: select places needing a ping
     → Postgres: select * from outreach_facts where person_id = $1
     → IF chain: opted_out → quiet hours → allowance → 48h gap → response rate
     → HTTP Request → OUR app's send endpoint (not Twilio)
     → Postgres: message_log + last_pinged_at
```

Thresholds per category, because camps are seasonal and playgrounds are not: camps 90
days, classes 120, caregivers 180, places 365. Defaults live in a `freshness_policy`
table so Janet can change them without a deploy.

**The rule that makes this workflow safe:** it does not call Twilio. It calls our own
send layer, which applies opt-out → quiet hours → allowance → 48-hour gap → governor
in that order (invariant 6). n8n decides *who is due*; the app decides *whether a text
may go out*.

### 3.10 `demand-matching` — cron

Daily: for every `demand_signals` row with `status = 'open'`, look for an approved
contribution that answers it (category + age band + neighborhood overlap). On a match,
queue an outbound "the network can answer this now" message through the same send
endpoint, and set `status = 'matched'`.

`requires_human_review` rows are skipped entirely until an admin resolves them.

### 3.11 `founding-qualification` — called by the review workflow

The client's rule, as nodes, reading one view. Nothing about it is in SQL, so Janet
can see the criteria and you can change them without a migration.

```
(called after set_contribution_status → 'approved')
  → Postgres   select * from founding_checklist where person_id = $1
  → IF         {{ $json.verified && $json.has_neighborhood && $json.has_children
                  && $json.allowance_ok && $json.qualifying_approved >= 2 }}
       true  → Postgres set_founding($1,'founding','workflow')
             → Postgres write_credit(referrer, 'targeted_network_ask', 'referral_approved')
             → HTTP     our app's send endpoint → the D3 message
       false → NoOp     (the checklist row is what the admin queue shows)
```

`qualifying_approved` is where the rule actually is, and the view spells it out:
approved **and** firsthand **and** has child-age context **and** has recency **and**
has a specific strength **and** has fit context **and** the caveat prompt was
answered. Change any of those and you change `founding_checklist` in
`0002_views.sql` — one place, and the admin page moves with it.

The exception the question set allows — one exceptional firsthand caregiver
nomination qualifying alone — is `caregiver_approved >= 1` in the same IF, plus an
admin override that writes its reason into the audit row.

**Status and rewards activate on approval, never on submission.**

### 3.12 `sms-inbound` — Phase 2

**Trigger:** Twilio webhook → **our app**, not n8n. Signature verification must happen
in code (see CLAUDE.md's exception list), and only then does the app hand the parsed
message to n8n.

Keyword handling, in this order:

| Keyword | Effect |
| --- | --- |
| `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` | Insert `sms_opt_outs`; every later send is refused at step 1 of the send layer. |
| `HELP`, `INFO` | Static help reply. |
| `START`, `UNSTOP` | **The only** opt-in keywords (client's instruction — `YES` must be removed from the console, because "yes" is an answer to a Network Ask). Delete the opt-out row. |
| `PRIVACY` | `people.aggregate_display = false`. The standing opt-out the profile disclosure promised. |
| anything else | Route to the conversation workflow. |

### 3.13 `market-options-import` — one-off, then on demand

CSV → `market_options`. Runs as: upload to Supabase Storage → n8n reads it →
`insert … on conflict do update set label, bands, active`. Values that already exist in
`pending_options` are marked approved in the same transaction, so the parents who typed
them become matchable immediately.

Until this runs, every taxonomy value in the app is a placeholder
(`web/lib/market-options.ts`).

### 3.14 `matching-test-harness` — not user-facing

A workflow Janet can run with a fake profile to see who *would* be asked, and why:
affinity score, relevance overlap, trust-circle ranking, and the reason each candidate
was excluded. It reads `affinity_weights` at query time — the same resolution the real
matcher uses, or the harness is testing something else.

---

## 4. Build order

1. **Schema + `write_person`**, and switch 1.3 to Postgres. Nothing else works without
   identity.
2. **Header Auth on every webhook**, in the same change. First write, first lock.
3. `seed-card-save` (§3.2) — including `restricted_notes` and the hold rules, because
   the admin queue is worthless without them.
4. `seed-complete` (§3.3).
5. `admin_read` (§3.6) — the moment this lands, the admin pages stop showing sample
   rows and start showing the pilot.
6. `admin_write` (§3.7) + the Founding IF (§3.11).
7. `annotation-and-flags` (§3.5) — rules only, no model.
8. `extraction-engine` (§3.4).
9. 2C, the caregiver's own flow (§3.8) — app side first.
10. Phase 2: send layer in code, then `sms-inbound`, `freshness-pings`,
    `demand-matching`.

## 5. What never moves into n8n

Not logic — enforcement and secrets. Everything else is yours to arrange on the
canvas.

**In the app's code, because a browser-edited workflow must not be able to bypass it:**

- the SMS send layer and its ordered checks (`web/lib/server/sms.ts`);
- Twilio and Stripe signature verification;
- OTP generation and checking, and the "nothing stored until verified" gate;
- sanitising and length-capping free text before it leaves the app.

**In the database, as constraints and views, because a wrong workflow must fail
rather than store something unsafe:**

- `adults_only`, `firsthand_only`, `visibility_requires_consent`, `ladder_order`,
  `consent_needs_evidence`, `verified_if_named`, `hold_when_hesitant`;
- `caregivers_answerable` and `contribution_labels` — the read paths;
- `restricted_notes` as its own table with `revoke all`.

Everything a constraint refuses, a workflow should also check and report kindly —
the constraint is the floor, not the error message.

## 6. The admin contract (done, 3 Aug)

`web/lib/admin/types.ts` was rewritten against the schema in the same pass as these
workflows, so `admin_read` returns exactly what the pages render. What changed:

- `ActivityRow` → **`ContributionRow`**: one queue for activities, places and tips,
  with `firsthand`, `child_age_at_time`, `last_there`, `how_much`, `price_band` +
  `price_unit`, `worth_it`, `who_for`, `who_not_for`, `caveat_answered`,
  `follow_up_ok`, and the place nested as its own object.
- `CaregiverRow`: **`contact` removed entirely** — no contact detail exists to show.
  Added `review_hold`, `hold_reasons[]`, `has_restricted_notes`, `hire_again`,
  `invite_sent_by_parent`, `strengths`, `good_fit_for`, `needs_horizon`,
  `needs_change_type`, `recontact_ok`, `pay_band`, `pay_benchmark_consent`, and the
  five-step ladder plus `discoverable` / `introducible`.
- New **`restricted_note`** resource, fetched one at a time so a list view cannot leak
  C6b or the reason behind a hesitant C7 (invariant 12).
- New **`demand`** resource and a page for it: high-stakes first, and Pando does not
  answer those.
- `ContributorDetail`: `attribution`, `aggregate_display`, allowance + mode,
  `school_status`, both topic clusters, `time_in_area`, and every consent with its
  wording version.
- `FoundingRow.checklist`: the client's rule as facts, so the queue shows *why*.
- `Overview`: the caregiver ladder replaces the old outreach funnel, plus
  `quality.review_holds` and the demand split.

Four rules now live in `/api/admin/action` as well as in the workflow, because a
readable refusal beats a constraint violation: releasing a hold needs a note,
visibility needs the consent it claims to have seen, `introducible` implies
`discoverable`, and a promoted option needs a real slug.
