# Where the logic lives

> Document type: **inventory**. Moved out of [CLAUDE.md](../../CLAUDE.md) on 4 Oct 2026.
> This is the reuse catalogue: search it before adding a module, and add a line in the
> same change when you add one that others should find.

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
`web/lib/server/demand-body.ts` — `demandFromBody`: a D1 request body → what may be stored (classified server-side, sensitive ones only with permission). Every route taking a D1 uses it.
`web/lib/seed-gate.ts` — link-only access: the marker cookie, and which screens
                       need it. `proxy.ts` issues it on `/join` and enforces it
                       on the rest. Not authentication — see [decisions.md](../decisions.md).
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
                       [decisions.md](../decisions.md).
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
                       reason (see [decisions.md](../decisions.md)).
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
                       `SegmentedFilter` · `Menu` · `Dialog`. See [decisions.md](../decisions.md) for
                       what that swap cost and what it bought.
`web/components/admin/Record.tsx` — the admin's second layout, for the queues a
                       table cannot hold: `RecordCard` · `FactGrid`/`Fact` ·
                       `SpecList`/`Spec` · `Quote` · `RecordGroup` ·
                       `RecordDrawer`. Which one a page uses is a property of
                       its data, never a preference — see [decisions.md](../decisions.md).
`web/components/ui/OptionPicker.tsx` — the searchable dropdown the circles
                       questions use. Which control a question gets is a
                       property of its options: a directory here, a short closed
                       set in `ChipGroup`.
`web/components/ui/TextAction.tsx` — the quiet 44px action beside the loud one,
                       and `InlineAction` for a link inside a sentence. One box
                       for `<button>` and `<a>` alike, which is the whole point.
`web/components/ui/Panel.tsx` — the block on a flow screen. `tone` is what it
                       means, `raised` is the one card the screen is about.
`web/lib/contribution-quality.ts` — is a contribution complete? Qualifies / needs follow-up / too thin, with the exact gap. Pure, no imports; read by the admin (`lib/admin/quality.ts`), the chat and `test:quality`.
`web/lib/admin/contribution-edit.ts` — what an admin may change on a contribution and how a patch is cleaned (route and write share it).
`web/lib/server/repo/founding-count.ts` — how many complete contributions each parent has, handed to the Founding SQL as arrays (one TypeScript rule, no migration).
`web/lib/rewards.ts` — the Founding rules and the chat's progress copy (`foundingProgressLine`).
`web/components/ui/Screen.tsx` — the app shell (phone + desktop).
`web/components/site/Shell.tsx` — the public-site shell.

Adding a question should touch one data file and nothing else.
