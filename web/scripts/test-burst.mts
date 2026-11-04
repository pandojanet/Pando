/**
 * Several texts in a row are one message (4 Nov): how a burst closes, what it
 * becomes, and what is not made to wait.
 *
 * The pure module is run with short timings; the pipeline's use of it is read
 * as source, because it needs the database.
 */
import fs from "node:fs";

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

const b = (await import(`../lib/inbound-burst.ts?v=${Date.now()}`)) as typeof import("../lib/inbound-burst.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = { quietMs: 120, maxMs: 400 };
const voice = { url: "https://api.twilio.com/v", contentType: "audio/amr", kind: "voice" as const };
const picture = { url: "https://api.twilio.com/p", contentType: "image/jpeg", kind: "image" as const };
const pdf = { url: "https://api.twilio.com/f", contentType: "application/pdf", kind: "file" as const };

console.log("\n=== how a burst closes ===");
{
  const P = "+16265550001";
  const first = b.gatherBurst(P, { body: "Hi" }, T);
  await sleep(40);
  const second = b.gatherBurst(P, { body: "looking for swim lessons" }, T);
  await sleep(40);
  const third = b.gatherBurst(P, { body: "for my 4 year old, in Altadena" }, T);
  const [a, c, d] = await Promise.all([first, second, third]);
  ok("three texts a moment apart: only the last carries them", a === null && c === null && Array.isArray(d));
  ok("all three, in the order sent", d?.map((p) => p.body).join("|") === "Hi|looking for swim lessons|for my 4 year old, in Altadena");
  ok("and the burst is closed after", !b.burstOpen(P));
}
{
  const P = "+16265550002";
  const one = await b.gatherBurst(P, { body: "swim lessons in Pasadena?" }, T);
  ok("a single text is its own burst, after the quiet window", one?.length === 1);
  const later = await b.gatherBurst(P, { body: "thanks" }, T);
  ok("a text after the window is a new message", later?.length === 1 && later[0].body === "thanks");
}
{
  const P = "+16265550003";
  const started = Date.now();
  const pending: Array<Promise<unknown>> = [];
  for (let i = 0; i < 8; i++) {
    pending.push(b.gatherBurst(P, { body: `line ${i}` }, T));
    await sleep(90);
  }
  const results = (await Promise.all(pending)) as Array<Array<{ body: string }> | null>;
  const carried = results.filter((r) => r !== null);
  ok("someone texting line after line is answered by the cap, not when they stop",
    carried.length >= 2 && (carried[0]?.length ?? 0) >= 4, `${carried.map((r) => r?.length).join(",")}`);
  ok("and nothing is lost or carried twice", carried.flat().length === 8 && new Set(carried.flat().map((p) => p.body)).size === 8);
  ok("the first answer comes no later than the cap and a beat", Date.now() - started < 8 * 90 + T.maxMs + 200);
}
{
  const [x, y] = await Promise.all([b.gatherBurst("+16265550004", { body: "a" }, T), b.gatherBurst("+16265550005", { body: "b" }, T)]);
  ok("two numbers never share a burst", x?.length === 1 && y?.length === 1);
}

console.log("\n=== what a burst becomes ===");
{
  const one = b.combineBurst([{ body: "Hi", channel: "rcs" }, { body: "  " }, { body: "swim lessons?", channel: "rcs" }]);
  ok("the texts, line by line, blanks dropped", one.body === "Hi\nswim lessons?" && one.channel === "rcs" && one.media === undefined);
  const captioned = b.combineBurst([{ body: "", media: picture }, { body: "is there something like this for a 3 year old?" }]);
  ok("a picture and the text sent after it: the text is the picture's words",
    captioned.media === picture && captioned.body === "is there something like this for a 3 year old?" && captioned.unused.length === 0);
  const before = b.combineBurst([{ body: "what do parents think of this place" }, { body: "", media: picture }]);
  ok("and the text sent before it too", before.media === picture && before.body === "what do parents think of this place");
  const many = b.combineBurst([{ body: "", media: picture }, { body: "", media: voice }, { body: "", media: pdf }]);
  ok("of several, a voice note is read first, as in one message", many.media === voice);
  ok("and the others are handed back to be deleted at Twilio", many.unused.length === 2 && many.unused.includes(picture.url) && many.unused.includes(pdf.url));
  ok("a picture before a PDF", b.combineBurst([{ body: "", media: pdf }, { body: "", media: picture }]).media === picture);
}

console.log("\n=== one turn at a time per number ===");
{
  const order: string[] = [];
  const turn = (name: string, ms: number) => async () => {
    order.push(`${name} start`);
    await sleep(ms);
    order.push(`${name} end`);
    return name;
  };
  const first = b.oneAtATime("+16265550006", turn("first", 120));
  await sleep(20);
  const second = b.oneAtATime("+16265550006", turn("second", 10));
  const other = b.oneAtATime("+16265550007", turn("other", 10));
  await Promise.all([first, second, other]);
  ok("a later turn of the same number waits for the one being answered",
    order.indexOf("second start") > order.indexOf("first end"));
  ok("another number's turn does not wait", order.indexOf("other end") < order.indexOf("first end"));
  const failed = b.oneAtATime("+16265550008", async () => { throw new Error("boom"); });
  const after = b.oneAtATime("+16265550008", async () => "still answered");
  ok("a turn that fails does not hold up the next", (await failed.catch(() => "failed")) === "failed" && (await after) === "still answered");
}
ok("a closed burst runs in its number's queue",
  /return oneAtATime\(message\.from, \(\) =>\s+handleOne\(/.test(fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8")));
ok("the window is five seconds of quiet, twenty at most", b.BURST_QUIET_MS === 5_000 && b.BURST_MAX_MS === 20_000);

console.log("\n=== DELETE and STOP end what the number had in hand (review, 4 Nov) ===");
{
  const P = "+16265550010";
  const asked = b.gatherBurst(P, { body: "looking for swim lessons", media: { url: "https://api.twilio.com/m", contentType: "image/png", kind: "image" } }, T);
  await sleep(20);
  const urls = b.endTurns(P);
  ok("a burst still gathering is dropped, its media handed back to delete", (await asked) === null && urls.join() === "https://api.twilio.com/m");
  ok("and is no longer open", !b.burstOpen(P));
  const order: string[] = [];
  const running = b.oneAtATime(P, async () => { await sleep(60); order.push("first"); });
  const waiting = b.oneAtATime(P, async () => { order.push("queued"); });
  await sleep(10);
  b.endTurns(P);
  await Promise.all([running, waiting]);
  ok("a turn waiting in the queue does not run after DELETE; the one running finishes", order.join() === "first");
  const after = await b.oneAtATime(P, async () => "new turn");
  ok("and a turn after it runs as usual", after === "new turn");
}

console.log("\n=== what is not made to wait ===");
const inbound = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/sms/inbound/route.ts", import.meta.url), "utf8");
const entry = inbound.slice(inbound.indexOf("export async function handleInboundMessage("));
ok("STOP and DELETE end the number's burst and queue, delete its media, and are acted on at once",
  /if \(keyword === "opt_out" \|\| isDeleteRequest\(message\.body\)\) \{\s+for \(const url of endTurns\(message\.from\)\) await deleteTwilioMedia\(url\);\s+return handleOne\(message\);/.test(entry));
ok("another keyword is acted on at once, never merged into a sentence", /if \(keyword !== null\) return handleOne\(message\);/.test(entry));
ok("a tapped button skips the gathering when nothing is gathering — but runs in the number's queue",
  /if \(tap === true && !burstOpen\(message\.from\)\) return oneAtATime\(message\.from, \(\) => handleOne\(message\)\);/.test(entry) &&
    /tap: Boolean\(params\.ButtonPayload\)/.test(route));
ok("every other text is gathered, and only the closing one runs the pipeline",
  /const parts = await gatherBurst\(/.test(entry) && /if \(!parts\) return;/.test(entry));
ok("media left out of a burst is deleted at Twilio, inside the number's turn",
  /await oneAtATime\(message\.from, async \(\) => \{\s+for \(const url of burst\.unused\) await deleteTwilioMedia\(url\);/.test(entry));
ok("the burst's log line is counts and kinds only",
  /console\.info\("\[sms:inbound\] burst", \{ messages: parts\.length, media: burst\.media\?\.kind \?\? null, unused: burst\.unused\.length \}\)/.test(entry));
ok("the typing indicator starts once the burst is closed, not while it gathers",
  inbound.indexOf("const parts = await gatherBurst(") < inbound.indexOf('withTrace("sms_inbound"'));
ok("the confirmed words of a voice note or picture are never a keyword or DELETE",
  /const keyword = input\.confirmedMedia \? null : keywordOf\(body\);/.test(inbound) &&
    /if \(!input\.confirmedMedia && \(await keywordStep\(\{ from, body, keyword \}\)\) === HANDLED\) \{\s+\/\*[^*]*\*\/\s+if \(input\.media\) await deleteTwilioMedia\(input\.media\.url\);/.test(inbound));

console.log("\n=== the conversation as a whole (4 Nov) ===");
const intent = fs.readFileSync(new URL("../lib/server/intent.ts", import.meta.url), "utf8");
const dives = fs.readFileSync(new URL("../lib/server/repo/deep-dives.ts", import.meta.url), "utf8");
ok("the classifier reads several texts in a row as one message, later lines correcting earlier ones",
  /The message may be several texts the parent sent in a row, one per line/.test(intent) && /is several texts in a row, or is not in English/.test(intent));
ok("and is given the conversation before the last exchange, oldest first — on both of its calls",
  /const earlier = exchange && !exchange\.held \? await earlierExchangesFor\(from\) : \[\];/.test(inbound) &&
    /earlier: exchange && !exchange\.held \? await earlierExchangesFor\(from\) : \[\],\s+askedThem:/.test(inbound) &&
    /Earlier questions in this conversation, oldest first/.test(intent));
ok("twelve earlier questions over a week, only ones that went out",
  /EARLIER_EXCHANGES = 12/.test(dives) && /EARLIER_DAYS = 7/.test(dives) && /row\.status === "sent" && row\.hold_reason === "not_held"/.test(dives));
ok("going back to an earlier question carries from that one; a new subject keeps only what the parent said that still applies",
  /carry over from THAT question/.test(intent) && /never the old topic\./.test(intent) && !/where they live\), never/.test(intent));
ok("a rewritten follow-up's place comes from the parent's own words, the question it goes back to first",
  /placeFrom: placeSources\(body, rewritten, \[\.\.\.\(exchange \? \[exchange\.question\] : \[\]\), \.\.\.earlier\.map\(\(x\) => x\.question\)\.reverse\(\)\]\)/.test(inbound) &&
    /return \[body, \.\.\.earlierWords\.filter\(carried\), \.\.\.earlierWords\.filter\(\(t\) => !carried\(t\)\)\];/.test(inbound));
ok("an answer to Pando's question that also asks for more is read as the request it refines",
  /If it answers that AND says more about what they want/.test(intent) &&
    /if \(newRequest && question && early\?\.standalone && !early\.sensitive\) \{/.test(inbound));
ok("and keeps only the fact Pando asked for — never a town volunteered inside a request",
  /const kept = open && pending === question \? await saveFactsIn\(person, body, \{ saysAChild, only: question \}\) : \[\];/.test(inbound));
ok("several short lines answering Pando's question are read by the model, a question among them too",
  /\(longReply \|\| severalLines\)\) \|\| volunteered\) && \(isClarifyingAnswer\(body\) \|\| severalLines\)/.test(inbound));
ok("one reply keeps every fact it carries, each tried on its own; never a name",
  /for \(const q of only \? \[only\] : \(\["child_age", "neighborhood"\] as const\)\)/.test(inbound) && /if \(!saved\) continue;/.test(inbound) &&
    /alsoKept\.reduce\(\(profile, q\) => withAnswer\(profile, q, body\)/.test(inbound));

console.log("\n=== an age is only an age (review, 4 Nov) ===");
const factsSrc = inbound.slice(inbound.indexOf("const DURATION = "), inbound.indexOf("async function saveFactsIn"));
const DURATION = new RegExp(factsSrc.match(/const DURATION = \/(.+)\/i;/)?.[1] ?? "x^", "i");
const BARE = new RegExp(factsSrc.match(/const BARE_AGES = \/(.+)\/i;/)?.[1] ?? "x^", "i");
ok("a duration is not an age: 'a camp for 5 days', 'a 2 week camp', '3 sessions'",
  ["she's 7 and loves science, a camp for 5 days", "my son, looking for a 2 week camp", "3 sessions a week"].every((t) => DURATION.test(t)) &&
    !DURATION.test("she's 7 and loves science"));
ok("a bare answer to the age question is: '7', '3 and 7', '4, 6'", ["7", "3 and 7", "4, 6", " 10 "].every((t) => BARE.test(t)) && !BARE.test("top 5 schools"));
ok("and 'no' in a request is never 'no kids'", /&& !declinesChildren\(body\) && !DURATION\.test\(body\)/.test(inbound));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);
