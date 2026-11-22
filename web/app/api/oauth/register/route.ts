import { NextResponse } from "next/server";
import { acceptableRedirect, oauthError } from "@/lib/mcp/oauth";
import { rateLimited } from "@/lib/server/rate-limit";
import { registerClient } from "@/lib/server/repo/mcp";

/**
 * POST /api/oauth/register — Dynamic Client Registration (RFC 7591) for Pando MCP (20 Nov).
 * Claude registers itself as a public client (no secret, PKCE). Registering grants nothing: a client
 * still needs an active admin to sign in and say yes on the consent screen, and its redirects can only
 * be Claude's own callback or a loopback address (`acceptableRedirect`). At most 500 clients
 * registered in the last 30 days, so registration cannot fill the table.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "oauth") ?? rateLimited(request, "oauth_register");
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown } | null;
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(acceptableRedirect)) {
    return NextResponse.json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be Claude's callback, or http on a loopback address" }, { status: 400 });
  }
  if (body?.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
    return NextResponse.json(oauthError("invalid_request", "only public clients (token_endpoint_auth_method none)"), { status: 400 });
  }
  const name = typeof body?.client_name === "string" ? body.client_name.slice(0, 100) : null;
  const client = await registerClient({ clientName: name, redirectUris: uris });
  if (client === "full") return NextResponse.json(oauthError("temporarily_unavailable", "too many registered clients"), { status: 503 });
  if (!client) return NextResponse.json(oauthError("temporarily_unavailable", "could not register right now"), { status: 503 });
  console.info("[mcp:oauth] client registered", { redirects: uris.length });
  return NextResponse.json(
    {
      client_id: client.clientId,
      client_name: client.clientName ?? undefined,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 },
  );
}
