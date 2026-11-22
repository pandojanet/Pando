import "server-only";

import { acceptableRedirect, grantedScope, isMetadataDocumentUrl, redirectMatches, resourceMatches, wellFormedChallenge } from "@/lib/mcp/oauth";
import { findClient, rememberMetadataClient, type McpClient } from "@/lib/server/repo/mcp";

/**
 * An authorization request, checked (20 Nov). Used twice: when Claude opens the authorize URL, and
 * again when the admin's yes comes back from the consent screen — the second check is what makes the
 * code, never the first.
 */
export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string;
  resource: string | null;
}

export type Checked =
  | { ok: true; request: AuthorizeRequest; client: McpClient }
  /** Nothing to redirect to safely: shown on Pando's own page. */
  | { ok: false; redirect: null; reason: string }
  /** The redirect is the client's own: the error goes back there (RFC 6749 §4.1.2.1). */
  | { ok: false; redirect: string; reason: string };

const MAX_DOCUMENT_BYTES = 16 * 1024;

/** A response body as text, refused past `max` bytes rather than read whole. */
async function cappedText(res: Response, max: number): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? 0) > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A client: one Claude registered, or one named by its metadata document (CIMD) on Claude's own host
 * (`isMetadataDocumentUrl`), read once — at most 16 KB, no redirects — and kept.
 */
export async function clientFor(clientId: string): Promise<McpClient | null> {
  const known = await findClient(clientId);
  if (known && known.kind === "dcr") return known;
  if (!isMetadataDocumentUrl(clientId)) return known;
  try {
    const res = await fetch(clientId, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return known;
    const text = await cappedText(res, MAX_DOCUMENT_BYTES);
    if (text === null) return known;
    const doc = JSON.parse(text) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
    const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.slice(0, 10).filter((u): u is string => typeof u === "string" && acceptableRedirect(u)) : [];
    if (doc.client_id !== clientId || uris.length === 0) return known;
    const client: McpClient = { clientId, clientName: typeof doc.client_name === "string" ? doc.client_name.slice(0, 100) : null, redirectUris: uris, kind: "cimd" };
    await rememberMetadataClient(client);
    return client;
  } catch {
    return known;
  }
}

function withQuery(url: string, params: Record<string, string | null>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

/** The redirect that carries an error back to the client. */
export const errorRedirect = (redirectUri: string, error: string, state: string | null) => withQuery(redirectUri, { error, state });
/** The redirect that carries the code back to the client. */
export const codeRedirect = (redirectUri: string, code: string, state: string | null) => withQuery(redirectUri, { code, state });

/** `base` is Pando's public origin (`baseUrl`): a `resource` must name its MCP endpoint. */
export async function checkAuthorize(params: URLSearchParams | Record<string, unknown>, base: string): Promise<Checked> {
  const get = (k: string): string | null => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return typeof v === "string" && v ? v : null;
  };
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  if (!clientId || !redirectUri) return { ok: false, redirect: null, reason: "missing client_id or redirect_uri" };
  const client = await clientFor(clientId);
  if (!client) return { ok: false, redirect: null, reason: "unknown client" };
  if (!redirectMatches(client.redirectUris, redirectUri)) return { ok: false, redirect: null, reason: "redirect_uri not registered for this client" };
  const state = get("state");
  if (get("response_type") !== "code") return { ok: false, redirect: errorRedirect(redirectUri, "unsupported_response_type", state), reason: "response_type must be code" };
  const challenge = get("code_challenge");
  if (!wellFormedChallenge(challenge) || get("code_challenge_method") !== "S256") {
    return { ok: false, redirect: errorRedirect(redirectUri, "invalid_request", state), reason: "PKCE S256 is required" };
  }
  const scope = grantedScope(get("scope"));
  if (scope === null) return { ok: false, redirect: errorRedirect(redirectUri, "invalid_scope", state), reason: "a scope Pando does not grant" };
  const resource = get("resource");
  if (!resourceMatches(base, resource)) return { ok: false, redirect: errorRedirect(redirectUri, "invalid_target", state), reason: "resource is not this MCP server" };
  return {
    ok: true,
    client,
    request: { clientId, redirectUri, codeChallenge: challenge, state, scope, resource },
  };
}
