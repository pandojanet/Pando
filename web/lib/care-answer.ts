/**
 * What an answer about a caregiver says, and how well she fits the question.
 *
 * Pure and free of runtime imports, like `answer.ts` and `matching.ts`, so a
 * plain node test can load it.
 *
 * ## Why this exists (29 Sep)
 *
 * The first answer a person reads about a nanny was the same shape as one about
 * a music class: "2 parents near you have used Elena V., full-time care in San
 * Marino." Everything a parent actually chooses on was missing, although the
 * caregiver had agreed to all of it being shown (`CAREGIVER_CONSENT_TEXT.listing`
 * - "my first name, what I'm good with, my areas and my rate range"): which ages
 * she works with, what she is good at, what she charges. And her place in the
 * list came from one number, how many families had employed her, so a newborn
 * night nurse was offered to somebody asking about after-school pick-ups.
 *
 * ## What is *not* here, deliberately
 *
 *  - **No note about her, ever.** A parent's private note and the reason behind a
 *    hesitant hire-again never leave the admin surface (invariant 12); nothing
 *    in this file reads one.
 *  - **No availability.** Her consent names four things and days or a start date
 *    is not one of them.
 *  - **No pay band from a parent's nomination.** That belongs to a separate
 *    decision (`pay_benchmark_consent`); the only rate shown is her own.
 *
 * ## Fit ranks and never filters
 *
 * The rule the rest of retrieval follows (4 Sep): a wrong reading re-orders a
 * list and cannot make the right person vanish. A caregiver who lists no ages
 * at all is not penalised - an empty profile is unknown, not a mismatch.
 */

export interface CareProfile {
  /** `CAREGIVER_AGE_BANDS` ids: baby, toddler, preschool, grade, tween. */
  ages: readonly string[];
  /** `CAREGIVER_STRENGTHS` ids. */
  strengths: readonly string[];
  /** `CAREGIVER_TYPES` ids. */
  roles: readonly string[];
  /** `CAREGIVER_PAY_BANDS` id. */
  rate: string | null;
}

const AGE_WORDS: Record<string, string> = {
  baby: "babies",
  toddler: "toddlers",
  preschool: "preschoolers",
  grade: "school-age kids",
  tween: "older kids",
};

/** The matcher's bands (`bandsInQuestion`) onto the caregiver's five. */
const BAND_TO_AGE: Record<string, string> = {
  expecting: "baby",
  baby: "baby",
  toddler: "toddler",
  preschool: "preschool",
  grade: "grade",
  tween: "tween",
  teen: "tween",
};

const ROLE_WORDS: Record<string, string> = {
  occasional_sitting: "occasional sitting",
  regular_part_time: "part-time care",
  full_time: "full-time care",
  night_newborn: "night and newborn care",
  before_after_school: "before and after-school care",
};

/**
 * Said the way a parent would say it. GSM-7 by construction: no dash outside
 * the basic set, nothing typographic.
 */
const STRENGTH_WORDS: Record<string, string> = {
  calm_with_shy: "calm with a shy kid",
  plays_actively: "plays actively",
  reliable: "reliable and on time",
  newborns: "newborn experience",
  toddlers: "great with toddlers",
  big_kids: "great with older kids",
  homework: "helps with homework",
  special_needs: "additional needs experience",
  bilingual: "bilingual",
  drives: "drives and can do pickups",
  cooks: "handles meals",
  cpr: "CPR and first aid",
  no_screens: "not a screens babysitter",
  flexible_hours: "flexible hours",
};

/** Salaried and "prefer not to say" say nothing a parent can compare. */
const RATE_WORDS: Record<string, string> = {
  under_18: "under $18/hr",
  "18_22": "$18-22/hr",
  "22_26": "$22-26/hr",
  "26_32": "$26-32/hr",
  over_32: "$32+/hr",
};

