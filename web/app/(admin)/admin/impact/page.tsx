"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Explainer,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  Toolbar,
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { SegmentedFilter } from "@/components/admin/kit";
import {
  Fact,
  FactGrid,
  Quote,
  RecordCard,
  RecordList,
} from "@/components/admin/Record";
import { useAdminRows } from "@/lib/admin/client";
import type { ImpactEventRow, ImpactResult } from "@/lib/admin/types";

/**
 * Estimate 14.6 — thank-you events, contribution impact and reward status.
 *
 * ## Why the two halves are one row
 *
 * 9.1 asks the parent who received an answer whether it helped. 9.2 thanks the
 * contributors whose recommendation it was. Read apart, **the interesting case
 * is invisible from either side**: a parent said *yes* and the people behind the
 * recommendation have not been thanked. From the answers side that is an
 * ordinary answered prompt; from the thanks side it is an absence. Together it
 * is a loop that stopped, which is the one thing this page exists to surface.
 *
 * That join only became possible with `drizzle/0026` — before `answers.share_ids`
 * an answer knew what it said and never which records it said it from, so there
 * was no path from "we booked it" back to the person who earned the thanks.
 *
 * ## The rule the whole page has to respect
 *
 * **A silence is not a no.** `helped` is null until the parent replies, and null
 * never means the recommendation failed: it neither blames a contributor nor
 * earns anybody a thank-you. So "waiting" is its own tab rather than being
 * folded into the noes, and the copy says so out loud — a reader who read null
 * as failure would draw exactly the wrong conclusion about a good record.
 *
 * ## No actions
 *
 * Nothing is sent or granted from here. A thank-you goes out through
 * `thanks_delivery`, which batches one per contributor per week — a button here
 * would be a second sender with no knowledge of that week, and the page's job is
 * to show whether the loop is running rather than to run it by hand.
 */
