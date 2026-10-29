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
  capture_kind: ["Class", "Camp", "Place", "Tip"],
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
  capture_kind: (t) => JSON.stringify(capture.readAnswer("kind", t)),
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
  capture_kind: ['{"ok":true,"value":"activity"}', '{"ok":true,"value":"activity"}', '{"ok":true,"value":"place"}', '{"ok":true,"value":"tip"}'],
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

console.log("\n=== a read RCS message counts as delivered ===");
ok("read is terminal", delivery.TERMINAL_STATUSES.includes("read"));
ok("read and delivered are the delivered ones", JSON.stringify(delivery.DELIVERED_STATUSES) === '["delivered","read"]');
ok("sent and queued are still in flight", !delivery.TERMINAL_STATUSES.includes("sent") && !delivery.TERMINAL_STATUSES.includes("queued"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
