import { marketOptions } from "../market-options";
import {
  CAREGIVER_AGE_BANDS as AGE_BANDS,
  CAREGIVER_BENEFITS,
  CAREGIVER_FIT,
  CAREGIVER_HOURS,
  CAREGIVER_PAY_BANDS as PAY_BANDS,
  CAREGIVER_SCHEDULE,
  CAREGIVER_STRENGTHS,
  CAREGIVER_TYPES,
} from "@/lib/caregiver-options";
import type { MarketId, Option } from "../types";
import type { Script, ShareKind } from "./types";

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

const PLACE_TYPES: Option[] = [
  { id: "park", label: "Park" },
  { id: "playground", label: "Playground" },
  { id: "library", label: "Library" },
  { id: "museum", label: "Museum" },
  { id: "indoor_play", label: "Indoor play" },
  { id: "pool", label: "Pool / splash pad" },
  { id: "trail", label: "Trail / hike" },
  { id: "cafe", label: "Kid-friendly café" },
];

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

/** R8's unit for the band above — exported for the same reason. */
export const PRICE_UNIT: Option[] = [
  { id: "per_class", label: "Class" },
  { id: "per_session", label: "Session" },
  { id: "per_month", label: "Month" },
  { id: "per_term", label: "Term" },
  { id: "per_camp_week", label: "Camp week" },
];

/** R9 — exported for the same reason as the two above. */
export const WORTH_IT: Option[] = [
  { id: "great_value", label: "Great value" },
  { id: "fair", label: "Fair" },
  { id: "pricey_worth_it", label: "Pricey but worth it" },
  { id: "pricey_not_worth_it", label: "Pricey, not worth it" },
  { id: "free", label: "It's free" },
];

const TIP_TOPICS: Option[] = [
  { id: "schedules", label: "Schedules & timing" },
  { id: "costs", label: "Costs & deals" },
  { id: "caregivers", label: "Finding caregivers" },
  { id: "birthdays", label: "Birthdays & parties" },
  { id: "rainy_days", label: "Rainy days" },
  { id: "food", label: "Eating out with kids" },
  { id: "new_to_area", label: "Being new here" },
  { id: "health", label: "Doctors & health" },
];

