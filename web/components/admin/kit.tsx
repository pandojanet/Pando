"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Info, KeyRound, LogOut, Minus, MoreHorizontal, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The admin's interaction primitives, on the platform, wearing Pando's clothes.
 *
 * ## Why these exist
 *
 * The admin had reached the point where the remaining problems were not layout
 * — they were **mechanics**: a `title` attribute that a touch device cannot
 * reach, a control that reads as a foreign object, a "modal" that is really an
 * inline div and so does not trap focus or lock the page behind it, and six
 * buttons in a row because there was no way to say "these four are secondary".
 *
 * ## Why not a component library
 *
 * MUI, Ant and Chakra ship a *design language* with the mechanics, and this
 * project's design system rules that out in so many words: "Not a SaaS
 * dashboard, not a kids' app", plus "never hard-code a hex value — if a colour
 * isn't in the theme, it isn't in the product."
 *
 * The first version of this file used **Radix primitives**, which ship no styles
 * and solve exactly the mechanics above. It worked, and it cost more than it is
 * worth here: six packages (select, dropdown-menu, tooltip, dialog, toggle-group
 * and their shared popper / focus-scope / dismissable-layer internals) compiled
 * to a **102 KB chunk — 34 KB gzipped — loaded on every admin page**, for five
 * controls used by one or two people at a laptop.
 *
 * So the mechanics come from the platform instead, which has caught up with most
 * of what the library was for:
 *
 *  - `<dialog>` + `showModal()` — top layer, focus trap, Escape, an inert
 *    background, and focus restored on close, all native;
 *  - the **Popover API** (`popover`) — top layer again, light dismiss, Escape,
 *    and no portal, which is what makes it immune to the clipping bug below;
 *  - a native `<select>` — typeahead, keyboard, and the OS wheel on a phone;
 *  - `role="radiogroup"` with a roving tabindex — thirty lines, and the whole
 *    row stays one tab stop.
 *
 * Kept: `lucide-react`, which is per-icon tree-shaken (five icons here) and
 * spares the pages a drawer of hand-rolled SVGs.
 *
 * **The clipping bug this file must never reintroduce.** CLAUDE.md records it:
 * `position: fixed` inside an element with a *filled* animation is clipped to
 * that element forever, because the identity matrix is still a transform and
 * makes it the containing block. Every admin card is inside animated content, so
 * an overlay drawn in place has already been invisible on a phone once. The top
 * layer — `<dialog showModal>` and `popover` — is outside every containing block
 * by definition, and that property is the whole reason both are used here.
 *
 * ## The rule that keeps this from becoming a second design system
 *
 * **Pando tokens only** — `paper`, `card`, `bark`, `ink`, `green`, `gold`,
 * `alert`. If a component needs a colour that is not in the theme, the answer is
 * to not add the component.
 */

/* ── Top-layer plumbing, shared by Hint and Menu ───────────────────────────── */

/**
 * Whether this browser has the Popover API. Chrome 114, Safari 17 and Firefox
 * 125 all do; anything older falls back to a panel positioned in the page, which
 * loses the top layer and light dismiss but keeps the content reachable.
 *
 * Starts optimistic and corrects itself in an effect, so the server and the
 * first client render agree.
 */
function usePopoverSupport(): boolean {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(
      typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype,
    );
  }, []);
  return supported;
}

/**
 * Puts an open panel next to its trigger and inside the viewport.
 *
 * The top layer is positioned in viewport coordinates, so this is
 * `getBoundingClientRect` plus clamping — no observer, no library. It runs on
 * open and on scroll/resize while open, and does nothing at all when closed,
 * which is the only performance rule that matters here.
 */
function useAnchoredPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
) {
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const t = trigger.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const margin = 8;

    /* Below by default; above when there is no room below — the collision
       behaviour the library was doing, in the one direction that actually comes
       up in a long admin table. */
    const below = t.bottom + margin;
    const fitsBelow = below + p.height <= window.innerHeight - margin;
    const top = fitsBelow ? below : Math.max(margin, t.top - p.height - margin);

    /* The visible width, not `innerWidth`: where a scrollbar takes room, `innerWidth`
       counts it, and a panel placed against that edge went under it (12 Nov, 375px). */
    const viewport = document.documentElement.clientWidth || window.innerWidth;
    const left = Math.min(
      Math.max(margin, t.left),
      Math.max(margin, viewport - p.width - margin),
    );

    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
  }, [panelRef, triggerRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    /* Capture, so it also fires for the scrolling container a table sits in
       rather than only for the window. */
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return place;
}

/**
 * Shows and hides a `popover` element, and keeps React's state in step.
 *
 * `place` is called **after** it is shown, and that ordering is the whole
 * reason this takes a callback. A `popover` is `display: none` until
 * `showPopover()` — so measuring it in a layout effect, before that call, reads
 * 0×0. Found on a phone: a menu opened from a card below the fold was positioned
 * as if it had no height and landed at y=816 in an 812px viewport, i.e. entirely
 * off-screen. It is one line, and nothing about the code looked wrong.
 */
