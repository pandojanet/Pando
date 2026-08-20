"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  inputClass,
  optionLabel,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { CaregiverClaimRow } from "@/lib/admin/types";
import {
  CAREGIVER_AGE_BANDS,
  CAREGIVER_AVAILABLE_FROM,
  CAREGIVER_DAYS,
  CAREGIVER_PAY_BANDS,
  CAREGIVER_STRENGTHS,
  CAREGIVER_TYPES,
} from "@/lib/caregiver-options";

/**
 * 2C — caregivers who registered themselves, waiting to be matched to a nomination.
 *
 * The decision on this page is **identity**, not quality: is this Rosa R. the Rosa R.
 * a family put forward? Nothing here can be automated, which is the whole reason the
 * page exists — one shared invite link means no token to match on, and Pando holds no
 * contact detail for a nominee to match against either (invariant 13).
 *
 * What this page deliberately never shows: anything a parent wrote about them. No
 * nomination text, no chosen strengths, and above all no private note or hesitant
 * "why" (invariant 12). The candidate list carries a name, a count and a ladder
 * state — enough to tell two people apart, and nothing that would let an admin read
 * a family's confidence back to the person it was about.
 */
export default function ClaimsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<CaregiverClaimRow[]>("caregiver_claims");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  /** How the person asked to be removed, and which row is one click from it. */
  const [via, setVia] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const all = rows ?? [];
  const pending = all.filter((c) => c.status === "pending");
  const resolved = all.filter((c) => c.status !== "pending");

  async function link(claimId: string, caregiverId: string) {
    setBusy(claimId);
    setMessage(null);
    try {
      const result = await adminAction({
        action: "claim.link",
        id: claimId,
        caregiver_id: caregiverId,
      });
      setMessage(
        result.persisted
          ? "Matched. They're consented, and still not visible — raise that on the caregiver page."
          : "Not stored — no database connected.",
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  async function decline(claimId: string) {
    const reason = (reasons[claimId] ?? "").trim();
    if (!reason) {
      setMessage("Say why first — this is a person who asked to be listed.");
      return;
    }
    setBusy(claimId);
    setMessage(null);
    try {
      const result = await adminAction({
        action: "claim.decline",
        id: claimId,
        reason,
      });
      setMessage(result.persisted ? "Declined." : "Not stored — no database connected.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  /**
   * The other half of "Text DELETE and the whole profile goes, without asking why",
   * which is the last thing the caregiver flow says to them. Until the SMS channel
   * is live an admin is the one who receives that request, so this is the button
   * that keeps the sentence true.
   *
   * Two things it asks for and one it doesn't: *how* they asked (the only evidence
   * the request was real) and a second click (this is the one action on any admin
   * page that no other action can undo). It never asks why.
   */
  async function remove(claimId: string) {
    const requested = (via[claimId] ?? "").trim();
    if (!requested) {
      setMessage("Record how they asked — a text, an email, a call.");
      return;
    }
    setBusy(claimId);
    setMessage(null);
    try {
      const result = await adminAction({
        action: "claim.delete",
        id: claimId,
        requested_via: requested,
      });
      setMessage(
        result.persisted
          ? "Deleted. Their profile and their consent records are gone; the audit log keeps the fact that you did it."
          : "Not stored — no database connected.",
      );
      setConfirming(null);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead
        title="Caregiver sign-ups"
        intro="Caregivers who signed themselves up. Say which family put each one forward — Pando never guesses, because two people can share a name."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && (
        <p className="mb-4 rounded-lg border border-bark bg-card px-3 py-2 text-[13px] text-ink-soft">
          {message}
        </p>
      )}

      {loading && all.length === 0 ? (
        <Card>
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        </Card>
      ) : !configured && all.length === 0 ? (
        <Card>
          <NotConfigured demo={demo} onDemo={setDemo} />
        </Card>
      ) : all.length === 0 ? (
        <Card>
          <Empty
            title="No sign-ups yet"
            body="They appear here once a family invites them and they fill in a profile."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.map((claim) => (
            <Card
              key={claim.id}
              title={`${claim.first_name} ${claim.last_initial ?? ""}`.trim()}
              right={<Badge tone="gold">Waiting to be matched</Badge>}
            >
              <div className="grid gap-4 px-4 py-3 lg:grid-cols-2">
                <dl className="space-y-2.5 text-[13.5px]">
                  <Pair label="Number" value={claim.phone_masked ?? "—"} />
                  <Pair label="Looking for" value={labels(CAREGIVER_TYPES, claim.roles_wanted)} />
                  <Pair label="Ages" value={labels(CAREGIVER_AGE_BANDS, claim.age_experience)} />
                  <Pair label="Says they're good at" value={labels(CAREGIVER_STRENGTHS, claim.strengths)} />
                  <Pair label="Areas" value={labels([], claim.areas_served)} />
                  <Pair
                    label="Drives"
                    value={claim.drives === null ? "—" : claim.drives ? "Yes" : "No"}
                  />
                  <Pair label="Days" value={labels(CAREGIVER_DAYS, claim.days_available)} />
                  <Pair
                    label="Can start"
                    value={claim.available_from ? optionLabel(CAREGIVER_AVAILABLE_FROM, claim.available_from) : "—"}
                  />
                  <Pair
                    label="Rate"
                    value={claim.rate_band ? optionLabel(CAREGIVER_PAY_BANDS, claim.rate_band) : "—"}
                  />
                  {claim.hours_note && (
                    <Pair label="On their hours" value={claim.hours_note} />
                  )}
                </dl>

                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                    What they agreed to
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={claim.appear_in_answers ? "green" : "muted"}>
                      {claim.appear_in_answers
                        ? "May appear in answers"
                        : "Not in answers"}
                    </Badge>
                    <Badge tone={claim.open_to_introductions ? "green" : "muted"}>
                      {claim.open_to_introductions
                        ? "May be introduced"
                        : "No introductions"}
                    </Badge>
                    <Badge tone={claim.open_to_reference_intros ? "green" : "muted"}>
                      {claim.open_to_reference_intros
                        ? "References ok"
                        : "No references"}
                    </Badge>
                  </div>
                  {/* The version string stays verbatim — it is what a complaint
                      would be answered with, so it must be the exact stored
                      value. What changed is that the line now says why it is
                      here, instead of the word "Wording" and an id. */}
                  <p className="mt-1.5 text-[12px] text-muted">
                    Signed up {when(claim.created_at)} · agreed to consent wording{" "}
                    <span className="font-mono">{claim.consent_text_version}</span>
                  </p>

                  <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                    Which nomination is this?
                  </p>
                  {claim.candidates.length === 0 ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                      No family has put this name forward. Usually best to decline
                      and let the family send the invite again — never attach her to
                      somebody else.
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-2">
                      {claim.candidates.map((c) => (
                        <li
                          key={c.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bark px-3 py-2"
                        >
                          <span className="text-[13.5px]">
                            <span className="font-semibold">
                              {c.first_name} {c.last_initial ?? ""}
                            </span>
                            <span className="ml-2 text-muted">
                              {c.nominations}{" "}
                              {c.nominations === 1 ? "nomination" : "nominations"} ·{" "}
                              {c.consent_status}
                              {c.invite_sent_by_parent
                                ? " · invite sent"
                                : " · no invite sent"}
                            </span>
                          </span>
                          <Button
                            tone="primary"
                            disabled={busy === claim.id}
                            onClick={() => void link(claim.id, c.id)}
                          >
                            This is them
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 border-t border-bark/70 pt-3">
                    <input
                      value={reasons[claim.id] ?? ""}
                      onChange={(e) =>
                        setReasons((r) => ({ ...r, [claim.id]: e.target.value }))
                      }
                      placeholder="Why this can't be matched"
                      className={inputClass}
                    />
                    <Button
                      tone="danger"
                      className="mt-2"
                      disabled={busy === claim.id}
                      onClick={() => void decline(claim.id)}
                    >
                      Decline this sign-up
                    </Button>
                  </div>

                  <DeleteRequest
                    claimId={claim.id}
                    via={via[claim.id] ?? ""}
                    onVia={(v) => setVia((s) => ({ ...s, [claim.id]: v }))}
                    confirming={confirming === claim.id}
                    onArm={() => setConfirming(claim.id)}
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => void remove(claim.id)}
                    busy={busy === claim.id}
                  />
                </div>
              </div>
            </Card>
          ))}

          {resolved.length > 0 && (
            <Card title={`Resolved (${resolved.length})`}>
              <ul className="divide-y divide-bark/50">
                {resolved.map((claim) => (
                  <li key={claim.id} className="px-4 py-2.5 text-[13.5px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {claim.first_name} {claim.last_initial ?? ""}
                      </span>
                      <span className="flex items-center gap-2 text-muted">
                        {claim.linked_caregiver && (
                          <span>
                            matched to {claim.linked_caregiver.first_name}{" "}
                            {claim.linked_caregiver.last_initial ?? ""}
                          </span>
                        )}
                        <Badge tone={claim.status === "linked" ? "green" : "muted"}>
                          {claim.status}
                        </Badge>
                      </span>
                    </div>
                    {/* A matched caregiver can ask to be removed too — in fact that
                        is when they are most likely to, because that is when they
                        are actually listed. */}
                    <DeleteRequest
                      claimId={claim.id}
                      via={via[claim.id] ?? ""}
                      onVia={(v) => setVia((s) => ({ ...s, [claim.id]: v }))}
                      confirming={confirming === claim.id}
                      onArm={() => setConfirming(claim.id)}
                      onCancel={() => setConfirming(null)}
                      onConfirm={() => void remove(claim.id)}
                      busy={busy === claim.id}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Honouring "text DELETE and the whole profile goes". Collapsed to one line until
 * it is armed, because it is not part of the normal work on this page — the normal
 * work is matching people up, and a delete control competing for attention with
 * "This is them" is how the wrong button gets pressed.
 */
function DeleteRequest({
  claimId,
  via,
  onVia,
  confirming,
  onArm,
  onCancel,
  onConfirm,
  busy,
}: {
  claimId: string;
  via: string;
  onVia: (value: string) => void;
  confirming: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onArm}
        className="mt-2 text-[12.5px] font-semibold text-muted underline underline-offset-2 hover:text-alert"
      >
        They asked to be removed
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-alert-line bg-alert-wash p-3">
      <p className="text-[13px] font-semibold text-alert">
        This deletes their profile, their sign-up and their consent records.
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-alert/90">
        It cannot be undone from here, and it is what we promised them. The family&apos;s
        own card stays — it is that parent&apos;s contribution, and it holds no way to
        contact anybody.
      </p>
      <input
        value={via}
        onChange={(e) => onVia(e.target.value.slice(0, 120))}
        placeholder="How did they ask? e.g. texted DELETE, 11 Aug"
        aria-label="How they asked to be removed"
        className={`${inputClass} mt-2`}
        id={`via-${claimId}`}
      />
      <div className="mt-2 flex gap-2">
        <Button
          tone="danger"
          disabled={busy || via.trim().length === 0}
          onClick={onConfirm}
        >
          Delete everything
        </Button>
        <Button tone="secondary" onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[9.5rem] shrink-0 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );
}

/**
 * The caregiver's own answers, rendered from the list she was actually offered.
 *
 * `options` is not optional by accident: these ids come from fixed lists whose
 * labels carry punctuation an id cannot ("$18–22/hr", "Babies (0–1)"), and
 * running them through `slugLabel` instead produced "18 22" and "Baby". Pass
 * the list. Neighborhoods are the one exception — they have no shared constant
 * on this surface and slugging them is lossless ("north-pasadena" → "North
 * Pasadena"), which is why `optionLabel` falls back to it rather than blanking.
 */
function labels(
  options: readonly { id: string; label: string }[],
  values: string[],
): string {
  return values.length === 0
    ? "—"
    : values.map((v) => optionLabel(options, v)).join(", ");
}
