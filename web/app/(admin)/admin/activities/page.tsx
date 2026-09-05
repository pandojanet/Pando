"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  Empty,
  ErrorNote,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  optionLabel,
  PageHead,
  ProvenanceBadge,
  ResultNote,
  SampleBanner,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { Hint, SegmentedFilter } from "@/components/admin/kit";
import {
  Fact,
  FactGrid,
  Quote,
  RecordCard,
  RecordDrawer,
  RecordList,
  RecordNotes,
} from "@/components/admin/Record";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { ContributionRow } from "@/lib/admin/types";
import {
  FRESHNESS,
  RECOMMENDATION,
  REVIEW_STATUS,
  sentence,
} from "@/lib/admin/labels";
import { PRICE_BAND, PRICE_UNIT, WORTH_IT } from "@/lib/seed-chat/scripts";

/**
 * Estimate 2.4 — contribution review.
 *
 * One queue for activities, places and tips: they differ by `kind`, not by shape. The
 * row is one parent's experience of one place (R1–R11), so five parents recommending
 * the same class are five rows to read and one place to keep clean.
 *
 * Four things the client's rules put on the screen:
 *  - **firsthand or secondhand.** A secondhand card is welcome and labelled, and can
 *    never count toward Founding. Approving it must not quietly promote it.
 *  - **the Founding checklist, per row.** Age at the time, recency, a strength, fit
 *    context, an answered caveat prompt. What is missing is why somebody is stuck at
 *    one qualifying contribution, so it is visible here rather than inferred.
 *  - **"needs more detail" is not a rejection.** The client was explicit: it is a
 *    held state, not a rejection — its own action with the question attached. It
 *    is *not* an outbound message: there is no SMS reply pipeline yet, so the
 *    question is a note for whoever reviews the queue next, and the row stays in
 *    "To review" rather than disappearing into "All" the moment it's set.
 *  - **low confidence first.** That queue is what improves the extraction prompt.
 *
 * ## 2 Sep — this stopped being a table, and that was overdue
 *
 * It had **ten columns**, and walking it in a browser is what settled the
 * argument: "Counts toward Founding" rendered as six lines of one word each
 * down a 90px column, the three action buttons wrapped their own labels
 * ("Add to Pando" over three lines), and the free text a reviewer is actually
 * here to read — the caveat, the tip, the question we asked — was crammed
 * under the name in 12.5px italics.
 *
 * A table promises that a column means the same thing on every row and can be
 * scanned down. This queue never kept that promise, because half its columns
 * hold sentences. It is `RecordCard` now: the facts get a line each, the
 * parent's own words get a quote treatment that distinguishes them from the
 * system's prose (which is invariant 8's distinction, on screen), and every
 * action gets its whole label.
 *
 * `/admin/contributors` is deliberately **still a table** — its values are all
 * short. The layout follows the data, not a preference.
 */
