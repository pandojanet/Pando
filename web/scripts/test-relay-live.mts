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
import { createHmac, randomBytes, scryptSync } from "node:crypto";
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
/**
 * The walk signs in as an admin it creates itself, and removes afterwards.
 *
 * The first version used the pilot's starter pair and failed with a 401 — which
 * is the *right* failure, because rotating that password is on the pre-pilot
 * list and a suite that breaks when somebody finally does it is a suite that
 * teaches people not to. A credential in the repository would have been worse
 * still. So the record is built here with the same scrypt parameters
 * `lib/admin/auth.ts` uses, in the same self-describing format, and the row is
 * deleted in the cleanup — `admin_users` being authoritative once populated
 * (12 Aug) is exactly what makes this work without touching any env var.
 */
const ADMIN_NAME = "relay-walk";
const ADMIN_PASSWORD = "relay-walk-password";
const SCRYPT = { N: 65536, r: 8, p: 1, keylen: 32 } as const;
const adminRecord = (() => {
  const salt = randomBytes(16);
  const hash = scryptSync(ADMIN_PASSWORD, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");
})();

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

/**
 * Wait for the pipeline to have done something, rather than for a guess.
 *
 * The route answers Slack inside its three-second budget and runs the work in
 * `after()`, so a fixed sleep is now a race the suite loses on a slow query and
 * wins by accident on a fast one — which is worse than failing, because it fails
 * *sometimes*. Each caller says what it is waiting for.
 *
 * The timeout is generous because one of these waits on a model call. Returning
 * early on success keeps the walk quick when nothing is slow.
 */
const settle = async (done: () => boolean | Promise<boolean>, ms = 12000) => {
  const until = Date.now() + ms;
  for (;;) {
    if (await done()) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
};

/** Set by the sign-in below, and used again by the M7 walk. */
let adminCookie = "";

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "event_callback",
  event: { type: "message", user: "U0TESTER", channel: "C0RELAYWALK", ts: "1788401111.1", text, ...extra },
});

