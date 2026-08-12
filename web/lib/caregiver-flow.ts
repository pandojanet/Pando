import {
  CAREGIVER_AGE_BANDS,
  CAREGIVER_AVAILABLE_FROM,
  CAREGIVER_DAYS,
  CAREGIVER_PAY_BANDS,
  CAREGIVER_STRENGTHS,
  CAREGIVER_TYPES,
} from "@/lib/caregiver-options";
import { marketOptions } from "@/lib/market-options";
import type { MarketId, Option } from "@/lib/types";

/**
 * 2C — the caregiver's own flow (G1–G10), as data.
 *
 * The same rule as `lib/questions.ts`: adding or reordering a question touches this
 * file and nothing else. The tap-first mechanics, the chips and the shell are all
 * already built for the parent flow and are reused as-is.
 *
 * What is *not* here, deliberately: anything a family said about them. A caregiver
 * must never see the nomination, the strengths a parent chose, or — above all — the
 * private note or the reason behind a hesitant "would you hire them again"
 * (invariant 12). This flow reads nothing and shows nothing from the parent side.
 */

export interface CaregiverAnswers {
  /* G1 — identity. First name and an initial, the same shape the parent's
     nomination stores, because a surname is never needed to be findable. */
  first_name: string;
  last_initial: string;
  phone: string;
  sms_consent: boolean;
  /* G2 — the profile may exist at all. */
  profile_consent: boolean;
  /* G3–G7 */
  roles_wanted: string[];
  age_experience: string[];
  strengths: string[];
  areas_served: string[];
  drives: string | null;
  days_available: string[];
  available_from: string | null;
  hours_note: string;
  rate_band: string | null;
  /* G8–G10 — three separate permissions, never one switch. */
  open_to_reference_intros: boolean;
  appear_in_answers: boolean;
  open_to_introductions: boolean;
}

export const EMPTY_CAREGIVER_ANSWERS: CaregiverAnswers = {
  first_name: "",
  last_initial: "",
  phone: "",
  sms_consent: false,
  profile_consent: false,
  roles_wanted: [],
  age_experience: [],
  strengths: [],
  areas_served: [],
  drives: null,
  days_available: [],
  available_from: null,
  hours_note: "",
  rate_band: null,
  open_to_reference_intros: false,
  appear_in_answers: false,
  open_to_introductions: false,
};

/** The keys a tap screen can write. Excludes identity, consent and permissions. */
export type TapKey =
  | "roles_wanted"
  | "age_experience"
  | "strengths"
  | "areas_served"
  | "drives"
  | "days_available"
  | "available_from"
  | "rate_band";

export interface CaregiverQuestion {
  key: TapKey;
  label: string;
  mode: "single" | "multi";
  options: Option[];
  layout?: "wrap" | "grid";
}

export interface CaregiverStep {
  id: string;
  eyebrow: string;
  title: string;
  help?: string;
  questions: CaregiverQuestion[];
  /** G6 only — one optional line of free text, for what chips cannot say. */
  freeText?: { key: "hours_note"; label: string; placeholder: string };
}

const YES_NO: Option[] = [
  { id: "yes", label: "Yes, I drive" },
  { id: "no", label: "No" },
];

/**
 * The tap screens, in the client's G-order. Every answer here is optional: a
 * caregiver who only wants to say "I do occasional sitting, evenings, in these two
 * neighborhoods" has said something useful, and demanding the rest would be asking
 * a person for a CV before they have decided to be listed at all.
 */
export function caregiverSteps(market: MarketId): CaregiverStep[] {
  const neighborhoods = marketOptions(market, "neighborhoods");

  return [
    {
      id: "roles",
      eyebrow: "G3 · What you do",
      title: "What kind of work are you looking for?",
      help: "Pick as many as fit. This is what a family is asking about when they ask Pando.",
      questions: [
        {
          key: "roles_wanted",
          label: "Kind of care",
          mode: "multi",
          options: CAREGIVER_TYPES,
        },
      ],
    },
    {
      id: "ages",
      eyebrow: "G4 · Experience",
      title: "Which ages have you looked after?",
      help: "What you've actually done, not what you'd be willing to do.",
      questions: [
        {
          key: "age_experience",
          label: "Ages",
          mode: "multi",
          options: CAREGIVER_AGE_BANDS,
        },
      ],
    },
    {
      id: "strengths",
      eyebrow: "G4 · Experience",
      title: "What are you especially good at?",
      help: "The same list families choose from, so what you say and what they look for meet.",
      questions: [
        {
          key: "strengths",
          label: "Strengths",
          mode: "multi",
          options: CAREGIVER_STRENGTHS,
        },
      ],
    },
    {
      id: "areas",
      eyebrow: "G5 · Where",
      title: "Where can you work?",
      help: "Only the areas you'd actually travel to.",
      questions: [
        {
          key: "areas_served",
          label: "Areas",
          mode: "multi",
          options: neighborhoods,
          layout: "grid",
        },
        { key: "drives", label: "Driving", mode: "single", options: YES_NO },
      ],
    },
    {
      id: "when",
      eyebrow: "G6 · When",
      title: "When are you usually free?",
      help: "Days, not a timetable — a family asks about a Friday night, not a calendar slot.",
      questions: [
        {
          key: "days_available",
          label: "Days",
          mode: "multi",
          options: CAREGIVER_DAYS,
        },
        {
          key: "available_from",
          label: "Able to start",
          mode: "single",
          options: CAREGIVER_AVAILABLE_FROM,
        },
      ],
      freeText: {
        key: "hours_note",
        label: "Anything about your hours a family should know?",
        placeholder: "Optional — e.g. school pickups only until June",
      },
    },
    {
      id: "rate",
      eyebrow: "G7 · Rate",
      title: "What do you charge?",
      help: "A range, never a number, and never shown as yours: Pando answers with the range for the area so a family arrives with a fair offer instead of a guess.",
      questions: [
        {
          key: "rate_band",
          label: "Rate",
          mode: "single",
          options: CAREGIVER_PAY_BANDS,
        },
      ],
    },
  ];
}

/** Selections for one question, so the flow never hands a chip group a null. */
export function selectionsFor(
  key: TapKey,
  answers: CaregiverAnswers,
): string[] {
  const value = answers[key];
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value !== "" ? [value] : [];
}

export const SINGLE_KEYS = new Set<TapKey>([
  "drives",
  "available_from",
  "rate_band",
]);
