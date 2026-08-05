import { NextResponse } from "next/server";
import { isHookConfigured } from "@/lib/server/n8n";

/**
 * GET /api/health — liveness probe for the container and the deploy workflow.
 *
 * Deliberately anonymous: it reports whether the process is up and which
 * backends are wired, never a URL, a token or anything about a contributor.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    n8n: {
      invite: isHookConfigured("invite"),
      profile: isHookConfigured("profile"),
      chat: isHookConfigured("chat"),
      save: isHookConfigured("save"),
    },
  });
}
