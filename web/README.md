# Pando — web

One Next.js app holding two things: the **public site** (pando.is) and the
**Seed Tool** (Phase 1 contributor app — mobile-first, tap-first, no login).

Built so far — **estimate 1.1** (landing / invite + QR entry), **1.2** (tap-first
profile), **1.4** (chat-seeding interface, including the structured capture cards
for activities, caregivers, places and tips) and **1.7** (completion screen with the
versioned follow-up consent), plus the four marketing pages ported from the static
HTML that used to live at the repo root.

A line-by-line [spec compliance review](../docs/spec-compliance-review.md) of
this build against every client document sits in [`../docs`](../docs). All
frontend logic is complete and exercised end to end; the backend runs in this
same app (`lib/server/repo/*`) and waits only on a `DATABASE_URL`.

```bash
npm --prefix web install
npm --prefix web run dev     # http://localhost:3000 · seed tool: /join?i=sgv-founding
```

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · TypeScript.
The spec names Next.js 14; 16 is the current stable line, same App Router model.

## Routes

Two route groups. `app/(site)` is public and indexable; `app/(seed)` is the
invite-only tool and carries `noindex, nofollow` for the whole group.

| Route                    | What                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| `/`                      | Marketing home: hero, how it works, asks, founding band, FAQ.               |
| `/about`                 | Why "Pando" — the story page.                                               |
| `/privacy`               | Privacy policy.                                                             |
| `/terms`                 | Text messaging terms.                                                       |
| `/join?i=<code>&src=qr`  | Invite landing. Validates the shared code server-side; optional name/phone. |
| `/profile`               | The 8-screen tap-first profile + review.                                    |
| `/share`                 | Chat-seeding: share menu, capture cards, add-another loop.                  |
| `/done`                  | 1.7 screen 1 of 3 — badge, thank-you, what they shared. Tells only.          |
| `/done/ask`              | 1.7 screen 2 of 3 — D1, follow-up consent, OTP gate. The only one that writes. |
| `/done/next`             | 1.7 screen 3 of 3 — what happens next, D2 referral, return links.           |
| `POST /api/seed/invite`  | Validates a hand-typed code.                                                |
| `POST /api/seed/profile` | Sanitizes, then writes person + children + affinities + relevance + schools in one transaction. |
| `POST /api/seed/save`    | Sanitizes, then writes one capture card — a caregiver's nomination and its restricted notes land together or not at all. |
| `POST /api/seed/complete`| Records completion: follow-up consent + `pending_founding` status.           |
| `POST /api/seed/verify/start` | Texts a 6-digit code (needs the consent checkbox). `{sent:false, reason:"not_provisioned"}` until A2P approval. |
| `POST /api/seed/verify/check` | Confirms the code. Until this succeeds, the three routes above answer 401 for any named parent. |
| `/admin/login`           | Shared password + pick who you are (so the audit log has a name).            |
| `/admin`                 | Overview: completion, two-or-more rate, drop-off, quality queues.            |
| `/admin/founding`        | Founding approval queue — cards, bulk-approve per link.                     |
| `/admin/contributors`    | List + detail (taps, derived profile, cards, transcript, notes).             |
| `/admin/activities`      | Review with confidence filter, edit, approve/reject.                        |
| `/admin/caregivers`      | Consent state machine with evidence + duplicate candidates.                 |
| `/admin/options`         | Promote "other" answers into the tap lists.                                 |
| `/admin/flags`           | Escalations first, then review queue.                                       |
| `/admin/audit`           | Who changed what, with a before → after diff.                               |
| `POST /api/admin/query`  | One read endpoint for every admin page → `lib/server/repo/admin-read.ts`.    |
| `POST /api/admin/action` | One write endpoint → `admin-write.ts`; the audit row is written in the same transaction as the change. |
| `POST /api/admin/extract` | The 1.8 catch-up sweep: scores contributions the inline pass missed. |

