import "server-only";

import { baseUrl, unauthorizedHeader } from "@/lib/mcp/oauth";
import { tokenOwner, type TokenOwner } from "@/lib/server/repo/mcp";

/**
 * The Bearer access token on a Pando MCP request (20 Nov), checked before anything is read: an
 * unexpired, unrevoked token of an admin who is still active. Anything else is the 401 that starts
 * Claude's sign-in, with the pointer Claude reads (`WWW-Authenticate: Bearer resource_metadata=…`).
 */
export async function mcpBearer(request: Request): Promise<{ owner: TokenOwner } | { refusal: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? null;
  const owner = token ? await tokenOwner(token) : null;
  if (owner === "unavailable") {
    return { refusal: new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "5" } }) };
  }
  if (owner) return { owner };
  return {
    refusal: new Response(JSON.stringify({ error: "invalid_token", error_description: "Sign in to Pando to use this connector." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": unauthorizedHeader(baseUrl(request.url)) },
    }),
  };
}
