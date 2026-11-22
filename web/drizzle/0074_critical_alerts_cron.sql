-- The critical_alerts job's schedule (20 Nov): every ten minutes, Pando tells the team in Slack at once
-- when something critical breaks (lib/alerts.ts, lib/server/alerts.ts) — the founder's playbook:
-- "Critical incidents are event-triggered, not held until tomorrow". Claude Cowork cannot react to an
-- event, so this is Pando's own job; Slack is the channel the developer chose.
--
-- ⚠ Created PAUSED (active = false), because every scheduled job is paused on production while the
-- product is tested (decisions.md, 19 Nov: "Do not turn the schedules back on without the developer's
-- word"). Turn it on with:  select cron.alter_job(jobid, active := true) from cron.job where jobname = 'pando-critical_alerts';
-- It reads counts and posts to a Slack webhook; it never texts a parent.
--
-- Same guards as 0068: no pg_cron or pg_net (the lab) → no schedule and no failure; any error is undone
-- here and said loudly, never taking the migrations around it with it.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pando: pg_cron or pg_net is not available here, so no critical_alerts schedule was made';
    RETURN;
  END IF;

  PERFORM cron.schedule('pando-critical_alerts', '*/10 * * * *', $c$select pando_private.run_job('critical_alerts')$c$);
  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'pando-critical_alerts'), active := false);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pando: critical_alerts schedule NOT set up (%: %)', SQLSTATE, SQLERRM;
END
$migration$;
