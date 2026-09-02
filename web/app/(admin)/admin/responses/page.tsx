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
  slugLabel,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { BlastResponseRow } from "@/lib/admin/types";

/**
 * Estimates 7.6 and 7.9 — reading what the network answered.
 *
 * One page, because they are one act. The admin reads a reply, decides whether it
 * is any good, and **approving it is what lets it into the graph**: "every paid
 * question permanently enriches the free answer base".
 *
 * ## Why merge sits beside create, not behind a search
 *
 * 7.9 asks for "likely-duplicate candidates surfaced so it can be merged as a
 * validation instead of creating a second copy of the same place". That is the
 * difference between a knowledge base that compounds and one that fragments: two
 * parents on one record is the `Validated by multiple parents` label, while two
 * records with one parent each is nothing at all. A merge that costs one more
 * click than creating is a merge that stops happening — so the candidates are on
 * the card.
 *
 * ## What the page will not do
 *
 * It cannot approve into the answer base. The record it creates enters
 * `pending_review` and is read again in the ordinary contributions queue: this
 * admin is judging the *reply*, and the claim about a place is a second judgement.
 * Approving both at once would put text into an answer that one person has looked
 * at, which is invariant 8 with an extra step.
 */
export default function BlastResponsesPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<BlastResponseRow[]>("blast_responses");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const all = rows ?? [];
  const waiting = all.filter((r) => r.review_status === "pending_review");
  const done = all.filter((r) => r.review_status !== "pending_review");

  const key = (r: BlastResponseRow) => `${r.blast_id}:${r.person_id}`;

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

  function ResponseCard({ row }: { row: BlastResponseRow }) {
    const k = key(row);
    const typed = names[k] ?? "";

    return (
      <li className="px-4 py-4">
        {/* What was asked, so the reply can be judged against it rather than on
            its own merits. A good answer to a different question is not one. */}
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
          They were asked
        </p>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">
          “{row.question}”
        </p>

        <p className="mt-3 text-[15.5px] leading-relaxed text-ink">
          “{row.response_text}”
        </p>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <span className="font-medium text-ink-soft">{row.responder ?? "Unnamed"}</span>
          {row.responder_phone_masked && <span>{row.responder_phone_masked}</span>}
          <span>·</span>
          <span
            title="Approved contributions they already have. A track record is not a reason to approve, but it is a reason to read differently."
          >
            {row.responder_contributions} added before
          </span>
          {row.responded_at && (
            <>
              <span>·</span>
              <span>{when(row.responded_at)}</span>
            </>
          )}
          {row.neighborhood && (
            <>
              <span>·</span>
              <span>{slugLabel(row.neighborhood)}</span>
            </>
          )}
          {row.quality !== null && (
            <Badge tone={row.quality >= 4 ? "green" : row.quality >= 2 ? "gold" : "neutral"}>
              rated {row.quality}/5
            </Badge>
          )}
        </p>

        {/* 7.6 — the rating, separate from the decision. A reply can be genuinely
            useful and still be about something Pando already knows. */}
        <div className="mt-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
            How useful was it?
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5].map((q) => (
              <Button
                key={q}
                tone={row.quality === q ? "primary" : "secondary"}
                disabled={busy}
                title="Feeds their credits and tier. Separate from whether it goes into the graph."
                onClick={() =>
                  void run(`Rated ${q}/5.`, async () =>
                    adminAction({
                      action: "blast_response.rate",
                      blast_id: row.blast_id,
                      person_id: row.person_id,
                      quality: q,
                    }),
                  )
                }
              >
                {q}
              </Button>
            ))}
          </div>
        </div>

        {/* 7.9 — merge first, because merging is what makes a paid answer a
            validation rather than a duplicate. */}
        {row.merge_candidates.length > 0 && (
          <div className="mt-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
              Pando may already know this one
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {row.merge_candidates.map((c) => (
                <Button
                  key={c.share_id}
                  tone="secondary"
                  disabled={busy}
                  title={`Adds their experience to this record instead of creating a second one. ${c.firsthand_count} parent${c.firsthand_count === 1 ? "" : "s"} already on it.`}
                  onClick={() =>
                    void run("Added to the existing record.", async () =>
                      adminAction({
                        action: "blast_response.approve",
                        blast_id: row.blast_id,
                        person_id: row.person_id,
                        merge_into: c.share_id,
                      }),
                    )
                  }
                >
                  {c.name}
                  {c.firsthand_count > 0 && (
                    <span className="ml-1.5 text-[12px] text-muted">
                      ({c.firsthand_count})
                    </span>
                  )}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3">
          <label
            htmlFor={`name-${k}`}
            className="block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted"
          >
            Or add it as something new
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id={`name-${k}`}
              className={`${inputClass} min-w-[14rem] flex-1`}
              value={typed}
              onChange={(e) => setNames({ ...names, [k]: e.target.value.slice(0, 120) })}
              placeholder="What they recommended, as it should be listed"
            />
            <Button
              tone="primary"
              disabled={busy}
              title="Creates a record for a human to read again in the contributions queue — not straight into answers."
              onClick={() =>
                void run(
                  typed.trim()
                    ? "Added — it goes to the contributions queue next."
                    : "Marked as read. Nothing added to the graph.",
                  async () =>
                    adminAction({
                      action: "blast_response.approve",
                      blast_id: row.blast_id,
                      person_id: row.person_id,
                      ...(typed.trim() ? { share_name: typed.trim() } : {}),
                    }),
                )
              }
            >
              {typed.trim() ? "Add to Pando" : "Useful, nothing to add"}
            </Button>
            <Button
              tone="danger"
              disabled={busy}
              title="Takes it off the list and adds nothing."
              onClick={() =>
                void run("Set aside.", async () =>
                  adminAction({
                    action: "blast_response.reject",
                    blast_id: row.blast_id,
                    person_id: row.person_id,
                    reason: "not_useful",
                  }),
                )
              }
            >
              Not useful
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <>
      <PageHead
        title="What the network answered"
        intro="Replies to Network Asks. Rating one feeds their credits; approving one puts it in front of the contributions queue."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <NotConfigured demo={demo} onDemo={setDemo} />}
      {message && <ResultNote>{message}</ResultNote>}

      <div className="space-y-5">
        <Card title={`Waiting to be read (${waiting.length})`}>
          {loading && all.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
          ) : !configured && all.length === 0 ? (
            <NotConfigured demo={demo} onDemo={setDemo} />
          ) : waiting.length === 0 ? (
            <Empty
              title="Nothing waiting"
              body="Replies appear here as contributors answer a Network Ask."
            />
          ) : (
            <ul className="divide-y divide-bark/50">
              {waiting.map((r) => (
                <ResponseCard key={key(r)} row={r} />
              ))}
            </ul>
          )}
        </Card>

        {done.length > 0 && (
          <Card title={`Already read (${done.length})`}>
            <ul className="divide-y divide-bark/50">
              {done.map((r) => (
                <ResponseCard key={key(r)} row={r} />
              ))}
            </ul>
          </Card>
        )}
      </div>

      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
        Nothing here reaches an answer directly. A record created from a reply enters
        the contributions queue and is read again — this page judges the reply, not the
        claim about a place. A reply that names a caregiver adds nothing on its own:
        a caregiver only ever appears through her own consent.
      </p>
    </>
  );
}
