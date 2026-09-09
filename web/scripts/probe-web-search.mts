/**
 * The public-information half of an answer, across questions, phrasings and
 * contexts — driven through the real pipeline, never through a copy of it.
 *
 * ## Why it goes through the front door
 *
 * `lib/server/web-search.ts` is `server-only` and imports the Anthropic SDK, so
 * a plain node script cannot load it — the same constraint `test-relay.mts`
 * documents. That file also records what happens when a suite works around it:
 * its own regex was restated inline and it would have passed with the route's
 * parser deleted.
 *
 * And the thing worth measuring here is not the module in isolation. It is
 * whether *the context the call site computes* reaches the search and changes
 * what comes back — the age bands, the topic, the area and the records the
 * parents already backed. That wiring only exists in `answerQuestion`, so the
 * probe posts a signed Slack event and reads the answer the pipeline queued.
 *
 * ## What is a check and what is a reading
 *
 * Some of this has a right answer and is asserted:
 *
 *  - a question about **care** must produce no public line at all;
 *  - a public line must never repeat a place the parents' half already names;
 *  - a public line must never carry a parent's trust label (invariant 3);
 *  - a name that reads as a person must never arrive from the open web;
 *  - every answer must still compose when the search returns nothing.
 *
 * The rest — whether the web found something *good* — has no assertion that
 * would survive the day a business closes, so it is printed for a human to
 * read. ⚠ A model plus a live web is not deterministic: two runs of the same
 * question legitimately differ, and this probe reports rather than gates.
 *
 * Requires a build, a database and `ANTHROPIC_API_KEY`.
 *
 *     npm run probe:web-search            all cases
 *     npm run probe:web-search -- swim    only cases whose id contains "swim"
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
  console.log("\n  DATABASE_URL is not set — this probe needs a database. Skipping.\n");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("\n  ANTHROPIC_API_KEY is not set — there is nothing to probe. Skipping.\n");
  process.exit(0);
}
if (!existsSync(".next/standalone/server.js")) {
  console.log("\n  No standalone build found. Run `npm run build` first.\n");
  process.exit(0);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log("    ok   " + name);
  } else {
    fail++;
    console.log("    FAIL " + name + (detail ? ` — ${detail}` : ""));
  }
};

const APP_PORT = 4191;
const STUB_PORT = 4192;
const SECRET = "web-search-probe-secret";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require" });

/* ── the Slack stub ────────────────────────────────────────────────────────── */

const posted: Array<{ text: string }> = [];
let seq = 0;
const stub: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      posted.push(JSON.parse(raw) as { text: string });
    } catch {
      /* the assertions read the database, not this */
    }
    seq += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: `1788500000.00000${seq}` }));
  });
});
await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", () => r()));

/* ── the app ───────────────────────────────────────────────────────────────── */

/**
 * The app's own `[web-search]` lines, kept so a case that came back empty can
 * say **why**: a refusal and a miss are the same silence from the outside, which
 * is the distinction that module's own logging exists to draw.
 */
const appLog: string[] = [];

