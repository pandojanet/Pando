/**
 * `/api/seed/assist`'s pure half (9 Oct) — `lib/seed-chat/assist.ts`.
 *
 * The classifier and the rewording are model output, and both are checked
 * before anything reaches a parent's screen. These are the refusals: a
 * sub-category from another button, an unsure or low-confidence answer, a
 * rewrite that lists the answers, carries a link, asks two things or runs
 * long — each falls back to the general category or the canonical wording.
 *
 *     npm run test:assist
 */
const assist = (await import(`../lib/seed-chat/assist.ts?v=${Date.now()}`)) as typeof import("../lib/seed-chat/assist.ts");
const { buildScripts, buildSubScripts } = (await import(
  `../lib/seed-chat/scripts.ts?v=${Date.now()}`
)) as typeof import("../lib/seed-chat/scripts.ts");
const { SUBCATEGORIES, SUBCATEGORY_KIND, SUBCATEGORIES_BY_KIND } = (await import(
  `../lib/seed-chat/subcategories.ts?v=${Date.now()}`
)) as typeof import("../lib/seed-chat/subcategories.ts");

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

/* ── the classifier's answer ── */
ok("a sure answer under the right button is taken", assist.readClassification("activity", { subcategory: "camps", confidence: 0.9 }) === "camps");
ok("unsure is the general category", assist.readClassification("activity", { subcategory: "unsure", confidence: 0.95 }) === null);
ok("a low-confidence answer is the general category", assist.readClassification("activity", { subcategory: "camps", confidence: 0.4 }) === null);
ok("a sub-category of another button is refused", assist.readClassification("activity", { subcategory: "schools", confidence: 0.99 }) === null);
ok("an invented sub-category is refused", assist.readClassification("tip", { subcategory: "recipes", confidence: 1 }) === null);
ok("no answer is the general category", assist.readClassification("place", null) === null);
ok("a confidence that is not a number is the general category", assist.readClassification("place", { subcategory: "schools", confidence: "high" }) === null);

/* ── the request ── */
ok("a caregiver card never reaches the interview", assist.readTurnInput({ kind: "caregiver" }) === null);
ok("a body that is not one is refused", assist.readTurnInput("nope") === null);
{
  const input = assist.readTurnInput({
    kind: "place",
    classify: true,
    subcategory: "camps",
    fields: { name: "  Café\u0007 Verde ", what_is_it: "x".repeat(900), child_age: [3, 99], __fu_caveat: "yes", "Bad Key": "x" },
    last_step: "what_is_it",
    followed_up: ["caveat", "Not An Id!"],
  });
  ok(
    "fields are cleaned and capped, markers and odd keys dropped",
    input?.fields.name === "Café Verde" &&
      String(input?.fields.what_is_it).length === 400 &&
      JSON.stringify(input?.fields.child_age) === "[3]" &&
      !("__fu_caveat" in (input?.fields ?? {})) &&
      !("Bad Key" in (input?.fields ?? {})),
    JSON.stringify(input),
  );
  ok("a sub-category of another button is dropped", input?.subcategory === null);
  ok("only real step ids are kept as followed up", JSON.stringify(input?.followed_up) === '["caveat"]');
}

/* ── what may come next ── */
const scripts = buildScripts("pasadena");
const subs = buildSubScripts("pasadena");
{
  const ids = (fields: Record<string, unknown>, script = subs.classes) =>
    assist.candidateSteps(script, fields as never).map((x) => x.id);
  const ctx = { name: "Splash", what_is_it: "swim lessons", firsthand: "yes", child_age: [4] };
  const first = ids(ctx);
  ok("required questions come first", first.includes("freshness") && first.includes("recommendation") && !first.includes("location"), first.join(","));
  ok("a why waits for the recommendation", !first.includes("what_makes_it_great") && !first.includes("what_didnt_work"));
  const afterRec = ids({ ...ctx, freshness: "current", recommendation: "no" });
  ok("after a No, the No's why is open and the Yes's is not", afterRec.includes("what_didnt_work") && !afterRec.includes("what_makes_it_great"), afterRec.join(","));
  const required = { ...ctx, freshness: "current", recommendation: "yes", what_makes_it_great: "a great teacher", caveat: "none" };
  ok("then the optional town, before the fork", JSON.stringify(ids(required)) === '["location"]', ids(required).join(","));
  ok("then the fork", JSON.stringify(ids({ ...required, location: [] })) === '["more_detail"]');
  ok("“That's it” goes straight to the last question", JSON.stringify(ids({ ...required, location: [], more_detail: "no" })) === '["extra_note"]');
  const detail = ids({ ...required, location: [], more_detail: "yes" });
  ok("“Add more detail” opens the detail, not yet the last question", detail.includes("who_for") && !detail.includes("extra_note"), detail.join(","));
  ok("nothing open means the card is finished", ids({ ...required, location: [], more_detail: "no", extra_note: "" }).length === 0);
}

