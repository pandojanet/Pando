"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Hint } from "@/components/admin/kit";
import { cn } from "@/lib/cn";

/**
 * Admin primitives. Same Pando tokens as the parent-facing app, but a denser
 * register: this is a desktop work tool, not a phone flow — smaller type, tables
 * instead of cards, less rounding. It still has to work on a phone, so every table
 * scrolls inside its own container rather than pushing the page sideways.
 */

const FADE_PX = 16;

function edgeMaskFor(start: boolean, end: boolean): string {
  if (!start && !end) return "none";
  const left = start ? `transparent, black ${FADE_PX}px` : "black";
  const right = end ? `black calc(100% - ${FADE_PX}px), transparent` : "black";
  return `linear-gradient(to right, ${left}, ${right})`;
}

/**
 * Attach to a horizontally scrollable element to get a `maskImage` that fades
 * only the edge that actually hides content, and updates live as the user
 * scrolls or the content changes.
 *
 * A fade that's on for both edges regardless of scroll position looks fine on
 * a quiet background, but on a filled control (a selected filter's solid
 * green, a table row) it softens that edge into the page colour even at rest,
 * with nothing there to reveal — it reads as a smudge, and it's dishonest:
 * it implies hidden content on a side where none exists.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* Threshold matches the fade width itself, not a bare "!== 0". A snapped,
       padded row (the admin nav) settles a few px off true zero — its own
       leading padding, not hidden content — so a strict >0 check would show a
       left fade at rest there. Being within one fade-width of an edge reads as
       "there" regardless. */
    const update = () =>
      setEdges({
        start: el.scrollLeft > FADE_PX,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - FADE_PX,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    /* Belt and suspenders: a container that switches from a horizontal scroll
       strip to a wrapped/vertical layout at a breakpoint (the admin nav at
       `md`) changes size for CSS reasons, not because anything scrolled — the
       resize listener catches that transition promptly even if it lands in
       the same tick a browser might otherwise coalesce or defer the observer
       callback. */
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const mask = edgeMaskFor(edges.start, edges.end);
  return { ref, maskStyle: { maskImage: mask, WebkitMaskImage: mask } };
}

export function PageHead({
  title,
  intro,
  right,
}: {
  title: string;
  intro?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-[1.5rem] font-bold tracking-[-0.02em]">
          {title}
        </h1>
        {intro && (
          <p className="mt-1.5 max-w-[70ch] text-[14px] leading-relaxed text-muted">
            {intro}
          </p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  title,
  right,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section
      className={cn("rounded-xl border border-bark bg-card", className)}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-bark/70 px-4 py-2.5">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-muted">
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  explain,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /**
   * A sentence the reader can actually reach, next to the label.
   *
   * Delivery's "Still in flight" carried its only explanation in a `title=` —
   * unreachable by touch and by keyboard, which is the fault both this file and
   * `kit.tsx` document at length and which has already cost two client reports.
   */
  explain?: ReactNode;
  /**
   * `alert` rather than `warn` for a number that is *wrong*, not pending. Gold
   * already means "not finished yet" everywhere on this surface; a delivery rate
   * under the 95% floor is not pending, it is a fault somebody has to act on.
   */
  tone?: "plain" | "warn" | "good" | "alert";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        // Selected, never appended — `cn()` is a plain join.
        tone === "warn"
          ? "border-gold-line bg-gold-wash"
          : tone === "good"
            ? "border-green/25 bg-green-wash"
            : tone === "alert"
              ? "border-alert-line bg-alert-wash"
              : "border-bark bg-card",
      )}
    >
      <p className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
        {explain && <Hint label={`What "${label}" means`}>{explain}</Hint>}
      </p>
      <p
        className={cn(
          "mt-1 font-display text-[1.7rem] font-bold leading-none",
          tone === "alert" && "text-alert",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

type BadgeTone = "neutral" | "green" | "gold" | "red" | "muted";

/**
 * A stored state, in words.
 *
 * `hint` is how the second sentence about it reaches a reader: it draws a
 * `Hint` inside the pill, which opens on hover, on focus **and** on tap. The
 * older `title` prop still works and is still wrong for anything a reader
 * needs — a `title` is invisible on a touch device and to a keyboard, which is
 * how two client reports of "this screen is unexplained" happened while the
 * explanation was already written.
 */
export function Badge({
  children,
  tone = "neutral",
  title,
  hint,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  /** Deprecated: reachable by a mouse and nothing else. Prefer `hint`. */
  title?: string;
  hint?: ReactNode;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-bark bg-paper text-ink-soft",
    green: "border-green/30 bg-green-wash text-green-deep",
    gold: "border-gold-line bg-gold-wash text-gold-ink",
    red: "border-alert-line bg-alert-wash text-alert",
    muted: "border-bark bg-transparent text-muted",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold",
        tones[tone],
      )}
    >
      {children}
      {hint && <Hint label="What this means">{hint}</Hint>}
    </span>
  );
}

/**
 * Tables scroll inside themselves — the page never scrolls sideways.
 *
 * `.no-scrollbar` + the edge fade replace the bare OS scrollbar (grey track,
 * click-to-page arrows) that `overflow-x-auto` renders on its own — the same
 * fix as the admin nav (`Shell.tsx`), because a table is the one place on this
 * page that's expected to scroll, not the whole surface reaching for attention.
 */
export function TableWrap({
  label,
  children,
}: {
  /**
   * What this table is. Names the scroll region **and** the table.
   *
   * Without it the scrolling div had no `tabindex`, no role and no name — so the
   * nine-column contributors table could not be scrolled sideways from the
   * keyboard *at all*, and there is not even a scrollbar to hint that there is
   * more: `useEdgeFade` replaces it with a mask.
   *
   * `role="group"`, deliberately, not `region`: eight tables becoming eight
   * landmarks is noise in the landmark list.
   */
  label: string;
  children: ReactNode;
}) {
  const { ref, maskStyle } = useEdgeFade<HTMLDivElement>();
  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={label}
      className="overflow-x-auto no-scrollbar"
      style={maskStyle}
    >
      <table className="w-full min-w-[46rem] border-collapse text-left text-[14px]">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  title,
  hint,
  scope = "col",
}: {
  children?: ReactNode;
  className?: string;
  /** Hover explanation, same as `Td` — a column heading has to fit in two words
      more often than it can explain itself in two words. */
  title?: string;
  /**
   * The reachable version of `title`, for a heading whose second sentence is the
   * only place a fact is stated. The worst instance was the contributors table,
   * where a `title=` held the **only** statement anywhere of the difference
   * between the reward threshold and the Founding threshold.
   */
  hint?: ReactNode;
  /** `col` for a column heading; `row` for the cell that names a row. */
  scope?: "col" | "row";
}) {
  return (
    <th
      title={title}
      scope={scope}
      className={cn(
        "border-b border-bark/70 bg-paper/60 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted",
        className,
      )}
    >
      {hint ? (
        <span className="inline-flex items-center gap-1">
          {children}
          <Hint label="What this column means">{hint}</Hint>
        </span>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({
  children,
  className,
  colSpan,
  title,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  /** Hover explanation — used where a number needs one word of context. */
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cn("border-b border-bark/50 px-3 py-2.5 align-top", className)}
    >
      {children}
    </td>
  );
}

export function Button({
  children,
  onClick,
  tone = "secondary",
  disabled,
  type = "button",
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  /** For a control whose label has to stay short — this table is dense on purpose. */
  title?: string;
}) {
  const tones = {
    primary: "bg-green-deep text-white hover:bg-ink",
    secondary: "border border-bark bg-card text-ink hover:border-green/60",
    danger: "border border-alert-line bg-alert-wash text-alert hover:border-alert/45",
    ghost: "text-muted hover:text-green-deep",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        /* `whitespace-nowrap` is a correctness fix, not a style preference. In a
           narrow table cell the label wrapped mid-phrase ("Add to Pando" over
           three lines) and — on `/admin/demand`, where an ancestor set
           `truncate` — the primary button rendered as **"I've dealt with
           this…"**: an ellipsis eating the label of the button somebody is
           meant to press. A button is now as wide as its words; if that is too
           wide for its container, the container is wrong. */
        "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

/**
 * The look of a control, without a width.
 *
 * Split out because appending `w-auto` to `inputClass` **does not work**, and
 * the reason is the trap `Chip.tsx` already records: two utilities for the same
 * property in the same layer are resolved by Tailwind's own output order, not by
 * where they sit in the string. So `${inputClass} w-auto` kept `w-full`, and
 * three toolbar controls that were meant to sit in a row stacked full-width down
 * the page instead — visible only in a browser, since the class list reads
 * exactly as intended.
 *
 * Use this in a toolbar, where a control should be as wide as it needs to be;
 * use `inputClass` in a form, where filling the column is right.
 */
export const controlClass =
  "rounded-lg border border-bark bg-card px-3 py-2 text-[14px] outline-none focus:border-green";

/** A control that fills its column — the form case. One definition of the look. */
export const inputClass = `w-full ${controlClass}`;

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-display text-[1.05rem] font-semibold">{title}</p>
      {body && (
        <p className="mx-auto mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-muted">
          {body}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Shown whenever a page is displaying invented rows. Sample data is only available
 * while there is no backend at all, and it must never be mistakable for real data.
 */
export function SampleBanner() {
  return (
    <div className="mb-4 rounded-xl border border-gold-line bg-gold-wash px-4 py-2.5 text-[13px] font-medium text-gold-ink">
      Sample data — invented rows for reviewing the layout. Nothing here is real, and
      no action you take is stored.
    </div>
  );
}

export function NotConfigured({
  demo,
  onDemo,
  noSample,
}: {
  demo: boolean;
  onDemo: (on: boolean) => void;
  /**
   * Why this resource has no sample rows, in one sentence.
   *
   * Nine resources answer with a deliberately **empty** sample — money,
   * payments, conversation histories, blast pools, matching rankings, freshness,
   * impact, delivery, answers — and each has its reason written beside it in
   * `app/api/admin/query/route.ts`: a fabricated $15 payment answers "has
   * anybody actually paid?" with a yes, and an invented ranking is the one thing
   * the matching harness must never show, because judging the real ranking is
   * its whole purpose.
   *
   * The defect this closes is small and corrosive: those pages still offered a
   * **"Show sample data" button that does nothing**, because there is nothing to
   * show. A control that visibly does not respond reads as a broken page, so an
   * admin concludes the tool is broken rather than that the deployment has no
   * database. Passing the reason replaces the button with it — and the text
   * comes from the same decision as the empty sample rather than being written
   * again here, so the two cannot drift.
   */
  noSample?: string;
}) {
  return (
    <Empty
      title="No database connected yet"
      body={
        noSample ? (
          <>
            This page reads from the pilot database, and this deployment
            isn&apos;t connected to one. {noSample}
          </>
        ) : (
          <>
            This page reads from the pilot database, and this deployment
            isn&apos;t connected to one. Until it is there is nothing to show —
            you can switch on sample rows to review the layout.
          </>
        )
      }
      action={
        noSample ? undefined : (
          <Button tone="secondary" onClick={() => onDemo(!demo)}>
            {demo ? "Hide sample data" : "Show sample data"}
          </Button>
        )
      }
    />
  );
}

/**
 * Waiting for a query, in one place.
 *
 * It was written out **24 times** — 23 of them the identical
 * `px-4 py-10 text-center text-[13.5px] text-muted`, one at `py-8` for no
 * reason — and not one of them announced anything, so a screen-reader user
 * working the admin got silence between clicking and rows appearing.
 *
 * ## Why the text arrives one tick late
 *
 * A live region has to be **in the document before its content changes**, or
 * nothing is announced. That is the rule `TypingDots` paid for in the chat and
 * `CopyButton` paid for again on 3 Sep, and mounting a `role="status"` with its
 * message already inside is exactly the mistake: the region and the text arrive
 * in the same commit, so there is no change to observe. So the element mounts
 * empty and an effect fills it.
 *
 * Two consequences worth keeping. The box holds its height either way, so
 * nothing shifts when the text lands. And a query that resolves inside one tick
 * now shows **nothing at all** rather than flashing "Loading…" — which is the
 * better behaviour on the warm pooler, where most of these return in ~200ms.
 *
 * No skeletons, deliberately: this is a tool for one or two people at a laptop,
 * a skeleton that blinks for 200ms is more movement than a line of text, and it
 * would be a promise about the shape of the rows that differs on all 23 pages.
 */
export function Loading({ inline = false }: { inline?: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);

  return (
    <div
      role="status"
      className={
        inline
          ? "px-4 py-6 text-center text-[13.5px] text-muted"
          : "px-4 py-10 text-center text-[13.5px] text-muted"
      }
    >
      {shown ? "Loading…" : ""}
    </div>
  );
}

/**
 * Something went wrong. `role="alert"` because it interrupts: the admin was
 * mid-task and the thing they tried did not happen.
 */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-alert-line bg-alert-wash px-4 py-2.5 text-[13.5px] font-medium text-alert"
    >
      {children}
    </div>
  );
}

/**
 * The result of an action — "Added to Pando", "Marked as read", "Invite created".
 *
 * ## Why this is a component and was not
 *
 * This exact block was **hand-copied into seven admin pages**, and the cost was
 * not the duplication: it was that none of them said anything out loud. Every
 * admin action ends by painting a green line the reader may not be looking at,
 * so somebody using a screen reader tapped "Add to Pando" and got silence —
 * indistinguishable from a click that missed.
 *
 * `role="status"` rather than `alert`: the action succeeded, so it is worth
 * announcing at the next pause rather than interrupting a sentence. And the whole
 * region is live rather than the text alone, so replacing one message with
 * another (approve, then approve again) is announced both times.
 */
export function ResultNote({
  children,
  inline = false,
}: {
  children: ReactNode;
  /**
   * Sits under the control that produced it, rather than at the top of the page.
   * Quieter on purpose — the reader is already looking at the button they just
   * pressed, so a full banner beside it would be shouting. It is the same
   * component because it is the same concept: what happened, announced.
   */
  inline?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        inline
          ? "mt-2 text-[12.5px] text-muted"
          : "mb-4 rounded-xl border border-green/25 bg-green-wash px-4 py-2.5 text-[13.5px] font-medium text-green-deep"
      }
    >
      {children}
    </div>
  );
}

/**
 * The row of controls beside a page title — search, a sort, a checkbox.
 *
 * It exists because of one specific defect, and the defect is instructive:
 * `/admin/contributors` put four controls into `PageHead`'s `right` slot, which
 * is a `flex` with `shrink-0` items, and the last of them — a checkbox with the
 * label "Hide 2 test" — **wrapped into three lines, one word each**, because a
 * label is the one thing in that row with no intrinsic width to defend. A
 * toolbar has to let its controls wrap as *whole controls*, and keep a text
 * label in one piece.
 *
 * On a phone it drops below the title rather than fighting it for the row,
 * which is what `PageHead` already does — this only fixes the inside.
 */
/**
 * The row of controls under the page title: search, filters, hide-test.
 *
 * It owns its own `mb-4`, like every other block under `PageHead` (which owns
 * `mb-5`). Before this the four pages carrying one each supplied the gap from
 * whatever came next — an `mt-5` here, an `mt-4` there — so the distance between
 * the controls and the work depended on which page you were on.
 *
 * `right` on `PageHead` is **not** where this goes. That slot is a flex of
 * `shrink-0` items whose failure mode is documented on this file: a checkbox
 * label, the one thing with no intrinsic width to defend, wrapped into three
 * lines of one word each against the page title. Fixed on `/admin/contributors`
 * on 2 Sep and left in place on three other pages until now.
 */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 [&_label]:whitespace-nowrap">
      {children}
    </div>
  );
}

/**
 * How something on this page works, in prose, on the page.
 *
 * ## Why a component and not a tooltip
 *
 * The client has now twice reported an admin screen as unexplained — the second
 * time about the matching harness, in the words *"the scoring logic is not
 * entirely clear"* — and both times the explanation existed, in a `title`
 * attribute. A tooltip is not an explanation: it is invisible until hovered,
 * unreachable on a touch device, and unfindable by somebody who does not
 * already suspect there is something to find. `labels.ts` fixed the *words* an
 * admin reads; this fixes where the sentences behind them live.
 *
 * It is a real `<details>` so the browser owns the disclosure: keyboard
 * operable, findable by the browser's own find-in-page (Chrome expands a closed
 * `details` to reveal a hit), and no state for a page to get wrong.
 *
 * ## Closed by default, and it opens on hover (3 Sep)
 *
 * This **reverses** the 2 Sep decision recorded in CLAUDE.md, which was "open
 * by default, because a collapsed explainer is a tooltip with a bigger target".
 * The client's instruction is the newer document and it wins: *"Тултіпи лише
 * при наведенні курсору, а не бути постійно розгорнутими, щоб не
 * перевантажувати сторінку."*
 *
 * She is right about the cost, and the cost is what the earlier reasoning did
 * not price. Six pages carry one of these, and every one of them opened with a
 * paragraph of ours above the work — on `/admin/payments` the reader met four
 * sentences about how money works before the first payment. An explanation that
 * is always on screen stops being read at all, which is the same failure as a
 * tooltip nobody finds, arriving from the other direction.
 *
 * **What is kept from the earlier decision, because it was the sound half:**
 * this is not a `title` attribute. It stays a real `<details>`, so it is
 * reachable by tap and by keyboard, and findable by the browser's own
 * find-in-page (Chrome expands a closed `details` to reveal a hit). The hover
 * is added *on top of* that rather than instead of it — hover alone would put
 * the explanation out of reach on the phone the admin sometimes uses, which is
 * exactly the defect this component was written to end.
 *
 * So there are two ways in and they do not fight: hovering peeks, clicking
 * pins. A pinned explainer stays open when the pointer leaves — otherwise
 * reading a long one means keeping the mouse inside it while you scroll.
 */
export function Explainer({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  /** Pinned open from the first render. Rare: something a page must not bury. */
  open?: boolean;
}) {
  const [pinned, setPinned] = useState(open);
  const [peeking, setPeeking] = useState(false);

  return (
    <details
      open={pinned || peeking}
      /* Its own box, because it belongs **above** the work rather than inside
         it. `border-b … last:border-b-0` was shaped for living as the first row
         of a `Card` — which is exactly the placement this pass removed: on
         `/admin/blasts` and `/admin/payments` our paragraph was literally the
         first row of the reader's queue. Standalone, those classes drew a naked
         summary line on bare paper, so the two placements could not both be
         right. */
      className="group mb-4 rounded-xl border border-bark bg-card"
      onPointerEnter={(e) => {
        /* Pointer type matters: a tap fires `pointerenter` too, and peeking on
           a tap would race the click that toggles the pin — the summary would
           open on the enter and close again on the click. Hover is a mouse. */
        if (e.pointerType === "mouse") setPeeking(true);
      }}
      onPointerLeave={() => setPeeking(false)}
    >
      {/* `open` is ours, so the browser's own toggle has to be stopped — and
          `onToggle` is **not** the place to read it back: that event fires on
          any change to the attribute, including one React made for a peek, so
          hovering would silently pin. Intercepting the click is what keeps the
          two gestures separate, and it covers the keyboard too (Enter and Space
          on a summary both arrive as a click). */}
      <summary
        onClick={(e) => {
          e.preventDefault();
          setPinned((was) => !was);
        }}
        className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-[0.07em] text-muted hover:text-ink"
      >
        <span
          aria-hidden="true"
          className="text-[10px] transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        {title}
      </summary>
      <div className="px-4 pb-3.5 text-[13px] leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-ink">
        {children}
      </div>
    </details>
  );
}

/* ── Shared value formatters ──────────────────────────────────────────────── */

export function slugLabel(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The **real** label for a stored option id, from the same list the capture card
 * offered — falling back to `slugLabel` for anything not in it rather than
 * rendering nothing.
 *
 * Use this, not `slugLabel`, wherever the value came from a fixed option list.
 * `slugLabel` turns every underscore into a space, which is right for a status
 * enum (`pending_review` → "Pending Review") and wrong for anything whose
 * underscore stood in for punctuation: `50_100` became "50 100" and `18_22`
 * became "18 22", when both lists already held "$50–100" and "$18–22/hr".
 */
export function optionLabel(
  options: readonly { id: string; label: string }[],
  value: string,
): string {
  return options.find((o) => o.id === value)?.label ?? slugLabel(value);
}

export function ageList(ages: number[]): string {
  if (ages.length === 0) return "—";
  return ages
    .map((a) => (a === -1 ? "expecting" : a === 0 ? "under 1" : String(a)))
    .join(", ");
}

export function when(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : /* Pinned to en-US rather than the reader's locale. The admin is an
         English-only tool for a California market, and `undefined` meant the same
         row read "Jul 30" for the client and "30 лип." for whoever was testing —
         which makes screenshots and bug reports disagree about the data. */
      date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * A date **and** a time, pinned to en-US for exactly the reason `when()` records.
 *
 * The audit log was the one place in the admin calling
 * `toLocaleString(undefined, …)` — the reader's own locale — which is the worst
 * page to do it on, since its whole job is being readable months later and
 * compared against somebody else's screenshot. Its own sibling here rather than
 * a second inline call, so the reason lives in one file.
 */
export function whenExact(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function ProvenanceBadge({ provenance }: { provenance: string }) {
  if (provenance === "parent_submitted") {
    return <Badge tone="green" hint="A real parent submitted this">Parent</Badge>;
  }
  if (provenance === "admin_entered") {
    return (
      <Badge tone="gold" hint="Entered by an admin — can never carry a parent-vouched label">
        Admin-entered
      </Badge>
    );
  }
  return <Badge tone="muted">{slugLabel(provenance)}</Badge>;
}

/**
 * The score, and — since it is a number somebody is asked to sort a queue by —
 * the sentence saying what it is a number about.
 *
 * The reason is shown, not hidden in a tooltip: an admin deciding whether to read
 * a card first should not have to hover to find out why it is at the top. It is
 * written by the review pass about the *text*, never a quote of the parent, and
 * it disappears with the score when the text is edited.
 */
export function ConfidenceBadge({
  value,
  note,
}: {
  value: number | null;
  note?: string | null;
}) {
  if (value === null) {
    return (
      <Badge
        tone="muted"
        hint="Not reviewed yet. A card of pure taps has no free text to judge, and a wrong score would sort a card out of the very queue meant to catch it — so this stays empty rather than becoming a guess."
      >
        —
      </Badge>
    );
  }
  /**
   * A word first, the number second — the same treatment the Flags page uses,
   * and for the same reason: a bare `38%` says nothing about whether to act, and
   * an admin reading two surfaces should not have to learn two scales. The bands
   * are the ones the contributions queue already filters on, 0.6 being the
   * low-confidence line.
   */
  const pct = Math.round(value * 100);
  const band =
    value < 0.4
      ? { label: "Thin", tone: "red" as const }
      : value < 0.6
        ? { label: "Some use", tone: "gold" as const }
        : value < 0.85
          ? { label: "Useful", tone: "neutral" as const }
          : { label: "Very useful", tone: "green" as const };

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <Badge tone={band.tone}>{band.label}</Badge>
        <span className="text-[12px] tabular-nums text-muted">{pct}%</span>
      </span>
      {note && (
        <p className="max-w-[16rem] text-[12px] leading-snug text-muted">{note}</p>
      )}
    </div>
  );
}

/**
 * The option value a promoted "other" answer gets. Matching keys on this, so it is
 * created deliberately at the moment of promotion rather than derived later by a
 * workflow that might slugify differently.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Birth years read plainly; an empty list is a dash, not "0". */
export function yearList(years: number[]): string {
  return years.length ? years.join(" · ") : "—";
}
