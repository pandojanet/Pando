---
name: tap-first-flow
description: How Pando builds question flows people actually finish — one question per screen, tappable options instead of typing, skip and "prefer not to say", conditional questions, autosave and resume, review before submit, and funnel instrumentation. Use when adding or changing any questionnaire, onboarding, or multi-step form, or when drop-off needs reducing.
---

# Tap-first flows

"Tap, don't type" is a core product principle, and it isn't only about friction —
typed answers produce unmatchable data. Every tap is a canonical id that can be
scored; every typed answer is a cleanup job. Design for the id.

## The shape

**One question group per screen.** Eyebrow → title as a question → one line of
help → options → dock. A parent should understand the screen in under two seconds
without scrolling.

Group questions on one screen only when they're the same *kind* of thing (three
community lists together, e.g.) — then each gets a small uppercase label and the
screen title covers all of them.

Ordering: **required first, then by matching value.** Ask the two things you
genuinely need before you have earned any patience, and tell the parent when
they're past them:

> "That's both required questions. Everything after this is optional — it just
> sharpens who Pando asks on your behalf."

## Options

- Pre-load real local values as chips; keep them short enough to read at a glance.
- Multi-select is the default. Single-select only when the answers are genuinely
  exclusive (budget posture, neighborhood).
- **Sensitive groups always offer an out.** Worship, clubs, parent groups, family
  setup get `None / prefer not to say` as an `exclusive` option: choosing it clears
  everything else in that group, and it's stored (it means "asked and declined")
  but never produces a matching row.
- **"Other" is a fallback, not a first-class answer.** It opens a bottom sheet,
  the value becomes a `pending_options` row for admin review, and it renders as a
  distinct gold chip so the parent sees it's provisional.
- Long lists get filtered by context rather than searched — see gating below.

## Conditional questions

Gate on an answer the parent already gave, and **re-evaluate when that answer
changes** — not once at mount.

In this codebase both levels live in `lib/questions.ts`:

- `Option.bands` — hide an individual chip (baby swim class for a 12-year-old).
- `Question.showForBands` — hide a whole question (school, for a family with only
  a newborn). If every question on a screen is hidden, the screen disappears from
  the flow and the progress total shrinks with it.

The parent goes back, adds an 8-year-old, and the school question is simply there
when they return. No reload, no stale list.

## Progress and skipping

- Segmented progress bar, not a percentage: a parent can count what's left.
- Show `n of m` or a header-right **Skip** on optional screens. Exactly one skip
  affordance — a header Skip *and* a dock skip is a decision the parent didn't ask
  to make.
- Required screen with nothing chosen: dock button disabled, hint reads "Pick one
  to keep going". Never a red error for something they haven't done yet.
- Record skips (`answers.skipped`). Which question people skip is a finding, not
  an absence of data.

## Autosave, resume, review

- Persist after **every tap** to a versioned key (`pando.seed.v1`), merged over a
  default answers object on read so a mid-pilot deploy can't break a session.
- Wrap all storage access in `try/catch` — Safari private mode throws on write —
  and degrade to "works, but can't resume".
- Offer resume explicitly on the entry screen ("Continue where you left off" /
  "Start over instead"). Never silently restore into the middle of a flow.
- End with a **review screen**: every question, its answer or "Skipped", and an
  Edit/Add jump. It is the cheapest data-quality tool available, and it's where a
  parent notices they mis-tapped an age.

## Instrumentation (what the pilot is judged on)

Emit named events at the call site as you build, even before the analytics
provider exists (`lib/analytics.ts`):

`link_opened` · `invite_valid|invalid` · `profile_started|resumed` ·
`question_answered` · `question_skipped` · `other_submitted` · `screen_advanced` ·
`screen_back` · `review_viewed` · `profile_saved` · `save_failed` ·
`session_abandoned` (fired on `visibilitychange` → hidden, carrying the last step
reached).

Properties carry ids and counts only — **never** a phone number, a name, or free
text.

## Chat capture (the seeding conversation)

Same rules, different clothes. When a flow should feel like texting rather than
filling in a form:

- **The transcript is messages; the dock is the widget.** Never put the active
  input inside a bubble — the answer control lives in one fixed place at the
  bottom, whether that's four menu tiles, chips, or a textarea. Answered widgets
  collapse into the parent's own bubble.
- **Scripted, not generative.** Each share type is a list of steps with a field
  and a widget (`lib/seed-chat/scripts.ts`). No extraction pass, no way for a
  model to invent a question. A backend can later decide the next step; the
  widgets stay the same.
- **One typing beat between turns** (~430ms, 0 under reduced motion). It reads as
  a person, and it stops double-taps landing on the next question.
- **Hide the widget while "typing".** The dock shows an empty placeholder — the
  parent can't answer a question that isn't on screen yet.
- **Recap every finished card** as labelled fields. It's the proof that a chat
  produced structured data, and it's where a parent spots a wrong tap.
- **"Change last answer"**, not a general edit mode: trim the transcript back to
  the last parent bubble, clear that one field, re-ask. Cheap to build, covers
  the mistake people actually make.
- **Add-another loop**: after each card the menu returns, with an explicit way
  out ("That's me for now"). Never dead-end into a wall of thanks.
- **Pin to the bottom by scrolling the container that actually scrolls** (window
  on a phone, the framed card on desktop), twice — once now, once after late
  reflow. `scrollIntoView` on an anchor lands the newest message behind the
  sticky dock; `requestAnimationFrame` never fires in a backgrounded tab. Re-pin
  on `resize` and `visualViewport` resize too, or the keyboard closing leaves the
  live question hidden.
- **Keep the widget dock under half the screen** on a 360×640 phone: cap option
  scrollers in both dvh and rem, and cut dock copy to one line mid-card.
- **Safety gates abort, they don't record.** Answering "under 18" to a caregiver
  age gate discards the card and says so kindly. Anything the backend must
  guarantee (consent pending, no minors, initials only) is re-enforced in the
  route handler, never trusted from the chat.

## Anti-patterns

- A long scrolling form with 11 questions. It looks efficient and it converts worse.
- Free-text where a list would do "because we don't have the list yet". Ship a
  placeholder list, flag it, get the real one.
- Requiring more than the two things you truly need. Every extra required field is
  a drop-off you can measure.
- Validating on blur with red borders while a parent is still thinking.
- Losing answers on refresh. Unforgivable at 11pm on a phone.
- Treating "prefer not to say" as no answer.

## Where this is implemented

Profile: `lib/questions.ts` (screens, gating, weights) · `lib/derive.ts` (answers →
rows) · `lib/storage.ts` (autosave/resume) · `components/seed/ProfileFlow.tsx` ·
`components/ui/ChipGroup.tsx` (selection semantics).

Chat: `lib/seed-chat/scripts.ts` (the conversations) · `lib/seed-chat/engine.ts`
(pure turn logic) · `components/seed/chat/*` (transcript, menu, step widgets,
recaps).

Adding a question should touch one data file and nothing else. If it doesn't, fix
the abstraction before adding the question.
