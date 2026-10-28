import { readFileSync } from "node:fs";
import type { HoldReason, RoutingInput } from "../lib/answer-routing.ts";

/**
 * M5.8 — what holds an answer back.
 *
 * Two layers are tested separately on purpose. The **pilot's blanket rule** holds
 * everything (strategy §19), and it is meant to come off one day; the **specific
 * rules** are what remain when it does. Testing only the blanket one would mean
 * discovering the specific ones are wrong on the day they start being the only
 * thing standing between a parent and an unread answer.
 *
 * So most of what follows checks that a rule fires **for the right reason** and
 * is marked `permanent` correctly — that flag is what says "this would still be
 * held with the pilot rule off".
 */

const r = (await import(`../lib/answer-routing.ts?v=${Date.now()}`)) as typeof import("../lib/answer-routing.ts");
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
const onb = (await import(`../lib/onboarding.ts?v=${Date.now()}`)) as typeof import("../lib/onboarding.ts");

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

/** A solid, ordinary answer: two parent-backed records, nothing sensitive. */
const good = (over: Partial<RoutingInput> = {}): RoutingInput => ({
  sensitivity: "ordinary",
  caregiver_related: false,
  public_only: false,
  used: 3,
  next_step: "none",
  ...over,
});
const route = (over: Partial<RoutingInput> = {}) => r.routeAnswer(good(over));

console.log("\n=== only what needs a person waits for one ===");
/* The blanket rule came off on 8 Sep (the client: only sensitive messages go
   to the admin). These are the checks that the automation is exactly as wide
   as it was meant to be and no wider. */
ok(
  "the blanket rule is off",
  r.PILOT_HOLD_EVERYTHING === false,
  "and turning it back on is the response to a bad answer reaching a parent",
);
ok(
  "a solid ordinary answer goes out by itself",
  route().hold === false,
);
/**
 * ⚠ These three asserted the opposite until 14 Sep, and why they were inverted
 * rather than deleted is the finding: the condition they described is **the
 * same expression** that offers a Network Check, so holding on it meant M7's
 * automatic entry could never fire without an admin first releasing the answer
 * that carries the offer.
 */
ok(
  "a thin answer goes out by itself — one parent behind it is still an answer",
  route({ used: 1 }).hold === false && route({ used: 1 }).reason === "not_held",
  "it is an unhelpful answer, and the honest alternative to it was silence",
);
ok(
  "so does one with no parent behind it at all",
  route({ public_only: true }).hold === false,
  "the label says Public/general information, so it cannot pose as a parent",
);
ok(
  "and the two move together, because they are one set",
  route({ public_only: true, used: 0 }).hold === false,
  "composeAnswer offers a blast on publicOnly || parentUsed < 2 — the same test",
);

console.log("\n=== the rules that will still hold when the blanket comes off ===");
for (const sensitivity of ["high_stakes", "peer_support", "named_allegation"] as const) {
  const v = route({ sensitivity });
  ok(`${sensitivity} is held`, v.hold && v.reason === "sensitive");
  ok(`${sensitivity} is held permanently`, v.permanent === true);
}
ok(
  "a caregiver answer is held permanently",
  (() => {
    const v = route({ caregiver_related: true });
    return v.hold && v.reason === "caregiver" && v.permanent;
  })(),
  "§19: everything caregiver-related keeps human eyes permanently",
);
ok(
  "and the generator asking for a person is permanent too",
  (() => {
    const v = route({ next_step: "human_review" });
    return v.hold && v.reason === "generator_asked" && v.permanent;
  })(),
);

console.log("\n=== the specific reason beats the blanket one ===");
ok(
  "sensitive is reported as sensitive, not as pilot_review_all",
  route({ sensitivity: "high_stakes" }).reason === "sensitive",
  "the reviewer's first question is why this one is here",
);
ok(
  "caregiver likewise",
  route({ caregiver_related: true }).reason === "caregiver",
);
ok(
  "a thin answer has no reason to report, because it is not held",
  route({ used: 1 }).reason === "not_held",
);

