"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Explainer,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  Stat,
  when,
} from "@/components/admin/ui";
import { SegmentedFilter } from "@/components/admin/kit";
import {
  Fact,
  FactGrid,
  Quote,
  RecordCard,
  RecordDrawer,
  RecordList,
} from "@/components/admin/Record";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { BLAST_TIER, PAYMENT_STATUS, sentence } from "@/lib/admin/labels";
import { REFUND_WINDOW_DAYS, assessRefund, formatCents } from "@/lib/payments";
import type { PaymentsResult } from "@/lib/admin/types";

/**
 * Estimate 14.5 — "paid blasts, credit-funded blasts, status, and refund needs."
 *
 * ## Why this is its own page rather than a column on 14.3
 *
 * The rows overlap almost entirely; the reading does not. `/admin/blasts` asks
 * *how is this Ask going* — who was asked, what came back, is it answered.
 * This asks *what does Pando owe, and to whom*, which is a different job, often
 * a different person, and always a different order: here the refunds owed come
 * first and everything else is context.
 *
 * ## The two halves of a refund, and why they are two buttons
 *
 * 13.7 is "the manual refund flow for the first ~60 days, with admin flags", and
 * manual is the design rather than a shortcut: the guarantee turns on whether an
 * answer was *useful*, which is a judgement. Flagging one is done wherever
 * somebody notices — usually the blast queue. **Making** it is done here, because
 * it moves money, and the note is the only record of why.
 *
 * ## What it will not do
 *
 * There is **no partial refund**. A partial needs a rule for how much of a $15
 * Ask three mediocre answers are worth, and nobody has written one; the
 * strategy's promise is "no useful answer → not charged", which is all or
 * nothing. If partials are ever wanted, that is a client decision and a new
 * argument in `lib/server/stripe.ts`, not a number somebody picks in the moment.
 *
 * And there is no automatic refund on a timer. `expire_blasts` already grants a
 * *credit* automatically, because a credit costs nobody anything and is
 * reversible; money is not.
 */
