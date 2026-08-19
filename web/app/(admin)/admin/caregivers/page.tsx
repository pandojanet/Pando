"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
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
  optionLabel,
  slugLabel,
  when,
} from "@/components/admin/ui";
import {
  adminAction,
  readRestrictedNote,
  useAdminRows,
} from "@/lib/admin/client";
import type { CaregiverRow, ConsentStatus, DuplicateCandidate } from "@/lib/admin/types";
import { CONSENT_STATE, HOLD_REASON, sentence } from "@/lib/admin/labels";
import {
  CAREGIVER_AGE_BANDS,
  CAREGIVER_BENEFITS,
  CAREGIVER_HOURS,
  CAREGIVER_PAY_BANDS,
  CAREGIVER_SCHEDULE,
  CAREGIVER_TYPES,
} from "@/lib/caregiver-options";

/**
 * Estimate 2.5 — caregiver consent and duplicate candidates.
 *
 * The most consequential page in the admin, so three rules are visible in the UI:
 *
 *  - **Consent needs evidence.** Recording a "yes" asks how it was given; a phone call
 *    or an in-person yes also needs a note, because that note is the only artefact.
 *  - **Active is not consent.** A caregiver can only be switched on after consent, and
 *    both flags are required before they can appear in any answer.
 *  - **Held cards come first, and releasing one is a decision.** A hesitant "would you
 *    hire them again", or any restricted note, holds the nomination. Releasing it asks
 *    for a note, because a name goes on it in the audit log.
 *  - **Restricted notes are fetched one at a time, never listed.** The list only says
 *    that one exists (invariant 12), and opening it is itself an audited read.
 *  - **Pando never contacts anyone here.** There is no contact column because there is
 *    no contact detail in the database (invariant 13) — the parent sent the invite.
 *  - **Duplicates are suggestions.** Merging is a human decision, and it asks which
 *    record survives — a wrong merge attributes someone else's caveats to a real
 *    person, which is worse than leaving two rows.
 */

/**
 * The visibility ladder. It only moves forward, and only on the caregiver's own word:
 * `invited` is as far as a parent's action reaches, `consented` needs evidence recorded
 * here, and a revoke is always available.
 */
const NEXT_STATES: Record<ConsentStatus, ConsentStatus[]> = {
  mentioned: ["invited", "declined"],
  invited: ["consented", "declined"],
  consented: ["revoked"],
  declined: [],
  revoked: [],
};

const METHODS = [
  { id: "sms_reply", label: "Replied YES by text" },
  { id: "signed_link", label: "Confirmed via a link" },
  { id: "call_logged", label: "Said yes on a call" },
  { id: "in_person", label: "Said yes in person" },
];
/** No artefact of their own — the note is the evidence. */
const NEEDS_NOTE = ["call_logged", "in_person"];

