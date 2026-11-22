import { NextResponse } from "next/server";
import { authorizationServerMetadata, baseUrl } from "@/lib/mcp/oauth";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * GET /.well-known/oauth-authorization-server (rewritten here) — RFC 8414 for Pando MCP (20 Nov):
 * endpoints, PKCE S256, DCR and CIMD, public clients.
 */
export async function GET(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  return NextResponse.json(authorizationServerMetadata(baseUrl(request.url)), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
