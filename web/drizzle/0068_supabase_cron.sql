-- The scheduled jobs run from Supabase Cron (11 Nov). The developer: *"let's not
-- tie this to the server — set it up through Supabase Cron"*.
--
-- Until now nothing called /api/jobs/run: the plan was a crontab line on the VPS
-- (decisions, 9 Sep: "no cron exists, and six jobs are waiting on it"). Here the
-- database itself knocks: pg_cron runs a schedule, pg_net makes the HTTP call.
-- What a job DOES stays in the app (lib/jobs.ts, lib/server/repo/jobs.ts) —
-- Postgres cannot send an SMS or run the digest agent; it only says "now".
--
-- The address and the bearer token are NOT in this file. They are two Vault
-- secrets, set once in the Supabase dashboard (Project → Vault):
--   pando_jobs_url     https://pando.is
--   pando_jobs_secret  the same value as JOBS_SECRET on the server
-- Until both exist every call is skipped with a warning (cron.job_run_details).
--
-- Times are UTC (Supabase's pg_cron clock). Each job decides for itself whether
-- it is due (`job_runs`, min_interval_minutes, the market's clock), so a call
-- that comes too soon is a cheap refusal. The texting daily jobs are called
-- hourly at :21-:29 from 16 to 03 UTC = 8:21-19:29 PST / 9:21-20:29 PDT, inside
-- quiet hours' day on both clocks (a run inside quiet hours is refused by
-- sendSms yet counts as a run — the 22 Oct audit); the rest around the clock.
--
-- Where pg_cron or pg_net is not available (the lab's PGlite, a plain Postgres)
-- no schedule is made and nothing fails: the function exists, the schedules do
-- not, and a NOTICE says so. Where they are listed but cannot be created (no
-- right, not preloaded, another database) the block is undone on its own and a
-- WARNING says so — it never takes 0066 and 0067 down with it, since every
-- pending migration shares one transaction (review, 11 Nov).
--
-- After applying, and after the Vault secrets are set, check it really called
-- the app — "succeeded" in cron.job_run_details only means the call was queued:
--   select jobname, schedule from cron.job where jobname like 'pando-%';      -- 12 rows
--   select status_code, count(*) from net._http_response group by 1;          -- 200s; kept 6 h
--   select job, max(started_at) from job_runs group by 1;                     -- the app's own record
--
-- The function lives in its own schema, not `public`, which Supabase's REST API
-- exposes: nobody but the database owner may call it.
CREATE SCHEMA IF NOT EXISTS pando_private;--> statement-breakpoint
REVOKE ALL ON SCHEMA pando_private FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION pando_private.run_job(job text) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base   text;
  secret text;
BEGIN
  IF job !~ '^[a-z_]+$' THEN
    RAISE EXCEPTION 'pando: not a job name';
  END IF;
  -- Trimmed: a pasted newline or space would make every call a 401 that cron still calls "succeeded".
  SELECT btrim(decrypted_secret, E' \t\r\n') INTO base   FROM vault.decrypted_secrets WHERE name = 'pando_jobs_url'    LIMIT 1;
  SELECT btrim(decrypted_secret, E' \t\r\n') INTO secret FROM vault.decrypted_secrets WHERE name = 'pando_jobs_secret' LIMIT 1;
  IF coalesce(base, '') = '' OR coalesce(secret, '') = '' THEN
    RAISE WARNING 'pando: Vault secrets pando_jobs_url / pando_jobs_secret are not set; % not called', job;
    RETURN NULL;
  END IF;
  -- Asynchronous: pg_net sends it after the cron transaction commits. The app
  -- finishes a job even if this connection is dropped at the timeout.
  RETURN net.http_post(
    url                  := rtrim(base, '/') || '/api/jobs/run?job=' || job,
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object('authorization', 'Bearer ' || secret, 'content-type', 'application/json'),
    timeout_milliseconds := 60000
  );
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION pando_private.run_job(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON SCHEMA pando_private FROM anon, authenticated;--> statement-breakpoint

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pando: pg_cron or pg_net is not available here, so no job schedules were made';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  -- Every few minutes: failed sends, and the digest's picks (each row its own moment).
  PERFORM cron.schedule('pando-retry_failed',     '*/10 * * * *', $c$select pando_private.run_job('retry_failed')$c$);
  PERFORM cron.schedule('pando-digest_reminders', '*/5 * * * *',  $c$select pando_private.run_job('digest_reminders')$c$);
  PERFORM cron.schedule('pando-digest_feedback',  '1-59/5 * * * *', $c$select pando_private.run_job('digest_feedback')$c$);

  -- Hourly, around the clock: each checks its own clock (the digest acts only on Saturday 9:00-20:00 local).
  PERFORM cron.schedule('pando-expire_blasts',    '3 * * * *',  $c$select pando_private.run_job('expire_blasts')$c$);
  PERFORM cron.schedule('pando-weekly_digest',    '7 * * * *',  $c$select pando_private.run_job('weekly_digest')$c$);
  PERFORM cron.schedule('pando-delivery_check',   '11 * * * *', $c$select pando_private.run_job('delivery_check')$c$);
  PERFORM cron.schedule('pando-impact_sync',      '13 * * * *', $c$select pando_private.run_job('impact_sync')$c$);
  PERFORM cron.schedule('pando-expire_memory',    '17 * * * *', $c$select pando_private.run_job('expire_memory')$c$);

  -- Daily jobs that text people: hourly through the Pacific day, each runs once a day.
  PERFORM cron.schedule('pando-freshness_ping',   '21 16-23,0-3 * * *', $c$select pando_private.run_job('freshness_ping')$c$);
  PERFORM cron.schedule('pando-thanks_prompt',    '25 16-23,0-3 * * *', $c$select pando_private.run_job('thanks_prompt')$c$);
  PERFORM cron.schedule('pando-thanks_delivery',  '29 16-23,0-3 * * *', $c$select pando_private.run_job('thanks_delivery')$c$);

  -- pg_cron keeps every run's record forever; two weeks is enough to read.
  PERFORM cron.schedule('pando-cron_history', '43 12 * * *',
    $c$delete from cron.job_run_details where end_time < now() - interval '14 days'$c$);
EXCEPTION WHEN OTHERS THEN
  -- Undone to here; the migrations around it still apply. Loud, because a skip here means no job runs.
  RAISE WARNING 'pando: Supabase Cron NOT set up (%: %); no job will run until it is', SQLSTATE, SQLERRM;
END
$migration$;
