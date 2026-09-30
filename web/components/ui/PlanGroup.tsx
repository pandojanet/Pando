"use client";

import {
  ArrowLeftRight,
  Check,
  Heart,
  MessageSquare,
  Search,
  ShieldCheck,
  Sprout,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Option, OptionPlan } from "@/lib/types";

/**
 * A single-select question presented as a comparison — one card per option, the
 * same three blocks down every card.
 *
 * ## Why this exists
 *
 * The client, 9 Sep, on the participation screen: she did not understand the
 * presentation of "once a week / up to five questions / etc." and asked for the
 * pattern a pricing page uses, **while being explicit that it is not pricing**.
 * A chip holds a label and one hint, so three different facts — what agreeing
 * means, how many questions, what you get back — were run together into one
 * line, and comparing two levels meant holding two paragraphs in your head.
 *
 * ## 30 Sep — redrawn to the client's mockup
 *
 * Each card is now: an icon in a circle, the name and a tagline, then **How often
 * Pando may ask you**, **Best for**, and the check-marked list of what you get,
 * with a *Select* control at the foot. Under the cards, `PlanFooter` says what
 * every level shares and that answers are not for sale.
 *
 * ## Things not to undo
 *
 * **It is a comparison and not a price list.** No currency, no "per month", no
 * cheapest-to-dearest ordering. *Select* is a label on the card, not a second
 * control: the card is the radio, and a `<button>` may not hold a `<button>`.
 * `Recommended` comes from `Option.recommended` and must never become "Most
 * popular", which the client ruled out on 1 Sep for want of usage data.
 *
 * **Nothing is preselected.** The recommended card is *marked*, never *chosen*:
 * it has the green edge and the Recommended pill, but `aria-checked` is true only for
 * the level the parent picked, and "Agree & Join" stays locked until they do.
 *
 * **An empty block renders nothing**, not its label over a blank. A level with no
 * `benefits` has no list at all.
 *
 * Radio semantics, and the interaction `ChipGroup` settled on 8 Sep: tapping the
 * chosen card clears it, because a radiogroup with nothing checked is legal and
 * is this question's initial state.
 *
 * ⚠ **The recommended card's pill overlaps its top border** (mockup), so the
 * card cannot be `overflow-hidden`. The grid gap is larger than the pill's
 * overhang, so stacked on a phone it does not touch the card above.
 */
interface Props {
  options: Option[];
  selected: string[];
  onChange: (next: string[], changed: { id: string; on: boolean }) => void;
  /** Names the radiogroup — the question, or the screen it is the only one on. */
  groupLabel: string;
}

const ICONS = {
  person: { Icon: User, circle: "bg-green-wash", mark: "text-green-deep" },
  sprout: { Icon: Sprout, circle: "bg-green-wash", mark: "text-green" },
  /* The mockup's heart is red on pink. `alert` is otherwise kept out of the
     parent flow (it means *owed a person today*); this is a decorative mark the
     client drew, and it is one object in one place. */
  heart: { Icon: Heart, circle: "bg-alert-wash", mark: "text-alert" },
} as const satisfies Record<NonNullable<OptionPlan["icon"]>, unknown>;

