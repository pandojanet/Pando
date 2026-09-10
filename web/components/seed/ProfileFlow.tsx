"use client";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Button } from "@/components/ui/Button";
import { AnimatePresence, m } from "motion/react";
import { MotionProvider, STEP } from "@/components/ui/Motion";
import { Panel } from "@/components/ui/Panel";
import { Consent } from "@/components/ui/Consent";
import {
} from "@/lib/consent";
import { InlineAction, TextAction } from "@/components/ui/TextAction";
import { Note } from "@/components/ui/Note";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { SearchableChipGroup } from "@/components/ui/SearchableChipGroup";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { PlanGroup } from "@/components/ui/PlanGroup";
import { PhoneField } from "@/components/ui/PhoneField";
import { formatPhone, isPhoneComplete, toE164 } from "@/lib/phone";
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
import {
  fetchMe,
  saveProfile,
  verifyStatus,
  type VerifyStatus,
} from "@/lib/api-client";
import { buildProfilePayload } from "@/lib/derive";
import { handleExpiredVerification, holdsUntilVerified } from "@/lib/submit";
import { ChildList } from "@/components/seed/ChildList";
import {
  CHILD_SCHOOL_STATUS,
  addChildAt,
  applyChildSelections,
  MONTH_OPTIONS,
  canAdvance,
  removeChildAt,
  childBlocks,
  childOptions,
  customEntriesFor,
  isQuestionAnswered,
  labelForOption,
  maxSelectionHint,
  maxSelectionsFor,
  optionsFor,
  profileCompleteness,
  pruneAnswers,
  sameForAllChildren,
  searchableCategory,
  selectionsFor,
  statusLabel,
  visibleQuestions,
  visibleScreens,
} from "@/lib/questions";
import {
  loadSession,
  newSession,
  normaliseAnswers,
  saveSession,
} from "@/lib/storage";
import { useStepChange } from "@/lib/use-step-change";
import { useMarketOptions } from "@/lib/use-market-options";
import { EXPECTING } from "@/lib/types";
import type { ProfileAnswers, Question, SeedSession } from "@/lib/types";

/* The year a birth-year label is computed against. One constant, because the
   review screen and `childOptions` must agree on what "2019" means. */
const CURRENT_YEAR = new Date().getFullYear();

/**
 * The repeated block inside one question: a school with its Current/Former row,
 * a child with its birth month, a selection with its "whose is it?" chips.
 *
 * Deliberately **not** `Panel size="inset"`, which is `p-4`. These are a dense
 * repeated list — up to six on the screen at once, on the tallest screens in the
 * flow — and eight more pixels each is how the dock starts eating the content.
 * A shared string rather than three copies, and a shared string rather than a
 * third size on a primitive for one caller.
 */
const SUBBLOCK = "rounded-2xl border border-bark bg-card p-3";

/**
 * How long a single-select screen waits before advancing itself.
 *
 * Long enough that the chip is seen to go green — under about 200ms the screen
 * looks as though it changed on its own — and short enough that it does not read
 * as a pause. Reduced motion does not shorten it: this is reading time, not an
 * animation, and somebody who has asked for less movement has not asked to be
 * moved on faster.
 */
const AUTO_ADVANCE_MS = 320;

/**
 * Estimate 1.2 — the tap-first profile.
 *
 * One question group per screen, autosaved after every tap, resumable, and
 * finishable in under a minute with two answers. All the question logic
 * (ordering, gating, weights, "prefer not to say") lives in lib/questions.ts —
 * this component only renders it and moves the parent forward.
 */
/**
 * The accessible name for a dropdown that has no directory search behind it.
 *
 * The four searchable questions carry the client's own wording per category;
 * this covers the one that does not, and it says what the box actually does —
 * it filters the options this question offers, and reaches nothing further.
 */
function pickerLabel(question: Question): string {
  /* A static list is not searched, it is chosen from — and "Search family" is
     what the directory wording produced when the 9 Sep merges routed these
     questions here. */
  if (question.dropdown && question.label) {
    return `${question.label} — choose from the list`;
  }
  return question.label ? `Search ${question.label.toLowerCase()}` : "Search the list";
}

/**
 * What the box invites you to do, which is not the same on both kinds of it.
 *
 * `OptionPicker`'s default is "Start typing a name", written for a directory of
 * hundreds where typing is the only way to reach most of them. On a closed list
 * of eleven childcare arrangements it is wrong twice over: there is no name to
 * think of, and it hides that tapping the box shows every option there is —
 * which for these questions is the whole interaction.
 *
 * ⚠ New user-facing copy, on the list for the client.
 */
function pickerPlaceholder(question: Question): string | undefined {
  return question.dropdown ? "Tap to choose, or type to filter" : undefined;
}

