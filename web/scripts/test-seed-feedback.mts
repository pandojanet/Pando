import type { Option, ProfileAnswers, Question, QuestionId } from "../lib/types.ts";

/**
 * The 1 Sep client feedback, as checks.
 *
 * Every item she reported was in the questionnaire *data* rather than in a
 * component, and every one of them was visible only to somebody tapping through
 * the screens — a duplicate chip, a cap that did not bite, an instruction that
 * contradicted the hint underneath it. Nothing threw, and nothing would.
 *
 * So the rules are pinned here by her item number. A future session reading only
 * an older document cannot quietly restore any of them.
 */

const q = (await import(`../lib/questions.ts?v=${Date.now()}`)) as typeof import("../lib/questions.ts");

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

const screenById = (id: string) => q.SCREENS.find((s) => s.id === id);
const questionById = (id: QuestionId): Question | undefined => {
  for (const s of q.SCREENS) {
    const found = s.questions.find((x) => x.id === id);
    if (found) return found;
  }
  return undefined;
};
const optionsOf = (id: QuestionId): Option[] => {
  const question = questionById(id);
  if (!question || question.source.type !== "static") return [];
  return question.source.options;
};

console.log("\n=== universal 1: one “Something else”, never two ===");
/**
 * Her words: *"Remove the duplicate 'Something else' option wherever it appears.
 * Keep only '+ Something else,' which opens a short optional field."*
 *
 * Both existed on all five of the questions she names — a chip storing an id
 * that means nothing, beside the field that actually captures the answer.
 */
const FIVE: QuestionId[] = [
  "family_structure",
  "work_setup",
  "childcare_now",
  "childcare_backup",
  "logistics",
];
for (const id of FIVE) {
  ok(
    `${id} has no “Something else” chip`,
    !optionsOf(id).some((o) => o.id === "something_else"),
  );
}
ok(
  "and each still offers the typed field",
  FIVE.every((id) => questionById(id)?.allowOther === true),
  "removing the chip must not remove the answer",
);
ok(
  "labelled with the + that says it opens something",
  FIVE.every((id) => questionById(id)?.otherLabel === "+ Something else"),
  FIVE.map((id) => questionById(id)?.otherLabel).join(" | "),
);

console.log("\n=== item 8: “Parenting on my own” clears the partner answers ===");
const own = optionsOf("family_structure").find((o) => o.id === "parenting_on_my_own");
ok("it names what it clears", Array.isArray(own?.clears), JSON.stringify(own?.clears));
ok(
  "both partner answers",
  (own?.clears ?? []).includes("partner_in_household") &&
    (own?.clears ?? []).includes("co_parenting_across_households"),
);
ok(
  "and it is NOT exclusive",
  own?.exclusive !== true,
  "a parent on their own can have a blended family and a grandmother in the house",
);
ok(
  "blended family and a family caregiver survive it",
  !(own?.clears ?? []).includes("blended_family") &&
    !(own?.clears ?? []).includes("family_caregiver_involved"),
);

console.log("\n=== items 8, 9, 11, 12: “Prefer not to say” clears the page ===");
for (const id of FIVE) {
  const pnts = optionsOf(id).find((o) => o.id === "prefer_not_to_say");
  ok(`${id} — exclusive`, pnts?.exclusive === true, pnts ? "" : "no option at all");
}
const backup = optionsOf("childcare_backup").find((o) => o.id === "no_reliable_backup");
ok(
  "“No reliable backup childcare” clears the page too",
  backup?.exclusive === true,
  "it is a statement that none of the others apply — item 11",
);

console.log("\n=== items 5 and 10: “One per child” is gone ===");
/**
 * Item 10 gives the reason that settles it: the hint *"directly contradicts
 * 'Select all that apply'."* A child can do gymnastics and swimming, and can
 * have preschool in the morning and a sitter after.
 */
const twoKids: ProfileAnswers = { ...q.EMPTY_ANSWERS, child_ages: [2, 7] };
for (const id of ["classes", "camps", "childcare_now"] as QuestionId[]) {
  const question = questionById(id)!;
  ok(
    `${id} — no per-child ceiling`,
    q.maxSelectionsFor(question, twoKids) === undefined,
    `got ${q.maxSelectionsFor(question, twoKids)}`,
  );
  ok(
    `${id} — and no hint claiming one`,
    q.maxSelectionHint(question, twoKids) === undefined,
  );
}
ok(
  "but a school is still capped, because that question asks for it",
  q.maxSelectionsFor(questionById("schools")!, twoKids) === 4,
  "two each for two children — “Former counts” is that screen's own invitation",
);
ok(
  "and the default is now uncapped, so a new per-child question is not silently limited",
  q.maxSelectionsFor(
    { ...questionById("classes")!, perChild: true, perChildLimit: undefined },
    twoKids,
  ) === undefined,
);

