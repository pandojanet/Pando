"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  inputClass,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { FlagRow } from "@/lib/admin/types";

/**
 * Estimate 2.7 — flags and escalations.
 *
 * Two queues, on purpose. Serious allegations about a named person are not an item in
 * a moderation list; they get their own channel at the top of the page, because a
 * safety claim buried among typo fixes is a safety claim nobody reads.
 *
 * The flagged text is shown here and only here. It is never published verbatim to a
 * parent, whatever the outcome.
 */
export default function FlagsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<FlagRow[]>("flags", { status: "open" });

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const open = (rows ?? []).filter((r) => r.status === "open");
  const escalations = useMemo(() => open.filter((r) => r.severity === "escalation"), [open]);
  const reviews = useMemo(() => open.filter((r) => r.severity !== "escalation"), [open]);

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted ? `${label} — done.` : `${label} — not stored (no admin_write hook).`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  function FlagCard({ flag }: { flag: FlagRow }) {
    const note = notes[flag.id] ?? "";
    return (
      <li className="px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={flag.severity === "escalation" ? "red" : "gold"}>
                {slugLabel(flag.severity)}
              </Badge>
              <span className="text-[14.5px] font-semibold">{flag.reason}</span>
              <ConfidenceBadge value={flag.confidence} />
            </p>
            <p className="mt-1.5 text-[13.5px] text-muted">
              {flag.subject
                ? `${slugLabel(flag.subject.kind)} · ${flag.subject.title}`
                : "no subject"}
              {flag.field ? ` · field: ${flag.field}` : ""}
              {flag.contributor?.name ? ` · from ${flag.contributor.name}` : ""}
              {` · ${when(flag.created_at)}`}
            </p>
            {/* Shown to an admin only. Never rendered in a parent-facing answer. */}
            <blockquote className="mt-2 border-l-2 border-bark pl-3 text-[13.5px] italic text-ink-soft">
              {flag.excerpt}
            </blockquote>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
              What you decided
            </span>
            <input
              className={`${inputClass} mt-1`}
              value={note}
              onChange={(e) => setNotes({ ...notes, [flag.id]: e.target.value.slice(0, 300) })}
              placeholder="Recorded with your name"
            />
          </label>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() =>
              void run("Resolved", async () =>
                adminAction({ action: "flag.resolve", id: flag.id, note: note.trim() || null }),
              )
            }
          >
            Resolve
          </Button>
          {flag.severity !== "escalation" && (
            <Button
              tone="danger"
              disabled={busy}
              onClick={() =>
                void run("Escalated", async () =>
                  adminAction({ action: "flag.escalate", id: flag.id, note: note.trim() || null }),
                )
              }
            >
              Escalate
            </Button>
          )}
        </div>
      </li>
    );
  }

  return (
    <>
      <PageHead
        title="Flags"
        intro="Raised automatically from free text (estimate 1.9), tuned to over-flag rather than miss anything. Nothing here is ever shown to a parent word for word."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && (
        <div className="mb-4 rounded-xl border border-green/25 bg-green-wash px-4 py-2.5 text-[13.5px] font-medium text-green-deep">
          {message}
        </div>
      )}

      <div className="space-y-5">
        <Card
          title={`Escalations (${escalations.length})`}
          className={escalations.length > 0 ? "border-alert-line" : undefined}
          right={
            <span className="text-[12px] text-muted">
              safety claims about a named person — handle first
            </span>
          }
        >
          {loading && open.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
          ) : !configured && open.length === 0 ? (
            <NotConfigured demo={demo} onDemo={setDemo} />
          ) : escalations.length === 0 ? (
            <Empty title="Nothing escalated" body="This is the queue you want empty." />
          ) : (
            <ul className="divide-y divide-bark/50">
              {escalations.map((flag) => (
                <FlagCard key={flag.id} flag={flag} />
              ))}
            </ul>
          )}
        </Card>

        <Card title={`To review (${reviews.length})`}>
          {reviews.length === 0 ? (
            <Empty title="Nothing waiting" />
          ) : (
            <ul className="divide-y divide-bark/50">
              {reviews.map((flag) => (
                <FlagCard key={flag.id} flag={flag} />
              ))}
            </ul>
          )}
        </Card>

        <p className="text-[12.5px] leading-relaxed text-muted">
          A negative claim about a named person can affect whether that person is
          surfaced at all, but it never becomes text a parent reads. Low-confidence
          extractions live on the{" "}
          <a
            href="/admin/activities?confidence=low"
            className="font-semibold text-green-deep underline underline-offset-2"
          >
            activities page
          </a>{" "}
          — that queue is what improves the extraction prompt.
        </p>
      </div>
    </>
  );
}
