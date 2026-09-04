/**
 * The Slack relay — the routing decision and the signature, as pure checks.
 *
 * Two things are worth proving without a server, and they are the two that
 * would be silent if they were wrong:
 *
 *  1. **Verification never leaves the real provider.** A code posted into a test
 *     channel is a code the parent never receives, so `transportFor` has to
 *     answer `sms` for it whatever the relay is set to. This is the one that a
 *     future session could break by "simplifying" the routing to read
 *     `category`, which looks equivalent and is exactly backwards.
 *  2. **The signature refuses everything it should.** The events URL is public
 *     and behind it is the pipeline that opts people out and writes
 *     contributions — so unconfigured, unsigned, stale and tampered all have to
 *     fail, and only the genuine article may pass.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/* The dynamic-import-with-cache-buster form every sibling suite uses: a value
   import with a `.ts` specifier is a typecheck error under this tsconfig, and a
   type-only import cannot carry the functions. */
const sig = (await import(String.raw`../lib/slack-signature.ts` + `?v=${Date.now()}`)) as typeof import("../lib/slack-signature.ts");
const { SLACK_REPLAY_WINDOW_SECONDS, slackSignaturePayload, verifySlackSignature } = sig;
const txt = (await import(String.raw`../lib/slack-text.ts` + `?v=${Date.now()}`)) as typeof import("../lib/slack-text.ts");
const { unwrapSlackText, addressedNumber, readSlackMessage } = txt;

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log("  ok   ", name);
  } else {
    fail++;
    console.log("  FAIL ", name, detail ? `— ${detail}` : "");
  }
}

function head(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* ── the routing decision ──────────────────────────────────────────────────── */

/**
 * `transportFor` lives in `lib/server/sms.ts`, which is `server-only` and pulls
 * in the database — so the rule is restated here as the two lines it is, and
 * asserted against the source so the copy cannot drift silently.
 */
function transportFor(
  input: { purpose?: "verification" },
  relayEnabled: boolean,
): "sms" | "slack" {
  if (input.purpose === "verification") return "sms";
  return relayEnabled ? "slack" : "sms";
}

head("verification never goes to the relay");
ok(
  "with the relay on, a verification code still goes by SMS",
  transportFor({ purpose: "verification" }, true) === "sms",
);
ok(
  "with the relay off, so does everything else",
  transportFor({}, false) === "sms",
);
ok(
  "with the relay on, an ordinary message goes to Slack",
  transportFor({}, true) === "slack",
);

const source = readFileSync(new URL("../lib/server/sms.ts", import.meta.url), "utf8");
ok(
  "the real router pins verification first, before it looks at the relay",
  /purpose === "verification"\)\s*return "sms";/.test(source),
  "if this fails, the copy above no longer describes the app",
);
ok(
  "and it does not route on `category`",
  !/transportFor[\s\S]{0,400}category ===/.test(source),
  "`transactional` covers HELP, settings and every capture prompt — the relay's whole subject",
);
ok(
  "the verification caller marks itself",
  /purpose: "verification"/.test(
    readFileSync(new URL("../app/api/seed/verify/start/route.ts", import.meta.url), "utf8"),
  ),
);

/* ── the signature ─────────────────────────────────────────────────────────── */

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const BODY = JSON.stringify({ type: "event_callback", event: { text: "yes" } });

function sign(body: string, ts: string, secret = SECRET): string {
  return (
    "v0=" +
    createHmac("sha256", secret)
      .update(slackSignaturePayload(ts, body), "utf8")
      .digest("hex")
  );
}

const now = new Date();
const ts = String(Math.floor(now.getTime() / 1000));

head("the signature");
ok(
  "a genuine request passes",
  verifySlackSignature({
    rawBody: BODY,
    timestamp: ts,
    signature: sign(BODY, ts),
    secret: SECRET,
    now,
  }).ok,
);

const cases: Array<[string, ReturnType<typeof verifySlackSignature>, string]> = [
  [
    "no signing secret refuses, never waves through",
    verifySlackSignature({
      rawBody: BODY,
      timestamp: ts,
      signature: sign(BODY, ts),
      secret: null,
      now,
    }),
    "not_configured",
  ],
  [
    "a missing signature refuses",
    verifySlackSignature({ rawBody: BODY, timestamp: ts, signature: null, secret: SECRET, now }),
    "missing_signature",
  ],
  [
    "a missing timestamp refuses",
    verifySlackSignature({
      rawBody: BODY,
      timestamp: null,
      signature: sign(BODY, ts),
      secret: SECRET,
      now,
    }),
    "missing_signature",
  ],
  [
    "a non-numeric timestamp refuses",
    verifySlackSignature({
      rawBody: BODY,
      timestamp: "not-a-time",
      signature: sign(BODY, "not-a-time"),
      secret: SECRET,
      now,
    }),
    "missing_signature",
  ],
  [
    "a tampered body refuses",
    verifySlackSignature({
      rawBody: BODY.replace("yes", "no"),
      timestamp: ts,
      signature: sign(BODY, ts),
      secret: SECRET,
      now,
    }),
    "mismatch",
  ],
  [
    "the wrong secret refuses",
    verifySlackSignature({
      rawBody: BODY,
      timestamp: ts,
      signature: sign(BODY, ts, "someone-elses-secret"),
      secret: SECRET,
      now,
    }),
    "mismatch",
  ],
];

