"use client";

import { useState } from "react";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Loading,
  Stat,
} from "@/components/admin/ui";
import { SegmentedFilter } from "@/components/admin/kit";
import { useAdminRows } from "@/lib/admin/client";
import type { DeliveryHealthRow } from "@/lib/admin/types";

/**
 * Estimate 12.5 — delivery health, as the top of `/admin/conversations`.
 *
 * It was its own page until 25 Sep and moved here whole: the conversations
 * list and this gauge read the same table, and the question a delivery alert
 * raises — *whose* message did not arrive — is answered by the list directly
 * below it ("Something failed", and each history's per-message status). Nothing
 * was cut in the move: the window picker, the Slack banner, the three carrier
 * alerts, both figures and the 95% line are all still here.
 *
 * A send and a delivery are different facts. `sendSms` learns that Twilio
 * accepted a message; whether it arrived comes back later on the status callback.
 * This is where that difference becomes visible — and the reason it matters is
 * that every failure mode here is silent from inside the app: the code runs,
 * the log says sent, and nobody receives anything.
 *
 * ## What it is built to answer, in order
 *
 * **"Is anything wrong right now?"** — the alerts, first, because two of the three
 * carry an instruction rather than a number. **"How bad?"** — the rate, against
 * 12.5's own 95% floor. **"How much do I not know yet?"** — what is still in
 * flight, which is deliberately not folded into the rate.
 *
 * ## With no database it renders nothing
 *
 * The conversations card below already says the deployment has no database;
 * a second "not configured" block for the same fact, an inch above the first,
 * is the page saying one thing twice. There is no sample for this resource
 * either (`app/api/admin/query/route.ts`), so there was never anything to show.
 */
export function DeliveryHealth() {
  const [days, setDays] = useState(7);
  const { rows, loading, error } = useAdminRows<DeliveryHealthRow>(
    "delivery",
    { days },
  );

  const data = rows;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

  /* The shared control, not a row of primary buttons. A window picker changes
     what you are looking at; it is not the loudest thing on a page that
     reports carrier failures. */
  const picker = (
    <SegmentedFilter
      label="How far back to look"
      value={days}
      onChange={setDays}
      options={[
        { id: 1, label: "Today" },
        { id: 7, label: "7 days" },
        { id: 30, label: "30 days" },
      ]}
    />
  );

  if (data && !data.configured) return null;

  const title = data
    ? `Delivery over ${data.window_days === 1 ? "today" : `${data.window_days} days`}`
    : "Delivery";

  return (
    <div className="mb-4 space-y-4">
      {error && <ErrorNote className="mb-0">{error}</ErrorNote>}

      {/**
        * The one thing a section about delivery has to say before any number
        * in it means anything: these messages did not go to phones.
        *
        * With the relay on, a 100% rate means every message reached a Slack
        * channel — which is the 3 Sep rule, that a surface reporting an outcome
        * says whether the thing producing it is switched on, applied to the
        * transport instead of to Stripe.
        */}
      {data?.relay && (
        <p className="rounded-xl border border-gold-line bg-gold-wash px-3 py-2 text-[12.5px] leading-relaxed text-gold-ink">
          Messages are going to the Slack test channel, not to phones.
        </p>
      )}

      {/**
       * Alerts first, and above the rate.
       *
       * Two of the three carry an instruction, not a number — 30034 says stop
       * sending, 21610 says our own suppression failed — and a reader who met
       * the percentage first would have already decided how worried to be.
       */}
      {data && data.alerts.length > 0 && (
        <Card title={`Needs attention (${data.alerts.length})`}>
          <ul className="divide-y divide-bark/50">
            {data.alerts.map((a) => (
              <li key={a.code} className="px-4 py-3.5">
                <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-ink">
                  {a.title}
                  <Badge tone={a.severity === "alert" ? "red" : "gold"}>
                    {a.count} {a.count === 1 ? "message" : "messages"}
                  </Badge>
                  <span className="text-[12px] font-normal tabular-nums text-muted">
                    Twilio {a.code}
                  </span>
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
                  {a.action}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={title} right={picker}>
        {loading && !data ? (
          <Loading />
        ) : error && !data ? (
          <Failed />
        ) : !data ? null : data.settled === 0 && data.in_flight === 0 && data.unreported === 0 ? (
          <Empty title="Nothing has been sent yet" />
        ) : (
          <>
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
              <Stat
                label="Delivered"
                tone={data.below_floor ? "alert" : "plain"}
                value={data.rate === null ? "—" : pct(data.rate)}
                hint={`${data.delivered} of ${data.settled} that have a final answer`}
              />
              <Stat
                label="Still in flight"
                value={data.in_flight}
                hint="sent in the last day · not counted either way"
              />
            </div>
            {/* A day with no final status is not "in flight": the report never
                came back. On the relay that is every message, because Slack
                sends no delivery status; with Twilio it means the Messaging
                Service has no status callback pointing at /api/sms/status. */}
            {data.unreported > 0 && (
              <p className="border-t border-bark/70 px-4 py-2.5 text-[13.5px] leading-relaxed text-muted">
                {data.unreported === 1 ? "1 message" : `${data.unreported} messages`}{" "}
                older than a day never reported back
                {data.relay
                  ? " — the Slack relay sends no delivery status."
                  : " — check that the Messaging Service's status callback points at /api/sms/status."}
              </p>
            )}

            {/**
             * 12.5's daily check, stated rather than left to the reader to
             * compute. A number on its own does not say whether it is bad.
             *
             * ⚠ And on a thin sample it does not say that either. Measured on
             * the live database: 13 settled against 51 that never reported, so
             * this line read **"At or above the 95% floor"** under a headline
             * **100%** — a green all-clear over an outage in which no status
             * was coming back at all, which is the failure the paragraph
             * directly above it is written to diagnose. `thin_sample` is what
             * withholds the reassurance; the count stays in that paragraph
             * rather than being said twice.
             */}
            <p
              className={
                data.below_floor
                  ? "border-t border-alert-line bg-alert-wash px-4 py-2.5 text-[13.5px] leading-relaxed text-alert"
                  : data.thin_sample
                    ? "border-t border-gold-line bg-gold-wash px-4 py-2.5 text-[13.5px] leading-relaxed text-gold-ink"
                    : "border-t border-bark/70 px-4 py-2.5 text-[13.5px] leading-relaxed text-muted"
              }
            >
              {data.rate === null
                ? "No message has a final answer yet."
                : data.below_floor
                  ? data.thin_sample
                    ? "Below the 95% floor — and on a minority of the window, so the real rate could be worse."
                    : "Below the 95% floor."
                  : data.thin_sample
                    ? "Too few reports to judge against the 95% floor."
                    : "At or above the 95% floor."}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
