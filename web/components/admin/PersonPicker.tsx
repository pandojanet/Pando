"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { slugLabel } from "@/components/admin/ui";
import {
  matchRanges,
  rankPeople,
  type SearchablePerson,
} from "@/lib/admin/person-search";

/**
 * One control for finding one parent — a real combobox, not a search box bolted
 * on top of a `<select>`.
 *
 * ## What this replaces, and why the old shape was wrong
 *
 * `/admin/matching` had a text input stacked above a native dropdown: type to
 * narrow, then open the dropdown and pick. Two controls doing one job, and the
 * cost was not only that it looked foreign on a styled page — it *read* as two
 * unrelated things, so a reader who typed a name and saw the dropdown below it
 * unchanged reasonably concluded the search was broken. It also could not show
 * anything about a person beyond one line of text, because a native `<option>`
 * renders no markup, and it needed a special case to keep the chosen row inside
 * the filtered list or the control would blank itself out.
 *
 * A combobox has none of those problems: the selection lives in the input, the
 * list is purely suggestions, and each suggestion is a real element that can
 * carry a second line and an emphasis on the part that matched.
 *
 * ## The rules it keeps
 *
 * - **It is a combobox to assistive technology too**, not a div that looks like
 *   one: `role="combobox"` with `aria-expanded` / `aria-controls` /
 *   `aria-activedescendant` on the input, `role="listbox"` on the list,
 *   `role="option"` with `aria-selected` on each row. The arrow keys move an
 *   *active* option without moving focus out of the input, which is what makes
 *   type-then-arrow-then-Enter work.
 * - **The count is announced.** A filter that silently empties is the admin
 *   equivalent of the bug `components/admin/ui.tsx` records for `ResultNote`:
 *   the page changed and said nothing. `role="status"` rather than `alert` —
 *   it is a result, not an interruption.
 * - **The status cannot lag the input.** It is derived from the query on every
 *   render, never stored in state and set from an effect. That is the exact
 *   trap recorded for the parent-facing search box, where an announcement read
 *   out "nothing matching" about a query that had already matched.
 * - **Escape reverts rather than clears.** A reader who opens the list to look
 *   and then presses Escape has not changed their mind about who they picked.
 * - **Nothing is chosen by hovering.** The pointer sets the *active* row; only
 *   a click or Enter commits. Otherwise dragging the mouse across the list on
 *   the way to the scrollbar would silently re-run the whole page.
 */


