import "server-only";

import { verificationRequired, verifiedPhone, VERIFY_COOKIE } from "./verify";

/**
 * The submit gate, in one place because three routes have to agree on it.
 *
 * The client's rule: nothing is stored server-side until the phone is confirmed —
 * "if they abandon at OTP, nothing persists". The browser holds the profile and the
 * cards until then, but a rule that only the UI keeps is not a rule, so every write
 * route asks this function first.
 *
 * The anonymous path is the deliberate exception: no phone, no verification, and
 * (as the entry screen says in so many words) no founding status.
 */

export function verifyCookie(request: Request): string | null {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${VERIFY_COOKIE}=`))
      ?.slice(VERIFY_COOKIE.length + 1) ?? null
  );
}

export type GateResult =
  | { allowed: true; verified_at: string | null }
  | { allowed: false; reason: "verification_required" | "phone_mismatch" };

export function submitGate(
  request: Request,
  claim: { phone: string | null; wants_founding?: boolean },
): GateResult {
  const verified = verifiedPhone(verifyCookie(request));

  // Switched off for a local walkthrough or a pre-A2P demo; the log line on every
  // write still says whether a verification was behind it.
  if (!verificationRequired()) {
    return { allowed: true, verified_at: verified?.verified_at ?? null };
  }

  // Anonymous contribution: nothing to verify, and not eligible for founding.
  if (!claim.phone && claim.wants_founding !== true) {
    return { allowed: true, verified_at: null };
  }

  if (!verified) return { allowed: false, reason: "verification_required" };
  if (claim.phone && verified.phone !== claim.phone) {
    return { allowed: false, reason: "phone_mismatch" };
  }

  return { allowed: true, verified_at: verified.verified_at };
}
