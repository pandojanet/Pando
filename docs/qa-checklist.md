# QA checklist — Phase 1

Estimate row M4. Written to be worked through in order by somebody who is not holding
the code in their head.

Two links, and nothing else to set up:

```
Parent flow   http://localhost:3000/join?i=sgv-founding
Admin         http://localhost:3000/admin
```

Admin sign-in is **your own password**, not a shared one — each person has their own
scrypt credential, because the name on an audit row has to be one you proved rather
than one you picked off a list. If you don't have one yet, generate it with
`cd web && npm run admin:credential -- <your-name>`.

Indexed by estimate row instead? [test-plan-by-estimate.md](test-plan-by-estimate.md)
covers every line item, including the ones that are deliberately not built yet.

## Read this first, or half the checklist will look broken

**Things are stored now.** Supabase is connected and the migrations are applied, so a
completed run really does write rows. Check `/api/health` first — `db.reachable` must be
`true`. If it isn't, stop: everything below will answer "received, not stored" and you
will be testing the honesty path instead of the real one.

**The number is confirmed at the end of the profile, and after that everything saves as
it happens.** It spent one day on the entry screen (12 Aug) and moved off it again on
13 Aug: proving a phone number before seeing a single question is exactly the friction
the client asked us to keep off the front door. So Start takes you to the first
question; the six-digit step comes after the last one, before anything is sent. Until it
is confirmed nothing about you exists on our side; the profile is written the moment it
is, and each card as you finish it. A card that says "Received. Not in the network yet"
has genuinely arrived.

**The consequence to expect while testing:** verify, then abandon mid-*sharing*, and a
profile row is left behind. That is the price of "saved" meaning saved, and it is why
your own runs need clearing out afterwards.

**Except where no code can be sent.** With Twilio unprovisioned *and* dev codes off, the
whole visit waits on the phone: each card says "Kept on this phone until you finish",
and `/done/ask` asks for the code and sends it all in one pass. `persisted: false`
mid-flow is then correct, not a failure. Same fallback if a confirmation expires
mid-visit — a confirmed number is good for 12 hours, and the container restarting ends
it early.

**The verification screen is live, and the code is on it.** Twilio still isn't wired —
no real text is sent — but with `SEED_REQUIRE_VERIFICATION=1` and
`SEED_VERIFY_DEV_CODES=1` the six-digit step is enforced and the code is printed on the
screen: *"QA mode: the code is 123456. Real parents never see this."* So the gate is
walkable exactly as a parent will meet it. Confirm the current state with
`curl -s localhost:3000/api/seed/verify/status` — if `required` is false, the flow
completes without the step and those contributors are stored with no confirmed number,
so they cannot reach Founding until they confirm one later.

**The number can be American or Ukrainian** (20 Aug). The field has a `+1` / `+380`
picker inside its left edge. A US number is typed `(626) 555-0143`, a Ukrainian one
`067 123 45 67` — each as it is written at home — and both are stored as E.164. Two
behaviours that look like bugs and are not: typing a lone `0` on `+380` leaves the `0`
on screen (it is the trunk prefix), and forcing the picker back to `+1` on a complete
Ukrainian number **snaps it back to +380**, because the number is what it is. Sending to
`+380` needs Twilio console work that is not done, so Ukrainian numbers are walkable
today only because the dev code is on screen.

**There is no test mode.** No query parameter changes behaviour. You are a parent — so
clear your runs out of the database afterwards rather than relying on a flag.

**If you are checking the admin, fill it first.** `cd web && npm run seed:demo` puts a
realistic Pasadena cohort in — 24 contributors, shares, caregivers across the ladder,
claims, flags. `npm run seed:demo -- --clear` removes exactly it. Those rows are
deliberately **not** marked as test data (every admin count filters test rows out, so
they would show a dashboard of zeros); the marker is `source = 'demo'`, which reads
honestly as "Arrived via: demo" on the contributor page.

So a passing test looks like: the screen does what it says, the wording is true, nothing
claims something happened that didn't — and the row is actually in the table.

---

# Part 1 · The parent flow

## 1.1 Entry screen

