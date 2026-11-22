-- Events the plugin's Researcher found, for the weekly digest (20 Nov).
--
-- The diagram's Researcher finds "camps, classes, events by area and age, a source link for every
-- fact"; the developer, 20 Nov, on where its dated finds go: digest candidates. An agent proposes an
-- event through Pando MCP (`propose_event`, an `mcp_proposals` row of kind `event`); an admin's yes —
-- on /admin/proposals or in chat — puts it here; each Saturday every group whose window and ages it
-- fits gets it before what the digest agent found (`candidatesForGroup`, `withCandidates`).
--
-- A person checked it, so it skips the page checks the agent's own finds need; its dates go through
-- the same rule (`datesMiss`). An admin can take one off (`removed_at`); it is never deleted, so the
-- audit trail and the digests it went out in still read.
--
-- `mcp_proposals.kind` gains `event`. RLS on, no policies, anon/authenticated revoked (0062).
CREATE TABLE IF NOT EXISTS digest_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('event', 'camp', 'class', 'opportunity')),
  title text NOT NULL,
  when_text text NOT NULL,
  starts_on date,
  ends_on date,
  place text,
  age_min integer,
  age_max integer,
  summary text NOT NULL,
  url text NOT NULL,
  proposal_id uuid REFERENCES mcp_proposals(id) ON DELETE SET NULL,
  added_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by text,
  CONSTRAINT digest_candidates_ages CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max),
  CONSTRAINT digest_candidates_dated_event CHECK (kind <> 'event' OR starts_on IS NOT NULL OR ends_on IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS digest_candidates_live ON digest_candidates (market_id, coalesce(ends_on, starts_on)) WHERE removed_at IS NULL;--> statement-breakpoint
ALTER TABLE digest_candidates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON digest_candidates FROM anon, authenticated;--> statement-breakpoint

ALTER TABLE mcp_proposals DROP CONSTRAINT IF EXISTS mcp_proposals_kind_check;--> statement-breakpoint
ALTER TABLE mcp_proposals ADD CONSTRAINT mcp_proposals_kind_check CHECK (kind IN ('record_edit', 'new_record', 'fact_check', 'event'));
--> statement-breakpoint
-- A proposal's source link is http(s) at the table too, not only in the tool's check (review, 20 Nov):
-- it is shown as a link on /admin/proposals and becomes a digest candidate's link.
ALTER TABLE mcp_proposals ADD CONSTRAINT mcp_proposals_source_url_http CHECK (source_url IS NULL OR source_url ~* '^https?://');
