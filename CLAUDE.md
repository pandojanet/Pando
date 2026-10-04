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

**Claude Code writes the app · the developer specifies pages · the app owns the
backend.** So:

- Everything the browser touches is our Next.js app: pages, route handlers,
  validation, sanitising, secrets.
- Business logic is TypeScript in `lib/server/repo/*`, running in the same
  process. `lib/server/db.ts` is the **only** file that knows a connection
  string.
- Unset `DATABASE_URL` ⇒ the route answers `persisted: false` rather than
  pretending. That honesty rule survived the move off n8n and is what makes the
  flow walkable before there is a database.
- Postgres is Supabase, reached over the **pooler** (IPv4). The direct host is
  IPv6-only without the paid add-on and an IPv4 VPS cannot use it — the same
  constraint that once forced an HTTP transport for n8n.
- The n8n instance still runs on the box and still hosts other work; nothing in
  this app talks to it.

## Repo map

```
CLAUDE.md            this file
README.md            how to run it
DEPLOY.md            GitHub → GHCR → VPS pipeline
docs/
  spec-compliance-review.md   built vs. every client document, + open questions
  qa-checklist.md             M4 — how to test both flows, in order
  test-plan-by-estimate.md    the same ground indexed by estimate row, incl. ⬜ ones
  phase-2-test-plan.md        the SMS product, through the Slack relay: the three
                              doors that send anything, the conversation loop, a
                              question end to end, blasts, freshness, money — plus
                              what is deliberately absent and the switch-off list
  2c-caregiver-flow.md        why the caregiver flow is a claim, and how to test it
supabase/            seed data for the tap lists (supabase/README.md)
web/drizzle/         the migrations, one file per change — `ls web/drizzle` for the
                     list. Never edited in place: drizzle hashes them, and an edit
                     desynchronises every environment silently.
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

Lives in [docs/status.md](docs/status.md) — what is built, per estimate row, with
its test suites. Read it before saying what state a feature is in; update it in
the same turn as the change.

## Decisions already made — do not silently revert

Live in [docs/decisions.md](docs/decisions.md) (~400 rows, newest first). It is too
large to load every session, so the rule is: **before changing behaviour, copy, a
number or a flow in any area, `grep -n` docs/decisions.md for that area** (the screen,
the table, the env var, the client's word for it) and read the matching rows. A
decision recorded there is not reverted silently — if the change contradicts one,
say so and add a new row saying what changed and why.

## Phase 2, before any of it

Reconciled 27 Aug against *Pando Strategy — Current Direction* (Aug 2026), the
QC Strategy Reconciliation 8.18, and `Pando_Estimate_v3.2_updated.xlsx`
(M5–M15). Three things a future session must not discover the hard way.

**Two pieces of scope are in the strategy and in no estimate row.** Searched, not
assumed: `digest`, `grove`, `leaves` and `leaf` return **zero** matches in the
workbook. (a) *The Pando Digest* (§10) — a scarce, event-triggered SMS that reads
like a well-connected friend, with layered access (headlines free, depth for
members, and "answer one board question and the week's Digest opens fully"). The
strategy calls it "primarily a retention engine … likely the strongest habit
mechanism we have", so it is not a nice-to-have that fell off a list. (b) *The
grove* (§13) — a private per-contributor ledger where a leaf converts at posted
rates (5 = a free Targeted Ask · 15 = a month of Pando+ · 40 = a year), with
impact receipts and earned statuses, and **no leaderboard ever**. M9 covers the
thanks loop, impact tracking and tiers, which is adjacent but is not a ledger with
a published exchange rate. Both need quoting before they are built.

**The open board is a surface, not a feature of Blast.** §3 and §8 describe a
once-a-day digest of anonymous questions that opted-in parents browse and answer,
priced as the $5 Board Ask, with a rule attached that shapes the whole allowance
model: **answering on the board never spends the monthly allowance, and still
counts as giving** (§7). M7 is written around a targeted blast; nothing in it is
this.

**The tiers are named and priced.** Passive (free) · Board Ask $5 · Targeted Ask
$15 · Last-Minute Care (free during the pilot, strongest neighborhoods only), and
every paid Ask is guaranteed — no useful answer in the window, automatic credit.
The first Targeted Ask is free, deliberately: the pilot's real question is whether
she pays for the *second*.

**Four areas have no neighbour, and that is correct.** `drizzle/0018` seeds 29
pairs; Whittier, San Dimas, Glendora and West Covina are selectable neighborhoods
with curated starters and touch nothing else on the list, because on the ground
they do not. A parent there gets no adjacency credit, which is the honest answer
rather than an omission — and the migration cannot be annotated after the fact,
since drizzle hashes it.

**Three client answers, 27 Aug.** (1) The A2P campaign is **approved** — Twilio
provisioning is unblocked, and the ordering rule in the dev-codes decision applies
now: add the three `TWILIO_*` values first, remove `SEED_VERIFY_DEV_CODES` only
after. (2) **A contribution enters the graph only after approval** — already true
in code rather than a change to make: `shares_answerable` requires
`s.status = 'approved' AND sc.status = 'approved'`, so this closes open question 8
of docs/spec-compliance-review.md by confirming the build. (3) The contest
threshold stays undecided and is **not material for now**, so the app continues to
invent no rule.

| **The admin's interaction primitives are the platform's, not a library's** (13 Aug) | `components/admin/kit.tsx` — `Hint` · `Select` · `SegmentedFilter` · `Menu` · `Dialog`. It began as thin wrappers over **Radix**, which was the right instinct (no styles shipped, so Pando's tokens stay the design language — MUI or Chakra would have brought their own) and the wrong trade **here**: six packages compiled to a **102 KB chunk, 34 KB gzipped, on every admin page**, for five controls used by one or two people at a laptop. Measured before and after, not assumed. The mechanics now come from the platform, which has caught up with what the library was for: `<dialog showModal>` (focus trap, Escape, inert background, focus restored), the **Popover API** (top layer, light dismiss), a native `<select>` (typeahead and the OS wheel on a phone), and `role="radiogroup"` with a roving tabindex. `lucide-react` stays — per-icon tree-shaken, five icons. **The property being bought in both cases is the top layer**, and it is the reason a hand-rolled overlay is not an option: CLAUDE.md's 5 Aug bug is that `position: fixed` inside a *filled* animation is clipped to that element forever, and every admin card is inside animated content. **Two bugs this cost, both found in a browser and neither visible in review.** (1) A `popover` is `display: none` until `showPopover()`, so measuring it in a layout effect reads **0×0** — a menu opened from a card below the fold was positioned as though it had no height and landed at y=816 in an 812px viewport, entirely off-screen. Placement now runs *after* the show, and again on the next frame. (2) **`dialog.close()` fires no `close` event in one of the browsers this admin is walked in** — the element shut, React went on believing it was open, the scroll lock was never released and the note could not be reopened. So React closes it rather than reacting to it having closed: `cancel` and a keydown are both intercepted, and the `close` listener stays as belt and braces. |

## Invariants (breaking one is a product-level bug)

1. A caregiver appears in a user-facing answer **only** if `consent_status = consented`
   **and** `active = true` **and** `discoverable = true` **and** `is_adult`,
   enforced at the query level.

   **The two extra conditions are not padding.** This invariant was written with
   two, and `discoverable` is a separate rung of the ladder (mentioned → invited
   → consented → discoverable → introducible, 11 Aug) because *consent is not
   visibility*: a caregiver can agree to be listed and decline to appear in
   answers, and 2C makes that a real supported outcome. Measured against the demo
   cohort on 27 Aug: of ten caregivers, **three** pass `consented AND active` and
   only **two** also pass `discoverable` — so the invariant as written would have
   surfaced one caregiver who had said no to exactly this. `is_adult` is
   invariant 2 restated at the point of use. `introducible` is deliberately not
   part of it: being in an answer and being introduced are different amounts of
   exposure.
2. **No minors.** A nomination under 18 is discarded, not stored as pending.
3. Never present public information as human trust. Labels are **verbatim** from the
   spec and read the *source*, never who typed it.
4. A "vouched / validated by a parent" label requires `provenance = parent_submitted`
   **and** a real contributor behind it.
5. Contributor-protection numbers are enforced **in code, never by judgement**:
   monthly cap (**5 or 10, default 5, or `as_relevant` = no fixed cap** — the
   18 Aug reciprocity numbers; the spec's older 3/5/10/20 ladder is superseded and
   `allowance_shape` refuses anything else), a **48-hour gap** (see below —
   it has moved twice), response-rate governor at
   25%/30 days, and (v3.2 §10) at most one freshness ping per contributor per
   month, never on the same day as a blast.

   **The gap is 48 hours, and this is its second move.** Track the documents by
   date, because reading any one of them alone gives the wrong answer:

   - spec §14 and estimate row 8.2 (*titled* "48-hour gap") — **48 hours**;
   - *Pando Strategy — Current Direction* (8.18) §6 and §7 — **five days**,
     twice, with a rationale ("so 'five a month' describes a real ceiling rather
     than a burst"). Adopted 27 Aug under this file's rule that the newer client
     document wins;
   - **Seed Feedback, 1 Sep, item 18 — 48 hours, three times.** Once as an
     instruction ("Apply the 48-hour gap across all contribution requests. Pando
     should never send more than one request within 48 hours") and twice inside
     the participation page copy she wrote. Newest document, so it wins in turn,
     and `OUTREACH_GAP_DAYS` is 2.

   There is a second reason beyond recency, and it is what makes this
   unambiguous rather than a coin toss: **the allowance screen has been telling
   parents "with a 48-hour gap" since 18 Aug**, and her page copy repeats it.
   Enforcing five days behind copy promising two was not a broken promise — a
   parent received fewer messages, not more — but the number a parent agreed to
   and the number the code kept were different, and only one of them was written
   where she could read it. One named constant, so it is changed in one place;
   `npm run test:outreach` and `test:compliance` both pin it, so a session
   reading only the 8.18 strategy cannot halve the request rate again.

   **Phase 2**: nothing sends yet, so
   nothing enforces them yet. What exists today is where they go —
   `lib/server/sms.ts` runs opt-out → quiet hours → *frequency* → provider, and
   `monthly_contact_allowance` is captured from the parent (P14) and stored. The
   invariant is that the first code that sends a blast implements the middle step;
   it is listed here so that code cannot be written without meeting it.
6. All outbound SMS goes through one compliant send layer (`lib/server/sms.ts`):
   opt-out → quiet hours 8:00–21:00 PT → frequency → throttle → provider, in that
   order. No raw Twilio calls anywhere, and always via the Messaging
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
`web/lib/home-places.ts` — where a parent lives: her §5 place list and the
                       ZIPs that reach it. A ZIP names a place only
                       sometimes — 15 of 62 are shared — so the resolution
                       is many-to-many both ways. Pure; `places:sync` puts
                       the same places into `market_options`.
`web/lib/geo.ts` — reading what Google said about a place **or an establishment**,
                       and **refusing to
                       type it**: `locality` cannot tell an incorporated city
                       from an unincorporated one, and 16 of her 52 places are
                       unincorporated. Pure, so `npm run test:geo` loads it.
`web/lib/server/geocode.ts` — the **only** place Pando talks to Google, and since
                       16 Sep it makes **two** requests: Geocoding for a town or a
                       ZIP, Places Text Search for a named school, class, club or
                       place of worship. One caller, `fetch`, no SDK; the cost guard and the cache
                       live here, and no key answers `not_configured` rather
                       than an empty result.
`web/lib/demand.ts` — D1 routing: what Pando says back to which kind of question.
`web/lib/seed-gate.ts` — link-only access: the marker cookie, and which screens
                       need it. `proxy.ts` issues it on `/join` and enforces it
                       on the rest. Not authentication — see Decisions.
`web/lib/caregiver-invite.ts` — the message the parent sends themselves (C11).
`web/lib/server/repo/parent-delete.ts` · `app/api/seed/delete/route.ts` — the
                       **one** "remove me", reached by the web control *and*
                       by texting DELETE since 14 Sep. —
                       a parent removing their own profile (§1). One
                       `delete from people`: the person cascades, what they
                       contributed is detached and stays. The phone comes
                       from the verification; there is no request body.
`web/lib/server/repo/referral.ts` — a parent's own link, and who referred whom.
                       A `personal` `invites` row rather than a table of its
                       own, so it inherits attribution, the cache and the funnel.
`web/components/seed/ProfileDepth.tsx` — how full a profile is, and why filling it
                       in is worth a parent’s time. Measured by `profileDepth`,
                       which is **not** the stored `profileCompleteness` — see
                       Decisions.
`web/components/seed/ReferralInvite.tsx` — that link on screen: the popup over
                       `/share`, the panel on `/done`, one icon copy button.
`web/components/seed/SignIn.tsx` · `web/app/api/seed/me/route.ts` — coming back
                       with a number and a code. The phone is read from the
                       verification the server recorded, never from the request.
`web/lib/caregiver-flow.ts` — 2C: the caregiver's own questions (G1–G10), as data.
`web/lib/caregiver-options.ts` — the option lists **both** caregiver surfaces share.
`web/lib/server/repo/caregiver.ts` — 2C: writing a claim, in one transaction,
                       and `deleteCaregiverClaim` — the **one** copy of the
                       cascade both the admin button and DELETE run.
`web/components/admin/Standing.tsx` — M14.4. Counters, response rate, tier and
                       limits. A third view on the contributors page, and the
                       first thing that ever read `lib/tiers.ts`.
`web/app/(admin)/admin/impact/page.tsx` — M14.6. 9.1 joined to 9.2, so "helped
                       but never thanked" is visible at all.
`web/app/(admin)/admin/freshness/page.tsx` — M14.9. Retire it, or keep it
                       marked old. The two write actions the flag never had.
`web/lib/outreach-policy.ts` — M8. The four contributor-protection rows as pure
                       rules: the 48-hour gap, the 5/10/as-relevant ceiling, the
                       25%/30-day governor, the ping limits, and the SETTINGS
                       exchange. No runtime imports, so `test:outreach` loads it
                       in plain node — and most of its checks assert a refusal.
`web/scripts/stage-outreach.mjs` — `npm run stage:outreach` — the rows that make
                       the gap and the governor fire, so they can be walked
                       without waiting a month. Asserts nothing: every
                       judgement is left to production code.
`web/lib/rate-limits.ts` — M15.4. How often one caller may hit each public
                       endpoint, and **which `X-Forwarded-For` entry is
                       actually theirs**. Pure; imports nothing.
`web/lib/server/rate-limit.ts` — the counters, and the one line a route adds.
                       In-process, which is honest about needing to move the day
                       there are two containers.
`web/lib/sms-segments.ts` — M13.3. What a message actually costs to send, and
                       where it breaks. One character outside GSM-7 halves the
                       budget; this measures and never rewrites registered copy.
`web/lib/payments.ts` — M13.5–13.7. Whether a refund is coherent and whether the
                       guarantee is owed. Imports **nothing** — `paymentFor`
                       lives in `blast-tiers.ts` beside the prices, for that
                       reason (see Decisions).
`web/lib/stripe-signature.ts` — M13.6. Verifying a payment webhook, including
                       the replay tolerance the Twilio verifier has no
                       equivalent of.
`web/lib/server/stripe.ts` — the **only** place Pando talks to Stripe: a
                       checkout session and a refund, over `fetch`, inert until
                       `STRIPE_SECRET_KEY` is set.
`web/lib/server/repo/payments.ts` — the writes behind a paid Ask. Idempotent by
                       `where` clause, because Stripe is not.
`web/lib/server/repo/retry.ts` — M13.4. Which failed messages are worth sending
                       again, and rebuilding the three that can be.
`web/app/api/stripe/webhook/route.ts` — the only evidence of payment this app
                       accepts. A success page cannot activate a blast.
`web/app/(admin)/admin/blasts/page.tsx` — M14.3. The Ask, its pool before it
                       goes out, and the two verbs nobody could reach: mark it
                       answered, flag a refund. Cannot send.
`web/app/(admin)/admin/payments/page.tsx` — M14.5. What was paid and what is
                       owed. Leads with whether Stripe is switched on at all.
`web/lib/pending-question.ts` — what Pando says when it cannot read a
                       message, how much of the exchange it remembers, and when
                       to stop asking and fetch a person. Pure.
`web/lib/server/repo/pending-question.ts` — the turns themselves
                       (`drizzle/0035`), the only place SMS conversation text
                       is kept.
`web/lib/server/web-search.ts` — what is generally known about a question,
                       from the open web. Public labels only, never a person,
                       never for a question about care, off by default.
`web/lib/public-info.ts` — reading what came back. Pure, so a node test can
                       load it; every branch drops rather than repairs.
                       `npm run probe:web-search` is the live matrix behind it
                       — ten questions across contexts, through the real pipeline.
`web/lib/named-person.ts` — M11.4. Is this record's *name* a person? Pure, two
                       thresholds, and measured against all 588 real records.
`web/lib/seed-chat/scripts.ts` — the capture conversations.
`web/lib/trust-labels.ts` — M5.6. The approved wording, verbatim, plus the
                       freshness ladder and the guard that public information
                       never wears a parent label. Pure.
`web/lib/server/repo/retrieval.ts` — M5.5. What could answer a question, with
                       invariant 1's four conditions in the WHERE clause.
`web/lib/server/inbound.ts` — what Pando does with an inbound message, whatever
                       carried it. Extracted from `/api/sms/inbound` when the
                       Slack relay gave it a second door; the transports keep
                       only the signature check and "which number is this".
`web/lib/slack-text.ts` — what Slack's event `text` actually contains, undone:
                       tel links, labels, entities, and the address prefix. Pure,
                       imports nothing, and tested — the regex used to live in the
                       route with a **copy** of itself in the suite.
`web/lib/server/slack.ts` · `web/lib/slack-signature.ts` — the **temporary**
                       test transport standing in for Twilio, and its signature.
                       One channel, threads as addresses, verification excluded.
`web/lib/server/repo/relay.ts` — who a relay message is for and which thread it
                       belongs in. Resolves by phone when there is no person id,
                       because that is how SMS addresses everything.
`web/lib/matching.ts` — M6. The two-layer scorer, and the **only** copy of the age
                       ladder. Pure, and deliberately free of *runtime* imports so
                       `npm run test:matching` can load it in plain node.
`web/lib/server/repo/matching.ts` — the one query that feeds it. Weights from the
                       table every call; the pool bounded by the asker's edges.
`web/app/(admin)/admin/matching/page.tsx` — 6.7. The harness: who Pando would
                       ask, why, and at what weights — the coefficients are
                       editable here since 2 Sep (`matching.weight`, audited).
                       Still cannot send: config, never outreach. Each row is
                       the arithmetic behind its own score.
`web/lib/admin/url-state.ts` — the filter a page is on, in the address bar. What
                       makes a worklist row able to point at a *tab*.
`web/components/admin/QuickFind.tsx` — `/` from anywhere: find a parent and open
                       their page. Ranks with `lib/admin/person-search.ts`.
`web/components/admin/PersonPicker.tsx` — finding one parent among hundreds. A
                       real combobox, because a search box on top of a `<select>`
                       is two controls doing one job.
`web/lib/admin/person-search.ts` — what counts as a match and what ranks above
                       what. Pure, because a search rule fails silently
                       (`npm run test:person-search`).
`web/components/admin/ui.tsx` — the admin's *look*: `ResultNote`/`ErrorNote` (the
                       one way a page reports what an action did — nine
                       hand-written copies before, and none of them announced),
                       `Badge` (with `hint`, the reachable replacement for a
                       `title`), `Toolbar`, `Explainer` (closed since 3 Sep — hover peeks, a click pins), and `controlClass` vs
                       `inputClass` — one look, with and without a width.
`web/components/admin/kit.tsx` — the admin's *mechanics*, on platform primitives
                       rather than a component library: `Hint` · `Select` ·
                       `SegmentedFilter` · `Menu` · `Dialog`. See Decisions for
                       what that swap cost and what it bought.
`web/components/admin/Record.tsx` — the admin's second layout, for the queues a
                       table cannot hold: `RecordCard` · `FactGrid`/`Fact` ·
                       `SpecList`/`Spec` · `Quote` · `RecordGroup` ·
                       `RecordDrawer`. Which one a page uses is a property of
                       its data, never a preference — see Decisions.
`web/components/ui/OptionPicker.tsx` — the searchable dropdown the circles
                       questions use. Which control a question gets is a
                       property of its options: a directory here, a short closed
                       set in `ChipGroup`.
`web/components/ui/TextAction.tsx` — the quiet 44px action beside the loud one,
                       and `InlineAction` for a link inside a sentence. One box
                       for `<button>` and `<a>` alike, which is the whole point.
`web/components/ui/Panel.tsx` — the block on a flow screen. `tone` is what it
                       means, `raised` is the one card the screen is about.
`web/components/ui/Screen.tsx` — the app shell (phone + desktop).
`web/components/site/Shell.tsx` — the public-site shell.

Adding a question should touch one data file and nothing else.

## Keeping this file current

Do this **in the same turn** as the change, not later:

1. **New functionality** → update [docs/status.md](docs/status.md), and add a row to
   [docs/decisions.md](docs/decisions.md) if a
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
