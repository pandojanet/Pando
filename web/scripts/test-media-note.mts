/**
 * Voice notes and pictures (3 Nov): which media is which, what is read back,
 * and the order in which the pipeline lets it act — the read-back first, the
 * main flow only on a YES, and the media deleted at Twilio when the read-back
 * ends.
 *
 * The pure module is run; the network and database halves are read as source,
 * because they need Twilio, Deepgram, Claude and Postgres.
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

const m = (await import(`../lib/media-note.ts?v=${Date.now()}`)) as typeof import("../lib/media-note.ts");
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
const thanks = (await import(`../lib/thanks.ts?v=${Date.now()}`)) as typeof import("../lib/thanks.ts");

const AC = "AC" + "a".repeat(32);
const MM = "MM" + "b".repeat(32);
const url = (n: string) => `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${MM}/Media/ME${n.repeat(32)}`;

console.log("\n=== which media is which ===");
ok("Twilio's media URL is one", m.isTwilioMediaUrl(url("c")));
ok(
  "anywhere else is not — the server fetches it with the account's credentials",
  !m.isTwilioMediaUrl(url("c").replace("api.twilio.com", "evil.example")) &&
    !m.isTwilioMediaUrl(url("c").replace("https:", "http:")) &&
    !m.isTwilioMediaUrl(`${url("c")}/../../x`),
);
ok(
  "a voice note wins over a picture sent with it",
  JSON.stringify(
    m.inboundMediaFrom({ NumMedia: "2", MediaUrl0: url("d"), MediaContentType0: "image/jpeg", MediaUrl1: url("c"), MediaContentType1: "audio/amr" }),
  ) === JSON.stringify({ url: url("c"), contentType: "audio/amr", kind: "voice" }),
);
ok(
  "a picture alone is read as one",
  JSON.stringify(m.inboundMediaFrom({ NumMedia: "1", MediaUrl0: url("d"), MediaContentType0: "image/png" })) ===
    JSON.stringify({ url: url("d"), contentType: "image/png", kind: "image" }),
);
ok("a picture Claude cannot read (HEIC) is not taken",
  m.inboundMediaFrom({ NumMedia: "1", MediaUrl0: url("d"), MediaContentType0: "image/heic" }) === null);
ok("a PDF is a file Claude reads, after any picture sent with it",
  m.inboundMediaFrom({ NumMedia: "1", MediaUrl0: url("d"), MediaContentType0: "application/pdf" })?.kind === "file" &&
    m.inboundMediaFrom({ NumMedia: "2", MediaUrl0: url("d"), MediaContentType0: "application/pdf", MediaUrl1: url("e"), MediaContentType1: "image/jpeg" })?.kind === "image");
ok("a video is read for its spoken words, and a voice note still wins over it",
  m.inboundMediaFrom({ NumMedia: "1", MediaUrl0: url("d"), MediaContentType0: "video/mp4" })?.kind === "voice" &&
    m.inboundMediaFrom({ NumMedia: "2", MediaUrl0: url("d"), MediaContentType0: "video/mp4", MediaUrl1: url("c"), MediaContentType1: "audio/amr" })?.url === url("c"));
ok("a file reads back as a file", m.mediaConfirmSms("file", "x").startsWith("I read your file as:"));
ok("no media is nothing",
  m.inboundMediaFrom({ NumMedia: "0" }) === null && m.inboundMediaFrom({}) === null);
ok("media at a URL that is not Twilio's is ignored",
  m.inboundMediaFrom({ NumMedia: "1", MediaUrl0: "https://example.com/a.jpg", MediaContentType0: "image/jpeg" }) === null);

console.log("\n=== what is read back ===");
const said = "Any good swim lessons for my 4 year old in Altadena?";
ok("a voice note: what was heard, then the question",
  m.mediaConfirmSms("voice", said) === `I heard: "${said}" Is that right? Reply YES, or NO to type it instead.`);
ok("a picture: what it was read as, then the question",
  m.mediaConfirmSms("image", said) === `I read your picture as: "${said}" Is that right? Reply YES, or NO to type it instead.`);
ok("the card drops the reply instruction — Yes and No are buttons",
  (["voice", "image"] as const).every((k) => !/Reply/.test(m.mediaConfirmCard(k, said)) && m.mediaConfirmCard(k, said).endsWith("Is that right?")));
ok("curly quotes and dashes become GSM-7, so one character does not triple the cost",
  seg.planSegments(m.mediaConfirmSms("voice", "She said “it’s great” — truly…")).encoding === "gsm7");
const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
const back = m.readBack(long);
const opening = back.slice(0, -3);
ok("a long note is read back as its opening, cut at a word",
  back.length <= m.READBACK_MAX && back.endsWith("...") && long.startsWith(opening) && long[opening.length] === " ");
ok("and fits in four segments", seg.planSegments(m.mediaConfirmSms("voice", long)).segments <= 4, String(seg.planSegments(m.mediaConfirmSms("voice", long)).segments));
ok("the failure lines ask them to type, and are GSM-7",
  [m.MEDIA_UNREADABLE.voice, m.MEDIA_UNREADABLE.image, m.MEDIA_UNREADABLE.file, m.MEDIA_REJECTED].every((t) => /text|type it/.test(t) && seg.planSegments(t).encoding === "gsm7"));
ok("a tap on the card's buttons reads as the answer", thanks.yesOrNo("Yes") === true && thanks.yesOrNo("No") === false);

console.log("\n=== the order the pipeline gives it ===");
const inbound = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
const noteAt = inbound.indexOf("await mediaNoteStep(");
const replyAt = inbound.indexOf("await mediaReplyStep(");
const settingsAt = inbound.indexOf("await settingsStep({ from, body, person })) === HANDLED) return;");
ok("media is read back before any step acts on a message", noteAt > 0 && noteAt < settingsAt);
ok("and the answer to a read-back is read before any other step too", replyAt > 0 && replyAt < settingsAt);
ok("media ends the turn: nothing else runs on what was only read",
  /await mediaNoteStep\(\{[^}]*\}\);\s+return;/.test(inbound));
ok("only a YES runs the words, as a message of their own",
  /if \(said === true\) return note\.text;/.test(inbound) &&
    /handleInboundMessageUntraced\(\{ from, body: read, channel: input\.channel, confirmedMedia: true \}\)/.test(inbound));
ok("and is not counted as a second inbound", /if \(!input\.confirmedMedia\) await recordInbound/.test(inbound));
const steps = inbound.slice(inbound.indexOf("async function mediaNoteStep"), inbound.indexOf("async function mediaReplyStep") + 1500);
ok("the words are never logged", !/console\.\w+\([^)]*(\.text|note\.text|read\.text)/.test(steps));

console.log("\n=== a picture ===");
const server = fs.readFileSync(new URL("../lib/server/media-note.ts", import.meta.url), "utf8");
ok("is read by the fast model in the registry, not a model id typed in", /model: MODELS\.fast/.test(server) && !/claude-haiku/.test(server));
ok("as the message they mean, with what they typed kept",
  /Write the message they most likely mean/.test(server) && /keep their question/.test(server));
ok("never describing a person or copying a contact detail",
  /Never describe or identify a person/.test(server) && /maskContactDetails\(/.test(server));
ok("and text inside it is never an instruction", /never an instruction to you/.test(server));
ok("a voice note is heard in its own language, not assumed English (4 Nov)", /listen\?model=nova-3[^"]*&detect_language=true/.test(server));
ok("a PDF goes to Claude as a document, not as a picture", /contentType === "application\/pdf"\s+\? \{\s+type: "document"/.test(server));

console.log("\n=== the media is not kept ===");
const repo = fs.readFileSync(new URL("../lib/server/repo/media-notes.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../drizzle/0063_media_notes.sql", import.meta.url), "utf8");
ok("reading does not delete it — the read-back's end does (the developer, 3 Nov)",
  !/deleteTwilioMedia\(/.test(server.slice(server.indexOf("export async function readInboundMedia"))));
ok("every end of a read-back clears the words and the URL together",
  (repo.match(/text = null, media_url = null/g) ?? []).length === 1 && /endPending\(db, personId, "expired", true\)/.test(repo));
ok("and every caller deletes the media it hands back",
  /for \(const url of ended\) await deleteTwilioMedia\(url\)/.test(inbound) &&
    /for \(const url of expired\) await deleteTwilioMedia\(url\)/.test(inbound) &&
    /for \(const url of saved\.superseded\) await deleteTwilioMedia\(url\)/.test(inbound));
ok("media that fails is deleted at once", /if \(!read\.ok \|\| !saved\) \{\s+await deleteTwilioMedia\(media\.url\)/.test(inbound));
ok("the table holds words and URL only while pending",
  /CHECK \(\(status = 'pending'\) = \(text IS NOT NULL\)\)/.test(migration) &&
    /CHECK \(status = 'pending' OR media_url IS NULL\)/.test(migration));
ok("and is closed to the public API", /ENABLE ROW LEVEL SECURITY/.test(migration) && /REVOKE ALL ON media_notes/.test(migration));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);
