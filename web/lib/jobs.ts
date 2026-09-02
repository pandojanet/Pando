/**
 * M9.5 — the scheduled jobs, as data.
 *
 * Three things in Phase 2 need a clock and had none: freshness pings (10.3), the
 * daily delivery-rate check (12.5), and blast expiry with its automatic credit
 * (7.7). Each was written and then never called.
 *
 * ## Why the schedule is a list here rather than a crontab
 *
 * Because a crontab lives on a host and this has to be answerable in code: which
 * jobs exist, how often each may run, and — the part that matters — **which of
 * them may send a text**. A job that sends is subject to quiet hours and to the
 * contributor-protection rules, and the difference between "this reads" and "this
 * writes to a parent's phone" should be visible in one glance rather than
 * discovered by reading three job bodies.
 *
 * The host cron does one thing: call the endpoint. Everything about *what* runs
 * is here.
 */

export type JobName =
  | "expire_blasts"
  | "delivery_check"
  | "freshness_ping"
  | "impact_sync"
  | "thanks_prompt"
  | "thanks_delivery";

export interface JobSpec {
  name: JobName;
  /** Shortest gap between two runs. A cron firing more often is simply refused. */
  min_interval_minutes: number;
  /**
   * The job sends messages to parents.
   *
   * Marked because it changes what a mis-scheduled run costs. A read-only job run
   * twice wastes a query; a sending one run twice is two texts to somebody who
   * agreed to five a month — which is why `sendSms` re-checks the rules anyway,
   * and why this flag exists to make the risk visible before that safety net is
   * ever the only one.
   */
  sends: boolean;
  what: string;
}

export const JOBS: Record<JobName, JobSpec> = {
  /**
   * 7.7 — the guarantee's clock.
   *
   * Hourly, because the shortest window is Last-Minute Care's four hours and a
   * guarantee that expires late is a parent still waiting past the promise. Reads
   * and writes rows; sends nothing — the credit is a row, and telling the parent
   * is a queued answer like any other.
   */
  expire_blasts: {
    name: "expire_blasts",
    min_interval_minutes: 55,
    sends: false,
    what: "Close blasts past their window, and credit the paid ones that got no answer.",
  },

  /**
   * 12.5 — the daily delivery-rate check.
   *
   * Daily is the estimate's own word. It reads `message_log` and logs; the alert
   * that matters most already fires the minute a callback arrives, so this is the
   * standing picture rather than the alarm.
   */
  delivery_check: {
    name: "delivery_check",
    min_interval_minutes: 20 * 60,
    sends: false,
    what: "Report the delivery rate over the last day, and anything below 95%.",
  },

  /**
   * 10.3 — freshness pings.
   *
   * Daily, and it **sends**. Every protection applies: at most one ping per
   * contributor per month, never on the same day as a blast, the 48-hour gap,
   * quiet hours, and the opt-out list — all of them enforced by `sendSms` and
   * `decideOutreach` rather than by this job, which only decides *who is worth
   * asking* and lets the layer below refuse.
   */
  freshness_ping: {
    name: "freshness_ping",
    min_interval_minutes: 20 * 60,
    sends: true,
    what: "Ask a few contributors whether an ageing recommendation still holds.",
  },

  /**
   * 9.3 / 9.4 — the ledger's catch-up sweep.
   *
   * 9.5 lists "tier recalculation" among the recurring jobs, and this
   * deliberately is not that: there is nothing stored to recalculate, because
   * `tierFor` computes a standing from the events every time it is asked. A
   * nightly job that wrote a tier into a column would only create the second
   * copy that goes stale — the same reason `matching.ts` recomputes an age band
   * rather than reading the stored edge.
   *
   * What this repairs is the **ledger**: the seed cohort whose contributions
   * were approved before the table existed, and any live write that failed
   * without failing the admin decision it accompanied. Idempotent by
   * construction, so it runs beside the live path without coordinating with it.
   * Touches no phone.
   */
  impact_sync: {
    name: "impact_sync",
    min_interval_minutes: 20 * 60,
    sends: false,
    what: "Backfill impact events for anything approved before the ledger saw it.",
  },

  /**
   * 9.1 — "did it help?", a few days after an answer went out.
   *
   * Daily, and it **sends**. Daily is the finest granularity that makes sense:
   * the window is measured in days (3–5 for an activity, 7–14 for a caregiver),
   * so an hourly run would only ask the same parents at a more arbitrary hour.
   *
   * The window is the job's whole schedule — there is no second chance. An
   * answer past its ceiling is never asked about, because a verdict on something
   * a parent half-remembers is worse evidence than none, and it would enter the
   * ledger as though somebody had just used the recommendation.
   */
  thanks_prompt: {
    name: "thanks_prompt",
    min_interval_minutes: 20 * 60,
    sends: true,
    what: "Ask a few parents whether the recommendation they were sent helped.",
  },

  /**
   * 9.2 — the thank-yous, batched.
   *
   * Daily and it **sends**, but the rule that shapes it is weekly: at most one
   * thank-you per contributor per seven days, with everything owed since the
   * last one gathered into it. Running daily rather than weekly is what makes
   * that batching rather than a queue — somebody first thanked on a Tuesday
   * becomes eligible again the following Tuesday, not on whichever day the
   * weekly cron happens to fall.
   */
  thanks_delivery: {
    name: "thanks_delivery",
    min_interval_minutes: 20 * 60,
    sends: true,
    what: "Thank contributors whose recommendation a parent said helped.",
  },
};

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as string[]).includes(value);
}

