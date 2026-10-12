import { marketOptions } from "../market-options";
import {
  CAREGIVER_AGE_BANDS,
  CAREGIVER_FIT,
  CAREGIVER_HOURS,
  CAREGIVER_PAY_BANDS as PAY_BANDS,
  CAREGIVER_SCHEDULE,
  CAREGIVER_TYPES,
  CAREGIVER_WEEKDAYS,
  PARENT_STRENGTHS,
  wantsWeekdays,
} from "@/lib/caregiver-options";
import type { MarketId, Option } from "../types";
import type { Fields, Script, ShareKind, Step, Subcategory } from "./types";

/**
 * The capture conversations.
 *
 * Activity questions follow spec §3.4 exactly; caregiver questions follow §3.5,
 * including the 18-or-older gate and the fact that a nomination stays pending and
 * inactive until the caregiver personally consents. "Place" and "tip" are the two
 * lighter share types from the estimate's menu.
 *
 * The AI side of these cards — extraction and confidence scoring (estimate 1.8) —
 * runs server-side in `lib/server/extract.ts`, after the save response. What lives
 * here is the structured capture: every answer already arrives as a field.
 */

/**
 * R8's price band, exported (not just used inline below) so admin display can
 * render the real label instead of guessing one from the id. `50_100`'s
 * underscore stands in for a dash — a generic id-to-label formatter turns it
 * into "50 100", which is where the admin's price column bug came from.
 */
export const PRICE_BAND: Option[] = [
  { id: "free", label: "Free" },
  { id: "under_25", label: "Under $25" },
  { id: "25_50", label: "$25–50" },
  { id: "50_100", label: "$50–100" },
  { id: "100_200", label: "$100–200" },
  { id: "over_200", label: "Over $200" },
  { id: "prefer_not_to_say", label: "Prefer not to say" },
];

/**
 * R8's unit for the band above — exported for the same reason.
 *
 * Every unit a stored row can carry, because the admin reads and edits old rows
 * as well as new ones. Which of them a card *offers* is its own list: the
 * activity card offers the last three (`ACTIVITY_PRICE_UNIT`, 8 Oct).
 */
export const PRICE_UNIT: Option[] = [
  { id: "per_class", label: "Class" },
  { id: "per_session", label: "Session" },
  { id: "per_month", label: "Month" },
  { id: "per_term", label: "Term" },
  { id: "per_camp_week", label: "Camp week" },
  { id: "per_day", label: "Day" },
  { id: "per_week", label: "Week" },
  { id: "per_season", label: "Season" },
  /* 9 Oct — a school's tuition. */
  { id: "per_year", label: "Year" },
];

/**
 * "Roughly what did you pay, and per day, week or season?" — the activity
 * card's whole unit list (8 Oct, the client). The older five stay in
 * `PRICE_UNIT`: a card saved before today carries one of them, and the admin
 * has to read it.
 */
export const ACTIVITY_PRICE_UNIT: Option[] = PRICE_UNIT.filter((o) =>
  ["per_day", "per_week", "per_season"].includes(o.id),
);

/**
 * The activity card's three closed answers, exported (5 Oct) for the same reason:
 * the admin edits a contribution's every field, and offers exactly the choices
 * the parent was offered rather than a second list of them.
 */
export const LAST_THERE: Option[] = [
  { id: "current", label: "Still doing it" },
  { id: "recent", label: "Within the last year" },
  { id: "over_year", label: "Over a year ago" },
  { id: "unsure", label: "Not sure anymore" },
];

/**
 * "When did you last go?" on a **place** (8 Oct, the client): the activity
 * list's ids with her own first answer, which a place needs and a class does
 * not — a park is not something a child is still "doing". `within_6m` is a new
 * id and nothing reads `last_there` by value except the stale-at-capture flag,
 * which looks only for `over_year`, so it needs no migration and no CHECK
 * (there is none on that column).
 */
export const PLACE_LAST_GONE: Option[] = [
  { id: "within_6m", label: "Within the last 6 months" },
  { id: "recent", label: "Within the last year" },
  { id: "over_year", label: "Over a year ago" },
  { id: "unsure", label: "Not sure" },
];

export const RECOMMENDATION_OPTIONS: Option[] = [
  { id: "yes", label: "Yes" },
  { id: "yes_with_caveats", label: "Yes, with caveats" },
  { id: "probably_not", label: "Probably not" },
  { id: "no", label: "No" },
];

export const HOW_MUCH: Option[] = [
  { id: "tried_once", label: "Tried it once" },
  { id: "few_sessions", label: "A few sessions" },
  { id: "a_term", label: "A term or season" },
  { id: "a_year_plus", label: "A year or more" },
  { id: "weekly_ongoing", label: "Weekly, ongoing" },
];

/* ── The doctor card's closed answers (8 Oct, the client's list) ───────────────── */

/** "What did you see them for?" — `share_contributions.visit_reason`. */
export const VISIT_REASON: Option[] = [
  { id: "routine", label: "Routine care" },
  { id: "illness", label: "Illness" },
  { id: "ongoing", label: "Ongoing issue" },
  { id: "specialist", label: "Specialist concern" },
  { id: "other", label: "Other" },
];

/**
 * "Are you still seeing them?" — the activity card's `last_there` ids under a
 * doctor's words, so the column, the freshness reading and the quality rule
 * need nothing new. The activity list's fourth answer, "Not sure anymore", is
 * not on her list and is not offered.
 */
export const DOCTOR_LAST_SEEN: Option[] = [
  { id: "current", label: "Still seeing them" },
  { id: "recent", label: "Within the last year" },
  { id: "over_year", label: "Over a year ago" },
];

/** "How easy is it to get an appointment?" — `share_contributions.appointment_ease`. */
export const APPOINTMENT_EASE: Option[] = [
  { id: "easy", label: "Easy" },
  { id: "manageable", label: "Usually manageable" },
  { id: "difficult", label: "Difficult" },
  { id: "not_sure", label: "Not sure" },
];

/**
 * "Roughly what did you pay per visit, out of pocket?" — `PRICE_BAND`'s ids, so
 * the column and the admin's labels are shared, with her wording for `free`.
 * The unit is always a visit, so it is not asked: `cards.ts` stores
 * `VISIT_UNIT` beside the band, which the `price_shape` CHECK requires.
 */
export const DOCTOR_PRICE_BAND: Option[] = PRICE_BAND.map((o) =>
  o.id === "free" ? { ...o, label: "Free, covered" } : o,
);

/** The doctor card's one price unit — kept out of `PRICE_UNIT`, which the activity card offers. */
export const VISIT_UNIT: Option = { id: "per_visit", label: "Visit" };

/* ── The sub-categories' closed answers (9 Oct, the client's 10/7 list) ───────
   Each "when did they last…" list reuses `last_there`'s ids where the meaning
   is the same, so the stale-at-capture flag (`over_year`) and the quality rule
   need nothing new; there is no CHECK on that column. */

/** Classes — "Are they still taking it?" */
export const CLASS_STILL: Option[] = [
  { id: "current", label: "Still going" },
  { id: "recent", label: "Stopped within the last year" },
  { id: "over_year", label: "Over a year ago" },
  { id: "unsure", label: "Not sure anymore" },
];

/** Classes — "per class, month or term". */
export const CLASS_PRICE_UNIT: Option[] = PRICE_UNIT.filter((o) =>
  ["per_class", "per_month", "per_term"].includes(o.id),
);

/** Camps — "When did they last attend?" */
export const CAMP_LAST: Option[] = [
  { id: "this_year", label: "This year" },
  { id: "last_year", label: "Last year" },
  { id: "over_year", label: "Longer ago" },
];

/** Camps — "per day/week". */
export const CAMP_PRICE_UNIT: Option[] = PRICE_UNIT.filter((o) =>
  ["per_day", "per_week"].includes(o.id),
);

/** Schools — "Are they still there?" */
export const SCHOOL_STILL: Option[] = [
  { id: "current", label: "Still there" },
  { id: "recent", label: "Left within the last year" },
  { id: "over_year", label: "Left over a year ago" },
];

/** Schools — tuition "per month or year". Kept for rows saved before 9 Oct's change below. */
export const SCHOOL_PRICE_UNIT: Option[] = [
  { id: "per_month", label: "Month" },
  { id: "per_year", label: "Year" },
];

/**
 * A school's tuition, **per month** (9 Oct, the developer: the class bands —
 * up to "Over $200" — put every private school in the top band). One question
 * instead of band-then-unit: a band's size depends on its unit, and monthly is
 * how most families think of it. `cards.ts` stores the unit, `per_month`, as
 * it stores a doctor's `per_visit`. `free` and `prefer_not_to_say` are the
 * shared ids, so the `price_shape` CHECK needs no unit for them.
 */
export const SCHOOL_TUITION_BAND: Option[] = [
  { id: "free", label: "Free — public or charter" },
  { id: "tuition_under_500", label: "Under $500" },
  { id: "tuition_500_1000", label: "$500–1,000" },
  { id: "tuition_1000_2000", label: "$1,000–2,000" },
  { id: "tuition_2000_3000", label: "$2,000–3,000" },
  { id: "tuition_over_3000", label: "Over $3,000" },
  { id: "prefer_not_to_say", label: "Prefer not to say" },
];

/** Specialists — "Are you still using them?" */
export const SPECIALIST_STILL: Option[] = [
  { id: "current", label: "Yes" },
  { id: "recent", label: "Within the last year" },
  { id: "over_year", label: "Longer ago" },
];

/** Restaurants — "Anything practical to know?" → `share_contributions.amenities`. */
export const RESTAURANT_AMENITIES: Option[] = [
  { id: "highchairs", label: "Highchairs" },
  { id: "changing_table", label: "Changing table" },
  { id: "outdoor_space", label: "Outdoor space" },
  { id: "stroller_room", label: "Room for a stroller" },
  { id: "kids_menu", label: "Kids' menu" },
  { id: "easy_parking", label: "Easy parking" },
  { id: "noisy_enough", label: "Noisy enough for kids" },
];

