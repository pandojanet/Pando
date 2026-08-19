-- The follow-up question an admin types was never stored.
--
-- `contribution.needs_detail` flipped the status and discarded the question —
-- it survived only inside `audit_log.after`, where nobody reviewing the queue
-- would think to look for it. The screen's own copy ("stays in the queue until
-- they answer") promises the question is remembered; this column is what makes
-- that true, the same way `confidence_note` exists so a score is never shown
-- without the sentence explaining it.
--
-- (The referral cap from the same review needs no schema change — three rows
-- are countable at write time — so it isn't here.)
ALTER TABLE share_contributions
  ADD COLUMN IF NOT EXISTS needs_detail_note text;--> statement-breakpoint