export type DueVerdict =
  | { due: true }
  | { due: false; reason: "too_soon" | "already_running"; wait_minutes?: number };

/**
 * May this job start?
 *
 * Two refusals, and they are different failures. **`already_running`** is a
 * second host, a retry, or a run that has not finished — starting anyway is how a
 * parent gets two pings. **`too_soon`** is a cron misconfigured to fire every
 * minute; the job is fine, the schedule is not, and refusing is cheaper than
 * doing the work again.
 *
 * A crashed run — started long ago, never finished — is deliberately **not**
 * treated as free. It blocks, and it stays visible, because a job that quietly
 * unblocks itself after a crash hides the crash. Clearing it is a decision.
 */
export function isDue(
  job: JobSpec,
  history: { last_started_at: Date | string | null; in_flight: boolean },
  now: Date = new Date(),
): DueVerdict {
  if (history.in_flight) return { due: false, reason: "already_running" };
  if (!history.last_started_at) return { due: true };

  const last =
    history.last_started_at instanceof Date
      ? history.last_started_at
      : new Date(history.last_started_at);
  if (Number.isNaN(last.getTime())) return { due: true };

  const minutes = (now.getTime() - last.getTime()) / 60_000;
  if (minutes < job.min_interval_minutes) {
    return {
      due: false,
      reason: "too_soon",
      wait_minutes: Math.ceil(job.min_interval_minutes - minutes),
    };
  }
  return { due: true };
}

/** What a run reports back. Counts and enums only — invariant 7. */
export interface JobResult {
  outcome: "ok" | "partial" | "error" | "skipped";
  processed: number;
  skipped: number;
  failed: number;
  /** One short line for the log. Never a phone, never free text from a parent. */
  note?: string;
}

/**
 * The outcome a run should report, from its own counts.
 *
 * `partial` exists because "some of it worked" is the commonest real result of a
 * sending job — a pool of ten where three are inside their 48-hour gap is a
 * success with skips, not a failure — and collapsing it into `ok` would hide the
 * day everything starts being skipped.
 */
export function outcomeFor(counts: {
  processed: number;
  skipped: number;
  failed: number;
}): JobResult["outcome"] {
  if (counts.failed > 0 && counts.processed === 0) return "error";
  if (counts.failed > 0) return "partial";
  if (counts.processed === 0 && counts.skipped > 0) return "skipped";
  return "ok";
}
