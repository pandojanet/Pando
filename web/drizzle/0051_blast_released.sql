-- M7.2 — the moment a person let an Ask out of review, so the send honours it.
--
-- `blast.release` cleared `human_review`, and `sendBlast` then re-ran
-- `selectPool`, whose `needsHumanReview` raised the flag again for the very
-- reasons a person had just accepted: Last-Minute Care always (the tier), and
-- any pool shorter than the tier's target. So a Last-Minute Ask could never be
-- sent at all, and releasing a short pool did nothing — found walking M7 over
-- the relay on 25 Sep. The release was a gate with a key that did not turn.
--
-- A timestamp rather than a boolean, so "when, and by whom" is one join to
-- audit_log away and a later re-flag can be told apart from a release that
-- never happened.
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS released_at timestamptz;--> statement-breakpoint

COMMENT ON COLUMN blasts.released_at IS
  'When an admin released this Ask from human review (blast.release). sendBlast then sends to whoever the pool chose, short or not, instead of re-flagging it for a review that has already happened.';
