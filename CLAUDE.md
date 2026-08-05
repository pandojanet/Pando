# Pando — project context

Read this first. It is the single place that says what this project is, what state
it is in, and what has already been decided. Keep it current (see the last section).

## What we're building

Pando is an **SMS-first local parenting trust network**: a parent texts a US number
saved as a contact and gets recommendations about local classes, camps, activities
and caregivers, backed by real parents and honestly labelled by source and
freshness. *"AI knows things. Pando knows someone."*

The long-term asset is not the interface — it's the structured **trust + freshness
graph** and the **two-layer matching** on top of it (social affinity × life
relevance). That is what the paid tier sells.

- **Phase 1 — Seed Tool** (what we are building): a mobile-first web app for ~350
  curated founding contributors. Collects the matching profile, activity/place/tip
  recommendations and caregiver nominations. It is *not* a survey — it is the first
  version of the human-truth ingestion layer.
- **Phase 2 — SMS pilot**: the real product. Client folded the old "Phase 3"
  (Twilio + Stripe) into Phase 2 — the channel *is* the product, so it ships with it.

Client: Janet (non-technical, owns product decisions). Agency: QuitCode.

## Working model (why the code looks like this)

**Claude Code writes the app · the developer specifies pages · the client builds
the workflows in n8n.** So:

- Everything the browser touches is our Next.js app: pages, route handlers,
  validation, sanitising, secrets.
- Business workflows (persistence, AI extraction, scheduled jobs, outreach) are n8n
  webhooks behind our route handlers. `lib/server/n8n.ts` is the **only** file that
  knows a webhook URL.
- Unset hook env var ⇒ the route answers `persisted: false` rather than pretending.
  That is how the app runs today; nothing is stored yet.
- n8n instance: `https://n8n-dxmd.srv1576782.hstgr.cloud` — webhooks currently have
  **no authentication**, so `N8N_WEBHOOK_TOKEN` stays empty and the app omits the
  header. Add Header Auth on both sides in the same change as the first workflow that
  writes to a database.
- **Exception that must stay in code:** the SMS send layer, Twilio/Stripe signature
  verification, OTP, the caregiver consent filter, matching SQL. See
  [docs/n8n-build-plan.md](docs/n8n-build-plan.md) §0 and §4.

## Repo map

```
CLAUDE.md            this file
README.md            how to run it
DEPLOY.md            GitHub → GHCR → VPS pipeline
docs/
  spec-compliance-review.md   built vs. every client document, + open questions
  n8n-build-plan.md           how each remaining estimate row gets built
  n8n-supabase-plan.md        the Supabase schema + every workflow's logic (build from this)
  n8n-integration-options.md  four ways n8n can reach Supabase, and which to pick
  qa-checklist.md             M4 — how to test both flows, in order
n8n/                 per-scenario build instructions + importable workflow JSON
                     workflows/*.json       Postgres-node transport
                     workflows/http/*.json  HTTP/RPC transport (no DB connection needed)
                     to-http.py             regenerates the HTTP set from the other
supabase/            migrations + seed + smoke test + check.py (supabase/README.md)
web/                 the Next.js app (see web/README.md for structure + payloads)
deploy/ .github/     what runs on the VPS, CI/CD
*.html               the client's original static pages — source of truth for
                     marketing COPY only; the live pages are app/(site)/*
.claude/skills/      pando-design-system · mobile-first-ui · tap-first-flow ·
                     mobile-ui-review  (read the relevant one before UI work)
```

Source documents live outside the repo (client-supplied): `Janet Estimate.xlsx`,
`Pando — QC Eng Spec June Revision V2.pdf` (spec v3.1), `опис.pdf` (105-page
analysis transcript that contains **Janet's answers and her v3.2 additions** —
newer than the spec; where they conflict, it wins).

## Status by estimate row

