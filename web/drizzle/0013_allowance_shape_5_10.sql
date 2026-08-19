-- The 1/3/5 scheme superseded by the 18 Aug reciprocity agreement (5/10) was
-- enforced in two places, and this migration was found by the second one
-- failing: the app-level validation in /api/seed/profile was widened first,
-- but this DB-level CHECK still only allowed (1,3,5) — so a value the route
-- had just accepted as valid aborted the write here instead. Same rule,
-- same numbers, both places, or the write path is only as honest as
-- whichever check runs last.
-- Existing rows at the old default (3) move to the new one (5) first, or the
-- ADD CONSTRAINT below aborts the migration on the first row that violates it.
-- There is no 1 in this deployment's data to migrate, but 3 existed.
UPDATE people SET monthly_contact_allowance = 5
  WHERE allowance_mode = 'fixed' AND monthly_contact_allowance IN (1, 3);--> statement-breakpoint
ALTER TABLE people DROP CONSTRAINT allowance_shape;--> statement-breakpoint
ALTER TABLE people ADD CONSTRAINT allowance_shape
  CHECK ((allowance_mode = 'as_relevant' AND monthly_contact_allowance IS NULL)
      OR (allowance_mode = 'fixed' AND monthly_contact_allowance IN (5, 10)));--> statement-breakpoint
