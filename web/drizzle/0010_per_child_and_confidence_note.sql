-- Two unrelated additions, both from the same review of what a person reading a
-- record can actually tell from it.
--
-- 1. **Which child** a school, class or camp belongs to.
--
-- The questionnaire asked a family-level question ("your schools") and stored a
-- family-level answer, so a household with a toddler and a teenager produced one
-- undifferentiated list — and the per-school status (`current` / `former`) hung
-- off the school rather than off a child. Two consequences, both bad for the
-- thing this graph exists to do: the option lists were the union of every age
-- band the family covers, and "same school" could match two families whose
-- children are nine years apart.
--
-- The birth year is the key rather than a child id, because the parent taps birth
-- years (P4) and that is what they can answer. Nullable and array-valued: a
-- parent may skip the attribution, and one class genuinely can cover two
-- children.
ALTER TABLE person_schools
  ADD COLUMN IF NOT EXISTS child_birth_years integer[];--> statement-breakpoint

ALTER TABLE social_affinities
  ADD COLUMN IF NOT EXISTS child_birth_years integer[];--> statement-breakpoint

-- 2. **Why the confidence score is what it is.**
--
-- The model has always returned one sentence explaining the number (`note` in
-- `lib/server/extract.ts`), and it was only ever stored when the card also
-- tripped a flag. So a card scored 0.85 carried a number with no reasoning
-- anywhere, and an admin looking at the queue had to take it on trust.
--
-- It is stored next to the score and cleared with it: an admin edit blanks
-- `confidence`, and a reason that described a sentence which no longer exists is
-- worse than none. Not a summary of the parent's text and never a quote of it —
-- the prompt forbids reproducing their wording, because this column is displayed.
ALTER TABLE share_contributions
  ADD COLUMN IF NOT EXISTS confidence_note text;--> statement-breakpoint

ALTER TABLE share_contributions
  ADD CONSTRAINT share_contributions_confidence_note_check
  CHECK (confidence_note IS NULL OR confidence IS NOT NULL);
