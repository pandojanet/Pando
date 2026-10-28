-- Row level security on every table the migrations created without it
-- (28 Oct, architecture review §4.1).
--
-- 0002 and 0008 set the posture: the app connects as a role that bypasses RLS,
-- so this protects nothing of ours — it closes the other door, PostgREST's
-- public API with the anon key, where a table without RLS is readable and
-- writable by anyone holding that key. Enabled with no policies is "deny", and
-- the REVOKE is the second lock.
--
-- In production these eighteen are already locked: an event trigger
-- (`ensure_rls`, function `rls_auto_enable`) was added in the dashboard and
-- enables RLS on each new table. That trigger is not in this repo, so a
-- database rebuilt from the migrations — a staging project, a restore — would
-- have opened them, `phone_verifications` among them (a row inserted there is
-- a sign-in as any parent). Idempotent: on production every statement is a
-- no-op.
--
-- The list is every table created in web/drizzle/ with no ENABLE ROW LEVEL
-- SECURITY of its own, checked by script on 28 Oct.
ALTER TABLE affiliation_visibility    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE answers                   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE blast_recipients          ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE blasts                    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE deep_dives                ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE freshness_pings           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE geocode_cache             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE impact_events             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE introductions             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE invites                   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE job_runs                  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE matching_settings         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE neighborhood_adjacency    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE pending_questions         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE person_relationships      ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE phone_verification_locks  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE phone_verifications       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sms_captures              ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON affiliation_visibility    FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON answers                   FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON blast_recipients          FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON blasts                    FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON deep_dives                FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON freshness_pings           FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON geocode_cache             FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON impact_events             FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON introductions             FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON invites                   FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON job_runs                  FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON matching_settings         FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON neighborhood_adjacency    FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON pending_questions         FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON person_relationships      FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON phone_verification_locks  FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON phone_verifications       FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON sms_captures              FROM anon, authenticated;
