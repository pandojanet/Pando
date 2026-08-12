"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
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
import { PandoMark } from "@/components/ui/Logo";
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
          <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
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
          <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            That&apos;s saved — and you&apos;re not listed yet.
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            A person at Pando checks this against the family who put your name
            forward. That&apos;s deliberate: it&apos;s what stops anyone from listing
            themselves as someone a parent vouched for.
          </p>
          <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-ink-soft">
            <li className="flex gap-2.5">
              <Tick />
              We&apos;ll text you once it&apos;s matched up.
            </li>
            <li className="flex gap-2.5">
              <Tick />
              {answers.appear_in_answers
                ? "Then families near you can see your first name, what you're good with, and your range — never your number."
                : "You said no to appearing in answers, so nothing about you is shown to a family. You can change that any time."}
            </li>
            <li className="flex gap-2.5">
              <Tick />
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
        <Header />
        <ScreenBody>
          <Eyebrow>For caregivers</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            A family recommended you.
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            Pando is how parents here ask each other about care. Someone you&apos;ve
            worked for put your name forward — nothing about you is listed until you
            set this up and say yes.
          </p>
          <div className="mt-6 rounded-3xl border border-bark bg-card p-5">
            <p className="text-[15px] leading-relaxed text-ink-soft">
              {CAREGIVER_CONSENT_TEXT.profile}
            </p>
            <ul className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-muted">
              <li className="flex gap-2.5">
                <Tick />
                Your number is never shown to a family.
              </li>
              <li className="flex gap-2.5">
                <Tick />
                What you were told about — who said what — stays between them and
                Pando. You&apos;ll never see it here, and neither will anyone else.
              </li>
              <li className="flex gap-2.5">
                <Tick />
                Every permission after this is a separate yes.
              </li>
            </ul>
          </div>
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
          <button
            type="button"
            onClick={() => setDeclined(true)}
            className="mt-3 min-h-11 w-full text-[14px] font-semibold text-muted underline underline-offset-2"
          >
            No thanks — don&apos;t keep anything
          </button>
        </ScreenDock>
      </Screen>
    );
  }

  /* ── G1: who they are, and the number that proves it ─────────────────────── */
  if (stage === "identity") {
    return (
      <Screen>
        <Header onBack={() => setStage("intro")} />
        <ScreenBody>
          <Eyebrow>G1 · You</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            What should families call you?
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            A first name and an initial is all Pando ever shows — never a surname.
          </p>

          <div className="mt-6 space-y-4">
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="text-[14px] font-semibold">First name</span>
                <input
                  value={answers.first_name}
                  onChange={(e) => set("first_name", e.target.value.slice(0, 30))}
                  autoComplete="given-name"
                  className="mt-1.5 min-h-[52px] w-full rounded-2xl border border-bark bg-card px-4 text-[16.5px]"
                />
              </label>
              <label className="w-[6.5rem]">
                <span className="text-[14px] font-semibold">Initial</span>
                <input
                  value={answers.last_initial}
                  onChange={(e) =>
                    set("last_initial", e.target.value.slice(0, 1).toUpperCase())
                  }
                  className="mt-1.5 min-h-[52px] w-full rounded-2xl border border-bark bg-card px-4 text-[16.5px]"
                />
              </label>
            </div>

            <PhoneField
              value={answers.phone}
              onChange={(v) => set("phone", v)}
              label="Your mobile number"
              hint="Only ever used to reach you. Never shown to a family."
            />

            <label className="flex items-start gap-3 rounded-2xl border border-bark bg-card p-4">
              <input
                type="checkbox"
                checked={answers.sms_consent}
                onChange={(e) => set("sms_consent", e.target.checked)}
                aria-describedby="cg-sms-terms"
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-green-deep)]"
              />
              <span className="text-[14px] leading-relaxed text-ink-soft">
                {SMS_CONSENT_AGREEMENT}
              </span>
            </label>
            <p id="cg-sms-terms" className="text-[12.5px] leading-relaxed text-muted">
              {SMS_CONSENT_TERMS}
            </p>
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
          progress={`${tapIndex + 1} of ${steps.length}`}
        />
        <ScreenBody>
          <Eyebrow>{step.eyebrow}</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
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
              <label className="block">
                <span className="text-[14px] font-semibold">
                  {step.freeText.label}
                </span>
                <textarea
                  value={answers.hours_note}
                  onChange={(e) =>
                    set("hours_note", e.target.value.slice(0, 300))
                  }
                  rows={3}
                  placeholder={step.freeText.placeholder}
                  className="mt-1.5 w-full rounded-2xl border border-bark bg-card p-4 text-[16.5px]"
                />
              </label>
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
        <Header onBack={() => setStage("tap")} />
        <ScreenBody>
          <Eyebrow>G8–G10 · Your call</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
            What may families see?
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            Three separate questions. No is a complete answer to all of them — your
            profile still exists, it&apos;s just yours.
          </p>

          <div className="mt-6 space-y-3">
            <Permission
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
              body={CAREGIVER_CONSENT_TEXT.listing}
            />
            <Permission
              checked={answers.open_to_introductions}
              disabled={!answers.appear_in_answers}
              onChange={(on) => set("open_to_introductions", on)}
              title="Be introduced"
              body={CAREGIVER_CONSENT_TEXT.introduction}
              note={
                answers.appear_in_answers
                  ? undefined
                  : "Available once you've said yes to appearing in answers."
              }
            />
            <Permission
              checked={answers.open_to_reference_intros}
              onChange={(on) => set("open_to_reference_intros", on)}
              title="References"
              body={CAREGIVER_CONSENT_TEXT.reference}
            />
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
      <Header onBack={() => setStage("permissions")} />
      <ScreenBody>
        <Eyebrow>Last step</Eyebrow>
        <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-[1.12]">
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
          <p className="mt-4 text-[14px] font-medium text-alert">{error}</p>
        )}
      </ScreenBody>
    </Screen>
  );
}

function Header({
  onBack,
  progress,
}: {
  onBack?: () => void;
  progress?: string;
}) {
  return (
    <ScreenHeader
      left={
        <span className="flex items-center gap-2">
          <PandoMark className="h-5" />
          <span className="font-display text-[1rem] font-bold tracking-[-0.02em]">
            Pando
          </span>
        </span>
      }
      right={
        <>
          {progress && (
            <span className="text-[12.5px] font-semibold text-muted">
              {progress}
            </span>
          )}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="min-h-11 px-2 text-[14px] font-semibold text-green-deep"
            >
              Back
            </button>
          )}
        </>
      }
    />
  );
}

function Permission({
  checked,
  onChange,
  title,
  body,
  note,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  body: string;
  note?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-2xl border p-4 ${
        disabled
          ? "border-bark bg-paper opacity-60"
          : checked
            ? "border-green/40 bg-green-wash"
            : "border-bark bg-card"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-green-deep)]"
      />
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="mt-1 block text-[14px] leading-relaxed text-ink-soft">
          {body}
        </span>
        {note && (
          <span className="mt-1.5 block text-[12.5px] text-muted">{note}</span>
        )}
      </span>
    </label>
  );
}

function Tick() {
  return (
    <span
      aria-hidden="true"
      className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-green"
    />
  );
}
