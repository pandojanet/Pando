# Invariants (breaking one is a product-level bug)

<!-- No `paths:` on purpose: a protective rule must load in every session, and a
path-scoped rule loads only when a matching file is opened with Read. -->

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
     than a burst"). Adopted 27 Aug under CLAUDE.md's rule that the newer client
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
