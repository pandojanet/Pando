import { NextResponse } from "next/server";
import { baseUrl, protectedResourceMetadata } from "@/lib/mcp/oauth";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * GET /.well-known/oauth-protected-resource (rewritten here, next.config.ts) — RFC 9728 for Pando MCP
 * (20 Nov): where its authorization server is. Claude reads it from the pointer in the MCP's 401.
 */
export async function GET(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  return NextResponse.json(protectedResourceMetadata(baseUrl(request.url)), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
