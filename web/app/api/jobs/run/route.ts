import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { JOBS, JOB_NAMES, isJobName } from "@/lib/jobs";
import { runJob } from "@/lib/server/repo/jobs";

/**
 * M9.5 — the one door a scheduled job comes through.
 *
 * Deployment is standalone Docker behind Traefik (no platform cron), so the host
 * runs one line and everything about *what* runs lives in `lib/jobs.ts`:
 *
 *     curl -fsS -X POST -H "authorization: Bearer $JOBS_SECRET" \
 *       https://pando.is/api/jobs/run?job=expire_blasts
 *
 * ## Why the endpoint can be called too often without harm
 *
 * Because "is it due" is answered from `job_runs`, not from the caller. A cron
 * every five minutes, a retry after a timeout, and two hosts overlapping are all
 * the same event to the database: the first claims the run, the rest are refused
 * on the partial unique index. That is what makes a public URL safe to schedule
 * against — and it is also why the refusal is a **200 with `ran: false`** rather
 * than an error, so a cron does not alert on the ordinary case.
 *
 * ## Why it is a secret rather than an IP allow-list
 *
 * The jobs send texts and grant credits. An allow-list is configuration that
 * silently stops matching when the network changes; a bearer token either matches
 * or does not. **Unset means refused** — the same fail-closed rule as the Twilio
 * signature: an endpoint that runs jobs for anybody when a secret is missing is
 * unauthenticated the moment somebody mis-deploys.
 */

function authorised(request: Request): boolean {
  const secret = process.env.JOBS_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (offered.length === 0) return false;

  /* Constant time, length-checked first — `timingSafeEqual` throws on a length
     mismatch, and that throw is itself the timing signal. Same shape as the
     Twilio signature check, for the same reason. */
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(offered, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    console.warn("[job] refused an unauthorised run");
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const job = new URL(request.url).searchParams.get("job") ?? "";
  if (!isJobName(job)) {
    return NextResponse.json(
      { error: "Unknown job", known: JOB_NAMES },
      { status: 400 },
    );
  }

  const outcome = await runJob(job);

  /**
   * 200 either way.
   *
   * A refusal here is the framework working — too soon, or already running — and
   * a cron that alerts on it would alert every five minutes by design. The body
   * says which happened, which is what a human reads when they want to know.
   */
  return NextResponse.json({
    job,
    sends: JOBS[job].sends,
    ...outcome,
  });
}

/** What exists and how often, so a host can be configured without reading code. */
export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({
    jobs: JOB_NAMES.map((name) => ({
      name,
      every_minutes: JOBS[name].min_interval_minutes,
      sends: JOBS[name].sends,
      what: JOBS[name].what,
    })),
  });
}
