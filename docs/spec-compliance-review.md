# Spec compliance review — Phase 1 as built

Audit of everything in `web/` against every document we have. Written after
estimate item 1.7 landed.

**Sources**

| Source | What it is |
| --- | --- |
| `Janet Estimate.xlsx` | The line-item estimate (1.1 … 19.5) this build follows. |
| `Pando — QC Eng Spec June Revision V2.pdf` | Engineering spec v3.1 ("QuitCode Ready"). Section refs below are to this. |
| `опис.pdf` (105 pp) | Transcript of the project analysis, including **Janet's answers** to the open questions and her **v3.2 additions**. Newer than the spec — where they conflict, this is the client's latest word. |

Legend: ✅ built and matches · 🟡 built but deviates from the newest decision ·
⬜ not built yet (later estimate row) · ❓ needs a client decision.

---

## 1. What matches

| Requirement | Source | Where |
| --- | --- | --- |
| Tap-first profile, only neighborhood + child age required, everything else one-tap-or-skip | §8.5 | `lib/questions.ts` |
| Ordered by matching value, required first | §8.5 | `lib/questions.ts` (`SCREENS`) |
| Child age re-evaluates later questions **and** chips, live | §8.5 | `Option.bands`, `Question.showForBands` |
| Sensitive groups always offer "None / prefer not to say", exclusive | §8.5 | `SENSITIVE` + `PREFER_NOT` |
| Each selection produces a weighted `social_affinities` row (school 5 · activity 4 · neighborhood 3 · group/faith 3 · age 2) | §7.1, §8.1 | `lib/derive.ts` |
| Life-relevance captured as posture, never income | §7, §8.3 | `budget` / `logistics` / `family_setup` / `trust_circles` → `life_relevance` |
| "Other" goes to `pending_options`, is **not** matchable until promoted | §8.1 | `derivePendingOptions`, never an affinity row |
| Conversational capture that lands in structured fields, not prose | §3.1, 1.4 | `lib/seed-chat/scripts.ts` + `StepWidget` |
| Activity questions verbatim (7 fields) | §3.4 | `scripts.ts` → `activity` |
| Caregiver questions (type, first name + last initial, ages, how known/how long, what's special, caveat, reference, contact) | §3.5 | `scripts.ts` → `caregiver` |
| **No minors**: 18+ gate that discards the card | §12, Janet: "not listed. Period." | `age_gate` step with `stopIf` + server 422 |
| Caregiver never activatable from the contributor side: `consent_status: pending`, `active: false` forced server-side | §3.5 ⚠, §12 ⚠ | `app/api/seed/save/route.ts` |
| Only a last **initial** is stored | §3.5 | save route splits `[first, initial]`, truncates to 1 char |
| Reference willingness comes from the **nominating parent**, not the caregiver | Janet's answers (scope = listed + contactable, *not* reference) | `reference_willing` step is asked of the parent |
| Named providers (tutor, coach) treated as caregivers | Janet: "same rules" | `CAREGIVER_TYPES` includes tutor/coach → same script, same gate |
| Free text capped at 500 chars, control chars stripped, ids validated | §19 | `lib/sanitize.ts` + routes |
| Phones stored E.164 | §19 | `lib/phone.ts`, `cleanE164` |
| Never log personal data | §19 | routes log counts/enums only — verified in the dev server log |
| Autosave + resume, no username/password | 1.10 | `lib/storage.ts` |
| One shared invite link + QR entry | 1.1, Janet (Slack) | `/join?i=…&src=qr` + `next.config.ts` redirect |
| Funnel instrumentation at every step | 3.1 / M3 | `lib/analytics.ts` (PostHog-shaped, provider not attached) |
| Weights/prices as config, not hardcoded behaviour | §18.1 | weights live in one data file; see 🟡-4 below for the remaining half |
| Founding status is **not** self-granted | Janet's founding approval queue | 1.7 shows "being confirmed"; server sets `contributor_status: pending_founding` |
| Follow-up permission is its own consent, separate from Blast and reference | analysis (three escalating consents) | `lib/consent.ts` + completion screen |

---

## 2. Deviations to settle 🟡

**2.1 Unique invite links vs one shared link** — ✅ **decided 31 Jul: keep one shared link**
The estimate (1.1) and Janet's Slack answer say *one* shareable link; her v3.2
update asks for unique per-contributor links. Ours stays **one shared link** by the
developer's call, so nothing changes in the code.

What that costs, so it isn't discovered later:

- **No per-parent attribution.** "% of invited who completed" has to be measured
  against a denominator of ~350, not per link. Per-link funnels are still possible
  if Janet uses a handful of channel links (`?i=sgv-founding&src=southpas`) — the
  `source` field already travels all the way to the payload.
- **The founding approval queue loses its strongest field.** It was designed around
  "invited by / how did you get this link", which is what lets Janet recognise a
  person in seconds. With one link, that has to be *asked* — one optional free-text
  question ("who told you about this?") on the entry or completion screen, or she
  reviews on neighborhood + school + child ages alone.
- **Return-to-edit has no authorization.** A shared link is not proof of identity, so
  coming back to change submissions needs the OTP component (Phase 2) or stays
  device-local only, as it is today.

**2.2 Consent record at every phone-capture point** 🟡 partly fixed
v3.2 requires `consent_status / source / timestamp / text_version / opted_out_at`
wherever a number is taken, Seed Tool included. Item 1.7 now does this properly
(`lib/consent.ts`, versioned text, server-stamped). **The entry screen (1.1) does
not** — it still captures a number with a reassurance line and no consent record.
Fix: show the same versioned consent line under the phone field and post the same
record shape. ~1 h.

**2.3 Demand capture missing** ⬜ (new v3.2 row)
"What local parenting decision are you trying to figure out right now?" — free text
+ optional category chips, at the very end of seeding, neighborhood taken from the
profile, skippable, written to `demand_signals`. It is deliberately placed on/just
before the completion screen, so it belongs next to the code 1.7 just added.

**2.4 Where matching weights live** 🟡 design note
§8.1 says write the weight into the affinity row; §18.1 says weights must be
changeable without a deploy. The analysis resolves it: rows carry **membership**
`(type, value)`, and the weight is joined from a config table at query time. Our
`derive.ts` currently sends `score_weight` inline — fine as a snapshot, but the
matching query in Phase 2 must read config, not the row, or a weight change needs a
backfill. Documented in `web/README.md`; the n8n plan repeats it.

**2.5 Adjacent neighborhood, age bands** 🟡 design note
`adjacent_neighborhood` is a property of a **pair**, not a membership — it belongs
in a `neighborhood_adjacency` table resolved at query time, and must not
double-count when the neighborhood already matched. Age must match as **overlapping
bands** with multi-child overlap, not exact equality. We already derive age *bands*
(`ageBandsOf`) rather than raw years, which is the right shape; adjacency is
correctly absent from what the client sends.

**2.6 Caregiver contact retention** 🟡 promise made, job still missing
Janet accepted storing the caregiver's number at nomination **on conditions**:
restricted (admin-only) and **deleted if they decline or don't answer in the
window**. The capture step now says exactly that to the parent handing the number
over ("Only Pando's team can see it, and we delete it if they say no or never
reply"), so the promise is live — which makes the backend job that honours it
mandatory before real nominations are collected, not optional. The retention window
itself is still unconfirmed (§4.3). Privacy policy needs the matching line.

**2.7 Answer labels must be verbatim** 🟡
Phase 2 copy has to use the spec's exact strings ("Validated by multiple parents",
"Shared by a local parent", …) because that copy is what the carrier registration
describes. Our marketing page uses plain-language variants — fine for marketing,
but the answer builder must not paraphrase.

**2.7a "Network Ask" and the no-answer guarantee** — new client copy, 31 Jul ⚠
The updated `index.html` renames **Network Check → Network Ask** everywhere (ported)
and adds a promise that was not in any spec:

> "your first one is on us — and **if the network can't get you a useful answer,
> you're not charged**."

That is now published on the public site, so the Blast workflow has to honour it.
Two consequences for Phase 2: refunds stop being an internal courtesy (estimate 7.7
"flag refunds for manual handling") and become a **stated guarantee**, and someone
has to define "useful answer" operationally — no responses at all is easy, but
"responses arrived and were weak" is a judgement the admin quality rating already
makes. Raise with Janet: is the guarantee "no responses collected" or "admin judged
them unusable"?

**2.8 Camps as a category** ⬜ zero-code
Add to `market_options` data. Also add the seeded Pasadena lists from Janet's
Google Sheet — `lib/market-options.ts` is still a **placeholder** and every value
in it is a guess.

**2.9 `contributors` vs `users`** 🟡 decided, not yet reflected
Agreed with Janet's logic: one person, phone = key, "contributor" is a derived
behavioural status, not a table or a role. Phase 1 payloads therefore should not
imply a second identity. Nothing in the frontend blocks this — but the n8n workflow
must write in a way that merges on phone, not create a parallel `contributors` row
that later duplicates a `users` row.

**2.9a Test data** 🟡 app side done
Entering with `?test=1` marks the session, shows a TEST tag on every screen, and
sends `is_test: true` with the profile, every card and the completion. The workflows
must exclude those rows from the graph and from metrics — otherwise the pilot's
first numbers include our own walkthroughs. `is_test` is also a reserved field name,
so it can't be smuggled in from inside `fields`.

**2.10 Provenance / audit fields** ⬜
Every stored record needs `provenance` (`parent_submitted` | `admin_entered` |
`migrated`), `entered_by`, `entry_reason`, `is_test`, and the hard rule that a
"vouched/validated by a parent" label requires `provenance = parent_submitted` **and**
a non-empty contributor. Our payloads are all parent-submitted, so nothing is wrong
yet — the fields have to exist before the admin can write anything.

---

## 3. Not built yet (later estimate rows) ⬜

1.3 affinity derivation as a backend job · 1.5 / 1.6 as *AI-driven* cards
(confirm-back on low confidence) · 1.8 extraction engine + confidence scores ·
1.9 annotation & flag layer · 1.10 server-side session/OTP · all of M2 (admin) ·
M3 PostHog provider · M4 QA · everything in Phase 2 · v3.2 additions (compliance
layer, freshness pings, credits, graph write-back, forwardable answers, golden
answers, founding approval queue, matching test harness, demand capture).

Note on 1.5/1.6: the *capture* is built and produces clean fields **without** an
LLM in the loop. The estimate rows describe conversational cards driven by an
extraction engine; our version reaches the same data by asking closed questions.
That is a deliberate simplification of the risk the spec warns about ("pure
open-ended chat creates messy data") and it means 1.8's job shrinks to the free-text
fields only (`what_makes_it_great`, `caveat`, tips) rather than every answer.

---

## 3b. Client feedback round, 3 Aug 2026 — what landed

Janet's list, item by item. Everything marked ✅ is in the app and was walked on a
live server; ⬜ items name their blocker.

| Client asked for | State |
| --- | --- |
| Store birth years, not ages; keep the capture date | ✅ `children[{birth_year, expecting, due_year, due_year_precision}]` + `child_ages_at_capture` + `profile_captured_at`. "Expecting" records a due *year* marked `assumed_capture_year`. |
| First **and** last name; name + verified mobile required for Founding; anonymous path clearly labelled | ✅ Two name fields, phone, consent checkbox — Start stays disabled until all four. The anonymous card says in so many words that it isn't eligible for Founding status. |
| SMS consent: required, unchecked by default, its own element, never bundled; exact registered wording; both links live | ✅ Its own `<label>`, unchecked, blocks Start; wording verbatim in `lib/consent.ts`; Privacy and Terms are real in-app links. |
| OTP at submit: 6 digits, 10-min expiry, max 3 resends; nothing stored until confirmed; store consent timestamp + text version + phone + verification time; send via the Messaging Service | 🟡 Whole structure built and enforced server-side (5 wrong guesses burns the code, too). **Sends blocked** on A2P campaign approval + the Messaging Service SID — until then the screen says text verification isn't switched on yet, and `SEED_VERIFY_DEV_CODES=1` lets QA walk it. |
| Unchecked box ⇒ no OTP send, no submit | ✅ 422 from `/api/seed/verify/start` without consent, and the button can't be reached without it. |
| Missing profile questions: communities incl. invite-link group, go-to topics incl. lived experience, two privacy taps, monthly allowance (default 3) | ✅ All four. The allowance is treated as a consent control: it defaults to 3, travels with every payload, and single-select chips no longer clear on a second tap. |
| Multi-select for budget / logistics / family setup; split family setup into structure + current childcare; rename "Budget posture" | ✅ Now "How do you usually choose a class or camp?", plus "Who's in your family?" and "Who helps with the children right now?" as separate questions. |
| Trust circles: ranking not filter, multi-select, new copy | ✅ "Whose answers would you trust most? — Pando weighs these first, and always finds the best available match." Stored as `life_relevance.trust_circle` rows. Logging the selection *with each match decision* is Phase 2. |
| Activity card: caveats, who-it's-for, who-it-might-not-suit, roughly-what-you-paid, was-it-worth-it, per-rec follow-up permission | ✅ All six, with the "counts as one of your monthly community questions" line on the follow-up step. |
| Caregiver conversation: duration + recency, kids' ages, strengths, fit vs private concerns as two questions, hire-again branch with review hold, pay + separate benchmark consent, needs-change, parent-sent invite | ✅ 19 steps. Hire-again "No" and any private note hold the card for a human and say so on the spot; the hold is re-derived in the route so it can't be removed by the client. |
| "Saved on this phone only" is confusing / alarming | ✅ Reworded to "Kept on this phone until you finish." — which is now literally true: on the founding path nothing is sent until the code is confirmed. |
| Demand question in the flow | ✅ On the completion screen, with the honest promise ("we'll text you when Pando can actually help — we're not promising an answer today"). |
| Opt-in keywords START and UNSTOP only (remove YES) | ⬜ Carrier-console setting, not code. Recorded in `lib/sms-templates.ts` so it isn't lost. |
| $15 thank-you / contest | ⬜ Waiting on the client's copy. |
| Neighborhood list provenance; preschool/daycare CSV | ⬜ Our placeholder (`lib/market-options.ts`) until the sheet arrives. |

**The one thing worth discussing back.** Janet's note — "if shared contributions
genuinely aren't reaching the server, that's a blocker — my admin review queue is the
whole quality system" — and her OTP rule pull in opposite directions, so the app now
does both in sequence: hold everything on the device, then flush it all the moment the
code is confirmed. The consequence to accept knowingly: a parent who abandons *at the
code step* leaves nothing behind, not even a partial card. That is what "nothing
persists" means. Separately, contributions still don't reach a database at all — the
n8n workflows behind `save` and `complete` aren't built yet, which is a different
blocker with a different fix.

## 3c. "Pando Seed Conversation — Question Set", July 2026 (received 3 Aug)

The authoritative question list. Part 1 and Parts 2A/2B are now built from it
one-to-one; what follows is only what it *changed*, and what remains.

**Reversals — things this document undid.**

| Was built as | Now |
| --- | --- |
| Caregiver's phone collected, admin-only, deleted on decline; Pando asks for consent | **No contact details at all.** Pando never contacts them; the parent sends the invite (`lib/caregiver-invite.ts`). The save route refuses `contact` / `caregiver_phone` outright. |
| Two privacy taps ("say my neighborhood" / "say we share a school") | **P13, one tap:** anonymous-but-verified, or first-name-where-it-cannot-identify-you. Plus the disclosed aggregate-mention rule — groups of five or more, PRIVACY to turn it off. |
| Ages tapped as ages | **Birth years tapped**, converted at capture. The stored answer is still the age because that is what gates later questions, and it round-trips exactly. |
| Founding "being confirmed" after finishing | **Activates on the second approved contribution**, with the lifecycle copy received → being read → added to Pando. |
| Demand question saved and acknowledged | **Routed** — ordinary / peer-support / high-stakes, per D1's table. |

**Kept deliberately, against the document.** Trust circles ("whose answers would you
trust most") is not in this list, but the client asked for it explicitly in the 3 Aug
feedback round, including new copy. It stays, as `life_relevance.trust_circle`. Worth
one line of confirmation.

**Deviations that need a decision.**

1. **P6's invite-group confirmation** should read "You joined through [group]. Is that
   one of your communities?" With one shared invite link we cannot name the group, so
   we ask which group the link reached them through instead. Unique links would fix
   it — the same open question as attribution and D2 referral credit.
2. **D2 referral credit is unattributable** for the same reason. The card asks the new
   parent to mention who sent them; without unique links that is the best available.
3. **P5's list is a placeholder** — waiting on the CSV with preschools and daycares,
   and on the provenance of the neighborhood list.
4. **P9b's "limited backup support"** is stored as a childcare value, though it is
   arguably a life-context signal of its own. Left as the document has it.
5. **"Names a specific person negatively"** (D1's fourth row) is not detected. Any
   non-ordinary question is flagged for human review, which catches most of it, but a
   politely-worded complaint about a named person, filed under "Childcare", reads as
   ordinary. Detecting it properly is the extraction workflow's job (1.8).

**Not built: Part 2C, the caregiver's own flow (G1–G10), marked BUILD NOW.** It is a
second surface rather than an extension of the seed tool: identity + mobile
verification, consent to create a private profile with decline/delete at every step,
roles wanted, child-age experience, areas served + driving, days and hours, rate
expectations, openness to reference introductions, permission to appear in answers,
permission to be introduced. The visibility ladder — mentioned → invited → consented →
discoverable → introducible — is the part to model first, because each step is a
separate consent and the invariant is that visibility only ever increases. The OTP
layer, the versioned consent helper and the write gate it needs already exist.

**Founding qualification (documented, not yet enforced anywhere).** Qualifies on: P1–P4
complete + verified consent · the rest answered or explicitly skipped · allowance at 3
or higher · **two** approved Founding-qualifying contributions. Qualifying means a
findable subject · firsthand · child-age context · recency · at least one specific
strength · fit context · caveat prompt answered ("nothing notable" counts) · fresh for
its category. One exceptional firsthand caregiver nomination can qualify alone by admin
override. Labelled-secondhand and older historical context are welcome but never
qualifying. This belongs in the admin approval queue and the n8n review workflow; the
app already captures every field it needs, including `firsthand`.

## 4. Questions for the client

1. **One shared link or unique per-contributor links?** (2.1) — blocks attribution,
   `invited_by`, and whether return needs OTP.
2. **Do submissions from `pending_founding` / `request_invite` people enter the
   graph immediately, or wait for approval?** Shareable links make this a real hole.
3. **Caregiver-contact retention window** — how many days without an answer before
   the number is deleted?
4. **Freshness thresholds per category** — camps are seasonal, classes churn faster
   than playgrounds. Needed for the ping job (default 120 days).
5. **Does the Seed Tool consent text cover future SMS?** Answered 3 Aug: the client
   supplied the registered wording, now used verbatim
   (`SMS_CONSENT_TEXT_VERSION = seed-sms-2026-08-01`) alongside the follow-up consent
   (`seed-followup-2026-07-31`).
7. **The Messaging Service SID** — needed before a single code can go out, and it
   arrives "separately". Until then verification cannot complete, so no founding
   parent can be stored.
8. **Is the review queue meant to see abandoned sessions?** Today it cannot: nothing
   is stored until the code is confirmed (client's own rule). If partial
   contributions should be reviewable, the rule has to relax.
6. **Who imports the Pasadena `market_options` Google Sheet, and when?** Until then
   every taxonomy value in the app is a placeholder.