console.log("\n=== order: the costlier mistake is checked first ===");
ok(
  "sensitive beats caregiver when both are true",
  route({ sensitivity: "named_allegation", caregiver_related: true }).reason === "sensitive",
  "a claim about a named person is owed silence, which is stricter than review",
);
ok(
  "a caregiver answer is still held even when it is thin",
  route({ caregiver_related: true, public_only: true, used: 0 }).reason === "caregiver",
  "dropping the thin holds must not drop the permanent one underneath them",
);
ok(
  "and a sensitive one likewise",
  route({ sensitivity: "high_stakes", used: 0 }).reason === "sensitive",
);

console.log("\n=== the two reasons stay readable for the rows that carry them ===");
/**
 * Nothing produces these any more, and they must not be deleted from the union:
 * answers written before 14 Sep carry them and `labels.ts` renders them, so
 * removing the values breaks the admin on its own history.
 */
for (const reason of ["public_only", "low_evidence"] as const) {
  const kept: HoldReason = reason;
  ok(`${reason} is still a hold reason an old row can carry`, kept === reason);
}
ok(
  "and nothing routes to either of them today",
  route({ public_only: true, used: 0 }).reason === "not_held",
);

console.log("\n=== the caregiver word scan is generous on purpose ===");
for (const text of [
  "our nanny loved it",
  "a great babysitter for date nights",
  "we used an au pair that year",
  "night nurse for the first six weeks",
  "the nanny share fell through",
  "ask their childminder",
]) {
  ok(`"${text.slice(0, 28)}…" is caught`, r.mentionsCaregiver(text));
}
ok(
  "an ordinary class answer is not",
  !r.mentionsCaregiver("Toddler Tunes on Lake — the 9am is calmer"),
);
ok(
  "and the asymmetry is the argument",
  r.mentionsCaregiver("NANNY") && !r.mentionsCaregiver("nan bread"),
  "a false positive costs one extra read; a miss costs a caregiver named to a parent unchecked",
);

console.log("\n=== what the parent hears while a person reads it ===");
{
  /* Every answer is held in the pilot, and until 4 Sep nothing said so: a
     parent texted a question and got silence until an admin opened the queue.
     On a stranger's first message that is indistinguishable from a dead
     number, which is the one thing 5.9 exists to prevent. */
  ok("it names a person rather than a system", r.HELD_ACK.includes("Someone at Pando"));
  ok(
    "and promises no time",
    !/shortly|soon|minutes|hour/i.test(r.HELD_ACK),
    "nobody can keep one during a pilot worked by hand",
  );
  ok(
    "the clarifying question rides along when there is one",
    r.heldReply("How old is your child?").endsWith("How old is your child?"),
  );
  ok("and nothing is appended when there is not", r.heldReply(null) === r.HELD_ACK);

  /* One character outside GSM-7 cuts the budget from 160 to 70, so the
     acknowledgement is written inside it deliberately. `sms-segments.ts` is
     the measurement; these two are what keep it true. */
  ok(
    "written in GSM-7, so it costs one segment on its own",
    seg.planSegments(r.HELD_ACK).encoding === "gsm7" &&
      seg.planSegments(r.HELD_ACK).segments === 1,
    JSON.stringify(seg.planSegments(r.HELD_ACK)),
  );
  ok(
    "and two with the age question, not three",
    seg.planSegments(r.heldReply(onb.CLARIFYING_COPY.child_age)).segments === 2,
    "an em dash in that question used to make it three",
  );
}

