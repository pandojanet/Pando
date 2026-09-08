"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import type { Option } from "@/lib/types";
import { CustomChip } from "./Chip";
import { fieldShell } from "./Field";
import { OtherSheet } from "./OtherSheet";

/** Breathing room between the box and its list, and between the list and the dock. */
const GAP = 12;
/** Below this the list is not worth dropping downward — it flips instead. */
const MIN_LIST = 168;
const MAX_LIST = 288;

interface Props {
  /** Shown when a screen carries more than one question. */
  label?: string;
  groupLabel: string;
  /** What this question offers — starters, already ranked by the caller. */
  options: Option[];
  /**
   * Records the caller found elsewhere for the current query.
   *
   * Listed **without** the local filter below, and that is the point rather than
   * a shortcut: the directory search matches aliases, so "LCHS" comes back as
   * "La Cañada High School" — a label the local predicate would then throw away,
   * leaving a search that finds something and shows nothing.
   */
  extra?: Option[];
  mode: "single" | "multi";
  selected: string[];
  onChange: (next: string[], changed: { id: string; on: boolean }) => void;
  custom?: string[];
  otherLabel?: string;
  onAddCustom?: (value: string) => void;
  onRemoveCustom?: (value: string) => void;
  max?: number;
  maxHint?: string;
  /** The box's accessible name — "Search all schools, preschools and daycares". */
  searchLabel: string;
  placeholder?: string;
  /** Controlled, so a caller can run a directory search behind the same box. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** What the caller's own search is doing. Rendered under the list. */
  status?: ReactNode;
  footnote?: ReactNode;
}

/**
 * A searchable dropdown for a question whose options are a directory.
 *
 * ## Why this sits next to `ChipGroup` rather than replacing it
 *
 * The client asked for the "circles" questions — schools, classes, camps, clubs,
 * faith communities — to offer a dropdown with search instead of a wall of
 * option buttons. A chip list is still right for a short, closed set a parent is
 * meant to read whole: the ages, the seventeen approved towns, and every static
 * question. So `ChipGroup` keeps those and this takes the ones backed by
 * hundreds of records.
 *
 * ## What deliberately stays a button
 *
 * **The answers.** A dropdown hides what is *not* chosen, which is the point;
 * hiding what *is* chosen would leave a parent unable to see or undo their own
 * answer until the review screen, seventeen questions later. So selections stay
 * on the page as removable chips above the box — what goes is the offers, not
 * the answers.
 *
 * ## The selection rules are `ChipGroup`'s, restated rather than imported
 *
 * Single-select keeps radio semantics — tapping the chosen one keeps it chosen
 * (3 Aug) — an `exclusive` option clears the rest, `clears` clears the ones it
 * names and only when switching **on** (1 Sep), and a cap blocks *adding* while
 * always leaving a deselect and a refusal reachable (14 Aug). Those four are
 * behaviour the client has asked for by name, so a second copy of them is a
 * second thing to get wrong: `test:feedback` asserts them against this component
 * as well as against the chips.
 */
