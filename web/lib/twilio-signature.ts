import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * M13.2 — the signature arithmetic, given a token.
 *
 * Pure, and it never reads an environment variable: it is *given* the token and
 * the URL, exactly like `lib/admin/auth.ts` is given the credentials. That is
 * what lets `npm run test:inbound` prove the refusals without a server, and the
 * refusals are the half that matters — the webhook URL is public and everything
 * behind it acts on what the request claims.
 *
 * ## The three details that do the damage
 *
 *  - **The URL must be the one Twilio called**, byte for byte, scheme and query
 *    included. The caller supplies it from configuration; taking it from a host
 *    header would let whoever sets that header choose what gets verified.
 *  - **Sorted by key, concatenated as key + value**, no separators, no encoding.
 *  - **Compared in constant time.** A `===` on a signature leaks how much of a
 *    guess was right, one request at a time.
 */

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "missing_signature" | "mismatch" };

/** The exact string Twilio signs. */
export function signaturePayload(url: string, params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
}

export function verifySignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  token: string | null,
): SignatureResult {
  if (!token) return { ok: false, reason: "not_configured" };
  if (!signature) return { ok: false, reason: "missing_signature" };

  const expected = createHmac("sha1", token)
    .update(signaturePayload(url, params), "utf8")
    .digest("base64");

  /* Length first: timingSafeEqual throws on a mismatch, and that throw would
     itself be the timing signal the function exists to avoid. */
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "mismatch" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "mismatch" };
}
