"use client";

import { cn } from "@/lib/cn";
import { PandoMark } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { TextAction } from "@/components/ui/TextAction";
import { recapRows } from "@/lib/seed-chat/engine";
import type { Script, Submission } from "@/lib/seed-chat/types";

export function Bubble({
  role,
  text,
  aside,
  skipped,
}: {
  role: "pando" | "parent";
  text?: string;
  aside?: string;
  skipped?: boolean;
}) {
  if (!text && !aside) return null;

  // A skipped step still belongs in the transcript — it shows the question was
  // asked and passed on — but it must not look like a control.
  if (skipped) {
    return (
      <div className="flex animate-rise justify-end">
        <span className="px-1 text-[13.5px] italic text-muted">Skipped</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex animate-rise",
        role === "parent" ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          // 86% is the phone rule. From md the column is wide enough that a
          // percentage would stretch one sentence across the whole window, so the
          // bubble takes a fixed reading measure instead.
          "max-w-[86%] md:max-w-[34rem] rounded-3xl px-4 py-2.5 text-[15.5px] leading-snug",
          role === "parent"
            ? "rounded-br-lg bg-green-deep text-white"
            : "rounded-bl-lg border border-bark bg-card text-ink",
        )}
      >
        {text}
        {aside && (
          <span
            className={cn(
              "mt-1.5 block text-[13.5px] leading-snug",
              role === "parent" ? "text-white/70" : "text-muted",
            )}
          >
            {aside}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Purely visual.
 *
 * This used to carry `aria-live="polite"` and `aria-label="Pando is typing"`,
 * which reads as the right thing and does not work: a live region has to be in
 * the document *before* its content changes, and this one mounts together with
 * the only content it will ever have. The announcement it was meant to make now
 * comes from the stable region in `ChatSeeding`, which is always present and
 * carries what Pando actually said — so the dots are decoration.
 */
export function TypingDots() {
  return (
    <div className="flex animate-fade justify-start" aria-hidden="true">
      <div className="rounded-3xl rounded-bl-lg border border-bark bg-card px-4 py-3">
        <span className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-green"
              style={{ animation: "dot-tick 1.3s ease-in-out infinite", animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

/**
 * The proof that a friendly chat produced structured data: every finished card
 * plays back as labelled fields, exactly as they'll be stored.
 */
export function CardRecap({
  submission,
  script,
  held,
  onRetry,
  onEditField,
}: {
  submission: Submission;
  script: Script;
  /**
   * True on the founding path, where the card waits on this device until the parent
   * confirms a code. False on the anonymous path, where it was posted as soon as it
   * was finished — so "kept on this phone until you finish" would be describing
   * something that already left.
   */
  held?: boolean;
  onRetry?: () => void;
  /** Tap a row to correct that one answer. Omitted while a card is open. */
  onEditField?: (field: string) => void;
}) {
  const rows = recapRows(script, submission.fields);
  /* Every field name in this card belongs to a script we no longer have — it was
     filled in before an update. An empty card reads as broken, so say what it is. */
  const fromAnOlderVersion = rows.length === 0;

  /* The chat recap is the same box as any raised flow panel; what makes it a
     recap is the green-wash header and the divided rows inside it. */
  return (
    <Panel raised flush className="animate-rise">
      <div className="flex items-center gap-2 border-b border-bark/70 bg-green-wash px-4 py-2.5">
        <PandoMark className="h-4" />
        <span className="text-[13px] font-semibold uppercase tracking-[0.09em] text-green-deep">
          {script.label} · saved
        </span>
      </div>

      <dl className="divide-y divide-bark/60">
        {rows.map((row) => (
          <div key={row.field} className="flex items-start gap-3 px-4 py-2.5">
            <dt className="w-[6.5rem] shrink-0 pt-[2px] text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {row.label}
            </dt>
            <dd className="min-w-0 flex-1 text-[15px] leading-snug">{row.value}</dd>
            {onEditField && (
              <TextAction
                tone="quiet"
                underline={false}
                onClick={() => onEditField(row.field)}
                aria-label={`Edit ${row.label.toLowerCase()}`}
                className="-my-1 -mr-1 shrink-0 px-2"
              >
                Edit
              </TextAction>
            )}
          </div>
        ))}
      </dl>

      {fromAnOlderVersion && (
        <p className="border-t border-bark/70 px-4 py-3 text-[13.5px] leading-snug text-muted">
          You filled this in before an update, so we can&apos;t show it back to you
          here. It&apos;s still on this phone, and still counts.
        </p>
      )}

      {submission.kind === "caregiver" && (
        <p className="border-t border-gold-line bg-gold-wash px-4 py-3 text-[13.5px] leading-snug text-gold-ink">
          Pending their consent. Nobody sees this person on Pando until they say
          yes themselves — and Pando never claims they&apos;re vetted.
        </p>
      )}

      {!submission.persisted && (
        <div className="flex items-center justify-between gap-3 border-t border-bark/70 px-4 py-2.5">
          {/* Precise, because the old wording ("saved on this phone only") next to a
              "N shared" counter read as though nothing had been sent. */}
          <span className="text-[13px] text-muted">
            {submission.error
              ? "Didn't reach Pando — kept on this phone."
              : held
                ? "Kept on this phone until you finish."
                : "Received. Not in the network yet — a person reads it first."}
          </span>
          {/* Was `h-9` — a 36px target, the smallest in the chat, on the one
              control a parent reaches for after something already failed. */}
          {onRetry && (
            <TextAction underline={false} onClick={onRetry} className="px-3">
              Try again
            </TextAction>
          )}
        </div>
      )}
    </Panel>
  );
}
