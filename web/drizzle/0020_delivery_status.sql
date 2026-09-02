-- 12.5 / 13.4 — the delivery status of every message.
--
-- `message_log` recorded that Pando sent something. Whether it *arrived* is a
-- different fact and Twilio reports it later, on a separate callback: a message
-- is `queued` when the API accepts it and only becomes `delivered`, `undelivered`
-- or `failed` seconds or minutes afterwards.
--
-- Without these columns the delivery rate cannot be computed at all, and the
-- three carrier errors that matter are invisible:
--
--   30034  the number is not registered for A2P 10DLC — every send is failing,
--          and the answer is to stop sending, not to retry
--   30007  carrier filtering — the wording is being treated as spam, and the
--          answer is to review the copy
--   21610  sent to somebody who opted out — this one is ours: it means the
--          suppression list did not stop it, which is a bug and never noise
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS status text;--> statement-breakpoint
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS error_code integer;--> statement-breakpoint
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS status_at timestamptz;--> statement-breakpoint

COMMENT ON COLUMN message_log.status IS
  'Twilio delivery status, from the status callback: queued, sent, delivered, undelivered, failed. Null until the callback arrives; a send is not a delivery.';--> statement-breakpoint
COMMENT ON COLUMN message_log.error_code IS
  'Twilio error code on a failure. 30034 = not registered for A2P (stop sending), 30007 = carrier filtering (review the wording), 21610 = sent to somebody who opted out (a suppression bug of ours).';--> statement-breakpoint

-- The daily delivery-rate check reads outbound rows in a time window, and the
-- health page groups them by status. Both are covered by one index.
CREATE INDEX IF NOT EXISTS message_log_delivery_idx
  ON message_log (direction, sent_at DESC)
  WHERE direction = 'out';--> statement-breakpoint

-- Finding a row by what Twilio calls it is the whole of the status callback.
CREATE INDEX IF NOT EXISTS message_log_provider_idx
  ON message_log (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
