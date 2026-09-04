/**
 * M12.5 — what a delivery failure means, and what to do about it.
 *
 * Pure, so the classification can be tested without a carrier. The estimate names
 * three errors and gives each a different answer, and the differences are the
 * point: one says stop sending entirely, one says the copy is wrong, and one says
 * **our own suppression failed**. Treating them as one "delivery error" bucket
 * would bury the only one that is a bug in Pando.
 */

/** Twilio's terminal states. Anything else is still in flight. */
export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed";

export const TERMINAL_STATUSES: DeliveryStatus[] = ["delivered", "undelivered", "failed"];

/**
 * The three that matter, from 12.5's own list.
 *
 * `severity` drives whether the admin sees red. `alert` is the one number that
 * must never be background noise: 21610 means Pando texted somebody who had asked
 * it to stop, and the suppression list did not catch it.
 */
export const CARRIER_ERRORS: Record<
  number,
  { severity: "alert" | "warn"; action: string; title: string }
> = {
  30034: {
    severity: "alert",
    title: "Number not registered for A2P",
    action:
      "Every send is failing for this reason. Stop sending and finish the 10DLC registration — retrying makes it worse with the carriers.",
  },
  30007: {
    severity: "warn",
    title: "Carrier filtered the message",
    action:
      "A carrier treated the wording as spam. Review the copy of the template that failed; it is registered text, so a change means re-registering the sample.",
  },
  21610: {
    severity: "alert",
    title: "Sent to somebody who opted out",
    action:
      "This is our bug, not carrier noise: the suppression list should have stopped it before it reached Twilio. Check the opt-out mirror before sending anything else.",
  },
};

/**
 * The floor the daily check reports against.
 *
 * 12.5's own number. Below it something is wrong with the sender, the copy or the
 * numbers — not with one recipient.
 */
export const DELIVERY_RATE_FLOOR = 0.95;

export interface DeliveryCounts {
  /** Outbound messages with a terminal status in the window. */
  settled: number;
  delivered: number;
  /** Still queued or sent — excluded from the rate rather than counted against it. */
  in_flight: number;
  by_error: Array<{ code: number; count: number }>;
}

export interface DeliveryHealth {
  /** Null when nothing has settled yet: a rate of 0 out of 0 is not a failure. */
  rate: number | null;
  below_floor: boolean;
  settled: number;
  delivered: number;
  in_flight: number;
  /** Newest first, the ones with an entry in `CARRIER_ERRORS` first. */
  alerts: Array<{
    code: number;
    count: number;
    severity: "alert" | "warn";
    title: string;
    action: string;
  }>;
}

/**
 * Turn raw counts into the health an admin reads.
 *
 * **In-flight messages are excluded from the denominator, not counted as
 * failures.** A message Twilio has accepted and not yet reported on is neither
 * delivered nor undelivered, and counting it either way makes the rate swing with
 * how recently the page was opened rather than with anything real.
 */
export function deliveryHealth(counts: DeliveryCounts): DeliveryHealth {
  const rate = counts.settled > 0 ? counts.delivered / counts.settled : null;
  const alerts = counts.by_error
    .map((e) => {
      const known = CARRIER_ERRORS[e.code];
      return {
        code: e.code,
        count: e.count,
        severity: known?.severity ?? ("warn" as const),
        title: known?.title ?? `Carrier error ${e.code}`,
        /* An unknown code is still shown. A silent one is how a new failure mode
           goes unnoticed for a week. */
        action:
          known?.action ??
          "Not one of the three errors we watch for. Look it up in Twilio's error reference before sending more.",
      };
    })
    .sort(
      (a, b) =>
        Number(b.severity === "alert") - Number(a.severity === "alert") ||
        b.count - a.count ||
        a.code - b.code,
    );

  return {
    rate,
    below_floor: rate !== null && rate < DELIVERY_RATE_FLOOR,
    settled: counts.settled,
    delivered: counts.delivered,
    in_flight: counts.in_flight,
    alerts,
  };
}

/* ── 13.4, the retry half ──────────────────────────────────────────────────── */

