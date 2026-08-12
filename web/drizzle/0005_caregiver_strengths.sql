-- The closed strengths list, on the caregiver's own side.
--
-- Missed in 0004: the flow asks it (G4, "what are you especially good at") and it is
-- the one field that has to use the *same* option ids as the parent's nomination, or
-- a caregiver saying `toddlers` and a family looking for `toddlers` never meet. See
-- lib/caregiver-options.ts for why the list is shared rather than duplicated.
--
-- Its own migration rather than an edit to 0004: that one is already applied and
-- drizzle records a hash of it, so changing it in place would leave every other
-- environment silently out of step with what the journal claims was run.
ALTER TABLE caregiver_claims
  ADD COLUMN IF NOT EXISTS strengths text[] NOT NULL DEFAULT '{}';--> statement-breakpoint

ALTER TABLE caregiver_profiles
  ADD COLUMN IF NOT EXISTS strengths text[];