export function ProfileFlow() {
  const router = useRouter();
  const [session, setSession] = useState<SeedSession | null>(null);
  const [stage, setStage] = useState<"questions" | "review" | "verify">(
    "questions",
  );
  /** Configuration, not a person: whether a code can be asked for at all. */
  const [gate, setGate] = useState<VerifyStatus | null>(null);
  /**
   * Set once a confirmed number turns out to already have a profile — see
   * `afterVerified`. Null means "not asked yet, or nothing there", and the
   * question is never asked before the code is confirmed.
   */
  const [existing, setExisting] = useState<{
    first_name: string | null;
    referral_code: string | null;
  } | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Non-null while the parent is correcting the number the code goes to. */
  const [editingPhone, setEditingPhone] = useState<string | null>(null);

  // A parent can deep-link straight here from a forwarded URL; don't block them.
  useEffect(() => {
    const existing = loadSession();
    setSession(
      existing ??
        newSession({ invite_code: null, market_id: "pasadena", source: "direct" }),
    );
    /**
     * A parent whose profile is already saved opens on the **review**, not
     * wherever they happened to stop.
     *
     * Found by walking the flow to the end: `/done/next` offers *"Review my
     * answers"* pointing at `/profile`, and `/profile` restored
     * `screen_index` — which for a finished session is the **last question
     * they answered**. So a parent who had been thanked, asked their question
     * and told what happens next tapped "Review my answers" and landed on
     * *"Ask when you need help. Help when you can."*, mid-questionnaire, with a
     * dock reading "Review". CLAUDE.md's copy list carried this as an open
     * question — *"I did not trace what `screen_index` holds for a completed
     * session"* — and it holds 16 of 17.
     *
     * Keyed on `profile_saved_at` rather than a query parameter, because a URL
     * that changes what a screen does is the thing this app refuses (4 Aug) —
     * and because the stored fact is the better test anyway: it is true for
     * *any* return to a saved profile, not only for the one link that happens to
     * point here. An unfinished session is untouched: the field is null until
     * the profile is written, so resume still lands where they stopped.
     */
    if (!existing?.profile_saved_at) return;
    setStage("review");

    /**
     * A saved profile is re-read from the database, and the device copy loses.
     *
     * The client's report, 8 Sep: a parent coming back is shown what
     * `localStorage` holds rather than what Pando actually has. Both exist
     * because the flow is autosaved to the phone, and they diverge the moment
     * the same parent fills the form on a second device (the write is an upsert
     * on the number, invariant 10) or an admin corrects a record. Once the
     * profile is **in the database, the database owns it** — the phone is a
     * cache, and a cache that outranks the record is `persisted: false`
     * inverted.
     *
     * On mount only, deliberately, so it can never overwrite an edit somebody is
     * in the middle of making: it runs before the review is touched and never
     * again.
     *
     * Answers and the referral code, and nothing else. The name is not refreshed
     * because the server holds only a first name and `prev.name` is usually both
     * — replacing "Alice Probe" with "Alice" would be the record losing to a
     * narrower copy of itself. Anything the server could not answer (no cookie,
     * no database, a profile written before `raw_answers` was populated) leaves
     * the device copy exactly as it was: a refresh that fails is silence, never
     * an empty review.
     */
    void (async () => {
      const me = await fetchMe();
      if (!me.ok || !me.found || !me.profile_saved) return;
      setSession((prev) =>
        prev
          ? saveSession({
              ...prev,
              referral_code: me.referral_code ?? prev.referral_code,
              answers: me.answers
                ? pruneAnswers(normaliseAnswers(me.answers))
                : prev.answers,
            })
          : prev,
      );
    })();
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

  /**
   * How many screens a parent walks: the questions, plus the review.
   *
   * **One expression, because two of them disagreed.** Measured in the DOM: the
   * bar rendered `aria-valuemax="18"` while the live region announced *"Step 1
   * of 17"* — a sighted parent counting segments and a screen-reader user
   * hearing the total were given different denominators, and only one of them
   * could be right. Worse on the verification screen, which passed
   * `current={screens.length + 1}` and so reported **"Step 19 of 18"**: a bar
   * whose `valuenow` exceeds its own `valuemax`.
   *
   * The 3 Sep fix for the caregiver flow is the precedent — *"the bar and the
   * counter read from the same expression, so they cannot disagree"* — and this
   * flow never got it.
   *
   * **The code screen counts as the last step rather than an extra one**, and
   * that is deliberate: whether it appears at all depends on
   * `/verify/status`, which is fetched lazily at the end (13 Aug) and is
   * unknown while the questions are being answered. A denominator that grew by
   * one on the last screen would be a total that changed under the reader; a
   * denominator that assumed the screen would appear would leave the bar
   * permanently one segment short wherever verification is off. So review is
   * the last step, and entering the code is the act of saving it — the bar sits
   * full there rather than overflowing.
   */
  const totalSteps = screens.length + 1;

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

  /* Scroll to the top **and** move focus to the new screens heading. The
     scroll half was already here; the focus half was not, so a keyboard user
     stayed on a Continue button while everything around it silently changed.
     See `useStepChange` for why the first run is skipped. */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useStepChange(`${stage}:${index}`, headingRef);

  /* The pending auto-advance. A ref rather than state: nothing renders from it,
     and putting it in state would re-render the screen it is about to leave. */
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
  }, []);
  /* On unmount **and on every step change**: a timer left running across a Back
     tap would advance the parent off the screen they just went back to. */
  useEffect(() => clearAutoAdvance, [clearAutoAdvance, index, stage]);

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
  /**
   * ⚠⚠ **The second consent checkbox is gone, and its gate with it** — the
   * client, 10 Sep: *"On the participation screen, show frequency only. Do not
   * show a second checkbox."*
   *
   * The 2 Sep recurring opt-in lived on that screen and is now part of the
   * single consent on `/join` (see `SMS_CONSENT_TEXT`), so participation asks
   * one question again: how often. **Both halves had to go together** — a gate
   * left behind after its control is removed locks the dock on the last screen
   * of the flow with nothing on screen to explain why, which is the worst
   * version of this change and the one a careless removal produces.
   *
   * `recurring_messages` stays in `ProfileAnswers` and is simply never set from
   * here, on the same rule as `topics` and `listening_ear`: parents answered it
   * under the old build and deleting the field would throw away something they
   * actually said.
   */
  const unlocked = canAdvance(screen, answers);
  const isLast = index === screens.length - 1;
  /**
   * `questions.every(…)` on an empty array is `true`, so the two screens that
   * *state* rather than ask — the privacy explainer and the Pando promise — were
   * offering a Skip. There is nothing on them to skip, and the client asked for
   * it gone from the privacy one specifically (24 Aug, item 8). Continue is the
   * only action a statement screen has.
   */
  const optionalScreen =
    questions.length > 0 && questions.every((q) => !q.required);

  /**
   * *"Show progress as '3 left.'"* (the client, 10 Sep.)
   *
   * It replaces "12 of 14", which is a position rather than a distance —
   * arithmetic a parent has to do before it answers the question they are
   * actually asking, which is *how much more of this is there*. The bar below
   * still carries the position, so nothing is lost.
   *
   * ⚠ **It counts question screens and not the review**, deliberately: the
   * review is where the flow ends rather than one more thing to answer, and a
   * count that never reaches zero would make the last screen read "1 left"
   * under a button saying Review.
   */
  const screensLeft = screens.length - index - 1;

  /**
   * *"Auto-advance single-select screens."*
   *
   * Only where the tap is unambiguously the whole answer: one question on the
   * screen, single-select, and something now chosen. Everything else stays on
   * Continue, and each exclusion is a case where advancing would take the screen
   * away mid-answer —
   *
   *  - **more than one question on the screen** (the 9 Sep merges put two and
   *    three questions on four screens), or the parent answers the first and
   *    the second is gone;
   *    (a fourth exclusion stood here until 10 Sep — the participation screen,
   *    whose single-select level sat above a recurring-messages checkbox, so
   *    advancing on the level would have skipped a consent. That checkbox is
   *    now part of the single consent on `/join`, so the screen is a plain
   *    single-select and auto-advancing it takes nothing away.)
   *  - **a per-selection follow-up** (a school's Current/Former, whose child it
   *    is) — the tap opens a second question rather than finishing one;
   *  - **the last screen**, because "advance" there means the review, and
   *    arriving at a summary you did not ask for reads as having lost the flow.
   *
   * The delay is what makes it legible rather than abrupt: the chip has to be
   * seen to go green, or the screen appears to change for no reason. It is
   * cleared on unmount and on any further tap, so a parent who changes their
   * mind inside the window advances on their *second* choice and not their
   * first.
   */
  const autoAdvances =
    questions.length === 1 &&
    questions[0].kind === "single" &&
    !questions[0].perSelectionStatus &&
    !questions[0].perChild &&
    /* The consent that used to sit under the participation level is gone
       (10 Sep), so this exclusion is too — the screen is a plain single-select
       again and auto-advancing it takes nothing away. */
    !isLast;

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
        case "grew_up_here":
          a.grew_up_here = next[0] ?? null;
          break;
        case "attribution":
          a.attribution = next[0] ?? null;
          break;
        case "shared_connections":
          a.shared_connections = next[0] ?? null;
          break;
        case "allowance":
          a.allowance = next[0] ?? null;
          break;
        case "listening_ear":
          a.listening_ear = next[0] ?? null;
          break;
        case "child_ages": {
          a.child_ages = next.map(Number).sort((x, y) => x - y);
          /* A month belongs to a birth year, so untapping the year takes it —
             the same rule `school_status` follows, for the same reason: a
             month against a child nobody named is a fact about nothing, and it
             would be re-offered as a pre-filled answer if that year came back. */
          a.child_months = Object.fromEntries(
            Object.entries(s.answers.child_months).filter(([id]) =>
              next.includes(id),
            ),
          );
          break;
        }
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

    /* See `autoAdvances`. Cleared first, so a parent who taps twice inside the
       window advances on the second choice rather than being carried away by
       the first — which is the failure mode that makes an auto-advance feel
       like the screen taking the decision. */
    clearAutoAdvance();
    if (autoAdvances && next.length === 1) {
      autoAdvanceRef.current = setTimeout(() => {
        autoAdvanceRef.current = null;
        track("seed_screen_auto_advanced", { screen: screen.id });
        goNext();
      }, AUTO_ADVANCE_MS);
    }
  }

  /**
   * Which month a child was born in (3 Sep).
   *
   * Single-select and **optional**: the year is the required tap, and the
   * child-ages screen is one of only two required questions in the profile — so
   * a month that blocked the dock would put a measurable drop-off on the screen
   * every parent has to pass. Tapping the chosen month again clears it, which is
   * the one place this differs from a single-select chip elsewhere (3 Aug: a
   * radio keeps its choice), because here there is a real "I'd rather not say"
   * and no chip standing for it.
   */
  /** Keyed by the child's index since 10 Sep — see `removeChildAt`. */
  function setBirthMonth(index: number, month: string) {
    update((s) => {
      const months = { ...s.answers.child_months };
      if (months[String(index)] === Number(month)) delete months[String(index)];
      else months[String(index)] = Number(month);
      return { ...s, answers: { ...s.answers, child_months: months } };
    });
  }

  /**
   * The fork. Records the choice **and** advances in one step, because the
   * button is the answer — a screen that asked and then waited for Continue
   * would be two taps for one decision.
   */
  function chooseDetail(wants: boolean) {
    track(wants ? "seed_detail_opened" : "seed_detail_skipped", {
      screen: screen.id,
    });
    update((s) => ({
      ...s,
      answers: { ...s.answers, wants_detail: wants },
    }));
    goNext();
  }

  /**
   * Why a child is at no school. Tapping the chosen answer again clears it,
   * which is the only way back to the third state — "attends one of the schools
   * below" — and that state has no chip of its own because naming the school
   * *is* the answer.
   */

  /**
   * "Any child not at a school yet?" — the client, 10 Sep: *"Store None yet and
   * Homeschool as child statuses, not schools."*
   *
   * They were chips in the school list until now, so a homeschooling family
   * "attended" a school called Homeschool — a value `NON_ANSWERS` had to catch
   * on the way into the graph, and one no admin reading the row could tell from
   * a real school.
   *
   * ⚠ A function rather than JSX written where it is used, because the schools
   * question renders down **two** paths — one block per child for a family with
   * more than one, the ordinary list for a family with one — and it belongs on
   * both. Written inline it reached only the second, which is the family that
   * needs it least: with one child there is nothing to disambiguate, and the
   * family that has to say *which* child is not at a school never saw it.
   */
  function childSchoolStatusBlock(answers: ProfileAnswers) {
    return (
      <div className="mb-4 space-y-2">
        <p className="text-eyebrow font-semibold uppercase tracking-eyebrow text-muted">
          Any child not at a school yet?
        </p>
        {children.map((child) => {
          const chosen = answers.child_school_status[child.id];
          return (
            <div key={child.id} className={SUBBLOCK}>
              <p className="font-semibold text-control">
                Born {child.label}
              </p>
              <div
                role="group"
                aria-label={`School status for the child born ${child.label}`}
                className="mt-2 flex flex-wrap gap-2"
              >
                {CHILD_SCHOOL_STATUS.map((option) => {
                  const on = chosen === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setChildSchoolStatus(Number(child.id), option.id)
                      }
                      className={
                        on
                          ? "min-h-11 rounded-full border border-green bg-green-wash px-3.5 text-[14px] font-semibold text-green-deep"
                          : "min-h-11 rounded-full border border-bark px-3.5 text-[14px] font-medium text-ink-soft"
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="text-help leading-snug text-muted">
          Leave a child unmarked if they attend one of the schools below.
        </p>
      </div>
    );
  }


  function setChildSchoolStatus(index: number, status: string) {
    update((s) => {
      const next = { ...s.answers.child_school_status };
      if (next[String(index)] === status) delete next[String(index)];
      else next[String(index)] = status;
      return { ...s, answers: { ...s.answers, child_school_status: next } };
    });
  }

  function addChild(age: number) {
    update((s) => ({ ...s, answers: addChildAt(s.answers, age) }));
  }

  function removeChild(index: number) {
    update((s) => ({ ...s, answers: removeChildAt(s.answers, index) }));
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

  /**
   * One child's block changed (1 Sep, items 4 and 10).
   *
   * The arithmetic is in `applyChildSelections`, deliberately: it decides which
   * options survive and which children keep them, and getting that wrong would
   * silently re-attribute a school to the wrong sibling. A rule like that
   * belongs somewhere a test can reach it without a browser.
   *
   * The status map is trimmed with it, on the same rule the household path
   * follows: a Current/Former for a school nobody attends any more is a fact
   * about nothing.
   */
  function setChildSelections(question: Question, child: number, next: string[]) {
    update((s) => {
      const { values, attribution } = applyChildSelections(
        question,
        s.answers,
        child,
        next,
      );
      const a: ProfileAnswers = {
        ...s.answers,
        child_of: { ...s.answers.child_of, [question.id]: attribution },
        skipped: s.answers.skipped.filter((id) => id !== screen.id),
      };
      (a as unknown as Record<string, string[]>)[question.id] = values;
      if (question.id === "schools") {
        a.school_status = Object.fromEntries(
          Object.entries(s.answers.school_status).filter(([id]) =>
            values.includes(id),
          ),
        );
      }
      return { ...s, answers: a };
    });
  }

  /** Item 10's shortcut: every child gets what the family has named so far. */
  function applySameForAll(question: Question) {
    update((s) => {
      const { values, attribution } = sameForAllChildren(question, s.answers);
      const a: ProfileAnswers = {
        ...s.answers,
        child_of: { ...s.answers.child_of, [question.id]: attribution },
      };
      (a as unknown as Record<string, string[]>)[question.id] = values;
      return { ...s, answers: a };
    });
    track("seed_question_answered", {
      question: question.id,
      option: "same_for_all_children",
    });
  }

  /* ⚠ `setRecurringConsent` stood here until 10 Sep, with the checkbox it
     wrote for. Deleted rather than left unused: an exported writer with no
     caller is how a removed control comes back by accident. The field it
     wrote (`recurring_messages`) stays on ProfileAnswers for the rows that
     already carry it. */

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

  /**
   * Between confirming the number and writing the profile: does one already
   * exist on it?
   *
   * ## Why this is here and not on `/join`
   *
   * The client's report is that a number already in the database can register
   * again and nothing says so — and it is worse than a missing message: the
   * write is `onConflictDoUpdate` on `people.phone` (invariant 10), and every
   * derived set is **replaced rather than merged**, deliberately, so a parent
   * filling the form again from a second device silently overwrites the richer
   * profile they gave the first time.
   *
   * ⚠ **The obvious place to say it is the number field, and that place is
   * wrong.** `/join` takes a phone with nothing proving it belongs to whoever
   * typed it, so an answer there is an oracle: anybody could work through a
   * list of numbers and learn which of their neighbours is in the network. The
   * network *is* the asset, and who is in it is exactly what Pando does not
   * publish. So the question is only answered once the code has been confirmed,
   * which is the same proof `submitGate` requires before anything is stored —
   * and `GET /api/seed/me` reads the phone from that record rather than from
   * the request, so this cannot be asked about somebody else's number.
   *
   * It **asks rather than refuses**. Updating your own profile is legitimate
   * and is what the upsert is for; what was missing is the parent knowing that
   * is what will happen.
   *
   * A failed check falls through to saving. The parent has answered eighteen
   * screens and holds a confirmed code; blocking that on a read that did not
   * come back would turn a warning into an outage.
   */
  async function afterVerified(current: SeedSession) {
    const me = await fetchMe();
    if (me.ok && me.found && me.profile_saved) {
      setExisting({
        first_name: me.first_name ?? null,
        referral_code: me.referral_code ?? null,
      });
      track("seed_profile_exists_shown");
      return;
    }
    /* Every other outcome falls through to saving — see above: a warning that
       could not be fetched must not become a wall. `fetchMe` reports a failure
       as a state rather than throwing, so there is nothing to catch. */
    await persist(current);
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
      const code = result?.referral_code ?? null;
      update((s) => ({
        ...s,
        profile_saved_at: new Date().toISOString(),
        referral_code: code ?? s.referral_code,
      }));
      track("seed_profile_saved", {
        completeness: profileCompleteness(current.answers),
        persisted: result?.persisted ?? false,
      });
      /**
       * The code is kept and `/share` shows the popup — this screen does not.
       *
       * The first version returned a dialog over an **empty** screen here, and
       * the client's report was right: a modal with nothing behind it does not
       * read as a popup, it reads as a broken page. The parent is on their way
       * to `/share`, so that is the page the popup belongs on, and closing it
       * leaves them where they were already going.
       *
       * It also makes "once" fall out of the data rather than needing a second
       * mechanism: `/share` shows it while the session has a code that has not
       * been shown, so a re-save cannot bring it back and a reload mid-popup
       * still gets it.
       *
       * No code means no popup and no apology — on the held path (a deployment
       * that cannot send a code, or the anonymous route) nothing has been
       * written yet, so there is no link to give.
       */
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
              <Progress total={totalSteps} current={screens.length} />
            </div>
          }
        />
        <ScreenBody className="pt-2">
          <div className="animate-step-in">
            <Eyebrow>Last step</Eyebrow>
            <h1 ref={headingRef} tabIndex={-1} className="mt-2.5 font-display text-[1.7rem] font-bold">
              Confirm your number and this is saved.
            </h1>
            {/**
              * Her line, 10 Sep: *"One quick check" / "Nothing has left this
              * phone yet." → "Verify your number to save your profile."*
              *
              * The two it replaces said what the screen was not doing; hers
              * says what it is for, which is the only question a parent has
              * with a code box in front of them. The eyebrow moved with it:
              * "One quick check" was the other half of the same evasion.
              */}
            <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">
              Verify your number to save your profile.
            </p>
          </div>

          {existing ? (
            <ExistingProfile
              firstName={existing.first_name}
              busy={saving}
              onReplace={() => {
                setExisting(null);
                void persist({ ...session, phone_verified: true });
              }}
              onKeep={() => {
                /* Nothing is written. The session is marked finished so `/done`
                   treats them as the returning parent they are, and carries the
                   link `/api/seed/me` just handed back. */
                update((s) => ({
                  ...s,
                  /* The stored name, not the one they just typed: they chose to
                     keep the profile, so "Thank you, Alice Probe" on the next
                     screen would greet them as the version they discarded. */
                  name: existing.first_name ?? s.name,
                  first_name: existing.first_name ?? s.first_name,
                  last_name: existing.first_name ? null : s.last_name,
                  profile_saved_at: s.profile_saved_at ?? new Date().toISOString(),
                  referral_code: existing.referral_code ?? s.referral_code,
                  referral_shown_at: s.referral_shown_at ?? new Date().toISOString(),
                }));
                track("seed_profile_exists_kept");
                router.push("/done");
              }}
            />
          ) : editingPhone !== null ? (
            /**
             * 9 Sep — correcting the number the code goes to.
             *
             * Her second UX note, and until now this flow had no answer to it
             * at all: the number was typed on `/join`, eighteen screens back,
             * and a parent who mistyped a digit reached this screen, sent a code
             * to a phone they do not hold, and had nowhere to go. Back leads to
             * the review, not to `/join`.
             *
             * ⚠ **The duplicate check on `/join` is not re-run here**, and it
             * does not need to be: `afterVerified` reads `/api/seed/me` after a
             * confirmed code and shows the "you already have a profile" panel
             * (8 Sep), which is the same check one step later and the one that
             * cannot be walked around.
             */
            <ChangeNumber
              initial={session.phone}
              onCancel={() => setEditingPhone(null)}
              onSave={(e164) => {
                update((s) => ({ ...s, phone: e164, phone_verified: false }));
                setEditingPhone(null);
                track("seed_verify_number_changed");
              }}
            />
          ) : (
            <VerifyPhone
              /* Remounted when the number changes, or a code already sent to
                 the old one leaves the box waiting for something that will
                 never arrive. */
              key={session.phone}
              phone={session.phone}
              onChangeNumber={() => setEditingPhone(session.phone)}
              onVerified={() => {
                const verified: SeedSession = { ...session, phone_verified: true };
                saveSession(verified);
                setSession(verified);
                track("seed_verified", { at: "profile_end" });
                void afterVerified(verified);
              }}
            />
          )}

          {saving && (
            <p role="status" className="mt-4 text-[13.5px] text-muted">
              Saving your answers…
            </p>
          )}
          {saveError && (
            <Note className="mt-4">{saveError}</Note>
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
              <Progress total={totalSteps} current={screens.length} />
            </div>
          }
        />
        <ScreenBody>
          <div className="animate-step-in">
            <Eyebrow>Almost done</Eyebrow>
            <h1 ref={headingRef} tabIndex={-1} className="mt-2.5 font-display text-[1.7rem] font-bold">
              Does this look right?
            </h1>
            <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
              This is only used to match you with parents whose lives overlap
              with yours. None of it is shown to anyone.
            </p>

            {/**
             * *"On review, show completed answers first and collapse skipped
             * fields under 'Optional details not added.'"* (10 Sep.)
             *
             * The list used to run in flow order, so a parent who skipped six
             * optional questions read six rows of *Skipped* scattered through
             * their own answers — which makes a screen whose job is *does this
             * look right* read as a list of things they got wrong.
             *
             * ⚠ **Nothing is hidden that a parent must act on**: a required
             * question cannot be unanswered here, because the dock would not
             * have let them past it, so every row in the collapsed group is
             * genuinely optional. Each one keeps its own **Add** button inside
             * the group, so adding a skipped answer is one tap further away
             * rather than unreachable.
             *
             * A `<details>`, for the reasons `Disclosure` uses one: it works
             * before hydration, find-in-page opens it, and it needs nothing
             * remembered. Closed on arrival — that is the whole point — and the
             * count is in the summary, because *how many* is what a parent
             * decides whether to open on.
             */}
            {(() => {
            const rows = screens.flatMap((s) =>
                visibleQuestions(s, answers).map((q) => {
                  /**
                   * ⚠ The children are read off the list rather than through
                   * `selectionsFor` (10 Sep). Two siblings born in one year are
                   * two entries with the same option id, so a per-option map
                   * would collapse them back into the one child this screen
                   * exists to let a parent notice is missing — and the month is
                   * keyed by position now, which an option id cannot supply.
                   */
                  const values = q.kind === "ages"
                    ? answers.child_ages.map((age, index) => {
                        if (age === EXPECTING) return "Expecting";
                        const year = String(CURRENT_YEAR - age);
                        const month = MONTH_OPTIONS.find(
                          (m) => Number(m.id) === answers.child_months[String(index)],
                        )?.label;
                        return month ? `${year} (${month})` : year;
                      })
                    : [
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
                  return {
                    key: `${s.id}-${q.id}`,
                    label: q.label ?? s.eyebrow,
                    values,
                    screenId: s.id,
                  };
                }),
              );
            const answered = rows.filter((r) => r.values.length > 0);
            const notAdded = rows.filter((r) => r.values.length === 0);

            /* One row renderer for both groups, or the collapsed half drifts
               from the visible one — which on this screen would mean a parent's
               skipped answers being editable in a way their given ones are
               not. */
            const row = (r: (typeof rows)[number]) => (
              <div key={r.key} className="flex gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <dt className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {r.label}
                  </dt>
                  <dd
                    className={
                      r.values.length
                        ? "mt-1 text-[15.5px] leading-snug"
                        : "mt-1 text-[15.5px] italic text-muted"
                    }
                  >
                    {r.values.length ? r.values.join(" · ") : "Not added"}
                  </dd>
                </div>
                {/* Named, because there are up to 23 of these down the
                    review list and a screen reader otherwise hears
                    "Edit" twenty-three times with nothing telling them
                    which row they are on. `Bubble`'s per-row Edit already
                    did this; this list did not. */}
                <TextAction
                  underline={false}
                  onClick={() => jumpTo(r.screenId)}
                  aria-label={`${r.values.length ? "Edit" : "Add"}: ${r.label}`}
                  className="shrink-0 self-center px-3"
                >
                  {r.values.length ? "Edit" : "Add"}
                </TextAction>
              </div>
            );

            return (
              <>
                {/* `as="dl"`: the review screen is a definition list, and the
                    rows supply their own dividers — hence `flush`. */}
                <Panel as="dl" flush className="mt-6 divide-y divide-bark/70">
                  {answered.map(row)}
                </Panel>

                {notAdded.length > 0 && (
                  <details className="group mt-4">
                    {/* `display: flex` is what actually removes the disclosure
                        triangle — a summary is `display: list-item` by default,
                        and once it is a flex box no marker is generated at all.
                        `list-none` is the belt, and the WebKit pseudo-element is
                        the braces for older Safari. Measured: `::marker` content
                        is `normal` and nothing renders. */}
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-1 text-[13.5px] font-semibold text-muted [&::-webkit-details-marker]:hidden">
                      <svg
                        viewBox="0 0 10 10"
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 transition-transform group-open:rotate-90"
                        fill="none"
                      >
                        <path
                          d="M3 1.5 6.5 5 3 8.5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Optional details not added ({notAdded.length})
                    </summary>
                    <Panel
                      as="dl"
                      flush
                      className="mt-2 divide-y divide-bark/70"
                    >
                      {notAdded.map(row)}
                    </Panel>
                  </details>
                )}
              </>
            );
            })()}

            {/**
              * Her item 14, and it is a reminder rather than a rule — the logic
              * is unchanged.
              *
              * A parent who chose to stay private has, seven screens earlier,
              * answered a question about *credit*. What they may not have
              * carried this far is that their recommendation is still used —
              * only the name is withheld. Saying it here, on the screen before
              * everything is saved, is the last honest moment to say it.
              *
              * ⚠ It also fires for a parent who **skipped** the question, and
              * that is the more important half: skipping defaults to private
              * server-side (`derive.ts` fails closed to anonymous), so they are
              * private without ever having read what that means.
              *
              * Green rather than gold: this is reassurance about a choice that
              * is working, not a warning about one that needs attention.
              */}
            {(answers.attribution === "name_private" ||
              answers.attribution === null) && (
              <Panel as="p" tone="positive" size="inset" className="mt-5 leading-relaxed text-green-deep text-help">
                Your name stays private. What you recommend can still be used in
                answers to other parents — never with your name on it.
              </Panel>
            )}

            <p className="mt-5 text-[13.5px] leading-relaxed text-muted">
              You can change any of this later — just text Pando once your
              neighborhood goes live.
            </p>
          </div>
        </ScreenBody>
        <ScreenDock>
          {saveError && (
            <Note className="mb-3">{saveError}</Note>
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
          /* ⚠ **Skip is not here any more**, and that is the client's *"Put Skip
             in the same place"*: this slot held Skip on an optional screen and
             the counter on a required one, so the one control a parent reaches
             for when a question does not apply to them moved, appeared and
             disappeared as they walked the flow. It is in the dock now, in one
             fixed slot under Continue, and this slot is always the count. */
          <span className="px-1 font-medium text-muted text-dock">
            {screensLeft > 0 ? `${screensLeft} left` : "Last one"}
          </span>
        }
        below={
          <div className="mt-1">
            <Progress total={totalSteps} current={index} />
          </div>
        }
      />

      <ScreenBody>
        {/* Outside the keyed div on purpose: a live region has to be in the
            document *before* its content changes, and anything inside that div
            is remounted on every step — which is precisely the mistake
            `TypingDots` already paid for. Focus moving to the heading is the
            other half; this is what says where it moved *to*. */}
        <p className="sr-only" role="status">
          {`Step ${index + 1} of ${totalSteps} — ${screen.title}`}
        </p>
        {/**
         * The first time a step in this app can *leave*.
         *
         * It was a keyed `<div>` with `animate-step-in` — an entrance only, so
         * the old question was gone between two frames while the new one slid
         * in over it. `animate-step-in-back` exists because that is the most CSS
         * can express; `AnimatePresence` is what the back-direction keyframe was
         * standing in for.
         *
         * `mode="popLayout"` so the outgoing screen is taken out of flow rather
         * than stacked above the incoming one, which on a phone would double the
         * page height for a third of a second and jump the dock.
         *
         * ⚠ This changes *when* a step unmounts. Autosave runs on every tap, so
         * nothing can be lost in the gap — but the screen is walked by hand
         * rather than trusted to the types.
         */}
        <MotionProvider>
        {/**
         * A one-cell grid, and it is load-bearing rather than styling.
         *
         * `mode="popLayout"` was the obvious choice and does not work here: it
         * needs layout projection, which lives in `domMax` and not in the
         * `domAnimation` feature set this app loads — the outgoing step simply
         * never unmounted, and both questions stayed on screen. Measured, not
         * reasoned about.
         *
         * Stacking both steps in the same grid cell gets the same result for
         * nothing: the container takes the height of the taller one, so the dock
         * cannot jump, and the two cross-slide in place.
         */}
        <div className="grid">
        <AnimatePresence initial={false}>
          <m.div
            key={screen.id}
            className="[grid-area:1/1]"
            initial={{ opacity: 0, x: direction * 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -14 }}
            transition={STEP}
          >
          <Eyebrow>{screen.eyebrow}</Eyebrow>
          <h1 ref={headingRef} tabIndex={-1} className="mt-2.5 font-display text-[1.7rem] font-bold">
            {screen.title}
          </h1>
          {screen.help && (
            <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
              {screen.help}
            </p>
          )}

          {/* Stated, not asked: the privacy disclosure and the Pando promise. */}
          {screen.statement && (
            <Panel className="mt-6">
              {screen.statement.body.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 24)}
                  className="mt-3 text-[15.5px] leading-relaxed text-ink-soft first:mt-0"
                >
                  {paragraph}
                </p>
              ))}
              {/* Quoted, indented and in the reading face: these are sentences
                  another parent would actually receive, and the whole point of
                  showing them is that they read as a message rather than as our
                  description of one. */}
              {screen.statement.examples && (
                <ul className="mt-3 space-y-2 border-l-2 border-green/30 pl-3.5">
                  {screen.statement.examples.map((example) => (
                    <li
                      key={example.slice(0, 24)}
                      className="text-[15.5px] leading-relaxed text-ink"
                    >
                      {example}
                    </li>
                  ))}
                </ul>
              )}
              {/* After the examples, because it answers the question they
                  raise: they show a connection being named and say nothing
                  about what stays private. */}
              {screen.statement.bodyAfter?.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 24)}
                  className="mt-3 text-[15.5px] leading-relaxed text-ink-soft"
                >
                  {paragraph}
                </p>
              ))}
              {screen.statement.link && (
                <p className="mt-3.5">
                  {/* A new tab, deliberately: this screen sits mid-flow and the
                      answers are held on the phone, so navigating away and back
                      is a resume the parent did not ask for. */}
                  <TextAction href={screen.statement.link.href} external>
                    {screen.statement.link.label}
                  </TextAction>
                </p>
              )}
              {screen.statement.note && (
                <Panel
                  as="p"
                  tone="positive"
                  size="inset"
                  className="mt-4 font-medium leading-relaxed text-green-deep text-help"
                >
                  {screen.statement.note}
                </Panel>
              )}
            </Panel>
          )}

          {/* Under the questions, not over them: the client's caveat on the
              per-affiliation control belongs *after* the decision it qualifies.
              Rendered as text rather than a tooltip, because it is the one thing
              the control cannot promise. */}
          <div className="mt-6 space-y-8">
            {questions.map((question) => {
              /* One per child, for the questions that belong to a child. See
                 `maxSelectionsFor` — the cap is what makes the "whose is it?"
                 picker below answerable instead of a guess. */
              const max = maxSelectionsFor(question, answers);
              /**
               * Whether this question is a *directory* or a chip list (item 7).
               *
               * Four categories carry hundreds of records now, so the chips are
               * a curated starter set and the rest is reached by search. The
               * others — neighborhoods, camps, parent groups — are short enough
               * to show whole, and have no starters curated, so searching them
               * would offer a box that finds only what is already on screen.
               */
              const directory = searchableCategory(question);
              const shared = {
                label: questions.length > 1 ? question.label : undefined,
                /* Its own instruction, beside its own label — the merged
                   screens of 9 Sep carry two questions with two different
                   ones, which is what `Question.help` exists for. */
                help: question.help,
                groupLabel: question.label ?? screen.title,
                mode: (question.kind === "single" ? "single" : "multi") as
                  | "single"
                  | "multi",
                options: optionsFor(question, market, answers),
                selected: selectionsFor(question, answers),
                max,
                maxHint: maxSelectionHint(question, answers),
                onChange: (next: string[], changed: { id: string; on: boolean }) => {
                  setSelections(question, next);
                  if (changed.on) {
                    track("seed_question_answered", {
                      question: question.id,
                      option: changed.id,
                    });
                  }
                },
                custom: customEntriesFor(question, answers),
                otherLabel: question.allowOther ? question.otherLabel : undefined,
                onAddCustom: question.allowOther
                  ? (value: string) => addCustom(question, value)
                  : undefined,
                onRemoveCustom: (value: string) => removeCustom(question, value),
              };
              /**
               * 1 Sep, items 4 and 10 — one block per child.
               *
               * Empty for every other question and for a one-child family, and
               * then this whole branch is skipped and nothing about the
               * ordinary rendering below changes.
               *
               * **The typed fallback stays at question level.** A parent can
               * add from any block and the answer is stored unattributed —
               * which is not a regression, because a typed school has never
               * carried a child either. Only the last block renders the list of
               * typed answers, so it appears once.
               */
              /**
               * ⚠⚠ **Hoisted above the per-child branch, and it was rendering
               * for exactly the wrong families** (10 Sep).
               *
               * *"Store None yet and Homeschool as child statuses, not
               * schools."* The block below was written inside the ordinary
               * `-group` return — and `childBlocks` returns early for any
               * family with **more than one child**, so the two statuses
               * appeared only for a one-child family. That is backwards twice
               * over: with one child there is nothing to disambiguate, and the
               * family that actually needs to say *which* child is not at a
               * school is the one that never saw the control.
               *
               * Found by walking the screen with two children rather than by
               * reading, because both branches look complete on their own.
               */
              const childStatus =
                question.id === "schools" && children.length > 0
                  ? childSchoolStatusBlock(answers)
                  : null;

              const blocks = childBlocks(question, market, answers);
              if (blocks.length > 0) {
                return (
                  <div key={`${question.id}-perchild`} className="space-y-6">
                    {childStatus}
                    {/**
                      * The question's label and its instruction, once, above
                      * every block — because they are true of the whole run and
                      * not of one child.
                      *
                      * Each block renders the shared props with `label` and
                      * `help` blanked, so before this the instruction appeared
                      * **once per child**: "Select all regular care
                      * arrangements that apply." twice on a two-child screen,
                      * which is the repetition this repo has already paid for
                      * on the admin's record queues. And with the 9 Sep merge
                      * putting a second question underneath, a per-child
                      * question with no label at all sat above one that had
                      * one.
                      */}
                    {(shared.label || question.help) && (
                      <div className="space-y-1">
                        {shared.label && (
                          <p className="font-semibold uppercase text-eyebrow tracking-eyebrow text-muted">
                            {shared.label}
                          </p>
                        )}
                        {question.help && (
                          <p className="leading-relaxed text-muted text-help">
                            {question.help}
                          </p>
                        )}
                      </div>
                    )}
                    {question.sameForAll && (
                      <TextAction
                        onClick={() => applySameForAll(question)}
                        disabled={selectionsFor(question, answers).length === 0}
                      >
                        {question.sameForAll}
                      </TextAction>
                    )}
                    {blocks.map((block, blockIndex) => {
                      const last = blockIndex === blocks.length - 1;
                      const perChild = {
                        ...shared,
                        label: undefined,
                        /* Both live above the run of blocks — see the note
                           there. Left on, the instruction repeats once a child. */
                        help: undefined,
                        groupLabel: block.heading,
                        options: block.options,
                        selected: block.selected,
                        /* The cap is a family total; per block it would refuse a
                           tap that the question actually allows. */
                        max: undefined,
                        maxHint: undefined,
                        custom: last ? customEntriesFor(question, answers) : [],
                        onChange: (
                          next: string[],
                          changed: { id: string; on: boolean },
                        ) => {
                          setChildSelections(question, block.child, next);
                          if (changed.on) {
                            track("seed_question_answered", {
                              question: question.id,
                              option: changed.id,
                            });
                          }
                        },
                      };
                      return (
                        <div key={`${question.id}-${block.child}`}>
                          {/* `h2`, not `h3` (9 Sep). These blocks are the only
                              headings under the screen's `h1`, so an `h3` made
                              the document jump a level on both per-child
                              screens — the same fault the admin's record queues
                              were fixed for on 7 Sep, one surface along. Size is
                              unchanged; only the tag is. */}
                          <h2 className="mb-2.5 text-[15px] font-semibold text-ink">
                            {block.heading}
                          </h2>
                          {directory ? (
                            <SearchableChipGroup
                              {...perChild}
                              category={directory.category}
                              market={market}
                              area={answers.neighborhood}
                              wholeList={directory.wholeList}
                  dropdown={directory.dropdown}
                              searchLabel={directory.searchLabel}
                              footnote={last ? directory.footnote : undefined}
                            />
                          ) : question.source.type === "market" ||
                            question.dropdown ? (
                            <OptionPicker
                              {...perChild}
                              /* The block's own heading, not the question's
                                 label: one screen carries a box per child, and
                                 naming all of them "Regular care — choose from
                                 the list" would give a screen-reader user two
                                 controls with one name. */
                              searchLabel={block.heading}
                              placeholder={pickerPlaceholder(question)}
                              wrapLabels={question.dropdown}
                            />
                          ) : (
                            <ChipGroup {...perChild} layout="wrap" />
                          )}
                        </div>
                      );
                    })}
                    {/* Per selection, not per child: a school's Current/Former
                        belongs to the school. Rendered once, under all the
                        blocks, over the union of what they chose. */}
                    {question.perSelectionStatus &&
                      selectionsFor(question, answers).length > 0 && (
                        <div className="space-y-2.5">
                          <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
                            {question.perSelectionStatus.label}
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
                                className={SUBBLOCK}
                              >
                                <p className="font-semibold text-control">
                                  {optionLabel}
                                </p>
                                <div
                                  role="radiogroup"
                                  aria-label={`Status for ${optionLabel}`}
                                  className="mt-2 flex flex-wrap gap-2"
                                >
                                  {question.perSelectionStatus!.options.map((status) => {
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
                              </div>
                            );
                          })}
                        </div>
                      )}
                  </div>
                );
              }

              /**
               * A question whose options carry a `plan` is a comparison, not a
               * row of chips (9 Sep — the participation screen).
               *
               * Keyed on the **data** rather than on the question id, so the
               * next question she wants presented this way is a `plan` block in
               * `questions.ts` and nothing here changes — the same rule the
               * directory branch below follows.
               */
              const plans = shared.options.every((o) => o.plan);

              return (
              <div key={`${question.id}-group`}>
              {childStatus}
              {plans ? (
                <PlanGroup
                  key={question.id}
                  options={shared.options}
                  selected={shared.selected}
                  onChange={shared.onChange}
                  groupLabel={shared.groupLabel}
                />
              ) : directory ? (
                <SearchableChipGroup
                  key={question.id}
                  {...shared}
                  category={directory.category}
                  market={market}
                  /* Ranking hint only. Null before P3 is answered, which simply
                     ranks nothing higher. */
                  area={answers.neighborhood}
                  /* The neighborhood question sets the area, so it cannot be
                     filtered by it — see `wholeList`. */
                  wholeList={directory.wholeList}
                  dropdown={directory.dropdown}
                  searchLabel={directory.searchLabel}
                  footnote={directory.footnote}
                />
              ) : question.source.type === "market" || question.dropdown ? (
                /**
                 * A market question with no directory behind it — camps — and,
                 * since 9 Sep, a static question that asked for a dropdown.
                 *
                 * The second is her instruction that long option lists become a
                 * compact control, and it reuses this rather than growing a
                 * second dropdown: a closed list of eleven and a directory of
                 * hundreds want the same box, and two boxes would be two things
                 * to keep in step. What differs is only the placeholder, since
                 * there is nothing to *search* in a closed list — see
                 * `pickerPlaceholder`.
                 *
                 * It gets the dropdown too, and the reason is the screen rather
                 * than the question: camps sits between classes, clubs and faith
                 * on one page, and leaving it as the single wall of buttons
                 * among three dropdowns is exactly the "some do, some don't"
                 * the client has already reported once on the admin.
                 *
                 * Deliberately **not** routed through `SearchableChipGroup`:
                 * that would also apply the area trimming and the twelve-item
                 * cap, which camps has never had. This changes how the options
                 * are presented and not which ones are offered.
                 */
                <OptionPicker
                  key={question.id}
                  {...shared}
                  searchLabel={pickerLabel(question)}
                  placeholder={pickerPlaceholder(question)}
                  wrapLabels={question.dropdown}
                />
              ) : question.kind === "ages" ? (
                /**
                 * ⚠ **A list, not a chip set** (10 Sep). A grid of birth-year
                 * chips is a *set*, so a second child born in the same year
                 * deselected the first — see `ChildList` for what that cost.
                 * The client asked for one Child record per child, "Add another
                 * child", and duplicate years allowed; none of those is
                 * expressible in a multi-select.
                 */
                <ChildList
                  key={question.id}
                  answers={answers}
                  labels={children}
                  onAdd={addChild}
                  onRemove={removeChild}
                  onMonth={setBirthMonth}
                />
              ) : (
              <ChipGroup key={question.id} {...shared} layout="wrap" />
              )}

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
                          className={SUBBLOCK}
                        >
                          <p className="font-semibold text-control">{optionLabel}</p>

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
            <Panel
              as="p"
              tone="positive"
              size="inset"
              className="mt-8 leading-relaxed text-green-deep text-help"
            >
              That&apos;s both required questions. Everything after this is
              optional — it just sharpens who Pando asks on your behalf.
            </Panel>
          )}

          {/**
           * Under the questions, not over them.
           *
           * The per-affiliation privacy screen carries the client's caveat —
           * "Members may sometimes be able to guess who you are, particularly in
           * a small community." It belongs *after* the decision it qualifies,
           * and as text: it is the one thing that control cannot promise, so
           * hiding it in a tooltip would make the consent less informed than she
           * asked for.
           *
           * Neutral styling, deliberately. In green it reads as reassurance and
           * in gold as a warning; it is neither, it is the honest limit. That
           * argument is `Panel`'s `tone="quiet"` now — this comment is where the
           * tone came from, and the register had existed here without a name
           * since the day it was written.
           */}
          {screen.footnote && (
            <Panel
              as="p"
              tone="quiet"
              size="inset"
              className="mt-7 leading-relaxed text-ink-soft text-help"
            >
              {screen.footnote}
            </Panel>
          )}

          {/**
           * The recurring SMS/RCS opt-in, immediately above the dock — where she
           * asked for it, and where a consent belongs: adjacent to the action it
           * describes rather than a screen away from it.
           *
           * The `<label>` covers only the sentence being agreed to and the
           * carrier disclosure sits beside it tied by `aria-describedby` — the
           * rule `Consent` now enforces rather than four comments asking for it.
           *
           * Her "Terms · Privacy", as the site's own pages, and in a new tab
           * because the answers are held on this phone and navigating away
           * mid-flow is a resume the parent did not ask for. They are the
           * component's `links` row rather than an inline `" · "`: at 375px that
           * row always wraps, and an inline separator is left dangling at the end
           * of a line — `/join` had already found that and the fix had not
           * travelled the two files.
           */}
          {/* ⚠ The recurring-messages checkbox stood here until 10 Sep.
              *"Do not show a second checkbox"* — it is one consent on
              /join now (see SMS_CONSENT_TEXT), so this screen shows the
              frequency table and nothing else. */}
          </m.div>
        </AnimatePresence>
        </div>
        </MotionProvider>
      </ScreenBody>

      <ScreenDock>
        {screen.fork ? (
          /**
           * ⚠ **Two ways on, and Continue is the primary one** (10 Sep).
           *
           * The client's framing is that the detail is worth giving, not that
           * it is expected — *"Continue skips all optional details"* — so the
           * loud button is the one that skips. Making "Add optional details"
           * primary would read as the intended answer and turn an offer into a
           * hurdle, which is the thing this screen exists to remove.
           *
           * Both are recorded, and `false` is a real stored value rather than an
           * absence: it is what stops the optional screens reappearing on the
           * next visit for somebody who has already declined them once.
           */
          <div className="space-y-2.5">
            <Button full onClick={() => chooseDetail(false)}>
              {screen.fork.continueLabel}
              <ArrowRight />
            </Button>
            <Button full variant="secondary" onClick={() => chooseDetail(true)}>
              {screen.fork.detailLabel}
            </Button>
            <p className="pb-3 pt-1 text-center text-[12.5px] text-muted">
              You can add any of it later.
            </p>
          </div>
        ) : (
        <>
        {/**
         * ⚠ **Continue is enabled on every optional screen and always was** —
         * `canAdvance` locks the dock only where a question on the screen is
         * `required`, and there are three of those in the whole flow
         * (neighborhood, the children's ages, the participation level). The
         * client's *"Keep Continue enabled"* is therefore already true, and
         * what made an optional question *feel* required is the two things
         * either side of this button, which are what changed: a Skip that moved
         * around the screen, and a counter that named a position rather than a
         * distance.
         *
         * It is left disabled where a required answer is missing, and that is
         * the one reading of her instruction not taken: a Continue that does
         * nothing when tapped is worse than one that is visibly not ready, and
         * the line below says which answer is missing.
         */}
        <Button full onClick={goNext} disabled={!unlocked}>
          {isLast ? "Review" : "Continue"}
          <ArrowRight />
        </Button>
        {/* One fixed slot, under Continue, on every screen. The height is held
            whether or not it holds anything, so the sentence below it does not
            move between a skippable screen and a required one — which is the
            other half of "the same place". */}
        <div className="flex min-h-11 items-center justify-center">
          {optionalScreen && (
            <TextAction tone="quiet" onClick={skipScreen} className="px-3">
              Skip this one
            </TextAction>
          )}
        </div>
        <p className="pb-3 text-center text-[12.5px] text-muted">
          {/* "Nothing here fits? Skip it — no harm done." was removed on the
              client's instruction (24 Aug, item 9): the Skip control says it,
              and a line inviting a parent to skip the screen they are reading
              works against the screen. */}
          {/* One reason left. The second — "Tick the box above to join" —
              went with the consent checkbox on 10 Sep; a sentence naming a
              control that is not on the screen is the fault this repository
              records under three names. */}
          {!unlocked
            ? "Pick one to keep going"
            : "Autosaved. You can close this and come back."}
        </p>
        </>
        )}
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

/**
 * Correcting the number before the code goes out (9 Sep, her second UX note).
 *
 * A panel rather than a route back to `/join`: that screen is the whole
 * name-and-consent card and re-entering it mid-flow would ask a parent who has
 * answered eighteen questions to agree to everything again. What is being
 * changed is one field, so one field is what is on screen.
 *
 * Three rules worth keeping. It seeds from the **stored** number, formatted
 * nationally, so nobody retypes what is already right. It refuses to save an
 * incomplete number rather than storing a half one — `phone_verified` is
 * cleared by the caller on save, so a half number would leave the flow unable
 * to finish at the one step that finishes it. And Cancel leaves the stored
 * number exactly as it was, which is what makes opening this to *check* the
 * number costless.
 */
function ChangeNumber({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (e164: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() => formatPhone(initial));
  const e164 = toE164(value);
  const ready = isPhoneComplete(value) && e164 !== null && e164 !== initial;

  return (
    <Panel className="mt-7" tone="card" raised>
      <h2 className="font-display text-card-title font-semibold">
        Which number should the code go to?
      </h2>
      {/* `PhoneField` renders its own label — wrapping it in `Field` would give
          the input two, and its accessible name would be both concatenated. */}
      <div className="mt-3">
        <PhoneField label="Mobile number" value={value} onChange={setValue} />
      </div>
      <p className="mt-2 text-muted text-help">
        Your answers stay on this phone either way.
      </p>
      <Button className="mt-4" full disabled={!ready} onClick={() => onSave(e164!)}>
        Send the code here
      </Button>
      <TextAction full className="mt-2" tone="quiet" onClick={onCancel}>
        Keep the number I gave
      </TextAction>
    </Panel>
  );
}

/**
 * "This number already has a profile" — the choice, not a refusal.
 *
 * The parent has just proved the number is theirs, so re-filling the form is a
 * legitimate thing to be doing and the upsert is what invariant 10 asks for.
 * What was missing is that the write **replaces** every derived set, on purpose
 * (a parent who removes a school must stop matching on it) — so a second pass
 * with fewer answers quietly loses the richer profile, and nothing said so.
 *
 * ⚠ Both options are safe and neither is destructive by accident: keeping
 * writes nothing at all, and replacing is the behaviour that already existed,
 * now chosen rather than stumbled into. `Replace` is the primary because it is
 * what somebody who has just answered eighteen screens almost certainly wants.
 *
 * ⚠ The wording is new user-facing copy and is on the list for the client.
 */
function ExistingProfile({
  firstName,
  busy,
  onReplace,
  onKeep,
}: {
  firstName: string | null;
  busy: boolean;
  onReplace: () => void;
  onKeep: () => void;
}) {
  return (
    <Panel tone="warning" className="mt-7">
      <h2 className="font-display text-card-title font-semibold text-gold-ink">
        {firstName
          ? `You already have a profile, ${firstName}.`
          : "You already have a profile."}
      </h2>
      <p className="mt-2 text-control leading-relaxed text-ink-soft">
        This number is already in Pando. Saving now replaces what is on it with
        the answers you have just given — including anything you skipped this
        time.
      </p>
      <Button className="mt-4" full disabled={busy} onClick={onReplace}>
        {busy ? "Saving…" : "Replace it with these answers"}
      </Button>
      <TextAction full className="mt-2" tone="quiet" disabled={busy} onClick={onKeep}>
        Keep what I had
      </TextAction>
    </Panel>
  );
}
