"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { SegmentedFilter } from "@/components/admin/kit";
import {
  FactInline,
  FactLine,
  RecordCard,
  RecordDrawer,
  RecordList,
} from "@/components/admin/Record";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { useUrlFilter } from "@/lib/admin/url-state";
import {
  DEMAND_CATEGORY,
  DEMAND_SENSITIVITY,
  DEMAND_STATUS,
  sentence,
} from "@/lib/admin/labels";
import type { DemandRow } from "@/lib/admin/types";

/**
 * Estimate 2.7 — what parents asked for (D1).
 *
 * Every parent gets one question at the end of the flow, and what Pando said back
 * already depended on what they asked. This page is the other half of that promise:
 *
 *  - **high-stakes questions come first, and are not answerable here.** The parent was
 *    given professional resources in the flow. What is owed now is a human following
 *    up, not a recommendation.
 *  - **peer support is not a queue of tickets.** These were only stored because the
 *    parent said yes to keeping them, and the answer is a matched cohort at launch —
 *    so the useful action is marking them matched, never replying in a database.
 *  - **ordinary questions are the launch inventory.** They are the reason to know
 *    which neighborhood needs which answer first.
 *
 * Nothing here is ever published. The text is a parent's own words about their own
 * family, and it stays on this screen.
 */
/** The tabs, and what the query parameter may say. */
const FILTERS = ["urgent", "open", "all"] as const;