function usePopoverElement(
  open: boolean,
  onClose: () => void,
  ref: RefObject<HTMLElement | null>,
  supported: boolean,
  place: () => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !supported) return;
    if (open) {
      if (!el.matches(":popover-open")) el.showPopover();
      place();
      /* And again on the next frame: the first measurement happens while the
         panel is still settling into its own max-width, which on a phone is the
         difference between "against the edge" and "8px from it". */
      const again = requestAnimationFrame(place);
      return () => cancelAnimationFrame(again);
    } else if (el.matches(":popover-open")) {
      el.hidePopover();
    }
  }, [open, place, ref, supported]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !supported) return;
    /* Light dismiss and Escape belong to the browser, and they close the element
       without telling React. This listener is what keeps the two in step —
       without it `open` stays true and the panel can never be reopened. */
    const sync = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") onClose();
    };
    el.addEventListener("toggle", sync);
    return () => el.removeEventListener("toggle", sync);
  }, [onClose, ref, supported]);
}

/* ── Hint ─────────────────────────────────────────────────────────────────── */

/**
 * An explanation attached to a specific thing on the page.
 *
 * This replaces `title=` on badges and controls, and it is the change with the
 * most behind it: CLAUDE.md records the client reporting an admin screen as
 * unexplained **twice**, and both times the explanation existed — in a `title`
 * attribute. A `title` is invisible until hovered, unreachable on a touch
 * device, unreachable from a keyboard, and unfindable by anybody who does not
 * already suspect there is something to find.
 *
 * This opens on hover **and** on focus **and** on tap, so a keyboard and a thumb
 * both reach it; the trigger is a real button with a 24px target; and it is in
 * the top layer, so a scrolling table cannot clip it.
 *
 * **It is still not the place for an explanation somebody needs.** That rule
 * stands — `RecordGroup` puts those on the page. This is for the
 * second sentence about a value that is already labelled: what "Thin" means,
 * what a stored status implies, what a number is measuring.
 */
