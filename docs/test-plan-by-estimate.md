# How to test each estimate row

A companion to [qa-checklist.md](qa-checklist.md), which walks the two flows in the
order a parent meets them. This one is indexed by **estimate row**, so you can prove
one line item without walking everything, and so "is 1.9 done" has an answer that
isn't an opinion.

Each row below says what to exercise, exactly how, and **what a pass looks like as
something you can see**. Where a row cannot be tested yet, it says so and why —
those are not failures, and marking them as such wastes a round with the client.

---

## Before anything: the four switches that change what "correct" means

Half of this app is built to be honest about missing configuration rather than to
fake it. So the same screen is *supposed* to behave differently depending on four
environment variables, and if you don't know which state you're in, a correct
result reads like a bug.

| Variable | Set | Unset |
|---|---|---|
| `DATABASE_URL` | rows are written | routes answer `persisted: false`, admin shows the honest empty state |
| `ANTHROPIC_API_KEY` | cards get a confidence score | `confidence` stays **null** — not 0, not a guess |
| `admin_users` (or, while it is empty, `ADMIN_CREDENTIALS` / the deprecated `ADMIN_PASSWORD`+`ADMIN_USERS`) | `/admin` exists | `/admin` is dark, not open. Configured but unreadable ⇒ "temporarily unavailable", which is also not open |
| `SEED_REQUIRE_VERIFICATION` | the OTP gate is enforced | nothing is gated, and contributors are stored with no confirmed number |
| `SEED_VERIFY_DEV_CODES` + the three `TWILIO_*` | see the table below — the pair has four states, not two | |

**The Twilio pair, because getting it backwards is what takes the tool offline.**
Dev codes do not replace the send: `/api/seed/verify/start` calls `sendSms`
regardless and the flag only *adds* `dev_code` to the response. So:

| dev codes | Twilio | What happens |
|---|---|---|
| on | unset | nothing sends, code on screen, everything stores — **today** |
| on | set | a real text goes out **and** the code is on screen ⇒ anyone can confirm any number. Pass through, don't sit here |
| off | set | the destination |
| off | unset | `sendable: false` ⇒ every founding parent falls to the deferred path and **nothing reaches the database**. Never ship this |

So provision Twilio **first**, then remove the flag — never the flag alone. Both
variables fail safe when deleted: `SEED_REQUIRE_VERIFICATION` is on unless it is
literally `"0"`, `SEED_VERIFY_DEV_CODES` is off unless it is literally `"1"`.

Check the current state first — this one command answers all of it:

```bash
curl -s localhost:3000/api/health            # db.configured / db.reachable
curl -s localhost:3000/api/seed/verify/status # required / sendable / dev_codes
cd web && npm run check                       # row counts + extraction + invariants
```

On this machine right now: database connected, `SEED_REQUIRE_VERIFICATION=1`,
`SEED_VERIFY_DEV_CODES=1` — so **the six-digit step is live and the code is printed
on screen** ("QA mode: the code is …"). Twilio is not provisioned, so no real text
is sent; the dev code is the whole mechanism.

## Run the automated checks first

Three minutes, and they rule out whole classes of problem before you touch a
screen.

```bash
cd web
npm run typecheck     # the admin read/write contract compiles against every page
npm run test:auth     # 45 checks on admin sign-in and the credential store (see 2.1)
npm run test:phone    # 35 checks on US/Ukraine number parsing (see 1.10)
npm run check         # row counts, extraction coverage, invariants 1 and 2
npm run build         # every route compiles

npm run dev           # in another terminal, then:
npm run test:e2e      # 280 checks: the whole of Phase 1, end to end
```

`test:phone` is the fastest of them and needs nothing running. It is separate
because a phone number *is* an identity here (invariant 10), so the near-collisions
are worth asserting on their own: `380` is a real US area code, which is why a
ten-digit `380…` must stay American and only a twelve-digit one Ukrainian.

`test:e2e` is the one that would catch a regression the others cannot. It signs up
a parent, answers the profile, shares cards, finishes, registers a caregiver and
then drives the admin — checking at each step both what the API answered *and* what
landed in Postgres. It removes everything it created, including flags whose subject
it deleted.

Two things it does deliberately, and which are the reason it is worth trusting:

- **About half of its checks assert a refusal** — a card before the code is
  confirmed, a secondhand nomination, a sensitive question nobody gave permission
  to keep. A suite that only proved the happy path would pass while every one of
  those leaked.
- **It lies to the server.** The profile payload carries fabricated affinities and
  a pending option in another market; the caregiver card smuggles a phone number
  and `consent_status: consented`. It then asserts none of it survived.

It needs a real `DATABASE_URL` and, for the extraction checks, `ANTHROPIC_API_KEY`.
Without the model key those two checks fail honestly rather than being skipped.

`npm run check` ends in either `✓ no invariant violations found` or a list. A
violation there is a **product-level bug**, not data noise — invariant 1 (a
caregiver visible without consent) and invariant 2 (a caregiver stored under 18)
are the two the database cannot enforce alone.

---

# Phase 1 — the parent flow

## 1.1 · Landing, invite and QR entry

**Exercise:** the one shared invite link, both entry paths, and the consent record.

1. Open `http://localhost:3000/join?i=sgv-founding`.
2. **Founding path:** first name, last name, phone, and the SMS-consent checkbox
   are all required — try submitting with the checkbox clear and confirm it
   refuses.
3. **Anonymous path:** take the labelled opt-out. Confirm the screen states plainly
   that founding status is given up.
