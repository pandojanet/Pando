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
 * ## Three things not to undo
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
 * supply. See `OptionPlan`.
 *
 * **The whole card is the control, and there is no tick** (developer, 15 Sep —
 * *"Прибери CheckBox на кожній з опцій, це буде клікабельна карточка без
 * нього"*). The card is already a ~300px target, and a 20px circle beside the
 * name was a second thing to aim at that did nothing the card did not.
 * ⚠ **The cost is stated rather than left to be discovered:** selection is now
 * carried by the border, the ring and the wash, so a sighted parent reads it
 * from a colour and a boundary rather than from a glyph. `aria-checked` is
 * untouched — a screen reader was never being told by the tick.
 *
 * ## Mechanics
 *
 * Radio semantics, and the same interaction `ChipGroup` settled on 8 Sep:
 * tapping the chosen column clears it, because a radiogroup with nothing
 * checked is legal and is the initial state of this question anyway
 * (`EMPTY_ANSWERS.allowance` is null and the choice is required, so the dock
 * stays locked until one is picked).
 *
 * Each column is its own run of blocks, one `STEP` apart, and the three stretch
 * to the height of the tallest — so a card reads with a single rhythm from its
 * name to its last bullet, and the three start and end together.
 *
 * ⚠⚠ **This replaced `grid-rows-subgrid`, and the trade runs the other way from
 * what it sounds like.** Subgrid put every column's Participation label at the
 * same y, which is what a comparison seems to want — and it sized each row
 * track to the tallest cell **across** the columns, so a level whose answer
 * wrapped to two lines left the other two carrying a blank line before their
 * next label. Measured: every gap 16px except one at 38px, in all three columns
 * at once. The developer asked twice for the spacing to be even (15 Sep,
 * *"Відстані між розділами зроби однаковими"*, then *"рівномірно розподіли
 * текст"*) and pointed at a pricing page whose columns do **not** share row
 * lines — each card is its own list, and only the names align. Her rows survive
 * that intact, because every column still carries all three of her labels: what
 * is lost is the shared y, not the comparison.
 */
interface Props {
  options: Option[];
  selected: string[];
  onChange: (next: string[], changed: { id: string; on: boolean }) => void;
  /** Names the radiogroup — the question, or the screen it is the only one on. */
  groupLabel: string;
}

/**
 * Her first two rows, in her order; the key is the field on `OptionPlan`.
 * Benefits is rendered separately because it is a list rather than a sentence.
 */
const ROWS = [
  { key: "participation", label: "Participation" },
  { key: "questions", label: "Questions" },
] as const;

/**
 * One step between every block — the band, the name, each row, and between a
 * row's label and its answer (developer, 15 Sep: *"Відстані між розділами
 * зроби однаковими"*). It was `gap-3` stacked against `gap-4` in columns, with
 * an `mt-1` under each row label — so a phone and a laptop had different
 * rhythms, and a label sat nearer its own value than to anything else on the
 * card.
 */
const STEP = "gap-4";

/**
 * How far the recommended column stands above its neighbours: the band's own
 * height, exactly.
 *
 * ⚠⚠ **The three classes are one number and must not drift apart.** `height`
 * fixes the band, `pull` lifts the card by the same amount so its *name* lands
 * level with the other two — that alignment is the point of the treatment, and
 * it is what fixing the height buys — and `room` is the space above the row for
 * the card to be lifted into. Change one and the three plan names stop sharing
 * a baseline, which is the defect this shape exists to avoid: an earlier
 * attempt gave the recommended column an extra subgrid track instead, and put
 * that card's own heading **17px above the other two** (measured: 369 · 352 ·
 * 369), because a subgrid's padding comes out of its *first* track.
 *
 * All three are `md:` only. Stacked there is nothing to stand proud of, and a
 * card lifted on a phone would sit on the one above it.
 */
const BAND = { height: "md:h-8", pull: "md:-mt-8", room: "md:pt-8" };

export function PlanGroup({ options, selected, onChange, groupLabel }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className={cn("grid", STEP, "md:grid-cols-3", BAND.room)}
    >
      {options.map((option) => {
        const on = selected.includes(option.id);
        const plan = option.plan;
        const recommended = option.recommended === true;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? [] : [option.id], { id: option.id, on: !on })}
            className={cn(
              /* `content-start`: a card with less in it than its neighbours
                 keeps the one rhythm and lets the difference fall at the foot
                 of it. Spreading the blocks to fill the height would give each
                 column its own spacing, which is the thing being fixed. */
              "grid w-full content-start overflow-hidden rounded-3xl border p-4 text-left",
              STEP,
              "transition-[background-color,border-color,box-shadow] duration-150",
              "active:scale-[0.985]",
              recommended && BAND.pull,
              on
                ? "border-green-deep bg-green-wash ring-1 ring-green-deep"
                : "border-bark bg-card hover:border-green/50",
            )}
          >
            {recommended && <Recommended />}

            <span
              className={cn(
                "block font-display text-card-title font-semibold",
                on ? "text-green-deep" : "text-ink",
              )}
            >
              {option.label}
            </span>

            {ROWS.map((row) => (
              <Cell key={row.key} label={row.label} answered={plan?.[row.key]} on={on}>
                {plan?.[row.key]}
              </Cell>
            ))}

            <Cell label="Benefits" answered={plan?.benefits?.length} on={on}>
              {plan?.benefitsLead && <span className="block">{plan.benefitsLead}</span>}
              {plan?.benefits?.map((benefit) => (
                /* A list inside a `<button>` is markup a button may not hold —
                   phrasing content only — so the bullet is a glyph rather than
                   a `<ul>`, and it is `aria-hidden` because a dot read aloud
                   before every item is noise. */
                <span key={benefit} className="flex gap-2">
                  <span aria-hidden="true" className={on ? "text-green-deep" : "text-green"}>
                    •
                  </span>
                  <span className="block">{benefit}</span>
                </span>
              ))}
            </Cell>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One row of one column: her label, then the answer.
 *
 * An unanswered row renders **nothing at all** — not the label over a blank,
 * which announces "Benefits" to a screen reader and then says nothing, and
 * reads on the page as a heading that failed to load.
 */
function Cell({
  label,
  answered,
  on,
  children,
}: {
  label: string;
  /** Whatever says this row has something in it — a sentence, or a count. */
  answered?: string | number;
  on: boolean;
  children?: React.ReactNode;
}) {
  if (!answered) return null;
  return (
    <span className={cn("grid", STEP)}>
      <span className="block text-eyebrow font-semibold uppercase tracking-eyebrow text-muted">
        {label}
      </span>
      <span
        className={cn(
          "grid gap-1.5 leading-relaxed text-help",
          on ? "text-green-deep" : "text-ink-soft",
        )}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * Her word, and only hers — never "Most popular" (1 Sep, for want of usage
 * data).
 *
 * **The top of the card, standing above its neighbours** (developer, 15 Sep,
 * pointing at a pricing page twice: *"Recommended перенести над карткою"*, then
 * *"зроби верх так само по формату як тут"*). It was a pill stacked on top of
 * the plan name inside the card, which put the recommended column's name a line
 * lower than the other two — so the card the screen wants read first was the
 * one whose heading was out of line, and every other column had to render the
 * pill invisibly to hold its own name down.
 *
 * The card is lifted by exactly the band's height (`BAND`), so the band fills
 * the space above the row and the three plan names still share a baseline. The
 * negative margins carry it out of the card's padding to the border, where
 * `overflow-hidden` on the card rounds it.
 */
function Recommended() {
  return (
    <span
      className={cn(
        "-mx-4 -mt-4 flex items-center justify-center border-b border-gold-line bg-gold-wash px-4 py-2 text-eyebrow font-semibold uppercase tracking-eyebrow text-gold-ink",
        /* Stacked, the band is simply the card's top edge and sizes itself. */
        BAND.height,
        "md:py-0",
      )}
    >
      Recommended
    </span>
  );
}
