import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";
import { getDb } from "@/lib/server/db";
import { isWebSearchConfigured } from "@/lib/server/web-search";
import { runProviderCheck } from "@/lib/server/provider-check";
import { PROVIDER_CHECK_PAUSED } from "@/lib/provider-check";

/**
 * POST /api/admin/provider-check — "Check again" on a doctor record (8 Oct).
 *
 * The check runs by itself after a doctor card is saved; this is the admin's
 * way to run it when that did not happen (no key at the time, a timeout, a
 * redeploy mid-flight) or when they think it missed — the client's own reason
 * for routing every doctor through the admin: "maybe our system failed".
 *
 * Not in `/api/admin/action`: that route writes inside one transaction, and
 * this is two web searches — up to a minute that no transaction should hold.
 * Behind the admin session, because it spends money per call.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await readAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { share_id?: unknown } | null;
  const shareId = typeof body?.share_id === "string" ? body.share_id : "";
  if (!UUID.test(shareId)) {
    return NextResponse.json({ error: "Unknown record" }, { status: 400 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ ok: false, configured: false, reason: "no_database" });
  }
  /* Said in words rather than as a quiet no-op: "nothing changed" with no
     reason reads as "the doctor was not found". */
  if (PROVIDER_CHECK_PAUSED) {
    return NextResponse.json({ ok: false, configured: false, reason: "paused" });
  }
  if (!isWebSearchConfigured()) {
    return NextResponse.json({ ok: false, configured: false, reason: "no_api_key" });
  }

  try {
    const outcome = await runProviderCheck(db, shareId, { admin: true });
    console.info("[admin:provider-check]", { actor: session.user, outcome: outcome.kind });
    switch (outcome.kind) {
      case "stored":
        return NextResponse.json({ ok: true, status: outcome.status });
      case "not_a_doctor":
        return NextResponse.json({ error: "That record is not a doctor" }, { status: 404 });
      case "busy":
        return NextResponse.json(
          { error: "A check is already running, or just finished — give it a minute" },
          { status: 409 },
        );
      case "failed":
        return NextResponse.json(
          { error: "The search didn't answer — nothing was changed. Try again in a minute" },
          { status: 502 },
        );
    }
  } catch (err) {
    console.error(
      "[admin:provider-check] failed:",
      err instanceof Error ? err.constructor.name : "unknown",
    );
    return NextResponse.json({ error: "The check didn't finish" }, { status: 502 });
  }
}
