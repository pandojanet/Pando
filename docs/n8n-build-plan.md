# Building the rest of the estimate with n8n

How every remaining estimate row gets done under the agreed working model:
**Claude Code writes the app, the developer specifies pages, the client builds the
workflows in n8n.** This document is the seam between those two halves.

---

## 0. The contract

```
browser ──HTTP──> Next.js route handler ──HTTP (token)──> n8n webhook ──> Supabase
                        (validation,                       (business
                     sanitising, secrets)                  workflow)
```

Rules that make this work:

1. **The browser never talks to n8n.** It calls our own routes; the webhook URL and
   token stay server-side (`lib/server/n8n.ts` is the only file that knows them).
2. **Our routes validate and sanitise; n8n decides and persists.** A workflow can
   trust the shape of what it receives (ids match `^[a-z0-9_-]{1,64}$`, text is
   capped and control-stripped, phones are E.164, required fields are present).
3. **Every hook is an env var.** Unset = the route answers `persisted: false`
   instead of pretending. That is how the app runs today.
4. **Workflows are versioned artefacts.** Export each one to `n8n/<name>.json` in
   this repo on every meaningful change — otherwise the business logic exists only
   inside one n8n instance with no history and no review.

Hooks that already exist: `invite`, `profile`, `save`, `complete`, `chat`
(reserved). Add new hooks by adding one line to `ENV_BY_HOOK`.

### The one hard exception: SMS sending

v3.2 requires **one send function, no raw Twilio calls anywhere**: opt-out hard
block → quiet hours 8:00–21:00 PT → blast frequency → throughput throttle by 10DLC
trust score. Every one of those is a legal requirement, and a workflow that calls
the Twilio node directly bypasses all four.

So: **`POST /api/sms/send` lives in code and is the only thing allowed to touch
Twilio.** n8n never uses the Twilio node for outbound. Workflows call our endpoint
with `{ to, body, kind, reason_id }` and it returns `sent | suppressed | queued`
with a reason. This is the piece the "n8n discount" does not apply to — budget it
as real code.

The same reasoning applies, for the same "it must be provably correct" reason, to:
Twilio inbound signature verification, Stripe webhook signature verification, OTP
issue/verify, and the caregiver-consent query filter.

---

## 1. Standard workflow skeleton

Every inbound workflow looks like this, and most of the estimate rows below are a
variation on it:

```
Webhook (POST, header auth: X-Pando-Token)
  → IF token invalid → Respond 401
  → Code: normalise payload
  → Switch (intent / kind / status)
      → Supabase: select context
      → Anthropic (Claude) — only where judgement is needed
      → Supabase: insert/update
      → HTTP Request → POST /api/sms/send   (never the Twilio node)
  → Respond to Webhook (JSON the route passes back to the browser)
```

Conventions worth fixing once, in the first workflow you build:

- **Idempotency.** Every payload we send carries a client id (`submission.id`,
  `client_id`). Upsert on it. Retries are guaranteed — our routes time out at 10 s.
- **Error workflow.** One n8n Error Trigger workflow that logs to a Supabase
  `workflow_errors` table and pings you. Attach it to every workflow.
- **No secrets in nodes.** Supabase/Anthropic/Twilio credentials as n8n
  credentials, never inline.
- **Reply fast, work later.** If a workflow does anything slow (AI + several
  writes), respond to the webhook first and continue in a sub-workflow
  (`Execute Workflow`, "do not wait"). Our routes wait 10 s.

---

## 2. Finishing Phase 1