export function PlanGroup({ options, selected, onChange, groupLabel }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className="grid items-stretch gap-6 md:grid-cols-3 md:gap-4 md:pt-2"
    >
      {options.map((option) => {
        const on = selected.includes(option.id);
        const plan = option.plan;
        const recommended = option.recommended === true;
        const icon = plan?.icon ? ICONS[plan.icon] : null;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? [] : [option.id], { id: option.id, on: !on })}
            className={cn(
              "relative flex w-full flex-col gap-4 rounded-3xl border p-4 text-left sm:p-5",
              "transition-[background-color,border-color,box-shadow] duration-150",
              "active:scale-[0.985]",
              on
                ? "border-green-deep bg-green-wash ring-2 ring-green-deep"
                : recommended
                  ? "border-green bg-green-wash/60 hover:border-green-deep"
                  : "border-bark bg-card hover:border-green/50",
            )}
          >
            {recommended && <Recommended />}

            <span className="flex items-center gap-3 md:min-h-28">
              {icon && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-14 shrink-0 place-items-center rounded-full",
                    icon.circle,
                  )}
                >
                  <icon.Icon className={cn("size-6", icon.mark)} strokeWidth={1.75} />
                </span>
              )}
              <span className="grid gap-0.5">
                <span
                  className={cn(
                    "block font-display text-card-title font-semibold leading-tight",
                    on ? "text-green-deep" : "text-ink",
                  )}
                >
                  {option.label}
                </span>
                {plan?.tagline && (
                  <span className="block text-help leading-snug text-muted">
                    {plan.tagline}
                  </span>
                )}
              </span>
            </span>

            <Block label="How often Pando may ask you" answered={plan?.participation}>
              <span className="block font-display text-[1.06rem] font-semibold leading-snug text-ink">
                {plan?.participation}
              </span>
            </Block>

            <Block label="Best for" answered={plan?.bestFor}>
              <span className="block text-help leading-relaxed text-ink-soft">
                {plan?.bestFor}
              </span>
            </Block>

            <Block
              label={plan?.benefitsLead ?? "You’ll get"}
              answered={plan?.benefits?.length}
            >
              {plan?.benefits?.map((benefit) => (
                /* A list inside a `<button>` is markup a button may not hold —
                   phrasing content only — so each line is a flex row of spans,
                   and the check is `aria-hidden` because a mark read aloud
                   before every item is noise. */
                <span key={benefit} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-green text-white"
                  >
                    <Check className="size-3" strokeWidth={3.5} />
                  </span>
                  <span className="block text-help leading-snug text-ink-soft">
                    {benefit}
                  </span>
                </span>
              ))}
            </Block>

            {/* The mockup's Select. It is a label, not a control (see above).
                White on every card that is not chosen, the recommended one
                included (30 Sep, the developer: it had the dark fill and read as
                already picked); only a chosen card goes dark, so "Selected" is
                never the same as an unchosen card on sight. */}
            <span
              aria-hidden="true"
              className={cn(
                "mt-auto flex h-12 items-center justify-center gap-2 rounded-full border text-[15px] font-semibold",
                on
                  ? "border-green-deep bg-green-deep text-white"
                  : "border-bark bg-card text-ink",
              )}
            >
              {on && <Check className="size-4" strokeWidth={3} />}
              {on ? "Selected" : "Select"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One block of one card: a hairline, then the small-caps label, then the answer.
 *
 * An unanswered block renders **nothing at all** — not the label over a blank,
 * which announces the label to a screen reader and then says nothing.
 */
function Block({
  label,
  answered,
  children,
}: {
  label: string;
  /** Whatever says this block has something in it — a sentence, or a count. */
  answered?: string | number;
  children?: React.ReactNode;
}) {
  if (!answered) return null;
  return (
    <span className="grid gap-2.5 border-t border-bark/60 pt-4">
      <span className="block text-eyebrow font-semibold uppercase tracking-eyebrow text-muted">
        {label}
      </span>
      <span className="grid gap-2">{children}</span>
    </span>
  );
}

/**
 * Her word, and only hers — never "Most popular" (1 Sep, for want of usage
 * data). A pill straddling the card's top edge, as in the mockup.
 */
function Recommended() {
  return (
    <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-gold-line bg-gold-wash px-3.5 py-1 text-eyebrow font-semibold uppercase tracking-eyebrow text-gold-ink">
      Recommended
    </span>
  );
}

/**
 * The two blocks under the cards (30 Sep, the client's mockup): what every level
 * shares, and that an answer cannot be bought.
 *
 * ⚠ **Copy is the mockup's, verbatim.** "Ordinary parent to parent introductions
 * are free" and "Pando can run a Network Check when needed" name things that are
 * not built yet, and the banner's "can never pay to … change what Pando tells
 * you" is the old footnote ("There are no ads. No business or provider can ever
 * pay to change an answer.") in the mockup's words — the claim is the same one,
 * invariant 4's, and it is now wider: it also says *ranked higher*.
 */
const SHARED = [
  { Icon: MessageSquare, text: "Ask Pando whenever you need help" },
  { Icon: Users, text: "Get answers from parents with firsthand experience" },
  { Icon: Search, text: "Pando can run a Network Check when needed" },
  { Icon: ArrowLeftRight, text: "Ordinary parent to parent introductions are free" },
] as const;

export function PlanFooter() {
  return (
    <div className="mt-6 grid gap-3">
      <div className="grid gap-4 rounded-3xl border border-bark bg-green-wash/50 p-4 sm:p-5">
        <div>
          <p className="font-display text-card-title font-semibold text-ink">
            Everyone gets the same core Pando
          </p>
          <p className="mt-1.5 text-help leading-relaxed text-muted">
            Your contribution level only changes how often we may ask for your
            experience. It never changes the quality of help you receive from Pando.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-bark/60 pt-4 sm:grid-cols-4">
          {SHARED.map(({ Icon, text }) => (
            <li key={text} className="grid justify-items-center gap-2 text-center">
              <span
                aria-hidden="true"
                className="grid size-11 place-items-center rounded-full bg-green-wash"
              >
                <Icon className="size-5 text-green-deep" strokeWidth={1.75} />
              </span>
              <span className="text-eyebrow leading-snug text-ink-soft">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-3.5 rounded-3xl border border-gold-line bg-gold-wash p-4 sm:p-5">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-paper"
        >
          <ShieldCheck className="size-5 text-gold-ink" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-display text-card-title font-semibold text-ink">
            Pando’s answers aren’t for sale.
          </p>
          <p className="mt-0.5 text-help leading-relaxed text-ink-soft">
            Businesses and providers can never pay to be recommended, ranked higher
            or change what Pando tells you.
          </p>
        </div>
      </div>
    </div>
  );
}
