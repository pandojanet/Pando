import "server-only";
import { ONE_SENDER, isMarketId, isQuietHoursAnywhere, isQuietHoursIn, marketConfig } from "@/lib/markets";

import { quietHoursBlocks, type OutreachKind } from "@/lib/outreach-policy";
import { planSegments } from "@/lib/sms-segments";
import { cardFormat, richContentSid, richVariables, type RichKind } from "@/lib/sms-rich";
import { isOptedOut, marketIdForPhone, outreachAllowed, personMarketId, recordSend } from "@/lib/server/repo/outreach";
import {
  isSlackRelayEnabled,
  postToSlack,
  recipientLabel,
} from "@/lib/server/slack";
import { relayTargetFor } from "@/lib/server/repo/relay";
import { span } from "@/lib/server/trace";

/**
 * The single outbound SMS layer (invariant 6 — spec §14, §21).
 *
 * Every text Pando ever sends goes through `sendSms`. Nothing else in the app may
 * call Twilio directly, because the order of the checks below *is* the compliance
 * story: opt-out, then quiet hours, then frequency, then the throttle, then the send.
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
  /**
   * 13.3 — how many SMS segments this body occupies, and in which encoding.
   *
   * Returned because the caller is the only one who can do anything about it,
   * and because the number is not `length / 160`: one character outside GSM-7
   * moves the whole message to UCS-2 and cuts the per-segment budget from 160 to
   * 70. See `lib/sms-segments.ts`.
   */
  segments?: number;
  encoding?: "gsm7" | "ucs2";
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
  /**
   * 13.4 — the `message_log` id this attempt is retrying.
   *
   * Set only by the retry sweep (`repo/retry.ts`). It is threaded to
   * `message_log.retry_of`, and **every contributor-protection counter excludes
   * rows that carry it** — one message received once must not spend a parent's
   * monthly allowance twice, or restart their 48-hour gap.
   */
  retryOf?: string;
  /** How many attempts preceded this one. Capped by `RETRY_LIMIT`. */
  retryCount?: number;
  /**
   * What this message *is*, where that changes which transport carries it.
   *
   * Only `"verification"` means anything today, and it means one thing: **never
   * the Slack relay.** A code posted into a test channel is a code the parent
   * never receives, so verification is pinned to the real provider whatever the
   * relay is set to (see `transportFor`).
   *
   * It is an explicit marker rather than a guess from `category`, because
   * `transactional` covers most of what the relay exists to exercise — HELP,
   * the settings reply, every capture prompt — and routing on the category would
   * have sent all of those to Twilio and the code to Slack, i.e. exactly
   * backwards.
   */
  purpose?: "verification";
  /**
   * Ask for the RCS quick-reply version of this message (`lib/sms-rich.ts`).
   *
   * `body` is still the text, and it is still what the segment plan, the
   * throttle and every rule above the provider read. It rides in the template as
   * `{{2}}`, and the template's own `twilio/text` is the SMS a phone without RCS
   * receives. `card` is `{{1}}`, the card's text — the body without the sentence
   * that says what to type; omitted, the body is both. Ignored — plain `Body` —
   * when that kind has no content SID set, on the Slack relay, and when either
   * text is too long for its type.
   */
  rich?: { kind: RichKind; card?: string };
}

