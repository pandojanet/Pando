/**
 * RCS quick-reply buttons — the kinds, their buttons, and the templates.
 *
 * Pure and import-free, so `npm run test:rich` loads it in plain node. The plan and
 * the research behind it: docs/rcs-templates.md; the operator's side:
 * docs/rcs-quick-replies.md.
 *
 * ## What a kind is
 *
 * A message that already exists as text can ride on a Twilio Content Template that
 * holds **two** types: a `twilio/card` (no media, so RCS shows it as text with a
 * row of buttons) for a phone that has RCS, and a `twilio/text` for one that does
 * not. Twilio chooses by the recipient's device; Pando never asks which.
 *
 * A kind is one **set of buttons**, not one message: "Yes / No" serves the Network
 * Ask offer and "did it help?" alike, because a template's buttons are fixed and
 * the words it carries are the variables.
 *
 * ## Two variables (29 Oct)
 *
 * `{{1}}` is the card's text and `{{2}}` the SMS text. The SMS text is exactly what
 * Pando sent before RCS existed — several are registered A2P samples and may not
 * change. The card text is the same message without the sentence that tells the
 * person what to type ("Reply 1 for…"), because the buttons say it; the first
 * walk on a real phone showed the two side by side and it read as a mistake.
 * Where nothing needs dropping the caller passes no card and the body is both.
 *
 * ## Why the button titles are what they are
 *
 * A tap reaches the inbound webhook as `ButtonPayload` (the id, returned exactly)
 * and `ButtonText`, and — tested on a real phone, 29 Oct — with the title in
 * `Body` as well. Every title is a word the existing parsers already read as the
 * answer it stands for, and `tapText` turns a known id back into that word, so a
 * tap is understood by either route. `test:rich` fails if a title stops parsing.
 *
 * Titles are at most 20 characters, the limit Twilio documents for a quick-reply
 * button on a card; a card without media takes up to 11 buttons.
 *
 * It is **off until an operator sets a kind's content SID** (`RICH_ENV`). Unset,
 * `sendSms` sends exactly what it sent before.
 */

export type RichKind =
  | "yes_no"
  | "pass"
  | "deep_offer"
  | "intro_offer"
  | "settings_allowance"
  | "capture_kind"
  | "capture_firsthand"
  | "capture_recommend"
  | "skip";

/** One quick reply: what the person sees, and the id Twilio returns as `ButtonPayload`. */
export interface RichButton {
  title: string;
  id: string;
}

/** The most a quick-reply button title may hold (Twilio's `twilio/card` limit). */
export const RICH_BUTTON_TITLE_MAX = 20;

/** The most buttons a card without media may carry (a chip list). */
export const RICH_BUTTONS_MAX = 11;

/** The most a card body, or the template's text, may hold (Twilio's limit for both). */
export const RICH_BODY_MAX = 1600;

const b = (title: string, id: string): RichButton => ({ title, id });

export const RICH_BUTTONS: Record<RichKind, readonly RichButton[]> = {
  /*
   * The Network Ask offer, "did it help?", the last part of a deep dive, and the
   * freshness ping (`readPingReply`).
   *
   * ⚠ The ping offers no Pass button although its SMS says "or PASS to skip"
   * (review, 29 Oct): PASS is a keyword read before the ping is, and it releases
   * whatever Network Ask the person still has open — a one-tap Pass under a ping
   * would make that easy to do by accident. Not answering is the same as passing.
   */
  yes_no: [b("Yes", "yes"), b("No", "no")],
  /* A Network Ask request: the answer is typed; leaving is one tap. */
  pass: [b("Pass", "pass")],
  /* "Want a deep dive?" — `acceptsDeepDive` reads "deep dive". */
  deep_offer: [b("Deep dive", "deep")],
  /* "Want an introduction?" — the INTRO command. */
  intro_offer: [b("Intro", "intro")],
  /* SETTINGS and the participation question: `parseAllowanceChoice`. */
  settings_allowance: [b("5 a month", "5_a_month"), b("10 a month", "10_a_month"), b("As relevant", "as_relevant")],
  /* ADD, step by step: `CAPTURE_QUESTIONS` in lib/capture.ts. */
  /* The web flow's five categories (29 Oct); "Caregiver" is answered with the link to the careful form. */
  capture_kind: [
    b("Activity or class", "activity"),
    b("Place", "place"),
    b("Doctor or specialist", "doctor"),
    b("Caregiver", "caregiver"),
    b("Something else", "other"),
  ],
  capture_firsthand: [b("Used", "used"), b("Heard", "heard")],
  capture_recommend: [b("Yes", "yes"), b("Yes but", "yes_but"), b("No", "no")],
  /* ADD's last step: the note is typed; skipping is one tap. */
  skip: [b("Skip", "skip")],
};

/**
 * The server variable that names each kind's Content Template (`HX…`).
 *
 * The first two names predate the others and are kept, so a server that already
 * has them set goes on working.
 */