4. `http://localhost:3000/?i=sgv-founding` must redirect to `/join?i=sgv-founding`
   (links already shared in group chats keep working).
5. `?src=qr` is accepted and recorded; no other query parameter changes anything.

**Pass:** consent row exists at phone capture, not at the end —
`select scope, text_version from consents order by captured_at desc limit 2` shows
`sms` with the registered version `seed-sms-2026-08-01`.

**Watch for:** an invalid code (`?i=nonsense`) must still let the parent in, with
the market falling back — a typo in a forwarded link is not a dead end.

## 1.2 · Tap-first profile (P3–P14)

**Exercise:** 15 screens in the client's order, two of which state rather than ask.

- Screens are in the client's sequence: neighborhood, birth years, schools with
  per-school status, time in area + where from, family structure, current
  childcare, logistics, how you choose, trust circles, two topic clusters, then
  P13 attribution and P14 allowance.
- **"Where this link reached you" is gone** (12 Aug). The invite carries the group,
  so the profile no longer asks. Check the "Your circles" screen: parent groups is
  still there as a *membership* question, and there is no separate "where did this
  reach you". Attribution lands without asking —
  `select invited_via_group from people where …` matches the group the invite is
  linked to, and there is **no** affinity edge to it unless the parent also picked
  it as one of their own groups.
- The **privacy disclosure** and the **Pando promise** screens ask nothing. They
  must not present as questions with a right answer.
- "Your circles" carries six groups, the newest being **Camps & school-break
  programs** (v3.2 §8.4). With a baby-only profile the whole group is absent; with
  a school-age child it appears, and its chips re-filter by band like every other
  market list — a sleepaway camp must not be offered for a five-year-old.
- **Whose is it.** With **two or more** children, every school, class and camp you
  pick grows a "Which of your children?" row of birth years under it, and the
  review screen shows the answer in brackets — "Walden School (Current · 2019)".
  With **one** child the question is not asked at all (there is nothing to ask) and
  the attribution still lands. Skipping it is allowed: an empty answer means "they
  didn't say", and `social_affinities.child_birth_years` is null rather than a
  guess. Reload mid-profile and the taps survive — they are two levels deep, which
  is exactly the shape a naive session-normaliser drops.
- **"Parent groups" is gone from this screen** (14 Aug) — the whole question, not
  just P6's "where this link reached you", which went on 12 Aug. "Your circles"
  must show exactly four groups: classes, camps, clubs, faith. **What to know
  before reading this as a bug:** nothing writes a parent-group affinity edge now,
  by design — the invite records the group as *attribution* and never as
  membership. `market_options.parent_groups` is still populated, because
  `/admin/invites` links each invite to one of its values.
- **A per-child ceiling, one each — except schools, which take two** (14 Aug).
  With two birth years tapped, go to schools: the first three taps do nothing
  special, and on the **fourth** every other school chip goes inert (faded,
  `not-allowed`, still on screen and still readable), "Another school" goes with
  them, and a line appears reading *"Up to 2 each for your 2 kids — current and
  former both count."* Two is deliberate here and only here: the screen invites
  former schools in so many words, and one child commonly has a preschool behind
  their current school. Classes and camps cap at **one** each per child — fill
  classes with two and the hint reads *"One for each of your 2 kids."* Then check
  all four rules:
  1. **Swapping works** — tap one of the two off and everything re-enables. A cap
     that could only be escaped by restarting the screen would be a wall.
  2. **The ceiling is per question, not per screen.** On "Your circles", filling
     classes must **not** disable camps, and must never touch parent groups, clubs
     or faith — those are household questions and stay uncapped.
  3. **A typed answer counts.** With the cap reached, "Another school" is
     unavailable; it is still a school, and the Other sheet is the one path that
     would otherwise walk straight past the rule.
  4. **Nothing is said before it bites.** At one of two selections there is no
     hint and no disabled chip — and the limit is never red, because reaching it
     is not a mistake.

  Add a third birth year and both ceilings rise on their own — six schools, three
  classes — with no reload.
- Single-select chips behave like radios: **tap the already-chosen chip and it
  stays chosen.** Deselecting used to clear the pre-set allowance on the first tap,
  which is the opposite of what the tap means.
- "Other" opens a full-screen sheet. On a phone it must cover the screen — if it
  appears clipped to the question block, that is the portal regression described in
  CLAUDE.md.
- Reload mid-profile: answers come back. Then corrupt them —
  `localStorage.setItem('pando.seed', '{"answers":{"child_ages":null}}')` and
  reload. The screen must survive; a stored `null` overwriting a default `[]` is
  what `normaliseAnswers` exists to stop.

### The 18 Aug reciprocity screens

- **P14 allowance** offers **Now and then (5) · Happy to help more (10) · Ask me
  anytime it's genuinely relevant**, and 5 is pre-selected. If you see 1 or 3, the
  build predates 18 Aug. The failure mode worth provoking: pick each option, finish,
  and confirm the row landed — `select allowance_mode, monthly_contact_allowance
  from people order by created_at desc limit 1`. `as_relevant` must store **null**,
  not 0. A 200 from the route is not proof; the CHECK is a second gate and the two
  disagreeing is exactly the bug 0013 fixed.
