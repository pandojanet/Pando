import { marketOptions, optionsForBands } from "./market-options";
import {
  EXPECTING,
  type AgeBand,
  type MarketId,
  type Option,
  type ProfileAnswers,
  type Question,
  type QuestionId,
  type Screen,
} from "./types";

/**
 * The tap-first questionnaire (estimate 1.2, spec §8).
 *
 * This file follows the client's question set, "Pando Seed Conversation —
 * Question Set", July 2026, in its order and its wording. The design rules from
 * that document that are encoded *here* rather than in components:
 *
 *  - Part 1 is taps only, about two minutes, and only P1–P4 are required
 *    (P1/P2 — name, mobile, SMS consent — live on the entry screen).
 *  - Every personal question carries one short "why we ask" line. People share
 *    more when they can see what the answer buys them, so `help` is not optional
 *    decoration.
 *  - Never ask what we already know, and never ask for income, street address,
 *    children's names, email, partner details, or whether the parent personally
 *    went through a sensitive experience.
 *  - Privacy settings control what other parents can *see*. They never narrow
 *    matching: a parent on maximum privacy is still matched on their full
 *    profile, only the description shown to others gets more general.
 *  - Two screens ask nothing at all. The privacy disclosure and the Pando promise
 *    are stated, with a standing opt-out — not turned into a question the parent
 *    has to get right.
 */

export const EMPTY_ANSWERS: ProfileAnswers = {
  neighborhood: null,
  child_ages: [],
  schools: [],
  school_status: {},
  classes: [],
  camps: [],
  faith: [],
  clubs: [],
  parent_groups: [],
  time_in_area: null,
  moved_from: null,
  family_structure: [],
  childcare_now: [],
  logistics: [],
  budget: [],
  trust_circles: [],
  topics: [],
  topics_lived: [],
  /** P13. Null until they choose; nothing is shown until they do. */
  attribution: null,
  /** P14 — 3 by default, per the client. A real control, not a preference. */
  allowance: "3",
  other: {},
  skipped: [],
};

/**
 * P4. The parent taps a **birth year**, not an age — ages go stale in a database
 * and a year doesn't. The tap's stored value stays the age because that is what
 * gates later questions, and it round-trips exactly: the payload converts it back
 * to the year the parent actually tapped (`childrenFromAges`).
 */
const CURRENT_YEAR = new Date().getFullYear();

/**
 * Ages, still needed by the chat: R3 asks how old the child was *at the time* of a
 * recommendation, which is an age, not a birth year.
 */
export const AGE_OPTIONS: Option[] = [
  { id: String(EXPECTING), label: "Expecting", wide: true },
  ...Array.from({ length: 18 }, (_, age) => ({
    id: String(age),
    label: age === 0 ? "Under 1" : String(age),
  })),
];

export const BIRTH_YEAR_OPTIONS: Option[] = [
  { id: String(EXPECTING), label: "Expecting", wide: true },
  ...Array.from({ length: 18 }, (_, age) => ({
    id: String(age),
    label: String(CURRENT_YEAR - age),
  })),
];

/** P5. Each school the parent taps gets one of these. */
const SCHOOL_STATUS: Option[] = [
  { id: "current", label: "Current" },
  { id: "former", label: "Former" },
  { id: "not_yet", label: "Not yet" },
  { id: "homeschool", label: "Homeschool" },
];

const TIME_IN_AREA: Option[] = [
  { id: "under_year", label: "Under a year" },
  { id: "1_3_years", label: "1–3 years" },
  { id: "3_10_years", label: "3–10 years" },
  { id: "10_plus_years", label: "10+ years" },
  { id: "grew_up_here", label: "I grew up here" },
];

/** P8b. Structure first, free text for the specifics. */
const MOVED_FROM: Option[] = [
  { id: "elsewhere_in_california", label: "Elsewhere in California" },
  { id: "another_us_state", label: "Another US state" },
  { id: "another_country", label: "Another country" },
];