await sql`delete from answers where phone = ${PHONE}`;
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
  const res = await slackEvent(message(`${PHONE}: any good toddler classes near South Pasadena?`));
  ok("the event is accepted", res.ok);

  /**
   * The pipeline runs in `after()`, so wait for its last write rather than for
   * a number: the queued answer is the end of this branch.
   *
   * ⚠ **35 seconds, not the default 12, and the reason is a change nobody
   * re-ran this suite after.** Since 8 Sep the pipeline also searches the open
   * web, and `retrieveFor` runs *before* it so the search can be told what the
   * answer already found — measured at 4-9s on its own, on top of the intent
   * call and two queries. At 12s this timed out and six assertions failed in a
   * row, the first of them "the question reached the answer queue", which reads
   * exactly like the wiring having come undone. It had not; the row landed
   * about a second later.
   *
   * ⚠ And the **result is checked**. `settle` returns false on a timeout and
   * every caller here was discarding it, so a slow pipeline produced a cascade
   * of failed assertions rather than one that says "this timed out" — which is
   * the difference between twenty minutes of debugging and none.
   */
  const landed = await settle(async () => {
    const [row] = await sql`select status from answers where phone = ${PHONE}`;
    return row?.status === "sent";
  }, 35000);
  ok("the pipeline finished inside its budget", landed, "web search is 4-9s of it");

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

  /**
   * 5.5 -> 5.6 -> 5.7 -> 5.8, which until 4 Sep ended at a log line: the chain
   * was built, tested and reachable from nothing, so a question was read,
   * classified and answered with silence. These four are the wiring.
   */
  const [queued] = await sql`
    select id, hold_reason, next_step, public_only, answer_text, status
      from answers where phone = ${PHONE}`;
  ok("the question reached the answer queue", Boolean(queued), "5.8");
  /**
   * ⚠ **This asserted the opposite until 8 Sep, and the suite had not been
   * re-run since.** It read *"held for a person, because the pilot holds
   * everything"*, which was true while `PILOT_HOLD_EVERYTHING` was on. The
   * client turned it off that morning: only sensitive, caregiver-related and
   * generator-asked answers wait now, and an ordinary question about toddler
   * classes is **sent**. A stale assertion here is worse than none — it would
   * have failed a correct build for months.
   *
   * `not_held` is asserted by name because it is a real value rather than an
   * absence: before the send path existed, the no-hold branch still returned
   * `pilot_review_all`, so every automatically sent answer would have been
   * recorded as *"held because the pilot reads everything"*.
   */
  ok(
    "an ordinary question is sent rather than held",
    queued && queued.status === "sent" && queued.hold_reason === "not_held",
    JSON.stringify({ status: queued?.status, hold: queued?.hold_reason }),
  );
  ok(
    "with text composed from records rather than left empty",
    Boolean(queued?.answer_text && String(queued.answer_text).length > 0),
  );

  /**
   * ⚠ **Every record it names has to be about what was asked.**
   *
   * The question is "any good toddler classes near South Pasadena?", and the
   * live answer to it named Little Maestros — a class, in South Pasadena, for
   * toddlers, right on all three axes — **and Hahamongna Watershed Park**, a
   * trail in Altadena for preschool and up, wrong on all three and wearing the
   * identical trust chain. The cause was that bands came only from the asker's
   * children and a cold number has none, so no band filter applied at all and
   * the composer padded to the budget with whatever ranked next.
   *
   * Asserted against the table rather than against two record names, so it does
   * not break the day the client retires one.
   */
  const eligible = await sql`
    select name from shares
     where status = 'approved' and not is_test
       and age_bands && '{toddler}'::text[]`;
  const allowed = new Set(eligible.map((r) => String(r.name)));
  const offTopic = await sql`
    select name from shares
     where status = 'approved' and not is_test
       and not (age_bands && '{toddler}'::text[])`;
  const named = offTopic
    .map((r) => String(r.name))
    .filter((name) => String(queued?.answer_text ?? "").includes(name));
  ok(
    "and every record it names is one a toddler question could reach",
    named.length === 0,
    named.length > 0 ? `named anyway: ${named.join(", ")}` : `${allowed.size} eligible`,
  );

  /**
   * ⚠ **No caregiver in an answer about classes.**
   *
   * The first version of the retrieval gate narrowed the *shares* half and left
   * `caregivers: true` unconditional, so this exact question came back naming a
   * caregiver beside two music classes — a named person put in front of somebody
   * who asked about neither, which is the highest-stakes thing this answer does.
   * It passed invariant 1 the whole time, which is why it looked fine.
   */
  const surfaced = await sql`
    select first_name, last_initial from caregivers
     where consent_status = 'consented' and active and discoverable and is_adult`;
  const mentioned = surfaced
    .map((c) => `${c.first_name} ${c.last_initial}`)
    .filter((who) => String(queued?.answer_text ?? "").includes(who));
  ok(
    "a question about classes names no caregiver",
    mentioned.length === 0,
    mentioned.length > 0 ? `named: ${mentioned.join(", ")}` : `${surfaced.length} were eligible`,
  );

  /* One character outside GSM-7 halves the budget from 160 to 70. The composer's
     own punctuation is ASCII for that reason; the labels are verbatim and are
     not the risk. */
  ok(
    "and the answer is cheap to send",
    !/[\u2014\u00b7\u2018\u2019\u201c\u201d]/.test(String(queued?.answer_text ?? "")),
    "an em dash or an interpunct drops the whole message to UCS-2",
  );

  /**
   * And the parent hears something — which since 8 Sep is **the answer itself**
   * rather than "somebody will look".
   *
   * ⚠ The old assertion looked for *"Someone at Pando"*, `heldReply`'s wording,
   * and that is now the wrong branch for an ordinary question: it is what a
   * *sensitive* one still gets. Asserted against the stored `answer_text`, so
   * this says the thing that matters — the parent received what the pipeline
   * composed, verbatim — instead of matching a sentence.
   */
  const ack = posted[posted.length - 1];
  ok(
    "the parent receives the composed answer itself",
    Boolean(queued?.answer_text) &&
      ack?.text.includes(String(queued?.answer_text).split("\n")[0]) === true,
    ack?.text.slice(0, 90),
  );
  ok(
    "and 5.4's clarifying question finally rides along",
    Boolean(ack?.text.includes("how old is your child")),
    "nothing had ever sent one, so pendingClarification could never find one",
  );
  const clarify = await sql`
    select m.template from message_log m join people p on p.id = m.person_id
     where p.phone = ${PHONE} and m.direction = 'out' and m.template like 'clarify_%'`;
  ok(
    "logged under the clarify template, which is what makes the reply findable",
    clarify.length === 1 && clarify[0].template === "clarify_child_age",
    JSON.stringify(clarify),
  );
}

