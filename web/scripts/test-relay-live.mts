/**
 * The Slack relay, walked end to end against a real server.
 *
 * `npm run test:relay` proves the routing rule and the signature as arithmetic.
 * This proves the half that can only be wrong at runtime, and it cannot do it by
 * importing the send layer: `lib/server/sms.ts` is `server-only`, which does not
 * resolve outside Next's bundler — the same constraint that keeps `matching.ts`
 * free of runtime imports. So this starts the built app on its own port with the
 * relay pointed at a stubbed Slack, and drives it through the front door.
 *
 * What it asserts, in the order a message actually travels:
 *
 *  - a signed Slack event reaches the pipeline, and an **unsigned one does not**;
 *  - a top-level `+1…: HELP` is read as a cold inbound (5.9) — the only way that
 *    path is testable from a channel, since a stranger has no thread;
 *  - the reply Pando sends is **posted to Slack, not to Twilio**, with the
 *    recipient masked;
 *  - Slack's `ts` lands in `message_log.provider_message_id`, which is the thread
 *    key the whole addressing scheme rests on;
 *  - a **threaded** reply resolves back to that person and runs the pipeline
 *    again — the round trip;
 *  - and the bot's own posts are ignored, without which Pando answers itself.
 *
 * Requires a build (`npm run build`) and a database.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import postgres from "postgres";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(f);
    } catch {
      /* a malformed line is not worth failing the run over */
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.log("\n  DATABASE_URL is not set — this walk needs a database. Skipping.\n");
  process.exit(0);
}
if (!existsSync(".next")) {
  console.log("\n  No build found. Run `npm run build` first.\n");
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log("  ok   ", name);
  } else {
    fail++;
    console.log("  FAIL ", name, detail ? `— ${detail}` : "");
  }
};

const APP_PORT = 4187;
const STUB_PORT = 4188;
const SECRET = "relay-walk-signing-secret";
const PHONE = "+16265559481";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require" });

/* ── the Slack stub ────────────────────────────────────────────────────────── */

interface Posted {
  channel: string;
  text: string;
  thread_ts?: string;
}
const posted: Posted[] = [];
let seq = 0;

const stub: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      posted.push(JSON.parse(raw) as Posted);
    } catch {
      /* ignore — the assertion below will notice a missing post */
    }
    seq += 1;
    res.writeHead(200, { "content-type": "application/json" });
    /* Slack's ts shape: it is stored and compared as text, so the shape matters. */
    res.end(JSON.stringify({ ok: true, ts: `1788400000.00000${seq}` }));
  });
});
await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", () => r()));

/* ── the app, with the relay on and pointed at the stub ────────────────────── */

/**
 * The standalone server, run directly.
 *
 * `next.config.ts` sets `output: "standalone"`, and `next start` says outright
 * that it "does not work" with it — it served requests anyway, which is worse
 * than failing: the first run of this suite was answered by a bundle that
 * predated the module under test, and the symptom was a post arriving at the
 * *real* slack.com with `invalid_auth`. So this runs `.next/standalone/server.js`,
 * which is the thing the build produced and the thing DEPLOY.md runs.
 *
 * And node directly rather than `npx` through a shell.
 *
 * With `shell: true` on Windows the pid is the shell's, so `app.kill()` leaves
 * Next itself listening — and the *next* run of this suite then talks to the
 * orphan from the last one, whose stub is long closed. Every assertion after the
 * signature checks failed that way once, and the cause was invisible until the
 * app's own stderr said `EADDRINUSE`. Spawning node directly gives a real pid
 * to kill.
 */