for (const [name, result, reason] of cases) {
  ok(name, !result.ok && result.reason === reason, JSON.stringify(result));
}

head("the replay window — the one thing Twilio's scheme has no equivalent of");
{
  const old = String(Math.floor(now.getTime() / 1000) - SLACK_REPLAY_WINDOW_SECONDS - 1);
  ok(
    "a correctly signed request from six minutes ago is refused",
    (() => {
      const r = verifySlackSignature({
        rawBody: BODY,
        timestamp: old,
        signature: sign(BODY, old),
        secret: SECRET,
        now,
      });
      return !r.ok && r.reason === "stale";
    })(),
    "a captured request would otherwise be replayable forever",
  );

  const edge = String(Math.floor(now.getTime() / 1000) - SLACK_REPLAY_WINDOW_SECONDS + 5);
  ok(
    "one just inside the window still passes",
    verifySlackSignature({
      rawBody: BODY,
      timestamp: edge,
      signature: sign(BODY, edge),
      secret: SECRET,
      now,
    }).ok,
  );

  const future = String(Math.floor(now.getTime() / 1000) + SLACK_REPLAY_WINDOW_SECONDS + 60);
  ok(
    "and so is a clock skewed the other way, up to the same window",
    (() => {
      const r = verifySlackSignature({
        rawBody: BODY,
        timestamp: future,
        signature: sign(BODY, future),
        secret: SECRET,
        now,
      });
      return !r.ok && r.reason === "stale";
    })(),
    "the window is absolute, so a far-future timestamp is as suspect as a stale one",
  );
}

/* ── the cold-inbound address form ─────────────────────────────────────────── */

head("addressing a message to a number, for the cold inbound (5.9)");
{
  /* The real function, not a copy of its regex. It used to be restated here
     "because the route is a server module" — so this suite was checking a
     duplicate, and would have passed with the route's own parser deleted. It
     did pass, throughout the linkify bug below. That is why the parser moved
     to `lib/slack-text.ts`, which imports nothing and loads in plain node. */
  const parse = addressedNumber;

  ok("a number and a colon is an addressed message", parse("+16265550143: hello") !== null);
  ok(
    "the body is everything after the colon",
    parse("+16265550143: what about camps?")?.body === "what about camps?",
  );
  ok(
    "a sentence starting with a plus is not",
    parse("+1 more thing about the class") === null,
    "requiring the colon is what keeps the accident impossible",
  );
  ok("ordinary chatter is not", parse("morning all") === null);
  ok(
    "and neither is a bare colon sentence",
    parse("note: this is for us") === null,
    "the prefix has to look like a number",
  );
}

head("Slack's own markup, undone before anything reads the message");
{
  /* The bug, by name. Slack linkifies a phone number, so the raw event text
     for "+16265550001: HELP" is a tel link and the address parser saw a
     message starting with "<". The channel went silent and the route logged
     `addressed:false` — nothing errored, and typing the number without the
     plus worked, which is how it surfaced. */
  const read = (t: string) => readSlackMessage(t).addressed;

  ok(
    "a linkified number is still an address",
    read("<tel:+16265550001|+16265550001>: HELP")?.raw === "+16265550001",
    "this is the case that was silently dropped",
  );
  ok("and its body survives", read("<tel:+16265550001|+16265550001>: HELP")?.body === "HELP");
  ok(
    "a bare tel link yields the number, not the scheme",
    read("<tel:+16265550001>: HELP")?.raw === "+16265550001",
    "the label is optional; the target is what counts",
  );
  ok(
    "an unlinkified number still works",
    read("16265550001: HELP")?.raw === "16265550001",
    "the form that happened to work is not allowed to regress",
  );

  ok(
    "a labelled link yields the label",
    unwrapSlackText("see <https://pando.is/share|the form>") === "see the form",
    "the label is what the person sees, so it is what they meant",
  );
  ok(
    "an unlabelled link yields the target",
    unwrapSlackText("<https://pando.is/share>") === "https://pando.is/share",
  );
  ok("an email link unwraps too", unwrapSlackText("<mailto:a@b.com|a@b.com>") === "a@b.com");

  /* Slack escapes exactly three characters in every event body, so this
     reaches a capture's free-text step and would be stored inside a parent's
     own words. */
  ok(
    "the three escaped entities are decoded",
    unwrapSlackText("Tom &amp; Jerry &lt;3 &gt;") === "Tom & Jerry <3 >",
  );
  ok(
    "and decoding runs last, so escaped text is not read as markup",
    unwrapSlackText("&lt;tel:+15550001&gt;") === "<tel:+15550001>",
    "decoding first would turn a typed angle bracket into a link to unwrap",
  );

  ok("ordinary text passes through untouched", unwrapSlackText("morning all") === "morning all");
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