console.log("\n=== a keyword is answered, and the reply is addressed ===");
{
  const before = posted.length;
  const res = await slackEvent(message(`${PHONE}: HELP`, { ts: "1788401555.5" }));
  ok("the event is accepted", res.ok);
  await settle(() => posted.length > before);

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
  await settle(() => posted.length > before);

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

/**
 * The other half of the loop, and the reason it is walked rather than assumed.
 *
 * The wiring queues an answer; nothing in this suite proved a person could then
 * *send* it, or that it would land in the parent's own thread rather than as a
 * loose post in the channel. Threading is the relay's whole addressing scheme —
 * `relayTargetFor` looks up the first outbound row for that person — and an
 * answer sent through `approveAndSend` carries a `personId`, which is a
 * different path from the keyword replies above.
 *
 * ⚠ **It has to run before the STOP section**, and the first version did not:
 * that section opts this number out, `sendSms` refused the answer exactly as it
 * should, and the row honestly stayed `approved` rather than `sent`. Three
 * failures that were the suite's ordering rather than the product — worth
 * keeping as a note, because the fix is not to weaken the assertion.
 */
console.log("\n=== an admin approves it, and it lands in the parent's thread ===");
{
  /**
   * ⚠ **This section needed a held answer, and since 8 Sep an ordinary question
   * no longer produces one.** It used to take the latest row for this number,
   * which was the toddler-classes answer waiting for a reviewer under
   * `PILOT_HOLD_EVERYTHING`. That answer is now *sent* automatically, so
   * `answer.send` correctly refused it and four assertions failed — the suite
   * describing a build that no longer exists.
   *
   * So the walk asks something **sensitive** first. That still holds, and
   * permanently: health, legal and safety questions are the class §19 keeps a
   * person on for ever, which makes this the honest subject for a test about a
   * person approving something. It also exercises the 8 Sep detection — the
   * three layers that decide `sensitive` — on the live path rather than only in
   * `test:intent`.
   */
  /**
   * ⚠ **A caregiver question, and not a health one, and that is a finding
   * rather than a preference.** The obvious subject was *"my 4 year old keeps
   * having nosebleeds, is that normal?"* — the sentence the 8 Sep word list was
   * rebuilt around. Walked live, it produces **no answer row and no reply at
   * all**: `classifyDemand` correctly says `high_stakes` and `routeAnswer`
   * correctly holds, but nothing gets that far, because retrieval finds no
   * record about paediatric health and `composeAnswer` returns null, so
   * `answerQuestion` returns before anything is queued.
   *
   * That is the 7 Sep review's second gap — *"a sensitive question over SMS is
   * held, and answered with nothing"* — one step worse than it was recorded:
   * not a generic holding line, silence. It is on the list for the client and
   * is deliberately not fixed inside a test.
   *
   * A caregiver question holds permanently for its own reason (§19 keeps human
   * eyes on everything caregiver-related) *and* retrieves records, so it is the
   * subject that actually exercises approve-then-send.
   */
  const heldRes = await slackEvent(message(`${PHONE}: any good nannies near Altadena?`));
  ok("a caregiver question is accepted", heldRes.ok);
  const wasHeld = await settle(async () => {
    const [row] = await sql`
      select status from answers where phone = ${PHONE} order by created_at desc limit 1`;
    return row?.status === "pending_review";
  }, 35000);
  ok(
    "and it waits for a person rather than going out on its own",
    wasHeld,
    "everything caregiver-related keeps human eyes permanently (§19)",
  );

  const [queued] = await sql`
    select id, status, hold_reason from answers where phone = ${PHONE}
     order by created_at desc limit 1`;
  ok(
    "held for a reason that names what is in it, not the blanket rule",
    queued?.hold_reason === "caregiver",
    String(queued?.hold_reason),
  );

  await sql`
    insert into admin_users (name, password_hash, active)
    values (${ADMIN_NAME}, ${adminRecord}, true)
    on conflict (name) do update set password_hash = excluded.password_hash, active = true`;
  /* `adminCredentials()` caches for a minute (12 Aug), and the app has been up
     for less than that with an empty store — so the read that matters is the one
     the sign-in itself does, which always re-reads. */

  const session = await fetch(`http://127.0.0.1:${APP_PORT}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: ADMIN_NAME, password: ADMIN_PASSWORD }),
  });
  const cookie = session.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  /* Kept for the M7 walk further down, which drives five admin actions of its
     own. One sign-in rather than two, so the suite exercises one session the
     way an admin has one. */
  adminCookie = cookie;
  ok("an admin can sign in", session.status === 200, `status ${session.status}`);

  const before = posted.length;
  const sent = await fetch(`http://127.0.0.1:${APP_PORT}/api/admin/action`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "answer.send", id: queued?.id }),
  });
  ok("answer.send is accepted", sent.status === 200, `status ${sent.status}`);
  await settle(() => posted.length > before);

  ok("the answer reached the channel", posted.length > before, `${posted.length} posts`);
  const answer = posted[posted.length - 1];
  ok(
    "in the parent's own thread, not as a loose post",
    Boolean(answer?.thread_ts),
    "threading is how a reply resolves back to a person",
  );
  ok(
    "and the number is still masked in it",
    !answer?.text.includes("6265559481"),
    answer?.text.split("\n")[0],
  );

  const [after] = await sql`select status, sent_at, reviewed_by from answers where id = ${queued?.id}`;
  ok(
    "the row says sent only because the send layer said so",
    after?.status === "sent" && after?.sent_at !== null,
    JSON.stringify({ status: after?.status, sent: after?.sent_at !== null }),
  );
  ok("and it carries who decided", Boolean(after?.reviewed_by), String(after?.reviewed_by));
}

