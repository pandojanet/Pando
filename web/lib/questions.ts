import {
  AFFILIATION_CONSENT_CAVEAT,
  AFFILIATION_CONSENT_TEXT,
} from "./consent";
import { producesAffiliation } from "./affiliations";
import { bandsForAge } from "./matching";
import { marketOptions, optionsForBands } from "./market-options";
import {
  EXPECTING,
  type AgeBand,
  type MarketCategory,
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
  wants_detail: null,
  neighborhood: null,
  child_ages: [],
  schools: [],
  school_status: {},
  child_school_status: {},
  child_of: {},
  classes: [],
  camps: [],
  faith: [],
  clubs: [],
  time_in_area: null,
  grew_up_here: null,
  previous_places: [],
  moved_from: null,
  family_structure: [],
  work_setup: [],
  childcare_now: [],
  childcare_backup: [],
  travel_time: [],
  logistics: [],
  budget: [],
  trust_circles: [],
  topics: [],
  child_months: {},
  topics_lived: [],
  /** P13. Null until they choose; nothing is shown until they do. */
  /**
   * ⚠ **Private by default** (10 Sep): *"Default to ‘Keep my name private.’"*
   * It was `null`, and null failed closed anyway — but a default nobody chose
   * and a choice nobody made read the same on the review screen, and only one
   * of them is a promise Pando can repeat back.
   */
  attribution: "name_private",
  /* Off by default. Her rule: skipping this page keeps the name private and
     shared connections off — "Continue" is not consent. */
  shared_connections: null,
  /* Empty, and that is the consent model: an affiliation is private until it
     appears in this list. Nothing a parent skips can grant anything. */
  shared_affiliations: [],
  /**
   * P14 — **null, and that is item 18's instruction**: *"do not preselect a
   * level. The parent must affirmatively choose one."*
   *
   * It defaulted to "5" so that skipping the screen still produced the
   * community minimum. That was generous and wrong: it made the app assert an
   * agreement nobody gave, on the one question that is the condition of using
   * Pando at all. The question is `required` now, so the dock does not unlock
   * until they choose — and a null arriving at the write route means a crafted
   * request, which is refused rather than defaulted.
   */
  allowance: null,
  listening_ear: null,
  recurring_messages: null,
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

/**
 * Months, short enough to sit twelve-across on a phone.
 *
 * Ids are 1–12 as strings, matching `children.birth_month` rather than
 * JavaScript's zero-based month — the column is what this has to agree with, and
 * an off-by-one here would be invisible until somebody read a birthday.
 */
export const MONTH_OPTIONS: Option[] = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
].map((label, i) => ({ id: String(i + 1), label }));

export const BIRTH_YEAR_OPTIONS: Option[] = [
  { id: String(EXPECTING), label: "Expecting", wide: true },
  ...Array.from({ length: 18 }, (_, age) => ({
    id: String(age),
    label: String(CURRENT_YEAR - age),
  })),
];

/**
 * Whether a club membership is current — her instruction for the clubs question
 * (24 Aug): "default to Current and allow Former".
 *
 * Two options rather than four: a club has no "not yet" or "homeschool"
 * equivalent, and offering the school list here would ask a question that has no
 * answer. Weighting former membership lower is the matching side of it, which
 * belongs in Phase 2's scoring rather than in the tap.
 */
const CLUB_STATUS: Option[] = [
  { id: "current", label: "Current" },
  { id: "former", label: "Former" },
];

/**
 * P5. Each school the parent taps gets one of these.
 *
 * ⚠ **"Not yet" and "Homeschool" are gone from here** (10 Sep): *"Store None yet
 * and Homeschool as child statuses, not schools."* They never were statuses of a
 * school — a school a child does not attend cannot be "not yet", and a
 * homeschooling family has no school row to hang it on. They are facts about the
 * **child**, and they live in `child_school_status` now.
 */
const SCHOOL_STATUS: Option[] = [
  { id: "current", label: "Current" },
  { id: "former", label: "Former" },
];

/**
 * A child who is not at a school, and why not.
 *
 * Unset is the third state and the commonest: the child attends one of the
 * schools named below. It is not an option here because "attends a school" is
 * answered by naming the school, and offering it as a chip would ask the same
 * question twice.
 *
 * ⚠ **Never an entry in `answers.schools`.** That list feeds a `school` affinity
 * edge at weight 5 — the heaviest in the graph — so "Homeschool" as a school
 * would match every homeschooling family to every other as though they shared a
 * campus. That is the 9 Sep refusal-chip bug exactly, and this is what keeps it
 * from coming back through a different door.
 */
export const CHILD_SCHOOL_STATUS: Option[] = [
  { id: "not_yet", label: "Not in school yet" },
  { id: "homeschool", label: "Homeschool" },
];

/**
 * Item 11 — her four bands, and note the boundaries moved: 4-9 rather than 3-10.
 *
 * "I grew up here" **came out of this list**, and that is the substance of the
 * change rather than a tidy-up. As an option here it was mutually exclusive with
 * every tenure answer, so a parent who grew up in Pasadena, moved away and came
 * back could not say so — they had to pick one truth and drop the other. Local
 * roots are now their own question, below.
 */
const TIME_IN_AREA: Option[] = [
  { id: "under_year", label: "Less than 1 year" },
  { id: "1_3_years", label: "1–3 years" },
  { id: "4_9_years", label: "4–9 years" },
  { id: "10_plus_years", label: "10+ years" },
];

/**
 * Local roots, as a single yes — the client asked for "a separate checkbox".
 *
 * One option rather than yes/no: an unticked box already means no, and offering
 * an explicit "No, I moved here" would ask a parent to state the absence of a
 * thing, which is the pattern the rest of this questionnaire avoids.
 */
const GREW_UP_HERE: Option[] = [
  /* ⚠ "this area", not "your area" — the title above it moved to *your* on
     9 Sep and this must not follow it for consistency: the heading is Pando
     addressing the parent, and this option is the parent speaking about
     themselves, where "I grew up in your area" is nonsense. */
  { id: "grew_up_here", label: "I grew up in this area", wide: true },
];

/**
 * The coarse tenure values. **No longer asked** — item 11's instruction is that
 * "Pando can derive 'elsewhere in California,' 'another state' or 'another
 * country' from the actual location. The parent shouldn't have to provide both."
 *
 * So these are what `derive.ts` *computes* from the canonical place the parent
 * named, and the list stays here because it is still the vocabulary of the
 * `tenure` rows and of every profile already stored against it.
 */
const MOVED_FROM: Option[] = [
  { id: "elsewhere_in_california", label: "Elsewhere in California" },
  { id: "another_us_state", label: "Another US state" },
  { id: "another_country", label: "Another country" },
];

/**
 * Item 12, first half. The old list mixed four different facts — household
 * structure, co-parenting, employment and work location — and two of its options
 * could not be read:
 *
 *  - "Two parents, one at home" meant either a stay-at-home parent or one working
 *    from home, which are different lives.
 *  - "Solo parent" implied no co-parent, when many single parents co-parent
 *    across two households.
 *
 * So structure is asked here and work is asked next. "Parenting on my own"
 * `clears` the two partner options — you cannot both have a partner in the
 * household and be parenting alone — while "Blended family" and "Grandparent
 * involved" combine freely with either.
 */
