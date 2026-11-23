-- A change to the Pando plugin is one kind of proposal (23 Nov): a skill, an agent or a connector — new,
-- changed or removed — that an admin reads as lines removed and added on /admin/proposals and commits
-- with *Commit to plugin* (lib/server/mcp/plugin-repo.ts). The developer: the client changes the plugin
-- without QuitCode. `skill` (0077) is kept in the list for any row made before; nothing writes it now.
ALTER TABLE mcp_proposals DROP CONSTRAINT IF EXISTS mcp_proposals_kind_check;--> statement-breakpoint
ALTER TABLE mcp_proposals ADD CONSTRAINT mcp_proposals_kind_check CHECK (kind IN ('record_edit', 'new_record', 'fact_check', 'event', 'skill', 'source', 'plugin'));
