-- The skills Pando MCP's `save_skill` wrote into the Pando plugin (20 Nov).
--
-- The diagram's Agent builder: "Test-runs a new skill on real data · Saves it on your 'save' · Next
-- update brings it to your Claude", saved "through Pando MCP" into GitHub `pando-plugin`. The
-- developer, 20 Nov: no pull request — one build mechanism, committed straight to the plugin's
-- branch, fixed afterwards if something is wrong.
--
-- One row per skill the Agent builder made. A skill without a row here is one QuitCode maintains, and
-- `save_skill` refuses to overwrite it. Every save is also an `audit_log` row (`skill.save`).
--
--   * name         — the skill's folder, `skills/<name>/SKILL.md` in the plugin.
--   * created_by / updated_by — admin names, as audit_log does.
--   * commit_sha   — the plugin commit of the last save; version — the plugin version it bumped to.
--
-- RLS on, no policies, anon/authenticated revoked, as every table (0062).
CREATE TABLE IF NOT EXISTS plugin_skills (
  name text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9-]{2,40}$'),
  description text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  commit_sha text,
  version text
);--> statement-breakpoint
ALTER TABLE plugin_skills ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON plugin_skills FROM anon, authenticated;
