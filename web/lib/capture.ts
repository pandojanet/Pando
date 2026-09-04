/**
 * M10.1 — adding a recommendation later, over SMS.
 *
 * The estimate: "lets any parent add a new activity or caregiver through chat
 * later, using the same structured capture as the Seed Tool." Pure, and free of
 * runtime imports, like every Phase 2 rule that decides what enters the graph.
 *
 * ## An activity can be added over SMS. A caregiver cannot.
 *
 * That boundary is the main decision in this file, and it is not about effort.
 * A caregiver nomination is gated by three invariants that a text message cannot
 * honestly satisfy:
 *
 *  - **invariant 14**, firsthand employment — the family must have employed
 *    them, and a secondhand nomination is refused rather than stored as a weaker
 *    record. The Seed Tool asks this as a hard gate with the consequence spelled
 *    out on screen (C1);
 *  - **invariant 2**, no minors, which is a `CHECK` and a question a parent has
 *    to be asked deliberately;
 *  - the **hesitant-hire hold** and its restricted note (invariant 12), which is
 *    a branch with a promise attached: the parent is told on the spot that the
 *    card is held for a person to read.
 *
 * None of those survives being reduced to "reply YES". So the SMS path for a
 * caregiver is a **link to the flow that asks properly** — which is also the
 * estimate's own words, "the same structured capture as the Seed Tool", read
 * literally. Refusing to collect something badly is not a missing feature.
 *
 * ## Why five questions and not eleven
 *
 * The Seed Tool asks R1–R11 because the parent is looking at a screen and every
 * answer is a tap. Over SMS each question is a round trip that may take a day,
 * so the set here is the smallest one that produces a record the rest of the
 * system can actually use: a name, a kind, whether they used it themselves,
 * whether they would recommend it, and anything another parent should know.
 * Everything a trust label rests on is in that list — `firsthand` and
 * `recommendation` are exactly what `trust-labels.ts` reads — and everything
 * else is an admin's follow-up rather than a fifth text.
 *
 * The neighborhood is **not** asked. It is read from the parent's profile, per
 * the 11 Aug rule that the graph is derived on the server and never taken from
 * the request body.
 */

export type CaptureStep = "kind" | "name" | "firsthand" | "recommend" | "detail";

/** In order. The capture walks this list and stops at the first unanswered. */
export const CAPTURE_STEPS: CaptureStep[] = [
  "kind",
  "name",
  "firsthand",
  "recommend",
  "detail",
];

export interface CaptureOption {
  /** What gets stored. Must match the vocabulary the Seed Tool already uses. */
  value: string;
  /** What the parent may type. Matched exactly, case-insensitively. */
  words: string[];
}

export interface CaptureQuestion {
  step: CaptureStep;
  /** The outbound text. One question, always — the 5.4 rule. */
  prompt: string;
  /** Closed questions carry their options; free-text ones do not. */
  options?: CaptureOption[];
  /** A step the parent may decline. Skipping is an answer, not a gap. */
  skippable?: boolean;
}

/**
 * The kinds, matching `shares.kind` exactly.
 *
 * `caregiver` is deliberately absent from the options and handled separately —
 * see the header. It is still *recognised*, because a parent who types "nanny"
 * needs the link rather than "sorry, I didn't understand".
 */
