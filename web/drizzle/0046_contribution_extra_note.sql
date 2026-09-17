-- The last question on a card: anything else the parent wants to say, in their
-- own words (developer, 17 Sep).
--
-- The card already ends by asking for facts — a price band, who it suits, what
-- to know before going — and a parent who has just described a place often has
-- one more thing that fits none of those boxes. The three scripts now close
-- with an open, skippable question, and this is where the answer lands.
--
-- ⚠⚠ A NEW COLUMN RATHER THAN REUSING ONE, and that is the whole decision.
-- Every free-text column on this table already means something specific and is
-- read for that meaning downstream:
--
--   what_makes_it_great  the reason, and `hasReason` gates the $10 on it
--   caveat               a reason to hesitate, which the composer renders as one
--   tip_text             advice, rendered on its own line as a tip
--   who_for / who_not_for  who it suits
--
-- So folding a general comment into any of them would corrupt what that field
-- means everywhere it is read — and into `what_makes_it_great` it would change
-- who qualifies for money. This one is deliberately the column with no promise
-- attached: it is what the parent said, and nothing infers anything from it.
ALTER TABLE share_contributions
  ADD COLUMN IF NOT EXISTS extra_note text;--> statement-breakpoint

-- ⚠ Nullable, and null is not "they refused". The step is skippable and a
-- skip is a real answer (the 1 Sep rule), but unlike `caveat` there is no
-- `caveat_answered` companion here and deliberately so: nothing downstream
-- treats an absent comment differently from a declined one, so a second column
-- would record a distinction no reader makes.
COMMENT ON COLUMN share_contributions.extra_note IS
  'Free text, the last question on a card. Belongs to the contribution rather '
  'than the share: two parents describing one place each get their own. Read '
  'by the admin queue and scored by the extraction pass; deliberately not sent '
  'to another parent yet - see CLAUDE.md, 17 Sep.';
