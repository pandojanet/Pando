"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  optionLabel,
  PageHead,
  ProvenanceBadge,
  ResultNote,
  SampleBanner,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { Dialog, Menu, MenuItem, MenuSeparator } from "@/components/admin/kit";
import {
  Fact,
  FactGrid,
  Quote,
  RecordCard,
  RecordDrawer,
  RecordList,
  RecordNotes,
} from "@/components/admin/Record";
import {
  adminAction,
  readRestrictedNote,
  useAdminRows,
} from "@/lib/admin/client";
import type { CaregiverRow, ConsentStatus, DuplicateCandidate } from "@/lib/admin/types";
import {
  CONSENT_STATE,
  HOLD_REASON,
  REFERENCE_WILLING,
  sentence,
} from "@/lib/admin/labels";
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
  /**
   * Why the failure needs its own state: `noteBody` is `null` while loading, so
   * a rejected read left the modal reading **"Loading…" forever** — on the one
   * panel in the admin whose contents are a private note about a named person,
   * where an admin waiting on a spinner concludes the note is missing rather
   * than that the request failed. `readRestrictedNote` had no `.catch` at all.
   */
  const [noteError, setNoteError] = useState<string | null>(null);

  const rows = useMemo(
    () => (caregivers.rows ?? []).filter((r) => !r.is_test),
    [caregivers.rows],
  );
  /* Nomination cards are tall, so thirty of them is already a long page.
     Inert at today's nineteen. */
  const { shown, hidden, revealAll } = useReveal(rows);

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
        intro="Everyone a family has put forward. Nobody reaches a parent until she says yes herself and you switch her on."
      />

      {(caregivers.error || duplicates.error) && (
        <ErrorNote>{caregivers.error ?? duplicates.error}</ErrorNote>
      )}
      {caregivers.sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      <div className="space-y-5">
        <Card title="Nominations">
          {caregivers.loading && rows.length === 0 ? (
            <Loading />
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
            <RecordList>
              {shown.map((row) => {
                const answerable = row.consent_status === "consented" && row.active;
                const open = openConsent === row.id;
                /**
                 * Stage 1 employment context, assembled once. It is only ever read
                 * as one thing — what kind of job this was — because a pay band on
                 * its own is not a market rate: 22–26/hr for a guaranteed 40 hours
                 * with paid holidays and 22–26/hr for occasional date nights are
                 * different numbers wearing the same label.
                 *
                 * Hours and schedule share the option `varied`, so a job that was
                 * irregular in both ways read "It varied · It varied" and the
                 * reader could not tell which answer was which. Each half now says
                 * what it is about — only when the value alone would be ambiguous,
                 * so the common case ("10–20 a week · Weekday mornings") is
                 * untouched.
                 */
                const jobShape = [
                  row.hours_per_week &&
                    (row.hours_per_week === "varied"
                      ? "Hours varied"
                      : optionLabel(CAREGIVER_HOURS, row.hours_per_week)),
                  row.schedule_pattern
                    .map((v) =>
                      v === "varied" ? "days varied" : optionLabel(CAREGIVER_SCHEDULE, v),
                    )
                    .join(", ") || null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                /**
                 * `none` was already skipped; `prefer_not_to_say` was not, so the
                 * line read "plus Prefer not to say" — a refusal rendered as a
                 * benefit. Both are `exclusive` options in the same list and both
                 * mean "there is nothing to list here", so both suppress it.
                 */
                const benefits = row.benefits.filter(
                  (b) => b !== "none" && b !== "prefer_not_to_say",
                );
                return (
                  <RecordCard
                    key={row.id}
                    /* A held card is the exception on this page, and it is the one
                       thing that stops everything else from happening — so it is
                       the one that gets a shade. */
                    tone={row.review_hold ? "pending" : "plain"}
                    title={`${row.first_name}${row.last_initial ? ` ${row.last_initial}.` : ""}`}
                    kind={row.type ? optionLabel(CAREGIVER_TYPES, row.type) : undefined}
                    aside={
                      <>
                        {row.nominations === 1
                          ? "1 nomination"
                          : `${row.nominations} nominations`}
                        <span className="mt-0.5 block">{when(row.created_at)}</span>
                      </>
                    }
                    badges={
                      <>
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
                            sentence(row.consent_status)}
                        </Badge>
                        {answerable ? (
                          <Badge
                            tone="green"
                            hint="She said yes and you switched her on — families can see her"
                          >
                            Families can see her
                          </Badge>
                        ) : (
                          <Badge tone="muted">Not shown to anyone</Badge>
                        )}
                        {row.review_hold && (
                          <Badge
                            tone="gold"
                            hint="Nothing happens with this one until you clear it. A parent hesitated about a named person, and releasing it is a decision with your name on it."
                          >
                            On hold
                          </Badge>
                        )}
                        {row.has_restricted_notes && (
                          <Badge
                            tone="red"
                            hint="Never shown to a family or to the caregiver, and never summarized by a model. Opening it is recorded against your name."
                          >
                            Private note
                          </Badge>
                        )}
                        <ProvenanceBadge provenance={row.provenance} />
                      </>
                    }
                    actions={
                      <>
                        {/**
                          * Two buttons and a menu, where there used to be up to
                          * six equal ones — a row of six says nothing about
                          * which you are meant to press.
                          *
                          * What stays a button: **recording consent**, which is
                          * the one act that moves a caregiver forward, and
                          * **releasing a hold**, which is not really an action
                          * at all but a piece of state the card is telling you
                          * about. Hiding that one would hide the state.
                          *
                          * What moves into the menu: the other consent states,
                          * the two visibility switches, and reading the private
                          * note — each of which the badges above already say
                          * enough about.
                          */}
                        {NEXT_STATES[row.consent_status].includes("consented") && (
                          <Button
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
                        )}

                        {/* Everything that is not the main move, in one place. */}
                        <Menu label={`More for ${row.first_name}`}>
                          {NEXT_STATES[row.consent_status]
                            .filter((to) => to !== "consented")
                            .map((to) => (
                              <MenuItem
                                key={to}
                                disabled={busy}
                                tone={to === "declined" ? "danger" : "plain"}
                                hint={
                                  to === "declined"
                                    ? "She said no. Nothing about her is shown again."
                                    : "You have asked her, and are waiting."
                                }
                                onSelect={() =>
                                  void run(`Marked ${to}`, async () =>
                                    adminAction({
                                      action: "caregiver.consent",
                                      id: row.id,
                                      to,
                                      method:
                                        to === "declined" ? "recorded" : "outreach_sent",
                                      note: null,
                                    }),
                                  )
                                }
                              >
                                Mark {to}
                              </MenuItem>
                            ))}

                          {/**
                           * Two switches that had four labels between them —
                           * "Set active"/"Set inactive" and "Make
                           * discoverable"/"Not discoverable", with the
                           * confirmations saying "Switched on"/"Hidden"
                           * instead. Nobody could tell what the difference
                           * between "active" and "discoverable" was, because
                           * both words describe the column and neither
                           * describes the effect. They are two steps of one
                           * thing, so they say what each step does.
                           */}
                          {row.consent_status === "consented" && (
                            <MenuItem
                              disabled={busy}
                              hint="Whether Pando may use her at all. Nothing shows a family until the next step too."
                              onSelect={() =>
                                void run(
                                  row.active ? "Switched off." : "Switched on.",
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
                              {row.active ? "Switch off" : "Switch on"}
                            </MenuItem>
                          )}

                          {/* Only offered once she is switched on. Being seen by
                              a family is a further step, and hers to give. */}
                          {row.consent_status === "consented" && row.active && (
                            <MenuItem
                              disabled={busy}
                              hint="Whether a family asking about care may be shown her at all."
                              onSelect={() =>
                                void run(
                                  row.discoverable
                                    ? "Hidden from families."
                                    : "Families can see her now.",
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
                                ? "Hide from families"
                                : "Let families see her"}
                            </MenuItem>
                          )}

                          {row.has_restricted_notes && (
                            <>
                              <MenuSeparator />
                              <MenuItem
                                disabled={busy}
                                hint="Opening it is recorded against your name."
                                onSelect={() => {
                                  setNoteFor(row.id);
                                  setNoteBody(null);
                                  setNoteError(null);
                                  void readRestrictedNote(row.id)
                                    .then(setNoteBody)
                                    .catch((err: unknown) =>
                                      setNoteError(
                                        err instanceof Error
                                          ? err.message
                                          : "The note could not be read.",
                                      ),
                                    );
                                }}
                              >
                                Read private note
                              </MenuItem>
                            </>
                          )}
                        </Menu>

                        {row.review_hold && (
                          <Button
                            tone="danger"
                            disabled={busy}
                            onClick={() => setReleasing(row.id)}
                          >
                            Release the hold…
                          </Button>
                        )}
                      </>
                    }
                  >
                    <FactGrid>
                      <Fact label="Good with">
                        {row.good_with_bands
                          .map((b) => optionLabel(CAREGIVER_AGE_BANDS, b))
                          .join(", ") || null}
                      </Fact>
                      <Fact
                        label="The job"
                        hint={
                          benefits.length > 0
                            ? `Plus ${benefits
                                .map((v) => optionLabel(CAREGIVER_BENEFITS, v))
                                .join(", ")}`
                            : undefined
                        }
                      >
                        {jobShape || null}
                      </Fact>
                      <Fact
                        label="Pay"
                        /* "not poolable" was our word for it. What the admin needs
                           to know is what they may do with the number: look at
                           it, not publish an average from it. And only when there
                           *is* a rate — on a row where the family preferred not
                           to say, this line guarded a number that does not
                           exist. */
                        hint={
                          row.pay_band &&
                          row.pay_band !== "prefer_not_to_say" &&
                          !row.pay_benchmark_consent
                            ? "For your eyes only — not for a published average"
                            : undefined
                        }
                      >
                        {row.pay_band
                          ? optionLabel(CAREGIVER_PAY_BANDS, row.pay_band)
                          : null}
                      </Fact>
                      <Fact
                        label="Consent evidence"
                        hint={
                          row.consent_evidence
                            ? [
                                when(row.consent_evidence.at),
                                row.consent_evidence.note,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : undefined
                        }
                      >
                        {/* `METHODS` already carries the wording the admin chose
                            from, so read it back rather than title-casing the
                            stored id into a second name for the same thing. */}
                        {/* The one fact on this page whose *absence* is the
                            point — consent needs an artefact, so "none recorded"
                            is said rather than left to an em dash. */}
                        {row.consent_evidence ? (
                          optionLabel(METHODS, row.consent_evidence.method)
                        ) : (
                          <span className="text-muted">None recorded</span>
                        )}
                      </Fact>
                      <Fact
                        label="Reference"
                        /* Whose willingness this is, because it is the one fact
                           here that is not about the caregiver: it is the family
                           offering to vouch for her. */
                        hint="The family who put her forward"
                      >
                        {row.contributor_reference_opt_in
                          ? (REFERENCE_WILLING[row.contributor_reference_opt_in] ??
                            sentence(row.contributor_reference_opt_in))
                          : null}
                      </Fact>
                      <Fact label="Invite">
                        {row.invite_sent_by_parent
                          ? "The parent sent it themselves"
                          : "Not sent yet"}
                      </Fact>
                      {row.review_hold && (
                        <Fact label="Why it is held">
                          {row.hold_reasons
                            .map((r) => HOLD_REASON[r] ?? sentence(r))
                            .join(", ") || null}
                        </Fact>
                      )}
                    </FactGrid>

                    {row.caveat && (
                      <RecordNotes>
                        <Quote label="What the family said to know first">
                          {row.caveat}
                        </Quote>
                      </RecordNotes>
                    )}

                    {open && (
                      <RecordDrawer title="Record that she said yes">
                        <div className="grid gap-3 sm:grid-cols-2">
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
                        <p className="mt-3 text-[12px] leading-relaxed text-muted">
                          Consent covers being <em>listed</em>. It is not permission to
                          be contacted — Pando never contacts a nominated caregiver —
                          and it is not permission to be a reference. That one comes
                          from the parent who nominated them.
                        </p>
                        <div className="mt-3">
                          <Button
                            tone="primary"
                            disabled={
                              busy ||
                              (NEEDS_NOTE.includes(method) && note.trim().length === 0)
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
                        </div>
                      </RecordDrawer>
                    )}

                    {releasing === row.id && (
                      <RecordDrawer title="Release the hold">
                        <Field
                          label="Why is this safe to release?"
                          hint="Your name goes on this in the audit log. A hold exists because a parent hesitated."
                        >
                          <input
                            className={inputClass}
                            value={releaseNote}
                            onChange={(e) => setReleaseNote(e.target.value.slice(0, 300))}
                          />
                        </Field>
                        <div className="mt-3 flex flex-wrap gap-2">
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
                      </RecordDrawer>
                    )}

                  </RecordCard>
                );
              })}
            </RecordList>
          )}
          <RevealMore n={hidden} onClick={revealAll} />
        </Card>

        <Card
          title="Possible duplicates"
          right={
            <span className="text-[12px] text-muted">suggestions only — never merged automatically</span>
          }
        >
          {(duplicates.rows ?? []).length === 0 ? (
            <Empty title="No duplicate candidates" />
          ) : (
            <ul className="divide-y divide-bark/50">
              {(duplicates.rows ?? []).map((group) => (
                <li key={group.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {group.members.length} records
                    </span>
                    {/* "score 87%" told the reader a number and not what to do
                        with it. A word first, the number in the tooltip — same
                        treatment as the usefulness score on Flags. */}
                    <Badge
                      tone={group.score >= 0.8 ? "gold" : "neutral"}
                      title={`How alike they look: ${Math.round(group.score * 100)}%. Pando will not merge two people on a first name and an initial, so this is your call.`}
                    >
                      {group.score >= 0.8
                        ? "Probably the same person"
                        : "Possibly the same person"}
                    </Badge>
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
                          {m.type ? optionLabel(CAREGIVER_TYPES, m.type) : "—"} ·{" "}
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
                  {/* Kept, unlike the other footnotes cut in this pass: this one
                      is about an action that cannot be undone, and it is short. */}
                  <p className="mt-2 text-[12px] leading-relaxed text-muted">
                    If you&apos;re not sure, leave them as two. Merging the wrong
                    people puts someone else&apos;s caveats on a real person.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/**
       * The one panel on this page that is a **modal** rather than an inline
       * drawer (invariant 12). A private note about a named person, whose read
       * is itself audited, should be the only thing on screen while it is open —
       * not left expanded behind other rows, or read over a shoulder while
       * somebody works the rest of the queue. Everything else here stays inline,
       * because taking a reader off a queue they are working down is a cost.
       *
       * **One dialog for the page, not one per row.** It used to be rendered
       * inside the `.map()`, so a queue of thirty caregivers mounted thirty
       * `<dialog>` elements, thirty `useId`s and thirty effects to keep
       * twenty-nine of them closed — and only one can ever be open, because
       * `noteFor` is a single id. `noteFor` is now what the dialog reads
       * directly.
       */}
      <Dialog
        open={noteFor !== null}
        onClose={() => {
          setNoteFor(null);
          setNoteBody(null);
          setNoteError(null);
        }}
        title="Restricted — this screen only"
        description="Never shown to a family or to the caregiver, and never summarized by a model. Opening it is recorded."
        footer={
          <Button
            tone="secondary"
            onClick={() => {
              setNoteFor(null);
              setNoteBody(null);
              setNoteError(null);
            }}
          >
            Close
          </Button>
        }
      >
        {/* Three states, not two: loading, failed, and read. Folding the first
            two together is what produced the permanent spinner. */}
        {noteError ? (
          <ErrorNote>{noteError}</ErrorNote>
        ) : noteBody === null ? (
          <Loading inline />
        ) : (
          <p className="whitespace-pre-line text-[14px] leading-relaxed">
            {noteBody}
          </p>
        )}
      </Dialog>
    </>
  );
}