- **The listening-ear screen** comes straight after it: "Some parents ask Pando the
  things they can't ask anywhere else." Two options, both explicit. Answering yes
  must write a `consents` row with `scope = 'listening_ear'` and a wording version —
  not a boolean on `people`. Declining, or skipping, must write **nothing**:

  ```sql
  select scope, status, text_version from consents
   where person_id = (select id from people order by created_at desc limit 1);
  ```

  The copy makes two promises to check against the product: the answer is anonymous
  to whoever asked, and it **spends the same monthly allowance** — so a parent on 5
  who opts in is still on 5, not 5 plus an unstated extra.

**Pass:** every screen advances, nothing is lost on reload, and no screen requires
an answer the client marked optional.

## 1.3 · Profile → affinity derivation

**Exercise:** one transaction writing person + children + affinities + relevance +
schools + pending options.

Finish a profile, then:

```sql
select count(*) from people;
select birth_year from children where person_id = '<id>';
select affinity_type, affinity_value, weight_at_capture from social_affinities where person_id = '<id>';
select dimension, value from life_relevance where person_id = '<id>';
select option_value, status from person_schools where person_id = '<id>';
select category, submitted_value, status from pending_options;
```

**Pass:** all six populated from one run, `weight_at_capture` present on affinities,
and any "Other" answer sitting in `pending_options` with status `pending`.

**The invariant to prove:** an "Other" answer is **not matchable** until an admin
promotes it (invariant 9). Nothing in a matching path may read `pending_options` —
confirm the value does not appear as a normal option anywhere until promoted via
2.6.

## 1.4 · Chat-seeding interface

**Exercise:** the four card types and the add-another loop.

Share an activity, then a place, then a tip, then a caregiver. After each, the loop
must offer another and let you stop. Confirm the recap lists what you shared.

**Pass:** four cards, four `submissions` rows, and the chat never loses a
half-finished card on reload.

## 1.5 / 1.6 · Activity and caregiver capture cards

**Exercise, activity (R1–R11):** firsthand-or-secondhand, age at the time, recency,
how much, caveat, who-for / who-not-for, price band + unit, worth-it, recommend,
per-recommendation follow-up.

- **"Nothing comes to mind" counts as an answer.** Take it, and check
  `caveat_answered = true` with `caveat` null. This is what makes the card eligible
  for Founding — a skipped caveat is not the same as an answered one.
- Mark a card **secondhand**: it must be accepted, labelled, and never qualify.
- Price: pick a band and no unit. The card must still save — `$100/month` and
  `$100/term` are different recommendations, so a band without a unit is dropped
  rather than allowed to abort the card.
- **Fix a field:** tap a recap row, change one answer, re-save. It must update in
  place under the same `client_id`, not create a second contribution.

**Exercise, caregiver (C1–C11):** the gates first, because they are refusals.

| Try this | Must happen |
|---|---|
| "Did they work directly for your family?" → no | refused, 422, nothing stored (invariant 14) |
| 18-or-older → no | refused, 422 (invariant 2) |
| "Would you hire them again?" → hesitant or no | card is **held**, and the parent is told so on the spot |
| Type a private note | card held, note stored in `restricted_notes`, never in the nomination row |
| Pay band + benchmark consent | two separate decisions; leave the consent alone and it is **no** |

Then prove the two things that are easy to get wrong:

```sql
-- No contact details for a nominated caregiver exist anywhere (invariant 13).
select * from caregivers limit 1;   -- no phone, no email, no address columns at all
-- The nomination and its restricted notes are one fact.
select n.id, count(r.id) from caregiver_nominations n
  left join restricted_notes r on r.nomination_id = n.id group by n.id;
```

**Pass:** the ladder starts at `mentioned`, `active`/`discoverable`/`introducible`
are all false, and a private note never appears in a list view.

## 1.7 · Completion — three screens, not one

**Exercise:** `/done` tells, `/done/ask` asks, `/done/next` explains.

- `/done` — thank-you, "Founding contributor · in review", what you shared. On the
  **anonymous** path the founding badge must **not** appear, and the next-steps copy
  must match.
- `/done/ask` — the D1 question, the versioned follow-up consent, and the OTP gate.
- `/done/next` — received → being read → added, the D2 referral card, the return
  link.

**The ordering trap:** D1 travels in the same completion write as the consent. If
you ever see the demand question move to `/done/next`, every demand signal is being
dropped silently. Prove it lands:

```sql
select question_text, sensitivity, requires_human_review from demand_signals order by created_at desc limit 1;
```

**D1 routing — test all three:**

| Ask about | Expect |
|---|---|
| an ordinary activity | stored, no flag |
| something peer-support shaped | an in-flow answer, and stored **only** on an explicit yes |
| health, legal or safety | professional resources shown immediately, plus an `escalation` flag `high_stakes_demand` |

Category taps drive the routing; a keyword scan may only **escalate**, never
de-escalate. Try an ordinary category with alarming words in the text and confirm it
escalates rather than staying ordinary.

## 1.8 / 1.9 · Extraction engine and flags

**Exercise:** the only place the app calls a model, plus the flag rules.

The full method is in the earlier session notes; the short version:

1. Save an activity card with **deliberately vague** free text ("it's good").
2. Watch the dev console: `[seed:save] stored` and **nothing else** — no names, no
   free text. The model call happens after the response, so the parent never waits.
3. `npm run check` → `scored` goes up by one.
4. Admin → Flags shows `low_confidence`. Admin → Contributions with the "Low
   confidence" filter shows the same card. **If it appears in one and not the
   other, the 0.6 threshold has drifted between the rule and the filter.**

**The three rules:**

