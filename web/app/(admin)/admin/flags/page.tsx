"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  inputClass,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { FIELD_LABEL, flagMeaning, flagTitle, sentence } from "@/lib/admin/labels";
import type { FlagRow } from "@/lib/admin/types";

/**
 * Estimate 2.7 — the review queue.
 *
 * Two sections, on purpose: a serious claim about a named person is not an item
 * in a moderation list, so it sits at the top. A safety claim buried among "this
 * note is a bit thin" is a safety claim nobody reads.
 *
 * ## Why the card looks like this (19 Aug, second pass)
 *
 * The first rebuild fixed *what* was on the card — it had been showing the review
 * pass's reasoning styled as a quotation and never the parent's actual words. The
 * client's next answer was that the page was still hard to take in, and they were
 * right for three reasons, all of them repetition:
 *
 *  - **it explained itself twice.** Each card printed the specific stored reason
 *    *and* a generic paragraph about that kind of flag. Now: the specific one, or
 *    the generic one when there is no specific one, never both. The generic
 *    sentence lives on the heading's tooltip instead of taking up space.
 *  - **the same instruction, twelve times.** "Saved with your name, visible to
 *    admins only" was under every note box. It is true once, at the top.
 *  - **nothing was scannable.** Every card was a stack of six labelled blocks, so
 *    twelve of them had no shape. The card is now four lines: what and where, the
 *    words, why in one line, and one row of controls.
 *
 * What did not move: the parent's own text is still the biggest thing on the card,
 * because reading it *is* the task, and it is still shown field by field so two
 * answers never read as one sentence.
 */
export default function FlagsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<FlagRow[]>("flags", { status: "open" });

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const open = (rows ?? []).filter((r) => r.status === "open");
  const urgent = useMemo(
    () => open.filter((r) => r.severity === "escalation"),
    [open],
  );
  const rest = useMemo(
    () => open.filter((r) => r.severity !== "escalation"),
    [open],
  );

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

  function FlagCard({ flag }: { flag: FlagRow }) {
    const note = notes[flag.id] ?? "";
    const isQuestion = flag.subject?.kind === "demand_signal";
    const wrote = flag.subject?.wrote ?? [];
    /* One reason, never two. The specific sentence if the review pass wrote one,
       otherwise the general meaning of this kind of flag. */
    const why = flag.excerpt || flagMeaning(flag.reason);

    return (
      <li className="px-4 py-4">
        {/* One line: what it is, and where it came from. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3
            className="text-[14.5px] font-semibold text-ink"
            title={flagMeaning(flag.reason) ?? undefined}
          >
            {flagTitle(flag.reason)}
          </h3>
          {/* Three bare values separated by dots left it to the reader to work
              out which was the class and which was the parent. One word fixes
              it, and only the ambiguous one is labelled. */}
          <p className="text-[12.5px] text-muted">
            {[
              flag.subject?.title || null,
              flag.contributor?.name ? `from ${flag.contributor.name}` : null,
              when(flag.created_at),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* The words. The per-answer field label sits under each quote, not over
            it, so the eye lands on what the parent said first — but the block as
            a whole is named, because otherwise nothing on the card says whose
            words these are. */}
        {wrote.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
              {isQuestion ? "What they asked" : "What they wrote"}
            </p>
            <div className="mt-1 space-y-1.5">
              {wrote.map((w) => (
                <div key={w.field}>
                  <p className="text-[15px] leading-relaxed text-ink">
                    “{w.body}”
                  </p>
                  {!isQuestion && (
                    <p className="text-[11.5px] text-muted">
                      {FIELD_LABEL[w.field] ?? sentence(w.field)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[13.5px] text-muted">
            They wrote nothing — this came from what they tapped
            {flag.field
              ? `, on ${FIELD_LABEL[flag.field] ?? sentence(flag.field)}`
              : ""}
            .
          </p>
        )}

        {why && (
          <div className="mt-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
              Why it came up
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-relaxed text-ink-soft">
              <span>{why}</span>
              {flag.confidence !== null && <Usefulness value={flag.confidence} />}
            </p>
          </div>
        )}

        {/**
         * A real label, not a placeholder.
         *
         * The compaction pass replaced this heading with a placeholder and an
         * `aria-label`, which reads as tidy and is not: a placeholder vanishes
         * the moment somebody types, so the one moment you might want to check
         * what the box is for is the moment the answer disappears. The client
         * had asked for this field to be named, twice.
         */}
        <div className="mt-3">
          <label
            htmlFor={`note-${flag.id}`}
            className="block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted"
          >
            Admin comment
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id={`note-${flag.id}`}
              className={`${inputClass} min-w-[12rem] flex-1`}
              value={note}
              onChange={(e) =>
                setNotes({ ...notes, [flag.id]: e.target.value.slice(0, 300) })
              }
              placeholder="What you decided, and why"
            />
            <Button
              tone="primary"
              disabled={busy}
              title="Saves your comment and takes this off the list"
              onClick={() =>
                void run("Marked as read.", async () =>
                  adminAction({
                    action: "flag.resolve",
                    id: flag.id,
                    note: note.trim() || null,
                  }),
                )
              }
            >
              I&apos;ve read it
            </Button>
            {flag.severity !== "escalation" && (
              <Button
                tone="danger"
                disabled={busy}
                title="Saves your comment and moves this to the top of the page"
                onClick={() =>
                  void run("Moved to the top.", async () =>
                    adminAction({
                      action: "flag.escalate",
                      id: flag.id,
                      note: note.trim() || null,
                    }),
                  )
                }
              >
                Needs attention
              </Button>
            )}
          </div>
        </div>
      </li>
    );
  }

  return (
    <>
      <PageHead
        title="Flags"
        intro="What a parent wrote, for you to read before Pando uses it. Your notes stay between admins."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      <div className="space-y-5">
        <Card
          title={`Needs a person today (${urgent.length})`}
          className={urgent.length > 0 ? "border-alert-line" : undefined}
        >
          {loading && open.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted">
              Loading…
            </div>
          ) : !configured && open.length === 0 ? (
            <NotConfigured demo={demo} onDemo={setDemo} />
          ) : urgent.length === 0 ? (
            <Empty title="Nothing urgent" body="This is the one you want empty." />
          ) : (
            <ul className="divide-y divide-bark/50">
              {urgent.map((flag) => (
                <FlagCard key={flag.id} flag={flag} />
              ))}
            </ul>
          )}
        </Card>

        <Card title={`When you have a minute (${rest.length})`}>
          {rest.length === 0 ? (
            <Empty title="Nothing waiting" />
          ) : (
            <ul className="divide-y divide-bark/50">
              {rest.map((flag) => (
                <FlagCard key={flag.id} flag={flag} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * How much another parent could act on the text — a word first, the number
 * second, and coloured, because the number alone said nothing about whether to
 * act. The bands match the ones the contributions queue sorts on.
 */
function Usefulness({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const band =
    value < 0.4
      ? { label: "Thin", tone: "red" as const }
      : value < 0.6
        ? { label: "Some use", tone: "gold" as const }
        : value < 0.85
          ? { label: "Useful", tone: "neutral" as const }
          : { label: "Very useful", tone: "green" as const };

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Badge tone={band.tone}>{band.label}</Badge>
      <span className="text-[12px] tabular-nums text-muted">{pct}%</span>
    </span>
  );
}
