-- 7.7's guarantee, the half that was invisible.
--
-- `expire_blasts` has granted a fresh credit for an unanswered paid Ask since
-- 27 Aug, automatically and inside the transaction that expires it. Nothing
-- recorded that it had -- `credits` carries a person, a kind and a reason, and
-- no reference back to the Ask it compensates -- so `refundOwed` could only
-- ever answer "a credit is owed", and the blast manager rendered that in alert
-- red for ever, on a promise Pando had already kept. An admin reading it would
-- chase a second credit for a parent who has one.
--
-- The same shape as the clock added on 3 Sep: the guarantee is a state with a
-- beginning and an end, and the page could see only the beginning.
--
-- Nullable, and null keeps its plain meaning -- not granted. That matters in
-- the direction nobody looks: a deployment whose cron is not wired runs no
-- jobs, grants nothing, and this column stays null, so the page can say the
-- credit is still owed instead of quietly reporting it as handled.
ALTER TABLE blasts
  ADD COLUMN IF NOT EXISTS credit_granted_at timestamp with time zone;
--> statement-breakpoint

COMMENT ON COLUMN blasts.credit_granted_at IS
  'When 7.7''s automatic credit was granted for this Ask (expire_blasts). Null means it was not.';