export default function PaymentsPage() {
  const { rows, configured, loading, error, demo, setDemo, reload } =
    useAdminRows<PaymentsResult>("payments");

  const [filter, setFilter] = useState<"owed" | "paid" | "refunded" | "all">("owed");
  const [refunding, setRefunding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const data = rows;
  const all = useMemo(() => (data?.rows ?? []).filter((r) => !r.is_test), [data]);

  const visible = useMemo(() => {
    if (filter === "owed") return all.filter((r) => r.payment_status === "refund_due");
    if (filter === "paid") return all.filter((r) => r.payment_status === "paid");
    if (filter === "refunded") return all.filter((r) => r.payment_status === "refunded");
    return all;
  }, [all, filter]);

  const counts = {
    owed: all.filter((r) => r.payment_status === "refund_due").length,
    paid: all.filter((r) => r.payment_status === "paid").length,
    refunded: all.filter((r) => r.payment_status === "refunded").length,
    all: all.length,
  };

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(result.persisted ? label : `${label} — but nothing was saved.`);
      setRefunding(null);
      setReason("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  const stripe = data?.stripe;

  return (
    <>
      <PageHead
        title="Payments"
        intro="What parents have paid for a Network Ask, and what Pando owes back."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {message && <ResultNote>{message}</ResultNote>}

      {/**
       * The configuration, first, and the order is the design — the same
       * reasoning as `/admin/delivery`: a page reporting money has to say
       * whether the thing that moves money is switched on *before* it shows a
       * number, or a reader who met the total first has already decided how to
       * feel about it.
       *
       * `test` mode is called out as loudly as unconfigured. A page full of
       * plausible payments that all happened in Stripe's sandbox is the single
       * most misleading state this surface can be in.
       */}
      {stripe && !stripe.provisioned && (
        <div className="mb-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
          <p className="text-[14.5px] font-semibold text-gold-ink">
            Stripe is not switched on yet.
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-gold-ink/90">
            No payment link can be created and no refund can be made until{" "}
            <code>STRIPE_SECRET_KEY</code> is set on the server. Everything else on
            this page still reads correctly — there is simply nothing to read yet.
          </p>
        </div>
      )}
      {stripe?.provisioned && stripe.mode === "test" && (
        <div className="mb-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
          <p className="text-[14.5px] font-semibold text-gold-ink">
            Stripe is in test mode.
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-gold-ink/90">
            Everything below is sandbox money. Nobody has been charged and no refund
            here reaches a real card.
          </p>
        </div>
      )}
      {stripe?.provisioned && !stripe.webhook_configured && (
        <div className="mb-4 rounded-2xl border border-alert-line bg-alert-wash p-4">
          <p className="text-[14.5px] font-semibold text-alert">
            Payments can be taken, but Pando will never hear about them.
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-alert/90">
            <code>STRIPE_WEBHOOK_SECRET</code> is unset, so the webhook refuses every
            delivery — fail-closed, deliberately. A parent could pay and their Ask
            would sit unpaid forever. This is the one thing on this page worth fixing
            before the next checkout.
          </p>
        </div>
      )}

      {data && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Taken"
            value={formatCents(data.totals.paid_cents)}
            hint="Paid and not refunded"
          />
          <Stat
            label="Refunds owed"
            value={formatCents(data.totals.refund_due_cents)}
            hint={counts.owed === 1 ? "1 Ask waiting" : `${counts.owed} Asks waiting`}
            tone={data.totals.refund_due_cents > 0 ? "warn" : "plain"}
          />
          <Stat
            label="Refunded"
            value={formatCents(data.totals.refunded_cents)}
            hint="Already returned"
          />
        </div>
      )}

      <div className="mb-4">
        <SegmentedFilter
          label="Which payments to show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "owed", label: "Refunds owed", count: counts.owed },
            { id: "paid", label: "Paid", count: counts.paid },
            { id: "refunded", label: "Refunded", count: counts.refunded },
            { id: "all", label: "Everything", count: counts.all },
          ]}
        />
      </div>
      <Explainer title="How money works here">
        <p>
          <strong>Two prices, and they come from one place.</strong>{" "}
          {stripe && stripe.prices.length > 0
            ? stripe.prices.map((p) => `${p.label} ${p.price}`).join(" · ")
            /* No full stop: the fragment after this supplies one, so a period
               here rendered "No chargeable tier is configured.. A checkout…"
               — visible only on a deployment with no chargeable tier, which
               is every deployment until Stripe is switched on. */
            : "No chargeable tier is configured"}
          {". A checkout reads them from the code, and what was actually charged"}
          {" is frozen onto the Ask"} — so a price change later never alters an old
          receipt or an old refund.
        </p>
        <p className="mt-2">
          <strong>A credit is refunded as a credit.</strong> When a parent pays
          with an earned credit and the Ask goes unanswered, Pando grants a fresh
          credit automatically — there is no charge to reverse, so those rows never
          need you.
        </p>
        <p className="mt-2">
          <strong>Refunds are whole, and by hand.</strong>
          {` For the pilot's first ${REFUND_WINDOW_DAYS} days a person makes every refund and says why. There is no partial: the promise is "no useful answer, not charged", which is all or nothing.`}
        </p>
      </Explainer>


      <Card>

        {loading && !data ? (
          <Loading />
        ) : !configured && !data ? (
          <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample="There are no sample payments on purpose — invented money is worse than invented anything else, and a fabricated $15 payment answers “has anybody actually paid?” with a yes."
            />
        ) : visible.length === 0 ? (
          <Empty
            title={filter === "owed" ? "Nothing is owed" : "Nothing in this view"}
            body={
              filter === "owed"
                ? "No Ask is waiting on a refund. That is the state you want."
                : "Switch the filter, or wait for a parent to pay for an Ask."
            }
          />
        ) : (
          <RecordList>
            {visible.map((row) => {
              const payment = PAYMENT_STATUS[row.payment_status];
              const refund = assessRefund({
                payment_status: row.payment_status as never,
                paid_at: row.paid_at,
                /* The page is not given the Stripe id — it is of no use on
                   screen and a payment reference is not something to put in a
                   screenshot. What matters here is whether one exists, which
                   `paid_at` implies: `blasts_paid_needs_evidence` refuses a
                   paid row without both. */
                stripe_payment_intent_id: row.paid_at ? "present" : null,
                credit_id: row.credit_funded ? "credit" : null,
              });
              return (
                <RecordCard
                  key={row.blast_id}
                  tone={row.payment_status === "refund_due" ? "urgent" : "plain"}
                  title={
                    <span className="font-normal leading-relaxed">
                      “{row.question_text}”
                    </span>
                  }
                  aside={
                    <>
                      {row.asker?.name ?? "No profile"}
                      <span className="mt-0.5 block">
                        {row.paid_at ? `Paid ${when(row.paid_at)}` : "Not paid"}
                      </span>
                    </>
                  }
                  badges={
                    <>
                      <Badge tone={payment?.tone ?? "neutral"}>
                        {payment?.label ?? sentence(row.payment_status)}
                      </Badge>
                      {row.price_cents > 0 && (
                        <Badge tone="neutral">{formatCents(row.price_cents)}</Badge>
                      )}
                      {row.credit_funded && (
                        <Badge tone="green">Paid with an earned credit</Badge>
                      )}
                      {refund.outside_window && row.payment_status !== "refunded" && (
                        <Badge
                          tone="gold"
                          hint={`Past the ${REFUND_WINDOW_DAYS}-day pilot window. Still refundable — the window is guidance, not a lock.`}
                        >
                          Older than {REFUND_WINDOW_DAYS} days
                        </Badge>
                      )}
                    </>
                  }
                  actions={
                    <>
                      {/**
                       * Offered whenever a refund is coherent — including past
                       * the window, deliberately. `lib/payments.ts` records why:
                       * refusing a refund on day 61 by hiding the control is how
                       * a support conversation becomes a bug report. The badge
                       * above says it is old; the person decides.
                       */}
                      {refund.refundable && !refund.credit_instead && (
                        <Button
                          tone="danger"
                          disabled={busy || stripe?.provisioned === false}
                          title={
                            stripe?.provisioned === false
                              ? "Stripe is not switched on, so this could only fail."
                              : "Refunds the whole amount in Stripe, then records it here."
                          }
                          onClick={() => {
                            setRefunding(row.blast_id);
                            setReason(row.refund_reason ?? "");
                          }}
                        >
                          Refund {formatCents(row.price_cents)}
                        </Button>
                      )}
                      {refund.blocked === "no_payment_reference" && (
                        <span className="text-[12.5px] text-alert">
                          This row says it was paid but carries no payment reference —
                          worth checking against Stripe before anything else.
                        </span>
                      )}
                    </>
                  }
                >
                  <FactGrid>
                    <Fact label="Tier">{BLAST_TIER[row.tier] ?? sentence(row.tier)}</Fact>
                    <Fact label="The Ask">{sentence(row.status)}</Fact>
                    <Fact
                      label="Approved replies"
                      hint={
                        row.approved_responses === 0
                          ? "The guarantee is about a useful answer, so none means it is owed"
                          : undefined
                      }
                    >
                      {row.approved_responses}
                    </Fact>
                    <Fact label="Age">
                      {row.age_days === null
                        ? null
                        : row.age_days === 0
                          ? "Paid today"
                          : `${row.age_days} day${row.age_days === 1 ? "" : "s"} ago`}
                    </Fact>
                    {row.refunded_at && (
                      <Fact label="Refunded">{when(row.refunded_at)}</Fact>
                    )}
                  </FactGrid>

                  {row.refund_reason && (
                    <div className="mt-3.5">
                      <Quote
                        label={
                          row.payment_status === "refunded"
                            ? "Why it was refunded"
                            : "Why a refund was flagged"
                        }
                      >
                        {row.refund_reason}
                      </Quote>
                    </div>
                  )}

                  {refunding === row.blast_id && (
                    <RecordDrawer title={`Refund ${formatCents(row.price_cents)}`}>
                      <Field
                        label="Why"
                        hint="Your name goes on this. It is the only record of the decision, and it never reaches the parent."
                      >
                        <input
                          className={inputClass}
                          value={reason}
                          onChange={(e) => setReason(e.target.value.slice(0, 300))}
                        />
                      </Field>
                      <p className="mt-2 text-[12px] leading-relaxed text-muted">
                        This refunds the whole amount in Stripe first, and records it
                        here second. If Stripe refuses, nothing changes and you can
                        try again — the same Ask cannot be refunded twice.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          tone="danger"
                          disabled={busy || reason.trim().length < 3}
                          onClick={() =>
                            void run("Refunded.", async () =>
                              adminAction({
                                action: "blast.refund",
                                id: row.blast_id,
                                reason: reason.trim(),
                              }),
                            )
                          }
                        >
                          Refund it
                        </Button>
                        <Button
                          tone="secondary"
                          onClick={() => {
                            setRefunding(null);
                            setReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </RecordDrawer>
                  )}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Card>
    </>
  );
}