export default function CaregiversPage() {
  const caregivers = useAdminRows<CaregiverRow[]>("caregivers");
  const duplicates = useAdminRows<DuplicateCandidate[]>("duplicates");

  const [openConsent, setOpenConsent] = useState<string | null>(null);
  const [method, setMethod] = useState(METHODS[0].id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Releasing a hold needs a reason, so it gets its own panel rather than a button. */
  const [releasing, setReleasing] = useState<string | null>(null);
  const [releaseNote, setReleaseNote] = useState("");
  /** A restricted note is fetched one at a time, on request, and never listed. */
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState<string | null>(null);

  const rows = useMemo(
    () => (caregivers.rows ?? []).filter((r) => !r.is_test),
    [caregivers.rows],
  );

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted ? label : `${label} — but nothing was saved.`,
      );
      setOpenConsent(null);
      setNote("");
      await caregivers.reload();
      await duplicates.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Caregivers"
        intro="Everyone a family has put forward. Nobody reaches a parent until she has said yes herself and you have switched her on — until both are true she is invisible, whatever else is set here."
      />

      {(caregivers.error || duplicates.error) && (
        <ErrorNote>{caregivers.error ?? duplicates.error}</ErrorNote>
      )}
      {caregivers.sample && <SampleBanner />}
      {message && (
        <div className="mb-4 rounded-xl border border-green/25 bg-green-wash px-4 py-2.5 text-[13.5px] font-medium text-green-deep">
          {message}
        </div>
      )}

      <div className="space-y-5">
        <Card title="Nominations">
          {caregivers.loading && rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
          ) : !caregivers.configured && rows.length === 0 ? (
            /* This page reads two resources; sample mode has to cover both. */
            <NotConfigured
              demo={caregivers.demo}
              onDemo={(on) => {
                caregivers.setDemo(on);
                duplicates.setDemo(on);
              }}
            />
          ) : rows.length === 0 ? (
            <Empty title="No nominations yet" />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Caregiver</Th>
                  <Th>Type</Th>
                  <Th>Good with</Th>
                  <Th>Consent</Th>
                  <Th>Evidence</Th>
                  <Th>Review</Th>
                  <Th>Reference</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const answerable = row.consent_status === "consented" && row.active;
                  const open = openConsent === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <Td>
                          <span className="font-semibold">
                            {row.first_name}
                            {row.last_initial ? ` ${row.last_initial}.` : ""}
                          </span>
                          <span className="mt-0.5 block text-[12.5px] text-muted">
                            {row.nominations === 1
                              ? "1 nomination"
                              : `${row.nominations} nominations`}
                          </span>
                          <span className="mt-1 block">
                            <ProvenanceBadge provenance={row.provenance} />
                          </span>
                          {row.caveat && (
                            <span className="mt-1 block text-[12.5px] italic text-muted">
                              “{row.caveat}”
                            </span>
                          )}
                        </Td>
                        <Td>
                          {row.type ? optionLabel(CAREGIVER_TYPES, row.type) : "—"}
                          {/**
                           * Stage 1 employment context. Kept together and kept here
                           * rather than given columns of its own, because it is only
                           * ever read as one thing: what kind of job this was. A pay
                           * band on its own is not a market rate.
                           */}
                          {(row.hours_per_week ||
                            row.schedule_pattern.length > 0 ||
                            row.pay_band ||
                            row.benefits.length > 0) && (
                            <span className="mt-1 block text-[12px] leading-relaxed text-muted">
                              {[
                                row.hours_per_week &&
                                  optionLabel(CAREGIVER_HOURS, row.hours_per_week),
                                row.schedule_pattern
                                  .map((v) => optionLabel(CAREGIVER_SCHEDULE, v))
                                  .join(", ") || null,
                                row.pay_band &&
                                  optionLabel(CAREGIVER_PAY_BANDS, row.pay_band),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              {row.benefits.length > 0 &&
                                row.benefits[0] !== "none" && (
                                  <span className="mt-0.5 block">
                                    with{" "}
                                    {row.benefits
                                      .map((v) => optionLabel(CAREGIVER_BENEFITS, v))
                                      .join(", ")}
                                  </span>
                                )}
                              {row.pay_band && !row.pay_benchmark_consent && (
                                <span
                                  className="mt-0.5 block"
                                  title="Stored for context, but the parent did not agree to it being pooled"
                                >
                                  not poolable
                                </span>
                              )}
                            </span>
                          )}
                        </Td>
                        <Td>
                          {row.good_with_bands
                            .map((b) => optionLabel(CAREGIVER_AGE_BANDS, b))
                            .join(", ") || "—"}
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              row.consent_status === "consented"
                                ? "green"
                                : row.consent_status === "declined"
                                  ? "red"
                                  : "gold"
                            }
                          >
                            {CONSENT_STATE[row.consent_status]?.label ??
                              slugLabel(row.consent_status)}
                          </Badge>
                          <span className="mt-1 block">
                            {answerable ? (
                              <Badge tone="green" title="She said yes and you switched her on — families can see her">
                                families can see her
                              </Badge>
                            ) : (
                              <Badge tone="muted">not shown to anyone</Badge>
                            )}
                          </span>
                        </Td>
                        <Td className="text-[13px]">
                          {row.consent_evidence ? (
                            <>
                              {slugLabel(row.consent_evidence.method)}
                              <span className="mt-0.5 block text-muted">
                                {when(row.consent_evidence.at)}
                                {row.consent_evidence.note
                                  ? ` · ${row.consent_evidence.note}`
                                  : ""}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted">none recorded</span>
                          )}
                        </Td>
                        <Td className="text-[13px]">
                          {row.review_hold ? (
                            <>
                              <Badge
                                tone="gold"
                                title="Nothing happens with this one until you clear it"
                              >
                                held
                              </Badge>
                              <span className="mt-1 block text-muted">
                                {row.hold_reasons
                                  .map((r) => HOLD_REASON[r] ?? sentence(r))
                                  .join(", ")}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted">clear</span>
                          )}
                          {row.has_restricted_notes && (
                            <span className="mt-1 block">
                              <Badge
                                tone="red"
                                title="Never shown to a family or to the caregiver, and never summarized by a model"
                              >
                                private note
                              </Badge>
                            </span>
                          )}
                          {row.invite_sent_by_parent && (
                            <span className="mt-1 block text-muted">
                              parent sent the invite
                            </span>
                          )}
                        </Td>
                        <Td className="text-[13px]">
                          {row.contributor_reference_opt_in
                            ? slugLabel(row.contributor_reference_opt_in)
                            : "—"}
                          <span className="mt-0.5 block text-muted">from the parent</span>
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-1.5">
                            {NEXT_STATES[row.consent_status].map((to) =>
                              to === "consented" ? (
                                <Button
                                  key={to}
                                  tone="primary"
                                  disabled={busy}
                                  onClick={() => {
                                    setOpenConsent(open ? null : row.id);
                                    setMethod(METHODS[0].id);
                                    setNote("");
                                  }}
                                >
                                  {open ? "Cancel" : "Record consent"}
                                </Button>
                              ) : (
                                <Button
                                  key={to}
                                  tone={to === "declined" ? "danger" : "secondary"}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(`Marked ${to}`, async () =>
                                      adminAction({
                                        action: "caregiver.consent",
                                        id: row.id,
                                        to,
                                        method: to === "declined" ? "recorded" : "outreach_sent",
                                        note: null,
                                      }),
                                    )
                                  }
                                >
                                  Mark {to}
                                </Button>
                              ),
                            )}

                            {row.consent_status === "consented" && (
                              <Button
                                tone="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    row.active ? "Switched off" : "Switched on",
                                    async () =>
                                      adminAction({
                                        action: "caregiver.visibility",
                                        id: row.id,
                                        consent_status: row.consent_status,
                                        active: !row.active,
                                      }),
                                  )
                                }
                              >
                                {row.active ? "Set inactive" : "Set active"}
                              </Button>
                            )}

                            {/* Only offered once they are answerable. Being
                                introducible is a further step, and theirs to give. */}
                            {row.consent_status === "consented" && row.active && (
                              <Button
                                tone="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    row.discoverable ? "Hidden" : "Discoverable",
                                    async () =>
                                      adminAction({
                                        action: "caregiver.visibility",
                                        id: row.id,
                                        consent_status: row.consent_status,
                                        discoverable: !row.discoverable,
                                      }),
                                  )
                                }
                              >
                                {row.discoverable
                                  ? "Not discoverable"
                                  : "Make discoverable"}
                              </Button>
                            )}

                            {row.review_hold && (
                              <Button
                                tone="danger"
                                disabled={busy}
                                onClick={() => setReleasing(row.id)}
                              >
                                Release hold…
                              </Button>
                            )}

                            {row.has_restricted_notes && (
                              <Button
                                tone="secondary"
                                disabled={busy}
                                onClick={() => {
                                  setNoteFor(row.id);
                                  setNoteBody(null);
                                  void readRestrictedNote(row.id).then(setNoteBody);
                                }}
                              >
                                Read private note
                              </Button>
                            )}
                          </div>
                        </Td>
                      </tr>

                      {open && (
                        <tr>
                          <Td colSpan={8} className="bg-paper/70">
                            <div className="grid gap-3 py-1 sm:grid-cols-2">
                              <Field
                                label="How did they say yes?"
                                hint="Referral of caregivers needs an auditable artefact, not a checkbox."
                              >
                                <select
                                  className={inputClass}
                                  value={method}
                                  onChange={(e) => setMethod(e.target.value)}
                                >
                                  {METHODS.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field
                                label={
                                  NEEDS_NOTE.includes(method)
                                    ? "Note (required)"
                                    : "Note (optional)"
                                }
                                hint="What was said, and when. Stored with your name."
                              >
                                <input
                                  className={inputClass}
                                  value={note}
                                  onChange={(e) => setNote(e.target.value.slice(0, 300))}
                                />
                              </Field>
                            </div>
                            <p className="mb-2 text-[12px] leading-relaxed text-muted">
                              Consent covers being <em>listed</em>. It is not permission
                              to be contacted — Pando never contacts a nominated
                              caregiver — and it is not permission to be a reference.
                              That one comes from the parent who nominated them.
                            </p>
                            <Button
                              tone="primary"
                              disabled={
                                busy || (NEEDS_NOTE.includes(method) && note.trim().length === 0)
                              }
                              onClick={() =>
                                void run("Consent recorded", async () =>
                                  adminAction({
                                    action: "caregiver.consent",
                                    id: row.id,
                                    to: "consented",
                                    method,
                                    note: note.trim() || null,
                                  }),
                                )
                              }
                            >
                              Record consent
                            </Button>
                          </Td>
                        </tr>
                      )}

                      {releasing === row.id && (
                        <tr>
                          <Td colSpan={8} className="bg-gold-wash/40">
                            <Field
                              label="Why is this safe to release?"
                              hint="Your name goes on this in the audit log. A hold exists because a parent hesitated."
                            >
                              <input
                                className={inputClass}
                                value={releaseNote}
                                onChange={(e) =>
                                  setReleaseNote(e.target.value.slice(0, 300))
                                }
                              />
                            </Field>
                            <div className="mt-2 flex gap-2">
                              <Button
                                tone="danger"
                                disabled={busy || releaseNote.trim().length < 3}
                                onClick={() =>
                                  void run("Hold released", async () => {
                                    const result = await adminAction({
                                      action: "nomination.release_hold",
                                      id: row.id,
                                      note: releaseNote.trim(),
                                    });
                                    setReleasing(null);
                                    setReleaseNote("");
                                    return result;
                                  })
                                }
                              >
                                Release the hold
                              </Button>
                              <Button
                                tone="secondary"
                                onClick={() => {
                                  setReleasing(null);
                                  setReleaseNote("");
                                }}
                              >
                                Keep it held
                              </Button>
                            </div>
                          </Td>
                        </tr>
                      )}

                      {noteFor === row.id && (
                        <tr>
                          <Td colSpan={8} className="bg-paper/70">
                            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                              Restricted — this screen only
                            </p>
                            <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed">
                              {noteBody ?? "Loading…"}
                            </p>
                            <p className="mt-2 text-[12px] leading-relaxed text-muted">
                              Never shown to a family or to the caregiver, and never
                              summarized by a model. Opening it is recorded.
                            </p>
                            <Button
                              tone="secondary"
                              onClick={() => {
                                setNoteFor(null);
                                setNoteBody(null);
                              }}
                            >
                              Close
                            </Button>
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

        <Card
          title="Possible duplicates"
          right={
            <span className="text-[12px] text-muted">suggestions only — never merged automatically</span>
          }
        >
          {(duplicates.rows ?? []).length === 0 ? (
            <Empty
              title="No duplicate candidates"
              body="Name and initial aren't an identifier, so candidates are only suggested — a phone number at consent is the real key."
            />
          ) : (
            <ul className="divide-y divide-bark/50">
              {(duplicates.rows ?? []).map((group) => (
                <li key={group.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{group.members.length} records</span>
                    <Badge tone="gold">score {Math.round(group.score * 100)}%</Badge>
                    <span className="text-[12.5px] text-muted">
                      {group.reason.join(" · ")}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {group.members.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bark px-3 py-2 text-[13.5px]"
                      >
                        <span>
                          {m.first_name}
                          {m.last_initial ? ` ${m.last_initial}.` : ""} ·{" "}
                          {m.type ? slugLabel(m.type) : "—"} ·{" "}
                          {m.neighborhood ? slugLabel(m.neighborhood) : "—"}
                        </span>
                        <Button
                          tone="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run("Merged", async () =>
                              adminAction({
                                action: "caregiver.merge",
                                keep: m.id,
                                merge: group.members
                                  .filter((other) => other.id !== m.id)
                                  .map((other) => other.id),
                              }),
                            )
                          }
                        >
                          Keep this one, merge the rest
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted">
                    Merging the wrong two people attributes someone else&apos;s vouches and
                    caveats to a real person. Two rows for one person is only
                    redundancy — prefer that when unsure.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
