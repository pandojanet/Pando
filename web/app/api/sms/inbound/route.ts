import { NextResponse, after } from "next/server";
import { toE164 } from "@/lib/phone";
import { verifyTwilioSignature } from "@/lib/server/twilio-signature";
import { handleInboundMessage } from "@/lib/server/inbound";

/**
 * M13.2 — the inbound webhook, and M12.3/12.4's precedence.
 *
 * Twilio POSTs every inbound text here. This route now does exactly two things
 * that are its own — **prove the request is Twilio's**, and work out which
 * number it came from — and hands the message to `handleInboundMessage`, which
 * is where the pipeline lives now that the Slack relay gives it a second door.
 * See that module for the order of the steps and the reasoning behind it.
 *
 * ## Why the signature is not hardening to add later
 *
 * The URL is public and everything behind it acts on what the request claims, so
 * a forged POST could opt somebody out, opt somebody back *in* after they asked
 * to stop, or write a fake reply that raises a contributor's response rate and
 * keeps Pando texting them. **Unconfigured refuses**: an endpoint that skips
 * verification when a secret is missing is unauthenticated the moment somebody
 * mis-deploys, and silently.
 *
 * ## Why it always answers 200 with empty TwiML
 *
 * A non-2xx makes Twilio retry, and a retry of a STOP is harmless while a retry
 * of anything else duplicates a log row. The one exception is a bad signature,
 * which is a 403: that request was not Twilio's, and it should not be encouraged.
 */

/** Empty TwiML — accepted, no auto-reply from the webhook itself. */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml() {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value;

  const verdict = verifyTwilioSignature(
    "/api/sms/inbound",
    params,
    request.headers.get("x-twilio-signature"),
  );
  if (!verdict.ok) {
    /* Counts and enums only — never the body, never the number (invariant 7). */
    console.warn("[sms:inbound] refused", { reason: verdict.reason });
    return NextResponse.json({ error: "Unverified" }, { status: 403 });
  }

  const from = toE164(params.From ?? "");
  const body = params.Body ?? "";
  if (!from) {
    console.warn("[sms:inbound] no usable sender");
    return twiml();
  }

  /**
   * Answered before the pipeline runs, the same as the Slack door and for the
   * same reason — the two transports must not differ in behaviour, which is the
   * whole point of there being one `handleInboundMessage`.
   *
   * Twilio is more forgiving than Slack (fifteen seconds, and a timeout is an
   * error rather than a retry-with-duplicate), so this was not the door where
   * the duplicates appeared. It is still the wrong shape: a pipeline that now
   * makes a model call and two queries should not be holding open the response
   * that tells the carrier the message was received.
   *
   * The handler logs the keyword and the length for both transports, so this
   * route does not log it again.
   */
  after(async () => {
    try {
      await handleInboundMessage({ from, body });
    } catch (err) {
      console.error("[sms:inbound] pipeline failed", {
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  });

  return twiml();
}
