/**
 * M9.5 — when a scheduled job may start.
 *
 * The expensive failure here is a job running twice, and the expensive version of
 * *that* is `freshness_ping` — a parent receiving two texts because a container
 * restarted mid-run. So most of what follows asserts a **refusal**, and the two
 * refusals are kept apart on purpose: "already running" is a concurrency event,
 * "too soon" is a misconfigured schedule, and they want different responses.
 */

const j = (await import(`../lib/jobs.ts?v=${Date.now()}`)) as typeof import("../lib/jobs.ts");

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};

const NOW = new Date("2026-08-27T12:00:00Z");
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const due = (job: keyof typeof j.JOBS, last: Date | null, inFlight = false) =>
  j.isDue(j.JOBS[job], { last_started_at: last, in_flight: inFlight }, NOW);

console.log("\n=== a job that has never run is due ===");
for (const name of j.JOB_NAMES) {
  ok(`${name} runs the first time`, due(name, null).due === true);
}

console.log("\n=== running twice is the failure this exists to prevent ===");
ok(
  "an unfinished run blocks a second",
  (() => {
    const v = due("freshness_ping", minsAgo(10_000), true);
    return !v.due && v.reason === "already_running";
  })(),
  "a restart mid-run must not text the same parent twice",
);
ok(
  "even a very old unfinished run still blocks",
  !due("freshness_ping", minsAgo(100_000), true).due,
  "a job that quietly unblocks itself after a crash hides the crash",
);
ok(
  "and that is a different refusal from a schedule that is too eager",
  (() => {
    const blocked = due("freshness_ping", minsAgo(10), true);
    const eager = due("freshness_ping", minsAgo(10));
    return (
      !blocked.due &&
      !eager.due &&
      blocked.reason === "already_running" &&
      eager.reason === "too_soon"
    );
  })(),
  "one is a concurrency event, the other a misconfigured schedule",
);

console.log("\n=== the interval ===");
ok(
  "hourly expiry refuses a five-minute cron",
  (() => {
    const v = due("expire_blasts", minsAgo(5));
    return !v.due && v.reason === "too_soon";
  })(),
);
ok(
  "and says how long is left, so a caller can back off",
  (() => {
    const v = due("expire_blasts", minsAgo(5));
    return !v.due && v.wait_minutes === 50;
  })(),
);
ok("an hour later it runs", due("expire_blasts", minsAgo(60)).due === true);
ok(
  "a daily job refuses an hourly cron",
  !due("delivery_check", minsAgo(120)).due,
);
ok("and runs the next day", due("delivery_check", minsAgo(25 * 60)).due === true);
ok(
  "expiry is checked far more often than the daily ones",
  j.JOBS.expire_blasts.min_interval_minutes < j.JOBS.delivery_check.min_interval_minutes,
  "the shortest promise is Last-Minute Care's four hours",
);

console.log("\n=== which jobs touch a parent's phone is visible in one glance ===");
ok("the freshness ping sends", j.JOBS.freshness_ping.sends === true);
ok("expiry does not", j.JOBS.expire_blasts.sends === false, "a credit is a row");
ok("the delivery check does not", j.JOBS.delivery_check.sends === false);
ok("both halves of the thanks loop send", j.JOBS.thanks_prompt.sends && j.JOBS.thanks_delivery.sends);
ok("the ledger sweep does not", j.JOBS.impact_sync.sends === false, "it writes rows and reads none out loud");
/**
 * Named rather than counted.
 *
 * This was "exactly one job sends", which passed for as long as there was one
 * and then failed the moment M9 added two — telling whoever added them that a
 * number had moved, rather than that they had just given a new job permission
 * to text a parent. The list is the thing worth reviewing: adding a name here is
 * a deliberate act, and a job that starts sending without one fails this.
 */
const SENDING = ["freshness_ping", "thanks_prompt", "thanks_delivery"];
ok(
  "and those are the only jobs that may text anybody",
  j.JOB_NAMES.filter((n) => j.JOBS[n].sends).sort().join(",") === SENDING.slice().sort().join(","),
  j.JOB_NAMES.filter((n) => j.JOBS[n].sends).join(","),
);
ok(
  "and every job says what it does",
  j.JOB_NAMES.every((n) => j.JOBS[n].what.length > 20),
);

console.log("\n=== only known jobs ===");
ok("a known name is accepted", j.isJobName("expire_blasts"));
ok("an unknown one is not", !j.isJobName("drop_everything"));
ok("nor an empty string", !j.isJobName(""));
ok(
  "and the name matches its key, so a lookup cannot drift",
  j.JOB_NAMES.every((n) => j.JOBS[n].name === n),
);

console.log("\n=== what a run reports ===");
const outcome = (processed: number, skipped: number, failed: number) =>
  j.outcomeFor({ processed, skipped, failed });
ok("all done is ok", outcome(5, 0, 0) === "ok");
ok("nothing to do is ok", outcome(0, 0, 0) === "ok");
ok(
  "some skipped and none sent is 'skipped', not a failure",
  outcome(0, 3, 0) === "skipped",
  "three contributors inside their 48-hour gap is the system working",
);
ok(
  "some worked and some failed is partial",
  outcome(3, 0, 2) === "partial",
  "collapsing it into ok would hide the day everything starts failing",
);
ok("nothing worked and something failed is an error", outcome(0, 0, 2) === "error");
ok(
  "skips do not turn a good run into a partial one",
  outcome(4, 6, 0) === "ok",
  "a refusal by the protection rules is not an error in the job",
);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
