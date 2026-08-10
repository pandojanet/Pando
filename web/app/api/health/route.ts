import { NextResponse } from "next/server";
import { isDbConfigured, pingDb } from "@/lib/server/db";

/**
 * GET /api/health — liveness probe for the container and the deploy workflow.
 *
 * Deliberately anonymous: it reports whether the process is up and whether the
 * database is reachable, never a URL, a credential or anything about a
 * contributor.
 *
 * `ok` stays true when the database is merely *unconfigured*, because that is a
 * supported state — the app runs and reports `persisted: false`. It goes false
 * only when a database was configured and cannot be reached, which is the case
 * a rollout should refuse to go live on: the container would accept a parent's
 * contribution and drop it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isDbConfigured();
  const db = await pingDb();
  const degraded = configured && !db.ok;

  return NextResponse.json(
    {
      ok: !degraded,
      uptime_s: Math.round(process.uptime()),
      db: {
        configured,
        reachable: db.ok,
      },
    },
    { status: degraded ? 503 : 200 },
  );
}
