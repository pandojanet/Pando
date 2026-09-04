"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextAction } from "@/components/ui/TextAction";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { cn } from "@/lib/cn";
import { PhoneField } from "@/components/ui/PhoneField";
import { AGE_OPTIONS } from "@/lib/questions";
import { formatPhone, toE164 } from "@/lib/phone";
import { progressOf } from "@/lib/seed-chat/engine";
import type { FieldValue, Fields, Script, Step } from "@/lib/seed-chat/types";

/**
 * The embedded widget for the current step, rendered in the dock.
 *
 * One widget per step, always in the same place, always thumb-reachable — so the
 * parent never hunts for where to answer. Mount this with a key of
 * `draftId + step.id` so its local state resets between steps.
 */
export function StepWidget({
  step,
  script,
  fields,
  stepIndex,
  canUndo,
  editing,
  initialValue,
  onAnswer,
  onSkip,
  onUndo,
}: {
  step: Step;
  script: Script;
  fields: Fields;
  stepIndex: number;
  canUndo: boolean;
  /** Correcting one answer on a finished card — not walking the script. */
  editing?: boolean;
  /** The answer already on record, so a correction starts from it. */
  initialValue?: FieldValue;
  onAnswer: (value: FieldValue) => void;
  onSkip: () => void;
  onUndo: () => void;
}) {
  const { current, total } = progressOf(script, fields, stepIndex);

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">
          {editing
            ? `${script.label} · fixing one answer`
            : `${script.label} · ${current} of ${total}`}
        </span>
        {canUndo && (
          <TextAction
            tone="quiet"
            underline={false}
            onClick={onUndo}
            className="-mr-2 px-2"
          >
            Change last answer
          </TextAction>
        )}
      </div>

      {/*
        The question again, in the dock, right above the answer.

        It is already in the transcript — and that is the problem: the bubble
        scrolls away the moment the keyboard opens or the option list is long, so
        the parent is left tapping chips with the question off-screen. Repeating
        it here costs one line and removes the "what was I answering?" scroll.
      */}
      <p className="mb-2.5 text-[15px] font-semibold leading-snug text-ink">
        {step.prompt}
      </p>
      {step.aside && (
        <p className="mb-2.5 -mt-1 text-[13px] leading-snug text-muted">
          {step.aside}
        </p>
      )}

      <Widget
        step={step}
        initialValue={initialValue}
        onAnswer={onAnswer}
        onSkip={onSkip}
      />
    </div>
  );
}

function Widget({
  step,
  initialValue,
  onAnswer,
  onSkip,
}: {
  step: Step;
  initialValue?: FieldValue;
  onAnswer: (value: FieldValue) => void;
  onSkip: () => void;
}) {
  switch (step.widget) {
    case "quick":
      // One tap answers, so there is no state to seed — the parent just picks again.
      return <QuickReplies step={step} onAnswer={onAnswer} />;
    case "chips":
      return (
        <MultiSelect
          step={step}
          initial={initialValue}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      );
    case "ages":
      return (
        <AgePicker
          step={step}
          initial={initialValue}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      );
    case "text":
      return (
        <ShortText
          step={step}
          initial={initialValue}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      );
    case "name":
      return <NameFields initial={initialValue} onAnswer={onAnswer} />;
    case "phone":
      return (
        <PhoneEntry
          step={step}
          initial={initialValue}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      );
  }
}

/** Previous answers seed a correction; a fresh step starts empty. */
function initialList(initial: FieldValue | undefined): string[] {
  return Array.isArray(initial) ? initial.map(String) : [];
}

function initialText(initial: FieldValue | undefined): string {
  return typeof initial === "string" ? initial : "";
}

/* ── Widgets ──────────────────────────────────────────────────────── */

function QuickReplies({
  step,
  onAnswer,
}: {
  step: Step;
  onAnswer: (value: FieldValue) => void;
}) {
  return (
    <Scroller>
      <ChipGroup
        groupLabel={step.prompt}
        mode="single"
        options={step.options ?? []}
        selected={[]}
        onChange={(next) => {
          if (next[0]) onAnswer(next[0]);
        }}
      />
    </Scroller>
  );
}

function MultiSelect({
  step,
  initial,
  onAnswer,
  onSkip,
}: {
  step: Step;
  initial?: FieldValue;
  onAnswer: (value: FieldValue) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => initialList(initial));
  return (
    <>
      <Scroller tight>
        <ChipGroup
          groupLabel={step.prompt}
          mode="multi"
          options={step.options ?? []}
          selected={selected}
          onChange={setSelected}
        />
      </Scroller>
      <Actions
        step={step}
        ready={selected.length > 0}
        onSubmit={() => onAnswer(selected)}
        onSkip={onSkip}
      />
    </>
  );
}

function AgePicker({
  step,
  initial,
  onAnswer,
  onSkip,
}: {
  step: Step;
  initial?: FieldValue;
  onAnswer: (value: FieldValue) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => initialList(initial));
  return (
    <>
      <Scroller tight>
        <ChipGroup
          groupLabel={step.prompt}
          mode="multi"
          layout="grid"
          options={AGE_OPTIONS}
          selected={selected}
          onChange={setSelected}
        />
      </Scroller>
      <Actions
        step={step}
        ready={selected.length > 0}
        onSubmit={() =>
          onAnswer(selected.map(Number).sort((a, b) => a - b))
        }
        onSkip={onSkip}
      />
    </>
  );
}

