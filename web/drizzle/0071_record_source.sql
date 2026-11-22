-- A record's own source, and the last check of it (20 Nov, Pando MCP review against the plugin's
-- architecture diagram).
--
-- The Researcher's "a source link for every fact" and the Fact-checker's "confirms each fact on its
-- own source" need the page a record's facts come from to stay on the record. Until now an
-- agent's new record kept its link only in the proposal (`mcp_proposals.source_url`), and
-- `provider_check_url` is the doctor check's own page (0054), not a source for every kind.
--
--   * source_url        — the page the record's facts come from: set when an agent's new record is
--                         approved, and by an approved fact check against another page.
--   * source_checked_at — when that page was last checked by an approved fact check.
--   * source_check      — what that check found: confirmed | stale | unreachable (the page could
--                         not be read, so nothing was confirmed — the Fact-checker's "marks what it
--                         couldn't confirm"). Null = never checked. It gates nothing; freshness
--                         stays in last_confirmed_at / freshness_state.
--
-- Additive and nullable. ⚠ Run it before the code that came with it deploys (as 0054 says):
-- drizzle's `insert(shares)` names every column in schema.ts. 0070 has the same rule, so both run
-- in the one `npm run migrate` before the deploy.
ALTER TABLE shares
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_check text;--> statement-breakpoint

ALTER TABLE shares
  ADD CONSTRAINT shares_source_check_check
  CHECK (source_check IS NULL OR source_check IN ('confirmed', 'stale', 'unreachable'));--> statement-breakpoint

COMMENT ON COLUMN shares.source_url IS
  'The page this record''s facts come from (an agent''s new record, an approved fact check). Not the doctor check''s page — that is provider_check_url.';
