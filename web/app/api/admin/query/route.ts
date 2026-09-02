import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";
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
  answers: [],
  overview: null,
  contributors: [],
  contributor: null,
  contributions: [],
  caregivers: [],
  caregiver_claims: [],
  restricted_note: null,
  duplicates: [],
  options: [],
  flags: [],
  demand: [],
  founding: [],
  invites: [],
  consents: [],
  /* 7.6. An empty list, never a fabricated reply: a made-up blast response
     would be text nobody wrote entering the review queue. */
  blast_responses: [],
  /* 12.5. `configured: false` rather than a zero rate: a page that cannot reach
     the database must say so, not report perfect delivery. */
  delivery: {
    configured: false,
    window_days: 7,
    rate: null,
    below_floor: false,
    settled: 0,
    delivered: 0,
    in_flight: 0,
    alerts: [],
  },
  /**
   * 6.7's harness. Not `[]` and not `null`: the page reads `asker`, `ranked` and
   * `people`, so a bare null would make an unconfigured deployment throw where
   * every other page shows an honest empty state.
   */
  matching: {
    asker: null,
    ranked: [],
    cold: false,
    wanted: 0,
    found: 0,
    weights: [],
    adjacency_pairs: 0,
    people: [],
  },
  audit: [],
};

const SAMPLE: Record<AdminResource, unknown> = {
  answers: [],
  blast_responses: [],
  overview: sample.sampleOverview,
  contributors: sample.sampleContributors,
  contributor: sample.sampleContributorDetail,
  contributions: sample.sampleContributions,
  caregivers: sample.sampleCaregivers,
  caregiver_claims: sample.sampleCaregiverClaims,
  restricted_note: sample.sampleRestrictedNote,
  duplicates: sample.sampleDuplicates,
  options: sample.samplePendingOptions,
  flags: sample.sampleFlags,
  demand: sample.sampleDemand,
  founding: sample.sampleFounding,
  invites: sample.sampleInvites,
  consents: sample.sampleConsents,
  /* 12.5. `configured: false` rather than a zero rate: a page that cannot reach
     the database must say so, not report perfect delivery. */
  delivery: {
    configured: false,
    window_days: 7,
    rate: null,
    below_floor: false,
    settled: 0,
    delivered: 0,
    in_flight: 0,
    alerts: [],
  },
  /* Deliberately empty rather than fabricated: a made-up ranking is the one thing
     this page must never show, because its whole purpose is judging whether the
     real ranking is any good. The page says so when there is no database. */
  matching: {
    asker: null,
    ranked: [],
    cold: false,
    wanted: 0,
    found: 0,
    weights: [],
    adjacency_pairs: 0,
    people: [],
  },
  audit: sample.sampleAudit,
};

export async function POST(request: Request) {
  const session = await readAdminSession(
    (await cookies()).get(ADMIN_COOKIE)?.value,
  );
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
     * Two reads are events in themselves, and both get an audit row.
     *
     * A restricted note is a body invariant 12 keeps off every list, and "who
     * opened it" is the only control left once someone has admin access at all.
     *
     * The consent export is the one read whose purpose is to leave the building
     * with unmasked phone numbers (A2P §3.3). Nothing stops an admin exporting it —
     * it is their defence file — but every export is recorded, so the log can
     * answer "when did this list of numbers get taken out, and by whom".
     */
    if (resource === "restricted_note" || resource === "consents") {
      await db.execute(
        sql`insert into audit_log (actor, action, resource, resource_id)
            values (${session.user}, 'read', ${resource},
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
