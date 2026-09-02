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
  type ReactNode,
  type RefObject,
} from "react";
import { Check, ChevronDown, Info, MoreHorizontal, X } from "lucide-react";
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

    const left = Math.min(
      Math.max(margin, t.left),
      Math.max(margin, window.innerWidth - p.width - margin),
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
 * stands — `Explainer` and `RecordGroup` put those on the page. This is for the
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
 * A dropdown that looks like the rest of the page — a native `<select>` with the
 * OS chrome taken off and ours put on.
 *
 * The complaint that started this was the *closed* control: on a warm-paper page
 * with rounded borders, a default select reads as a foreign object. That part is
 * `appearance: none` and a chevron of our own. The **open list** is still drawn
 * by the platform, and that is the deliberate half of the trade: it brings
 * typeahead, arrow keys, Escape, an announced value, and — the one thing nothing
 * hand-rolled matches — the native wheel on a phone.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ id: T; label: string }>;
  /** Announced, never drawn — the visible label is the `Field` around it. */
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-h-10 w-full appearance-none rounded-lg border border-bark bg-card py-0 pl-3 pr-9 text-[14px] text-ink outline-none transition-colors hover:border-green/50 focus-visible:border-green"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </span>
  );
}

/* ── Filter ───────────────────────────────────────────────────────────────── */

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
}: {
  /** What this filters — announced, never drawn. */
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; count?: number }>;
  onChange: (id: T) => void;
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
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
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
      className="max-h-[85vh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-bark bg-card p-0 text-ink shadow-card backdrop:bg-moss/40 backdrop:backdrop-blur-[2px]"
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