| Write | Expect |
|---|---|
| vague text | `confidence < 0.6` → `low_confidence` |
| praise a named person ("ask for Maria on weekends") | `possible_named_person` flag, `review` severity |
| tap "we went over a year ago" | `stale_at_capture` — **no model needed**, it is knowable at capture |

**Naming a person must not double as a quality defect (12 Aug).** A card that names
someone and is otherwise specific and concrete — e.g. *"Ms. Diane got my son
playing in three weeks after a year of refusing"* — must land **both** flags
independently: `possible_named_person` **and** `confidence` at or above 0.6. If
naming the person pulls the score under 0.6 too, review and quality have been
merged back into one signal, which is the exact regression this fix closed —
`possible_named_person` alone is what routes it to a human, and a low score should
only ever mean the text itself gives another parent nothing to act on. The same
card must not be marked down for a field that was captured as a tap (price band,
recency, recommendation, child ages) — the extraction prompt is given those taps
as context labelled "already answered", so a complete card should not read as
vague because the model can't see a column it was never shown.

**Prove the exclusions.** A caregiver card must produce **no** extraction — its free
text *is* the restricted note (invariant 12). And with `ANTHROPIC_API_KEY` removed,
`confidence` must stay **null**, not 0.5: a wrong score sorts a card out of the
queue that exists to catch it.

**An admin edit clears the score, it does not recompute it.** Edit a scored card's
free text from Admin → Contributions. `confidence` goes back to **null**
immediately — re-running extraction inline would mean a network call inside the
same transaction as the audit row, and a stale score describing text that no
longer exists is worse than no score. `npm run check` (or the catch-up sweep)
picks it back up and scores the edited text on its own next pass.

**Catch-up sweep:** unset the key, save a card with text, restore the key, then
`POST /api/admin/extract` with an admin cookie. The card gets scored. The response
is honest in three states — `no_api_key`, `no_database`, or counts.

## 1.10 · Session and passwordless

**Where the code sits (13 Aug):** at the **end of the profile**, not at the entry
screen. Finish the questions, tap through the review, and the next screen is the
six-digit code — the profile is written the moment it is confirmed. Two failures
worth aiming at: reload that screen (the answers are still on the phone, nothing
has been sent), and throttle the network before tapping the last button (the step
must still appear — it awaits the status rather than reading whatever a background
fetch had finished, which is what used to wave a parent straight past it).

**Exercise:** device-local autosave and the phone OTP.

- **Autosave:** answer half the profile, close the tab, come back. Answers are
  there.
- **The OTP gate, which is the real test of "nothing is stored until verified".**
  Since 12 Aug it stands at the **entry screen**, so the walk is:
  1. `/join`, fill in name, number and the consent box, tap Start. The next screen
     is the code — not the profile.
  2. Before entering it, check the database: **no person, no anything.** Abandon
     here and nothing persists, which is the client's rule verbatim.
  3. Start again, enter the code from the screen ("QA mode: the code is …").
  4. Now finish the profile and check the database **before reaching the end**:
     the person and their affinities are already there. Share a card and check
     again: it is there too, and the card itself says *"Received. Not in the
     network yet — a person reads it first"* rather than *"kept on this phone"*.
     That difference is the whole point of the move.
- **The fallback, which has to keep working.** Set `SEED_VERIFY_DEV_CODES=0` (and
  no Twilio credentials) so no code can be sent. Entry must **skip** verification
  rather than block it, every card must say "kept on this phone until you finish",
  the database must stay empty, and `/done/ask` must show the honest "we can't
  confirm your number yet" panel. This is production's state until A2P approval —
  if it breaks, the tool is offline for everyone.
- **An expired confirmation must not lose anything.** Verify, then restart the dev
  server (that clears the in-memory verification), then save a card. It must be
  *held*, not errored — the session silently goes back to the deferred path, and
  `/done/ask` asks for a fresh code and sends everything. A confirmed number is
  good for 12 hours otherwise.
- **Limits (spec §19):** 6 digits, 5 minutes, 3 sends, 3 wrong guesses — then the
  **number** is locked for 15 minutes. Enter a wrong code three times: the screen
  should stop asking for a code and say how long, and asking for a fresh one from a
  clean browser must be refused too. The lock is keyed to the phone precisely so
  that clearing cookies is not a way around it.
- **Server-side, not just UI:** call `POST /api/seed/save` directly with a phone and
  no verification cookie. It must answer **401**, not store the card.

```bash
curl -s -X POST localhost:3000/api/seed/save -H 'content-type: application/json' \
  -d '{"invite_code":"sgv-founding","contributor_phone":"+16265551234",
       "submission":{"id":"probe-1","kind":"activity","fields":{"name":"Probe"}}}'
# {"error":"Phone verification required","reason":...}
```

### A Ukrainian number (20 Aug)

The field takes `+1` and `+380`, and the picker is inside the input's border on the
left. `npm run test:phone` covers the parsing; what is worth doing by hand is the
part a unit test cannot see.

- Type a US number, then switch the picker to `+380`. The digits **re-group rather
  than clearing** — nobody should have to retype after a mis-pick.
- Clear the field and type a single `0`. It must **stay on screen.** The trunk zero
  is stripped for storage, so an earlier version showed nothing until the second
  digit, which reads as a broken field.
- Type `067 123 45 67`, then try to force the picker to `+1`. It must **snap back to
  +380**: the number is what it is, and a field asserting a country its own digits
  contradict is worse than no picker. (The digits do re-group to `(067) 123-4567` —
  that part is expected.)
- Walk the whole flow on the Ukrainian number and check what landed:

  ```sql
  select phone, phone_verified_at from people order by created_at desc limit 1;
  -- +380671234567 — E.164, never the national form
  ```

