import {
  AFFILIATION_CONSENT_CAVEAT,
  AFFILIATION_CONSENT_TEXT,
} from "./consent";
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
  neighborhood: null,
  child_ages: [],
  schools: [],
  school_status: {},
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
  topics_lived: [],
  /** P13. Null until they choose; nothing is shown until they do. */
  attribution: null,
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

/** P5. Each school the parent taps gets one of these. */
const SCHOOL_STATUS: Option[] = [
  { id: "current", label: "Current" },
  { id: "former", label: "Former" },
  { id: "not_yet", label: "Not yet" },
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
    hint: "“A local parent recommends this.”",
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
    hint: "“A parent at your golf club recommends this.” Only parents who share that connection see it.",
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
const ALLOWANCE: Option[] = [
  {
    id: "5",
    label: "Community member · required minimum",
    hint: "About once a week — up to 5 questions a month",
    wide: true,
  },
  {
    id: "10",
    /**
     * 1 Sep, item 18: *"Highlight Active Contributor as **Recommended**. Do not
     * call it 'Most popular' without supporting usage data."*
     *
     * The hint carries her reciprocity argument rather than a nudge: the reason
     * to help more is that Pando can then ask the community for *you* more
     * often. Note what it must not say — access to what Pando already knows is
     * never restricted by this choice ("Do not restrict access to useful
     * information Pando already has"), so the benefit is worded as new outreach
     * and nothing else.
     */
    label: "Active contributor · recommended",
    hint: "Happy to help more — up to 10 a month. Pando can ask the community for a fresh answer for you more often.",
    wide: true,
  },
  {
    id: "as_relevant",
    label: "Open contributor",
    hint: "Ask me whenever it’s genuinely relevant — never more than one question every 48 hours. Pando can ask the community for you most often.",
    wide: true,
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

export const SCREENS: Screen[] = [
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
    /* The helper here said "The strongest matching signal there is. Former
       counts: a parent who's been through admissions is exactly who someone
       needs." Removed on the client's instruction (24 Aug, item 6) — it explained
       our matching to a parent who has not asked, and "the strongest signal"
       reads as pressure to answer a question that is optional. Her own screen
       title for this is below; "or has attended" is what still invites a former
       school, without the sales pitch. */
    title: "Where does your child go to school, preschool or daycare?",
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
    /* Item 5: her instruction for the activities section, and the three sections
       stay on one scrollable page — *"Do not split this into additional pages
       for now. Keeping the three sections on one scrollable page is acceptable
       and avoids extra work."* */
    help: "Select all recurring activities that apply. Every one of these is optional.",
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
    statement: {
      body: [
        "Pando uses your connections and context to find parents whose experience fits your family. You decide whether each school, club, faith community or other connection stays private or can be shown with your recommendations.",
        "If you choose to share it, another parent with the same connection may see:",
      ],
      examples: [
        "“A parent at your golf club recommends this.”",
        "“Three parents at your golf club recommend this.”",
      ],
      /* Item 6's restored sentence. After the examples, because it is the answer
         to the question they raise. */
      bodyAfter: [
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
    eyebrow: "Life context",
    title: "How long have you lived in the Pasadena area?",
    help: "Your local experience helps Pando tailor answers and find the right parents to ask.",
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
    id: "family_structure",
    eyebrow: "Life context",
    title: "Your parenting setup",
    help: "This helps Pando find parents who understand your family’s day-to-day. Select all that apply.",
    questions: [
      {
        id: "family_structure",
        label: "Family",
        kind: "multi",
        source: { type: "static", options: PARENTING_SETUP },
        relevance: "family_setup",
        /* "Something else" is an option in her list now, so the free-text
           fallback is what it opens rather than a second route to the same
           idea. */
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
      },
    ],
  },
  {
    /* Item 12, second screen. Same `family_setup` dimension as the one above —
       the split is about what a parent is asked, not about how it is stored, so
       nothing downstream and no migration. */
    id: "work_setup",
    eyebrow: "Life context",
    title: "Your family’s work setup",
    help: "This helps Pando tailor answers to your schedule and logistics. Select all that apply.",
    questions: [
      {
        id: "work_setup",
        label: "Work",
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
    id: "childcare_now",
    eyebrow: "Life context",
    title: "Your child’s current care",
    /* Item 10, her wording. The old line ended "Select all that apply" while
       the cap hint underneath said "One per child" — two instructions that
       contradicted each other on one screen. */
    help: "Select all regular care arrangements that apply.",
    questions: [
      {
        id: "childcare_now",
        label: "Regular care",
        kind: "multi",
        source: { type: "static", options: CHILDCARE_REGULAR },
        relevance: "childcare",
        perChild: true,
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
      },
    ],
  },
  {
    /* Item 13, second screen. Asked once, at household level: a grandmother who
       can come over covers every child, so attributing it per child would be
       inventing a distinction the parent did not make. */
    id: "childcare_backup",
    eyebrow: "Life context",
    title: "Your backup childcare",
    /* Item 11 adds the instruction; the question keeps its own framing. */
    help: "What can you usually rely on when regular childcare falls through? Select everything you can usually rely on.",
    questions: [
      {
        id: "childcare_backup",
        label: "Backup",
        kind: "multi",
        source: { type: "static", options: CHILDCARE_BACKUP },
        relevance: "childcare",
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
      },
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
    id: "budget",
    /* Her point, and it is a real one: this is a recommendation *preference*, not
       life context. "Which describes you?" also made a spending preference sound
       like a personal identity, which is why the title is now about Pando's
       behaviour rather than about the parent. */
    eyebrow: "Preferences",
    /* Item 13, verbatim: *"‘How should Pando weigh cost?’ / ‘Pando weigh’
       sounds weird."* Hers reads as a question a person would ask. */
    title: "How would you like Pando to consider price?",
    help: "Choose one — what usually works best for you. You can change this for any specific question.",
    questions: [
      {
        id: "budget",
        label: "Cost preference",
        /* Single, not multi — see COST_PREFERENCE. A default instruction cannot
           be five simultaneous answers. */
        kind: "single",
        source: { type: "static", options: COST_PREFERENCE },
        relevance: "budget",
      },
    ],
  },
  {
    id: "trust_circles",
    eyebrow: "Trust",
    /**
     * Item 16, and the help text is the correction. The old line said Pando
     * weighs these *first*, which was wrong and was the client's main objection:
     * relevant, firsthand, recent-enough experience always comes first, and these
     * only choose between parents who are already relevant.
     */
    title: "What should Pando prioritize?",
    help: "Relevant firsthand experience always comes first. Choose up to three other things that matter to you — three at most.",
    questions: [
      {
        id: "trust_circles",
        label: "Trust circles",
        kind: "multi",
        source: { type: "static", options: TRUST_CIRCLES },
        maxSelections: 3,
        relevance: "trust_circle",
      },
    ],
  },
  {
    /**
     * Item 17, first of two. The client's judgement was that one screen holding
     * both clusters is too dense, and that two screens probably do not cost time
     * because each is clearer — so they are split.
     *
     * They are also two different **routing** categories, which is the reason
     * that outlives the density argument: local knowledge and lived parenting
     * experience are asked for differently, and the opt-out has to be per
     * category. Declining local questions must not silently decline the
     * emotional ones.
     */
    id: "topics",
    eyebrow: "What you know",
    title: "What local questions could you help with?",
    help: "Choose anything you have firsthand experience with. You’ll always decide whether to answer.",
    questions: [
      {
        id: "topics",
        kind: "multi",
        source: { type: "static", options: TOPICS_LOCAL },
      },
    ],
    /**
     * 1 Sep, item 15 — the two rules this screen has to make true.
     *
     * *"Skipping must not opt the parent into any topic"* is already how the
     * screen works: nothing is preselected and the answer starts empty, so
     * Continue grants nothing. It is stated here because it is a promise rather
     * than an accident of the default.
     *
     * The second is the one with teeth: selecting *"Pediatricians and
     * children's health providers"* permits **firsthand provider
     * recommendations only — not medical advice.** That is a Phase 2 routing
     * constraint, and it is the same line `classifyDemand` already draws
     * between a recommendation and a health question.
     */
    footnote:
      "Choosing a topic means Pando may occasionally ask you about your own experience with it. Health topics mean provider recommendations only — never medical advice.",
  },
  {
    /* Item 17, second of two. "Comfortable sharing" rather than "could help
       with": this list is about experience a parent lived, and the wording should
       not imply they are offering advice. */
    id: "topics_lived",
    eyebrow: "What you know",
    title: "Which parenting experiences would you be comfortable sharing?",
    /* Item 17's own words. */
    help: "Choose any topics where your firsthand experience could help. You’ll always decide whether to answer.",
    questions: [
      {
        id: "topics_lived",
        kind: "multi",
        source: { type: "static", options: TOPICS_LIVED },
        /* Item 17: *"Add 'Something else' for relevant experiences Pando has
           not anticipated."* The typed route, not a chip — the universal
           comment applies here too. */
        allowOther: true,
        otherLabel: SOMETHING_ELSE,
        /**
         * Item 17: *"Remove Skip, because it duplicates the explicit opt-out.
         * Continue should activate once the parent selects at least one topic
         * or chooses the opt-out."*
         *
         * `required` is exactly that, because the opt-out chip **is** an
         * answer: choosing it satisfies this, so there is no third way past the
         * screen that leaves Pando guessing what the silence meant.
         */
        required: true,
      },
    ],
    /**
     * **This footnote is the listening-ear consent.** Her words, verbatim, and
     * the reason the separate page below it is gone:
     *
     * > "This page is unnecessary if the Parenting Experiences page already acts
     * > as the topic-level opt-in. Add the following directly beneath the
     * > topics…"
     *
     * Three constraints ride with it, and none is visible on screen. *Only
     * route questions within topics the parent explicitly selected* — opting
     * into one sensitive topic is not blanket permission for every sensitive
     * question. *Never infer* pregnancy loss, fertility treatment,
     * mental-health history, relationship problems or disability from anything
     * else in the profile. And *urgent* medical issues, self-harm, abuse,
     * immediate safety concerns and legal emergencies are **never** routed as
     * peer questions — that is `classifyDemand`'s high-stakes branch, which
     * answers with professional resources instead.
     *
     * Note the word she chose: names are **not shared**, and the exchange is
     * never called anonymous, because Pando knows exactly who both parents are.
     */
    footnote:
      "Selecting a topic means Pando may occasionally ask you a relevant question about it. Your name will not be shared with the parent asking, and you can decline any request or change your choices later.",
  },
  {
    /* "Ordinary recommendations" meant nothing to a parent — her word. The
       question is what credit they get, so that is what the title asks. */
    id: "attribution",
    eyebrow: "Privacy",
    title: "How should Pando credit your recommendations?",
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
    /* Nothing to decide if they named no connections at all. */
    when: (answers) =>
      answers.shared_connections === "share_connection" &&
      answers.schools.length +
        answers.classes.length +
        answers.camps.length +
        answers.clubs.length +
        answers.faith.length >
        0,
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
      note: "You can always skip a question. The next screen sets your own limit — and it is the last one.",
    },
    questions: [],
  },
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
    help: "To join and use Pando, choose a participation level. Community member — up to five relevant questions a month — is the minimum. Every question is optional, and you’ll never receive more than one request within 48 hours.",
    questions: [
      {
        id: "allowance",
        label: "Choose one",
        kind: "single",
        source: { type: "static", options: ALLOWANCE },
        required: true,
      },
    ],
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
  schools: [
    /* Her list. A homeschooling family had nothing to select: "Homeschool"
       existed only as a per-school *status*, which cannot apply to a school they
       do not attend. */
    { id: "homeschool", label: "Homeschool", exclusive: true, wide: true },
    {
      id: "not_in_school_yet",
      label: "Not in school or daycare yet",
      exclusive: true,
      wide: true,
    },
  ],
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
  /* Appended rather than merged into the directory, so they sit at the end of the
     list where a refusal belongs — and so an importer can never introduce or
     remove one. */
  const special = SPECIAL_OPTIONS[question.id];
  return special ? [...base, ...special] : base;
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
export function childOptions(answers: ProfileAnswers): Option[] {
  return [...new Set(answers.child_ages)]
    .sort((a, b) => a - b)
    .map((age) => ({
      id: String(age),
      label: age === EXPECTING ? "Expecting" : String(CURRENT_YEAR - age),
    }));
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
    }
  >
> = {
  schools: {
    category: "schools",
    searchLabel: "Search all schools, preschools and daycares",
    footnote: "It doesn’t have to be in your own city — plenty of families cross town for the right one.",
  },
  classes: {
    category: "baby_activities",
    searchLabel: "Search all activities and classes",
    footnote: "It doesn’t have to be in your own city — plenty of families cross town for the right one.",
  },
  clubs: {
    category: "clubs",
    searchLabel: "Search all private clubs and member organizations",
    footnote: "It doesn’t have to be in your own city — plenty of families cross town for the right one.",
  },
  faith: {
    category: "worship",
    searchLabel: "Search all faith communities and places of worship",
    footnote: "It doesn’t have to be in your own city — plenty of families cross town for the right one.",
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

  for (const screen of SCREENS) {
    for (const question of screen.questions) {
      if (question.source.type !== "static") continue;

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
  const children = new Set(answers.child_ages).size;
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
  const unique = [...new Set(answers.child_ages)];
  if (unique.length <= 1) return unique;
  const picked = answers.child_of?.[question.id]?.[optionId] ?? [];
  return picked.filter((age) => unique.includes(age));
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

export function questionById(id: QuestionId): Question {
  for (const screen of SCREENS) {
    const q = screen.questions.find((x) => x.id === id);
    if (q) return q;
  }
  throw new Error(`Unknown question: ${id}`);
}
