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
ok(
  "and the topic-level consent is stated on the screen",
  /Pando may occasionally ask you a relevant question/.test(
    screenById("topics_lived")?.footnote ?? "",
  ),
);
ok(
  "in the words that say names are not shared, never “anonymous”",
  /name will not be shared/.test(screenById("topics_lived")?.footnote ?? "") &&
    !/anonymous/i.test(screenById("topics_lived")?.footnote ?? ""),
  "Pando knows exactly who both parents are",
);

console.log("\n=== the listening-ear page is gone ===");
ok(
  "no screen asks it",
  screenById("listening_ear") === undefined,
  "her recommendation: unnecessary once the topics page is the opt-in",
);
ok(
  "and the parenting-experiences page carries what it used to ask",
  (screenById("topics_lived")?.footnote ?? "").length > 0,
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
ok(
  "the minimum is named as required",
  /required minimum/i.test(levels[0]?.label ?? ""),
  levels[0]?.label,
);
ok(
  "the middle one is Recommended, not “most popular”",
  /recommended/i.test(levels[1]?.label ?? "") && !/popular/i.test(levels[1]?.label ?? ""),
  "“Do not call it ‘Most popular’ without supporting usage data”",
);
ok(
  "48 hours is stated on the screen",
  /48 hours/.test(screenById("allowance")?.help ?? ""),
);
ok(
  "and the benefit is new outreach, never access to what Pando already knows",
  /ask the community/i.test(levels[1]?.hint ?? "") &&
    !/access/i.test(levels[1]?.hint ?? ""),
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

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
