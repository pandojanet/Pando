import type { McpAdminResult, McpPeriod } from "@/lib/admin/types";

/** Pando MCP's admin answer with no tables or no database: nothing switched, nobody connected, no calls. */
export function mcpNothing(periodDays: McpPeriod = 7, envOff = false): McpAdminResult {
  const none = { calls: 0, ok: 0, refused: 0, off: 0, error: 0 };
  return {
    configured: false, enabled: false, env_off: envOff, switched_by: null, switched_at: null, connections: [], period_days: periodDays,
    totals: { ...none, p50_ms: null, p95_ms: null, people: 0, prev_calls: 0, prev_error: 0 },
    tools: [], timeline: [], people: [], keeps_reason: false, reasons: [], slowest: [], recent: [], history: [],
  };
}