console.log("\n=== items 4 and 10: asked separately for each child ===");
/**
 * The old shape asked once for the household and attributed **backwards** — a
 * "whose is it?" row under every selection. Her instruction's subject is
 * *"separately for each child"*, which that did not do, and the chip list was
 * the union of every age band the family covered: a toddler and a teenager
 * produced one list of preschools and high schools.
 */
const family: ProfileAnswers = { ...q.EMPTY_ANSWERS, child_ages: [1, 9] };
const schoolBlocks = q.childBlocks(questionById("schools")!, "pasadena", family);
ok("there is a block per child", schoolBlocks.length === 2, `${schoolBlocks.length}`);
ok(
  "each names the child by birth year, in her words",
  schoolBlocks.every((b) => /Where does your child born in \d{4} currently go\?/.test(b.heading)),
  schoolBlocks.map((b) => b.heading).join(" | "),
);
const careBlocks = q.childBlocks(questionById("childcare_now")!, "pasadena", family);
ok(
  "the one-year-old's care block offers no after-school program",
  !careBlocks[0].options.some((o) => o.id === "after_school_program"),
  careBlocks[0].options.map((o) => o.id).join(","),
);
ok(
  "the nine-year-old's does",
  careBlocks[1].options.some((o) => o.id === "after_school_program"),
  "which is the whole reason the repetition is worth a screen",
);
ok(
  "a one-child family is not repeated",
  q.childBlocks(questionById("schools")!, "pasadena", {
    ...q.EMPTY_ANSWERS,
    child_ages: [4],
  }).length === 0,
  "there is nothing to repeat, so it renders as it always did",
);
ok(
  "and no other question is",
  q.childBlocks(questionById("classes")!, "pasadena", family).length === 0,
  "item 5 declined extra work on the circles page in so many words",
);

console.log("\n=== the attribution arithmetic ===");
/* Written forward now. The storage shape is unchanged, which is what made this
   a rendering change rather than a migration. */
const step1 = q.applyChildSelections(questionById("childcare_now")!, family, 1, ["daycare"]);
ok("one child's choice lands", step1.values.join(",") === "daycare");
ok("owned by that child only", JSON.stringify(step1.attribution.daycare) === "[1]");

const afterStep1: ProfileAnswers = {
  ...family,
  childcare_now: step1.values,
  child_of: { childcare_now: step1.attribution },
};
const step2 = q.applyChildSelections(questionById("childcare_now")!, afterStep1, 9, [
  "daycare",
  "after_school_program",
]);
ok(
  "the other child can share it",
  JSON.stringify(step2.attribution.daycare) === "[1,9]",
  JSON.stringify(step2.attribution),
);
ok("and add their own", step2.attribution.after_school_program?.join(",") === "9");

const afterStep2: ProfileAnswers = {
  ...family,
  childcare_now: step2.values,
  child_of: { childcare_now: step2.attribution },
};
const step3 = q.applyChildSelections(questionById("childcare_now")!, afterStep2, 1, []);
ok(
  "untapping one child leaves the other's answer standing",
  step3.attribution.daycare?.join(",") === "9",
  JSON.stringify(step3.attribution),
);
ok(
  "and an option nobody owns is removed entirely",
  !step3.values.includes("nanny") &&
    Object.values(step3.attribution).every((owners) => owners.length > 0),
);
const step4 = q.applyChildSelections(questionById("childcare_now")!, afterStep2, 9, []);
ok(
  "clearing the last owner drops the option",
  !step4.values.includes("after_school_program"),
  step4.values.join(","),
);
ok(
  "a block never touches a sibling it does not mention",
  step4.attribution.daycare?.includes(1) === true,
  "the 1-year-old still has daycare after the 9-year-old's block was cleared",
);

console.log("\n=== item 10's shortcut ===");
ok(
  "only the care question offers it",
  typeof questionById("childcare_now")?.sameForAll === "string" &&
    questionById("schools")?.sameForAll === undefined,
  "siblings share a nanny; they do not share a school",
);
const shared = q.sameForAllChildren(questionById("childcare_now")!, afterStep2);
ok(
  "it gives every child everything already named",
  Object.values(shared.attribution).every((owners) => owners.length === 2),
  JSON.stringify(shared.attribution),
);
ok(
  "built from the union, so nothing a parent typed is discarded",
  shared.values.includes("daycare") && shared.values.includes("after_school_program"),
);