export const CAPTURE_QUESTIONS: Record<CaptureStep, CaptureQuestion> = {
  kind: {
    step: "kind",
    prompt:
      "Pando: happy to add it. Is it a class, a camp, a place, or a tip? Reply with one word.",
    /**
     * The values are `share_kind` exactly, and **a camp is stored as an
     * activity** — that enum has four members and camp is not one of them.
     *
     * Worth knowing rather than "fixing": camps are a first-class category in
     * the *taxonomy* (§8.4/§15.3, a `market_options` category the questionnaire
     * offers), and they have never been a `shares.kind`. So a camp is offered as
     * a word a parent can say, because that is what they will type, and it lands
     * where every other camp in the database already is. Adding a fifth enum
     * member is a migration plus a freshness policy plus a label, not a line
     * here.
     */
    options: [
      { value: "activity", words: ["CLASS", "ACTIVITY", "LESSON", "LESSONS"] },
      { value: "activity", words: ["CAMP", "CAMPS"] },
      { value: "place", words: ["PLACE", "PARK", "SPOT"] },
      { value: "tip", words: ["TIP", "ADVICE"] },
    ],
  },
  name: {
    step: "name",
    prompt: "Pando: what is it called? Just the name is fine.",
  },
  firsthand: {
    step: "firsthand",
    /**
     * R1, and the one question that cannot be skipped.
     *
     * Everything `trust-labels.ts` says about a record rests on this being true
     * of somebody: "Shared by a local parent" needs a parent who was there.
     * Secondhand is welcome and is labelled as such — it is never refused, and
     * it is never enough for a trust label on its own.
     */
    prompt:
      "Pando: did you use it yourself, or did you hear about it from someone? Reply USED or HEARD.",
    options: [
      { value: "yes", words: ["USED", "US", "ME", "MYSELF", "YES", "FIRSTHAND"] },
      { value: "no", words: ["HEARD", "FRIEND", "SECONDHAND", "NO"] },
    ],
  },
  recommend: {
    step: "recommend",
    /**
     * R10. Three answers, not two, because "vouched" means a parent who would
     * actually recommend it — and a parent can tell Pando about something and
     * stop short of that. Collapsing the caveat into a yes is what would make
     * the label meaningless.
     */
    prompt:
      "Pando: would you recommend it to another parent? Reply YES, YES BUT (if there's a catch), or NO.",
    options: [
      { value: "yes", words: ["YES", "Y", "DEFINITELY", "ABSOLUTELY"] },
      {
        value: "yes_with_caveats",
        words: ["YES BUT", "YES, BUT", "MOSTLY", "WITH CAVEATS", "MAYBE"],
      },
      { value: "no", words: ["NO", "N", "NOPE"] },
    ],
  },
  detail: {
    step: "detail",
    prompt:
      "Pando: last one — anything another parent should know? Reply with a sentence, or SKIP.",
    skippable: true,
  },
};

/** Words that start a capture. Exact on the whole message, as everywhere else. */
const START_WORDS = ["ADD", "RECOMMEND", "SHARE", "SUGGEST"];

export function isCaptureStart(body: string): boolean {
  const word = body.trim().toUpperCase().replace(/[.!,]+$/, "");
  return START_WORDS.includes(word);
}

/**
 * Words that mean a caregiver, at any point in the capture.
 *
 * Checked as a **substring**, unlike everything else here, and the asymmetry is
 * deliberate: the cost of a false positive is a parent being sent to a web form
 * that can take their nomination properly, and the cost of a false negative is a
 * caregiver record built by a path that cannot ask the 18+ question. Those are
 * not comparable, so this one errs toward the link.
 */
const CAREGIVER_WORDS = [
  "NANNY",
  "SITTER",
  "BABYSITTER",
  "CAREGIVER",
  "AU PAIR",
  "CHILDMINDER",
  "NANNIES",
];

/**
 * Is this message *offering* something rather than asking about it?
 *
 * The distinction the caregiver refusal turns on. "I want to **add** our nanny
 * Marisol" is a nomination and must be sent to a form that can ask the three
 * questions a text cannot — whether the family employed them (invariant 14),
 * whether they are 18 (invariant 2), and the private note behind a hesitant
 * rehire (invariant 12). "Any good nannies near Altadena?" is a question, and
 * answering it is right.
 *
 * The verbs are `START_WORDS` read loosely — the same vocabulary the capture
 * already owns, matched **anywhere** in the sentence rather than as the whole
 * message, because a parent volunteering something writes a sentence and not a
 * command.
 *
 * ⚠ Deliberately **not** "is this question-shaped". The obvious inverse test
 * fails on "we need a nanny three days a week", which has no question mark and
 * no interrogative and is plainly a request for help — sending that parent a
 * nomination form would be the redirect firing on exactly the person it is not
 * for.
 */
const OFFER_WORDS =
  /\b(add|adding|added|recommend|recommending|share|sharing|suggest|suggesting|vouch|vouching)\b/i;

export function offersSomething(body: string): boolean {
  return OFFER_WORDS.test(body);
}

export function mentionsCaregiver(body: string): boolean {
  const text = body.trim().toUpperCase();
  return CAREGIVER_WORDS.some((word) => text.includes(word));
}

/** Anywhere in the capture, this stops it. */
const CANCEL_WORDS = ["CANCEL", "STOP ADDING", "NEVER MIND", "NEVERMIND", "FORGET IT"];

export function isCaptureCancel(body: string): boolean {
  const word = body.trim().toUpperCase().replace(/[.!,]+$/, "");
  return CANCEL_WORDS.includes(word);
}

const SKIP_WORDS = ["SKIP", "NONE", "NOTHING", "NA", "N/A", "-"];

/**
 * Reading one answer.
 *
 * A closed step matches its options exactly and returns **null** for anything
 * else — the 27 Aug rule that a parser refuses to guess. A free-text step takes
 * what was written, trimmed, and treats a skip word as an explicit decline
 * rather than as text.
 */
