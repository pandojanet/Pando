import { NextResponse } from "next/server";
import { isPhoneComplete, toE164 } from "@/lib/phone";
import {
  SMS_TEMPLATE_VERSION,
  VERIFICATION_MAX_SENDS,
  VERIFICATION_SESSION_HOURS,
  verificationSms,
} from "@/lib/sms-templates";
import { sendSms } from "@/lib/server/sms";
import { rateLimited } from "@/lib/server/rate-limit";
import {
  devCodesEnabled,
  verifiedPhone,
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
  /* 15.4 — the tightest limit in the app, because this is the only endpoint
     where every request that gets through costs money and carrier reputation.
     The per-*phone* caps (§19: 3 sends an hour, then a 15-minute lock) are what
     stop one number being spammed; this is what stops one machine spraying
     many. */
  const limited = rateLimited(request, "verify_start");
  if (limited) return limited;

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

  /**
   * ⚠⚠ **Already confirmed in this browser: send nothing, change nothing**
   * (23 Sep). Asking for a code used to create a fresh, unconfirmed verification
   * and point the cookie at it — so the confirmed one this browser was carrying
   * was dropped the moment anything asked for a code again, and every card after
   * that was held on the phone as if the parent had never verified. Measured on
   * the developer's own number: confirmed at 07:04, a new code requested at 08:55
   * and never entered, and nothing saved in between. A code is for proving the
   * number once; a browser that has already proved it is answered as such, and
   * the screen goes straight on.
   */
  const already = await verifiedPhone(existingId);
  if (already && already.phone === phone) {
    console.info("[seed:verify] already confirmed");
    return NextResponse.json({
      sent: false,
      already_verified: true,
      sends: 0,
      max_sends: VERIFICATION_MAX_SENDS,
      expires_at: "",
    });
  }

  const started = await startVerification(phone, existingId);

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
      /* ⚠ An unreachable store is **503, never 429**: the other three refusals
         are Pando saying no on purpose and this one is Pando unable to answer.
         Collapsing them would tell a parent they had asked too often when they
         had asked once, and would put a retry-after on a number that has no
         allowance problem. */
      { status: started.reason === "unavailable" ? 503 : 429 },
    );
  }

  const result = await sendSms({
    to: phone,
    body: verificationSms(started.code),
    category: "transactional",
    /**
     * Pinned to the real provider even while the Slack relay is on: a code in a
     * test channel is a code the parent never gets. This is the only caller that
     * sets it, and `npm run test:relay` asserts it stays that way.
     */
    purpose: "verification",
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

  /**
   * ⚠⚠ **Read from `VERIFICATION_SESSION_HOURS`, and it said 60 * 60 until
   * 17 Sep — one hour, against a server session of twelve.**
   *
   * The two halves of one rule, one of them updated and one not. The hour was
   * right on 5 Aug, when the code was the last thing a parent did; 12 Aug moved
   * it to the front of the flow and raised the session to twelve hours, with
   * that constant's own doc explaining why — *"it has to outlive the whole Seed
   * Tool visit … where an hour was plenty when the code was the last thing they
   * did"*. The cookie carrying the id was left where it was.
   *
   * So the promise was twelve hours and a parent got one: `verifiedPhone` would
   * have honoured them all afternoon, and the browser had stopped sending the
   * id, so the gate saw nobody and asked for a fresh code — on a **saved**
   * profile they had come back to edit. Nothing was lost (the write is refused,
   * the session falls back to holding everything on the phone) and there was no
   * way to tell from the screen why it was asking again.
   *
   * ⚠ It is anchored on the send, like the server's own window, so the cookie
   * dies ~5 minutes *before* the entry it points at rather than after — which
   * fails in the safe direction: a cookie outliving its entry is a code prompt
   * either way.
   */
  response.cookies.set(VERIFY_COOKIE, started.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VERIFICATION_SESSION_HOURS * 60 * 60,
  });

  return response;
}
