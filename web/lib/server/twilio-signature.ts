import "server-only";

import { verifySignature, type SignatureResult } from "@/lib/twilio-signature";

/**
 * Where the token and the public URL come from — and nothing else.
 *
 * Split from `lib/twilio-signature.ts` on the same principle as
 * `lib/admin/auth.ts` and `lib/server/admin-auth.ts`: the arithmetic is given
 * its secrets and never asks where they came from, so it can be tested
 * exhaustively without a server.
 *
 * **Unconfigured refuses.** Same fail-closed rule as `repo/outreach.ts`: an
 * endpoint that skips verification when a secret is missing is unauthenticated
 * the moment somebody mis-deploys, and the failure is silent because everything
 * else keeps working.
 */
export function verifyTwilioSignature(
  path: string,
  params: Record<string, string>,
  signature: string | null,
): SignatureResult {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim() || null;
  /* Configuration, never `request.headers.host`: behind Traefik that header is
     whatever reached the container, and whoever can set it could choose the URL
     the signature is checked against. */
  const base = process.env.TWILIO_WEBHOOK_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return { ok: false, reason: "not_configured" };

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return verifySignature(url, params, signature, token);
}
