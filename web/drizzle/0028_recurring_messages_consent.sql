-- The recurring-messaging opt-in on the participation screen (2 Sep, client).
--
-- RCS is why it exists: `sms` covers "Pando may text this number at all" and is
-- taken at the phone field, while this one is taken where the parent chooses how
-- often they may be asked, and names recurring automated SMS *and RCS* plus the
-- volume they just selected. Different words, different moment, so its own scope
-- and its own version string (lib/consent.ts) — a stored consent has to resolve
-- to the text that was on screen.
--
-- A consent like any other: append-only, no new table, only a wider scope list.
ALTER TABLE consents DROP CONSTRAINT consents_scope_check;--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consents_scope_check
  CHECK (scope in ('sms','sms_recurring','follow_up','blast','reference',
                    'caregiver_profile','caregiver_listing',
                    'caregiver_introduction','caregiver_reference',
                    'listening_ear'));--> statement-breakpoint
