-- M9.5 — the scheduled-job framework's memory.
--
-- Three things need a clock and have none: freshness pings (10.3), the daily
-- delivery-rate check (12.5), and blast expiry with its automatic credit (7.7).
-- Each is currently code nothing ever calls.
--
-- ## Why a table rather than trusting cron
--
-- Because "did this already run" has to be answerable **from the database**, not
-- from whether a container happened to be up. A cron that fires twice — a retry,
-- a restart mid-run, two hosts briefly overlapping — must not send a parent two
-- freshness pings, and the only way to know is a row that says the run started.
--
-- So a run is claimed before it works and closed when it finishes. A row with
-- `finished_at` null and an old `started_at` is a crashed run, which is visible
-- rather than silent.
CREATE TABLE IF NOT EXISTS job_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job         text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- What it did. Counts and enums only — never a phone, never free text.
  outcome     text,
  processed   integer NOT NULL DEFAULT 0,
  skipped     integer NOT NULL DEFAULT 0,
  failed      integer NOT NULL DEFAULT 0,
  note        text,
  CONSTRAINT job_runs_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('ok', 'partial', 'error', 'skipped'))
);--> statement-breakpoint

COMMENT ON TABLE job_runs IS
  'M9.5. One row per attempted run of a scheduled job. Claimed before the work, closed after — so a double fire, a restart or an overlapping host cannot run the same job twice. A row with finished_at null and an old started_at is a crash, not a mystery.';--> statement-breakpoint

-- "When did this last finish" and "is one running now" are the only two
-- questions asked of this table, and both are this index.
CREATE INDEX IF NOT EXISTS job_runs_job_idx ON job_runs (job, started_at DESC);--> statement-breakpoint

-- At most one unfinished run per job. A partial unique index is the lock: a
-- second attempt while one is in flight fails on the constraint rather than
-- racing it, which is the whole point of claiming before working.
CREATE UNIQUE INDEX IF NOT EXISTS job_runs_one_in_flight
  ON job_runs (job) WHERE finished_at IS NULL;
