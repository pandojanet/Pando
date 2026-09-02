"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { searchMarketOptions } from "@/lib/api-client";
import { registerFoundOptions } from "@/lib/market-options";
import { visibleStarters } from "@/lib/starters";
import type { MarketCategory, MarketId, Option } from "@/lib/types";

interface Props {
  label?: string;
  groupLabel: string;
  /** The curated starter set — 8-12 familiar choices, from `/api/market/options`. */
  options: Option[];
  mode: "single" | "multi";
  selected: string[];
  onChange: (next: string[], changed: { id: string; on: boolean }) => void;
  custom?: string[];
  otherLabel?: string;
  onAddCustom?: (value: string) => void;
  onRemoveCustom?: (value: string) => void;
  max?: number;
  maxHint?: string;
  /** Which directory to search. */
  category: MarketCategory;
  market: string;
  /** The parent's own area, for ranking. Never a filter. */
  area?: string | null;
  /**
   * Show every starter, unfiltered, uncapped and in its own order.
   *
   * **For the question that establishes the area.** The area logic below exists
   * so a parent sees their own city's schools; applied to "where do you live?"
   * it is circular — it filters the list of cities by the city you just picked
   * — and on 1 Sep the client reported both halves of what that did.
   *
   * *Five approved cities were never shown.* Seventeen starters against
   * `STARTER_LIMIT = 12`, sliced alphabetically before the question was
   * answered, cut exactly San Gabriel, San Marino, Sierra Madre, South Pasadena
   * and Temple City — the five she listed as missing. Verified against the live
   * table: all seventeen are curated starters, so nothing was wrong with the
   * data.
   *
   * *And the list shrank once she tapped one.* With `area = "pasadena"`,
   * `isHome` matched Pasadena **and its nine sub-neighborhoods** (Old Pasadena,
   * Linda Vista, San Rafael…), which clears `AREA_FLOOR` on its own — so the
   * other sixteen cities disappeared. Picking Sierra Madre instead left one
   * match, and the list was topped back up to eight by area size. Either way
   * options vanished and the order changed, which is what she saw.
   *
   * The escape is per question rather than "no area passed", because a curated
   * set of seventeen that the client requires shown whole must not be capped
   * either — and an empty `area` still hits the twelve-item slice.
   */
  wholeList?: boolean;
  /** "Search all schools, preschools and daycares" — her wording per category. */
  searchLabel: string;
  /**
   * One line under the box, per question.
   *
   * It was hardcoded to "it doesn't have to be in your own city", which is her
   * closing note on the four *local* directories — and nonsense under "where have
   * you lived before?", where crossing town is the whole premise.
   */
  footnote?: string;
}

/**
 * Tap first, search second (client, 24 Aug — item 7).
 *
 * Four categories became directories of hundreds of records, which a chip list
 * cannot hold. This shows the curated starters as chips, and puts the rest behind
 * a search field.
 *
 * ## Why this wraps `ChipGroup` instead of replacing it
 *
 * Everything below the search box is unchanged behaviour: selection semantics,
 * the exclusive-option rule, the selection cap and its hint, and the typed
 * "other" answers all already work and are tested. The only new thing is *where
 * an option can come from*. So this component's whole job is to widen the
 * `options` array it hands down — a found record is merged in and then behaves
 * exactly like a starter.
 *
 * ## The rule that makes that safe
 *
 * **A found record must stay in the list once selected.** If search results were
 * rendered separately, clearing the query would unrender the chip a parent had
 * just picked while the value stayed in `selected` — a selection with nothing on
 * screen representing it. `found` is therefore append-only for the life of the
 * screen, and merged ahead of the starters so a record that is both appears once.
 *
 * ## What is deliberately not here
 *
 * No debounce cleverness beyond a plain timer, and no client-side cache: the
 * endpoint is a single indexed query against a table of a few hundred rows behind
 * an invite-gated screen. A cache would be a second copy of the taxonomy to get
 * stale.
 */