- On the confirm screen the masked number must read `067 •••‑4567`, **not**
  `(067) •••‑4567`. The second is a trunk zero dressed as a US area code, and it was
  the bug that made the shared mask worth having.

**Blocked:** real SMS delivery. Twilio needs the A2P campaign approved and the three
`TWILIO_*` values; until then `sendSms` answers
`{sent:false, reason:"not_provisioned"}` and the screen says text verification isn't
switched on yet — which is itself worth confirming reads honestly. **A Ukrainian
number needs more than that**: Geo Permissions for Ukraine on the account and a
sender the Messaging Service can use outside the US, because A2P 10DLC is a US
registration. So `+380` will fail as `provider_error` on the day `+1` starts
sending, and that is configuration rather than a regression.

---

# Phase 1 — admin (M2, rows 2.1–2.8)

Sign in at `http://localhost:3000/admin`. Every page must work on a phone too: nav
and tables scroll **inside themselves**, never the page.

### Fill it first

An empty admin cannot be reviewed — half the things below are about how a populated
table reads.

```bash
cd web
npm run seed:demo            # 24 contributors, shares, caregivers, claims, flags
npm run seed:demo -- --clear # removes exactly it, and nothing else
```

These rows are **not** `is_test`, deliberately: every admin count filters test rows
out, so a demo cohort marked that way would render a dashboard of zeros. The marker
is `people.source = 'demo'`, which shows honestly as "Arrived via: demo" on the
contributor page. Before demoing to the client, run `--clear` and confirm your own
walkthrough rows are still there — that is the check that the marker is doing its
job rather than deleting by date.

### The language test, on every page (19 Aug)

This is the pass the client failed the admin on, so it is worth doing as its own
sweep rather than page by page. Read each screen as somebody who has never seen the
schema:

- **No stored ids on screen.** Not `possible_named_person`, not `stale_at_capture`,
  not `share_contribution`, not `pending_review`, not `mid_range`, not `firsthand`,
  not `yes_with_caveats`, not `nomination.release_hold`. If one appears, its label
  is missing from `lib/admin/labels.ts` — and note that a title-cased id
  ("Possible Named Person") does not count as fixed.
- **One value, one wording, everywhere.** Open the overview and the demand queue
  side by side: `peer_support` must read identically on both. Same for the
  caregiver ladder on the overview vs the caregivers page. Two names for one thing
  is the failure this file exists to prevent, and it is invisible on any single
  page.
- **No two adjacent columns saying the same words.** The demand queue's "About"
  and "Kind of question" both used to read "Health, legal or safety" on a
  high-stakes row, which told the reader nothing about the difference.
- **Every heading stands on its own.** If a column heading contains "it" or
  "these", check what it refers to — from the heading alone, not from the row
  beneath it.
- **Every stated condition has a write behind it.** This is the one worth doing
  slowly. "not usable until read" was printed from a column nothing ever cleared,
  so it never went away; "Invited by" named a question removed on 12 Aug. For each
  claim on screen, ask which action makes it false — and if there is none, it is a
  bug in the same class, not a wording nit.
- **Nothing said twice.** No hint under an input repeating the page intro, no
  paragraph under a card repeating the heading, no sentence in the sidebar repeating
  the page's own first line. The nav hints live on the links' tooltips for exactly
  this reason.
- **Every button says what happens**, and its tooltip says what else it does. "Done"
  and "Submit" describe the click, not the consequence.
- **No open questions for us** in a surface Janet reads. A footnote wondering when
  cards enter the graph belongs in a call, not under her queue.

## 2.1 · Auth and shell

**Automated:** `npm run test:auth` — 45 checks covering all four sources, token
forgery, rotation, revocation, timing, and malformed records. `npm run test:e2e`
ends on the same ground against the live server and the real table.

**By hand, and this is the one that matters:**

1. Add two people: `npm run admin:user -- add janet`, then `… add andrii`. Each
   prints a passphrase once; the database stores only a scrypt record, and
   `npm run admin:user -- list` shows who exists and when they last signed in.
2. **Janet's password must not sign in Andrii.** That is the whole point of the
   change: `session.user` is what every `audit_log` row is written from, so the name
   has to be proved rather than picked.
3. `npm run admin:user -- disable janet` — **no restart, no deploy.** Within a
   minute (immediately if she tries to sign in) her open session is dead: the API
   answers 401 and `/admin` redirects to the login screen. That is the reason the
   credentials moved out of the environment.
4. `… enable janet` puts her back, with the same password. Rotate it with
   `… password janet` and her session ends again — with `ADMIN_SESSION_SECRET` set,
   only hers; without it, everyone's.
5. Every one of those commands leaves an `audit_log` row: `select actor, action,
   resource_id from audit_log where resource = 'admin_user'`. Pass `--by <who>` and
   it names them instead of `cli`.
6. **A plaintext password cannot be stored.** `insert into admin_users (name,
   password_hash) values ('x', 'hunter2')` must be refused by
   `admin_users_hash_check`.
7. **Empty table = bootstrap.** With nobody in `admin_users`, `ADMIN_CREDENTIALS`
   admits people again and the sign-in screen says which mode it is in. Add one
   person and the table takes over — an env credential is then refused, which is
   the behaviour that stops a revoked admin walking back in.
8. **Unreadable store = closed, not open.** Point `DATABASE_URL` at a dead host and
   reload `/admin`: "Sign-in is temporarily unavailable", and nothing is accepted —
   not a session, not an env credential.