Flow: `/join` → profile → review → **chat** → done. A parent can leave at any
point and pick up where they left off on the same phone.

Add `&test=1` to the entry URL for a QA run: every payload carries `is_test: true`
and a gold TEST tag shows on every screen.

Redirects in `next.config.ts` keep every old URL alive: `/about.html` → `/about`
(and the rest), and `/?i=<code>` → `/join?i=<code>` so invite links already
forwarded around parent group chats still land in the right place.

## Where the logic lives

| File                    | Responsibility                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| `lib/questions.ts`      | The questionnaire: order, required fields, age gating, weights, screens.  |
| `lib/market-options.ts` | **Placeholder** Pasadena taxonomy → `market_options` rows.               |
| `lib/derive.ts`         | Answers → `social_affinities` / `life_relevance` / `pending_options`.     |
| `lib/storage.ts`        | Autosave + resume (localStorage, versioned key).                         |
| `lib/analytics.ts`      | Funnel events, PostHog-shaped, provider not yet attached.                |
| `lib/server/invite.ts`  | Shared invite codes → market.                                            |
| `lib/server/db.ts`      | **The only place a connection string exists.**                           |
| `lib/db/schema.ts`      | The data model, and every CHECK that encodes an invariant.               |
| `lib/server/repo/*`     | The backend: profile, cards, completion, flags, admin read/write.        |
| `lib/server/extract.ts` | 1.8 — the only file that talks to an AI provider.                        |
| `lib/seed-chat/scripts.ts` | The capture conversations: steps, widgets, fields, recap order.        |
| `lib/seed-chat/engine.ts`  | Pure turn logic: next step, answer formatting, recap, submission.      |
| `components/ui/*`       | Chips, dock, sheet, progress, desktop frame — the primitives.             |
| `components/seed/*`     | Landing, profile flow, completion.                                       |
| `components/seed/chat/*`| Transcript, share menu, step widgets, card recaps.                       |
| `components/site/*`     | Public-site shell (header, footer, wrap, buttons) and the hero phone mock. |

Adding or reordering a profile question is a change to `lib/questions.ts` alone;
adding or reordering a capture question is a change to `lib/seed-chat/scripts.ts`
alone. Nothing in the components knows what the questions are.

## Presentation

**Icons.** Three files, because no single format covers every place an icon is asked
for. All of them draw the `PandoMark` leaf path verbatim (`components/ui/Logo.tsx`),
with a heavier stem and dots than the component uses — at 16px the original weights
disappear.