export const RICH_ENV: Record<RichKind, string> = {
  yes_no: "TWILIO_RCS_CONTENT_SID_YES_NO",
  pass: "TWILIO_RCS_CONTENT_SID_PASS",
  deep_offer: "TWILIO_RCS_CONTENT_SID_DEEP_OFFER",
  intro_offer: "TWILIO_RCS_CONTENT_SID_INTRO_OFFER",
  settings_allowance: "TWILIO_RCS_CONTENT_SID_SETTINGS",
  capture_kind: "TWILIO_RCS_CONTENT_SID_CAPTURE_KIND",
  capture_firsthand: "TWILIO_RCS_CONTENT_SID_CAPTURE_FIRSTHAND",
  capture_recommend: "TWILIO_RCS_CONTENT_SID_CAPTURE_RECOMMEND",
  skip: "TWILIO_RCS_CONTENT_SID_SKIP",
};

export const RICH_KINDS = Object.keys(RICH_BUTTONS) as RichKind[];

/**
 * The template's SID, or null when the kind is not switched on.
 *
 * Shaped like Twilio's (`HX` and 32 hex digits) so a pasted label or a stray
 * space turns the feature off rather than reaching the API as a bad request.
 */
export function richContentSid(
  kind: RichKind,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = (env[RICH_ENV[kind]] ?? "").trim();
  return /^HX[0-9a-f]{32}$/i.test(value) ? value : null;
}

/**
 * The template's two variables: `{{1}}` the card's text, `{{2}}` the SMS text.
 *
 * Null when either would not fit — the plain text goes instead, which is what a
 * parent without RCS would have had anyway.
 */
export function richVariables(card: string, body: string): string | null {
  if (card.length === 0 || body.length === 0) return null;
  if (card.length > RICH_BODY_MAX || body.length > RICH_BODY_MAX) return null;
  return JSON.stringify({ "1": card, "2": body });
}

/** Every button id, mapped to its title — the word the parsers read. */
const TAP_WORDS: ReadonlyMap<string, string> = new Map(
  RICH_KINDS.flatMap((kind) => RICH_BUTTONS[kind].map((button) => [button.id, button.title] as const)),
);

/**
 * What a reply says, read from a tap where there was one.
 *
 * A known `ButtonPayload` is turned into its button's title, so the pipeline reads
 * the same word whether the title also arrived in `Body` or not. An unknown or
 * absent payload leaves `Body` as it is: a typed reply, or a button from a template
 * this code does not know, is read the way every SMS is.
 *
 * **`Body` wins whenever it says something else** (review, 29 Oct). The payload
 * only fills in an empty `Body` or confirms the title already there; it never
 * replaces words the person sent. Otherwise a message carrying a payload and a
 * typed STOP would be read by Pando as "Yes" while Twilio's own opt-out acted on
 * the STOP — the two would disagree about whether the person had left.
 */
export function tapText(input: { body: string; buttonPayload?: string | null }): string {
  const title = TAP_WORDS.get((input.buttonPayload ?? "").trim());
  if (!title) return input.body;
  const typed = input.body.trim();
  return typed === "" || typed.toLowerCase() === title.toLowerCase() ? title : input.body;
}

/**
 * The Network Ask offer's buttons on an answer, when the offer is what the text
 * ends on.
 *
 * Read from the stored `next_step` and the text together, the same test
 * `answerQuestion` applies before it asks anything else: an answer whose rewrite
 * lost the offer must not carry buttons for a question it no longer asks.
 */
export function askOfferRich(nextStep: string | null | undefined, text: string): { kind: "yes_no" } | undefined {
  return nextStep === "offer_blast" && text.includes("Want me to ask") ? { kind: "yes_no" } : undefined;
}

/** Which buttons each ADD step carries; `name` is typed and has none. */
const CAPTURE_STEP_KIND: Readonly<Record<string, RichKind>> = {
  kind: "capture_kind",
  firsthand: "capture_firsthand",
  recommend: "capture_recommend",
  detail: "skip",
};

/** The buttons for an ADD prompt, given its step and its card text (`CAPTURE_QUESTIONS`). */
export function captureStepRich(step: string, card: string | undefined): { kind: RichKind; card: string } | undefined {
  const kind = CAPTURE_STEP_KIND[step];
  return kind && card ? { kind, card } : undefined;
}

/**
 * The Content API request that creates each template — what an operator posts, or
 * builds in the Console (Card, no media; a Text fallback), to switch a kind on.
 *
 * `twilio/text` is **not optional**: without it Twilio has no SMS version of the
 * message, and a parent without RCS would get an MMS or nothing.
 */
export function contentTemplateDefinition(kind: RichKind): {
  friendly_name: string;
  language: "en";
  variables: { "1": string; "2": string };
  types: {
    "twilio/card": { body: string; actions: Array<{ type: "QUICK_REPLY"; title: string; id: string }> };
    "twilio/text": { body: string };
  };
} {
  return {
    friendly_name: `pando_${kind}`,
    language: "en",
    variables: { "1": "The card text", "2": "The SMS text" },
    types: {
      "twilio/card": {
        body: "{{1}}",
        actions: RICH_BUTTONS[kind].map((button) => ({ type: "QUICK_REPLY" as const, title: button.title, id: button.id })),
      },
      "twilio/text": { body: "{{2}}" },
    },
  };
}
