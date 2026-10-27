import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";
import { refuseForeignAdminWrite } from "@/lib/admin/request-guard";
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
  /* 14.3. An empty list, and the pool preview is an object because the page
     reads three fields off it. */
  blasts: [],
  blast_pool: {
    blast_id: "",
    wanted: 0,
    chosen: [],
    held: [],
    cold: false,
    human_review: { required: false, reason: null },
  },

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
  demand_places: { rows: [], questions_no_place: 0 },
  conversations: { rows: [], unattributed: 0 },
  conversation: null,
  freshness: [],
  standing: [],
  impact: { rows: [], totals: { answered_yes: 0, answered_no: 0, awaiting: 0, unasked: 0 } },
  deep_dives: { configured: false, rows: [] },
  introductions: { configured: false, rows: [] },
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
  /* 14.3 / 14.5. No sample rows, for the reason the conversation history gives
     one line up: invented money is worse than invented anything else. A page
     showing a fabricated $15 payment answers "has anybody actually paid?" with
     a yes. */
  blasts: [],
  blast_pool: {
    blast_id: "",
    wanted: 0,
    chosen: [],
    held: [],
    cold: false,
    human_review: { required: false, reason: null },
  },

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
  demand_places: sample.samplePlaceDemand,
  /* 14.1. No sample rows: a conversation history is the one thing that would be
     actively misleading to fake — the whole page is "did Pando really text
     her", and invented rows answer yes. */
  conversations: { rows: [], unattributed: 0 },
  conversation: null,
  freshness: [],
  standing: [],
  impact: { rows: [], totals: { answered_yes: 0, answered_no: 0, awaiting: 0, unasked: 0 } },
  /* No sample rows: a made-up yes-rate is the number this page exists to get right. */
  deep_dives: { configured: false, rows: [] },
  introductions: { configured: false, rows: [] },
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

/**
 * The sample, narrowed the way the real read would be (23 Sep): the contributor
 * page asks for one parent's cards, and handing it every sample card would show
 * a stranger's recommendations under this parent's name.
 */
function sampleFor(resource: AdminResource, params: unknown): unknown {
  const personId = (params as { person_id?: unknown } | null)?.person_id;
  if (resource === "contributions" && typeof personId === "string") {
    return (SAMPLE.contributions as Array<{ contributor: { id: string } | null }>).filter(
      (row) => row.contributor?.id === personId,
    );
  }
  return SAMPLE[resource];
}

export async function POST(request: Request) {
  /* A read, but a POST — and two of its reads write an audit row. */
  const refused = refuseForeignAdminWrite(request, "query");
  if (refused) return refused;
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
  /* Own keys only: `"toString" in EMPTY` is true, and would reach the reader. */
  if (typeof resource !== "string" || !Object.hasOwn(EMPTY, resource)) {
    return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({
      configured: false,
      rows: body?.demo === true ? sampleFor(resource, body?.params) : EMPTY[resource],
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
     * (A2P §3.3) — a file of numbers, decisions and wording versions. Nothing stops an admin exporting it —
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
    /* The class name only (27 Oct). A `DrizzleQueryError`'s message is the
       rendered SQL **and every bound value** — names and phone numbers — the
       leak `driverError` in lib/server/db.ts was written to stop. */
    console.error(
      "[admin:query] failed",
      resource,
      err instanceof Error ? (err.constructor?.name ?? "Error") : "unknown",
    );
    return NextResponse.json(
      { error: "Could not load that right now" },
      { status: 502 },
    );
  }
}
