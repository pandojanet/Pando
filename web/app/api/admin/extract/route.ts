import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";
import { getDb } from "@/lib/server/db";
import { isExtractionConfigured } from "@/lib/server/extract";
import { sweepExtraction } from "@/lib/server/repo/flags";

/**
 * POST /api/admin/extract — the 1.8 catch-up sweep.
 *
 * Scores contributions the inline pass didn't get to: a card saved while the
 * key was unset, one whose background attempt died with the process, or the
 * whole backlog the first time extraction is switched on.
 *
 * Behind the admin session rather than a bare cron token, because it spends
 * money per call and the audit question "who ran this" should have an answer.
 * A scheduler can drive it with an admin cookie; there is no unauthenticated
 * path in.
 */
export const dynamic = "force-dynamic";

/** Bounded per call — a sweep is resumable, so a long backlog is many calls. */
const MAX_BATCH = 50;

export async function POST(request: Request) {
  const session = await readAdminSession(
    (await cookies()).get(ADMIN_COOKIE)?.value,
  );
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({
      ok: true,
      configured: false,
      reason: "no_database",
      processed: 0,
    });
  }

  /**
   * Answered honestly rather than as a silent no-op: "0 processed" with no
   * explanation reads as "nothing to do", which is the opposite of "the key
   * isn't set".
   */
  if (!isExtractionConfigured()) {
    return NextResponse.json({
      ok: true,
      configured: false,
      reason: "no_api_key",
      processed: 0,
    });
  }

  const body = (await request.json().catch(() => null)) as {
    limit?: unknown;
  } | null;
  const limit =
    typeof body?.limit === "number" && Number.isInteger(body.limit)
      ? Math.max(1, Math.min(body.limit, MAX_BATCH))
      : 25;

  try {
    const result = await sweepExtraction(db, limit);
    // Counts only — never the text that was scored (invariant 7).
    console.info("[admin:extract]", { actor: session.user, ...result });
    return NextResponse.json({ ok: true, configured: true, ...result });
  } catch (err) {
    console.error(
      "[admin:extract] failed:",
      err instanceof Error ? err.constructor.name : "unknown",
    );
    return NextResponse.json(
      { error: "The sweep didn't finish" },
      { status: 502 },
    );
  }
}
