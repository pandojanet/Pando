-- What a record was when an agent proposed changing it, and why an admin said no (20 Nov, the admin
-- review against GitHub's PR review and Google Docs' suggestion mode: a change is shown as
-- "was → becomes", and a "record changed since" warning needs what the agent saw).
--
--   * mcp_proposals.before        — the record's own facts when the proposal was made (name, venue,
--                                   areas, age bands, subcategory, status, ready, freshness). Null for
--                                   a new record or an event, which have nothing before them.
--   * mcp_proposals.decision_note — an admin's optional reason for a rejection, shown on the Decided
--                                   list and given back to the agent through list_proposals.
--
-- Additive and nullable; nothing reads them before this runs.
ALTER TABLE mcp_proposals
  ADD COLUMN IF NOT EXISTS before jsonb,
  ADD COLUMN IF NOT EXISTS decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 300);