/* ── reading the model's turn ── */
{
  const script = subs.classes;
  const fields = { name: "Splash Academy", what_is_it: "swim lessons, our 4 year old still goes", firsthand: "yes" } as never;
  const why = script.steps.find((x) => x.id === "what_makes_it_great")!;
  const base = { script, fields, lastStep: null, mayFollowUp: false, ruleFollowUp: null };

  const got = assist.readTurn(
    {
      followup: { needed: false, text: "" },
      prefill: [
        { id: "child_age", value: "4" },
        { id: "freshness", value: "current" },
        { id: "recommendation", value: "yes" },
        { id: "firsthand", value: "secondhand" },
      ],
      next: { id: "recommendation", question: "Would you recommend Splash Academy to another parent?" },
    },
    base,
  );
  ok("how recent is never filled in — it was guessed (9 Oct)", !("freshness" in got.prefill), JSON.stringify(got.prefill));
  const own = assist.readTurn(
    { followup: { needed: false, text: "" }, prefill: [{ id: "firsthand", value: "yes" }], next: null },
    { ...base, fields: { name: "Splash", what_is_it: "our daughter's swim lessons" } as never },
  );
  ok("whose experience it was is taken when their words say so, in the step's own ids", own.prefill.firsthand === "yes", JSON.stringify(own.prefill));
  ok("the age is never filled in — its own question is always asked (9 Oct)", !("child_age" in got.prefill));
  ok("a recommendation is never filled in for a parent", !("recommendation" in got.prefill));
  ok("an answer already given is never overwritten", !("firsthand" in got.prefill));
  ok(
    "a question with buttons is the model's pick, in the script's own words (9 Oct)",
    got.next?.id === "recommendation" && got.next.prompt === script.steps.find((x) => x.id === "recommendation")!.prompt,
    JSON.stringify(got.next),
  );
  {
    const typed = { ...(fields as Record<string, unknown>), child_age: [4], freshness: "current", recommendation: "yes" } as never;
    const ok1 = assist.readTurn(
      { followup: { needed: false, text: "" }, prefill: [], next: { id: "what_makes_it_great", question: "What stood out for your daughter about the way Splash teaches?" } },
      { ...base, fields: typed },
    );
    ok("a typed question is the model's pick, in its words", ok1.next?.prompt.includes("Splash") === true, JSON.stringify(ok1.next));
  }
  ok("a rewording that keeps its words is kept", assist.keepsMeaning("What makes it work well with children?", "What makes Little Sprouts work so well with your 2-year-old?"));
  ok(
    "one that drifted to another subject is refused (the walk's own case)",
    !assist.keepsMeaning("What would you buy instead, if anything?", "Anything else you'd want another parent to know about the Vista?"),
  );
  {
    const friend = assist.readTurn(null, { ...base, fields: { name: "Victory Park", what_is_it: "a park", firsthand: "secondhand" } as never, script: subs.places });
    ok("on a friend's card the age is asked about the friend's child", friend.next?.id === "child_age" && /friend/.test(friend.next.prompt), JSON.stringify(friend.next));
  }
  {
    const product = assist.readTurn(
      { followup: { needed: false, text: "" }, prefill: [{ id: "name", value: "UPPAbaby Vista" }, { id: "firsthand", value: "yes" }], next: null },
      { ...base, script: subs.products, fields: { what_is_it: "The UPPAbaby Vista stroller - we used it for both kids" } as never },
    );
    ok("a product's name is taken from its description, word for word", product.prefill.name === "UPPAbaby Vista", JSON.stringify(product.prefill));
    const invented = assist.readTurn(
      { followup: { needed: false, text: "" }, prefill: [{ id: "name", value: "Bugaboo Fox" }], next: null },
      { ...base, script: subs.products, fields: { what_is_it: "a stroller we loved" } as never },
    );
    ok("a name the parent never typed is refused", !("name" in invented.prefill));
    const elsewhere = assist.readTurn(
      { followup: { needed: false, text: "" }, prefill: [{ id: "name", value: "Splash" }], next: null },
      { ...base, fields: { what_is_it: "Splash swim lessons" } as never },
    );
    ok("and only on a product", !("name" in elsewhere.prefill));
  }
  {
    const tuition = subs.schools.steps.find((x) => x.id === "price_band")!;
    ok(
      "a school's tuition is asked per month, in tuition-sized bands, with no unit question (9 Oct)",
      /per month/.test(tuition.prompt) &&
        (tuition.options ?? []).some((o) => o.label === "Over $3,000") &&
        !subs.schools.steps.some((x) => x.id === "price_unit"),
      tuition.prompt,
    );
  }
  ok(
    "a listed option is spotted with & or and",
    assist.acceptPrompt("What's it about?", "Is it about schedules and timing, or costs and deals?", subs.tips.steps.find((x) => x.id === "topic")!) === null,
  );

  const off = assist.readTurn({ followup: { needed: false, text: "" }, prefill: [{ id: "firsthand", value: "forever" }], next: { id: "who_for", question: "Who is it for?" } }, base);
  ok("a value outside the step's options is refused", !("firsthand" in off.prefill));
  ok("a step that is not open yet is not asked — the first open one is, in its own words", off.next?.id === "child_age" && off.next.prompt === script.steps.find((x) => x.id === "child_age")!.prompt, JSON.stringify(off.next));

  const none = assist.readTurn(null, base);
  ok("no answer from the model is the script's own next step", none.next?.id === "child_age" && Object.keys(none.prefill).length === 0);

  const fu = assist.readTurn(
    { followup: { needed: true, text: "What stood out about the teaching for your daughter?" }, prefill: [], next: { id: "caveat", question: "x?" } },
    { ...base, lastStep: why, mayFollowUp: true },
  );
  ok("the model may ask a follow-up the rule would not, about this question", fu.followup?.includes("teaching") === true && fu.next === null);
  const off2 = assist.readTurn({ followup: { needed: true, text: "What did your twins enjoy most about playing there?" }, prefill: [], next: null }, { ...base, lastStep: script.steps.find((x) => x.id === "caveat")!, mayFollowUp: true });
  ok("a follow-up about something else is dropped (the walk: enjoy-most after know-first)", off2.followup === null);
  const ruled = assist.readTurn({ followup: { needed: false, text: "" }, prefill: [], next: null }, { ...base, lastStep: why, mayFollowUp: true, ruleFollowUp: "Say more?" });
  ok("the rule's follow-up stands even when the model says no", ruled.followup === "Say more?");
  const once = assist.readTurn({ followup: { needed: true, text: "Again?" }, prefill: [], next: null }, { ...base, lastStep: why, mayFollowUp: false });
  ok("never a second follow-up for the same question", once.followup === null);
  const fixed = assist.readTurn(
    { followup: { needed: false, text: "" }, prefill: [], next: { id: "more_detail", question: "Want to tell us more about Splash?" } },
    { ...base, fields: { name: "S", what_is_it: "w", firsthand: "yes", child_age: [4], freshness: "current", recommendation: "yes", what_makes_it_great: "great teacher", caveat: "none", location: [] } as never },
  );
  ok("her fixed sentences are never reworded", fixed.next?.id === "more_detail" && fixed.next.prompt === script.steps.find((x) => x.id === "more_detail")!.prompt);
}

