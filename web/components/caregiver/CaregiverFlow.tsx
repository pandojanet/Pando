"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { TextAction } from "@/components/ui/TextAction";
import { Note } from "@/components/ui/Note";
import { Field } from "@/components/ui/Field";
import { Consent } from "@/components/ui/Consent";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { PhoneField } from "@/components/ui/PhoneField";
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import {
  Container,
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { Wordmark } from "@/components/ui/Logo";
import { Progress } from "@/components/ui/Progress";
import {
  CAREGIVER_CONSENT_TEXT,
  SMS_CONSENT_AGREEMENT,
  SMS_CONSENT_TERMS,
} from "@/lib/consent";
import {
  EMPTY_CAREGIVER_ANSWERS,
  SINGLE_KEYS,
  caregiverSteps,
  selectionsFor,
  type CaregiverAnswers,
  type TapKey,
} from "@/lib/caregiver-flow";
import { isPhoneComplete, toE164 } from "@/lib/phone";
import { useMarketOptions } from "@/lib/use-market-options";
import { useStepChange } from "@/lib/use-step-change";
import type { MarketId } from "@/lib/types";

/**
 * 2C — the caregiver's own flow (G1–G10).
 *
 * A second surface, not an extension of the Seed Tool, and the difference is the
 * reader: a parent arrives wanting to help, a caregiver arrives wanting to know who
 * is going to see this. So the order is consent first, questions second, and the
 * last screen is honest that answering all of it lists them nowhere by itself.
 *
 * Three rules this file keeps:
 *
 *  - **It shows them nothing a family said.** No nomination, no chosen strengths,
 *    and above all no private note or hesitant "why" (invariant 12). This flow
 *    reads from the parent side at all — not filtered, not summarised, not at all.
 *  - **Nothing is stored until the code is confirmed** (invariant 11). The answers
 *    live in this component until the OTP screen, exactly like the parent flow, and
 *    the write route refuses them without a verified cookie regardless.
 *  - **Every permission is asked separately**, and the flow can be finished with all
 *    three refused. That is a real outcome — a profile that exists and is visible to
 *    nobody — and it is the one the copy promises.
 */

type Stage = "intro" | "identity" | "tap" | "permissions" | "verify" | "done";

export function CaregiverFlow({ market }: { market: MarketId }) {
  /* The areas-served chips are `market_options` neighborhoods, same as the
     parent's — so this rebuilds when that table loads. */
  const optionsVersion = useMarketOptions(market);
  const steps = useMemo(() => caregiverSteps(market), [market, optionsVersion]);
  const [answers, setAnswers] = useState<CaregiverAnswers>(
    EMPTY_CAREGIVER_ANSWERS,
  );
  const [stage, setStage] = useState<Stage>("intro");
  const [tapIndex, setTapIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  /* Every screen a caregiver actually walks: intro, identity, the tap steps,
     the three permissions, the code. `done` and the declined ending are not
     steps — they are where the flow stops. */
  const totalSteps = 4 + steps.length;
  const stepIndex =
    stage === "intro"
      ? 0
      : stage === "identity"
        ? 1
        : stage === "tap"
          ? 2 + tapIndex
          : stage === "permissions"
            ? 2 + steps.length
            : 3 + steps.length;

  /**
   * ⚠ This flow had **no** `useEffect` and no `window.scrollTo` at all, so
   * advancing opened the next screen at the previous one's scroll offset — the
   * most visible defect in the caregiver flow, and invisible in review because
   * the file looks complete on its own. `useStepChange` also moves focus to the
   * heading, which neither flow did.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useStepChange(`${stage}:${tapIndex}`, headingRef);

  const set = <K extends keyof CaregiverAnswers>(
    key: K,
    value: CaregiverAnswers[K],
  ) => setAnswers((a) => ({ ...a, [key]: value }));

  function setTap(key: TapKey, next: string[]) {
    /* Single-select keys store the id itself, not a one-element array — the
       database column is text, and unwrapping here keeps the payload honest. */
    if (SINGLE_KEYS.has(key)) {
      set(key as "drives", next[0] ?? null);
      return;
    }
    set(key as "roles_wanted", next);
  }

  const e164 = toE164(answers.phone);
  const identityReady =
    answers.first_name.trim().length > 0 &&
    isPhoneComplete(answers.phone) &&
    answers.sms_consent;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/caregiver/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...answers, phone: e164 ?? answers.phone }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(body?.error ?? "That didn't go through.");
        return;
      }
      setStage("done");
    } catch {
      setError("We couldn't reach Pando just now. Nothing was sent.");
    } finally {
      setSaving(false);
    }
  }

  /* ── Declined at G2: the flow ends, and it ends kindly. ──────────────────── */
  if (declined) {
    return (
      <Screen>
        <Header />
        <ScreenBody>
          <Eyebrow>No problem</Eyebrow>
          <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            Nothing was saved.
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            You&apos;re not on Pando, and nothing about you is stored. If you change
            your mind, the family who recommended you can send the link again.
          </p>
        </ScreenBody>
      </Screen>
    );
  }

  if (stage === "done") {
    return (
      <Screen>
        <Header />
        <ScreenBody>
          <Eyebrow>Thank you</Eyebrow>
          <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            That&apos;s saved — and you&apos;re not listed yet.
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            A person at Pando checks this against the family who put your name
            forward. That&apos;s deliberate: it&apos;s what stops anyone from listing
            themselves as someone a parent vouched for.
          </p>
          <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-ink-soft">
            <li className="flex gap-2.5">
              <Bullet />
              We&apos;ll text you once it&apos;s matched up.
            </li>
            <li className="flex gap-2.5">
              <Bullet />
              {answers.appear_in_answers
                ? "Then families near you can see your first name, what you're good with, and your range — never your number."
                : "You said no to appearing in answers, so nothing about you is shown to a family. You can change that any time."}
            </li>
            <li className="flex gap-2.5">
              <Bullet />
              Text DELETE and the whole profile goes, without asking why.
            </li>
          </ul>
        </ScreenBody>
      </Screen>
    );
  }

  /* ── G2: what this is, and the one consent that lets it exist ────────────── */
  if (stage === "intro") {
    return (
      <Screen>
        <Header step={stepIndex} total={totalSteps} />
        <ScreenBody>
          <Eyebrow>For caregivers</Eyebrow>
          <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            A family recommended you.
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            Pando is how parents here ask each other about care. Someone you&apos;ve
            worked for put your name forward — nothing about you is listed until you
            set this up and say yes.
          </p>
          <Panel className="mt-6">
            <p className="text-[15px] leading-relaxed text-ink-soft">
              {CAREGIVER_CONSENT_TEXT.profile}
            </p>
            <ul className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-muted">
              <li className="flex gap-2.5">
                <Bullet />
                Your number is never shown to a family.
              </li>
              <li className="flex gap-2.5">
                <Bullet />
                What you were told about — who said what — stays between them and
                Pando. You&apos;ll never see it here, and neither will anyone else.
              </li>
              <li className="flex gap-2.5">
                <Bullet />
                Every permission after this is a separate yes.
              </li>
            </ul>
          </Panel>
        </ScreenBody>
        <ScreenDock stickyOnDesktop>
          <Button
            full
            onClick={() => {
              set("profile_consent", true);
              setStage("identity");
            }}
          >
            Set up my profile
          </Button>
          <TextAction tone="quiet" full className="mt-3" onClick={() => setDeclined(true)}>
            No thanks — don&apos;t keep anything
          </TextAction>
        </ScreenDock>
      </Screen>
    );
  }

  /* ── G1: who they are, and the number that proves it ─────────────────────── */
  if (stage === "identity") {
    return (
      <Screen>
        <Header onBack={() => setStage("intro")} step={stepIndex} total={totalSteps} />
        <ScreenBody>
          <Eyebrow>G1 · You</Eyebrow>
          <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            What should families call you?
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            A first name and an initial is all Pando ever shows — never a surname.
          </p>

          <div className="mt-6 space-y-4">
            <div className="flex gap-3">
              <Field
                label="First name"
                className="flex-1"
                value={answers.first_name}
                onChange={(e) => set("first_name", e.target.value.slice(0, 30))}
                autoComplete="given-name"
              />
              <Field
                label="Initial"
                className="w-[6.5rem]"
                value={answers.last_initial}
                onChange={(e) =>
                  set("last_initial", e.target.value.slice(0, 1).toUpperCase())
                }
              />
            </div>

            <PhoneField
              value={answers.phone}
              onChange={(v) => set("phone", v)}
              label="Your mobile number"
              hint="Only ever used to reach you. Never shown to a family."
            />

            {/* The disclosure was outside the bordered box here and inside it on
                the two parent surfaces, which made it read as an unrelated
                footnote rather than as part of what was being agreed to. One
                component, one answer. */}
            <Consent
              id="cg-sms"
              checked={answers.sms_consent}
              onChange={(on) => set("sms_consent", on)}
              detail={SMS_CONSENT_TERMS}
            >
              {SMS_CONSENT_AGREEMENT}
            </Consent>
          </div>
        </ScreenBody>
        <ScreenDock>
          <Button
            full
            disabled={!identityReady}
            onClick={() => {
              setTapIndex(0);
              setStage("tap");
            }}
          >
            Continue
          </Button>
        </ScreenDock>
      </Screen>
    );
  }

  /* ── G3–G7: the tap screens ──────────────────────────────────────────────── */
  if (stage === "tap") {
    const step = steps[tapIndex];
    const last = tapIndex === steps.length - 1;
    return (
      <Screen>
        <Header
          onBack={() =>
            tapIndex === 0 ? setStage("identity") : setTapIndex(tapIndex - 1)
          }
          step={stepIndex}
          total={totalSteps}
        />
        <ScreenBody>
          <Eyebrow>{step.eyebrow}</Eyebrow>
          <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            {step.title}
          </h1>
          {step.help && (
            <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
              {step.help}
            </p>
          )}

          <div className="mt-6 space-y-7">
            {step.questions.map((q) => (
              <ChipGroup
                key={q.key}
                label={step.questions.length > 1 ? q.label : undefined}
                groupLabel={q.label}
                options={q.options}
                mode={q.mode}
                layout={q.layout}
                selected={selectionsFor(q.key, answers)}
                onChange={(next) => setTap(q.key, next)}
              />
            ))}

            {step.freeText && (
              <Field
                label={step.freeText.label}
                rows={3}
                value={answers.hours_note}
                onChange={(e) => set("hours_note", e.target.value.slice(0, 300))}
                placeholder={step.freeText.placeholder}
              />
            )}
          </div>
        </ScreenBody>
        <ScreenDock>
          <Button
            full
            onClick={() =>
              last ? setStage("permissions") : setTapIndex(tapIndex + 1)
            }
          >
            {last ? "Next: what families can see" : "Continue"}
          </Button>
          {/* Every question here is optional — skipping is a real answer, and
              saying so is what keeps the flow from feeling like an application. */}
          <p className="mt-2.5 text-center text-[12.5px] text-muted">
            Skip anything you&apos;d rather not answer.
          </p>
        </ScreenDock>
      </Screen>
    );
  }

  /* ── G8–G10: the three permissions, each on its own ──────────────────────── */
  if (stage === "permissions") {
    return (
      <Screen>
        <Header onBack={() => setStage("tap")} step={stepIndex} total={totalSteps} />
        <ScreenBody>
          <Eyebrow>G8–G10 · Your call</Eyebrow>
          <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            What may families see?
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            Three separate questions. No is a complete answer to all of them — your
            profile still exists, it&apos;s just yours.
          </p>

          <div className="mt-6 space-y-3">
            <Consent
              reflects
              checked={answers.appear_in_answers}
              onChange={(on) => {
                set("appear_in_answers", on);
                /* Being introduced is strictly more than being named, so it
                   cannot outlive the permission it depends on. The database says
                   the same thing (claim_ladder_order); this is so the screen never
                   shows a state the write would refuse. */
                if (!on) set("open_to_introductions", false);
              }}
              title="Appear in answers"
            >
              {CAREGIVER_CONSENT_TEXT.listing}
            </Consent>
            <Consent
              reflects
              checked={answers.open_to_introductions}
              disabled={!answers.appear_in_answers}
              onChange={(on) => set("open_to_introductions", on)}
              title="Be introduced"
              note={
                answers.appear_in_answers
                  ? undefined
                  : "Available once you have said yes to appearing in answers."
              }
            >
              {CAREGIVER_CONSENT_TEXT.introduction}
            </Consent>
            <Consent
              reflects
              checked={answers.open_to_reference_intros}
              onChange={(on) => set("open_to_reference_intros", on)}
              title="References"
            >
              {CAREGIVER_CONSENT_TEXT.reference}
            </Consent>
          </div>
        </ScreenBody>
        <ScreenDock>
          <Button full onClick={() => setStage("verify")}>
            Continue
          </Button>
        </ScreenDock>
      </Screen>
    );
  }

  /* ── Verify, then write. Nothing before this point has left the device. ──── */
  return (
    <Screen>
      <Header onBack={() => setStage("permissions")} step={stepIndex} total={totalSteps} />
      <ScreenBody>
        <Eyebrow>Last step</Eyebrow>
        <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
          Confirm it&apos;s you.
        </h1>
        <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
          Nothing you&apos;ve answered has been sent yet. It goes when you confirm
          the code, and not before.
        </p>

        <VerifyPhone
          phone={e164 ?? answers.phone}
          audience="caregiver"
          submits
          busy={saving}
          onVerified={() => void submit()}
        />

        {error && (
          <Note className="mt-4">{error}</Note>
        )}
      </ScreenBody>
    </Screen>
  );
}