| # | Row | In code | In n8n | Notes |
| --- | --- | --- | --- | --- |
| 1.3 | Profile → affinity derivation | already sends ready rows; route honours the workflow's `persisted` flag | `profile` hook: upsert person on phone → replace `social_affinities` + `life_relevance` for that person → upsert `pending_options`. **Step-by-step build, with the Code node body and expected output: [../n8n/1.3-profile-derive.md](../n8n/1.3-profile-derive.md)** | **Delete-then-insert** the derived rows, don't merge: editing a profile must remove affinities that no longer apply. Store membership; resolve weight from a config table at query time. |
| 1.5 / 1.6 | Activity / caregiver capture cards | built (closed questions, no LLM) | `save` hook: insert `activities` / `caregiver_nominations`; caregiver always `consent_status=pending, active=false` | Split `caregiver_nominations` (one row per parent's claim) from `caregivers` (canonical person, key = phone, created at consent). Merging nominations is what produces "validated by multiple parents". |
| 1.7 | Completion | built | `complete` hook: set `follow_up_opt_in`, write the consent row (`scope/status/source/text_version/captured_at`), set `contributor_status='pending_founding'` | Never let the client set `contributor_status`. |
| 1.8 | Extraction engine + confidence | — | sub-workflow on free text only: Claude with a JSON schema → `{value, confidence}` per field → write `extraction_confidence` + queue low scores | Because capture is closed-question, this is now only `what_makes_it_great`, `caveat`, `tip`, and demand text. Confirm-back: return `needs_confirmation: true` and the route re-asks in the chat. |
| 1.9 | Annotation & flag layer | — | same sub-workflow, second Claude call: severity + reason → `flags`; serious allegations to a **separate** channel | Tuned to over-flag. Negative text about a named person is never published verbatim — it becomes a signal that affects surfacing. |
| 1.10 | Session / passwordless | `lib/storage.ts` today (device-local) | — | Server-side sessions only matter once return-to-edit must be authorised — which depends on the unique-link decision. |
| new | Demand capture | one screen + route (~1 h) | `complete` hook (same call): insert `demand_signals(question_text, category, neighborhood, status='open')` | Free text goes through the 1.9 flagging path. |
| new | market_options import | — | one-off workflow: Google Sheets node → normalise slug → upsert `market_options(market_id, category, option_value, active)` | Slugs must match the ids the app already uses, or every existing profile row orphans. Re-runnable. |

### Admin (M2) — all pages, thin workflows

**The pages are built** (`app/(admin)/admin/*`). What's missing is the two
workflows behind them; the row shapes they expect are typed in
`web/lib/admin/types.ts`, and `web/lib/admin/sample.ts` shows one valid example of
every resource — build the workflow to return that shape and the pages light up
with no further changes.

Pages are code (Next.js + our design system); each page reads and writes through
one admin hook. Simplest split that keeps the surface small:

- `POST /api/admin/query` → n8n `admin-read` workflow: `{ resource, filters, page }`
  → Supabase select → rows. One workflow, a Switch on `resource`
  (contributors / activities / caregivers / flags / pending-options / founding-queue).
- `POST /api/admin/action` → n8n `admin-write` workflow: `{ resource, id, action, payload }`
  → Switch → update + **always** insert an `audit_log` row
  (who, what, before, after, when).

Row-by-row: 2.1 auth is code (individual accounts — the audit trail must attribute
sensitive actions to a person). 2.2 overview = counts from `admin-read` + embedded
PostHog. 2.4 needs the confidence column from 1.8 to be filterable. 2.5 caregiver
consent is a state machine `pending → contacted → consented | declined` with
evidence stored, plus a duplicate-candidate panel that **suggests** and never
merges. 2.6 promotes `pending_options` into `market_options` (soft-delete the old
value, never hard delete — profiles reference it). 2.7 flag queue with the separate
escalation channel. 2.8 audit log is the write workflow's last node, not a feature.
New: founding approval queue — cards, three statuses
(`pending_founding | founding | request_invite`), bulk-approve per link.

### M3 PostHog

Call sites exist (`lib/analytics.ts`). Remaining: add the provider script + key in
code, then build funnels in PostHog's own UI. No n8n.

---

## 3. Phase 2 (SMS pilot) — the interesting part

**M5 conversation → answer.** This is the biggest workflow and the one to build
first, because everything else feeds it.

```
/api/sms/inbound (code: verify Twilio signature, mirror STOP/HELP, persist message)
   → n8n `inbound` workflow
       Switch on keyword (already handled in code) 
       → Claude: classify intent (last 5 messages as context, confidence + fallback)
       → Switch on intent
            activity_question / caregiver_question:
              → optional single clarifying question → write the answer back to the profile
              → Supabase: candidate retrieval (see M6)
              → Code: attach labels + freshness
              → Claude: compose answer (concise for SMS), decide next step
              → IF sensitive/low-confidence/caregiver → insert into `answer_queue`, stop
              → ELSE → POST /api/sms/send
            blast_response / vouch / freshness_update / contribution / settings / meta → own branches
```

Points that decide whether this works:

- **Intent classification needs a fallback**, not just a confidence number: unknown
  → ask one clarifying question rather than guess.
- **Caregiver retrieval filters `consent_status='consented' AND active=true` in the
  query**, not in the response step. Put it in a Supabase **view** so no workflow
  can forget it.
- **Labels are verbatim** from the spec, and public info is never presented as
  parent trust.
- **Answer composition is one Claude call with the retrieved rows in the prompt** —
  do not let the model retrieve or invent sources.

**M6 matching.** Pure SQL, and it belongs in a Postgres function
(`match_contributors(asker_id, category, tier)`) called by one Supabase node — not
assembled from n8n nodes. Self-join `social_affinities` on `(type, value)`, join
`affinity_weights` from config, add life-relevance modifiers as boosts, add
adjacency from `neighborhood_adjacency` (never double-counting a same-neighborhood
match), overlap age bands, apply hard excludes only when the request demands them,
then frequency filters, then tier cut. Cold-start behaviour must be explicit: widen
radius → relax modifiers → tell the parent honestly.

**M7 Blast.** n8n orchestrates, code owns money and sending: create (status
`pending_payment`) → Stripe Checkout link (code) → Stripe webhook (code, signature
verified) flips to `active` → n8n selects the pool via the matching function +
protection filters → send each recipient through `/api/sms/send` → collect replies →
admin rates → fulfil within the window → flag refunds. Use **Split In Batches +
Wait** for throttling, and log every send to `blast_frequency_log` before sending,
not after.

**M8 contributor protection.** Enforced in code inside the send layer, because it
must be impossible to bypass: monthly limit (3/5/10/20, default 5), hard 48-hour
gap, response-rate governor (<25% over 30 days → down one tier + one friendly
note). n8n only reads/writes the preference rows and handles `BLAST SETTINGS`.

**M9 thanks, rewards, scheduled jobs.** This is n8n's sweet spot — Schedule
Triggers, all Pacific time: thanks prompts (3–5 days activities, 7–14 caregivers),
thanks delivery with batching (≤1 per contributor per week), weekly impact summary,
weekly tier recalculation (founding never downgrades), hourly blast expiry, daily
response-rate update. Every send still goes through `/api/sms/send`, which is what
makes "STOP silences everything, including jobs" true.

**M10–M11 contribution, vouch, caregiver processes.** Ongoing contribution reuses
the `save` hook. Vouch/freshness increments `validated_count` and refreshes
`last_confirmed` — this is how "validated by multiple parents" happens. Caregiver
consent outreach over SMS: send explanation → capture the reply → store evidence +
timestamp + phone (which is also the dedup key) → `consented`. Self-deactivation
via keyword. **Retention job**: delete the stored number if the caregiver declines
or doesn't answer within the agreed window.

**M12 admin (Phase 2)** — same two-hook pattern as M2.

**v3.2 additions.** Freshness pings: weekly Schedule Trigger → stale records
(120 days, per-category config) → one-tap Y/N → N to admin review; max 1/month, not
on a Blast day, counts toward tier. First blast free: `NEW_USER_BLAST_CREDITS=1`,
`credit_transactions`, redemption skips Stripe. Graph write-back: approved Blast
answer → pending `activities`/`caregiver_nominations` row with provenance → admin
promotion. Forwardable answers: share line on vouched+ answers only (never
caregiver, never public-only), max 1/week/user. Golden answers: `answer_ready` flag
+ admin filter. Passive queue writes neighborhood + category for the demand map.

**Internal matching test harness.** An admin page that runs
`match_contributors()` against real seed data with a typed test question and shows
the ranked pool with score breakdown. Cheap, and it is what de-risks matching
before any consumer traffic — build it as soon as M6 exists.

---

## 4. Keep out of n8n

| Thing | Why |
| --- | --- |
| Outbound SMS | Legal choke-point: opt-out, quiet hours, frequency, throttling. |
| Twilio inbound signature, Stripe webhook signature | Must reject unsigned requests before anything else runs. |
| OTP issue/verify | 5-min TTL, 3 attempts, 15-min lock, no code in logs. |
| The caregiver consent filter | Enforce in a DB view, not in workflow branches. |
| Matching scoring | One SQL function — testable, fast, and reviewable in a diff. |
| Anything that decides `consent_status`, `active`, `trust_level`, `provenance` | Server-owned fields; a workflow may set them, a client never. |

---

## 5. Suggested build order

1. `market_options` import (everything downstream depends on real taxonomy).
2. `profile` + `save` + `complete` hooks → Phase 1 actually persists.
3. Admin read/write hooks + audit log → founding queue, activity review, caregiver consent.
4. 1.8/1.9 extraction + flagging on free text.
5. `/api/sms/send` compliance layer **in code** + Messaging Service wiring.
6. `match_contributors()` + the test harness.
7. M5 inbound/answer workflow.
8. Blast + Stripe.
9. M9 scheduled jobs.
10. v3.2 additions.

The first four need no Twilio and no 10DLC approval, so they can be built while the
carrier registration Janet is doing runs in parallel.
