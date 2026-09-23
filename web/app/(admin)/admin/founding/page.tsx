"use client";

import { useMemo, useState } from "react";
import {
  ageList,
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  slugLabel,
  TextLink,
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
      <PageHead title="Founding queue" />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {note && <ResultNote>{note}</ResultNote>}

      {loading && pending.length === 0 ? (
        <Card>
          <Loading />
        </Card>
      ) : error && pending.length === 0 ? (
        <Card>
          <Failed />
        </Card>
      ) : !configured && pending.length === 0 ? (
        <Card>
          <NotConfigured demo={demo} onDemo={setDemo} />
        </Card>
      ) : pending.length === 0 ? (
        <Card>
          <Empty
            title="Nobody waiting"
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
                            {/* 23 Sep: the person this decision is about opens
                                their own page, where every card the approval
                                rests on can be read in full. */}
                            <TextLink href={`/admin/contributors/${row.id}`}>
                              {row.name ?? "Unknown name"}
                            </TextLink>
                            {/* "off-list" was jargon; "nobody vouched for them"
                                was worse, because it read as a judgement about
                                the person. What it actually means is that no
                                group was recorded against their arrival. */}
                            {offList && (
                              <Badge
                                tone="gold"
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
                          {/**
                            * ⚠⚠ **The two numbers this row is here for**, and
                            * until 16 Sep the page rendered neither — it showed a
                            * submission count while the type's own doc said
                            * *"the founding queue reads the checklist … so the
                            * admin sees why somebody is or is not eligible"*. The
                            * checklist was sent and unused: a comment describing
                            * behaviour nothing implemented, on the one screen
                            * where somebody decides whether a parent is paid.
                            *
                            * Now that the queue is *filtered* on a full profile
                            * and two admin approvals, a row reaching it is a claim
                            * about those two numbers, and the person confirming it
                            * has to be able to see them. Shared stays beside them
                            * because approved-of-shared is the ratio that says
                            * whether this is somebody prolific or somebody who
                            * wrote two good cards.
                            */}
                          <p className="mt-1 text-[13px] text-muted">
                            {[
                              `Profile ${row.checklist.profile_depth}%`,
                              `${row.checklist.approved_contributions} approved`,
                              `${total} shared`,
                              row.phone ?? "no number",
                            ].join(" · ")}
                          </p>
                          <p className="mt-1 text-[13px]">
                            <TextLink href={`/admin/contributors/${row.id}#contributions`}>
                              {`See the ${row.checklist.approved_contributions} approved ${
                                row.checklist.approved_contributions === 1 ? "contribution" : "contributions"
                              }`}
                            </TextLink>
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            tone="primary"
                            disabled={busy !== null}
                            subject={row.name ?? "this contributor"}
                            onClick={() =>
                              void act("founding.approve", [row.id], "Confirmed as a Founding parent.")
                            }
                          >
                            Confirm
                          </Button>
                          <Button
                            tone="secondary"
                            disabled={busy !== null}
                            subject={row.name ?? "this contributor"}
                            onClick={() =>
                              void act(
                                "founding.request_invite",
                                [row.id],
                                "Marked as not a Founding parent.",
                              )
                            }
                          >
                            {/**
                              * ⚠⚠ **"Not from the group" was the dead question,
                              * printed on the control that takes the decision.**
                              * The group concept went on 7 Sep when entry opened
                              * and everybody began arriving directly, so the
                              * button was asking an admin to rule on something
                              * the product no longer has — and the answer it
                              * writes now withholds a $10 reward.
                              *
                              * ⚠ The stored value stays `request_invite`, and
                              * so does the action: it is an enum with a CHECK
                              * behind it, and the 10 Sep rule is that a rename
                              * there is a migration rather than a copy change.
                              * What changed is only what the person reads.
                              *
                              * ⚠ Still not a rejection, which is why it is not
                              * `danger`: every card they shared stays, and they
                              * become an ordinary user at launch.
                              */}
                            Not Founding
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
