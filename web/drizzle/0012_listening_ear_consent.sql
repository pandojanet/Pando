-- The listening-ear opt-in (18 Aug strategy addition): willingness to
-- occasionally answer another parent's hard question, anonymously. It is a
-- consent like any other (lib/consent.ts) — append-only, its own wording
-- version — so it needs no new table, only a wider scope list.
ALTER TABLE consents DROP CONSTRAINT consents_scope_check;--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consents_scope_check
  CHECK (scope in ('sms','follow_up','blast','reference','caregiver_profile',
                    'caregiver_listing','caregiver_introduction',
                    'caregiver_reference','listening_ear'));--> statement-breakpoint
