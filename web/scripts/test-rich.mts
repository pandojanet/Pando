/**
 * RCS quick-reply buttons — `lib/sms-rich.ts`, the card wording beside each SMS
 * text, and the parsers every button has to satisfy.
 *
 * What matters here are properties, not strings:
 *
 *  - **every button is an answer the existing parsers read** as what it stands
 *    for, both as its title (a tap may put the title in `Body`) and through
 *    `tapText` (a tap puts the id in `ButtonPayload`);
 *  - **a card says no more than its SMS**: shorter, without "Reply <WORD>", and
 *    keeping STOP and HELP wherever the SMS had them — the SMS texts are the
 *    registered copy, the card only drops what its buttons replace;
 *  - nothing reaches Twilio malformed: a SID that is not a SID, a text too long
 *    for its type.
 *
 * Expected values are literals, never computed by the code under test.
 */

import { readFileSync } from "node:fs";

const r = (await import(`../lib/sms-rich.ts?v=${Date.now()}`)) as typeof import("../lib/sms-rich.ts");
const policy = (await import(`../lib/outreach-policy.ts?v=${Date.now()}`)) as typeof import("../lib/outreach-policy.ts");
const thanks = (await import(`../lib/thanks.ts?v=${Date.now()}`)) as typeof import("../lib/thanks.ts");
const vouch = (await import(`../lib/vouch.ts?v=${Date.now()}`)) as typeof import("../lib/vouch.ts");
const tpl = (await import(`../lib/sms-templates.ts?v=${Date.now()}`)) as typeof import("../lib/sms-templates.ts");
const deep = (await import(`../lib/deep-dive.ts?v=${Date.now()}`)) as typeof import("../lib/deep-dive.ts");
const intro = (await import(`../lib/introductions.ts?v=${Date.now()}`)) as typeof import("../lib/introductions.ts");
const capture = (await import(`../lib/capture.ts?v=${Date.now()}`)) as typeof import("../lib/capture.ts");
const onboarding = (await import(`../lib/onboarding.ts?v=${Date.now()}`)) as typeof import("../lib/onboarding.ts");
const delivery = (await import(`../lib/delivery.ts?v=${Date.now()}`)) as typeof import("../lib/delivery.ts");

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

const SID = "HX0123456789abcdef0123456789abcdef";

console.log("\n=== off unless an operator switched it on ===");
ok("unset is off", r.richContentSid("yes_no", {}) === null);
ok("empty is off", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: "" }) === null);
ok("a label pasted by mistake is off", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: "yes_no template" }) === null);
ok("a SID one digit short is off", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: SID.slice(0, -1) }) === null);
ok("another resource's SID is off", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: "SM" + SID.slice(2) }) === null);
ok("a valid SID is read, trimmed", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: `  ${SID}\n` }) === SID);
ok(
  "each kind reads only its own variable",
  r.richContentSid("pass", { TWILIO_RCS_CONTENT_SID_YES_NO: SID }) === null &&
    r.richContentSid("pass", { TWILIO_RCS_CONTENT_SID_PASS: SID }) === SID,
);
ok(
  "the two names already on the server are kept",
  r.RICH_ENV.yes_no === "TWILIO_RCS_CONTENT_SID_YES_NO" && r.RICH_ENV.settings_allowance === "TWILIO_RCS_CONTENT_SID_SETTINGS",
);
const envNames = Object.values(r.RICH_ENV);
ok("every kind has its own variable", new Set(envNames).size === envNames.length && envNames.length === 9);
ok("every variable is a TWILIO_RCS_CONTENT_SID_ name", envNames.every((n) => /^TWILIO_RCS_CONTENT_SID_[A-Z_]+$/.test(n)));