/* ── the rewording guard ── */
{
  const caveat = scripts.activity.steps.find((x) => x.id === "caveat")!;
  const recommend = scripts.activity.steps.find((x) => x.id === "recommendation")!;
  ok("a rewrite that keeps to one question is taken", assist.acceptPrompt(caveat.prompt, "What should another parent know before signing up for Little Maestros?", caveat) !== null);
  ok("one that lists the answers is refused", assist.acceptPrompt(recommend.prompt, "Would you recommend it — Yes, Yes with caveats, Probably not or No?", recommend) === null);
  ok("one with a link is refused", assist.acceptPrompt(caveat.prompt, "What should parents know? See www.example.com?", caveat) === null);
  ok("one with a phone number is refused", assist.acceptPrompt(caveat.prompt, "Call 626-555-0101 — what should parents know?", caveat) === null);
  ok("two questions are refused", assist.acceptPrompt(caveat.prompt, "What should parents know? Anything else?", caveat) === null);
  ok("a question that stops being one is refused", assist.acceptPrompt(caveat.prompt, "Tell me what parents should know.", caveat) === null);
  ok("one that runs long is refused", assist.acceptPrompt(caveat.prompt, `${"Really ".repeat(60)}what should parents know?`, caveat) === null);
}

/* ── the tip button's context answer is the tip ── */
ok(
  "on a tip the context answer becomes the tip, on a product it does not",
  assist.afterClassified("tip", "tips", { what_is_it: "book early" } as never).tip === "book early" &&
    assist.afterClassified("tip", null, { what_is_it: "book early" } as never).tip === "book early" &&
    !("tip" in assist.afterClassified("tip", "products", { what_is_it: "a stroller" } as never)),
);

