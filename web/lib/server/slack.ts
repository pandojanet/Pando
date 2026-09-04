import "server-only";

import {
  verifySlackSignature,
  type SlackSignatureResult,
} from "@/lib/slack-signature";

/**
 * The Slack relay — a **temporary test transport** standing in for Twilio.
 *
 * ## What this is for, and what it deliberately is not
 *
 * The developer's instruction (2 Sep): swap Twilio for Slack for everything
 * except verification, so answers and the whole conversation loop can be
 * exercised in one channel before a single real parent is texted. M5, M7, M9 and
 * M10 are all built and none of them has ever run end to end, because the only
 * way to see what Pando says is to have it text somebody.
 *
 * **It replaces exactly one step.** `sendSms` keeps its whole order — opt-out,
 * quiet hours, contributor protection, *then* the provider (invariant 6) — and
 * only the provider changes. That is the point: routing a test channel through
 * the same gate is what makes the test worth anything, and a second send path
 * beside `sendSms` would be the thing invariant 6 exists to forbid.
 *
 * **Verification never comes here.** `sendSms` routes `purpose: "verification"`
 * to the real provider always, because a code posted into a Slack channel is a
 * code the parent never receives — see `transportFor`.
 *
 * ## Invariant 7, and the one place this bends it
 *
 * The invariant is that Pando never *logs* a phone number, a name or free text.
 * This posts message bodies to Slack, and a body can contain both — but that is
 * the payload of the channel it is standing in for, not a log line: it is what
 * the parent would have received on their phone. What this module still refuses
 * to do is put a **full phone number** in the channel; the recipient is labelled
 * with a masked number and a first name, the same way every admin surface
 * identifies a person.
 *
 * ⚠️ **So this must never be enabled against real contributors.** One channel
 * holding every message Pando sends is a transcript of the network. It is for
 * the demo cohort and `is_test` rows, and it comes off before the pilot opens —
 * the same deadline as `SEED_VERIFY_DEV_CODES` and the `pando` starter password.
 */

export interface SlackConfig {
  token: string;
  channel: string;
  secret: string;
  base: string;
}

function config(): SlackConfig {
  return {
    token: process.env.SLACK_BOT_TOKEN?.trim() ?? "",
    channel: process.env.SLACK_CHANNEL_ID?.trim() ?? "",
    secret: process.env.SLACK_SIGNING_SECRET?.trim() ?? "",
    /**
     * Overridable for the same reason `TWILIO_API_BASE` is: so the posting path
     * can be exercised against a local stub instead of shipping an unexercised
     * code path — or firing test posts at a real workspace. Never set in
     * production.
     */
    base: process.env.SLACK_API_BASE?.trim() || "https://slack.com",
  };
}

/**
 * On only when it is asked for **and** it can actually work.
 *
 * `MESSAGING_RELAY=slack` is the switch, and the token plus channel are what
 * make it possible — so a half-configured deployment falls back to the real
 * provider rather than silently swallowing every message. Unset means off, the
 * same fail-safe reading as `SEED_VERIFY_DEV_CODES`.
 */
export function isSlackRelayEnabled(): boolean {
  if (process.env.MESSAGING_RELAY?.trim().toLowerCase() !== "slack") return false;
  const c = config();
  return c.token !== "" && c.channel !== "";
}

/** For `/api/slack/events`, which is given the secret rather than reading it. */
export function checkSlackSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  now?: Date;
}): SlackSignatureResult {
  return verifySlackSignature({ ...input, secret: config().secret || null });
}

/** Our own bot's id, so the events route can ignore what Pando itself posted. */
export function slackBotUserId(): string | null {
  return process.env.SLACK_BOT_USER_ID?.trim() || null;
}

export interface SlackPostResult {
  ok: boolean;
  /** Slack's message timestamp — the thread key, and our provider message id. */
  ts?: string;
  error?: string;
}

/**
 * The header that says who a message was for.
 *
 * In one shared channel every message would otherwise look like it was for the
 * same person, so each post names its recipient — masked, per the note above.
 * `→` rather than a word, because the channel is read as a transcript and the
 * direction is the thing to see at a glance.
 */
export function recipientLabel(input: {
  name?: string | null;
  phoneMasked?: string | null;
}): string {
  const parts = [input.name?.trim(), input.phoneMasked?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "unknown recipient";
}

/**
 * Post one message as Pando.
 *
 * `thread_ts` keeps a conversation with one parent in one thread, which is what
 * makes a reply resolvable back to them: the events route reads `thread_ts`,
 * finds the `message_log` row whose `provider_message_id` is that ts, and takes
 * the person from it. Without threading, a shared channel could not say who a
 * reply came from at all.
 */
export async function postToSlack(input: {
  body: string;
  label: string;
  /** Reply inside an existing conversation rather than starting one. */
  threadTs?: string | null;
  /** `outreach` / `transactional`, shown so the register is visible in-channel. */
  category?: string;
  template?: string | null;
}): Promise<SlackPostResult> {
  const c = config();
  if (c.token === "" || c.channel === "") return { ok: false, error: "not_configured" };

  const meta = [input.category, input.template].filter(Boolean).join(" · ");
  const text =
    `*→ ${input.label}*${meta ? `  _${meta}_` : ""}\n` +
    /* A blockquote, so the parent's message reads as the message rather than as
       Pando's commentary about it — the same distinction `Quote` draws in the
       admin, where invariant 8 turns on it. */
    input.body
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

  try {
    const res = await fetch(`${c.base}/api/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: c.channel,
        text,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      ts?: string;
      error?: string;
    } | null;

    if (!res.ok || !data?.ok) {
      /* Slack's error is an enum of its own ("channel_not_found",
         "invalid_auth"), so it is safe to log — unlike Twilio's, which echoes
         the recipient's number back. */
      console.error("[slack] post rejected", {
        status: res.status,
        error: data?.error ?? "unknown",
      });
      return { ok: false, error: data?.error ?? "post_failed" };
    }

    return { ok: true, ts: data.ts };
  } catch (error) {
    console.error(
      "[slack] unreachable",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, error: "unreachable" };
  }
}