export function PersonPicker<T extends SearchablePerson>({
  people,
  value,
  onChange,
  label,
  hint,
  placeholder = "Search by name or neighborhood…",
  emptyLabel = "Nobody to choose from yet",
  noun = "parent",
  className,
}: {
  people: readonly T[];
  /** The chosen person's id, or `""` for none. */
  value: string;
  onChange: (personId: string) => void;
  label: string;
  /** Shown under the control, always — this is an explanation, not a tooltip. */
  hint?: ReactNode;
  placeholder?: string;
  emptyLabel?: string;
  /** Used in the announcement: "3 parents match". */
  noun?: string;
  className?: string;
}) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const statusId = `${inputId}-status`;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => people.find((p) => p.person_id === value) ?? null,
    [people, value],
  );

  /* Ranked suggestions. Pure, and pinned by `npm run test:person-search`. */
  const matches = useMemo(() => rankPeople(people, query), [people, query]);

  /* Derived, never stored: see the note above about a status that lags. */
  const filtering = query.trim() !== "";

  /* The active row has to exist. Reset on every query change rather than
     clamped afterwards, so Enter can never commit the row that *used* to be
     under the cursor. */
  useEffect(() => setActive(0), [query]);

  /* Close on a press outside. `pointerdown` rather than `click`, so a press
     that starts outside the control has closed it before the click lands. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  /* Keep the active row in view when the arrows walk past the visible window. */
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLLIElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function commit(person: T) {
    onChange(person.person_id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (matches.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
      return;
    }
    if (e.key === "Home" && open) {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End" && open) {
      e.preventDefault();
      setActive(Math.max(0, matches.length - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const person = matches[active];
      if (person) commit(person);
      return;
    }
    if (e.key === "Escape" && (open || query !== "")) {
      /* Reverts. The selection is untouched — see the rules above. */
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  /* What the input shows: the query while the reader is typing or browsing,
     otherwise the person they picked. One field, two states, never both. */
  const shown = open || filtering ? query : selected ? personLine(selected) : "";

  return (
    <div className={cn("min-w-[15rem]", className)} ref={wrapRef}>
      <label
        htmlFor={inputId}
        className="block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted"
      >
        {label}
      </label>

      <div className="relative mt-1">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        >
          <SearchIcon />
        </span>

        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={statusId}
          aria-activedescendant={
            open && matches[active]
              ? `${inputId}-opt-${matches[active].person_id}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          type="text"
          value={shown}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "min-h-10 w-full rounded-lg border bg-card pl-9 pr-9 text-[14px] outline-none",
            open ? "border-green" : "border-bark",
            /* The chosen name reads as an answer, not as a placeholder. */
            selected && !open && !filtering ? "font-semibold" : undefined,
          )}
        />

        {(selected || filtering) && (
          <button
            type="button"
            /* Clears the *query* when there is one, otherwise the selection —
               one button, always meaning "undo the last thing I typed or
               picked". */
            onClick={() => {
              if (filtering) {
                setQuery("");
                inputRef.current?.focus();
                return;
              }
              onChange("");
              setQuery("");
              setOpen(false);
            }}
            aria-label={filtering ? "Clear the search" : `Clear the chosen ${noun}`}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink"
          >
            <CloseIcon />
          </button>
        )}

        {open && (
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={label}
            className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-20 max-h-72 overflow-y-auto rounded-xl border border-bark bg-card py-1 shadow-lg"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-2.5 text-[13px] text-muted">
                {people.length === 0
                  ? emptyLabel
                  : `No ${noun} matches “${query.trim()}”. Try a surname, or the town.`}
              </li>
            ) : (
              matches.map((person, i) => (
                <li
                  key={person.person_id}
                  id={`${inputId}-opt-${person.person_id}`}
                  role="option"
                  aria-selected={person.person_id === value}
                  data-index={i}
                  onPointerMove={() => setActive(i)}
                  onClick={() => commit(person)}
                  className={cn(
                    "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2",
                    i === active ? "bg-green-wash" : "bg-transparent",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold">
                      <Highlight text={person.name ?? "Unnamed"} query={query} />
                      {person.person_id === value && (
                        <span className="ml-1.5 text-[11.5px] font-semibold text-green-deep">
                          · chosen
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">
                      {person.neighborhood ? (
                        <Highlight text={slugLabel(person.neighborhood)} query={query} />
                      ) : (
                        "No area recorded"
                      )}
                    </span>
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Derived from the query on every render — a live region that can lag
          its own input is worse than none. */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        /* Visible only when the list is not covering it — while the list is
           open it *is* the answer, and a count underneath it would be hidden
           text pretending to inform. It stays in the DOM either way, so the
           announcement fires regardless. */
        className={cn("mt-1 text-[12px]", filtering && !open ? "text-muted" : "sr-only")}
      >
        {filtering
          ? `${matches.length} ${matches.length === 1 ? noun : `${noun}s`} match “${query.trim()}”.`
          : `${people.length} ${people.length === 1 ? noun : `${noun}s`} to choose from.`}
      </p>

      {hint && !filtering && (
        <p className="mt-1 text-[12px] leading-relaxed text-muted">{hint}</p>
      )}
    </div>
  );
}

/** "Sarah Chen · South Pasadena" — what the input shows once one is chosen. */
function personLine(person: SearchablePerson): string {
  const area = person.neighborhood ? slugLabel(person.neighborhood) : null;
  return [person.name ?? "Unnamed", area].filter(Boolean).join(" · ");
}

/**
 * The part that matched, emphasised.
 *
 * Not decoration: with two fields searched and an AND across terms, a row can
 * be in the list for a reason that is not the obvious one — "san" matching an
 * area rather than a name — and a reader who cannot see why a row is there
 * cannot trust the ones that are missing.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} className="bg-gold-wash text-ink">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.5 10.5 14 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