export function Hint({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const supported = usePopoverSupport();
  const close = useCallback(() => setOpen(false), []);
  const id = useId();

  const place = useAnchoredPosition(open, triggerRef, panelRef);
  usePopoverElement(open, close, panelRef, supported, place);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        /* A real button: focusable, and 24px of target rather than the 14px the
           icon draws. `align-middle` keeps it on the text baseline of whatever
           label it follows. */
        aria-label={label ?? "What this means"}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="ml-1 -my-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-muted transition-colors hover:bg-paper hover:text-ink focus-visible:text-ink"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <div
        ref={panelRef}
        id={id}
        role="tooltip"
        /* `manual`, not `auto`: an `auto` popover light-dismisses on any outside
           pointer-down, which on a hover-opened hint means it closes and
           immediately reopens under the cursor. Hover and focus own this one. */
        {...(supported ? { popover: "manual" } : {})}
        className={cn(
          "fixed z-50 m-0 w-max max-w-[min(26rem,calc(100vw-1rem))] rounded-xl border border-bark bg-card px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft shadow-card",
          !open && "hidden",
        )}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Kept as a passthrough so the layout does not have to know which mechanism is
 * underneath. It used to group a library's shared open/delay state; the platform
 * has no such thing to share, and one hint per hover is the behaviour a reader
 * sees either way.
 */
export function HintProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/* ── Select ───────────────────────────────────────────────────────────────── */

/**
 * A dropdown of our own, open list included (12 Nov, the developer: *"we were
 * meant to have our own selectors for everything"*).
 *
 * It was a native `<select>` with the OS chrome taken off the closed control
 * and the **open list left to the platform** — a grey system menu on a
 * warm-paper page, and no room for anything but one line of text per option.
 * Now the list is ours too: an anchored panel like `Menu`'s (the same popover
 * hooks: light dismiss, inside the viewport, re-placed on scroll), with options
 * that can carry a second line (`detail`) and a pill (`tag`).
 *
 * What the native list gave and this keeps, because it was the reason for the
 * old trade: the keyboard — Arrow keys, Home/End, Enter/Space, Escape back to
 * the trigger, and typeahead on the first letters — and an announced value
 * (WAI-ARIA's select-only combobox: a button with `aria-haspopup="listbox"`,
 * a `role="listbox"` that owns the focus while open, `aria-activedescendant`).
 * The phone's native wheel is the one thing given up; the panel scrolls inside
 * itself instead, and every row is a 44px target.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  disabled = false,
  bare = false,
  compact = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ id: T; label: string; detail?: string; tag?: string }>;
  /** Nothing to choose yet (a list still loading): shown, not openable. */
  disabled?: boolean;
  /** Announced, never drawn — the visible label is the `Field` around it. */
  label: string;
  className?: string;
  /** No border of its own: one segment of a `ControlGroup`, which draws the edge. */
  bare?: boolean;
  /**
   * The closed trigger shows the label alone; each option's `detail` stays in
   * the open list (19 Nov, the digests review: the week's figures were cut off
   * in the trigger as "4 families · 3 gr…").
   */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const supported = usePopoverSupport();
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const place = useAnchoredPosition(open, triggerRef, panelRef);
  usePopoverElement(open, close, panelRef, supported, place);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === value));
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
    /* As wide as its trigger at least, so the list reads as the control opened. */
    const width = triggerRef.current?.getBoundingClientRect().width;
    if (width && panelRef.current) panelRef.current.style.minWidth = `${Math.round(width)}px`;
    listRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (o.id !== value) onChange(o.id);
  };

  /* Typeahead: letters typed within a second find the next option starting with them. */
  const seek = (key: string) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : "") + key.toLowerCase(), at: now };
    const from = typed.current.text.length === 1 ? active + 1 : active;
    for (let k = 0; k < options.length; k++) {
      const i = (from + k) % options.length;
      if (options[i].label.toLowerCase().startsWith(typed.current.text)) return setActive(i);
    }
  };

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        /* The value is announced with the name: "Which Saturday: Sat, Nov 21", not just the question. */
        aria-label={selected ? `${label}: ${selected.label}` : label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "inline-flex min-h-10 w-full items-center gap-2 py-1.5 pl-3 pr-9 text-left text-[14px] text-ink transition-colors disabled:cursor-default disabled:opacity-60",
          bare
            ? cn("bg-transparent hover:bg-bark-soft/70 focus-visible:bg-bark-soft/70 focus-visible:outline-offset-[-2px]", open && "bg-bark-soft/70")
            : cn("rounded-lg border bg-card focus-visible:border-green", open ? "border-green" : "border-bark hover:border-green/50"),
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? "—"}
          {selected?.detail && !compact && <span className="ml-1.5 text-muted">· {selected.detail}</span>}
        </span>
        {selected?.tag && (
          <span className="shrink-0 rounded-full border border-gold-line bg-gold-wash px-2 py-0.5 text-[11.5px] font-semibold text-gold-ink">
            {selected.tag}
          </span>
        )}
      </button>
      <ChevronDown
        className={cn("pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted transition-transform", open && "rotate-180")}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        {...(supported ? { popover: "auto" } : {})}
        onBlur={
          supported
            ? undefined
            : (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) close();
              }
        }
        className={cn(
          "fixed z-50 m-0 max-w-[min(26rem,calc(100vw-1rem))] rounded-xl border border-bark bg-card p-0 shadow-card",
          !open && "hidden",
        )}
      >
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(options.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(options.length - 1);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (e.key === "Tab") {
              setOpen(false);
            } else if (e.key.length === 1 && /\S/.test(e.key)) {
              seek(e.key);
            }
          }}
          className="max-h-[min(22rem,60vh)] overflow-y-auto py-1 outline-none"
        >
          {options.map((o, i) => {
            const isSelected = o.id === value;
            return (
              <li
                key={o.id}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 text-[14px]",
                  i === active && "bg-paper",
                )}
              >
                <Check className={cn("h-4 w-4 shrink-0 text-green-deep", !isSelected && "invisible")} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", isSelected ? "font-semibold text-green-deep" : "text-ink")}>{o.label}</span>
                  {o.detail && <span className="block truncate text-[12.5px] text-muted">{o.detail}</span>}
                </span>
                {o.tag && (
                  <span className="shrink-0 rounded-full border border-gold-line bg-gold-wash px-2 py-0.5 text-[11.5px] font-semibold text-gold-ink">
                    {o.tag}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </span>
  );
}

/* ── Calendar ─────────────────────────────────────────────────────────────── */

/** "2026-11-21" ↔ a UTC date at noon: day arithmetic that no time zone or DST change can shift. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const fromIso = (s: string) => new Date(`${s}T12:00:00Z`);
const addDaysIso = (s: string, n: number) => {
  const d = fromIso(s);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};
const addMonthsIso = (s: string, n: number) => {
  const d = fromIso(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoDay(d);
};
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * A calendar of our own, in a popover (12 Nov, the developer: *"let me find a
 * particular week through a calendar — everything custom, not default"*).
 *
 * A month grid, Sunday first (US), where the days that can be chosen are
 * **marked** — a dot, and a short count under the number — and the rest are
 * plain. `resolve` maps any day to the day it stands for, so on a page of
 * weekly editions a click anywhere in a week picks that week's Saturday, and a
 * hovered week lights up as a row. Nothing marked in a week: that row cannot
 * be chosen.
 *
 * The keyboard is the date picker's own (WAI-ARIA grid): arrows by day and by
 * week, Home/End to the week's ends, PageUp/PageDown by month, Enter or Space
 * to choose, Escape back to the trigger. One cell is in the tab order at a
 * time. `<input type="date">` is not used: its calendar is the platform's, it
 * cannot mark days, and on this surface it is the grey foreign object the rule
 * above forbids.
 */
export function Calendar({
  value,
  onChange,
  marks,
  label,
  resolve = (d) => (marks.has(d) ? d : null),
  bare = false,
}: {
  /** The chosen day, YYYY-MM-DD, or null. */
  value: string | null;
  onChange: (day: string) => void;
  /** The days that can be chosen, with what to say under each and whether it needs a look. */
  marks: ReadonlyMap<string, { note?: string; alert?: boolean }>;
  /** The trigger's name: "Find a week on the calendar". */
  label: string;
  /** What a click on a day chooses (default: itself, if marked). */
  resolve?: (day: string) => string | null;
  /** No border of its own: one segment of a `ControlGroup`. */
  bare?: boolean;
}) {
  const latest = [...marks.keys()].sort().at(-1) ?? isoDay(new Date());
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(value ?? latest);
  const [hoverWeek, setHoverWeek] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);
  const supported = usePopoverSupport();
  const close = useCallback(() => setOpen(false), []);
  const place = useAnchoredPosition(open, triggerRef, panelRef);
  usePopoverElement(open, close, panelRef, supported, place);
  const id = useId();

  useEffect(() => {
    if (open) setFocus(value ?? latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, open]);

  const month = focus.slice(0, 7);
  const first = `${month}-01`;
  const start = addDaysIso(first, -fromIso(first).getUTCDay());
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = Array.from({ length: 7 }, (_, d) => addDaysIso(start, w * 7 + d));
    if (w > 3 && !row.some((d) => d.startsWith(month))) break;
    weeks.push(row);
  }
  const title = fromIso(first).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const today = isoDay(new Date());
  const weekOf = (d: string) => addDaysIso(d, -fromIso(d).getUTCDay());

  const choose = (day: string) => {
    const to = resolve(day);
    if (!to) return;
    setOpen(false);
    triggerRef.current?.focus();
    onChange(to);
  };

  const monthHas = (m: string) => [...marks.keys()].some((d) => d.startsWith(m));
  const prevMonth = addMonthsIso(first, -1).slice(0, 7);
  const nextMonth = addMonthsIso(first, 1).slice(0, 7);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-10 w-10 shrink-0 items-center justify-center text-ink transition-colors",
          bare
            ? cn("bg-transparent hover:bg-bark-soft/70", open && "bg-bark-soft/70 text-green-deep")
            : cn("rounded-lg border bg-card", open ? "border-green" : "border-bark hover:border-green/50"),
        )}
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
      </button>

      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        {...(supported ? { popover: "auto" } : {})}
        onBlur={
          supported
            ? undefined
            : (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) close();
              }
        }
        /* A set width, so it is measured at its real size and placed 8px inside the edge on a phone. */
        className={cn("fixed z-50 m-0 w-[min(21.5rem,calc(100vw-1rem))] rounded-xl border border-bark bg-card p-3 shadow-card", !open && "hidden")}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setFocus(addMonthsIso(focus, -1))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-paper"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {monthHas(prevMonth) && <span className="sr-only"> (has digests)</span>}
          </button>
          <p id={`${id}-title`} aria-live="polite" className="font-display text-[15px] font-semibold text-ink">
            {title}
          </p>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setFocus(addMonthsIso(focus, 1))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-paper"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            {monthHas(nextMonth) && <span className="sr-only"> (has digests)</span>}
          </button>
        </div>

        <table ref={gridRef} role="grid" aria-labelledby={`${id}-title`} className="w-full border-separate border-spacing-0.5">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th key={d} scope="col" className="h-7 w-10 text-center text-[12.5px] font-medium text-muted">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((row) => {
              const rowWeek = weekOf(row[0]);
              const rowLive = row.some((d) => resolve(d) !== null);
              return (
                <tr
                  key={row[0]}
                  onMouseEnter={() => setHoverWeek(rowLive ? rowWeek : null)}
                  onMouseLeave={() => setHoverWeek(null)}
                  className={cn(hoverWeek === rowWeek && "[&>td]:bg-green-wash")}
                >
                  {row.map((day) => {
                    const mark = marks.get(day);
                    const target = resolve(day);
                    const chosen = value !== null && day === value;
                    const inMonth = day.startsWith(month);
                    return (
                      <td key={day} role="gridcell" aria-selected={chosen} className="rounded-lg p-0 first:rounded-l-lg last:rounded-r-lg">
                        <button
                          type="button"
                          data-day={day}
                          tabIndex={day === focus ? 0 : -1}
                          aria-disabled={target === null}
                          aria-label={`${fromIso(day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}${mark?.note ? `, ${mark.note}` : ""}${target === null ? ", no digest" : ""}`}
                          onClick={() => choose(day)}
                          onFocus={() => setFocus(day)}
                          onKeyDown={(e) => {
                            const by: Record<string, () => string> = {
                              ArrowLeft: () => addDaysIso(day, -1),
                              ArrowRight: () => addDaysIso(day, 1),
                              ArrowUp: () => addDaysIso(day, -7),
                              ArrowDown: () => addDaysIso(day, 7),
                              Home: () => addDaysIso(day, -fromIso(day).getUTCDay()),
                              End: () => addDaysIso(day, 6 - fromIso(day).getUTCDay()),
                              PageUp: () => addMonthsIso(day, -1),
                              PageDown: () => addMonthsIso(day, 1),
                            };
                            if (by[e.key]) {
                              e.preventDefault();
                              setFocus(by[e.key]());
                            } else if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              choose(day);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setOpen(false);
                              triggerRef.current?.focus();
                            }
                          }}
                          className={cn(
                            "relative flex h-11 w-10 flex-col items-center justify-center rounded-lg text-[13.5px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold",
                            chosen
                              ? "bg-green-deep font-semibold text-white"
                              : mark
                                ? "font-semibold text-green-deep hover:bg-green-wash"
                                : target
                                  ? "text-ink hover:bg-green-wash"
                                  : "cursor-default text-muted/60",
                            !inMonth && !chosen && "opacity-45",
                            day === today && !chosen && "underline decoration-gold decoration-2 underline-offset-4",
                          )}
                        >
                          {Number(day.slice(8))}
                          {mark && (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "mt-0.5 text-[10px] font-semibold leading-none",
                                chosen ? "text-white/85" : mark.alert ? "text-alert" : "text-green",
                              )}
                            >
                              {mark.note ? mark.note.split(" ")[0] : "•"}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Checkbox · Radio · NumberField ───────────────────────────────────────── */

/**
 * A tick box of our own (12 Nov: no browser-default control on the admin). The
 * input is still the real one — so the label, Space, focus and a form all work
 * exactly as before — with its drawing taken off (`appearance-none`) and ours
 * put on: a warm box, a solid green fill and a white tick when on, the gold
 * focus ring the rest of the surface uses.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible label. Without one, `label` names it. */
  children?: ReactNode;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-9 items-center gap-2 text-[13px]",
        disabled ? "cursor-default opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative inline-flex h-[18px] w-[18px] shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 m-0 h-full w-full cursor-[inherit] appearance-none rounded-[5px] border border-bark bg-card transition-colors hover:border-green/60 checked:border-green-deep checked:bg-green-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1"
        />
        <Check className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3.5} aria-hidden="true" />
      </span>
      {children}
    </label>
  );
}

/** One choice of several, drawn as ours on the real input — the same trade as `Checkbox`. */
export function Radio({
  checked,
  onChange,
  name,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={onChange}
        className="peer absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-full border border-bark bg-card transition-colors hover:border-green/60 checked:border-green-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1 disabled:cursor-default"
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 m-auto h-2 w-2 rounded-full bg-green-deep opacity-0 peer-checked:opacity-100" />
    </span>
  );
}

/**
 * A number with our own − and + (12 Nov). `type="number"` drew the platform's
 * spin arrows — tiny, grey, and different in every browser. This is a text field
 * announced as a spinbutton, stepped by its buttons and by the Up/Down keys,
 * clamped to `min`/`max`, with as many decimals as `step` has. The value stays a
 * string, so a half-typed "0." is the caller's to judge, as it was.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  onKeyDown,
  disabled,
  ...input
}: {
  value: string | number;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  /** For the input itself — the caller's control class and any invalid ring. */
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max" | "step" | "className">) {
  const decimals = (String(step).split(".")[1] ?? "").length;
  const now = Number(value);
  const nudge = (by: number) => {
    const base = Number.isFinite(now) && String(value).trim() !== "" ? now : (min ?? 0);
    let next = Math.round((base + by * step) / step) * step;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(next.toFixed(decimals));
  };
  const stepper = "inline-flex w-9 shrink-0 items-center justify-center border-bark bg-card text-ink transition-colors hover:bg-paper disabled:cursor-default disabled:opacity-40";
  return (
    <span className="inline-flex w-full items-stretch">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || (min !== undefined && Number.isFinite(now) && now <= min)}
        onClick={() => nudge(-1)}
        className={cn(stepper, "rounded-l-lg border border-r-0")}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        {...input}
        type="text"
        role="spinbutton"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(now) ? now : undefined}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            nudge(e.key === "ArrowUp" ? 1 : -1);
          }
          onKeyDown?.(e);
        }}
        className={cn(className, "min-w-0 !rounded-none")}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || (max !== undefined && Number.isFinite(now) && now >= max)}
        onClick={() => nudge(1)}
        className={cn(stepper, "rounded-r-lg border border-l-0")}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/* ── Filter ───────────────────────────────────────────────────────────────── */