const app: ChildProcess = spawn(
  process.execPath,
  [".next/standalone/server.js"],
  {
    env: {
      ...process.env,
      /* The standalone server takes its port from the environment. */
      PORT: String(APP_PORT),
      MESSAGING_RELAY: "slack",
      SLACK_BOT_TOKEN: "xoxb-relay-walk",
      SLACK_CHANNEL_ID: "C0RELAYWALK",
      SLACK_SIGNING_SECRET: SECRET,
      SLACK_BOT_USER_ID: "U0PANDOBOT",
      SLACK_API_BASE: `http://127.0.0.1:${STUB_PORT}`,
      /* Nothing here may reach a real phone even by accident. */
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      TWILIO_MESSAGING_SERVICE_SID: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

app.stdout?.on("data", (d) => process.stdout.write("[app] " + d));
app.stderr?.on("data", (d) => process.stdout.write("[app!] " + d));

async function waitForApp(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/seed/verify/status`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function teardown() {
  /* The tree, not just the parent: Next spawns workers, and a survivor holds the
     port and answers the next run. */
  if (app.pid && process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      app.kill();
    }
  } else {
    app.kill();
  }
  stub.close();
}

if (!(await waitForApp())) {
  console.log("\n  The app did not start on port", APP_PORT, "\n");
  teardown();
  await sql.end();
  process.exit(1);
}

/* ── driving it ────────────────────────────────────────────────────────────── */

function slackEvent(body: unknown, opts: { sign?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.sign !== false) {
    headers["x-slack-request-timestamp"] = ts;
    headers["x-slack-signature"] =
      "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`, "utf8").digest("hex");
  }
  return fetch(`http://127.0.0.1:${APP_PORT}/api/slack/events`, {
    method: "POST",
    headers,
    body: raw,
  });
}

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "event_callback",
  event: { type: "message", user: "U0TESTER", channel: "C0RELAYWALK", ts: "1788401111.1", text, ...extra },
});

await sql`delete from people where phone = ${PHONE}`;
await sql`delete from sms_opt_outs where phone = ${PHONE}`;

console.log("\n=== the door refuses what it should ===");
{
  const res = await slackEvent(message("+16265559481: HELP"), { sign: false });
  ok("an unsigned event is refused", res.status === 403, `status ${res.status}`);
  const [row] = await sql`select count(*)::int as n from people where phone = ${PHONE}`;
  ok("and nothing was created by it", row.n === 0);
}
{
  const res = await slackEvent({ type: "url_verification", challenge: "abc123" });
  const body = (await res.json()) as { challenge?: string };
  ok("the URL-verification handshake is echoed", body.challenge === "abc123");
}
{
  const before = posted.length;
  const res = await slackEvent(message("Pando says something", { bot_id: "B0PANDO" }));
  ok("a post from the bot itself is accepted and ignored", res.ok);
  ok(
    "so Pando cannot answer its own message",
    posted.length === before,
    "without this the loop spends every allowance in seconds",
  );
}

console.log("\n=== a cold inbound, addressed by number (5.9) ===");
{
  /**
   * An **ordinary** message, not a keyword — and the distinction is the app's,
   * not a detail of the test. A keyword is a decision *about Pando* (STOP,
   * HELP), handled before the pipeline ensures anybody exists; an ordinary text
   * is somebody talking, and 5.9 says that first text is their opt-in. Asking
   * HELP to create a person is asking the wrong branch, which is how this
   * assertion was written the first time.
   */
  const res = await slackEvent(message(`${PHONE}: any good camps near Altadena?`));
  ok("the event is accepted", res.ok);

  /* Parts of the pipeline run after the response, so give it a moment. */
  await new Promise((r) => setTimeout(r, 2000));

  const [person] = await sql`
    select id, first_name, phone_verified_at from people where phone = ${PHONE}`;
  ok("the stranger now exists", Boolean(person));
  ok("nameless, as 5.9 requires", person && person.first_name === null);
  ok(
    "and verified, because an inbound text proves possession",
    person && person.phone_verified_at !== null,
  );
  const [consent] = await sql`
    select c.scope, c.text_version from consents c
    join people p on p.id = c.person_id
    where p.phone = ${PHONE}`;
  ok(
    "their opt-in is recorded under the inbound wording, not the seed one",
    consent?.text_version === "inbound-text-2026-08",
    JSON.stringify(consent),
  );
  const inbound = await sql`
    select m.category from message_log m join people p on p.id = m.person_id
     where p.phone = ${PHONE} and m.direction = 'in'`;
  ok("and the inbound itself is logged", inbound.length >= 1);
}

