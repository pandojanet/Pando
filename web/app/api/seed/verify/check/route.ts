import { NextResponse } from "next/server";
import { SMS_CONSENT_TEXT_VERSION } from "@/lib/consent";
import { checkVerification, VERIFY_COOKIE } from "@/lib/server/verify";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * POST /api/seed/verify/check — confirm the code.
 *
 * A correct code is the moment the parent becomes storable: only after this does
 * the browser send the profile, the cards and the completion record (each of those
 * routes re-checks the cookie, so the gate isn't a UI convention).
 *
 * What the confirmation records, per the client's list: the verification time, the
 * phone (held with the pending verification, not sent by the browser) and the
 * version of the consent wording the parent ticked.
 */

export async function POST(request: Request) {
  /* Looser than the send: a wrong code is free to us, and the per-phone rule
     already ends the attempt after three guesses. This only bounds somebody
     working through many numbers at once. */
  const limited = rateLimited(request, "verify_check");
  if (limited) return limited;

  const raw = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof raw?.code === "string" ? raw.code.replace(/\D/g, "") : "";

  if (code.length !== 6) {
    return NextResponse.json({ ok: false, reason: "wrong_code" }, { status: 400 });
  }

  const id =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${VERIFY_COOKIE}=`))
      ?.slice(VERIFY_COOKIE.length + 1) ?? null;

  const result = checkVerification(id, code);

  console.info("[seed:verify] check", {
    ok: result.ok,
    reason: result.ok ? null : result.reason,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, attempts_left: result.attempts_left },
      { status: result.reason === "unknown" ? 404 : 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    verified_at: result.verified_at,
    consent_text_version: SMS_CONSENT_TEXT_VERSION,
  });
}