console.log("\n=== items 12 and 14: three is a hard maximum ===");
ok("practical priorities cap at 3", q.maxSelectionsFor(questionById("logistics")!, twoKids) === 3);
ok("trust priorities cap at 3", q.maxSelectionsFor(questionById("trust_circles")!, twoKids) === 3);
/* Her report was four and five *selected* — saved state that predated the caps. */
const overCap: ProfileAnswers = {
  ...q.EMPTY_ANSWERS,
  child_ages: [3],
  logistics: ["easy_parking", "weekday_flexibility", "weekend_friendly", "budget_friendly"],
  trust_circles: [
    "same_school",
    "same_neighborhood",
    "same_classes",
    "parent_group",
    "private_club",
  ],
};
const pruned = q.pruneAnswers(overCap);
ok(
  "four saved priorities become three",
  pruned.logistics.length === 3,
  `${pruned.logistics.length}: ${pruned.logistics.join(",")}`,
);
ok(
  "five saved trust circles become three",
  pruned.trust_circles.length === 3,
  `${pruned.trust_circles.length}`,
);
ok(
  "and the earliest choices are the ones kept",
  pruned.logistics[0] === "easy_parking",
  "they were made deliberately, before the screen stopped refusing taps",
);

console.log("\n=== universal 2: a retired option is dropped, a split one is kept ===");
const stale: ProfileAnswers = {
  ...q.EMPTY_ANSWERS,
  child_ages: [3],
  family_structure: ["partner_in_household", "something_else"],
  topics_lived: ["postpartum_first_year", "sleep_routines"],
};
const cleaned = q.pruneAnswers(stale);
ok(
  "the removed “Something else” chip is dropped",
  !cleaned.family_structure.includes("something_else"),
  "it would otherwise render as a raw slug on the review screen",
);
ok("and the real answer beside it survives", cleaned.family_structure.includes("partner_in_household"));
ok(
  "a *split* option keeps its answer",
  cleaned.topics_lived.includes("postpartum_first_year"),
  "the parent said something true and the list changed underneath them",
);
ok(
  "and it still has words rather than a slug",
  q.labelForOption(questionById("topics_lived")!, "pasadena", cleaned, "postpartum_first_year") !==
    "postpartum_first_year",
);
ok(
  "pruning nothing returns the same object",
  q.pruneAnswers(q.EMPTY_ANSWERS) === q.EMPTY_ANSWERS,
  "so a clean session does not churn local storage on every load",
);

console.log("\n=== item 17: the parenting-experience list ===");
const lived = optionsOf("topics_lived").map((o) => o.id);
ok(
  "pregnancy and newborn care are two topics",
  lived.includes("pregnancy_postpartum") && lived.includes("newborn_infant_care"),
  "the old single option overlapped with sleep, feeding and development",
);
ok("and the merged one is no longer offered", !lived.includes("postpartum_first_year"));
ok(
  "co-parenting and parenting alone are two topics",
  lived.includes("co_parenting_across_households") && lived.includes("parenting_on_my_own"),
  "materially different experiences — her words",
);
ok("and the merged one is no longer offered", !lived.includes("co_parenting_or_solo"));
ok(
  "there is a typed “Something else”",
  questionById("topics_lived")?.otherLabel === "+ Something else",
);
ok(
  "the opt-out is exclusive",
  optionsOf("topics_lived").find((o) => o.id === "no_parenting_questions")?.exclusive === true,
  "it must pause the whole category, not sit beside three chosen topics",
);
ok(
  "the screen is required, so Skip is not needed",
  questionById("topics_lived")?.required === true,
  "her instruction: Continue activates once a topic or the opt-out is chosen",
);
/**
 * 2 Sep — the descriptive box is off the profile pages, on the client's
 * instruction, and on this screen that box was the topic-level consent she
 * dictated on 1 Sep. So the assertion inverts: it is no longer on the screen,
 * and this check exists to make sure a future session does not put it back
 * without her asking, or remove the screen's own `help` line as well.
 */
ok(
  "the descriptive box is gone from the parenting-experiences screen",
  screenById("topics_lived")?.footnote === undefined,
  "her 2 Sep instruction — the consent is now made by selecting a topic",
);
ok(
  "and the screen still says the parent decides whether to answer",
  /decide whether to answer/.test(screenById("topics_lived")?.help ?? ""),
  "the one part of the removed footnote a parent acted on",
);
ok(
  "the local-topics screen has no box either",
  screenById("topics")?.footnote === undefined,
);

console.log("\n=== the listening-ear page is gone ===");
ok(
  "no screen asks it",
  screenById("listening_ear") === undefined,
  "her recommendation: unnecessary once the topics page is the opt-in",
);
ok(
  "and the parenting-experiences page is what asks it now",
  optionsOf("topics_lived").length > 0 && questionById("topics_lived")?.required === true,
  "selecting a topic is the opt-in; the screen no longer explains that in a box",
);

console.log("\n=== item 18: participation is chosen, never assumed ===");
ok(
  "nothing is preselected",
  q.EMPTY_ANSWERS.allowance === null,
  `got ${JSON.stringify(q.EMPTY_ANSWERS.allowance)}`,
);
ok(
  "and the choice is required",
  questionById("allowance")?.required === true,
  "“Agree & Join Pando should remain disabled until a level is selected”",
);
const levels = optionsOf("allowance");
ok("there are three levels", levels.length === 3, levels.map((o) => o.id).join(","));
/**
 * 9 Sep — the same three instructions, now carried by the comparison layout
 * rather than by two words appended to a label. Her rules did not change; where
 * they live did, so these assert the fields the screen actually renders.
 */
