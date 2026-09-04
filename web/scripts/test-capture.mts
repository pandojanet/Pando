import type { CaptureStep } from "../lib/capture.ts";

/**
 * M10.1 — adding a recommendation over SMS.
 *
 * The load-bearing check in this file is the one that says a caregiver is
 * **refused**: invariants 14, 2 and 12 are three gates a text message cannot
 * honestly pass, and a capture that quietly built a caregiver record anyway
 * would break all three without anything failing.
 */

const c = (await import(`../lib/capture.ts?v=${Date.now()}`)) as typeof import("../lib/capture.ts");

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

/** Walk the whole script the way a parent would. */
const walk = (replies: string[]) => {
  const answers: Record<string, unknown> = {};
  for (const reply of replies) {
    const step = c.nextStep(answers);
    if (!step) break;
    const read = c.readAnswer(step, reply);
    if (!read.ok) return { answers, stuckAt: step };
    answers[step] = "skipped" in read ? null : read.value;
  }
  return { answers, stuckAt: null as CaptureStep | null };
};

console.log("\n=== the script asks one thing at a time ===");
ok("it starts at the kind", c.nextStep({}) === "kind");
ok(
  "every question is a single question",
  c.CAPTURE_STEPS.every((s) => (c.CAPTURE_QUESTIONS[s].prompt.match(/\?/g) ?? []).length <= 1),
  "two in a text get one answer back, and then Pando has to guess which",
);
ok(
  "and every prompt names the service first",
  c.CAPTURE_STEPS.every((s) => c.CAPTURE_QUESTIONS[s].prompt.startsWith("Pando:")),
);
ok("there are five", c.CAPTURE_STEPS.length === 5, c.CAPTURE_STEPS.join(" -> "));

console.log("\n=== a whole capture ===");
const done = walk(["class", "Aveson Music", "used", "yes", "great teacher, small group"]);
ok("it completes", c.nextStep(done.answers) === null && done.stuckAt === null);
const card = c.cardFrom(done.answers);
ok("and becomes a card", card !== null);
ok("with the kind stored as share_kind", card?.kind === "activity");
ok("the name as typed", card?.name === "Aveson Music");
ok("firsthand true", card?.firsthand === true);
ok("the recommendation", card?.recommendation === "yes");
ok("and the detail", card?.detail === "great teacher, small group");

console.log("\n=== the kinds are share_kind exactly ===");
/**
 * `share_kind` has four members and **camp is not one of them** — camps are a
 * first-class *taxonomy* category (§8.4/§15.3) and have never been a share kind.
 * A capture offering `camp` as a value would fail on the enum at runtime, with a
 * clean typecheck and green tests: the `bands` shape of bug.
 */
const KINDS = ["activity", "caregiver", "place", "tip"];
ok(
  "every option stores a real share_kind",
  (c.CAPTURE_QUESTIONS.kind.options ?? []).every((o) => KINDS.includes(o.value)),
  (c.CAPTURE_QUESTIONS.kind.options ?? []).map((o) => o.value).join(","),
);
ok(
  "a camp is accepted as a word and stored as an activity",
  c.readAnswer("kind", "camp").ok &&
    (c.readAnswer("kind", "camp") as { value: string }).value === "activity",
);
ok(
  "and no option offers caregiver",
  !(c.CAPTURE_QUESTIONS.kind.options ?? []).some((o) => o.value === "caregiver"),
  "it is refused, not collected badly",
);

console.log("\n=== a caregiver is refused and handed on ===");
for (const word of ["nanny", "I want to recommend our sitter", "AU PAIR", "babysitter"]) {
  ok(`"${word}" is recognised as a caregiver`, c.mentionsCaregiver(word));
}
ok("and an ordinary class is not", !c.mentionsCaregiver("a swim class at the Y"));
const redirect = c.caregiverRedirectSms();
ok("the redirect points at /share", redirect.includes("pando.is/share"));
ok(
  "not at /caregiver",
  !redirect.includes("/caregiver"),
  "that is where a caregiver signs themselves up — a different flow entirely",
);
ok(
  "it says why, rather than saying no",
  /employed them yourself/.test(redirect),
  "a parent offering this is doing the most valuable thing in the product",
);
ok("STOP and HELP last, as registered", /Reply STOP to opt out, HELP for help\.$/.test(redirect));

console.log("\n=== firsthand is asked, never assumed ===");
ok("USED is firsthand", c.readAnswer("firsthand", "used").ok);
ok(
  "HEARD is stored as secondhand rather than refused",
  (c.readAnswer("firsthand", "heard") as { value: string }).value === "no",
  "secondhand is welcome and labelled; it is never enough for a trust label alone",
);
ok(
  "and it cannot be skipped",
  c.CAPTURE_QUESTIONS.firsthand.skippable !== true,
  "every trust label rests on somebody having been there",
);
ok(
  "a card with no firsthand answer is not a card",
  c.cardFrom({ kind: "activity", name: "X", recommend: "yes" }) === null,
);

