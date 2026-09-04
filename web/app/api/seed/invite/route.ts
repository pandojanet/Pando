import { NextResponse } from "next/server";
import { validateInviteCode } from "@/lib/server/invite";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * POST /api/seed/invite — validates the shared invite code (estimate 1.1).
 *
 * Used when a parent types the code by hand; the QR/link path is validated
 * during the server render of the landing page instead.
 */
export async function POST(request: Request) {
  /* The one endpoint whose answer tells you whether a guess was right, and a
     code is a short string. Guessing buys very little — an unknown code still
     lets the parent in, without attribution (12 Aug) — but there is no reason
     to make it fast. */
  const limited = rateLimited(request, "invite_check");
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
  } | null;

  const code = typeof body?.code === "string" ? body.code.slice(0, 64) : null;
  return NextResponse.json(await validateInviteCode(code));
}
