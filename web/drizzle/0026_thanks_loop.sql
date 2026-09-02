-- M9.1 — closing the loop after a recommendation is used.
--
-- Three columns on `answers`, and the first is the one without which none of
-- M9 can exist: an answer knew what it *said* and never which records it said
-- it from. So "did it help" could be asked but never attributed, and 9.2's
-- thank-you had no recipient — there was no path from a parent's "yes, we
-- booked it" back to the contributor whose recommendation did the work.
--
-- ## Why an array rather than a join table
--
-- Because it is never queried the other way. Every read here starts from an
-- answer and asks who to thank; nothing asks "which answers used this share",
-- and a table for a question nobody poses is a table that goes stale. The
-- composer (5.7) already holds the list at the moment it writes the row.
ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS share_ids uuid[] NOT NULL DEFAULT '{}';--> statement-breakpoint

COMMENT ON COLUMN answers.share_ids IS
  'M9.1. The records this answer was composed from, in the order it used them. The path from an answer that helped back to the contributors who earned the thanks.';--> statement-breakpoint

-- When the asker was asked whether it helped. Null means not yet, and the job
-- reads it as its own queue — one prompt per answer, forever.
ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS helped_asked_at timestamptz;--> statement-breakpoint

-- What they said. Null is not "no": it is a parent who did not reply, and the
-- difference matters — a silence must never be recorded as a recommendation
-- that failed, and it must never mint a thank-you either.
ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS helped boolean;--> statement-breakpoint

COMMENT ON COLUMN answers.helped IS
  'M9.1. The asker''s own verdict. NULL means they did not answer — never "no". A silence is not evidence either way, so it neither blames a recommendation nor earns anybody a thank-you.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS answers_helped_due_idx
  ON answers (sent_at)
  WHERE status = 'sent' AND helped_asked_at IS NULL AND NOT is_test;
