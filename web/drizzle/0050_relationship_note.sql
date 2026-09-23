-- 23 Sep — "Something else" on the invite relationship question takes the
-- parent's own words, like every other Something else in the profile.
--
-- A column on the edge rather than a new relationship value: `relationship`
-- stays the closed vocabulary its CHECK names ('other' already among them), and
-- the words say what "other" was. Only on an 'other' edge, because a note beside
-- "Family" would be a second, unreviewed answer to a question already answered.
-- Bounded, because it is typed on a phone and read by nobody but an admin.
ALTER TABLE person_relationships ADD COLUMN IF NOT EXISTS note text;--> statement-breakpoint
ALTER TABLE person_relationships DROP CONSTRAINT IF EXISTS person_relationships_note_check;--> statement-breakpoint
ALTER TABLE person_relationships ADD CONSTRAINT person_relationships_note_check
  CHECK (note IS NULL OR (relationship = 'other' AND char_length(note) BETWEEN 1 AND 120));--> statement-breakpoint
COMMENT ON COLUMN person_relationships.note IS
  'The parent''s own words when they chose "Something else". Internal; never shown to another parent.';
