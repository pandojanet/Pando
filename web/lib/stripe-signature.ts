import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * M13.6 — verifying that a payment webhook really came from Stripe.
 *
 * Pure, and it never reads an environment variable: it is *given* the secret,
 * exactly like `lib/twilio-signature.ts` and `lib/admin/auth.ts`. That is what
 * lets `npm run test:payments` prove the refusals without a server, and the
 * refusals are the half that matters.
 *
 * ## What a forged webhook would buy an attacker
 *
 * The endpoint's whole job is "this blast is paid, activate it", so the answer
 * is: **free Network Asks, indefinitely.** A `checkout.session.completed` that
 * nobody paid for would move a blast from `pending` to `paid` and let it be
 * sent to five parents' phones. It would also put revenue on the payments page
 * that does not exist in Stripe, which is the kind of discrepancy that is found
 * a month later during a reconciliation nobody enjoys.
 *
 * So the same three rules as the Twilio verifier, plus one Stripe adds.
 *
 * ## Stripe's scheme, and the timestamp that is not decoration
 *
 * The `Stripe-Signature` header is a comma-separated list:
 *
 *     t=1699999999,v1=5257a869e7...,v1=<another during a secret rotation>
 *
 * and the signed string is `t + "." + rawBody`. Three consequences:
 *
 *  - **The raw body, byte for byte.** `JSON.parse` then re-stringify changes key
 *    order and whitespace and the signature fails for a legitimate request —
 *    which is worse than failing closed, because it looks like Stripe is broken.
 *    The route reads `await request.text()` and parses only after verifying.
 *  - **`v1` can appear more than once.** During a secret rotation Stripe signs
 *    with both, so a verifier that reads the first `v1` and stops rejects half
 *    of all traffic for the duration of the rotation. Every `v1` is checked.
 *  - **The timestamp is checked against a tolerance**, and this is the rule the
 *    Twilio verifier has no equivalent of. Without it a valid webhook captured
 *    once can be replayed forever: the signature stays valid because the payload
 *    is unchanged, so `checkout.session.completed` for a real $15 payment could
 *    activate a new blast every day. Five minutes is Stripe's own default.
 *
 * Idempotency is *not* this module's job and must not be mistaken for it: a
 * replay inside the tolerance window is legitimately possible, because Stripe
 * retries until it gets a 2xx. That is handled where it belongs — a unique index
 * on `blasts.stripe_session_id` (`drizzle/0029`), so the database refuses the
 * second activation rather than a handler remembering to.
 */

export type StripeSignatureResult =
  | { ok: true; timestamp: number }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "missing_signature"
        | "malformed_signature"
        | "expired"
        | "mismatch";
    };

/** Stripe's own default, in seconds. */
export const STRIPE_TOLERANCE_SECONDS = 300;

interface ParsedHeader {
  timestamp: number | null;
  signatures: string[];
}

/** `t=…,v1=…,v1=…` → its parts. Unknown schemes (`v0`) are ignored, not an error. */
export function parseStripeSignature(header: string): ParsedHeader {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === undefined || value === undefined) continue;
    const k = key.trim();
    if (k === "t") {
      const n = Number(value.trim());
      /* Only a finite integer. A `t=abc` that parsed to NaN would make every
         comparison below false, which reads as "expired" rather than as the
         malformed header it is. */
      if (Number.isFinite(n)) timestamp = Math.trunc(n);
    } else if (k === "v1") {
      signatures.push(value.trim());
    }
  }
  return { timestamp, signatures };
}

export function verifyStripeSignature(input: {
  /** The request body exactly as it arrived. Never a re-serialised object. */
  rawBody: string;
  header: string | null;
  secret: string | null;
  /** Seconds since the epoch. Injected so a test can pin it. */
  now?: number;
  toleranceSeconds?: number;
}): StripeSignatureResult {
  /* Unconfigured refuses. An endpoint that skips verification when a secret is
     missing is unauthenticated the moment somebody mis-deploys, and silently —
     the same fail-closed rule as the Twilio webhook and `JOBS_SECRET`. */
  if (!input.secret) return { ok: false, reason: "not_configured" };
  if (!input.header) return { ok: false, reason: "missing_signature" };

  const { timestamp, signatures } = parseStripeSignature(input.header);
  if (timestamp === null || signatures.length === 0) {
    return { ok: false, reason: "malformed_signature" };
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? STRIPE_TOLERANCE_SECONDS;
  /* Absolute difference, so a timestamp from the future is refused too: a clock
     skew that let a far-future `t` through would make the replay window
     unbounded in the other direction. */
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "expired" };

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected, "utf8");

  for (const candidate of signatures) {
    const b = Buffer.from(candidate, "utf8");
    /* Length first: `timingSafeEqual` throws on a mismatch, and that throw is
       itself the timing signal the comparison exists to avoid. */
    if (a.length !== b.length) continue;
    if (timingSafeEqual(a, b)) return { ok: true, timestamp };
  }
  return { ok: false, reason: "mismatch" };
}
