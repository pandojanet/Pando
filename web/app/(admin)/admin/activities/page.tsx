"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  Empty,
  ErrorNote,
  Field,
  NotConfigured,
  PageHead,
  ProvenanceBadge,
  SampleBanner,
  TableWrap,
  Td,
  Th,
  inputClass,
  slugLabel,
  useEdgeFade,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { ContributionRow } from "@/lib/admin/types";

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
 *    friendly follow-up question, so it is its own action with the question attached.
 *  - **low confidence first.** That queue is what improves the extraction prompt.
 */
export default function ContributionsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<ContributionRow[]>("contributions");

  const [filter, setFilter] = useState<
    "pending" | "low" | "secondhand" | "incomplete" | "golden" | "all"
  >("pending");
  const { ref: filterRef, maskStyle: filterMask } = useEdgeFade<HTMLDivElement>();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ContributionRow>>({});
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const all = rows ?? [];
  const visible = useMemo(() => {
    const list = all.filter((r) => !r.is_test);
    if (filter === "low")
      return list.filter((r) => r.confidence !== null && r.confidence < 0.6);
    if (filter === "secondhand") return list.filter((r) => !r.firsthand);
    if (filter === "incomplete")
      return list.filter((r) => missingForFounding(r).length > 0 && r.firsthand);
    if (filter === "pending") return list.filter((r) => r.status === "pending_review");
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
  }, [all, filter]);

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted
          ? `${label} — done.`
          : `${label} — not stored (no database connected).`,
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
        intro="Approve what's usable, ask for the one missing detail, and keep secondhand clearly labelled."
        right={
          <div
            ref={filterRef}
            style={filterMask}
            className="flex gap-1 overflow-x-auto no-scrollbar md:flex-wrap md:overflow-visible"
          >
            {(
              ["pending", "low", "incomplete", "secondhand", "golden", "all"] as const
            ).map(
              (key) => (
                <Button
                  key={key}
                  className="shrink-0"
                  tone={filter === key ? "primary" : "secondary"}
                  onClick={() => setFilter(key)}
                >
                  {key === "pending"
                    ? "To review"
                    : key === "low"
                      ? "Low confidence"
                      : key === "incomplete"
                        ? "One detail short"
                        : key === "secondhand"
                          ? "Secondhand"
                          : key === "golden"
                            ? "Answer-ready"
                            : "All"}
                </Button>
              ),
            )}
          </div>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && (
        <div className="mb-4 rounded-xl border border-green/25 bg-green-wash px-4 py-2.5 text-[13.5px] font-medium text-green-deep">
          {message}
        </div>
      )}

      <Card>
        {loading && all.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">
            Loading…
          </div>
        ) : !configured && all.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : visible.length === 0 ? (
          <Empty
            title="Nothing in this view"
            body="Switch the filter, or wait for new submissions."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>What</Th>
                <Th>Where</Th>
                <Th>Whose</Th>
                <Th>Recommends</Th>
                <Th>Paid</Th>
                <Th>Fresh</Th>
                <Th>Founding</Th>
                <Th>Conf.</Th>
                <Th>From</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const open = editing === row.id;
                const missing = missingForFounding(row);
                return (
                  <Fragment key={row.id}>
                    <tr className={row.firsthand ? undefined : "bg-gold-wash/30"}>
                      <Td>
                        <span className="font-semibold">{row.share.name}</span>
                        <span className="ml-1.5 text-[12px] uppercase tracking-[0.06em] text-muted">
                          {row.kind}
                        </span>
                        {row.share.answer_ready && (
                          <span className="ml-1.5">
                            <Badge
                              tone="green"
                              title="Marked good enough to answer a question with, without asking the network"
                            >
                              answer-ready
                            </Badge>
                          </span>
                        )}
                        {row.share.venue && (
                          <span className="mt-0.5 block text-[12.5px] text-muted">
                            {row.share.venue}
                          </span>
                        )}
                        {row.tip_text && (
                          <span className="mt-1 block text-[12.5px] italic text-muted">
                            “{row.tip_text}”
                          </span>
                        )}
                        {row.caveat ? (
                          <span className="mt-1 block text-[12.5px] italic text-muted">
                            Know first: “{row.caveat}”
                          </span>
                        ) : row.caveat_answered ? (
                          <span className="mt-1 block text-[12.5px] text-muted">
                            Caveat: nothing came to mind
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        {row.share.neighborhoods.length === 0
                          ? "—"
                          : row.share.neighborhoods.map(slugLabel).join(", ")}
                      </Td>
                      <Td>
                        {/* R2 — the label reads the source, never who typed it. */}
                        {row.firsthand ? (
                          <Badge tone="green">firsthand</Badge>
                        ) : (
                          <Badge
                            tone="gold"
                            title="Welcome, labelled, and never counted toward Founding"
                          >
                            secondhand
                          </Badge>
                        )}
                        <span className="mt-0.5 block text-[12.5px] text-muted">
                          {row.child_age_at_time.length
                            ? `age ${row.child_age_at_time.join(", ")}`
                            : "no age given"}
                        </span>
                      </Td>
                      <Td>
                        {row.recommendation ? (
                          <Badge
                            tone={
                              row.recommendation.startsWith("yes")
                                ? "green"
                                : row.recommendation === "no"
                                  ? "red"
                                  : "gold"
                            }
                          >
                            {slugLabel(row.recommendation)}
                          </Badge>
                        ) : (
                          "—"
                        )}
                        {row.follow_up_ok && (
                          <span
                            className="mt-1 block text-[12px] text-muted"
                            title="Costs one of their monthly questions"
                          >
                            follow-ups ok
                          </span>
                        )}
                      </Td>
                      <Td className="text-[13px]">
                        {row.price_band ? (
                          <>
                            {slugLabel(row.price_band)}
                            {row.price_unit && (
                              <span className="text-muted">
                                {" "}
                                / {slugLabel(row.price_unit).toLowerCase()}
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                        {row.worth_it && (
                          <span className="mt-0.5 block text-muted">
                            {slugLabel(row.worth_it)}
                          </span>
                        )}
                      </Td>
                      <Td className="text-[13px]">
                        {slugLabel(row.share.freshness_state)}
                        <span className="mt-0.5 block text-muted">
                          {when(row.share.last_confirmed_at)}
                        </span>
                      </Td>
                      <Td className="text-[12.5px]">
                        {!row.firsthand ? (
                          <span className="text-muted">never qualifies</span>
                        ) : missing.length === 0 ? (
                          <Badge tone="green">qualifies</Badge>
                        ) : (
                          <span
                            className="text-gold-ink"
                            title="What this contribution would need to count"
                          >
                            needs {missing.join(", ")}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <ConfidenceBadge
                          value={row.confidence}
                          note={row.confidence_note}
                        />
                      </Td>
                      <Td className="text-[13px]">
                        {row.contributor?.name ?? "—"}
                        <span className="mt-1 block">
                          <ProvenanceBadge provenance={row.provenance} />
                        </span>
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1.5">
                          {row.status === "pending_review" && (
                            <Button
                              tone="primary"
                              disabled={busy}
                              onClick={() =>
                                void run("Approved", async () =>
                                  adminAction({
                                    action: "contribution.approve",
                                    id: row.id,
                                  }),
                                )
                              }
                            >
                              Approve
                            </Button>
                          )}
                          <Button
                            tone="secondary"
                            disabled={busy}
                            onClick={() => {
                              setEditing(open ? null : row.id);
                              setDraft(open ? {} : { ...row });
                            }}
                          >
                            {open ? "Cancel" : "Edit / ask"}
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
                                  ? "Take it back out of the answer-ready set"
                                  : "This record could answer a real question as it stands"
                              }
                              onClick={() =>
                                void run(
                                  row.share.answer_ready
                                    ? "Unmarked"
                                    : "Marked answer-ready",
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
                                ? "Not ready"
                                : "Answer-ready"}
                            </Button>
                          )}
                          {row.status !== "rejected" && (
                            <Button
                              tone="danger"
                              disabled={busy}
                              onClick={() =>
                                void run("Rejected", async () =>
                                  adminAction({
                                    action: "contribution.reject",
                                    id: row.id,
                                    reason: "not usable",
                                  }),
                                )
                              }
                            >
                              Reject
                            </Button>
                          )}
                        </div>
                      </Td>
                    </tr>

                    {open && (
                      <tr>
                        <Td className="bg-paper/70" colSpan={10}>
                          <div className="grid gap-3 py-1 sm:grid-cols-2">
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
                          <p className="mb-3 text-[12px] leading-relaxed text-muted">
                            Editing tidies the parent&apos;s wording. It never changes
                            who said it, whether it was firsthand, the trust label, or
                            the freshness date — those are provenance.
                          </p>
                          <div className="flex flex-wrap items-end gap-2">
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

                          {/* "Needs more detail" is a friendly question, never a
                              rejection — the client's words. */}
                          <div className="mt-4 rounded-xl border border-bark bg-card p-3">
                            <Field label="Ask them for one more detail">
                              <input
                                className={inputClass}
                                placeholder="Quick one — could you add roughly what age your child was?"
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                              />
                            </Field>
                            <Button
                              tone="secondary"
                              disabled={busy || question.trim().length === 0}
                              onClick={() =>
                                void run("Question queued", async () =>
                                  adminAction({
                                    action: "contribution.needs_detail",
                                    id: row.id,
                                    question: question.trim(),
                                  }),
                                )
                              }
                            >
                              Send as a follow-up
                            </Button>
                            <p className="mt-2 text-[12px] leading-relaxed text-muted">
                              Goes out as a question, not a rejection, and the card
                              stays in the queue until they answer.
                            </p>
                          </div>
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

/**
 * What this contribution still needs to count toward Founding, in the client's terms.
 * Shown per row so "why is she stuck at one?" has an answer on the screen.
 */
function missingForFounding(row: ContributionRow): string[] {
  const missing: string[] = [];
  if (row.child_age_at_time.length === 0) missing.push("child age");
  if (!row.last_there) missing.push("recency");
  if (!row.what_makes_it_great) missing.push("a strength");
  if (!row.who_for && !row.who_not_for) missing.push("fit");
  if (!row.caveat_answered) missing.push("caveat asked");
  return missing;
}
