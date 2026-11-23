/**
 * Every tool Pando MCP has, and whether it writes (23 Nov). One list, because three things must agree
 * on it: the server (`registerTool` refuses a name not here, so the list cannot fall behind), the
 * check of an agent the client proposes for the plugin (`lib/server/mcp/plugin-repo.ts` — which Pando
 * tools an agent may name, and which of them write), and `test:mcp`.
 *
 * "Writes" means it creates a proposal or records something; nothing here applies a change.
 */
export const PANDO_TOOLS = {
  pando_overview: "read",
  parents_totals: "read",
  questions_totals: "read",
  records_totals: "read",
  demand_by_place: "read",
  delivery_health: "read",
  impact_totals: "read",
  digest_weeks: "read",
  daily_activity: "read",
  unanswered_questions: "read",
  what_went_wrong: "read",
  search_records: "read",
  get_record: "read",
  digest_candidates: "read",
  list_proposals: "read",
  list_sources: "read",
  read_plugin: "read",
  costs_summary: "read",
  propose_record_edit: "write",
  propose_new_record: "write",
  propose_fact_check: "write",
  propose_event: "write",
  propose_source: "write",
  propose_plugin_change: "write",
  record_source_check: "write",
} as const;

export type PandoToolName = keyof typeof PANDO_TOOLS;

export const PANDO_TOOL_NAMES = Object.keys(PANDO_TOOLS) as PandoToolName[];
export const PANDO_WRITE_TOOLS = PANDO_TOOL_NAMES.filter((t) => PANDO_TOOLS[t] === "write");

/** How Claude names a tool of this plugin's Pando connector inside an agent's tool list. */
export const PANDO_TOOL_PREFIX = "mcp__plugin_pando_pando__";