export type CaptureAnswer =
  | { ok: true; value: string }
  | { ok: true; skipped: true }
  | { ok: false };

/**
 * Would the capture read this message as *skip this question*?
 *
 * Both halves matter, and the step is the half that is easy to drop. `SKIP` is
 * also a PASS keyword, so `handleInboundMessage` has to decide which of the two
 * a mid-capture message means — and it may only hand it to the capture when the
 * capture would actually treat it as a decline. At a step that is **not**
 * skippable the word is read as an ordinary answer: on `name`, "SKIP" would
 * become the record's name.
 */
export function isSkipWord(body: string): boolean {
  return SKIP_WORDS.includes(body.trim().toUpperCase().replace(/[.!,]+$/, ""));
}

export function readsAsSkip(step: CaptureStep, body: string): boolean {
  return Boolean(CAPTURE_QUESTIONS[step].skippable) && isSkipWord(body);
}

export function readAnswer(step: CaptureStep, body: string): CaptureAnswer {
  const question = CAPTURE_QUESTIONS[step];
  const trimmed = body.trim();
  const word = trimmed.toUpperCase().replace(/[.!,]+$/, "");

  if (question.skippable && SKIP_WORDS.includes(word)) return { ok: true, skipped: true };

  if (question.options) {
    for (const option of question.options) {
      if (option.words.includes(word)) return { ok: true, value: option.value };
    }
    return { ok: false };
  }

  /* A free-text answer. Length-capped so one very long text cannot become a
     column value nobody can read in the review queue; the parent is not told
     off for it, and nothing is silently discarded that a reviewer would miss. */
  if (trimmed.length === 0) return { ok: false };
  return { ok: true, value: trimmed.slice(0, 500) };
}

/**
 * What to ask next, given what has been answered.
 *
 * Returns null when the capture is complete. One question at a time, always:
 * two in a text get one answer back and then Pando has to guess which.
 */
export function nextStep(answers: Record<string, unknown>): CaptureStep | null {
  for (const step of CAPTURE_STEPS) {
    if (!(step in answers)) return step;
  }
  return null;
}

/**
 * What the finished capture becomes.
 *
 * Deliberately not a `shares` row and a `share_contributions` row — that is the
 * repo's job. This is the shape, so the mapping can be asserted without a
 * database, including the two values that are never taken from the parent.
 */
export interface CapturedCard {
  kind: string;
  name: string;
  firsthand: boolean;
  recommendation: string;
  detail: string | null;
}

export function cardFrom(answers: Record<string, unknown>): CapturedCard | null {
  const kind = typeof answers.kind === "string" ? answers.kind : null;
  const name = typeof answers.name === "string" ? answers.name : null;
  const firsthand = answers.firsthand;
  const recommendation =
    typeof answers.recommend === "string" ? answers.recommend : null;
  if (!kind || !name || !recommendation) return null;
  if (firsthand !== "yes" && firsthand !== "no") return null;

  const detail = typeof answers.detail === "string" ? answers.detail : null;
  return {
    kind,
    name,
    firsthand: firsthand === "yes",
    recommendation,
    detail: detail && detail.length > 0 ? detail : null,
  };
}

/** The message that ends a capture. Says what happens next, and promises nothing. */
export function captureSavedSms(name: string): string {
  return `Pando: got it — ${name} is saved. A person reads every new recommendation before it reaches anyone, so it won't show up straight away. Thank you. Reply STOP to opt out, HELP for help.`;
}

/**
 * The caregiver deflection.
 *
 * ⚠️ **Registered copy, like everything in `sms-templates.ts`** — this lives here
 * rather than there only because it is part of the capture script; check it
 * against the A2P samples with the rest before the first live run.
 *
 * It does not say no. A parent offering to recommend somebody who looked after
 * their child is doing the single most valuable thing in this product, and the
 * reason for the link is that the questions are ones Pando has to ask carefully
 * — not that the offer is unwelcome.
 *
 * **The link is `/share`, not `/caregiver`**, and confusing the two would send a
 * parent to the wrong flow entirely: `/caregiver` is where a caregiver signs
 * *themselves* up (2C), while nominating somebody is the seed capture's own
 * caregiver card. The domain is written out rather than composed from an env
 * value, exactly as `caregiverInviteMessage` does — a registered sample cannot
 * have a variable in it.
 */
export function caregiverRedirectSms(): string {
  return "Pando: for a nanny or sitter we ask a few careful questions first — including whether you employed them yourself. Takes two minutes: pando.is/share Reply STOP to opt out, HELP for help.";
}
