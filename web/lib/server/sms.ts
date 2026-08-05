import "server-only";

/**
 * The single outbound SMS layer (invariant 6 — spec §14, §21).
 *
 * Every text Pando ever sends goes through `sendSms`. Nothing else in the app —
 * and nothing in n8n — may call Twilio directly, because the order of the checks
 * below *is* the compliance story: opt-out, then quiet hours, then frequency, then
 * the send.
 *
 * Today it is deliberately inert: the A2P 10DLC campaign isn't approved and the
 * Messaging Service SID hasn't been issued, so `sendSms` reports
 * `not_provisioned` instead of pretending. Callers must handle that — the same
 * rule as `persisted: false` on the n8n seam: never claim something happened.
 *
 * When the SID arrives, only the marked block at the bottom changes.
 */

export type SmsCategory =
  /** The parent just asked for it (verification code). Quiet hours don't apply. */
  | "transactional"
  /** Pando initiated it (Network Ask, freshness ping). Quiet hours apply. */
  | "outreach";

export interface SendResult {
  sent: boolean;
  /** Why it wasn't sent. Enum, never free text — this gets logged. */
  reason?:
    | "not_provisioned"
    | "opted_out"
    | "quiet_hours"
    | "frequency_cap"
    | "provider_error";
  /** Provider message id, when there is one. */
  message_id?: string;
}

interface SendInput {
  /** E.164. Never logged. */
  to: string;
  body: string;
  category: SmsCategory;
}

function provisioning() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID ?? "",
    token: process.env.TWILIO_AUTH_TOKEN ?? "",
    /** The client's instruction: always the Messaging Service, never the number. */
    service: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
    /**
     * Overridable so the provisioned path can be exercised against a local stub
     * instead of shipping an unexercised code path — or firing test requests at
     * Twilio. Never set in production.
     */
    base: process.env.TWILIO_API_BASE ?? "https://api.twilio.com",
  };
}

/**
 * Twilio error codes we act on rather than lump into `provider_error`.
 *
 * 21610 is the important one: the Messaging Service refuses a number that has texted
 * STOP. That is our opt-out check — the app has no database of its own, so the
 * carrier-level list is the authority, and this is where we hear about it.
 */
const TWILIO_OPTED_OUT = 21610;
const TWILIO_UNSUBSCRIBED_RECIPIENT = 21211; // invalid 'To' — usually a typo'd number

export function isSmsProvisioned(): boolean {
  const p = provisioning();
  return p.sid !== "" && p.token !== "" && p.service !== "";
}

/**
 * Pacific quiet hours: no outreach before 08:00 or after 21:00 PT (spec §14).
 * Computed in America/Los_Angeles regardless of where the server runs — the rule
 * is about the parent's clock, and our VPS is not in California.
 */
export function isQuietHours(now = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  return hour < 8 || hour >= 21;
}

export async function sendSms({ to, body, category }: SendInput): Promise<SendResult> {
  /* 1. Opt-out.
   *
   * The app has no database of its own, so it cannot read `sms_opt_outs` — and it
   * doesn't need to: the Messaging Service has Advanced Opt-Out enabled, so a number
   * that texted STOP is refused by Twilio with error 21610, which the provider block
   * below turns into `reason: "opted_out"`. The carrier-level list is the authority,
   * and it is the one a regulator would look at.
   *
   * When Phase 2 adds outreach, `sms_opt_outs` becomes a second, *earlier* check so we
   * never spend a request finding out — but it is a belt, not the braces. */

  // 2. Quiet hours — outreach only.
  if (category === "outreach" && isQuietHours()) {
    return { sent: false, reason: "quiet_hours" };
  }

  // 3. Frequency / monthly allowance — outreach only.
  //    TODO(phase-2): the 3/5/10/20 cap, the 48-hour gap and the 25%/30-day
  //    response-rate governor (invariant 5) sit here, ahead of the provider call.

  // 4. Provider.
  if (!isSmsProvisioned()) {
    // Counts and enums only — never the number, never the body.
    console.warn("[sms] not provisioned", { category, length: body.length });
    return { sent: false, reason: "not_provisioned" };
  }

  const { sid, token, service, base } = provisioning();
  const params = new URLSearchParams({
    To: to,
    MessagingServiceSid: service,
    Body: body,
  });

  try {
    const res = await fetch(`${base}/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json().catch(() => null)) as {
      sid?: string;
      code?: number;
      message?: string;
      status?: string;
    } | null;

    if (!res.ok) {
      const code = typeof data?.code === "number" ? data.code : null;

      if (code === TWILIO_OPTED_OUT) {
        // They texted STOP. Not an error on our side, and not something to retry:
        // the only way back is START or UNSTOP, from them.
        console.info("[sms] refused — recipient opted out", { category, code });
        return { sent: false, reason: "opted_out" };
      }

      // Never log Twilio's message: it echoes the 'To' number back.
      console.error("[sms] provider rejected", {
        status: res.status,
        code,
        category,
        invalid_recipient: code === TWILIO_UNSUBSCRIBED_RECIPIENT,
      });
      return { sent: false, reason: "provider_error" };
    }

    /**
     * A 201 with `status: "failed"` is possible; Twilio queues most things, so an
     * accepted message is `queued`/`accepted`. Treat anything else as not sent rather
     * than telling the parent a code is on the way.
     */
    if (data?.status === "failed" || data?.status === "undelivered") {
      console.error("[sms] provider accepted then failed", {
        category,
        status: data.status,
      });
      return { sent: false, reason: "provider_error" };
    }

    console.info("[sms] sent", { category, has_message_id: Boolean(data?.sid) });
    return { sent: true, message_id: data?.sid };
  } catch (error) {
    console.error(
      "[sms] provider unreachable",
      error instanceof Error ? error.name : "unknown",
    );
    return { sent: false, reason: "provider_error" };
  }
}