console.log("\n=== the two variables ===");
ok("card is {{1}}, SMS is {{2}}", r.richVariables("Card", "SMS") === '{"1":"Card","2":"SMS"}');
ok("quotes and newlines survive", JSON.parse(r.richVariables('Say "hi"\nnow', "x") ?? "{}")["1"] === 'Say "hi"\nnow');
ok("an empty card is not sent", r.richVariables("", "SMS") === null);
ok("an empty SMS is not sent", r.richVariables("Card", "") === null);
ok("1600 characters fit both", r.richVariables("a".repeat(1600), "b".repeat(1600)) !== null);
ok("a 1601-character card goes as plain text", r.richVariables("a".repeat(1601), "b") === null);
ok("a 1601-character SMS goes as plain text", r.richVariables("a", "b".repeat(1601)) === null);

console.log("\n=== the buttons fit Twilio's limits ===");
for (const kind of r.RICH_KINDS) {
  const buttons = r.RICH_BUTTONS[kind];
  ok(`${kind}: 1 to ${r.RICH_BUTTONS_MAX} buttons`, buttons.length >= 1 && buttons.length <= r.RICH_BUTTONS_MAX);
  ok(`${kind}: titles at most ${r.RICH_BUTTON_TITLE_MAX} characters`, buttons.every((x) => x.title.length <= r.RICH_BUTTON_TITLE_MAX));
  ok(`${kind}: ids are distinct, lower-case words`, new Set(buttons.map((x) => x.id)).size === buttons.length && buttons.every((x) => /^[a-z0-9_]+$/.test(x.id)));
}
/* The buttons, written out by hand: what the operator types into each template. */
const TITLES: Record<string, string[]> = {
  yes_no: ["Yes", "No"],
  pass: ["Pass"],
  deep_offer: ["Deep dive"],
  intro_offer: ["Intro"],
  settings_allowance: ["5 a month", "10 a month", "As relevant"],
  capture_kind: ["Activity or class", "Place", "Doctor or specialist", "Caregiver", "Something else"],
  capture_firsthand: ["Used", "Heard"],
  capture_recommend: ["Yes", "Yes but", "No"],
  skip: ["Skip"],
};
ok("exactly the nine kinds the runbook lists", JSON.stringify([...r.RICH_KINDS].sort()) === JSON.stringify(Object.keys(TITLES).sort()));
for (const kind of r.RICH_KINDS) {
  ok(`${kind}: the titles are ${TITLES[kind]?.join(", ")}`, JSON.stringify(r.RICH_BUTTONS[kind].map((x) => x.title)) === JSON.stringify(TITLES[kind]));
}
ok("no Pass under the freshness ping (it would release an open Network Ask)", !r.RICH_BUTTONS.yes_no.some((x) => x.id === "pass"));
const titleById = new Map<string, Set<string>>();
for (const kind of r.RICH_KINDS) for (const x of r.RICH_BUTTONS[kind]) titleById.set(x.id, (titleById.get(x.id) ?? new Set()).add(x.title));
ok("one id means one word in every kind", [...titleById.values()].every((titles) => titles.size === 1));

console.log("\n=== every button is an answer, by its title and by its id ===");
/* What each button must be read as, written out by hand. */
const meaning: Record<string, (text: string) => unknown> = {
  /* Read as a yes/no by "did it help?" and the Network Ask, and by the freshness ping. */
  yes_no: (t) => `${thanks.yesOrNo(t)}/${vouch.readPingReply(t)}`,
  pass: (t) => tpl.keywordOf(t),
  deep_offer: (t) => deep.acceptsDeepDive(t),
  intro_offer: (t) => intro.acceptsIntro(t),
  settings_allowance: (t) => JSON.stringify(policy.parseAllowanceChoice(t)),
  /* The Caregiver button is not an option: the word is read as a caregiver and handed on (five categories, 29 Oct). */
  capture_kind: (t) => (capture.mentionsCaregiver(t) ? "caregiver: handed on" : JSON.stringify(capture.readAnswer("kind", t))),
  capture_firsthand: (t) => JSON.stringify(capture.readAnswer("firsthand", t)),
  capture_recommend: (t) => JSON.stringify(capture.readAnswer("recommend", t)),
  skip: (t) => JSON.stringify(capture.readAnswer("detail", t)),
};
const expected: Record<string, unknown[]> = {
  yes_no: ["true/still_good", "false/no_longer"],
  pass: ["pass"],
  deep_offer: [true],
  intro_offer: [true],
  settings_allowance: [
    '{"allowance":5,"mode":"fixed"}',
    '{"allowance":10,"mode":"fixed"}',
    '{"allowance":null,"mode":"as_relevant"}',
  ],
  capture_kind: [
    '{"ok":true,"value":"activity"}',
    '{"ok":true,"value":"place"}',
    '{"ok":true,"value":"doctor"}',
    "caregiver: handed on",
    '{"ok":true,"value":"tip"}',
  ],
  capture_firsthand: ['{"ok":true,"value":"yes"}', '{"ok":true,"value":"no"}'],
  capture_recommend: ['{"ok":true,"value":"yes"}', '{"ok":true,"value":"yes_with_caveats"}', '{"ok":true,"value":"no"}'],
  skip: ['{"ok":true,"skipped":true}'],
};
for (const kind of r.RICH_KINDS) {
  r.RICH_BUTTONS[kind].forEach((button, i) => {
    const byTitle = meaning[kind](button.title);
    const byTap = meaning[kind](r.tapText({ body: "", buttonPayload: button.id }));
    ok(`${kind} "${button.title}" reads as ${String(expected[kind][i])}`, byTitle === expected[kind][i], `got ${String(byTitle)}`);
    ok(`${kind} "${button.title}" reads the same from its id`, byTap === expected[kind][i], `got ${String(byTap)}`);
  });
}

