import { NextResponse } from "next/server";
import { oauthError } from "@/lib/mcp/oauth";
import { rateLimited, rateLimitedKey } from "@/lib/server/rate-limit";
import { issueTokens, rotateRefresh, takeCode, type IssuedTokens } from "@/lib/server/repo/mcp";

/**
 * POST /api/oauth/token — Pando MCP's token endpoint (20 Nov). Form-urlencoded, as Claude sends it
 * (RFC 6749 §4.1.3). A code works once and only with its PKCE verifier, client and redirect; a
 * refresh token works once and is rotated (OAuth 2.1, public clients). Every refusal is
 * `invalid_grant`, which is what makes Claude start a fresh sign-in.
 *
 * 23 Nov, the security review: the code's client, redirect and PKCE verifier are checked in the
 * statement that spends it (`takeCode`), so a request without the verifier cannot spend the admin's
 * code; a spent code presented again revokes what it bought. Beside the address-wide `oauth` limit
 * (every Claude arrives from Anthropic's range) each client has its own budget, `oauth_token`.
 */
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const fail = (error: Parameters<typeof oauthError>[0], description: string, status = 400) =>
  NextResponse.json(oauthError(error, description), { status, headers: NO_STORE });
const issued = (t: IssuedTokens) =>
  NextResponse.json(
    { access_token: t.accessToken, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refreshToken, scope: t.scope },
    { headers: NO_STORE },
  );

export async function POST(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("invalid_request", "a form-urlencoded body is required");
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v ? v : null;
  };
  const grant = field("grant_type");
  const clientId = field("client_id");
  if (!clientId) return fail("invalid_client", "client_id is required", 401);
  const perClient = rateLimitedKey(clientId, "oauth_token");
  if (perClient) return perClient;

  if (grant === "authorization_code") {
    const code = field("code");
    const verifier = field("code_verifier");
    if (!code || !verifier) return fail("invalid_request", "code and code_verifier are required");
    const taken = await takeCode({ code, clientId, redirectUri: field("redirect_uri"), verifier });
    if (taken === "unavailable") return fail("temporarily_unavailable", "could not check the code right now", 503);
    if (!taken) {
      console.info("[mcp:oauth] code refused");
      return fail("invalid_grant", "the code is invalid, used, expired or not this client's");
    }
    const tokens = await issueTokens({ adminUser: taken.adminUser, clientId, scope: taken.scope, codeHash: taken.codeHash });
    if (!tokens) return fail("temporarily_unavailable", "could not issue tokens right now", 503);
    console.info("[mcp:oauth] tokens issued", { grant: "authorization_code" });
    return issued(tokens);
  }

  if (grant === "refresh_token") {
    const refresh = field("refresh_token");
    if (!refresh) return fail("invalid_request", "refresh_token is required");
    const out = await rotateRefresh(refresh, clientId);
    if ("unavailable" in out) return fail("temporarily_unavailable", "could not issue tokens right now", 503);
    if ("refused" in out) {
      console.info("[mcp:oauth] refresh refused", { why: out.refused });
      return fail("invalid_grant", "the refresh token is invalid, used, expired or revoked");
    }
    console.info("[mcp:oauth] tokens issued", { grant: "refresh_token" });
    return issued(out.tokens);
  }

  return fail("unsupported_grant_type", "authorization_code or refresh_token");
}
