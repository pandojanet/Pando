"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  NotConfigured,
  PageHead,
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
export default function DemandPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<DemandRow[]>("demand");

  const [filter, setFilter] = useState<"urgent" | "open" | "all">("urgent");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { ref: filterRef, maskStyle: filterMask } = useEdgeFade<HTMLDivElement>();

  const all = rows ?? [];
  const visible = useMemo(() => {
    const list = all.filter((r) => !r.is_test);
    if (filter === "urgent")
      return list.filter((r) => r.requires_human_review && r.status === "open");
    if (filter === "open") return list.filter((r) => r.status === "open");
    return list;
  }, [all, filter]);

  const counts = useMemo(() => {
    const open = all.filter((r) => !r.is_test && r.status === "open");
    return {
      allegation: open.filter((r) => r.sensitivity === "named_allegation").length,
      high: open.filter((r) => r.sensitivity === "high_stakes").length,
      peer: open.filter((r) => r.sensitivity === "peer_support").length,
      ordinary: open.filter((r) => r.sensitivity === "ordinary").length,
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

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="What parents asked for"
        intro="What parents asked, in their own words. Health, legal and safety ones need a person today."
        right={
          <div
            ref={filterRef}
            style={filterMask}
            className="flex gap-1 overflow-x-auto no-scrollbar md:flex-wrap md:overflow-visible"
          >
            {(["urgent", "open", "all"] as const).map((key) => (
              <Button
                key={key}
                className="shrink-0"
                tone={filter === key ? "primary" : "secondary"}
                onClick={() => setFilter(key)}
              >
                {key === "urgent"
                  ? `Needs a person${counts.high + counts.peer > 0 ? ` · ${counts.high + counts.peer}` : ""}`
                  : key === "open"
                    ? "All open"
                    : "Everything"}
              </Button>
            ))}
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

      {/**
       * Above the high-stakes banner on purpose: this is the only class where Pando
       * does nothing at all until a person has read it.
       */}
      {counts.allegation > 0 && (
        <div className="mb-4 rounded-2xl border border-alert-line bg-alert-wash p-4">
          <p className="text-[14.5px] font-semibold text-alert">
            {counts.allegation === 1
              ? "One parent made a claim about a named person."
              : `${counts.allegation} parents made claims about named people.`}
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-alert/90">
            Read it, and nothing else. These are never circulated, never quoted in an
            answer, and never written into the knowledge base — and Pando told the
            parent it cannot look into it.
          </p>
        </div>
      )}

      {counts.high > 0 && (
        <div className="mb-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
          <p className="text-[14.5px] font-semibold text-gold-ink">
            {counts.high === 1
              ? "One parent asked about health, legal or safety."
              : `${counts.high} parents asked about health, legal or safety.`}
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-gold-ink/90">
            They were shown professional resources in the flow. This queue exists so
            somebody follows up properly — Pando does not answer these.
          </p>
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
            body={
              filter === "urgent"
                ? "Nothing is waiting on a person. That is the state you want."
                : "Switch the filter, or wait for new sessions."
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>What they asked</Th>
                <Th>About</Th>
                <Th>Where from</Th>
                {/* "Routing" named the mechanism. What an admin needs from this
                    column is what kind of question it is and therefore what
                    Pando already said back to the parent. */}
                <Th title="What kind of question this is — which decides what Pando said back to them, and what you may do with it.">
                  Kind of question
                </Th>
                <Th title="Yours to track. Nothing here is sent to the parent — there is no channel until Phase 2.">
                  Where you got to
                </Th>
                <Th>From</Th>
                <Th>When</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className={
                    row.sensitivity === "named_allegation"
                      ? "bg-alert-wash/60"
                      : row.sensitivity === "high_stakes"
                        ? "bg-gold-wash/40"
                        : undefined
                  }
                >
                  <Td className="max-w-[26rem]">
                    <span className="block text-[14px] leading-snug">
                      {row.question_text}
                    </span>
                  </Td>
                  <Td>
                    {row.category
                      ? (DEMAND_CATEGORY[row.category] ?? sentence(row.category))
                      : "—"}
                  </Td>
                  <Td className="text-[13px]">
                    {row.neighborhood ? (
                      slugLabel(row.neighborhood)
                    ) : (
                      <span className="text-muted" title="Anonymous session — no profile to read it from">
                        not known
                      </span>
                    )}
                  </Td>
                  <Td>
                    {(() => {
                      const kind = DEMAND_SENSITIVITY[row.sensitivity];
                      return (
                        <>
                          <Badge
                            tone={kind?.tone ?? "neutral"}
                            title={
                              kind
                                ? `What they saw: ${kind.said}\nWhat you may do: ${kind.allowed}`
                                : undefined
                            }
                          >
                            {kind?.label ?? sentence(row.sensitivity)}
                          </Badge>
                          {/**
                           * The line under the badge used to read "not usable
                           * until read" for every row `requires_human_review`
                           * was set on — which is every non-ordinary row, and
                           * **nothing ever clears that column**. So a question
                           * you had read, followed up and answered still said it
                           * was unread, forever. The sentence is now tied to the
                           * thing that does change: while it is open it is
                           * waiting, and once you have moved it on it isn't.
                           */}
                          {row.requires_human_review && row.status === "open" && (
                            <span className="mt-1 block text-[12px] text-muted">
                              waiting for you to read it
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </Td>
                  <Td>
                    <Badge tone={DEMAND_STATUS[row.status]?.tone ?? "neutral"}>
                      {DEMAND_STATUS[row.status]?.label ?? sentence(row.status)}
                    </Badge>
                  </Td>
                  <Td className="text-[13px]">{row.contributor?.name ?? "—"}</Td>
                  <Td className="text-[13px] text-muted">{when(row.created_at)}</Td>
                  <Td>
                    <div className="flex flex-col gap-1.5">
                      {row.status === "open" && (
                        <Button
                          tone="primary"
                          disabled={busy}
                          title="Writes a note against this question, with your name on it. Nothing goes to the parent."
                          onClick={() => setNoteFor(row.id)}
                        >
                          {row.sensitivity === "high_stakes" ||
                          row.sensitivity === "named_allegation"
                            ? "I've dealt with this…"
                            : "I know who could answer…"}
                        </Button>
                      )}
                      {row.status !== "closed" && (
                        <Button
                          tone="secondary"
                          disabled={busy}
                          title="Takes it off the list without a note — for a question that needs nothing from you."
                          onClick={() =>
                            void run("Closed", async () =>
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
                    </div>

                    {noteFor === row.id && (
                      <div className="mt-2 rounded-xl border border-bark bg-paper p-2.5">
                        <Field
                          label={
                            row.sensitivity === "high_stakes" ||
                            row.sensitivity === "named_allegation"
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
                        <div className="mt-2 flex gap-2">
                          <Button
                            tone="primary"
                            disabled={busy || note.trim().length < 3}
                            onClick={() =>
                              void run("Recorded", async () =>
                                adminAction({
                                  action: "demand.status",
                                  id: row.id,
                                  to:
                                    row.sensitivity === "high_stakes" ||
                                    row.sensitivity === "named_allegation"
                                      ? "answered"
                                      : "matched",
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
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
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
