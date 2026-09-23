"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DisclosureChevron,
  Empty,
  ErrorNote,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  slugLabel,
  TextLink,
  when,
  yearList,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import {
  AFFILIATION_KIND,
  CARD_KIND,
  REVIEW_STATUS,
  sentence,
} from "@/lib/admin/labels";
import { profileValueLabel } from "@/lib/questions";
import type {
  ContributionRow,
  ContributorDetail,
  ContributorRow,
} from "@/lib/admin/types";
import { ContributionFacts } from "@/components/admin/ContributionFacts";
import { FOUNDING_MIN_APPROVED } from "@/lib/rewards";

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
   * Every card this parent shared, in full (23 Sep). The developer: from the
   * Founding queue an admin opens this page and must be able to open *each*
   * contribution the approval rests on. The list the page already had carried a
   * name and a status and linked to the whole queue, so checking one card meant
   * finding it among everybody else's. Same read as the queue, narrowed to this
   * person, so both pages show one record the same way.
   */
  const { rows: contributions, loading: contributionsLoading } = useAdminRows<
    ContributionRow[]
  >("contributions", { person_id: id });

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
        result.persisted ? "Note saved." : "Note not saved — nothing was written.",
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
          <TextLink href="/admin/contributors">← All contributors</TextLink>
        }
        right={
          c ? (
            <>
              {c.is_test && <Badge tone="gold">test session</Badge>}
              {c.founding_status === "founding" ? (
                <Badge tone="green">Founding</Badge>
              ) : c.founding_status === "request_invite" ? (
                <Badge tone="muted">Not Founding</Badge>
              ) : (
                <Badge tone="gold">Founding pending</Badge>
              )}
              {/**
                * ⚠⚠ **Whether the $10 is in play, on the page where somebody
                * decides about one parent.** It was computed and sent from
                * 10 Sep and rendered nowhere, while the list one click away
                * showed it — so the more detailed screen said less about the
                * one question that involves money.
                *
                * ⚠ Only where it adds something the Founding badge does not.
                * `approved` is the same fact as the green Founding badge said
                * two lines up, so it is suppressed rather than printed twice;
                * what is worth a second badge is *in review* (every
                * requirement met, waiting on a person) and *not met* — and,
                * rarely, a parent who did everything after the deadline.
                */}
              {c.founding_status !== "founding" &&
                (c.reward_status === "in_review" ? (
                  <Badge tone="gold">Reward in review</Badge>
                ) : c.reward_status === "missed_deadline" ? (
                  <Badge tone="muted">After the deadline</Badge>
                ) : (
                  <Badge tone="muted">Reward requirements not met</Badge>
                ))}
            </>
          ) : null
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      {loading && !c ? (
        <Card>
          <Loading />
        </Card>
      ) : !configured && !c ? (
        <Card>
          <NotConfigured demo={demo} onDemo={setDemo} />
        </Card>
      ) : !c ? (
        <Card>
          <Empty title="Not found" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            <Card title="What they tapped">
              <dl className="grid gap-x-6 gap-y-2.5 px-4 py-3 text-[14px] sm:grid-cols-2">
                <Pair label="Phone" value={c.phone ?? "not given"} />
                <Pair
                  label="Neighborhood"
                  value={c.neighborhood ? slugLabel(c.neighborhood) : "—"}
                />
                <Pair label="Children born" value={yearList(c.child_birth_years)} />
                {/**
                  * ⚠⚠ **Two different numbers, and before 16 Sep only the
                  * one that decides nothing was on screen.** This page showed
                  * *Profile complete 82%* beside a reward the parent had
                  * missed on a profile measured at **79%** — so the badge
                  * could not be explained from the page it sits on.
                  *
                  * Both are kept and both are labelled, because they answer
                  * different questions: completeness is *how much of the flow
                  * they were shown did they finish* (historical, stored since
                  * the first contributor), depth is *how much of the whole
                  * questionnaire is answered*, which is what the Founding
                  * requirements read. Deleting either would make one of the
                  * two unanswerable.
                  */}
                <Pair label="Profile complete" value={`${c.profile_completeness}%`} />
                <Pair
                  label="Profile filled in"
                  value={`${c.profile_depth}% · ${c.approved_contributions} approved`}
                />
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

            {/**
             * One list, not two. This was "Social affinities" and "Life
             * relevance" — the names of the two tables underneath — which asked
             * an admin to know the data model to read her own screen. What she
             * needs is the answer to one question: who is this family like?
             * The weight numbers went with it; they change what Pando does and
             * nothing an admin can act on.
             */}
            <Card
              title="What Pando matches them on"
              right={
                <span className="text-[12px] text-muted">
                  built from their answers
                </span>
              }
            >
              <div className="px-4 py-3">
                {c.affinities.length === 0 && c.relevance.length === 0 ? (
                  <p className="text-[13.5px] text-muted">
                    Nothing yet — they have not answered enough for Pando to find
                    parents like them.
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {c.affinities.map((a) => (
                      <li key={`${a.affinity_type}-${a.affinity_value}`}>
                        <Badge tone="neutral" hint={sentence(a.affinity_type)}>
                          {profileValueLabel(a.affinity_value) ??
                            slugLabel(a.affinity_value)}
                        </Badge>
                      </li>
                    ))}
                    {c.relevance.map((r) => (
                      <li key={`${r.dimension}-${r.value}`}>
                        <Badge tone="neutral" hint={sentence(r.dimension)}>
                          {profileValueLabel(r.value) ?? slugLabel(r.value)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            {/**
              * Privacy Guidance §A — what this parent has allowed, connection by
              * connection.
              *
              * Its own card rather than a line on the profile, because it is the
              * only place an admin can answer "may Pando say 'a parent at your
              * golf club' about them" — and §I asks that an attributed statement
              * be reconstructable from its supporting records, which means the
              * wording version and the timestamp have to be readable, not just
              * stored.
              *
              * **Revoked rows stay listed.** A withdrawn permission is part of
              * the answer to "what was allowed, and when", and hiding it would
              * make the card look like a current-state view of something that is
              * really a history.
              */}
            {c.affiliation_visibility.length > 0 && (
              <Card
                title="Connections Pando may mention"
                right={
                  <span className="text-[12px] text-muted">
                    {
                      c.affiliation_visibility.filter(
                        (v) => v.visibility === "shared_anonymously",
                      ).length
                    }{" "}
                    of {c.affiliation_visibility.length} allowed
                  </span>
                }
              >
                <ul className="divide-y divide-bark/50">
                  {c.affiliation_visibility.map((v) => {
                    const shared = v.visibility === "shared_anonymously";
                    return (
                      <li
                        key={`${v.affiliation_type}/${v.affiliation_value}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="text-[14.5px] font-medium">
                            {slugLabel(v.affiliation_value)}
                          </span>
                          <span className="ml-2 text-[12.5px] text-muted">
                            {AFFILIATION_KIND[v.affiliation_type] ??
                              sentence(v.affiliation_type)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge tone={shared ? "green" : "muted"}>
                            {shared ? "May be mentioned" : "Private"}
                          </Badge>
                          {/* The evidence, in the order it reads: when they
                              agreed, and — if it happened — when they took it
                              back. */}
                          <span className="text-[12px] text-muted">
                            {shared
                              ? `since ${when(v.consented_at)}`
                              : v.revoked_at
                                ? `withdrawn ${when(v.revoked_at)}`
                                : "never shared"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
                  Wording version{" "}
                  <span className="font-mono">
                    {c.affiliation_visibility[0].consent_text_version ?? "—"}
                  </span>
                  .
                </p>
              </Card>
            )}

            <SharedCards
              cards={c.cards}
              contributions={contributions ?? []}
              loading={contributionsLoading}
            />

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
                {message && <ResultNote inline>{message}</ResultNote>}
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
                    <TextLink
                      href={`/admin/contributors/${c.referral.referred_by.id}`}
                    >
                      {c.referral.referred_by.name ?? "Unknown"}
                    </TextLink>
                  </div>
                ) : !pickerOpen ? (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[13.5px] text-muted">Nobody recorded</span>
                    <TextLink
                      className="text-[12.5px]"
                      onClick={() => setPickerOpen(true)}
                    >
                      Record who invited them
                    </TextLink>
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
                  Credits are earned in Network Checks, and those do not exist until
                  Phase 2 — so this records who to credit, and nothing is credited.
                */}
                {refMessage && (
                  <p className="mt-2 text-[12.5px] text-muted">{refMessage}</p>
                )}
              </div>
            </Card>

            {/* The "Not editable here" card that used to sit at the bottom is
                gone. It explained the data model to somebody who never asked —
                a phone number is not editable because it is how Pando knows one
                person from another, and nobody looking at this page was about to
                try. If a real question comes up about changing a number, the
                answer is a conversation, not a paragraph nobody reads. */}
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

/**
 * What the parent shared, and which of it the Founding decision rests on.
 *
 * ⚠ **"Counts toward Founding" is the rule the queue decides on, and nothing
 * looser**: an approved contribution that is not a test row, a caregiver
 * nomination only when approved (`founding_checklist.approved_contributions`,
 * drizzle/0045). They are listed first, under their own heading, because they are
 * what the Confirm button in the Founding queue is agreeing to.
 *
 * Each activity, place or tip opens in place (`<details>`, so it works before
 * hydration and find-in-page reaches it) onto exactly what the contributions
 * queue shows. A caregiver card does not open here: its private note is behind
 * a logged read on the caregivers page (invariant 12), so it links there.
 */
function SharedCards({
  cards,
  contributions,
  loading,
}: {
  cards: ContributorDetail["cards"];
  contributions: ContributionRow[];
  loading: boolean;
}) {
  const shares = contributions.filter((r) => !r.is_test);
  const caregivers = cards.filter((card) => card.kind === "caregiver");
  const counts = (status: string) => status === "approved";
  const approved =
    shares.filter((r) => counts(r.status)).length +
    caregivers.filter((card) => counts(card.status)).length;
  const total = shares.length + caregivers.length;

  /**
   * The Founding queue links here as `#contributions`, and this block arrives
   * after the page does — so the browser looks for the anchor before it exists
   * and lands at the top. Scrolled once, when the cards are in, and only for
   * that link.
   */
  const anchor = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || loading || total === 0) return;
    if (window.location.hash !== "#contributions") return;
    scrolled.current = true;
    anchor.current?.scrollIntoView({ block: "start" });
  }, [loading, total]);

  const ordered = [
    ...shares.filter((r) => counts(r.status)),
    ...shares.filter((r) => !counts(r.status)),
  ];

  return (
    <div id="contributions" ref={anchor} className="scroll-mt-4">
      <Card
        title={`What they shared (${total})`}
        right={
          <span className="text-[12px] text-muted">
            {approved} approved · Founding needs {FOUNDING_MIN_APPROVED}
          </span>
        }
      >
        {loading && total === 0 ? (
          <Loading />
        ) : total === 0 ? (
          <Empty title="Nothing shared yet" />
        ) : (
          <ul className="divide-y divide-bark/50">
            {ordered.map((row) => (
              <li key={row.id}>
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[14px] hover:bg-paper [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2">
                      <DisclosureChevron />
                      <Badge tone="muted">{CARD_KIND[row.kind] ?? sentence(row.kind)}</Badge>
                      <span className="truncate font-medium">{row.share.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
                      {counts(row.status) && (
                        <Badge tone="green">Counts toward Founding</Badge>
                      )}
                      {!counts(row.status) &&
                        (REVIEW_STATUS[row.status]?.label ?? sentence(row.status))}
                      <span className="hidden sm:inline">{when(row.created_at)}</span>
                    </span>
                  </summary>
                  {/* The queue gets this padding from `RecordCard`; here the
                      facts sit straight in a list row, so it is given here. */}
                  <div className="border-t border-bark/50 px-4 pb-3 pt-3">
                    <ContributionFacts row={row} />
                    <p className="pt-3 text-[13px]">
                      <TextLink href="/admin/activities">
                        Act on it in the contributions queue
                      </TextLink>
                    </p>
                  </div>
                </details>
              </li>
            ))}
            {caregivers.map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone="muted">{CARD_KIND[card.kind] ?? sentence(card.kind)}</Badge>
                  <span className="truncate font-medium">{card.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
                  {counts(card.status) ? (
                    <Badge tone="green">Counts toward Founding</Badge>
                  ) : (
                    (REVIEW_STATUS[card.status]?.label ?? sentence(card.status))
                  )}
                  <TextLink href="/admin/caregivers">Open</TextLink>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
