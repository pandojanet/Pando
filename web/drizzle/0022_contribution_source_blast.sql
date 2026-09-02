-- 7.9 — which blast produced a contribution.
--
-- "Every paid question permanently enriches the free answer base", and the
-- estimate asks the written-back record to carry "full provenance (who said it,
-- when, which blast)". The first two were already on the row — `person_id` and
-- `created_at`. This is the third.
--
-- It is not bookkeeping. A contribution that came from a paid Ask was written by
-- somebody who was asked rather than by somebody who volunteered, and that is a
-- real difference when reading it: they were answering a specific question, under
-- a deadline, about a family they know nothing about. Without the link that
-- context is unrecoverable — the reply reads like any other card.
ALTER TABLE share_contributions
  ADD COLUMN IF NOT EXISTS source_blast_id uuid REFERENCES blasts(id) ON DELETE SET NULL;--> statement-breakpoint

COMMENT ON COLUMN share_contributions.source_blast_id IS
  'The Network Ask this contribution answered, when it came from one. Null for a seed-flow card. Part of 7.9 provenance: who said it, when, which blast.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS share_contributions_source_blast_idx
  ON share_contributions (source_blast_id)
  WHERE source_blast_id IS NOT NULL;
