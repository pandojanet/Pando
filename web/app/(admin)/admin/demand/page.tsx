"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import type { DemandRow, PlaceDemand } from "@/lib/admin/types";

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
  /* Its own resource rather than a field on the rows above: this is an
     aggregate over two tables with a roll-up the browser cannot do, and the
     queue is filtered by tab while these totals never are. */
  const { rows: placeData } = useAdminRows<PlaceDemand>("demand_places");
  const places = placeData ?? { rows: [], questions_no_place: 0 };

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
      <PageHead title="What parents asked for" />

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
            title={filter === "urgent" ? "Nothing needs a person" : "Nothing in this view"}
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
                        hint="Saved with your name. Never reaches the parent."
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

      {(places.rows.length > 0 || places.questions_no_place > 0) && (
        <PlacesCard places={places} />
      )}

      {/* A guarantee the page has no way to break, stated under it on every
          visit. Enforced in the routing code, which is where it belongs. */}
    </>
  );
}

/**
 * 17 Sep — where people join from, ranked.
 *
 * ## Why there is a bar
 *
 * The card's own title is *where demand is strongest*, i.e. it is a ranking —
 * and as eight rows of "13 sign-ups", "6 sign-ups", "1 sign-up" set in one
 * muted size, the ranking was invisible: Pasadena being twice Altadena had to
 * be worked out by reading two numbers. That is the finding the matching
 * weights card already records (7 Sep) — *numbers whose only purpose is to be
 * weighed against each other, and not one of them aligned with another* — so
 * the answer is the same one: a bar, with the top row as the denominator, so
 * the longest is always full and the list reads at a glance.
 *
 * ⚠ **It draws sign-ups and never questions**, because sign-ups is what the SQL
 * orders by; a bar drawing one number beside a list sorted on another would be
 * two rankings on one row. Questions keeps its own figure, at a fixed x.
 *
 * ## Why the two sub-lines are labelled
 *
 * They were both `text-[12.5px] text-muted` at the same indent, so "13 with no
 * ZIP on record" and "Classes & activities · Childcare" read as one grey
 * paragraph and the ZIP line looked like one more topic. A ZIP is a token with
 * its count now, and the topics are a labelled run — the `Fact` idiom this
 * admin already uses everywhere else.
 *
 * ⚠ **An absent ZIP is drawn in a different register from a real one** (dashed
 * and muted, against bordered on paper), because it is not a place: the ZIP
 * question only exists since 14 Sep, so most profiles have none, and a chip
 * saying "13 with no ZIP" set like a postcode would read as a postcode. It is
 * sent by the server rather than counted here, per the 2 Sep rule that a count
 * and the list it describes come from one expression.
 */
function PlacesCard({ places }: { places: PlaceDemand }) {
  /* The top row's own count. `Math.max(1, …)` so a cohort that is questions
     only — every city at zero sign-ups — cannot divide by zero. */
  const most = Math.max(1, ...places.rows.map((r) => r.signups));

  return (
    <Card className="mt-4">
      <div className="px-4 py-3">
        <h2 className="text-[14px] font-semibold">Where demand is strongest</h2>
        {/* The denominator, said once. Every number in this block is a parent
            who finished — see `PlaceDemand` for why "or tried to" is not
            answerable here. */}
        <p className="mt-1 text-[12.5px] text-muted">
          Grouped by city, so a Pasadena district counts towards Pasadena.
          Sign-ups are parents who finished a profile.
        </p>

        <ul className="mt-3">
          {places.rows.map((r) => (
            <li
              key={r.city}
              className="grid gap-x-4 gap-y-1.5 border-t border-bark/40 py-2.5 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)]"
            >
              <h3 className="truncate text-[13.5px] font-semibold">
                {slugLabel(r.city)}
              </h3>

              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {/* Fixed width, with the figure right-aligned inside it, so
                      every bar starts at one x — without that they step
                      sideways with the width of "1" against "13" and stop
                      being comparable, which is the whole point of them. */}
                  <span className="flex w-[5.75rem] shrink-0 items-baseline gap-1 text-[12.5px] text-muted">
                    <span className="w-5 text-right text-[14px] font-semibold tabular-nums text-ink">
                      {r.signups}
                    </span>
                    {r.signups === 1 ? "sign-up" : "sign-ups"}
                  </span>

                  {/* Capped rather than free, so the questions figure beside it
                      also lands at one x on every row. `aria-hidden`: the
                      number it draws is already read out to its left. */}
                  <span
                    aria-hidden="true"
                    className="hidden h-1.5 max-w-[13rem] flex-1 rounded-full bg-bark/40 sm:block"
                  >
                    <span
                      className="block h-full rounded-full bg-green"
                      style={{ width: `${Math.max(4, (r.signups / most) * 100)}%` }}
                    />
                  </span>

                  {r.questions > 0 && (
                    <span className="flex shrink-0 items-baseline gap-1 text-[12.5px] text-muted">
                      <span className="text-[13px] font-semibold tabular-nums text-ink">
                        {r.questions}
                      </span>
                      {r.questions === 1 ? "question" : "questions"}
                    </span>
                  )}
                </div>

                {(r.zips.length > 0 || r.signups_no_zip > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <SubLabel>ZIPs</SubLabel>
                    {r.zips.map((z) => (
                      <span
                        key={z.zip}
                        className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-full border border-bark bg-paper px-2 py-0.5 text-[11.5px]"
                      >
                        <span className="font-semibold tabular-nums">{z.zip}</span>
                        <span className="text-muted">{z.signups}</span>
                      </span>
                    ))}
                    {r.signups_no_zip > 0 && (
                      <span className="whitespace-nowrap rounded-full border border-dashed border-bark px-2 py-0.5 text-[11.5px] text-muted">
                        {r.signups_no_zip} with no ZIP
                      </span>
                    )}
                  </div>
                )}

                {r.categories.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <SubLabel>Asked about</SubLabel>
                    <span className="min-w-0 text-[12.5px] text-muted">
                      {r.categories
                        .map((c) => DEMAND_CATEGORY[c] ?? sentence(c))
                        .join(" · ")}
                    </span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {places.questions_no_place > 0 && (
          <p className="mt-3 border-t border-bark/40 pt-2.5 text-[12.5px] text-muted">
            {places.questions_no_place} question
            {places.questions_no_place === 1 ? "" : "s"} from anonymous sessions,
            with no neighborhood on record.
          </p>
        )}
      </div>
    </Card>
  );
}

/** The 11px uppercase label `Fact` uses, for a line that is not a `<dl>`. */
function SubLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
      {children}
    </span>
  );
}