/**
 * The one unit a card that does not ask for one is stored with — the
 * `price_shape` CHECK needs a unit beside a paid band. A doctor or specialist
 * is per visit (`VISIT_UNIT`); a party vendor per event; a product per item.
 */
export const EVENT_UNIT: Option = { id: "per_event", label: "Event" };
export const ITEM_UNIT: Option = { id: "per_item", label: "Item" };

/** A negative answer turns "what do you like" into "what didn't work" (her item 7). */
const doesNotRecommend = (fields: Fields): boolean =>
  fields.recommendation === "probably_not" || fields.recommendation === "no";

/** R9 — exported for the same reason as the two above. */
export const WORTH_IT: Option[] = [
  { id: "great_value", label: "Great value" },
  { id: "fair", label: "Fair" },
  { id: "pricey_worth_it", label: "Pricey but worth it" },
  { id: "pricey_not_worth_it", label: "Pricey, not worth it" },
  { id: "free", label: "It's free" },
];

/**
 * Behind the recommendation card's own fork (10 Sep). `"yes"` only — an
 * unanswered fork and a "save it" both stop the card, which is what makes the
 * short path the default rather than something a parent opts out of.
 */
const wantsMore = (fields: Fields): boolean => fields.more_detail === "yes";

/**
 * The child-age chips on the **place** and **tip** cards, with the labels they
 * had before 30 Sep. The client's new wording ("Infants under 1 · Toddlers 1–2
 * …") is for the caregiver questions, where it is her table; the same five ids
 * on a place card keep their old labels rather than changing by association.
 */
const AGE_BANDS: Option[] = [
  { id: "baby", label: "Babies (0–1)" },
  { id: "toddler", label: "Toddlers (1–3)" },
  { id: "preschool", label: "Preschool (3–5)" },
  { id: "grade", label: "School age (5–11)" },
  { id: "tween", label: "Tweens & teens (11+)" },
];

const TIP_TOPICS: Option[] = [
  { id: "schedules", label: "Schedules & timing" },
  { id: "costs", label: "Costs & deals" },
  { id: "caregivers", label: "Finding caregivers" },
  { id: "birthdays", label: "Birthdays & parties" },
  { id: "rainy_days", label: "Rainy days" },
  { id: "food", label: "Eating out with kids" },
  { id: "new_to_area", label: "Being new here" },
  /* The client's list ends "Being new here, other" (8 Oct), and "Doctors &
     health" is not on it — a doctor has its own card now. A tip saved with the
     old `health` topic still reads: nothing looks the id up in this list. */
  { id: "other", label: "Other" },
];

/**
 * "Who does this help most?" on a tip: the five child bands, plus two answers a
 * tip can give that a place cannot (30 Sep) — it is for **parents** themselves
 * (nothing about a child's age), or for **all ages**. Each is exclusive, because
 * "parents" beside "toddlers" says nothing the band alone does not, and `cards.ts`
 * reads both as "every band" so a tip for all ages is not filtered out of an
 * answer about a toddler.
 */
const TIP_AUDIENCE: Option[] = [
  ...AGE_BANDS,
  { id: "parents", label: "Parents", exclusive: true },
  { id: "all_ages", label: "All ages", exclusive: true },
];

/**
 * The card's last question (23 Sep, the developer: *"Is there anything you think
 * other parents should know?"*), one constant for all three kinds so the
 * activity, place and tip cards cannot drift apart.
 */
export const EXTRA_NOTE_PROMPT = "Is there anything you think other parents should know?";

/**
 * The follow-ups (9 Oct): asked once, straight after a required or descriptive
 * answer that came back empty or too thin. Canonical wording — the model may
 * rephrase it for the parent in front of it (`/api/seed/assist`). Moved here
 * from `confirm-back.ts`, which asked one of these once per card, at the end.
 */
export const FOLLOW_UP = {
  /* 12 Oct, the developer: a skipped town is worth one more ask — it is what
     makes a recommendation local, a doctor's most of all. Asked again with the
     same town buttons (`ChatSeeding.askFollowUp`), and it can be skipped again. */
  /* 12 Oct: `{thing|it}` is the card's name when it has one (`withThing`). */
  location: "Even roughly helps — which town or area is {thing|it} in? It's how parents nearby find it.",
  activityWhy:
    "One more thing and this becomes really useful — what would you tell a friend who was deciding? The teacher, the room, the price, the thing you didn't expect.",
  activityDidnt:
    "Can you say a bit more about what didn't work? The teacher, the group size, the time, the thing you didn't expect.",
  /* 12 Oct: no "Parking" — after "parking is bad" it read as not listening. */
  caveat:
    "Anything else worth knowing before someone else tries {thing|it}? When it gets busy, the age it stops working, a cost that isn't obvious.",
  whoFor: "Who is {thing|it} right for — what age, temperament or situation?",
  tip: "Can you say a bit more? The tips parents act on are the specific ones — a name, a time, a number.",
  tipWhy: "When would another parent use this — or what did it change for you?",
  placeWhy:
    "One more thing and this becomes really useful — what would you tell a friend who was deciding? The shade, the crowds, what your child loved or hated.",
  placeCaveat: "Anything worth knowing before heading {to thing|there}? Parking, crowds, the hours, the toilets.",
  doctorWhy:
    "One more thing and this becomes really useful — what would you tell a friend who was choosing a doctor? How they explain things, how they are with kids, the wait.",
  doctorDidnt:
    "Can you say a bit more about what didn't work? The wait, how they explained things, how they were with your child.",
  doctorCaveat:
    "Anything worth knowing before someone else books {thing|them}? The wait for appointments, insurance, after-hours care.",
  doctorWhoFor: "Who would you send to {thing|them}? An age, a worry, a situation.",
  usedFor:
    "Can you say a bit more about what {thing|they} helped with? It's how Pando matches them to the next family.",
} as const;

/** The step id that carries a follow-up marker once one has been asked. */
export function followUpMark(stepId: string): string {
  return `__fu_${stepId}`;
}

function neighborhoodOptions(market: MarketId, ownPlaces: readonly string[], home?: string | null): Option[] {
  const curated: Option[] = marketOptions(market, "neighborhoods");
  const known = new Set(curated.map((o) => o.label.trim().toLowerCase()));
  const all = [
    ...curated,
    ...ownPlaces
      .map((p) => p.trim())
      .filter((p) => p !== "" && !known.has(p.toLowerCase()))
      .map((p) => ({ id: p, label: p })),
  ];
  /* Their own area first (12 Oct): the town question offers it as a check
     ("Is it in Altadena, near you…?"), so a yes is one tap, not a search. */
  const own = home ? all.find((o) => o.id === home || o.label === home) : undefined;
  return own ? [own, ...all.filter((o) => o !== own)] : all;
}

/** The parent's own area, as its label — what `AREA_TOKEN` is filled with. */
export function homeAreaLabel(market: MarketId, home: string | null | undefined, ownPlaces: readonly string[] = []): string | null {
  if (!home) return null;
  return neighborhoodOptions(market, ownPlaces).find((o) => o.id === home || o.label === home)?.label ?? null;
}