| File | For | Notes |
| --- | --- | --- |
| `app/icon.svg` | the browser tab | Hand-written. Has its own `prefers-color-scheme` branch (green/ink → gold/paper, the mark's `tone="light"` treatment). Declared `sizes="any"`, so modern browsers prefer it. |
| `app/favicon.ico` | legacy clients, crawlers, link unfurlers | 16/32/48 PNG-in-ICO. Exists because some clients request `/favicon.ico` directly without reading `<link>`. Next declares it at a concrete size, which is what keeps it *behind* the SVG. |
| `app/apple-icon.png` | iOS "Add to Home Screen" | 180×180. Safari ignores SVG icons here. |

The two raster files are generated: `node scripts/make-icons.mjs`. Run it after any
change to the mark or the palette.

Two traps worth knowing before editing these, both of which fail loudly but not
obviously:

- **The ICO's embedded PNGs must be RGBA.** Turbopack reads the file to get its
  dimensions and its decoder rejects RGB with *"The PNG is not in RGBA format!"*,
  which takes the dev server down. The script keeps the alpha channel for the ICO and
  drops it for the touch icon (a transparent apple-icon renders as a black square on
  the home screen).
- **`icon.svg` is parsed as XML.** A double hyphen inside an XML comment is illegal,
  so writing a CSS custom property name in the comment the way you would in
  TypeScript stops the file loading as an image. It looks fine when injected into a
  page — that path uses the lenient HTML parser.

Literal brand hex in these files is correct, not an oversight: an icon is fetched as
its own document and never sees `globals.css`.

**Seed Tool.** Phone is the design target, and the phone layout is the one in
`components/ui/Screen.tsx` by default: sticky header, window scroll, sticky dock
under the thumb.

From `md` it becomes a desktop app layout rather than a phone in a frame — the
device mock is gone, along with the nested scroll container it needed:

- content column widens to `40rem`, so a 20-item chip list fits without scrolling
  anything;
- the dock drops into page flow (`ScreenDock`) — a floating bar is a phone idiom
  and costs half a laptop window. The entry screen opts back in with
  `stickyOnDesktop`, because its CTA is the whole point of the page;
- chip scrollers uncap (`md:max-h-none`), the share menu goes four across, the age
  grid seven across, the entry promises three across.

From `lg`, `components/ui/BrandPanel.tsx` becomes a full-height sidebar carrying
context for the step the parent is on — what this step is for, what's protected,
and a named three-step rail (`Your profile → What you know → Done`). It picks the
panel from the pathname, so pages don't opt in.

Nothing above `md` reaches the phone layout: every rule is behind `md:`/`lg:` or in
a component that doesn't render below `lg`.

**Public site.** A normal responsive website — `components/site/Shell.tsx`, not the
phone frame — and a deliberately different layout per breakpoint rather than one
stretched column. On `lg` and up each content section puts its heading and intro in
a sticky left rail (`SectionGrid`), the legal pages get a sticky title rail plus a
section index with the text capped at ~75 characters a line (`DocShell`), the story
page lets pull quotes and cards step into the margin, and the hero picks up an
ambient wash. On a phone all of that collapses to the stacked, full-width layout
the pages were designed at first. The four pages were ported to
JSX rather than dropped into `public/`, so they share the design system instead of
re-declaring a palette and re-downloading fonts. Legal body copy is styled by one
`.legal` block in `globals.css` so those pages stay close to plain HTML that a
non-engineer can edit.

The original `index.html`, `about.html`, `privacy.html` and `terms.html` are gone
— the four routes above replace them, and `next.config.ts` redirects the old URLs.

## Deployment

Docker image → GHCR → our VPS, on every push to `main`. See
[`../DEPLOY.md`](../DEPLOY.md) for the pipeline, the server setup and the
secrets it needs. `next.config.ts` sets `output: "standalone"` for that image;
`GET /api/health` is the liveness probe.

## Analytics

`lib/posthog-provider.tsx` wraps the app in `app/layout.tsx` and, once
`NEXT_PUBLIC_POSTHOG_KEY` is set, sets `window.posthog` and fires `$pageview` on
every route change (App Router navigation doesn't reload the page, so PostHog's
own on-load capture would only ever see the first screen a parent lands on).
Unset the key and the provider is a no-op — `lib/analytics.ts`'s `track()` calls
already guard on `window.posthog?.capture`, same honesty rule as `persisted: false`
without a `DATABASE_URL`.

**Autocapture and session recording are off, deliberately** — see the comment in
`posthog-provider.tsx` and the Decisions table below. Every event the app sends
is a named `track()` call in `lib/analytics.ts` with structured props; nothing
here should be "improved" by turning either back on.

## Database

Set `DATABASE_URL` to the Supabase **pooler** connection string — see
`.env.example` for why the pooler and not the direct host. Until it is set every
write route answers `{ ok: true, persisted: false }`, so the UI can be walked end
to end without pretending anything was stored.

Migrations live in `drizzle/` and are applied with `npm run migrate` (use port
**5432** for that command — session mode; the app itself wants 6543).
`lib/db/schema.ts` is the source of truth for the schema; `supabase/README.md`
has the setup walkthrough.

The write paths, and what each guarantees atomically:

| Route | Transaction |
| --- | --- |
| `seed/profile` | person + children + affinities + relevance + schools + pending options |
| `seed/save` (place-like) | submission + place + contribution, upserted on `client_id` |
| `seed/save` (caregiver) | submission + caregiver + nomination + **its restricted notes** |
| `seed/complete` | founding status + follow-up consent + demand signal + escalation flag |
| `admin/action` | the change **and its audit row** |

The last one is the reason this is not a set of independent calls: an admin write
whose audit row failed separately would be an unattributed change to a record
about a real family.

## Decisions taken while building

- **Invite = market, not identity.** One shared link, per the estimate, so the
  code is a soft gate. A wrong or missing code shows a friendly gate with manual
  entry rather than a dead end.
- **`prefer_not_to_say` is stored, never derived.** It reaches the backend inside
  `answers` (a useful signal that the question was seen and declined) but produces
  no affinity or relevance row.
- **"Other" never becomes an affinity.** It queues in `pending_options` for admin
  promotion (spec §8.1), which means a parent whose school isn't listed gets no
  school weight until an admin promotes it. That's the spec's trade-off — worth
  re-checking after the pilot.
- **Nothing user-typed is trusted client-side.** The route handler re-validates
  ids against `^[a-z0-9_-]{1,64}$`, caps list lengths, strips control characters,
  and re-checks the two required answers.
- **Logs carry counts, never people** (spec §19).
- **The chat is scripted, not generative.** Turn-taking runs off
  `lib/seed-chat/scripts.ts`, so answers land in fields with no extraction step
  and no way for a model to invent a question. If a server-driven conversation
  ever replaces the script, it can drive the same widgets turn by turn — the UI
  doesn't change.
- **Caregiver safety is enforced on the server, not in the chat.** The save route
  rejects a nomination whose 18+ gate isn't `yes`, forces
  `consent_status: "pending"` and `active: false` whatever the client sends, and
  truncates the last initial to one character. Answering "under 18" in the chat
  discards the card outright — nothing is stored as pending.
- **Pando-owned fields are never accepted from a device.** The save route drops
  `consent_status`, `active`, `trust_level`, `status`, `approved_at`, the count
  columns and any `*_id` out of the submitted fields, so a crafted request can't
  smuggle a consented caregiver or a trust level into the record.
- **The transcript is persisted** alongside the answers (mirrors
  `seed_conversations.messages`), so a parent can close the tab mid-card and come
  back to the same conversation, and admins get the original wording later.
- **Failed card saves keep the card.** It stays in the transcript with a "saved on
  this phone only" note and a Try again button; the parent is never told
  something was stored when it wasn't.

## Open questions for the client

1. The Pasadena lists in `lib/market-options.ts` are placeholders (spec §23.2 Q10).
   Who supplies neighborhoods / schools / faith / clubs / parent groups / classes,
   and in what format? Should they be read from `market_options` at runtime
   instead of shipped in the bundle?
2. Confirmed invite code(s) for the shared link, and the domain it lives on (Q2/Q3).
3. Return visits: right now a saved profile on the same phone offers "start a
   fresh one". Once OTP exists (estimate 5.1) this should re-verify instead (Q4).
4. Is capturing first name at entry acceptable, or phone only?
5. **Places and tips.** The estimate's share menu lists activity / caregiver /
   place / tip, but the database schema (spec §15.1) only defines `activities` and
   `caregivers`. Right now a place and a tip forward as their own `kind` with their
   own fields. Do they get their own tables, fold into `activities` with a type
   column, or drop from the pilot menu?
6. Caregiver contact capture: we ask for a number and use it only for consent
   outreach. Confirm that's the intended Phase 1 behaviour rather than admin
   entering it during outreach.

## Not built yet (by design)

The caregiver's own flow (2C), the freshness-ping and matching crons, and the
PostHog provider (M3).

There are no automated tests. The eight invariant assertions in
`drizzle/0002_rls.sql` run at migration time and are the only thing standing in
for them.
