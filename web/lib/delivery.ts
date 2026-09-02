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
