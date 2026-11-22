import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { baseUrl, mcpUrl } from "@/lib/mcp/oauth";
import { mcpBearer } from "@/lib/server/mcp/bearer";
import { pandoMcpServer } from "@/lib/server/mcp/server";
import { rateLimitedKey } from "@/lib/server/rate-limit";
import { logCall } from "@/lib/server/repo/mcp";

/**
 * /api/mcp — Pando MCP (20 Nov), the one door the Pando plugin's agents use to reach Pando:
 * Streamable HTTP, stateless (a new server per request, no sessions to lose between containers or
 * deploys). The Bearer token is checked first; a tool then checks the admin's switch and writes one
 * `mcp_calls` row (`lib/server/mcp/server.ts`).
 */
export const dynamic = "force-dynamic";

/** The last minute a refused connection was written to the call log, so a loop at 429 adds one row a minute, not one a request. */
const refusalLogged = new Map<string, number>();

async function handle(request: Request): Promise<Response> {
  const auth = await mcpBearer(request);
  if ("refusal" in auth) return auth.refusal;
  const { owner } = auth;
  /* Per connection — one admin in one Claude — a minute's ceiling and a day's quota (20 Nov). */
  const connection = `${owner.adminUser}|${owner.clientId}`;
  /* One JSON-RPC message per request (review, 20 Nov): the SDK takes a batch of up to 100, which would
     make one counted request a hundred tool calls. MCP since 2025-06-18 has no batches, and Claude sends none. */
  if (request.method === "POST" && /^\s*\[/.test(await request.clone().text().catch(() => ""))) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32600, message: "Batches are not accepted; send one message per request." }, id: null }, { status: 400 });
  }
  const limited = rateLimitedKey(connection, "mcp") ?? rateLimitedKey(connection, "mcp_day");
  if (limited) {
    const minute = Math.floor(Date.now() / 60_000);
    if (refusalLogged.get(connection) !== minute) {
      refusalLogged.set(connection, minute);
      if (refusalLogged.size > 1000) refusalLogged.clear();
      await logCall({ actor: owner.adminUser, clientId: owner.clientId, tool: "(rate limited)", outcome: "refused", ms: 0 });
    }
    return limited;
  }
  const server = pandoMcpServer({ actor: owner.adminUser, clientId: owner.clientId, scopes: owner.scopes });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, {
      authInfo: { token: "", clientId: owner.clientId, scopes: owner.scopes, expiresAt: owner.expiresAt, resource: new URL(mcpUrl(baseUrl(request.url))) },
    });
  } finally {
    void server.close();
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