/* ── the sub-categories themselves ── */
ok("eleven sub-categories, the client's list", SUBCATEGORIES.length === 11);
ok(
  "every sub-category has a script asked from its own button",
  SUBCATEGORIES.every((s) => subs[s] && subs[s].kind === SUBCATEGORY_KIND[s] && subs[s].subcategory === s),
);
ok(
  "every button's sub-categories are listed once",
  Object.values(SUBCATEGORIES_BY_KIND).flat().sort().join() === [...SUBCATEGORIES].sort().join(),
);
{
  /* Each sub-category script starts with its button's context steps, by id, so
     nothing answered before the classifier is asked again. */
  const bad: string[] = [];
  for (const s of SUBCATEGORIES) {
    const general = scripts[SUBCATEGORY_KIND[s]];
    const contextEnd = general.steps.findIndex((x) => x.classifyAfter);
    const contextIds = general.steps.slice(0, contextEnd + 1).map((x) => x.id);
    const ids = new Set(subs[s].steps.map((x) => x.id));
    for (const id of contextIds) {
      if (id === "what_is_it" && s !== "tips" && s !== "products" && SUBCATEGORY_KIND[s] !== "activity" && SUBCATEGORY_KIND[s] !== "place") continue;
      if (!ids.has(id)) bad.push(`${s}.${id}`);
    }
  }
  ok("every sub-category carries its button's context steps", bad.length === 0, bad.join(", "));
}
{
  /* Her struck items are not asked (strike lines in the 10/7 document). */
  const prompts = Object.values(subs).flatMap((s) => s.steps.map((x) => x.prompt));
  const struck = [
    "What makes it good?" /* Activities' item 7 — Products' item 5 is the same words and is not struck */,
    "What makes the teaching good?",
    "What makes it worth the trip?",
    "What makes it a good school?",
    "What do you value about them?",
  ];
  const asked = struck.filter((q) => prompts.filter((p) => p === q).length > (q === "What makes it good?" ? 1 : 0));
  ok("her struck questions are not asked", asked.length === 0, asked.join(" | "));
  ok("Products keeps its own “What makes it good?”", subs.products.steps.some((x) => x.prompt === "What makes it good?"));
}
{
  /* The developer's rule for every card (5 Oct): what must be answered comes
     first; nothing required and unconditional follows an optional step. */
  const bad: string[] = [];
  for (const s of Object.values(subs)) {
    const firstOptional = s.steps.findIndex((x) => x.optional);
    s.steps.forEach((x, i) => {
      if (firstOptional >= 0 && i > firstOptional && !x.optional && !x.when && x.id !== "more_detail") bad.push(`${s.subcategory}.${x.id}`);
    });
    if (s.steps[s.steps.length - 1]?.id !== "extra_note") bad.push(`${s.subcategory} does not end on extra_note`);
    for (const r of s.recap) if (!s.steps.some((x) => x.id === r.field)) bad.push(`${s.subcategory} recap ${r.field}`);
  }
  ok("required first, the last question last, every recap row a real step", bad.length === 0, bad.join(", "));
}

