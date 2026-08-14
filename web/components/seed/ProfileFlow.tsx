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
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import { track, trackAbandonOnHide } from "@/lib/analytics";
import { saveProfile, verifyStatus, type VerifyStatus } from "@/lib/api-client";
import { buildProfilePayload } from "@/lib/derive";
import { handleExpiredVerification, holdsUntilVerified } from "@/lib/submit";
import {
  canAdvance,
  childOptions,
  customEntriesFor,
  isQuestionAnswered,
  labelForOption,
  maxSelectionsFor,
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
  const [stage, setStage] = useState<"questions" | "review" | "verify">(
    "questions",
  );
  /** Configuration, not a person: whether a code can be asked for at all. */
  const [gate, setGate] = useState<VerifyStatus | null>(null);
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

  /** The birth years tapped in P4, for the "whose is it" chips. */
  const children = useMemo(
    () => (answers ? childOptions(answers) : []),
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
      /* Deselecting an option takes its attribution with it — the same rule the
         school status follows, for the same reason: an orphaned answer about a
         school nobody picked is a fact about nothing. */
      if (question.perChild && a.child_of[question.id]) {
        a.child_of = {
          ...a.child_of,
          [question.id]: Object.fromEntries(
            Object.entries(a.child_of[question.id] ?? {}).filter(([id]) =>
              next.includes(id),
            ),
          ),
        };
      }
      a.skipped = s.answers.skipped.filter((id) => id !== screen.id);
      return { ...s, answers: a };
    });
  }

  /**
   * Whose this answer is. Multi-select, because one class genuinely covers two
   * children — and tapping the only chosen child off is allowed: "they didn't
   * say" is a real answer, and inventing one would put a fact in the record that
   * no parent stated.
   */
  function toggleChild(question: Question, optionId: string, age: number) {
    update((s) => {
      const forQuestion = { ...(s.answers.child_of[question.id] ?? {}) };
      const current = forQuestion[optionId] ?? [];
      forQuestion[optionId] = current.includes(age)
        ? current.filter((a) => a !== age)
        : [...current, age].sort((a, b) => a - b);
      return {
        ...s,
        answers: {
          ...s.answers,
          child_of: { ...s.answers.child_of, [question.id]: forQuestion },
        },
      };
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
      /* The cap again, against the stored answers rather than against a rendered
         button — the sheet can be open while the count changes under it, and a
         typed school is the one path that would otherwise slip past it. */
      const max = maxSelectionsFor(question, s.answers);
      if (
        max !== undefined &&
        selectionsFor(question, s.answers).length + existing.length >= max
      ) {
        return s;
      }
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

  /**
   * The number is confirmed **here** — after the questions, before anything is
   * sent (13 Aug). It sat on the entry screen for a day and was wrong there: a
   * parent was asked to prove a number before they had seen what the tool even
   * does, which is the friction the client asked us to keep off the front door.
   *
   * Two rules this placement has to keep, and the entry version broke the first:
   *
   *  - **it never skips silently.** The status is awaited rather than read from
   *    whatever a background fetch happened to have finished. Previously a slow
   *    or failed `/verify/status` left the gate null and the parent walked
   *    straight past the code — verification looked "missing" and nothing said so.
   *  - **it never becomes a dead end.** If the status cannot be fetched, or a
   *    code cannot be sent on this deployment, the session falls back to holding
   *    everything on the phone and the completion screen asks — the shape that
   *    has always existed for exactly this.
   */
  async function gateNow(): Promise<VerifyStatus | null> {
    if (gate) return gate;
    try {
      const fresh = await verifyStatus();
      setGate(fresh);
      return fresh;
    } catch {
      return null;
    }
  }

  async function save() {
    if (!session) return;

    if (holdsUntilVerified(session)) {
      setSaving(true);
      const status = await gateNow();
      setSaving(false);
      if (status?.required && status.sendable) {
        track("seed_verify_reached", { at: "profile_end" });
        setStage("verify");
        return;
      }
    }

    await persist(session);
  }

  async function persist(current: SeedSession) {
    setSaving(true);
    setSaveError(null);
    try {
      /* A confirmed number means this goes up now. Without one — the anonymous
         path, or a deployment that cannot send a code — it stays on the phone and
         travels with everything else at the end (lib/submit.ts). Either way the
         screen says "saved", and either way that is true. */
      const held = holdsUntilVerified(current);
      const result = held ? null : await saveProfile(buildProfilePayload(current));
      update((s) => ({ ...s, profile_saved_at: new Date().toISOString() }));
      track("seed_profile_saved", {
        completeness: profileCompleteness(current.answers),
        persisted: result?.persisted ?? false,
      });
      // Straight into the part only they can answer.
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

  /* ── The code, once the questions are answered ───────────────── */

  if (stage === "verify" && session.phone) {
    return (
      <Screen>
        <ScreenHeader
          left={<BackButton onClick={() => setStage("review")} />}
          below={
            <div className="mt-1">
              <Progress total={screens.length + 1} current={screens.length + 1} />
            </div>
          }
        />
        <ScreenBody className="pt-2">
          <div className="animate-step-in">
            <Eyebrow>One quick check</Eyebrow>
            <h1 className="mt-2.5 font-display text-[1.7rem] font-bold">
              Confirm your number and this is saved.
            </h1>
            <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">
              Ten seconds, and it&apos;s the last thing standing between these
              answers and your place in the pilot. Nothing has left this phone yet.
            </p>
          </div>

          <VerifyPhone
            phone={session.phone}
            onVerified={() => {
              const verified: SeedSession = { ...session, phone_verified: true };
              saveSession(verified);
              setSession(verified);
              track("seed_verified", { at: "profile_end" });
              void persist(verified);
            }}
          />

          {saving && (
            <p className="mt-4 text-[13.5px] text-muted">Saving your answers…</p>
          )}
          {saveError && (
            <p className="mt-4 text-[13.5px] font-medium text-alert">{saveError}</p>
          )}
        </ScreenBody>
      </Screen>
    );
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
                      /* And whose it is, when they said — a school with no child
                         against it reads as the family's, which is the ambiguity
                         the question exists to remove. */
                      const whose =
                        q.perChild && children.length > 1
                          ? (answers.child_of[q.id]?.[id] ?? [])
                              .map(
                                (age) =>
                                  children.find((c) => Number(c.id) === age)?.label,
                              )
                              .filter(Boolean)
                          : [];
                      const detail = [
                        status ? statusLabel(status) : null,
                        ...whose,
                      ].filter(Boolean);
                      return detail.length > 0
                        ? `${label} (${detail.join(" · ")})`
                        : label;
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
            {questions.map((question) => {
              /* One per child, for the questions that belong to a child. See
                 `maxSelectionsFor` — the cap is what makes the "whose is it?"
                 picker below answerable instead of a guess. */
              const max = maxSelectionsFor(question, answers);
              return (
              <div key={`${question.id}-group`}>
              <ChipGroup
                key={question.id}
                label={questions.length > 1 ? question.label : undefined}
                groupLabel={question.label ?? screen.title}
                mode={question.kind === "single" ? "single" : "multi"}
                layout={question.kind === "ages" ? "grid" : "wrap"}
                options={optionsFor(question, market, answers)}
                selected={selectionsFor(question, answers)}
                max={max}
                maxHint={
                  max === undefined
                    ? undefined
                    : max === 1
                      ? "One per child — tap it off to choose a different one."
                      : `One for each of your ${max} kids. Tap one off to swap it.`
                }
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

              {/* Per selection, two follow-ups on the same card.
                  P5 — each school gets its own status. "Former" is a real signal:
                  a parent who has been through admissions is exactly who someone
                  needs, so we keep them matchable instead of dropping them.
                  And, for anything that belongs to a child rather than to the
                  household, **whose it is** — asked only when the family has more
                  than one, because with one child there is nothing to ask. */}
              {(question.perSelectionStatus ||
                (question.perChild && children.length > 1)) &&
                selectionsFor(question, answers).length > 0 && (
                  <div className="mt-4 space-y-2.5">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
                      {question.perSelectionStatus?.label ?? "For each one"}
                    </p>
                    {selectionsFor(question, answers).map((optionId) => {
                      const optionLabel = labelForOption(
                        question,
                        market,
                        answers,
                        optionId,
                      );
                      return (
                        <div
                          key={optionId}
                          className="rounded-2xl border border-bark bg-card p-3"
                        >
                          <p className="text-[14.5px] font-semibold">{optionLabel}</p>

                          {question.perSelectionStatus && (
                            <div
                              role="radiogroup"
                              aria-label={`Status for ${optionLabel}`}
                              className="mt-2 flex flex-wrap gap-2"
                            >
                              {question.perSelectionStatus.options.map((status) => {
                                const on =
                                  answers.school_status[optionId] === status.id;
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
                          )}

                          {question.perChild && children.length > 1 && (
                            <div className="mt-3">
                              <p className="text-[13px] text-muted">
                                Which of your children?
                              </p>
                              <div
                                aria-label={`Which child ${optionLabel} is for`}
                                className="mt-1.5 flex flex-wrap gap-2"
                              >
                                {children.map((child) => {
                                  const age = Number(child.id);
                                  const on = (
                                    answers.child_of[question.id]?.[optionId] ?? []
                                  ).includes(age);
                                  return (
                                    <button
                                      key={child.id}
                                      type="button"
                                      aria-pressed={on}
                                      onClick={() =>
                                        toggleChild(question, optionId, age)
                                      }
                                      className={
                                        on
                                          ? "min-h-[44px] rounded-full border border-green bg-green-wash px-3.5 text-[14px] font-semibold text-green-deep"
                                          : "min-h-[44px] rounded-full border border-bark px-3.5 text-[14px] font-medium text-ink-soft"
                                      }
                                    >
                                      {child.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })}
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