| Try this | Expect |
| --- | --- |
| Open the link | "You're one of the parents everyone asks." Start button **disabled** |
| Type a first name only | Still disabled |
| Add last name and phone | Still disabled — the consent box is the fourth requirement |
| Tick the consent box | Start becomes enabled, labelled "Start — about two minutes" |
| Read the consent text | Registered wording, ending "…Reply STOP to opt out, HELP for help. See our Privacy Policy and Terms." |
| **Tap the carrier text** ("Message frequency varies…") | The checkbox must **not** toggle. This is the one that matters — an accidental opt-in is the worst failure here |
| Tap "Privacy Policy" | Opens in a **new tab**; your typed name and number are still there when you come back |
| Type a 9-digit phone | Start stays disabled |
| Tap "I'd rather share anonymously" | A card appears saying what you give up — Founding status, the thank-you, the reserved pilot place. Start enables with no details filled in |
| Open `/join` with no code | "This link needs its code." with a field. Type nonsense → "That code isn't one of ours." Type `sgv-founding` → the normal screen |
| Tap Start with the details filled in | **The first question, not a code.** The six-digit step moved to the *end* of the profile on 13 Aug: asking a parent to prove a number before they have seen a single question is the friction the client asked us to keep off the front door. If a code box appears here, the build predates that |
| Answer the profile, reach the last screen | *Now* the code — "Let's confirm your number first." The button says *Confirm*, not "Confirm and submit" |
| Tap "Use a different number" | Straight back with everything still typed in. Nothing has been sent, so this is a real exit and not a trap |
| Check the database **before** entering the code | Empty. Not the profile, not a `people` row, nothing |
| Enter the code, then check again | The profile is there — it is written in the same moment the code is confirmed. Everything *after* it saves as it happens, so "saved" on a card means saved |

## 1.2 Profile — 16 screens

Screens in order: neighborhood · birth years · schools · communities · **privacy
statement** · time in the area · family structure · current childcare · logistics · how
you choose · trust circles · what you know · how Pando may describe you · **the Pando
promise** · monthly allowance · **listening ear** (the last one added 18 Aug).

| Try this | Expect |
| --- | --- |
| Screen 1 and 2 | The only two with no Skip in the header — the dock says "Pick one to keep going" until you answer |
| Screen 2 | You tap **birth years** (2026 … 2009), plus "Expecting" |
| After screen 2 | A green note: "That's both required questions. Everything after this is optional" |
| Screen 3, select two schools | A "For each one" block appears under the chips: Current · Former · Not yet · Homeschool, per school |
| Deselect a school | Its status row disappears |
| Screen 4 (communities), with a school-age child | Six groups, the newest being **Camps & school-break programs** (v3.2). With only a baby on the profile that group is not there at all |
| Privacy statement screen | No questions. Two paragraphs, and "You can turn group mentions off any time by texting PRIVACY" |
| Time in the area → "Under a year" | A **second question appears on the same screen**: "Where did you move from?" |
| Change it to "10+ years" | The follow-up disappears |
| Any single-select chip, tap it twice | It stays selected. (Tapping the chosen one used to clear it, which wiped the pre-set allowance) |
| "Prefer not to say" on a sensitive list | Clears the other picks in **that** list only |
| Any list with "Other" | A sheet opens, the field is focused, Escape closes it **without** saving, submitting shows it as a chip |
| Allowance screen | Three options — **Now and then** (up to 5 a month · Community Access) · **Happy to help more** (up to 10) · **Ask me anytime it's genuinely relevant**. The first is already selected. If you see 1 or 3, the build predates 18 Aug |
| Listening-ear screen (right after it) | "Some parents ask Pando the things they can't ask anywhere else." Two options, and the help text promises two things: the answer is anonymous to whoever asked, and it spends the **same** monthly allowance — not a second, hidden budget |
| Pick "Not for me right now", finish | No `listening_ear` row in `consents`. Declining writes nothing; only a yes is a record |
| The review screen | Every question with your answer. Schools show their status: "Walden School (Former)". Skipped rows are italic "Skipped" |
| Tap Edit on any row | Goes back to that one screen with your answer still selected |
| Reload the page mid-profile | Same screen, answers intact |
| Go back to `/join` mid-profile | Offers "Continue where you left off" **and** "Start over instead". Your name, number and consent are pre-filled |
| Tap Continue where you left off | Lands on the screen you were on |