/**
 * An on/off switch (20 Nov, the developer on Pando MCP's switch: a real toggle, not a button that says
 * what it would do). `role="switch"` with `aria-checked`, so a screen reader says "on" or "off"; Space and
 * Enter flip it as a button does; the knob slides, the track turns green when on. While the change is
 * saving (`busy`) it stays where it was and goes quiet, so it never shows a state the server has not
 * taken. `label` names it for assistive tech; the visible words beside it are the caller's.
 */
export function Toggle({
  checked,
  onChange,
  label,
  busy = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || busy;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={off}
      onClick={() => onChange(!checked)}
      className={cn(
        "group relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        checked ? "bg-green" : "bg-bark",
        !off && (checked ? "hover:bg-green-deep" : "hover:bg-paper-soft"),
        disabled && "cursor-not-allowed opacity-50",
        busy && "cursor-wait",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none flex size-6 items-center justify-center rounded-full bg-card shadow-[0_1px_2px_rgba(34,48,24,0.25),0_1px_1px_rgba(34,48,24,0.08)] transition-transform duration-200 ease-out",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      >
        {busy ? (
          <span className="size-3 animate-spin rounded-full border-[1.5px] border-bark border-t-green" />
        ) : checked ? (
          <Check className="size-3.5 text-green" strokeWidth={3} />
        ) : null}
      </span>
    </button>
  );
}

/**
 * The one filter control, now with a keyboard.
 *
 * It was five hand-rolled copies, then one component with `role="tablist"`. Two
 * things changed on the way to this version.
 *
 * **The semantics are a radio group, not tabs.** A tablist implies panels you
 * move between; these buttons filter one list that stays where it is.
 *
 * **The whole row is one tab stop.** Roving tabindex: Tab reaches the group,
 * arrows move within it, Home/End jump to the ends. The `role="tablist"` version
 * made six tab stops out of one control, and every one of them announced the
 * wrong thing.
 *
 * **A filter is still not a primary action.** Selected is `green-wash` with a
 * green rule, never the solid green of a button that changes data.
 */
export function SegmentedFilter<T extends string | number>({
  label,
  value,
  options,
  onChange,
  unknown = false,
  track = false,
}: {
  /** What this filters — announced, never drawn. */
  label: string;
  /** One track with the chosen option raised — two or three options in a toolbar. */
  track?: boolean;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; count?: number }>;
  onChange: (id: T) => void;
  /**
   * The rows are not known — a read that failed, or one still in flight.
   *
   * Every count here is computed off the rows the page holds, so during an
   * outage they all render **0**: six pills stating that there are zero of
   * everything, which is the same untruth the work area used to tell with
   * "Nothing in this view". A missing number says "not known"; a zero says
   * "none". One suppression at the group rather than a ternary on every pill,
   * because the pills are written one per line and the one that gets forgotten
   * is the one nobody was looking at.
   */
  unknown?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );

  /** Moving the focus *is* choosing, which is what a radio group does. */
  const move = (to: number) => {
    if (options.length === 0) return;
    const next = (to + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].id);
  };

  return (
    <div role="radiogroup" aria-label={label} className={track ? "inline-flex rounded-lg bg-bark-soft p-0.5" : "flex flex-wrap gap-1.5"}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            /* One tab stop for the group: only the chosen option is tabbable,
               and the arrows do the rest. */
            tabIndex={i === selected ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i - 1);
              } else if (e.key === "Home") {
                e.preventDefault();
                move(0);
              } else if (e.key === "End") {
                e.preventDefault();
                move(options.length - 1);
              }
            }}
            className={cn(
              track
                ? cn(
                    "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors",
                    on ? "bg-card font-semibold text-ink shadow-card" : "font-medium text-muted hover:text-ink",
                  )
                : cn(
                    "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13.5px] transition-colors",
                    on
                      ? "border-green bg-green-wash font-semibold text-green-deep"
                      : "border-bark bg-card font-medium text-muted hover:border-green/50 hover:text-ink",
                  ),
            )}
          >
            {o.label}
            {!unknown && o.count !== undefined && (
              <span className="tabular-nums opacity-70">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A real tab strip, for the **one** place that swaps whole panels.
 *
 * ## Why this is not `SegmentedFilter`
 *
 * That component's own doc says it: *"A tablist implies panels you move between;
 * these buttons filter one list that stays where it is."* `/admin/contributors`
 * does the other thing — three separate panels (the table, the consent file, the
 * standing view), each with its own columns and its own fetch — so a reader
 * heard six unrelated buttons and nothing announced that the region below had
 * been replaced.
 *
 * Adding this is not a reversal of the 2 Sep decision that consolidated five
 * hand-rolled filter rows into one component. It is the distinction that
 * decision was drawing, given a second name.
 *
 * ## Manual activation, which is the opposite of `SegmentedFilter`
 *
 * There, moving the focus **is** choosing, because a filter is free. Here each
 * panel is a separate `useAdminRows` fetch, so arrowing across three tabs to
 * reach the fourth would fire three round trips nobody asked for. Arrows move
 * focus, Enter or Space commits — the manual-activation pattern, and the reason
 * it exists.
 *
 * The pills are the same ones, deliberately: this reads as the same control to
 * anybody looking at it, because it is the same control doing a job one step
 * bigger.
 */
export function SegmentedTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  panelId,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; count?: number }>;
  onChange: (id: T) => void;
  /** The single `role="tabpanel"` these swap. */
  panelId: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );

  /** Focus only. Committing is a separate keypress — see the header. */
  const move = (to: number) => {
    if (options.length === 0) return;
    refs.current[(to + options.length) % options.length]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i - 1);
              } else if (e.key === "Home") {
                e.preventDefault();
                move(0);
              } else if (e.key === "End") {
                e.preventDefault();
                move(options.length - 1);
              }
            }}
            className={cn(
              "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13.5px] transition-colors",
              on
                ? "border-green bg-green-wash font-semibold text-green-deep"
                : "border-bark bg-card font-medium text-muted hover:border-green/50 hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="tabular-nums opacity-70">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Menu ─────────────────────────────────────────────────────────────────── */

/** So an item can close the menu it is in without every page wiring it up. */
const MenuCloseContext = createContext<() => void>(() => {});

/**
 * The actions a record has that are not its main one.
 *
 * `/admin/caregivers` could show **six** buttons on one card — mark invited,
 * mark declined, switch on, let families see her, release the hold, read the
 * private note — and a row of six equal buttons says nothing about which one you
 * are meant to press. The first one or two stay as buttons; the rest live here.
 *
 * **What does not go in a menu:** anything whose availability is the
 * information. A held card's "Release the hold" is half of what the card is
 * telling you, so hiding it behind a click would hide the state. Judgement per
 * page, and the pages say which they chose.
 */
export function Menu({
  label = "More actions",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const supported = usePopoverSupport();
  const close = useCallback(() => setOpen(false), []);

  const place = useAnchoredPosition(open, triggerRef, panelRef);
  usePopoverElement(open, close, panelRef, supported, place);

  const items = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not([disabled])",
      ) ?? [],
    );

  useEffect(() => {
    if (!open) return;
    /* Focus the first item, so a keyboard user is inside the menu rather than
       still on the trigger with a panel open somewhere near them. */
    panelRef.current
      ?.querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border bg-card px-2.5 text-[13.5px] font-semibold text-ink transition-colors",
          open ? "border-green" : "border-bark hover:border-green/60",
        )}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        More
      </button>

      <div
        ref={panelRef}
        role="menu"
        aria-label={label}
        {...(supported ? { popover: "auto" } : {})}
        onKeyDown={(e) => {
          const list = items();
          const i = list.indexOf(document.activeElement as HTMLButtonElement);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            list[(i + 1) % list.length]?.focus();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            list[(i - 1 + list.length) % list.length]?.focus();
          } else if (e.key === "Escape") {
            /* Focus goes back to the trigger, or a keyboard user is left
               standing on a panel that has just gone. */
            setOpen(false);
            triggerRef.current?.focus();
          }
        }}
        /* Without the API there is no light dismiss, so leaving the panel closes
           it. With it, the browser has already done this. */
        onBlur={
          supported
            ? undefined
            : (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) close();
              }
        }
        className={cn(
          "fixed z-50 m-0 min-w-[13rem] max-w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-bark bg-card p-0 py-1 shadow-card",
          !open && "hidden",
        )}
      >
        <MenuCloseContext.Provider value={close}>
          {children}
        </MenuCloseContext.Provider>
      </div>
    </>
  );
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  tone = "plain",
  hint,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** `danger` for what sets something aside — never for the ordinary case. */
  tone?: "plain" | "danger";
  /** A second line, for an action whose consequence is not in its name. */
  hint?: string;
}) {
  const close = useContext(MenuCloseContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        "block w-full cursor-pointer px-3 py-2 text-left text-[13.5px] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        tone === "danger"
          ? "text-alert hover:bg-alert-wash focus-visible:bg-alert-wash"
          : "text-ink hover:bg-green-wash focus-visible:bg-green-wash",
      )}
    >
      <span className="block font-medium">{children}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-muted">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-bark/70" />;
}

