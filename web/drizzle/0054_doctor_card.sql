-- The doctor card's two questions with nowhere to go, and the provider check.
--
-- `visit_reason` ("What did you see them for?") and `appointment_ease` ("How easy
-- is it to get an appointment?") are new information: no existing column means
-- either, and the developer chose columns over leaving them in
-- `submissions.fields` (8 Oct) so the admin can read and edit them.
--
-- `provider_check` on `shares`: whether a doctor or practice could be found —
-- `license` (a page on DCA's own license search names them), `web` (found on the
-- open web) or `not_found`. Null = not checked yet. It is on the record, not the
-- contribution, because it is a fact about the provider, not about one parent's
-- visit. It gates nothing: a `not_found` record still goes to the admin, because
-- the check can miss. `provider_check_url` is the page it matched on.
--
-- `provider_check_started_at` is the claim a check takes before it searches, so
-- two saves of one doctor cannot pay for two checks at once (review, 8 Oct).
--
-- ⚠⚠ RUN THIS BEFORE THE CODE THAT CAME WITH IT DEPLOYS. Additive and nullable,
-- but not "either side of the run": drizzle's insert names every column in
-- `schema.ts`, so the new code's `insert(shares)` / `insert(shareContributions)`
-- fails on a database without these columns — every activity, place and tip
-- card, not only doctors. Migrate first, then ship.
ALTER TABLE share_contributions
  ADD COLUMN IF NOT EXISTS visit_reason text,
  ADD COLUMN IF NOT EXISTS appointment_ease text;--> statement-breakpoint

ALTER TABLE shares
  ADD COLUMN IF NOT EXISTS provider_check text,
  ADD COLUMN IF NOT EXISTS provider_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_check_url text,
  ADD COLUMN IF NOT EXISTS provider_check_started_at timestamptz;--> statement-breakpoint

ALTER TABLE shares
  ADD CONSTRAINT shares_provider_check_check
  CHECK (provider_check IS NULL OR provider_check IN ('license','web','not_found'));--> statement-breakpoint

COMMENT ON COLUMN shares.provider_check IS
  'Doctor records: license (DCA license search names them) | web (found on the open web) | not_found. Null = not checked yet. Informs the admin; gates nothing.';