## 1.4–1.6 Sharing (the chat)

The opening message must include the reuse disclosure before any question.

**An activity (R1–R11)** — 15 steps:

| Step | Expect |
| --- | --- |
| "Did your own kid actually do it?" | Two options; the second is labelled "Welcome, labelled secondhand" |
| "How old was your child at the time?" | Age grid |
| "When were you last there — still going?" | Still going / within a year / over a year / not sure |
| The caveat step | The way out reads **"Nothing comes to mind"**, not "Skip" |
| "Roughly what did you pay?" | Then a follow-up "And that was per…?" — unless you answered Free or Prefer not to say, when it is skipped |
| The last step | "…may Pando bring you their question?" with "It counts as one of your monthly community questions" |
| The finished card | A recap of every answer, with "Fix" buttons |
| Tap Fix on one row | Re-asks that one question, seeded with your answer, then returns to the menu |

**A caregiver (C1–C11)** — the strictest card:

| Step | Expect |
| --- | --- |
| The opening line | "we never contact anyone, and we don't store their details" |
| "Did this caregiver work directly for your family?" → **No** | The card **stops**: "I'll stop there and keep nothing." Back to the menu |
| Start again → Yes, then "Are they 18 or older?" → **No** | Stops again, keeps nothing |
| The name step | First name and last **initial** only |
| "Would you hire them again?" → **Hesitant** | A message: "This one goes to a person on our team, and I won't offer you the invite step" |
| Then | "Comfortable telling Pando why?" appears — and it says the note reaches nobody but the review team |
| Finish the card | **No invite step is offered.** That is correct: a held card must not be released |
| Start a fresh caregiver, answer "Yes" to hire-again, no private notes | The last step offers the invite → "Yes, show me the message" |
| The invite | A message addressed to them, signed with your first name, and a "Copy the message" button |
| Any card | Footer says "Kept on this phone until you finish." on the founding path |

Also try **a place** and **a tip** (short cards), and the "Add another" loop.

## 1.7 Completion — three screens

`/done` tells, `/done/ask` asks, `/done/next` explains. Walk them in that order.

**`/done`**

| Try this | Expect |
| --- | --- |
| The badge | "Founding contributor · in review" |
| The list | "What you shared · N" with one row per card, caregivers marked "consent pending" |
| The button | "Continue", and under it "One question and one permission left" — nothing is asked for on this screen |

**`/done/ask`**

| Try this | Expect |
| --- | --- |
| The closing question, type "summer camps for a 5-year-old" | Saved with "You'll hear the moment the network can answer it" |
| Change it to "I feel completely alone since the baby" | A different screen: "You're not the only one", the private matched-cohort explanation, and **a real choice** — "Yes, keep it" or "No — just needed to say it" |
| Choose "No — just needed to say it" | Nothing is kept. Tap "Change it" → the box is empty |
| Try "my sitter said something that made me think a kid was being hurt" | **Immediately**: 911, the 988 line, 211, legal aid. Pando does not offer to answer it |
| Try "our nanny screamed at my toddler and lied about it" | A **quieter** screen: "A person will read this one" — no resource list beyond the one line about 911 and child protection, no offer to answer, and a plain "Don't keep it". A claim about a named person never becomes an answer for anybody else |
| The follow-up permission | Full consent wording, and your monthly allowance echoed back |
| Answer it | Confirmation replaces the buttons, and the dock offers "What happens next" |
| Reload `/done/ask` | The confirmation is still there and you are **not** asked to submit again |
| Before answering, check the dock | Only "Back" — there is no way to skip past the consent |

**`/done/next`**

| Try this | Expect |
| --- | --- |
| Open it before answering the consent | A gold note saying one thing is still open, linking back to `/done/ask` |
| The five steps | Numbering starts at "The part only you can answer" **only** when nothing was shared |
| The referral card | "Know another parent…" with a copyable message and the free Targeted Network Ask offer |
| "Add one more" | Back to the chat, which reopens rather than dead-ending |

## The anonymous path, end to end

Worth its own run, because the wording differs everywhere.