/**
 * Whether a failed message is worth sending again, and how soon.
 *
 * The estimate's row is "Delivery status **+ retry**", and the status half has
 * existed since 27 Aug. This is the other half, and it is almost entirely a set
 * of refusals — because for most carrier failures **a retry is a second failure
 * with a second charge**, and for one of them it is a compliance breach.
 *
 * ## The three that must never be retried, and why each is different
 *
 *  - **21610 — they opted out.** Retrying is texting somebody who told Pando to
 *    stop, a second time. It is already a bug that the first one left (the
 *    suppression mirror should have caught it); a retry makes it deliberate.
 *    This is the one where the rule is not economics.
 *  - **30034 — not registered for A2P.** `CARRIER_ERRORS` already says it in
 *    words: "retrying makes it worse with the carriers." Every send is failing
 *    for the same reason, so a retry sweep would turn one outage into a flood of
 *    identical rejections against the sender's reputation.
 *  - **30007 — carrier filtering.** The carrier judged the *wording*. The same
 *    wording will be judged the same way, and repeated attempts are what gets a
 *    sender blocked outright. The answer is registered copy that a carrier
 *    accepts, which is a person's decision, not a timer's.
 *
 * Plus the ones that are simply about the number rather than the moment —
 * a landline, an unreachable handset, a number that does not exist. Those fail
 * identically forever.
 *
 * ## What is retried
 *
 * Only failures that are about *this attempt*: Twilio's own queue overflowing
 * (30001), an unknown internal error (30008), and a send that never reached
 * Twilio at all (a timeout or a 5xx, which arrives here as no code). Those are
 * the cases where the same message, sent again, plausibly arrives.
 *
 * ## Once, and once only
 *
 * `RETRY_LIMIT` is 1. A message that fails twice is a message with a reason
 * nobody has diagnosed, and a third attempt is how a transient blip becomes a
 * self-inflicted flood — while the recipient, who may have received nothing,
 * cannot tell the difference between one Pando and three. The delivery page is
 * where a pattern of them gets noticed.
 *
 * And a retry is **never** a fresh charge against the parent's allowance: the
 * sweep passes `retryOf`, `message_log.retry_of` records it, and every counter
 * in `repo/outreach.ts` excludes rows that carry it (`drizzle/0029`).
 */
export const RETRY_LIMIT = 1;

/**
 * How long to wait before trying again, and how long is too late to bother.
 *
 * The delay exists because a queue that overflowed a second ago is still
 * overflowing. The ceiling exists because these messages are time-bound: a
 * verification code has five minutes (§19), a Network Ask has a window, and a
 * freshness ping asking "is this still worth recommending?" that arrives two
 * days late is a message the parent cannot place. Past the ceiling the honest
 * thing is to let it stay failed and let the loop that owns it ask again on its
 * own schedule.
 */
export const RETRY_DELAY_MINUTES = 5;
export const RETRY_GIVE_UP_MINUTES = 60;

/** Codes that will fail again for the same reason, whenever they are tried. */
const NEVER_RETRY: Record<number, string> = {
  21610: "They opted out — a retry would text somebody who asked Pando to stop.",
  30034: "Not registered for A2P. Retrying makes it worse with the carriers.",
  30007: "A carrier judged the wording. The same wording fails the same way.",
  30003: "The handset is unreachable.",
  30005: "That number does not exist.",
  30006: "That is a landline or an unreachable carrier.",
  30002: "The account is suspended — nothing will send until that is fixed.",
};

/** Codes that are about this attempt rather than this recipient. */
const TRANSIENT = new Set([30001, 30008, 30009]);

export type RetryVerdict =
  | { retry: true; after_minutes: number }
  | {
      retry: false;
      reason:
        | "not_failed"
        | "permanent"
        | "already_retried"
        | "too_old"
        | "unknown_code";
      /** What to say on the delivery page, when there is something to say. */
      note?: string;
    };

/**
 * Should this message be sent again?
 *
 * **An unrecognised code is not retried**, and that default is deliberate. A new
 * carrier error is far more likely to be another permanent one than a transient
 * one — Twilio's 30xxx range is mostly reasons a message can never arrive — and
 * the cost of being wrong in the two directions is not symmetric: not retrying
 * loses one message and shows up on the delivery page as a failure somebody can
 * read, while retrying a permanent failure spends money on every message to that
 * number forever and teaches the carrier that Pando does not listen.
 */
export function shouldRetry(input: {
  status: DeliveryStatus | null;
  error_code: number | null;
  /** How many attempts have already been made for this message. */
  retry_count: number;
  /** Minutes since the original was sent. */
  age_minutes: number;
}): RetryVerdict {
  if (input.status !== "failed" && input.status !== "undelivered") {
    return { retry: false, reason: "not_failed" };
  }
  if (input.retry_count >= RETRY_LIMIT) {
    return { retry: false, reason: "already_retried" };
  }
  if (input.error_code !== null && input.error_code in NEVER_RETRY) {
    return {
      retry: false,
      reason: "permanent",
      note: NEVER_RETRY[input.error_code],
    };
  }
  /* The age check runs *after* the permanent ones, so the delivery page can say
     "this will never work" about an old row rather than the less useful "this
     was too old to try". */
  if (input.age_minutes > RETRY_GIVE_UP_MINUTES) {
    return { retry: false, reason: "too_old" };
  }
  /* No code at all means the request never got a verdict from Twilio — a
     timeout, a 5xx, a dropped connection. That is the clearest transient case
     there is. */
  if (input.error_code === null || TRANSIENT.has(input.error_code)) {
    return { retry: true, after_minutes: RETRY_DELAY_MINUTES };
  }
  return {
    retry: false,
    reason: "unknown_code",
    note: `Error ${input.error_code} is not one Pando knows how to retry safely, so it was left alone. Worth a look if it repeats.`,
  };
}