/* ── iteration 2–4 (9 Oct): reactions and the model's follow-ups ── */
ok("a reaction that reflects a fact is kept", assist.acceptAck("Booking a week ahead — noted.") === "Booking a week ahead — noted.");
ok("a reaction that flatters is dropped", assist.acceptAck("That's a great setup for families!") === null && assist.acceptAck("From 10 words to sentences — that's real progress.") === null);
ok("a reaction that asks is dropped", assist.acceptAck("Did they enjoy it?") === null);
{
  const why = buildSubScripts("pasadena").restaurants.steps.find((x) => x.id === "what_makes_it_great")!;
  ok(
    "a follow-up of two short questions is kept (the walk's 'You said it's nice…')",
    assist.acceptFollowUp("You said it's nice — what works for your 2-year-old? The play corner, or the food?", why) !== null,
  );
  ok("three questions are too many", assist.acceptFollowUp("Why? What? How?", why) === null);
}

/* ── the parent's first name (12 Oct): a token the chat fills, never the name ── */
{
  const T = assist.NAME_TOKEN;
  ok("the name as a form of address is kept once", assist.readName(`Thanks, ${T} — how old was he?`, true) === `Thanks, ${T} — how old was he?`);
  ok("an opening name is kept", assist.readName(`${T}, what made it work for her?`, true) === `${T}, what made it work for her?`);
  ok("a second token is taken out", assist.readName(`${T}, what made it work, ${T}?`, true) === `${T}, what made it work?`);
  ok("not allowed → taken out, still a sentence", assist.readName(`Thanks, ${T} — how old was he?`, false) === "Thanks — how old was he?");
  ok("not allowed, opening → capitalised", assist.readName(`${T}, what made it work?`, false) === "What made it work?");
  ok("a name inside the sentence is refused", assist.readName(`Is ${T} still going?`, true) === null);
  ok("no token, untouched", assist.readName("How old was he?", true) === "How old was he?");
  ok("the chat fills the name in", assist.fillName(`Thanks, ${T} — how old was he?`, "Dana") === "Thanks, Dana — how old was he?");
  ok("no name on the device → the token goes", assist.fillName(`${T}, what made it work?`, null) === "What made it work?");
  ok("a trailing name goes cleanly", assist.withoutName(`Which town is it in, ${T}?`) === "Which town is it in?");

  const script = subs.classes;
  const fields = { name: "Splash Academy", what_is_it: "swim lessons, our son still goes", firsthand: "yes", child_age: [4] } as never;
  const caveat = script.steps.find((x) => x.id === "caveat")!;
  const base = { script, fields: { ...(fields as object), caveat: "Book early" } as never, lastStep: caveat, mayFollowUp: false, ruleFollowUp: null };
  const both = assist.readTurn(
    { ack: `Book early, ${T} — noted.`, next: { id: "location", question: `${T}, which town is Splash Academy in?` } },
    { ...base, mayName: true },
  );
  ok(
    "the reaction never carries the name; the question does, once",
    !(both.ack ?? "").includes(T) && (both.next?.prompt.split(T).length ?? 0) === 2,
    JSON.stringify(both),
  );
  const none = assist.readTurn(
    { ack: `Book early, ${T} — noted.`, next: { id: "location", question: `${T}, which town is Splash Academy in?` } },
    { ...base, mayName: false },
  );
  ok("not allowed on this card → no token anywhere", !JSON.stringify(none).includes(T), JSON.stringify(none));
  const inside = assist.readTurn(
    { ack: "", next: { id: "location", question: `Which town is ${T}'s Splash Academy in?` } },
    { ...base, mayName: true },
  );
  ok(
    "a misplaced name is refused, and the script's question is addressed instead",
    !(inside.next?.prompt ?? "").includes(`${T}'s`) && (inside.next?.prompt ?? "").startsWith(`${T}, `),
    JSON.stringify(inside.next),
  );
  const plain = assist.readTurn({ ack: "", next: { id: "freshness", question: "Is your son still taking it?" } }, { ...base, mayName: true });
  ok("left out by the model → put in front, lower-cased", plain.next?.prompt === `${T}, is your son still taking it?`, JSON.stringify(plain.next));
  const notNow = assist.readTurn({ ack: "", next: { id: "freshness", question: "Is your son still taking it?" } }, { ...base, mayName: false });
  ok("not this turn → never added", notNow.next?.prompt === "Is your son still taking it?");
  const atFork = assist.readTurn(null, {
    ...base,
    fields: { ...(fields as object), freshness: "current", recommendation: "yes", what_makes_it_great: "x".repeat(30), caveat: "Book early", location: [] } as never,
    mayName: true,
  }).next;
  ok("her fixed sentences are never addressed", atFork?.id === "more_detail" && !atFork.prompt.includes(T), JSON.stringify(atFork));

  const text = subs.classes.steps.find((x) => x.id === "caveat")!;
  const tap = subs.classes.steps.find((x) => x.id === "recommendation")!;
  ok("named after something of substance", assist.nameThisTurn(true, text, { caveat: "Book a week ahead for weekends, they fill up fast" } as never, false));
  ok("not after a short answer", !assist.nameThisTurn(true, text, { caveat: "Book early" } as never, false));
  ok("not after a tap", !assist.nameThisTurn(true, tap, { recommendation: "yes" } as never, false));
  ok("with a follow-up the rule wants", assist.nameThisTurn(true, text, { caveat: "" } as never, true));
  ok("never twice a card", !assist.nameThisTurn(false, text, { caveat: "Book a week ahead for weekends, they fill up fast" } as never, true));
  ok("a reaction cut off mid-thought is dropped", assist.acceptAck("You and your son made bowls together — ") === null);
  ok("a button question with no words to keep is not reworded", !assist.keepsMeaning("What's it about?", "Which classes are you talking about?", 1));
  ok("…a typed one may be", assist.keepsMeaning("What's it about?", "Which classes are you talking about?", 0.5));
  ok("their own words + 'got it' is an echo, dropped", assist.acceptAck("A very independent kid — got it.", "A very independent kid") === null);
  ok("a reaction in other words is kept", assist.acceptAck("So, kids who like to work on their own.", "A very independent kid") !== null);
}

