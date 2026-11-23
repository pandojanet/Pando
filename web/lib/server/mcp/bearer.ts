import "server-only";

import { baseUrl, unauthorizedHeader } from "@/lib/mcp/oauth";
import { rateBlocked, rateLimited } from "@/lib/server/rate-limit";
import { tokenOwner, type TokenOwner } from "@/lib/server/repo/mcp";

/** What `newSecret("access")` makes: "pma_" and 32 random bytes in base64url. Anything else is never looked up. */
export const ACCESS_SHAPE = /^pma_[A-Za-z0-9_-]{43}$/;

/**
 * The Bearer access token on a Pando MCP request (20 Nov), checked before anything is read: an
 * unexpired, unrevoked token of an admin who is still active. Anything else is the 401 that starts
 * Claude's sign-in, with the pointer Claude reads (`WWW-Authenticate: Bearer resource_metadata=…`).
 *
 * 23 Nov, the security review: a request could make one database read per bogus token, before any
 * limit, on the pool the SMS side shares. Now a token not shaped like Pando's is refused without a
 * read, and an address whose well-shaped tokens keep failing is refused (429) before the read.
 */
export async function mcpBearer(request: Request): Promise<{ owner: TokenOwner } | { refusal: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? null;
  const shaped = token !== null && ACCESS_SHAPE.test(token);
  if (shaped) {
    const blocked = rateBlocked(request, "mcp_bad_token");
    if (blocked) return { refusal: blocked };
  }
  const owner = shaped ? await tokenOwner(token) : null;
  if (owner === "unavailable") {
    return { refusal: new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "5" } }) };
  }
  if (owner) return { owner };
  /* A well-shaped token that matched nothing counts against its address. */
  if (shaped) rateLimited(request, "mcp_bad_token");
  return {
    refusal: new Response(JSON.stringify({ error: "invalid_token", error_description: "Sign in to Pando to use this connector." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": unauthorizedHeader(baseUrl(request.url)) },
    }),
  };
}