export function OptionPicker({
  label,
  groupLabel,
  options,
  extra = [],
  mode,
  selected,
  onChange,
  custom = [],
  otherLabel,
  onAddCustom,
  onRemoveCustom,
  max,
  maxHint,
  searchLabel,
  placeholder = "Start typing a name",
  query: controlledQuery,
  onQueryChange,
  status,
  footnote,
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ownQuery, setOwnQuery] = useState("");
  const [placement, setPlacement] = useState({ above: false, maxHeight: MAX_LIST });
  const query = controlledQuery ?? ownQuery;

  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const setQuery = useCallback(
    (next: string) => {
      if (onQueryChange) onQueryChange(next);
      else setOwnQuery(next);
    },
    [onQueryChange],
  );

  const atMax = max !== undefined && selected.length + custom.length >= max;
  const exclusiveIds = useMemo(
    () => options.filter((o) => o.exclusive).map((o) => o.id),
    [options],
  );

  /* Every term must match something — the rule `person-search.ts` already
     settled: an OR answers "willard south" with every Willard *plus* everything
     in South Pasadena, which is a longer list than the parent started with. */
  const listed = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const local =
      terms.length === 0
        ? options
        : options.filter((o) => {
            const hay = [o.label, o.area ?? "", o.hint ?? "", o.section ?? ""]
              .join(" ")
              .toLowerCase();
            return terms.every((t) => hay.includes(t));
          });
    const seen = new Set(local.map((o) => o.id));
    return [...local, ...extra.filter((o) => !seen.has(o.id))];
  }, [options, extra, query]);

  const byId = useMemo(() => {
    const map = new Map<string, Option>();
    for (const o of [...options, ...extra]) if (!map.has(o.id)) map.set(o.id, o);
    return map;
  }, [options, extra]);

  const blocked = useCallback(
    (option: Option) =>
      mode === "multi" && atMax && !option.exclusive && !selected.includes(option.id),
    [mode, atMax, selected],
  );

  /* The active row can fall out of range whenever the list re-filters under it. */
  useEffect(() => {
    setActive((i) => (i >= listed.length ? 0 : i));
  }, [listed.length]);

  /* Closed on an outside press rather than on blur: blur fires *before* the
     click that caused it, so a blur handler shuts the list out from under the
     option a parent is in the middle of tapping. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  /**
   * Where the list fits, measured rather than assumed.
   *
   * A flow screen has a **sticky dock** at `z-30` carrying Continue, so a list
   * dropped below a box near the foot of the page is painted over by it: the
   * last options are on screen and unreachable, which is worse than a shorter
   * list. Found by opening the first of four boxes on a 375×812 phone — three
   * of the thirteen options were behind the dock.
   *
   * So the ceiling is the dock's own top edge when there is one, and the list
   * flips above the box when what is left below is too little to be worth
   * reading. It is re-measured on scroll and resize, because both move the dock
   * relative to the box while the list is open.
   */
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const dock = document
        .querySelector("[data-screen-dock]")
        ?.getBoundingClientRect();
      /* Only a dock *below* the box is a ceiling. Above `md` it stops being
         sticky and sits in the flow, so on a laptop it can legitimately be
         above the field — and treating that as the ceiling would compute a
         negative space and flip a list that had a whole screen beneath it. */
      const ceiling = dock && dock.top > box.top ? dock.top : window.innerHeight;
      const floor = Math.min(ceiling, window.innerHeight);
      const below = floor - box.bottom - GAP;
      const above = box.top - GAP;
      const flip = below < MIN_LIST && above > below;
      setPlacement({
        above: flip,
        maxHeight: Math.max(MIN_LIST, Math.min(MAX_LIST, flip ? above : below)),
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  const toggle = useCallback(
    (option: Option) => {
      const on = !selected.includes(option.id);
      if (on && blocked(option)) return;

      if (mode === "single") {
        /* Clears when it was already the answer — the same rule as `ChipGroup`,
           and here it is what makes the chip's own × work at all: removing a
           single-select chip calls this, and re-selecting was the only thing it
           could have done. No dropdown question is single-select today, so that
           was a trap rather than a fault. */
        onChange(on ? [option.id] : [], { id: option.id, on });
        setQuery("");
        setOpen(false);
        return;
      }

      let next: string[];
      if (option.exclusive) {
        next = on ? [option.id] : [];
      } else {
        const cleared = on ? new Set(option.clears ?? []) : new Set<string>();
        next = on
          ? [
              ...selected.filter(
                (id) => !exclusiveIds.includes(id) && !cleared.has(id),
              ),
              option.id,
            ]
          : selected.filter((id) => id !== option.id);
      }
      onChange(next, { id: option.id, on });
      /* Cleared so the next choice starts from the whole list — and because a
         query still standing over a list of one reads as "there is nothing
         else". The list stays open: picking two classes is one errand. */
      setQuery("");
    },
    [selected, blocked, mode, onChange, setQuery, exclusiveIds],
  );

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) =>
        e.key === "ArrowDown" ? Math.min(i + 1, listed.length - 1) : Math.max(i - 1, 0),
      );
      return;
    }
    if (!open) return;

    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, listed.length - 1));
      return;
    }
    if (e.key === "Enter") {
      /* Always swallowed while the list is open, or Enter on a suggestion also
         submits the step behind it and the parent lands a screen further on
         than they meant to be. */
      e.preventDefault();
      const option = listed[active];
      if (option) toggle(option);
      return;
    }
    if (e.key === "Escape") {
      /* Stopped, so the flow's own Escape handling does not fire as well:
         closing the list is what the key meant here. */
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  const typed = query.trim();

  return (
    <div>
      {/* A `<p>`, not an `<h2>` — the same reason as `ChipGroup`'s: this text is
          already the group's accessible name, so as a heading it duplicates
          itself into the document outline. */}
      {label && (
        <p className="mb-2.5 font-semibold uppercase text-eyebrow tracking-eyebrow text-muted">
          {label}
        </p>
      )}

      {(selected.length > 0 || custom.length > 0) && (
        <ul
          aria-label={`${groupLabel} — what you have chosen`}
          className="mb-3 flex flex-wrap gap-2"
        >
          {selected.map((id) => (
            <li key={id}>
              <CustomChip
                tone="green"
                label={byId.get(id)?.label ?? id}
                onRemove={() => {
                  const option = byId.get(id);
                  /* An id whose record has not loaded yet is still an answer,
                     and it has to be removable — otherwise a slow directory
                     fetch leaves a chip a parent cannot take off. */
                  if (option) toggle(option);
                  else
                    onChange(
                      selected.filter((other) => other !== id),
                      { id, on: false },
                    );
                }}
              />
            </li>
          ))}
          {custom.map((value) => (
            <li key={value}>
              <CustomChip label={value} onRemove={() => onRemoveCustom?.(value)} />
            </li>
          ))}
        </ul>
      )}

      <div ref={boxRef} className="relative">
        <label htmlFor={`${listId}-input`} className="sr-only">
          {searchLabel}
        </label>
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && listed[active] ? `${listId}-o${active}` : undefined
          }
          aria-describedby={`${listId}-status`}
          autoComplete="off"
          type="text"
          enterKeyHint="search"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value.slice(0, 60));
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(fieldShell(), "min-h-[52px] px-4 py-3")}
        />

        {open && (
          <div
            /* The press that chooses an option must not first move focus out of
               the input: that would close the list before the tap lands. */
            onMouseDown={(e) => e.preventDefault()}
            /* Above the dock's `z-30` while it is open: the clamp below should
               keep them from meeting at all, but if a measurement is a few
               pixels out the failure has to be a list that overlaps the button
               rather than options nobody can see. */
            /* The height belongs to the **panel**, not to the list inside it.
               Clamping the `<ul>` alone left the "Can't find it?" footer hanging
               past the ceiling and over the dock — measured: the list ended 5px
               clear and the panel still covered Continue. */
            style={{ maxHeight: placement.maxHeight }}
            className={cn(
              "absolute left-0 right-0 z-40 flex flex-col overflow-hidden rounded-2xl border border-bark bg-card shadow-card",
              placement.above
                ? "bottom-[calc(100%+0.375rem)]"
                : "top-[calc(100%+0.375rem)]",
            )}
          >
            <ul
              ref={listRef}
              id={`${listId}-list`}
              role="listbox"
              aria-label={groupLabel}
              aria-multiselectable={mode === "multi" ? true : undefined}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
            >
              {listed.map((option, i) => {
                const on = selected.includes(option.id);
                const off = blocked(option);
                return (
                  <li
                    key={option.id}
                    id={`${listId}-o${i}`}
                    role="option"
                    aria-selected={on}
                    aria-disabled={off || undefined}
                    data-active={i === active ? "true" : undefined}
                    onPointerUp={() => {
                      if (!off) toggle(option);
                    }}
                    onPointerEnter={() => setActive(i)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5",
                      i === active && "bg-green-wash",
                      off && "cursor-not-allowed opacity-55",
                    )}
                  >
                    <Tick on={on} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-control font-medium text-ink">
                        {option.label}
                      </span>
                      {/* The area is what tells three "Willard Elementary
                          School"s apart, and `hint` carries "closed" or "not
                          verified". Suppressed when the label already ends with
                          it: a previous place is stored as "Berlin, DE" with
                          `area = "DE"`, which printed blindly read "Berlin,
                          DEDE". A subtitle must not repeat its own title. */}
                      {(() => {
                        const area =
                          option.area && !option.label.endsWith(option.area)
                            ? option.area
                            : null;
                        const meta = [area, option.hint].filter(Boolean);
                        if (meta.length === 0) return null;
                        return (
                          <span className="mt-0.5 block truncate text-dock text-muted">
                            {meta.join(" · ")}
                          </span>
                        );
                      })()}
                    </span>
                  </li>
                );
              })}

              {/* An empty box reads as broken; an empty box that says so reads
                  as an answer. Inside the list rather than under it, because
                  this *is* what the list has to say — and it is the one place
                  the parent is already looking. */}
              {listed.length === 0 && (
                <li
                  /* Not an option: a listbox's children are options, and a
                     sentence announced as a choosable one is a choice that does
                     nothing. */
                  role="presentation"
                  className="px-4 py-3 text-help text-muted"
                >
                  {typed
                    ? `Nothing matching “${typed}”.`
                    : /* "Where have you lived before?" has no starters at all —
                         there is no plausible list of familiar *previous* cities
                         — so an empty list there is the question working, and
                         saying "nothing to choose from" would be a dead end
                         where the answer is one keystroke away. */
                      onQueryChange
                      ? "Start typing to search."
                      : "Nothing to choose from yet."}
                </li>
              )}
            </ul>

            {/* The caller's search state, and the typed fallback — her
                instruction puts "Can't find it? Add it" inside the results and
                keeps it there even when there are matches, because the right
                answer may be the one Pando does not know yet. */}
            {(status || onAddCustom) && (
              <div className="shrink-0 border-t border-bark/60 px-4 py-2">
                {status}
                {onAddCustom && (
                  <button
                    type="button"
                    disabled={atMax}
                    onPointerUp={() => {
                      if (atMax) return;
                      if (typed) {
                        onAddCustom(typed);
                        setQuery("");
                      } else {
                        setOpen(false);
                        setSheetOpen(true);
                      }
                    }}
                    className="min-h-11 text-left text-help font-semibold text-green-deep underline underline-offset-4 disabled:no-underline disabled:opacity-50"
                  >
                    {typed
                      ? `Can’t find it? Add “${typed}”`
                      : (otherLabel ?? "Add your own")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Outside the list on purpose: a live region wrapping the options would
          read out every match on every keystroke, which is worse than silence.
          This is one fact — how many there are — and it stays in the document
          whether the list is open or not, because a region that mounts with its
          message already inside announces nothing (the `TypingDots` lesson). */}
      <p id={`${listId}-status`} role="status" aria-live="polite" className="sr-only">
        {open
          ? `${listed.length} ${listed.length === 1 ? "option" : "options"}${
              typed ? ` for “${typed}”` : ""
            }.`
          : ""}
      </p>

      {/* Stated only once it bites: explaining a limit a parent has not reached
          is a rule to remember instead of a screen to answer. */}
      {atMax && maxHint && (
        <p className="mt-2.5 text-help leading-relaxed text-muted">{maxHint}</p>
      )}

      {footnote && (
        <p className="mt-2 text-dock leading-relaxed text-muted">{footnote}</p>
      )}

      {onAddCustom && (
        <OtherSheet
          open={sheetOpen}
          title={otherLabel ?? "Add your own"}
          onClose={() => setSheetOpen(false)}
          onSubmit={(value) => {
            onAddCustom(value);
            setSheetOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Empty circle → check, the same signal `ChipGroup` gives before any tap. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-150",
        on ? "border-green-deep bg-green-deep" : "border-bark bg-paper",
      )}
    >
      <svg viewBox="0 0 12 12" className="h-[11px] w-[11px]" fill="none">
        <path
          d="M2 6.4 4.6 9 10 3.2"
          stroke={on ? "#ffffff" : "transparent"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
