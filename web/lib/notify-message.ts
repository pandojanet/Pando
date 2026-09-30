/**
 * What the team is told in Slack when something new arrives (30 Sep).
 *
 * Pure and import-free, so `npm run test:notify` can load it in plain node — and
 * because the one property that matters here is what the message **does not
 * say**, which is best checked against the builder itself rather than against a
 * sender that needs a webhook.
 *
 * ## What is deliberately not in a notification
 *
 * Slack is a third party's storage, and a message in it is kept and indexed even
 * if it is later deleted. So a notification carries **that** something arrived,
 * **what kind**, and **a link into the admin** — where the sign-in is the gate —
 * and nothing else:
 *
 * - no phone number and no name, of a parent or of anyone they recommended;
 * - no free text (invariants 7 and 8: what a parent wrote about a named person is
 *   read by a human in the admin before it goes anywhere);
 * - **no caregiver detail at all** — not her name, not her area, not what she
 *   charges (invariants 12 and 13). "A caregiver was nominated" is the whole
 *   message, and the admin page is where it is read.
 *
 * The recommended place's own name is left out as well. It is usually a business,
 * but `lib/named-person.ts` exists because it is sometimes a person, and a
 * notification is not the place to find out. Adding it later is one line here.
 */

export type NotifyEvent =
  /** A parent finished their profile for the first time. */
  | { kind: "parent"; person_id: string; neighborhood: string | null }
  /** A new activity, place or tip card (not a correction of one). */
  | { kind: "activity" | "place" | "tip" }
  /** A parent nominated a caregiver. */
  | { kind: "caregiver" }
  /** A caregiver set up her own profile and is waiting to be matched. */
  | { kind: "caregiver_signup" };

function slugLabel(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Slack `mrkdwn`: a link is `<url|label>`, and `&`, `<` and `>` are escaped. */
function link(base: string, path: string, label: string): string {
  return `<${base.replace(/\/+$/, "")}${path}|${label}>`;
}

export function notifyText(event: NotifyEvent, base: string): string {
  switch (event.kind) {
    case "parent":
      return [
        `:bust_in_silhouette: *New parent joined Pando*${
          event.neighborhood ? ` — ${slugLabel(event.neighborhood)}` : ""
        }`,
        link(base, `/admin/contributors/${event.person_id}`, "Open in the admin"),
      ].join("\n");
    case "activity":
    case "place":
    case "tip":
      return [
        `:sparkles: *New ${event.kind === "activity" ? "activity or class" : event.kind} recommendation*`,
        link(base, "/admin/activities", "Review it"),
      ].join("\n");
    case "caregiver":
      return [
        ":baby: *A caregiver was nominated*",
        link(base, "/admin/caregivers", "Open in the admin"),
      ].join("\n");
    case "caregiver_signup":
      return [
        ":raising_hand: *A caregiver set up her own profile* — it needs matching to a nomination",
        link(base, "/admin/caregivers?view=signups", "Match it"),
      ].join("\n");
  }
}

/** The one host an incoming webhook may point at. */
export const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/";

export function isSlackWebhookUrl(value: string | undefined | null): value is string {
  return typeof value === "string" && value.startsWith(SLACK_WEBHOOK_PREFIX);
}
