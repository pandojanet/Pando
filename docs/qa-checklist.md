# QA checklist — Phase 1

Estimate row M4. Written to be worked through in order by somebody who is not holding
the code in their head.

Two links, and nothing else to set up:

```
Parent flow   http://localhost:3000/join?i=sgv-founding
Admin         http://localhost:3000/admin        (password: pando-dev, then pick a name)
```

## Read this first, or half the checklist will look broken

**Nothing is stored.** No database or n8n is connected, so every save answers
"received, not stored". That is the intended state — the app is built to be honest about
it rather than pretend. What you are testing is the interface and the rules it enforces.

**There is no verification screen.** Twilio isn't wired, so the six-digit code step is
switched off and the flow completes without it.

**There is no test mode.** No query parameter changes behaviour. You are a parent.

So a passing test looks like: the screen does what it says, the wording is true, and
nothing claims something happened that didn't.

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

## 1.2 Profile — 15 screens

Screens in order: neighborhood · birth years · schools · communities · **privacy
statement** · time in the area · family structure · current childcare · logistics · how
you choose · trust circles · what you know · how Pando may describe you · **the Pando
promise** · monthly allowance.

| Try this | Expect |
| --- | --- |
| Screen 1 and 2 | The only two with no Skip in the header — the dock says "Pick one to keep going" until you answer |
| Screen 2 | You tap **birth years** (2026 … 2009), plus "Expecting" |
| After screen 2 | A green note: "That's both required questions. Everything after this is optional" |
| Screen 3, select two schools | A "For each one" block appears under the chips: Current · Former · Not yet · Homeschool, per school |
| Deselect a school | Its status row disappears |
| Privacy statement screen | No questions. Two paragraphs, and "You can turn group mentions off any time by texting PRIVACY" |
| Time in the area → "Under a year" | A **second question appears on the same screen**: "Where did you move from?" |
| Change it to "10+ years" | The follow-up disappears |
| Any single-select chip, tap it twice | It stays selected. (Tapping the chosen one used to clear it, which wiped the pre-set allowance) |
| "Prefer not to say" on a sensitive list | Clears the other picks in **that** list only |
| Any list with "Other" | A sheet opens, the field is focused, Escape closes it **without** saving, submitting shows it as a chip |
| Allowance screen | "3 a month" is already selected and labelled Default |
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

## 1.7 Completion

| Try this | Expect |
| --- | --- |
| The badge | "Founding contributor · in review" |
| The closing question, type "summer camps for a 5-year-old" | Saved with "You'll hear the moment the network can answer it" |
| Change it to "I feel completely alone since the baby" | A different screen: "You're not the only one", the private matched-cohort explanation, and **a real choice** — "Yes, keep it" or "No — just needed to say it" |
| Choose "No — just needed to say it" | Nothing is kept. Tap "Change it" → the box is empty |
| Try "my sitter said something that made me think a kid was being hurt" | **Immediately**: 911, the 988 line, 211, legal aid. Pando does not offer to answer it |
| The referral card | "Know another parent…" with a copyable message and the free Targeted Network Ask offer |
| The follow-up permission | Full consent wording, and your monthly allowance echoed back |
| Answer it | Confirmation replaces the buttons |
| Reload `/done` | The confirmation is still there and you are **not** asked to submit again |
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

Every page starts with an honest empty state — there is no backend. Each has a button to
**show sample rows**, and a banner saying they are samples. Turn it on to review layout
and behaviour.

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

**Every admin action will say "not stored (no admin_write hook)".** That is correct
today. What you are checking is that the refusals fire and the wording is right.

---

# What can't be tested yet, and why

| Not testable | Blocked on |
| --- | --- |
| Anything persisting | Supabase + n8n not connected |
| The six-digit code | Twilio not integrated |
| Real SMS of any kind | Same |
| Extraction confidence scores | The 1.8 workflow's AI node is a placeholder |
| Duplicate detection on real names | Needs data in the database |
| Matching / who-gets-asked | Phase 2 |
| The caregiver's own flow (2C) | Not built |

# Reporting something

What helps most, in order: **the screen you were on**, **what you tapped**, **what you
expected**, **what happened**. A screenshot beats a description. If the console had a red
error, paste it.

Two categories worth flagging even if they look small:

- **anything that claims something was saved, sent, or confirmed.** Nothing is stored and
  no texts go out, so any such wording is a bug.
- **anything that promises a parent something we can't keep** — Founding status on the
  anonymous path, a text to somebody who left no number, a caregiver described as vetted.