/**
 * A4, and the walk that found it.
 *
 * A caregiver *offer* must be sent to the form that can ask the three questions
 * a text cannot — employed them (invariant 14), 18 or over (invariant 2), and
 * the private note behind a hesitant rehire (invariant 12). Before 4 Sep the
 * redirect only fired inside a capture, so an unprompted offer was read as a
 * question and queued as an answer.
 */
console.log("\n=== a caregiver offered by text is refused, not answered ===");
{
  const before = posted.length;
  const answersBefore = await sql`select count(*)::int n from answers where phone = ${PHONE}`;
  await slackEvent(
    message(`${PHONE}: I want to add our nanny Marisol, she is wonderful`, {
      ts: "1788401999.9",
    }),
  );
  await settle(() => posted.length > before);

  const reply = posted[posted.length - 1];
  ok("Pando answered", posted.length > before, `${posted.length} posts`);
  ok(
    "with the link to the form, not with an answer",
    Boolean(reply?.text.includes("/share")),
    reply?.text.slice(0, 120),
  );
  const answersAfter = await sql`select count(*)::int n from answers where phone = ${PHONE}`;
  ok(
    "and nothing was queued as a question",
    answersAfter[0].n === answersBefore[0].n,
    "a nomination in the answers queue is one nobody processes properly",
  );
  const [caregiver] = await sql`
    select count(*)::int n from caregivers where lower(first_name) = 'marisol'`;
  ok("nor was a caregiver record created", caregiver.n === 0, "invariants 2 and 14");
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
  /* STOP is the one branch that deliberately sends nothing, so there is no post
     to wait for — wait for the row it does write. */
  await settle(async () => {
    const [row] = await sql`
      select count(*)::int n from sms_opt_outs
       where phone = ${PHONE} and opted_out_at is not null`;
    return row.n > 0;
  });

  const [out] = await sql`
    select opted_out_at from sms_opt_outs where phone = ${PHONE}`;
  ok("the opt-out is recorded", Boolean(out?.opted_out_at));

  const before = posted.length;
  await slackEvent(
    message("SETTINGS", { thread_ts: String(outbound.ts), ts: "1788404444.4" }),
  );
  /**
   * ⚠ An absence cannot be waited *for*. This one has to be given long enough to
   * fail to happen — and with the pipeline now running in `after()`, "long
   * enough" is a real judgement rather than a formality: too short and the suite
   * passes because the send had not been attempted yet, which is the assertion
   * silently proving nothing. Four seconds against a keyword path that answers
   * in well under one.
   */
  await new Promise((r) => setTimeout(r, 4000));
  ok(
    "and nothing further reaches the channel",
    posted.length === before,
    "the opt-out check runs before the provider step, whichever provider it is",
  );
}