9. Five wrong attempts → locked for 15 minutes.
10. Unset the admin variables *and* empty the table → `/admin` is **dark**, not open.
11. Route protection, before anything renders:
   `curl -si localhost:3000/admin/contributors | head -1` → `307` to
   `/admin/login?next=…`. And `POST /api/admin/query` with no cookie → **401**, not
   a redirect.

## 2.x · The admin's controls

Five primitives shared by every page (`components/admin/kit.tsx`), all on
platform mechanics rather than a component library. Worth one pass with the mouse
put away:

| Try this | Expect |
| --- | --- |
| Tab to a filter row | **One** tab stop for the whole row. Arrows move between options and change the filter as they go; Home/End jump to the ends |
| Tab to the ⓘ next to a badge, then press Enter | The explanation opens — and it opens on hover and on tap too. It is a real button, not a `title`, which is why it is reachable at all |
| Open **More** on a caregiver card | A menu, focus on its first item, arrows to move, Escape to close and focus back on the trigger. Clicking anywhere else closes it |
| Open **Read private note** | A modal: the page behind it is inert, Tab cannot leave it, Escape closes it, and the scroll behind does not move. Close it and open it again — it must reopen |
| All of the above at 375px | Every panel stays inside the viewport. A menu opened from a card near the bottom flips above its trigger rather than off the screen |

**The two failures worth aiming at**, because both have happened: a panel measured
before it is shown positions itself as though it had no height (off-screen on a
phone), and a modal closed by Escape that does not tell React can never be
reopened.

## 2.2 · Founding queue

The queue shows the **checklist**, not a submission count, so an admin sees *why*
somebody is or is not eligible: verified, has neighborhood, has children, allowance
ok, qualifying approved, caregiver approved.

**Pass:** approving sets `founding = 'founding'`. "Not from the group" sets
`request_invite` and **keeps every submission** — it is not a rejection. Founding is
never self-granted, and it activates on the **second** approved contribution.

## 2.3 · Contributors, detail, and the seed reward

- List: search, hide-test toggle, and the reward filter (`Reward earned` /
  `Waiting on review` / `Gave nothing`).
- **The reward bar is one contribution, not two.** "One activity or one caregiver"
  is the client's payment minimum; Founding needs two. `Gave nothing` is the state
  the client asked for by name — the parents who arrived and left nothing.
- Sort by "Most contributions" — this is the contest ranking. There is **no
  threshold**, deliberately: the client never named one.
- Detail: derived profile, everything submitted, consents with wording versions,
  internal notes, and the referral card.
- **Referrals:** "Record who invited them" → pick a parent → the link appears on
  both people's pages. "wrong" voids it without deleting it. Status is
  `profile_complete`, never `credited` — credits are Network Asks, which don't exist
  until Phase 2.
- Self-referral must be refused with a readable message, and linking the same pair
  twice must be a no-op rather than a constraint error.

**Overview counters must add up:** `reward.eligible + started + none` equals
`contributors.total`.

## 2.4 · Contributions review

Approve, ask for more detail, reject, edit a field.

**Pass:** approving a contribution is also the moment its **share** becomes usable —
`shares.status` goes `approved`, `validated_count` increments, `freshness_state`
becomes `fresh`. A share with no approved contribution behind it must never reach an
answer.

**"Needs more detail" stores the question** (18 Aug). It requires an actual question,
and that question must survive where the queue can see it — the button's own copy
promises the card "stays in the queue until they answer", which is only true if the
question was kept:

```sql
select status, needs_detail_note from share_contributions
 where status = 'needs_detail' order by created_at desc limit 1;
```

Before 0011 it lived only inside `audit_log.after`, where nobody working the queue
would look. There is still no channel to send it — that is Phase 2 — so this is the
record of what will be asked, not evidence it was.

**One concept, one button** (19 Aug). Every row offers the forward action whenever it
would change something — so a card that is **on hold or awaiting detail is still
approvable.** If a held card shows no way forward, that is the regression: the gate
used to be `status === "pending_review"`, which let the queue fill with cards nobody
could act on. The status belongs in a pill, never as a third button.

**Golden answers (§17.1).** The "golden" filter lists approved records and offers a
one-tap **answer-ready** flag. Try it on a record that is *not* approved: nothing
happens — no error, no flag. That is deliberate, and the database enforces the same
rule (`shares_answer_ready_check`), because "ready to answer with" has to be a
subset of "a human has read it". The overview's *Answer-ready records* count is the
one number on that page meant to go up.

## 2.5 · Caregiver ladder, holds and restricted notes

The ladder only ever increases, and only by the caregiver's own action:
`mentioned → invited → consented → declined → revoked`.

| Try | Must happen |
|---|---|
| set `active` or `discoverable` before consent | refused **in words**, not a Postgres error |
| `introducible` while `discoverable` is false | refused — introducible implies discoverable |
| move to `consented` with no method | refused: consent needs evidence |
| method = call or in-person, no note | refused — that note **is** the artefact |
| release a hold with no reason | refused; your name goes on it |
| open a restricted note | shown one at a time, and the read lands in the audit log |

**The leak test:** a restricted note must never appear in a list view. Fetch the
caregiver list and grep the response — `has_restricted_notes` may be true, the body
must be absent.

## 2.1a · Who can sign in

**Right now:** `janet` and `andrii` are in `admin_users`, both with the starter
password `pando`. It is hashed like any other — `select password_hash from
admin_users` shows a `scrypt:` record and nothing resembling the word — but five
characters is five characters.