ok(
  "the minimum is named as required",
  /required minimum/i.test(levels[0]?.plan?.participation ?? ""),
  levels[0]?.plan?.participation,
);
ok(
  "the middle one is Recommended, not “most popular”",
  levels[1]?.recommended === true &&
    !/popular/i.test(JSON.stringify(levels[1] ?? {})),
  "“Do not call it ‘Most popular’ without supporting usage data”",
);
ok(
  "every level answers all three of her rows, benefits included where written",
  levels.every((o) => o.plan?.participation && o.plan?.questions),
  "Participation · Questions · Benefits, one column each",
);
ok(
  "and no benefit was invented for the level she has not written one for",
  levels[0]?.plan?.benefits === undefined,
  "“Janet прямо сказала, що ще дасть benefits” — the cell stays empty",
);
ok(
  "48 hours is stated on the screen",
  /48 hours/.test(screenById("allowance")?.help ?? ""),
);
ok(
  "and the benefit is new outreach, never access to what Pando already knows",
  /ask the community/i.test(levels[1]?.plan?.benefits ?? "") &&
    !/access/i.test(levels[1]?.plan?.benefits ?? ""),
  "“Do not restrict access to useful information Pando already has”",
);

console.log("\n=== item 6: the privacy screen ===");
const privacy = screenById("privacy_disclosure");
ok("the heading is about connections", privacy?.title === "How Pando uses your connections");
ok(
  "the sentence about contact information is restored",
  (privacy?.statement?.bodyAfter ?? []).some((p) =>
    /contact information stay private unless you separately agree to an introduction/.test(p),
  ),
  "it was in her 24 Aug block and never reached the screen",
);
ok(
  "it asks nothing, so Continue cannot be consent",
  (privacy?.questions ?? []).length === 0,
);
ok(
  "and nothing a parent skips grants a connection",
  q.EMPTY_ANSWERS.shared_affiliations.length === 0 &&
    q.EMPTY_ANSWERS.shared_connections === null,
);

console.log("\n=== item 2: one route out of the town list ===");
const hood = q.searchableCategory(questionById("neighborhood")!);
ok("the search box is the only fallback", questionById("neighborhood")?.allowOther !== true);
ok(
  "the stranded “Other nearby area” label is gone",
  questionById("neighborhood")?.otherLabel === undefined,
);
ok("her search label", hood?.searchLabel === "Can’t find yours? Search for a town or neighborhood.");
ok(
  "and the town list is never filtered by the town you just picked",
  hood?.wholeList === true,
  "see lib/starters.ts — this is the circularity that hid five of them",
);

console.log("\n=== items 3, 7 and 10: already right, and asserted so ===");
ok(
  "birth years are multi-select",
  questionById("child_ages")?.kind === "ages",
  " is the dedicated multi-select kind — a family with three children needs three",
);
ok(
  "“Expecting” sits alongside a real child",
  q.BIRTH_YEAR_OPTIONS.find((o) => o.label === "Expecting")?.exclusive !== true,
);
ok(
  "“I grew up in this area” is its own question",
  questionById("grew_up_here") !== undefined &&
    questionById("time_in_area") !== undefined,
  "so somebody who grew up here, left and came back can say both",
);
ok("previous places are multi-select", questionById("previous_places")?.kind === "multi");
ok("and searchable", q.searchableCategory(questionById("previous_places")!) !== null);
/* Item 10's last bullet: the care options adapt to the child's age. */
const babyOnly: ProfileAnswers = { ...q.EMPTY_ANSWERS, child_ages: [1] };
const babyCare = q.optionsFor(questionById("childcare_now")!, "pasadena", babyOnly).map((o) => o.id);
ok(
  "a baby is not offered an after-school program",
  !babyCare.includes("after_school_program") && !babyCare.includes("after_school_sitter"),
  babyCare.join(","),
);
const gradeCare = q
  .optionsFor(questionById("childcare_now")!, "pasadena", { ...q.EMPTY_ANSWERS, child_ages: [8] })
  .map((o) => o.id);
ok("an eight-year-old is", gradeCare.includes("after_school_program"));

/* ────────────────────────────────────────────────────────────────────────────
   The 3 Sep round.

   Four of her five items are in this file's reach; the fifth (the privacy links
   moving up into the SMS-consent box on /join) is copy on a screen with no data
   file, and is walked in a browser instead.
   ──────────────────────────────────────────────────────────────────────────── */

