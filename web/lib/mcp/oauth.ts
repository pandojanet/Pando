/**
 * Pando MCP's OAuth, the pure half (20 Nov): what Claude's connectors require of a remote MCP
 * server's authorization server, and nothing that touches the database.
 *
 * Claude (claude.ai, Desktop, Cowork) signs a person in with OAuth 2.0: it reads the protected
 * resource metadata the 401 points at, then the authorization server metadata, registers itself
 * (DCR, RFC 7591) or names itself by a metadata document URL (CIMD), sends PKCE S256 on every
 * authorization request, and exchanges codes and refresh tokens as a public client with a
 * form-urlencoded body. The hosted apps come back to `CLAUDE_CALLBACK`; Claude Code comes back to
 * a loopback address on any port, which must match with the port ignored.
 * Source: claude.com/docs/connectors/building/authentication (read 20 Nov).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** The hosted Claude apps' one callback. */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/**
 * The only places a code may go (20 Nov security review): Claude's hosted callback (claude.ai, and
 * claude.com for when Claude moves it) and a loopback address for Claude Code. Pando MCP serves
 * Claude and nothing else, so a client registering any other https redirect is refused — otherwise a
 * link to a look-alike consent screen would send an admin's code to whoever registered it.
 */
export const CLAUDE_CALLBACKS: readonly string[] = [CLAUDE_CALLBACK, "https://claude.com/api/mcp/auth_callback"];

/** Hosts whose client metadata documents (CIMD) Pando reads: Claude's own, nothing else. */
export const CLAUDE_METADATA_HOSTS: readonly string[] = ["claude.ai", "claude.com"];

/** What a token may do. Every admin gets both (20 Nov: "all admins everything"). */
export const SCOPES = ["pando:read", "pando:propose"] as const;
export const SCOPE = SCOPES.join(" ");

export const CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A fresh secret: 32 random bytes, base64url, with a prefix that says what it is. */
export function newSecret(kind: "code" | "access" | "refresh" | "client"): string {
  const prefix = { code: "pmc_", access: "pma_", refresh: "pmr_", client: "pmcl_" }[kind];
  return prefix + randomBytes(32).toString("base64url");
}

/** What is stored for a secret: never the secret itself. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

/** PKCE S256: base64url(SHA-256(verifier)) must equal the challenge (RFC 7636 §4.6). */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  const derived = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A redirect URI a client may register: Claude's hosted callback, or http on a loopback host (RFC 8252). */
export function acceptableRedirect(uri: string): boolean {
  if (uri.length > 300) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password || u.search) return false;
  if (u.protocol === "https:") return CLAUDE_CALLBACKS.includes(u.toString());
  return u.protocol === "http:" && LOOPBACK.has(u.hostname);
}

/**
 * Whether the redirect an authorization request asks for is one the client registered: exactly,
 * or — for a loopback address — with the port ignored (Claude Code picks a new port each session).
 */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (!acceptableRedirect(requested)) return false;
  if (registered.includes(requested)) return true;
  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  if (want.protocol !== "http:" || !LOOPBACK.has(want.hostname)) return false;
  return registered.some((r) => {
    try {
      const have = new URL(r);
      return have.protocol === "http:" && LOOPBACK.has(have.hostname) && have.hostname === want.hostname && have.pathname === want.pathname;
    } catch {
      return false;
    }
  });
}

/**
 * A client ID that is a Client ID Metadata Document URL (CIMD) Pando will fetch: https on Claude's
 * own host, default port, a path, no query or fragment. Any other host is never fetched, so the
 * fetch cannot be pointed at Pando's own network.
 */
export function isMetadataDocumentUrl(clientId: string): boolean {
  if (clientId.length > 300) return false;
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && CLAUDE_METADATA_HOSTS.includes(u.hostname) && !u.port && u.pathname.length > 1 && !u.hash && !u.search && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * The public origin Pando answers on: `MCP_BASE_URL`, else `NOTIFY_BASE_URL`, else
 * `NEXT_PUBLIC_SITE_URL`. In production that is the end of it — `https://pando.is`, **never the
 * request's Host** (23 Nov, the security review: the issuer and the resource Claude checks tokens
 * against would otherwise be whatever a request claimed, as notify.ts already refuses). Outside
 * production the request's own origin, so a local server works without configuration.
 *
 * `||`, not `??`: the env example leaves these as empty lines, and an empty `MCP_BASE_URL` must fall
 * through to the next one rather than win.
 */
export function baseUrl(requestUrl: string): string {
  const env = (process.env.MCP_BASE_URL || process.env.NOTIFY_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  if (process.env.NODE_ENV === "production") return "https://pando.is";
  return new URL(requestUrl).origin;
}

/** The MCP endpoint, exactly as a person enters it in Claude: the `resource` must equal it. */
export const mcpUrl = (base: string) => `${base}/api/mcp`;
export const resourceMetadataUrl = (base: string) => `${base}/.well-known/oauth-protected-resource`;

/** RFC 9728: where the MCP server's authorization server is, and what it can grant. */
export function protectedResourceMetadata(base: string) {
  return {
    resource: mcpUrl(base),
    authorization_servers: [base],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Pando",
  };
}

/** RFC 8414: the authorization server, with what Claude checks before it chooses CIMD or DCR. */
export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [...SCOPES, "offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
  };
}

/** The 401 that starts sign-in: Claude reads only a 401, and only this header's pointer. */
export function unauthorizedHeader(base: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(base)}", scope="${SCOPE}"`;
}

/**
 * The scope a request gets: what it asked of Pando's scopes, in Pando's order; none asked is all of
 * it. A scope Pando does not know is refused (`null` → `invalid_scope`), never widened to everything.
 * `offline_access` is accepted and adds nothing: every grant comes with a refresh token.
 */
export function grantedScope(asked: string | null | undefined): string | null {
  const want = new Set((asked ?? "").split(/\s+/).filter(Boolean));
  want.delete("offline_access");
  if ([...want].some((s) => !(SCOPES as readonly string[]).includes(s))) return null;
  return SCOPES.filter((s) => want.size === 0 || want.has(s)).join(" ");
}

/** May a token with these scopes run a tool that writes (a proposal, an approval)? */
export const mayPropose = (scopes: readonly string[]) => scopes.includes("pando:propose");

/** RFC 8707: a `resource` an authorization request names must be this MCP endpoint (or absent). */
export function resourceMatches(base: string, resource: string | null): boolean {
  return resource === null || resource.replace(/\/+$/, "") === mcpUrl(base);
}

/** A PKCE S256 challenge as RFC 7636 makes it: 43 base64url characters. */
export const wellFormedChallenge = (c: string | null): c is string => !!c && /^[A-Za-z0-9_-]{43}$/.test(c);

/** An OAuth error body (RFC 6749 §5.2): the code and a short reason, nothing else. */
export function oauthError(error: "invalid_request" | "invalid_client" | "invalid_grant" | "unauthorized_client" | "unsupported_grant_type" | "invalid_scope" | "access_denied" | "temporarily_unavailable", description: string) {
  return { error, error_description: description };
}
