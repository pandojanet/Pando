import { NextResponse } from "next/server";
import { validateInviteCode } from "@/lib/server/invite";

/**
 * POST /api/seed/invite — validates the shared invite code (estimate 1.1).
 *
 * Used when a parent types the code by hand; the QR/link path is validated
 * during the server render of the landing page instead.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
  } | null;

  const code = typeof body?.code === "string" ? body.code.slice(0, 64) : null;
  return NextResponse.json(validateInviteCode(code));
}
