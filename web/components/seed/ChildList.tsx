"use client";

import { BIRTH_YEAR_OPTIONS, MONTH_OPTIONS, MAX_CHILDREN } from "@/lib/questions";
import { EXPECTING } from "@/lib/types";
import type { ProfileAnswers } from "@/lib/types";

/**
 * "Add each child's birth year." — the client's heading, and her data model
 * underneath it (10 Sep).
 *
 * ## Why this replaced a chip multi-select, which is not a presentation change
 *
 * The birth years were a grid of chips, so the answer was a **set**: tapping
 * 2019 twice deselected it. A family with twins, or with two children born in
 * one calendar year, could not say so — and nothing on screen suggested they had
 * failed to, because one chip was all the control offered. `childrenFromAges`
 * maps the stored array 1:1 onto `children` rows, so Pando recorded one child
 * and matched them as a one-child family for ever.
 *
 * This is a **list**: one row per child, added in order, duplicates allowed,
 * removable. Her instruction was "create one Child record per child", and a
 * list is the only control whose shape says that.
 *
 * ## Three rules worth keeping
 *
 * **A child is added by choosing their year, not by an empty row.** "Add another
 * child" that appends a blank waiting to be filled means `child_ages` briefly
 * holds a child with no birth year, and the required question is answered by a
 * row that answers nothing. The year picker *is* the add button.
 *
 * **The index is the identity, so removal re-keys** (`removeChildAt`). Two
 * children born the same year are told apart by nothing else.
 *
 * **The month is offered per row and never required.** The ages screen is one of
 * only two required questions in the flow, and every extra required field on it
 * is measurable drop-off (3 Sep). It is refused outright on an expecting row,
 * because `children_month_needs_year` refuses a month with no year and the
 * question would be asking when a baby was born who has not been.
 */
export function ChildList({
  answers,
  onAdd,
  onRemove,
  onMonth,
  labels,
}: {
  answers: ProfileAnswers;
  onAdd: (age: number) => void;
  onRemove: (index: number) => void;
  onMonth: (index: number, month: string) => void;
  /** `childOptions` — index → the year, disambiguated where two children share one. */
  labels: { id: string; label: string }[];
}) {
  const children = answers.child_ages;
  const full = children.length >= MAX_CHILDREN;
  const labelFor = (index: number) =>
    labels.find((l) => l.id === String(index))?.label ?? null;

  return (
    <div>
      {children.length > 0 && (
        <ul className="space-y-2.5">
          {children.map((age, index) => {
            const expecting = age === EXPECTING;
            const heading = expecting
              ? "On the way"
              : (labelFor(index) ?? String(new Date().getFullYear() - age));
            const chosen = answers.child_months[String(index)];
            return (
              <li
                key={`${index}-${age}`}
                className="rounded-2xl border border-bark bg-card p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-control">
                    {expecting ? heading : `Born ${heading}`}
                  </p>
                  {/* 44px, and named — a column of buttons all reading "Remove"
                      is the "23 buttons called Edit" fault, and this one removes
                      a child rather than a row of text. */}
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    aria-label={`Remove the child ${expecting ? "on the way" : `born ${heading}`}`}
                    className="min-h-11 shrink-0 rounded-full px-3 text-help font-semibold text-muted underline underline-offset-2 hover:text-green-deep"
                  >
                    Remove
                  </button>
                </div>

                {!expecting && (
                  <div
                    role="radiogroup"
                    aria-label={`Birth month for the child born ${heading}`}
                    className="mt-2.5 flex flex-wrap gap-2"
                  >
                    {MONTH_OPTIONS.map((month) => {
                      const on = chosen === Number(month.id);
                      return (
                        <button
                          key={month.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => onMonth(index, month.id)}
                          className={
                            on
                              ? "min-h-11 rounded-full border border-green bg-green-wash px-3.5 text-[14px] font-semibold text-green-deep"
                              : "min-h-11 rounded-full border border-bark px-3.5 text-[14px] font-medium text-ink-soft"
                          }
                        >
                          {month.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className={children.length > 0 ? "mt-5" : ""}>
        <p className="text-eyebrow font-semibold uppercase tracking-eyebrow text-muted">
          {children.length > 0 ? "Add another child" : "Add a child"}
        </p>
        <p className="mt-1 text-help leading-snug text-muted">
          Tap a birth year. Same year twice is fine — that is two children.
        </p>
        {full ? (
          <p className="mt-2.5 text-help text-gold-ink">
            That is as many as Pando records.
          </p>
        ) : (
          <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {BIRTH_YEAR_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onAdd(Number(option.id))}
                className={
                  option.wide
                    ? "col-span-3 min-h-12 rounded-2xl border border-bark bg-card px-3 text-control font-medium text-ink-soft sm:col-span-4"
                    : "min-h-12 rounded-2xl border border-bark bg-card px-3 text-control font-medium text-ink-soft"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
