"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Explainer,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  slugLabel,
  Toolbar,
  when,
} from "@/components/admin/ui";
import {
  Fact,
  FactGrid,
  RecordCard,
  RecordDrawer,
  RecordList,
} from "@/components/admin/Record";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { FreshnessOutcomeRow } from "@/lib/admin/types";

/**
 * Estimate 14.9 — records a contributor said are no longer worth recommending.
 *
 * ## Why this queue exists at all
 *
 * 10.2 has been raising `recommendation_withdrawn` since 1 Sep and marking the
 * record **stale rather than rejected**, on a rule worth restating because this
 * whole page follows from it: *one parent's changed mind is evidence, not a
 * verdict* — three others may still stand behind the same class. So the ping
 * loop deliberately stops short of a decision, and this is where the decision
 * gets made.
 *
 * Until now it had no screen. The flag landed in the general Flags queue, where
 * "resolve" meant "I have read this" and left the record exactly as it was:
 * still approved, still answering, still stale. That is a defensible outcome —
 * but it was the *only* reachable one, and it was reached by default rather than
 * chosen.
 *
 * ## The two numbers that make it a decision
 *
 * `firsthand_count` and `recommending_count`, on every card. A record one parent
 * withdrew and nobody else has used is very nearly a retirement; the same
 * withdrawal against four parents who would still recommend it is very nearly a
 * keep. Without both numbers a reader is deciding on the withdrawal alone, which
 * is the one piece of evidence that is guaranteed to be negative.
 *
 * ## Retire, or keep — and what is deliberately missing
 *
 * The row says "retire-or-**re-blast** decisions". Re-blasting is not built, and
 * that is a scoping decision rather than an omission: a Network Ask has an asker
 * and a price (M7's tiers), and a freshness question asked by an admin has
 * neither. Wiring it would mean inventing who pays for it, which is a product
 * decision. What exists instead is honest: the ping loop will ask again on its
 * own schedule, because keeping a record stale leaves it eligible for the next
 * `freshness_ping` run.
 */
