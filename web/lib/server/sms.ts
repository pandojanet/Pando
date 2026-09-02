import "server-only";

import { type OutreachKind } from "@/lib/outreach-policy";
import { isOptedOut, outreachAllowed, recordSend } from "@/lib/server/repo/outreach";

/**
 * The single outbound SMS layer (invariant 6 — spec §14, §21).
 *
 * Every text Pando ever sends goes through `sendSms`. Nothing else in the app may
 * call Twilio directly, because the order of the checks below *is* the compliance
 * story: opt-out, then quiet hours, then frequency, then the send.
 *
 * The A2P 10DLC campaign was **approved on 27 Aug**. Until the three `TWILIO_*`
 * values are set on the server this still reports `not_provisioned` rather than
 * pretending — the same rule as `persisted: false` without a `DATABASE_URL`.
 *
 * **The ordering trap, because getting it backwards takes the tool offline:** add
 * the Twilio values *first*, and only then remove `SEED_VERIFY_DEV_CODES`. With
 * neither, `/api/seed/verify/status` reports `sendable: false`, every founding
 * parent falls to the deferred path, and nothing anyone writes reaches the
 * database.
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
  /** Which contributor-protection rule refused it, when `frequency_cap` did. */
  policy_reason?: string;
  /** Provider message id, when there is one. */
  message_id?: string;
}

interface SendInput {
  /** E.164. Never logged. */
  to: string;
  body: string;
  category: SmsCategory;
  /**
   * Who it is going to, as a `people.id`.
   *
   * **Required for `outreach`** and ignored for `transactional`: the
   * contributor-protection rules (invariant 5) are per person, and a verification
   * code goes to a number that may not be anybody yet. An outreach call without
   * one is refused rather than sent unchecked — a missing id must never be a way
   * past the limits.
   */
  personId?: string;
  /**
   * What kind of proactive message this is, for the per-kind rules in
   * `outreach-policy.ts` (v3.2 §10's ping rules). Defaults to `blast`.
   */
  outreachKind?: OutreachKind;
  /** Recorded on `message_log`, so delivery monitoring can group by template. */
  template?: string;
  templateVersion?: string;
  /**
   * The **`message_log` id** of the outbound message this answers — not a person,
   * not an answer, not a blast.
   *
   * It does two things and both need a real message id: it lands in
   * `responded_to`, which is how the response-rate governor knows a reply was a
   * reply, and it exempts a live conversation from quiet hours (12.1: "direct
   * replies in a live conversation are exempt").
   *
   * Anything `transactional` does not need it for the second purpose — quiet
   * hours only apply to `outreach` — so passing a convenient uuid here to mean
   * "this is a reply" writes a row pointing at nothing. It was done three times
   * before this comment existed.
   */
  inReplyTo?: string;
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

export async function sendSms(input: SendInput): Promise<SendResult> {
  const { to, body, category } = input;
  /**
   * 1. Opt-out — a hard block with no exceptions, including scheduled jobs.
   *
   * Two layers, and both are wanted. The Messaging Service has Advanced Opt-Out
   * enabled, so a number that texted STOP is refused by Twilio with 21610, which
   * the provider block turns into `opted_out` — the carrier list is the authority
   * and the one a regulator would look at. `sms_opt_outs` is the earlier mirror
   * (12.3), so Pando never spends a request finding out, and so an opted-out
   * person can be excluded *at the query level* from pools rather than filtered
   * after the fact.
   *
   * It runs for **every** category. A verification code is something the parent
   * asked for, but STOP means stop.
   */
  if (await isOptedOut(to)) {
    return { sent: false, reason: "opted_out" };
  }

  /**
   * 2. Quiet hours — 8am to 9pm Pacific, proactive messages only.
   *
   * 12.1 exempts "direct replies in a live conversation", which is why
   * `inReplyTo` exists separately from `transactional`: answering a parent who
   * just texted at 10pm is a reply, not an intrusion.
   */
  if (category === "outreach" && !input.inReplyTo && isQuietHours()) {
    return { sent: false, reason: "quiet_hours" };
  }

  /**
   * 3. Contributor protection (invariant 5, M8) — outreach only.
   *
   * The numbers live in `lib/outreach-policy.ts` and the counters come from
   * `message_log`. **A missing `personId` is a refusal, not a bypass**: the
   * limits are per person, so a caller that cannot say who this is for cannot be
   * allowed to send proactively.
   */
  if (category === "outreach") {
    if (!input.personId) {
      return { sent: false, reason: "frequency_cap", policy_reason: "no_person" };
    }
    const verdict = await outreachAllowed(input.personId, input.outreachKind ?? "blast");
    if (!verdict.ok) {
      return { sent: false, reason: "frequency_cap", policy_reason: verdict.reason };
    }
  }

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

    /**
     * The record every later rule reads.
     *
     * `message_log` is what 12.5 monitors delivery against and what M8 counts
     * for the monthly cap, the 48-hour gap and the response-rate governor — so a
     * send that is not logged is a send that does not exist to any of them. It is
     * written **after** the provider accepted, never before: a row for a message
     * that was rejected would spend somebody's allowance on nothing.
     *
     * Not awaited in a way that can fail the send: the text has already gone, and
     * telling the caller it did not would be the lie `persisted: false` exists
     * to avoid. A lost row is a counter that is one low; a false failure is a
     * duplicate text.
     */
    if (input.personId) {
      void recordSend({
        personId: input.personId,
        direction: "out",
        category,
        template: input.template ?? null,
        templateVersion: input.templateVersion ?? null,
        providerMessageId: data?.sid ?? null,
        respondedTo: input.inReplyTo ?? null,
      });
    }

    return { sent: true, message_id: data?.sid };
  } catch (error) {
    console.error(
      "[sms] provider unreachable",
      error instanceof Error ? error.name : "unknown",
    );
    return { sent: false, reason: "provider_error" };
  }
}