/** A strength that only repeats the ages already listed adds nothing. */
function repeatsAges(strength: string, ages: readonly string[]): boolean {
  return (
    (strength === "toddlers" && ages.includes("toddler")) ||
    (strength === "newborns" && ages.includes("baby")) ||
    (strength === "big_kids" && (ages.includes("grade") || ages.includes("tween")))
  );
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export interface CareFacts {
  /** For the lead: "Works with toddlers. Reliable and on time. Rate: $22-26/hr." */
  full: string | null;
  /** For a short line: "works with toddlers, $22-26/hr". */
  brief: string | null;
}

const MAX_STRENGTHS = 3;

export function careFacts(profile: CareProfile): CareFacts {
  const ages = profile.ages.filter((a) => AGE_WORDS[a]);
  /* School-age and tween read as one thing to a parent: "school-age kids and
     older kids" said the same range twice. */
  const ageWords =
    ages.includes("grade") && ages.includes("tween")
      ? [
          ...ages.filter((a) => a !== "grade" && a !== "tween").map((a) => AGE_WORDS[a]),
          "school-age and older kids",
        ]
      : ages.map((a) => AGE_WORDS[a]);
  const ageText = ageWords.length > 0 ? joinWords(ageWords) : null;
  const strengths = profile.strengths
    .filter((s) => STRENGTH_WORDS[s] && !repeatsAges(s, ages))
    .slice(0, MAX_STRENGTHS)
    .map((s) => STRENGTH_WORDS[s]);
  const rate = profile.rate ? (RATE_WORDS[profile.rate] ?? null) : null;

  const sentences: string[] = [];
  if (ageText) sentences.push(`Works with ${ageText}.`);
  if (strengths.length > 0) {
    /* Commas, not "and": several of the phrases contain one already
       ("reliable and on time", "CPR and first aid"). */
    const s = strengths.join(", ");
    sentences.push(`${s.charAt(0).toUpperCase()}${s.slice(1)}.`);
  }
  if (rate) sentences.push(`Rate: ${rate}.`);

  const brief = [ageText ? `works with ${ageText}` : null, rate].filter(
    Boolean,
  ) as string[];

  return {
    full: sentences.length > 0 ? sentences.join(" ") : null,
    brief: brief.length > 0 ? brief.join(", ") : null,
  };
}

/* What the question is asking for, read from its words. Deliberately a short
   list of phrases people actually use, and every one of them only ever adds to
   a score: nothing here can remove a caregiver from an answer. */
const ROLE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(after[- ]?school|before[- ]?school|school pick ?ups?|school runs?)\b/i, "before_after_school"],
  [/\b(newborn|night nurse|overnight|night nanny|postpartum|doula)\b/i, "night_newborn"],
  [/\bfull[- ]?time\b/i, "full_time"],
  [/\b(part[- ]?time|few days a week|couple of days|regularly)\b/i, "regular_part_time"],
  [/\b(date night|occasional|once in a while|sitter|babysit\w*|evening out|night out)\b/i, "occasional_sitting"],
];

const STRENGTH_PATTERNS: Array<[RegExp, string]> = [
  [/\b(bilingual|spanish|mandarin|chinese|french)\b/i, "bilingual"],
  [/\b(drives?|driving|pick ?ups?)\b/i, "drives"],
  [/\b(special needs|autis\w*|adhd|additional needs)\b/i, "special_needs"],
  [/\bhomework\b/i, "homework"],
  [/\b(cpr|first aid)\b/i, "cpr"],
  [/\b(cook\w*|meals?)\b/i, "cooks"],
];

export interface CareFit {
  /** Higher is closer. Zero means the question said nothing this could match. */
  score: number;
  /** What she matches, in a parent's words: "toddlers", "full-time care". */
  fits: string[];
  /** The kind of care the question asked for that she offers, as a `CAREGIVER_TYPES` id. */
  role: string | null;
}

/**
 * How closely a caregiver matches what was asked.
 *
 * `bands` is what retrieval already computed (the question's own age words,
 * else the asker's children), so the age the parent typed and the age Pando
 * knows go through one rule.
 */
export function careFit(
  question: string,
  bands: readonly string[],
  profile: CareProfile,
): CareFit {
  let score = 0;
  const fits: string[] = [];
  let role: string | null = null;

  const wanted = [...new Set(bands.map((b) => BAND_TO_AGE[b]).filter(Boolean))];
  const listed = profile.ages.filter((a) => AGE_WORDS[a]);
  for (const age of wanted) {
    if (listed.includes(age)) {
      score += 3;
      fits.push(AGE_WORDS[age]);
    }
  }
  /* Asked for an age she does not list, and she lists some: further down, never
     out. An empty list is unknown rather than a mismatch. */
  if (wanted.length > 0 && listed.length > 0 && !wanted.some((a) => listed.includes(a))) {
    score -= 2;
  }

  for (const [pattern, kind] of ROLE_PATTERNS) {
    if (!pattern.test(question)) continue;
    if (profile.roles.includes(kind)) {
      score += 2;
      fits.push(ROLE_WORDS[kind]);
      role = role ?? kind;
    }
  }
  for (const [pattern, strength] of STRENGTH_PATTERNS) {
    if (!pattern.test(question)) continue;
    if (profile.strengths.includes(strength)) {
      score += 1;
      fits.push(STRENGTH_WORDS[strength]);
    }
  }
  return { score, fits: [...new Set(fits)], role };
}