/**
 * M7 end to end — the chain that had no way out.
 *
 * Reviewed on 7 Sep and recorded as having "no entry point and no exit". The
 * entry was built the same day (`blast.create`); this walks what happens after
 * it, because two of the three links were still missing when the client asked
 * on 8 Sep whether the blast process works: **`blast.send` had no button in the
 * admin at all**, and nothing ever sent the approved replies back to the asker.
 *
 * ⚠ **What this deliberately does not do is call `blast.send` for real.** That
 * runs `selectPool` against the live cohort and would text real demo
 * contributors through the stub — writing `blast_recipients` and `message_log`
 * rows for people who did not ask to be in a test, spending their 48-hour gap
 * and their monthly allowance. So the send is asserted through its **refusals**,
 * which are deterministic and are where its logic lives, and the recipient this
 * walk needs is inserted directly. Pool selection itself is `test:matching` (53)
 * and the live pool preview on `/admin/blasts`.
 */
console.log("\n=== M7: a question, a reply, and the answer back to the asker ===");
{
  const ASKER = "+16265559482";
  const RESPONDER = "+16265559483";
  const QUESTION = "any good swim classes for a 4 year old?";

  await sql`delete from people where phone in (${ASKER}, ${RESPONDER})`;
  const [asker] = await sql`
    insert into people (phone, first_name, market_id, is_test, phone_verified_at)
    values (${ASKER}, 'Asker', 'pasadena', true, now()) returning id`;
  const [responder] = await sql`
    insert into people (phone, first_name, market_id, is_test, phone_verified_at)
    values (${RESPONDER}, 'Responder', 'pasadena', true, now()) returning id`;

  const act = (body: unknown) =>
    fetch(`http://127.0.0.1:${APP_PORT}/api/admin/action`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify(body),
    });

  /* 7.1 — the entry. `last_minute` is free, so no checkout stands between the
     Ask and the rest of the walk; the paid path is `test:payments-live`. */
  const created = await act({
    action: "blast.create",
    asker_id: String(asker.id),
    question_text: QUESTION,
    tier: "last_minute",
  });
  ok("an Ask can be created", created.status === 200, `status ${created.status}`);
  const [blast] = await sql`
    select id, status, human_review from blasts where asker_id = ${asker.id}::uuid`;
  ok("and it lands as a row with the question on it", Boolean(blast?.id));

  /**
   * Last-Minute Care always carries `human_review` (7.2), so this is also the
   * check that the send refuses on it — the one thing standing between a
   * mis-scored pool and five strangers' phones.
   */
  const early = await act({ action: "blast.send", id: String(blast.id) });
  ok(
    "sending is refused while it waits for a person, in words",
    early.status === 409,
    `status ${early.status}`,
  );
  const earlyBody = (await early.json()) as { reason?: string; error?: string };
  ok(
    "and the refusal says which one it is",
    earlyBody.reason === "blast_needs_review",
    String(earlyBody.reason),
  );

  /* Delivering before anybody has been asked is its own refusal, not "not found". */
  const tooEarly = await act({ action: "blast.deliver", id: String(blast.id) });
  const tooEarlyBody = (await tooEarly.json()) as { reason?: string };
  ok(
    "and delivering with nothing approved is refused separately",
    tooEarly.status === 409 && tooEarlyBody.reason === "blast_nothing_approved",
    `${tooEarly.status} ${tooEarlyBody.reason}`,
  );

  /* The recipient a real send would have written. See the note above. */
  await sql`
    insert into blast_recipients (blast_id, person_id, match_score, sent_at)
    values (${blast.id}::uuid, ${responder.id}::uuid, 5, now())`;
  await sql`update blasts set status = 'active', human_review = false
             where id = ${blast.id}::uuid`;

  /* 7.5 — the reply comes in through the real inbound door. */
  await slackEvent(message(`${RESPONDER}: Rose Bowl Aquatics parent and me is great.`));
  const attached = await settle(async () => {
    const [r] = await sql`
      select response_text from blast_recipients where blast_id = ${blast.id}::uuid`;
    return r?.response_text !== null && r?.response_text !== undefined;
  });
  ok("an inbound reply attaches to the Ask it answers", attached);

  /* 7.6 / 7.9 — a person reads it. This is what makes forwarding it safe. */
  const rated = await act({
    action: "blast_response.rate",
    blast_id: String(blast.id),
    person_id: String(responder.id),
    quality: 5,
  });
  ok("an admin can rate the reply", rated.status === 200, `status ${rated.status}`);
  const approved = await act({
    action: "blast_response.approve",
    blast_id: String(blast.id),
    person_id: String(responder.id),
    share_name: "Rose Bowl Aquatics",
    share_kind: "activity",
  });
  ok("and approve it", approved.status === 200, `status ${approved.status}`);

  /* M7's exit. */
  const before = posted.length;
  const delivered = await act({ action: "blast.deliver", id: String(blast.id) });
  ok("the answers can be sent to the asker", delivered.status === 200, `status ${delivered.status}`);
  await settle(() => posted.length > before);

  const out = posted[posted.length - 1];
  ok("something reached the channel", posted.length > before, `${posted.length} posts`);
  ok(
    "carrying the parent's own words",
    out?.text.includes("Rose Bowl Aquatics parent and me is great.") === true,
    out?.text.split("\n").slice(-2).join(" "),
  );
  ok(
    "and saying where they came from",
    out?.text.includes("local parents Pando matched") === true,
  );
  ok(
    "the asker's number is masked in the channel, like every other post",
    out?.text.includes("6265559482") === false,
    out?.text.split("\n")[0],
  );

  const [stamped] = await sql`
    select answers_sent_at, status from blasts where id = ${blast.id}::uuid`;
  ok(
    "the row says delivered only because the send layer said so",
    stamped?.answers_sent_at !== null,
  );
  ok(
    "and delivering does not mark the Ask fulfilled — that is a separate judgement",
    stamped?.status !== "fulfilled",
    String(stamped?.status),
  );

  /* The column earns itself here: without it a second press texts them twice. */
  const again = await act({ action: "blast.deliver", id: String(blast.id) });
  const againBody = (await again.json()) as { reason?: string };
  ok(
    "a second press is refused rather than sending the same message twice",
    again.status === 409 && againBody.reason === "blast_answers_already_sent",
    `${again.status} ${againBody.reason}`,
  );

  await sql`delete from blast_recipients where blast_id = ${blast.id}::uuid`;
  await sql`delete from impact_events where blast_id = ${blast.id}::uuid`;
  await sql`delete from blasts where id = ${blast.id}::uuid`;
  await sql`delete from people where phone in (${ASKER}, ${RESPONDER})`;
}

/* ── cleanup ───────────────────────────────────────────────────────────────── */
await sql`delete from answers where phone = ${PHONE}`;
await sql`delete from people where phone = ${PHONE}`;
await sql`delete from sms_opt_outs where phone = ${PHONE}`;
await sql`delete from audit_log where actor = ${ADMIN_NAME}`;
await sql`delete from admin_users where name = ${ADMIN_NAME}`;
ok("cleaned up after itself", true);

teardown();
await sql.end();

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
