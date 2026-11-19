-- A weekly digest is approved by a person before it is sent (19 Nov).
--
-- The developer: "потрібно додати апрув для дайджестів перед відправкою, тобто
-- дайджести підготовлюються за джобою, апрув, далі відправка". The job now
-- prepares each group's edition on Friday and sends on Saturday only what an
-- admin approved; an admin may take single items out first.
--
-- `approval_required` defaults to false so no existing row is rewritten: every
-- edition from before this file was sent without one and reads as it was. The
-- job inserts new editions with true. Approved is then "not required, or
-- approved_at is set" — one rule, read the same by the job and the admin.
--
-- When and by whom, both or neither, as `reward_paid_at` (0052). An item taken
-- out keeps its row and says when (`removed_at`), so what the search found and
-- what the admin kept are both on the record, and a slip can be undone.
ALTER TABLE digest_editions
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text;--> statement-breakpoint
ALTER TABLE digest_editions
  ADD CONSTRAINT digest_editions_approved_pair
  CHECK ((approved_at IS NULL) = (approved_by IS NULL));--> statement-breakpoint
ALTER TABLE digest_items
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;