```bash
cd web && npm run admin:user -- list
```

**Pass:** both listed as `active`, and `select 1 from admin_users where
password_hash like '%pando%'` returns nothing.

**The one thing to check before the pilot opens:** `password set` in that listing
should no longer be the day they were created, i.e. each of them has changed it at
`/admin/account`. Until then the audit log says so out loud —
`select after from audit_log where action = 'admin.create'` carries
`weak_starter_password: true`. A short password opens every parent's profile, every
restricted note and the consent file with unmasked numbers.

**Also check the floor is still there:** `printf 'pando' | node
scripts/admin-user.mjs add someone --stdin` must be **refused**. Only the explicit
`--insecure-password` gets through, and `/api/admin/password` never does.

## 2.1b · Changing your own password

**Exercise:** `/admin/account`, reached from "Change password" in the sidebar.

1. Enter the wrong current password → refused, even though you are signed in. Five
   wrong tries locks that check for fifteen minutes, the same as the sign-in form.
2. A new password under 12 characters, or the one you already have → refused.
3. A correct change → the success card, and **you stay signed in**. That last part
   is the one worth checking: rotating the hash changes the session key, so if the
   route did not hand back a fresh cookie, a successful change would look like
   being logged out at random.
4. Sign out and back in: the old password is dead, the new one works.

**Pass, in the database:**

```sql
select password_hash, password_changed_at from admin_users where name = '<you>';
select actor, action from audit_log where action = 'admin.password';
```

The column starts `scrypt:` and the audit row names who and when — and **nowhere**
does the password itself appear, which is why this is its own route rather than an
`/api/admin/action` (that one builds its audit row from the request body).

**What this page deliberately cannot do:** touch anybody else's account. Creating
an admin, disabling one, or resetting someone else's password is
`npm run admin:user` — a session that can grant a session is a different surface.

## 2.6b · Invites — one per group

**Exercise:** `/admin/invites`, and what a code does to a parent's record.

1. Create one: group name "Field Elementary PTA", code `pta-field`, and link it to
   a parent group from the dropdown. A code that isn't lowercase-hyphenated is
   refused, and so is an empty group name — the parent reads that name back.
2. Open `/join?i=pta-field` immediately. It must be live (an admin write clears the
   resolution cache), and on the **communities** screen the question becomes
   *"You joined through Field Elementary PTA. Is that one of your communities?"*
3. Answer **No — somewhere else**. The ordinary chip list appears.
4. Start again, answer **Yes**, finish the profile, then check the graph:

```sql
select affinity_type, affinity_value from social_affinities where person_id = '<id>';
```

**Pass:** `social_group / school-pta` is there after a **yes**, and *not* there for
a parent who arrived on the same link and never confirmed. The link is evidence
that somebody forwarded it, never that this parent belongs to the group.

**Then the number the page exists for:** `contributors` vs `delivered` per invite —
arrivals against how many gave an approved contribution. Approve one contribution
and watch `delivered` move.

**Retire it** and open the link again: the parent still gets in, with no
attribution. A code retired today must not strand whoever was handed it last week.

## 2.6 · Tap lists

Promote an "Other" answer into `market_options`, reject one, retire one.

**Pass:** promotion requires a lowercase hyphenated slug, chosen deliberately at
promotion rather than derived twice. Only after promotion may the value appear as a
normal option (invariant 9).

**Then check that promotion actually did something** — three things, and until
12 Aug none of them happened:

1. **The chip appears without a deploy.** Promote a value, then reload `/profile`
   and walk to the screen that owns that category. It must be in the list.
   `curl -s "localhost:3000/api/market/options?market_id=pasadena"` is the faster
   version of the same question. The list is cached for a minute, but an admin
   write clears the cache, so *this* path is immediate; only
   `npm run options:import` waits out the TTL, because it is a different process.
2. **Everyone who asked for it is answered.** If two parents typed the same value,
   both pending rows go to `approved` — promoting one and leaving the other is how
   the same judgement gets made twice, with two different slugs.
3. **The graph is repaired.** The parent who typed it had **no** affinity row while
   it sat unreviewed — that is invariant 9 working. After promotion they must have
   one, stored under the admin's **slug** and never under their free text:

```sql
select affinity_type, affinity_value, weight_at_capture from social_affinities where affinity_value = '<the-slug>';
```

**Watch for:** the fallback. Turn off `DATABASE_URL` and the chips must still be
there — the built-in lists take over rather than a screen rendering empty. Same if
the fetch fails outright.

## 2.7 · Flags and the D1 demand queue

Resolve and escalate flags; move a demand signal through open → matched → answered →
closed.

**Pass:** one open flag per (reason, subject) — re-save the same card and no
duplicate appears. But resolve a flag and trigger the same rule again: a **new**
flag is correct, because a concern that recurs after a human cleared it is new
information.

**The fourth D1 class.** Ask a closing question that names a person and makes a
claim — *"our nanny screamed at my toddler and lied about it"* — filed under an
ordinary category. It must be classified `named_allegation`, not `high_stakes`: the
parent gets the quiet acknowledgement rather than a list of professional resources,
the row carries `requires_human_review`, and it raises its own flag reason. The
demand queue shows it first, with the high-stakes ones.

**Where the neighborhood came from.** Every demand row has one, and it is read from
the parent's profile inside the same insert — never from the request body. It is
the number that decides which market Pando opens next (v3.2 §9), so the anonymous
path leaves it null rather than guessing.