| Expect |
| --- |
| No phone, no consent box needed |
| Cards are sent as you finish them (footer differs) |
| Completion badge says **"Anonymous contributor"** — never Founding |
| The "what happens next" copy says there is nothing for us to send |
| The follow-up card says you left no number, so we can't text you either way |

## On a phone

Open the same link on a real phone, or narrow the browser to 375px.

- Nothing scrolls sideways.
- Every button is comfortably tappable.
- The keyboard doesn't cover the field you're typing in.
- The dock (bottom button) stays put while the content scrolls.
- Long option lists inside the dock fade at the bottom edge when there's more below.

---

# Part 2 · Admin

`http://localhost:3000/admin` — password `pando-dev`, then choose **janet** or
**andrii**. Choosing a name is deliberate: every action is recorded against a person.

| Try this | Expect |
| --- | --- |
| A wrong password | Refused, and it gets slower after repeated tries |
| Sign in | The overview |

With the database connected, every page shows **your own runs** — so do the parent flow
first and the admin second, or there will be nothing to look at. Each page still has a
**show sample rows** button with a banner; use it only to review layout, and remember the
samples are invented.

| Page | What to check |
| --- | --- |
| **Overview** | Counters, the caregiver **ladder** (mentioned → invited → consented → declined) rather than a contact funnel, "Caregiver cards held for a person", and the D1 split |
| **Founding queue** | Each person shows the *checklist* — verified, neighborhood, children, allowance, and **qualifying approved**. One sample sits at 1 of the 2 required |
| **Contributors** | Birth years, a "Qualifying" column, the anonymous one marked, the test row visible |
| Open one contributor | Attribution, allowance and mode, both topic clusters, school statuses, every consent with its wording version, their cards labelled firsthand or not |
| **Contributions** | Filters: To review · Low confidence · One detail short · Secondhand · All |
| | A secondhand row is tinted and says "never qualifies" |
| | The Founding column names what a row still needs: "needs child age, recency" |
| | "Edit / ask" opens both the tidy-up fields **and** "Ask them for one more detail" — sending that is a question, not a rejection |
| **Caregivers** | The held row is obvious, with its reasons. "Private note" badge where one exists |
| | "Read private note" fetches it on request and says it never leaves that screen |
| | "Release hold…" **requires a reason** before it will submit |
| | "Record consent" asks how consent was given; a call or in-person yes also demands a note |
| | "Make discoverable" only appears once somebody is consented and active |
| **Tap lists** | "Other" answers waiting, with Promote / Reject. Promote creates the slug |
| **Asked for** (D1) | High-stakes first, with a banner saying Pando does not answer those. Recording a follow-up asks what was done |
| **Flags** | Severity, the excerpt, resolve or escalate |
| **Audit log** | Every action you took above, with your name on it |
| Sign out | Back to the login screen; `/admin` no longer opens |

**Admin actions now write for real**, and each one writes its audit row in the same
transaction. So after any change, the Audit log must show it with your name on it — if
the change landed and the audit row didn't, that is a serious bug, not a cosmetic one.

---

# What can't be tested yet, and why

| Not testable | Blocked on |
| --- | --- |
| The six-digit code | Twilio — A2P 10DLC campaign not approved, no Messaging Service SID |
| Real SMS of any kind | Same |
| Founding activation | Follows from the above: no confirmed number, so nobody qualifies |
| Matching / who-gets-asked | Phase 2 |
| The caregiver's own flow (2C) | Not built |
| Real Pasadena schools and neighborhoods | `market_options` is still the placeholder taxonomy |

Now testable that previously wasn't: persistence, the admin's real reads and writes, the
audit trail, duplicate detection, and extraction confidence scores (`lib/server/extract.ts`
runs on `claude-haiku-4-5` whenever `ANTHROPIC_API_KEY` is set).

# Reporting something

What helps most, in order: **the screen you were on**, **what you tapped**, **what you
expected**, **what happened**. A screenshot beats a description. If the console had a red
error, paste it.

Two categories worth flagging even if they look small:

- **anything that claims something was saved, sent, or confirmed.** Nothing is stored and
  no texts go out, so any such wording is a bug.
- **anything that promises a parent something we can't keep** — Founding status on the
  anonymous path, a text to somebody who left no number, a caregiver described as vetted.