export default function ImpactPage() {
  const [view, setView] = useState<"all" | "yes" | "no" | "awaiting" | "unasked">("all");
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(true);

  const { rows, configured, loading, error, demo, setDemo } =
    useAdminRows<ImpactResult>("impact");

  const all = rows?.rows ?? [];
  const totals = rows?.totals;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (hideTest && r.is_test) return false;
      if (view === "yes" && r.helped !== true) return false;
      if (view === "no" && r.helped !== false) return false;
      if (view === "awaiting" && !(r.helped_asked_at !== null && r.helped === null)) {
        return false;
      }
      if (view === "unasked" && r.helped_asked_at !== null) return false;
      if (!q) return true;
      return [r.question, r.asker, ...r.records.map((x) => x.name)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, view, search, hideTest]);

  const testCount = all.filter((r) => r.is_test).length;

  /**
   * The case worth leading with: a yes whose contributors are still unthanked.
   *
   * Computed here rather than in SQL because it is a *join* of the two halves —
   * and because "unthanked" is per contributor, so a row with two contributors
   * where one has been thanked is still owed.
   */
  const owed = useMemo(
    () =>
      filtered.filter(
        (r) =>
          r.helped === true &&
          r.contributors.some((c) => c.last_thanked_at === null),
      ).length,
    [filtered],
  );

  /* Every queue reveals the same way: thirty rows, then a button saying how
     many are left. Inert until the list is long enough to need it. */
  const { shown, hidden, revealAll } = useReveal(filtered);

  return (
    <>
      <PageHead
        title="Thanks and impact"
        intro="Whether the answers Pando sent actually helped, and whether the parents behind them have heard about it."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <Toolbar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Question, record, parent…"
          className={`${inputClass} w-[13rem]`}
        />
        {testCount > 0 && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={hideTest}
              onChange={(e) => setHideTest(e.target.checked)}
            />
            Hide test ({testCount})
          </label>
        )}
      </Toolbar>

      <div className="mb-4">
        <SegmentedFilter
          label="Which answers"
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { id: "all" as const, label: "All sent", count: all.length },
            { id: "yes" as const, label: "It helped", count: totals?.answered_yes },
            { id: "no" as const, label: "It didn't", count: totals?.answered_no },
            { id: "awaiting" as const, label: "No reply", count: totals?.awaiting },
            { id: "unasked" as const, label: "Not asked", count: totals?.unasked },
          ]}
        />
      </div>


      <Explainer title="How to read this">
        <p>
          A few days after Pando sends an answer it asks the parent whether it
          helped. A <strong>yes</strong> is what earns the people behind that
          recommendation a thank-you, sent in a weekly batch so nobody hears from
          Pando twice for being helpful.
        </p>
        <p className="mt-2">
          <strong>No reply is not a no.</strong> Most parents will not answer, and
          that says nothing about the recommendation — it is never recorded as a
          failure and never blames a contributor.
        </p>
      </Explainer>

      <div className="space-y-4">
        {loading && !rows ? (
          <Card>
            <Loading />
          </Card>
        ) : !configured ? (
          <Card>
            <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample="There is no sample impact on purpose: a fabricated “it helped” is the one claim this page exists to count."
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <Empty
              title={all.length === 0 ? "No answers have gone out yet" : "Nothing in this view"}
              body={
                all.length === 0
                  ? "Once an answer is approved and sent, it shows up here — and a few days later Pando asks whether it helped."
                  : undefined
              }
            />
          </Card>
        ) : (
          <>
            {owed > 0 && (
              <p className="rounded-xl border border-gold-line bg-gold-wash px-4 py-2.5 text-[13.5px] leading-relaxed text-gold-ink">
                {owedNote(owed)}
              </p>
            )}
            {/* `RecordCard` has no border and no background of its own — it is
                built for `Card > RecordList`, which is where the five other
                record queues put it. Mapped straight into a `space-y-4` div,
                these floated on bare paper: one component, two appearances,
                depending only on which page you happened to be on. */}
            <Card>
              <RecordList>
                {shown.map((row) => (
                  <ImpactCard key={row.answer_id} row={row} />
                ))}
              </RecordList>
              <RevealMore n={hidden} onClick={revealAll} />
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function ImpactCard({ row }: { row: ImpactEventRow }) {
  const unthanked = row.contributors.filter((c) => c.last_thanked_at === null);

  return (
    <RecordCard
      title={row.records.length > 0 ? row.records.map((r) => r.name).join(", ") : "Answer"}
      kind={row.records.length === 1 ? "record" : `${row.records.length} records`}
      badges={
        <>
          {row.is_test && <Badge tone="neutral">Test</Badge>}
          {row.helped === true && (
            <Badge tone="green" hint="The parent replied YES when Pando asked whether it helped.">
              It helped
            </Badge>
          )}
          {row.helped === false && (
            <Badge tone="gold" hint="The parent replied NO. Not a fault of the record — a recommendation can be excellent and wrong for one family.">
              It didn&apos;t help
            </Badge>
          )}
          {row.helped === null && row.helped_asked_at !== null && (
            <Badge
              tone="neutral"
              hint="Asked and no reply. Never recorded as a no — a silence is not a verdict."
            >
              No reply
            </Badge>
          )}
          {row.helped_asked_at === null && (
            <Badge
              tone="muted"
              hint="Pando has not asked yet. The window is 3–5 days for a class and 7–14 for a caregiver, and past it the question is not asked at all."
            >
              Not asked
            </Badge>
          )}
          {row.helped === true && unthanked.length > 0 && (
            <Badge
              tone="red"
              hint="The parent said it helped, and these contributors have never been thanked. The weekly batch should pick them up — if it does not, the loop has stopped."
            >
              {owedBadge(unthanked.length)}
            </Badge>
          )}
        </>
      }
      aside={row.sent_at ? `sent ${when(row.sent_at)}` : "not sent"}
    >
      {/* The parent's own words, in the one style reserved for them — invariant
          8 turns on the difference between what somebody wrote and what the
          system says about it. */}
      <Quote>{row.question}</Quote>

      <FactGrid>
        <Fact label="Asked by">{row.asker ?? "New number"}</Fact>
        <Fact label="Pando asked if it helped">
          {row.helped_asked_at ? when(row.helped_asked_at) : "—"}
        </Fact>
        <Fact label="Parents behind it">
          {row.contributors.length === 0 ? "—" : row.contributors.length}
        </Fact>
        <Fact label="Thanked">
          {row.contributors.length === 0
            ? "—"
            : thankedSummary(row.contributors.length - unthanked.length, row.contributors.length)}
        </Fact>
      </FactGrid>

      {row.contributors.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {row.contributors.map((c) => (
            <li key={c.person_id}>
              <span className="font-medium">{c.name ?? "Unnamed"}</span>{" "}
              <span className="text-muted">
                {c.last_thanked_at ? `thanked ${when(c.last_thanked_at)}` : "never thanked"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecordCard>
  );
}

/* All four built in JS rather than interpolated: JSX strips the whitespace on
   both boundaries of an embedded expression when the block wraps, which is the
   trap the matching page's `shortfall` documents. */

function owedNote(n: number): string {
  return n === 1
    ? "1 answer helped somebody and the parent behind it has never been thanked. The weekly batch should pick it up — if it has not, the thanks job is not running."
    : `${n} answers helped somebody and the parents behind them have never been thanked. The weekly batch should pick them up — if it has not, the thanks job is not running.`;
}

function owedBadge(n: number): string {
  return n === 1 ? "1 owed a thank-you" : `${n} owed a thank-you`;
}

function thankedSummary(thanked: number, total: number): string {
  if (thanked === 0) return "none yet";
  return thanked === total ? "all of them" : `${thanked} of ${total}`;
}
