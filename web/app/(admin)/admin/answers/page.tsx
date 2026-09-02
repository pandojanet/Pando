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
  ResultNote,
  inputClass,
  when,
} from "@/components/admin/ui";
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
export default function AnswersPage() {
  const { rows, configured, demo, setDemo, loading, error, reload } =
    useAdminRows<AnswerRow[]>("answers");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const all = rows ?? [];
  const waiting = all.filter((r) => r.status === "pending_review");
  const approved = all.filter((r) => r.status === "approved");
  const done = all.filter((r) => r.status === "sent" || r.status === "rejected");

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(result.persisted ? label : `${label} — but nothing was saved.`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  function AnswerCard({ row }: { row: AnswerRow }) {
    const draft = drafts[row.id];
    const editing = draft !== undefined;

    return (
      <li className="px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
            They asked
          </p>
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            {row.asker ?? (
              /* 5.9's subject. A stranger's first reply is their whole first
                 impression of Pando, which is worth the reviewer knowing. */
              <span title="No profile — they texted cold, usually from a forwarded answer.">
                New number
              </span>
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
            onChange={(e) => setDrafts({ ...drafts, [row.id]: e.target.value.slice(0, 2000) })}
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
            <Badge tone="neutral" title="Nothing here rests on a parent's experience. It says so, and that is worth checking.">
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
          <Badge
            tone={row.hold_reason === "pilot_review_all" ? "neutral" : "gold"}
            title={
              row.hold_reason === "pilot_review_all"
                ? "Held because the pilot reads every answer, not because of anything in this one."
                : "This one would still be held once the pilot stops reading everything."
            }
          >
            {holdReasonLabel(row.hold_reason)}
          </Badge>
          {row.next_step === "offer_blast" && (
            <Badge tone="gold" title="The answer offers to ask nearby parents for more.">
              Offers a Network Ask
            </Badge>
          )}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {row.status === "pending_review" && !editing && (
            <>
              <Button
                tone="primary"
                disabled={busy}
                title="Records your decision. Sending is the next button — a carrier failure must not undo an approval."
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
                disabled={busy}
                onClick={() => setDrafts({ ...drafts, [row.id]: row.answer_text })}
              >
                Rewrite it
              </Button>
              <Button
                tone="danger"
                disabled={busy}
                title="Nothing is sent. The text is kept as the record of what was refused."
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
                title="Replaces the text. The labels stay as they are — they describe the records, not the wording."
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
              disabled={busy}
              title="Goes through the same send layer as everything else — opt-out and quiet hours still apply."
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

  return (
    <>
      <PageHead
        title="Answers to send"
        intro="What Pando would reply, waiting for you. Nothing goes out unread during the pilot."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {message && <ResultNote>{message}</ResultNote>}

      <div className="space-y-5">
        <Card title={`Waiting for you (${waiting.length})`}>
          {loading && all.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
          ) : !configured && all.length === 0 ? (
            <NotConfigured demo={demo} onDemo={setDemo} />
          ) : waiting.length === 0 ? (
            <Empty
              title="Nothing waiting"
              body="Answers appear here as parents ask questions."
            />
          ) : (
            <ul className="divide-y divide-bark/50">
              {waiting.map((r) => (
                <AnswerCard key={r.id} row={r} />
              ))}
            </ul>
          )}
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
                <AnswerCard key={r.id} row={r} />
              ))}
            </ul>
          </Card>
        )}

        {done.length > 0 && (
          <Card title={`Already decided (${done.length})`}>
            <ul className="divide-y divide-bark/50">
              {done.map((r) => (
                <AnswerCard key={r.id} row={r} />
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
      {all.length > 0 && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
          You are checking the claim, not the wording: the labels say what the records
        support. If a label looks wrong, the fix is in the contributions queue — the
        labels are not editable here, because they describe the records rather than
        the sentence. {sentence("send")} goes through the same layer as every other
          message, so somebody who texted STOP still cannot be reached.
        </p>
      )}
    </>
  );
}