export function buildScripts(
  market: MarketId,
  ownPlaces: readonly string[] = [],
  /** The parent's own neighbourhood (`answers.neighborhood`), put first among the town chips. */
  home: string | null = null,
): Record<ShareKind, Script> {
  /**
   * The town list for a card, plus the parent's **own** place when it is not on
   * the market's list yet (21 Sep, the developer: a parent who lives in Detroit
   * must be able to say an activity is in Detroit).
   *
   * That place is the name Google resolved on the neighborhood question, waiting
   * in `pending_options` for an admin (invariant 9). Offering it here stores the
   * same canonical name on the record — and `option.promote` swaps it for the
   * admin's slug, while `option.reject` removes it, so a record never keeps a
   * place nobody approved. It is appended after the curated towns, and only
   * when no curated option already carries that name.
   */
  const neighborhoods = neighborhoodOptions(market, ownPlaces, home);

  return {
    /**
     * ## Six questions, and the seventh only when Pando does not know the place
     *
     * The client, 10 Sep: *"Sixteen questions create drop-off at the highest-value
     * point … no more than 6 questions. Autocomplete known places. If there is no
     * match, ask for the town, never a street address."*
     *
     * The six are hers, from the provenance row of the same document: the place,
     * whose experience it is, the child's age at the time, when they were last
     * there, whether they would recommend it, and why. The name-display choice is
     * the seventh thing she lists and it is **not** a question — it is the toggle
     * on the finished card (`show_name`), which is where a decision about one
     * recommendation belongs.
     *
     * ⚠ **`venue` is deleted, not moved.** *"Anything more exact, if you remember?
     * A street or the venue"* asked a parent to type an address from memory, and
     * her instruction is explicit that a street is never asked for. What it was
     * for — telling two places with one name apart — is what the directory match
     * now does properly, by storing the canonical record's own label.
     *
     * ⚠ **`location` is asked only when the name did not match.** `PlaceStep`
     * writes the town from the matched record, so the step's own `when` is
     * already false by the time it is reached. That is the whole of why six is
     * possible: three questions used to identify one place.
     *
     * ## What is behind the fork, and why each of them
     *
     * Her sentence: *"others can be additional detail if folks want to complete —
     * can say the more info you provide, the more targeted your responses."* So
     * nothing was deleted for length; eight steps moved behind one tap.
     *
     * ⚠ **The caveat came back out from behind the fork on 4 Oct** — the
     * client's P0 round requires it on every activity — and since 5 Oct it, the
     * child's age and "what makes it good" are **required**: no skip, asked
     * before anything optional. "Nothing to flag" is an answer to type, not a
     * button. The short path is seven questions, not six.
     *
     * ⚠ **`follow_up_ok` is a permission rather than detail**, and behind a fork
     * most cards will not carry one. That is safe in the only direction that
     * matters: unanswered means no, so the cost is Pando asking fewer parents
     * rather than asking one who never agreed.
     */
    activity: {
      kind: "activity",
      /* 9 Oct: the button covers the client's Activities, Classes and Camps —
         the classifier picks which — but keeps its label and size: the
         developer asked for the button to stay as it was. */
      label: "An activity or class",
      hint: "Music, swim, dance, sports, camp",
      intro: "Great — let's do one activity or class at a time.",
      steps: [
        {
          id: "name",
          prompt: "What's it called?",
          variants: ["Ooh, which one? What's it called?", "{parent}, what's it called?", "Which one is it — what's the name?"],
          aside: "Start typing — Pando probably knows it, and then it fills in the rest.",
          widget: "place",
          searchCategory: "baby_activities",
          maxLength: 80,
          placeholder: "e.g. Little Maestros",
        },
        {
          /**
           * The context question (9 Oct), straight after the name: the parent's
           * own description is what the classifier and the adaptive interview
           * read — everything after it is chosen and worded from what it says
           * (`/api/seed/assist`), and a closed answer it already gives (whose
           * experience, the age, how recent) is not asked again.
           */
          id: "what_is_it",
          /* 9 Oct: "what is it", not "how did it go" — the developer's walk wrote a
             review here and was then asked what they liked. How it went is
             the "why" question's, later. */
          prompt: "In a line or two, what is it?",
          namedPrompt: "In a line or two, what is {thing}?",
          variants: [
            "In a line or two, what is {thing}?",
            "Ooh, {thing}. In a line or two, what is it?",
            "And what is {thing}, in a line or two?",
            "Tell me a bit about {thing} — what is it, in a line or two?",
          ],
          aside: "Weekly swim lessons, a pottery afternoon, a summer camp… and whether it was your family or a friend's.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. weekly swim lessons our daughter still goes to",
          classifyAfter: true,
        },
        {
          /**
           * R2. Firsthand or a friend's — and the answer changes what the record
           * is worth. Secondhand is welcome, labelled, and does not count toward
           * Founding, so the parent is told that here rather than discovering it.
           */
          id: "firsthand",
          /* 8 Oct, her wording: "Did your kid do it?" / "Yes, ours did" / "No,
             this is based on a friend's experience". */
          prompt: "Did your kid do it?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, ours did" },
            {
              id: "secondhand",
              label: "No, this is based on a friend's experience",
              hint: "Welcome, labelled secondhand",
              wide: true,
            },
          ],
        },
        {
          /* R3 — the age at the time, not now: a class that suited a three-year-old
             is the answer to a question about three-year-olds, whenever it was. */
          id: "child_age",
          prompt: "How old was your child at the time?",
          friendPrompt: "How old was your friend's child at the time?",
          aside: "Tap every age that applies.",
          widget: "ages",
        },
        {
          id: "freshness",
          /* 12 Oct (the developer allowed light rewording): its first button is
             "Still doing it", which "When did they last do it?" does not take. */
          prompt: "Are they still doing it, or when did they last go?",
          friendPrompt: "Is your friend's child still doing it, or when did they last go?",
          widget: "quick",
          options: LAST_THERE,
        },
        {
          id: "recommendation",
          prompt: "Knowing what you know now, would you recommend it?",
          widget: "quick",
          options: RECOMMENDATION_OPTIONS,
        },
        {
          /**
           * Two questions on one answer (8 Oct, the client): *"What did you or
           * your child especially like about it?"* after a Yes, and *"What
           * didn't work for you or your child?"* after a Probably not or a No.
           * "What makes it good?" is struck from her list.
           *
           * ⚠ **One column, chosen by the recommendation** — the doctor card's
           * rule (`doctorWhy`), applied here too. A parent who edits Yes to No
           * from the recap still holds the praise, and the stored "why" must
           * follow the recommendation rather than whichever field is filled.
           * Retrieval then quotes it **only** for a positive recommendation, or
           * a No's reason would reach another parent as praise.
           */
          id: "what_makes_it_great",
          prompt: "What did you or your child especially like about it?",
          aside: "One line is plenty — the thing you'd text a friend.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. small groups and a very patient teacher",
          when: (fields) => !doesNotRecommend(fields),
          followUp: { ask: FOLLOW_UP.activityWhy, on: "empty_or_thin" },
        },
        {
          id: "what_didnt_work",
          prompt: "What didn't work for you or your child?",
          aside: "One line is plenty.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. too big a group for a shy child",
          when: doesNotRecommend,
          followUp: { ask: FOLLOW_UP.activityDidnt, on: "empty_or_thin" },
        },
        {
          /**
           * R7, asked of every activity card (4 Oct, the client: *"What should
           * another parent know before trying it? A parent can answer 'nothing
           * to flag', but they must be asked."*). It sat behind the fork, so
           * none of the first eight real activity cards had one.
           *
           * ⚠ This reverses the 10 Sep placement and puts a seventh question
           * on the short path. The skip is still an answer: an empty value
           * lands as `caveat_answered` in `cards.ts`.
           */
          id: "caveat",
          /* 8 Oct, her wording: "before signing up". */
          prompt: "What should another parent know before signing up?",
          aside:
            "The waitlist, the parking, the one instructor to avoid. Nothing to flag? Just say so.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. nothing to flag",
          followUp: { ask: FOLLOW_UP.caveat, on: "empty_or_thin" },
        },
        {
          /**
           * Only when the directory did not have it (10 Sep). `PlaceStep` writes
           * this field from the matched record, so for a known place this step
           * is already answered and never appears.
           *
           * Her wording, and note what it is not: *"ask for the town, never a
           * street address."*
           *
           * ⚠ After the required questions, not after the name (5 Oct): the
           * developer's rule is that what must be answered comes first and
           * unskippable, and what may be skipped follows.
           */
          id: "location",
          prompt: "Which town is it in?",
          widget: "chips",
          options: neighborhoods,
          optional: true,
          followUp: { ask: FOLLOW_UP.location, on: "empty" },
          when: (fields) =>
            !(Array.isArray(fields.location) && fields.location.length > 0),
        },
        {
          /**
           * The fork, and her framing rather than a nudge (10 Sep): *"the more
           * info you provide, the more targeted your responses."* One tap, and
           * **Save it** is the first option — a parent who stops here has given
           * a complete recommendation, and the screen should not imply
           * otherwise.
           */
          id: "more_detail",
          /**
           * ⚠⚠ **Reworded 17 Sep, and the old wording is the reported bug.**
           * It read *"Anything else worth adding?"* and then offered two
           * buttons — an open question answered by a choice, which is what
           * the developer called confusing and misleading. Those words are
           * now the card's real last step, which is an actual text field.
           * This one asks what it has always decided: whether to keep going.
           */
          prompt: "That's everything Pando needs. Add a few more details, or save it as it is?",
          aside:
            "The more detail you give, the more targeted the answers Pando can give another parent.",
          widget: "quick",
          options: [
            /* ⚠ The label no longer promises saving *now*: one question
               follows for every parent, whichever they pick. */
            { id: "no", label: "That's it", wide: true },
            { id: "yes", label: "Add more detail", wide: true },
          ],
        },
        /* "How long, or how often, did you go?" and "And who might it not
           suit?" are not on the client's list (8 Oct) and are gone from the
           card. Their columns stay, so a card saved before today still reads —
           and the admin can still edit them. */
        {
          id: "who_for",
          prompt: "Who is it perfect for?",
          widget: "text",
          maxLength: 200,
          optional: true,
          placeholder: "e.g. a cautious toddler who warms up slowly",
          when: wantsMore,
          followUp: { ask: FOLLOW_UP.whoFor, on: "empty_or_thin" },
        },
        {
          id: "price_band",
          prompt: "Roughly what did you pay?",
          widget: "quick",
          optional: true,
          options: PRICE_BAND,
          when: wantsMore,
        },
        {
          id: "price_unit",
          prompt: "And was that per day, week or season?",
          widget: "quick",
          when: (fields) =>
            wantsMore(fields) &&
            typeof fields.price_band === "string" &&
            fields.price_band !== "" &&
            fields.price_band !== "free" &&
            fields.price_band !== "prefer_not_to_say",
          options: ACTIVITY_PRICE_UNIT,
        },
        {
          id: "worth_it",
          prompt: "Was it worth the money?",
          widget: "quick",
          options: WORTH_IT,
          when: wantsMore,
        },
        {
          /* Per-recommendation permission, with the cost stated plainly. */
          id: "follow_up_ok",
          prompt: "If another parent asks about this one, may Pando bring you their question?",
          aside: "It counts as one of your monthly community questions, and you can always skip it.",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, happy to" },
            { id: "no", label: "Not this one" },
          ],
          when: wantsMore,
        },
        {
          /**
           * The last question on every card (developer, 17 Sep): *"додати можливість
           * в кінці вказати свій коментар або скіпнути його, це має бути останнє
           * питання"*.
           *
           * ⚠⚠ **Not behind `wantsMore`, and that is what makes it *the last
           * question* rather than the last question of the detailed branch.** Most
           * parents tap through the short path, so gating it would hide it from
           * exactly the people it is for. The cost is that the fork above can no
           * longer say *save it* — its label changed in the same pass.
           *
           * ⚠ Skippable, and a skip is an answer rather than an omission (1 Sep).
           * The label says what is being declined so it does not read as the only
           * way past a required field.
           *
           * ⚠⚠ **Swapped with the post-save line the same day.** This step first
           * shipped asking *"Anything else you'd like to share?"* and the
           * developer moved those words down to the line that follows the saved
           * card: *"в нижній текст переміщуєш Anything else you'd like to share.
           * У верхній замінюєш власним про коментар"*. They are right about which
           * sentence is which — *anything else* reads as *another recommendation*,
           * which is what the line below the card asks, while this one is about
           * **this** card and wants their own words.
           *
           * ⚠ Not *"Would you like to add a comment?"*: a yes/no sentence over a
           * text field is the fault this whole change exists to fix, one screen
           * along. It asks for the thing rather than for permission to ask.
           */
          id: "extra_note",
          /* 23 Sep, her wording verbatim for the card's last question. */
          prompt: EXTRA_NOTE_PROMPT,
          aside:
            "Your own comment on this one — whatever did not fit the questions above. Optional.",
          widget: "text",
          maxLength: 400,
          optional: true,
          skipLabel: "Nothing else",
          placeholder: "Anything you would tell a friend about it…",
        },
      ],
      recap: [
        { field: "name", label: "Activity" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age at the time" },
        { field: "freshness", label: "Last there" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What's good" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Perfect for" },
        { field: "price_band", label: "Paid" },
        { field: "price_unit", label: "Per" },
        { field: "worth_it", label: "Worth it" },
        { field: "follow_up_ok", label: "Follow-ups" },
        { field: "extra_note", label: "Anything else" },
      ],
    },
    caregiver: {
      kind: "caregiver",
      label: "A caregiver",
      hint: "Sitter, nanny, tutor, coach",
      intro:
        "This one works differently — we never contact anyone, and we don't store their details. At the end I'll give you an invite you can send them yourself.",
      steps: [
        {
          /**
           * C1 — the hard gate, and first (30 Sep, the client's "Caregiver
           * questions"). Firsthand only: a caregiver recommendation relayed from
           * someone else is not something Pando will carry.
           *
           * Her wording replaces "Did this caregiver work directly for your
           * family?" — *personally cared for your child* is the thing being
           * asked, and "worked directly for" read as a payroll question. The
           * step id stays `worked_for_you`: it is the field key the save route
           * refuses a card on (invariant 14), and a rename would make an older
           * client's answer read as missing.
           *
           * A No ends the flow and keeps nothing — no recommendation,
           * endorsement, trust edge, vouch or invitation.
           */
          id: "worked_for_you",
          prompt: "Has this caregiver personally cared for your child or children?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
          stopIf: (value) =>
            value === "no"
              ? "For now, Pando only accepts caregiver recommendations from families who have personally used the caregiver."
              : null,
        },
        {
          /* After firsthand care is confirmed, not before (30 Sep): nothing below
             is asked of somebody whose recommendation cannot be taken. */
          id: "age_gate",
          prompt: "Are they 18 or older?",
          aside: "Pando never lists anyone under 18.",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, 18 or older" },
            { id: "no", label: "No, under 18" },
          ],
          stopIf: (value) =>
            value === "no" ? "Pando currently supports adult caregivers only." : null,
        },
        {
          id: "name",
          prompt: "What's their name?",
          aside: "First name and last initial only — never a full name, never a number here.",
          widget: "name",
        },
        {
          id: "type",
          prompt: "What kind of care was it?",
          widget: "quick",
          options: CAREGIVER_TYPES,
        },
        {
          /* The ages they actually cared for — evidence, not an opinion about who
             they'd be good with. */
          id: "cared_for_ages",
          prompt: "How old were the kids they looked after?",
          widget: "chips",
          options: CAREGIVER_AGE_BANDS,
        },
        {
          /* Closed first: strengths are the matchable half, so they must not
             depend on extraction from free text. CPR / first aid is not offered
             here (30 Sep): only the caregiver can state it, and it is unverified. */
          id: "strengths",
          prompt: "What are they especially good at?",
          widget: "chips",
          options: PARENT_STRENGTHS,
        },
        {
          id: "how_long",
          prompt: "And for how long?",
          widget: "quick",
          options: [
            { id: "under_6m", label: "Under 6 months" },
            { id: "6_12m", label: "6–12 months" },
            { id: "1_3y", label: "1–3 years" },
            { id: "over_3y", label: "3+ years" },
          ],
        },
        {
          /* Recency, separately from duration: "three years, until 2019" and
             "three years, still every week" are not the same recommendation. */
          id: "last_worked",
          prompt: "When did they last work with you?",
          widget: "quick",
          options: [
            { id: "current", label: "Still do, currently" },
            { id: "within_3m", label: "Within 3 months" },
            { id: "within_year", label: "Within the past year" },
            { id: "over_year", label: "Over a year ago" },
          ],
        },
        {
          /**
           * "Would you hire them again?" → "Would you recommend them to another
           * family?" (30 Sep). The step id stays `hire_again` and the values stay
           * yes / hesitant / no: the column, its `hold_when_hesitant` CHECK and
           * the route's holds all key on them, and only the words changed.
           *
           * "Yes, with some context" is held for a person before it is used. A
           * **No** must never generate a recommendation or an invitation: the
           * card is kept only as a private, held record and the invite is not
           * offered (`ChatSeeding`), and nothing below asks for a reference.
           */
          id: "hire_again",
          prompt: "Would you recommend them to another family?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, without hesitation" },
            { id: "hesitant", label: "Yes, with some context" },
            { id: "no", label: "No" },
          ],
        },
        {
          id: "reference_willing",
          prompt: "If another parent asks about them, would you be willing to be a reference?",
          aside: "We'd ask you again each time, and you can always say no.",
          widget: "quick",
          when: (fields) => fields.hire_again !== "no",
          options: [
            { id: "yes", label: "Yes, happy to" },
            { id: "maybe", label: "Ask me at the time" },
            { id: "no", label: "Prefer not to" },
          ],
        },
        {
          /**
           * 30 Sep, the developer, reading the client's table: *"Просто робиш
           * публічним, лишається"* — this note is **public** (after a person has
           * read the card), and the private "Anything you'd only say privately?"
           * is gone. It is stored as the nomination's `caveat`; retrieval
           * offers it to an answer only from a card a human has released, made
           * on or after the change (`PUBLIC_NOTE_SINCE`), so nothing a parent
           * wrote believing it was private is ever shown.
           *
           * ⚠ It is the one box where a parent can name a person, so the card
           * is still read by a person before anyone is listed (invariant 8).
           * What a parent would only say privately now has exactly one place:
           * the follow-up to the recommendation answer below.
           */
          id: "know_first",
          prompt: "Anything a family should know up front?",
          aside:
            "Nothing to flag? Just say so. Families may see this once someone at Pando has read it.",
          widget: "text",
          maxLength: 400,
          when: (fields) => fields.hire_again !== "no",
          placeholder: "e.g. books up early in the summer",
        },
        {
          /**
           * Same ids as the caregiver's own availability (2C, G6), because "she
           * worked weekday mornings" and "I'm free weekday mornings" is the match
           * this data exists to make.
           */
          id: "schedule_pattern",
          prompt: "When did they usually work for you?",
          aside: "Tap all that apply.",
          widget: "chips",
          options: CAREGIVER_SCHEDULE,
          optional: true,
        },
        {
          /* 28 Sep: "Specific days of the week" opens the days themselves.
             cards.ts folds them into schedule_pattern beside the windows. */
          id: "schedule_days",
          prompt: "Which days?",
          aside: "Tap all that apply.",
          widget: "chips",
          options: CAREGIVER_WEEKDAYS,
          optional: true,
          when: (fields) => wantsWeekdays(fields.schedule_pattern),
        },
        {
          /**
           * Asked **once, and whether or not a pay range was given** (30 Sep, her
           * rule: "ask weekly hours once, independently of whether a pay range
           * was given"). It used to appear only after a band, so a parent who
           * skipped the rate was never asked the size of the job.
           */
          id: "hours_per_week",
          prompt: "Roughly how many hours a week?",
          aside: "Optional.",
          widget: "quick",
          optional: true,
          options: CAREGIVER_HOURS,
        },
        {
          id: "pay_band",
          prompt: "Roughly what did you pay?",
          aside: "Optional. Ranges only, and never shown next to their name.",
          widget: "quick",
          optional: true,
          options: PAY_BANDS,
        },
        {
          id: "what_makes_special",
          prompt: "Anything you'd add in your own words?",
          widget: "text",
          maxLength: 400,
          optional: true,
          placeholder: "Calm with a shy kid, and she actually plays…",
        },
        {
          /* Back on the card (30 Sep); it was removed on 28 Sep and the client's
             table restores it, optional, with her eight options. */
          id: "good_fit_for",
          prompt: "Which families are they a great fit for?",
          widget: "chips",
          options: CAREGIVER_FIT,
          optional: true,
        },
        {
          id: "hesitation_reason",
          prompt: "What would you want Pando to understand?",
          aside: "Optional. Your response stays private unless you separately agree to share it.",
          widget: "text",
          maxLength: 400,
          optional: true,
          when: (fields) => fields.hire_again === "hesitant" || fields.hire_again === "no",
        },
        {
          /**
           * C10, and why it earns its place, in the client's words: when a
           * wonderful nanny's hours end, parents scramble on Facebook to help her
           * land with a good family. Pando can matchmake quietly instead — with
           * her consent, and including a share if this family needs fewer hours.
           *
           * 30 Sep: only when the caregiver **currently works for the proposer**
           * (her bracket in the table), and its two follow-ups — the kind of
           * change and "may Pando check back with you" — are gone.
           */
          id: "needs_horizon",
          prompt: "Do you expect your childcare needs to change in the next year?",
          aside: "When a nanny's hours end, parents scramble on Facebook to help her land somewhere good. Pando can do that quietly instead — with her consent, and including a share if you need fewer hours.",
          widget: "quick",
          optional: true,
          when: (fields) => fields.last_worked === "current" && fields.hire_again !== "no",
          options: [
            { id: "3_months", label: "Yes — within 3 months" },
            { id: "6_months", label: "Yes — within 6 months" },
            { id: "12_months", label: "Yes — within a year" },
            { id: "unsure", label: "Unsure" },
            { id: "no_change", label: "No change expected" },
          ],
        },
        /**
         * C11 is not a question (23 Sep, the developer): every saved caregiver
         * card ends on the invite message (`offerCaregiverInvite` in
         * `ChatSeeding`), held cards included — except after a **No** (30 Sep).
         * The client's table also lists "May Pando send {Name} an invitation?"
         * and "What is {Name}'s mobile number?"; the developer's answer was that
         * the caregiver fills in her own number **after** the invitation, so
         * neither is asked here (invariant 13 stands).
         */
      ],
      recap: [
        { field: "type", label: "Kind of care" },
        { field: "name", label: "Caregiver" },
        { field: "cared_for_ages", label: "Looked after" },
        { field: "how_long", label: "How long" },
        { field: "last_worked", label: "Last worked" },
        { field: "schedule_pattern", label: "When" },
        { field: "schedule_days", label: "Days" },
        { field: "strengths", label: "Good at" },
        { field: "what_makes_special", label: "In your words" },
        { field: "good_fit_for", label: "Great fit for" },
        { field: "know_first", label: "Up front" },
        { field: "hire_again", label: "Recommend" },
        { field: "hesitation_reason", label: "Note for Pando" },
        { field: "needs_horizon", label: "Needs changing" },
        { field: "pay_band", label: "Paid" },
        { field: "hours_per_week", label: "Hours a week" },
        { field: "reference_willing", label: "Reference" },
      ],
    },

    place: {
      kind: "place",
      label: "A place",
      /* 9 Oct: Places, Restaurants & cafés and Schools sit under this button. */
      hint: "Park, café, restaurant, school",
      intro: "Places are easy — a few taps and a sentence.",
      steps: [
        {
          id: "name",
          prompt: "What's the place?",
          variants: ["Which place is it?", "{parent}, which place is it?", "Ooh, where? What's the place called?"],
          widget: "text",
          maxLength: 80,
          placeholder: "e.g. Victory Park playground",
        },
        {
          /* The context question (9 Oct), straight after the name — see the
             activity card's. */
          id: "what_is_it",
          prompt: "In a line or two, what kind of place is it?",
          namedPrompt: "In a line or two, what kind of place is {thing}?",
          variants: [
            "In a line or two, what kind of place is {thing}?",
            "{thing} — what kind of place is it, in a line or two?",
            "And {thing} is what kind of place? A line or two is plenty.",
          ],
          aside: "A park, a café, a school, a museum… and whether you went or a friend did.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. a playground with a splash pad we go to most weekends",
          classifyAfter: true,
        },
        {
          /* 8 Oct, the client's list: whose experience it is, and a friend's is
             welcome, labelled, and does not count toward Founding — the same
             rule and the same column as an activity. */
          id: "firsthand",
          prompt: "Did you go there with your child?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes" },
            {
              id: "secondhand",
              label: "No, this is based on a friend's experience",
              hint: "Welcome, labelled secondhand",
              wide: true,
            },
          ],
        },
        {
          id: "child_age",
          prompt: "How old was your child when you went?",
          friendPrompt: "How old was your friend's child when they went?",
          aside: "Tap every age that applies.",
          widget: "ages",
        },
        {
          id: "freshness",
          prompt: "When did you last go?",
          friendPrompt: "When did your friend last go?",
          widget: "quick",
          options: PLACE_LAST_GONE,
        },
        {
          id: "recommendation",
          prompt: "Would you recommend it?",
          widget: "quick",
          options: RECOMMENDATION_OPTIONS,
        },
        {
          /* One question for both, her wording (8 Oct): *"What did you like — or
             dislike — about it?"*. "What makes it worth the trip?" is struck
             from her list, and there is no second question after a No — which is
             why the stored text may be either, and retrieval quotes it only for
             a positive recommendation. */
          id: "what_makes_it_great",
          prompt: "What did you like — or dislike — about it?",
          widget: "text",
          maxLength: 400,
          placeholder: "Shade and a fence — but the parking is brutal…",
          followUp: { ask: FOLLOW_UP.placeWhy, on: "empty_or_thin" },
        },
        {
          /* Required, and answered in words (5 Oct): "Nothing to flag" is an
             answer, a skip button is not. `cards.ts` stores it as asked and
             answered, never as a caveat another parent is shown. */
          id: "caveat",
          prompt: "Anything to know before going?",
          aside: "Parking, crowds, the hours. Nothing to flag? Just say so.",
          widget: "text",
          maxLength: 400,
          placeholder: "Parking is brutal after 10am…",
          followUp: { ask: FOLLOW_UP.placeCaveat, on: "empty_or_thin" },
        },
        {
          id: "best_for",
          prompt: "Who's it best for?",
          widget: "chips",
          options: AGE_BANDS,
          optional: true,
        },
        {
          /* After the required questions (5 Oct), and in her order (8 Oct):
             item 9, then item 10 "Which area is it in?" — optional. */
          id: "location",
          prompt: "Which area is it in?",
          widget: "chips",
          options: neighborhoods,
          optional: true,
          followUp: { ask: FOLLOW_UP.location, on: "empty" },
        },
        {
          /**
           * The last question on every card (developer, 17 Sep): *"додати можливість
           * в кінці вказати свій коментар або скіпнути його, це має бути останнє
           * питання"*.
           *
           * ⚠⚠ **Not behind `wantsMore`, and that is what makes it *the last
           * question* rather than the last question of the detailed branch.** Most
           * parents tap through the short path, so gating it would hide it from
           * exactly the people it is for. The cost is that the fork above can no
           * longer say *save it* — its label changed in the same pass.
           *
           * ⚠ Skippable, and a skip is an answer rather than an omission (1 Sep).
           * The label says what is being declined so it does not read as the only
           * way past a required field.
           *
           * ⚠⚠ **Swapped with the post-save line the same day.** This step first
           * shipped asking *"Anything else you'd like to share?"* and the
           * developer moved those words down to the line that follows the saved
           * card: *"в нижній текст переміщуєш Anything else you'd like to share.
           * У верхній замінюєш власним про коментар"*. They are right about which
           * sentence is which — *anything else* reads as *another recommendation*,
           * which is what the line below the card asks, while this one is about
           * **this** card and wants their own words.
           *
           * ⚠ Not *"Would you like to add a comment?"*: a yes/no sentence over a
           * text field is the fault this whole change exists to fix, one screen
           * along. It asks for the thing rather than for permission to ask.
           */
          id: "extra_note",
          /* 23 Sep, her wording verbatim for the card's last question. */
          prompt: EXTRA_NOTE_PROMPT,
          aside:
            "Your own comment on this one — whatever did not fit the questions above. Optional.",
          widget: "text",
          maxLength: 400,
          optional: true,
          skipLabel: "Nothing else",
          placeholder: "Anything you would tell a friend about it…",
        },
      ],
      recap: [
        { field: "name", label: "Place" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age when you went" },
        { field: "freshness", label: "Last went" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "Liked or disliked" },
        { field: "caveat", label: "Know first" },
        { field: "best_for", label: "Best for" },
        { field: "location", label: "Where" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    /**
     * ## Doctors & medical providers (8 Oct)
     *
     * The client's list, in her order and her words. Eight required questions,
     * then the fork, then three optional ones and the card's shared last step.
     * Her item 8, "What do you value about them?", is struck out of her own list
     * and is not asked.
     *
     * ⚠ **The name is typed, not searched.** There is no doctors directory in
     * `market_options`, so the town step's `when` is true for every doctor card
     * today — it is written the activity card's way so that it becomes "only if
     * needed" the day a directory exists. Whether the provider is real is
     * checked after saving (`lib/server/provider-check.ts`) and shown to the
     * admin; it never blocks the card.
     *
     * ⚠ **Item 7 is two steps, not one with two wordings.** A step's prompt is a
     * plain string everywhere it is read, so "What didn't work for you?" is its
     * own step behind `doesNotRecommend` and `cards.ts` stores either one in
     * `what_makes_it_great`, the contribution's "why" column.
     *
     * ⚠ Secondhand (a friend's doctor) is welcome and labelled, and does not
     * count toward Founding — the same rule and the same column as an activity.
     */
    doctor: {
      kind: "doctor",
      /* 9 Oct, the developer: the button is **Services** — Doctors,
         Specialists & family services and Parties / venues / vendors sit under
         it. 12 Oct, the developer: renamed **Specialists**, then **Specialists &
         Doctors**. The kind stays
         `doctor`, so nothing stored changes. The first questions are worded
         for any of the three; the doctor's own follow. */
      label: "Specialists & Doctors",
      hint: "Doctors, dentists, therapists, tutors, party vendors",
      /* 12 Oct, the developer: "service" was left over from the Services button
         and could puzzle a parent; the button is Specialists & Doctors. */
      intro: "Great — one doctor, specialist or vendor at a time.",
      steps: [
        {
          id: "name",
          prompt: "Who was it — the doctor, specialist or vendor?",
          variants: ["Who was it — which doctor, specialist or vendor?", "{parent}, who was it?", "Which doctor, specialist or vendor was it?"],
          widget: "text",
          maxLength: 80,
          placeholder: "Name of the doctor, practice or vendor",
        },
        {
          /* The context question (9 Oct), straight after the name, and the
             client's Specialists Q3 — stored in `share_contributions.used_for`
             (`drizzle/0056`). */
          id: "used_for",
          prompt: "What did you see or use them for?",
          variants: ["What did you see {thing} for?", "And what did {thing} help with?", "{thing} — what was it for?"],
          aside: "A checkup, speech therapy, a birthday party… A sentence is plenty.",
          widget: "text",
          maxLength: 200,
          placeholder: "e.g. our son's speech delay",
          classifyAfter: true,
          followUp: { ask: FOLLOW_UP.usedFor, on: "empty_or_thin" },
        },
        {
          id: "firsthand",
          prompt: "Did you use them yourselves?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes" },
            {
              id: "secondhand",
              label: "No, this is based on a friend's experience",
              hint: "Welcome, labelled secondhand",
              wide: true,
            },
          ],
        },
        {
          id: "child_age",
          prompt: "How old was your child at the time?",
          friendPrompt: "How old was your friend's child at the time?",
          aside: "Tap every age that applies.",
          widget: "ages",
        },
        {
          id: "visit_reason",
          prompt: "What did you see them for?",
          widget: "quick",
          options: VISIT_REASON,
        },
        {
          id: "freshness",
          /* 12 Oct: fits a one-off visit (urgent care) as well as a regular doctor. */
          prompt: "Are you still seeing them, or when was the last visit?",
          friendPrompt: "Is your friend still seeing them, or when was the last visit?",
          widget: "quick",
          options: DOCTOR_LAST_SEEN,
        },
        {
          id: "recommendation",
          prompt: "Would you recommend them?",
          widget: "quick",
          options: RECOMMENDATION_OPTIONS,
        },
        {
          id: "what_makes_it_great",
          prompt: "What do you especially like about them?",
          aside: "One line is plenty — the thing you'd text a friend.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. she listens and never rushes us",
          when: (fields) => !doesNotRecommend(fields),
          followUp: { ask: FOLLOW_UP.doctorWhy, on: "empty_or_thin" },
        },
        {
          id: "what_didnt_work",
          prompt: "What didn't work for you?",
          aside: "One line is plenty.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. hard to reach after hours",
          when: doesNotRecommend,
          followUp: { ask: FOLLOW_UP.doctorDidnt, on: "empty_or_thin" },
        },
        {
          /* Required, answered in words, as on every other card: "Nothing to
             flag" is an answer and `cards.ts` stores it as asked-and-answered. */
          id: "caveat",
          prompt: "What should another parent know?",
          aside: "The wait times, the front desk, insurance. Nothing to flag? Just say so.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. book well-child visits months ahead",
          followUp: { ask: FOLLOW_UP.doctorCaveat, on: "empty_or_thin" },
        },
        {
          id: "location",
          prompt: "Which town is it in?",
          widget: "chips",
          options: neighborhoods,
          optional: true,
          followUp: { ask: FOLLOW_UP.location, on: "empty" },
          when: (fields) =>
            !(Array.isArray(fields.location) && fields.location.length > 0),
        },
        {
          /* The activity card's fork, word for word, so the two cannot read
             differently (the fork's wording is pinned in test:feedback). */
          id: "more_detail",
          prompt: "That's everything Pando needs. Add a few more details, or save it as it is?",
          aside:
            "The more detail you give, the more targeted the answers Pando can give another parent.",
          widget: "quick",
          options: [
            { id: "no", label: "That's it", wide: true },
            { id: "yes", label: "Add more detail", wide: true },
          ],
        },
        {
          id: "who_for",
          prompt: "Who are they especially good for?",
          widget: "text",
          maxLength: 200,
          optional: true,
          placeholder: "e.g. anxious kids, or families new to the area",
          when: wantsMore,
          followUp: { ask: FOLLOW_UP.doctorWhoFor, on: "empty_or_thin" },
        },
        {
          id: "appointment_ease",
          prompt: "How easy is it to get an appointment?",
          widget: "quick",
          optional: true,
          options: APPOINTMENT_EASE,
          when: wantsMore,
        },
        {
          id: "price_band",
          prompt: "Roughly what did you pay per visit, out of pocket?",
          widget: "quick",
          optional: true,
          options: DOCTOR_PRICE_BAND,
          when: wantsMore,
        },
        {
          /* The card's shared last step — see the activity card's for why it is
             not behind the fork. */
          id: "extra_note",
          prompt: EXTRA_NOTE_PROMPT,
          aside:
            "Your own comment on this one — whatever did not fit the questions above. Optional.",
          widget: "text",
          maxLength: 400,
          optional: true,
          skipLabel: "Nothing else",
          placeholder: "Anything you would tell a friend about them…",
        },
      ],
      recap: [
        { field: "name", label: "Who" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Used them yourselves" },
        { field: "child_age", label: "Age at the time" },
        { field: "used_for", label: "Used them for" },
        { field: "visit_reason", label: "Seen for" },
        { field: "freshness", label: "Seeing them" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What's good" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Good for" },
        { field: "appointment_ease", label: "Appointments" },
        { field: "price_band", label: "Per visit" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    tip: {
      kind: "tip",
      label: "Something else?",
      /* 9 Oct: Tips and Products & gear sit under this button. */
      hint: "A tip, or a product you'd recommend",
      intro: "These are often the most useful things in the whole network.",
      steps: [
        {
          /**
           * The context question (9 Oct). For a tip it **is** the tip: the chat
           * copies it into `tip` once the classifier says so (or is unsure),
           * so the tip is never asked twice. For a product it is what the
           * classifier reads, and the product's own questions follow.
           */
          id: "what_is_it",
          prompt: "In a line, what would you like to pass on?",
          variants: ["What's the tip? A line is plenty.", "{parent}, what would you tell another parent? A line is plenty."],
          aside: "A tip you wish someone had told you, or a product you'd recommend.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. sign up the week registration opens",
          classifyAfter: true,
          followUp: { ask: FOLLOW_UP.tip, on: "empty_or_thin" },
        },
        {
          id: "topic",
          /* 12 Oct: asked right after the tip is told, "What's it about?" read as
             if Pando had not listened. */
          prompt: "Which of these is it mostly about?",
          widget: "quick",
          options: TIP_TOPICS,
        },
        {
          id: "tip",
          prompt: "What should another parent do or know?",
          aside: "Say it the way you'd text it.",
          widget: "text",
          maxLength: 400,
          placeholder: "Sign up the week registration opens or you'll be waitlisted…",
          followUp: { ask: FOLLOW_UP.tip, on: "empty_or_thin" },
        },
        {
          /* The client's tip minimum (5 Oct): *"When is this useful / why did it
             help you?"* Stored in `what_makes_it_great`, the contribution's
             "why" column — a tip has no other use for it, and the admin, the
             extraction pass and the quality rule already read it. */
          id: "what_makes_it_great",
          prompt: "When is this useful, or why did it help you?",
          aside: "A sentence is plenty.",
          widget: "text",
          maxLength: 400,
          placeholder: "It saved us a month on the waitlist…",
          followUp: { ask: FOLLOW_UP.tipWhy, on: "empty_or_thin" },
        },
        {
          id: "best_for",
          prompt: "Who does this help most?",
          widget: "chips",
          options: TIP_AUDIENCE,
          optional: true,
        },
        {
          /**
           * The last question on every card (developer, 17 Sep): *"додати можливість
           * в кінці вказати свій коментар або скіпнути його, це має бути останнє
           * питання"*.
           *
           * ⚠⚠ **Not behind `wantsMore`, and that is what makes it *the last
           * question* rather than the last question of the detailed branch.** Most
           * parents tap through the short path, so gating it would hide it from
           * exactly the people it is for. The cost is that the fork above can no
           * longer say *save it* — its label changed in the same pass.
           *
           * ⚠ Skippable, and a skip is an answer rather than an omission (1 Sep).
           * The label says what is being declined so it does not read as the only
           * way past a required field.
           *
           * ⚠⚠ **Swapped with the post-save line the same day.** This step first
           * shipped asking *"Anything else you'd like to share?"* and the
           * developer moved those words down to the line that follows the saved
           * card: *"в нижній текст переміщуєш Anything else you'd like to share.
           * У верхній замінюєш власним про коментар"*. They are right about which
           * sentence is which — *anything else* reads as *another recommendation*,
           * which is what the line below the card asks, while this one is about
           * **this** card and wants their own words.
           *
           * ⚠ Not *"Would you like to add a comment?"*: a yes/no sentence over a
           * text field is the fault this whole change exists to fix, one screen
           * along. It asks for the thing rather than for permission to ask.
           */
          id: "extra_note",
          /* 23 Sep, her wording verbatim for the card's last question. */
          prompt: EXTRA_NOTE_PROMPT,
          aside:
            "Your own comment on this one — whatever did not fit the questions above. Optional.",
          widget: "text",
          maxLength: 400,
          optional: true,
          skipLabel: "Nothing else",
          placeholder: "Anything you would tell a friend about it…",
        },
      ],
      recap: [
        { field: "topic", label: "Topic" },
        { field: "tip", label: "Tip" },
        { field: "what_makes_it_great", label: "Why it helped" },
        { field: "best_for", label: "Helps most" },
        { field: "extra_note", label: "Anything else" },
      ],
    },
  };
}

/* The doctor card (8 Oct) before the tip, so "Something else?" stays last. */
export const SHARE_ORDER: ShareKind[] = ["activity", "caregiver", "place", "doctor", "tip"];

/* ── Sub-categories (9 Oct) ───────────────────────────────────────────────── */

const SECONDHAND: Option = {
  id: "secondhand",
  label: "No, this is based on a friend's experience",
  hint: "Welcome, labelled secondhand",
  wide: true,
};

/** The client's shorter wording on the 10/7 additions. */
const SECONDHAND_SHORT: Option = { ...SECONDHAND, label: "No, a friend's experience" };

function firsthandStep(prompt: string, yes = "Yes", no: Option = SECONDHAND): Step {
  return { id: "firsthand", prompt, widget: "quick", options: [{ id: "yes", label: yes }, no] };
}

function childAgeStep(prompt: string): Step {
  return {
    id: "child_age",
    prompt,
    friendPrompt: "How old was your friend's child at the time?",
    aside: "Tap every age that applies.",
    widget: "ages",
  };
}

function recommendStep(prompt: string): Step {
  return { id: "recommendation", prompt, widget: "quick", options: RECOMMENDATION_OPTIONS };
}

/**
 * The card's "why". `didnt` adds the No branch (`what_didnt_work`), which
 * every activity and Specialists-button sub-category carries so the stored "why" follows
 * the recommendation (`doctorWhy`); without it the one question is asked
 * whatever the answer, as on a place.
 */
function whySteps(input: {
  prompt: string;
  placeholder: string;
  ask: string;
  didnt?: { prompt: string; placeholder: string; ask: string };
}): Step[] {
  const like: Step = {
    id: "what_makes_it_great",
    prompt: input.prompt,
    aside: "One line is plenty — the thing you'd text a friend.",
    widget: "text",
    maxLength: 400,
    placeholder: input.placeholder,
    followUp: { ask: input.ask, on: "empty_or_thin" },
    /* 12 Oct: a camp a neighbour's boys went to was asked "What did your child
       actually enjoy about it?". */
    friendPrompt: "What did your friend say stood out about it?",
  };
  if (!input.didnt) return [like];
  return [
    { ...like, when: (fields) => !doesNotRecommend(fields) },
    {
      id: "what_didnt_work",
      prompt: input.didnt.prompt,
      aside: "One line is plenty.",
      widget: "text",
      maxLength: 400,
      placeholder: input.didnt.placeholder,
      friendPrompt: "What did your friend say didn't work?",
      when: doesNotRecommend,
      followUp: { ask: input.didnt.ask, on: "empty_or_thin" },
    },
  ];
}

function caveatStep(prompt: string, aside: string, placeholder: string, ask: string): Step {
  return {
    id: "caveat",
    prompt,
    aside,
    widget: "text",
    maxLength: 400,
    placeholder,
    followUp: { ask, on: "empty_or_thin" },
  };
}

/** "— only if needed": a name the directory matched already carries its town. */
function townStep(prompt: string, options: Option[]): Step {
  return {
    id: "location",
    prompt,
    widget: "chips",
    options,
    optional: true,
    followUp: { ask: FOLLOW_UP.location, on: "empty" },
    when: (fields) => !(Array.isArray(fields.location) && fields.location.length > 0),
  };
}

const FORK_STEP: Step = {
  id: "more_detail",
  prompt: "That's everything Pando needs. Add a few more details, or save it as it is?",
  aside: "The more detail you give, the more targeted the answers Pando can give another parent.",
  widget: "quick",
  options: [
    { id: "no", label: "That's it", wide: true },
    { id: "yes", label: "Add more detail", wide: true },
  ],
};

function detailText(id: string, prompt: string, placeholder: string, ask: string, maxLength = 200): Step {
  return {
    id,
    prompt,
    widget: "text",
    maxLength,
    optional: true,
    placeholder,
    when: wantsMore,
    followUp: { ask, on: "empty_or_thin" },
  };
}

function priceSteps(prompt: string, units?: { prompt: string; options: Option[] }, bands = PRICE_BAND): Step[] {
  const band: Step = {
    id: "price_band",
    prompt,
    widget: "quick",
    optional: true,
    options: bands,
    when: wantsMore,
  };
  if (!units) return [band];
  return [
    band,
    {
      id: "price_unit",
      prompt: units.prompt,
      widget: "quick",
      options: units.options,
      when: (fields) =>
        wantsMore(fields) &&
        typeof fields.price_band === "string" &&
        fields.price_band !== "" &&
        fields.price_band !== "free" &&
        fields.price_band !== "prefer_not_to_say",
    },
  ];
}

function worthItStep(prompt: string): Step {
  return { id: "worth_it", prompt, widget: "quick", options: WORTH_IT, optional: true, when: wantsMore };
}

const EXTRA_NOTE_STEP: Step = {
  id: "extra_note",
  prompt: EXTRA_NOTE_PROMPT,
  aside: "Your own comment on this one — whatever did not fit the questions above. Optional.",
  widget: "text",
  maxLength: 400,
  optional: true,
  skipLabel: "Nothing else",
  placeholder: "Anything you would tell a friend about it…",
};

/** A context step from the button's general script, so ids and widgets match. */
function contextStep(script: Script, id: string): Step {
  const step = script.steps.find((x) => x.id === id);
  if (!step) throw new Error(`no context step ${id} on ${script.kind}`);
  return step;
}

/**
 * Every sub-category's script (9 Oct, the client's *Categories Questions*).
 *
 * Her wording, in her order, with her struck items left out: "What makes it
 * good?" (Activities), "What makes the teaching good?" (Classes), "What makes
 * it worth the trip?" (Places), "What makes it a good school?" (Schools) and
 * "What do you value about them?" (Doctors) carry a strike line in her
 * document and are not asked.
 *
 * ⚠ **Each starts with its button's context steps, by id** — they are answered
 * before the classifier runs, so the chat carries on from the first step not
 * yet answered (`nextUnanswered`) and none is asked twice. Their wording here
 * is hers for the sub-category, which is what a recap row or an edit shows.
 *
 * Four are the button's own script: Activities, Places, Doctors and Tips are
 * what those buttons already asked, from her 8 Oct lists.
 */
export function buildSubScripts(
  market: MarketId,
  ownPlaces: readonly string[] = [],
  home: string | null = null,
): Record<Subcategory, Script> {
  const base = buildScripts(market, ownPlaces, home);
  const neighborhoods = neighborhoodOptions(market, ownPlaces, home);
  const activityName = contextStep(base.activity, "name");

  return {
    activities: { ...base.activity, subcategory: "activities" },
    places: { ...base.place, subcategory: "places" },
    /* The Specialists button asks its first two in words that fit any service;
       a doctor keeps hers (8 Oct) for its recap and its edits. */
    doctors: {
      ...base.doctor,
      subcategory: "doctors",
      label: "A doctor or medical provider",
      steps: base.doctor.steps.map((step) =>
        step.id === "name"
          ? { ...step, prompt: "Which practice or doctor?", placeholder: "Name" }
          : step.id === "firsthand"
            ? { ...step, prompt: "Did you take your own child to them?" }
            : step,
      ),
      recap: base.doctor.recap.map((row) =>
        row.field === "name"
          ? { ...row, label: "Doctor" }
          : row.field === "firsthand"
            ? { ...row, label: "Your child's doctor" }
            : row,
      ),
    },
    tips: { ...base.tip, subcategory: "tips" },

    classes: {
      kind: "activity",
      subcategory: "classes",
      label: "A class",
      hint: base.activity.hint,
      intro: base.activity.intro,
      steps: [
        { ...activityName, prompt: "What's the class called?" },
        firsthandStep("Did your kid take it?", "Yes, ours did"),
        childAgeStep("How old was your child at the time?"),
        contextStep(base.activity, "what_is_it"),
        { id: "freshness", prompt: "Are they still taking it?", widget: "quick", options: CLASS_STILL },
        recommendStep("Knowing what you know now, would you recommend it?"),
        ...whySteps({
          prompt: "What stood out about the teaching or class?",
          placeholder: "e.g. a teacher who learned every child's name",
          ask: "One more thing and this becomes really useful — what would you tell a friend who was deciding? The teacher, the class size, the pace, the thing you didn't expect.",
          didnt: {
            prompt: "What didn't work for you or your child?",
            placeholder: "e.g. too big a class for a shy child",
            ask: FOLLOW_UP.activityDidnt,
          },
        }),
        caveatStep(
          "What should another parent know before enrolling?",
          "The waitlist, the parking, the term dates. Nothing to flag? Just say so.",
          "e.g. nothing to flag",
          FOLLOW_UP.caveat,
        ),
        townStep("Which town is it in?", neighborhoods),
        FORK_STEP,
        detailText("who_for", "Who is it perfect for?", "e.g. a cautious toddler who warms up slowly", FOLLOW_UP.whoFor),
        ...priceSteps("Roughly what did you pay?", {
          prompt: "And was that per class, month or term?",
          options: CLASS_PRICE_UNIT,
        }),
        worthItStep("Was it worth the money?"),
        EXTRA_NOTE_STEP,
      ],
      recap: [
        { field: "name", label: "Class" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age at the time" },
        { field: "freshness", label: "Still going" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What stood out" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Perfect for" },
        { field: "price_band", label: "Paid" },
        { field: "price_unit", label: "Per" },
        { field: "worth_it", label: "Worth it" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    camps: {
      kind: "activity",
      subcategory: "camps",
      label: "A camp or holiday program",
      hint: base.activity.hint,
      intro: base.activity.intro,
      steps: [
        { ...activityName, prompt: "What's the camp or program called?" },
        firsthandStep("Did your child attend?", "Yes", SECONDHAND_SHORT),
        childAgeStep("How old were they?"),
        contextStep(base.activity, "what_is_it"),
        { id: "freshness", prompt: "When did they last attend?", widget: "quick", options: CAMP_LAST },
        recommendStep("Would you recommend it?"),
        ...whySteps({
          prompt: "What did your child actually enjoy about it?",
          placeholder: "e.g. the counselors, and building a raft on Friday",
          ask: "One more thing and this becomes really useful — what would you tell a friend who was deciding? What your child talked about afterwards, the counselors, the days.",
          didnt: {
            prompt: "What didn't work for you or your child?",
            placeholder: "e.g. long days for a five-year-old",
            ask: FOLLOW_UP.activityDidnt,
          },
        }),
        caveatStep(
          "What should another parent know before booking?",
          "When it fills up, drop-off, what to pack. Nothing to flag? Just say so.",
          "e.g. it fills up in February",
          "Anything worth knowing before someone else books? When it fills up, drop-off, a cost that isn't obvious.",
        ),
        townStep("Which town is it in?", neighborhoods),
        FORK_STEP,
        detailText(
          "who_for",
          "What kind of child is it best for?",
          "e.g. an outdoorsy kid who likes a busy day",
          "Who would you send there — what age, temperament or situation?",
        ),
        detailText(
          "timing_note",
          "Is it full-day or part-day, and roughly what hours?",
          "e.g. part-day, 9 to 1",
          "Even roughly — full days or mornings only, and what hours?",
        ),
        ...priceSteps("Roughly what did it cost?", { prompt: "And was that per day or per week?", options: CAMP_PRICE_UNIT }),
        worthItStep("Was it worth the money?"),
        EXTRA_NOTE_STEP,
      ],
      recap: [
        { field: "name", label: "Camp" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age at the time" },
        { field: "freshness", label: "Last attended" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What they enjoyed" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Best for" },
        { field: "timing_note", label: "Hours" },
        { field: "price_band", label: "Cost" },
        { field: "price_unit", label: "Per" },
        { field: "worth_it", label: "Worth it" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    restaurants: {
      kind: "place",
      subcategory: "restaurants",
      label: "A restaurant or café",
      hint: base.place.hint,
      intro: base.place.intro,
      steps: [
        { ...contextStep(base.place, "name"), prompt: "What's the place called?" },
        firsthandStep("Have you been there with your child?", "Yes", SECONDHAND_SHORT),
        childAgeStep("How old was your child?"),
        contextStep(base.place, "what_is_it"),
        recommendStep("Would you recommend it with kids?"),
        ...whySteps({
          prompt: "What makes it work well with children?",
          placeholder: "e.g. crayons at the table and a patio they can wander",
          ask: "One more thing and this becomes really useful — what would you tell a friend who was deciding? The kids' menu, the space, how the staff were with children.",
          /* 12 Oct: after "Probably not" the simulated parent was asked what
             makes it work well with children. */
          didnt: {
            prompt: "What didn't work with the kids?",
            placeholder: "e.g. nowhere for a stroller and a 40-minute wait",
            ask: "Can you say a bit more about what didn't work? The wait, the space, how the staff were with children.",
          },
        }),
        caveatStep(
          "What should another parent know before going?",
          "The wait, the noise, when it gets busy. Nothing to flag? Just say so.",
          "e.g. go before 6 or wait an hour",
          "Anything worth knowing before going? The wait, the noise, when it gets busy.",
        ),
        townStep("Which town or neighborhood is it in?", neighborhoods),
        FORK_STEP,
        { id: "best_for", prompt: "What ages is it best for?", widget: "chips", options: AGE_BANDS, optional: true, when: wantsMore },
        detailText(
          "detail_note",
          "What makes it good for the adults too?",
          "e.g. proper coffee and a decent wine list",
          "Anything for the grown-ups — the coffee, the food, a quiet corner?",
        ),
        {
          id: "amenities",
          prompt: "Anything practical to know?",
          widget: "chips",
          options: RESTAURANT_AMENITIES,
          optional: true,
          when: wantsMore,
        },
        detailText(
          "timing_note",
          "Best time to go with children?",
          "e.g. weekday lunch, or before 5:30",
          "When does it work best with kids — a time of day, a day of the week?",
        ),
        EXTRA_NOTE_STEP,
      ],
      recap: [
        { field: "name", label: "Restaurant" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age at the time" },
        { field: "recommendation", label: "Recommend with kids" },
        { field: "what_makes_it_great", label: "Works with kids because" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "best_for", label: "Best for" },
        { field: "detail_note", label: "For the adults" },
        { field: "amenities", label: "Practical" },
        { field: "timing_note", label: "Best time" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    schools: {
      kind: "place",
      subcategory: "schools",
      label: "A school",
      hint: base.place.hint,
      intro: base.place.intro,
      steps: [
        { ...contextStep(base.place, "name"), prompt: "Which school?" },
        firsthandStep("Does your child go there, or did they?", "Yes, ours does or did"),
        childAgeStep("What grade or age was your child?"),
        contextStep(base.place, "what_is_it"),
        { id: "freshness", prompt: "Are they still there?", widget: "quick", options: SCHOOL_STILL },
        recommendStep("Would you recommend it?"),
        ...whySteps({
          prompt: "What do you especially like about the school?",
          placeholder: "e.g. teachers who know every family by name",
          ask: "One more thing and this becomes really useful — what would you tell a friend who was choosing a school? The teachers, the community, how your child settled in.",
          didnt: {
            prompt: "What didn't work for your family?",
            placeholder: "e.g. very little communication from the office",
            ask: "Can you say a bit more about what didn't work? The teachers, the communication, how your child settled in.",
          },
        }),
        caveatStep(
          "What should another parent know before applying?",
          "Deadlines, the waitlist, pick-up, the costs nobody mentions. Nothing to flag? Just say so.",
          "e.g. apply a full year ahead",
          "Anything worth knowing before someone else applies? Deadlines, the waitlist, a cost that isn't obvious.",
        ),
        townStep("Which town is it in?", neighborhoods),
        FORK_STEP,
        detailText(
          "who_for",
          "What kind of child thrives there?",
          "e.g. a curious kid who likes structure",
          "Who would you send there? A temperament, a learning style, a situation.",
        ),
        .../* "if any" (12 Oct): a public school's answer is Free. */
        priceSteps("Roughly what is the tuition per month, if any?", undefined, SCHOOL_TUITION_BAND),
        EXTRA_NOTE_STEP,
      ],
      recap: [
        { field: "name", label: "School" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Grade or age" },
        { field: "freshness", label: "Still there" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What's good" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Thrives there" },
        { field: "price_band", label: "Tuition per month" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    specialists: {
      kind: "doctor",
      subcategory: "specialists",
      label: "A specialist or family service",
      hint: base.doctor.hint,
      intro: base.doctor.intro,
      steps: [
        { ...contextStep(base.doctor, "name"), prompt: "Which specialist or practice was it?" },
        firsthandStep("Did you use them personally?", "Yes", SECONDHAND_SHORT),
        childAgeStep("How old was your child, if relevant?"),
        { ...contextStep(base.doctor, "used_for"), prompt: "What did you use them for?" },
        {
          id: "freshness",
          prompt: "Are you still using them, or was it a while ago?",
          friendPrompt: "Is your friend still using them, or was it a while ago?",
          widget: "quick",
          options: SPECIALIST_STILL,
        },
        recommendStep("Would you recommend them?"),
        ...whySteps({
          prompt: "What made them especially good?",
          placeholder: "e.g. she made speech practice feel like a game",
          ask: "One more thing and this becomes really useful — what would you tell a friend who was choosing? How they were with your child, how they explained things, the results.",
          didnt: {
            prompt: "What didn't work for you?",
            placeholder: "e.g. hard to book and often late",
            ask: FOLLOW_UP.doctorDidnt,
          },
        }),
        caveatStep(
          "What should another parent know before contacting them?",
          "The wait, insurance, how to book. Nothing to flag? Just say so.",
          "e.g. the waitlist is about two months",
          "Anything worth knowing before someone else gets in touch? The wait, insurance, how they book.",
        ),
        townStep("Which town are they in?", neighborhoods),
        FORK_STEP,
        detailText(
          "who_for",
          "Who are they particularly good for?",
          "e.g. toddlers who are slow to talk",
          FOLLOW_UP.doctorWhoFor,
        ),
        ...priceSteps("Roughly what did you pay?"),
        {
          id: "appointment_ease",
          prompt: "Were they easy to book, or was there a wait?",
          widget: "quick",
          optional: true,
          options: APPOINTMENT_EASE,
          when: wantsMore,
        },
        EXTRA_NOTE_STEP,
      ],
      recap: [
        { field: "name", label: "Who" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age at the time" },
        { field: "used_for", label: "Used them for" },
        { field: "freshness", label: "Still using them" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What's good" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Good for" },
        { field: "price_band", label: "Paid" },
        { field: "appointment_ease", label: "Booking" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    parties: {
      kind: "doctor",
      subcategory: "parties",
      label: "A party vendor",
      hint: base.doctor.hint,
      intro: base.doctor.intro,
      steps: [
        { ...contextStep(base.doctor, "name"), prompt: "What's the venue, entertainer or vendor called?" },
        firsthandStep("Did you use them personally?", "Yes", SECONDHAND_SHORT),
        childAgeStep("How old was your child?"),
        { ...contextStep(base.doctor, "used_for"), prompt: "What did you use them for?" },
        recommendStep("Would you recommend them?"),
        ...whySteps({
          prompt: "What made them good?",
          placeholder: "e.g. the magician had every four-year-old in the room hooked",
          ask: "One more thing and this becomes really useful — what would you tell a friend who was planning a party? How the kids reacted, how easy they were to work with.",
          didnt: {
            prompt: "What didn't work for you?",
            placeholder: "e.g. arrived late and left early",
            ask: "Can you say a bit more about what didn't work? Timing, how they were with the kids, what you were promised.",
          },
        }),
        caveatStep(
          "What should another parent know before booking?",
          "How far ahead to book, the deposit, what's included. Nothing to flag? Just say so.",
          "e.g. book three months ahead for a weekend",
          "Anything worth knowing before someone else books? How far ahead, the deposit, what's included.",
        ),
        townStep("Which town are they in?", neighborhoods),
        FORK_STEP,
        { id: "best_for", prompt: "What ages are they best for?", widget: "chips", options: AGE_BANDS, optional: true, when: wantsMore },
        ...priceSteps("Roughly what did you pay?"),
        worthItStep("Was it worth it?"),
        detailText(
          "detail_note",
          "Anything particularly easy or difficult about the setup or logistics?",
          "e.g. they needed a power outlet near the yard",
          "Anything about setup, timing or clean-up another parent should plan for?",
        ),
        EXTRA_NOTE_STEP,
      ],
      recap: [
        { field: "name", label: "Who" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age at the time" },
        { field: "used_for", label: "Used them for" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What's good" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "best_for", label: "Best for" },
        { field: "price_band", label: "Paid" },
        { field: "worth_it", label: "Worth it" },
        { field: "detail_note", label: "Setup" },
        { field: "extra_note", label: "Anything else" },
      ],
    },

    products: {
      kind: "tip",
      subcategory: "products",
      label: "A product or gear",
      hint: base.tip.hint,
      intro: base.tip.intro,
      steps: [
        contextStep(base.tip, "what_is_it"),
        { id: "name", prompt: "What's the product?", widget: "text", maxLength: 80, placeholder: "e.g. the brand and model" },
        firsthandStep("Did you personally use it?", "Yes", SECONDHAND_SHORT),
        childAgeStep("How old was your child when you used it?"),
        recommendStep("Would you recommend it?"),
        ...whySteps({
          prompt: "What makes it good?",
          placeholder: "e.g. folds with one hand and fits in a small trunk",
          ask: "One more thing and this becomes really useful — what would you tell a friend who was buying one? What it does better, how long it lasted.",
          /* 12 Oct: "Don't buy the Graco 4Ever" was then asked what makes it good. */
          didnt: {
            prompt: "What didn't work for you?",
            placeholder: "e.g. too wide for our back seat",
            ask: "Can you say a bit more about what didn't work? The size, how it held up, what you'd warn a friend about.",
          },
        }),
        caveatStep(
          "What should another parent know before buying it?",
          "The size, the weight, what wears out. Nothing to flag? Just say so.",
          "e.g. it's heavier than it looks",
          "Anything worth knowing before someone else buys it? The size, the weight, what wears out.",
        ),
        FORK_STEP,
        detailText("who_for", "Who is it best for?", "e.g. city families who walk everywhere", "Who would you tell to get one? An age, a lifestyle, a situation."),
        ...priceSteps("What did you pay, roughly?"),
        worthItStep("Was it worth the money?"),
        detailText(
          "detail_note",
          "What would you buy instead, if anything?",
          "e.g. nothing — this is the one",
          "Is there anything you'd pick instead — or is this the one?",
        ),
        EXTRA_NOTE_STEP,
      ],
      recap: [
        { field: "name", label: "Product" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age when used" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What's good" },
        { field: "what_didnt_work", label: "Didn't work" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Best for" },
        { field: "price_band", label: "Paid" },
        { field: "worth_it", label: "Worth it" },
        { field: "detail_note", label: "Instead" },
        { field: "extra_note", label: "Anything else" },
      ],
    },
  };
}