console.log("\n=== a tap, as the webhook receives it ===");
ok("a known id fills an empty Body", r.tapText({ body: "", buttonPayload: "yes_but" }) === "Yes but");
ok("a known id confirms its own title in Body, whatever the case", r.tapText({ body: " yes BUT ", buttonPayload: "yes_but" }) === "Yes but");
ok("words the person sent are never replaced by a payload", r.tapText({ body: "STOP", buttonPayload: "yes" }) === "STOP");
ok("nor is a different answer", r.tapText({ body: "No", buttonPayload: "yes" }) === "No");
ok("an id with stray spaces is still known", r.tapText({ body: "", buttonPayload: " 10_a_month " }) === "10 a month");
ok("an unknown id leaves Body alone", r.tapText({ body: "hello", buttonPayload: "something_else" }) === "hello");
ok("no payload leaves Body alone", r.tapText({ body: "3 and 7" }) === "3 and 7");
ok("an empty payload leaves Body alone", r.tapText({ body: "STOP", buttonPayload: "" }) === "STOP");

console.log("\n=== when an answer carries the Network Ask buttons ===");
const offerText = "Here is what I found.\nWant me to ask a few nearby parents for more?";
ok("offer_blast and the offer in the text: Yes / No", r.askOfferRich("offer_blast", offerText)?.kind === "yes_no");
ok("offer_blast but the rewrite lost the offer: none", r.askOfferRich("offer_blast", "Here is what I found.") === undefined);
ok("the offer's words without the offer stored: none", r.askOfferRich("none", offerText) === undefined);
ok("no next step read: none", r.askOfferRich(null, offerText) === undefined);

console.log("\n=== which ADD steps carry buttons ===");
ok("kind → capture_kind", r.captureStepRich("kind", capture.CAPTURE_QUESTIONS.kind.card)?.kind === "capture_kind");
ok("firsthand → capture_firsthand", r.captureStepRich("firsthand", capture.CAPTURE_QUESTIONS.firsthand.card)?.kind === "capture_firsthand");
ok("recommend → capture_recommend", r.captureStepRich("recommend", capture.CAPTURE_QUESTIONS.recommend.card)?.kind === "capture_recommend");
ok("detail → skip", r.captureStepRich("detail", capture.CAPTURE_QUESTIONS.detail.card)?.kind === "skip");
ok("name is typed: none", r.captureStepRich("name", capture.CAPTURE_QUESTIONS.name.card) === undefined);
ok("a step without card text: none", r.captureStepRich("kind", undefined) === undefined);

