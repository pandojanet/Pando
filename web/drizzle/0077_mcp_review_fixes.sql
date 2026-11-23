-- What the 23 Nov review of Pando MCP and the plugin asked of the schema (decisions.md, 23 Nov).
--
-- 1. mcp_auth_codes.token_id — the token pair a code was exchanged for. A code presented a second time
--    is a stolen one (RFC 6749 §4.1.2): the pair it bought, and every pair rotated from it, is
--    revoked. Without the link there was nothing to revoke.
--
-- 2. mcp_proposals.kind gains `skill` and `source`. A skill the Agent builder writes is no longer
--    committed to the plugin from the chat (`save_skill`, 20 Nov): it is a proposal, read in full and
--    approved on /admin/proposals, and only then committed. A source or partner the Source agent or
--    the Partner analyst wants to add or change is a proposal too.
--
-- 3. pando_sources — the sources & partners list the agent features sheet gives the Source agent
--    ("Pando data via Pando MCP: sources & partners list") and the Partner analyst ("Keeps the partner
--    list"). Organisations and feeds only: a name, a link, what kind it is, the area, a note, and when
--    it was last checked and how that went. No person's name, email or phone is a column — a
--    partner's contact stays in the admin's inbox. Written only by an admin's yes (a proposal) or the
--    admin; `last_checked_*` by the Source agent's `record_source_check`.
--
-- RLS on, no policies, anon/authenticated revoked, as every table (0062).
ALTER TABLE mcp_auth_codes ADD COLUMN IF NOT EXISTS token_id uuid;--> statement-breakpoint

ALTER TABLE mcp_proposals DROP CONSTRAINT IF EXISTS mcp_proposals_kind_check;--> statement-breakpoint
ALTER TABLE mcp_proposals ADD CONSTRAINT mcp_proposals_kind_check CHECK (kind IN ('record_edit', 'new_record', 'fact_check', 'event', 'skill', 'source'));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS pando_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('source', 'partner')),
  kind text NOT NULL CHECK (kind IN ('api', 'ical', 'rss', 'page', 'sheet', 'newsletter', 'school', 'camp', 'pta', 'group', 'venue', 'other')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  url text CHECK (url IS NULL OR url ~* '^https?://'),
  market_id text,
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  last_checked_at timestamptz,
  last_check text CHECK (last_check IS NULL OR last_check IN ('ok', 'failed', 'changed', 'gone')),
  added_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  proposal_id uuid REFERENCES mcp_proposals(id) ON DELETE SET NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS pando_sources_name_role ON pando_sources (role, lower(name));--> statement-breakpoint
ALTER TABLE pando_sources ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON pando_sources FROM anon, authenticated;
