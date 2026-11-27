/**
 * Twilio's record of the messages, summed for `messages_summary` (27 Nov): statuses, channels, errors,
 * days and templates, where Twilio and Pando's log disagree — and that no phone number or text gets out.
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
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const m = (await import(`../lib/messages-summary.ts?v=${Date.now()}`)) as typeof import("../lib/messages-summary.ts");

const sid = (n: number, p = "SM") => `${p}${String(n).padStart(32, "0")}`;
const msg = (o: Partial<import("../lib/messages-summary.ts").TwilioMessage> & { sid: string }) => ({
  status: "delivered", error_code: null, direction: "outbound-api", from: null, num_segments: "1", num_media: "0",
  price: "-0.0079", price_unit: "USD", date_created: "Mon, 24 Nov 2026 20:28:20 +0000", ...o,
});
const twilio = [
  msg({ sid: sid(1) }),
  msg({ sid: sid(2, "MM"), from: "rcs:", status: "read", num_segments: "6", price: "-0.03" }),
  msg({ sid: sid(3, "MM"), status: "failed", error_code: 19023, price: null }),
  msg({ sid: sid(4), status: "undelivered", error_code: 30007 }),
  msg({ sid: sid(5), status: "sent" }),
  msg({ sid: sid(6), direction: "inbound", status: "received" }),
  msg({ sid: sid(7), num_media: "1", date_created: "Tue, 25 Nov 2026 09:00:00 +0000" }),
  msg({ sid: sid(8), status: "delivered" }),
];
const pando = [
  { sid: sid(1), template: "answer_sent", category: "transactional", status: "delivered", error_code: null },
  { sid: sid(2, "MM"), template: "answer_sent", category: "transactional", status: "read", error_code: null },
  { sid: sid(3, "MM"), template: "answer_sent", category: "transactional", status: null, error_code: null },
  { sid: sid(4), template: "weekly_digest", category: "digest", status: "undelivered", error_code: 30007 },
  { sid: sid(5), template: "clarify_child_age", category: "transactional", status: null, error_code: null },
  { sid: sid(7), template: "image_confirm", category: "transactional", status: "delivered", error_code: null },
];
const s = m.summarizeMessages({ twilio, pando, titles: { 30007: "Carrier filtered the message" }, day: (iso) => new Date(iso).toISOString().slice(0, 10) });

console.log("\ncounts");
ok("messages, inbound and outbound", s.messages === 8 && s.inbound === 1 && s.outbound === 7);
ok("outbound by status", s.outbound_by_status.delivered === 3 && s.outbound_by_status.read === 1 && s.outbound_by_status.failed === 1 && s.outbound_by_status.undelivered === 1 && s.outbound_by_status.sent === 1, JSON.stringify(s.outbound_by_status));
ok("by channel: RCS from the rcs: prefix, MMS from media, the rest SMS", s.outbound_by_channel.rcs === 1 && s.outbound_by_channel.mms === 1 && s.outbound_by_channel.sms === 5, JSON.stringify(s.outbound_by_channel));
ok("delivery rate over final statuses only (4 of 6; 'sent' is not final)", s.delivery_rate === 0.667, String(s.delivery_rate));
ok("segments summed, inbound included", s.segments === 13, String(s.segments));
ok("price: a missing price is not zero cost, the sign dropped", s.price.total === 0.08 && s.price.currency === "USD", JSON.stringify(s.price));

console.log("\nerrors");
ok("each code once, with a known title or a plain one, its docs and an example SID",
  s.errors.length === 2 && s.errors.some((e) => e.code === 19023 && e.title === "Twilio error 19023" && e.docs.endsWith("/19023") && e.example_sids[0] === sid(3, "MM")) &&
    s.errors.some((e) => e.code === 30007 && e.title === "Carrier filtered the message"), JSON.stringify(s.errors));

console.log("\nPando's log beside Twilio's");
ok("the 24 Nov hole: Twilio failed it, Pando holds no status — out of step",
  s.pando_out_of_step.examples.some((x) => x.sid === sid(3, "MM") && x.twilio === "failed" && x.pando === null && x.error_code === 19023 && x.template === "answer_sent"), JSON.stringify(s.pando_out_of_step));
ok("not final in Twilio ('sent') is not out of step, and a matching status is not", s.pando_out_of_step.count === 1);
ok("outbound with no row in Pando's log: not sent by Pando", s.not_sent_by_pando.count === 1 && s.not_sent_by_pando.example_sids[0] === sid(8));
ok("by template, from Pando's log", s.by_template.find((t) => t.template === "answer_sent")?.outbound === 3 && s.by_template.find((t) => t.template === "answer_sent")?.failed === 1);
ok("by day", s.by_day.length === 2 && s.by_day[0].day === "2026-11-24" && s.by_day[0].inbound === 1 && s.by_day[1].outbound === 1, JSON.stringify(s.by_day));
ok("nothing at all: zeros and a null rate", (() => { const z = m.summarizeMessages({ twilio: [], pando: [], titles: {}, day: (x) => x }); return z.messages === 0 && z.delivery_rate === null && z.errors.length === 0; })());

console.log("\nno phone, no text");
const leaky = [msg({ sid: sid(9), from: "+16265550142", status: "failed", error_code: 30003, ...({ to: "+16265550100", body: "Hi Dana, Elena can sit Friday" } as object) })];
const out = JSON.stringify(m.summarizeMessages({ twilio: leaky, pando: [], titles: {}, day: (x) => x }));
ok("a message's number, recipient and text never reach the summary", !/\+1\d{10}|Dana|Elena/.test(out), out.slice(0, 200));
const server = read("lib/server/mcp/messages.ts");
ok("the Twilio read keeps only the channel prefix of `from`, and never reads `to` or `body`",
  /from: typeof m\.from === "string" \? \(\/\^\(rcs\|whatsapp\):\/i\.exec\(m\.from\)/.test(server) && !/m\.to\b|m\.body\b/.test(server));
ok("GET only: no method, no POST to Twilio", !/method:\s*"(POST|DELETE|PUT|PATCH)"/.test(server));
ok("a SID fetched one by one is checked before it goes in the path", /\^\(SM\|MM\)\[0-9a-f\]\{32\}\$/.test(server));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
