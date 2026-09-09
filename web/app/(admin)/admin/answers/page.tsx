"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
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
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { holdReasonLabel, sentence } from "@/lib/admin/labels";
import type { AnswerRow } from "@/lib/admin/types";

/**
 * Estimate 14.2 — the answer queue, and the last link in the chain.
 *
 * 5.5 retrieves, 5.6 labels, 5.7 composes, 5.8 decides this has to be read. Until
 * this page existed, a composed answer had nowhere to go.
 *
 * ## What a reviewer is actually checking
 *
 * Not the prose. **The claim.** Every answer carries the trust labels it rests on,
 * and the question in front of them is whether the records support the sentence —
 * "Validated by multiple parents" on a record two parents have used is true, and
 * on one is the single most damaging thing Pando could say. So the labels are
 * shown as their own row rather than left to be spotted inside the text.
 *
 * ## Approve and send are two buttons, and that is deliberate
 *
 * They are different events. Approving is a judgement — durable, audited, and
 * final. Sending is a delivery attempt that can fail on a carrier and be retried
 * without anybody re-approving anything. One button would mean a hiccup either
 * lost the decision or wrote a second one.
 */

/**
 * One answer, and it lives **at module level** — which is a correctness fix
 * rather than a tidy-up.
 *
 * It was declared inside `AnswersPage`, so every render of the page created a
 * new component *type*. React reconciles by type, and a new type in the same
 * position is not an update — it is an unmount and a fresh mount, so the DOM
 * node is thrown away and rebuilt. This card holds a controlled `<textarea>`
 * whose draft lives in page state, so the page re-rendered on every keystroke
 * and **typing one character destroyed the field and took the caret with it**.
 * An admin could not write a rewrite at all.
 *
 * Hence the props: the draft, `busy`, the setter and `run` used to come from
 * the closure. They change on every keystroke, which is what props are for —
 * what must never change is the type.
 */
function AnswerCard({
  row,
  draft,
  busy,
  setDrafts,
  run,
}: {
  row: AnswerRow;
  /** `undefined` means not being rewritten; `""` is an emptied draft. */
  draft: string | undefined;
  busy: boolean;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  run: (label: string, fn: () => Promise<{ persisted: boolean }>) => Promise<void>;
}) {
  const editing = draft !== undefined;

  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
          They asked
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          {row.asker ?? (
            /* 5.9's subject: a stranger with no profile, texting cold. */
            <span>New number</span>
          )}
          {row.asker_phone_masked && <span>{row.asker_phone_masked}</span>}
          <span>·</span>
          <span>{when(row.created_at)}</span>
        </p>
      </div>
      <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">
        “{row.question}”
      </p>

      <p className="mt-3 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
        What Pando would send
      </p>
      {editing ? (
        <textarea
          className={`${inputClass} mt-1 min-h-[7rem] w-full`}
          value={draft}
          onChange={(e) =>
            setDrafts((d) => ({ ...d, [row.id]: e.target.value.slice(0, 2000) }))
          }
        />
      ) : (
        <p className="mt-1 whitespace-pre-line rounded-xl border border-bark bg-card px-3 py-2 text-[15px] leading-relaxed text-ink">
          {row.answer_text}
        </p>
      )}

      {/**
       * The claim, on its own row.
       *
       * This is what the reviewer is judging — whether the records support the
       * sentence — and a label spotted inside a paragraph is a label nobody
       * checks.
       */}
      <p className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
          Claims
        </span>
        {row.public_only ? (
          <Badge tone="neutral">
            General information only
          </Badge>
        ) : row.labels.length === 0 ? (
          <span className="text-[13px] text-muted">nothing</span>
        ) : (
          row.labels.map((l) => (
            <Badge key={l} tone="green">
              {l}
            </Badge>
          ))
        )}
        {/* No hint: "Routine — every answer is read" in neutral, against a
            named reason in gold, is the whole of what the two sentences here
            used to say — and on this queue the same one rendered ten times. */}
        <Badge
          tone={row.hold_reason === "pilot_review_all" ? "neutral" : "gold"}
        >
          {holdReasonLabel(row.hold_reason)}
        </Badge>
        {row.next_step === "offer_blast" && (
          <Badge tone="gold">
            Offers a Network Ask
          </Badge>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {row.status === "pending_review" && !editing && (
          <>
            <Button
              tone="primary"
              subject={`"${row.question.slice(0, 44).trimEnd()}"`}
              disabled={busy}
              onClick={() =>
                void run("Approved. Send it when you're ready.", async () =>
                  adminAction({ action: "answer.approve", id: row.id }),
                )
              }
            >
              Approve
            </Button>
            <Button
              tone="secondary"
              subject={`"${row.question.slice(0, 44).trimEnd()}"`}
              disabled={busy}
              onClick={() => setDrafts((d) => ({ ...d, [row.id]: row.answer_text }))}
            >
              Rewrite it
            </Button>
            <Button
              tone="danger"
              subject={`"${row.question.slice(0, 44).trimEnd()}"`}
              disabled={busy}
              onClick={() =>
                void run("Set aside — nothing sent.", async () =>
                  adminAction({ action: "answer.reject", id: row.id, reason: "not_good_enough" }),
                )
              }
            >
              Don&apos;t send
            </Button>
          </>
        )}

        {editing && (
          <>
            <Button
              tone="primary"
              disabled={busy}
              onClick={() =>
                void run("Rewritten.", async () => {
                  const out = await adminAction({
                    action: "answer.edit",
                    id: row.id,
                    text: draft,
                  });
                  setDrafts((d) => {
                    const next = { ...d };
                    delete next[row.id];
                    return next;
                  });
                  return out;
                })
              }
            >
              Save the rewrite
            </Button>
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() =>
                setDrafts((d) => {
                  const next = { ...d };
                  delete next[row.id];
                  return next;
                })
              }
            >
              Cancel
            </Button>
          </>
        )}

        {row.status === "approved" && (
          <Button
            tone="primary"
            subject={`"${row.question.slice(0, 44).trimEnd()}"`}
            disabled={busy}
            onClick={() =>
              void run("Sent.", async () => adminAction({ action: "answer.send", id: row.id }))
            }
          >
            Send it
          </Button>
        )}

        {row.status === "sent" && (
          <Badge tone="green">Sent {row.sent_at ? when(row.sent_at) : ""}</Badge>
        )}
        {row.status === "rejected" && <Badge tone="neutral">Not sent</Badge>}
      </div>
    </li>
  );
}