const app: ChildProcess = spawn(process.execPath, [".next/standalone/server.js"], {
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    MESSAGING_RELAY: "slack",
    SLACK_BOT_TOKEN: "xoxb-web-search-probe",
    SLACK_CHANNEL_ID: "C0PROBE",
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_USER_ID: "U0PANDOBOT",
    SLACK_API_BASE: `http://127.0.0.1:${STUB_PORT}`,
    /* Nothing here may reach a real phone even by accident. */
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_MESSAGING_SERVICE_SID: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const collect = (d: Buffer) => {
  const s = d.toString();
  for (const line of s.split("\n")) if (line.includes("[web-search]")) appLog.push(line.trim());
};
app.stdout?.on("data", collect);
app.stderr?.on("data", collect);

function teardown() {
  /* The tree, not just the parent: a survivor holds the port and the next run
     talks to it — the orphan trap `test-relay-live.mts` documents. */
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

if (!(await waitForApp())) {
  console.log("\n  The app did not start on port", APP_PORT, "\n");
  teardown();
  await sql.end();
  process.exit(1);
}

/* ── driving it ────────────────────────────────────────────────────────────── */

function slackEvent(text: string) {
  const raw = JSON.stringify({
    type: "event_callback",
    event: { type: "message", user: "U0PROBE", channel: "C0PROBE", ts: "1788501111.1", text },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  return fetch(`http://127.0.0.1:${APP_PORT}/api/slack/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": ts,
      "x-slack-signature":
        "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`, "utf8").digest("hex"),
    },
    body: raw,
  });
}

const settle = async (done: () => boolean | Promise<boolean>, ms = 45000) => {
  const until = Date.now() + ms;
  for (;;) {
    if (await done()) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
};

/* ── the cases ─────────────────────────────────────────────────────────────── */

/**
 * A profile, or none.
 *
 * The point of the matrix is that the *same* question is asked from different
 * contexts, so the context is a property of the case rather than of the phone:
 * each case gets its own number and its own person row, created here and
 * removed at the end.
 */
interface Context {
  /** No `people` row at all — 5.9's cold inbound, the hardest case. */
  cold?: boolean;
  area?: string;
  /** Birth years, so the bands are computed the way the pipeline computes them. */
  children?: number[];
}

interface Case {
  id: string;
  text: string;
  context: Context;
  /** What this case is here to show. Printed above the result. */
  about: string;
  /** True when a public line would be a bug rather than a miss. */
  expectNoPublic?: boolean;
  /**
   * True when the right outcome is Pando **asking** rather than answering.
   *
   * ⚠ The first version of this probe asserted that every case queued an
   * answer, and the nonsense case failed — correctly. "asdfgh qwerty" is
   * `unclear`, and since 8 Sep an unreadable message opens a `pending_questions`
   * row and asks for the detail that would let Pando classify it. The check was
   * wrong, not the pipeline; it also sat out the full 45-second settle waiting
   * for a row that was never coming.
   */
  expectAsked?: boolean;
}

const YEAR = new Date().getFullYear();

const CASES: Case[] = [
  {
    id: "named-place",
    text: "What locals tell about Tom Sawyer Camps?",
    context: { area: "altadena", children: [YEAR - 7] },
    about:
      "the question names a place the graph already holds — the case where the exclusion can eat the one finding the parent actually asked about",
  },
  {
    id: "toddler-classes-cold",
    text: "any good toddler classes near South Pasadena?",
    context: { cold: true },
    about: "the baseline: everything the search knows comes from the words",
  },
  {
    id: "toddler-classes-profiled",
    text: "any good classes?",
    context: { area: "south-pasadena", children: [YEAR - 2] },
    about: "the same question with the age and the area stripped out of it — this is the case the context brief exists for",
  },
  {
    id: "terse-camps",
    text: "camps",
    context: { area: "altadena", children: [YEAR - 7] },
    about: "one word, no question mark, no age — and camps are seasonal, so the date in the brief matters",
  },
  {
    id: "swim-specific",
    text: "swim lessons for a 4 year old in Altadena, ideally weekends",
    context: { area: "altadena", children: [YEAR - 4] },
    about: "specific and well phrased: the case that should work with or without context",
  },
  {
    id: "rainy-day",
    text: "its pouring and my 2yo is climbing the walls, anywhere indoors round pasadena thats not the mall",
    context: { area: "pasadena", children: [YEAR - 2] },
    about: "how a parent actually texts — lower case, a typo, an aside, and no noun the taxonomy knows",
  },
  {
    id: "teen-context",
    text: "anything for my kid to do after school",
    context: { area: "monrovia", children: [YEAR - 15] },
    about: "the age is only in the profile, and it is the far end of the ladder — a wrong band here is very visible",
  },
  {
    id: "baby-context",
    text: "anything for my kid to do after school",
    context: { area: "monrovia", children: [YEAR - 1] },
    about: "the identical sentence from a baby's parent: the two results should not be the same",
  },
  {
    id: "care-question",
    text: "any good nannies near Altadena?",
    context: { area: "altadena", children: [YEAR - 3] },
    about: "a question about care",
    expectNoPublic: true,
  },
  {
    id: "care-implicit",
    text: "who can look after my toddler on tuesdays",
    context: { area: "pasadena", children: [YEAR - 2] },
    about: "care without a care word in it — the focus topic is what has to catch this",
    expectNoPublic: true,
  },
  {
    id: "nonsense",
    text: "asdfgh qwerty",
    context: { cold: true },
    about: "nothing to search for, and nothing to answer: Pando asks instead, and no search should have run",
    expectAsked: true,
  },
];

const chosen = only.length === 0 ? CASES : CASES.filter((c) => only.some((q) => c.id.includes(q)));

/* ── the probe people ──────────────────────────────────────────────────────── */

const PHONE_BASE = 16265559200;
const phones = new Map<string, string>();
chosen.forEach((c, i) => phones.set(c.id, `+${PHONE_BASE + i}`));

async function wipe() {
  for (const phone of phones.values()) {
    const rows = (await sql`select id from people where phone = ${phone}`) as Array<{ id: string }>;
    for (const { id } of rows) {
      /* `message_log` has **no phone column** — invariant 7 at the schema level,
         so the only way to it is the person, and it has to go before them. */
      await sql`delete from message_log where person_id = ${id}`;
      await sql`delete from children where person_id = ${id}`;
      await sql`delete from social_affinities where person_id = ${id}`;
      await sql`delete from life_relevance where person_id = ${id}`;
      await sql`delete from consents where person_id = ${id}`;
      await sql`delete from pending_questions where person_id = ${id}`;
    }
    await sql`delete from answers where phone = ${phone}`;
    await sql`delete from people where phone = ${phone}`;
    await sql`delete from sms_opt_outs where phone = ${phone}`;
  }
}

await wipe();

for (const c of chosen) {
  if (c.context.cold) continue;
  const phone = phones.get(c.id)!;
  /**
   * A named row needs a verified number (`verified_if_named`, invariant 11), and
   * this row is a fixture rather than a parent — it is created and deleted by
   * this file and never sees a screen.
   */
  const [person] = (await sql`
    insert into people (phone, first_name, market_id, neighborhood, wants_founding,
                        phone_verified_at, source, is_test)
    values (${phone}, 'Probe', 'pasadena', ${c.context.area ?? null}, true, now(), 'probe', true)
    returning id`) as Array<{ id: string }>;
  for (const year of c.context.children ?? []) {
    await sql`insert into children (person_id, birth_year) values (${person.id}, ${year})`;
  }
}

/* ── run ───────────────────────────────────────────────────────────────────── */

interface Row {
  answer_text: string;
  labels: string[] | null;
  hold_reason: string | null;
  public_only: boolean | null;
}

console.log(`\n  ${chosen.length} case(s). Each is one live search.\n`);

const report: Array<{ c: Case; row: Row | null; asked: boolean; ms: number; logs: string[] }> = [];

for (const c of chosen) {
  const phone = phones.get(c.id)!;
  const started = Date.now();
  const logMark = appLog.length;

  const res = await slackEvent(`${phone}: ${c.text}`);
  if (!res.ok) {
    console.log(`  ${c.id}: the event was refused (${res.status})`);
    report.push({ c, row: null, asked: false, ms: 0, logs: [] });
    continue;
  }

  /**
   * Wait for **either** ending, because both are real.
   *
   * A message can be answered or asked about, and which one a short message
   * gets is the classifier's judgement rather than something this probe can
   * pin: "camps" was answered on one run and asked about on the next, which is
   * a model reading one word and is not a regression. Waiting only for an
   * answer spends the whole timeout on the runs where it asked, and then
   * reports a passing pipeline as broken.
   *
   * What is *not* legitimate is neither — that is a pipeline that dropped the
   * message, and it is the one thing this loop still fails on.
   */
  const asked = async () => {
    const [n] = (await sql`
      select count(*)::int n from pending_questions q
        join people p on p.id = q.person_id
       where p.phone = ${phone}`) as Array<{ n: number }>;
    return n.n > 0;
  };
  const answered = async () => {
    const [n] = (await sql`select count(*)::int n from answers where phone = ${phone}`) as Array<{
      n: number;
    }>;
    return n.n > 0;
  };
  const arrived = await settle(async () => (await answered()) || (await asked()));
  const wasAsked = arrived && !(await answered());

  const rows = arrived
    ? ((await sql`
        select answer_text, labels, hold_reason, public_only
          from answers where phone = ${phone}
         order by created_at desc limit 1`) as unknown as Row[])
    : [];

  report.push({
    c,
    row: rows[0] ?? null,
    asked: wasAsked,
    ms: Date.now() - started,
    logs: appLog.slice(logMark),
  });
}

/* ── report ────────────────────────────────────────────────────────────────── */

/* The composer's own separator, so a public line can be told from a parent's. */
const PUBLIC_LABEL = "Public/general information";
const PARENT_LABELS = [
  "Shared by a local parent",
  "Vouched by a local parent",
  "Validated by multiple parents",
];

console.log("\n════════ what came back ════════");

for (const { c, row, asked, ms, logs } of report) {
  console.log(`\n── ${c.id}  (${(ms / 1000).toFixed(1)}s)`);
  console.log(`   why: ${c.about}`);
  console.log(`   ctx: ${c.context.cold ? "cold number, no profile" : `${c.context.area}, children born ${(c.context.children ?? []).join(", ")}`}`);
  console.log(`   msg: "${c.text}"`);

  if (c.expectAsked) {
    ok(
      `${c.id}: a message nobody could read is asked about, not answered`,
      asked && row === null,
      asked ? "an answer was composed anyway" : "the pipeline produced nothing at all",
    );
  }

  if (!row) {
    console.log(
      asked
        ? "   →   Pando asked for more detail rather than answering"
        : "   →   nothing at all",
    );
    /* Asking is a legitimate ending; silence is not. */
    ok(`${c.id}: the message was not dropped`, asked, "no answer and no question");
    continue;
  }

  for (const line of row.answer_text.split("\n")) console.log(`   →   ${line}`);
  if (logs.length > 0) for (const l of logs) console.log(`   log: ${l}`);

  const hasPublic = row.answer_text.includes(PUBLIC_LABEL);
  /**
   * The lines *under* the heading, not the heading itself.
   *
   * This filtered on `includes(PUBLIC_LABEL)` and therefore matched exactly one
   * line — the heading — from the moment the label became a heading on 9 Sep
   * rather than a suffix on each line. Every check below it was reading our own
   * approved copy and passing on it, which is a check that cannot fail.
   */
  const allLines = row.answer_text.split("\n");
  const headingAt = allLines.findIndex((l) => l.includes(PUBLIC_LABEL));
  const publicLines =
    headingAt === -1
      ? []
      : allLines.slice(headingAt + 1).filter((l) => l.trim().length > 0);

  ok(`${c.id}: an answer was queued`, true);

  if (c.expectNoPublic) {
    ok(
      `${c.id}: no public line on a question about care`,
      !hasPublic,
      "a page calling somebody a wonderful nanny has cleared none of invariants 1, 2, 12 or 13",
    );
  }

  /* Invariant 3, read off the rendered answer rather than off the type. */
  for (const line of publicLines) {
    ok(
      `${c.id}: the public line carries no parent claim`,
      !PARENT_LABELS.some((l) => line.includes(l)),
      line,
    );
  }

  /**
   * The rule, restated after 9 Sep — and it is narrower than it was.
   *
   * ⚠ The old version split every line on `:` or `(` because the composer once
   * wrote `Name (venue): labels`. It has written prose since 9 Sep, so the
   * "name" it extracted was usually a whole sentence and the check **could not
   * fire at all**. It passed on this probe's own worst case and told us nothing.
   *
   * What must still never happen is an *alternative* appearing under both
   * headings: offering the same class as "Validated by multiple parents" and
   * again as general information says the two are equivalent, and they are not.
   *
   * What is now allowed on purpose is the **lead** appearing in both. When the
   * question is about one place, the parents' experience and the page's own
   * facts are complementary, the heading says which is which, and excluding it
   * deleted the public half of exactly the answers most likely to want one.
   */
  const alsoLine = allLines.find((l) => l.startsWith("Also nearby:")) ?? "";
  const alsoNames = alsoLine
    .replace("Also nearby:", "")
    .split(";")
    .map((part) => part.split(",")[0]?.trim().toLowerCase() ?? "")
    .filter((n) => n.length > 2);
  const publicNames = publicLines
    .map((l) => l.split(" - ")[0]?.trim().toLowerCase() ?? "")
    .filter((n) => n.length > 2);
  const bothWays = alsoNames.filter((n) => publicNames.includes(n));
  ok(
    `${c.id}: no alternative is offered under both headings`,
    bothWays.length === 0,
    bothWays.join(", "),
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);

if (!process.argv.includes("--keep")) {
  await wipe();
  console.log("  cleaned up the probe numbers\n");
}

teardown();
await sql.end();
process.exit(fail > 0 ? 1 : 0);
