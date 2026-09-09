"use client";

import { cn } from "@/lib/cn";
import type { Option } from "@/lib/types";

/**
 * A single-select question presented as a comparison — one column per option,
 * the same rows down every column.
 *
 * ## Why this exists
 *
 * The client, 9 Sep, on the participation screen: she does not understand the
 * current presentation — *"once a week / up to five questions / etc."* — and
 * she asked for the pattern a pricing page uses, **while being explicit that it
 * is not pricing**. Her sketch is a table: Community Member and Active
 * Contributor as columns, Participation · Questions · Benefits as rows, and
 * *Recommended* marked on one of them.
 *
 * The reading problem she hit is a property of the old control rather than of
 * the words. A chip holds a label and one `hint`, so three different facts —
 * what agreeing means, how many questions, and what you get back — were run
 * together into a single line per option, and the only way to compare two
 * levels was to read two paragraphs and hold them in your head. Rows are what
 * make a comparison a comparison.
 *
 * ## Two things not to undo
 *
 * **It is a comparison and not a price list.** There is no currency, no "per
 * month", no cheapest-to-dearest ordering and no call-to-action per column —
 * the dock still carries the one action, as on every other screen in this flow.
 * `Recommended` is her word and comes from `Option.recommended`; it must never
 * become "Most popular", which she ruled out by name on 1 Sep for want of usage
 * data.
 *
 * **An empty cell is honest.** A level with no `benefits` renders nothing in
 * that row rather than an em dash or a sentence — the benefits are hers to
 * supply and one of the three is still unwritten. See `OptionPlan`.
 *
 * ## Mechanics
 *
 * Radio semantics, and the same interaction `ChipGroup` settled on 8 Sep:
 * tapping the chosen column clears it, because a radiogroup with nothing
 * checked is legal and is the initial state of this question anyway
 * (`EMPTY_ANSWERS.allowance` is null and the choice is required, so the dock
 * stays locked until one is picked).
 *
 * The rows line up across columns from `md` up through **subgrid** — each
 * column is a grid whose rows are the parent's, so the Questions row starts at
 * the same y in all three however long the Participation cell above it runs. A
 * per-column grid would let them drift, which is the one thing a comparison
 * cannot do. Below `md` the columns stack into cards and each carries its own
 * row labels, which is what keeps a stacked comparison readable on a phone.
 */
interface Props {
  options: Option[];
  selected: string[];
  onChange: (next: string[], changed: { id: string; on: boolean }) => void;
  /** Names the radiogroup — the question, or the screen it is the only one on. */
  groupLabel: string;
}

/** Her rows, in her order. The key is the field on `OptionPlan`. */
const ROWS = [
  { key: "participation", label: "Participation" },
  { key: "questions", label: "Questions" },
  { key: "benefits", label: "Benefits" },
] as const;

export function PlanGroup({ options, selected, onChange, groupLabel }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className={cn(
        "grid gap-3",
        /* One track per row (header + the three rows), so a column can hand its
           rows to the parent with `grid-rows-subgrid` and every cell aligns. */
        "md:grid-cols-3 md:grid-rows-[auto_auto_auto_auto] md:gap-4",
      )}
    >
      {options.map((option) => {
        const on = selected.includes(option.id);
        const plan = option.plan;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? [] : [option.id], { id: option.id, on: !on })}
            className={cn(
              "grid w-full gap-3 rounded-3xl border p-4 text-left",
              "transition-[background-color,border-color,box-shadow] duration-150",
              "active:scale-[0.985]",
              "md:row-span-4 md:grid-rows-subgrid md:gap-4",
              on
                ? "border-green-deep bg-green-wash ring-1 ring-green-deep"
                : "border-bark bg-card hover:border-green/50",
            )}
          >
            <span className="block">
              {/* Above the name, not beside it: at 375px a badge on the same
                  line takes enough width to wrap "Active contributor" onto two
                  lines, which makes the one column she wants highlighted the
                  one that reads worst. */}
              <Recommended shown={option.recommended === true} />
              <span className="flex items-center gap-2.5">
                <Tick selected={on} />
                <span
                  className={cn(
                    "font-display text-card-title font-semibold",
                    on ? "text-green-deep" : "text-ink",
                  )}
                >
                  {option.label}
                </span>
              </span>
            </span>

            {ROWS.map((row) => {
              const value = plan?.[row.key];
              return (
                /**
                 * An empty cell renders **nothing at all** — not the row label
                 * over a blank, which announces "Benefits" to a screen reader
                 * and then says nothing, and reads on the page as a heading
                 * that failed to load.
                 *
                 * It still takes its place in the grid, so the alignment is
                 * unaffected: with `grid-rows-subgrid` the track's height comes
                 * from the tallest cell **across** the row, and the two columns
                 * that do carry a benefit hold it open for the one that does
                 * not.
                 */
                <span key={row.key} className="block">
                  {value && (
                    <>
                      <span className="block text-eyebrow font-semibold uppercase tracking-eyebrow text-muted">
                        {row.label}
                      </span>
                      <span
                        className={cn(
                          "mt-1 block leading-relaxed text-help",
                          on ? "text-green-deep" : "text-ink-soft",
                        )}
                      >
                        {value}
                      </span>
                    </>
                  )}
                </span>
              );
            })}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Her word, and only hers — never "Most popular" (1 Sep, for want of usage
 * data).
 *
 * A column without it still renders the badge's **box**, invisible, from `md`
 * up: the plan names would otherwise sit a line lower in the recommended
 * column than in the other two, which is the one misalignment a comparison
 * cannot afford. Rendering the same element rather than a hand-measured spacer
 * is what guarantees the two heights match. On a phone the columns are stacked
 * cards with no row to align to, so there is nothing to hold open.
 */
function Recommended({ shown }: { shown: boolean }) {
  return (
    <span
      aria-hidden={!shown}
      className={cn(
        "mb-2 rounded-full border border-gold-line bg-gold-wash px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-eyebrow text-gold-ink",
        shown ? "inline-flex" : "invisible hidden md:inline-flex",
      )}
    >
      Recommended
    </span>
  );
}

/** Empty circle → check, the same signal a chip carries. */
function Tick({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
        selected ? "border-green-deep bg-green-deep" : "border-bark bg-card",
      )}
    >
      {selected && (
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
