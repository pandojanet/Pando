"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  ageList,
  slugLabel,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { FoundingRow } from "@/lib/admin/types";

/**
 * Founding approval queue (client's v3.2 addition).
 *
 * This queue is about the **person**, not the quality of their submissions: "is this
 * really Sarah from our group?" So the card leads with how they got the link and what
 * makes them recognisable — neighborhood, school, children's ages — and the whole
 * thing is optimised for deciding in seconds.
 *
 * There is no "reject". Someone who walked the whole flow and gave recommendations
 * isn't rejected; they're simply not founding, and they stay a future user.
 */
export default function FoundingQueuePage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<FoundingRow[]>("founding", { status: "pending_founding" });

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const pending = useMemo(() => rows ?? [], [rows]);

  const byLink = useMemo(() => {
    const groups = new Map<string, FoundingRow[]>();
    for (const row of pending) {
      const key = row.arrived_via ?? "unknown";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()];
  }, [pending]);

  async function act(
    action: "founding.approve" | "founding.request_invite",
    ids: string[],
    label: string,
  ) {
    setBusy(ids.join(","));
    setNote(null);
    try {
      const result = await adminAction({ action, ids } as never);
      setNote(
        result.persisted
          ? label
          : `${label} — but nothing was saved.`,
      );
      await reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead
        title="Founding queue"
        intro="Everyone who finished their profile waits here until you confirm they really are from the group. Nobody becomes a Founding parent automatically, and once you've said yes it never gets taken away."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {note && (
        <div className="mb-4 rounded-xl border border-green/25 bg-green-wash px-4 py-2.5 text-[13.5px] font-medium text-green-deep">
          {note}
        </div>
      )}

      {loading && pending.length === 0 ? (
        <Card>
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        </Card>
      ) : !configured && pending.length === 0 ? (
        <Card>
          <NotConfigured demo={demo} onDemo={setDemo} />
        </Card>
      ) : pending.length === 0 ? (
        <Card>
          <Empty
            title="Nobody waiting"
            body="Everyone who finished has been reviewed. New arrivals show up here as soon as they complete the flow."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {byLink.map(([link, group]) => (
            <Card
              key={link}
              title={`Arrived via ${link}`}
              right={
                group.length > 1 ? (
                  <Button
                    tone="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        "founding.approve",
                        group.map((r) => r.id),
                        `Approved all ${group.length} from this link`,
                      )
                    }
                  >
                    Approve all {group.length}
                  </Button>
                ) : null
              }
            >
              <ul className="divide-y divide-bark/50">
                {group.map((row) => {
                  const offList = !row.invited_by;
                  const total =
                    row.submissions.activities +
                    row.submissions.caregivers +
                    row.submissions.places +
                    row.submissions.tips;
                  return (
                    <li key={row.id} className="px-4 py-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-[15.5px] font-semibold">
                            {row.name ?? "Unknown name"}
                            {offList && (
                              <Badge tone="gold" title="No 'who invited you' answer">
                                off-list
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 text-[13.5px] text-muted">
                            {[
                              row.neighborhood ? slugLabel(row.neighborhood) : null,
                              /* "kids born", not "born": next to a neighborhood and
                                 a school, a bare year reads as the parent's own. */
                              `kids born ${row.child_birth_years.join(", ")}`,
                              /* The stored value is an option id, so it needs the
                                 same treatment as the neighborhood above — this is
                                 a line Janet reads to recognise a person, and
                                 "the-growing-place" is not how she knows them. */
                              row.school ? slugLabel(row.school) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {/* The field Janet actually decides on. */}
                          <p className="mt-1.5 text-[14px]">
                            <span className="text-muted">Invited by: </span>
                            {row.invited_by ? (
                              <span className="font-medium">{row.invited_by}</span>
                            ) : (
                              <span className="italic text-muted">not answered</span>
                            )}
                          </p>
                          <p className="mt-1 text-[13px] text-muted">
                            Shared {total} {total === 1 ? "card" : "cards"} ·{" "}
                            {row.phone_masked ?? "no number"}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            tone="primary"
                            disabled={busy !== null}
                            onClick={() =>
                              void act("founding.approve", [row.id], "Approved as founding")
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            tone="secondary"
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                "founding.request_invite",
                                [row.id],
                                "Moved to request-an-invite",
                              )
                            }
                          >
                            Not from the group
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}

          <p className="text-[12.5px] leading-relaxed text-muted">
            &quot;Not from the group&quot; is not a rejection: the person keeps their
            submissions and becomes an ordinary user at launch. Whether their cards
            enter the graph before approval is still an open question for the client.
          </p>
        </div>
      )}
    </>
  );
}