export default function ContributionsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<ContributionRow[]>("contributions");

  const [filter, setFilter] = useState<
    "pending" | "low" | "secondhand" | "incomplete" | "golden" | "all"
  >("pending");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ContributionRow>>({});
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const all = rows ?? [];
  const real = useMemo(() => all.filter((r) => !r.is_test), [all]);

  const visible = useMemo(() => {
    const list = real;
    if (filter === "low")
      return list.filter((r) => r.confidence !== null && r.confidence < 0.6);
    if (filter === "secondhand") return list.filter((r) => !r.firsthand);
    if (filter === "incomplete")
      return list.filter((r) => missingForFounding(r).length > 0 && r.firsthand);
    /**
     * "Needs one more detail" is a held state, not a dead end — the screen's own
     * promise is that the card "stays in the queue until they answer" (there is
     * no way to actually notify them yet, but the queue itself must not lie).
     * Leaving `needs_detail` rows out of "To review" would bury them in "All"
     * the moment the question is asked, which is the opposite of staying visible.
     */
    if (filter === "pending")
      return list.filter(
        (r) => r.status === "pending_review" || r.status === "needs_detail",
      );
    /**
     * The golden-answer pass (§23.1 step 9): approved records only, because that is
     * the pool the flag can be set on, and the ones already marked float to the top
     * so a session can be picked up where it was left.
     */
    if (filter === "golden")
      return list
        .filter((r) => r.status === "approved")
        .sort(
          (a, b) => Number(b.share.answer_ready) - Number(a.share.answer_ready),
        );
    return list;
  }, [real, filter]);

  /* Off the filtered list, so the number the button offers is the number the
     current tab is hiding. Inert until a tab holds more than thirty. */
  const { shown, hidden, revealAll } = useReveal(visible);

  /**
   * The counts live on the filters, so "is there anything in the other views"
   * is answerable without clicking through all six. The nav already does this
   * for the queue as a whole; this is the same idea one level in.
   */
  const counts = useMemo(
    () => ({
      pending: real.filter(
        (r) => r.status === "pending_review" || r.status === "needs_detail",
      ).length,
      low: real.filter((r) => r.confidence !== null && r.confidence < 0.6).length,
      incomplete: real.filter(
        (r) => r.firsthand && missingForFounding(r).length > 0,
      ).length,
      secondhand: real.filter((r) => !r.firsthand).length,
      golden: real.filter((r) => r.share.answer_ready).length,
      all: real.length,
    }),
    [real],
  );

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted ? label : `${label} — but nothing was saved.`,
      );
      setEditing(null);
      setQuestion("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Contributions"
        intro="Add the ones you'd be happy for Pando to pass on. Hold the ones missing something."
      />

      {/* Banners **above** the filter. At 375px this six-pill row wraps to three
          lines, so a green "Approved" confirmation rendered underneath it landed
          off the bottom of the screen — the reader acted, saw nothing, and had
          no way to tell whether it had worked. */}
      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      <div className="mb-4">
        <SegmentedFilter
          label="Which contributions to show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "pending", label: "To review", count: counts.pending },
            { id: "low", label: "Needs a read", count: counts.low },
            { id: "incomplete", label: "Missing a detail", count: counts.incomplete },
            { id: "secondhand", label: "Heard from a friend", count: counts.secondhand },
            { id: "golden", label: "Ready to answer with", count: counts.golden },
            { id: "all", label: "Everything", count: counts.all },
          ]}
        />
      </div>

      <Card>
        {loading && all.length === 0 ? (
          <Loading />
        ) : !configured && all.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : visible.length === 0 ? (
          <Empty
            title="Nothing in this view"
            body="Switch the filter, or wait for new submissions."
          />
        ) : (
          <RecordList>
            {shown.map((row) => {
              const open = editing === row.id;
              const missing = missingForFounding(row);
              return (
                <RecordCard
                  key={row.id}
                  /* A secondhand card stays visibly different — it is welcome,
                     labelled, and can never count toward Founding — but the
                     shade is the card's, not a whole row of table cells. */
                  tone={row.firsthand ? "plain" : "pending"}
                  title={row.share.name}
                  kind={row.kind}
                  aside={
                    <>
                      {row.contributor?.name ?? "—"}
                      <span className="mt-0.5 block">{when(row.created_at)}</span>
                    </>
                  }
                  badges={
                    <>
                      <Badge
                        tone={REVIEW_STATUS[row.status]?.tone ?? "neutral"}
                        hint={REVIEW_STATUS[row.status]?.meaning}
                      >
                        {REVIEW_STATUS[row.status]?.label ?? row.status}
                      </Badge>
                      {/* R2 — the label reads the source, never who typed it. */}
                      {row.firsthand ? (
                        <Badge tone="green">
                          They went themselves
                        </Badge>
                      ) : (
                        <Badge
                          tone="gold"
                          hint="Someone told them about it. Welcome, always labelled as such, and never counted toward Founding."
                        >
                          Heard from a friend
                        </Badge>
                      )}
                      <ProvenanceBadge provenance={row.provenance} />
                      {row.share.answer_ready && (
                        <Badge
                          tone="green"
                          hint="Good enough to answer a parent's question on its own, without asking anyone"
                        >
                          Ready to answer with
                        </Badge>
                      )}
                    </>
                  }
                  actions={
                    <>
                      {/**
                       * The action set is derived from one rule — "offer what
                       * this row is not already" — rather than from a list of
                       * statuses, which is how a card held for a detail ended
                       * up with no way to be added at all: the old condition
                       * was `status === "pending_review"`, so asking for a
                       * detail quietly removed the only button that mattered.
                       *
                       * The status pill above is the other half. Without it the
                       * buttons changing between cards reads as random; with
                       * it, "this one is already added, so there is nothing to
                       * add" is obvious at a glance.
                       */}
                      {row.status !== "approved" && (
                        <Button
                          tone="primary"
                          disabled={busy}
                          title="Make this usable in an answer to a parent"
                          onClick={() =>
                            void run("Added to Pando.", async () =>
                              adminAction({
                                action: "contribution.approve",
                                id: row.id,
                              }),
                            )
                          }
                        >
                          Add to Pando
                        </Button>
                      )}
                      <Button
                        tone="secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditing(open ? null : row.id);
                          setDraft(open ? {} : { ...row });
                          /* Otherwise a question typed for one row and left
                             unsent reappears in the next row's box — and a row
                             already asked something should show what, not a
                             blank field. */
                          setQuestion(open ? "" : row.needs_detail_note ?? "");
                        }}
                      >
                        {open ? "Close" : "Edit or hold"}
                      </Button>
                      {/**
                       * Golden answers (§17.1). Only offered on an approved
                       * record, because that is the only state the flag can be
                       * true in — the database says so too.
                       */}
                      {row.status === "approved" && (
                        <Button
                          tone="secondary"
                          disabled={busy}
                          title={
                            row.share.answer_ready
                              ? "Stop treating it as good enough to answer with"
                              : "Good enough to answer a parent on its own, with nobody asked"
                          }
                          onClick={() =>
                            void run(
                              row.share.answer_ready
                                ? "No longer marked ready."
                                : "Marked ready to answer with.",
                              async () =>
                                adminAction({
                                  action: "share.answer_ready",
                                  id: row.share.id,
                                  to: !row.share.answer_ready,
                                }),
                            )
                          }
                        >
                          {row.share.answer_ready
                            ? "Not ready after all"
                            : "Ready to answer with"}
                        </Button>
                      )}
                      {row.status !== "rejected" && (
                        <Button
                          tone="danger"
                          disabled={busy}
                          title="Set it aside. Nothing is sent to the parent."
                          onClick={() =>
                            void run("Set aside.", async () =>
                              adminAction({
                                action: "contribution.reject",
                                id: row.id,
                                reason: "not usable",
                              }),
                            )
                          }
                        >
                          Don&apos;t use
                        </Button>
                      )}
                    </>
                  }
                >
                  <FactGrid>
                    <Fact label="Where">
                      {row.share.neighborhoods.length === 0
                        ? null
                        : row.share.neighborhoods.map(slugLabel).join(", ")}
                    </Fact>
                    <Fact label="Who it was for">
                      {row.child_age_at_time.length
                        ? `Age ${row.child_age_at_time.join(", ")} at the time`
                        : null}
                    </Fact>
                    <Fact label="Would recommend">
                      {row.recommendation ? (
                        <Badge
                          tone={RECOMMENDATION[row.recommendation]?.tone ?? "gold"}
                        >
                          {RECOMMENDATION[row.recommendation]?.label ??
                            sentence(row.recommendation)}
                        </Badge>
                      ) : null}
                    </Fact>
                    <Fact
                      label="Paid"
                      hint={row.worth_it ? optionLabel(WORTH_IT, row.worth_it) : undefined}
                    >
                      {row.price_band ? (
                        <>
                          {optionLabel(PRICE_BAND, row.price_band)}
                          {row.price_unit && (
                            <span className="text-muted">
                              {" / "}
                              {optionLabel(PRICE_UNIT, row.price_unit).toLowerCase()}
                            </span>
                          )}
                        </>
                      ) : null}
                    </Fact>
                    <Fact
                      label="How recent"
                      /* Only when there is a date. `when(null)` is an em dash,
                         and an em dash under a filled value reads as a second,
                         missing answer rather than as "no date recorded". */
                      hint={
                        row.share.last_confirmed_at
                          ? `Last confirmed ${when(row.share.last_confirmed_at)}`
                          : undefined
                      }
                    >
                      <span title={FRESHNESS[row.share.freshness_state]?.meaning}>
                        {FRESHNESS[row.share.freshness_state]?.label ??
                          sentence(row.share.freshness_state)}
                      </span>
                    </Fact>
                    {/* R11 — a permission, so it belongs with the recommendation
                        it applies to rather than in the badge row, where it was
                        a fourth pill competing with the review status. */}
                    <Fact
                      label="Follow-up"
                      hint={
                        row.follow_up_ok
                          ? "Costs one of their monthly questions"
                          : undefined
                      }
                    >
                      {row.follow_up_ok
                        ? "Happy to be asked more about this one"
                        : "Not offered"}
                    </Fact>
                    <Fact label="Counts toward Founding">
                      {/* Answers the label, rather than restating the rule. */}
                      {!row.firsthand ? (
                        <span className="text-muted">
                          No — heard from a friend{" "}<Hint>{"Only a family's own experience counts toward Founding. This one is still welcome."}</Hint></span>
                      ) : missing.length === 0 ? (
                        <Badge tone="green">Yes</Badge>
                      ) : (
                        <span className="text-gold-ink">
                          Not yet — they didn&apos;t say {missing.join(", ")}{" "}<Hint>{"They skipped these questions. It counts as soon as they are answered."}</Hint></span>
                      )}
                    </Fact>
                    <Fact label="How useful their words are">
                      <ConfidenceBadge
                        value={row.confidence}
                        note={row.confidence_note}
                      />
                    </Fact>
                    {row.share.venue && <Fact label="Venue">{row.share.venue}</Fact>}
                  </FactGrid>

                  {(row.what_makes_it_great ||
                    row.tip_text ||
                    row.caveat ||
                    row.caveat_answered ||
                    row.who_for ||
                    row.who_not_for ||
                    (row.status === "needs_detail" && row.needs_detail_note)) && (
                    <RecordNotes>
                      {row.what_makes_it_great && (
                        <Quote label="What they liked">
                          {row.what_makes_it_great}
                        </Quote>
                      )}
                      {row.tip_text && <Quote label="Their tip">{row.tip_text}</Quote>}
                      {row.caveat ? (
                        <Quote label="Know first">{row.caveat}</Quote>
                      ) : row.caveat_answered ? (
                        <p className="text-[12.5px] text-muted">
                          Asked what to know first — nothing came to mind.
                        </p>
                      ) : null}
                      {(row.who_for || row.who_not_for) && (
                        <p className="text-[13px] leading-relaxed text-ink-soft">
                          {row.who_for && (
                            <>
                              <span className="font-semibold">Perfect for</span>{" "}
                              {row.who_for}.{" "}
                            </>
                          )}
                          {row.who_not_for && (
                            <>
                              <span className="font-semibold">Might not suit</span>{" "}
                              {row.who_not_for}.
                            </>
                          )}
                        </p>
                      )}
                      {row.status === "needs_detail" && row.needs_detail_note && (
                        <p className="rounded-lg border border-gold-line bg-gold-wash px-3 py-2 text-[12.5px] leading-relaxed text-gold-ink">
                          You asked: “{row.needs_detail_note}” — nothing has been
                          sent to the parent.
                        </p>
                      )}
                    </RecordNotes>
                  )}

                  {open && (
                    <>
                      <RecordDrawer title="Tidy up what they wrote">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="What makes it good">
                            <textarea
                              className={inputClass}
                              rows={2}
                              value={draft.what_makes_it_great ?? ""}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  what_makes_it_great: e.target.value,
                                })
                              }
                            />
                          </Field>
                          <Field label="Know first (caveat)">
                            <textarea
                              className={inputClass}
                              rows={2}
                              value={draft.caveat ?? ""}
                              onChange={(e) =>
                                setDraft({ ...draft, caveat: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Perfect for">
                            <input
                              className={inputClass}
                              value={draft.who_for ?? ""}
                              onChange={(e) =>
                                setDraft({ ...draft, who_for: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Might not suit">
                            <input
                              className={inputClass}
                              value={draft.who_not_for ?? ""}
                              onChange={(e) =>
                                setDraft({ ...draft, who_not_for: e.target.value })
                              }
                            />
                          </Field>
                        </div>
                        <div className="mt-3">
                          <Button
                            tone="primary"
                            disabled={busy}
                            onClick={() =>
                              void run("Saved", async () =>
                                adminAction({
                                  action: "contribution.edit",
                                  id: row.id,
                                  patch: {
                                    what_makes_it_great:
                                      draft.what_makes_it_great ?? null,
                                    caveat: draft.caveat ?? null,
                                    who_for: draft.who_for ?? null,
                                    who_not_for: draft.who_not_for ?? null,
                                  },
                                }),
                              )
                            }
                          >
                            Save changes
                          </Button>
                        </div>
                      </RecordDrawer>

                      {/* "Needs more detail" is a held state, not a rejection
                          — the client's words. It is *not* a message the parent
                          receives: there's no SMS reply pipeline yet, so this
                          note is for whoever reviews the queue next. */}
                      <RecordDrawer title="Hold it for one missing detail">
                        <Field
                          label="What's missing?"
                          hint="Stays in your queue. Nothing is sent to the parent."
                        >
                          <input
                            className={inputClass}
                            placeholder="Quick one — could you add roughly what age your child was?"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                          />
                        </Field>
                        <div className="mt-3">
                          <Button
                            tone="secondary"
                            disabled={busy || question.trim().length === 0}
                            onClick={() =>
                              void run("Held — noted", async () =>
                                adminAction({
                                  action: "contribution.needs_detail",
                                  id: row.id,
                                  question: question.trim(),
                                }),
                              )
                            }
                          >
                            Hold for this detail
                          </Button>
                        </div>
                      </RecordDrawer>
                    </>
                  )}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
        <RevealMore n={hidden} onClick={revealAll} />
      </Card>
    </>
  );
}

/**
 * What this contribution would still need to count towards Founding, in the
 * words a parent was actually asked.
 *
 * These read out on screen as "missing a strength, fit, caveat asked" — which
 * were the *column* names and not questions anybody recognises. Each one now
 * names the question the parent skipped, so an admin can tell at a glance
 * whether it is worth asking for.
 */
function missingForFounding(row: ContributionRow): string[] {
  const missing: string[] = [];
  if (row.child_age_at_time.length === 0) missing.push("how old their child was");
  if (!row.last_there) missing.push("when they were last there");
  if (!row.what_makes_it_great) missing.push("what they liked about it");
  if (!row.who_for && !row.who_not_for) missing.push("who it suits");
  if (!row.caveat_answered) missing.push("whether there's a catch");
  return missing;
}
