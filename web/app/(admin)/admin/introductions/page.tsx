"use client";

import { useId, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Failed,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  slugLabel,
  Toolbar,
  when,
} from "@/components/admin/ui";
import { SegmentedFilter } from "@/components/admin/kit";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { useUrlFilter } from "@/lib/admin/url-state";
import type { IntroductionRow, IntroductionsResult } from "@/lib/admin/types";
import { INTRO_STATUS, LAST_THERE } from "@/lib/admin/labels";

/**
 * Introductions (21 Oct) — parent to parent, through a person at Pando.
 *
 * A parent asked, after a recommendation, to talk to a parent who has been
 * there. The admin's moves, each recorded and audited:
 *
 *   Asked → **Approve** → **Contacted** (which parent you reached out to) →
 *   **Connected** (they agreed; the chat is set up outside Pando) or **Said no**.
 *   **Don't take forward** at the first two steps, with a reason.
 *
 * Pando texts nobody from here. The other parent is asked by a person, outside
 * the app, and only their yes leads to a chat. A parent who texted STOP, or
 * who has not agreed to be asked, is never listed (audit, 22 Oct).
 */

const VIEWS = ["open", "connected", "closed", "offers"] as const;

/** Which view a row belongs to — the one expression the counts and the list both read. */
function viewOf(r: IntroductionRow): (typeof VIEWS)[number] {
  if (r.status === "offered") return "offers";
  if (r.status === "connected") return "connected";
  if (r.status === "declined" || r.status === "rejected") return "closed";
  return "open";
}