| Row | What | State |
| --- | --- | --- |
| 1.1 | Landing / invite + QR entry | ✅ built — one shared link, `/join?i=…&src=qr`. First + last name, phone and the registered SMS-consent checkbox are required for the founding path; a labelled anonymous path opts out of both. Consent record is written at phone capture. |
| 1.2 | Tap-first profile | ✅ rebuilt to the client's July question set (P3–P14): 15 screens in their order, two of which state rather than ask (privacy disclosure, Pando promise). Birth-year taps, per-school status, time-in-area + where-from, family structure, current childcare, logistics, how-you-choose, trust circles, two topic clusters, P13 attribution, P14 allowance |
| 1.3 | Profile → affinity derivation | 🟡 app side done. **Supabase schema + importable workflow written** (`supabase/migrations`, `n8n/workflows/pando-1.3-profile.json`); neither applied to a live database or n8n yet |
| 1.4 | Chat-seeding interface | ✅ built — activity / caregiver / place / tip cards, add-another loop |
| 1.5 / 1.6 | Activity + caregiver capture cards (R1–R11 · C1–C11) | 🟡 **UI complete**: closed questions (no LLM), venue, fix-a-field, retention + review promises, `is_test`. Activity follows R1–R11: firsthand-or-secondhand, age at the time, recency, how much, caveat ("nothing comes to mind" counts), who-for / who-not-for, price band + unit, worth-it, recommend, per-rec follow-up. Caregiver follows C1–C11: firsthand-employment hard gate, kind of care, 18+, recency, ages cared for, closed strengths, fit, know-first vs private note, hire-again (yes/hesitant/no → hold + restricted why), needs horizon + type + check-back permission, pay band + separate benchmark consent, reference, and a parent-sent invite. **No caregiver contact details are collected at all.** Remaining: the n8n workflow that shapes a card into a stored row |
| 1.7 | Completion screen | ✅ built — thank-you, "Founding contributor · in review" (activates on the 2nd approved contribution), received → being read → added, D1 demand question with sensitivity routing, D2 referral, versioned follow-up consent, OTP gate, return link |
| 1.8 / 1.9 | Extraction engine · annotation & flags | 🟡 workflows written (`n8n/workflows/pando-1.8-extraction.json`, `-1.9-flags.json`) — 1.8 has a NoOp where the AI node goes; neither imported yet |
| 1.10 | Session / passwordless | 🟡 device-local autosave + **phone OTP at submit** (6 digits, 10 min, 3 sends, 5 attempts). Structure done and gated server-side; sends blocked on A2P campaign approval + Messaging Service SID |
| M2 | Admin (2.1–2.8) | 🟡 **complete on our side** — 10 pages (auth+shell, overview, founding queue with the qualification checklist, contributors+detail, contributions review, caregiver ladder + holds + restricted notes, tap lists, D1 demand queue, flags, audit). Contract matches the Supabase schema; `admin_read` / `admin_write` workflows written (16 + 41 nodes). Not connected to a live n8n, so pages still show the honest empty state |
| M3 | PostHog | 🟡 all events emitted, provider not attached |
| M4 | QA | 🟡 checklist written ([docs/qa-checklist.md](docs/qa-checklist.md)) — both flows, in order, with what can't be tested yet and why. Not yet walked by the client |
| Phase 2 | Everything | ⬜ |
| 2C | Caregiver's own flow (G1–G10) | ⬜ **not built** — the client's July set marks it BUILD NOW. A second surface: identity + OTP, consent to a private profile, roles, ages, areas + driving, days/hours, rate, reference intros, appear-in-answers, introductions — with a visibility ladder mentioned → invited → consented → discoverable → introducible |
| new (v3.2) | ✅ demand capture · ⬜ freshness pings · credits · graph write-back · forwardable answers · golden answers · founding approval queue · matching test harness · market_options import · SMS compliance layer | ⬜ |

Public site: `/`, `/about`, `/privacy`, `/terms` ✅ ported from the static HTML.

## Decisions already made — do not silently revert