console.log("\n=== the card wording, as the client will read it ===");
const fixed5 = { monthly_contact_allowance: 5, allowance_mode: "fixed" } as never;
ok(
  "SETTINGS asks instead of listing digits",
  policy.settingsPromptCard(fixed5) ===
    "Right now Pando may ask you up to 5 questions a month. How many would you like? As relevant means up to 3 a week. However you set it, you'll never get two requests within 48 hours.",
);
ok(
  "deep-dive offer without Reply DEEP",
  deep.deepDiveOfferCard(true) ===
    "Want a deep dive? I'll rank these for your family with what local parents said, what's online and rough drive times.",
);
ok(
  "intro offer without Reply INTRO",
  intro.introOfferCard("Little Maestros", 1) ===
    "By the way, a parent Pando knows has used Little Maestros. Want an introduction? Someone at Pando will ask them first.",
);
ok(
  "did it help, without Reply YES or NO",
  tpl.thanksPromptCard() ===
    "Pando: a few days ago we sent you a recommendation from a local parent. Did it help? A yes lets us thank whoever shared it. Reply STOP to opt out, HELP for help.",
);
ok(
  "freshness ping without Reply YES, NO, or PASS",
  tpl.freshnessPingCard({ name: "Kidspace" }) ===
    "Pando: quick one - is Kidspace still worth recommending to other parents? Reply STOP to opt out, HELP for help.",
);
ok(
  "Network Ask request without PASS to skip",
  tpl.blastRequestCard({ question: "Any swim classes?", because: "you live nearby" }) ===
    'Pando: a parent nearby asked — "Any swim classes?" We thought of you (you live nearby). Reply with anything useful. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
);
ok(
  "recommend keeps what 'Yes but' means",
  capture.CAPTURE_QUESTIONS.recommend.card === "Pando: would you recommend it to another parent? Yes but means there's a catch.",
);
ok("the deep-dive ask footer, as a card", deep.DEEP_ASK_FOOTER_CARD === "Want me to ask nearby parents about these?");
ok(
  "participation: only the question's own wording changes, wherever it rides",
  onboarding.participationCard(`Here you go.\n\n${onboarding.CLARIFYING_COPY.participation}`) ===
    "Here you go.\n\nLast thing: how many questions from nearby parents could Pando send you? As relevant means up to 3 a week.",
);
ok("participation: a message that does not ask it has no card", onboarding.participationCard(onboarding.CLARIFYING_COPY.child_age) === null);

console.log("\n=== a card never says more than its SMS ===");
const pairs: Array<[string, string, string]> = [
  ["SETTINGS", policy.settingsPrompt(fixed5), policy.settingsPromptCard(fixed5)],
  ["deep offer (parents)", deep.deepDiveOffer(true), deep.deepDiveOfferCard(true)],
  ["deep offer (web)", deep.deepDiveOffer(false), deep.deepDiveOfferCard(false)],
  ["intro offer", intro.introOffer("Kidspace", 2), intro.introOfferCard("Kidspace", 2)],
  ["did it help", tpl.thanksPromptSms(), tpl.thanksPromptCard()],
  ["freshness", tpl.freshnessPingSms({ name: "A rather long place name for a ping" }), tpl.freshnessPingCard({ name: "A rather long place name for a ping" })],
  ["Network Ask", tpl.blastRequestSms({ question: "Q?", because: "b" }), tpl.blastRequestCard({ question: "Q?", because: "b" })],
  ["deep footer", deep.DEEP_ASK_FOOTER, deep.DEEP_ASK_FOOTER_CARD],
  ["participation", onboarding.CLARIFYING_COPY.participation, onboarding.PARTICIPATION_CARD],
  ...(["kind", "firsthand", "recommend", "detail"] as const).map(
    (s) => [`ADD ${s}`, capture.CAPTURE_QUESTIONS[s].prompt, capture.CAPTURE_QUESTIONS[s].card ?? ""] as [string, string, string],
  ),
];
const FOOTER = "Reply STOP to opt out, HELP for help.";
for (const [label, sms, card] of pairs) {
  const instructions = card.replace(FOOTER, "").match(/\bReply (?!with\b)[A-Z0-9]/g);
  ok(`${label}: shorter than its SMS`, card.length > 0 && card.length < sms.length, `${card.length} vs ${sms.length}`);
  ok(`${label}: no "Reply <WORD>" left`, instructions === null, String(instructions));
  ok(`${label}: STOP and HELP kept where the SMS has them`, !sms.includes(FOOTER) || card.includes(FOOTER));
  ok(`${label}: starts the way its SMS does`, sms.startsWith(card.slice(0, 20)));
  /* Review, 29 Oct: the first card dropped "3 for up to 3 a week" with its digits,
     and with it the only place the "As relevant" limit was stated. */
  ok(`${label}: a limit the SMS states, the card states too`, !/\b\d+ a week\b/.test(sms) || /\b\d+ a week\b/.test(card));
}
ok("ADD name has no card", capture.CAPTURE_QUESTIONS.name.card === undefined);

