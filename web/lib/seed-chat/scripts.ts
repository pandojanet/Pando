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
import type { Fields, Script, ShareKind } from "./types";

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

export function buildScripts(
  market: MarketId,
  ownPlaces: readonly string[] = [],
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
  const curated: Option[] = marketOptions(market, "neighborhoods");
  const known = new Set(curated.map((o) => o.label.trim().toLowerCase()));
  const neighborhoods: Option[] = [
    ...curated,
    ...ownPlaces
      .map((p) => p.trim())
      .filter((p) => p !== "" && !known.has(p.toLowerCase()))
      .map((p) => ({ id: p, label: p })),
  ];

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
      label: "An activity or class",
      hint: "Music, swim, dance, sports, camp",
      intro: "Great — let's do one activity or class at a time.",
      steps: [
        {
          id: "name",
          prompt: "What's it called?",
          aside: "Start typing — Pando probably knows it, and then it fills in the rest.",
          widget: "place",
          searchCategory: "baby_activities",
          maxLength: 80,
          placeholder: "e.g. Little Maestros",
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
          aside: "Tap every age that applies.",
          widget: "ages",
        },
        {
          id: "freshness",
          prompt: "When did they last do it?",
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
        },
        {
          id: "what_didnt_work",
          prompt: "What didn't work for you or your child?",
          aside: "One line is plenty.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. too big a group for a shy child",
          when: doesNotRecommend,
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
      hint: "Park, library, indoor play, café",
      intro: "Places are easy — a few taps and a sentence.",
      steps: [
        {
          id: "name",
          prompt: "What's the place?",
          widget: "text",
          maxLength: 80,
          placeholder: "e.g. Victory Park playground",
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
          aside: "Tap every age that applies.",
          widget: "ages",
        },
        {
          id: "freshness",
          prompt: "When did you last go?",
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
      label: "A doctor or medical provider",
      hint: "Pediatrician, dentist, specialist",
      intro: "Great — one doctor or practice at a time.",
      steps: [
        {
          id: "name",
          prompt: "Which practice or doctor?",
          widget: "text",
          maxLength: 80,
          placeholder: "Name",
        },
        {
          id: "firsthand",
          prompt: "Is it your child's doctor?",
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
          prompt: "Are you still seeing them?",
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
        },
        {
          id: "what_didnt_work",
          prompt: "What didn't work for you?",
          aside: "One line is plenty.",
          widget: "text",
          maxLength: 400,
          placeholder: "e.g. hard to reach after hours",
          when: doesNotRecommend,
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
        },
        {
          id: "location",
          prompt: "Which town is it in?",
          widget: "chips",
          options: neighborhoods,
          optional: true,
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
        { field: "name", label: "Doctor" },
        { field: "location", label: "Where" },
        { field: "firsthand", label: "Your child's doctor" },
        { field: "child_age", label: "Age at the time" },
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
      hint: "The thing you wish someone had told you",
      intro: "These are often the most useful things in the whole network.",
      steps: [
        {
          id: "topic",
          prompt: "What's it about?",
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