export default function IntroductionsPage() {
  const [view, setView] = useUrlFilter(VIEWS, "open", "view");
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteId = useId();

  const { rows, configured, loading, error, demo, setDemo, reload } =
    useAdminRows<IntroductionsResult>("introductions");

  const all = useMemo(() => {
    const list = rows?.rows ?? [];
    return hideTest ? list.filter((r) => !r.is_test) : list;
  }, [rows, hideTest]);
  const testCount = (rows?.rows ?? []).filter((r) => r.is_test).length;

  const counts = useMemo(() => {
    const c = { open: 0, connected: 0, closed: 0, offers: 0 };
    for (const r of all) c[viewOf(r)]++;
    return c;
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (viewOf(r) !== view) return false;
      if (!q) return true;
      return [r.requester.name, r.record.name, r.question, r.other_parent?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, view, search]);

  const { shown, hidden, revealAll } = useReveal(filtered);

  async function move(row: IntroductionRow, label: string, action: Parameters<typeof adminAction>[0]) {
    setBusy(row.id);
    setMessage(null);
    try {
      const result = await adminAction(action);
      setMessage(result.persisted ? label : `${label} — but nothing was saved.`);
      setNotes((n) => ({ ...n, [row.id]: "" }));
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  const offered = counts.offers + all.filter((r) => r.status !== "offered" && r.trigger === "proactive").length;
  const tookOffer = all.filter((r) => r.status !== "offered" && r.trigger === "proactive").length;

  return (
    <>
      <PageHead
        title="Introductions"
        intro="Parents who asked, after a recommendation, to talk to a parent who has been there. Approve, contact the other parent outside Pando, and record how it went. Nothing here texts anybody."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {message && <ResultNote>{message}</ResultNote>}

      <Toolbar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Parent, place, question…"
          aria-label="Search by parent, place or question"
          className={`${inputClass} w-[13rem]`}
        />
        {testCount > 0 && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} />
            Hide test ({testCount})
          </label>
        )}
        {offered > 0 && (
          <span className="text-[13px] text-muted">
            {tookOffer} of {offered} offers taken
          </span>
        )}
      </Toolbar>

      <div className="mb-4">
        <SegmentedFilter
          unknown={!rows}
          label="Which requests"
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { id: "open" as const, label: "To move", count: counts.open },
            { id: "connected" as const, label: "Connected", count: counts.connected },
            { id: "closed" as const, label: "Closed", count: counts.closed },
            { id: "offers" as const, label: "Offers not taken", count: counts.offers },
          ]}
        />
      </div>

      <div className="space-y-4">
        {loading && !rows ? (
          <Card>
            <Loading />
          </Card>
        ) : error && !rows ? (
          <Card>
            <Failed />
          </Card>
        ) : !configured || rows?.configured === false ? (
          <Card>
            <NotConfigured demo={demo} onDemo={setDemo} noSample />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <Empty
              title={all.length === 0 ? "No introductions yet" : "Nothing in this view"}
              body="A request appears here when a parent replies INTRO to an answer, or asks to be introduced to a parent who has been somewhere."
            />
          </Card>
        ) : (
          <>
            {shown.map((r) => {
              const note = notes[r.id] ?? "";
              const choice = picked[r.id] ?? r.candidates[0]?.person_id ?? "";
              const working = busy === r.id;
              return (
                <Card
                  key={r.id}
                  title={
                    <span>
                      {r.requester.name ?? "A parent"} wants to talk to a parent about{" "}
                      <strong>{r.record.name ?? "a place"}</strong>
                    </span>
                  }
                  right={
                    <span className="flex items-center gap-1.5">
                      <Badge tone={INTRO_STATUS[r.status]?.tone ?? "neutral"}>{INTRO_STATUS[r.status]?.label ?? r.status}</Badge>
                      {r.is_test && <Badge tone="gold">test</Badge>}
                    </span>
                  }
                >
                  <div className="space-y-3 p-4 text-[14px]">
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      <div>
                        <dt className="text-muted">Asked by</dt>
                        <dd>
                          {r.requester.name ?? "no name"} · {r.requester.phone ?? "no number"}
                          {r.requester.neighborhood ? ` · ${slugLabel(r.requester.neighborhood)}` : ""}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">How</dt>
                        <dd>{r.trigger === "proactive" ? "Took the offer in an answer" : "Asked for it"}</dd>
                      </div>
                      {r.question && (
                        <div className="sm:col-span-2">
                          <dt className="text-muted">Their question</dt>
                          <dd>{r.question}</dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-muted">Timeline</dt>
                        <dd className="text-[13px]">
                          {r.requested_at ? `Asked ${when(r.requested_at)}` : `Offered ${when(r.created_at)}`}
                          {r.decided_at ? ` · decided ${when(r.decided_at)}${r.decided_by ? ` by ${r.decided_by}` : ""}` : ""}
                          {r.contacted_at ? ` · contacted ${when(r.contacted_at)}` : ""}
                          {r.closed_at ? ` · closed ${when(r.closed_at)}` : ""}
                        </dd>
                      </div>
                      {r.other_parent && (
                        <div>
                          <dt className="text-muted">Parent contacted</dt>
                          <dd>
                            {r.other_parent.name ?? "no name"} · {r.other_parent.phone ?? "no number"}
                          </dd>
                        </div>
                      )}
                      {r.note && (
                        <div className="sm:col-span-2">
                          <dt className="text-muted">Note</dt>
                          <dd>{r.note}</dd>
                        </div>
                      )}
                    </dl>

                    {(r.status === "requested" || r.status === "approved") && (
                      <div>
                        <p className="mb-1.5 text-muted">Parents who have been there</p>
                        {r.candidates.length === 0 ? (
                          <p className="text-[13.5px]">Nobody left to ask on this record.</p>
                        ) : (
                          <ul className="space-y-1">
                            {r.candidates.map((c) => (
                              <li key={c.person_id} className="flex flex-wrap items-center gap-2">
                                {r.status === "approved" && (
                                  <input
                                    type="radio"
                                    name={`pick-${r.id}`}
                                    aria-label={`Contacted ${c.name ?? "this parent"}`}
                                    checked={choice === c.person_id}
                                    onChange={() => setPicked((p) => ({ ...p, [r.id]: c.person_id }))}
                                  />
                                )}
                                <span>
                                  {c.name ?? "no name"} · {c.phone ?? "no number"}
                                  {c.last_there ? ` · ${LAST_THERE[c.last_there] ?? c.last_there}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {["requested", "approved", "contacted"].includes(r.status) && (
                      <div className="space-y-2">
                        <label htmlFor={`${noteId}-${r.id}`} className="block text-muted">
                          {r.status === "contacted" ? "What they said (optional)" : "Note (needed to not take it forward)"}
                        </label>
                        <input
                          id={`${noteId}-${r.id}`}
                          value={note}
                          onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          maxLength={500}
                          className={inputClass}
                        />
                        <div className="flex flex-wrap gap-2">
                          {r.status === "requested" && (
                            <Button
                              tone="primary"
                              disabled={working}
                              subject={r.record.name ?? undefined}
                              onClick={() => move(r, "Approved", { action: "intro.approve", id: r.id })}
                            >
                              Approve
                            </Button>
                          )}
                          {r.status === "approved" && (
                            <Button
                              tone="primary"
                              disabled={working || !choice}
                              subject={r.record.name ?? undefined}
                              onClick={() =>
                                move(r, "Marked as contacted", {
                                  action: "intro.contacted",
                                  id: r.id,
                                  parent_id: choice,
                                  ...(note.trim() ? { note: note.trim() } : {}),
                                })
                              }
                            >
                              I contacted this parent
                            </Button>
                          )}
                          {r.status === "contacted" && (
                            <>
                              <Button
                                tone="primary"
                                disabled={working}
                                subject={r.record.name ?? undefined}
                                onClick={() =>
                                  move(r, "Connected", {
                                    action: "intro.connected",
                                    id: r.id,
                                    ...(note.trim() ? { note: note.trim() } : {}),
                                  })
                                }
                              >
                                Connected: chat set up
                              </Button>
                              <Button
                                tone="secondary"
                                disabled={working}
                                subject={r.record.name ?? undefined}
                                onClick={() =>
                                  move(r, "Recorded: they said no", {
                                    action: "intro.declined",
                                    id: r.id,
                                    ...(note.trim() ? { note: note.trim() } : {}),
                                  })
                                }
                              >
                                They said no
                              </Button>
                            </>
                          )}
                          {(r.status === "requested" || r.status === "approved") && (
                            <Button
                              tone="danger"
                              disabled={working || !note.trim()}
                              subject={r.record.name ?? undefined}
                              onClick={() =>
                                move(r, "Not taken forward", { action: "intro.reject", id: r.id, reason: note.trim() })
                              }
                            >
                              Don&apos;t take forward
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
            <RevealMore n={hidden} onClick={revealAll} />
          </>
        )}
      </div>
    </>
  );
}
