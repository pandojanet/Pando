-- The mcp_prune job's schedule (20 Nov): once a day Pando MCP deletes spent codes, tokens long revoked
-- or expired, clients nobody signed in through, and calls older than 90 days (`pruneMcp` in
-- lib/server/repo/mcp.ts) — without it every tool call is a row kept for ever.
--
-- ⚠ Created PAUSED, as every job on production is while the product is tested (decisions.md, 19 Nov).
-- Turn it on with:  select cron.alter_job(jobid, active := true) from cron.job where jobname = 'pando-mcp_prune';
--
-- Same guards as 0068 and 0074: no pg_cron or pg_net (the lab) → no schedule and no failure.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pando: pg_cron or pg_net is not available here, so no mcp_prune schedule was made';
    RETURN;
  END IF;

  PERFORM cron.schedule('pando-mcp_prune', '47 11 * * *', $c$select pando_private.run_job('mcp_prune')$c$);
  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'pando-mcp_prune'), active := false);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pando: mcp_prune schedule NOT set up (%: %)', SQLSTATE, SQLERRM;
END
$migration$;