console.log("\n=== 9 Sep: a message that is not a question is answered, not ignored ===");
{
  /**
   * The 7 Sep review's first gap. `unclear` and a mid-exchange `chitchat` were
   * closed on 8 Sep; a **cold** `chitchat` and **any** free-form `contribute`
   * still fell off the end of `handleInboundMessage` in silence — verified live
   * against the built app on 9 Sep, with *"we loved Little Gym"* producing no
   * reply, no queued answer and no pending question.
   */
  const r = (await import(
    `../lib/replies.ts?v=${Date.now()}`
  )) as typeof import("../lib/replies.ts");
  const s = (await import(
    `../lib/sms-segments.ts?v=${Date.now()}`
  )) as typeof import("../lib/sms-segments.ts");

  for (const [name, text] of [
    ["the share invite", r.SHARE_INVITE],
    ["the small-talk reply", r.SMALL_TALK],
    ["the opener reply", r.OPENER_REPLY],
    ["the Ask acknowledgement", r.ASK_STARTED],
    ["the Ask failure reply", r.ASK_NOT_STARTED],
    ["the still-good acknowledgement", r.PING_STILL_GOOD],
    ["the withdrawal acknowledgement", r.PING_NO_LONGER],
    ["the helped-yes acknowledgement", r.HELPED_YES],
    ["the helped-no acknowledgement", r.HELPED_NO],
    ["the Ask-reply acknowledgement", r.BLAST_REPLY_THANKS],
  ] as const) {
    const plan = s.planSegments(text);
    ok(
      `${name} is GSM-7`,
      plan.encoding === "gsm7",
      plan.offenders?.join("") ?? "",
    );
    ok(
      `${name} is one segment`,
      plan.segments === 1,
      `${text.length} chars, ${plan.segments} segments`,
    );
    ok(
      `${name} ends with the compliance line, like every other reply`,
      /Reply STOP to opt out, HELP for help\.$/.test(text),
    );
  }
  /* 22 Oct: it pointed at pando.is/share, which the seed gate bounces to the
     home page for a parent who never held an invite link — so it now names the
     SMS capture's own start word, checked against the reader that accepts it. */
  const cap = (await import(`../lib/capture.ts?v=${Date.now()}`)) as typeof import("../lib/capture.ts");
  const startWord = /\btext ([A-Z]+)\b/.exec(r.SHARE_INVITE)?.[1] ?? "";
  ok(
    "the share invite names a word that really starts the SMS capture",
    startWord !== "" && cap.isCaptureStart(startWord),
    r.SHARE_INVITE,
  );
  ok(
    "and sends a texting parent to no gated page, and never to /caregiver",
    !/pando\.is\/(share|profile|done)\b/.test(r.SHARE_INVITE) && !r.SHARE_INVITE.includes("/caregiver"),
    "sending a nominating parent to the caregiver's own sign-up is the wrong flow",
  );
  ok(
    "the Ask acknowledgement does not promise to pass on what parents say",
    !/what they say/i.test(r.ASK_STARTED),
    "an Ask nobody answers expires without a text, and a person reads every reply first",
  );
  /**
   * M7's automatic entry, wired 14 Sep. The reply a parent gets for saying yes
   * to *"Want me to ask a few nearby parents for more?"*.
   *
   * It **promises no time**, for the same reason `heldReply` does not: an Ask
   * runs on a window the parent cannot see and an admin still presses Send, so
   * any number here is one nobody can keep.
   */
  ok(
    "the Ask acknowledgement says what will happen and promises no time",
    !/\b(minute|hour|today|shortly|soon)\b/i.test(r.ASK_STARTED),
    r.ASK_STARTED,
  );
  ok(
    "and it never says what an Ask costs",
    !r.ASK_STARTED.includes("$"),
    "payment is off for the pilot, and the price is not this message's to state",
  );
  ok(
    "the four yes/no acknowledgements ask nothing back",
    [r.PING_STILL_GOOD, r.PING_NO_LONGER, r.HELPED_YES, r.HELPED_NO, r.BLAST_REPLY_THANKS].every((t) => !t.includes("?")),
  );
  ok(
    "and the helped one does not promise the contributors a thank-you a job has to send",
    !/thank (them|the parents|everyone)|let (them|the parents) know/i.test(r.HELPED_YES),
    r.HELPED_YES,
  );
  ok(
    "and the opener reply asks no question either",
    !r.OPENER_REPLY.includes("?"),
    "a question here would make the next message ambiguous",
  );
  ok(
    "and small talk asks no question of its own",
    !r.SMALL_TALK.includes("?"),
    "5.4 owns onboarding; a second question here makes the next reply ambiguous",
  );
}