/* ── a context question with the card's name (12 Oct) ── */
{
  const engine = (await import(`../lib/seed-chat/engine.ts?v=${Date.now()}`)) as typeof import("../lib/seed-chat/engine.ts");
  const ctx = buildScripts("pasadena").activity.steps.find((x) => x.id === "what_is_it")!;
  ok("named once the card has a name", engine.canonicalPrompt(ctx, { name: "Green & Bisque" }) === "In a line or two, what is Green & Bisque?");
  ok("its own words without one", engine.canonicalPrompt(ctx, {}) === "In a line or two, what is it?");
  ok("a long name is not read back", engine.canonicalPrompt(ctx, { name: "x".repeat(60) }) === "In a line or two, what is it?");
  ok("a person's name is not a thing", engine.canonicalPrompt(ctx, { name: "Ms. Lee" }) === "In a line or two, what is it?");

  const subs2 = buildSubScripts("pasadena");
  const why = subs2.camps.steps.find((x) => x.id === "what_makes_it_great")!;
  ok("a friend's card asks what the friend said", engine.canonicalPrompt(why, { firsthand: "secondhand" }) === "What did your friend say stood out about it?");
  ok(
    "a restaurant and a product ask what didn't work after a No",
    ["restaurants", "products"].every((k) => (subs2 as Record<string, { steps: Array<{ id: string; when?: (f: object) => boolean }> }>)[k].steps.some((x) => x.id === "what_didnt_work" && x.when?.({ recommendation: "no" }))),
  );

  const skipStep = subs2.parties.steps.find((x) => x.id === "detail_note")!;
  const afterSkip = assist.readTurn(
    { followup: { needed: true, text: "You mentioned the setup — was it easy in your backyard?" } },
    { script: subs2.parties, fields: { name: "Andy", detail_note: "" } as never, lastStep: skipStep, mayFollowUp: true, ruleFollowUp: "Anything about setup or logistics?" },
  );
  ok("after a skip a follow-up never quotes them", afterSkip.followup === "Anything about setup or logistics?", String(afterSkip.followup));
}

console.log(`\n  ${passed} checks passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);