export function buildScripts(market: MarketId): Record<ShareKind, Script> {
  const neighborhoods: Option[] = marketOptions(market, "neighborhoods");

  return {
    activity: {
      kind: "activity",
      label: "An activity or class",
      hint: "Music, swim, dance, sports, camp",
      intro: "Great — let's do one activity or class at a time.",
      steps: [
        {
          id: "name",
          prompt: "What's it called?",
          widget: "text",
          maxLength: 80,
          placeholder: "e.g. Little Maestros",
        },
        {
          id: "location",
          prompt: "Where is it?",
          widget: "chips",
          options: neighborhoods,
          optional: true,
          aside: "Roughly is fine — pick every area it's easy to get to from.",
        },
        {
          /* The chips make it matchable; this makes it identifiable. Two places
             share a name often enough that an admin needs one distinguishing
             detail to tell submissions apart instead of merging them by hand. */
          id: "venue",
          prompt: "Anything more exact, if you remember?",
          aside: "A street or the venue — it's what tells two places with the same name apart.",
          widget: "text",
          maxLength: 80,
          optional: true,
          placeholder: "e.g. on Mission Ave",
        },
        {
          /**
           * R2. Firsthand or a friend's — and the answer changes what the record
           * is worth. Secondhand is welcome, labelled, and does not count toward
           * Founding, so the parent is told that here rather than discovering it.
           */
          id: "firsthand",
          prompt: "Did your own kid actually do it?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, ours did" },
            {
              id: "secondhand",
              label: "No — a friend's experience",
              hint: "Welcome, labelled secondhand",
            },
          ],
        },
        {
          id: "child_age",
          prompt: "How old was your child at the time?",
          aside: "This is what lets Pando match it to the right family later.",
          widget: "ages",
          /* Suggested from their birth years, but any age can be tapped — a
             friend's child isn't theirs. */
        },
        {
          /* R4. Recency, asked where the parent is still thinking about the place
             rather than at the end of the card. */
          id: "freshness",
          prompt: "When were you last there — still going?",
          widget: "quick",
          options: [
            { id: "current", label: "Still going now" },
            { id: "recent", label: "Within the last year" },
            { id: "over_year", label: "Over a year ago" },
            { id: "unsure", label: "Not sure anymore" },
          ],
        },
        {
          /* R5. How much exposure is behind the recommendation. */
          id: "how_much",
          prompt: "How long, or how often, did you go?",
          widget: "quick",
          optional: true,
          options: [
            { id: "tried_once", label: "Tried it once" },
            { id: "few_sessions", label: "A few sessions" },
            { id: "a_term", label: "A term or season" },
            { id: "a_year_plus", label: "A year or more" },
            { id: "weekly_ongoing", label: "Weekly, ongoing" },
          ],
        },
        {
          id: "recommendation",
          prompt: "Knowing what you know now, would you recommend it?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes" },
            { id: "yes_with_caveats", label: "Yes, with caveats" },
            { id: "probably_not", label: "Probably not" },
            { id: "no", label: "No" },
          ],
        },
        {
          id: "what_makes_it_great",
          prompt: "What makes it good?",
          aside: "The thing you'd actually say to a friend, not a review.",
          widget: "text",
          maxLength: 400,
          placeholder: "Small groups, and the teacher is unbelievably patient…",
        },
        {
          /* The client calls this the single most valuable question in the product,
             so it is asked in their words. Still skippable — a forced answer on the
             most nuanced question invites filler. */
          id: "caveat",
          prompt: "Anything a parent should know before signing up — even something small?",
          aside: "Parking, waitlists, the one teacher to avoid, the week it gets chaotic.",
          widget: "text",
          maxLength: 400,
          optional: true,
          /* The client counts "nothing notable" as an answered caveat for Founding,
             so the way out has to say that — not just "Skip". */
          skipLabel: "Nothing comes to mind",
          placeholder: "Saturdays get packed…",
        },
        {
          id: "who_for",
          prompt: "Who is it perfect for?",
          aside: "The kind of kid or family that gets the most out of it.",
          widget: "text",
          maxLength: 300,
          optional: true,
          placeholder: "A cautious toddler who warms up slowly…",
        },
        {
          id: "who_not_for",
          prompt: "And who might it not suit?",
          aside: "Just as useful as the recommendation itself — it's what stops a bad match.",
          widget: "text",
          maxLength: 300,
          optional: true,
          placeholder: "Not for a kid who needs a lot of structure…",
        },
        {
          id: "price_band",
          prompt: "Roughly what did you pay?",
          aside: "Per month, or per session for one-offs. A rough band is plenty.",
          widget: "quick",
          optional: true,
          options: PRICE_BAND,
        },
        {
          /* A band without a unit is unusable: $100 a month and $100 a term are
             different recommendations. */
          id: "price_unit",
          prompt: "And that was per…?",
          widget: "quick",
          when: (fields) =>
            typeof fields.price_band === "string" &&
            fields.price_band !== "" &&
            fields.price_band !== "free" &&
            fields.price_band !== "prefer_not_to_say",
          options: PRICE_UNIT,
        },
        {
          id: "worth_it",
          prompt: "Was it worth the money?",
          widget: "quick",
          options: WORTH_IT,
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
        },
      ],
      recap: [
        { field: "name", label: "Activity" },
        { field: "location", label: "Where" },
        { field: "venue", label: "Exactly" },
        { field: "firsthand", label: "Whose experience" },
        { field: "child_age", label: "Age at the time" },
        { field: "freshness", label: "Last there" },
        { field: "how_much", label: "How much" },
        { field: "recommendation", label: "Recommend" },
        { field: "what_makes_it_great", label: "What's good" },
        { field: "caveat", label: "Know first" },
        { field: "who_for", label: "Perfect for" },
        { field: "who_not_for", label: "Not for" },
        { field: "price_band", label: "Paid" },
        { field: "price_unit", label: "Per" },
        { field: "worth_it", label: "Worth it" },
        { field: "follow_up_ok", label: "Follow-ups" },
      ],
    },

    caregiver: {
      kind: "caregiver",
      label: "A caregiver",
      hint: "Sitter, nanny, tutor, coach",
      /* The client's July question set changed this outright: Pando does not
         contact the caregiver and does not store their details. At the end the
         parent gets a message to send themselves. */
      intro:
        "This one works differently — we never contact anyone, and we don't store their details. At the end I'll give you an invite you can send them yourself.",
      steps: [
        {
          /**
           * C1 — the hard gate. Firsthand only: a caregiver recommendation
           * relayed from someone else is not something Pando will carry.
           */
          id: "worked_for_you",
          prompt: "Did this caregiver work directly for your family?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, for us" },
            { id: "no", label: "No — someone else's" },
          ],
          stopIf: (value) =>
            value === "no"
              ? "Then I'll stop there and keep nothing. A caregiver recommendation only carries weight when it comes from the family who actually employed them — but an activity or a tip from a friend is genuinely useful, if you have one."
              : null,
        },
        {
          id: "type",
          prompt: "What kind of care was it?",
          widget: "quick",
          options: CAREGIVER_TYPES,
        },
        {
          id: "age_gate",
          prompt: "Are they 18 or older?",
          aside: "Pando never lists anyone under 18.",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, 18 or older" },
            { id: "no", label: "No, under 18" },
          ],
          stopIf: (value) =>
            value === "no"
              ? "Thank you for thinking of them — but Pando only ever lists caregivers who are 18 or older, so I'll stop there and keep nothing. Anything else you'd like to share?"
              : null,
        },
        {
          id: "name",
          prompt: "What's their name?",
          aside: "First name and last initial only — never a full name, never a number here.",
          widget: "name",
        },
        {
          id: "how_known",
          prompt: "How do you know them?",
          widget: "quick",
          options: [
            { id: "watched_my_kids", label: "They've watched my kids" },
            { id: "friends_caregiver", label: "A friend's caregiver we've used" },
            { id: "through_school", label: "Through our school" },
            { id: "neighbor", label: "Neighbor" },
            { id: "family_friend", label: "Family friend" },
          ],
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
           * Stage 1: "schedule pattern". Same ids as the caregiver's own
           * availability (2C, G6), because "she worked weekday mornings" and "I'm
           * free weekday mornings" is the match this data exists to make.
           */
          id: "schedule_pattern",
          prompt: "What did the week usually look like?",
          widget: "chips",
          options: CAREGIVER_SCHEDULE,
          optional: true,
        },
        {
          /* The ages they actually cared for — evidence, not an opinion about who
             they'd be good with. */
          id: "cared_for_ages",
          prompt: "How old were the kids they looked after?",
          widget: "chips",
          options: AGE_BANDS,
        },
        {
          /* Closed first: strengths are the matchable half, so they must not
             depend on extraction from free text. */
          id: "strengths",
          prompt: "What are they especially good at?",
          widget: "chips",
          options: CAREGIVER_STRENGTHS,
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
          id: "good_fit_for",
          prompt: "Which families are they a great fit for?",
          widget: "chips",
          options: CAREGIVER_FIT,
          optional: true,
        },
        {
          id: "caveat",
          prompt: "Anything a family should know up front?",
          /* This is free text about a named third party, so the promise has to be
             on the screen where it's typed: a person reads it, and it is never
             published word for word (spec §12, and the client's own condition). */
          aside: "Availability, scheduling, the practical things. A person reads this before anyone sees it, and we never publish it word for word.",
          widget: "text",
          maxLength: 400,
          optional: true,
          placeholder: "Books up early in the summer…",
        },
        {
          /* Deliberately a second question, not a longer first one: a concern you'd
             only say privately should not sit in the same box as scheduling. */
          id: "private_note",
          prompt: "Anything you'd only say privately?",
          aside: "This one never reaches another parent, in any form. Only Pando's team sees it, and it's used to decide whether to list them at all.",
          widget: "text",
          maxLength: 400,
          optional: true,
          placeholder: "Only if there's something…",
        },
        {
          id: "hire_again",
          prompt: "Would you hire them again?",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes" },
            { id: "hesitant", label: "Hesitant" },
            { id: "no", label: "No" },
          ],
          /* Anything other than a clear yes holds the nomination back from the
             invite step until a person has read it — the client's rule, and the
             parent is told so rather than finding out later. */
          holdIf: (value) =>
            value === "hesitant" || value === "no"
              ? "Thank you for being straight with me — that's more useful than a polite yes. This one goes to a person on our team, and I won't offer you the invite step for them in the meantime."
              : null,
        },
        {
          /* C7's branch. Restricted exactly like the private note: never shown,
             never AI-summarized, and able to pause a nomination quietly. */
          id: "hesitation_reason",
          prompt: "Comfortable telling Pando why?",
          aside: "Never shown to the caregiver, and never to a family. It goes only to our human review team.",
          widget: "text",
          maxLength: 400,
          optional: true,
          when: (fields) =>
            fields.hire_again === "hesitant" || fields.hire_again === "no",
          placeholder: "Only if you want to…",
        },
        {
          /**
           * C10, and why it earns its place, in the client's words: when a wonderful
           * nanny's hours end, parents scramble on Facebook to help her land with a
           * good family. Pando can matchmake quietly instead — with her consent,
           * and including a share if this family needs fewer hours.
           */
          id: "needs_horizon",
          prompt: "Do you expect your childcare needs to change in the next year?",
          aside: "When a nanny's hours end, parents scramble on Facebook to help her land somewhere good. Pando can do that quietly instead — with her consent, and nobody has to post anything publicly.",
          widget: "quick",
          optional: true,
          options: [
            { id: "3_months", label: "Yes — within 3 months" },
            { id: "6_months", label: "Yes — within 6 months" },
            { id: "12_months", label: "Yes — within a year" },
            { id: "unsure", label: "Unsure" },
            { id: "no_change", label: "No change expected" },
          ],
        },
        {
          id: "needs_change_type",
          prompt: "What kind of change?",
          widget: "quick",
          optional: true,
          when: (fields) =>
            typeof fields.needs_horizon === "string" &&
            fields.needs_horizon !== "" &&
            fields.needs_horizon !== "no_change",
          options: [
            { id: "fewer_hours", label: "Fewer hours" },
            { id: "role_ending", label: "Role ending" },
            { id: "full_to_part", label: "Full-time → part-time" },
            { id: "child_starting_school", label: "Child starting school" },
            { id: "moving", label: "Moving" },
            { id: "unsure", label: "Not sure yet" },
          ],
        },
        {
          id: "recontact_ok",
          prompt: "May Pando check back with you about it?",
          aside: "It uses your normal monthly allowance — never an extra text.",
          widget: "quick",
          optional: true,
          when: (fields) =>
            typeof fields.needs_horizon === "string" &&
            fields.needs_horizon !== "" &&
            fields.needs_horizon !== "no_change",
          options: [
            { id: "yes", label: "Yes, check back" },
            { id: "no", label: "No thanks" },
          ],
        },
        {
          id: "pay_band",
          prompt: "Roughly what did you pay?",
          aside: "Ranges only, and never shown next to their name.",
          widget: "quick",
          optional: true,
          options: PAY_BANDS,
        },
        {
          /**
           * Stage 1: "rate, hours and benefits" — the three that only mean
           * something together. Asked between the band and the benchmark consent on
           * purpose, so the yes below covers the whole picture rather than a number
           * that could describe two completely different jobs.
           */
          id: "hours_per_week",
          prompt: "Roughly how many hours a week?",
          widget: "quick",
          optional: true,
          options: CAREGIVER_HOURS,
          when: (fields) =>
            typeof fields.pay_band === "string" &&
            fields.pay_band !== "" &&
            fields.pay_band !== "prefer_not_to_say",
        },
        {
          id: "benefits",
          prompt: "Did anything come with the job?",
          aside: "Guaranteed hours and paid time off are what make one rate comparable to another.",
          widget: "chips",
          optional: true,
          options: CAREGIVER_BENEFITS,
          when: (fields) =>
            typeof fields.pay_band === "string" &&
            fields.pay_band !== "" &&
            fields.pay_band !== "prefer_not_to_say",
        },
        {
          /* A separate, explicit yes — the client asked for pay and permission to
             use it as a benchmark to be two decisions, not one. */
          id: "pay_benchmark_ok",
          prompt: "May Pando use that in anonymous pay ranges for the area?",
          aside: "Pooled with other parents' numbers. Never tied to you or to them.",
          widget: "quick",
          when: (fields) =>
            typeof fields.pay_band === "string" &&
            fields.pay_band !== "" &&
            fields.pay_band !== "prefer_not_to_say",
          options: [
            { id: "yes", label: "Yes, that's fine" },
            { id: "no", label: "No, keep it to yourselves" },
          ],
        },
        {
          id: "reference_willing",
          prompt: "If another parent asks about them, would you be willing to be a reference?",
          aside: "We'd ask you again each time, and you can always say no.",
          widget: "quick",
          options: [
            { id: "yes", label: "Yes, happy to" },
            { id: "maybe", label: "Ask me at the time" },
            { id: "no", label: "Prefer not to" },
          ],
        },
        {
          /**
           * C11. Pando never contacts them and never stores their details, so the
           * only way in is the parent's own message. Held back when the nomination
           * is under review: offering the invite for a caregiver a human hasn't
           * cleared would undo the hold.
           */
          id: "send_invite",
          prompt: "Want to invite them to Pando? I'll give you a message you can send right now.",
          aside: "You send it, not us. Nothing about them is stored until they accept and set up their own profile.",
          widget: "quick",
          when: (fields) => fields.review_hold !== "true",
          options: [
            { id: "yes", label: "Yes, show me the message" },
            { id: "later", label: "Maybe later" },
          ],
        },
      ],
      recap: [
        { field: "type", label: "Kind of care" },
        { field: "name", label: "Caregiver" },
        { field: "cared_for_ages", label: "Looked after" },
        { field: "how_known", label: "How known" },
        { field: "how_long", label: "How long" },
        { field: "last_worked", label: "Last worked" },
        { field: "strengths", label: "Good at" },
        { field: "what_makes_special", label: "In your words" },
        { field: "good_fit_for", label: "Great fit for" },
        { field: "caveat", label: "Know first" },
        { field: "private_note", label: "Private note" },
        { field: "hire_again", label: "Hire again" },
        { field: "needs_horizon", label: "Needs changing" },
        { field: "needs_change_type", label: "What changes" },
        { field: "recontact_ok", label: "Check back" },
        { field: "pay_band", label: "Paid" },
        { field: "pay_benchmark_ok", label: "Pay range use" },
        { field: "reference_willing", label: "Reference" },
        { field: "send_invite", label: "Invite" },
      ],
    },

    place: {
      kind: "place",
      label: "A place",
      hint: "Park, library, indoor play, café",
      intro: "Places are easy — three or four taps.",
      steps: [
        {
          id: "name",
          prompt: "What's the place?",
          widget: "text",
          maxLength: 80,
          placeholder: "e.g. Victory Park playground",
        },
        {
          id: "type",
          prompt: "What kind of place is it?",
          widget: "quick",
          options: PLACE_TYPES,
        },
        {
          id: "location",
          prompt: "Which area is it in?",
          widget: "chips",
          options: neighborhoods,
          optional: true,
        },
        {
          id: "best_for",
          prompt: "Who's it best for?",
          widget: "chips",
          options: AGE_BANDS,
          optional: true,
        },
        {
          id: "what_makes_it_great",
          prompt: "What makes it worth the trip?",
          widget: "text",
          maxLength: 400,
          placeholder: "Shade, clean bathrooms, and a fence…",
        },
        {
          id: "caveat",
          prompt: "Anything to know before going?",
          widget: "text",
          maxLength: 400,
          optional: true,
          placeholder: "Parking is brutal after 10am…",
        },
      ],
      recap: [
        { field: "name", label: "Place" },
        { field: "type", label: "Kind" },
        { field: "location", label: "Where" },
        { field: "best_for", label: "Best for" },
        { field: "what_makes_it_great", label: "Why go" },
        { field: "caveat", label: "Caveat" },
      ],
    },

    tip: {
      kind: "tip",
      label: "Something you learned",
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
          prompt: "What's the tip?",
          aside: "Say it the way you'd text it.",
          widget: "text",
          maxLength: 400,
          placeholder: "Sign up the week registration opens or you'll be waitlisted…",
        },
        {
          id: "best_for",
          prompt: "Who does this help most?",
          widget: "chips",
          options: AGE_BANDS,
          optional: true,
        },
      ],
      recap: [
        { field: "topic", label: "Topic" },
        { field: "tip", label: "Tip" },
        { field: "best_for", label: "Helps most" },
      ],
    },
  };
}

export const SHARE_ORDER: ShareKind[] = ["activity", "caregiver", "place", "tip"];
