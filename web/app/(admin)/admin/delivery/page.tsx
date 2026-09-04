"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Loading,
  NotConfigured,
  PageHead,
  Stat,
} from "@/components/admin/ui";
import { SegmentedFilter } from "@/components/admin/kit";
import { useAdminRows } from "@/lib/admin/client";
import type { DeliveryHealthRow } from "@/lib/admin/types";

/**
 * Estimate 12.5 — delivery health.
 *
 * A send and a delivery are different facts. `sendSms` learns that Twilio
 * accepted a message; whether it arrived comes back later on the status callback.
 * This page is where that difference becomes visible — and the reason it matters
 * is that every failure mode here is silent from inside the app: the code runs,
 * the log says sent, and nobody receives anything.
 *
 * ## What it is built to answer, in order
 *
 * **"Is anything wrong right now?"** — the alerts, first, because two of the three
 * carry an instruction rather than a number. **"How bad?"** — the rate, against
 * 12.5's own 95% floor. **"How much do I not know yet?"** — what is still in
 * flight, which is deliberately not folded into the rate.
 *
 * No count in the sidebar, on purpose: the nav's numbers mean "something here is
 * waiting for you" (10 Aug), and a delivery rate is a gauge, not a queue.
 */
export default function DeliveryPage() {
  const [days, setDays] = useState(7);
  const { rows, loading, error, demo, setDemo } = useAdminRows<DeliveryHealthRow>(
    "delivery",
    { days },
  );

  const data = rows;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

  return (
    <>
      <PageHead
        title="Message delivery"
        intro="Whether the texts actually arrived, and the carrier errors worth doing something about."
        right={
          /* The shared control, not a row of primary buttons. A window picker
             changes what you are looking at; it is not the loudest thing on a
             page that reports carrier failures. */
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
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !data ? (
        <Card>
          <Loading />
        </Card>
      ) : !data?.configured ? (
        <Card>
          <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample="There is no sample delivery rate on purpose — a page that cannot reach the database must say so rather than report perfect delivery."
            />
        </Card>
      ) : (
        <div className="space-y-5">
          {/**
           * Alerts first, and above the rate.
           *
           * Two of the three carry an instruction, not a number — 30034 says stop
           * sending, 21610 says our own suppression failed — and a reader who met
           * the percentage first would have already decided how worried to be.
           */}
          {data.alerts.length > 0 && (
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

          <Card title={`Delivery over ${data.window_days === 1 ? "today" : `${data.window_days} days`}`}>
            {data.settled === 0 && data.in_flight === 0 ? (
              <Empty
                title="Nothing has been sent yet"
                body="Delivery only becomes measurable once Twilio is provisioned and the first message goes out."
              />
            ) : (
              <>
                {/* `Stat`, not two hand-written blocks. These were
                    `text-[26px] font-semibold` in the sans face while the same
                    kind of number on Payments and Overview is `font-display
                    text-[1.7rem] font-bold` — so the two headline figures on
                    this page were set differently from every other headline
                    figure in the admin. The explanation on "Still in flight"
                    was a `title=`, which is unreachable by touch and keyboard. */}
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
                    hint="not counted either way"
                    explain="Twilio accepted these and has not reported back yet. They are neither delivered nor failed, so they are left out of the rate rather than counted against it."
                  />
                </div>

                {/**
                 * 12.5's daily check, stated rather than left to the reader to
                 * compute. A number on its own does not say whether it is bad.
                 */}
                <p
                  className={
                    data.below_floor
                      ? "border-t border-alert-line bg-alert-wash px-4 py-2.5 text-[13.5px] leading-relaxed text-alert"
                      : "border-t border-bark/70 px-4 py-2.5 text-[13.5px] leading-relaxed text-muted"
                  }
                >
                  {data.rate === null
                    ? "Nothing has a final answer yet, so there is no rate to judge. That is not a failure."
                    : data.below_floor
                      ? `Below the 95% floor. At this level the problem is the sender, the wording or the numbers — not one recipient.`
                      : `At or above the 95% floor.`}
                </p>
              </>
            )}
          </Card>

          <p className="text-[12.5px] leading-relaxed text-muted">
            Delivery status arrives on Twilio&apos;s status callback. If this page stays
            empty while messages are going out, the Messaging Service has no status
            callback pointing at <code>/api/sms/status</code> — the sends are real, the
            statuses simply never come back.
          </p>
        </div>
      )}
    </>
  );
}
