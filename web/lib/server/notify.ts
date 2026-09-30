import "server-only";

import {
  isSlackWebhookUrl,
  notifyText,
  type NotifyEvent,
} from "@/lib/notify-message";

/**
 * Tells the team in Slack that something new arrived (30 Sep): a parent, an
 * activity, a place or tip, a caregiver.
 *
 * ## Why this is not the Slack relay
 *
 * `lib/server/slack.ts` is the **temporary test transport** that stands in for
 * Twilio: one channel holding the messages Pando sends, which is exactly why it
 * must never be enabled against real contributors. This is the opposite thing —
 * a one-way heads-up for the people running the pilot — so it has its own switch,
 * its own channel and no shared code. An **Incoming Webhook** rather than the bot
 * token because it can post to one channel only, which is the property you want
 * from a secret that lives in an env file.
 *
 * ## Rules
 *
 * - **Inert when unset.** No `SLACK_NOTIFY_WEBHOOK_URL`, no request, no error —
 *   the same honesty rule as every other integration here.
 * - **It never throws and never waits for a person.** Callers run it inside
 *   `after()`, past the response; a slow or dead Slack must not cost a parent a
 *   save, and a save must not fail because a notification did.
 * - **The webhook host is fixed** (`hooks.slack.com`). The URL comes from an env
 *   file, but a value that could point anywhere is a request this server would
 *   make on somebody else's behalf.
 * - **Test rows do not notify.** `is_test` data is the QA walk, and a channel
 *   that fills with it teaches the team to mute it.
 * - **Counts and enums in the log, never the message** (invariant 7).
 *
 * What a message may contain is decided in `lib/notify-message.ts`, where it is
 * tested — and the answer is: a kind, a link into the admin, nothing about anyone.
 */

function siteBase(): string {
  /* Configured, never read from a request header: a link built from a header is
     a header somebody else controls (the reason Stripe's return URL and the
     Twilio signature are built the same way). `NOTIFY_BASE_URL` first so the
     team's links can be set without touching Twilio's; the production address
     last, because a notification that links to localhost is worse than one with
     no link — and this only ever runs where a webhook is set. */
  return (
    process.env.NOTIFY_BASE_URL?.trim() ||
    process.env.TWILIO_WEBHOOK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://pando.is"
  );
}

export function isNotifyConfigured(): boolean {
  return isSlackWebhookUrl(process.env.SLACK_NOTIFY_WEBHOOK_URL?.trim());
}

export async function notifyAdmins(
  event: NotifyEvent,
  opts: { is_test?: boolean } = {},
): Promise<void> {
  if (opts.is_test === true) return;
  const url = process.env.SLACK_NOTIFY_WEBHOOK_URL?.trim();
  if (!isSlackWebhookUrl(url)) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: notifyText(event, siteBase()) }),
      /* Four seconds and no retry: a notification that arrives late is noise,
         and a retry that double-posts is worse than one that is lost. */
      signal: AbortSignal.timeout(4000),
    });
    console.info("[notify]", { kind: event.kind, ok: res.ok, status: res.status });
  } catch (err) {
    /* The error's class and nothing else. A fetch error can carry the URL, and
       the URL is the secret. */
    console.warn("[notify] failed", {
      kind: event.kind,
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}