const PARENTING_SETUP: Option[] = [
  { id: "partner_in_household", label: "Parenting with a partner in my household" },
  { id: "co_parenting_across_households", label: "Co-parenting across households" },
  {
    id: "parenting_on_my_own",
    label: "Parenting on my own",
    /**
     * 1 Sep, item 8, in her words: it *"must clear 'Parenting with a partner'
     * and 'Co-parenting across households'"*.
     *
     * Named rather than `exclusive`, because the rest of the list combines with
     * it and always did: a parent on their own can have a blended family and a
     * grandmother in the house. `exclusive` would have cleared those as well.
     */
    clears: ["partner_in_household", "co_parenting_across_households"],
  },
  { id: "blended_family", label: "Blended family" },
  { id: "family_caregiver_involved", label: "Grandparent or family caregiver involved" },
  /* No "Something else" chip — see SOMETHING_ELSE below. */
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/** Item 12, second half: how the household works, not who is in it. */
const WORK_SETUP: Option[] = [
  { id: "work_outside_home", label: "Parent(s) work mainly outside the home" },
  { id: "work_from_home", label: "Parent(s) work mainly from home" },
  { id: "full_time_caregiver", label: "A parent is a full-time caregiver" },
  { id: "variable_hours", label: "Variable or nontraditional work hours" },
  { id: "frequent_travel", label: "Frequent work travel" },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/**
 * The typed fallback's label, on the five questions that offer one.
 *
 * 1 Sep's first universal comment: *"Remove the duplicate 'Something else'
 * option wherever it appears. Keep only '+ Something else,' which opens a short
 * optional field."*
 *
 * Each of those five questions had **both** — a `something_else` chip in the
 * option list *and* `allowOther` with the same words — so the screen offered the
 * same idea twice, one of them storing an id that means nothing and the other
 * opening the field that actually captures the answer. The chip is gone; this is
 * the surviving one, and the `+` is what says it opens something.
 *
 * A stored `something_else` from a test session now resolves to no option, which
 * `pruneAnswers` drops on load rather than rendering as a raw slug.
 */
const SOMETHING_ELSE = "+ Something else";

/**
 * Item 13, first half: a child's *regular* arrangement.
 *
 * Three things the old five-option list ran together, and each is a materially
 * different experience to be asked about: "Nanny or regular sitter" (a nanny, a
 * nanny share, an au pair and a Saturday-night sitter are not one thing),
 * "Daycare / preschool", and "family provides regular care" versus "family
 * nearby can help when something falls through" — which is the backup question
 * and now lives on its own screen.
 *
 * The two school-age options are age-gated: an after-school programme is not an
 * answer for a one-year-old.
 */
const CHILDCARE_REGULAR: Option[] = [
  { id: "parent_provides_care", label: "Parent or guardian provides most daytime care" },
  { id: "nanny", label: "Nanny" },
  { id: "nanny_share", label: "Nanny share" },
  { id: "au_pair", label: "Au pair" },
  { id: "regular_babysitter", label: "Regular babysitter" },
  { id: "family_regular_care", label: "Family member provides regular care" },
  { id: "daycare", label: "Daycare" },
  { id: "preschool", label: "Preschool" },
  {
    id: "after_school_program",
    label: "After-school program",
    /* Her instruction: the regular-care options adapt to the child's age. An
       after-school programme is not an answer for a one-year-old. */
    bands: ["grade", "tween", "teen"],
  },
  {
    id: "after_school_sitter",
    label: "Regular after-school sitter",
    bands: ["grade", "tween", "teen"],
  },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/**
 * Item 13, second half: what the household falls back on. Asked once, not per
 * child — a grandmother who can come over covers everybody.
 *
 * Both "No reliable backup childcare" and "Prefer not to say" clear the rest:
 * the first is a statement that none of the others apply, and it is the most
 * useful answer on the screen for matching.
 */
const CHILDCARE_BACKUP: Option[] = [
  { id: "family_nearby", label: "Family nearby who can help" },
  { id: "friends_or_parents", label: "Friends or other parents" },
  { id: "backup_sitter", label: "Backup sitter or nanny" },
  { id: "employer_or_school_backup", label: "Employer, school or agency backup care" },
  { id: "a_parent_can_cover", label: "A parent can usually cover" },
  { id: "no_reliable_backup", label: "No reliable backup childcare", exclusive: true },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/**
 * Item 14, first half. "Close to home" and "Will drive for the right thing" were
 * two options in a list of eight, which made distance a *preference* competing
 * with parking. It is a threshold, so it is its own single-select question.
 */
const TRAVEL_TIME: Option[] = [
  { id: "under_10_min", label: "10 minutes or less" },
  { id: "under_20_min", label: "Up to 20 minutes" },
  { id: "under_30_min", label: "Up to 30 minutes" },
  { id: "over_30_for_fit", label: "More than 30 minutes for the right fit" },
];

/**
 * Item 14, second half: capped at three, on the client's instruction. Ten ticks
 * is not a set of priorities — the cap is what turns this into one.
 */
const PRACTICAL_PRIORITIES: Option[] = [
  { id: "easy_parking", label: "Easy parking or drop-off" },
  { id: "weekday_flexibility", label: "Flexible weekday scheduling" },
  { id: "weekend_friendly", label: "Weekend availability" },
  { id: "working_parent_hours", label: "Early drop-off or late pickup" },
  { id: "sibling_friendly", label: "Siblings can attend together" },
  { id: "stroller_friendly", label: "Easy with a baby or stroller" },
  { id: "flexible_booking", label: "Flexible booking or make-ups" },
  { id: "budget_friendly", label: "Budget-friendly" },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/* P11. The word "budget" stays out of the UI; the stored dimension keeps its name
   so nothing downstream has to change. */
/**
 * How Pando should weigh cost. Rewritten to the client's list, 24 Aug (item 15),
 * and the *shape* changed as much as the words.
 *
 * The old options overlapped so badly that they could not be an instruction: a
 * parent can compare carefully, care about value, pay more for quality and look
 * for the best available all at once, so a multi-select produced five ticks and
 * no ranking rule. Hers are mutually exclusive, so **single-select** — Pando now
 * receives an actual default.
 *
 * Four of her notes are constraints on how this value may be used, and they
 * belong here rather than in a ticket:
 *
 *  - It **improves ranking only.** It must never infer income, and never exclude
 *    a parent from seeing an option.
 *  - "Free or low-cost" **never lowers the safety or quality baseline.**
 *  - A request inside a specific question **always overrides** this default.
 *  - Skipped, or "prefer not to say", means *show good options across price
 *    points* — which is why that is an option in its own right rather than a
 *    fallback nobody can see.
 *
 * Gone with the old list: "Mid-range is fine" (means something different in every
 * category) and the screen's "Pando never asks about income" (her note: it reads
 * as defensive and makes parents wonder why we said it).
 */
const COST_PREFERENCE: Option[] = [
  { id: "prioritize_low_cost", label: "Prioritize free or low-cost options" },
  { id: "prioritize_value", label: "Prioritize the best value for the price" },
  { id: "across_price_points", label: "Show me good options across price points" },
  { id: "prioritize_fit", label: "Prioritize the best fit, even if it costs more" },
  { id: "ask_each_time", label: "Ask me each time" },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/**
 * Item 16 — reframed, not just relisted. The client's correction goes to what
 * this question *is*:
 *
 * The old screen said Pando weighs shared affiliations first. That was wrong.
 * **Relevant, firsthand, recent-enough experience always comes first**, and these
 * choices only break the tie between parents who are already relevant. The help
 * text now says exactly that, and it is the one sentence on this screen that
 * matters.
 *
 * Four changes to the list: "Clubs / community group" and "Religious or community
 * group" overlapped, so parent groups, private clubs and faith communities are
 * now three separate things; "Similar family or work setup" was added, because we
 * have just asked for that context and it may matter more than a shared club; and
 * "No fixed preference" is `exclusive` **and the default when the screen is
 * skipped** — so skipping means "use the best available match", which is the
 * honest reading of no answer.
 *
 * Capped at three (`maxSelections`). Ten ranking hints rank nothing.
 *
 * Two rules that are not visible on the screen and must hold anyway: these are
 * ranking signals and **never hard filters**, and picking one here does **not**
 * give Pando permission to display that affiliation — visibility is a separate
 * decision (item 18).
 */
const TRUST_CIRCLES: Option[] = [
  { id: "same_school", label: "Same preschool or school" },
  { id: "same_neighborhood", label: "Same neighborhood" },
  { id: "same_classes", label: "Same classes or activities" },
  { id: "parent_group", label: "Same parent group or group chat" },
  { id: "private_club", label: "Same private or social club" },
  { id: "faith_community", label: "Same faith community" },
  { id: "friends_of_friends", label: "Friend of a friend" },
  { id: "similar_ages", label: "Children of a similar age" },
  { id: "similar_setup", label: "Similar family or work setup" },
  {
    id: "no_fixed_preference",
    label: "No fixed preference — use the best available match",
    exclusive: true,
    wide: true,
  },
];

/** P12, first cluster: local knowledge. */
/**
 * Item 17, first cluster: **local knowledge**, and it is now its own screen.
 *
 * Three of the client's corrections are in this list rather than in the copy:
 *
 *  - "Pediatric / health recommendations" was too broad and read as an offer of
 *    medical advice. It is now firsthand experience **with providers** —
 *    "Pediatricians and children's health providers".
 *  - "Special-needs resources" became "Developmental, learning or disability
 *    support", which is what parents actually call it.
 *  - "Daycare" is separated from preschools, matching the childcare split above.
 *
 * The opt-out is exclusive and per screen: declining local questions must not
 * also decline the parenting ones, which are a different kind of exposure.
 */
const TOPICS_LOCAL: Option[] = [
  { id: "activities", label: "Activities and classes" },
  { id: "preschools_schools", label: "Preschools and schools" },
  { id: "camps", label: "Camps" },
  { id: "daycare", label: "Daycare" },
  { id: "babysitters", label: "Babysitters" },
  { id: "nannies", label: "Nannies" },
  { id: "newborn_care", label: "Newborn and postpartum providers" },
  { id: "pediatric_health", label: "Pediatricians and children’s health providers" },
  { id: "special_needs_resources", label: "Developmental, learning or disability support" },
  { id: "outings", label: "Parks, outings and family-friendly places" },
  { id: "sports", label: "Sports" },
  { id: "arts_music", label: "Arts and music" },
  { id: "new_to_area_help", label: "Moving to or getting settled in the area" },
  {
    id: "no_local_questions",
    label: "I don’t want local questions right now",
    exclusive: true,
    wide: true,
  },
];

/**
 * P12, second cluster: lived experience. Sensitive by nature, so the question is
 * about willingness to help — never about whether they went through it — and it
 * always offers a way out.
 */
/**
 * Item 17, second cluster: **lived parenting experience**, on its own screen.
 *
 * "Newborn care" and "postpartum" overlapped across the two clusters, so the
 * personal side is now one thing — "Pregnancy, postpartum and the first year" —
 * and the provider side sits in the local list above. "Co-parenting or parenting
 * on your own" was added, because the setup screen now asks about it and a parent
 * who lives it is exactly who another needs.
 *
 * Four rules that hold whatever is ticked here, none of them visible on screen:
 * selecting a category means *open to being asked*, never a claim of expertise
 * and never permission for Pando to answer on their behalf; Pando must still
 * confirm relevant firsthand experience before routing a real question; every
 * request can be declined without penalty; and **skipping opts into nothing**.
 * Sensitive experience is never inferred from the rest of the profile.
 */
const TOPICS_LIVED: Option[] = [
  /**
   * 1 Sep, item 17: *"Split 'Pregnancy, postpartum and the first year' into
   * 'Pregnancy and postpartum' and 'Newborn and infant care.' The current
   * option overlaps with sleep, feeding and development."*
   *
   * The overlap is the substance. A parent who ticked the old option could not
   * tell whether they were offering to talk about a caesarean recovery or about
   * a four-month sleep regression, and those go to different people.
   *
   * The retired id is kept resolvable by `RETIRED_TOPICS_LIVED` below, so a
   * profile already stored against it still reads.
   */
  { id: "pregnancy_postpartum", label: "Pregnancy and postpartum" },
  { id: "newborn_infant_care", label: "Newborn and infant care" },
  { id: "sleep_routines", label: "Sleep and routines" },
  { id: "feeding_picky_eating", label: "Feeding and picky eating" },
  { id: "development_milestones", label: "Development and milestones" },
  { id: "returning_to_work", label: "Returning to work" },
  { id: "working_parent_logistics", label: "Working-parent logistics" },
  /* Her wording: "without nearby family support" rather than "with limited
     nearby support", which described a degree instead of a situation. */
  { id: "limited_nearby_support", label: "Parenting without nearby family support" },
  /* Item 17: *"Separate 'Co-parenting across households' from 'Parenting on my
     own.' They are materially different experiences."* One chip meant a parent
     who co-parents amicably across two homes and a parent doing it alone were
     the same person to Pando. */
  { id: "co_parenting_across_households", label: "Co-parenting across households" },
  { id: "parenting_on_my_own", label: "Parenting on my own" },
  { id: "identity_after_parenthood", label: "Emotional adjustment to parenthood" },
  { id: "loneliness_emotional", label: "Loneliness and isolation" },
  { id: "relationship_changes", label: "Relationships after children" },
  {
    id: "no_parenting_questions",
    label: "I don’t want parenting questions right now",
    exclusive: true,
    wide: true,
  },
];

/**
 * Ids no longer offered, kept resolvable so a stored answer still has a label.
 *
 * `pruneAnswers` drops selections whose option has gone, which is right for a
 * chip somebody tapped by mistake in a test session and wrong for a real
 * answer that a **split** retired: the parent said something true and the list
 * changed underneath them. So these keep their words, are never offered again,
 * and survive the prune.
 *
 * `co_parenting_or_solo` deliberately does not resolve to either half of its
 * split: choosing one on the parent's behalf would be Pando inventing which of
 * two materially different experiences they meant, which is the whole reason
 * item 17 asked for the split.
 */
export const RETIRED_OPTIONS: Partial<Record<QuestionId, Option[]>> = {
  topics_lived: [
    { id: "postpartum_first_year", label: "Pregnancy, postpartum and the first year" },
    { id: "co_parenting_or_solo", label: "Co-parenting or parenting on your own" },
  ],
};

/**
 * P13. One tap, and it is the only thing that decides how a parent is named in an
 * answer. Both options are private by default; the second one is bounded by a
 * promise we have to keep at query time, so the wording says it out loud.
 */
/**
 * Item 18 — rewritten, and every one of the client's four objections was to
 * something the old two options *claimed* rather than to their wording:
 *
 *  - **"Anonymous, but verified" was a contradiction.** Pando knows exactly who
 *    the parent is. What we meant is that their name is not shown. And she is
 *    explicit: do not use the word "verified" at all unless a documented
 *    verification standard has actually been met.
 *  - **"First name — only where it can't identify me" was a promise we cannot
 *    keep.** A first name can be enough to identify somebody in a small school.
 *    Deciding on the parent's behalf whether it is safe is not ours to do — so
 *    the parent chooses, and Pando does not second-guess it.
 *  - **Name and shared connection are two different decisions**, so they are two
 *    questions (below). A shared connection is shown *instead of* a name by
 *    default, never combined with it — combining requires separate approval of
 *    the exact wording, which is Phase 2 work.
 *  - **Skipping defaults to private**, with connections off. Silence is never
 *    consent to be named.
 */
const ATTRIBUTION: Option[] = [
  {
    id: "name_private",
    label: "Keep my name private",
    /**
     * 9 Sep, her copy list — the private option gets a reminder of what
     * anonymous attribution actually is.
     *
     * The example sentence alone was ambiguous in the one direction that
     * matters: "keep my name private" reads to some parents as *"then nothing I
     * say gets shared"*, which would make the whole screen look like a choice
     * about whether to contribute at all. It is not — the recommendation
     * reaches other parents either way, and only the name is withheld. So the
     * second clause says the thing the example implies and never states.
     */
    hint: "“A local parent recommends this.” Your recommendation is still shared — your name is not.",
  },
  {
    id: "first_name",
    label: "Use my first name",
    hint: "“Janet recommends this.”",
  },
  {
    id: "ask_each_time",
    label: "Ask me each time",
    hint: "Pando checks with you before each recommendation is shared",
  },
];

/**
 * The second half of item 18, and deliberately its own question.
 *
 * Saying yes here lets Pando tell another parent who shares one of your
 * connections that "a parent at your golf club" recommends something — without
 * your name. Three constraints from her Privacy Guidance that the *screen* cannot
 * enforce and the answering path must:
 *
 *  - Only a connection the recipient **also** has, resolved to the same canonical
 *    record — "Valley Hunt" free text does not match Annandale.
 *  - **One** affiliation per anonymous mention, never stacked with an age, a
 *    neighborhood or a school ("a mother of a two-year-old at Valley Hunt" is
 *    forbidden).
 *  - Counts are of distinct **households**, exclude anyone whose visibility is
 *    private, and are recalculated the moment somebody turns sharing off.
 *
 * **What is not built yet:** her model is a visibility state *per affiliation* —
 * share the school, keep the club private. This question is one answer for all of
 * them, which is the honest limit of today's data model and the open item behind
 * it.
 */
const SHARED_CONNECTIONS: Option[] = [
  {
    id: "share_connection",
    label: "Show a shared connection instead of my name when relevant",
    hint: "“A parent at your child’s preschool recommends this.” Only parents who share that connection see it.",
    wide: true,
  },
  {
    id: "no_connection",
    label: "Don’t mention my connections",
    exclusive: true,
    wide: true,
  },
];

/**
 * P14 — the reciprocity agreement (§7, 18 Aug), superseding the 3-question
 * default. Five is the network's actual floor for free Community Access, not a
 * cautious opening offer, so it is the default rather than a step up from one —
 * the old ladder's "Just 1 · Basic access" is gone with it: the strategy doc's
 * no-commitment path is "still use Pando, pay full price," never a fourth chip
 * here pretending a lighter version of the same agreement exists.
 */
/**
 * ## 9 Sep — the same three levels, presented as a comparison
 *
 * Her report: she does not understand the current presentation — *"once a week
 * / up to five questions / etc."* — and she wants the pattern a pricing page
 * uses, **without it being pricing**: a column per level, and the same three
 * rows down every column, with Active Contributor marked Recommended.
 *
 * The rows are hers: **Participation · Questions · Benefits**.
 *
 * ⚠ **Nothing here is new copy.** Every sentence below is the clause that was
 * already in that level's `hint`, moved into the row it answers — the old hint
 * ran all three of them together in one line, which is exactly the reading
 * problem she reported. `hint` is gone from these three because a plan column
 * has nowhere to put a fourth, unlabelled sentence.
 *
 * ⚠⚠ **Community member has no `benefits`, and that is deliberate.** She said
 * in so many words that she will supply the benefits, so the cell is left
 * **empty** rather than filled with something Pando made up. The other two
 * carry the sentence she already approved on 1 Sep, which is a benefit and was
 * only ever presented as the tail of a hint. Filling the third is one line in
 * this file.
 *
 * ⚠ **The 48-hour gap reads as Open Contributor's alone**, because her own
 * wording put it there and the chip layout had the same asymmetry. It is
 * actually true of every level (invariant 5) and the screen's `help` says so
 * above the columns. Reworded, it would be our sentence rather than hers — so
 * it stays as written and goes on the list for her.
 */
/**
 * ## The three levels, in the client's own words — 10 Sep
 *
 * She supplied the whole table this time: the question, the intro, and a
 * "how often we may ask" and "what you get" for each of the three. Every cell
 * below is hers, verbatim, and that closes the one thing `PlanGroup` shipped
 * deliberately empty on 9 Sep — *"Janet прямо сказала, що ще дасть benefits"*.
 * Community member has a benefits cell now because she wrote one.
 *
 * ⚠ **Three of her benefits name things that do not exist yet**, and each is
 * labelled with her own hedge rather than promised flat: a Network Check a
 * month, Pando+, caregiver matching. Her instruction is explicit — *"Label
 * benefits that are not yet live 'during the pilot' or 'at launch.'"* — so the
 * hedge is part of the sentence and must not be tidied away. A credit is
 * denominated in Network Checks and those are not spendable yet (10 Aug), so
 * without the hedge this screen would promise a balance nothing can pay out.
 *
 * ⚠ **"Recommended" stays a badge on the middle level** (`recommended`), which
 * is where her 1 Sep instruction put it, and must never become "Most popular" —
 * she ruled that out by name for want of usage data.
 */
const ALLOWANCE: Option[] = [
  {
    id: "5",
    label: "Community member",
    wide: true,
    plan: {
      participation: "Up to 5 relevant questions a month",
      questions: "The minimum level",
      benefits:
        "Join Pando. Ask questions and get answers from parents with firsthand experience. Invite friends.",
    },
  },
  {
    id: "10",
    /**
     * 1 Sep, item 18: *"Highlight Active Contributor as **Recommended**. Do not
     * call it 'Most popular' without supporting usage data."* — which is the
     * badge rather than two words appended to the name.
     */
    label: "Active contributor",
    recommended: true,
    wide: true,
    plan: {
      participation: "Up to 10 relevant questions a month",
      questions: "Happy to help more",
      benefits:
        "Everything above, plus one Network Check each month during the pilot, early access to caregiver matching and discounted Pando+ at launch.",
    },
  },
  {
    id: "as_relevant",
    label: "Open contributor",
    wide: true,
    plan: {
      participation: "Whenever it’s relevant — never more than one every 48 hours",
      questions: "Ask me when it fits",
      benefits:
        "Everything above, plus Pando+ during the pilot, two Network Checks a month, priority routing for questions, timely seasonal reminders, early access to caregiver matching and additional invitations.",
    },
  },
];

/**
 * The listening-ear opt-in (18 Aug strategy addition, no P-number of its own).
 * Two options, and neither is a soft middle: the strategy doc's own copy is a
 * plain yes/no, and a "maybe" here would leave D1 sensitive-question routing
 * (Phase 2) unable to tell "willing" from "unset."
 */
const LISTENING_EAR: Option[] = [
  { id: "opted_in", label: "I'll be a listening ear" },
  { id: "declined", label: "Not for me right now" },
];

/**
 * Behind the fork. `true` only once the parent has tapped **Add optional
 * details** — `null` (not yet asked) and `false` (Continue) both hide the
 * screen, which is what makes the fast path the default rather than something
 * a parent has to opt out of.
 */
const wantsDetail = (answers: ProfileAnswers): boolean =>
  answers.wants_detail === true;

/**
 * Is there any connection a parent could grant at all?
 *
 * ⚠⚠ **The third layer of the 10 Sep rule, and it was being done by
 * `ASK_LATER` rather than by anything durable.** `affiliationOptions` returns
 * nothing while `NAMEABLE` is empty, so `connection_visibility` has no chips —
 * and `visibleQuestions` does not consult the option list (it cannot; options
 * need the market), so the screen rendered anyway. Measured in a browser the
 * moment that set was emptied: a heading, a paragraph promising *"Pando may
 * tell another parent with this same connection…"*, the caveat, and **zero
 * controls**. A screen with nothing to answer, making the one promise the
 * product refuses to keep.
 *
 * So the gate is here, where it survives the screen moving in and out of the
 * flow. The day the client names one type as shareable it is one entry in
 * `NAMEABLE` and this screen comes back on its own.
 */
const anyConnectionMayBeNamed = (): boolean =>
  AFFILIATION_QUESTIONS.some(producesAffiliation);

/**
 * ## Every screen this flow has ever asked, in order
 *
 * `SCREENS` is this minus `ASK_LATER` — see below. The definitions stay here
 * rather than being deleted, because the client's instruction was *"ask the
 * other profile questions later, when relevant"*, which is a change of **when**
 * and not a decision that the questions were wrong.
 *
 * ⚠ **Exported, and `SCREENS` is still the flow.** Nothing that renders or
 * derives may read this: `visibleScreens`, `derive.ts` and the write route all
 * walk `SCREENS`, and a caller reaching here would put a question back in front
 * of a parent that the client took out. It is exported for the one job that
 * genuinely needs every definition — the suites, which assert the wording and
 * the caps of questions the flow no longer asks, and which crashed on
 * `questionById("logistics")` the moment those moved.
 */
export const ALL_SCREENS: Screen[] = [
  {
    id: "neighborhood",
    eyebrow: "Where you are",
    /* Client's wording, 24 Aug (item 5). Her list is *cities*, not neighborhoods
       inside Pasadena — a Bungalow Heaven parent picks Pasadena, or types their
       own into "Other nearby area". The nine intra-Pasadena values were retired
       rather than deleted, so an existing answer still resolves. */
    title: "Where do you live?",
    help: "This helps Pando find parents whose local world overlaps with yours.",
    questions: [
      {
        id: "neighborhood",
        label: "Neighborhood",
        kind: "single",
        required: true,
        source: { type: "market", category: "neighborhoods" },
        affinity: { type: "neighborhood", weight: 3 },
        /* No typed fallback here. Item 2: "Keep one autocomplete route for
           unlisted locations … Remove the stranded 'Other nearby area' text
           unless it is an actionable option." The search box covers all 79
           towns and neighborhoods and its results carry their own
           "Can't find it? Add it", so a second route was two doors to one room
           — and the label was rendered nowhere, because
           SearchableChipGroup suppresses it. */
      },
    ],
  },
  {
    id: "child_ages",
    eyebrow: "Your kids",
    /* Her heading, 10 Sep, and it describes the control now rather than
       contradicting it: "tap a birth year for each one" was a multi-select
       pretending to be a list, so a parent with two children born in one year
       tapped once and Pando recorded one child. */
    title: "Add each child's birth year.",
    help: "So we only ask you about stages you've actually lived. Birth years, never names — and the month is optional.",
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
  /**
   * ## The fork — the client's instruction of 10 Sep, and the shape of the flow now
   *
   * *"After location and children, show Continue and Add optional details.
   * Continue skips all optional details … The path to the first recommendation
   * must contain no more than 8 screens."*
   *
   * **What is required is two questions.** Where they live and who their
   * children are — the two §8.5 has always called required, and the two the
   * matcher genuinely cannot run without. Everything else on the way to a first
   * recommendation is either a permission (the participation level and the
   * recurring-messages opt-in) or is behind this fork.
   *
   * ⚠ **The count, so the next session can check it rather than trust it:**
   * `/join` · where you live · your children · this · participation · review ·
   * the code · `/share`. **Eight**, and seven wherever verification cannot
   * send. `test:feedback` asserts the ceiling rather than leaving it to drift.
   *
   * ⚠ **The framing is hers, and it is deliberately not a nudge toward the
   * "right" answer.** *"The more detail you give, the more custom your answers
   * will be"* is a true statement about the matcher and it is the only argument
   * this screen makes: no count of what is behind the door (that reads as a
   * price), no progress penalty, no "recommended". Continue is a first-class
   * answer, which is why it is the primary button.
   */
  {
    id: "detail_fork",
    eyebrow: "That’s the required part",
    title: "That’s everything Pando needs.",
    statement: {
      body: [
        "You can go straight to sharing a recommendation — nothing after this is required, and you can add any of it later.",
        "The more detail you give, the more custom your answers will be: schools, regular classes or groups, childcare, and the parenting topics you have been through yourself.",
      ],
    },
    fork: {
      continueLabel: "Continue",
      detailLabel: "Add optional details",
    },
    questions: [],
  },
  {
    id: "schools",
    /* Behind the fork (10 Sep) — one of the four the client named as optional:
       schools, recurring classes or groups, regular childcare, and the topics a
       parent has personally navigated. */
    when: wantsDetail,
    eyebrow: "Your circles",
    /* The helper here said "The strongest matching signal there is. Former
       counts: a parent who's been through admissions is exactly who someone
       needs." Removed on the client's instruction (24 Aug, item 6) — it explained
       our matching to a parent who has not asked, and "the strongest signal"
       reads as pressure to answer a question that is optional. Her own screen
       title for this is below; "or has attended" is what still invites a former
       school, without the sales pitch. */
    /* Her wording, 10 Sep — and the tense is the change that matters: "have
       your children attended" invites the former school the old title had to
       explain in a helper, and it asks about the family rather than about one
       unnamed "your child". */
    title: "Which schools, preschools or daycares have your children attended?",
    /* Item 4, verbatim. "This stays private" claimed less than the truth and
       explained none of it: the parent decides later, per connection, and that
       is the sentence that makes the privacy screen legible when it arrives. */
    help: "Private by default. Pando uses this for matching, and you can decide later whether it may be shown as a shared connection.",
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
        /* A school belongs to a child, not to a household. Asked only when the
           family has more than one. Two each, because "Former counts" is this
           screen's own invitation and one child commonly has a preschool behind
           the school they are in now. */
        perChild: true,
        perChildLimit: 2,
        /**
         * Item 4: *"Repeat or associate the question separately for each child.
         * Suggested heading: 'Where does your child born in 2025 currently
         * go?' Siblings may attend different places."*
         *
         * Her heading, verbatim, and it is the sentence that makes the
         * repetition worth the screen: it names the child, so a parent with a
         * toddler and a teenager is never asked to sort one list of preschools
         * and high schools afterwards.
         */
        perChildRepeat: true,
        childHeading: "Where does your child born in {year} currently go?",
        /* Not the expecting gate — that is `perChild` in `isQuestionVisible`,
           because `expecting` carries the `baby` band with it. This list is
           what keeps the question off a screen for a family with no children
           in it at all, which today cannot happen and one day might. */
        showForBands: ["baby", "toddler", "preschool", "grade", "tween", "teen"],
      },
    ],
  },
  {
    id: "communities",
    /* Behind the fork (10 Sep) — one of the four the client named as optional:
       schools, recurring classes or groups, regular childcare, and the topics a
       parent has personally navigated. */
    when: wantsDetail,
    eyebrow: "Your circles",
    title: "Which local groups and communities are part of your family's life?",
    /* Item 5: her instruction for the activities section, and the three sections
       stay on one scrollable page — *"Do not split this into additional pages
       for now. Keeping the three sections on one scrollable page is acceptable
       and avoids extra work."* */
    /**
     * Her sentence, 10 Sep, and it carries two rules that were true and stated
     * nowhere a parent could read them.
     *
     * *"Adding a place means your family takes part; it is not a
     * recommendation"* — the "Attendance must not create a recommendation"
     * instruction, said on the screen rather than only enforced in the write
     * path (`repo/profile.ts` writes `person_schools` and affinity edges, and
     * never a `shares` row).
     *
     * *"Faith communities, private clubs and other sensitive affiliations are
     * used only for private matching and are never named to other parents"* —
     * which is `mayBeNamed` on screen. It is the strongest promise this screen
     * makes and it was enforced in three layers of code and printed in none.
     */
    help: "Select all that apply — every one is optional. Adding a place means your family takes part; it is not a recommendation. Faith communities, private clubs and other sensitive affiliations are used only for private matching and are never named to other parents.",
    questions: [
      {
        id: "classes",
        label: "Recurring classes & activities",
        kind: "multi",
        source: { type: "market", category: "baby_activities" },
        affinity: { type: "activity", weight: 4 },
        allowOther: true,
        otherLabel: "Another class or activity",
        perChild: true,
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
        perChild: true,
        showForBands: ["preschool", "grade", "tween", "teen"],
      },
      {
        id: "clubs",
        label: "Clubs & leagues",
        kind: "multi",
        source: { type: "market", category: "clubs" },
        affinity: { type: "social_group", weight: 3 },
        /* Her instruction: after selection, ask Current or Former. A current
           shared membership is the strong shared-circle signal; a former one is
           still worth having, weighted lower. Reuses the same mechanism as the
           per-school status, so nothing new stores it. */
        perSelectionStatus: { label: "For each one", options: CLUB_STATUS },
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
       * **Parent groups is gone entirely** (14 Aug), and this is the second half
       * of a removal that started on 12 Aug.
       *
       * First "Where this link reached you" went, when invites became one row per
       * group: the link already *knew* which group it was posted in, so asking a
       * parent to find it in a list was asking them to re-enter a fact we held.
       * That left a second question — "Parent groups", as *membership* — which
       * read to a parent as the same question asked twice, because the chips were
       * the same chips. The developer's call: an invite is about a group, so the
       * screen stops asking about groups.
       *
       * **The consequence, written down because nothing else records it:** the
       * `social_group` affinity now comes from "Clubs & leagues" alone. An invite
       * still writes **no** affinity edge (a link forwarded out of a group is
       * evidence somebody shared it, never that whoever opened it belongs there),
       * so a parent-group membership edge has no source in the questionnaire at
       * all. `invited_via_group` remains attribution, and attribution only.
       *
       * `market_options.parent_groups` stays: `/admin/invites` links each invite
       * to one of its values, which is the whole point of the table now.
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
    /* Behind the fork (10 Sep, second pass) — see the note above `ASK_LATER`. */
    when: wantsDetail,
    eyebrow: "Privacy",
    /**
     * Rewritten to the client's wording, 24 Aug (item 8). Three substantive
     * changes, not just phrasing:
     *
     *  - **Per-connection control replaces a blanket promise.** The old text said
     *    shared groups are mentioned anonymously "in groups of five parents or
     *    more". Hers says the parent decides *for each* school, club or faith
     *    community — which is a different data model (a visibility state per
     *    affiliation, not one setting per person) and is not built yet. The copy
     *    is what she approved; the model behind it is the open item.
     *  - **The threshold is gone.** "Five parents or more" was our floor; her
     *    wording examples start at one ("A parent at your golf club…"), and her
     *    counting rules spell out 1 / 2 / 3+ explicitly.
     *  - **The examples are shown, not described.** "An anonymous
     *    shared-connection mention" is meaningless until you read the sentence.
     *
     * **1 Sep, item 6 — two corrections, and the second was a real omission.**
     *
     * The heading is *"How Pando uses your connections"*, not "your answers".
     * On 24 Aug her block opened with a line repeating that heading and the
     * heading itself was the broader word; dropping the repeated line was
     * right, keeping the broader heading was not — this screen is about
     * connections specifically, and every sentence under it is.
     *
     * And **the sentence about contact information was missing**: *"Your name
     * and contact information stay private unless you separately agree to an
     * introduction."* It was in her 24 Aug block and did not make it onto the
     * screen. That is the one promise here a parent cannot infer from the
     * examples — the examples show a connection being named, and say nothing
     * about what stays private — so its absence left the strongest reassurance
     * on the screen unstated.
     *
     * The third instruction is not copy: *"Continue must not constitute consent
     * or change any connection's visibility."* Already true and asserted — the
     * screen asks nothing, `shared_connections` starts null and
     * `shared_affiliations` starts empty, so nothing a parent skips grants
     * anything.
     */
    title: "How Pando uses your connections",
    /**
     * ## Rewritten to the 10 Sep rule, because it had started stating something
     * false (10 Sep, second pass)
     *
     * *"Use these affiliations only for private matching. Never name them to
     * another parent or use them in shared-connection attribution, regardless of
     * the general setting."*
     *
     * ⚠⚠ **A disclosure is the one screen in this flow that cannot be
     * approximately right.** It exists to show a parent the sentence another
     * parent will read, and every version of it up to now was built around a
     * shared-connection mention — *"A parent at your child's preschool
     * recommends this."* `mayBeNamed` refuses to name **any** affiliation now,
     * so that sentence is not merely a stale example: it is Pando describing a
     * disclosure of something it will not disclose. Changing which club it names
     * cannot fix it, which is why the whole block is rewritten rather than
     * patched.
     *
     * ⚠ **The examples are the composer's own output, not illustrations.** They
     * are what `evidenceSentence` in `lib/answer.ts` actually builds — the
     * count sentence every reader gets, and the named form that appears only for
     * a single firsthand parent who turned their first name on for that one
     * recommendation. The earlier card copy quoted *"Janet recommends this."*,
     * a sentence the composer does not send, and this screen must not repeat
     * that: an example a parent will never receive is the same defect one
     * remove down.
     *
     * ⚠ The wording is mine and is on the list for the client. The **facts** in
     * it are hers, from 10 Sep; what could not stand was the old copy stating
     * the opposite of her own instruction.
     */
    statement: {
      body: [
        "Pando uses your connections and context to find parents whose experience fits your family. That happens privately: it decides who is asked, and it is never something another parent reads.",
        "Your schools, classes, clubs and faith communities are never named to another parent — not with your recommendations, and not as a shared connection. What another parent sees is the recommendation and how many parents stand behind it:",
      ],
      examples: [
        "“Three parents near you have used Little Maestros, a class in South Pasadena.”",
        "“Janet has used Little Maestros, a class in South Pasadena.”",
      ],
      bodyAfter: [
        "The second one appears only where you have turned your first name on for that particular recommendation. Your name is off by default, and it is a separate decision every time.",
        /* Item 6's restored sentence (1 Sep). Last, because it is the answer to
           the question the examples raise. */
        "Your name and contact information stay private unless you separately agree to an introduction.",
      ],
      link: { href: "/privacy", label: "Learn more about privacy" },
      /* Her wording. Both halves of it are Phase 2 promises: there is no Privacy
         Settings screen yet, and no channel to text PRIVACY into. Kept verbatim
         because she approved it, and flagged so it is not mistaken for built. */
      note: "You’re always in control. Change what Pando can show at any time in Privacy Settings or by texting PRIVACY.",
    },
    questions: [],
  },
  {
    /**
     * Item 11. One screen, **three distinct matching signals** — which is the
     * client's own summary of why it needed changing: current tenure, local
     * roots, and previous places were tangled into one list and one follow-up.
     *
     * They stay on one screen rather than three: all three answer "how local are
     * you", and a parent reads them together. What changed is that each is now
     * separately answerable.
     *
     * Note "Where did you move from?" is **gone as a question**. It used to be
     * asked only of parents under three years here, which meant a family who
     * moved from London twelve years ago had nowhere to say so — and it asked for
     * a coarse band that `derive.ts` now computes from the city itself.
     */
    id: "time_in_area",
    /* Behind the fork (10 Sep, second pass) — see the note above `ASK_LATER`. */
    when: wantsDetail,
    eyebrow: "Life context",
    /* 9 Sep, her copy list: the town comes out of the question. Pasadena is
       this market and not the parent's — seventeen towns are on offer, and a
       parent in Monrovia was being asked how long they had lived in somebody
       else's. "This area" is the same question with the assumption removed. */
    title: "How long have you lived in your area?",
    /**
     * ## Why this line says what it counts (7 Sep)
     *
     * The client's report: on this screen the options do not hang together —
     * *"if you grew up here then you have lived here more than ten years
     * anyway"*. She is describing a real defect, and it is not the redundancy
     * it looks like.
     *
     * **The question never said what it measured.** For a parent who grew up in
     * Pasadena, left for a decade and came back three years ago, *"How long
     * have you lived in your area?"* has two truthful answers — 10+ for
     * a lifetime, 1–3 for the current stretch — and the screen gave no rule. So
     * two identical families answered differently and `time_in_area` became
     * noise in the one dimension it exists to measure.
     *
     * ⚠ **The fix is not to fold "I grew up here" back into the band list**,
     * which is what the redundancy reading suggests. Item 11 took it out of that
     * list on 24 Aug for exactly this parent: as an option there it was mutually
     * exclusive with every band, so a returner *had* to pick one truth and drop
     * the other. Putting it back would restore that bug.
     *
     * Counting from the most recent move makes every combination coherent
     * instead: grew up here and 10+ is somebody who never left, grew up here and
     * under a year is a returner — which is a **more** useful pair than either
     * answer alone, because it says both "knows this place deeply" and "has been
     * away, so may not know this year's waiting lists".
     *
     * The two also stay separate in the graph, and that is deliberate:
     * `derive.ts` writes `grew_up_here` and `time_in_area` as their own
     * dimensions, so neither stands in for the other.
     *
     * The sentence it replaces — *"Your local experience helps Pando tailor
     * answers…"* — explained **why** we ask, which is the kind of line the 4 Sep
     * triage removes; this one names a rule the reader would otherwise walk
     * into. ⚠ New user-facing copy, so it is on the list for the client.
     */
    help: "Count from your most recent move. If you grew up here, tick the box below too — even if you left and came back.",
    questions: [
      {
        id: "time_in_area",
        label: "Time here",
        kind: "single",
        source: { type: "static", options: TIME_IN_AREA },
        relevance: "tenure",
      },
      {
        id: "grew_up_here",
        label: "Local roots",
        /* Single, and the one option toggles — which is what a checkbox is. */
        kind: "single",
        source: { type: "static", options: GREW_UP_HERE },
        relevance: "tenure",
      },
      {
        id: "previous_places",
        label: "Where have you lived before?",
        kind: "multi",
        /* Search-only: this category has no starter set, so the chips are absent
           and the search box is the whole control. */
        source: { type: "market", category: "previous_places" },
        /* Their own answer if Pando does not have the place — her instruction:
           "Users can add a missing location." It lands in `pending_options` for
           an admin, exactly like a school. */
        allowOther: true,
        otherLabel: "Optional — anywhere that's part of your experience",
      },
    ],
  },
  {
    /**
     * ## 9 Sep — two screens, because they were always one question
     *
     * Her report, repeated: onboarding is too long and visually overloaded, and
     * *"Parenting setup / Work setup / Childcare, backup childcare"* are the
     * screens she named to merge. These two were split on **24 Aug** (item 12)
     * and the reason for the split is worth reading before undoing this: the old
     * single screen ran the two together into options nobody could compare —
     * *"Two parents, one at home"* meant a stay-at-home parent **or** one
     * working from home.
     *
     * That fix was to the **options**, and it holds untouched: two questions,
     * two option lists, two answers, the same `family_setup` dimension. What is
     * reversed is only that each got a screen of its own — a page with one
     * six-chip question on it, twice in a row, which is the shape she is
     * complaining about.
     *
     * ⚠ **Nothing about the data moves.** `family_structure` and `work_setup`
     * are still separate answers with separate ids, so `derive.ts`, the payload,
     * the review screen and the admin are untouched and there is no migration.
     * ⚠ And the two instruction lines are kept **verbatim**, one per question —
     * which is what `Question.help` was added for; picking one for the merged
     * screen would have deleted an instruction a parent acts on.
     */
    id: "household_setup",
    /* Behind the fork (10 Sep, second pass) — see the note above `ASK_LATER`. */
    when: wantsDetail,
    eyebrow: "Life context",
    /* Her own two titles, joined. "Your parenting setup" alone would have left
       the work question sitting under a heading that does not cover it. */
    title: "Your parenting and work setup",
    questions: [
      {
        id: "family_structure",
        label: "Family",
        alphabetical: true,
        help: "This helps Pando find parents who understand your family’s day-to-day. Select all that apply.",
        /* Measured before deciding: as two chip lists this merged screen was
           1,168px, because six labels this long are six full-width rows each.
           As two boxes it is a screen. */
        dropdown: true,
        kind: "multi",
        source: { type: "static", options: PARENTING_SETUP },
        relevance: "family_setup",
        /* "Something else" is an option in her list now, so the free-text
           fallback is what it opens rather than a second route to the same
           idea. */
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
      },
      {
        /* Item 12's second question. Same `family_setup` dimension as the one
           above — the split is about what a parent is asked, not about how it is
           stored, so nothing downstream and no migration. */
        id: "work_setup",
        label: "Work",
        alphabetical: true,
        help: "This helps Pando tailor answers to your schedule and logistics. Select all that apply.",
        dropdown: true,
        kind: "multi",
        source: { type: "static", options: WORK_SETUP },
        relevance: "family_setup",
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
      },
    ],
  },
  {
    /**
     * Item 13, first screen: the *regular* arrangement.
     *
     * `perChild` because siblings genuinely differ — a toddler in daycare and a
     * nine-year-old in an after-school programme is one household with two
     * answers, and the old single household answer could not say that. The client
     * asked whether to repeat the question per child or offer "same for all
     * kids"; this keeps the developer's existing shape (one list, each selection
     * attributed to the children it belongs to) rather than adding a screen per
     * child, which is the same decision taken on 13 Aug for schools.
     *
     * No `perChildLimit` — unlike a school, a child can genuinely have several
     * arrangements at once (preschool in the morning, a sitter after).
     */
    id: "childcare",
    /* Behind the fork (10 Sep) — one of the four the client named as optional:
       schools, recurring classes or groups, regular childcare, and the topics a
       parent has personally navigated. */
    when: wantsDetail,
    eyebrow: "Life context",
    /**
     * ## 9 Sep — "Childcare / backup childcare" as one item, which is how she
     * wrote it
     *
     * The two were split on 24 Aug (item 13) because a regular arrangement and
     * a fallback are different facts, and they still are — two questions, two
     * answers, one screen. The backup question keeps its own `when`, moved off
     * the screen and onto itself: for an expecting-only parent both questions
     * are hidden (the regular one by the `perChild` rule) and `visibleScreens`
     * drops a screen with nothing left on it, so the behaviour the screen-level
     * gate produced is unchanged.
     *
     * ⚠ **Both lists are dropdowns.** Eleven options plus seven is what made
     * merging these two look impossible; as two compact controls the screen is
     * shorter than either of the pages it replaces. A parent choosing childcare
     * knows their own arrangement before they read the list — the list is a
     * lookup, which is the case a dropdown is for.
     */
    title: "Your childcare",
    questions: [
      {
        id: "childcare_now",
        label: "Regular care",
        /* The list she named: eleven arrangements, and a parent is looking up
           their own rather than reading them all. */
        alphabetical: true,
        /* Item 10, her wording. The old line ended "Select all that apply"
           while the cap hint underneath said "One per child" — two instructions
           that contradicted each other on one screen. */
        help: "Select all regular care arrangements that apply.",
        dropdown: true,
        kind: "multi",
        source: { type: "static", options: CHILDCARE_REGULAR },
        relevance: "childcare",
        perChild: true,
        /**
         * Item 10: *"Capture care separately for each child."* Together with
         * that item's last bullet — the options adapt to the child's age — this
         * is what stops a one-year-old's block offering an after-school
         * programme, because the block is filtered to that child's band rather
         * than to the family's union.
         */
        perChildRepeat: true,
        childHeading: "Care for your child born in {year}",
        /* Her own suggestion, and only here: siblings genuinely share a
           daycare or a nanny, and genuinely do not share a school. */
        sameForAll: "Use the same care arrangements for all children",
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
      },
      /* ⚠ **Backup childcare is gone** — the client, 10 Sep: *"Keep regular
         childcare; let’s remove backup care — it’s not necessary."* It was
         hers too (24 Aug, item 13), so this is a reversal rather than a trim.
         What goes with it is one `life_relevance` dimension’s worth of signal
         on the `childcare` axis — the regular arrangement above still writes
         it, so the dimension survives and only the fallback half of it does
         not. `CHILDCARE_BACKUP` and `answers.childcare_backup` stay in place:
         parents answered this under an older build, and the field is still
         read back on the admin side. */
    ],
  },
  {
    /**
     * Item 14. Her layout keeps both questions on one screen with two headings,
     * which is right: distance is a threshold and the rest are preferences, and
     * reading them together is how a parent decides. Splitting them into two
     * screens would separate a question from its own context.
     */
    id: "logistics",
    /* Behind the fork (10 Sep, second pass) — see the note above `ASK_LATER`. */
    when: wantsDetail,
    eyebrow: "Life context",
    title: "What makes an option work for your family?",
    help: "Tell Pando what matters when comparing classes, camps or childcare.",
    questions: [
      {
        id: "travel_time",
        /* Item 12: *"Travel time is single-select. Add 'Choose one' beneath
           'Usual travel time'."* It always was single; the screen never said
           so, and a parent who cannot tell will try to tap two. */
        label: "Usual travel time — choose one",
        kind: "single",
        source: { type: "static", options: TRAVEL_TIME },
        relevance: "logistics",
      },
      {
        id: "logistics",
        label: "Logistics",
        alphabetical: true,
        /* Nine options of which three may be picked, under a four-chip question
           on the same screen — the longest static list left standing after the
           9 Sep merges, and the same lookup case as the trust circles. */
        dropdown: true,
        kind: "multi",
        source: { type: "static", options: PRACTICAL_PRIORITIES },
        relevance: "logistics",
        /* Her number. Three is what makes this a priority list rather than a
           description of everything a parent would like. */
        maxSelections: 3,
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
      },
    ],
  },
  {
    /**
     * ## 9 Sep — *"Budget / What should Pando prioritize?" → one screen*, her words
     *
     * They are the same question asked twice: what Pando should weigh when it
     * has more than one honest answer to give. Price was its own screen only
     * because it was written first, and it is one six-chip question.
     *
     * ⚠ The **title is hers, already** — the trust screen's own, and it covers
     * both halves without a word being invented. Each question keeps its own
     * instruction verbatim under its own label.
     *
     * ⚠ The eyebrow is `Preferences` rather than `Trust`: the screen is now
     * about both, and *Trust* would name the second question over the first.
     */
    id: "priorities",
    /* Behind the fork (10 Sep, second pass) — see the note above `ASK_LATER`. */
    when: wantsDetail,
    /* Her point, and it is a real one: this is a recommendation *preference*, not
       life context. "Which describes you?" also made a spending preference sound
       like a personal identity, which is why the title is about Pando's
       behaviour rather than about the parent. */
    eyebrow: "Preferences",
    title: "What should Pando prioritize?",
    questions: [
      {
        id: "budget",
        /* Her label (2 Sep). Rendered above the chips now that the screen
           carries two questions, as well as on the review row. */
        label: "Price & value",
        /* Single-select, and the box is the compact form of one: it closes on
           the pick and leaves the answer on screen as a removable chip. */
        dropdown: true,
        /* ⚠ **Deliberately not `alphabetical`**, and the only dropdown that is
           not. These options are a **scale** — free-or-low-cost, best value,
           across price points, best fit even if it costs more — and A–Z turns
           that into "Ask me each time · Prioritize free… · Prioritize the best
           fit… · Prioritize the best value… · Show me…", which reads as random
           and hides that there is an order at all. */
        /* Item 13, verbatim: *"'How should Pando weigh cost?' / 'Pando weigh'
           sounds weird."* This was the screen's title and is the question's
           instruction; her sentence is unchanged. */
        help: "Choose one — what usually works best for you. You can change this for any specific question.",
        /* Single, not multi — see COST_PREFERENCE. A default instruction cannot
           be five simultaneous answers. */
        kind: "single",
        source: { type: "static", options: COST_PREFERENCE },
        relevance: "budget",
      },
      {
        id: "trust_circles",
        label: "Trust circles",
        alphabetical: true,
        /**
         * Item 16, and this line is the correction. The old one said Pando
         * weighs these *first*, which was wrong and was the client's main
         * objection: relevant, firsthand, recent-enough experience always comes
         * first, and these only choose between parents who are already
         * relevant.
         */
        help: "Relevant firsthand experience always comes first. Choose up to three other things that matter to you — three at most.",
        /* Ten options of which three may be picked: the parent is choosing a
           short list out of a menu, which is the lookup case rather than the
           read-every-line case. */
        dropdown: true,
        kind: "multi",
        source: { type: "static", options: TRUST_CIRCLES },
        maxSelections: 3,
        relevance: "trust_circle",
      },
    ],
  },
  /**
   * ## The local-questions screen is gone (3 Sep)
   *
   * Her instruction: *"Сторінку із запитанням про готовність відповідати на
   * чутливі/місцеві питання («Which local questions could you help with?»)
   * повністю прибирають з поточного флоу."*
   *
   * **The screen is removed; `answers.topics` is not.** That is the same call
   * as the listening-ear removal on 1 Sep, and for the same reason: parents who
   * filled this in under the old build have a real answer stored on their phone
   * and in `topic_preferences`, and deleting the field would throw away
   * something they actually said. So the field stays in `ProfileAnswers`, in
   * `EMPTY_ANSWERS`, in the route's allowlist and in `derive.ts` — where it is
   * still merged with `topics_lived` into `topic_preferences` — and nothing
   * asks for it any more.
   *
   * **What this costs, and it is worth putting back to her.** `topic_preferences`
   * was the only record of which *local* subjects a parent is the person to ask
   * about — camps, daycare, pediatricians, parks. Phase 2's routing has one
   * fewer signal for a new parent: the matcher still works (it scores shared
   * connections and life relevance, never topics), but "who should Pando ask
   * about camps in Altadena" now falls back to what somebody has already
   * contributed rather than what they said they know. `topics_lived` is
   * untouched and still carries the parenting-experience half.
   *
   * The sibling screen below (`topics_lived`, "Which parenting experiences
   * would you be comfortable sharing?") is **deliberately kept**: her
   * instruction names one heading, and that one — it is also the screen that
   * carries the topic-level consent she dictated on 1 Sep.
   */
  {
    /* Item 17, second of two. "Comfortable sharing" rather than "could help
       with": this list is about experience a parent lived, and the wording should
       not imply they are offering advice. */
    id: "topics_lived",
    /* Behind the fork (10 Sep) — one of the four the client named as optional:
       schools, recurring classes or groups, regular childcare, and the topics a
       parent has personally navigated. */
    when: wantsDetail,
    eyebrow: "What you know",
    /* Her wording, 10 Sep. It names the two things actually being stored —
       what the parent has been through, and whether they are willing to be
       asked — where "comfortable sharing" named only the second. */
    title: "Which parenting areas have you personally navigated and would be open to answering questions about?",
    /* Item 17's own words. */
    help: "Choose any topics where your firsthand experience could help. You’ll always decide whether to answer.",
    questions: [
      {
        id: "topics_lived",
        /**
         * ⚠ **The longest static list in the flow, and deliberately not a
         * dropdown** (9 Sep).
         *
         * Her instruction was long option lists → compact dropdown, and this is
         * fourteen options. It is also the one question here where each option
         * is **its own decision** rather than a lookup: the parent is not
         * finding an answer they already hold, they are reading down a list of
         * parenting experiences and deciding, one at a time, which they are
         * willing to be asked about. This screen carries the topic-level
         * consent the 1 Sep round folded the listening-ear page into.
         *
         * A dropdown hides what is not chosen. On a lookup that costs nothing;
         * here it costs opt-ins that would have been given — a parent does not
         * open a box to consider whether they would talk about loneliness. Her
         * own words on this pass were *"без втрати даних"*, and this is the one
         * list where the change would lose some.
         *
         * On the list for her rather than decided against her: if she wants it
         * boxed anyway, it is `dropdown: true` on this line.
         */
        kind: "multi",
        source: { type: "static", options: TOPICS_LIVED },
        /* Item 17: *"Add 'Something else' for relevant experiences Pando has
           not anticipated."* The typed route, not a chip — the universal
           comment applies here too. */
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
        /**
         * ⚠ **`required` was here and is gone** (10 Sep), and that reverses
         * item 17 of 1 Sep: *"Continue should activate once the parent selects
         * at least one topic or chooses the opt-out."*
         *
         * Her newer instruction names this question in the list that must be
         * optional — *"Keep schools, recurring classes or groups, regular
         * childcare and personally navigated topics optional"* — and by this
         * file's own rule the newer document wins.
         *
         * The two are in genuine conflict rather than about wording: this
         * screen now sits **behind the optional fork**, so a required question
         * here would mean a parent who tapped *"Add optional details"* could
         * not leave the screen without answering. Optional detail that cannot
         * be declined is not optional, and "I opened the door" is not consent
         * to every room behind it.
         *
         * ⚠ What item 17 was protecting is not lost. The explicit opt-out chip
         * is still on the list, so a parent who means *"ask me nothing"* can
         * still say so rather than leaving a silence — and now a silence and a
         * refusal are two different answers again, which is what the chip was
         * for in the first place.
         */
      },
    ],
    /**
     * **This screen is the listening-ear consent, and it no longer says so.**
     *
     * On 1 Sep the client removed the separate listening-ear page in favour of a
     * footnote here — her words, verbatim: *"This page is unnecessary if the
     * Parenting Experiences page already acts as the topic-level opt-in. Add the
     * following directly beneath the topics…"* On **2 Sep** she asked for the
     * descriptive box to come off the profile pages, and on this screen that box
     * was the footnote. So the opt-in is now made by *selecting a topic* and is
     * stated nowhere the parent can read it. Raised with her rather than
     * quietly absorbed, because what went is her own consent copy.
     *
     * The four constraints it carried are unchanged, and all four are now
     * code-only. Only route questions within topics the parent explicitly
     * selected — opting into one sensitive topic is not blanket permission for
     * every sensitive question. *Never infer* pregnancy loss, fertility
     * treatment, mental-health history, relationship problems or disability
     * from anything else in the profile. *Urgent* medical issues, self-harm,
     * abuse, immediate safety concerns and legal emergencies are **never**
     * routed as peer questions — that is `classifyDemand`'s high-stakes branch,
     * which answers with professional resources instead. And when a question is
     * routed, names are **not shared**: the exchange is never called anonymous,
     * because Pando knows exactly who both parents are.
     */
  },
  {
    /* "Ordinary recommendations" meant nothing to a parent — her word. The
       question is what credit they get, so that is what the title asks.
       ⚠ 9 Sep: "credit" was the system's word for it. Hers is the parent's —
       what this screen decides is what another parent sees, so that is the
       question, and every option below already answers it in those terms. */
    id: "attribution",
    /* Behind the fork (10 Sep, second pass) — see the note above `ASK_LATER`. */
    when: wantsDetail,
    eyebrow: "Privacy",
    title: "How do you want others to see you?",
    help: "Choose a default. You’ll see it and can change it each time before your recommendation is shared.",
    questions: [
      {
        id: "attribution",
        label: "Your name",
        kind: "single",
        source: { type: "static", options: ATTRIBUTION },
      },
      {
        id: "shared_connections",
        label: "Shared connections",
        kind: "single",
        source: { type: "static", options: SHARED_CONNECTIONS },
      },
    ],
  },
  {
    /**
     * Privacy Guidance §A — one decision per connection.
     *
     * **Only asked when the master switch above is on.** A parent who said "don't
     * mention my connections" has answered this screen already, and asking which
     * ones anyway would be asking them to repeat themselves in more detail.
     *
     * **Nothing here is pre-selected**, and that is the consent model rather than
     * a default: §A says new affiliations default to `private`, the privacy
     * explainer changes nothing, and "Continue" is not consent — only the toggle
     * is. So skipping this screen grants exactly nothing, which is why it needs
     * no "none of them" option.
     */
    id: "connection_visibility",
    eyebrow: "Privacy",
    title: "Which connections may Pando mention?",
    help: AFFILIATION_CONSENT_TEXT,
    questions: [
      {
        id: "shared_affiliations",
        kind: "multi",
        source: { type: "affiliations" },
      },
    ],
    /* Her caveat, immediately underneath and never as a tooltip: the one thing
       this control cannot promise. */
    footnote: AFFILIATION_CONSENT_CAVEAT,
    /* Two gates, cheapest first. `wantsDetail` is the fork (10 Sep, second
       pass); the rest is this screen's own narrower rule — nothing to decide if
       they named no connections at all. */
    when: (answers) =>
      wantsDetail(answers) &&
      anyConnectionMayBeNamed() &&
      answers.shared_connections === "share_connection" &&
      answers.schools.length +
        answers.classes.length +
        answers.camps.length +
        answers.clubs.length +
        answers.faith.length >
        0,
  },
  /**
   * ## "The Pando promise" is gone (9 Sep — her item 10)
   *
   * *"Є декілька проміжних informational screens. Прибрати ті, що не несуть
   * необхідної функції."* This was one: a screen that asked nothing, placed
   * **immediately before** the screen that says the same thing while asking for
   * a decision.
   *
   * Three of its four sentences were restated one tap later. *"Shared
   * give-to-get: contribute what you know, and Pando becomes more useful for
   * everyone"* and *"we may occasionally ask you a question"* are what the
   * participation screen's own help and its three columns say; *"You can always
   * skip a question"* is that screen's *"Every question is optional"*; and its
   * last clause — *"the next screen sets your own limit"* — was furniture about
   * navigation.
   *
   * ⚠ **One sentence was not said anywhere else, so it moved rather than went.**
   * *"There are no ads. No business or provider can ever pay to change an
   * answer."* is the strongest trust claim in the product and appeared exactly
   * once in the whole app; grepped before deleting. It is the participation
   * screen's `footnote` now, verbatim — under the levels rather than a screen
   * ahead of them, which is where a reason to believe the bargain belongs.
   *
   * ⚠ **The privacy disclosure is kept**, and it is the other statement screen.
   * She named the promise screens; a privacy disclosure is not one, it carries
   * the example sentences a parent needs *before* the attribution decision, and
   * its caveat is on the list for her rather than ours to remove (2 Sep).
   * ⚠ **The compliance opt-in is untouched**, as she required — it is the
   * recurring SMS/RCS checkbox on the screen below, not a screen of its own.
   */
  {
    id: "allowance",
    eyebrow: "Community",
    /**
     * 1 Sep, item 18 — rewritten to her page, and the framing is the change.
     *
     * The old screen asked a favour ("how often *may* Pando ask you"). Hers
     * states a condition of membership: *"Pando works because every parent can
     * ask the community — and every parent agrees to be available when their
     * experience could help someone else."* Community Member is named as the
     * **required minimum**, not as the gentlest of three options.
     *
     * Three things she asked for that are not wording:
     *
     *  - **No preselection**, and the choice is required — *"Remove Skip and do
     *    not preselect a level. The parent must affirmatively choose one"*, and
     *    *"Agree & Join Pando should remain disabled until a level is
     *    selected."* So `EMPTY_ANSWERS.allowance` is now `null`.
     *  - **The 48-hour gap applies to every request**, which is a reversal of
     *    the five-day figure taken from the 8.18 strategy — see
     *    `OUTREACH_GAP_DAYS`, and the Decisions entry that records it.
     *  - **The amount is a maximum, never a target.** Every individual question
     *    stays optional, and nothing anywhere may read a high allowance as an
     *    obligation.
     */
    title: "Ask when you need help. Help when you can.",
    /**
     * Her intro, verbatim (10 Sep). It replaces our paraphrase of the same
     * three facts, and one of them changed: hers says the level can be
     * changed at any time, which the old line did not.
     *
     * ⚠ **The 48-hour gap is no longer stated here**, and it is true of every
     * level rather than of Open Contributor alone (invariant 5) — her own
     * table puts it only in the third column, which is the asymmetry already
     * on the list for her. Reinstating it would make this our sentence again
     * rather than hers, so it stays as written and stays on the list.
     */
    help: "Pando works because parents help each other. Community Member is the minimum level. Every individual question is optional, and you can change your level at any time.",
    questions: [
      {
        id: "allowance",
        /**
         * Her label (2 Sep), and it fixes more than wording: what she reported
         * was "MONTHLY ALLOWANCE" from an older build, and by then the 1 Sep
         * rewrite had left this reading **"Choose one"** — an instruction, which
         * on a review screen summarising an answer says nothing at all
         * ("CHOOSE ONE · Community member"). Same rule as `budget` above: not
         * rendered on the question screen itself, only on the review row and as
         * the group's accessible name.
         */
        label: "Community participation",
        kind: "single",
        source: { type: "static", options: ALLOWANCE },
        required: true,
      },
    ],
    /* The one sentence rescued from "The Pando promise" when that screen was
       removed (9 Sep) — verbatim, and the only place in the app it is said. It
       sits under the levels because it is the reason to believe the bargain
       they are agreeing to, and above the recurring-messages consent because
       that is the act it qualifies. */
    footnote:
      "There are no ads. No business or provider can ever pay to change an answer.",
  },
  /**
   * **The listening-ear screen is gone** (1 Sep), on her explicit
   * recommendation: *"This page is unnecessary if the Parenting Experiences
   * page already acts as the topic-level opt-in."*
   *
   * It was added on 18 Aug as its own consent scope, and the argument for that
   * still holds — a different amount of exposure deserves its own record. What
   * changed is that the record now has a better source: the parent names the
   * *topics* they will be asked about, which is narrower and more honest than
   * one blanket yes. Her own note says why the blanket version was worse:
   * *"Opting into one sensitive topic is not blanket permission for every
   * sensitive question."*
   *
   * The `listening_ear` consent scope and its `LISTENING_EAR` vocabulary stay
   * in the schema and in this file. Nothing writes them now, and they are not
   * dropped: profiles stored under the old screen carry a real consent, and
   * `/admin/consents` is the A2P defence file that has to be able to say what
   * each of them agreed to.
   */
];

/**
 * ## `ASK_LATER` is empty, and the seven screens are behind the fork instead
 *
 * **The developer's call, 10 Sep (second pass): put them all back.** They are
 * up for discussion with the client, and a question nobody can answer cannot be
 * discussed against real data — which is what this set had made them.
 *
 * ⚠⚠ **Read this before adding an id back.** `ASK_LATER` removed a screen from
 * `SCREENS`, and `ProfileFlow` is the only renderer in the app: it walks
 * `visibleScreens()`, which filters `SCREENS`. So an id in here was not asked
 * *later* — it was asked **nowhere**. There is no other surface. The client's
 * sentence was *"ask the other profile questions later, when relevant … but
 * optional only"*, and only its first half had been built: they were taken out
 * of onboarding and nothing was put in their place.
 *
 * **What they cost while this set was populated**, measured through the real
 * `derive.ts` on two synthetic sessions rather than reasoned about:
 *
 * | | Continue | Add optional details |
 * | --- | --- | --- |
 * | `social_affinities` rows | 2 — neighborhood, age_range | 5 |
 * | `life_relevance` rows | 2, both defaults | 3 |
 * | of those, rows that score | **0** | 1 |
 *
 * A fast-path parent topped out at **5 points** (neighborhood 3 + age_range 2),
 * which is what a single shared school is worth on its own — and the second
 * matching layer was empty, because `budget`/`trust_circle` defaults are
 * written for a parent who answered nothing and deliberately score zero
 * (9 Sep). On the live database the two largest relevance dimensions are
 * `logistics` (26 rows) and `tenure` (25), and both come from screens that
 * had been put in here.
 *
 * **Why behind the fork rather than back on the required path.** The client's
 * *"no more than 8 screens to the first recommendation"* is explicit and
 * recent, and `test:feedback` pins it. Behind the fork the required path stays
 * four screens, every question is reachable and answerable, and the fork's own
 * screen carries her *"the more detail you give, the more custom your answers
 * will be"* — which is her wording for exactly these questions. The cost is
 * honest and worth stating: most parents will tap Continue, so relevance data
 * stays thin in practice. That is the discussion, not a fault of this code.
 *
 * ⚠ **`privacy_disclosure` came back with a defect it did not have before.**
 * It is a *statement*: the screen that shows a parent the sentence another
 * parent would see. Two of its three examples describe things that can no
 * longer happen — `mayBeNamed` now refuses to name **any** affiliation to
 * another parent, so a shared-connection example is false whichever club or
 * school it names. A disclosure has to be true. Its examples need rewriting,
 * and that is new user-facing copy, so it is the client's.
 *
 * ⚠ The set is kept rather than deleted, and `SCREENS` still derives from it:
 * emptying it makes `SCREENS` and `ALL_SCREENS` hold the same screens, so the
 * rule that **anything reading an answer back resolves against `ALL_SCREENS`**
 * stops being exercised while staying just as necessary. Do not "simplify" the
 * two into one.
 */
const ASK_LATER = new Set<string>([]);

export const SCREENS: Screen[] = ALL_SCREENS.filter((s) => !ASK_LATER.has(s.id));

/**
 * ## Questions no screen asks any more, kept resolvable — the `RETIRED_OPTIONS`
 * rule, one level up
 *
 * ⚠⚠ **This exists because deleting a question outright returned a 500 on the
 * profile write**, and it is worth reading before removing another one.
 * *"Let's remove backup care — it's not necessary"* (10 Sep) took the question
 * off the childcare screen and out of `ALL_SCREENS`. But `deriveLifeRelevance`
 * asks for it **by id, unconditionally** — it derives from *stored answers*,
 * and the answers do not know the screen has gone — so `questionById` threw
 * `Unknown question: childcare_backup` and the whole profile was refused. For
 * every parent whose device still held that answer, which on the day this ships
 * is every parent who has ever filled the form.
 *
 * So a question, like an option, is retired rather than deleted: **a stored
 * answer outlives the screen that asked for it.** What is kept here is only
 * what a reader of a stored answer needs — the id, the label, the shape and the
 * dimension it derives into. The `help`, the `dropdown`, the `when` gate and
 * the 7 Sep reasoning behind that gate are all deliberately dropped: they are
 * instructions to a parent looking at a screen, and there is no screen. They
 * are in git if she ever asks for the question back.
 *
 * ⚠ It is **not** in `ALL_SCREENS`, so nothing that walks screens can render it
 * or count it — only `questionById` reaches it, and only after every live
 * screen has been searched.
 */
const RETIRED_QUESTIONS: Question[] = [
  {
    id: "childcare_backup",
    label: "Backup",
    kind: "multi",
    source: { type: "static", options: CHILDCARE_BACKUP },
    relevance: "childcare",
  },
];

/** Questions whose chip lists are sensitive enough to always offer an out. */
/**
 * The options the client requires on each of the four searchable questions, over
 * and above the records in the directory ("Required special options" on all four
 * of her 24 Aug sheets).
 *
 * These are not data and never could be: no directory contains "Homeschool" or
 * "Not doing any yet", and the taxonomy importer strips rows she marked
 * `Special option` for exactly that reason. They belong to the question.
 *
 * **"None" and "Prefer not to say" are two options, not one.** They were a single
 * chip reading "None / prefer not to say", which conflates a fact with a refusal:
 * a family in no clubs at all is a useful thing to know, and a family declining
 * to say is not the same answer. She lists them separately on both sheets that
 * have them, and matching should never treat the second as the first.
 *
 * Both are `exclusive`, so either clears the named selections — and selecting a
 * named community clears them back, which `ChipGroup` already does.
 */
const SPECIAL_OPTIONS: Partial<Record<QuestionId, Option[]>> = {
  /* ⚠ **Schools has none** (10 Sep). "Homeschool" and "Not in school or daycare
     yet" were added here on 1 Sep because a homeschooling family had nothing to
     select — the right observation, the wrong place. They are answers about a
     *child*, so they are `CHILD_SCHOOL_STATUS` now, asked once per child above
     the list. Keeping them here as well would let a family be homeschooling and
     at a school at once, and would put "homeschool" back into the affinity
     graph. */
  classes: [
    { id: "not_doing_any_yet", label: "Not doing any yet", exclusive: true, wide: true },
  ],
  clubs: [
    { id: "none", label: "None", exclusive: true },
    { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
  ],
  faith: [
    { id: "none", label: "None", exclusive: true },
    { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
  ],
};

export function ageBandsOf(ages: number[]): AgeBand[] {
  /* The boundaries live in `lib/age-bands.ts` — one definition, because the
     matching side needs the same ladder from birth years, and a second copy here
     would drift the first time either was edited. */
  const bands = new Set<AgeBand>();
  for (const age of ages) for (const band of bandsForAge(age)) bands.add(band);
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
  /**
   * A question whose answer belongs to a child is not asked at all when the
   * only child is on the way.
   *
   * The 3 Sep round fixed the *mixed* family — `answerableChildren` keeps an
   * unborn child out of the attribution chips, the repeated blocks and the
   * "same for all children" shortcut — and left the family whose **first** is
   * on the way being asked all three of them, because with one child there is
   * nothing to attribute and `childBlocks` correctly falls back to the ordinary
   * household list. So the screen still read *"Where does your child go to
   * school, preschool or daycare?"*, offering "Homeschool" and "Not in school
   * or daycare yet" — two options for a child who has not been born.
   *
   * ⚠ `showForBands` cannot express this and the comment on the schools
   * question wrongly claimed it did: `bandsForAge(EXPECTING)` returns
   * **`["expecting", "baby"]`** on purpose (a family about to be in the baby
   * band is who they most want to hear from), so every band list that admits a
   * baby admits an expecting parent too. Narrowing those lists would break
   * matching to fix a screen; the gate belongs here.
   *
   * Only when they have answered: an empty `child_ages` is a parent who has not
   * reached the ages screen yet, and hiding half the flow from them would be
   * the same mistake in the other direction.
   */
  if (question.perChild && !hasBornChild(answers)) return false;
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
  return SCREENS.filter((s) => {
    /* A screen-level gate, checked before anything else: the per-affiliation
       privacy screen is only asked of a parent who said connections may be
       mentioned at all, and only if they named any. */
    if (s.when && !s.when(answers)) return false;
    return isStatementScreen(s) || visibleQuestions(s, answers).length > 0;
  });
}

export function optionsFor(
  question: Question,
  market: MarketId,
  answers: ProfileAnswers,
): Option[] {
  const base =
    question.source.type === "static"
      ? /**
         * **A static list's own `bands` are honoured too** (1 Sep).
         *
         * They were not, and that is a bug this feedback round turned up rather
         * than a change it asked for. Item 10's last bullet — *"Adapt the
         * choices to the child's age. Do not show after-school programs or
         * after-school sitters for a baby or preschool-aged child"* — describes
         * behaviour the regular-care list has *claimed* since 24 Aug: both
         * options carry `bands: ["grade", "tween", "teen"]` and a comment
         * saying so. Band filtering was only ever applied to the market branch
         * below, so a parent of a one-year-old was offered an after-school
         * programme by code that looked right in review.
         *
         * The `bands`-shaped bug again, and the archetype CLAUDE.md keeps
         * citing: a declared field nothing reads. `optionsForBands` passes
         * through any option with no `bands`, and returns everything when no
         * child has been tapped yet, so nothing else on any screen moves.
         */
        optionsForBands(question.source.options, ageBandsOf(answers.child_ages))
      : question.source.type === "affiliations"
        ? /* The parent's own connections. No age banding and no "prefer not to
             say": this is a list of *their* answers, and declining is what an
             untoggled row already means. */
          affiliationOptions(market, answers)
        : optionsForBands(
            marketOptions(market, question.source.category),
            ageBandsOf(answers.child_ages),
          );
  const ordered = question.alphabetical ? alphabetical(base) : base;
  /* Appended rather than merged into the directory, so they sit at the end of the
     list where a refusal belongs — and so an importer can never introduce or
     remove one. */
  const special = SPECIAL_OPTIONS[question.id];
  return special ? [...ordered, ...special] : ordered;
}

/**
 * A–Z, with the refusals left where they were (9 Sep — her item 8).
 *
 * `localeCompare` against a **named** locale rather than the runtime's: this
 * runs on the server and in the browser, and a list whose order depends on the
 * reader's machine is a list two parents see differently. Same reasoning as the
 * audit page's `whenExact`.
 *
 * ⚠ An `exclusive` option is the question's furniture — "Prefer not to say",
 * "No reliable backup childcare" — and sorting it into the middle of the answers
 * makes a refusal look like one of them. They keep their authored order at the
 * end, which is where `SPECIAL_OPTIONS` already goes.
 */
function alphabetical(options: Option[]): Option[] {
  const answersOnly = options.filter((o) => !o.exclusive);
  const refusals = options.filter((o) => o.exclusive);
  return [
    ...[...answersOnly].sort((a, b) => a.label.localeCompare(b.label, "en")),
    ...refusals,
  ];
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
    case "grew_up_here":
      return answers.grew_up_here ? [answers.grew_up_here] : [];
    case "attribution":
      return answers.attribution ? [answers.attribution] : [];
    case "shared_connections":
      return answers.shared_connections ? [answers.shared_connections] : [];
    case "shared_affiliations":
      return answers.shared_affiliations;
    case "allowance":
      return answers.allowance ? [answers.allowance] : [];
    case "listening_ear":
      return answers.listening_ear ? [answers.listening_ear] : [];
    case "child_ages":
      return answers.child_ages.map(String);
    default:
      return answers[question.id];
  }
}

/**
 * The children a per-child question can attribute an answer to, labelled the way
 * the parent tapped them in P4 — birth years, not ages.
 *
 * One child is not a question: there is only one possible answer, so the UI does
 * not ask and `childrenFor` below attributes it silently.
 */
/** One child's block on a `perChildRepeat` question. */
export interface ChildBlock {
  /**
   * The child's **index** in `child_ages`, which is what `child_of` keys on
   * since 10 Sep — never their age. Two siblings born in one year have one
   * age between them, so an age names a year and cannot name a child.
   */
  child: number;
  /** The birth year, as the parent tapped it. */
  year: string;
  /** Her heading, with the year filled in. */
  heading: string;
  /** Only what suits this child's age band — the point of the repetition. */
  options: Option[];
  /** What is currently attributed to this child. */
  selected: string[];
}

/**
 * The per-child blocks for a repeated question.
 *
 * Pure, so the whole of items 4 and 10 can be asserted without a browser — the
 * attribution arithmetic is where this would go wrong silently, and it did once
 * before in the other direction.
 *
 * Returns an **empty list** when the question is not repeated or the family has
 * one child, which is the caller's signal to render the ordinary single list.
 */
export function childBlocks(
  question: Question,
  market: MarketId,
  answers: ProfileAnswers,
): ChildBlock[] {
  if (!question.perChildRepeat) return [];
  const children = answerableChildren(answers);
  /* One child needs no blocks — there is nothing to attribute between — and a
     family with one born child and one on the way is now that case, which is
     the right answer: the household list with silent attribution. */
  if (children.length <= 1) return [];

  const attribution = answers.child_of[question.id] ?? {};
  /* Labels rather than bare years, so two siblings born in one year are told
     apart on the block headings exactly as they are on the chips. */
  const labels = new Map(childOptions(answers).map((o) => [o.id, o.label]));

  return children.map((index) => {
    const age = answers.child_ages[index];
    const year = labels.get(String(index)) ?? String(CURRENT_YEAR - age);
    return {
      child: index,
      year,
      heading: (question.childHeading ?? "For your child born in {year}").replace(
        "{year}",
        year,
      ),
      /* One child's bands, not the family's union. `optionsFor` takes the whole
         answers object, so it is handed a copy with just this child in it —
         and that copy carries the *age*, because bands are computed from it. */
      options: optionsFor(question, market, { ...answers, child_ages: [age] }),
      selected: Object.entries(attribution)
        .filter(([, owners]) => owners.includes(index))
        .map(([optionId]) => optionId),
    };
  });
}

/**
 * Apply one child's selections, and rebuild the question's answer from them.
 *
 * The direction is what changed on 1 Sep: attribution is written **forward**,
 * from the block the parent is looking at, rather than derived afterwards from
 * a household list. The stored shape is identical either way — which is what
 * made this a rendering change and not a migration.
 *
 * Two rules worth keeping:
 *
 *  - **An option nobody owns is removed.** Untapping the last child holding a
 *    school takes the school off the answer, because "selected by no child" is
 *    not a state this question has.
 *  - **The other children are untouched.** A block only ever adds or removes
 *    its own age, so two children sharing a daycare keep it when one of them
 *    stops.
 */
export function applyChildSelections(
  question: Question,
  answers: ProfileAnswers,
  /**
   * The child's **index** in `child_ages`, never their age (10 Sep). It was
   * called `age` while it already carried an index, which is the naming that
   * let `childrenFor` go on filtering positions against ages for a whole round
   * without anything looking wrong.
   */
  child: number,
  next: string[],
): { values: string[]; attribution: Record<string, number[]> } {
  const current = answers.child_of[question.id] ?? {};
  const map: Record<string, number[]> = {};

  for (const [optionId, owners] of Object.entries(current)) {
    const kept = next.includes(optionId)
      ? owners
      : owners.filter((owner) => owner !== child);
    if (kept.length > 0) map[optionId] = kept;
  }
  for (const optionId of next) {
    const owners = map[optionId] ?? [];
    if (!owners.includes(child)) map[optionId] = [...owners, child];
  }

  return { values: Object.keys(map), attribution: map };
}

/**
 * Item 10's shortcut: give every child the same answers.
 *
 * Built from the union rather than from one child, so a parent who filled two
 * blocks differently and *then* tapped it gets everything they had named — the
 * alternative is silently discarding half of what they typed.
 */
export function sameForAllChildren(
  question: Question,
  answers: ProfileAnswers,
): { values: string[]; attribution: Record<string, number[]> } {
  /* Item 10's shortcut must not hand a school to a child on the way either. */
  const children = answerableChildren(answers);
  const values = selectionsFor(question, answers);
  const attribution: Record<string, number[]> = {};
  for (const optionId of values) attribution[optionId] = [...children];
  return { values, attribution };
}

/**
 * The children a per-child question may be asked about — everybody except one
 * on the way.
 *
 * 3 Sep, her instruction: *"Для користувачів зі статусом «Expecting» питання
 * для такої дитини не мають відображатися."*
 *
 * It was a real defect rather than a wording point. `child_ages` stores
 * `EXPECTING` as -1 alongside the real birth years, and every per-child path
 * mapped over the lot — so a parent expecting a baby got a block headed **"For
 * your child born in Expecting"** asking which preschool that child attends and
 * what their current care arrangement is. Not merely odd: it is the app asking
 * a parent to answer for a child who does not exist yet, on the screen right
 * after they told it so.
 *
 * **The age itself stays recorded.** Expecting is a real answer and a strong
 * matching signal — a parent 30 weeks in and a parent with a newborn are the
 * pair the network is best at connecting — so it keeps its `children` row, its
 * `age_range` edge and its place on the review screen. What it does not get is
 * questions that presuppose a born child.
 *
 * One function for all three call sites (the attribution chips, the repeated
 * blocks, and the "same for all children" shortcut), because three copies of
 * this filter is three places for it to be forgotten — and the one that forgets
 * is the one a parent meets.
 */
/**
 * Is there a child this flow can ask about at all?
 *
 * `false` only once the ages screen has been answered and holds nothing but
 * `EXPECTING` — an empty `child_ages` is a parent who has not reached that
 * screen yet, and hiding half the flow from them is the same mistake inverted.
 */
export function hasBornChild(answers: ProfileAnswers): boolean {
  return answers.child_ages.length === 0 || answerableChildren(answers).length > 0;
}

/**
 * The **indexes** of the children this flow may ask about.
 *
 * ⚠⚠ **These are positions in `child_ages`, not ages, and that changed on 10
 * Sep.** The client asked for one Child record per child with duplicate birth
 * years allowed, which makes an age useless as an identity: two children born
 * in 2019 are two children, and a `child_of` map keyed by age could only ever
 * say "a 2019 child", never *which one*. The index is the only thing that
 * distinguishes them, which is why `cleanAges` no longer sorts.
 *
 * Expecting is filtered here and nowhere else, for the reason above.
 */
export function answerableChildren(answers: ProfileAnswers): number[] {
  return answers.child_ages
    .map((age, index) => ({ age, index }))
    .filter(({ age }) => age !== EXPECTING)
    .map(({ index }) => index);
}

/**
 * One chip per child, labelled by the birth year the parent tapped.
 *
 * ⚠ **Two children of the same year are disambiguated, and only then.** A pair
 * of chips both reading "2019" is a question a parent cannot answer, so the
 * label gains an ordinal — but only where a year really is shared, because
 * "2019 (1st)" on an only child is noise about a distinction that does not
 * exist. The id is the index either way, so nothing downstream depends on the
 * label being unique.
 */
export function childOptions(answers: ProfileAnswers): Option[] {
  const indexes = answerableChildren(answers);
  const years = indexes.map((i) => CURRENT_YEAR - answers.child_ages[i]);
  return indexes.map((index, n) => {
    const year = years[n];
    const shared = years.filter((y) => y === year).length > 1;
    const ordinal = years.slice(0, n).filter((y) => y === year).length + 1;
    return {
      id: String(index),
      label: shared ? `${year} (${ordinalWord(ordinal)})` : String(year),
    };
  });
}

/** 1 → "1st". Only ever reached for siblings sharing a birth year. */
function ordinalWord(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}

/**
 * The most answers a question can take: **one per child**, for the questions
 * whose answer belongs to a child rather than to the household.
 *
 * A school, a class or a camp is a thing *one* child does, so a two-child family
 * naming six schools has described a household again — which is the exact
 * ambiguity `perChild` was added to remove (13 Aug). The cap is what keeps the
 * "whose is it?" question under each selection answerable rather than a guess,
 * and it is why the chip lists stopped reading as "безліч".
 *
 * Undefined means no cap, which is every other question on the flow: parent
 * groups, logistics and the topic clusters take as many as genuinely apply.
 */
/**
 * The four questions that became searchable directories on 24 Aug, and the search
 * label the client wrote for each.
 *
 * Keyed on the *question*, not the category, because the same category can be
 * asked twice with different framing — and because the decision is about how many
 * records exist behind it, which is a property of the market data rather than of
 * the screen.
 *
 * A question not listed here keeps the plain chip list. That is deliberate for
 * neighborhoods, camps and parent groups: all three are short enough to read
 * whole, and none has a starter set curated, so a search box over them would
 * find only what is already on screen.
 */
const SEARCHABLE_QUESTIONS: Partial<
  Record<
    QuestionId,
    {
      category: MarketCategory;
      searchLabel: string;
      footnote?: string;
      /** See `SearchableChipGroup`'s own `wholeList`. */
      wholeList?: boolean;
      /**
       * Render as a searchable dropdown rather than as chips plus a search box.
       *
       * **Stated per question, never derived.** The first cut of this said
       * "a dropdown everywhere except `wholeList`" — a rule that decides by the
       * *absence* of another property, which quietly swept in "where have you
       * lived before?", a question the client never asked about and one that had
       * no option buttons to replace in the first place. A directory added here
       * tomorrow would have been swept in the same way, with nothing on screen
       * looking wrong.
       *
       * So the four the client named say so, and everything else keeps what it
       * has.
       */
      dropdown?: boolean;
    }
  >
> = {
  schools: {
    category: "schools",
    /**
     * ⚠ **No dropdown here**, and it is the client's own correction (8 Sep) —
     * *"на цій сторінці не потрібні були dropdown"*, pointing at this screen.
     *
     * Her original instruction named "local groups, schools, faith communities",
     * which read as three questions; they are two **screens**, and only one of
     * them is the circles page. Schools has its own, and it keeps the chips: the
     * starters are already trimmed to the parent's own area (eight per area, her
     * curation), so what is on offer is a short familiar list rather than the
     * wall of hundreds the dropdown was for — and on a per-child screen each
     * block would otherwise be a closed box a parent has to open before they can
     * see whether Pando knows their school at all.
     */
    searchLabel: "Search all schools, preschools and daycares",
    footnote: "It doesn’t have to be in your own city — plenty of families cross town for the right one.",
  },
  classes: {
    category: "baby_activities",
    dropdown: true,
    searchLabel: "Search all activities and classes",
    footnote: "It doesn’t have to be in your own city — plenty of families cross town for the right one.",
  },
  clubs: {
    category: "clubs",
    dropdown: true,
    searchLabel: "Search all private clubs and member organizations",
    /* ⚠ No footnote: the client, 10 Sep — *"(repeated three times on one
       screen) … show once, under the first field only."* Three of the four
       questions on the circles screen carried it, so a parent read the same
       sentence three times on one page. `classes` is the first field there and
       keeps it; schools is a screen of its own and keeps its own. */
  },
  faith: {
    category: "worship",
    dropdown: true,
    searchLabel: "Search all faith communities and places of worship",
    /* No footnote — see `clubs` above. */
  },
  neighborhood: {
    category: "neighborhoods",
    /**
     * Item 5's autopopulate, in her words: *"we need a field for other, where
     * they can type and it should autopopulate with other towns/neighborhoods."*
     *
     * Her seventeen cities are the taps; this reaches the rest — Pasadena's own
     * neighbourhoods and the towns families cross into. Same mechanism as the
     * schools, so the free-text sheet is no longer the only way out of a fixed
     * list.
     */
    searchLabel: "Can’t find yours? Search for a town or neighborhood.",
    /**
     * **All seventeen of her cities are taps, always.**
     *
     * They are her approved list (item 5 of 24 Aug, reaffirmed on 1 Sep) and
     * they are meant to be read whole — seventeen chips is a screen, not a
     * wall. The area logic that trims the other four directories cannot apply
     * to the question that *sets* the area, and applying it anyway is what hid
     * five cities and then shrank the list on selection. See `wholeList`.
     */
    wholeList: true,
  },
  previous_places: {
    category: "previous_places",
    /* Her label, and it is doing real work: it says what a valid answer looks
       like (a city, a state, a country) for a field with no chips above it to
       demonstrate the shape. */
    searchLabel: "Add a city, state or country",
  },
};

/**
 * The parent's own named connections, as options they can grant one by one.
 *
 * Privacy Guidance §A: "Permission must be available separately for each
 * affiliation. A parent may share their school but keep their golf club or faith
 * community private."
 *
 * ## Which connections, and which deliberately not
 *
 * The five questions that produce a *named, shared place or group* — schools,
 * classes, camps, clubs, faith communities. Her own copy on the privacy screen
 * names the same set: "each school, club, faith community or other connection".
 *
 * **Neighborhood and child age are excluded on purpose.** Both are affinities and
 * neither is a connection a sentence can name without narrowing the recommender:
 * §F forbids exactly that combination — "A parent from the Oak Grove neighborhood
 * who belongs to Valley Hunt recommends this" is the example she rules out. A
 * neighborhood mention would also be a different product decision, not a finer
 * grain of this one.
 *
 * The id is prefixed with the question it came from, because two different kinds
 * of connection can share a slug and the grant has to name exactly one edge.
 */
const AFFILIATION_QUESTIONS: QuestionId[] = [
  "schools",
  "classes",
  "camps",
  "clubs",
  "faith",
];

/** The heading each group sits under, in the parent's own terms. */
const AFFILIATION_SECTION: Partial<Record<QuestionId, string>> = {
  schools: "Schools & preschools",
  classes: "Classes & activities",
  camps: "Camps",
  clubs: "Clubs & leagues",
  faith: "Faith communities",
};

export function affiliationOptions(
  market: MarketId,
  answers: ProfileAnswers,
): Option[] {
  const out: Option[] = [];

  for (const screen of SCREENS) {
    for (const question of screen.questions) {
      if (!AFFILIATION_QUESTIONS.includes(question.id)) continue;
      /* ⚠ The first of the three layers behind the 10 Sep rule: a connection
         that may never be named is not offered as something to name. With the
         nameable set empty this returns nothing at all, so
         `connection_visibility` has no answers left and does not render —
         which is why that screen being in `ASK_LATER` is belt rather than
         braces. See `mayBeNamed`. */
      if (!producesAffiliation(question.id)) continue;

      const chosen = selectionsFor(question, answers);
      for (const optionId of chosen) {
        out.push({
          id: `${question.id}:${optionId}`,
          label: labelForOption(question, market, answers, optionId),
          section: AFFILIATION_SECTION[question.id],
          /* Long names — "All Souls World Language Catholic School" — and this
             screen is a list of decisions rather than a grid of taps. */
          wide: true,
        });
      }

      /**
       * **Typed connections are deliberately not offered here.**
       *
       * The first cut listed them, and two things were wrong with it. A typed
       * answer is unmatchable until an admin promotes it (invariant 9), so there
       * is nothing for the permission to act on — the toggle would be a decision
       * with no effect, which is the kind of control this codebase keeps deleting
       * elsewhere. And the grant is keyed on `affiliation_value` so it names one
       * edge in the graph; free text has no edge, so the row could never be
       * joined to anything.
       *
       * The parent is not losing the choice, only its timing: once an admin
       * promotes the answer it becomes a canonical connection like any other, and
       * the standing default applies — private until they say otherwise.
       */
    }
  }

  return out;
}

export function searchableCategory(
  question: Question,
): {
  category: MarketCategory;
  searchLabel: string;
  footnote?: string;
  wholeList?: boolean;
  dropdown?: boolean;
} | null {
  /* Only a market-sourced question can be searched — a static list has nothing
     behind it to find. */
  if (question.source.type !== "market") return null;
  return SEARCHABLE_QUESTIONS[question.id] ?? null;
}

/**
 * Drop saved selections the question no longer allows.
 *
 * 1 Sep's second universal comment ends with an instruction nothing in the app
 * could carry out: *"Clear or migrate any saved test data that already violates
 * these limits."* Her own report is what it looks like from the outside — a page
 * that says "Up to 3" showing four chips lit, and one that says "Choose up to
 * three" showing five. The caps were right in the code and the **stored session
 * predated them**, and `normaliseAnswers` only ever checked a value's *shape*,
 * never whether the option still existed or whether there were too many. Same
 * gap that let an out-of-range child age survive every reload (27 Aug).
 *
 * Two rules, and the second is the one that keeps this safe.
 *
 * **Static questions only.** A market-sourced answer is checked against a table
 * that arrives over the network *after* the session loads, so pruning those on
 * load would delete a parent's real school every time the fetch was slow. Every
 * question the client named is static.
 *
 * **A retired option keeps its answer.** `RETIRED_OPTIONS` is consulted as well
 * as the live list: a chip that went because item 17 *split* it recorded
 * something the parent meant, and deleting that is not tidying up — it is
 * discarding an answer because we changed our minds about the wording.
 */
export function pruneAnswers(answers: ProfileAnswers): ProfileAnswers {
  const next: ProfileAnswers = { ...answers };
  let changed = false;

  /**
   * ⚠ **`ALL_SCREENS`, not `SCREENS`** (10 Sep), and this is the one place that
   * distinction runs the other way.
   *
   * Everything else here walks the flow, because the flow is what a parent
   * sees. Pruning is not about what is on screen: it is stored-state hygiene —
   * dropping an option a question no longer offers, and trimming a selection
   * that predates its cap. A saved answer to a question the flow has stopped
   * asking is exactly the answer most likely to be stale, and walking `SCREENS`
   * would leave it unpruned until the day that screen returns, at which point
   * the parent meets the over-cap state the client reported on 1 Sep.
   */
  for (const screen of ALL_SCREENS) {
    for (const question of screen.questions) {
      if (question.source.type !== "static") continue;
      /* ⚠ The children are numbers, and everything below this line writes back
         `string[]`. It has never fired for them — every birth year is an
         allowed option, so `kept.length` always matched — but a stored answer
         out of range would have put strings into `child_ages`, where
         `childrenFromAges` would read `NaN` as a birth year. `cleanAges` and
         `normaliseAnswers` both police this question already. */
      if (question.kind === "ages") continue;

      const allowed = new Set([
        ...question.source.options.map((o) => o.id),
        ...(RETIRED_OPTIONS[question.id] ?? []).map((o) => o.id),
      ]);

      const current = selectionsFor(question, answers);
      let kept = current.filter((id) => allowed.has(id));

      /* The cap, applied to what is left. Truncating from the end keeps the
         earliest choices, which are the ones the parent made deliberately
         before the screen stopped refusing taps. */
      const max = maxSelectionsFor(question, answers);
      if (max !== undefined && kept.length > max) kept = kept.slice(0, max);

      if (kept.length === current.length) continue;
      changed = true;

      /* Single-answer questions are stored as a scalar, so they cannot be
         written back through the array path. */
      if (question.kind === "single") {
        (next as unknown as Record<string, unknown>)[question.id] =
          kept[0] ?? null;
      } else {
        (next as unknown as Record<string, string[]>)[question.id] = kept;
      }
    }
  }

  return changed ? next : answers;
}

export function maxSelectionsFor(
  question: Question,
  answers: ProfileAnswers,
): number | undefined {
  /* A flat ceiling, for a question that is a ranking instruction: three trust
     circles, three practical priorities (24 Aug). Checked first because it does
     not depend on the family — and a question could in principle carry both, in
     which case the tighter one has to win. */
  if (question.maxSelections !== undefined && !question.perChild) {
    return question.maxSelections;
  }
  if (!question.perChild) return question.maxSelections;
  /**
   * **A per-child question has no ceiling unless it asks for one** (1 Sep).
   *
   * This default was 1, and that is where the screens' "One per child" came
   * from — which items 5 and 10 both struck out, item 10 for the reason that
   * matters: it *"directly contradicts 'Select all that apply'"*. A child can
   * do gymnastics and swimming, and can have preschool in the morning and a
   * sitter after. Only a school is genuinely one-ish per child, and that
   * question says so with `perChildLimit: 2`.
   *
   * Inverting the default rather than adding an opt-out is deliberate: the
   * previous shape meant a new per-child question silently arrived capped at
   * one, and nothing on screen would have looked wrong.
   */
  if (question.perChildLimit === undefined) return question.maxSelections;
  /* 3 Sep: a child on the way is not a child this question can be answered
     for, so it must not raise the ceiling either — otherwise a family with one
     born child and one expecting could name two schools, and only one child
     could be at either of them. */
  const children = answerableChildren(answers).length;
  /* No cap before P4 is answered. It is required, so this is the corrupted-session
     case — and a screen that refuses every tap is worse than an uncapped one. */
  if (children === 0) return undefined;
  const perChild = children * question.perChildLimit;
  return question.maxSelections !== undefined
    ? Math.min(perChild, question.maxSelections)
    : perChild;
}

/**
 * What the screen says once that ceiling is reached — and nothing before it.
 *
 * It lives here rather than in the component because the number and the sentence
 * explaining it come from the same rule: a hint that said "one each" while the
 * cap allowed two would be worse than no hint at all.
 */
export function maxSelectionHint(
  question: Question,
  answers: ProfileAnswers,
): string | undefined {
  const max = maxSelectionsFor(question, answers);
  if (max === undefined) return undefined;

  /* A flat cap has nothing to do with how many children there are, so it gets
     its own sentence — "one for each of your 2 kids" beside a cap of three
     would be describing a different rule. */
  if (!question.perChild) {
    return `Up to ${max}. Tap one off to choose a different one.`;
  }

  const kids = new Set(answers.child_ages).size;
  /* Only reachable when the question set one — `maxSelectionsFor` returns
     undefined otherwise, and this function has already returned. */
  const each = question.perChildLimit ?? 1;

  return kids === 1
    ? `Up to ${each} for your child — current and former both count. Tap one off to swap.`
    : `Up to ${each} each for your ${kids} kids — current and former both count. Tap one off to swap.`;
}

/**
 * Whose this answer is, as ages. Falls back to the whole family when a parent
 * skipped the question — an unattributed school still belongs to *someone* in
 * this household, and a single-child family is never asked at all.
 */
export function childrenFor(
  question: Question,
  answers: ProfileAnswers,
  optionId: string,
): number[] {
  if (!question.perChild) return [];
  /**
   * ⚠⚠ **Indexes, not ages** (10 Sep), and this function was the last place
   * still returning ages — three layers below the change that needed it.
   *
   * `child_of` became a map of **positions** when duplicate birth years were
   * allowed, because an age names a year and can no longer name a child. This
   * still built a set of unique *ages* and filtered the picked positions
   * against it, so with two children aged 3 and 6 the school attributed to
   * position 1 was tested as `[3,6].includes(1)` — false — and **every
   * per-child attribution in a multi-child family was silently dropped**. The
   * screen showed the tap, the session stored it, the route cleaned it, and it
   * died here.
   *
   * ⚠ The one-child shortcut is on the **count of children**, not on the count
   * of distinct years. `[3, 3]` is one year and two children: on `unique` it
   * took the shortcut and attributed everything to a single child who does not
   * exist as a position.
   *
   * Expecting children are excluded throughout (`answerableChildren`), because
   * a school cannot belong to a child who is not born.
   */
  const born = answerableChildren(answers);
  if (born.length === 0) return [];
  if (born.length === 1) return born;
  const picked = answers.child_of?.[question.id]?.[optionId] ?? [];
  return picked.filter((index) => born.includes(index));
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
  if (found) return found.label;
  /* A retired option keeps its words. The review screen and the admin both read
     stored answers back, and printing `postpartum_first_year` at a parent who
     answered honestly before the list was split would be the raw-slug failure
     that `registerFoundOptions` exists to prevent for searched records. */
  const retired = (RETIRED_OPTIONS[question.id] ?? []).find(
    (o) => o.id === optionId,
  );
  return retired?.label ?? optionId;
}

export function statusLabel(statusId: string): string {
  return SCHOOL_STATUS.find((s) => s.id === statusId)?.label ?? statusId;
}

/**
 * Every label the questionnaire's own static lists hold, keyed by the id that
 * gets stored — so a surface reading a stored answer back can render the words
 * the parent actually saw.
 *
 * It exists for the admin. `life_relevance.value` and the derived affinities are
 * raw ids, and the generic slug formatter is lossy on exactly the ones a person
 * reads most: `3_10_years` came out as "3 10 Years", `free_low_cost` as "Free
 * Low Cost". Market-sourced values (schools, neighborhoods, classes) are
 * deliberately absent — they are slugs of their own labels, so slugging them
 * back is lossless, and pulling the market list in here would make this file
 * depend on runtime data it has no business knowing about.
 *
 * Ids are unique across these lists today. Where two ever collide, the first
 * list wins, which is why the order below runs from the most specific
 * (multi-word bands) to the most generic.
 */
const PROFILE_VALUE_LABELS: Record<string, string> = Object.fromEntries(
  [
    TIME_IN_AREA,
    MOVED_FROM,
    COST_PREFERENCE,
    TRAVEL_TIME,
    PRACTICAL_PRIORITIES,
    PARENTING_SETUP,
    WORK_SETUP,
    CHILDCARE_REGULAR,
    CHILDCARE_BACKUP,
    TRUST_CIRCLES,
    TOPICS_LOCAL,
    TOPICS_LIVED,
    ATTRIBUTION,
    SHARED_CONNECTIONS,
    SCHOOL_STATUS,
  ]
    .flat()
    .map((o) => [o.id, o.label] as const)
    .reverse(),
);

/** The label for a stored profile answer, or null when it isn't one of ours. */
export function profileValueLabel(value: string): string | null {
  return PROFILE_VALUE_LABELS[value] ?? null;
}

/**
 * The definition of one question, by id.
 *
 * ⚠⚠ **`ALL_SCREENS`, and this threw a 500 on a real profile write for the
 * hours it did not** (10 Sep). It searched `SCREENS`, so the moment seven
 * screens moved behind `ASK_LATER` this function started throwing for
 * `budget`, `logistics`, `trust_circles` and `time_in_area` — and
 * `deriveLifeRelevance` calls it by id for every dimension it knows about,
 * unconditionally. The result was `Error: Unknown question: budget` out of
 * `POST /api/seed/profile`, i.e. **the entire profile refused**, for any parent
 * whose device still held one of those answers from the older build. Which is
 * every parent mid-flow on the day this deploys.
 *
 * The rule it got wrong is worth stating, because it is the same one three
 * other call sites had to learn this week: **a stored answer outlives the
 * screen that asked for it.** Anything reading an answer back — deriving from
 * it, labelling it, pruning it — has to resolve against every question this
 * questionnaire has ever defined. Only the things that decide what a parent
 * *sees* may read `SCREENS`.
 *
 * It still throws on an id that does not exist anywhere, which is a programming
 * error rather than a stale answer: `QuestionId` is a closed union, so reaching
 * it means the union and the data disagree.
 */
export function questionById(id: QuestionId): Question {
  for (const screen of ALL_SCREENS) {
    const q = screen.questions.find((x) => x.id === id);
    if (q) return q;
  }
  /* Last, and only after every live screen: a retired question must never
     shadow a live one that reuses its id. */
  const retired = RETIRED_QUESTIONS.find((x) => x.id === id);
  if (retired) return retired;
  throw new Error(`Unknown question: ${id}`);
}

/**
 * Add one child, in the order the parent added them.
 *
 * The client's model, 10 Sep: *"Create one Child record per child. Add 'Add
 * another child.' Require birth year; make month optional; allow duplicate
 * birth years."* Appending is the whole of it — a repeat is a repeat, and the
 * index it lands on is that child's identity from here on.
 */
export function addChildAt(answers: ProfileAnswers, age: number): ProfileAnswers {
  if (answers.child_ages.length >= MAX_CHILDREN) return answers;
  return { ...answers, child_ages: [...answers.child_ages, age] };
}

/** The ceiling `cleanAges` enforces on the server, stated once for the UI too. */
export const MAX_CHILDREN = 12;

/**
 * Remove one child, and move every reference to the children after them.
 *
 * ⚠⚠ **The re-keying is the entire point of this function, and dropping it is
 * the silent bug.** A child's index is their identity: `child_months` keys a
 * birth month by it and `child_of` attributes a school, class or care
 * arrangement by it. Splicing the array without moving those maps would leave a
 * two-child family whose eldest was removed with the younger child's school
 * filed against the *older* one — no error, no empty answer, just a fact about
 * the wrong sibling. It is invisible on the review screen, because both
 * children are real and both rows read plausibly.
 *
 * A reference **to** the removed child is dropped rather than reassigned: an
 * answer that belonged to nobody is not an answer, which is the same rule
 * `applyChildSelections` follows when the last owner of an option is untapped.
 */
export function removeChildAt(answers: ProfileAnswers, index: number): ProfileAnswers {
  if (index < 0 || index >= answers.child_ages.length) return answers;

  const shift = (i: number) => (i > index ? i - 1 : i);

  const months: Record<string, number> = {};
  for (const [key, month] of Object.entries(answers.child_months)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i === index) continue;
    months[String(shift(i))] = month;
  }

  const childOf: ProfileAnswers["child_of"] = {};
  for (const [questionId, perOption] of Object.entries(answers.child_of)) {
    const cleaned: Record<string, number[]> = {};
    for (const [optionId, owners] of Object.entries(perOption ?? {})) {
      const kept = owners.filter((i) => i !== index).map(shift);
      if (kept.length > 0) cleaned[optionId] = kept;
    }
    if (Object.keys(cleaned).length > 0) {
      childOf[questionId as QuestionId] = cleaned;
    }
  }

  return {
    ...answers,
    child_ages: answers.child_ages.filter((_, i) => i !== index),
    child_months: months,
    child_of: childOf,
  };
}
