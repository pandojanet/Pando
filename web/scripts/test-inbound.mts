import { createHmac } from "node:crypto";

/**
 * M13.2 + M12.3/12.4 — the inbound webhook's two guards.
 *
 * The webhook URL is public, and everything behind it acts on what the request
 * says: a forged POST could opt somebody out, opt somebody back in after they
 * asked to stop, or write a fake reply that raises a contributor's response rate
 * and keeps Pando texting them. So **most of what follows asserts a refusal**.
 *
 * The keyword half is the other guard, and its failure mode is quieter: a
 * substring match would silence a parent who wrote "I'll stop asking", and a
 * classifier that saw STOP at all would eventually read it as conversation. Both
 * are tested here rather than left to the route.
 */

const sig = (await import(`../lib/twilio-signature.ts?v=${Date.now()}`)) as typeof import("../lib/twilio-signature.ts");
const tpl = (await import(`../lib/sms-templates.ts?v=${Date.now()}`)) as typeof import("../lib/sms-templates.ts");

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

const TOKEN = "test-auth-token-not-a-real-one";
const BASE = "https://pando.is";
const PATH = "/api/sms/inbound";


const params = { From: "+16265550143", To: "+13105551234", Body: "STOP", MessageSid: "SM123" };
const signFor = (p: Record<string, string>, url = BASE + PATH, token = TOKEN) =>
  createHmac("sha1", token).update(sig.signaturePayload(url, p), "utf8").digest("base64");

console.log("\n=== the payload Twilio signs ===");
ok(
  "URL first, then keys sorted, then key and value run together",
  sig.signaturePayload("https://x/y", { b: "2", a: "1" }) === "https://x/ya1b2",
  `got ${sig.signaturePayload("https://x/y", { b: "2", a: "1" })}`,
);
ok(
  "the order of the object does not change the payload",
  sig.signaturePayload("https://x/y", { a: "1", b: "2" }) ===
    sig.signaturePayload("https://x/y", { b: "2", a: "1" }),
);
ok(
  "an empty value still contributes its key",
  sig.signaturePayload("https://x/y", { a: "" }) === "https://x/ya",
);

console.log("\n=== a genuine request is accepted ===");
ok(
  "a correct signature verifies",
  sig.verifySignature(BASE + PATH, params, signFor(params), TOKEN).ok,
);

console.log("\n=== and every forgery is refused ===");
ok(
  "no signature at all",
  (() => {
    const r = sig.verifySignature(BASE + PATH, params, null, TOKEN);
    return !r.ok && r.reason === "missing_signature";
  })(),
);
ok("an empty signature", !sig.verifySignature(BASE + PATH, params, "", TOKEN).ok);
ok("a signature for different params", !sig.verifySignature(BASE + PATH, { ...params, Body: "START" }, signFor(params), TOKEN).ok,
   "this is the attack that matters: re-signing somebody else's STOP as a START");
ok(
  "a signature made with the wrong token",
  !sig.verifySignature(BASE + PATH, params, signFor(params, BASE + PATH, "wrong-token"), TOKEN).ok,
);
ok(
  "a signature for a different URL",
  !sig.verifySignature(BASE + PATH, params, signFor(params, "https://evil.example" + PATH), TOKEN).ok,
  "the URL comes from configuration, never from a header an attacker sets",
);
ok(
  "a signature for a different path on the same host",
  !sig.verifySignature(BASE + PATH, params, signFor(params, BASE + "/api/sms/status"), TOKEN).ok,
);
ok("truncated", !sig.verifySignature(BASE + PATH, params, signFor(params).slice(0, 20), TOKEN).ok);
ok("padded", !sig.verifySignature(BASE + PATH, params, signFor(params) + "A", TOKEN).ok);
ok(
  "an added parameter invalidates it",
  !sig.verifySignature(BASE + PATH, { ...params, Extra: "x" }, signFor(params), TOKEN).ok,
);
ok(
  "a removed parameter invalidates it",
  !sig.verifySignature(BASE + PATH, { From: params.From }, signFor(params), TOKEN).ok,
);

console.log("\n=== an unconfigured deployment refuses rather than allows ===");
ok(
  "no token means not_configured, never a free pass",
  (() => {
    const r = sig.verifySignature(BASE + PATH, params, signFor(params), null);
    return !r.ok && r.reason === "not_configured";
  })(),
  "an endpoint that skips verification when a secret is missing is unauthenticated the moment somebody mis-deploys",
);
ok(
  "an empty token is treated as no token, never as a key",
  (() => {
    const r = sig.verifySignature(BASE + PATH, params, signFor(params), "");
    return !r.ok && r.reason === "not_configured";
  })(),
);

console.log("\n=== 12.3  keywords, matched exactly ===");
for (const word of tpl.OPT_OUT_KEYWORDS) {
  ok(`${word} opts out`, tpl.keywordOf(word) === "opt_out");
  ok(`${word.toLowerCase()} does too`, tpl.keywordOf(word.toLowerCase()) === "opt_out");
}
ok("surrounding whitespace is ignored", tpl.keywordOf("  stop  ") === "opt_out");
ok("a trailing full stop is ignored", tpl.keywordOf("Stop.") === "opt_out");
ok(
  '"stop by the park at 3" is NOT an opt-out',
  tpl.keywordOf("stop by the park at 3") === null,
  "a substring test would silence people who never asked to be silenced",
);
ok('"I\'ll stop asking" is not either', tpl.keywordOf("I'll stop asking") === null);
ok('"please cancel my class" is not', tpl.keywordOf("please cancel my class") === null);

console.log("\n=== START and UNSTOP only ===");
ok("START opts in", tpl.keywordOf("START") === "opt_in");
ok("UNSTOP opts in", tpl.keywordOf("unstop") === "opt_in");
ok(
  "YES is NOT an opt-in",
  tpl.keywordOf("YES") === null,
  'a parent answering "yes" to a Network Ask must never read as a re-subscribe',
);
ok("and neither is a bare Y", tpl.keywordOf("Y") === null);

console.log("\n=== 12.4  HELP ===");
ok("HELP is recognised", tpl.keywordOf("HELP") === "help");
ok("INFO too", tpl.keywordOf("info") === "help");
const help = tpl.helpSms();
ok("the reply names the service", /Pando/.test(help));
ok("gives a contact address", /hello@pando\.is/.test(help));
ok("says how to opt out", /STOP/.test(help));
ok("carries the rates disclosure", /Msg & data rates may apply/.test(help));
ok(
  "and fits one segment",
  help.length <= 160,
  `${help.length} characters — a HELP reply that spans two messages reads as a company that cannot answer a simple question about itself`,
);

console.log("\n=== the START confirmation ===");
const back = tpl.optInConfirmationSms();
ok("confirms they are back", /Pando/.test(back) && back.length <= 160, `${back.length} chars`);
ok("and still says how to leave again", /STOP/.test(back));

console.log("\n=== ordinary text reaches the classifier, and only ordinary text ===");
ok("a real question is not a keyword", tpl.keywordOf("any good swim lessons near Altadena?") === null);
ok("an empty message is not a keyword", tpl.keywordOf("") === null);
ok("whitespace alone is not", tpl.keywordOf("   ") === null);

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
