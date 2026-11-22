-- Pando MCP: the one door the Pando plugin's agents use to reach Pando (20 Nov).
--
-- The developer: "далі будемо розробляти плагін і розпочнемо з Pando MCP", with the
-- architecture diagram — "Your permissions · Logs every call · Totals, no names · One
-- off switch", "read · write after your yes", "Every agent reaches Pando only through
-- here". Decided the same day: the MCP lives inside Pando (pando.is/api/mcp), people
-- sign in with their Pando admin login over OAuth (what Claude's connectors require),
-- writes are proposals an admin approves, and one switch in the admin turns it off.
--
-- Six tables, all new, nothing existing rewritten:
--  * mcp_clients     — OAuth clients Claude registers (DCR) or names by URL (CIMD).
--  * mcp_auth_codes  — single-use authorization codes, stored as hashes, PKCE S256.
--  * mcp_tokens      — access and refresh tokens, stored only as SHA-256 hashes; a
--                      refresh is rotated and the old pair revoked.
--  * mcp_calls       — one row per tool call: who, which tool, the outcome, how long,
--                      how many rows. Never the arguments (invariant 7).
--  * mcp_proposals   — what an agent proposes; nothing changes until an admin approves,
--                      in the admin or in chat, and the change itself goes through
--                      applyAction with its audit_log row.
--  * app_settings    — key/value settings an admin can flip without a deploy; the first
--                      is the MCP's on/off switch (`mcp_enabled`, off until switched on).
--
-- Admins are named by `admin_users.name`, as audit_log does, so an access change never
-- cascades into history. RLS on, no policies, as every table (0062).
CREATE TABLE IF NOT EXISTS mcp_clients (
  client_id text PRIMARY KEY,
  client_name text,
  redirect_uris text[] NOT NULL,
  kind text NOT NULL CHECK (kind IN ('dcr', 'cimd')),
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mcp_auth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  admin_user text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL,
  resource text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_hash text NOT NULL UNIQUE,
  refresh_hash text NOT NULL UNIQUE,
  admin_user text NOT NULL,
  client_id text NOT NULL,
  scope text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  rotated_from uuid,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_tokens_admin_idx ON mcp_tokens (admin_user) WHERE revoked_at IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mcp_calls (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  client_id text,
  tool text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error', 'refused', 'off')),
  ms integer NOT NULL DEFAULT 0,
  rows integer
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_calls_at_idx ON mcp_calls (at DESC);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mcp_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('record_edit', 'new_record', 'fact_check')),
  share_id uuid REFERENCES shares(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  source_url text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'rejected', 'failed')),
  decided_by text,
  decided_via text CHECK (decided_via IN ('admin', 'chat')),
  decided_at timestamptz,
  CONSTRAINT mcp_proposals_decided_together CHECK (
    (status = 'proposed') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_proposals_open_idx ON mcp_proposals (created_at DESC) WHERE status = 'proposed';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE mcp_clients ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mcp_auth_codes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mcp_calls ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mcp_proposals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON mcp_clients, mcp_auth_codes, mcp_tokens, mcp_calls, mcp_proposals, app_settings FROM anon, authenticated;
