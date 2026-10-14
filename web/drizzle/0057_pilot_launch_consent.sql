-- "Also text me when the pilot opens" — the second tick on /join (14 Oct, the
-- client's join mockup; the developer: "add the second checkbox, as on the mockup").
--
-- Its own scope rather than a reading of `sms`: `sms` is the registered consent
-- taken at the phone field ("Pando may text this number at all"), and this is a
-- separate, optional request — one message when the pilot opens — that a parent
-- can leave unticked while still joining. Different words, different meaning, so
-- its own scope and its own version string (lib/consent.ts), the rule 0028 set.
--
-- A consent like any other: append-only, no new table, only a wider scope list.
ALTER TABLE consents DROP CONSTRAINT consents_scope_check;--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consents_scope_check
  CHECK (scope in ('sms','sms_recurring','follow_up','blast','reference',
                    'caregiver_profile','caregiver_listing',
                    'caregiver_introduction','caregiver_reference',
                    'listening_ear','pilot_launch'));--> statement-breakpoint
