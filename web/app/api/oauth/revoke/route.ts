import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/server/rate-limit";
import { revokeBySecret } from "@/lib/server/repo/mcp";

/** POST /api/oauth/revoke — RFC 7009 for Pando MCP (20 Nov): either secret ends the pair; unknown is 200. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token === "string" && token) await revokeBySecret(token);
  return new NextResponse(null, { status: 200 });
}