console.log("\n=== the caveat survives ===");
ok(
  "YES BUT is its own answer",
  (c.readAnswer("recommend", "yes but") as { value: string }).value === "yes_with_caveats",
  "collapsing it into a yes is what would make Vouched meaningless",
);
ok("and NO is kept", (c.readAnswer("recommend", "no") as { value: string }).value === "no");
ok(
  "there are three answers, not two",
  new Set((c.CAPTURE_QUESTIONS.recommend.options ?? []).map((o) => o.value)).size === 3,
);

console.log("\n=== the parser refuses to guess ===");
ok("an unlisted word on a closed step is not read", !c.readAnswer("kind", "a music thing").ok);
ok("nor on the recommend step", !c.readAnswer("recommend", "it depends").ok);
ok("a free-text step takes what was written", c.readAnswer("name", "Kidspace").ok);
ok("but not an empty one", !c.readAnswer("name", "   ").ok);
ok(
  "a very long detail is capped rather than dropped",
  ((c.readAnswer("detail", "x".repeat(900)) as { value: string }).value ?? "").length === 500,
  "silently discarding it would hide text from the reviewer",
);

console.log("\n=== skipping is an answer ===");
const skipped = walk(["place", "Hahamongna", "used", "yes", "skip"]);
ok("SKIP finishes the capture", c.nextStep(skipped.answers) === null);
ok("and stores null, not absence", skipped.answers.detail === null);
ok(
  "so the question is not asked again forever",
  c.nextStep({ ...skipped.answers }) === null,
  "an absent key means not-asked-yet to nextStep",
);
ok("the card is still valid", c.cardFrom(skipped.answers)?.detail === null);
ok(
  "and only the last step may be skipped",
  c.CAPTURE_STEPS.filter((s) => c.CAPTURE_QUESTIONS[s].skippable).join(",") === "detail",
);

console.log("\n=== starting and stopping ===");
ok("ADD starts one", c.isCaptureStart("add"));
ok("RECOMMEND does too", c.isCaptureStart("Recommend"));
ok(
  '"add me to the list" does not',
  !c.isCaptureStart("add me to the list"),
  "exact on the whole message, like every other parser here",
);
ok("CANCEL stops one", c.isCaptureCancel("cancel"));
ok('"never mind" too', c.isCaptureCancel("never mind"));
ok("and an ordinary answer does not", !c.isCaptureCancel("Aveson Music"));

console.log("\n=== the closing message promises nothing ===");
const saved = c.captureSavedSms("Aveson Music");
ok("it names what was saved", saved.includes("Aveson Music"));
ok(
  "and says a person reads it first",
  /person reads/.test(saved),
  "a contribution enters the graph only after approval — the parent should not expect otherwise",
);
ok("STOP and HELP last", /Reply STOP to opt out, HELP for help\.$/.test(saved));

console.log("\n=== SKIP belongs to the capture only where it is accepted ===");
{
  /* `SKIP` is a PASS keyword *and* the word the last capture question asks
     for by name, and the keyword block runs first — so the word reached
     `recordPass` and the card five answers had gone into was never written.
     The pipeline diverts it to the capture, and these two rules are what stop
     that fix from causing the opposite fault. */
  ok(
    "the last question accepts it",
    c.readsAsSkip("detail", "SKIP") && c.readsAsSkip("detail", "skip."),
  );
  ok(
    "the name question does not",
    !c.readsAsSkip("name", "SKIP"),
    "at `name` it would be stored as the record's name",
  );
  ok("nor does a closed step", !c.readsAsSkip("kind", "SKIP"));
  ok(
    "PASS is never a capture skip",
    !c.readsAsSkip("detail", "PASS"),
    "so a mid-capture PASS still reaches the Network Ask it answers",
  );
  ok(
    "and the cheap pre-check agrees",
    c.isSkipWord("SKIP") && c.isSkipWord("none") && !c.isSkipWord("PASS"),
    "it is what keeps an ordinary PASS from querying the database",
  );
}

console.log("\n=== offering something is not the same as asking about it ===");
{
  /* The distinction the caregiver refusal turns on, and it was missing: a
     parent who texted "I want to add our nanny Marisol" with no capture open
     sailed past the redirect and came back a queued answer. A nomination in
     the answers queue is a nomination nobody processes properly. */
  ok("an offer is recognised", c.offersSomething("I want to add our nanny Marisol"));
  ok("in any of the capture verbs", c.offersSomething("I would recommend our sitter Ana"));
  ok(
    "a question about the same subject is not",
    !c.offersSomething("any good nannies near Altadena?"),
  );
  ok(
    "and neither is asking for help finding one",
    !c.offersSomething("we need a nanny three days a week"),
    "the obvious inverse test — is it question-shaped — fails on exactly this",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