console.log("\n=== 3 Sep: the local-questions screen is gone ===");
ok(
  "no screen asks which local questions a parent could help with",
  !q.SCREENS.some((s) => s.questions.some((x) => x.id === "topics")),
  "her instruction — the whole page comes out of the flow",
);
ok(
  "its sibling, parenting experiences, is deliberately kept",
  q.SCREENS.some((s) => s.questions.some((x) => x.id === "topics_lived")),
  "she named one heading, and that screen carries the 1 Sep topic-level opt-in",
);
ok(
  "the stored answer survives the screen",
  Array.isArray(q.EMPTY_ANSWERS.topics),
  "parents answered it under the old build; deleting the field would discard that",
);

console.log("\n=== 3 Sep: a child on the way is not asked about ===");
const expectingOnly: ProfileAnswers = { ...q.EMPTY_ANSWERS, child_ages: [-1] };
const oneOnTheWay: ProfileAnswers = { ...q.EMPTY_ANSWERS, child_ages: [-1, 4] };
const twoOnTheWay: ProfileAnswers = { ...q.EMPTY_ANSWERS, child_ages: [-1, 4, 9] };
const schoolQ = questionById("schools")!;
ok(
  "an expecting child is not offered as a “whose is it?” chip",
  q.childOptions(twoOnTheWay).every((c) => c.label !== "Expecting"),
  q.childOptions(twoOnTheWay).map((c) => c.label).join(","),
);
ok("and the born children still are", q.childOptions(twoOnTheWay).length === 2);
ok(
  "no per-child block is headed “Expecting”",
  q.childBlocks(schoolQ, "pasadena", twoOnTheWay).every((b) => !/Expecting/.test(b.heading)),
  q.childBlocks(schoolQ, "pasadena", twoOnTheWay).map((b) => b.heading).join(" | "),
);
ok(
  "one born child plus one on the way asks no blocks at all",
  q.childBlocks(schoolQ, "pasadena", oneOnTheWay).length === 0,
  "nothing to attribute between — the household list, attributed silently",
);
ok(
  "a parent expecting their first is asked no per-child question either",
  q.childOptions(expectingOnly).length === 0 &&
    q.childBlocks(schoolQ, "pasadena", expectingOnly).length === 0,
);
/* The two above were what this section asserted, and neither is the thing.
   `childBlocks` returning nothing for one child is *correct* — it means the
   caller renders the ordinary household list — so the question was still on
   screen, headed "Where does your child go to school, preschool or daycare?",
   offering "Homeschool" and "Not in school or daycare yet". The assertion has
   to be about the screen, not about the blocks. */
const perChildFor = (a: ProfileAnswers) =>
  q
    .visibleScreens(a)
    .filter((s) => !q.isStatementScreen(s))
    .flatMap((s) => q.visibleQuestions(s, a))
    .filter((x) => x.perChild)
    .map((x) => x.id);
ok(
  "and no per-child question is on the screen at all",
  perChildFor(expectingOnly).length === 0,
  perChildFor(expectingOnly).join(",") || "none",
);
ok(
  "the schools screen is gone rather than empty",
  !q.visibleScreens(expectingOnly).some((s) => s.id === "schools") &&
    !q.visibleScreens(expectingOnly).some((s) => s.id === "childcare"),
  "a screen with two options about an unborn child is a dead end",
);
ok(
  "one born child brings every one of them back",
  perChildFor(oneOnTheWay).length === 4,
  perChildFor(oneOnTheWay).join(","),
);
ok(
  "and a parent who has not reached the ages screen is asked normally",
  perChildFor(q.EMPTY_ANSWERS).length === 4,
  "hiding half the flow from somebody who has not answered yet is the same bug inverted",
);
/**
 * The screen the `perChild` gate could not reach (7 Sep).
 *
 * Backup childcare is deliberately **not** a per-child question — a grandmother
 * who can come over covers every child — so the gate did not touch it, and an
 * expecting-only parent was asked *"What can you usually rely on when regular
 * childcare falls through?"* about a child who is not born. The decisive point
 * is structural rather than a matter of taste: the thing it is the backup *to*
 * is per-child and therefore hidden, so the flow asked for a fallback to
 * something it had never asked about.
 */
/* 9 Sep: the two childcare questions share one screen, so the gate moved from
   the screen onto the backup **question** — and with both hidden the screen
   drops out on its own. Asserted on the question, which is where the rule now
   lives, plus on the screen, which is what a parent sees. */
const asks = (a: ProfileAnswers, id: string) =>
  q
    .visibleScreens(a)
    .flatMap((s) => q.visibleQuestions(s, a))
    .some((x) => x.id === id);
