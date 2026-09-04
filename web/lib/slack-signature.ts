import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack's request signature, as arithmetic — the same shape, and the same
 * reasoning, as `lib/twilio-signature.ts`.
 *
 * Pure, and it never reads an environment variable: it is *given* the signing
 * secret, so `npm run test:slack` can prove the refusals without a server. The
 * refusals are the half that matters, because the events URL is public and
 * everything behind it acts on what the request claims — and behind this one is
 * the whole inbound pipeline, which can opt somebody out, write a contribution,
 * or spend a contributor's monthly allowance.
 *
 * ## What Slack signs, and the three details that matter
 *
 *  - **`v0:<timestamp>:<raw body>`** — the *raw* body, byte for byte, before any
 *    JSON parsing. Re-serialising a parsed object changes key order and spacing
 *    and the signature stops matching, which reads as "Slack is broken".
 *  - **A replay window.** Slack sends the timestamp it signed; a request older
 *    than five minutes is refused even with a valid signature, because a
 *    captured request is otherwise replayable forever. Twilio's scheme has no
 *    equivalent, so this is the one place the two verifiers genuinely differ.
 *  - **Compared in constant time**, with the length checked first —
 *    `timingSafeEqual` throws on a length mismatch, and that throw is itself the
 *    timing signal the comparison exists to avoid.
 */

export type SlackSignatureResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_configured" | "missing_signature" | "stale" | "mismatch";
    };

/** Slack's own default, and the value their docs tell you to enforce. */
export const SLACK_REPLAY_WINDOW_SECONDS = 60 * 5;

/** The exact string Slack signs. */
export function slackSignaturePayload(timestamp: string, rawBody: string): string {
  return `v0:${timestamp}:${rawBody}`;
}

export function verifySlackSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string | null;
  now?: Date;
}): SlackSignatureResult {
  const { rawBody, timestamp, signature, secret } = input;
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing_signature" };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "missing_signature" };

  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - sent) > SLACK_REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected =
    "v0=" +
    createHmac("sha256", secret)
      .update(slackSignaturePayload(timestamp, rawBody), "utf8")
      .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "mismatch" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}
