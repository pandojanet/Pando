import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { ADMIN_COOKIE, readToken } from "@/lib/admin/auth";
import * as sample from "@/lib/admin/sample";
import type { AdminResource } from "@/lib/admin/types";
import { getDb } from "@/lib/server/db";
import { readResource } from "@/lib/server/repo/admin-read";

/**
 * POST /api/admin/query — one read endpoint for every admin page (estimate 2.2–2.8).
 *
 * `{ resource, params }` in, rows out. One endpoint means one place that checks
 * the session, instead of a dozen routes each able to forget it.
 *
 * With no database configured it answers `configured: false` and empty rows, so
 * pages show an honest empty state. `demo: true` swaps in clearly-labelled
 * sample rows for reviewing the layout — never mixed with real data, because it
 * is only reachable when there is no backend at all.
 */

const EMPTY: Record<AdminResource, unknown> = {
  overview: null,
  contributors: [],
  contributor: null,
  contributions: [],
  caregivers: [],
  restricted_note: null,
  duplicates: [],
  options: [],
  flags: [],
  demand: [],
  founding: [],
  audit: [],
};

const SAMPLE: Record<AdminResource, unknown> = {
  overview: sample.sampleOverview,
  contributors: sample.sampleContributors,
  contributor: sample.sampleContributorDetail,
  contributions: sample.sampleContributions,
  caregivers: sample.sampleCaregivers,
  restricted_note: sample.sampleRestrictedNote,
  duplicates: sample.sampleDuplicates,
  options: sample.samplePendingOptions,
  flags: sample.sampleFlags,
  demand: sample.sampleDemand,
  founding: sample.sampleFounding,
  audit: sample.sampleAudit,
};

export async function POST(request: Request) {
  const session = readToken((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    resource?: unknown;
    params?: unknown;
    demo?: unknown;
  } | null;

  const resource = body?.resource as AdminResource | undefined;
  if (!resource || !(resource in EMPTY)) {
    return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({
      configured: false,
      rows: body?.demo === true ? SAMPLE[resource] : EMPTY[resource],
      sample: body?.demo === true,
    });
  }

  try {
    const params = (body?.params ?? {}) as Record<string, unknown>;
    const data = await readResource(db, resource, params);

    /**
     * Reading a restricted note is itself an event worth recording: these are
     * the bodies invariant 12 keeps off every list, and "who opened it" is the
     * only control left once someone has access to the admin at all.
     */
    if (resource === "restricted_note") {
      await db.execute(
        sql`insert into audit_log (actor, action, resource, resource_id)
            values (${session.user}, 'read', 'restricted_note',
                    ${String(params.nomination_id ?? params.id ?? "")})`,
      );
    }

    return NextResponse.json({ configured: true, rows: data ?? EMPTY[resource] });
  } catch (err) {
    // No arguments logged: these queries carry names and phone numbers.
    console.error(
      "[admin:query] failed",
      resource,
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Could not load that right now" },
      { status: 502 },
    );
  }
}