ok(
  "the backup-childcare question goes with it, and the screen with both",
  !asks(expectingOnly, "childcare_backup") &&
    !q.visibleScreens(expectingOnly).some((s) => s.id === "childcare"),
  "a fallback with no antecedent — its own antecedent question is hidden",
);
ok(
  "and it comes back the moment one child is born",
  asks(oneOnTheWay, "childcare_backup") && asks(q.EMPTY_ANSWERS, "childcare_backup"),
  "including for a parent who has not reached the ages screen yet",
);
ok(
  "an expecting-only parent walks eleven screens, and none is about a child",
  q.visibleScreens(expectingOnly).length === 11,
  String(q.visibleScreens(expectingOnly).length),
);
ok(
  "the expecting answer itself is still recorded",
  expectingOnly.child_ages.includes(-1),
  "it is a strong matching signal, and the screen before it said so",
);

console.log("\n=== 3 Sep: month and year, not a date of birth ===");
ok("twelve months, in order", q.MONTH_OPTIONS.length === 12);
ok(
  "ids are 1-12, matching children.birth_month and not JavaScript's zero",
  q.MONTH_OPTIONS.map((m) => m.id).join(",") === "1,2,3,4,5,6,7,8,9,10,11,12",
  "an off-by-one here is invisible until somebody reads a birthday",
);
ok(
  "January is 1 and December is 12",
  q.MONTH_OPTIONS[0].label === "Jan" && q.MONTH_OPTIONS[11].label === "Dec",
);
ok(
  "nothing is pre-filled",
  Object.keys(q.EMPTY_ANSWERS.child_months).length === 0,
  "the year is the required tap; the month is offered beside it",
);
ok("and the ages question stays the required one", schoolQ !== undefined && questionById("child_ages")?.required === true);

/* ── the tenure screen ─────────────────────────────────────────────────────── */

/**
 * The client's report (7 Sep): on this screen the options do not hang
 * together — *"if you grew up here then you have lived here more than ten years
 * anyway"*.
 *
 * The redundancy reading suggests folding "I grew up in this area" back into
 * the band list, and that is the one thing not to do: item 11 took it out on
 * 24 Aug precisely so a parent who grew up here, left and came back is not
 * forced to pick one truth and drop the other. What was missing is a rule for
 * what the band measures, so these pin the rule and the pair it makes coherent.
 */
console.log("\n=== 7 Sep: the tenure screen says what it counts ===");
{
  const screen = q.SCREENS.find((s) => s.id === "time_in_area")!;
  ok(
    "the help line states what to count from",
    /most recent move/i.test(screen.help ?? ""),
    screen.help ?? "no help line",
  );
  ok(
    "and says the two answers go together for a returner",
    /grew up here/i.test(screen.help ?? "") && /came back/i.test(screen.help ?? ""),
  );
  ok(
    "local roots is still its own question, not a band",
    screen.questions.some((x) => x.id === "grew_up_here") &&
      !q
        .optionsFor(
          screen.questions.find((x) => x.id === "time_in_area")!,
          "pasadena",
          q.EMPTY_ANSWERS,
        )
        .some((o) => o.id === "grew_up_here"),
    "as an option in the band list it was mutually exclusive with every band",
  );
  /* The combination the split exists for: both answers coexist. */
  const returner: ProfileAnswers = {
    ...q.EMPTY_ANSWERS,
    time_in_area: "under_year",
    grew_up_here: "grew_up_here",
  };
  ok(
    "a returner can hold both answers at once",
    returner.time_in_area === "under_year" && returner.grew_up_here === "grew_up_here",
  );
  ok(
    "and every band is still offered when they tick it",
    q.optionsFor(
      screen.questions.find((x) => x.id === "time_in_area")!,
      "pasadena",
      returner,
    ).length === 4,
    "hiding bands once local roots is ticked is the 24 Aug bug coming back",
  );
}

console.log("\n=== 8 Sep: the context step's ceiling is one number, in one place ===");
{
  /**
   * `RELEVANCE_DIMENSIONS` is stated in `lib/matching.ts` and the dimensions
   * themselves are declared here, on the questions — and the scorer cannot count
   * them for itself, because it reads them off whatever rows a parent produced.
   * So this is the join, and it exists because the hand-maintained count had
   * already gone stale: `RELEVANCE_STEP`'s own doc said *five* until today.
   *
   * `/admin/matching` prints it ("up to N dimensions can match at once"), which
   * is the sentence that stops the shortest bar on the card reading as "context
   * barely counts". A wrong N there is a wrong statement about the model, and
   * nothing else would catch it.
   */
  const matching = (await import(
    `../lib/matching.ts?v=${Date.now()}`
  )) as typeof import("../lib/matching.ts");

  const declared = new Set<string>();
  for (const screen of q.SCREENS) {
    for (const question of screen.questions) {
      if (question.relevance) declared.add(question.relevance);
    }
  }

  ok(
    "the count matches the dimensions the question set declares",
    matching.RELEVANCE_DIMENSIONS === declared.size,
    `states ${matching.RELEVANCE_DIMENSIONS}, found ${declared.size}: ${[...declared]
      .sort()
      .join(", ")}`,
  );
  ok(
    "and all of them together still lose to a shared school",
    matching.RELEVANCE_STEP * matching.RELEVANCE_DIMENSIONS < 5,
    "life relevance is a boost that breaks ties, never a second scoring system",
  );
}

