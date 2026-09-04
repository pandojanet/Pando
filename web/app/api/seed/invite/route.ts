import { NextResponse } from "next/server";
import { validateInviteCode } from "@/lib/server/invite";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * POST /api/seed/invite — validates the shared invite code (estimate 1.1).
 *
 * ⚠ **Nothing in the app calls this any more.** It existed for the screen that
 * asked a parent to type a code by hand, and that screen was removed on 4 Sep
 * when the client made access link-only; `/join` resolves the code during its
 * own server render and redirects an arrival without one.
 *
 * It is kept, deliberately, because `test:e2e` asserts the invite-resolution
 * rules through it — the retired-code path, the `SEED_INVITE_CODES` fallback and
 * the built-in-code refusal have no other HTTP surface. Deleting the route means
 * reworking four checks, which is a decision rather than a tidy-up.
 *
 * ⚠ **What that costs, stated because the comment below used to argue the
 * opposite.** It is the one endpoint that tells an anonymous caller whether a
 * guessed code is real, and since 4 Sep a real code is worth more than it was:
 * an unknown one no longer lets anybody in. Rate-limited on the tightest of the
 * seed buckets, and a pilot code is short — so if the client wants the gate hard
 * rather than soft, this route is the remaining door.
 */
export async function POST(request: Request) {
  /* The one endpoint whose answer tells you whether a guess was right, and a
     code is a short string. There is no reason to make it fast. */
  const limited = rateLimited(request, "invite_check");
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
  } | null;

  const code = typeof body?.code === "string" ? body.code.slice(0, 64) : null;
  return NextResponse.json(await validateInviteCode(code));
}