export default function FreshnessPage() {
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(true);
  const [deciding, setDeciding] = useState<{
    row: FreshnessOutcomeRow;
    outcome: "retire" | "keep";
  } | null>(null);
  const [reason, setReason] = useState("");

  const { rows, configured, loading, error, demo, setDemo, reload } =
    useAdminRows<FreshnessOutcomeRow[]>("freshness");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* The same shape every other queue page uses: one place that reports what
     happened, distinguishes "saved" from "nothing was saved" (the
     `persisted: false` honesty rule), and reloads. */
  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(result.persisted ? label : `${label} — but nothing was saved.`);
      setDeciding(null);
      setReason("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  const all = rows ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (hideTest && r.is_test) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q);
    });
  }, [all, search, hideTest]);

  const testCount = all.filter((r) => r.is_test).length;

  async function decide() {
    if (!deciding) return;
    const retiring = deciding.outcome === "retire";
    await run(retiring ? "Retired" : "Kept, marked out of date", () =>
      adminAction({
        action: retiring ? "share.retire" : "share.keep",
        id: deciding.row.share_id,
        reason,
      }),
    );
  }

  return (
    <>
      <PageHead
        title="Withdrawn recommendations"
        intro="A contributor said one of these is no longer worth recommending. Retire it, or keep it marked as out of date."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {message && <ResultNote>{message}</ResultNote>}

      <Toolbar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Record name…"
          className={`${inputClass} w-[12rem]`}
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

      {/* Only once there is something to decide about — a rule for judging a
          queue, printed under an empty queue, is a rule the reader is asked to
          hold for work that does not exist (2 Sep). */}
      {filtered.length > 0 && (
        <Explainer title="How to read these">
          <p>
            Nothing has been taken down. Pando asked a parent whether their
            recommendation still holds, they said no, and the record was marked
            out of date — it still answers, with its age shown.
          </p>
          <p className="mt-2">
            <strong>How many other parents stand behind it</strong> is the thing
            to look at. One person changing their mind about somewhere nobody
            else has used is close to a retirement; the same answer about
            somewhere four families still recommend is close to a keep.
          </p>
        </Explainer>
      )}

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
              noSample="There are no sample withdrawals on purpose: retiring a record is a decision, and practising it on a parent who never withdrew anything teaches the wrong thing."
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <Empty
              title={
                all.length === 0
                  ? "Nothing has been withdrawn"
                  : "Nothing matching that"
              }
              body={
                all.length === 0
                  ? "When a contributor answers a freshness check with no, the record shows up here for a decision."
                  : undefined
              }
            />
          </Card>
        ) : (
          /* `RecordCard` is `px-4 py-4` with no border and no background — it
             is built to live inside `Card > RecordList`, which is where the five
             other record queues put it. Mapped straight into a `space-y-4` div,
             these floated on bare paper: the same component with two completely
             different appearances depending on which page you were on. */
          <Card>
            <RecordList>
          {filtered.map((row) => (
            <RecordCard
              key={row.share_id}
              title={row.name}
              kind={slugLabel(row.kind)}
              badges={
                <>
                  {row.is_test && <Badge tone="neutral">Test</Badge>}
                  <Badge tone="gold">{slugLabel(row.freshness_state)}</Badge>
                  {/* The honest reading of the two counts, as a badge rather
                      than left for the reader to compute from the grid. */}
                  {row.recommending_count === 0 ? (
                    <Badge
                      tone="red"
                      hint="Nobody else has recommended it, so the withdrawal is the only firsthand opinion Pando holds."
                    >
                      No other support
                    </Badge>
                  ) : (
                    <Badge
                      tone="green"
                      hint="Other parents still recommend it, so one withdrawal is not the whole picture."
                    >
                      {stillRecommend(row.recommending_count)}
                    </Badge>
                  )}
                </>
              }
              aside={
                row.said_no_by
                  ? said(row.said_no_by, row.said_no_at)
                  : "withdrawn"
              }
              actions={
                <>
                  <Button
                    tone="secondary"
                    onClick={() => setDeciding({ row, outcome: "keep" })}
                  >
                    Keep it, marked old
                  </Button>
                  <Button
                    tone="danger"
                    onClick={() => setDeciding({ row, outcome: "retire" })}
                  >
                    Retire it
                  </Button>
                </>
              }
            >
              <FactGrid>
                <Fact label="Parents who used it">
                  {row.firsthand_count === 0 ? "—" : row.firsthand_count}
                </Fact>
                <Fact label="Would still recommend">
                  {row.recommending_count === 0 ? "—" : row.recommending_count}
                </Fact>
                <Fact label="Last confirmed">
                  {row.last_confirmed_at ? when(row.last_confirmed_at) : "—"}
                </Fact>
                <Fact label="Area">
                  {row.neighborhoods.length > 0
                    ? row.neighborhoods.map(slugLabel).join(", ")
                    : "—"}
                </Fact>
              </FactGrid>
            </RecordCard>
          ))}
            </RecordList>
          </Card>
        )}
      </div>

      {deciding && (
        <RecordDrawer
          title={
            deciding.outcome === "retire"
              ? `Retire ${deciding.row.name}`
              : `Keep ${deciding.row.name}`
          }
        >
          <p className="text-[13.5px] leading-relaxed text-ink-soft">
            {deciding.outcome === "retire"
              ? "It stops appearing in answers straight away. The contributions parents made about it are kept — if it comes back, approving it again is all it takes."
              : "It keeps answering, and keeps showing its age. Pando will ask about it again on the next freshness round."}
          </p>
          <label className="mt-3 block text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
            Why
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className={`${inputClass} mt-1 w-full`}
            placeholder={
              deciding.outcome === "retire"
                ? "Closed permanently — checked their site."
                : "Two other families still recommend it."
            }
          />
          <p className="mt-1 text-[12.5px] text-muted">
            Required. The audit row is the only record of why this record stopped
            answering — or kept going after somebody said it should not.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={decide}
              disabled={busy || reason.trim().length < 3}
              tone={deciding.outcome === "retire" ? "danger" : "primary"}
            >
              {deciding.outcome === "retire" ? "Retire it" : "Keep it"}
            </Button>
            <Button
              tone="secondary"
              onClick={() => {
                setDeciding(null);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </RecordDrawer>
      )}
    </>
  );
}

/**
 * "3 still recommend it", built in JS.
 *
 * The JSX whitespace trap the matching page's `shortfall` documents: an embedded
 * expression loses the space on *both* sides when the block wraps, which reads
 * correctly in the source and as "3still recommend" in the DOM.
 */
function said(who: string, at: string | null): string {
  return at ? `${who} said no · ${when(at)}` : `${who} said no`;
}

function stillRecommend(n: number): string {
  return n === 1 ? "1 still recommends it" : `${n} still recommend it`;
}
