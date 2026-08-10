"use client";

import Link from "next/link";
import {
  Card,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  Stat,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import type { Overview } from "@/lib/admin/types";

/**
 * Estimate 2.2 — pilot overview.
 *
 * The numbers Phase 1 is judged on: how many finished, how many gave two or more
 * recommendations, and where people fall out. Funnels themselves live in PostHog
 * (M3) — this page links to them rather than rebuilding charting.
 */
export default function AdminOverviewPage() {
  const { rows, configured, sample, demo, setDemo, loading, error } =
    useAdminRows<Overview | null>("overview");

  const o = rows;
  const completion =
    o && o.contributors.total > 0
      ? Math.round((o.contributors.completed / o.contributors.total) * 100)
      : null;
  const twoPlus =
    o && o.contributors.completed > 0
      ? Math.round((o.contributors.with_two_plus / o.contributors.completed) * 100)
      : null;

  return (
    <>
      <PageHead
        title="Overview"
        intro="Where the seed pilot stands. Anything here that reads 0 with a backend connected is a real 0, not a placeholder."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      {loading && !o ? (
        <Card>
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        </Card>
      ) : !configured && !o ? (
        <Card>
          <NotConfigured demo={demo} onDemo={setDemo} />
        </Card>
      ) : o ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Contributors"
              value={o.contributors.total}
              hint={`${o.contributors.completed} finished the flow`}
            />
            <Stat
              label="Completion"
              value={completion === null ? "—" : `${completion}%`}
              hint="Of everyone who started"
              tone={completion !== null && completion < 50 ? "warn" : "plain"}
            />
            <Stat
              label="Two or more cards"
              value={twoPlus === null ? "—" : `${twoPlus}%`}
              hint="The Phase 1 target metric"
              tone={twoPlus !== null && twoPlus >= 50 ? "good" : "plain"}
            />
            <Stat
              label="Founding to review"
              value={o.founding.pending}
              hint={`${o.founding.approved} approved`}
              tone={o.founding.pending > 0 ? "warn" : "plain"}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Activities" value={o.submissions.activities} />
            <Stat label="Caregivers" value={o.submissions.caregivers} />
            <Stat label="Places" value={o.submissions.places} />
            <Stat label="Tips" value={o.submissions.tips} />
          </div>

          {/*
            The seed reward, which is not the Founding bar: one qualifying
            activity *or* one approved caregiver earns it, where Founding needs
            two. "Gave nothing" is its own number because that is the one the
            client asked for by name — it is who does not get paid.
          */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Reward earned"
              value={o.reward.eligible}
              hint="One approved activity or caregiver"
              tone={o.reward.eligible > 0 ? "good" : "plain"}
            />
            <Stat
              label="Waiting on review"
              value={o.reward.started}
              hint="Gave something, nothing approved yet"
              tone={o.reward.started > 0 ? "warn" : "plain"}
            />
            <Stat
              label="Gave nothing"
              value={o.reward.none}
              hint="Arrived, left no contribution"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Where people stop">
              <ul className="divide-y divide-bark/50">
                {o.drop_off.map((row, i) => {
                  const first = o.drop_off[0]?.reached || 1;
                  const pct = Math.round((row.reached / first) * 100);
                  const lost =
                    i > 0 ? o.drop_off[i - 1].reached - row.reached : 0;
                  return (
                    <li key={row.step} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[14px]">{row.step}</span>
                        <span className="shrink-0 text-[13px] text-muted">
                          {row.reached}
                          {lost > 0 && (
                            <span className="ml-2 text-gold-ink">−{lost}</span>
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bark">
                        <div
                          className="h-full rounded-full bg-green"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] text-muted">
                {o.posthog_url ? (
                  <a
                    href={o.posthog_url}
                    target="_blank"
                    rel="noopener"
                    className="font-semibold text-green-deep underline underline-offset-2"
                  >
                    Open the funnel in PostHog →
                  </a>
                ) : (
                  "Funnels and cohorts live in PostHog (estimate 3.1) — the provider isn't attached yet."
                )}
              </p>
            </Card>

            <div className="space-y-4">
              <Card title="Data quality">
                <ul className="divide-y divide-bark/50 text-[14px]">
                  <QualityRow
                    label="Low-confidence extractions"
                    value={o.quality.low_confidence}
                    href="/admin/activities?confidence=low"
                  />
                  <QualityRow
                    label="Open flags"
                    value={o.quality.open_flags}
                    href="/admin/flags"
                  />
                  <QualityRow
                    label="'Other' answers waiting"
                    value={o.quality.pending_options}
                    href="/admin/options"
                  />
                  <QualityRow
                    label="Caregiver cards held for a person"
                    value={o.quality.review_holds}
                    href="/admin/caregivers"
                  />
                </ul>
              </Card>

              {/* The visibility ladder, not a contact funnel: Pando never reaches
                  out to a nominated caregiver. Each step is the caregiver's own. */}
              <Card title="Caregiver ladder">
                <ul className="divide-y divide-bark/50 text-[14px]">
                  <QualityRow label="Mentioned" value={o.caregivers.mentioned} href="/admin/caregivers" />
                  <QualityRow label="Invited by a parent" value={o.caregivers.invited} href="/admin/caregivers" />
                  <QualityRow label="Consented" value={o.caregivers.consented} href="/admin/caregivers" />
                  <QualityRow label="Declined" value={o.caregivers.declined} href="/admin/caregivers" />
                </ul>
                <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] text-muted">
                  Only consented <em>and</em> active caregivers can ever appear in an
                  answer. We hold no way to contact anyone at any step.
                </p>
              </Card>

              <Card title="What parents asked for">
                <ul className="divide-y divide-bark/50 text-[14px]">
                  <QualityRow label="Ordinary questions" value={o.demand.ordinary} href="/admin/demand" />
                  <QualityRow label="Peer support" value={o.demand.peer_support} href="/admin/demand" />
                  <QualityRow label="Health, legal or safety" value={o.demand.high_stakes} href="/admin/demand" />
                </ul>
                <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] text-muted">
                  Anything but ordinary waits for a person before it can be used.
                </p>
              </Card>

              <Card title="Permissions given">
                <ul className="divide-y divide-bark/50 text-[14px]">
                  <QualityRow label="Follow-ups opted in" value={o.consent.follow_up_opt_in} />
                  <QualityRow label="Willing to be a reference" value={o.consent.reference_willing} />
                </ul>
              </Card>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function QualityRow({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span>{label}</span>
      <span className="flex items-center gap-3">
        <span className="font-display text-[1.05rem] font-bold">{value}</span>
        {href && value > 0 && (
          <Link
            href={href}
            className="text-[13px] font-semibold text-green-deep underline underline-offset-2"
          >
            Review
          </Link>
        )}
      </span>
    </li>
  );
}
