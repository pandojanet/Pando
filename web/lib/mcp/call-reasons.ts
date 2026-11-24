/**
 * Why a Pando MCP call did not answer (`mcp_calls.reason`, drizzle/0080, 24 Nov): one code from this
 * list, chosen by the tool wrapper in lib/server/mcp/server.ts — never an error's message, which can
 * carry the SQL and its parameters (invariant 7). Each belongs to one outcome; the admin's words for
 * them are in lib/admin/labels.ts.
 */
export const MCP_CALL_REASONS = {
  /* error */
  deadline: "error",
  database_unreachable: "error",
  query_timeout: "error",
  database_error: "error",
  outside_service: "error",
  unexpected: "error",
  /* refused */
  read_only: "refused",
  rule: "refused",
  /* off */
  switched_off: "off",
  off_on_server: "off",
} as const;

export type McpCallReason = keyof typeof MCP_CALL_REASONS;

export const isMcpCallReason = (v: unknown): v is McpCallReason => typeof v === "string" && Object.hasOwn(MCP_CALL_REASONS, v);
