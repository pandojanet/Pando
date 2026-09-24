import fs from "node:fs";
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

/**
 * ⚠ **Both look in `ALL_SCREENS`, not in `SCREENS`** (10 Sep).
 *
 * Seven screens spent 10 Sep in `ASK_LATER` — i.e. asked nowhere — and came
 * back the same day behind the fork, where they are optional. So they are on
 * the flow again and
 * every assertion in this file about their wording, their caps and their
 * refusal chips is still worth keeping — the client's instruction was to ask
 * them *later*, not that they were wrong. Against `SCREENS` this file crashed
 * on the first of them (`questionById("logistics")` came back undefined and
 * `maxSelectionsFor` read a property off it), which is a suite reporting a
 * question as broken when it had only moved.
 *
 * What is asserted **about the flow** — how many screens a parent walks, which
 * of them are visible — goes through `q.visibleScreens` and `q.SCREENS`, so
 * nothing here can quietly start testing a screen nobody is shown.
 */
const screenById = (id: string) => q.ALL_SCREENS.find((s) => s.id === id);
const questionById = (id: QuestionId): Question | undefined => {
  for (const s of q.ALL_SCREENS) {
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
/**
 * ⚠ **Four, not five, since 10 Sep** — *"Keep regular childcare; let's remove
 * backup care, it's not necessary."* The backup question is asked on no screen
 * now, so there is no chip on it to have removed twice. Its absence is
 * asserted on its own below, which is the stronger claim: this list would have
 * gone green for a question that had been deleted by accident.
 */
const FIVE: QuestionId[] = [
  "family_structure",
  "work_setup",
  "childcare_now",
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
/**
 * ⚠ **Backup childcare is asked nowhere** (10 Sep): *"Keep regular childcare;
 * let's remove backup care — it's not necessary."*
 *
 * Three claims, because removing a question badly is three different mistakes.
 * It must be off every screen; its option list must **survive**, or a stored
 * answer from a parent who filled it in last week renders as a raw slug on
 * their own review screen; and `derive.ts` must still read it, or that parent
 * silently loses the `childcare` relevance row they already earned.
 */
ok(
  "the backup-childcare question is on no screen at all",
  questionById("childcare_backup") === undefined,
  "removed from the flow, not merely hidden",
);
ok(
  "its options still resolve, so a stored answer is still words",
  q.profileValueLabel("no_reliable_backup") === "No reliable backup childcare",
  q.profileValueLabel("no_reliable_backup") ?? "renders as a raw slug",
);
/* The `exclusive` flag is deliberately no longer asserted: it governs what
   happens when a chip is tapped, and there is no longer a screen to tap it on.
   Asserting a property of a control nobody can reach is how a suite keeps
   passing about a feature that has gone. */

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
/**
 * ⚠ **Inverted on 10 Sep**, and the reversal is hers rather than a relaxation.
 *
 * Item 17 (1 Sep) asked for Continue to activate only once a topic or the
 * opt-out is chosen, which is `required`. Her 10 Sep list names this question
 * among the ones that must be **optional** — and the two now sit on opposite
 * sides of a door: the screen is behind *"Add optional details"*, so a required
 * question here would mean opening that door commits a parent to answering.
 *
 * The opt-out chip is still on the list, so what item 17 protected — a refusal
 * being a real answer rather than a silence — survives. This asserts both, so
 * neither half can be restored without meeting the other.
 */
ok(
  "the screen is optional, because the whole fork behind it is",
  questionById("topics_lived")?.required !== true,
  "optional detail a parent cannot decline is not optional",
);
ok(
  "and the explicit opt-out is still there to say “ask me nothing”",
  optionsOf("topics_lived").some((o) => o.id === "no_parenting_questions"),
  "a refusal and a silence must stay two different answers",
);
/**
 * 2 Sep — the descriptive box is off the profile pages, on the client's
 * instruction, and on this screen that box was the topic-level consent she
 * dictated on 1 Sep. So the assertion inverts: it is no longer on the screen,
 * and this check exists to make sure a future session does not put it back
 * without her asking, or remove the screen's own `help` line as well.
 */
/* ⚠ Read off the **question** since 15 Sep, when the topics screen merged into
   the participation one — a screen asking one question is what the developer
   asked to be rid of. Its consent box went on 2 Sep and its help moved onto the
   question, so the box must be absent from the screen it now shares and the
   sentence must still be somewhere a parent reads. */
ok(
  "the descriptive box is gone from the parenting-experiences question",
  !/decide for yourself|never shared|only the topics/i.test(
    screenById("allowance")?.footnote ?? "",
  ),
  "her 2 Sep instruction — the consent is now made by selecting a topic",
);
ok(
  "and it still says the parent decides whether to answer",
  /decide whether to answer/.test(questionById("topics_lived")?.help ?? ""),
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
  optionsOf("topics_lived").length > 0,
  "selecting a topic is the opt-in; the screen no longer explains that in a box",
);
/* ⚠ `required` was half of this check and came off on 10 Sep (see above). It
   was never what made the page the opt-in — a topic being *selectable* is —
   and leaving it here would have made one instruction of hers fail a test
   written for another. */

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
  "the minimum is named as the minimum",
  /minimum/i.test(JSON.stringify(levels[0]?.plan ?? {})),
  JSON.stringify(levels[0]?.plan),
);
ok(
  "the middle one is Recommended, not “most popular”",
  levels[1]?.recommended === true &&
    !/popular/i.test(JSON.stringify(levels[1] ?? {})),
  "“Do not call it ‘Most popular’ without supporting usage data”",
);
/**
 * ⚠⚠ **Inverted on 10 Sep, because she wrote the missing cell.**
 *
 * This asserted that Community Member had **no** benefits, which was the right
 * check for four days: *"розробникам зараз можна дати layout task, але final
 * content не можна вигадувати. Janet прямо сказала, що ще дасть benefits."* She
 * has now given them, for all three levels, so the guard flips from "nobody
 * invented one" to "all three are hers" — and the empty cell would now be the
 * defect.
 */
ok(
  "every level answers all three of her rows",
  levels.every(
    (o) => o.plan?.participation && o.plan?.questions && o.plan?.benefits?.length,
  ),
  levels.map((o) => `${o.id}:${o.plan?.benefits?.length ?? "MISSING"}`).join(" "),
);
/**
 * ⚠ **The cell is a list since 15 Sep** and every assertion below reads the
 * whole of it — `benefitsText` is the lead plus the bullets, which is what a
 * parent sees. Checking one bullet would pass while the rest of her sentence
 * had been dropped, which is exactly the failure the split could cause.
 */
const benefitsText = (o?: { plan?: { benefitsLead?: string; benefits?: string[] } }) =>
  [o?.plan?.benefitsLead ?? "", ...(o?.plan?.benefits ?? [])].join(" ");
ok(
  "and the two paid ones build on the one below, in her words",
  /^Everything above/.test(levels[1]?.plan?.benefitsLead ?? "") &&
    /^Everything above/.test(levels[2]?.plan?.benefitsLead ?? ""),
  "her table reads 'Everything above, plus …' — a level is never a different product",
);
/**
 * ⚠ The bullets are a **split** of her sentences and not a rewrite (15 Sep), so
 * this pins the words that would go first if somebody tidied the fragments into
 * capitalised ones: her lower case, and the items she actually listed.
 */
ok(
  "the bullets are her own fragments, not tidied ones",
  (levels[1]?.plan?.benefits ?? []).every((b) => b === b.replace(/^(.)/, (c) => c.toLowerCase())),
  JSON.stringify(levels[1]?.plan?.benefits),
);
/**
 * ⚠ Her instruction: *"Label benefits that are not yet live 'during the pilot'
 * or 'at launch.'"* Three of the things she promises do not exist — a Network
 * Check a month, Pando+, caregiver matching — and a credit is denominated in
 * Network Checks, which are not spendable yet (10 Aug). Without the hedge this
 * screen promises a balance nothing can pay out, so the hedge is part of the
 * sentence rather than a nicety.
 */
for (const level of [levels[1], levels[2]]) {
  const text = benefitsText(level);
  ok(
    `${level?.id} hedges what is not live yet`,
    /during the pilot|at launch/.test(text),
    text,
  );
}
/**
 * ⚠ The 48-hour gap moved out of the screen's intro when her own intro
 * replaced ours, and it now sits in the third level's own row — which is the
 * asymmetry already on the list for her, since invariant 5 applies it to every
 * level. What is asserted is only that the screen still states it *somewhere*:
 * a parent agreeing to a frequency has to be able to read the ceiling.
 */
ok(
  "48 hours is still stated on the screen",
  /48 hours/.test(
    (screenById("allowance")?.help ?? "") +
      JSON.stringify(levels.map((o) => o.plan)),
  ),
  screenById("allowance")?.help,
);
/**
 * ⚠ Restated as the rule rather than as one sentence's wording. Her 1 Sep
 * instruction was *"Do not restrict access to useful information Pando already
 * has"* — so what must hold is that the **base** level already grants asking
 * and answering, and the levels above it add outreach rather than unlock
 * access. Checking the middle level's phrasing, as this did, broke the moment
 * she wrote her own.
 */
ok(
  "the minimum level already includes asking and getting answers",
  /ask questions/i.test(benefitsText(levels[0])) &&
    /answers/i.test(benefitsText(levels[0])),
  benefitsText(levels[0]),
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
/**
 * ⚠ Her 24 Aug label was pinned here verbatim and is superseded by §5 of
 * 9 Sep, which adds a third way in: *"Type your town, neighborhood or ZIP
 * code."* Updated rather than deleted, because the thing worth protecting is
 * unchanged — there is **one** route out of the town list and it names every
 * way of using it.
 *
 * The label is ours; the placeholder is hers, word for word, so that one is
 * pinned against the component that renders it.
 */
ok(
  "the search label names all three ways in",
  ["town", "neighborhood", "ZIP"].every((w) => hood?.searchLabel?.includes(w)),
  hood?.searchLabel,
);
ok(
  "and her placeholder is on the control, verbatim",
  fs
    .readFileSync(
      new URL("../components/ui/SearchableChipGroup.tsx", import.meta.url),
      "utf8",
    )
    .includes("Type your town, neighborhood or ZIP code"),
  "§5, 9 Sep",
);
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
  "the child on the way sits alongside a real child",
  q.BIRTH_YEAR_OPTIONS.find((o) => o.id === "-1")?.exclusive !== true,
);
ok(
  "“I grew up in this area” is its own question",
  questionById("grew_up_here") !== undefined &&
    questionById("time_in_area") !== undefined,
  "so somebody who grew up here, left and came back can say both",
);
/* 16 Sep: "Remove 'Where have you lived before?'" — off every screen, but a
   stored answer still resolves (it is a retired question, not a deleted one). */
ok("“Where have you lived before?” is asked on no screen", questionById("previous_places") === undefined);
ok("and a stored answer still resolves to its question", q.questionById("previous_places").kind === "multi");
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
/**
 * ⚠ **Every cohort here takes the fork** (`wants_detail: true`, 10 Sep), and
 * that is load-bearing rather than boilerplate.
 *
 * The per-child screens moved behind *"Add optional details"*, so without it
 * `visibleScreens` hides them for **everybody** — and this whole section would
 * go green while asserting nothing: "the schools screen is gone" would be true
 * of an expecting parent because of the fork, and equally true of a parent with
 * four children. Opening the fork is what leaves the expecting gate as the only
 * thing that can still hide the screen, which is what these check.
 */
const detail = { wants_detail: true } as const;
const expectingOnly: ProfileAnswers = { ...q.EMPTY_ANSWERS, ...detail, child_ages: [-1] };
const oneOnTheWay: ProfileAnswers = { ...q.EMPTY_ANSWERS, ...detail, child_ages: [-1, 4] };
const twoOnTheWay: ProfileAnswers = { ...q.EMPTY_ANSWERS, ...detail, child_ages: [-1, 4, 9] };
const schoolQ = questionById("schools")!;
ok(
  "an expecting child is not offered as a “whose is it?” chip",
  q.childOptions(twoOnTheWay).every(
    (c) => c.label !== "Expecting" && c.label !== String(new Date().getFullYear() + 1),
  ),
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
  perChildFor({ ...q.EMPTY_ANSWERS, ...detail }).length === 4,
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
/**
 * ⚠ The 7 Sep half of this — *"the backup question is hidden for an expecting
 * parent, and comes back the moment one child is born"* — is **gone rather
 * than failing**, because the question it was about is gone (10 Sep). Its
 * absence is asserted once, above, where the removal is.
 *
 * What survives is the screen-level claim, which is still the client's rule and
 * is now carried by the regular-childcare question alone.
 */
/* ⚠ The question rather than the screen, since 15 Sep: childcare merged onto
   the parenting-and-work screen, which an expecting parent still sees for the
   two questions that are not about a child. The rule was always about the
   question — every option would be answered about a hypothetical. */
const asked = (a: ProfileAnswers) =>
  q
    .visibleScreens(a)
    .flatMap((s) => q.visibleQuestions(s, a))
    .map((x) => x.id);
ok(
  "the childcare question is not asked of a parent with no born child",
  !asked(expectingOnly).includes("childcare_now"),
  "every option would be answered about a hypothetical",
);
ok(
  "and it comes back the moment one child is born",
  asked(oneOnTheWay).includes("childcare_now") &&
    asked({ ...q.EMPTY_ANSWERS, ...detail }).includes("childcare_now"),
  "including for a parent who has not reached the ages screen yet",
);
/* ⚠ The claim, not the count. This read `length === 6` and broke the moment
   the seven ASK_LATER screens came back behind the fork (10 Sep, second pass)
   — the number moved, nothing about expecting-only did. A screen count is a
   property of where screens currently sit; "none is about a child" is the rule
   this section exists for, and it survives them moving again. */
ok(
  "an expecting-only parent is asked nothing about a child",
  q
    .visibleScreens(expectingOnly)
    .flatMap((s) => q.visibleQuestions(s, expectingOnly))
    .every((x) => !x.perChild),
  q
    .visibleScreens(expectingOnly)
    .flatMap((s) => q.visibleQuestions(s, expectingOnly))
    .filter((x) => x.perChild)
    .map((x) => x.id)
    .join(",") || "no per-child question on any of them",
);
/* ⚠ **Questions, not screens, since 15 Sep.** Every per-child question now
   shares a screen with one that is not about a child, so the screen count is
   identical for both parents and only what they are *asked* differs — which is
   what this check was ever about. Counting screens here would have gone green
   again the day somebody merged the last one. */
ok(
  "and is asked strictly fewer questions than the same parent with a born child",
  asked(expectingOnly).length < asked({ ...expectingOnly, child_ages: [3] }).length,
  `${asked(expectingOnly).length} vs ${asked({ ...expectingOnly, child_ages: [3] }).length}`,
);
ok(
  "the expecting answer itself is still recorded",
  expectingOnly.child_ages.includes(-1),
  "it is a strong matching signal, and the screen before it said so",
);

console.log("\n=== 16 Sep: the years reach 18, and the months follow the child ===");
{
  const thisYear = new Date().getFullYear();
  ok(
    "a child who turns 18 this year can be added",
    q.BIRTH_YEAR_OPTIONS.some((o) => o.label === String(thisYear - 18)),
    q.BIRTH_YEAR_OPTIONS.at(-1)?.label ?? "",
  );
  const sep = new Date(2026, 8, 16);
  const ids = (age: number) => q.monthOptionsFor(age, sep).map((m) => m.id).join(",");
  /* 23 Sep, reversing 16 Sep: "показуй всі місяці всюди, а не обмежуй їх". */
  const all = "1,2,3,4,5,6,7,8,9,10,11,12";
  for (const age of [-1, 0, 3, 18]) {
    ok(`every row offers all twelve months (age ${age})`, ids(age) === all, ids(age));
  }
  /* And the child on the way reads next year (23 Sep: "Заміни Expecting на 2027"). */
  ok(
    "the child on the way is offered as next year, not as “Expecting”",
    q.BIRTH_YEAR_OPTIONS[0]?.id === "-1" && q.BIRTH_YEAR_OPTIONS[0]?.label === String(thisYear + 1),
    JSON.stringify(q.BIRTH_YEAR_OPTIONS[0]),
  );
  const derive = (await import(`../lib/derive.ts?v=${Date.now()}`)) as typeof import("../lib/derive.ts");
  const rows = derive.childrenFromAges([-1, 0, 0], sep, { "0": 2, "1": 3, "2": 12 });
  ok("the child on the way is due next year, and the year is stated",
    rows[0].due_year === 2027 && rows[0].due_year_precision === "stated", JSON.stringify(rows[0]));
  ok("any month is stored as the due month", rows[0].due_month === 2, JSON.stringify(rows[0]));
  ok("a past month is kept for a child born this year", rows[1].birth_month === 3, JSON.stringify(rows[1]));
  ok("a later month is kept too — nothing restricts it any more", rows[2].birth_month === 12, JSON.stringify(rows[2]));
  ok("a stated year needs no month",
    derive.childrenFromAges([-1], sep, {})[0].due_year_precision === "stated");
  {
    /* Was: "complete-your-profile opens a screen with an unanswered question".
       That control and the function behind it went on 17 Sep, so what is left
       to hold is the route that replaced it — every question the percentage
       counts is a row in the review's fold, which is what makes the removal
       safe. Asserted on the thinnest real profile: the two required answers
       and the participation level. */
    const thin = { ...q.EMPTY_ANSWERS, neighborhood: "altadena", child_ages: [4], allowance: "5" } as ProfileAnswers;
    const opened = { ...thin, wants_detail: true };
    const listed = q
      .visibleScreens(opened)
      .filter((s) => !q.isStatementScreen(s))
      .flatMap((s) => q.visibleQuestions(s, opened));
    const unanswered = listed.filter((x) => !q.isQuestionAnswered(x, thin));
    const depth = q.profileDepth(thin);
    ok(
      "every question the percentage counts is one the review can list",
      listed.length === depth.total && unanswered.length === depth.total - depth.answered,
      `${listed.length} listed, ${depth.total} counted`,
    );
    ok("and a thin profile still has some to list", unanswered.length > 0);
  }
  {
    /* 16 Sep: how they know the person whose personal link brought them. */
    const rel = (await import(`../lib/inviter-relationship.ts?v=${Date.now()}`)) as typeof import("../lib/inviter-relationship.ts");
    ok("a named inviter is asked about by name", rel.relationshipQuestion("Jenny") === "How do you know Jenny?");
    ok("a private inviter is asked about generically",
      rel.relationshipQuestion(null) === "What's your relationship with the person who invited you?");
    ok("family, close friend, colleague and a parent group are all offered",
      ["family", "close_friend", "colleague", "parent_group"].every((id) => rel.isRelationship(id)));
    ok("an invented relationship is refused", !rel.isRelationship("best_friend_forever"));
    const inviteSrc = fs.readFileSync(new URL("../lib/server/invite.ts", import.meta.url), "utf8");
    ok("the inviter's first name reaches the browser only when they allow it",
      inviteSrc.includes("invite.inviter_named ? invite.inviter_first_name : null") &&
        inviteSrc.includes("p.attribution = 'first_name_safe'"));
    const migration = fs.readFileSync(new URL("../drizzle/0044_person_relationships.sql", import.meta.url), "utf8");
    const allIds = rel.RELATIONSHIP_OPTIONS.map((o) => o.id);

    /**
     * 21 Sep — *"має бути опція, що людина хоче залишити цю інформацію
     * анонімною, кнопку Skip з тієї сторінки потрібно прибрати"*.
     *
     * ⚠⚠ The refusal is the one option the database must **not** allow, so
     * the old blanket check ("every offered relationship is allowed") would
     * have gone red on it — and widening `person_relationships_relationship_check`
     * to make it green is precisely the fix not to make: a refusal is not a
     * relationship, and a value the route can never send would be a
     * permission with nothing behind it. The three halves fail independently.
     */
    ok(
      "the way out of the question is an option, in the app's own words",
      allIds.includes(rel.DECLINED_RELATIONSHIP) &&
        rel.RELATIONSHIP_OPTIONS.at(-1)?.id === rel.DECLINED_RELATIONSHIP &&
        rel.RELATIONSHIP_OPTIONS.at(-1)?.label === "Prefer not to say",
    );
    ok(
      "every relationship that can be stored is allowed by the database",
      allIds
        .filter((id) => id !== rel.DECLINED_RELATIONSHIP)
        .every((id) => migration.includes(`'${id}'`)),
    );
    ok(
      "and the refusal is neither allowed there nor storable",
      !migration.includes(`'${rel.DECLINED_RELATIONSHIP}'`) &&
        rel.storedRelationship(rel.DECLINED_RELATIONSHIP) === null &&
        rel.storedRelationship("family") === "family" &&
        rel.storedRelationship("best_friend_forever") === null,
    );
    const landingSrc = fs.readFileSync(
      new URL("../components/seed/InviteLanding.tsx", import.meta.url),
      "utf8",
    );
    ok(
      "the screen offers no Skip, so nothing leaves it unanswered",
      !/answerRelationship\(null\)/.test(landingSrc) &&
        !/>\s*Skip\s*</.test(landingSrc.slice(landingSrc.indexOf('step === "relationship"'))),
    );
  }
  {
    /* 23 Sep: "Mommy and me group" → "parent group", and "Something else" takes
       their own words, like every other Something else in the profile. */
    const rel = (await import(`../lib/inviter-relationship.ts?v=${Date.now()}`)) as typeof import("../lib/inviter-relationship.ts");
    const landingSrc = fs.readFileSync(new URL("../components/seed/InviteLanding.tsx", import.meta.url), "utf8");
    const screen = landingSrc.slice(landingSrc.indexOf('step === "relationship"'));
    ok("the parent-group chip reads “Parent group”",
      rel.RELATIONSHIP_OPTIONS.find((o) => o.id === "parent_group")?.label === "Parent group");
    ok("“other” is not a bare chip — it is the profile's “+ Something else” field",
      !rel.RELATIONSHIP_CHIPS.some((o) => (o.id as string) === rel.OTHER_RELATIONSHIP) &&
        screen.includes('otherLabel="+ Something else"') && screen.includes("onAddCustom="));
    ok("their words are kept beside “other”, whitespace collapsed",
      rel.relationshipNote("other", "  we met   at swim  ") === "we met at swim");
    ok("and never beside any other answer", rel.relationshipNote("family", "cousins") === null);
    ok("an empty or over-long note is refused, never cut",
      rel.relationshipNote("other", "   ") === null &&
        rel.relationshipNote("other", "x".repeat(rel.RELATIONSHIP_NOTE_MAX + 1)) === null);
    const noteMigration = fs.readFileSync(new URL("../drizzle/0050_relationship_note.sql", import.meta.url), "utf8");
    ok("the database holds the same rule",
      noteMigration.includes("relationship = 'other'") &&
        noteMigration.includes(`BETWEEN 1 AND ${rel.RELATIONSHIP_NOTE_MAX}`));
  }
  {
    /* 23 Sep: "прибери … питання чи показувати інвайт, показуй інвайт завжди". */
    const { buildScripts } = (await import(
      `../lib/seed-chat/scripts.ts?v=${Date.now()}`
    )) as typeof import("../lib/seed-chat/scripts.ts");
    const cg = buildScripts("pasadena").caregiver;
    const chatSrc = fs.readFileSync(new URL("../components/seed/chat/ChatSeeding.tsx", import.meta.url), "utf8");
    const offer = chatSrc.slice(chatSrc.indexOf("function offerCaregiverInvite"), chatSrc.indexOf("async function persist"));
    ok("the caregiver card no longer asks whether to show the invite",
      !cg.steps.some((x) => x.id === "send_invite") && !cg.recap.some((r) => r.field === "send_invite"));
    ok("and the invite is offered for every saved caregiver card",
      offer.length > 0 && !/send_invite/.test(offer) && /caregiverInviteMessage\(/.test(offer));
  }
  const landing = fs.readFileSync(new URL("../components/seed/InviteLanding.tsx", import.meta.url), "utf8");
  ok("the first-name field names nobody", !/placeholder="Janet"/.test(landing) && landing.includes('placeholder="First name"'));
  const flowForReview = fs.readFileSync(new URL("../components/seed/ProfileFlow.tsx", import.meta.url), "utf8");
  ok("the review dock no longer says “the part only you can answer”", !flowForReview.includes("the part only you can answer —"));

  /**
   * 16 Sep — the review lists every question the percentage counts.
   *
   * ⚠⚠ **Pinned on the source, and it has to be**: the fault was a *branch*
   * (which screen list the review reads), it lives in a React component, and
   * `ProfileFlow` cannot be loaded here. What it produced was a parent who
   * tapped Continue at the fork seeing three rows under a header reading
   * *30% done* — the number measured against the whole questionnaire, the list
   * against their own fork.
   *
   * ⚠ Three checks rather than one, because the halves fail independently:
   * the list has to be built from the opened fork, `profileDepth` has to keep
   * measuring the same way, and **Add** has to open the fork before jumping —
   * without that last one every optional row is a button that does nothing,
   * since `visibleScreens(answers)` does not contain the screen it names.
   */
  ok(
    "the review list is built from the questionnaire, not this parent’s fork",
    flowForReview.includes("const reviewScreens = visibleScreens({ ...answers, wants_detail: true })"),
    "a review reading `screens` shows a Continue-at-the-fork parent almost nothing",
  );
  ok(
    "and the percentage beside it is measured the same way",
    /const full: ProfileAnswers = \{ \.\.\.answers, wants_detail: true \};/.test(
      fs.readFileSync(new URL("../lib/questions.ts", import.meta.url), "utf8"),
    ),
    "the count and the list it describes come from one rule (2 Sep)",
  );
  ok(
    "Add opens the fork before jumping, so no optional row is a dead control",
    /function jumpTo[\s\S]{0,600}wants_detail: true/.test(flowForReview),
  );
}

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
  /* ALL_SCREENS: the tenure screen is behind the fork, and the
     rule it states is still the rule for the day it is asked again. */
  const screen = q.ALL_SCREENS.find((s) => s.id === "time_in_area")!;
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
  /* ALL_SCREENS: the claim is about what the *question set* declares, and the
     the seven screens that briefly left the flow still declare their dimensions — they are
     asked later, not deleted. Against SCREENS this would read 1 and the number
     in matching.ts would look wrong when what changed was the flow. */
  for (const screen of q.ALL_SCREENS) {
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
  /* ALL_SCREENS, because this is a drift guard: a question behind the fork
     still carries an affinity and still writes edges on the day it is asked,
     so letting it out of the sweep now is how an untriaged refusal chip
     arrives with it. */
  for (const screen of q.ALL_SCREENS) {
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
  const screens = q.visibleScreens({ ...twoChildren, wants_detail: true });
  /**
   * ⚠ **The merge shapes read `ALL_SCREENS`, the counts read the flow.**
   *
   * These read the *definitions* rather than the walk. Two of the three sat in
   * `ASK_LATER` for part of 10 Sep, where `visibleScreens` reported "no such
   * screen" — true, and not what this section is about. The merge is a property
   * of the definitions and has to hold wherever the screen sits; how many
   * screens a parent walks is a property of the flow, asserted separately below.
   */
  const on = (screenId: string) =>
    (screenById(screenId)?.questions ?? []).map((x) => x.id);

  /* ⚠ **The two required questions are not here**: they merged onto one
     screen that morning and were separated again the same day — see the
     required-path count above, and the exceptions beside it.

     ⚠ **Childcare joined these two on 15 Sep**, on the developer's *"всі
     сторінки, де є лише 1 питання … об'єднай"* — it was the last screen asking a
     single question in this part of the flow. The 9 Sep merge and the 24 Aug
     split are both intact underneath: three questions, three answers, three
     ids, and backup care still gone (10 Sep). */
  ok(
    "parenting setup, work setup and childcare are one screen",
    on("household_setup").join(",").startsWith("family_structure,work_setup,childcare_now"),
    on("household_setup").join(",") || "no such screen",
  );
  /* ⚠ **The lived topics landed here later on 15 Sep**, when the developer
     ruled that the participation screen must stand alone. Pinned on the screen
     rather than only on the count, because the question moving is exactly what
     decides whether Continue skips it. */
  ok(
    "and the lived topics are the fourth question on it",
    on("household_setup").includes("topics_lived"),
    on("household_setup").join(",") || "no such screen",
  );
  ok(
    "and backup care is gone from it",
    !on("household_setup").includes("childcare_backup"),
    on("household_setup").join(",") || "no such screen",
  );
  /* ⚠ **No screen asks exactly one question** — the developer's rule of 15 Sep,
     asserted over the definitions so a new screen cannot quietly reintroduce
     one. A statement screen asks none and is not a question screen.

     ⚠⚠ **The three exceptions are the required path, and all three are
     theirs.** Across the same day they took the lived topics back off the
     participation screen (*"та сторінка має бути одна"*) and separated the two
     required questions again (*"ці перші сторінки мають йти окремо"*). So the
     rule is about the **optional body** of the flow: a screen a parent is
     walking through collecting detail must not ask them one thing at a time,
     while each of the three required decisions gets a screen to itself. Named
     one by one rather than the rule being dropped, so the exception cannot
     spread to the next screen somebody adds. */
  const SINGLE_OK = ["neighborhood", "child_ages", "allowance"];
  ok(
    "no screen off the required path asks a single question",
    q.SCREENS.every((x) => x.questions.length !== 1 || SINGLE_OK.includes(x.id)),
    q.SCREENS.filter((x) => x.questions.length === 1 && !SINGLE_OK.includes(x.id))
      .map((x) => x.id)
      .join(",") || "none",
  );
  /* ⚠ And the exceptions are exactly the required path — not a list that grew.
     Each of the three asks one required question and nothing else, which is
     the property that earns the exception; `home_zip` rides along on the
     first because it is that question's own follow-up. */
  ok(
    "and the three that do are the three required decisions",
    SINGLE_OK.every((id) =>
      (screenById(id)?.questions ?? []).some((x) => x.required),
    ) &&
      SINGLE_OK.length ===
        q.SCREENS.filter((x) =>
          x.questions.some((y) => y.required),
        ).length,
    q.SCREENS.filter((x) => x.questions.some((y) => y.required))
      .map((x) => x.id)
      .join(","),
  );
  ok(
    "price and priorities are one screen, under her own title",
    on("priorities").join(",") === "budget,trust_circles" &&
      screenById("priorities")?.title === "What should Pando prioritize?",
    on("priorities").join(",") || "no such screen",
  );
  /* ⚠ Against `SCREENS.length`, never a literal. The rule is that opening the
     fork shows **everything the flow has** — that is what the fork promises —
     and the single exception is `connection_visibility`, which carries a
     narrower gate of its own (nothing to decide until they have named a
     connection and said it may be mentioned). A literal here was 8 until the
     seven came back behind the fork and said nothing about why. */
  /* ⚠ **Every screen, with no exception, since 15 Sep.** The exception was
     `connection_visibility`, which carried a narrower gate of its own; it is a
     question on the attribution screen now, so the gate moved onto it and the
     screen count no longer has a hole in it. Against `SCREENS.length` rather
     than a literal, for the reason that number keeps moving. */
  ok(
    "opening the fork shows every screen the flow has",
    screens.length === q.SCREENS.length,
    `${screens.length} of ${q.SCREENS.length}: ${screens.map((s) => s.id).join(",")}`,
  );
  /**
   * ⚠⚠ **And it does not come back just because a parent named a connection**,
   * which is what this asserted for about an hour and is worth keeping as the
   * check rather than the story. `connection_visibility` offers a parent the
   * choice of which connections Pando may mention; `mayBeNamed` refuses to
   * mention **any** of them (10 Sep), so `affiliationOptions` returns nothing
   * and the screen rendered as a heading, a promise and zero controls — found
   * in a browser the moment `ASK_LATER` was emptied. The gate is
   * `anyConnectionMayBeNamed()` now. Flip one entry into `NAMEABLE` and this
   * assertion is what tells you to invert it again.
   */
  ok(
    "and it stays hidden even then, while no connection may be named at all",
    !q
      .visibleScreens({
        ...twoChildren,
        wants_detail: true,
        schools: ["field-elementary"],
        shared_connections: "share_connection",
      })
      .flatMap((x) =>
        q.visibleQuestions(x, {
          ...twoChildren,
          wants_detail: true,
          schools: ["field-elementary"],
          shared_connections: "share_connection",
        }),
      )
      .some((x) => x.id === "shared_affiliations"),
    "a question offering a choice nothing can honour is worse than no question",
  );
  /* The disclosure has to describe what the composer actually sends. Both are
     drift guards on one rule: no affiliation is named to another parent. */
  ok(
    "and the disclosure names no shared connection either",
    !/parent at your/i.test(JSON.stringify(screenById("privacy_disclosure")?.statement ?? {})),
    "a disclosure of something the product will not disclose",
  );
  ok(
    "it states the rule outright instead",
    /never named to another parent/i.test(
      (screenById("privacy_disclosure")?.statement?.body ?? []).join(" "),
    ),
    "her 10 Sep instruction, on the screen that exists to state it",
  );
  /* The instruction each question carried as its screen's `help` is kept
     verbatim on the question, or a merge would have deleted one of the two. */
  ok(
    "and every merged question kept its own instruction",
    ["family_structure", "work_setup", "childcare_now", "budget", "trust_circles"].every(
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
  /* `childcare_backup` was the seventh and is asked nowhere since 10 Sep. */
  const alpha: QuestionId[] = [
    "family_structure",
    "work_setup",
    "childcare_now",
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


console.log("\n=== 10 Sep: the join page, the phone layout, and the optional screens ===");
{
  /**
   * These live in components rather than in the question data, so they are
   * pinned by reading the source — the mechanical shape `test:security` already
   * uses for invariant 7. A grep is a blunt instrument and that is the point:
   * each of these is a decision a future session could undo in one line, and
   * not one of them would throw.
   */
  const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const join = read("../components/seed/InviteLanding.tsx");
  const flow = read("../components/seed/ProfileFlow.tsx");
  const bar = read("../components/ui/BrandPanel.tsx");
  const site = read("../app/(site)/page.tsx");
  const privacy = read("../app/(site)/privacy/page.tsx");
  const finish = read("../components/seed/done/FinishAsks.tsx");

  /* Join: first name and mobile only. */
  ok(
    "the join screen has no surname field",
    !/id="last-name"/.test(join),
    "Let us collect first name and mobile only",
  );
  ok(
    "and the no-account route is gone from it",
    !/Share without joining/.test(join),
    "Remove the no-account route",
  );
  ok(
    "the country code is fixed to +1 there",
    /country="US"/.test(join),
    "Fix the code to +1 vs current number",
  );
  /* Fixed on the join screen only — a number already stored as +380 has to be
     able to sign back in, so the picker stays everywhere else. */
  ok(
    "but sign-in keeps the picker",
    !/country="US"/.test(read("../components/seed/SignIn.tsx")),
    "a stored +380 must still be able to get back in",
  );

  /* Join: the inviter line, and the case it must stay silent in. */
  ok(
    "the join screen names the inviter when there is one",
    /inviter_first_name/.test(join) && /invited you/.test(join),
    "If the invite code resolves, show {first name} invited you",
  );
  ok(
    "and only a personal link can carry a name",
    /kind = 'personal'/.test(read("../lib/server/invite.ts")),
    "a group or school link resolves and has nobody behind it — otherwise show nothing",
  );

  /* Terminology, both halves. */
  ok(
    "the join screen says Founding Contributor",
    /Founding Contributor/.test(join) && !/Founding contributor/.test(join),
    "one capitalisation, not the current mixture",
  );
  /* 21 Sep, the developer: the market line above the heading is gone too, so
     the screen names no town at all — and never one town standing for the
     market, which is what this check was written against. */
  ok(
    "the join screen names no single town as the market",
    !/Founding network · Pasadena/.test(join) &&
      !/<Eyebrow>Founding Contributor · San Gabriel Valley<\/Eyebrow>/.test(join),
    "the market eyebrow was removed on 21 Sep",
  );

  /* Blast is off every surface a parent reads. */
  const surfaces: Array<[string, string]> = [
    ["the marketing FAQ", site],
    ["the privacy page", privacy],
    ["the completion screen", finish],
  ];
  for (const [name, src] of surfaces) {
    ok(
      name + " no longer says Blast to a parent",
      !/\bBLAST\b|\bBlasts?\b/.test(src),
      "Blast sounds spammy and undermines trust",
    );
  }
  /* The keyword itself still answers, or a parent acting on an older text
     would be met with silence. */
  ok(
    "but BLAST SETTINGS still works as a keyword",
    /"BLAST SETTINGS"/.test(read("../lib/outreach-policy.ts")),
    "printed copy changes; a text somebody sent last month does not",
  );

  /* The desktop rail is one line. */
  ok(
    "the desktop panel is one line, not a full-height rail",
    /* The utilities as they would be **written**, not the bare tokens: the
       first version tested for `21rem` anywhere in the file and failed on a
       comment recording what the rail used to be. A check that a class is
       gone must not also forbid saying so. */
    !/lg:h-dvh/.test(bar) && !/lg:w-[21rem]/.test(bar),
    "Collapse the desktop panel to a one-line header",
  );
  ok(
    "and its unread copy went rather than sitting dead",
    !/\blead:/.test(bar) && !/\bpoints:/.test(bar),
    "a payload nothing renders is the fault this repo has paid for three times",
  );

  /* Optional screens. */
  ok(
    "Skip sits in the dock, in one place",
    /Skip this one/.test(flow) && !/>\s*Skip\s*</.test(flow),
    "Put Skip in the same place",
  );
  ok(
    "progress reads as a distance, not a position",
    /screensLeft/.test(flow) && !/\{index \+ 1\} of \{screens\.length\}/.test(flow),
    "Show progress as 3 left",
  );
  ok(
    "a single-select screen advances itself",
    /completesScreen/.test(flow) && /AUTO_ADVANCE_MS/.test(flow),
    "Auto-advance single-select screens",
  );
  /**
   * The exclusions, and the whole of why this is safe. Two have changed hands
   * since:
   *
   * - *"no consent under this screen"* went with the second consent checkbox
   *   on 10 Sep — an exclusion for a control that no longer exists is a rule
   *   nobody can violate.
   * - ⚠⚠ *"one question on the screen"* went on **21 Sep**, and this check had
   *   to be rewritten rather than left standing: it read
   *   `questions.length === 1` against the **whole file**, so with the rule
   *   replaced it went on passing against the comment recording the
   *   replacement. That is the mirror of the rail check above, which failed on
   *   a sentence saying what used to be there — a source check has to read the
   *   rule, not the prose around it. What replaces it is the 21 Sep block at
   *   the foot of this file, which reads the function's own body.
   */
  ok(
    "but never where the tap is not the whole answer",
    /!isLast/.test(flow) && /perSelectionStatus/.test(flow),
    "no follow-up tap, not the review",
  );
  ok(
    "and the participation screen no longer carries a second consent",
    !/consentBlocked/.test(flow) && !/RECURRING_MESSAGES_CONSENT/.test(flow),
    "one counsel-approved checkbox on Join, covering verification and recurring messages",
  );

  /* The review. */
  ok(
    "the review collapses what was skipped",
    /Optional details not added/.test(flow),
    "collapse skipped fields under Optional details not added",
  );
  ok(
    "and every skipped row keeps its own way back",
    /notAdded\.map\(row\)/.test(flow),
    "collapsed, never unreachable — the same row renderer as the answered half",
  );
}

console.log("\n=== 10 Sep: the fork, and the eight screens behind the ceiling ===");
{
  /**
   * *"The path to the first recommendation must contain no more than 8
   * screens."*
   *
   * ⚠ **The ceiling is asserted here rather than in a comment**, which is the
   * whole point: `questions.ts` claimed this suite pinned it while nothing did,
   * and a count nobody checks is the one that drifts back. The eight are named
   * so the arithmetic is legible: `/join`, the two required questions, the
   * fork, the participation level, the review, the code and `/share`. Only the
   * middle four are screens this file can count; the other four are routes, so
   * they are stated as a constant and the sum is what is checked.
   */
  const AROUND_THE_FLOW = 4; // /join · review · the code · /share
  const required: ProfileAnswers = {
    ...q.EMPTY_ANSWERS,
    neighborhood: "pasadena",
    child_ages: [3],
  };
  const walked = q.visibleScreens(required);
  /* ⚠ **Four, and it was three for part of 15 Sep**: the two required
     questions merged that morning (*"всі сторінки, де є лише 1 питання …
     об'єднай"*) and were separated again the same day (*"ці перші сторінки
     мають йти окремо"*), so the path is where you live, the children, the fork
     and the participation level. Her ceiling is what matters and it is checked
     below; this is the arithmetic behind it. */
  ok(
    "the required path is four screens",
    walked.length === 4,
    walked.map((s) => s.id).join(","),
  );
  ok(
    "so a parent reaches the first recommendation in eight, never nine",
    walked.length + AROUND_THE_FLOW <= 8,
    `${walked.length} + ${AROUND_THE_FLOW}`,
  );
  ok(
    "and the two required questions are the only required ones on it",
    walked
      .flatMap((s) => q.visibleQuestions(s, required))
      .filter((x) => x.required)
      .map((x) => x.id)
      .join(",") === "neighborhood,child_ages,allowance",
    walked
      .flatMap((s) => q.visibleQuestions(s, required))
      .filter((x) => x.required)
      .map((x) => x.id)
      .join(","),
  );

  /**
   * Her four, named as optional — and read as **questions** since 15 Sep, when
   * three of the four stopped being screens of their own.
   *
   * ⚠⚠ **`topics_lived` changed sides twice on 15 Sep and is back where it
   * started.** It merged onto the participation screen, which is required, so
   * for part of that day it was asked of everybody; the developer then moved
   * it to `household_setup` so the participation screen could stand alone.
   * That screen is behind the fork, so Continue skips it again — which is the
   * cost 10 Sep already named and the client's to weigh: a parent who taps
   * Continue produces almost no relevance data, and this is the one optional
   * question that says what they could help with.
   */
  const askedOn = (a: ProfileAnswers) =>
    q
      .visibleScreens(a)
      .flatMap((x) => q.visibleQuestions(x, a))
      .map((x) => x.id);
  const OPTIONAL_QUESTIONS: QuestionId[] = ["schools", "classes", "childcare_now"];
  ok(
    "schools, classes and childcare are all behind the fork",
    OPTIONAL_QUESTIONS.every((id) => !askedOn(required).includes(id)),
    askedOn(required).join(","),
  );
  ok(
    "and they appear the moment the parent asks for them",
    OPTIONAL_QUESTIONS.every((id) =>
      askedOn({ ...required, wants_detail: true }).includes(id),
    ),
    "Continue skips all optional details — it must not delete them",
  );
  ok(
    "lived topics are behind the fork again, and still optional",
    !askedOn(required).includes("topics_lived") &&
      askedOn({ ...required, wants_detail: true }).includes("topics_lived") &&
      questionById("topics_lived")?.required !== true,
    askedOn(required).join(","),
  );
  /* The fork's own framing is hers, and it is the only argument the screen
     makes: no count of what is behind the door, no "recommended". */
  /**
   * ⚠ *"Store None yet and Homeschool as child statuses, not schools."* The
   * control was written inside the ordinary render, and the schools question
   * returns early down a **per-child** path for any family with more than one
   * child — so the two statuses reached only a one-child family, which is the
   * one that needs them least. Pinned on the source because both branches look
   * complete on their own.
   */
  {
    const flowSrc = fs.readFileSync(
      new URL("../components/seed/ProfileFlow.tsx", import.meta.url),
      "utf8",
    );
    ok(
      "the child-status control is offered on both render paths",
      (flowSrc.match(/\{childStatus\}/g) ?? []).length === 2,
      `${(flowSrc.match(/\{childStatus\}/g) ?? []).length} call site(s)`,
    );
    ok(
      "and neither of them is “Homeschool” as a school",
      !optionsOf("schools").some((o) => /homeschool|not_in_school/i.test(o.id)),
      "a school called Homeschool is a weight-5 edge between every homeschooling family",
    );
    /**
     * ⚠⚠ **`[].every(…)` is `true`, so an empty option list matched the plan
     * branch** and took precedence over the directory branch — a label over an
     * empty `role="radiogroup"` and no search box. `previous_places` is empty
     * by design (search-only, no starters curated), so from 9 Sep it had no
     * control at all and could not be answered. Pinned on the source, because
     * the branch is React and this suite is pure; the condition is what makes
     * it safe, so the condition is what is asserted.
     */
    /**
     * ⚠⚠ **"I confirmed my number and it still asks me to confirm it"** (15 Sep).
     *
     * `stage` stays `verify` across the write that follows a confirmed code —
     * correctly, it is one step — and the branch inside it rendered the code
     * box unconditionally. So any refusal of that write left the parent looking
     * at a Confirm button and *Send a new code*, neither of which can fix a
     * refused write, with the number confirmed the whole time. Pinned on the
     * source because the branch is React: what matters is that the render is
     * **conditional on the number being confirmed**, which is the property that
     * was missing rather than any particular markup.
     */
    ok(
      "a confirmed number is never shown the code box again",
      flowSrc.includes(") : confirmed ? (") &&
        flowSrc.includes("session.phone_verified === true && !existing"),
      flowSrc.includes(") : confirmed ? (")
        ? "the branch is there but nothing computes confirmed"
        : "the code box renders unconditionally",
    );
    /* And the refusal that is recoverable navigates rather than apologising:
       the route has named the missing fields since 27 Aug and nothing read
       them until this. */
    ok(
      "and a missing required answer sends them to the question, not to an apology",
      flowSrc.includes("unansweredRequired(err)") &&
        flowSrc.includes("goToQuestion(missing)"),
      "the 422 names the field; the flow has to use it",
    );
    ok(
      "an empty option list is not read as a comparison of plans",
      flowSrc.includes("shared.options.length > 0 &&"),
      flowSrc.slice(flowSrc.indexOf("const plans"), flowSrc.indexOf("const plans") + 90),
    );
    /* And the question it cost: still market-sourced, still searchable, so the
       box is still the whole control rather than chips nobody curated. */
    ok(
      "and previous places is still the search-only directory that exposed it",
      q.questionById("previous_places").source.type === "market" &&
        q.searchableCategory(q.questionById("previous_places"))?.category ===
          "previous_places",
      String(q.questionById("previous_places").source.type),
    );
    /**
     * ## 16 Sep — one description per field, and the hidden one is the name
     *
     * The developer, pointing at the Life Context screen: *"Where have you
     * lived before — прибрати опцію city, state or country"*. That box wore
     * three descriptions stacked: the question heading, a bold field label
     * saying the same thing in different words, and a placeholder saying it a
     * third time. The label is off the screen and **stays in the markup**,
     * because it is the input's accessible name and a placeholder is not one —
     * so the two halves are asserted separately. A check that only read the
     * flag would pass on a build that deleted the label outright.
     */
    {
      const dir = q.searchableCategory(q.questionById("previous_places"))!;
      ok(
        "the search box on previous places has no visible label of its own",
        dir.searchLabelHidden === true,
        "the question's own heading is directly above it — a second one repeats it",
      );
      ok(
        "and it still has one for a screen reader",
        typeof dir.searchLabel === "string" && dir.searchLabel.trim().length > 0,
        "hidden is sr-only, never absent: a placeholder is not an accessible name",
      );
      /* Read by the component, or the flag is a decision nothing carries out —
         the written-and-never-called fault this repository keeps paying for. */
      const searchSrc = fs.readFileSync(
        new URL("../components/ui/SearchableChipGroup.tsx", import.meta.url),
        "utf8",
      );
      ok(
        "the search field honours it",
        searchSrc.includes("labelHidden={searchLabelHidden}"),
        "the flag is declared and the Field never reads it",
      );
      ok(
        "and the flow passes it through",
        flowSrc.includes("searchLabelHidden={directory.searchLabelHidden}"),
        "set in questions.ts and dropped between there and the component",
      );
      /* And it does not spread: on the four local directories the box sits
         under a grid of chips, where the label is what separates the two
         controls and says that the rest of the market is reachable. */
      ok(
        "the directories that have chips above the box keep their label",
        (["schools", "classes", "clubs", "faith"] as const).every(
          (id) =>
            q.searchableCategory(questionById(id)!)?.searchLabelHidden !== true,
        ),
        "a label under a chip grid is doing work a heading is not",
      );
    }
    /**
     * ## 16 Sep — schools is a dropdown, and that reverses the client
     *
     * She said *"на цій сторінці не потрібні були dropdown"* on 8 Sep, pointing
     * at this very screen; the developer asked for it back on 16 Sep and the
     * newer instruction wins. Pinned in both directions so neither side is lost
     * by accident: the dropdown is on, and the starters that made the chips
     * defensible are still curated per area, so restoring the chips is a
     * one-line change rather than a rebuild.
     */
    {
      const dir = q.searchableCategory(questionById("schools")!)!;
      ok("the schools question is a dropdown", dir.dropdown === true);
      ok(
        "and it is still the area-trimmed directory, not a wholeList",
        dir.wholeList !== true,
        "trimming to the parent's own area is what made eight starters the right number",
      );
      /**
       * ⚠ The fault the dropdown introduces if nobody threads it: this question
       * repeats **per child**, and a dropdown's `searchLabel` is its accessible
       * name — so two children would give a screen-reader user two controls
       * called "Search all schools, preschools and daycares".
       */
      ok(
        "each child's box is named for that child, not for the question",
        flowSrc.includes("directory.dropdown") &&
          flowSrc.includes("? block.heading"),
        "the per-child branch has to pass the block heading once this is a dropdown",
      );
      ok(
        "schools is still asked per child",
        questionById("schools")?.perChildRepeat === true,
        "the naming rule above only matters while it is",
      );
    }
  }

  /**
   * `unansweredRequired` — the reader for the one refusal this flow recovers
   * from. Loadable here because `lib/submit.ts` has no browser-only work at
   * module level; every case below is a real body shape the route can send.
   */
  {
    /* ⚠ **`ApiError` comes from `submit` itself**, not from a second import
       of `api-client`. `submit.ts` imports that module by its plain path, so
       importing it here with a cache-busting query loads a *second* copy with
       its own `ApiError` class — and `instanceof` against the wrong class is
       false, so every check below failed while the code they test was correct. */
    const submit = (await import(
      `../lib/submit.ts?v=${Date.now()}`
    )) as typeof import("../lib/submit.ts");
    const err = (status: number, body: string) => new submit.ApiError(body, status);
    ok(
      "a 422 naming a required answer comes back as that field",
      submit
        .unansweredRequired(
          err(422, JSON.stringify({ reason: "invalid_required_answers", fields: ["child_ages"] })),
        )
        ?.join(",") === "child_ages",
      "the route names the field; this is what reads it",
    );
    /* ⚠ Refused-but-unnamed is not the same as something-else-went-wrong: the
       first still means an answer is missing, so it must not collapse to null
       and send the parent down the generic apology. */
    ok(
      "a 422 with no fields still means an answer is missing",
      submit.unansweredRequired(
        err(422, JSON.stringify({ reason: "invalid_required_answers" })),
      )?.length === 0,
      "empty is not null",
    );
    ok(
      "and every other failure is left alone",
      submit.unansweredRequired(err(500, "upstream exploded")) === null &&
        submit.unansweredRequired(err(422, "not json at all")) === null &&
        submit.unansweredRequired(
          err(422, JSON.stringify({ reason: "something_else", fields: ["x"] })),
        ) === null &&
        submit.unansweredRequired(new Error("not an ApiError")) === null,
      "a wrong recovery is worse than none — it navigates on a failure it cannot fix",
    );
  }

  ok(
    "the fork says why more detail is worth giving, and asks nothing",
    /the more detail you give/i.test(
      (screenById("detail_fork")?.statement?.body ?? []).join(" "),
    ) && (screenById("detail_fork")?.questions.length ?? -1) === 0,
    "the more detail you give, the more custom your answers will be",
  );
}

console.log("\n=== 10 Sep: what a reload must not quietly lose ===");
{
  /**
   * ⚠⚠ Both of these were found by **reloading the page in a browser**, and
   * neither is visible from inside one session: the value lives in React state
   * and only a reload consults `normaliseAnswers`. Both were introduced by this
   * round's own changes, one layer below the change that needed them.
   */
  /* Imported here rather than at the top: `lib/storage.ts` is a "use client"
     module, and node only tolerates that because every `window` reference in
     it is inside a function body. Keeping the import local says so. */
  const st = (await import(
    `../lib/storage.ts?v=${Date.now()}`
  )) as typeof import("../lib/storage.ts");

  const stored = {
    ...q.EMPTY_ANSWERS,
    /* The fork. A boolean, and the generic branch handled strings and lists. */
    wants_detail: true,
    /* Twins, and an order that is the children's identity. */
    child_ages: [3, 3, 9],
    child_months: { "0": 4, "2": 11 },
  };
  const back = st.normaliseAnswers(stored);

  ok(
    "the fork answer survives a reload",
    back.wants_detail === true,
    String(back.wants_detail) + " — otherwise every optional screen vanishes on the way back",
  );
  ok(
    "two children born in one year stay two children",
    back.child_ages.length === 3 && back.child_ages.filter((a) => a === 3).length === 2,
    JSON.stringify(back.child_ages),
  );
  ok(
    "and their order is untouched, because the index is the identity",
    JSON.stringify(back.child_ages) === JSON.stringify([3, 3, 9]),
    JSON.stringify(back.child_ages) + " — child_months and child_of are keyed by position",
  );
  ok(
    "the month still belongs to the child it was tapped for",
    back.child_months["0"] === 4 && back.child_months["2"] === 11,
    JSON.stringify(back.child_months),
  );
  /* The domain check that was the reason for the filter in the first place. */
  ok(
    "an age outside the range the server accepts is still dropped",
    st.normaliseAnswers({ ...q.EMPTY_ANSWERS, child_ages: [3, 99, -4] }).child_ages.join(",") === "3",
    "a stored value the route refuses would be re-refused on every save, silently",
  );
}

console.log("\n=== 10 Sep: a child is a position, never a birth year ===");
{
  /**
   * ⚠⚠ **`child_of` became a map of positions when duplicate birth years were
   * allowed, and three separate readers had to be told.** The route was, the
   * derivation was, and `childrenFor` was not — so it filtered the picked
   * *positions* against the set of *ages* and every one failed to match:
   * per-child attribution was silently dropped for every family with more than
   * one child. Nothing threw, the tap was stored, and the edge came back with
   * no child on it.
   *
   * These pin the model itself rather than one caller, because the next reader
   * of `child_of` will have the same choice to get wrong.
   */
  const schoolQuestion = questionById("schools")!;
  const two: ProfileAnswers = {
    ...q.EMPTY_ANSWERS,
    child_ages: [3, 6],
    schools: ["walden-school"],
    child_of: { schools: { "walden-school": [1] } },
  };
  ok(
    "an attribution names the position the parent tapped",
    JSON.stringify(q.childrenFor(schoolQuestion, two, "walden-school")) === "[1]",
    JSON.stringify(q.childrenFor(schoolQuestion, two, "walden-school")),
  );
  ok(
    "a position nobody added is dropped",
    JSON.stringify(
      q.childrenFor(schoolQuestion, { ...two, child_of: { schools: { "walden-school": [1, 7] } } }, "walden-school"),
    ) === "[1]",
  );
  /* The shortcut, and the reason it counts children rather than years. */
  ok(
    "one child needs no attribution and gets position 0",
    JSON.stringify(
      q.childrenFor(schoolQuestion, { ...q.EMPTY_ANSWERS, child_ages: [4], schools: ["walden-school"] }, "walden-school"),
    ) === "[0]",
  );
  ok(
    "but twins are two children, not one shared year",
    JSON.stringify(
      q.childrenFor(
        schoolQuestion,
        { ...q.EMPTY_ANSWERS, child_ages: [4, 4], schools: ["walden-school"], child_of: { schools: { "walden-school": [1] } } },
        "walden-school",
      ),
    ) === "[1]",
    "on distinct ages this took the one-child shortcut and attributed to a child that is not a position",
  );
  ok(
    "a child on the way owns nothing",
    q.childrenFor(schoolQuestion, { ...q.EMPTY_ANSWERS, child_ages: [-1], schools: ["walden-school"] }, "walden-school").length === 0,
    "a school cannot belong to a child who is not born",
  );
}

console.log("\n=== 10 Sep: the name is private until this one card says otherwise ===");
{
  /* Its own copy: the helper above is scoped to that block, and hoisting it to
     module level would put a file read at the top of a suite most of whose
     checks are pure. */
  const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const bubble = src("../components/seed/chat/Bubble.tsx");
  const chat = src("../components/seed/chat/ChatSeeding.tsx");
  const cards = src("../lib/server/repo/cards.ts");
  const save = src("../app/api/seed/save/route.ts");
  const composer = src("../lib/answer.ts");

  ok(
    "the standing answer defaults to private",
    q.EMPTY_ANSWERS.attribution === "name_private",
    String(q.EMPTY_ANSWERS.attribution),
  );
  ok(
    "and her sentence is the one the share screen states",
    /Your name stays private unless you choose to show it/.test(chat),
    "her wording, verbatim",
  );
  /**
   * ⚠ The four links of the chain, each asserted separately, because the
   * failure this feature shipped with was that three of them were missing and
   * the fourth looked finished: a column, a migration and a control nobody
   * rendered.
   */
  ok(
    "the card offers the toggle",
    /onToggleName/.test(bubble) && /onToggleName=\{/.test(chat),
    "declared and passed — a prop nobody passes is a control nobody sees",
  );
  ok(
    "toggling re-sends the card rather than only moving local state",
    /function toggleName/.test(chat) && /void persist\(\{ \.\.\.card, show_name: next \}\)/.test(chat),
    "the decision lives on the row, so it has to reach the row",
  );
  ok(
    "the route reads it beside the fields, never from inside them",
    /show_first_name: raw\.submission\.show_name === true/.test(save),
    "a privacy decision is not evidence of what the parent said about the place",
  );
  ok(
    "and the write is === true, so every unsure path lands on private",
    /showFirstName: input\.show_first_name === true/.test(cards),
    "a missing key, a string, a null and an older client all mean no",
  );
  ok(
    "the composer names the parent on their own sentence",
    /\$\{named \?\? "One"\} said:/.test(composer),
    "the name and the quote come from one contribution or there is no name",
  );
  ok(
    "and never twice on one record",
    /evidenceSentence\(candidate, great \? null : named\)/.test(composer),
    "the quote wins the name; the evidence line takes it only when there is none",
  );
}

console.log("\n=== 10 Sep: the wording round, and the one consent ===");
{
  const c = (await import(
    `../lib/consent.ts?v=${Date.now()}`
  )) as typeof import("../lib/consent.ts");
  const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const chat = src("../components/seed/chat/ChatSeeding.tsx");
  const join = src("../components/seed/InviteLanding.tsx");
  const flow = src("../components/seed/ProfileFlow.tsx");
  const bar = src("../components/ui/BrandPanel.tsx");

  /**
   * ⚠⚠ **One checkbox, and its text has to cover both things** — the client,
   * 10 Sep: *"Two SMS consent requests look contradictory. Use one
   * counsel-approved checkbox on Join covering verification and recurring
   * Pando messages."*
   *
   * The failure mode this guards is not a missing checkbox, which anybody
   * would notice: it is a merge that quietly drops a clause. The 2 Sep consent
   * existed to name **recurring automated** messaging and **RCS**, which the
   * carriers want named, and deleting it while leaving the older text would
   * have removed both without anything looking wrong.
   */
  for (const [what, pattern] of [
    ["recurring automated messaging", /recurring automated/i],
    ["RCS by name", /RCS/],
    ["the verification code it also covers", /verification code/i],
    ["the frequency disclosure", /Message frequency varies/],
    ["the rates disclosure", /rates may apply/i],
    ["STOP and HELP", /STOP to opt out, HELP for help/],
  ] as Array<[string, RegExp]>) {
    ok(`the single consent names ${what}`, pattern.test(c.SMS_CONSENT_TEXT), c.SMS_CONSENT_TEXT.slice(0, 80));
  }
  ok(
    "and it is a new version, because the text changed",
    c.SMS_CONSENT_TEXT_VERSION === "seed-sms-2026-09-10",
    c.SMS_CONSENT_TEXT_VERSION,
  );
  /* The split is derived, so the label can never carry the carrier disclosure
     — a tap anywhere in a label toggles its checkbox. */
  ok(
    "the label half still stops before the disclosure",
    !/Message frequency varies/.test(c.SMS_CONSENT_AGREEMENT) &&
      /* Rejoined rather than counted: the agreement half is trimmed, so the
         lengths differ by the one space at the seam and an arithmetic check
         has to know that. This says the only thing that matters — the two
         halves on screen are the registered text and nothing else. */
      `${c.SMS_CONSENT_AGREEMENT} ${c.SMS_CONSENT_TERMS}` === c.SMS_CONSENT_TEXT,
    "derived from one string, never two copies",
  );
  ok(
    "the reassurance is on the join screen and out of the field hint",
    /SMS_CONSENT_REASSURANCE/.test(join) && !/hint=\{SMS_CONSENT_REASSURANCE\}/.test(join),
    "Keep it and make it more visible",
  );

  /* One opening bubble, not three. */
  ok(
    "the share screen opens with her question and nothing before it",
    /What’s one thing you’d recommend to another parent\?/.test(chat),
    "Thanks, {first name}. What's one thing you'd recommend to another parent?",
  );
  ok(
    "and the two lines it replaced are gone",
    !/the part only you can answer/.test(chat) &&
      !/What would you like to share first/.test(chat),
    "three opening bubbles became one",
  );
  ok(
    "the reuse disclosure is her sentence, not ours",
    /Pando may use what you share to answer other parents’ questions, following your privacy settings/.test(chat),
  );

  /**
   * ⚠⚠ **Narrowed on 15 Sep to the popup alone**, on the developer's *"поверни
   * реферальне посилання … на сторінку share"*. Her 10 Sep sentence — *"The
   * Invite button appears only after the first recommendation is saved"* — hid
   * the pill for the whole of a parent's first visit to the one screen they
   * sit on, so the pill now renders whenever there is a code and the modal
   * still waits. What is asserted is the half that still holds, plus that the
   * pill is no longer behind the gate, so a session restoring her original
   * rule has to meet this and read why.
   */
  ok(
    "the referral popup still waits for the first saved recommendation",
    /hasSavedRecommendation && !session\.referral_shown_at/.test(chat) &&
      /submissions \?\? \[\]\)\.some\(\(s\) => s\.persisted\)/.test(chat),
    "a modal asking for referrals before anything has been given is what her rule protected",
  );
  ok(
    "and the pill itself is not behind it",
    /session\?\.referral_code \? \(\s*<ReferralHeaderInvite/.test(chat) &&
      !/hasSavedRecommendation[\s\S]{0,40}<ReferralHeaderInvite/.test(chat),
    "the invite link is on /share whenever Pando has one to give",
  );

  /**
   * ⚠⚠ **"Text me a code" belongs to the control that sends one**, and since
   * 15 Sep that is the join CTA as well.
   *
   * Her list twice asked for that label there. A button saying it has to send
   * a code, which moves the OTP to the front door — so on 10 Sep she was asked
   * directly and answered *"Ні, код надсилаємо в кінці"*, and the label stayed
   * off it. The developer has since moved verification in front of the
   * questions, so the tap does send one and her wording is finally true where
   * she asked for it. ⚠ Both halves are hers to confirm together: the label is
   * what she asked for twice, the placement is what she declined once.
   *
   * ⚠ **The rule is what is asserted, never the placement** — a control may
   * say it texts a code only where one can actually be sent, which is why the
   * label is gated on `sendable` rather than written flat. The second check
   * keeps her wording on the panel that sends, so neither half can be "fixed"
   * away on its own.
   */
  const verify = src("../components/seed/VerifyPhone.tsx");
  {
    /* Measured as a distance rather than matched as a pattern: what has to
       hold is that the label sits inside the gate's own branch, and a regex
       spanning two lines of JSX is a worse way to say that than an index. */
    const label = join.indexOf('"Text me a code"', join.indexOf("{checking"));
    const gated = join.lastIndexOf("gate.sendable", label);
    ok(
      "the join CTA promises a code only where one can be sent",
      label > 0 && gated > 0 && label - gated < 120,
      "conditional on the gate, or it promises a text that can never arrive",
    );
  }
  ok(
    "and the button that does send one says exactly that",
    /"Text me a code"/.test(verify),
    "her wording, on the control where it is true",
  );

  /* Two screens' worth of her replacements. */
  ok("Step 2 is named for what it does", /Step 2 · Share what you know/.test(bar));
  ok(
    "the code screen says what it is for",
    /Verify your number to save your profile/.test(flow) &&
      !/Nothing has left this phone yet/.test(flow),
  );

  /* “Network Check” is her word, and it is now the product's. */
  const parentFacing = [
    "../app/(site)/page.tsx",
    "../components/seed/done/WhatsNext.tsx",
    "../components/seed/done/FinishAsks.tsx",
  ];
  ok(
    "no parent-facing surface says Network Ask any more",
    parentFacing.every((f) => !/Network Ask/.test(src(f).replace(/\/\*[\s\S]*?\*\//g, ""))),
    parentFacing.filter((f) => /Network Ask/.test(src(f).replace(/\/\*[\s\S]*?\*\//g, ""))).join(", "),
  );

  /**
   * ⚠⚠ **The launch offer, and "once" is the part that needs a test** (10 Sep
   * §6). Her rules are positional as much as textual: the exact sentence, in
   * the invite and **once** on Join, Terms as a link, separate from the SMS
   * consent, and *"do not show the reward or add a reward step anywhere in the
   * profile"*. Three of those five are about where it is **not**.
   */
  const rewards = (await import(
    `../lib/rewards.ts?v=${Date.now()}`
  )) as typeof import("../lib/rewards.ts");
  ok(
    "the offer is on the join page",
    join.includes("REWARD_OFFER"),
    "once, under the inviter line",
  );
  ok(
    "exactly once",
    (join.match(/\{REWARD_OFFER\}/g) ?? []).length === 1,
    `${(join.match(/\{REWARD_OFFER\}/g) ?? []).length} occurrence(s)`,
  );
  ok(
    "and in the invite a parent sends",
    src("../components/seed/done/WhatsNext.tsx").includes("REWARD_OFFER"),
  );
  ok(
    "but nowhere in the profile — no reward, no reward step",
    !/REWARD_|reward/i.test(flow.replace(/\/\*\*[\s\S]*?\*\//g, "")),
    "Do not show the reward or add a reward step anywhere in the profile",
  );
  /* Separate from SMS consent: the offer must not sit inside the label, or
     agreeing to messages and accepting an offer become one tap. */
  ok(
    "and it is outside the consent label",
    join.indexOf("{REWARD_OFFER}") < join.indexOf("<Consent"),
    "a payment offer inside a consent label is one tap for two decisions",
  );
  ok(
    "the amount and the deadline are stated once, in one module",
    rewards.REWARD_AMOUNT_USD === 10 && /Oct 31, 2026/.test(rewards.REWARD_OFFER),
    rewards.REWARD_OFFER,
  );

  /* 21 Sep, the developer: the circles screen's first paragraph is removed
     in full. It stated two rules the code still enforces; the screen no
     longer prints them. */
  const circles = screenById("communities")?.help ?? "";
  ok(
    "the circles screen carries no screen-level help paragraph",
    circles === "",
    circles,
  );
  /* Once, under the first field only. `SEARCHABLE_QUESTIONS` is private, so
     this reads the source: the claim is about how many times the sentence is
     written, which is exactly what a text search answers. */
  const questionsSrc = src("../lib/questions.ts");
  const crossTown =
    (questionsSrc.match(/It doesn.t have to be in your own city/g) ?? []).length;
  ok(
    "the cross-town line is written twice, not four times",
    crossTown === 2,
    `${crossTown} occurrence(s) — schools has its own screen; classes is the first field on the circles page`,
  );
}

/**
 * ## 16 Sep — how full the profile is, as the parent is told it
 *
 * The developer asked for a banner on the save screen and on `/share` saying a
 * parent should fill the profile in as fully as possible for the quality of
 * their answers, with a bar for how far along they are.
 *
 * ⚠⚠ **The measure could not be `profileCompleteness`**, and that is what these
 * checks are really pinning. That function counts the screens a parent can
 * *see*, and `visibleScreens` returns four of them for somebody who tapped
 * Continue at the fork — so it reports **67%** for a profile carrying nothing
 * but the two required answers, and does not move at all when real detail is
 * added. A banner built on it would tell a parent they were two-thirds done at
 * the moment they were thinnest.
 */
console.log("\n=== 16 Sep: the completeness a parent is shown ===");
{
  /* `q` is a dynamic import rather than a namespace, so its types are reached
     through the function that takes them rather than through `q.Type`. */
  type Answers = Parameters<typeof q.profileDepth>[0];
  const mk = (over: Partial<Answers>): Answers =>
    ({ ...q.EMPTY_ANSWERS, ...over }) as Answers;

  const bare = mk({ neighborhood: "altadena", child_ages: [5] });
  const deeper = mk({
    neighborhood: "altadena",
    child_ages: [5],
    wants_detail: true,
    time_in_area: "4_9_years",
    family_structure: ["two_parents"],
    schools: ["field-elementary"],
  });

  const a = q.profileDepth(bare);
  const b = q.profileDepth(deeper);

  ok(
    "the denominator is the whole questionnaire, not the part they are walking",
    a.total === b.total && a.total > 15,
    `${a.total} vs ${b.total}`,
  );
  ok(
    "so the two required answers are not reported as a finished profile",
    a.percent < 25,
    `${a.percent}%`,
  );
  ok(
    "and the stored figure, which is not this, would have said otherwise",
    q.profileCompleteness(bare) > 50,
    "if this ever drops below the bar above, the two have converged and the banner can use one measure",
  );
  ok("adding detail moves it", b.percent > a.percent, `${a.percent}% → ${b.percent}%`);
  ok(
    "while the stored figure does not",
    q.profileCompleteness(bare) === q.profileCompleteness(deeper),
    "the reason there are two numbers",
  );

  /* Counted per question rather than per screen: since the 9 Sep merges one tap
     on a four-question screen would otherwise have moved this by a fifth. */
  ok(
    "it counts questions, not screens",
    b.total > q.visibleScreens(mk({ wants_detail: true })).length,
    `${b.total} questions against ${q.visibleScreens(mk({ wants_detail: true })).length} screens`,
  );

  /* An expecting parent is not measured against questions about a born child:
     they are never asked them, so counting them would make the bar unreachable
     for a reason the parent cannot act on. */
  const expecting = q.profileDepth(mk({ neighborhood: "altadena", child_ages: [-1] }));
  ok(
    "an expecting parent has a smaller questionnaire, not a worse score",
    expecting.total < a.total,
    `${expecting.total} vs ${a.total}`,
  );

  ok("it never exceeds 100", b.percent <= 100 && a.percent <= 100);
  ok(
    "and an empty profile is near zero rather than at it",
    q.profileDepth(mk({})).percent < 10,
    "the name-privacy default is a real answer already in force, so it is counted",
  );
}

/**
 * ## 16 Sep — the referral link motivates, and promises nothing
 *
 * The developer asked for encouraging copy beside the link. The encouragement is
 * allowed; a **reward** is not, and the reason is not squeamishness:
 *
 *  - a referral credit is denominated in Network Checks and **nothing grants
 *    one** — the only `insert into credits` is the blast-expiry guarantee,
 *    `referral.link` writes `profile_complete`, and no admin action exists;
 *  - the client's §6 of 10 Sep says the guaranteed $10 is *"the only launch
 *    incentive"*, so a second one is hers to decide.
 *
 * `/done/next` promised *"you earn a free Targeted Network Check"* until today,
 * on the last screen of the flow, kept by nobody — so this is pinned rather than
 * left to a comment for the third time.
 */
console.log("\n=== 16-17 Sep: the invite motivates, and names nothing it cannot grant ===");
{
  const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const referralSrc = src("../components/seed/ReferralInvite.tsx");
  const nextSrc = src("../components/seed/done/WhatsNext.tsx");

  /* The sentence itself, read out of the constant rather than restated here —
     a copy in the suite is a copy that drifts. */
  const strip = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const why = /export const WHY_INVITE =\s*"([^"]+)"/.exec(referralSrc)?.[1] ?? "";
  ok("there is a motivating line at all", why.length > 40, `${why.length} chars`);
  ok(
    "and it names the benefit rather than the mechanic",
    /answer/i.test(why),
    "the mechanic — who gets recorded as the referrer — answers a question nobody asked",
  );
  /**
   * 17 Sep — **one paragraph beside the link, not two**, and that is the
   * developer's answer to their own request rather than an omission.
   *
   * Asked for motivating copy, the slot under `WHY_INVITE` held two different
   * second paragraphs on one day and both were removed on sight. First an
   * abstract reward hedged as *"we're working out how … you'll hear at
   * launch"* — *"не потрібно цього тексту, що ми працюємо"*, because a
   * decision Pando has not taken is a sentence about Pando. Then the honest
   * replacement, naming what a thin network costs — *"прибери цей блок"*.
   *
   * ⚠ So what is pinned is the **claims**, not the shape: a future second
   * paragraph is allowed, and these two are not. Reading the whole file
   * rather than one constant is deliberate — the version that read
   * `WHY_INVITE` alone went on passing while the paragraph beside it promised
   * a reward, which is how a guard stops describing the screen.
   */
  /**
   * ⚠ The one named exception, and it is an **identifier** rather than copy:
   * `REWARD_OFFER` is her $10, it is for whoever *joins*, and it belongs in
   * the message a parent sends. Excusing the token by name rather than
   * loosening the pattern is what keeps a `REWARD_OFFER_FOR_SENDER` catchable,
   * and its own presence is still asserted separately below.
   */
  /**
   * ⚠⚠ **Comments, imports and one identifier come out first, and each
   * exclusion is narrow on purpose** — what is left is as close to *what a
   * parent reads* as a source file gets.
   *
   * `REWARD_OFFER` is excused **by name**: it is her $10, it is for whoever
   * *joins*, and it belongs in the message a parent sends. Excusing the token
   * rather than loosening the pattern keeps a `REWARD_OFFER_FOR_SENDER`
   * catchable, and its presence is asserted separately below.
   *
   * Import lines go because a module path is never copy — `@/lib/rewards`
   * matches `\breward` at the slash, which is the guard failing on its own
   * plumbing rather than on anything anybody reads.
   */
  const invite = (strip(referralSrc) + strip(nextSrc))
    .replace(/^import[\s\S]*?from\s+"[^"]*";$/gm, "")
    .replaceAll("REWARD_OFFER", "");
  ok(
    "the invite offers the sender nothing to earn",
    /* ⚠ Prefixes, never whole words. `\breward\b` does not match
       **rewarded**, which is the exact wording just removed — the 9 Sep
       `nosebleed` / `nosebleeds` fault, caught here by running the guard
       against the sentence it exists to refuse rather than by reading it. */
    !/\bearn|\bcredit|\breward|\bbonus|\bgift/i.test(invite),
    "nothing in this codebase grants a referral credit",
  );
  ok(
    "and never says a decision about one is pending",
    !/working out|at launch|during the pilot|coming soon/i.test(invite),
    "a pending promise reads worse than no promise",
  );

  /* Every surface reads the one constant, which is what stopped three of them
     drifting and is what let the fourth be fixed in one place. */
  for (const [name, count] of [["ReferralInvite", 3], ["WhatsNext", 1]] as const) {
    const body = name === "ReferralInvite" ? referralSrc : nextSrc;
    for (const token of ["WHY_INVITE"] as const) {
      ok(
        `${name} renders ${token} on every surface`,
        (body.match(new RegExp(`\\{${token}\\}`, "g")) ?? []).length >= count,
        `${(body.match(new RegExp(`\\{${token}\\}`, "g")) ?? []).length} of ${count}`,
      );
    }
  }

  /**
   * ⚠ Source checks rather than string checks, because what must not come back
   * is the *claim*, in whatever wording. Comments are stripped first: the fix
   * itself quotes the old sentence to explain why it went.
   */
  /**
   * ⚠ The **referral card**, not the whole module. `/done/next` also carries the
   * client's own *"their first Network Check on us"* on the Founding card — a
   * different claim, from her strategy §8 rather than from us, and not this
   * guard's business. A file-wide grep fails on it and would push somebody
   * into editing her copy to make a test go green.
   */
  const referralCard = nextSrc.slice(nextSrc.indexOf("function ReferralCard"));
  for (const [name, body] of [
    ["the invite surfaces", referralSrc],
    ["the thank-you card", referralCard],
  ] as const) {
    /* ⚠ Renamed on 17 Sep and **not** relaxed: the surfaces now do offer the
       sender something, so the old name (`offer the sender nothing to earn`)
       described a screen that had changed. What the grep forbids is unchanged
       and is the part that matters — a named unit nothing grants. */
    ok(
      `${name} name no reward this codebase cannot grant`,
      !/you earn|Network Check|Network Ask/i.test(strip(body)),
      "a credit nothing in this codebase grants",
    );
  }

  /**
   * ⚠⚠ And the guard above must not take the **real** offer with it. The $10 is
   * the client's own, it is for whoever *joins* rather than for the sender, and
   * it belongs in the invite message — deleting it while removing a reward the
   * sender was falsely promised would be this fix overshooting.
   */
  ok(
    "the invited parent is still told about the guaranteed $10",
    nextSrc.includes("REWARD_OFFER"),
    "her §6 offer, in the message a parent sends",
  );
}

console.log("\n=== 17 Sep: every card ends with an open question ===");
{
  /**
   * The developer: *"в кінці додавання певної активності, tip, place додати
   * можливість в кінці вказати свій коментар або скіпнути його, **це має бути
   * останнє питання**"*.
   *
   * ⚠⚠ Checked on the **built script** rather than on the source, because
   * *last* is a property of the array and a reorder is exactly what would
   * break it silently — appending a step below this one costs nothing at
   * typecheck and quietly demotes the question the developer asked to be
   * last.
   */
  const { buildScripts } = (await import(
    `../lib/seed-chat/scripts.ts?v=${Date.now()}`
  )) as typeof import("../lib/seed-chat/scripts.ts");
  const scripts = buildScripts("pasadena");

  for (const kind of ["activity", "place", "tip"] as const) {
    const steps = scripts[kind].steps;
    const last = steps[steps.length - 1];
    ok(`${kind} ends on the open question`, last?.id === "extra_note", String(last?.id));
    /**
     * ⚠ Ungated on purpose. Behind `wantsMore` it would be the last question
     * of the *detailed* branch, and most parents take the short path — so it
     * would be hidden from exactly the people it is for.
     */
    ok(`and asks it of everybody, not just the detailed branch`, last?.when === undefined);
    /* A skip is an answer (1 Sep), and the label says what is declined. */
    ok(
      `and can be skipped in words`,
      last?.optional === true && typeof last?.skipLabel === "string",
      `${last?.optional} / ${last?.skipLabel}`,
    );
    ok(`and it is a field rather than a choice`, last?.widget === "text");
    /* It appears once. Two open questions on one card is the pitch fault the
       invite surfaces were just fixed for. */
    ok(
      `and appears exactly once on the card`,
      steps.filter((x) => x.id === "extra_note").length === 1,
    );
    /**
     * ⚠⚠ The swap, and it is the half that was got backwards first. *Anything
     * else* reads as *another recommendation*, which is what the line **after**
     * the saved card asks; this step is about **this** card, so it must ask for
     * their own comment and must not borrow the other sentence's words.
     */
    ok(
      `and asks it in the developer's words (23 Sep)`,
      last?.prompt === "Is there anything you think other parents should know?",
      String(last?.prompt),
    );
    ok(
      `and asks for their own comment rather than "anything else"`,
      !/anything else/i.test(String(last?.prompt)),
      String(last?.prompt),
    );
  }

  /**
   * ⚠⚠ The reported bug itself: *"Anything else worth adding?"* over two
   * buttons — an open question answered by a choice. Those words belong to
   * the text step now, so the fork must not still be asking them.
   */
  const fork = scripts.activity.steps.find((x) => x.id === "more_detail");
  ok(
    "the detail fork no longer asks an open question",
    !/anything else/i.test(String(fork?.prompt)),
    String(fork?.prompt),
  );
  /* And it no longer claims the card is saved at that tap, because it is not:
     one more question follows whichever button they press. */
  ok(
    "nor claims the card is saved at that tap",
    !fork?.options?.some((o) => /save it/i.test(o.label)),
    JSON.stringify(fork?.options?.map((o) => o.label)),
  );

  /**
   * The other half of the swap, on the **source** rather than on the script,
   * because this sentence is a branch inside a React component the pure suite
   * cannot render. It is the line that follows a saved card, so *anything
   * else* is exactly what it means — and it must not go back to *Want to add
   * another?*, which is what the first pass left it saying.
   */
  const chat = fs.readFileSync(
    new URL("../components/seed/chat/ChatSeeding.tsx", import.meta.url),
    "utf8",
  );
  ok(
    "the line after a saved card asks for anything else",
    /Got it, thank you\. Anything else you'd like to share\?/.test(chat),
  );
  ok(
    "and the two sentences are not the same words",
    !chat.includes(String(scripts.activity.steps.at(-1)?.prompt)),
    String(scripts.activity.steps.at(-1)?.prompt),
  );
}

/**
 * ## 17 Sep — where you live is one searchable box
 *
 * Her §5: *"Searchable combobox instead of a dropdown, placeholder 'Type your
 * town, neighborhood or ZIP code'; if a place has multiple ZIPs, ask one
 * follow-up question. Scope: SGVCOG footprint + West Covina + major
 * unincorporated communities."*
 *
 * Most of these read the **source**, because `SEARCHABLE_QUESTIONS` is private
 * to `lib/questions.ts` and the placeholder is a branch inside a React
 * component this pure suite cannot render.
 *
 * ⚠ The one worth having is `searchPlaces`: it was written on 14 Sep with her
 * placeholder quoted in its own header and **was called by nobody** until
 * today, so what is asserted is that the picker actually reaches it. That is
 * the written-and-never-called fault this repository keeps paying for, pinned
 * rather than remembered.
 */
{
  const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const places = (await import(`../lib/home-places.ts?v=${Date.now()}`)) as typeof import("../lib/home-places.ts");
  const questionsSrc = src("../lib/questions.ts");
  const picker = src("../components/ui/SearchableChipGroup.tsx");

  /* Read as the block between this entry and the next top-level key, so a
     `dropdown` belonging to some other directory cannot satisfy it. */
  const entry = questionsSrc.slice(
    questionsSrc.indexOf("  neighborhood: {"),
    questionsSrc.indexOf("  camps: {"),
  );
  ok("where you live is a searchable box, not a wall of chips", /dropdown: true/.test(entry));
  ok(
    "and it still offers every approved town, uncapped and untrimmed",
    /wholeList: true/.test(entry),
  );

  ok(
    "the placeholder is hers, verbatim",
    picker.includes('"Type your town, neighborhood or ZIP code"'),
  );
  /* One expression, both branches: two copies is how the dropdown branch came
     to render `OptionPicker`'s own default on the one question whose
     placeholder she specified by hand. */
  /* The string literal, not the sentence — the cost-control note above the
     ZIP branch quotes her wording too, and a comment saying what the code does
     is not a second copy of it. */
  const written = (picker.match(/\"Type your town, neighborhood or ZIP code\"/g) ?? []).length;
  ok(
    "and it is written once, so both branches read the same string",
    written === 1,
    `${written} occurrence(s)`,
  );

  ok(
    "a name inside the footprint is answered from the bundle, not only a ZIP",
    /searchPlaces\(/.test(picker),
  );

  /* Her follow-up, from both sides: asked where there is a choice to make, and
     never where there is exactly one possible answer. */
  ok(
    "a place with several ZIPs is asked which one",
    places.zipChoiceNeeded("covina") && places.zipOptionsFor("covina").length === 3,
  );
  ok(
    "a place with one ZIP is not asked a question with one answer",
    !places.zipChoiceNeeded("azusa") && places.zipOptionsFor("azusa").length === 1,
  );
  /* A ZIP several places share returns all of them — her "don't make users pick
     from duplicate city rows upfront", satisfied from the other side. */
  ok(
    "a shared ZIP returns every place it serves",
    places.placesForZip("91702").length === 3,
  );

  /* Her scope, asserted as membership rather than as a count, which would
     break the day she adds one. */
  for (const id of [
    "west-covina",
    "azusa",
    "pomona",
    "claremont",
    "altadena",
    "hacienda-heights",
    "rowland-heights",
  ]) {
    ok(`${id} is inside the footprint`, places.placeById(id) !== null);
  }
}

/**
 * ## 21 Sep — the reminder is a banner, on five screens, until the profile
 * clears the bar
 *
 * Three instructions in one day on one thing, and they have to be read in
 * order. Remove the "N questions still to answer…" paragraph and put a pop-up
 * in its place; move that pop-up to the bottom-right corner; then *"чи не
 * можна його зробити постійним банером … поки він не заповнить профіль на
 * потрібний відсоток. І не тільки на цій сторінці, а і на сторінці
 * рекомендацій і на інших"*.
 *
 * ⚠ So the pop-up's checks are **rewritten rather than deleted**: what
 * replaced them is a banner with no timer and no X, and the next reader needs
 * to know which way it went. The corner and the dock-clearance measurement
 * went with it — a banner in the flow has neither.
 *
 * Read on the **source**, because all of it is React this suite cannot render.
 */
{
  const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const flow = src("../components/seed/ProfileFlow.tsx");
  const depth = src("../components/seed/ProfileDepth.tsx");
  const chat = src("../components/seed/chat/ChatSeeding.tsx");

  ok("the review paragraph is gone", !depth.includes("{depth.total - depth.answered}"));
  ok("and nothing renders the old reminder", !/DepthReminder/.test(flow + chat + depth));
  const done = src("../components/seed/done/shared.tsx");
  const reminder = depth.slice(depth.indexOf("export function ProfileReminder"));
  /* The pure helpers, evaluated from the source: the file is a React module
     this suite cannot import. The two thresholds are read the same way, so the
     check follows the constants rather than restating them. */
  const constant = (name: string) =>
    Number(new RegExp(`export const ${name} = (\\d+)`).exec(depth)?.[1]);
  const RED = constant("REMINDER_RED_BELOW");
  const YELLOW = constant("REMINDER_YELLOW_BELOW");
  const fnBody = (name: string) => {
    const from = depth.slice(depth.indexOf(`export function ${name}`));
    const start = from.indexOf("\n  if (");
    return from.slice(start, from.indexOf("\n}", start));
  };
  const depthLib = {
    reminderFill: new Function(
      "percent",
      "REMINDER_RED_BELOW",
      "REMINDER_YELLOW_BELOW",
      fnBody("reminderFill"),
    ) as (percent: number, r: number, y: number) => string,
    reminderTone: new Function(
      "percent",
      "REMINDER_RED_BELOW",
      "REMINDER_YELLOW_BELOW",
      fnBody("reminderTone"),
    ) as (percent: number, r: number, y: number) => { card: string },
  };
  const fill = (n: number) => depthLib.reminderFill(n, RED, YELLOW);
  const tone = (n: number) => depthLib.reminderTone(n, RED, YELLOW).card;
  /* The strip is `ProfileReminder` up to the pop-up that follows it. */
  const strip = reminder.slice(0, Math.max(0, reminder.indexOf("function FloatingReminder")) || undefined);
  const popup = depth.slice(depth.indexOf("function FloatingReminder"));
  const rewards = (await import(
    `../lib/rewards.ts?v=${Date.now()}`
  )) as typeof import("../lib/rewards.ts");
  const q = (await import(
    `../lib/questions.ts?v=${Date.now()}`
  )) as typeof import("../lib/questions.ts");

  /**
   * ⚠⚠ **The fourth instruction is a reversal of the second and third**, and
   * the client took it: *"поверни вигляд і розташування вспливаючого попапа,
   * але зроби його постійним … щоб він не зникав і був разом з прокруткою на
   * всіх сторінках"*. So the pop-up's appearance and corner are back, with
   * the two properties the banner rounds added kept on them — five screens,
   * and no way to make it go.
   */
  /**
   * ⚠⚠ **The eighth instruction is the strip at every width** (23 Sep):
   * *"змісти банер вгору і зроби все що описано на цьому скріншоті"*, on a
   * screenshot of the 21 Sep pinned strip annotated with four changes. So the
   * corner card is gone on a laptop too, and the header is the one place.
   */
  /**
   * ⚠⚠ **The ninth instruction brings the pop-up back first** (23 Sep):
   * *"поверни той попап … перемісти його вверх … з можливістю його закрити
   * (хрестиком). Після закриття цей банер стає таким, як є зараз."* So the
   * card is in the top-right corner with an X, and the strip is what closing
   * it leaves — on the same five screens.
   */
  ok(
    "the reminder is on the same five screens, in the header slot",
    [
      ["../components/seed/chat/ChatSeeding.tsx", /below=\{<ProfileReminder /],
      ["../components/seed/ProfileFlow.tsx", /below=\{[\s\S]{0,700}<ProfileReminder /],
      ["../components/seed/done/Thanks.tsx", /below=\{<DoneProfileReminder /],
      ["../components/seed/done/FinishAsks.tsx", /below=\{<DoneProfileReminder /],
      ["../components/seed/done/WhatsNext.tsx", /below=\{<DoneProfileReminder /],
    ].every(([f, re]) => (re as RegExp).test(src(f as string))),
  );
  ok(
    "until it is closed it is the pop-up, and only then the strip",
    /if \(!closed\) \{\s*return <FloatingReminder/.test(reminder),
  );
  ok(
    "the pop-up is in the top-right corner, portalled, under the header",
    /createPortal/.test(popup) &&
      /style=\{\{ top \}\}/.test(popup) &&
      !/style=\{\{ bottom/.test(popup) &&
      /sm:right-4/.test(popup) &&
      /data-screen-header/.test(popup) &&
      /data-screen-header/.test(src("../components/ui/Screen.tsx")),
  );
  ok(
    "it closes with an X, and the device remembers that it did",
    /onClick=\{onClose\}/.test(popup) &&
      /<X /.test(popup) &&
      /aria-label="Close/.test(popup) &&
      /localStorage\.setItem\(CLOSED_KEY/.test(depth) &&
      /try \{/.test(depth),
  );
  ok(
    "and nothing closes it but the X — no timer",
    !/setTimeout/.test(depth) && !/usePresence/.test(depth),
  );
  ok(
    "the pop-up is coloured by how full the profile is",
    tone(0).includes("bg-alert") &&
      tone(RED - 1).includes("bg-alert") &&
      tone(RED).includes("bg-gold") &&
      tone(YELLOW - 1).includes("bg-gold") &&
      tone(YELLOW).includes("bg-green-deep") &&
      /reminderTone\(depth\.percent\)/.test(popup),
  );
  ok(
    "and yellow carries dark text, because white on gold fails contrast",
    tone(50).includes("text-ink") && !tone(50).includes("text-white"),
  );
  /* The strip's four notes (23 Sep screenshot), still pinned. */
  ok(
    "the strip sits apart from the logo row and counts 'out of'",
    /mt-3 rounded-xl/.test(strip) && /out of \$\{depth\.total\}/.test(strip),
  );
  ok(
    "and its Add more is the small, light size rather than a bold one",
    /font-medium text-dock[^"]*underline/.test(strip) &&
      !/font-semibold[^"]*underline/.test(strip),
  );
  ok(
    "the colours are the new ranges: red under 40, yellow to 69, green from 70",
    RED === 40 && YELLOW === 70 &&
      fill(0) === "bg-alert" &&
      fill(39) === "bg-alert" &&
      fill(40) === "bg-gold" &&
      fill(69) === "bg-gold" &&
      fill(70) === "bg-green" &&
      fill(79) === "bg-green" &&
      /fill=\{reminderFill\(depth\.percent\)\}/.test(strip),
  );
  /**
   * The threshold is the whole of *"потрібний відсоток"*, and it is the
   * product's own number rather than a new one: 100% is one parent in twelve
   * on the live cohort, so a reminder waiting for it would be permanent for
   * everybody who took the flow's own shortest path.
   */
  const bar = rewards.FOUNDING_MIN_PROFILE_DEPTH;
  const shows = (percent: number, total = 20) =>
    q.profileReminderShows({
      percent,
      total,
      answered: Math.round((percent / 100) * total),
    });
  ok(
    "it stops at the bar the Founding queue already decides on",
    bar < 100 &&
      shows(bar - 1) &&
      !shows(bar) &&
      !shows(100) &&
      shows(0) &&
      !shows(0, 0),
  );
  ok(
    "and the component asks that rule rather than restating it",
    /profileReminderShows\(depth\)/.test(reminder) &&
      !/FOUNDING_MIN_PROFILE_DEPTH/.test(reminder),
  );
  /* ⚠⚠ It promises relevance and never access: P14 alone gates Community
     Access, and the Founding reward needs two approved contributions as well,
     so naming either would be a claim this number cannot keep. */
  /* ⚠ 22 Sep: *"прибрати додаткові стрічки, залишити тільки основну"*. The
     relevance sentence is gone again — it came back when the card was floating
     and had room — so what is asserted is the figure, the way in, and that
     neither of them claims anything the number cannot keep. */
  ok(
    "it is the figure, the count and the way in, never what it earns",
    /* 23 Sep: the pop-up is back "as it was", so its sentence is back with
       it; the strip it leaves stays one line. */
    /% complete/.test(strip) &&
      /Add more/.test(strip) &&
      !/match you with parents/.test(strip) &&
      /match you with parents/.test(popup) &&
      !/(founding|reward|\$10|access|unlock)/i.test(
        reminder.replace(/FOUNDING_MIN_PROFILE_DEPTH/g, ""),
      ),
  );
  ok(
    "it is on the review, the recommendations screen and all three completion screens",
    /<ProfileReminder depth=\{depth\} onProfile \/>/.test(flow) &&
      /<ProfileReminder depth=\{depth\} \/>/.test(chat) &&
      /export function DoneProfileReminder/.test(done) &&
      ["Thanks", "FinishAsks", "WhatsNext"].every((f) =>
        /<DoneProfileReminder /.test(src(`../components/seed/done/${f}.tsx`)),
      ),
  );
  /* One expression, not three: the copy that drifts is the one nobody
     reopens. */
  ok(
    "and the three read it through one wrapper",
    ["Thanks", "FinishAsks", "WhatsNext"].every(
      (f) => !/profileDepth\(/.test(src(`../components/seed/done/${f}.tsx`)),
    ),
  );
  /* ⚠ The review's own label steps aside while the strip shows — both carry
     the figure, and an inch apart that is one number said twice. **Only on a
     phone**, because above `md` the strip is gone and the label is the one
     place the figure appears in that header; hence a variant rather than the
     ternary that used to drop it. The **bar** stays either way: it draws the
     number rather than repeating it, and it is her own 16 Sep instruction. */
  ok(
    "and the review draws one bar and says the figure once",
    /* 23 Sep: the header steps aside only for the strip; while the pop-up is
       up it keeps its own label and bar. */
    /right=\{\s*reviewStrip \? undefined/.test(flow) &&
      /reviewStrip \? \(\s*<ProfileReminder depth=\{depth\} onProfile \/>\s*\) : \(/.test(flow) &&
      /profileReminderShows\(depth\) && reminderMounted && reminderClosed/.test(flow),
  );
  ok("/share carries no \"Add optional details\" button", !chat.includes("Add optional details"));
  /* ⚠ The header pill went when the banner arrived: the same number a hundred
     pixels from the banner's own is one measure said twice on one screen. */
  ok(
    "and /share says the percentage once, in the banner",
    !/ProfilePercentPill/.test(chat),
  );
}

/**
 * ## 21 Sep — a screen advances when the tap finishes it
 *
 * The developer: *"коли вибирається neighborhood по zip-code, то воно не
 * перекидає на наступну сторінку, а в інших випадках перекидає."*
 *
 * The rule was `questions.length === 1`, so her §5 ZIP follow-up switched
 * auto-advance off for exactly the parents it asks twice — Altadena moved on
 * its own, Pasadena did not. Read on the **source**, because the rule is a
 * branch in a React component this pure suite cannot render (the 16 Sep
 * `reviewScreens` precedent), plus the data facts that make it reachable.
 */
{
  const flowSrc = fs.readFileSync(
    new URL("../components/seed/ProfileFlow.tsx", import.meta.url),
    "utf8",
  );
  const rule = flowSrc.slice(
    flowSrc.indexOf("const completesScreen"),
    flowSrc.indexOf("function setSelections"),
  );

  ok(
    "the advance is decided by what is still unanswered, not by a count",
    rule.length > 0 && !rule.includes("questions.length === 1"),
    "a count leaves a parent with a ZIP follow-up on a finished screen",
  );
  ok(
    "a sibling still waiting for an answer holds the screen",
    rule.includes("q.id === question.id || isQuestionAnswered(q, answers)"),
  );
  /* ⚠ The half that keeps all four of the 9 Sep merges where they were: a
     multi is "answered" on its first tap while the parent may mean three. */
  ok(
    "a screen holding a multi-select never advances itself",
    rule.includes('questions.every((q) => q.kind === "single")'),
  );
  ok(
    "and a tap that opens a question still cancels the advance it armed",
    flowSrc.includes("if (visibleNow > visibleCount.current) clearAutoAdvance();"),
  );

  /* The data behind it: the neighborhood screen really is the two-single case
     and the follow-up really is conditional. A screen with one question either
     way would make every check above vacuous. */
  const where = q.ALL_SCREENS.find((sc) => sc.id === "neighborhood")!;
  ok(
    "the neighborhood screen asks two single-select questions",
    where.questions.length === 2 &&
      where.questions.every((one) => one.kind === "single"),
  );
  const blank = { ...q.EMPTY_ANSWERS, other: {}, skipped: [] };
  ok(
    "a one-ZIP town leaves one question on the screen",
    q.visibleQuestions(where, {
      ...blank,
      neighborhood: "altadena",
      home_place: "altadena",
    }).length === 1,
  );
  ok(
    "a six-ZIP town leaves two, and the second is the one that finishes it",
    q.visibleQuestions(where, {
      ...blank,
      neighborhood: "pasadena",
      home_place: "pasadena",
    })
      .map((one) => one.id)
      .join(",") === "neighborhood,home_zip",
  );
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