**How the card reads** (19 Aug, the page the client called hardest to take in). Each
one must be four labelled blocks and no more: the flag's plain-English name plus
where it came from · **What they wrote / What they asked** with the parent's own
words as the largest text · **Why it came up** · **Admin comment** with the controls.
Three things to check specifically:

- **The reason appears once.** The specific stored sentence, or the generic meaning
  of that kind of flag — never both. Both is what made twelve cards unreadable.
- **`Admin comment` is a real label**, not just placeholder text. A placeholder
  disappears the moment you type, which is exactly when you might want to check what
  the box is for.
- **Confidence reads as a word first**, then the number, and it is coloured. A bare
  `0.35` says nothing about whether to act.

Then the semantics worth a query: a card naming a teacher **must** be flagged
`possible_named_person` **and must not** score below 0.6. Naming a person is a
review trigger, not a defect in the writing — and it used to be penalised twice.

## 2.x · The consent file

`/admin/consents` is the A2P §3.3 defence file, and the only admin surface that
shows a **phone number in full**. Test rows are labelled, never filtered out; every
row carries the scope, the source and the wording version that number agreed to;
the download is built from what is on screen, and reading the resource writes an
audit row naming who took it.

**Pass:** a number that later texted STOP shows its `opted_out_at` next to the yes
it overrides. Nothing on this page is free text.

## 2.8 · Audit

**Pass:** every write from 2.4–2.7 has a row naming who did it. There is no path
that changes data without one — the audit row is written in the **same transaction**
as the change, so it cannot be lost separately.

```sql
select actor, action, resource, at from audit_log order by at desc limit 20;
select count(*) from audit_log where actor is null or actor = '';  -- must be 0
```

---

# M3 · PostHog

**Pass with no key:** analytics is inert and nothing breaks.

**With `NEXT_PUBLIC_POSTHOG_KEY` set at build time** — a build arg, not a runtime
value, so a key set on the server does nothing:

1. `grep -r "$KEY" .next/static/chunks/ | head -1` finds it. Without it, the bundle
   is clean and the build still succeeds.
2. Named events fire (`seed_completion_viewed`, `seed_referral_copied`, …) and
   `$pageview` fires on **route change** — App Router navigation doesn't reload the
   page, so this is the one that regresses silently.
3. **Autocapture and session recording must be off.** Confirm in the network tab:
   no DOM attributes, no input values, no screen content leaving the app. Invariant
   7 has no carve-out for analytics.

# M4 · QA

[qa-checklist.md](qa-checklist.md) is the walkthrough. Not yet walked by the client.

---

# Not built — and how you would know

These are ⬜ on purpose. Testing them is confirming the app is honest about the gap,
not finding a bug.

| Row | State | What you should see |
|---|---|---|
| **2C** caregiver's own flow (G1–G10) | **built, first cut** — full guide in [2c-caregiver-flow.md](2c-caregiver-flow.md) | `/caregiver` writes a `caregiver_claims` row; an admin matches it at `/admin/claims`. Still missing: **DELETE-by-text, which the consent copy promises** — see that guide |
| Pay range / median by area | captured, not aggregated | `pay_band` and `pay_benchmark_consent` are stored; no query anywhere computes a range |
| Credit granting | schema only | `credits` is never written. Referrals stop at `profile_complete` |
| Freshness pings | policy table only | `freshness_policy` holds per-category thresholds; no job reads them |
| Reference introductions | intent only | `reference_willing` is stored; no code connects two people or shares a number. Blocked on legal review |
| Matching, trend graphs, forwardable and golden answers, graph write-back, SMS compliance layer | Phase 2 | — |
| `market_options` import | blocked on the client | every taxonomy value in the app is a **placeholder** Pasadena list until Janet's sheet arrives. Worth saying out loud in any demo |

---

# Cross-cutting: the honesty paths

Worth one pass each, because they are the app's own promise and they only break
quietly.

1. **No database.** Unset `DATABASE_URL`, restart. Every write route answers
   `persisted: false`; no screen claims a contribution was stored; admin pages show
   the empty state and offer clearly-labelled sample rows for reviewing layout.
   `/api/health` reports `ok: true` — unconfigured is a supported state.
2. **Database configured but unreachable.** `/api/health` must go **503**. This is
   the case a rollout has to refuse: the container would accept a parent's
   contribution and drop it.
3. **No model key.** `confidence` stays null. No fake scores.
4. **No Twilio.** The screen says verification isn't switched on yet, rather than
   showing a code box that cannot be satisfied.
5. **Never in the logs:** phone numbers, names, free text. Trigger a failed write
   (a check-constraint violation) and confirm the log line carries the driver
   message or a class name — never the rendered SQL with bind parameters.

# Cross-cutting: performance

The admin is remote-database bound, not query bound. If a page feels slow, measure
before optimising:

```bash
# The floor. Every query costs this much before it does any work.
node -e 'process.loadEnvFile("web/.env.local");
const p=require("./web/node_modules/postgres");const s=p(process.env.DATABASE_URL,{max:1,prepare:false});
(async()=>{await s`select 1`;const t=performance.now();await s`select 1`;
console.log("round trip:",(performance.now()-t).toFixed(0)+"ms");await s.end();})()'
```

A page should be **one** round trip plus that floor. Two symptoms and their causes:
several hundred milliseconds per extra query means a `Promise.all` fan-out (each one
is a round trip, and on a cold pool a fresh TLS handshake); a page that is fast
twice and slow the third time means the pool went idle.