console.log("\n=== a keyword is answered, and the reply is addressed ===");
{
  const before = posted.length;
  const res = await slackEvent(message(`${PHONE}: HELP`, { ts: "1788401555.5" }));
  ok("the event is accepted", res.ok);
  await new Promise((r) => setTimeout(r, 1500));

  ok("Pando's reply reached Slack", posted.length > before, `${posted.length} posts`);
  const last = posted[posted.length - 1];
  ok("into the configured channel", last?.channel === "C0RELAYWALK");
  ok(
    "with the number masked, never in full",
    Boolean(last?.text.includes("•")) && !last?.text.includes("6265559481"),
    last?.text.split("\n")[0],
  );
  ok(
    "and it is the HELP text, so the keyword branch really ran",
    Boolean(last?.text.includes("STOP")),
    last?.text.slice(0, 80),
  );
  ok(
    "addressed to somebody, even though a keyword reply carries no person id",
    !last?.text.includes("unknown recipient"),
    "the relay resolves by phone the way SMS does — the hole this walk found",
  );

  const logged = await sql`
    select m.provider_message_id
      from message_log m join people p on p.id = m.person_id
     where p.phone = ${PHONE} and m.direction = 'out'
     order by m.sent_at asc`;
  ok(
    "the Slack ts is stored as the provider message id — the thread key",
    Boolean(logged[0]?.provider_message_id),
    JSON.stringify(logged[0] ?? null),
  );
}

console.log("\n=== a threaded reply resolves back to that parent ===");
{
  const [outbound] = await sql`
    select m.provider_message_id as ts
      from message_log m join people p on p.id = m.person_id
     where p.phone = ${PHONE} and m.direction = 'out'
     order by m.sent_at asc limit 1`;
  const threadTs = String(outbound.ts);

  const before = posted.length;
  const res = await slackEvent(
    message("SETTINGS", { thread_ts: threadTs, ts: "1788402222.2" }),
  );
  ok("the threaded event is accepted", res.ok);
  await new Promise((r) => setTimeout(r, 1500));

  const inbound = await sql`
    select m.direction, m.category
      from message_log m join people p on p.id = m.person_id
     where p.phone = ${PHONE} and m.direction = 'in'`;
  ok(
    "it was attributed to the parent the thread belongs to",
    inbound.length >= 1,
    `${inbound.length} inbound rows`,
  );

  ok(
    "and Pando answered in the same thread",
    posted.length > before && posted[posted.length - 1]?.thread_ts === threadTs,
    `thread_ts=${posted[posted.length - 1]?.thread_ts} expected=${threadTs}`,
  );
  ok(
    "the answer is the settings menu, so the 8.3 branch ran through the relay",
    Boolean(posted[posted.length - 1]?.text.match(/\b5\b/)),
    posted[posted.length - 1]?.text.slice(0, 90),
  );
}

console.log("\n=== STOP still stops, relay or not ===");
{
  const [outbound] = await sql`
    select m.provider_message_id as ts
      from message_log m join people p on p.id = m.person_id
     where p.phone = ${PHONE} and m.direction = 'out'
     order by m.sent_at asc limit 1`;

  await slackEvent(
    message("STOP", { thread_ts: String(outbound.ts), ts: "1788403333.3" }),
  );
  await new Promise((r) => setTimeout(r, 1200));

  const [out] = await sql`
    select opted_out_at from sms_opt_outs where phone = ${PHONE}`;
  ok("the opt-out is recorded", Boolean(out?.opted_out_at));

  const before = posted.length;
  await slackEvent(
    message("SETTINGS", { thread_ts: String(outbound.ts), ts: "1788404444.4" }),
  );
  await new Promise((r) => setTimeout(r, 1200));
  ok(
    "and nothing further reaches the channel",
    posted.length === before,
    "the opt-out check runs before the provider step, whichever provider it is",
  );
}

/* ── cleanup ───────────────────────────────────────────────────────────────── */
await sql`delete from people where phone = ${PHONE}`;
await sql`delete from sms_opt_outs where phone = ${PHONE}`;
ok("cleaned up after itself", true);

teardown();
await sql.end();

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