console.log("\n=== 9 Sep: a refusal chip never becomes a connection ===");
{
  /**
   * ⚠ `deriveAffinities` pushed **every** selected value and filtered only
   * `prefer_not_to_say`, so the other refusals on the affinity-bearing questions
   * were written into `social_affinities` as edges. The expensive one is
   * `school:homeschool`: two families **not** at a school would have shared the
   * heaviest edge in the graph — **5 points**, more than any real connection —
   * for each having answered "none of these". `faith_community:none` is live on
   * one person today, so the mechanism was real and only the volume was not.
   *
   * The list lives in `derive.ts` as literals rather than being read from here,
   * because that module is deliberately free of runtime imports so it can be
   * loaded in a plain node test. This is what stops the two drifting: any
   * exclusive option on a question that writes an affinity or a relevance row
   * has to be in it.
   */
  const d = (await import(
    `../lib/derive.ts?v=${Date.now()}`
  )) as typeof import("../lib/derive.ts");

  const m = (await import(
    `../lib/matching.ts?v=${Date.now()}`
  )) as typeof import("../lib/matching.ts");

  /**
   * ⚠ **`exclusive` is not the same thing as "a refusal", and the first version
   * of this check conflated them.** It clears the rest of the page, which two
   * genuine answers also do:
   *
   *  - `childcare_backup:no_reliable_backup` — *"there is nobody I can call"* is
   *    a real and rather important fact about a family's life, and two parents
   *    who share it are genuinely alike. It is exclusive because it contradicts
   *    every other option, not because it declines the question.
   *  - `trust_circles:no_fixed_preference` — the server-side default the 1 Sep
   *    decision requires when the question is skipped. It is deliberately
   *    written (downstream reads it) and deliberately scores nothing, which is
   *    `NO_PREFERENCE`'s job rather than this one.
   *
   * So the rule is: every exclusive option on a graph-writing question is either
   * dropped before the graph, or scores zero, or is on this list with a reason.
   * A **new** one fails here until somebody decides which — which is the drift
   * guard, and it is what the flat `exclusive` test could not give.
   */
  const REAL_ANSWERS = new Set(["no_reliable_backup"]);

  const missing: string[] = [];
  for (const screen of q.SCREENS) {
    for (const question of screen.questions) {
      if (!question.affinity && !question.relevance) continue;
      for (const option of q.optionsFor(question, "pasadena", q.EMPTY_ANSWERS)) {
        if (!option.exclusive) continue;
        if (d.NON_ANSWERS.has(option.id)) continue;
        if (m.NO_PREFERENCE.has(option.id)) continue;
        if (REAL_ANSWERS.has(option.id)) continue;
        missing.push(`${question.id}:${option.id}`);
      }
    }
  }
  ok(
    "every exclusive option on a graph-writing question is triaged",
    missing.length === 0,
    missing.join(", "),
  );
  ok(
    "a shared “no preference” is worth nothing, so skipping is not a similarity",
    m.NO_PREFERENCE.has("no_fixed_preference") &&
      m.NO_PREFERENCE.has("across_price_points"),
    "26 of 109 live relevance rows are those two server-side defaults",
  );
  ok(
    "and the four that were missing are named",
    ["none", "homeschool", "not_in_school_yet", "not_doing_any_yet"].every((v) =>
      d.NON_ANSWERS.has(v),
    ),
  );
}

