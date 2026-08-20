import { NextResponse } from "next/server";
import { isPhoneComplete, toE164 } from "@/lib/phone";
import {
  SMS_TEMPLATE_VERSION,
  VERIFICATION_MAX_SENDS,
  verificationSms,
} from "@/lib/sms-templates";
import { sendSms } from "@/lib/server/sms";
import {
  devCodesEnabled,
  startVerification,
  VERIFICATION_SENDS_PER_HOUR,
  VERIFY_COOKIE,
} from "@/lib/server/verify";

/**
 * POST /api/seed/verify/start — text a 6-digit code to the number the parent gave.
 *
 * Two conditions from the client, both enforced here rather than in the form:
 *  - no consent checkbox, no send. An unchecked box means we have no permission to
 *    text that number at all, so there is nothing to verify.
 *  - the code goes out through the Pando Messaging Service via the single send
 *    layer. While the A2P campaign is unapproved that layer reports
 *    `not_provisioned` and this route says so plainly instead of pretending a text
 *    is on its way.
 */

export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as {
    phone?: unknown;
    sms_consent?: unknown;
  } | null;

  const phone =
    typeof raw?.phone === "string" && isPhoneComplete(raw.phone)
      ? toE164(raw.phone)
      : null;

  if (!phone) {
    return NextResponse.json(
      { error: "A complete mobile number is required" },
      { status: 400 },
    );
  }

  // The checkbox is the permission. Without it there is no lawful send.
  if (raw?.sms_consent !== true) {
    return NextResponse.json(
      { error: "Text permission is required before we can send a code" },
      { status: 422 },
    );
  }

  const existingId =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${VERIFY_COOKIE}=`))
      ?.slice(VERIFY_COOKIE.length + 1) ?? null;

  const started = startVerification(phone, existingId);

  if (!started.ok) {
    console.info("[seed:verify] send refused", {
      reason: started.reason,
      sends: started.sends,
    });
    return NextResponse.json(
      {
        sent: false,
        reason: started.reason,
        sends: started.sends,
        max_sends:
          started.reason === "phone_send_limit"
            ? VERIFICATION_SENDS_PER_HOUR
            : VERIFICATION_MAX_SENDS,
        /* §19's lock, in seconds, so the screen can say when rather than "later". */
        retry_in_seconds:
          started.reason === "locked" ? started.retry_in_seconds : undefined,
      },
      { status: 429 },
    );
  }

  const result = await sendSms({
    to: phone,
    body: verificationSms(started.code),
    category: "transactional",
  });

  // Never the number, never the code.
  console.info("[seed:verify] code issued", {
    sent: result.sent,
    reason: result.reason ?? null,
    sends: started.sends,
    template_version: SMS_TEMPLATE_VERSION,
  });

  /**
   * A number that texted STOP is refused by the carrier, and no cookie should be set:
   * there is no pending verification to continue, and the only way back is START or
   * UNSTOP — from them, not from us.
   */
  if (result.reason === "opted_out") {
    return NextResponse.json(
      { sent: false, reason: "opted_out", sends: started.sends, max_sends: VERIFICATION_MAX_SENDS,
        expires_at: started.expires_at },
      { status: 409 },
    );
  }

  const response = NextResponse.json({
    sent: result.sent,
    reason: result.sent ? undefined : (result.reason ?? "provider_error"),
    sends: started.sends,
    max_sends: VERIFICATION_MAX_SENDS,
    expires_at: started.expires_at,
    /* QA only, and only when switched on deliberately: the flow has to be
       walkable before the carriers approve the campaign. */
    dev_code: devCodesEnabled() ? started.code : undefined,
  });

  response.cookies.set(VERIFY_COOKIE, started.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });

  return response;
}
