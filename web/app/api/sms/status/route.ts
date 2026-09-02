import { NextResponse } from "next/server";
import { CARRIER_ERRORS } from "@/lib/delivery";
import { verifyTwilioSignature } from "@/lib/server/twilio-signature";
import { recordDeliveryStatus } from "@/lib/server/repo/outreach";

/**
 * M13.4 / M12.5 — Twilio's delivery status callback.
 *
 * A send and a delivery are different facts. `sendSms` learns that the API
 * accepted a message; whether it *arrived* comes back here, seconds or minutes
 * later, keyed by the message SID. Without this route `message_log.status` stays
 * null forever and the delivery rate cannot be computed at all.
 *
 * ## Signed like the inbound webhook, for the same reason
 *
 * This endpoint writes to `message_log`, which the contributor-protection rules
 * and the health page both read. A forged callback could mark every failure as
 * delivered and hide exactly the outage 12.5 exists to surface — so an unverified
 * request is a 403, not a shrug.
 *
 * ## Why the three errors are logged individually
 *
 * 12.5 gives each a different answer, and the one that matters most is **21610**:
 * it means Pando texted somebody who had asked it to stop, which is a failure of
 * our own suppression rather than carrier noise. Folding the three into one
 * "delivery error" count would bury it.
 */

export async function POST(request: Request) {
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value;

  const verdict = verifyTwilioSignature(
    "/api/sms/status",
    params,
    request.headers.get("x-twilio-signature"),
  );
  if (!verdict.ok) {
    console.warn("[sms:status] refused", { reason: verdict.reason });
    return NextResponse.json({ error: "Unverified" }, { status: 403 });
  }

  const sid = params.MessageSid ?? params.SmsSid ?? "";
  const status = params.MessageStatus ?? params.SmsStatus ?? "";
  const errorCode = params.ErrorCode ? Number(params.ErrorCode) : null;

  if (!sid || !status) {
    /* 200 anyway: a callback shape we do not recognise is not worth a retry
       storm, and there is nothing to record. */
    console.warn("[sms:status] callback with no sid or status");
    return new NextResponse(null, { status: 204 });
  }

  await recordDeliveryStatus({
    providerMessageId: sid,
    status,
    errorCode: Number.isFinite(errorCode) ? errorCode : null,
  });

  /**
   * The alert, at the moment it happens.
   *
   * The health page shows the standing picture; this line is what puts a failure
   * in the container log the minute it starts. Counts and enums only — never the
   * number, never the body (invariant 7).
   */
  if (errorCode && CARRIER_ERRORS[errorCode]) {
    const known = CARRIER_ERRORS[errorCode];
    console.error("[sms:delivery] carrier error", {
      code: errorCode,
      severity: known.severity,
      title: known.title,
    });
  } else if (status === "failed" || status === "undelivered") {
    console.error("[sms:delivery] failed", { status, code: errorCode });
  }

  return new NextResponse(null, { status: 204 });
}
