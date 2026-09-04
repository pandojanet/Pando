-- M15.4 — `caregivers_answerable` did not enforce invariant 1, and its own
-- comment said it did.
--
-- ## What the audit found
--
-- `npm run test:security` checks invariant 1 where it has to be true, and turned
-- up a gap the code does not currently have but the *schema* does. The view
-- filtered on:
--
--     consent_status = 'consented' AND active
--
-- while invariant 1 is four conditions: **consented AND active AND discoverable
-- AND is_adult**. And the comment above it read "matching, SMS answers and
-- exports all read this — never `caregivers`", which is a promise that the view
-- is the safe way to reach a caregiver.
--
-- ## Why this is not a live bug, and is still worth fixing
--
-- Two reasons it is dormant. **Nothing reads the view** — `grep` across the repo
-- finds exactly one occurrence, the CREATE below; M5.5's `retrieval.ts` was
-- written later and carries all four conditions itself. And **`is_adult` cannot
-- be false**: it is `NOT NULL` with `CONSTRAINT adults_only CHECK (is_adult)`,
-- so invariant 2 is enforced by the table and no query can undo it.
--
-- What is left is `discoverable`, and that one matters. CLAUDE.md records the
-- measurement: of ten caregivers in the demo cohort, **three** pass
-- consented+active and only **two** also pass discoverable — so a caller that
-- believed the comment and used this view would surface a caregiver who had
-- consented to being listed and declined to appear in answers. Consent is not
-- visibility, and 2C makes that a real supported outcome.
--
-- So the fix is to make the view match the invariant rather than to weaken the
-- comment. A dormant trap with a reassuring label is worse than no view at all:
-- the next person to need "the safe read" will find it, and it will look right.
--
-- `introducible` is deliberately **not** added. Invariant 1 excludes it in so
-- many words — being in an answer and being introduced are different amounts of
-- exposure — and it stays a selected column so a caller can see it without
-- being filtered by it.
CREATE OR REPLACE VIEW caregivers_answerable AS
SELECT
  c.id            AS caregiver_id,
  c.market_id,
  c.first_name,
  c.last_initial,
  n.id            AS nomination_id,
  n.care_type,
  n.cared_for_ages,
  n.strengths,
  n.good_fit_for,
  n.caveat,
  n.last_worked,
  n.pay_band,
  n.pay_benchmark_consent,
  c.discoverable,
  c.introducible
FROM caregivers c
JOIN caregiver_nominations n ON n.caregiver_id = c.id
-- Invariant 1, all four conditions.
WHERE c.consent_status = 'consented'
  AND c.active
  -- Added 3 Sep. Consent is not visibility: a caregiver may agree to be listed
  -- and decline to appear in answers, and `discoverable` is the separate rung of
  -- the ladder that records it (mentioned → invited → consented → discoverable →
  -- introducible).
  AND c.discoverable
  -- Invariant 2, restated at the point of use. `caregivers.is_adult` is NOT NULL
  -- with a CHECK that it is true, so this can never actually exclude a row —
  -- which is the point: it is here so that a future migration relaxing the CHECK
  -- cannot silently make this view unsafe.
  AND c.is_adult
  AND NOT c.is_test
  AND n.status = 'approved'
  AND NOT n.review_hold;--> statement-breakpoint

COMMENT ON VIEW caregivers_answerable IS
  'Invariant 1, all four conditions: consented AND active AND discoverable AND is_adult, plus an approved nomination that is not held. Any path that shows a caregiver to a parent must read this rather than `caregivers` — and `retrieval.ts` (M5.5) carries the same conditions inline for the same reason.';