console.log("\n=== 9 Sep: fewer screens, and the long lists are boxes ===");
/**
 * Her report, repeated: onboarding is too long and visually overloaded. Three
 * merges and one presentation rule, pinned here because every one of them is a
 * property of the *data* and a future session reading an older document would
 * see three screens each doing one thing and split them again.
 */
{
  const twoChildren: ProfileAnswers = {
    ...q.EMPTY_ANSWERS,
    neighborhood: "pasadena",
    child_ages: [3, 9],
  };
  const screens = q.visibleScreens(twoChildren);
  const on = (screenId: string) =>
    (screens.find((s) => s.id === screenId)?.questions ?? []).map((x) => x.id);

  ok(
    "parenting setup and work setup are one screen",
    on("household_setup").join(",") === "family_structure,work_setup",
    on("household_setup").join(",") || "no such screen",
  );
  ok(
    "childcare and backup childcare are one screen",
    on("childcare").join(",") === "childcare_now,childcare_backup",
    on("childcare").join(",") || "no such screen",
  );
  ok(
    "price and priorities are one screen, under her own title",
    on("priorities").join(",") === "budget,trust_circles" &&
      screens.find((s) => s.id === "priorities")?.title ===
        "What should Pando prioritize?",
    on("priorities").join(",") || "no such screen",
  );
  ok(
    "a two-child family walks thirteen screens, not seventeen",
    screens.length === 13,
    String(screens.length),
  );
  /* The instruction each question carried as its screen's `help` is kept
     verbatim on the question, or a merge would have deleted one of the two. */
  ok(
    "and every merged question kept its own instruction",
    ["family_structure", "work_setup", "childcare_now", "childcare_backup", "budget", "trust_circles"].every(
      (id) => (questionById(id as QuestionId)?.help ?? "").length > 0,
    ),
    "picking one for the screen would have dropped an instruction a parent acts on",
  );

  /* Six or more static options become a box — see `Question.dropdown`. */
  const staticCount = (id: QuestionId) => optionsOf(id).length;
  const shouldBox: QuestionId[] = [
    "family_structure",
    "work_setup",
    "budget",
    "childcare_backup",
    "logistics",
    "trust_circles",
    "childcare_now",
  ];
  ok(
    "every long static list is a dropdown",
    shouldBox.every((id) => questionById(id)?.dropdown === true),
    shouldBox.filter((id) => questionById(id)?.dropdown !== true).join(",") || "",
  );
  ok(
    "and every one of them really is long",
    shouldBox.every((id) => staticCount(id) >= 6),
    shouldBox.map((id) => `${id}:${staticCount(id)}`).join(" "),
  );
  ok(
    "the short ones keep their chips",
    (["travel_time", "time_in_area", "attribution", "shared_connections"] as QuestionId[]).every(
      (id) => questionById(id)?.dropdown !== true && staticCount(id) <= 5,
    ),
    "a box costs a tap to open and saves no height at four options",
  );
  /**
   * ⚠ The exception, and it is the longest list of all. Each option there is an
   * opt-in rather than a lookup, and a parent does not open a box to consider
   * whether they would talk about loneliness — hiding them loses opt-ins, which
   * is the one thing her own *"без втрати даних"* rules out.
   */
  ok(
    "except the one where each option is its own opt-in",
    questionById("topics_lived")?.dropdown !== true && staticCount("topics_lived") === 14,
    "topics_lived is 14 options and stays chips — on the list for her",
  );
}

console.log("\n=== 9 Sep, items 8 and 10: A–Z in a box, and one screen fewer ===");
{
  const alpha: QuestionId[] = [
    "family_structure",
    "work_setup",
    "childcare_now",
    "childcare_backup",
    "logistics",
    "trust_circles",
  ];
  const a: ProfileAnswers = { ...q.EMPTY_ANSWERS, neighborhood: "pasadena", child_ages: [3, 9] };
  for (const id of alpha) {
    const shown = q.optionsFor(questionById(id)!, "pasadena", a);
    const answersOnly = shown.filter((o) => !o.exclusive).map((o) => o.label);
    const sorted = [...answersOnly].sort((x, y) => x.localeCompare(y, "en"));
    ok(
      `${id} reads A–Z`,
      JSON.stringify(answersOnly) === JSON.stringify(sorted),
      answersOnly.join(" | "),
    );
    /* The refusal is furniture, not an answer — sorted into the middle it reads
       as one of the choices. */
    const firstRefusal = shown.findIndex((o) => o.exclusive);
    ok(
      `${id} keeps its refusals at the end`,
      firstRefusal === -1 || shown.slice(firstRefusal).every((o) => o.exclusive),
      shown.map((o) => (o.exclusive ? `*${o.label}` : o.label)).join(" | "),
    );
  }
  /**
   * ⚠ The one dropdown that must **not** be sorted. Its options are a scale —
   * free-or-low-cost through best-fit-even-if-costlier — and A–Z would open it
   * on "Ask me each time", which is the least informative answer on the list and
   * says nothing about there being an order at all.
   */
  ok(
    "but the price scale is left in its own order",
    questionById("budget")?.alphabetical !== true &&
      optionsOf("budget")[0]?.id === "prioritize_low_cost",
    optionsOf("budget").map((o) => o.id).join(" | "),
  );

  /* Item 10 — the interstitial goes, the compliance opt-in and the privacy
     disclosure stay, and the one sentence that was said nowhere else moved
     rather than went. */
  ok(
    "“The Pando promise” screen is gone",
    screenById("promise") === undefined,
    "an informational screen immediately before the one that says the same thing",
  );
  ok(
    "its no-ads promise survives on the participation screen",
    /no ads/i.test(screenById("allowance")?.footnote ?? ""),
    screenById("allowance")?.footnote ?? "nothing",
  );
  ok(
    "the privacy disclosure is kept",
    screenById("privacy_disclosure") !== undefined,
    "she named the promise screens; a privacy disclosure is not one",
  );
  ok(
    "and the recurring-messages consent is untouched",
    q.EMPTY_ANSWERS.recurring_messages === null &&
      questionById("allowance")?.required === true,
    "the compliance opt-in is a checkbox on that screen, not a screen of its own",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