const FAMILY_STRUCTURE: Option[] = [
  { id: "two_parents_both_working", label: "Two parents, both working" },
  { id: "two_parents_one_home", label: "Two parents, one at home" },
  { id: "work_from_home", label: "Parent(s) work from home" },
  { id: "solo_parent", label: "Solo parent" },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

const CHILDCARE_NOW: Option[] = [
  { id: "nanny_or_sitter", label: "Nanny or regular sitter" },
  { id: "daycare_preschool", label: "Daycare / preschool" },
  { id: "family_nearby", label: "Family nearby helps" },
  { id: "no_regular_childcare", label: "No regular childcare" },
  { id: "limited_backup", label: "Limited backup support" },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

const LOGISTICS: Option[] = [
  { id: "close_to_home", label: "Close to home" },
  { id: "easy_parking", label: "Easy parking / low hassle" },
  { id: "weekend_friendly", label: "Weekend-friendly" },
  { id: "weekday_flexibility", label: "Weekday flexibility" },
  { id: "working_parent_hours", label: "Working-parent hours" },
  { id: "sibling_friendly", label: "Sibling-friendly" },
  { id: "stroller_friendly", label: "Stroller-friendly" },
  { id: "will_drive", label: "Will drive for the right thing" },
];

/* P11. The word "budget" stays out of the UI; the stored dimension keeps its name
   so nothing downstream has to change. */
const HOW_YOU_CHOOSE: Option[] = [
  { id: "free_low_cost", label: "I look for free / low-cost options" },
  { id: "compare_value", label: "I compare carefully — value matters" },
  { id: "mid_range", label: "Mid-range is fine" },
  { id: "pay_more_for_quality", label: "I'll pay more when quality is clear" },
  { id: "best_available", label: "I look for the best available" },
];

/**
 * Retained from the client's 3 Aug feedback round, which asked for it explicitly
 * ("ranking, never a filter"). It isn't in the July question set — flagged in
 * docs/spec-compliance-review.md rather than quietly dropped.
 */
const TRUST_CIRCLES: Option[] = [
  { id: "same_school", label: "Same preschool / school" },
  { id: "same_classes", label: "Same classes or activities" },
  { id: "same_neighborhood", label: "Same neighborhood" },
  { id: "parent_group", label: "Parent WhatsApp / group chat" },
  { id: "clubs", label: "Clubs / community group" },
  { id: "religious", label: "Religious or community group" },
  { id: "friends_of_friends", label: "Friends of friends" },
  { id: "similar_ages", label: "Parents with similar-age children" },
];

/** P12, first cluster: local knowledge. */
const TOPICS_LOCAL: Option[] = [
  { id: "activities", label: "Activities" },
  { id: "preschools_schools", label: "Preschools & schools" },
  { id: "camps", label: "Camps" },
  { id: "babysitters", label: "Babysitters" },
  { id: "nannies", label: "Nannies" },
  { id: "newborn_care", label: "Newborn care" },
  { id: "special_needs_resources", label: "Special-needs resources" },
  { id: "working_parent_logistics", label: "Working-parent logistics" },
  { id: "outings", label: "Outings" },
  { id: "sports", label: "Sports" },
  { id: "arts_music", label: "Arts & music" },
  { id: "pediatric_health", label: "Pediatric / health recommendations" },
  { id: "new_to_area_help", label: "New-to-area help" },
];

/**
 * P12, second cluster: lived experience. Sensitive by nature, so the question is
 * about willingness to help — never about whether they went through it — and it
 * always offers a way out.
 */
const TOPICS_LIVED: Option[] = [
  { id: "sleep_routines", label: "Sleep & routines" },
  { id: "feeding_picky_eating", label: "Feeding & picky eating" },
  { id: "development_milestones", label: "Development & milestones" },
  { id: "postpartum_first_year", label: "Postpartum & the first year" },
  { id: "returning_to_work", label: "Returning to work" },
  { id: "identity_after_parenthood", label: "Identity after becoming a parent" },
  { id: "limited_nearby_support", label: "Parenting with limited nearby support" },
  { id: "loneliness_emotional", label: "Loneliness & the emotional side" },
  { id: "relationship_changes", label: "Relationship changes after children" },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/**
 * P13. One tap, and it is the only thing that decides how a parent is named in an
 * answer. Both options are private by default; the second one is bounded by a
 * promise we have to keep at query time, so the wording says it out loud.
 */
const ATTRIBUTION: Option[] = [
  {
    id: "anonymous_verified",
    label: "Anonymous, but verified",
    hint: "“A verified local parent”",
  },
  {
    id: "first_name_safe",
    label: "First name — only where it can't identify me",
    hint: "Never combined with details that would give you away",
  },
];

/** P14. The default is 3; "as many as are relevant" still obeys spacing rules. */
const ALLOWANCE: Option[] = [
  { id: "3", label: "3 a month", hint: "Community Access · default" },
  { id: "5", label: "5 a month" },
  { id: "as_relevant", label: "As many as are genuinely relevant" },
  { id: "1", label: "Just 1", hint: "Basic access" },
];

export const SCREENS: Screen[] = [
  {
    id: "neighborhood",
    eyebrow: "Where you are",
    title: "Which neighborhood do you call home?",
    help: "This is how Pando finds parents whose local world actually overlaps with yours.",
    questions: [
      {
        id: "neighborhood",
        label: "Neighborhood",
        kind: "single",
        required: true,
        source: { type: "market", category: "neighborhoods" },
        affinity: { type: "neighborhood", weight: 3 },
        allowOther: true,
        otherLabel: "Another neighborhood",
      },
    ],
  },
  {
    id: "child_ages",
    eyebrow: "Your kids",
    title: "Your kids — tap a birth year for each one.",
    help: "So we only ask you about stages you've actually lived. Birth years, never names.",
    questions: [
      {
        id: "child_ages",
        label: "Birth years",
        kind: "ages",
        required: true,
        source: { type: "static", options: BIRTH_YEAR_OPTIONS },
        affinity: { type: "age_range", weight: 2 },
      },
    ],
  },
  {
    id: "schools",
    eyebrow: "Your circles",
    title: "Schools, preschools or daycares your family attends — or has attended.",
    help: "The strongest matching signal there is. Former counts: a parent who's been through admissions is exactly who someone needs.",
    questions: [
      {
        id: "schools",
        label: "School, preschool or daycare",
        kind: "multi",
        source: { type: "market", category: "schools" },
        affinity: { type: "school", weight: 5 },
        allowOther: true,
        otherLabel: "Another school",
        perSelectionStatus: { label: "For each one", options: SCHOOL_STATUS },
        /* Expecting-only families have nothing to answer here yet, and a screen
           with no chips on it is a dead end (spec §8.5 gates whole questions). */
        showForBands: ["baby", "toddler", "preschool", "grade", "tween", "teen"],
      },
    ],
  },
  {
    id: "communities",
    eyebrow: "Your circles",
    title: "Which local groups and communities are part of your family's life?",
    help: "This powers Pando's best trust signal — “from a parent at your school”. Every one of these is optional.",
    questions: [
      {
        id: "parent_groups",
        label: "Parent groups",
        kind: "multi",
        source: { type: "market", category: "parent_groups" },
        affinity: { type: "social_group", weight: 3 },
        allowOther: true,
        otherLabel: "Another parent group",
      },
      {
        id: "classes",
        label: "Recurring classes & activities",
        kind: "multi",
        source: { type: "market", category: "baby_activities" },
        affinity: { type: "activity", weight: 4 },
        allowOther: true,
        otherLabel: "Another class or activity",
      },
      {
        /**
         * v3.2 §8.4, on its own rather than folded into "classes": a camp is not a
         * recurring class, and a parent scanning that chip list for last summer's
         * camp does not find it there.
         *
         * Same affinity as a class (§7.1, "same regular activity or class", 4) —
         * two families at the same camp week overlap in exactly the way that
         * signal means. Hidden below preschool age, where the answer is always
         * empty; the chips re-filter by band on top of that (§8.5).
         */
        id: "camps",
        label: "Camps & school-break programs",
        kind: "multi",
        source: { type: "market", category: "camps" },
        affinity: { type: "activity", weight: 4 },
        allowOther: true,
        otherLabel: "Another camp",
        showForBands: ["preschool", "grade", "tween", "teen"],
      },
      {
        id: "clubs",
        label: "Clubs & leagues",
        kind: "multi",
        source: { type: "market", category: "clubs" },
        affinity: { type: "social_group", weight: 3 },
        allowOther: true,
        otherLabel: "Another club",
      },
      {
        id: "faith",
        label: "Faith community",
        kind: "multi",
        source: { type: "market", category: "worship" },
        affinity: { type: "faith_community", weight: 3 },
        allowOther: true,
        otherLabel: "Another community",
      },
      /**
       * "Where this link reached you" used to be a question here. It was removed
       * on 12 Aug, when invites became one row per group: the link now *knows*
       * which group it was posted in, so asking the parent to find it in a list
       * was asking them to re-enter something we already had — and it produced a
       * second, weaker copy of a fact `people.invite_id` holds exactly.
       *
       * What each half does now, and why they stay apart:
       *  - **attribution** comes from the invite, server-side, from the code the
       *    server validated (`invited_via_group`);
       *  - **membership** comes from "Parent groups" above, because that is the
       *    question that asks it. A link forwarded out of a group is evidence
       *    somebody shared it, never that whoever opened it belongs there — so an
       *    invite still writes no affinity edge on its own.
       */
    ],
  },
  {
    /**
     * Stated, not asked — with a standing opt-out. The client's rule: keep the
     * separate privacy permissions separate, and never merge them into one
     * setting to save a screen.
     */
    id: "privacy_disclosure",
    eyebrow: "Privacy",
    title: "How Pando uses this",
    statement: {
      body: [
        "Pando uses your connections and context privately, to find parents whose experience fits your family. They're never shown to anyone automatically.",
        "Pando may mention shared groups only in anonymous form, and only in groups of five parents or more — “five parents at Oakwood recommend this”.",
      ],
      note: "You can turn group mentions off any time by texting PRIVACY.",
    },
    questions: [],
  },
  {
    id: "time_in_area",
    eyebrow: "Life context",
    title: "How long have you been in the area?",
    help: "Newer families and long-timers need different answers to the same question.",
    questions: [
      {
        id: "time_in_area",
        label: "Time here",
        kind: "single",
        source: { type: "static", options: TIME_IN_AREA },
        relevance: "tenure",
      },
      {
        id: "moved_from",
        label: "Where did you move from?",
        kind: "single",
        source: { type: "static", options: MOVED_FROM },
        allowOther: true,
        otherLabel: "Say where",
        /** Transplant parents love finding each other — but only ask the new ones. */
        when: (answers) =>
          answers.time_in_area === "under_year" || answers.time_in_area === "1_3_years",
      },
    ],
  },
  {
    id: "family_structure",
    eyebrow: "Life context",
    title: "Your family structure",
    help: "Tap all that apply. This is how a solo parent gets answers from parents who understand solo logistics.",
    questions: [
      {
        id: "family_structure",
        label: "Family",
        kind: "multi",
        source: { type: "static", options: FAMILY_STRUCTURE },
        relevance: "family_setup",
        allowOther: true,
        otherLabel: "Something else",
      },
    ],
  },
  {
    id: "childcare_now",
    eyebrow: "Life context",
    title: "Your current childcare",
    help: "Tap all that apply. It changes which recommendations are realistic for you.",
    questions: [
      {
        id: "childcare_now",
        label: "Childcare now",
        kind: "multi",
        source: { type: "static", options: CHILDCARE_NOW },
        relevance: "childcare",
      },
    ],
  },
  {
    id: "logistics",
    eyebrow: "Life context",
    title: "When you're picking classes, camps or care — what makes something actually work for your family?",
    help: "Tap as many as apply.",
    questions: [
      {
        id: "logistics",
        label: "Logistics",
        kind: "multi",
        source: { type: "static", options: LOGISTICS },
        relevance: "logistics",
      },
    ],
  },
  {
    id: "budget",
    eyebrow: "Life context",
    title: "Which of these usually describe you?",
    help: "So “worth it” means the same thing to both of you. Pando never asks about income.",
    questions: [
      {
        id: "budget",
        label: "How you choose",
        kind: "multi",
        source: { type: "static", options: HOW_YOU_CHOOSE },
        relevance: "budget",
      },
    ],
  },
  {
    id: "trust_circles",
    eyebrow: "Trust",
    title: "Whose answers would you trust most?",
    /* The client's exact framing: this ranks, it never filters. */
    help: "Pando weighs these first — and always finds the best available match. Tap all that apply.",
    questions: [
      {
        id: "trust_circles",
        label: "Trust circles",
        kind: "multi",
        source: { type: "static", options: TRUST_CIRCLES },
        relevance: "trust_circle",
      },
    ],
  },
  {
    id: "topics",
    eyebrow: "What you know",
    title: "What kinds of parent questions would you be comfortable helping with?",
    help: "Lived experience, not expertise — and you decide per question whether to answer. Tap as many as you like.",
    questions: [
      {
        id: "topics",
        label: "Local",
        kind: "multi",
        source: { type: "static", options: TOPICS_LOCAL },
      },
      {
        id: "topics_lived",
        label: "Lived experience",
        kind: "multi",
        source: { type: "static", options: TOPICS_LIVED },
      },
    ],
  },
  {
    id: "attribution",
    eyebrow: "Privacy",
    title: "How may Pando describe your ordinary recommendations?",
    help: "Pando never combines your name with details — a small group, a rare circumstance — that would give you away.",
    questions: [
      {
        id: "attribution",
        label: "How you're described",
        kind: "single",
        source: { type: "static", options: ATTRIBUTION },
      },
    ],
  },
  {
    id: "promise",
    eyebrow: "Why this works",
    title: "The Pando promise",
    statement: {
      body: [
        "Pando works because parents help one another. There are no ads. No business or provider can ever pay to change an answer.",
        "What the community knows is shared give-to-get: contribute what you know, and Pando becomes more useful for everyone — including you.",
        "In return, we may occasionally ask you a question when your experience could genuinely help another parent.",
      ],
      note: "You can always skip a question. The next screen sets your own limit.",
    },
    questions: [],
  },
  {
    id: "allowance",
    eyebrow: "Your terms",
    title: "How often may Pando ask you a question each month?",
    help: "A limit Pando keeps, not a suggestion — with a 48-hour gap between any two. Free access to the network's private parent knowledge begins at 3; at 1 you can still ask Pando anything and pay for Network Asks.",
    questions: [
      {
        id: "allowance",
        label: "Monthly allowance",
        kind: "single",
        source: { type: "static", options: ALLOWANCE },
      },
    ],
  },
];

/** Questions whose chip lists are sensitive enough to always offer an out. */
const SENSITIVE: QuestionId[] = ["faith", "clubs", "parent_groups"];

const PREFER_NOT: Option = {
  id: "prefer_not_to_say",
  label: "None / prefer not to say",
  exclusive: true,
};

export function ageBandsOf(ages: number[]): AgeBand[] {
  const bands = new Set<AgeBand>();
  for (const age of ages) {
    if (age === EXPECTING) {
      bands.add("expecting");
      bands.add("baby");
    } else if (age < 1) bands.add("baby");
    else if (age < 3) bands.add("toddler");
    else if (age < 5) bands.add("preschool");
    else if (age < 11) bands.add("grade");
    else if (age < 14) bands.add("tween");
    else bands.add("teen");
  }
  return [...bands];
}

/** A screen that states something instead of asking it. */
export function isStatementScreen(screen: Screen): boolean {
  return screen.questions.length === 0 && screen.statement !== undefined;
}

/** Child age gates whole questions, and so does an earlier answer (spec §8.5). */
export function isQuestionVisible(
  question: Question,
  answers: ProfileAnswers,
): boolean {
  if (question.when && !question.when(answers)) return false;
  if (!question.showForBands) return true;
  const bands = ageBandsOf(answers.child_ages);
  if (bands.length === 0) return true;
  return question.showForBands.some((b) => bands.includes(b));
}

export function visibleQuestions(
  screen: Screen,
  answers: ProfileAnswers,
): Question[] {
  return screen.questions.filter((q) => isQuestionVisible(q, answers));
}

/** A screen disappears if child age hid every question on it. */
export function visibleScreens(answers: ProfileAnswers): Screen[] {
  return SCREENS.filter(
    (s) => isStatementScreen(s) || visibleQuestions(s, answers).length > 0,
  );
}

export function optionsFor(
  question: Question,
  market: MarketId,
  answers: ProfileAnswers,
): Option[] {
  const base =
    question.source.type === "static"
      ? question.source.options
      : optionsForBands(
          marketOptions(market, question.source.category),
          ageBandsOf(answers.child_ages),
        );
  return SENSITIVE.includes(question.id) ? [...base, PREFER_NOT] : base;
}

/**
 * Current selections for a question, always as an array.
 *
 * "Always" is load-bearing: `lib/storage.ts` normalises a stored session, but this is
 * also called with answers built elsewhere, and a single `null` here crashes the whole
 * profile screen. Cheap insurance at the exact line that failed once.
 */
export function selectionsFor(
  question: Question,
  answers: ProfileAnswers,
): string[] {
  return rawSelectionsFor(question, answers) ?? [];
}

function rawSelectionsFor(
  question: Question,
  answers: ProfileAnswers,
): string[] | null {
  switch (question.id) {
    case "neighborhood":
      return answers.neighborhood ? [answers.neighborhood] : [];
    case "time_in_area":
      return answers.time_in_area ? [answers.time_in_area] : [];
    case "moved_from":
      return answers.moved_from ? [answers.moved_from] : [];
    case "attribution":
      return answers.attribution ? [answers.attribution] : [];
    case "allowance":
      return answers.allowance ? [answers.allowance] : [];
    case "child_ages":
      return answers.child_ages.map(String);
    default:
      return answers[question.id];
  }
}

export function customEntriesFor(
  question: Question,
  answers: ProfileAnswers,
): string[] {
  return answers.other[question.id] ?? [];
}

export function isQuestionAnswered(
  question: Question,
  answers: ProfileAnswers,
): boolean {
  return (
    selectionsFor(question, answers).length > 0 ||
    customEntriesFor(question, answers).length > 0
  );
}

export function isScreenAnswered(
  screen: Screen,
  answers: ProfileAnswers,
): boolean {
  if (isStatementScreen(screen)) return true;
  return visibleQuestions(screen, answers).some((q) =>
    isQuestionAnswered(q, answers),
  );
}

/** Required screens must be answered before the dock unlocks. */
export function canAdvance(screen: Screen, answers: ProfileAnswers): boolean {
  const required = visibleQuestions(screen, answers).filter((q) => q.required);
  if (required.length === 0) return true;
  return required.every((q) => isQuestionAnswered(q, answers));
}

/**
 * 0–100, stored on social_profiles.profile_completeness. Informational only — it
 * never gates anything (client's appendix: only P14 gates Community Access).
 */
export function profileCompleteness(answers: ProfileAnswers): number {
  const screens = visibleScreens(answers).filter((s) => !isStatementScreen(s));
  const answered = screens.filter((s) => isScreenAnswered(s, answers)).length;
  return Math.round((answered / screens.length) * 100);
}

export function labelForOption(
  question: Question,
  market: MarketId,
  answers: ProfileAnswers,
  optionId: string,
): string {
  const found = optionsFor(question, market, answers).find(
    (o) => o.id === optionId,
  );
  return found?.label ?? optionId;
}

export function statusLabel(statusId: string): string {
  return SCHOOL_STATUS.find((s) => s.id === statusId)?.label ?? statusId;
}

export function questionById(id: QuestionId): Question {
  for (const screen of SCREENS) {
    const q = screen.questions.find((x) => x.id === id);
    if (q) return q;
  }
  throw new Error(`Unknown question: ${id}`);
}
