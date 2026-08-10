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
import type { ContributorDetail, ContributorRow } from "@/lib/admin/types";

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

  /**
   * The picker's options. Linking a referral is an admin judgement — with one
   * shared invite link there is no code in the URL to read it from — so the list
   * of candidates is simply everyone else.
   *
   * Fetched on the click that opens the picker, and not before. Gating it on the
   * loaded contributor instead (`c != null && …`) looked like the careful version
   * and was worse: `c` is null until the first request lands, so the condition
   * turned one request into two *sequential* ones — ~250ms of waterfall added to
   * every contributor page, for a control that is only used once per parent.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const { rows: everyone, loading: everyoneLoading } = useAdminRows<
    ContributorRow[]
  >("contributors", undefined, pickerOpen);
  const [referrer, setReferrer] = useState("");
  const [refBusy, setRefBusy] = useState(false);
  const [refMessage, setRefMessage] = useState<string | null>(null);

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

  async function runReferral(action: "link" | "void", target: string) {
    setRefBusy(true);
    setRefMessage(null);
    try {
      const result = await adminAction(
        action === "link"
          ? { action: "referral.link", referrer: target, referred: id }
          : { action: "referral.void", id: target },
      );
      setReferrer("");
      setRefMessage(
        result.persisted
          ? action === "link"
            ? "Referral recorded."
            : "Referral withdrawn."
          : "Not stored — no database connected.",
      );
      await reload();
    } catch (err) {
      setRefMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setRefBusy(false);
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

            {/*
              D2. Who brought this parent in, recorded by hand: the invite link is
              one shared URL, so nothing in it says who passed it on. This is the
              same judgement the founding queue already asks for ("is this really
              Sarah from our group?"), written down where a credit can later read it.
            */}
            <Card title="Referrals">
              <div className="border-b border-bark/70 px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                  Invited by
                </p>
                {c.referral.referred_by ? (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Link
                      href={`/admin/contributors/${c.referral.referred_by.id}`}
                      className="font-semibold text-green-deep underline underline-offset-2"
                    >
                      {c.referral.referred_by.name ?? "Unknown"}
                    </Link>
                  </div>
                ) : !pickerOpen ? (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[13.5px] text-muted">Nobody recorded</span>
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="text-[12.5px] font-semibold text-green-deep underline underline-offset-2"
                    >
                      Record who invited them
                    </button>
                  </div>
                ) : (
                  <>
                    <select
                      aria-label="Invited by"
                      value={referrer}
                      onChange={(e) => setReferrer(e.target.value)}
                      disabled={everyoneLoading}
                      className={`${inputClass} mt-1.5`}
                    >
                      <option value="">
                        {everyoneLoading ? "Loading contributors…" : "Pick a parent"}
                      </option>
                      {(everyone ?? [])
                        .filter((p) => p.id !== id && !p.is_test)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name ?? "Unknown"}
                            {p.neighborhood ? ` · ${slugLabel(p.neighborhood)}` : ""}
                          </option>
                        ))}
                    </select>
                    <Button
                      tone="primary"
                      className="mt-2 w-full"
                      disabled={refBusy || referrer === ""}
                      onClick={() => void runReferral("link", referrer)}
                    >
                      {refBusy ? "Saving…" : "Record referral"}
                    </Button>
                  </>
                )}
              </div>

              <div className="px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                  Brought in ({c.referral.referred.filter((r) => r.status !== "void").length})
                </p>
                {c.referral.referred.length === 0 ? (
                  <p className="mt-1 text-[13px] text-muted">Nobody yet.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {c.referral.referred.map((r) => (
                      <li key={r.referral_id} className="flex items-center justify-between gap-2">
                        <Link
                          href={`/admin/contributors/${r.id}`}
                          className={
                            r.status === "void"
                              ? "text-[13.5px] text-muted line-through"
                              : "text-[13.5px] font-semibold text-green-deep underline underline-offset-2"
                          }
                        >
                          {r.name ?? "Unknown"}
                        </Link>
                        {r.status !== "void" && (
                          <button
                            type="button"
                            disabled={refBusy}
                            onClick={() => void runReferral("void", r.referral_id)}
                            className="text-[12px] text-muted underline underline-offset-2"
                          >
                            wrong
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {/*
                  Credits are earned in Network Asks, and those do not exist until
                  Phase 2 — so this records who to credit, and nothing is credited.
                */}
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Recorded for crediting later. Network Asks don&apos;t exist yet, so
                  nothing is granted here.
                </p>
                {refMessage && (
                  <p className="mt-2 text-[12.5px] text-muted">{refMessage}</p>
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
