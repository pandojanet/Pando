"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The quiet action beside the loud one — "Share without joining for now",
 * "It's fine as it is", "Can't find it? Add it", "Back".
 *
 * ## Why this is a component
 *
 * It was hand-written **eleven times** across the seed, caregiver and chat
 * surfaces, and the copies had drifted on five separate axes: three font sizes
 * (13.5 / 14 / 14.5), two tones, three different disabled treatments, some
 * underlined and some not — and, the part that showed up on screen, only *one*
 * of the eleven set a box model.
 *
 * **The bug that forced it.** `/join` puts a `<button>` ("Share without joining
 * for now") next to an `<a>` ("Learn more about privacy") in one flex row, both
 * `min-h-11` for the tap target, the row `items-center`. Measured in the DOM:
 * both boxes 44px tall, both starting at the same y — and the labels 11.5px
 * apart. A browser centres a `<button>`'s own label vertically; a blockified
 * `<a>` leaves its text at the top of the box. So `items-center` aligned the
 * boxes, which was never the problem, and the `self-center` somebody had added
 * to the anchor was inert. Two controls that read as a pair sat on different
 * lines.
 *
 * No amount of care at the call site fixes that class of fault, because the
 * call site is where the two elements look interchangeable and are not. Here
 * they share one box — `inline-flex items-center` — so the label is centred in
 * the 44px target whichever element ends up rendering.
 *
 * ## The choices it settles
 *
 * **One size: 14px.** The scale in `pando-design-system` names this step "Help
 * / secondary" and says not to invent sizes between the steps; 13.5 and 14.5
 * were exactly that, and were doing no work — five of the eleven were already
 * at 14.
 *
 * **`green` is an action, `quiet` is an aside.** Green-deep for something the
 * parent may well do next ("Change it", "Join the founding network"); muted for
 * the way out of the current path, warming to green on hover so it still
 * answers a pointer.
 *
 * **A disabled text action loses its underline.** `disabled:opacity-50` was one
 * of the three treatments, and it is the wrong one here: fading already-muted
 * text drops it under AA, and it leaves the thing still looking tappable.
 * Muted plus no underline says "not now" without dimming the words.
 */
type Tone = "green" | "quiet";

const TONES: Record<Tone, string> = {
  green: "text-green-deep hover:text-ink",
  quiet: "text-muted hover:text-green-deep",
};

/**
 * `min-h-11` is the 44px floor from the design system's definition of done, and
 * the flex is what makes it a *target* rather than a tall box with text at the
 * top of it.
 */
const BASE =
  "inline-flex min-h-11 items-center gap-1.5 text-help font-semibold " +
  "transition-colors duration-150 disabled:cursor-not-allowed";

function textActionClass(
  tone: Tone,
  underline: boolean,
  full: boolean,
  className?: string,
): string {
  return cn(
    BASE,
    TONES[tone],
    underline && "underline underline-offset-2",
    /* The one disabled look, and it stops the underline promising a tap. */
    "disabled:text-muted disabled:no-underline",
    full && "w-full justify-center",
    className,
  );
}

interface Common {
  children: ReactNode;
  tone?: Tone;
  /**
   * Off only when the action sits directly beside a real `Button` — there the
   * neighbouring control already carries the affordance and the rule reads as
   * noise. In prose, an underline is what says this word is tappable.
   */
  underline?: boolean;
  /** Fills its column and centres, for the slot under a dock's primary action. */
  full?: boolean;
  className?: string;
}

type ButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof Common | "type"> & {
    href?: undefined;
  };

type LinkProps = Common & {
  href: string;
  /**
   * Opens in a new tab with the `rel` that has to go with it. Used mid-flow,
   * where navigating away is a resume the parent did not ask for — the answers
   * are held on the phone, so leaving the page and coming back is a cost.
   */
  external?: boolean;
};

export function TextAction(props: ButtonProps | LinkProps) {
  const { children, tone = "green", underline = true, full = false, className } = props;
  const cls = textActionClass(tone, underline, full, className);

  if (props.href !== undefined) {
    const { href, external } = props;
    return (
      <Link
        href={href}
        className={cls}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </Link>
    );
  }

  /* eslint-disable-next-line @typescript-eslint/no-unused-vars -- the discriminant
     and the styling props are consumed above; the rest are the button's own. */
  const { children: _c, tone: _t, underline: _u, full: _f, className: _cl, href: _h, ...rest } =
    props;
  return (
    <button type="button" {...rest} className={cls}>
      {children}
    </button>
  );
}

/**
 * A link or action **inside a sentence** — "See our Privacy Policy and Terms",
 * "Start over instead", "the previous step".
 *
 * ## Why this is not `TextAction`
 *
 * `TextAction` is a 44px control: `inline-flex min-h-11`. Dropping that into a
 * paragraph would blow the line box apart, so these have always been written
 * separately — and they had drifted into two versions. The consent line on
 * `/join` carries `-my-1 inline-block py-1`, which is the right answer: `py-1`
 * grows the hit area and `-my-1` gives the space back, so the paragraph keeps
 * its rhythm. The resume banner's "Start over instead" and `WhatsNext`'s
 * "previous step" had none of it, and measured **23.6px** against the consent
 * links' 29.1px — the smallest targets in the parent flow were the two nobody
 * had thought about, which is the whole argument for one component.
 *
 * Measured after: the consent line is exactly neutral (a 4-line paragraph stays
 * 4 × 21.13px) and the resume banner runs **2px** over two lines, because an
 * inline-block's baseline alignment is not quite a text run's. 2px on a 49px
 * paragraph in exchange for 8px of hit area is the right trade — but it is a
 * trade, not a free lunch, so do not use this where a box must land on an exact
 * grid.
 *
 * **44px is not the target here, and that is deliberate.** An inline link
 * cannot be 44px without either breaking the line height or overlapping the
 * line above; WCAG 2.5.8 exempts exactly this case ("the target is in a
 * sentence, or its size is otherwise constrained by the line-height of
 * non-target text"). So the rule for these is *as large as the line allows*,
 * which is what the padding trick buys, and the flow's real controls stay in
 * the dock where they have room to be 52px.
 *
 * The colour is inherited (`currentColor`) rather than set, because these sit in
 * prose whose own colour is the panel's — a green-deep link inside a gold-wash
 * warning would be the only thing on the panel not speaking its tone. The one
 * exception is the neutral body case, which passes `tone="green"`.
 */
export function InlineAction(
  props:
    | ({ children: ReactNode; tone?: "inherit" | "green"; className?: string } & {
        href: string;
        external?: boolean;
      })
    | ({ children: ReactNode; tone?: "inherit" | "green"; className?: string } & Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        "children" | "className" | "type"
      > & { href?: undefined }),
) {
  const { children, tone = "inherit", className } = props;
  const cls = cn(
    /* `py-1` for the hit area, `-my-1` so the line box does not grow with it. */
    "-my-1 inline-block py-1 font-semibold underline underline-offset-2",
    tone === "green" && "text-green-deep",
    className,
  );

  if (props.href !== undefined) {
    const { href, external } = props;
    return (
      <Link
        href={href}
        className={cls}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </Link>
    );
  }

  const { children: _c, tone: _t, className: _cl, href: _h, ...rest } = props;
  return (
    <button type="button" {...rest} className={cls}>
      {children}
    </button>
  );
}