/* ── Dialog ───────────────────────────────────────────────────────────────── */

/**
 * A real modal, for the one kind of thing that deserves one.
 *
 * The admin's panels are inline on purpose — an edit form for two fields should
 * not take a reader off a queue they are working down (`RecordDrawer`). This is
 * for the opposite case: **something you should be looking at and nothing
 * else.** Today that is the restricted note (invariant 12) — a private note
 * about a named person, whose read is itself audited. An inline panel could be
 * scrolled away from, left open behind other rows, or read over a shoulder while
 * somebody worked the rest of the page.
 *
 * `<dialog>` with `showModal()` supplies what makes a modal a modal, and every
 * one of these is easy to get wrong by hand: focus moves in and is trapped, the
 * background is inert, Escape closes, focus returns to whatever opened it, and
 * it renders in the **top layer** — above everything, and outside every
 * containing block, which is the clipping bug this file exists not to repeat.
 *
 * The one thing the element does not do is lock the scroll behind it, so that is
 * the two lines below.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line on why this is in front of you. Announced with the title. */
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  /**
   * Every way this can close has to reach React, and **the `close` event is not
   * dependable enough to be the only one.**
   *
   * Measured, not assumed: in one of the browsers this admin is walked in,
   * `dialog.close()` fires no `close` event at all — not through `onclose`,
   * not through an added listener. The element shut, React went on believing it
   * was open, the scroll lock was never released, and the note could not be
   * opened a second time.
   *
   * So React closes it, rather than reacting to it having closed: Escape is
   * intercepted (as `cancel`, and again as a keydown, because which of the two a
   * browser sends is exactly the thing not to bet on), the backdrop click calls
   * `onClose`, and this listener stays as belt and braces for the browsers where
   * the event does arrive. Calling `onClose` twice is harmless — it sets state
   * that is already set.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onCloseRef.current();
    el.addEventListener("close", handler);
    return () => el.removeEventListener("close", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    /* Scroll lock, restored on close. No padding compensation: this is a
       desktop-first surface, and the alternative — measuring the scrollbar —
       is the part of a scroll lock that goes wrong. */
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        /* The spec'd close request. Prevented so the element does not shut
           behind React's back; the state change below is what closes it. */
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={(e) => {
        /* The backdrop is the dialog element itself — anything inside it is a
           child, so this fires only for a click outside the panel. */
        if (e.target === ref.current) onClose();
      }}
      /* `m-auto` is load-bearing: a modal `<dialog>` centres itself through the
         UA's own `margin: auto`, and Tailwind's preflight zeroes every margin —
         so without it every dialog on this surface sits in the top-left corner.
         Found while building the referral popup, which had the same fault. */
      className="m-auto max-h-[85vh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-bark bg-card p-0 text-ink shadow-card backdrop:bg-moss/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-bark/70 px-4 py-3">
        <div>
          <h2 id={titleId} className="font-display text-[1.05rem] font-semibold">
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              className="mt-0.5 text-[12.5px] leading-relaxed text-muted"
            >
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-paper hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="px-4 py-3.5">{children}</div>
      {footer && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-bark/70 px-4 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}

