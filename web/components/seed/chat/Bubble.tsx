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
  onToggleName,
  firstName,
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
  /**
   * The client's per-recommendation name toggle (10 Sep). Omitted while a card
   * is open, like `onEditField`, and omitted on a caregiver card — that one is
   * about a named person and its own panel already says who sees what.
   */
  onToggleName?: (next: boolean) => void;
  /** The parent's first name, so the control can show what turning it on means. */
  firstName?: string | null;
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

      {onToggleName && submission.kind !== "caregiver" && (
        /**
         * ⚠ **Per recommendation, and off unless it is on** (10 Sep).
         *
         * The old model was one standing answer on the privacy screen, and the
         * client's note is what it cost: the flow offered *"Use my first name"*
         * and then promised, one screen later, that a name is never shown. Both
         * could not be true. A parent is willing to be named on the swim class
         * and not on the therapist, so the decision belongs here — beside the
         * one recommendation it is about, after they have seen what it says.
         *
         * The sentence names the consequence rather than the setting: "Show my
         * first name" is a switch, *"Janet recommends this"* is what another
         * parent reads.
         */
        <div className="flex items-start gap-3 border-t border-bark/70 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">
              {submission.show_name
                ? "Your first name can appear on this"
                : "Your name stays private on this"}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">
              {/**
                * ⚠ **"can appear", not "will"** — and the difference is a fact
                * about the composer rather than hedging. A name is attached to
                * the sentence the parent wrote, or to the evidence line where
                * they are the only parent behind the record; on a record three
                * families have used, an answer says *three* rather than naming
                * one of them. So permission granted is not appearance
                * guaranteed, which is the same shape as every other consent
                * here — a caregiver may consent and still not be surfaced.
                *
                * The earlier wording promised a literal sentence Pando does not
                * send (*"Janet recommends this."*), which is the client's own
                * example rather than the composed answer. Quoting copy the
                * product cannot produce is exactly the contradiction she caught
                * between this screen and the privacy screen.
                */}
              {submission.show_name
                ? `Answers can say “${firstName ?? "your first name"} said …” or “${firstName ?? "your first name"} has used …”.`
                : "Answers say a local parent, never who. The recommendation is shared either way."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={submission.show_name === true}
            aria-label="Show my first name on this recommendation"
            onClick={() => onToggleName(!submission.show_name)}
            className={
              submission.show_name
                ? "min-h-11 shrink-0 rounded-full border border-green bg-green-wash px-3.5 text-[13.5px] font-semibold text-green-deep"
                : "min-h-11 shrink-0 rounded-full border border-bark px-3.5 text-[13.5px] font-medium text-ink-soft"
            }
          >
            {submission.show_name ? "On" : "Off"}
          </button>
        </div>
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
