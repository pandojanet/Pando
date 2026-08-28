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
  ResultNote,
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
        intro="Confirm each one really is from the group. Nothing happens automatically, and a yes is never taken back."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {note && <ResultNote>{note}</ResultNote>}

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
            body="New arrivals appear here as they finish a profile."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {/* `link` is the invite code they clicked. `Card` upper-cases its
              title, so a raw code was shouting `MOPS-ALTADENA`; slugged, it
              reads as the group an admin knows it by. */}
          {byLink.map(([link, group]) => (
            <Card
              key={link}
              title={`Arrived on the ${slugLabel(link)} link`}
              right={
                group.length > 1 ? (
                  <Button
                    tone="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        "founding.approve",
                        group.map((r) => r.id),
                        `Confirmed all ${group.length} from this link.`,
                      )
                    }
                  >
                    Confirm all {group.length}
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
                            {/* "off-list" was jargon; "nobody vouched for them"
                                was worse, because it read as a judgement about
                                the person. What it actually means is that no
                                group was recorded against their arrival. */}
                            {offList && (
                              <Badge
                                tone="gold"
                                title="No group was recorded when they arrived — they came on a link that is not tied to one, or on no link at all. Not a mark against them; it just means there is nothing to check them against."
                              >
                                no group recorded
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
                          {/**
                           * There used to be an "Invited by: …" line here, and it
                           * went for two reasons.
                           *
                           * It was **mislabelled**: the value is
                           * `people.invited_via_group`, which names a parent
                           * group and never a person. The "who invited you?"
                           * question was removed on 12 Aug when one invite per
                           * group started carrying the attribution instead — so
                           * the label promised a fact the app no longer collects,
                           * and its empty state ("not answered") blamed a parent
                           * for skipping a question that no longer exists.
                           *
                           * And once corrected it was **redundant**: these cards
                           * are already grouped by the link somebody arrived on,
                           * so every row repeated its own heading. The only thing
                           * the heading cannot say is when no group was recorded
                           * at all, and that is the badge beside the name.
                           */}
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
                              void act("founding.approve", [row.id], "Confirmed as a Founding parent.")
                            }
                          >
                            Confirm
                          </Button>
                          <Button
                            tone="secondary"
                            disabled={busy !== null}
                            title="Not a rejection — they keep everything they shared and become an ordinary user at launch."
                            onClick={() =>
                              void act(
                                "founding.request_invite",
                                [row.id],
                                "Marked as not from the group.",
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

          {/* This footnote explained that "not from the group" is not a
              rejection, and then raised an open question *for the client* about
              when cards enter the graph — which is a thing to settle in a call,
              not a paragraph under Janet's queue. The first half is now the
              button's own tooltip, where it is read at the moment it matters. */}
        </div>
      )}
    </>
  );
}
