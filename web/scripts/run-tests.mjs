/**
 * Every offline test, in one command.
 *
 *   npm test
 *
 * The list is package.json itself: each `test:*` script runs, so a new suite
 * joins the gate by being added there and nowhere else. Excluded are the suites
 * that reach something real — they write to whatever DATABASE_URL names (the
 * hosted Supabase project, which is production) or need a running server:
 *
 *   *-live           named for it
 *   test:e2e         drives a running dev server
 *   test:compliance  loads .env itself and inserts rows into the live database
 *
 * A suite outside that list that loads an env file or imports the Postgres driver is
 * refused rather than run: inclusion is the default, so the check is what keeps a new
 * suite from writing to production on every gate and in CI.
 *
 * Output stays quiet for a passing suite and is printed in full for a failing one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const NEEDS_LIVE_SERVICES = new Set(["test:e2e", "test:compliance"]);
const REACHES_OUT = /--env-file|loadEnvFile|from ["']postgres["']/;

const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const suites = Object.keys(scripts).filter(
  (name) => name.startsWith("test:") && !name.endsWith("-live") && !NEEDS_LIVE_SERVICES.has(name)
);

const reachesOut = suites.filter((name) => {
  const command = scripts[name];
  const file = command.match(/\S+\.m?[jt]s\b/g)?.find((f) => existsSync(new URL(`../${f}`, import.meta.url)));
  return REACHES_OUT.test(command) || (file && REACHES_OUT.test(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
});
if (reachesOut.length) {
  console.log(
    `refusing to run ${reachesOut.join(", ")}: it loads an env file or the Postgres driver, so it would reach\n` +
      "the live database. Name it *-live, or add it to NEEDS_LIVE_SERVICES with the reason."
  );
  process.exit(1);
}

const failed = [];
for (const name of suites) {
  const started = Date.now();
  // npm is npm.cmd on Windows, which only a shell resolves.
  const run = spawnSync("npm", ["run", "--silent", name], { encoding: "utf8", shell: process.platform === "win32" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) {
    console.log(`  pass  ${name}  (${seconds}s)`);
  } else {
    failed.push(name);
    console.log(`  FAIL  ${name}  (${seconds}s, exit ${run.status ?? run.signal})`);
    if (run.error) console.log(`  ${run.error.message}`);
    process.stdout.write(run.stdout ?? "");
    process.stderr.write(run.stderr ?? "");
  }
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed`);
if (failed.length) {
  console.log(`failed: ${failed.join(", ")}`);
  process.exit(1);
}
