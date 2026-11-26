/**
 * Every tool Pando MCP has, and whether it writes (23 Nov). One list, because three things must agree
 * on it: the server (`registerTool` refuses a name not here, so the list cannot fall behind), the
 * check of an agent the client proposes for the plugin (`lib/server/mcp/plugin-repo.ts` — which Pando
 * tools an agent may name, and which of them write), and `test:mcp`.
 *
 * "Writes" means it creates a proposal or records something. "Decides" (24 Nov) applies or closes a
 * waiting proposal on the person's own yes in the main conversation — never a change to the plugin
 * itself, and never given to an agent: an agent reads web pages and mail, and text there must not reach
 * a decision (`plugin-repo.ts` refuses it in any agent; the plugin's `check-agents.mjs` checks its own).
 * `set_budget` (26 Nov) is a decision of the same kind: the founder's own number, said in the chat.
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
  contributor_load: "read",
  propose_record_edit: "write",
  propose_new_record: "write",
  propose_fact_check: "write",
  propose_event: "write",
  propose_source: "write",
  propose_plugin_change: "write",
  record_source_check: "write",
  approve_proposal: "decide",
  reject_proposal: "decide",
  /* 26 Nov: the monthly SMS and AI budgets, on the person's own words in the main conversation. */
  set_budget: "decide",
} as const;

export type PandoToolName = keyof typeof PANDO_TOOLS;

export const PANDO_TOOL_NAMES = Object.keys(PANDO_TOOLS) as PandoToolName[];
export const PANDO_WRITE_TOOLS = PANDO_TOOL_NAMES.filter((t) => PANDO_TOOLS[t] === "write");
export const PANDO_DECIDE_TOOLS = PANDO_TOOL_NAMES.filter((t) => PANDO_TOOLS[t] === "decide");

/**
 * A tool's own name: Claude calls a connected tool `mcp__<connection>__<tool>`, and the connection's part
 * changes with how Pando was connected (`plugin_pando_pando`, `pando`, `claude_ai_Pando`, an ID in the
 * desktop app). Nothing Pando writes depends on it (24 Nov): the plugin's agents list tools by this name,
 * and its hook holds them to it on any connection. Was `PANDO_TOOL_PREFIX = "mcp__plugin_pando_pando__"`.
 */
export const ownToolName = (tool: string): string => (tool.startsWith("mcp__") ? tool.slice(tool.lastIndexOf("__") + 2) : tool);
