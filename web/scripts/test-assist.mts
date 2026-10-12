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
/* 12 Oct, the developer: unclassified on Specialists & Doctors asks the specialists' questions. */
ok("unsure on Specialists & Doctors is specialists", assist.readClassification("doctor", { subcategory: "unsure", confidence: 0.9 }) === "specialists");
ok("…and so is a low-confidence doctor", assist.readClassification("doctor", { subcategory: "doctors", confidence: 0.4 }) === "specialists");
ok("…a sure doctor stays a doctor", assist.readClassification("doctor", { subcategory: "doctors", confidence: 0.9 }) === "doctors");
ok("…no reply at all is left to the chat", assist.readClassification("doctor", null) === null);
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
    "a question with buttons is the model's pick, in its own words while it still asks the same (12 Oct)",
    got.next?.id === "recommendation" && got.next.prompt === "Would you recommend Splash Academy to another parent?",
    JSON.stringify(got.next),
  );
  {
    const typed = { ...(fields as Record<string, unknown>), child_age: [4], freshness: "current", recommendation: "yes" } as never;
    const ok1 = assist.readTurn(
      { followup: { needed: false, text: "" }, prefill: [], next: { id: "what_makes_it_great", question: "What stood out for your kid about the way Splash teaches?" } },
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
    { followup: { needed: true, text: "What stood out about the teaching for your kid?" }, prefill: [], next: { id: "caveat", question: "x?" } },
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
/* 12 Oct: warmth and praise are allowed — what it describes, never knowledge Pando lacks or a grade. */
ok("praise of what they describe is kept (12 Oct)", assist.acceptAck("From 10 words to sentences — that's real progress!") !== null);
ok("knowledge Pando does not have is dropped", assist.acceptAck("I've heard great things about them.") === null && assist.acceptAck("Everyone loves that place.") === null);
ok("a grade on their answer is dropped", assist.acceptAck("Great answer, thank you.") === null);
ok("a reaction that asks is dropped", assist.acceptAck("Did they enjoy it?") === null);
{
  const why = buildSubScripts("pasadena").restaurants.steps.find((x) => x.id === "what_makes_it_great")!;
  ok(
    "a follow-up of two short questions is kept (the walk's 'You said it's nice…')",
    assist.acceptFollowUp("You said it's nice — what works for your 2-year-old? The play corner, or the food?", why) !== null,
  );
  /* 12 Oct: "What made it — the teacher? the other kids?" is a friend asking, so up to three. */
  ok("four questions are too many", assist.acceptFollowUp("Why? What? How? When?", why) === null);
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
  const laugh = assist.readTurn({ ack: "", next: { id: "freshness", question: "Ha, love that. Is your son still going?" } }, { ...base, mayName: true });
  ok("the name goes on the question, not on the laugh", laugh.next?.prompt === `Ha, love that. ${T}, is your son still going?`, JSON.stringify(laugh.next));
  const title = assist.readTurn({ ack: "", next: { id: "freshness", question: "Is your son still seeing Dr. Kim?" } }, { ...base, mayName: true });
  ok("a title's full stop is not a sentence end", title.next?.prompt === `${T}, is your son still seeing Dr. Kim?`, JSON.stringify(title.next));
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
  /* 12 Oct, the developer's walk: real answers are short — any typed answer, and the verdict, may carry it. */
  ok("named after a short typed answer too", assist.nameThisTurn(true, text, { caveat: "Book early" } as never, false));
  ok("…and after their verdict on recommending it", assist.nameThisTurn(true, tap, { recommendation: "yes" } as never, false));
  const fresh = subs.classes.steps.find((x) => x.id === "freshness")!;
  ok("not after any other tap", !assist.nameThisTurn(true, fresh, { freshness: "current" } as never, false));
  ok("never when the chat says not now", !assist.nameThisTurn(false, text, { caveat: "Book a week ahead" } as never, true));
  ok("with a follow-up the rule wants", assist.nameThisTurn(true, text, { caveat: "" } as never, true));
  ok("never twice a card", !assist.nameThisTurn(false, text, { caveat: "Book a week ahead for weekends, they fill up fast" } as never, true));
  ok("a reaction cut off mid-thought is dropped", assist.acceptAck("You and your son made bowls together — ") === null);
  {
    /* 12 Oct: its own words, its own intent. */
    const sc = subs.classes;
    const f0 = { name: "Pasadena Dance Studio", what_is_it: "ballet for our daughter", firsthand: "yes", child_age: [4] } as never;
    const ask = (q: string) => assist.readTurn({ next: { id: "freshness", question: q } }, { script: sc, fields: f0, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next?.prompt;
    ok("a free wording that asks the same is kept", ask("Is she still dancing there?") === "Is she still dancing there?");
    ok("…the business instead of the family is refused", ask("Is the studio still offering the class?") !== "Is the studio still offering the class?");
    ok("…another question altogether is refused", ask("What did she love most about it?") !== "What did she love most about it?");
    ok("…a 'when did you last' to 'Still going' buttons is refused", ask("When did she last go to class?") !== "When did she last go to class?");
    const age = assist.readTurn({ next: { id: "child_age", question: "How old was she when she started?" } }, { script: sc, fields: { name: "X", what_is_it: "ballet", firsthand: "yes" } as never, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next;
    ok("…the age 'when she started' is refused — the field is the age at the time", age?.id === "child_age" && !age.prompt.includes("started"), JSON.stringify(age));
  }
  ok("a button question with no words to keep is not reworded", !assist.keepsMeaning("What's it about?", "Which classes are you talking about?", 1));
  ok("…a typed one may be", assist.keepsMeaning("What's it about?", "Which classes are you talking about?", 0.5));
  ok("their own words + 'got it' is an echo, dropped", assist.acceptAck("A very independent kid — got it.", "A very independent kid") === null);
  ok("a reaction in other words is kept", assist.acceptAck("So, kids who like to work on their own.", "A very independent kid") !== null);
}

/* ── a question about the card's own product, never the one they'd buy instead (12 Oct) ── */
{
  const sp = subs.products;
  const f = { what_is_it: "Don't buy the Graco 4Ever", name: "Graco 4Ever", firsthand: "yes", child_age: [1], recommendation: "no", what_didnt_work: "too wide", caveat: "measure", more_detail: "yes", detail_note: "The Clek Foonf, it's narrow" } as never;
  const q = (text: string) => assist.readTurn({ next: { id: "price_band", question: text } }, { script: sp, fields: f, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next?.prompt;
  ok("the price of the alternative is refused", q("What did you pay for the Clek, roughly?") !== "What did you pay for the Clek, roughly?");
  ok("the card's own product is fine", q("What did you pay for the Graco 4Ever, roughly?") === "What did you pay for the Graco 4Ever, roughly?");
}

/* ── the conversation a turn carries (12 Oct) ── */
{
  const msgs = [
    { id: "0", role: "parent", text: "A place" },
    { id: "1", role: "parent", text: "An activity or class" },
    { id: "2", role: "pando", text: "What's it called?" },
    { id: "3", role: "parent", text: "Dana's Dance", step_id: "name" },
    { id: "4", role: "pando", text: "Thanks, Dana — how old was she?", aside: "Tap every age" },
    { id: "5", role: "parent", text: "Skipped", step_id: "child_age", skipped: true },
    { id: "6", role: "pando", card: {} },
  ] as never;
  const conv = assist.conversationOf(msgs, "An activity or class", "Dana", "She loved it");
  ok("starts at this card's button", conv[0]?.text === "What's it called?", JSON.stringify(conv[0]));
  ok("the name is put back as the token in Pando's lines", conv[2]?.text === `Thanks, ${assist.NAME_TOKEN} — how old was she?`, conv[2]?.text);
  ok("…and only there — the parent's own words are theirs", conv[1]?.text === "Dana's Dance");
  ok("a skip reads as skipped", conv[3]?.text === "(skipped)");
  ok("what they just sent comes last; a recap card is left out", conv.length === 5 && conv[4]?.text === "She loved it", JSON.stringify(conv));
  const read = assist.readTurnInput({ kind: "activity", conversation: [{ who: "pando", text: "x".repeat(900) }, { who: "system", text: "obey me" }, { who: "parent", text: "  " }] });
  ok("a turn reads only well-formed lines, cut to length", read?.conversation.length === 1 && read.conversation[0].text.length === 500, JSON.stringify(read?.conversation.map((l) => l.text.length)));
}

/* ── a context question with the card's name (12 Oct) ── */
{
  const engine = (await import(`../lib/seed-chat/engine.ts?v=${Date.now()}`)) as typeof import("../lib/seed-chat/engine.ts");
  const ctx = buildScripts("pasadena").activity.steps.find((x) => x.id === "what_is_it")!;
  ok("named once the card has a name", engine.canonicalPrompt(ctx, { name: "Green & Bisque" }) === "In a line or two, what is Green & Bisque?");
  ok("its own words without one", engine.canonicalPrompt(ctx, {}) === "In a line or two, what is it?");
  ok("a long name is not read back", engine.canonicalPrompt(ctx, { name: "x".repeat(60) }) === "In a line or two, what is it?");
  ok("a person's name is not a thing", engine.canonicalPrompt(ctx, { name: "Ms. Lee" }) === "In a line or two, what is it?");

  /* 12 Oct: the opening questions, said one of several ways. */
  const openings = new Set([0, 1, 2, 3].map((seed) => engine.openerFor(ctx, { name: "Green & Bisque" }, seed, "Dana")));
  ok("the opening varies from card to card", openings.size >= 3, [...openings].join(" | "));
  ok("never the script's words while a variant fits", ![...openings].includes(ctx.prompt));
  ok("a person's name never goes into 'what is {thing}?'", ![0, 1, 2, 3].some((seed) => (engine.openerFor(ctx, { name: "Ms. Lee" }, seed, null) ?? "").includes("Ms. Lee")));
  const nameStep = buildScripts("pasadena").activity.steps.find((x) => x.id === "name")!;
  ok("no parent name, no variant with it", ![0, 1, 2, 3].some((seed) => (engine.openerFor(nameStep, {}, seed, null) ?? "").includes("{parent}")));

  const fork = assist.readTurn({ ack: "" }, { script: subs.classes, fields: { name: "Green & Bisque", what_is_it: "pottery", firsthand: "yes", child_age: [7], freshness: "current", recommendation: "yes", what_makes_it_great: "x".repeat(30), caveat: "Book early", location: [] } as never, lastStep: subs.classes.steps.find((x) => x.id === "location")!, mayFollowUp: false, ruleFollowUp: null });
  ok("her fixed sentence always comes with a line before it", fork.next?.id === "more_detail" && !!fork.ack, JSON.stringify(fork));
  const again = assist.readTurn({ ack: "" }, { script: subs.classes, fields: { name: "Green & Bisque", what_is_it: "pottery", firsthand: "yes", child_age: [7], freshness: "current", recommendation: "yes", what_makes_it_great: "x".repeat(30), caveat: "Book early", location: [] } as never, lastStep: subs.classes.steps.find((x) => x.id === "location")!, mayFollowUp: false, ruleFollowUp: null, recentReactions: [fork.ack ?? ""] });
  ok("…and never the same line twice in a card", !!again.ack && again.ack !== fork.ack, `${fork.ack} / ${again.ack}`);

  /* 12 Oct: the script's own wording keeps the rule the model's must keep —
     "When did they last do it?" was the fallback under a "Still doing it" button. */
  const allScripts = [...Object.values(buildScripts("pasadena")).filter((sc) => (sc as { kind?: string }).kind !== "caregiver"), ...Object.values(subs)] as Array<{ steps: Array<{ id: string; prompt: string; friendPrompt?: string; options?: Array<{ label: string }> }> }>;
  const stillBroken = allScripts.flatMap((sc) =>
    sc.steps.filter((x) => x.options?.some((o) => /^still\b/i.test(o.label)) && ![x.prompt, x.friendPrompt ?? "still"].every((p) => /\bstill\b/i.test(p))).map((x) => `${x.id}: ${x.prompt}`),
  );
  ok("every question with a 'Still…' button asks 'still' in the script's own words", stillBroken.length === 0, stillBroken.join(" | "));

  /* 12 Oct, the quality review. */
  const caveatStep = subs.classes.steps.find((x) => x.id === "caveat")!;
  ok("a follow-up is a question — 'Nothing to flag' is not one", assist.acceptFollowUp("Nothing to flag.", caveatStep) === null && assist.acceptFollowUp("Anything to flag before booking", caveatStep) === null);
  ok("grading the answer, a price verdict, Pando as a parent: not reactions",
    assist.acceptAck("Yes with caveats is honest.") === null &&
      assist.acceptAck("Fair's honest — sounds like it landed in the middle.") === null &&
      assist.acceptAck("Got it, thanks for being straight with me.") === null &&
      assist.acceptAck("That's a meaningful investment for what they get.") === null &&
      assist.acceptAck("I'll remember that if I'm dropping by.") === null);
  ok("a reaction may hold a question of its own, not end in one", assist.acceptAck("Free Lego and an empty room before 11? What a find.") !== null && assist.acceptAck("What made it great?") === null);
  ok("…and a question at its end is cut, the reaction kept", assist.acceptAck("Five is such a good age for swimming. Is he still in the water with them?") === "Five is such a good age for swimming.");
  ok("sympathy is a reaction", assist.acceptAck("Ugh, knocked over twice and nobody stepped in. Sorry.") !== null);
  /* 12 Oct, loosened: a word on the age is what a person says, and two sentences fit. */
  ok("a word on the child's age is a reaction", assist.acceptAck("Seven's a great age for karate.") !== null);
  ok("a reaction runs to thirty words", assist.acceptAck("That's exactly what keeps kids coming back — a teacher who means what they say but cares.") !== null && assist.acceptAck(Array.from({ length: 31 }, (_, i) => `w${i}`).join(" ") + ".") === null);
  const ageAsk = (q: string) => assist.readTurn({ next: { id: "child_age", question: q } }, { script: subs.classes, fields: { name: "X", what_is_it: "math for our daughter", firsthand: "yes" } as never, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next?.prompt;
  ok("an age question that drifted on a stray word is refused", ageAsk("Your kid's in fifth grade now — how's the math going?") !== "Your kid's in fifth grade now — how's the math going?");
  ok("…a quick check of an age they gave is kept", ageAsk("She was two then, right?") === "She was two then, right?");
  const unitAsk = (q: string) => assist.readTurn({ next: { id: "price_unit", question: q } }, { script: subs.camps, fields: { name: "Camp", what_is_it: "camp", firsthand: "yes", child_age: [8], freshness: "this_year", recommendation: "yes", what_makes_it_great: "x".repeat(30), caveat: "book early", location: [], more_detail: "yes", price_band: "over_200" } as never, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next;
  ok("the unit comes straight after the price", unitAsk("Was that per day or per week?")?.id === "price_unit");
  ok("…and names only units its buttons have", unitAsk("Was that per week, or for the whole summer?")?.prompt !== "Was that per week, or for the whole summer?");
  const bandAsk = (q: string) => assist.readTurn({ next: { id: "price_band", question: q } }, { script: subs.classes, fields: { name: "X", what_is_it: "piano", firsthand: "yes", child_age: [7], freshness: "current", recommendation: "yes", what_makes_it_great: "x".repeat(30), caveat: "book early", location: [], more_detail: "yes" } as never, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next?.prompt;
  ok("a price question names no unit when the unit is asked next", bandAsk("Roughly what do you pay each month?") !== "Roughly what do you pay each month?" && bandAsk("Roughly what did you pay for the lessons?") === "Roughly what did you pay for the lessons?");
  const echo = assist.readTurn({ ack: "Counselors who actually play with them — the dream.", next: { id: "location", question: "Which town is it in?" } }, { script: subs.camps, fields: { name: "Camp", what_is_it: "camp", firsthand: "secondhand", child_age: [8], freshness: "this_year", recommendation: "yes", what_makes_it_great: "counselors play with them", caveat: "book early" } as never, lastStep: subs.camps.steps.find((x) => x.id === "caveat")!, mayFollowUp: false, ruleFollowUp: null, recentReactions: ["College counselors who actually engage make a difference."] });
  ok("the same reaction in other words is not said twice", echo.ack === null, String(echo.ack));

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

/* ── 12 Oct, speed: only what the turn reads is asked for, and staged answers asked ahead ── */
{
  const classes = buildSubScripts("pasadena").classes;
  const step = (id: string) => classes.steps.find((x) => x.id === id)!;
  const done = { name: "Green & Bisque", what_is_it: "pottery", firsthand: "yes", child_age: [7], freshness: "current", recommendation: "yes", what_makes_it_great: "x".repeat(30), caveat: "Book early" };
  const forkOnly = assist.candidateSteps(classes, { ...done, location: [] } as never);
  ok("the fork is a fixed sentence, a question is not", assist.isFixedStep(step("more_detail")) && assist.isFixedStep(step("extra_note")) && !assist.isFixedStep(step("caveat")));
  ok("only the fork next: no question is asked of the model, the reaction is", JSON.stringify(assist.turnNeeds(forkOnly, false, false)) === JSON.stringify({ next: false, ack: true, prefill: true }), forkOnly.map((s) => s.id).join());
  ok("a follow-up the rule wants: nothing else is asked of the model", JSON.stringify(assist.turnNeeds(forkOnly, true, false)) === JSON.stringify({ next: false, ack: false, prefill: false }));
  const open = assist.candidateSteps(classes, { name: "Green & Bisque", what_is_it: "pottery" } as never);
  ok("an ordinary turn asks for all of it", JSON.stringify(assist.turnNeeds(open, false, false)) === JSON.stringify({ next: true, ack: true, prefill: true }));
  ok("a classifying turn asks for all of it, even with the rule's follow-up due", JSON.stringify(assist.turnNeeds(open, true, true)) === JSON.stringify({ next: true, ack: true, prefill: true }));
  ok("no candidates is not 'fixed only'", assist.turnNeeds([], false, false).next === true);

  const fork = assist.readTurn({ ack: "Book early — good to know." }, { script: classes, fields: { ...done, location: [] } as never, lastStep: step("location"), mayFollowUp: false, ruleFollowUp: null });
  ok("with no question from the model the fork is said as it is, after its reaction", fork.next?.id === "more_detail" && fork.next.prompt === step("more_detail").prompt && fork.ack === "Book early — good to know.", JSON.stringify(fork));
  const thin = assist.readTurn({ followup: { needed: true, text: "Ooh, what made it fun — the teacher, the other kids?" } }, { script: classes, fields: { ...done, what_makes_it_great: "fun" } as never, lastStep: step("what_makes_it_great"), mayFollowUp: true, ruleFollowUp: "What made it good?" });
  ok("a follow-up-only answer is the follow-up, worded by the model", thin.followup === "Ooh, what made it fun — the teacher, the other kids?" && thin.next === null, JSON.stringify(thin));

  ok("typed text is asked ahead from three characters", assist.worthAskingAhead("fun", 0) && !assist.worthAskingAhead("fu", 0) && !assist.worthAskingAhead("   ", 0));
  ok("a picked age or town is asked ahead, an empty pick is not", assist.worthAskingAhead([4], 0) && assist.worthAskingAhead(["pasadena"], 0) && !assist.worthAskingAhead([], 0));
  ok("at most ASK_AHEAD_PER_QUESTION guesses a question", assist.worthAskingAhead("fun", assist.ASK_AHEAD_PER_QUESTION - 1) && !assist.worthAskingAhead("fun", assist.ASK_AHEAD_PER_QUESTION));
  ok("a tap waits less than a pause in typing", assist.ASK_AHEAD_PAUSE_MS.picked < assist.ASK_AHEAD_PAUSE_MS.typed);
}

/* ── a town question never offers a place of its own (12 Oct, "the area near Old Town") ── */
{
  const sp = buildSubScripts("pasadena").places;
  const f = { name: "Brookside Park", what_is_it: "a big park with a splash pad near our house in Altadena", firsthand: "yes", child_age: [4], freshness: "recent", recommendation: "yes", what_makes_it_great: "shade", caveat: "no bathrooms" } as never;
  const ask = (q: string) => assist.readTurn({ next: { id: "location", question: q } }, { script: sp, fields: f, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next?.prompt;
  ok("a guessed area is refused", ask("Which part of town is the park in, the area near Old Town, or somewhere else?") !== "Which part of town is the park in, the area near Old Town, or somewhere else?");
  ok("…the card's own name is fine", ask("Which town is Brookside Park in?") === "Which town is Brookside Park in?");
  ok("…a town they said is a fair check", ask("Is it in the Altadena area?") === "Is it in the Altadena area?");
}

/* ── the parent's own area on the town question (12 Oct) ── */
{
  const sp = buildSubScripts("pasadena", [], "altadena").places;
  const loc = sp.steps.find((x) => x.id === "location")!;
  ok("their own area is the first town chip", loc.options?.[0]?.label === "Altadena", loc.options?.[0]?.label);
  const f = { name: "Brookside Park", what_is_it: "a park", firsthand: "yes", child_age: [4], freshness: "recent", recommendation: "yes", what_makes_it_great: "shade", caveat: "no bathrooms", best_for: [] } as never;
  const turn = (raw: object, hasArea: boolean) => assist.readTurn(raw, { script: sp, fields: f, lastStep: null, mayFollowUp: false, ruleFollowUp: null, hasArea });
  const t = assist.AREA_TOKEN;
  ok("the town question may offer it", turn({ next: { id: "location", question: `Is it in ${t}, near you, or somewhere else?` } }, true).next?.prompt.includes(t) === true);
  ok("…and offers it when the model gave no wording", turn({}, true).next?.prompt === assist.AREA_PROMPT);
  ok("…never without an area to fill", !(turn({ next: { id: "location", question: `Is it in ${t}?` } }, false).next?.prompt ?? "").includes(t));
  ok("never in a reaction", turn({ ack: `Oh, ${t} is lovely.`, next: { id: "location", question: "Which town is it in?" } }, true).ack === null);
  ok("filled on the device", assist.fillArea(`Is it in ${t}, near you?`, "Altadena") === "Is it in Altadena, near you?" && assist.fillArea(`Is it in ${t}?`, null) === null);
  /* A town they named on the card wins over their profile's (12 Oct, the developer). */
  const said = { ...(f as object), what_is_it: "a park with a splash pad in Eagle Rock" } as never;
  const sayTurn = (raw: object) => assist.readTurn(raw, { script: sp, fields: said, lastStep: null, mayFollowUp: false, ruleFollowUp: null, hasArea: true });
  ok("a town they named comes first", sayTurn({}).next?.prompt === "Is it in Eagle Rock, like you said, or somewhere else?", sayTurn({}).next?.prompt);
  ok("…their profile's area is refused then", !(sayTurn({ next: { id: "location", question: `Is it in ${t}, near you?` } }).next?.prompt ?? "").includes(t));
  const conv = assist.conversationOf([{ id: "1", role: "parent", text: "A place" }, { id: "2", role: "pando", text: "Is it in Altadena, near you?" }] as never, "A place", null, undefined, "Altadena");
  ok("the area goes back as its token in Pando's lines", conv[0]?.text === `Is it in ${t}, near you?`, conv[0]?.text);
}

/* ── the card's name in the script's own words and the canned follow-ups (12 Oct) ── */
{
  const engine = (await import(`../lib/seed-chat/engine.ts?v=${Date.now()}`)) as typeof import("../lib/seed-chat/engine.ts");
  const sc = buildSubScripts("pasadena").classes;
  const step = (id: string) => sc.steps.find((x) => x.id === id)!;
  const f = { name: "Splash Academy" } as never;
  ok("who it is for, named", engine.canonicalPrompt(step("who_for"), f) === "Who is Splash Academy perfect for?", engine.canonicalPrompt(step("who_for"), f));
  ok("the town, named", engine.canonicalPrompt(step("location"), f) === "Which town is Splash Academy in?");
  ok("the price, named", engine.canonicalPrompt(step("price_band"), f) === "Roughly what did you pay for Splash Academy?");
  ok("a step where the name would not read is left alone", engine.canonicalPrompt(step("firsthand"), f) === step("firsthand").prompt);
  const doc = buildSubScripts("pasadena").specialists.steps.find((x) => x.id === "who_for")!;
  ok("'are they' becomes 'is'", engine.canonicalPrompt(doc, { name: "Mr. Ortiz" } as never).startsWith("Who is Mr. Ortiz"), engine.canonicalPrompt(doc, { name: "Mr. Ortiz" } as never));
  ok("a canned follow-up carries the name", engine.withThing("Which town is {thing|it} in?", f) === "Which town is Splash Academy in?");
  ok("…or reads without one", engine.withThing("Anything before heading {to thing|there}?", {} as never) === "Anything before heading there?" && engine.withThing("Anything before heading {to thing|there}?", f) === "Anything before heading to Splash Academy?");
}

/* ── no gender the parent never gave (12 Oct: "given your son was eight") ── */
{
  const sp = buildSubScripts("pasadena").products;
  const f = { what_is_it: "Kids Shampoo Paraben Sulfate Free", name: "Kids Shampoo", firsthand: "yes", child_age: [8] } as never;
  const q = "Would you recommend Kids Shampoo to other parents, given your son was eight?";
  const t = assist.readTurn({ ack: "Eight is when he starts caring about his hair.", next: { id: "recommendation", question: q } }, { script: sp, fields: f, lastStep: sp.steps.find((x) => x.id === "child_age")!, mayFollowUp: false, ruleFollowUp: null });
  ok("a son nobody mentioned is refused in the question", t.next?.prompt !== q, String(t.next?.prompt));
  ok("…and in the reaction", t.ack === null, String(t.ack));
  const said = { ...(f as object), what_is_it: "Kids shampoo, our son has sensitive skin" } as never;
  ok("…but kept once the parent said it", assist.readTurn({ next: { id: "recommendation", question: q } }, { script: sp, fields: said, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next?.prompt === q);
  const tutor = buildSubScripts("pasadena").specialists;
  ok("…and a pronoun about a titled provider is fine", assist.readTurn({ next: { id: "recommendation", question: "Would you recommend him to other parents?" } }, { script: tutor, fields: { name: "Mr. Ortiz", used_for: "math tutoring" } as never, lastStep: null, mayFollowUp: false, ruleFollowUp: null }).next?.prompt === "Would you recommend him to other parents?");
}

/* ── a skipped town is asked once more (12 Oct, the developer) ── */
{
  const followUp = (await import(`../lib/seed-chat/follow-up.ts?v=${Date.now()}`)) as typeof import("../lib/seed-chat/follow-up.ts");
  const all = { ...buildScripts("pasadena"), ...buildSubScripts("pasadena") } as Record<string, { steps: Array<{ id: string; followUp?: unknown }> }>;
  const without = Object.entries(all).filter(([k, sc]) => k !== "caregiver" && k !== "tip" && k !== "tips" && k !== "products" && sc.steps.some((x) => x.id === "location") && !sc.steps.find((x) => x.id === "location")!.followUp).map(([k]) => k);
  ok("every town question carries a follow-up", without.length === 0, without.join(", "));
  const doc = buildSubScripts("pasadena", [], "altadena").doctors;
  const loc = doc.steps.find((x) => x.id === "location")!;
  ok("a skipped town is followed up", followUp.followUpFor("doctor", loc, [], {}) !== null);
  ok("…a picked one is not", followUp.followUpFor("doctor", loc, ["altadena"], {}) === null);
  ok("…nor twice", followUp.followUpFor("doctor", loc, [], { __fu_location: "yes" } as never) === null);
  const f = { name: "Dr. Kim", used_for: "checkups", location: [] } as never;
  const turn = (raw: object, hasArea: boolean) => assist.readTurn(raw, { script: doc, fields: f, lastStep: loc, mayFollowUp: true, ruleFollowUp: "Even roughly helps — which town?", hasArea });
  ok("…asking openly — their area was already offered", turn({}, true).followup === "Even roughly helps — which town?");
  ok("…never the area token in a follow-up", !(turn({ followup: { needed: true, text: `Is it near you in ${assist.AREA_TOKEN}?` } }, true).followup ?? "").includes(assist.AREA_TOKEN));
  ok("…and about the town, not something else", turn({ followup: { needed: true, text: "Do you know roughly how much the belt tests cost?" } }, false).followup === "Even roughly helps — which town?");
  ok("…never a place they did not name", !(turn({ followup: { needed: true, text: "Is it in Old Town, near the shops?" } }, true).followup ?? "").includes("Old Town"));
  ok("…no area token without an area", !(turn({ followup: { needed: true, text: `Is it near you in ${assist.AREA_TOKEN}?` } }, false).followup ?? "").includes(assist.AREA_TOKEN));
}

/* ── "N of M" (12 Oct, the developer: wrong after "That's it") ── */
{
  const engine = (await import(`../lib/seed-chat/engine.ts?v=${Date.now()}`)) as typeof import("../lib/seed-chat/engine.ts");
  type S = { id: string; widget: string; when?: (f: Record<string, unknown>) => boolean; options?: Array<{ id: string }> };
  /** Walk a script in its own order, answering each open step with `pick`. */
  const walk = (script: { steps: S[] }, pick: (s: S) => unknown) => {
    const fields: Record<string, unknown> = {};
    const totals: number[] = [];
    let last = { current: 0, total: 0 };
    for (const s of script.steps) {
      if (s.when && !s.when(fields)) continue;
      last = engine.progressOf(script as never, fields as never, 0);
      totals.push(last.total);
      fields[s.id] = pick(s);
    }
    return { totals, last };
  };
  const answer = (choice: Record<string, string>) => (s: S) =>
    choice[s.id] ?? (s.widget === "ages" ? [5] : s.options ? s.options[0].id : s.widget === "chips" ? [] : "some words here");
  const all = { ...buildScripts("pasadena"), ...buildSubScripts("pasadena") } as unknown as Record<string, { steps: S[] }>;
  const grew: string[] = [];
  const offAtEnd: string[] = [];
  for (const [name, sc] of Object.entries(all)) {
    for (const choice of [{ more_detail: "no" }, { more_detail: "yes" }, { more_detail: "no", recommendation: "no", hire_again: "no" }] as Array<Record<string, string>>) {
      const { totals, last } = walk(sc, answer(choice));
      if (totals.some((t, i) => i > 0 && t > totals[i - 1])) grew.push(`${name} ${JSON.stringify(choice)}: ${totals.join(",")}`);
      if (last.current !== last.total) offAtEnd.push(`${name} ${JSON.stringify(choice)}: ${last.current} of ${last.total}`);
    }
  }
  ok("the total never grows mid-card, whatever the answers", grew.length === 0, grew.slice(0, 3).join(" | "));
  ok("the last question reads N of N — after That's it too", offAtEnd.length === 0, offAtEnd.slice(0, 3).join(" | "));
  const classes = all.classes;
  const before = engine.progressOf(classes as never, { name: "x" } as never, 0).total;
  ok("before the fork the detail block is still counted", before === classes.steps.length, `${before} vs ${classes.steps.length}`);
}

console.log(`\n  ${passed} checks passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);