console.log("\n=== the template an operator creates ===");
for (const kind of r.RICH_KINDS) {
  const t = r.contentTemplateDefinition(kind);
  ok(`${kind}: card is {{1}}, text is {{2}}`, t.types["twilio/card"].body === "{{1}}" && t.types["twilio/text"].body === "{{2}}");
  ok(`${kind}: both variables have a sample`, Object.keys(t.variables).join() === "1,2");
  ok(
    `${kind}: one quick reply per button, in order`,
    t.types["twilio/card"].actions.every((a) => a.type === "QUICK_REPLY") &&
      JSON.stringify(t.types["twilio/card"].actions.map((a) => a.title)) === JSON.stringify(TITLES[kind]),
  );
  ok(`${kind}: named pando_${kind}`, t.friendly_name === `pando_${kind}`);
}
ok(
  "the ids the operator types, for two kinds written out",
  JSON.stringify(r.contentTemplateDefinition("settings_allowance").types["twilio/card"].actions.map((a) => a.id)) ===
    '["5_a_month","10_a_month","as_relevant"]' &&
    JSON.stringify(r.contentTemplateDefinition("capture_recommend").types["twilio/card"].actions.map((a) => a.id)) === '["yes","yes_but","no"]',
);

console.log("\n=== the card's formatting: seen, never changed ===");
/* What a reader of the card sees, written out. Tested on a phone, 29 Oct: these letters show bold. */
ok("a section label is bold", r.cardFormat("Heads up: the parking fills up.") === "𝗛𝗲𝗮𝗱𝘀 𝘂𝗽: the parking fills up.");
ok("a list line gets a bullet", r.cardFormat("- About 12 min away") === "• About 12 min away");
const italic = r.cardFormat("Drive times are rough estimates.");
ok(
  "the drive-time note is italic, letters only",
  [...italic].filter((ch) => /\p{L}/u.test(ch)).every((ch) => (ch.codePointAt(0) ?? 0) >= 0x1d608 && (ch.codePointAt(0) ?? 0) <= 0x1d63b) &&
    italic.endsWith("."),
);
const report = [
  "1) Rose Bowl Aquatics, Pasadena (about 12 min)",
  "2 parents near you have used it, last confirmed Sep 2026.",
  'Maria said: "My take: book early, it fills up."',
  "Good for: toddlers who are nervous in water.",
  "Heads up: the parking fills up on Saturdays.",
  "Site: https://www.example.com/swim",
  "- Saturday mornings",
  "Public/general information:",
  "Also worth a look (Public/general information): Pasadena Aquatics.",
  "My take: start with Rose Bowl.",
  "We liked it. Heads up: it is busy.",
  "Drive times are rough estimates.",
  "Want me to ask nearby parents about these?",
  "Reply STOP to opt out, HELP for help.",
].join("\n");
const formatted = r.cardFormat(report);
const lines = formatted.split("\n");
ok(
  "under NFKC the card is the unformatted text again (with • for -)",
  formatted.normalize("NFKC").replace(/^• /gm, "- ") === report,
);
ok("a name is never formatted", lines[0] === "1) Rose Bowl Aquatics, Pasadena (about 12 min)");
ok("a parent's words are never formatted, even with a label inside", lines[2] === 'Maria said: "My take: book early, it fills up."');
ok("a site's address stays as typed", lines[5].endsWith(": https://www.example.com/swim") && lines[5] !== "Site: https://www.example.com/swim");
ok("a trust label stays verbatim (invariant 3)", lines[7] === "Public/general information:" && lines[8] === "Also worth a look (Public/general information): Pasadena Aquatics.");
ok("a label inside a sentence is left alone", lines[10] === "We liked it. Heads up: it is busy.");
ok("STOP and HELP stay as typed", lines[13] === "Reply STOP to opt out, HELP for help.");
ok("formatting twice changes nothing more", r.cardFormat(formatted) === formatted);
const sources = ["../lib/answer.ts", "../lib/deep-dive.ts"].map((p) => readFileSync(new URL(p, import.meta.url), "utf8")).join("\n");
for (const label of r.CARD_BOLD_LABELS) {
  ok(`"${label}" is a label the answers or the deep dive really write`, sources.includes(label));
}
for (const note of r.CARD_ITALIC_NOTES) ok(`"${note}" is a note the deep dive really writes`, sources.includes(note));

