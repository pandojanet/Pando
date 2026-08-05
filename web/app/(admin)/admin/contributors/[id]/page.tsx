"use client";

import Link from "next/link";
import { use, useState } from "react";
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
  inputClass,
  slugLabel,
  yearList,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { ContributorDetail } from "@/lib/admin/types";

/**
 * Estimate 2.3 — one contributor.
 *
 * Three classes of data, deliberately shown as such: what they *tapped* (editable in
 * principle), what the system *derived* from it (read-only — editing it by hand would
 * let someone hand-tune their own matching weight), and provenance (never editable).
 * The transcript is here because data-quality review means reading the original
 * wording, not just the cleaned fields.
 */
export default function ContributorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<ContributorDetail | null>("contributor", { id });

  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const c = rows;

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await adminAction({
        action: "contributor.note",
        id,
        body: note.trim(),
      });
      setNote("");
      setMessage(
        result.persisted ? "Note saved." : "Not stored — admin_write hook isn't connected.",
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHead
        title={c?.name ?? "Contributor"}
        intro={
          <Link
            href="/admin/contributors"
            className="font-semibold text-green-deep underline underline-offset-2"
          >
            ← All contributors
          </Link>
        }
        right={
          c ? (
            <>
              {c.is_test && <Badge tone="gold">test session</Badge>}
              {c.founding_status === "founding" ? (
                <Badge tone="green">Founding</Badge>
              ) : c.founding_status === "request_invite" ? (
                <Badge tone="muted">Not from group</Badge>
              ) : (
                <Badge tone="gold">Founding pending</Badge>
              )}
            </>
          ) : null
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      {loading && !c ? (
        <Card>
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        </Card>
      ) : !configured && !c ? (
        <Card>
          <NotConfigured demo={demo} onDemo={setDemo} />
        </Card>
      ) : !c ? (
        <Card>
          <Empty title="Not found" body="No contributor with that id." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            <Card title="What they tapped">
              <dl className="grid gap-x-6 gap-y-2.5 px-4 py-3 text-[14px] sm:grid-cols-2">
                <Pair label="Phone" value={c.phone_masked ?? "not given"} />
                <Pair
                  label="Neighborhood"
                  value={c.neighborhood ? slugLabel(c.neighborhood) : "—"}
                />
                <Pair label="Children born" value={yearList(c.child_birth_years)} />
                <Pair label="Profile complete" value={`${c.profile_completeness}%`} />
                <Pair label="Invite code" value={c.invite_code ?? "—"} />
                <Pair label="Arrived via" value={c.source ?? "—"} />
                <Pair
                  label="Follow-ups"
                  value={
                    c.follow_up_opt_in === true
                      ? "Opted in"
                      : c.follow_up_opt_in === false
                        ? "Declined"
                        : "Not answered"
                  }
                />
                <Pair label="Joined" value={when(c.created_at)} />
              </dl>
            </Card>

            <Card
              title="Derived matching profile"
              right={
                <span className="text-[12px] text-muted">
                  read-only — rebuilt from the taps
                </span>
              }
            >
              <div className="px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                  Social affinities
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {c.affinities.length === 0 && (
                    <li className="text-[13.5px] text-muted">None derived yet.</li>
                  )}
                  {c.affinities.map((a) => (
                    <li key={`${a.affinity_type}-${a.affinity_value}`}>
                      <Badge tone="neutral" title={a.affinity_type}>
                        {slugLabel(a.affinity_value)}
                        <span className="ml-1.5 text-muted">
                          {a.affinity_type.replace(/_/g, " ")}
                          {a.weight !== null && ` ·${a.weight}`}
                        </span>
                      </Badge>
                    </li>
                  ))}
                </ul>

                <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                  Life relevance
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {c.relevance.length === 0 && (
                    <li className="text-[13.5px] text-muted">None derived yet.</li>
                  )}
                  {c.relevance.map((r) => (
                    <li key={`${r.dimension}-${r.value}`}>
                      <Badge tone="neutral" title={r.dimension}>
                        {slugLabel(r.value)}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[12px] leading-relaxed text-muted">
                  Weights come from config at match time, so a number here is what a
                  query would use today — not something stored on the row.
                </p>
              </div>
            </Card>

            <Card title={`Submitted (${c.cards.length})`}>
              {c.cards.length === 0 ? (
                <Empty title="Nothing shared yet" />
              ) : (
                <ul className="divide-y divide-bark/50">
                  {c.cards.map((card) => (
                    <li
                      key={card.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]"
                    >
                      <span>
                        <Badge tone="muted">{card.kind}</Badge>
                        <span className="ml-2">{card.title}</span>
                      </span>
                      <span className="flex items-center gap-2 text-[13px] text-muted">
                        {card.status.replace(/_/g, " ")}
                        <Link
                          href={
                            card.kind === "caregiver"
                              ? "/admin/caregivers"
                              : "/admin/activities"
                          }
                          className="font-semibold text-green-deep underline underline-offset-2"
                        >
                          Review
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Conversation transcript"
              right={
                <span className="text-[12px] text-muted">
                  original wording, as typed
                </span>
              }
            >
              {c.transcript.length === 0 ? (
                <Empty title="No transcript stored" />
              ) : (
                <ol className="space-y-1.5 px-4 py-3">
                  {c.transcript.map((m, i) => (
                    <li
                      key={i}
                      className={
                        m.role === "parent"
                          ? "ml-8 rounded-lg rounded-br-sm bg-green-wash px-3 py-1.5 text-[13.5px]"
                          : "mr-8 rounded-lg rounded-bl-sm border border-bark px-3 py-1.5 text-[13.5px]"
                      }
                    >
                      {m.text}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Internal notes">
              {c.notes.length > 0 && (
                <ul className="divide-y divide-bark/50">
                  {c.notes.map((n) => (
                    <li key={n.id} className="px-4 py-2.5">
                      <p className="text-[13.5px] leading-snug">{n.body}</p>
                      <p className="mt-1 text-[12px] text-muted">
                        {n.author} · {when(n.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-bark/70 px-4 py-3">
                <Field label="Add a note" hint="Visible to admins only. Recorded with your name.">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 500))}
                    rows={3}
                    className={inputClass}
                  />
                </Field>
                <Button
                  tone="primary"
                  className="mt-2 w-full"
                  disabled={saving || note.trim().length === 0}
                  onClick={() => void addNote()}
                >
                  {saving ? "Saving…" : "Save note"}
                </Button>
                {message && (
                  <p className="mt-2 text-[12.5px] text-muted">{message}</p>
                )}
              </div>
            </Card>

            <Card title="Not editable here">
              <ul className="space-y-1.5 px-4 py-3 text-[13px] leading-relaxed text-muted">
                <li>Phone — it is the identity key; changing it is a merge, not an edit.</li>
                <li>Derived affinities and weights — they are rebuilt from the taps.</li>
                <li>Provenance and timestamps — the trust graph rests on them.</li>
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
