/**
 * RCS quick-reply buttons (29 Oct) — the smallest piece of rich messaging.
 *
 * Pure and import-free, so `npm run test:rich` loads it in plain node.
 *
 * ## What this is, and what it deliberately is not
 *
 * A message that already exists as text can ride on a Twilio Content Template that
 * holds **two** types: a `twilio/card` with quick-reply buttons for a phone that
 * has RCS, and a `twilio/text` for one that does not. Twilio chooses by the
 * recipient's device; Pando never asks which. The body Pando would have sent as
 * SMS is the one variable, so the SMS a parent without RCS receives is the text
 * it always was (docs/rcs-quick-replies.md).
 *
 * It is **off until an operator sets the content SID** for a kind (below). Unset,
 * `sendSms` sends exactly what it sent before this file existed.
 *
 * ## Why the button titles are what they are
 *
 * A tap reaches the inbound webhook, and what the webhook carries for a tap was
 * not verified against a real RCS device when this was written. So every title is
 * a word the existing parsers already read as the answer — `yesOrNo` for "Yes" and
 * "No", `parseAllowanceChoice` for the settings choices — and `test:rich` fails if
 * a title stops parsing. If the webhook turns out to carry a separate payload,
 * nothing here needs to change; if it carries the title, nothing does either.
 *
 * Titles are at most 20 characters, the limit Twilio documents for a quick-reply
 * button on a card.
 */

export type RichKind = "yes_no" | "settings_allowance";

/** The most a quick-reply button title may hold (Twilio's `twilio/card` limit). */
export const RICH_BUTTON_TITLE_MAX = 20;

/** The most a card body may hold on RCS (Twilio's `twilio/card` limit). */
export const RICH_BODY_MAX = 1600;

export const RICH_BUTTONS: Record<RichKind, readonly string[]> = {
  /* The Network Ask offer: "Want me to ask a few nearby parents for more?" */
  yes_no: ["Yes", "No"],
  /* The SETTINGS menu: the three levels of `parseAllowanceChoice`. */
  settings_allowance: ["5 a month", "10 a month", "As relevant"],
};

/** The server variable that names each kind's Content Template (`HX…`). */
export const RICH_ENV: Record<RichKind, string> = {
  yes_no: "TWILIO_RCS_CONTENT_SID_YES_NO",
  settings_allowance: "TWILIO_RCS_CONTENT_SID_SETTINGS",
};

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
 * The template's one variable: the whole SMS body, as `{{1}}`.
 *
 * Null when the body would not fit a card — the plain text goes instead, which is
 * what the parent without RCS would have had anyway.
 */
export function richVariables(body: string): string | null {
  if (body.length === 0 || body.length > RICH_BODY_MAX) return null;
  return JSON.stringify({ "1": body });
}

/**
 * The Content API request that creates each template — what an operator posts (or
 * rebuilds in the Console's Content Template Builder) to switch a kind on.
 *
 * `twilio/text` is **not optional**: without it Twilio has no SMS version of the
 * message, and a parent without RCS would get an MMS or nothing.
 */
export function contentTemplateDefinition(kind: RichKind): {
  friendly_name: string;
  language: "en";
  variables: { "1": string };
  types: {
    "twilio/card": { body: string; actions: Array<{ type: "QUICK_REPLY"; title: string; id: string }> };
    "twilio/text": { body: string };
  };
} {
  return {
    friendly_name: `pando_${kind}`,
    language: "en",
    variables: { "1": "The message text" },
    types: {
      "twilio/card": {
        body: "{{1}}",
        actions: RICH_BUTTONS[kind].map((title) => ({
          type: "QUICK_REPLY" as const,
          title,
          id: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        })),
      },
      "twilio/text": { body: "{{1}}" },
    },
  };
}