export default function AnswersPage() {
  const { rows, configured, demo, setDemo, loading, error, reload } =
    useAdminRows<AnswerRow[]>("answers");

  /* The row being acted on, not a page-wide flag. Reading one answer while
     another is sending is ordinary work; freezing every button on the page for
     the round trip made the queue feel broken. */
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const all = rows ?? [];
  const waiting = all.filter((r) => r.status === "pending_review");
  /* Every queue reveals the same way: thirty rows, then a button saying how
     many are left. Inert until the list is long enough to need it. */
  const { shown, hidden, revealAll } = useReveal(waiting);
  const approved = all.filter((r) => r.status === "approved");
  const done = all.filter((r) => r.status === "sent" || r.status === "rejected");

  async function run(
    rowId: string,
    label: string,
    fn: () => Promise<{ persisted: boolean }>,
  ) {
    setBusy(rowId);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(result.persisted ? label : `${label} — but nothing was saved.`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead title="Answers to send" />

      {error && <ErrorNote>{error}</ErrorNote>}
      {message && <ResultNote>{message}</ResultNote>}

      <div className="space-y-5">
        <Card title={`Waiting for you (${waiting.length})`}>
          {loading && all.length === 0 ? (
            <Loading />
          ) : error && all.length === 0 ? (
            <Failed />
          ) : !configured && all.length === 0 ? (
            <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample
            />
          ) : waiting.length === 0 ? (
            <Empty
              title="Nothing waiting"
            />
          ) : (
            <ul className="divide-y divide-bark/50">
              {shown.map((r) => (
                <AnswerCard
                  key={r.id}
                  row={r}
                  draft={drafts[r.id]}
                  busy={busy === r.id}
                  setDrafts={setDrafts}
                  run={(label, fn) => run(r.id, label, fn)}
                />
              ))}
            </ul>
          )}
          <RevealMore n={hidden} onClick={revealAll} />
        </Card>

        {approved.length > 0 && (
          <Card
            title={`Approved, not sent (${approved.length})`}
            className="border-gold-line"
          >
            {/* This card exists because the two-button design creates a state
                that can be forgotten. An approved answer nobody sent is a parent
                still waiting, so it is called out rather than filed under done. */}
            <ul className="divide-y divide-bark/50">
              {approved.map((r) => (
                <AnswerCard
                  key={r.id}
                  row={r}
                  draft={drafts[r.id]}
                  busy={busy === r.id}
                  setDrafts={setDrafts}
                  run={(label, fn) => run(r.id, label, fn)}
                />
              ))}
            </ul>
          </Card>
        )}

        {done.length > 0 && (
          <Card title={`Already decided (${done.length})`}>
            <ul className="divide-y divide-bark/50">
              {done.map((r) => (
                <AnswerCard
                  key={r.id}
                  row={r}
                  draft={drafts[r.id]}
                  busy={busy === r.id}
                  setDrafts={setDrafts}
                  run={(label, fn) => run(r.id, label, fn)}
                />
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* Only when there is something to explain. An instruction about how to
          judge a queue, printed under an empty queue, is a paragraph asking the
          reader to hold a rule for work that does not exist — the "say it once,
          where it is needed" rule from the 19 Aug pass, applied to *when* as
          well as where. */}
    </>
  );
}