console.log("\n=== a sensitive question over SMS gets what the web D1 flow gives (25 Sep) ===");
{
  /* Walked over the relay: a fever of 104 was told Pando was putting together
     an answer "from local parents". These are the replies that replace it. */
  /* The local lines are the market's since 27 Oct (lib/markets.ts); the pilot's are checked here. */
  const mk = (await import(`../lib/markets.ts?v=${Date.now()}`)) as typeof import("../lib/markets.ts");
  const crisis = mk.marketConfig().crisis;
  const HIGH = r.highStakesReply(crisis);
  const ALLEGATION = r.allegationReply(crisis);
  for (const [name, text] of [
    ["the health, legal or safety reply", HIGH],
    ["the claim-about-a-person reply", ALLEGATION],
  ] as const) {
    const plan = seg.planSegments(text);
    ok(`${name} is GSM-7`, plan.encoding === "gsm7", plan.offenders?.join("") ?? "");
    ok(`${name} never promises parents' experience`, !/local parents|from parents/i.test(text), text);
    ok(`${name} asks nothing back`, !text.includes("?"), text);
  }
  ok(
    "the high-stakes reply carries the same four resources as the web panel",
    ["911", "211", "988", "1-800-433-6251"].every((n) => HIGH.includes(n)),
  );
  ok(
    "another market's lines replace the pilot's, word for word otherwise",
    r.highStakesReply({ ...crisis, legalHelp: { name: "X", phone: "1-800-000-0000" } }) === HIGH.replace("1-800-433-6251", "1-800-000-0000")
      && r.allegationReply({ ...crisis, childProtection: { name: "Cook County DCFS", phone: "1-800-252-2873" } }).includes("Cook County DCFS at 1-800-252-2873."),
  );
  ok(
    "the allegation reply carries no resource list, only the number for a child at risk",
    !/988|211|433-6251/.test(ALLEGATION) && ALLEGATION.includes("LA County child protection at 1-800-540-4000."),
  );
  const src = readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
  /* 26 Oct, the chat lab: a never-asked parent's bare "3" was read as answer_blast and told to text ADD. */
  ok(
    "an answer_blast reading is a contribution only for somebody sent an Ask lately",
    /reading\.intent === "answer_blast" && \(await askedRecently\(from\)\)/.test(src),
  );
  ok(
    "inbound sends them instead of the held reply, and flags the answer",
    src.includes("highStakesReply(marketConfig(marketOf(person)).crisis)") && src.includes("allegationReply(marketConfig(marketOf(person)).crisis)") && /reason: urgent === "high_stakes" \? "high_stakes_demand" : "named_allegation"/.test(src),
  );
  ok(
    "and asks no clarifying question under one",
    /const clarifier =\s+asking && !urgent/.test(src),
  );
  /* 26 Oct, the SMS lab: "I want to make a deep research against these top 5
     schools", sent while "How old are your kids?" was open, was stored as a
     child aged 5 and the request dropped. A longer reply is read first, told
     what Pando asked; a new request is not an answer. */
  ok(
    "a longer reply to a clarifying question is read before it is stored, and a new request is not an answer",
    /const longReply = body\.trim\(\)\.split\(\/\\s\+\/\)\.length > 3;/.test(src) &&
      /askedThem: open && pending \? CLARIFYING_COPY\[pending\] : null/.test(src) &&
      /if \(question && !newRequest && isClarifyingAnswer\(body\)\)/.test(src),
  );
  ok(
    "ages or an area said without being asked are offered to that question's parser, never a first name",
    /unasked === "neighborhood" \|\| \(unasked === "child_age" && saysAChild\) \? unasked : null;/.test(src) &&
      /const question = open && pending \? \(aQuestion \? null : pending\) : volunteered;/.test(src),
  );
  ok(
    "and that reading is reused, so the message costs one model call",
    /const reading = early && early\.intent !== "answer_blast" && !attached\.attached \? early : await classifyIntent/.test(src),
  );
  ok(
    "the clarifier never asks what the question itself just said (an age, a place)",
    /nextAsked === "child_age" && bandsInQuestion\(body\)\.length > 0/.test(src) &&
      /nextAsked === "neighborhood" && placePhraseIn\(body\) !== null/.test(src) &&
      /pendingAsked !== nextAsked && !saidHere/.test(src),
  );
  /* 26 Oct, the SMS lab: "any good fencing classes…?" from a parent holding a swim Ask was filed as her answer. */
  ok(
    "a question-shaped message inside an Ask window is read by the classifier, told the other parent's question",
    src.includes("othersQuestion: question,") &&
      /if \(ownRequestNotAnAnswer\(body, question, \(t\) => focusInQuestion\(t, list\)\)\) return true;/.test(src) &&
      /return reading\.source === "model" && \["ask_recommendation", "ask_caregiver", "deep_dive"\]\.includes\(reading\.intent\);/.test(src),
  );
  /* 27 Oct: the handler is a list of steps, and their order is the product's precedence (the comment above handleInboundMessageUntraced explains each place). */
  {
    const main = src.slice(src.indexOf("async function handleInboundMessageUntraced("), src.indexOf("const HANDLED = Symbol("));
    const order = ["await keywordStep(", "await ensureInboundPerson(", "await settingsStep(", "await captureStep(", "await attachStep(", "await repliesStep(", "await clarifyStep(", "await openQuestionStep(", "await routeStep("];
    const at = order.map((call) => main.indexOf(call));
    ok("the steps run in their fixed order: keywords, who it is, settings, capture, an Ask, a ping, a clarification, an open exchange, the answer",
      at.every((i) => i > 0) && at.every((i, n) => n === 0 || i > at[n - 1]), order.filter((_, n) => at[n] <= 0).join(", "));
    ok("a step that answered ends the turn", (main.match(/=== HANDLED\) return;/g) ?? []).length === 5);
  }
  /* 26 Oct, the SMS lab: a question after STOP went through the whole pipeline. */
  {
    /* Since 27 Oct the check lives in `keywordStep`, which the handler runs before it looks the sender up. */
    const step = src.slice(src.indexOf("async function keywordStep("), src.indexOf("async function settingsStep("));
    const gate = step.indexOf("if (await isOptedOut(from)) {");
    const main = src.slice(src.indexOf("async function handleInboundMessageUntraced("), src.indexOf("const HANDLED = Symbol("));
    ok(
      "an opted-out sender is recorded and not answered, after the keywords and DELETE, before anything is built",
      gate > 0 && gate > step.indexOf("if (isDeleteRequest(body)) {") &&
        main.indexOf("await keywordStep(") > 0 && main.indexOf("await keywordStep(") < main.indexOf("const person = await ensureInboundPerson({ phone: from });"),
    );
  }
  /* 26 Oct, the SMS lab: a ping's YES or a saved age was still classified, then discarded. */
  ok(
    "a message a step above already answered is not sent to the model",
    src.indexOf("if (answeredSomething || clarified) return;") > 0 &&
      src.indexOf("if (answeredSomething || clarified) return;") < src.indexOf("const reading = early && "),
  );
  /* 26 Oct review: the verdict, next step and offers were read off the headroom
     draft while the full-budget draft was sent — `offer_blast` stored beside a
     text with no offer. Each draft is planned on its own; the sent one's plan is used. */
  ok(
    "an answer's verdict, next step and offers come from the draft that is sent",
    src.includes("await planFor(composedFull)") &&
      /const \{ draft: sent, verdict, offerDeepEligible, nextStep, lead, introOthers, offerIntroEligible \} = plan;/.test(src) &&
      /answerText = voiced \?\? plan\.draftText/.test(src) &&
      /labels: sent\.labels,\s+publicOnly: sent\.public_only,[\s\S]{0,80}shareIds: sent\.used_ids/.test(src) &&
      !/next_step: composed\.next_step,\s+\}\);/.test(src),
  );
  /* The second recording: the model read an allegation as an offer, and the
     parent was asked for "ages, cost, whether you'd recommend it". */
  const nonQuestion = src.indexOf("const unreadable =");
  const guard = src.lastIndexOf("escalateSensitivity(classifyDemand(body, null), reading.sensitive)", nonQuestion);
  ok(
    "the words are read before a non-question is answered as an offer or small talk",
    guard > 0 && guard < nonQuestion && src.indexOf("SHARE_INVITE : SMALL_TALK") > nonQuestion,
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