console.log("\n=== a read RCS message counts as delivered ===");
ok("read is terminal", delivery.TERMINAL_STATUSES.includes("read"));
ok("read and delivered are the delivered ones", JSON.stringify(delivery.DELIVERED_STATUSES) === '["delivered","read"]');
ok("sent and queued are still in flight", !delivery.TERMINAL_STATUSES.includes("sent") && !delivery.TERMINAL_STATUSES.includes("queued"));

console.log("\n=== \"Pando is typing…\" on RCS (lib/rcs-typing.ts) ===");
{
  const typing = (await import(`../lib/rcs-typing.ts?v=${Date.now()}`)) as typeof import("../lib/rcs-typing.ts");
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const P = "+16265550001";
  /* Short timings: dots after 20 ms, again every 60 ms, for at most 300 ms (requests
     near 20, 80, 140, 200, 260). Windows timers run ~15 ms late, hence the margins. */
  const rig = (opts: { refuse?: boolean; optedOut?: boolean } = {}) => {
    const posts: string[] = [];
    const state = { optedOut: opts.optedOut === true };
    const t = typing.createTyping({
      post: async (to) => { posts.push(to); return !opts.refuse; },
      isOptedOut: async () => state.optedOut,
      delayMs: 20,
      repeatMs: 60,
      maxMs: 300,
    });
    return { t, posts, state };
  };

  {
    const { t, posts } = rig();
    const end = t.begin(P);
    await wait(5);
    ok("no dots at once: a quick reply never shows them", posts.length === 0);
    await wait(30);
    ok("dots once the reply takes longer, to that number", posts.length === 1 && posts[0] === P, String(posts.length));
    await wait(60);
    ok("and again before Twilio's 20 seconds run out", posts.length === 2, String(posts.length));
    t.stop(P);
    const sent = posts.length;
    await wait(80);
    ok("a message to the number stops them, and nothing follows it", posts.length === sent && t.active() === 0);
    end();
  }
  {
    const { t, posts } = rig();
    const end = t.begin(P);
    await wait(5);
    t.stop(P);
    await wait(60);
    ok("a reply sent within the delay: no dots at all", posts.length === 0);
    end();
  }
  {
    const { t, posts } = rig();
    t.begin(P);
    await wait(600);
    ok("bounded: the loop ends by itself after its maximum", t.active() === 0 && posts.length >= 3 && posts.length <= 5, String(posts.length));
  }
  {
    const { t, posts, state } = rig();
    t.begin(P);
    await wait(40);
    state.optedOut = true; /* STOP through another webhook, mid-answer */
    await wait(120);
    ok("a STOP that arrives mid-answer ends the dots at the next renewal", posts.length === 1 && t.active() === 0, String(posts.length));
  }
  {
    const { t, posts } = rig({ optedOut: true });
    t.begin(P);
    await wait(60);
    ok("a number that opted out is shown nothing", posts.length === 0 && t.active() === 0);
  }
  {
    const { t, posts } = rig({ refuse: true });
    t.begin(P);
    await wait(120);
    ok("a refused request ends the loop, no retrying", posts.length === 1 && t.active() === 0, String(posts.length));
  }
  {
    const { t, posts } = rig();
    t.resume(P);
    await wait(60);
    ok("no session, no dots: resume alone shows nothing (nothing proactive)", posts.length === 0);
    const end = t.begin(P);
    t.stop(P); /* "On it" went */
    t.resume(P, 1000); /* the deep dive */
    await wait(40);
    ok("inside a session, the deep dive shows them again after its first message", posts.length === 1, String(posts.length));
    end();
    await wait(60);
    ok("the end of the answer stops them", posts.length === 1 && t.active() === 0, String(posts.length));
  }
  {
    const { t, posts } = rig();
    const endA = t.begin(P);
    const endB = t.begin(P);
    endA();
    t.resume(P);
    await wait(40);
    ok("two texts from one phone: the first one ending leaves the second's session", posts.length === 1, String(posts.length));
    endB();
    endB();
    ok("and ending twice is harmless", t.active() === 0);
  }

  ok("ChannelMetadata of type rcs is RCS", typing.inboundChannel('{"type":"rcs","data":{"context":{}}}') === "rcs");
  ok("missing, other or unreadable ChannelMetadata is SMS", typing.inboundChannel(undefined) === "sms" && typing.inboundChannel("") === "sms" && typing.inboundChannel('{"type":"whatsapp"}') === "sms" && typing.inboundChannel("{not json") === "sms" && typing.inboundChannel("null") === "sms");
  ok("the sender id, as the Console shows it, with or without rcs:", typing.rcsSenderId("rcs:pando_ab12_agent") === "pando_ab12_agent" && typing.rcsSenderId(" pando_ab12_agent ") === "pando_ab12_agent");
  ok("unset or malformed: no sender, so no indicator", typing.rcsSenderId(undefined) === null && typing.rcsSenderId("") === null && typing.rcsSenderId("pando agent") === null && typing.rcsSenderId("rcs:") === null);
  ok(
    "the request is the one Twilio documents",
    JSON.stringify(typing.typingRequest("pando_ab12_agent", P)) === '{"channel":"RCS","from":"rcs:pando_ab12_agent","to":"rcs:+16265550001","event":"START"}',
  );
  ok("timings: dots after 1.5 s, renewed every 15 s (Twilio shows 20), 90 s for an answer, 10 min for a deep dive", typing.TYPING_DELAY_MS === 1500 && typing.TYPING_REPEAT_MS === 15000 && typing.TYPING_MAX_MS === 90000 && typing.TYPING_DEEP_MAX_MS === 600000);

  /* The wiring, read from the source: these are the lines that keep it honest. */
  const smsSrc = readFileSync(new URL("../lib/server/sms.ts", import.meta.url), "utf8");
  const untraced = smsSrc.slice(smsSrc.indexOf("async function sendSmsUntraced"));
  ok("every send stops the dots before anything else, even one that is then refused", untraced.indexOf("typing.stop(to)") > 0 && untraced.indexOf("typing.stop(to)") < untraced.indexOf("isOptedOut(to)"));
  ok("the request goes from sms.ts and nowhere else", !readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8").includes("Indicators/Typing") && smsSrc.includes("/v3/Indicators/Typing.json"));
  ok("off without a sender id and on the relay", /typingAvailable\(\)[\s\S]{0,40}\{\s*return rcsSenderId\(process\.env\.TWILIO_RCS_SENDER_ID\) !== null && isSmsProvisioned\(\) && !isSlackRelayEnabled\(\)/.test(smsSrc));
  const inboundSrc = readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  ok("only for an ordinary text that came over RCS — never a keyword", inboundSrc.includes('input.channel === "rcs" && keywordOf(input.body) === null ? startTyping(input.from) : null'));
  const routeSrc = readFileSync(new URL("../app/api/sms/inbound/route.ts", import.meta.url), "utf8");
  ok("the webhook reads the channel from ChannelMetadata and passes it on", routeSrc.includes("inboundChannel(params.ChannelMetadata)") && routeSrc.includes("handleInboundMessage({ from, body, channel })"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