| Decision | Why |
| --- | --- |
| **One shared invite link**, not per-parent links (31 Jul) | Client's call for now. v3.2 asks for unique links; if that flips, attribution, `invited_by` and return-auth all change. |
| **"Network Ask"**, never "Network Check" (31 Jul) | Client renamed it. New promise attached: *no useful answer → not charged*. |
| **Founding is never self-granted** | There is an admin approval queue ("is this really Sarah from our group?"). It activates on the **second approved contribution**; 1.7 says "in review" and promises a text. |
| **Three separate consents**: follow-up ≠ Blast ≠ reference | Different levels of exposure. `lib/consent.ts` keeps the wording versioned. |
| **Reference willingness comes from the nominating parent**, not the caregiver | It is the parent who would be the reference. The caregiver's own consent covers being *listed*, and everything beyond it is a separate step in their own flow (2C) — Pando never contacts them to ask. |
| **Marketing at `/`, Seed Tool at `/join`** | `/?i=<code>` redirects, so links already shared keep working. |
| **Founding CTA points to `/join`**, not the Tally form | Client asked; the static HTML still shows Tally — ignore it. |
| **A modal never renders inside an animated wrapper — it portals to `body`** (5 Aug) | `animate-step-in` ends at `transform: none`, but a *filled* animation computes to the identity matrix, and any transform other than `none` makes that element the containing block for `position: fixed`. So `OtherSheet`'s "full-screen" overlay was clipped to the question block for the life of the screen — invisible on a phone, a half-width sheet anchored to the middle of the page on a laptop. It is the only `fixed` element in the app; the next one must portal too. |
| **No phone-frame on desktop** | We tried it; a 27rem ribbon with its own scrollbar was worse than either alternative. `md:` = real desktop layout. |
| **A stored session is untrusted input** (4 Aug) | It was written by whatever build the parent last opened, and mid-pilot they meet several. `{...EMPTY_ANSWERS, ...stored}` looked safe but let a stored `null` overwrite a default `[]` — that crashed the profile screen. `normaliseAnswers` in `lib/storage.ts` now keeps a value only when its shape still matches, `selectionsFor` never returns null, and a chat draft pointing at a step that no longer exists is dropped back to the menu. |
| **Mobile is the design target** | Every desktop rule sits behind `md:`/`lg:`. Never regress the phone to improve the laptop. |
| Weights resolved from **config at query time**, not from the stored row | §8.1 vs §18.1 conflict; config wins or a weight change needs a backfill. |
| **Ingress on the VPS is Traefik, and `/docker/pando` is load-bearing** (5 Aug) | The box already runs Traefik (owning 80/443 + Let's Encrypt) and n8n; host `nginx` is inactive with a stock config. So no nginx/certbot — routing is container labels in `deploy/docker-compose.yml`, copied from the static site it replaced with the upstream port changed 80 → 3000. The compose project name comes from the directory, and that is what keeps the container on the `pando_default` network Traefik already reaches — moving or renaming the directory takes the site off Traefik and the only symptom is a 404 in front of a healthy app. |
| Deployment is **standalone Docker on our VPS**, not Vercel | See DEPLOY.md. Env is read at request time; `NEXT_PUBLIC_*` is not. |
| **A workflow's `persisted: false` is honoured, not overridden** (31 Jul) | Derive-only scenarios exist on purpose. The route must never report a save the backend didn't make. |
| **Business logic lives on the n8n canvas; Supabase is the database** (3 Aug) | Client's call. The write layer (`supabase/migrations/0003_write_ops.sql`) is decision-free: it takes what a workflow decided. Postgres keeps three things only — CHECK constraints (a wrong workflow must fail, not store something unsafe), one bundled write (nomination + its restricted notes, atomic), and an audit row per setter. Facts to branch on are views: `founding_checklist`, `outreach_facts`, `place_candidates`. |
| **Two transports, one set of logic** (4 Aug) | Supabase's direct host is IPv6-only without the paid add-on, so an IPv4 VPS cannot use the Postgres node. `n8n/workflows/http/` is the same eight workflows with every database call as a PostgREST RPC — generated by `n8n/to-http.py`, never hand-edited. This is why every write op takes a single `payload jsonb`: it is also the RPC calling convention. |
| **Supabase never calls out; n8n always initiates** (3 Aug) | One direction: browser → route → n8n → Supabase. No database triggers or webhooks reaching for n8n — work without a request behind it is a cron *inside* n8n. A trigger would put an n8n URL and secret in the database and lose rows silently when the hook is down. |
| Workflows are **specified in `n8n/*.md`, built by the client** in the n8n UI | Keep the spec, the test payload and the expected output in the repo even though the workflow itself lives in n8n. |
| **Safety invariants live in the route and (later) in DB constraints — not in an n8n Code node** (31 Jul) | A Code node is edited in a UI without review. `consent_status`, `active`, the 18+ gate and initials-only must be impossible to bypass, so they belong in `CHECK`s and defaults. |
| **A saved card can be corrected field-by-field** (31 Jul) | Tapping a recap row re-asks that one step, seeded with the current answer, and re-saves under the same `client_id` (so the backend upserts). Adding a *skipped* field afterwards is still not possible. |
| **No query parameter changes app behaviour** (4 Aug, reversed `?test=1`) | `?i=` and `?src=` are the only ones read, and they are the product's own link. `?test=1` and a short-lived `?reset=1` are gone: a URL that quietly changes what gets stored is a footgun for whoever forwards the link, and the client wants to walk the flow as a parent would. `is_test` stays a column — the schema, payloads and every admin count still filter on it, so a row can be marked from the admin side or by a seed script. **Consequence to accept:** our own walkthroughs now look like real contributors, so clear them from the database rather than relying on a flag. |
| **The anonymous path never sees a Founding claim** (4 Aug) | The entry screen tells them in so many words that they give it up. The completion screen showed the badge anyway, which was the app contradicting its own promise on the last screen they see. `wants_founding === false` now drives the badge and the "what happens next" copy. |
| **Admin = one shared password + pick who you are** (31 Jul) | Client asked for 1–3 admins, one password, no roles. But the audit trail must name a person, so sign-in also selects the actor. Closed entirely unless `ADMIN_PASSWORD` **and** `ADMIN_USERS` are set. |
| **All admin data goes through two endpoints** (31 Jul) | `/api/admin/query` and `/api/admin/action` → n8n `admin_read` / `admin_write`. One write path means one place that cannot forget the audit row. Contract: `web/lib/admin/types.ts`. |
| **Recording caregiver consent requires evidence** (31 Jul) | Method is mandatory; a call or in-person yes also needs a note, because that note is the only artefact. Enforced in the route, not just the form. |
| **Pando never contacts a nominated caregiver** (3 Aug, July question set) | Reverses the earlier "admin-only number, deleted if they decline" design. We collect no contact details at all — the nominating parent sends an invite we generate (`lib/caregiver-invite.ts`), and nothing about the caregiver is stored until they set up their own profile. `contact` / `caregiver_phone` are refused by the save route even if an older client sends them. |
| **The closing question is routed, never just banked** (3 Aug) | D1 classifies into ordinary / peer-support / high-stakes (`lib/demand.ts`). Peer support gets an in-flow answer and is stored only on an explicit yes; health-legal-safety gets professional resources immediately plus an admin flag. Category taps drive it; a keyword scan can only *escalate*, never de-escalate. |
| **Founding activates on the 2nd approved contribution** (3 Aug) | Not on submission, and not on finishing the form. The completion screen says "in review" and promises a text when it activates. Secondhand contributions are welcome but never qualifying. |
| **Nothing is stored until the phone is verified** (3 Aug) | Client's rule, verbatim: "if they abandon at OTP, nothing persists". The founding path holds the profile *and* every card on the device and flushes them in one pass after the code — contributor, cards, completion. Enforced in `lib/server/gate.ts`, not only in the UI. The anonymous path posts as it goes and carries no founding status. |
| **Registered SMS copy is verbatim and versioned** (3 Aug) | `lib/sms-templates.ts`. The verification text is A2P sample #3; the client said "production must match". Rewording it means re-registering the sample. Carrier-console settings live in that file's header — opt-in keywords **START and UNSTOP only** (YES removed, because "yes" is an answer to a Network Ask). |
| **One SMS send layer, inert until provisioned** (3 Aug) | `lib/server/sms.ts` is the only caller of Twilio, always through the Messaging Service SID, never a bare number. Unprovisioned ⇒ `{sent:false, reason:"not_provisioned"}` and the UI says text verification isn't switched on yet — the same honesty rule as `persisted:false`. |
| **Single-select chips behave like radios** (3 Aug) | Tapping the chosen chip keeps it chosen. Deselecting cleared the pre-set monthly allowance on the first tap, which is the opposite of what the tap means. |
| **A caregiver card can be held, not dropped** (3 Aug) | "Wouldn't hire again" and any private note keep the card but flag it for a human, and the parent is told so on the spot. The hold is re-derived in the route from the answers — the client can add one, never remove one. |
| **Pay band and pay-benchmark consent are two decisions** (3 Aug) | Client asked for a separate checkbox. Unanswered = no. `pay_benchmark_consent` is a boolean the route sets; the band is stored either way for admin context. |
| Admin is **desktop-first** (the only surface that is) | It's a tool for one or two people at a laptop. It still must work on a phone: nav and tables scroll inside themselves, never the page. |

## Invariants (breaking one is a product-level bug)

1. A caregiver appears in a user-facing answer **only** if `consent_status = consented`
   **and** `active = true`, enforced at the query level.
2. **No minors.** A nomination under 18 is discarded, not stored as pending.
3. Never present public information as human trust. Labels are **verbatim** from the
   spec and read the *source*, never who typed it.
4. A "vouched / validated by a parent" label requires `provenance = parent_submitted`
   **and** a real contributor behind it.
5. Contributor-protection numbers are enforced **in code**: monthly cap (3/5/10/20,
   default 5), hard 48-hour gap, response-rate governor at 25%/30 days.
6. All outbound SMS goes through one compliant send layer (`lib/server/sms.ts`):
   opt-out → quiet hours 8:00–21:00 PT → frequency → throttle → provider, in that
   order. No raw Twilio calls anywhere, n8n included, and always via the Messaging
   Service SID.
7. Never log phone numbers, names or free text. Counts and enums only.
8. Free text about a named person is never published verbatim without human review.
9. "Other" answers are not matchable until an admin promotes them into
   `market_options`.
10. One person, one identity, keyed by phone. "Contributor" is a derived status, not
    a second table.
11. **Nothing about a named parent is stored before their phone is verified.** The
    device holds the profile and the cards; the write routes refuse them without a
    confirmed code. `phone_verified` is a server fact read from the verification,
    never a field the client can set.
12. A caregiver's private note — and the reason behind a hesitant "would you hire
    them again" — never leaves the admin surface, in any form.
13. **No contact details for a nominated caregiver are ever collected or stored.**
    The only path in is the invite the nominating parent sends themselves.
14. A caregiver nomination is firsthand-only: the family must have employed them.
    A secondhand one is refused, not stored as a weaker record.

## Where the logic lives

`web/lib/questions.ts` — the profile questionnaire (order, gating, weights, P3–P14).
`web/lib/demand.ts` — D1 routing: what Pando says back to which kind of question.
`web/lib/caregiver-invite.ts` — the message the parent sends themselves (C11).
`web/lib/seed-chat/scripts.ts` — the capture conversations.
`web/lib/derive.ts` — answers → affinity / relevance / pending-option rows.
`web/lib/consent.ts` — consent wording + version. Bump the version, never edit text.
`web/lib/sms-templates.ts` — **registered** SMS copy. Verbatim, versioned.
`web/lib/server/sms.ts` — the only outbound SMS path (compliance order lives here).
`web/lib/server/verify.ts` + `gate.ts` — OTP store and the "nothing until verified" gate.
`web/lib/submit.ts` — what the device holds, and the one flush that sends it.
`web/lib/market-options.ts` — **placeholder** Pasadena taxonomy, awaiting Janet's sheet.
`web/components/ui/Screen.tsx` — the app shell (phone + desktop).
`web/components/site/Shell.tsx` — the public-site shell.

Adding a question should touch one data file and nothing else.

## Keeping this file current

Do this **in the same turn** as the change, not later:

1. **New functionality** → update the status table, and add a row to *Decisions* if a
   choice was made that a future session could unknowingly undo.
2. **A client answer or a new document** → reconcile
   [docs/spec-compliance-review.md](docs/spec-compliance-review.md) (matches /
   deviations / open questions) and note the date.
3. **A new invariant or a new safety rule** → add it to Invariants, and to the
   relevant `.claude/skills/*` if it changes how UI gets built.
4. **A new route, hook or payload** → `web/README.md` (routes table + payload shape)
   and `.env.example`.
5. **Copy changed by the client** in the root `*.html` → port it into `app/(site)/*`
   and record the terminology in Decisions.

Rule of thumb: if the next session would be surprised by it, it belongs here.