function Header({
  onBack,
  step,
  total,
}: {
  onBack?: () => void;
  /**
   * 0-based index across *every* stage, not just the tap ones.
   *
   * The header used to read "3 of 5" counting the tap steps alone, with no bar
   * at all — so a caregiver who reached "5 of 5" still had the permissions
   * screen and the code screen ahead of them. A progress indicator that fills
   * up and then hands you two more screens is worse than none.
   */
  step?: number;
  total?: number;
}) {
  const progress =
    step !== undefined && total !== undefined
      ? `${step + 1} of ${total}`
      : undefined;
  return (
    <ScreenHeader
      /* Was a fourth hand-drawn copy of the lockup, at a fourth size (`h-5` and
         `1rem`). Nothing made the caregiver flow's logo smaller than the parent
         flow's — every other `ScreenHeader` passes a plain `Wordmark`, and so
         does this one now. */
      left={<Wordmark />}
      below={
        step !== undefined && total !== undefined ? (
          <div className="pb-1 pt-2">
            <Progress total={total} current={step} />
          </div>
        ) : undefined
      }
      right={
        <>
          {progress && (
            <span className="font-semibold text-muted text-dock">
              {progress}
            </span>
          )}
          {/* No underline: it sits in the header rail beside the step count,
              where a rule reads as noise rather than as an affordance. */}
          {onBack && (
            <TextAction underline={false} className="px-2" onClick={onBack}>
              Back
            </TextAction>
          )}
        </>
      }
    />
  );
}

/**
 * A 6px dot at the head of a list item.
 *
 * Renamed from `Tick`, which is what `components/ui/Chip.tsx` calls its
 * circle-to-check mark. Two unrelated components under one name in one codebase
 * is a trap for the next import, and this one is not a tick at all.
 */
function Bullet() {
  return (
    <span
      aria-hidden="true"
      className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-green"
    />
  );
}
