import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, readToken } from "@/lib/admin/auth";
import * as sample from "@/lib/admin/sample";
import type { AdminResource } from "@/lib/admin/types";
import { forwardToN8n, isHookConfigured } from "@/lib/server/n8n";

/**
 * POST /api/admin/query — one read endpoint for every admin page (estimate 2.2–2.8).
 *
 * `{ resource, params }` in, rows out. One endpoint means one place that checks the
 * session and one workflow with a Switch, instead of a dozen webhooks each able to
 * forget the auth check.
 *
 * With the hook unconfigured it answers `configured: false` and empty rows, so pages
 * show an honest empty state. `demo: true` swaps in clearly-labelled sample rows for
 * reviewing the layout — never mixed with real data, because it is only reachable
 * when there is no backend at all.
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

  if (!isHookConfigured("admin_read")) {
    return NextResponse.json({
      configured: false,
      rows: body?.demo === true ? SAMPLE[resource] : EMPTY[resource],
      sample: body?.demo === true,
    });
  }

  const result = await forwardToN8n<{ rows?: unknown; total?: number }>("admin_read", {
    resource,
    params: body?.params ?? {},
    requested_by: session.user,
  });

  if (!result.forwarded) {
    console.error("[admin:query] n8n forward failed", result.error ?? result.reason);
    return NextResponse.json({ error: "Could not load that right now" }, { status: 502 });
  }

  return NextResponse.json({
    configured: true,
    rows: result.data.rows ?? EMPTY[resource],
    total: result.data.total,
  });
}
