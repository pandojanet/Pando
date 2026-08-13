"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Button } from "@/components/ui/Button";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { Progress } from "@/components/ui/Progress";
import {
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { track, trackAbandonOnHide } from "@/lib/analytics";
import { saveProfile } from "@/lib/api-client";
import { buildProfilePayload } from "@/lib/derive";
import { handleExpiredVerification, holdsUntilVerified } from "@/lib/submit";
import {
  canAdvance,
  customEntriesFor,
  isQuestionAnswered,
  labelForOption,
  optionsFor,
  profileCompleteness,
  selectionsFor,
  statusLabel,
  visibleQuestions,
  visibleScreens,
} from "@/lib/questions";
import { loadSession, newSession, saveSession } from "@/lib/storage";
import { useMarketOptions } from "@/lib/use-market-options";
import type { ProfileAnswers, Question, SeedSession } from "@/lib/types";

/**
 * Estimate 1.2 — the tap-first profile.
 *
 * One question group per screen, autosaved after every tap, resumable, and
 * finishable in under a minute with two answers. All the question logic
 * (ordering, gating, weights, "prefer not to say") lives in lib/questions.ts —
 * this component only renders it and moves the parent forward.
 */
export function ProfileFlow() {
  const router = useRouter();
  const [session, setSession] = useState<SeedSession | null>(null);
  const [stage, setStage] = useState<"questions" | "review">("questions");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A parent can deep-link straight here from a forwarded URL; don't block them.
  useEffect(() => {
    const existing = loadSession();
    setSession(
      existing ??
        newSession({ invite_code: null, market_id: "pasadena", source: "direct" }),
    );
  }, []);

  const answers: ProfileAnswers | null = session?.answers ?? null;

  /**
   * Loads the tap lists from the database and re-renders once they arrive, so a
   * chip an admin promoted (or Janet imported) is here without a deploy. Called
   * before the loading early-return, because a hook cannot be conditional; until
   * it resolves, `optionsFor` returns the built-in lists.
   */
  useMarketOptions(session?.market_id ?? "pasadena");

  const screens = useMemo(
    () => (answers ? visibleScreens(answers) : []),
    [answers],
  );

  const index = session
    ? Math.min(Math.max(session.screen_index, 0), Math.max(screens.length - 1, 0))
    : 0;
  const screen = screens[index];

  const update = useCallback(
    (mutate: (s: SeedSession) => SeedSession) => {
      setSession((prev) => (prev ? saveSession(mutate(prev)) : prev));
    },
    [],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [index, stage]);

  useEffect(() => {
    if (!screen) return;
    return trackAbandonOnHide(() => ({
      last_screen: stage === "review" ? "review" : screen.id,
      screen_index: index,
    }));
  }, [screen, index, stage]);

  if (!session || !answers || !screen) {
    return (
      <Screen>
        <ScreenHeader below={<div className="mt-1 h-1 rounded-full bg-bark" />} />
        <ScreenBody>
          <div className="h-4 w-24 rounded bg-bark/70" />
          <div className="mt-4 h-8 w-full rounded bg-bark/50" />
        </ScreenBody>
      </Screen>
    );
  }

  const market = session.market_id;
  const questions = visibleQuestions(screen, answers);
  const unlocked = canAdvance(screen, answers);
  const isLast = index === screens.length - 1;
  const optionalScreen = questions.every((q) => !q.required);

  function setSelections(question: Question, next: string[]) {
    update((s) => {
      const a: ProfileAnswers = { ...s.answers };
      switch (question.id) {
        case "neighborhood":
          a.neighborhood = next[0] ?? null;
          break;
        case "time_in_area":
          a.time_in_area = next[0] ?? null;
          // Dropping "new here" drops the follow-up with it, rather than keeping an
          // answer to a question that is no longer asked.
          if (a.time_in_area !== "under_year" && a.time_in_area !== "1_3_years") {
            a.moved_from = null;
          }
          break;
        case "moved_from":
          a.moved_from = next[0] ?? null;
          break;
        case "attribution":
          a.attribution = next[0] ?? null;
          break;
        case "allowance":
          a.allowance = next[0] ?? null;
          break;
        case "child_ages":
          a.child_ages = next.map(Number).sort((x, y) => x - y);
          break;
        case "schools": {
          a.schools = next;
          // Keep a status only for the schools still selected.
          a.school_status = Object.fromEntries(
            Object.entries(s.answers.school_status).filter(([id]) =>
              next.includes(id),
            ),
          );
          break;
        }
        default:
          a[question.id] = next;
      }
      a.skipped = s.answers.skipped.filter((id) => id !== screen.id);
      return { ...s, answers: a };
    });
  }

  function setStatus(optionId: string, statusId: string) {
    update((s) => ({
      ...s,
      answers: {
        ...s.answers,
        school_status: { ...s.answers.school_status, [optionId]: statusId },
      },
    }));
    track("seed_question_answered", { question: "school_status", option: statusId });
  }

  function addCustom(question: Question, value: string) {
    update((s) => {
      const existing = s.answers.other[question.id] ?? [];
      if (existing.some((v) => v.toLowerCase() === value.toLowerCase())) return s;
      return {
        ...s,
        answers: {
          ...s.answers,
          other: { ...s.answers.other, [question.id]: [...existing, value] },
          skipped: s.answers.skipped.filter((id) => id !== screen.id),
        },
      };
    });
    track("seed_other_submitted", { question: question.id });
  }

  function removeCustom(question: Question, value: string) {
    update((s) => ({
      ...s,
      answers: {
        ...s.answers,
        other: {
          ...s.answers.other,
          [question.id]: (s.answers.other[question.id] ?? []).filter(
            (v) => v !== value,
          ),
        },
      },
    }));
  }

  function goNext() {
    if (isLast) {
      setStage("review");
      track("seed_profile_review_viewed", {
        completeness: profileCompleteness(answers!),
      });
      return;
    }
    setDirection(1);
    track("seed_screen_advanced", { screen: screen.id, screen_index: index });
    update((s) => ({ ...s, screen_index: index + 1 }));
  }

  function goBack() {
    if (stage === "review") {
      setStage("questions");
      return;
    }
    if (index === 0) {
      router.push("/join");
      return;
    }
    setDirection(-1);
    track("seed_screen_back", { screen: screen.id });
    update((s) => ({ ...s, screen_index: index - 1 }));
  }

  function skipScreen() {
    track("seed_question_skipped", { screen: screen.id });
    update((s) => ({
      ...s,
      answers: {
        ...s.answers,
        skipped: s.answers.skipped.includes(screen.id)
          ? s.answers.skipped
          : [...s.answers.skipped, screen.id],
      },
    }));
    goNext();
  }

  function jumpTo(screenId: string) {
    const target = screens.findIndex((s) => s.id === screenId);
    if (target < 0) return;
    setDirection(-1);
    setStage("questions");
    update((s) => ({ ...s, screen_index: target }));
  }

  async function save() {
    if (!session) return;
    setSaving(true);
    setSaveError(null);
    try {
      /* A confirmed number means this goes up now. Without one — the anonymous
         path, or a deployment that cannot send a code — it stays on the phone and
         travels with everything else at the end (lib/submit.ts). Either way the
         screen says "saved", and either way that is true. */
      const held = holdsUntilVerified(session);
      const result = held ? null : await saveProfile(buildProfilePayload(session));
      update((s) => ({ ...s, profile_saved_at: new Date().toISOString() }));
      track("seed_profile_saved", {
        completeness: profileCompleteness(session.answers),
        persisted: result?.persisted ?? false,
      });
      // Straight into the part only they can answer (spec §3.2, estimate 1.4).
      router.push("/share");
    } catch (err) {
      /* The confirmation ran out mid-flow. The profile is on the phone, the
         session is back to holding, and the end of the flow will ask for a fresh
         code — so this is not an error to stop them with. */
      if (handleExpiredVerification(err)) {
        update((s) => ({
          ...s,
          phone_verified: false,
          profile_saved_at: new Date().toISOString(),
        }));
        router.push("/share");
        return;
      }
      setSaveError(
        "That didn't go through. Your answers are safe on this phone — try again.",
      );
      track("seed_profile_save_failed");
    } finally {
      setSaving(false);
    }
  }

  /* ── Review ──────────────────────────────────────────────────── */

  if (stage === "review") {
    return (
      <Screen>
        <ScreenHeader
          left={<BackButton onClick={goBack} />}
          below={
            <div className="mt-1">
              <Progress total={screens.length + 1} current={screens.length} />
            </div>
          }
        />
        <ScreenBody>
          <div className="animate-step-in">
            <Eyebrow>Almost done</Eyebrow>
            <h1 className="mt-2.5 font-display text-[1.7rem] font-bold">
              Does this look right?
            </h1>
            <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
              This is only used to match you with parents whose lives overlap
              with yours. None of it is shown to anyone.
            </p>

            <dl className="mt-6 divide-y divide-bark/70 overflow-hidden rounded-3xl border border-bark bg-card">
              {screens.flatMap((s) =>
                visibleQuestions(s, answers).map((q) => {
                  const values = [
                    ...selectionsFor(q, answers).map((id) => {
                      const label = labelForOption(q, market, answers, id);
                      // A school reads wrong without its status: "current" and
                      // "former" are different recommendations of the same place.
                      const status = q.perSelectionStatus
                        ? answers.school_status[id]
                        : undefined;
                      return status ? `${label} (${statusLabel(status)})` : label;
                    }),
                    ...customEntriesFor(q, answers),
                  ];
                  return (
                    <div key={`${s.id}-${q.id}`} className="flex gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <dt className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                          {q.label ?? s.eyebrow}
                        </dt>
                        <dd
                          className={
                            values.length
                              ? "mt-1 text-[15.5px] leading-snug"
                              : "mt-1 text-[15.5px] italic text-muted"
                          }
                        >
                          {values.length ? values.join(" · ") : "Skipped"}
                        </dd>
                      </div>
                      <button
                        type="button"
                        onClick={() => jumpTo(s.id)}
                        className="h-11 shrink-0 self-center rounded-full px-3 text-[14px] font-semibold text-green-deep"
                      >
                        {values.length ? "Edit" : "Add"}
                      </button>
                    </div>
                  );
                }),
              )}
            </dl>

            <p className="mt-5 text-[13.5px] leading-relaxed text-muted">
              You can change any of this later — just text Pando once your
              neighborhood goes live.
            </p>
          </div>
        </ScreenBody>
        <ScreenDock>
          {saveError && (
            <p className="mb-3 animate-rise rounded-2xl border border-gold-line bg-gold-wash p-3 text-[14px] font-medium text-gold-ink">
              {saveError}
            </p>
          )}
          <Button full onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save my profile"}
            {!saving && <ArrowRight />}
          </Button>
          <p className="py-3 text-center text-[12.5px] text-muted">
            Next: the part only you can answer — what you&apos;d recommend.
          </p>
        </ScreenDock>
      </Screen>
    );
  }

  /* ── Questions ───────────────────────────────────────────────── */

  return (
    <Screen>
      <ScreenHeader
        left={<BackButton onClick={goBack} />}
        right={
          optionalScreen ? (
            <button
              type="button"
              onClick={skipScreen}
              className="h-11 rounded-full px-3 text-[14.5px] font-semibold text-muted transition-colors hover:text-green-deep"
            >
              Skip
            </button>
          ) : (
            <span className="px-1 text-[13px] font-medium text-muted">
              {index + 1} of {screens.length}
            </span>
          )
        }
        below={
          <div className="mt-1">
            <Progress total={screens.length + 1} current={index} />
          </div>
        }
      />

      <ScreenBody>
        <div
          key={screen.id}
          className={direction === 1 ? "animate-step-in" : "animate-step-in-back"}
        >
          <Eyebrow>{screen.eyebrow}</Eyebrow>
          <h1 className="mt-2.5 font-display text-[1.7rem] font-bold">
            {screen.title}
          </h1>
          {screen.help && (
            <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
              {screen.help}
            </p>
          )}

          {/* Stated, not asked: the privacy disclosure and the Pando promise. */}
          {screen.statement && (
            <div className="mt-6 rounded-3xl border border-bark bg-card p-5">
              {screen.statement.body.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 24)}
                  className="mt-3 text-[15.5px] leading-relaxed text-ink-soft first:mt-0"
                >
                  {paragraph}
                </p>
              ))}
              {screen.statement.note && (
                <p className="mt-4 rounded-2xl border border-green/20 bg-green-wash p-3 text-[14px] font-medium leading-relaxed text-green-deep">
                  {screen.statement.note}
                </p>
              )}
            </div>
          )}

          <div className="mt-6 space-y-8">
            {questions.map((question) => (
              <div key={`${question.id}-group`}>
              <ChipGroup
                key={question.id}
                label={questions.length > 1 ? question.label : undefined}
                groupLabel={question.label ?? screen.title}
                mode={question.kind === "single" ? "single" : "multi"}
                layout={question.kind === "ages" ? "grid" : "wrap"}
                options={optionsFor(question, market, answers)}
                selected={selectionsFor(question, answers)}
                onChange={(next, changed) => {
                  setSelections(question, next);
                  if (changed.on) {
                    track("seed_question_answered", {
                      question: question.id,
                      option: changed.id,
                    });
                  }
                }}
                custom={customEntriesFor(question, answers)}
                otherLabel={question.allowOther ? question.otherLabel : undefined}
                onAddCustom={
                  question.allowOther
                    ? (value) => addCustom(question, value)
                    : undefined
                }
                onRemoveCustom={(value) => removeCustom(question, value)}
              />

              {/* P5 — each school gets its own status. "Former" is a real signal:
                  a parent who has been through admissions is exactly who someone
                  needs, so we keep them matchable instead of dropping them. */}
              {question.perSelectionStatus &&
                selectionsFor(question, answers).length > 0 && (
                  <div className="mt-4 space-y-2.5">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
                      {question.perSelectionStatus.label}
                    </p>
                    {selectionsFor(question, answers).map((optionId) => (
                      <div
                        key={optionId}
                        className="rounded-2xl border border-bark bg-card p-3"
                      >
                        <p className="text-[14.5px] font-semibold">
                          {labelForOption(question, market, answers, optionId)}
                        </p>
                        <div
                          role="radiogroup"
                          aria-label={`Status for ${labelForOption(question, market, answers, optionId)}`}
                          className="mt-2 flex flex-wrap gap-2"
                        >
                          {question.perSelectionStatus!.options.map((status) => {
                            const on = answers.school_status[optionId] === status.id;
                            return (
                              <button
                                key={status.id}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setStatus(optionId, status.id)}
                                className={
                                  on
                                    ? "min-h-[44px] rounded-full border border-green bg-green-wash px-3.5 text-[14px] font-semibold text-green-deep"
                                    : "min-h-[44px] rounded-full border border-bark px-3.5 text-[14px] font-medium text-ink-soft"
                                }
                              >
                                {status.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {index === 1 && (
            <p className="mt-8 rounded-2xl border border-green/20 bg-green-wash p-4 text-[14px] leading-relaxed text-green-deep">
              That&apos;s both required questions. Everything after this is
              optional — it just sharpens who Pando asks on your behalf.
            </p>
          )}
        </div>
      </ScreenBody>

      <ScreenDock>
        <Button full onClick={goNext} disabled={!unlocked}>
          {isLast ? "Review" : "Continue"}
          <ArrowRight />
        </Button>
        <p className="py-3 text-center text-[12.5px] text-muted">
          {!unlocked
            ? "Pick one to keep going"
            : optionalScreen && !questions.some((q) => isQuestionAnswered(q, answers))
              ? "Nothing here fits? Skip it — no harm done."
              : "Autosaved. You can close this and come back."}
        </p>
      </ScreenDock>
    </Screen>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-ink-soft transition-colors hover:bg-bark/50"
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M11.5 5 6.5 10l5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