export function SearchableChipGroup({
  category,
  market,
  area,
  wholeList,
  searchLabel,
  footnote,
  options,
  selected,
  onAddCustom,
  otherLabel,
  ...rest
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Option[]>([]);
  /**
   * Which query `results` are the answer to.
   *
   * This replaced a `searching` boolean that was set inside the effect, and the
   * difference is one render: on the render immediately after a keystroke the
   * flag was still false and the results were still the previous query's, so the
   * status read **"Nothing matching 'willard'"** before the search had started.
   * As a flicker under a text box that was survivable; announced out loud it is
   * the app stating something untrue and then correcting itself twice.
   *
   * Derived from this, "are we still waiting" cannot lag what was typed.
   */
  const [resultsFor, setResultsFor] = useState("");
  const [failed, setFailed] = useState(false);
  const searching = query.trim() !== resultsFor;
  /**
   * Every record this parent has surfaced by searching.
   *
   * Kept here *and* pushed into the shared runtime table
   * (`registerFoundOptions`). The local copy is what makes the chip appear
   * immediately; the shared one is what makes it survive a reload and gives
   * `labelForOption` a name to print instead of the slug.
   */
  const [found, setFound] = useState<Option[]>([]);

  /**
   * Selections whose record is in neither list — the reload case.
   *
   * A parent picks a searched school, closes the tab, comes back. The id is in
   * their answers, the starters do not contain it, and `found` is empty because
   * this component just mounted. Without this the chip is missing and the
   * follow-up row prints `starkids-preschool`.
   *
   * Resolved by asking the search endpoint for the ids directly, once.
   */
  const resolved = useRef(false);
  useEffect(() => {
    if (resolved.current) return;
    const unknown = selected.filter(
      (id) => !options.some((o) => o.id === id) && !found.some((o) => o.id === id),
    );
    if (unknown.length === 0) return;
    resolved.current = true;

    void searchMarketOptions({ category, market, ids: unknown })
      .then((records) => {
        if (records.length === 0) return;
        setFound((prev) => {
          const seen = new Set(prev.map((o) => o.id));
          return [...prev, ...records.filter((o) => !seen.has(o.id))];
        });
        registerFoundOptions(market as MarketId, category, records);
      })
      .catch(() => {
        /* The chip stays missing, which is visibly wrong and recoverable — the
           parent can search for it again. Losing their answer would not be. */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, options, category, market]);

  /**
   * The starter set, trimmed to what the client actually asked for: **about 8-12
   * familiar choices, for the area the parent lives in.**
   *
   * The endpoint serves every curated starter in the market — 133 schools across
   * seventeen areas — because it does not know which area this parent picked.
   * Rendering all of them is the failure this whole feature exists to fix, one
   * level down: a shorter wall is still a wall.
   *
   * ## Own area first became own area only (27 Aug)
   *
   * This used to rank by area and never filter, and ranking alone was not
   * enough. Her sheets curate **exactly eight school starters per area**, so a
   * cap of twelve meant a parent saw their own eight and then four schools from
   * wherever happened to sort first alphabetically — Aldama in Highland Park,
   * Alhambra High — which are not familiar choices to anybody, just the top of a
   * sorted list. Filtering removes the four.
   *
   * **This does not narrow what a parent can pick.** Search still covers all 357
   * across the whole market, and the footnote under the box says so in her own
   * words. The rule that was written down as "never a filter" is about
   * eligibility — a closed school stays selectable, a school in the next town
   * stays reachable — and both still hold. What is filtered is which twelve get
   * offered as taps.
   *
   * ## Why a floor, and why the top-up is ordered by area
   *
   * Schools are eight per area, but the other three directories are not: baby
   * activities run from eleven starters in Pasadena down to **two** in Altadena,
   * and clubs down to one. Filtered flat, those screens would be a two-chip list
   * next to a search box, which reads as "Pando does not know anything here".
   *
   * So below `AREA_FLOOR` the list is topped up — and the fill is ordered by
   * **how many starters each other area has**, not alphabetically. That puts
   * Pasadena first, which is the market's centre and where the families in the
   * small areas actually go; alphabetical order put Alhambra first, for no
   * reason a parent could perceive.
   *
   * Three rules carried over unchanged:
   *
   *  - **The question's own options are never ranked, filtered or capped.**
   *    "Homeschool", "Not in school yet", "Prefer not to say" are the question's
   *    furniture, not records about the market, and refusing must stay reachable.
   *  - **Anything already selected is kept, whatever the cap or the area.** A
   *    chip that vanished because the parent later changed their neighborhood
   *    would leave a selection with nothing on screen representing it.
   *  - **An unanswered neighborhood filters nothing.** P3 comes first, so this is
   *    rare, but a parent who skipped it gets the old alphabetical twelve rather
   *    than an empty screen.
   */
  const visible = useMemo(
    () => visibleStarters({ options, area, selected, wholeList }),
    [options, area, selected, wholeList],
  );

  /* The visible starters plus anything searched up, de-duplicated by id with the
     starter winning — a starter carries the curation and should not be replaced
     by the same record arriving from search. */
  const merged = useMemo(() => {
    const seen = new Set(visible.map((o) => o.id));
    return [...visible, ...found.filter((o) => !seen.has(o.id))];
  }, [visible, found]);

  const timer = useRef<number | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (timer.current !== null) window.clearTimeout(timer.current);

    /* Two characters is the floor the endpoint enforces too. Below it there is
       nothing to show, and clearing the results is the honest state — not the
       previous query's answers sitting under an empty box. */
    if (q.length < 2) {
      setResults([]);
      setResultsFor(q);
      setFailed(false);
      return;
    }

    timer.current = window.setTimeout(() => {
      void searchMarketOptions({ category, market, q, area: area ?? undefined })
        .then((r) => {
          setResults(r);
          setFailed(false);
        })
        .catch(() => {
          /* Same honesty rule as the rest of the app: say the search did not
             work rather than showing an empty result, which reads as "your
             school is not in Pando". The starters and "add it" still work. */
          setResults([]);
          setFailed(true);
        })
        /* Last, and in both branches: this is what marks the query settled, so
           a result that is about to be replaced never reads as the answer. */
        .finally(() => setResultsFor(q));
    }, 220);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [query, category, market, area]);

  /** Merge a result in, then let `ChipGroup`'s own logic apply the selection. */
  const take = useCallback(
    (option: Option) => {
      setFound((prev) => (prev.some((o) => o.id === option.id) ? prev : [...prev, option]));
      /* Into the shared table too, so `labelForOption` and the review screen
         can name it — not just this component. */
      registerFoundOptions(market as MarketId, category, [option]);
      const next =
        rest.mode === "single"
          ? [option.id]
          : selected.includes(option.id)
            ? selected
            : [...selected, option.id];
      rest.onChange(next, { id: option.id, on: true });
      setQuery("");
      setResults([]);
      setResultsFor("");
    },
    [rest, selected],
  );

  const atCap =
    rest.max !== undefined && selected.length + (rest.custom?.length ?? 0) >= rest.max;

  /* Only results not already on screen as chips — a result that is already a
     starter would otherwise appear twice, once above and once below the box. */
  const unshown = results.filter((r) => !merged.some((m) => m.id === r.id));

  return (
    <div>
      <ChipGroup
        {...rest}
        options={merged}
        selected={selected}
        custom={rest.custom}
        /* The typed fallback stays available *inside* the search results, where
           her instruction puts it ("Can't find it? Add it — always visible in
           results"), so it is not offered twice. */
        otherLabel={undefined}
        onAddCustom={undefined}
      />

      <div className="mt-4">
        <label
          htmlFor={`search-${category}`}
          className="block text-[14px] font-semibold text-ink-soft"
        >
          {searchLabel}
        </label>
        <input
          id={`search-${category}`}
          value={query}
          /* Points at the one status line below, so the count is available on
             demand and not only when it happens to be announced. */
          aria-describedby={`search-${category}-status`}
          aria-busy={searching}
          onChange={(e) => setQuery(e.target.value.slice(0, 60))}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Start typing a name"
          className="mt-1.5 min-h-[52px] w-full rounded-2xl border border-bark bg-card px-4 text-[16px] outline-none placeholder:text-muted/60 focus:border-green"
        />

        {query.trim().length >= 2 && (
          <div className="mt-2.5">
            {/**
              * What the search is doing, in one place and said out loud.
              *
              * There were four sibling messages here — "Looking…", the failure
              * line, and "Nothing matching …" — each rendered separately and
              * none of them announced. So a parent using a screen reader typed
              * three letters and got silence: the list below had changed, the
              * count had changed, and nothing said so. Typing is exactly the
              * moment you are not looking at the results.
              *
              * One `role="status"` region, because that is one fact: what
              * happened to the search. **The list is deliberately outside it** —
              * a live region wrapping the results would read out all forty
              * matches on every keystroke, which is worse than silence.
              *
              * When there *are* matches the line is `sr-only`: the results are
              * on screen for anyone who can see them, and the only thing missing
              * was the count.
              */}
            <p
              id={`search-${category}-status`}
              role="status"
              aria-live="polite"
              className={
                searching
                  ? "text-[13.5px] text-muted"
                  : failed
                    ? "text-[13.5px] text-gold-ink"
                    : unshown.length > 0
                      ? "sr-only"
                      : "text-[13.5px] text-muted"
              }
            >
              {searching
                ? "Looking…"
                : failed
                  ? "Search isn't answering just now. You can still add it below."
                  : unshown.length > 0
                    ? `${unshown.length} ${unshown.length === 1 ? "match" : "matches"} for “${query.trim()}”.`
                    : `Nothing matching “${query.trim()}”.`}
            </p>

            {!searching && !failed && unshown.length > 0 && (
              <ul className="space-y-1.5">
                {unshown.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      disabled={atCap}
                      /* The visible "Add" is decorative — the accessible name
                         has to carry the verb *and* which one, or every result
                         in the list reads as an unlabelled button. */
                      aria-label={`Add ${option.label}`}
                      onClick={() => take(option)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-bark bg-card px-4 py-2.5 text-left transition-colors enabled:hover:border-green disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium">
                          {option.label}
                        </span>
                        {/**
                          * The area is what tells three "Willard Elementary
                          * School"s apart, and `hint` carries "closed" or "not
                          * verified" — both worth reading before picking one.
                          *
                          * Suppressed when the label already says it: a previous
                          * place is stored as "Berlin, DE" with `area = "DE"`,
                          * because the area is what search ranks on — and printed
                          * blindly that read "Berlin, DEDE". A subtitle must not
                          * repeat its own title.
                          */}
                        {(() => {
                          const area =
                            option.area && !option.label.endsWith(option.area)
                              ? option.area
                              : null;
                          const meta = [area, option.hint].filter(Boolean);
                          if (meta.length === 0) return null;
                          return (
                            <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                              {meta.join(" · ")}
                            </span>
                          );
                        })()}
                      </span>
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-[13px] font-semibold text-green-deep"
                      >
                        Add
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Always visible in results, her instruction — including when there
                are matches, because the right answer may be the one Pando does
                not know yet. */}
            {onAddCustom && (
              <button
                type="button"
                disabled={atCap}
                onClick={() => {
                  onAddCustom(query.trim());
                  setQuery("");
                  setResults([]);
                  setResultsFor("");
                }}
                className="mt-2 min-h-11 text-[14.5px] font-semibold text-green-deep underline underline-offset-2 disabled:opacity-50"
              >
                Can&apos;t find it? Add “{query.trim()}”
              </button>
            )}
          </div>
        )}

        {(otherLabel || footnote) && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            {[otherLabel, footnote].filter(Boolean).join(". ")}
          </p>
        )}
      </div>
    </div>
  );
}
