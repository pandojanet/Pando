-- The doctor provider check's first step is NPPES now, not DCA (9 Oct).
--
-- The developer: "the same algorithm, just another service" — the CMS NPI
-- Registry, a free JSON lookup, replaces the DCA licence search. Its result is
-- `npi`: a record names the provider — one, or several in that area, which
-- the developer counts as found (9 Oct). The check constraint is widened to
-- allow `npi`.
--
-- Widening only: every value allowed before is still allowed. `license` is no
-- longer written but stays valid, so no existing row can break it — there are
-- none today (the one test doctor record was deleted 8 Oct).
--
-- ⚠ Run before the check is unpaused (`PROVIDER_CHECK_PAUSED` in
-- lib/provider-check.ts). Code writing `npi` against the old constraint fails
-- the update, and the record stays unchecked.
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_provider_check_check;--> statement-breakpoint

ALTER TABLE shares
  ADD CONSTRAINT shares_provider_check_check
  CHECK (provider_check IS NULL OR provider_check IN ('license','npi','web','not_found'));--> statement-breakpoint

COMMENT ON COLUMN shares.provider_check IS
  'Doctor records: npi (an NPPES record names them) | web (found on the open web) | not_found | license (DCA, before 9 Oct). Null = not checked yet. Informs the admin; gates nothing.';