function provisioning(marketId?: string | null) {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID ?? "",
    token: process.env.TWILIO_AUTH_TOKEN ?? "",
    /**
     * The client's instruction: always the Messaging Service, never the number —
     * the recipient's market's (lib/markets.ts), else the default one.
     */
    service:
      process.env[marketConfig(marketId).messagingServiceEnv] ||
      process.env.TWILIO_MESSAGING_SERVICE_SID ||
      "",
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
 * Quiet hours: no outreach before 08:00 or from 21:00 on (spec §14), on the
 * parent's clock — their market's time zone (lib/markets.ts), the default
 * market's when nobody is named. Never the server's: our VPS is not in California.
 */
export function isQuietHours(now = new Date(), timeZone: string = marketConfig().timeZone): boolean {
  return isQuietHoursIn(timeZone, now);
}

/**
 * Which transport carries this message.
 *
 * **Verification is pinned to the real provider**, always. Everything else goes
 * to the Slack relay while it is enabled — the temporary test channel described
 * in `lib/server/slack.ts` — and to Twilio otherwise.
 *
 * The relay is a swap of the *provider step only*: every rule in `sendSms`
 * above step 4 runs first either way, which is what keeps invariant 6 true while
 * the channel is standing in for SMS.
 */
export function transportFor(input: Pick<SendInput, "purpose">): "sms" | "slack" {
  if (input.purpose === "verification") return "sms";
  return isSlackRelayEnabled() ? "slack" : "sms";
}

/**
 * The relay's provider step.
 *
 * Two things it does that the Twilio block does not have to. It **labels the
 * recipient**, because one channel holding every message would otherwise not
 * say who any of them was for; and it **threads**, so a conversation with one
 * parent stays in one thread and a reply is resolvable back to them — the
 * events route reads `thread_ts` and finds the person through
 * `message_log.provider_message_id`.
 *
 * A person with no thread yet starts one, and its `ts` becomes the thread every
 * later message to them joins. That is why the `message_log` write below is not
 * optional for the relay the way it is for SMS: without the row there is no
 * thread key, so the next reply could not be attributed and the channel would
 * degrade into a flat list.
 */
async function sendViaSlack(input: SendInput): Promise<SendResult> {
  /**
   * Addressed **by number when there is no person id**, which is how SMS
   * addresses everything.
   *
   * A keyword reply (HELP, the START confirmation) is sent before the pipeline
   * has ensured a person, so it carries no `personId`. On a phone that is
   * invisible; in one channel it made the post read "unknown recipient" and sit
   * outside every thread, so the parent's next reply had nothing to resolve
   * against. Found by walking it — `npm run test:relay-live`.
   */
  const target = await relayTargetFor({ personId: input.personId, phone: input.to });

  const result = await postToSlack({
    body: input.body,
    label: recipientLabel({ name: target?.name, phoneMasked: target?.phone_masked }),
    threadTs: target?.thread_ts ?? null,
    category: input.category,
    template: input.template ?? null,
  });

  if (!result.ok) {
    console.error("[sms] relay refused", {
      category: input.category,
      error: result.error,
    });
    return { sent: false, reason: "provider_error" };
  }

  console.info("[sms] sent via relay", {
    category: input.category,
    threaded: Boolean(target?.thread_ts),
  });

  /**
   * Logged against whoever the message was addressed to — including somebody the
   * *caller* could not name, which the SMS path skips.
   *
   * The divergence is deliberate and it is what makes the channel usable: this
   * row carries the thread key, so without it a keyword reply is unthreaded and
   * the reply to it is unattributable. It cannot inflate anybody's limits —
   * every counter in `outreachAllowed` filters `category = 'outreach'` and these
   * are `transactional`. Checked, not assumed.
   *
   * Awaited, unlike the SMS path: there the row is a counter and losing one
   * costs a counter, here it is the address of the conversation.
   */
  const logAgainst = input.personId ?? target?.person_id ?? null;
  if (logAgainst) {
    await recordSend({
      personId: logAgainst,
      direction: "out",
      category: input.category,
      template: input.template ?? null,
      templateVersion: input.templateVersion ?? null,
      providerMessageId: result.ts ?? null,
      respondedTo: input.inReplyTo ?? null,
      /* A relayed retry is a retry, as on the Twilio path (22 Oct audit). */
      retryOf: input.retryOf ?? null,
      retryCount: input.retryCount ?? 0,
    });
  }

  return { sent: true, message_id: result.ts };
}

/** At most four sends a second from this process (invariant 6's throttle). */
export const THROTTLE_MS = 250;
let nextSlot = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + THROTTLE_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

async function sendSmsUntraced(input: SendInput): Promise<SendResult> {
  const { to, body, category } = input;

  /**
   * 13.3 — what this body will actually cost, worked out once.
   *
   * It is **reported, never rewritten**. `lib/sms-templates.ts` holds copy
   * registered with the carrier as A2P samples, and A2P §3.7's rule is that what
   * is registered and what is sent must match — so "correctly handles
   * segmentation" cannot mean quietly swapping the client's em dash for a hyphen
   * on the way out. What it means is that nobody is surprised by the bill.
   *
   * The warning fires on `ucs2`, because that is the case where the number on
   * screen and the number a carrier charges for diverge: 150 characters of plain
   * English is one segment, and the same 150 with one curly apostrophe in them is
   * three. Enums and counts only — the offending characters are named, which is
   * safe (they are punctuation, not content) and is the only thing that makes the
   * warning actionable.
   */
  const plan = planSegments(body);
  if (plan.encoding === "ucs2") {
    console.warn("[sms] non-GSM characters raise the segment count", {
      category,
      segments: plan.segments,
      offenders: plan.offenders.join(""),
    });
  }
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
  const transport = transportFor(input);
  /* Only a proactive message can be held, so only then is the parent's market read (27 Oct). */
  const proactive = category === "outreach" && !input.inReplyTo;
  const marketId = proactive && input.personId ? await personMarketId(input.personId) : null;
  /* Unreadable or unknown market: quiet wherever any market is (fails closed, 27 Oct review). */
  const quiet = !proactive
    ? isQuietHours()
    : isMarketId(marketId)
      ? isQuietHours(new Date(), marketConfig(marketId).timeZone)
      : isQuietHoursAnywhere();
  if (quietHoursBlocks({ category, inReplyTo: Boolean(input.inReplyTo), quiet, transport })) {
    return { sent: false, reason: "quiet_hours" };
  }
  if (quiet && category === "outreach" && !input.inReplyTo && transport === "slack") {
    /* Said out loud every time it happens, because a rule that stops applying
       silently is how it stops applying somewhere it should not. */
    console.info("[sms] quiet hours ignored — relay, so nobody's phone buzzes", {
      template: input.template ?? null,
    });
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
    const verdict = await outreachAllowed(input.personId, input.outreachKind ?? "blast", {
      /* A retry is the same message, so the failed original must not count as
         the "previous request" that spaces it out (see `outreachAllowed`). */
      excludeMessageId: input.retryOf ?? null,
    });
    if (!verdict.ok) {
      return { sent: false, reason: "frequency_cap", policy_reason: verdict.reason };
    }
  }

  /**
   * 3b. Throttle — invariant 6's fourth step, which did not exist until the
   * 22 Oct audit. Sends are spaced at least `THROTTLE_MS` apart in this
   * process, so a blast to five parents or a four-part deep dive leaves as a
   * steady trickle rather than a burst the carrier may filter; Twilio's
   * Messaging Service queues behind this too. After every check, so a refused
   * send never waits.
   */
  await throttle();

  /**
   * 4. Provider — or the relay standing in for it.
   *
   * Below this line the transport differs; everything above it does not, which
   * is the whole design: the test channel is subject to opt-out, quiet hours and
   * contributor protection exactly as a real send is, so what gets exercised in
   * Slack is the behaviour that will ship.
   */
  if (transport === "slack") {
    return sendViaSlack(input);
  }

  if (!isSmsProvisioned()) {
    // Counts and enums only — never the number, never the body.
    console.warn("[sms] not provisioned", { category, segments: plan.segments });
    return { sent: false, reason: "not_provisioned" };
  }

  /*
   * Whose sender: read only while markets name different services (never for the
   * pilot). A proactive text's market was read for quiet hours above; a text
   * sent before the sender is looked up (START, HELP) is matched by its number.
   * Unreadable ⇒ the default service.
   */
  const senderMarket = ONE_SENDER
    ? null
    : proactive && input.personId
      ? marketId
      : input.personId
        ? await personMarketId(input.personId)
        : await marketIdForPhone(to);
  const { sid, token, service, base } = provisioning(senderMarket);
  const plainParams = new URLSearchParams({
    To: to,
    MessagingServiceSid: service,
    Body: body,
  });

  /**
   * The RCS version, when this kind is switched on and the body fits a card.
   *
   * **No `Body` beside `ContentSid`:** Twilio rejects a `Body` sent together with
   * `ContentVariables` (error 35127) and says the template supersedes it. The SMS
   * text lives in the template's own `twilio/text`, as `{{2}}`.
   */
  const contentSid = input.rich ? richContentSid(input.rich.kind) : null;
  /* The card alone is formatted (`cardFormat`); the SMS text goes exactly as written. */
  const variables = contentSid && input.rich ? richVariables(cardFormat(input.rich.card ?? body), body) : null;
  const richParams =
    contentSid && variables
      ? new URLSearchParams({
          To: to,
          MessagingServiceSid: service,
          ContentSid: contentSid,
          ContentVariables: variables,
        })
      : null;

  type ProviderReply = { sid?: string; code?: number; message?: string; status?: string };
  const post = async (form: URLSearchParams) => {
    const response = await fetch(`${base}/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const reply = (await response.json().catch(() => null)) as ProviderReply | null;
    return { res: response, data: reply };
  };

  try {
    let viaRich = richParams !== null;
    let { res, data } = await post(richParams ?? plainParams);

    /**
     * A rich send Twilio refused is sent again as the plain text it always was.
     *
     * Only a **definite refusal** (a 4xx), so nothing was accepted and a second
     * message cannot be a duplicate: a timeout, a dropped connection or a 5xx
     * says nothing about whether the first went, and is left as the failure it
     * is. The two errors the plain text would meet again — an opt-out and a bad
     * number — are not retried either. A wrong SID, an archived template or a
     * variable Twilio dislikes therefore costs the card, never the message.
     */
    if (
      richParams &&
      !res.ok &&
      res.status >= 400 &&
      res.status < 500 &&
      data?.code !== TWILIO_OPTED_OUT &&
      data?.code !== TWILIO_UNSUBSCRIBED_RECIPIENT
    ) {
      console.warn("[sms] rich send refused, sending plain", {
        category,
        status: res.status,
        code: typeof data?.code === "number" ? data.code : null,
      });
      viaRich = false;
      ({ res, data } = await post(plainParams));
    }

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

    console.info("[sms] sent", { category, has_message_id: Boolean(data?.sid), rich: viaRich });

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
        retryOf: input.retryOf ?? null,
        retryCount: input.retryCount ?? 0,
      });
    }

    return {
      sent: true,
      message_id: data?.sid,
      segments: plan.segments,
      encoding: plan.encoding,
    };
  } catch (error) {
    console.error(
      "[sms] provider unreachable",
      error instanceof Error ? error.name : "unknown",
    );
    return { sent: false, reason: "provider_error" };
  }
}

/** sendSms, as one step of the trace (27 Oct, lib/server/trace.ts). */
export async function sendSms(input: Parameters<typeof sendSmsUntraced>[0]): ReturnType<typeof sendSmsUntraced> {
  return span("send", () => sendSmsUntraced(input), (r) => ({ category: input.category, template: input.template ?? null, sent: r.sent, reason: (r as { reason?: string }).reason ?? null }));
}