/** The tick a chosen row wears, kept here so pages do not import an icon set. */
export function ChosenMark() {
  return <Check className="h-3.5 w-3.5 text-green-deep" aria-hidden="true" />;
}

/* ── Account ──────────────────────────────────────────────────────────────── */

/** A name's initials in a circle — "lab" → "L", "Janet Lee" → "JL". The palette's own green, never a colour per name. */
function Initials({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const letters =
    name
      .trim()
      .split(/[\s._@-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-green-wash font-semibold text-green-deep ring-1 ring-green/20",
        size === "md" ? "h-9 w-9 text-[13.5px]" : "h-7 w-7 text-[12px]",
      )}
    >
      {letters}
    </span>
  );
}

/**
 * Who is signed in and what they can do about it, behind one button (12 Nov, the developer: "take the profile
 * tab as there — sign out, the name, change password"; property-workflows' account popover). In the sidebar a
 * row — initials, name, ⇅ — at the foot; on a phone only the initials, in the header. Opens above when there is
 * no room below; Escape or a click elsewhere closes it and focus goes back to the button.
 */
export function AccountMenu({ user, compact = false, onSignOut }: { user: string; compact?: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const supported = usePopoverSupport();
  const close = useCallback(() => setOpen(false), []);
  const place = useAnchoredPosition(open, triggerRef, panelRef);
  usePopoverElement(open, close, panelRef, supported, place);
  const id = useId();

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  const row =
    "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] font-medium text-ink transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-offset-[-2px]";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-account`}
        aria-label={compact ? `Account: ${user}` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "transition-colors",
          compact
            ? cn("inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-bark-soft/70", open && "bg-bark-soft/70")
            : cn("flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-paper", open && "bg-paper"),
        )}
      >
        <Initials name={user} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 break-words text-[13.5px] font-semibold text-ink">{user}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
          </>
        )}
      </button>

      <div
        ref={panelRef}
        id={`${id}-account`}
        role="dialog"
        aria-label="Account"
        {...(supported ? { popover: "auto" } : {})}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
          }
        }}
        onBlur={
          supported
            ? undefined
            : (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) close();
              }
        }
        className={cn("fixed z-50 m-0 w-[15rem] max-w-[calc(100vw-1rem)] rounded-xl border border-bark bg-card p-0 shadow-card", !open && "hidden")}
      >
        <div className="flex items-center gap-2.5 px-3 py-3">
          <Initials name={user} size="md" />
          <p className="min-w-0 break-words text-[14px] font-semibold text-ink">{user}</p>
        </div>
        <div className="space-y-0.5 border-t border-bark/70 p-1.5">
          <Link href="/admin/account" onClick={close} className={row}>
            <KeyRound className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            Change password
          </Link>
          <button
            type="button"
            onClick={() => {
              close();
              onSignOut();
            }}
            className={row}
          >
            <LogOut className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
