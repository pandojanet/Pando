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
import { Quote, RecordGroup } from "@/components/admin/Record";
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
 *    the generic one when there is no specific one, never both.
 *  - **the same instruction, twelve times.** "Saved with your name, visible to
 *    admins only" was under every note box. It is true once, at the top.
 *  - **nothing was scannable.** Every card was a stack of six labelled blocks, so
 *    twelve of them had no shape.
 *
 * What did not move: the parent's own text is still the biggest thing on the card,
 * because reading it *is* the task, and it is still shown field by field so two
 * answers never read as one sentence.
 *
 * ## 2 Sep — the third pass, and the same fault one level out
 *
 * Walked in a browser, and the repetition was back — not because that pass was
 * undone, but because it was per-card and the duplication is not. "The specific
 * reason, or the generic one" is right for one card and still means that when no
 * specific reason exists, **the identical paragraph appears on all twelve**, with
 * the identical heading above it. On the demo cohort that is exactly what
 * happened: five cards reading "Health, legal or safety question" over five
 * copies of the same sentence.
 *
 * So the flags are grouped by reason and the reason is stated **once, in the
 * group's heading** (`RecordGroup`). What is left on a card is what differs
 * between cards: the words the parent wrote, which specific record they are on,
 * and the controls. It also makes the page answer a question it could not
 * before — "how many of these are the same thing?" — at a glance.
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

    return (
      <article className="px-4 py-3.5">
        {/* Which record this is on, and who it came from. The *kind* of flag is
            no longer here — it is the group heading above, once. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {/**
           * An empty `subject.title` is not a missing record — the type says
           * so: *"Empty for a question, which is its own text."* Two wrong
           * answers were tried before this one, and both are worth recording
           * because they are the two obvious ones. Printing "No record
           * attached" states something false on every flag raised from a demand
           * signal, which is the entire urgent section. Printing the *kind*
           * instead ("A question a parent asked") is true and useless: the group
           * heading above already says what these are, so it was the same
           * duplication this pass removed, reappearing one level down.
           *
           * So the line appears only when it **identifies** something. A flag
           * with no subject at all is the one case worth saying out loud, since
           * that is odd data rather than an ordinary question.
           */}
          {flag.subject?.title ? (
            <p className="text-[13.5px] font-semibold text-ink">
              {flag.subject.title}
            </p>
          ) : !flag.subject ? (
            <p className="text-[13.5px] text-muted">No record attached</p>
          ) : (
            <span />
          )}
          <p className="text-[12.5px] text-muted">
            {[
              flag.contributor?.name ? `from ${flag.contributor.name}` : null,
              when(flag.created_at),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {/* The words — the reason this page exists. Field by field, so two
            answers never read as one sentence. */}
        {wrote.length > 0 ? (
          <div className="mt-2.5 space-y-2">
            {wrote.map((w) => (
              <Quote
                key={w.field}
                label={
                  isQuestion
                    ? "What they asked"
                    : (FIELD_LABEL[w.field] ?? sentence(w.field))
                }
              >
                “{w.body}”
              </Quote>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted">
            They wrote nothing — this came from what they tapped
            {flag.field
              ? `, on ${FIELD_LABEL[flag.field] ?? sentence(flag.field)}`
              : ""}
            .
          </p>
        )}

        {/* Only the *specific* reason the review pass wrote, if it wrote one.
            The generic meaning of this kind of flag is in the group heading, so
            printing it here would be the duplication this pass removed. */}
        {(flag.excerpt || flag.confidence !== null) && (
          <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-relaxed text-muted">
            {flag.excerpt && <span>{flag.excerpt}</span>}
            {flag.confidence !== null && <Usefulness value={flag.confidence} />}
          </p>
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
            className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-muted"
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
      </article>
    );
  }

  /** The flags of one section, in runs that share a reason. */
  function Grouped({ flags }: { flags: FlagRow[] }) {
    return (
      <>
        {groupByReason(flags).map((group) => (
          <RecordGroup
            key={group.reason}
            title={flagTitle(group.reason)}
            count={group.flags.length}
            meaning={flagMeaning(group.reason)}
          >
            {group.flags.map((flag) => (
              <FlagCard key={flag.id} flag={flag} />
            ))}
          </RecordGroup>
        ))}
      </>
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
            <Grouped flags={urgent} />
          )}
        </Card>

        <Card title={`When you have a minute (${rest.length})`}>
          {rest.length === 0 ? <Empty title="Nothing waiting" /> : <Grouped flags={rest} />}
        </Card>
      </div>
    </>
  );
}

/**
 * Flags in runs that share a reason, biggest run first.
 *
 * Order is by size rather than by time because the question this grouping
 * answers is "what is going on here" — five copies of one thing is one problem
 * to work through, and a single outlier below them is a second. Inside a run
 * the server's order (newest first) is untouched.
 */
function groupByReason(flags: FlagRow[]): Array<{ reason: string; flags: FlagRow[] }> {
  const byReason = new Map<string, FlagRow[]>();
  for (const flag of flags) {
    const existing = byReason.get(flag.reason);
    if (existing) existing.push(flag);
    else byReason.set(flag.reason, [flag]);
  }
  return [...byReason.entries()]
    .map(([reason, list]) => ({ reason, flags: list }))
    .sort((a, b) => b.flags.length - a.flags.length);
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
