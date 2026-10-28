/**
 * RCS quick-reply buttons (29 Oct) — `lib/sms-rich.ts` and the parsers its titles
 * have to satisfy.
 *
 * What matters here is a property, not a string: **a button title is something
 * the existing parsers read as the answer it stands for**. A tap may reach the
 * inbound webhook as its title, so a title that stops parsing is a button that
 * answers nothing. The checks below fail on that, and on the two ways the
 * feature could break a message — a malformed SID reaching Twilio, and a body too
 * long for a card.
 */

const r = (await import(`../lib/sms-rich.ts?v=${Date.now()}`)) as typeof import("../lib/sms-rich.ts");
const policy = (await import(`../lib/outreach-policy.ts?v=${Date.now()}`)) as typeof import("../lib/outreach-policy.ts");
const thanks = (await import(`../lib/thanks.ts?v=${Date.now()}`)) as typeof import("../lib/thanks.ts");

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
ok("a WhatsApp-style SID prefix is off", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: "SM" + SID.slice(2) }) === null);
ok("a valid SID is read", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: SID }) === SID);
ok("surrounding spaces are trimmed", r.richContentSid("yes_no", { TWILIO_RCS_CONTENT_SID_YES_NO: `  ${SID}\n` }) === SID);
ok(
  "each kind reads its own variable",
  r.richContentSid("settings_allowance", { TWILIO_RCS_CONTENT_SID_YES_NO: SID }) === null &&
    r.richContentSid("settings_allowance", { TWILIO_RCS_CONTENT_SID_SETTINGS: SID }) === SID,
);

console.log("\n=== the variable ===");
ok("the body is variable 1, as JSON", r.richVariables("Hi there") === '{"1":"Hi there"}');
ok("quotes and newlines survive as JSON", JSON.parse(r.richVariables('Say "hi"\nthen go') ?? "{}")["1"] === 'Say "hi"\nthen go');
ok("an empty body is not sent as a card", r.richVariables("") === null);
ok("1600 characters fit a card", r.richVariables("a".repeat(1600)) !== null);
ok("1601 characters go as plain text instead", r.richVariables("a".repeat(1601)) === null);

console.log("\n=== every title is an answer the parsers already read ===");
for (const title of r.RICH_BUTTONS.yes_no) {
  ok(`"${title}" is read by yesOrNo`, thanks.yesOrNo(title) === (title === "Yes"));
}
const expected: Record<string, { allowance: number | null; mode: "fixed" | "as_relevant" }> = {
  "5 a month": { allowance: 5, mode: "fixed" },
  "10 a month": { allowance: 10, mode: "fixed" },
  "As relevant": { allowance: null, mode: "as_relevant" },
};
for (const title of r.RICH_BUTTONS.settings_allowance) {
  const got = policy.parseAllowanceChoice(title);
  ok(
    `"${title}" is read by parseAllowanceChoice as ${JSON.stringify(expected[title])}`,
    JSON.stringify(got) === JSON.stringify(expected[title]),
    `got ${JSON.stringify(got)}`,
  );
}
ok("the settings titles are exactly the three the test knows", r.RICH_BUTTONS.settings_allowance.length === Object.keys(expected).length);

console.log("\n=== the parser change did not move the old words ===");
const old: Array<[string, number | null, string]> = [
  ["1", 5, "fixed"],
  ["five", 5, "fixed"],
  ["2", 10, "fixed"],
  ["Ten.", 10, "fixed"],
  ["3", null, "as_relevant"],
  ["anytime", null, "as_relevant"],
];
for (const [text, allowance, mode] of old) {
  const got = policy.parseAllowanceChoice(text);
  ok(`"${text}" still reads as ${mode}${allowance === null ? "" : " " + allowance}`, got?.allowance === allowance && got?.mode === mode);
}
ok("a number that is a child's age is still not a choice", policy.parseAllowanceChoice("4") === null);
ok("prose is not a choice", policy.parseAllowanceChoice("5 a month would be too many") === null);

console.log("\n=== the limits Twilio documents ===");
for (const [kind, titles] of Object.entries(r.RICH_BUTTONS)) {
  ok(`${kind}: every title is at most ${r.RICH_BUTTON_TITLE_MAX} characters`, titles.every((t) => t.length <= r.RICH_BUTTON_TITLE_MAX));
  ok(`${kind}: at most 11 buttons`, titles.length >= 1 && titles.length <= 11);
}

console.log("\n=== the template an operator creates ===");
for (const kind of Object.keys(r.RICH_BUTTONS) as Array<keyof typeof r.RICH_BUTTONS>) {
  const t = r.contentTemplateDefinition(kind);
  ok(`${kind}: has a twilio/text, the SMS a phone without RCS receives`, t.types["twilio/text"].body === "{{1}}");
  ok(`${kind}: the card's body is the same variable`, t.types["twilio/card"].body === "{{1}}");
  ok(
    `${kind}: one quick reply per title, in order`,
    JSON.stringify(t.types["twilio/card"].actions.map((a) => a.title)) === JSON.stringify(r.RICH_BUTTONS[kind]),
  );
  ok(`${kind}: every action is a QUICK_REPLY`, t.types["twilio/card"].actions.every((a) => a.type === "QUICK_REPLY"));
  const ids = t.types["twilio/card"].actions.map((a) => a.id);
  ok(`${kind}: ids are distinct and non-empty`, new Set(ids).size === ids.length && ids.every((id) => id !== ""));
}
ok("yes_no ids are yes and no", JSON.stringify(r.contentTemplateDefinition("yes_no").types["twilio/card"].actions.map((a) => a.id)) === '["yes","no"]');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