function ShortText({
  step,
  initial,
  onAnswer,
  onSkip,
}: {
  step: Step;
  initial?: FieldValue;
  onAnswer: (value: FieldValue) => void;
  onSkip: () => void;
}) {
  const [value, setValue] = useState(() => initialText(initial));
  const max = step.maxLength ?? 400;
  const trimmed = value.trim();

  return (
    <>
      {/* The prompt is the label: it is the bubble the parent just read, so a
          second visible copy would be the screen repeating itself. */}
      <Field
        label={step.prompt}
        labelHidden
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, max))}
        enterKeyHint="enter"
        placeholder={step.placeholder}
      />
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="text-[12px] text-muted">
          {value.length > max * 0.7 ? `${value.length}/${max}` : " "}
        </span>
      </div>
      <Actions
        step={step}
        ready={trimmed.length > 0}
        submitLabel="Send"
        onSubmit={() => onAnswer(trimmed)}
        onSkip={onSkip}
      />
    </>
  );
}

function NameFields({
  initial: previous,
  onAnswer,
}: {
  initial?: FieldValue;
  onAnswer: (value: FieldValue) => void;
}) {
  const [prevFirst, prevInitial] = initialList(previous);
  const [first, setFirst] = useState(prevFirst ?? "");
  const [initial, setInitial] = useState(prevInitial ?? "");

  return (
    <>
      <div className="flex gap-2">
        <Field
          label="Caregiver first name"
          labelHidden
          className="min-w-0 flex-1"
          value={first}
          onChange={(e) => setFirst(e.target.value.slice(0, 30))}
          placeholder="First name"
          autoComplete="off"
          enterKeyHint="next"
        />
        <Field
          label="Caregiver last initial"
          labelHidden
          className="w-[4.5rem]"
          value={initial}
          onChange={(e) =>
            setInitial(e.target.value.replace(/[^\p{L}]/gu, "").slice(0, 1).toUpperCase())
          }
          placeholder="R"
          align="center"
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>
      <Button
        full
        className="mt-3"
        disabled={first.trim().length === 0}
        onClick={() => onAnswer([first.trim(), initial])}
      >
        Send
      </Button>
    </>
  );
}

function PhoneEntry({
  step,
  initial,
  onAnswer,
  onSkip,
}: {
  step: Step;
  initial?: FieldValue;
  onAnswer: (value: FieldValue) => void;
  onSkip: () => void;
}) {
  const [phone, setPhone] = useState(() => formatPhone(initialText(initial)));
  const e164 = toE164(phone);

  return (
    <>
      <PhoneField
        id="caregiver-phone"
        label="Their mobile number"
        value={phone}
        onChange={setPhone}
      />
      <Actions
        step={step}
        ready={e164 !== null}
        onSubmit={() => onAnswer(e164 ?? "")}
        onSkip={onSkip}
      />
    </>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────── */

/**
 * Long option lists scroll inside the dock instead of pushing it off-screen.
 * Capped in rem as well as dvh — a dvh-only cap is comfortable at 844 and
 * suffocating at 640 — and capped tighter when the step also needs a
 * Skip/Continue row, so the dock never takes much more than half the screen.
 */
function Scroller({
  children,
  tight,
}: {
  children: React.ReactNode;
  tight?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /**
   * There is no scrollbar (deliberately — it looks like a defect inside a chip
   * list), so an overflowing list had no affordance at all: on the age-band step
   * the fifth option was clipped by 8px and read as a rendering glitch rather than
   * "there is more". This fades the bottom edge whenever content remains, and
   * removes it at the end of the list, so the cue is never a lie.
   */
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [children]);

  return (
    <div className="relative">
      <div
        ref={ref}
        className={cn(
          "no-scrollbar overflow-y-auto overscroll-contain",
          // The cap is a phone constraint: the dock is sticky there and must not eat
          // the transcript. From `md` the answer area sits in page flow, so the list
          // simply grows and the page scrolls — no box inside a box.
          "md:max-h-none md:overflow-visible",
          tight ? "max-h-[min(26dvh,13rem)]" : "max-h-[min(32dvh,15rem)]",
        )}
      >
        {children}
      </div>
      {moreBelow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-card to-transparent md:hidden"
        />
      )}
    </div>
  );
}

function Actions({
  step,
  ready,
  onSubmit,
  onSkip,
  submitLabel = "Continue",
}: {
  step: Step;
  ready: boolean;
  onSubmit: () => void;
  onSkip: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="mt-3 flex gap-2">
      {step.optional && (
        <Button variant="secondary" onClick={onSkip}>
          {/* "Nothing comes to mind" is an answer to the caveat question, not a
              skipped one — the wording comes from the step. */}
          {step.skipLabel ?? "Skip"}
        </Button>
      )}
      <Button full disabled={!ready} onClick={onSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}
