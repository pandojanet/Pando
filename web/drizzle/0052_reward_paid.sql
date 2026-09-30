-- Whether the launch reward has actually been paid out — who, and when.
--
-- `reward_status` says where a parent is on the way to the $10: requirements
-- not met, in review, approved (Founding granted by a person). It says nothing
-- about the money. Approved reads the same on the day somebody is told they
-- earned it and on the day it reached them, so an admin working the list could
-- not tell whom they still owed. The client asked for that to be a fact rather
-- than a memory.
--
-- A timestamp and a name rather than a boolean, for the reason `blasts.released_at`
-- gives: "when, and by whom" is then one column away, and un-ticking a box pressed
-- by mistake leaves the audit row saying it happened.
--
-- Both or neither (`reward_paid_pair`): a date with nobody's name on it, or a name
-- with no date, is a half-recorded payment and the one state this table should
-- refuse to hold.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS reward_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS reward_paid_by text;--> statement-breakpoint

ALTER TABLE people
  ADD CONSTRAINT reward_paid_pair
  CHECK ((reward_paid_at IS NULL) = (reward_paid_by IS NULL));--> statement-breakpoint

COMMENT ON COLUMN people.reward_paid_at IS
  'When an admin recorded that the launch reward was paid to this person (contributor.reward_paid). Null = not paid. Only a Founding-approved person can be marked.';