export default function DemandPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<DemandRow[]>("demand");

  const [filter, setFilter] = useUrlFilter(FILTERS, "urgent");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /* The question being acted on, not the whole queue. */
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const all = rows ?? [];
  const visible = useMemo(() => {
    const list = all.filter((r) => !r.is_test);
    if (filter === "urgent")
      return list.filter((r) => r.requires_human_review && r.status === "open");
    if (filter === "open") return list.filter((r) => r.status === "open");
    return list;
  }, [all, filter]);

  /* Counted off the filtered list, so the button follows the tab a reader is
     on. Inert at today's 27 questions and in place before the pilot fills it. */
  const { shown, hidden, revealAll } = useReveal(visible);

  /**
   * The counts, and each is computed with **the same predicate as the tab it
   * sits on** — which is a fix, not a refactor. The old badge read "Needs a
   * person · {high + peer}" while the tab it labelled shows everything with
   * requires_human_review, and that includes the allegation class. So on this
   * cohort the tab promised 14 and listed 19: the five questions the page
   * treats as the most serious of all were the five its own counter omitted.
   *
   * The rule that prevents the next one: a count and the list it describes come
   * from one expression, never from two that happen to agree.
   */
  const counts = useMemo(() => {
    const real = all.filter((r) => !r.is_test);
    const open = real.filter((r) => r.status === "open");
    return {
      allegation: open.filter((r) => r.sensitivity === "named_allegation").length,
      high: open.filter((r) => r.sensitivity === "high_stakes").length,
      peer: open.filter((r) => r.sensitivity === "peer_support").length,
      ordinary: open.filter((r) => r.sensitivity === "ordinary").length,
      urgent: open.filter((r) => r.requires_human_review).length,
      open: open.length,
      all: real.length,
    };
  }, [all]);

  /**
   * Demand by area — spec §9 and QC Answers Q7: "log the question with neighborhood
   * … this becomes your market-expansion demand signal." The table answers "what did
   * this parent want"; this answers the question the client actually asks the data,
   * which is "where are people asking from, and about what".
   *
   * Anonymous sessions have no neighborhood to read, so they are counted apart
   * rather than folded into a total that would quietly under-report every area.
   */
  const byArea = useMemo(() => {
    const areas = new Map<string, { total: number; categories: Set<string> }>();
    let unknown = 0;
    for (const r of all) {
      if (r.is_test) continue;
      if (!r.neighborhood) {
        unknown += 1;
        continue;
      }
      const entry = areas.get(r.neighborhood) ?? { total: 0, categories: new Set() };
      entry.total += 1;
      if (r.category) entry.categories.add(r.category);
      areas.set(r.neighborhood, entry);
    }
    return {
      rows: [...areas.entries()]
        .map(([area, v]) => ({ area, total: v.total, categories: [...v.categories] }))
        .sort((a, b) => b.total - a.total),
      unknown,
    };
  }, [all]);

  async function run(
    rowId: string,
    label: string,
    fn: () => Promise<{ persisted: boolean }>,
  ) {
    setBusy(rowId);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted
          ? label
          : `${label} — but nothing was saved.`,
      );
      setNoteFor(null);
      setNote("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead
        title="What parents asked for"
        intro="What parents asked, in their own words. Health, legal and safety ones need a person today."
      />

      {/* Banners above the filter — see `/admin/activities` for why: a wrapped
          filter row pushes a confirmation off a phone screen. */}
      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      <div className="mb-4">
        <SegmentedFilter
          unknown={!rows}
          label="Which questions to show"
          value={filter}
          onChange={setFilter}
          options={[
            {
              id: "urgent",
              label: "Needs a person",
              count: counts.urgent,
            },
            { id: "open", label: "All open", count: counts.open },
            { id: "all", label: "Everything", count: counts.all },
          ]}
        />
      </div>

      {/**
       * Above the high-stakes banner on purpose: this is the only class where Pando
       * does nothing at all until a person has read it.
       */}
      {counts.allegation > 0 && (
        <div className="mb-2 rounded-xl border border-alert-line bg-alert-wash px-4 py-2.5">
          <p className="text-[13.5px] font-semibold text-alert">
            {counts.allegation === 1
              ? "One parent made a claim about a named person."
              : `${counts.allegation} parents made claims about named people.`}
          </p>
        </div>
      )}

      {counts.high > 0 && (
        <div className="mb-4 rounded-xl border border-gold-line bg-gold-wash px-4 py-2.5">
          <p className="text-[13.5px] font-semibold text-gold-ink">
            {counts.high === 1
              ? "One parent asked about health, legal or safety."
              : `${counts.high} parents asked about health, legal or safety.`}
          </p>
        </div>
      )}

      <Card>
        {loading && all.length === 0 ? (
          <Loading />
        ) : error && all.length === 0 ? (
          <Failed />
        ) : !configured && all.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : visible.length === 0 ? (
          <Empty
            title="Nothing in this view"
            body={
              filter === "urgent"
                ? "Nothing is waiting on a person. That is the state you want."
                : "Switch the filter, or wait for new sessions."
            }
          />
        ) : (
          <RecordList>
            {shown.map((row) => {
              const kind = DEMAND_SENSITIVITY[row.sensitivity];
              const needsNote =
                row.sensitivity === "high_stakes" ||
                row.sensitivity === "named_allegation";
              return (
                <RecordCard
                  key={row.id}
                  /**
                   * Only the allegation class gets a wash, and that is a change.
                   * Every non-ordinary row used to carry one, so in the "needs a
                   * person" view the whole page was pink or gold — and two
                   * banners above it were making the same point in words. One
                   * accent that means something beats a page-wide tint: an
                   * allegation is the single class where Pando does *nothing at
                   * all* until a person has read it. High-stakes keeps its badge,
                   * which is where the distinction belongs.
                   */
                  tone={row.sensitivity === "named_allegation" ? "urgent" : "plain"}
                  /* The question in the parent's own words is the record. */
                  title={
                    <span className="font-normal leading-relaxed">
                      “{row.question_text}”
                    </span>
                  }
                  aside={
                    <>
                      {row.contributor?.name ?? "No profile"}
                      <span className="mt-0.5 block">{when(row.created_at)}</span>
                    </>
                  }
                  badges={
                    <>
                      <Badge
                        tone={kind?.tone ?? "neutral"}
>
                        {kind?.label ?? sentence(row.sensitivity)}
                      </Badge>
                      <Badge tone={DEMAND_STATUS[row.status]?.tone ?? "neutral"}>
                        {DEMAND_STATUS[row.status]?.label ?? sentence(row.status)}
                      </Badge>
                      {/**
                       * ⚠ There is deliberately **no** third badge here. It used
                       * to carry "Waiting for you to read it" whenever
                       * `requires_human_review` was set and the row was open —
                       * beside a status badge that already reads **"Not looked
                       * at"** for exactly those rows. Two pills saying one thing,
                       * on every open card. What it was really distinguishing is
                       * *this one needs a person*, and the sensitivity badge to
                       * its left says that in words.
                       *
                       * (Its history is worth keeping: it once read "not usable
                       * until read", driven by a column **nothing ever clears**,
                       * so a question you had read, followed up and answered
                       * still claimed to be unread forever. Tying it to `status`
                       * fixed the lie; removing it fixes the repetition.)
                       */}
                    </>
                  }
                  actions={
                    <>
                      {row.status === "open" && (
                        <Button
                          tone="primary"
                          disabled={busy === row.id}
                          subject={`"${row.question_text.slice(0, 44).trimEnd()}"`}
                          title="Writes a note against this question, with your name on it. Nothing goes to the parent."
                          onClick={() => setNoteFor(noteFor === row.id ? null : row.id)}
                        >
                          {needsNote
                            ? "I've dealt with this"
                            : "I know who could answer"}
                        </Button>
                      )}
                      {row.status !== "closed" && (
                        <Button
                          tone="secondary"
                          disabled={busy === row.id}
                          subject={`"${row.question_text.slice(0, 44).trimEnd()}"`}
                          title="Takes it off the list without a note — for a question that needs nothing from you."
                          onClick={() =>
                            void run(row.id, "Closed", async () =>
                              adminAction({
                                action: "demand.status",
                                id: row.id,
                                to: "closed",
                                note: null,
                              }),
                            )
                          }
                        >
                          Nothing to do
                        </Button>
                      )}
                    </>
                  }
                >
                  {/* One line, not a grid: two one-word values were taking
                      half a 1,130px row each, stacked over their labels — 347px
                      of card for a sentence and two words. */}
                  <FactLine>
                    <FactInline label="About">
                      {row.category
                        ? (DEMAND_CATEGORY[row.category] ?? sentence(row.category))
                        : null}
                    </FactInline>
                    <FactInline label="Where from">
                      {row.neighborhood ? (
                        slugLabel(row.neighborhood)
                      ) : (
                        <span className="text-muted">Not known</span>
                      )}
                    </FactInline>
                  </FactLine>

                  {noteFor === row.id && (
                    <RecordDrawer>
                      <Field
                        label={
                          needsNote
                            ? "What you did about it"
                            : "Who or what could answer this"
                        }
                        hint="Saved with your name, for other admins. It never reaches the parent."
                      >
                        <input
                          className={inputClass}
                          value={note}
                          onChange={(e) => setNote(e.target.value.slice(0, 300))}
                        />
                      </Field>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          tone="primary"
                          disabled={busy === row.id || note.trim().length < 3}
                          onClick={() =>
                            void run(row.id, "Recorded", async () =>
                              adminAction({
                                action: "demand.status",
                                id: row.id,
                                to: needsNote ? "answered" : "matched",
                                note: note.trim(),
                              }),
                            )
                          }
                        >
                          Save
                        </Button>
                        <Button
                          tone="secondary"
                          onClick={() => {
                            setNoteFor(null);
                            setNote("");
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
        <RevealMore n={hidden} onClick={revealAll} />
      </Card>

      {(byArea.rows.length > 0 || byArea.unknown > 0) && (
        <Card className="mt-4">
          <div className="px-4 py-3">
            <h2 className="text-[14px] font-semibold">Where the demand is</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Where the parents asking actually live.
            </p>
            <ul className="mt-3 space-y-1.5">
              {byArea.rows.map((r) => (
                <li key={r.area} className="flex items-baseline gap-2 text-[13.5px]">
                  <span className="w-40 shrink-0 font-medium">
                    {slugLabel(r.area)}
                  </span>
                  <span className="tabular-nums font-semibold">{r.total}</span>
                  {r.categories.length > 0 && (
                    <span className="text-[12.5px] text-muted">
                      {r.categories
                        .map((c) => DEMAND_CATEGORY[c] ?? sentence(c))
                        .join(" · ")}
                    </span>
                  )}
                </li>
              ))}
              {byArea.unknown > 0 && (
                <li className="text-[12.5px] text-muted">
                  {byArea.unknown} from anonymous sessions, with no neighborhood on
                  record.
                </li>
              )}
            </ul>
          </div>
        </Card>
      )}

      {/* A guarantee the page has no way to break, stated under it on every
          visit. Enforced in the routing code, which is where it belongs. */}
    </>
  );
}
