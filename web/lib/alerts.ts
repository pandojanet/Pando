/**
 * Critical alerts (20 Nov): what breaks badly enough that the team hears it in Slack at once, not in the
 * next morning's brief. The founder's operating playbook: *"Critical incidents are event-triggered, not
 * held until tomorrow"*, each with severity, what happened, user impact, who can fix it, the next action
 * and whether the founder's approval is needed. Claude Cowork cannot react to an event (its scheduled
 * tasks run at most hourly), so this is Pando's own job (`critical_alerts`), and Slack is the channel
 * the developer chose.
 *
 * Pure: the facts come in as counts, the alerts go out as text. Counts and enums only — never a phone,
 * a name, a question or an address (invariant 7). The server half is `lib/server/alerts.ts`.
 */

export type AlertSeverity = "critical" | "high";

export interface AlertFacts {
  /** Job runs in the last window that ended `error` (the alert job's own runs left out). */
  failedJobs: Array<{ job: string; failed: number; sends: boolean }>;
  /** Job runs started over an hour ago that never finished. */
  stuckJobs: Array<{ job: string; minutes: number; sends: boolean }>;
  /** Texts to parents in the last 30 minutes: how many went out, how many the carrier refused. */
  texts: { out: number; undelivered: number };
  /** The weekly digest, only on Saturday from 10:00 on the market's clock; null otherwise. */
  digest: { awaitingApproval: number; failedGroups: number } | null;
  /** Pando MCP in the last 30 minutes: tool calls that failed, and connections stopped by their quota. */
  mcp?: { errors: number; limited: number };
}

export interface Alert {
  /** What makes two alerts the same one, so it is said once, not every ten minutes. */
  key: string;
  severity: AlertSeverity;
  what: string;
  impact: string;
  owner: "QuitCode" | "Janet";
  next: string;
  /** An admin page, from the site's root. */
  page: string;
  approval: boolean;
}

/** The same alert again only after this long, if it still holds. */
export const ALERT_REPEAT_HOURS = 6;
/** Undelivered texts: at least this many, and at least this share of what went out, in 30 minutes. */
export const UNDELIVERED_MIN = 5;
export const UNDELIVERED_SHARE = 0.2;
/** Pando MCP tool failures in 30 minutes that make an alert. */
export const MCP_ERRORS_MIN = 5;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function criticalAlerts(f: AlertFacts, day: string): Alert[] {
  const out: Alert[] = [];
  for (const j of f.failedJobs) {
    out.push({
      key: `job_failed:${j.job}:${day}`,
      severity: j.sends ? "critical" : "high",
      what: `The ${j.job} job failed${j.failed ? ` (${plural(j.failed, "item")} not done)` : ""}.`,
      impact: j.sends ? "Texts to parents from this job may not have gone out." : "No parent is texted by this job; its work waits.",
      owner: "QuitCode",
      next: "Read the job's run on the server and run it again once fixed.",
      page: "/admin",
      approval: false,
    });
  }
  for (const j of f.stuckJobs) {
    out.push({
      key: `job_stuck:${j.job}:${day}`,
      severity: j.sends ? "critical" : "high",
      what: `The ${j.job} job started ${j.minutes} minutes ago and has not finished.`,
      impact: j.sends ? "Its texts to parents are stopped until it is cleared." : "Its work is stopped until it is cleared.",
      owner: "QuitCode",
      next: "Check whether it is still running; clear the run if it died.",
      page: "/admin",
      approval: false,
    });
  }
  if (f.texts.undelivered >= UNDELIVERED_MIN && f.texts.undelivered >= f.texts.out * UNDELIVERED_SHARE) {
    out.push({
      key: `texts_undelivered:${day}`,
      severity: "critical",
      what: `${f.texts.undelivered} of ${plural(f.texts.out, "text")} to parents were not delivered in the last 30 minutes.`,
      impact: "Parents are not getting Pando's answers or messages.",
      owner: "QuitCode",
      next: "Check Twilio's error codes and the messaging service; pause sending if it continues.",
      page: "/admin",
      approval: false,
    });
  }
  if (f.mcp && f.mcp.errors >= MCP_ERRORS_MIN) {
    out.push({
      key: `mcp_errors:${day}`,
      severity: "high",
      what: `Pando MCP failed ${f.mcp.errors} tool calls in the last 30 minutes.`,
      impact: "Claude's briefs and agents get no answer from Pando; no parent is affected.",
      owner: "QuitCode",
      next: "Read the server log's [mcp] lines (the error class) and /admin/mcp's recent calls.",
      page: "/admin/mcp",
      approval: false,
    });
  }
  if (f.mcp && f.mcp.limited > 0) {
    out.push({
      key: `mcp_quota:${day}`,
      severity: "high",
      what: `${plural(f.mcp.limited, "Claude connection")} hit Pando MCP's quota in the last 30 minutes.`,
      impact: "Likely a scheduled task or an agent in a loop; it is stopped until the quota resets.",
      owner: "QuitCode",
      next: "See which connection on /admin/mcp; revoke it if it is not wanted.",
      page: "/admin/mcp",
      approval: false,
    });
  }
  if (f.digest && f.digest.awaitingApproval > 0) {
    out.push({
      key: `digest_unapproved:${day}`,
      severity: "critical",
      what: `${plural(f.digest.awaitingApproval, "group's digest", "groups' digests")} still ${f.digest.awaitingApproval === 1 ? "waits" : "wait"} for approval on Saturday.`,
      impact: "Those families get no digest until it is approved (sending stops at 20:00).",
      owner: "Janet",
      next: "Approve or fix the digest on Digests.",
      page: "/admin/digests",
      approval: true,
    });
  }
  if (f.digest && f.digest.failedGroups > 0) {
    out.push({
      key: `digest_failed:${day}`,
      severity: "high",
      what: `The digest search failed for ${plural(f.digest.failedGroups, "group")} on every try.`,
      impact: "Those families get only what other groups found, or nothing.",
      owner: "QuitCode",
      next: "Look at the digest agent's errors; prepare those groups again if there is time.",
      page: "/admin/digests",
      approval: false,
    });
  }
  return out;
}

/** The alerts not said within `ALERT_REPEAT_HOURS`, given when each key was last said. */
export function alertsDue(alerts: readonly Alert[], lastSaid: Readonly<Record<string, string>>, now: Date): Alert[] {
  return alerts.filter((a) => {
    const at = lastSaid[a.key];
    return !at || now.getTime() - new Date(at).getTime() >= ALERT_REPEAT_HOURS * 60 * 60 * 1000;
  });
}

/** One Slack message for the alerts due, most severe first, in Slack's `mrkdwn`. */
export function alertsText(alerts: readonly Alert[], base: string): string {
  const root = base.replace(/\/+$/, "");
  const sorted = [...alerts].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  return sorted
    .map((a) =>
      [
        `${a.severity === "critical" ? ":rotating_light: *Pando — critical*" : ":warning: *Pando — high*"}: ${a.what}`,
        `• Who is affected: ${a.impact}`,
        `• Who can fix it: ${a.owner} — ${a.next}`,
        `• Janet's yes needed: ${a.approval ? "yes" : "no"} · <${root}${a.page}|Open in admin>`,
      ].join("\n"),
    )
    .join("\n\n");
}
