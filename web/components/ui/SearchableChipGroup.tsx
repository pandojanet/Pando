"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { Field } from "@/components/ui/Field";
import { TextAction } from "@/components/ui/TextAction";
import { geocodePlaces, searchMarketOptions } from "@/lib/api-client";
import { placesForZip } from "@/lib/home-places";
import { worthGeocoding, type GeocodedPlace } from "@/lib/geo";
import { neighborhoodCity, registerFoundOptions } from "@/lib/market-options";
import { useMarketOptions } from "@/lib/use-market-options";
import { visibleStarters } from "@/lib/starters";
import type { MarketCategory, MarketId, Option } from "@/lib/types";

interface Props {
  label?: string;
  /** Passed straight through to whichever control renders. */
  help?: string;
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
  /**
   * Render as a searchable dropdown instead of chips plus a search box.
   *
   * Set per question in `SEARCHABLE_QUESTIONS`, so the questions that get one
   * are named rather than inferred from what they are not.
   */
  dropdown?: boolean;
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
  /**
   * Record a place a **map** verified — which is not the permission
   * `onAddCustom` grants, and the distinction is the client's own.
   *
   * Her item 2: *"Keep one autocomplete route for unlisted locations. Remove the
   * stranded 'Other nearby area' text unless it is an actionable option."* So
   * the neighborhood question has no `allowOther` and no free-text box, and it
   * should not get one back. ⚠ What it had instead was **nothing**: a parent in
   * Sylmar or Santa Barbara met a required question with no answer they could
   * give, while the comment on that question claimed the search results carried
   * a "Can't find it? Add it" — a control that never rendered, because
   * `onAddCustom` is undefined there. A sentence describing a button nobody
   * implemented, which is the fault this repository keeps naming.
   *
   * This is the actionable option her sentence attaches the exception to. There
   * is still no way to type an arbitrary string here; the only way in is to tap
   * a row that came back from the map, carrying a canonical name, a ZIP and a
   * county — which is what makes the pending row one an admin can promote in a
   * single step rather than a fragment they have to research.
   *
   * It writes to the same place a typed answer does (`answers.other`), so
   * `derivePendingOptions` files it and `graphTargetForCategory` repairs the
   * graph on promotion. Invariant 9 holds untouched: verified by Google is not
   * verified by Pando, and it is not matchable until a person says so.
   */
  onAddPlace?: (value: string) => void;
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
  dropdown,
  searchLabel,
  footnote,
  onAddPlace,
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
   * Places Google knows and Pando does not — the third and last thing asked.
   *
   * ⚠ Held apart from `results` rather than merged into it, and that is the
   * substance rather than tidiness: a directory result **is** a
   * `market_options` row, so tapping it stores a slug the matcher already
   * understands. One of these is not. It has been verified by Google and by
   * nobody at Pando, so picking it takes the typed-answer path (invariant 9:
   * *"Other answers are not matchable until an admin promotes them"*) and the
   * screen has to be able to say which kind of row somebody is tapping.
   */
  const [geo, setGeo] = useState<GeocodedPlace[]>([]);
  /**
   * Four states, because three of them are not "nothing found".
   *
   * `off` is a deployment with no `GOOGLE_MAPS_API_KEY` and `failed` is a
   * lookup that did not run — neither may ever render as *"no such place"*.
   * That is the 9 Sep fault (`PublicSearchResult.configured`, computed and read
   * by nobody) kept from repeating, this time by giving each state a sentence.
   */
  const [geoState, setGeoState] = useState<"idle" | "looking" | "off" | "failed">(
    "idle",
  );
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
  /**
   * The city behind the neighborhood, so a Pasadena district matches Pasadena's
   * records (8 Sep).
   *
   * `useMarketOptions` is called here for its **subscription**, not for the
   * fetch — that is guarded per market and the parent screen has already
   * started it. Without it this memo would never recompute when the roll-up
   * lands, and the fix would work only for a parent who happened to arrive
   * after the response. Before it lands `neighborhoodCity` returns the id
   * unchanged, which is exactly the old behaviour.
   */
  const version = useMarketOptions(market as MarketId);
  const areaCity = useMemo(
    () => neighborhoodCity(market as MarketId, area),
    [market, area, version],
  );

  const visible = useMemo(
    () => visibleStarters({ options, area, areaCity, selected, wholeList }),
    [options, area, areaCity, selected, wholeList],
  );

  /* The visible starters plus anything searched up, de-duplicated by id with the
     starter winning — a starter carries the curation and should not be replaced
     by the same record arriving from search. */
  const merged = useMemo(() => {
    const seen = new Set(visible.map((o) => o.id));
    return [...visible, ...found.filter((o) => !seen.has(o.id))];
  }, [visible, found]);

  const timer = useRef<number | null>(null);
  /** Its own timer, because a billed call waits longer than a free one. */
  const geoTimer = useRef<number | null>(null);
  /**
   * Which lookup is current.
   *
   * A counter rather than an `AbortController`, because the thing that must not
   * happen is a **stale answer rendering**, not a request continuing: the reply
   * is already cached server-side by the time it lands, so letting it finish
   * costs nothing and paying for it twice would be the alternative.
   */
  const geoRun = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (geoTimer.current !== null) window.clearTimeout(geoTimer.current);

    /* Every keystroke invalidates whatever Google has not answered yet. */
    const run = ++geoRun.current;
    setGeo([]);
    setGeoState("idle");

    /* Two characters is the floor the endpoint enforces too. Below it there is
       nothing to show, and clearing the results is the honest state — not the
       previous query's answers sitting under an empty box. */
    if (q.length < 2) {
      setResults([]);
      setResultsFor(q);
      setFailed(false);
      return;
    }

    /**
     * Google, and **only ever as the third question asked**.
     *
     * The order is the whole cost control: the starters are on screen, then
     * `home-places.ts` answers from the bundle for nothing, and only when both
     * have missed does anything leave the building — where every request is
     * billed. `local > 0` is that gate, and it counts what the parent can
     * actually act on rather than what came back, so a town already sitting
     * among the taps never triggers a paid lookup.
     *
     * ⚠ **Its own, longer timer.** The directory search debounces at 220ms
     * because it is a query against our own table; a pause that short still
     * fires two or three times through a word somebody is typing, and here
     * each of those is money. 450ms is a parent having stopped, and the run
     * counter below is what stops a slow answer landing under a newer query —
     * Google is the slowest thing this box can do (a 4s ceiling), so a stale
     * result is a real possibility rather than a theoretical one.
     */
    const widen = (local: number) => {
      if (category !== "neighborhoods" || local > 0) return;
      if (!worthGeocoding(q)) return;
      /* ⚠ Nowhere to put the answer means nothing to pay for. Without a way to
         record a place Pando has no record of, asking Google would buy a row
         whose only button does not exist. */
      if (!onAddPlace) return;
      if (geoTimer.current !== null) window.clearTimeout(geoTimer.current);
      geoTimer.current = window.setTimeout(() => {
        setGeoState("looking");
        void geocodePlaces({ q, market })
          .then((r) => {
            if (run !== geoRun.current) return;
            /* Three states stay three. An unconfigured deployment is not an
               empty result, and neither is a failure — see `geoState`. */
            setGeo(r.configured ? r.places : []);
            setGeoState(r.configured ? "idle" : "off");
          })
          .catch(() => {
            if (run !== geoRun.current) return;
            setGeo([]);
            setGeoState("failed");
          });
      }, 450);
    };

    /**
     * A ZIP is answered here, not by the endpoint — her §5 placeholder is
     * *"Type your town, neighborhood or ZIP code."*
     *
     * `market_options` has no ZIP column and should not: the ZIPs are a
     * matching and validation rule the server has to be able to check, so they
     * live in `lib/home-places.ts`, which is already in this bundle. Asking the
     * database for something it does not hold would be a round trip that can
     * only answer nothing.
     *
     * ⚠ Gated on five digits rather than on "looks numeric", so a name search
     * is untouched — and **only** for this category, because a ZIP means
     * nothing to the schools or clubs directories.
     *
     * A ZIP serving several places returns all of them, which is her *"don't
     * make users pick from duplicate city rows upfront"* satisfied from the
     * other side: the rows appear only once a ZIP has narrowed them to three.
     */
    if (category === "neighborhoods" && /^\d{5}$/.test(q)) {
      const local = placesForZip(q).map((p) => ({ id: p.id, label: p.name }));
      setResults(local);
      setFailed(false);
      setResultsFor(q);
      /* One of the 62 in her table answers instantly and costs nothing; the
         other ~41,000 US postcodes are what this widens to. */
      widen(local.length);
      return () => {
        if (geoTimer.current !== null) window.clearTimeout(geoTimer.current);
      };
    }

    timer.current = window.setTimeout(() => {
      void searchMarketOptions({ category, market, q, area: area ?? undefined })
        .then((r) => {
          setResults(r);
          setFailed(false);
          widen(r.length);
        })
        .catch(() => {
          /* Same honesty rule as the rest of the app: say the search did not
             work rather than showing an empty result, which reads as "your
             school is not in Pando". The starters and "add it" still work.

             ⚠ And **no widening on a failure**: the directory did not say this
             place is missing, it said nothing at all, so paying Google to
             second-guess a network error would spend money to answer a
             question nobody managed to ask. */
          setResults([]);
          setFailed(true);
        })
        /* Last, and in both branches: this is what marks the query settled, so
           a result that is about to be replaced never reads as the answer. */
        .finally(() => setResultsFor(q));
    }, 220);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (geoTimer.current !== null) window.clearTimeout(geoTimer.current);
    };
  }, [query, category, market, area, onAddPlace]);

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
  /* The other half of that filter, so the status can tell "no match" from
     "matched something you can already see". */
  const matchedButShown = results.filter((r) => merged.some((m) => m.id === r.id));

  /**
   * Picking a record that came from the directory, rather than from the
   * starters.
   *
   * `OptionPicker` calls `onChange` straight through, so this is where a found
   * record has to be kept — in `found`, which is what puts it in `merged` once
   * the query clears, and in the shared runtime table, which is what lets
   * `labelForOption`, the review screen and the next reload print its name
   * instead of the slug.
   */
  const onPick = useCallback(
    (next: string[], changed: { id: string; on: boolean }) => {
      if (changed.on) {
        const record = results.find((r) => r.id === changed.id);
        if (record) {
          setFound((prev) =>
            prev.some((o) => o.id === record.id) ? prev : [...prev, record],
          );
          registerFoundOptions(market as MarketId, category, [record]);
        }
      }
      rest.onChange(next, changed);
    },
    [results, market, category, rest],
  );

  /**
   * The dropdown, on the questions that ask for one and no others.
   *
   * The client asked for the circles questions — schools, classes, camps, clubs,
   * faith — to offer a searchable dropdown rather than a wall of buttons.
   *
   * ⚠ **Opted into per question, never derived.** This first read "everything
   * except `wholeList`", and deciding by the absence of an unrelated property is
   * how it swept in *"where have you lived before?"* — a question on the tenure
   * screen that the client never mentioned and that had **no option buttons to
   * replace**, since it has no starters at all. The rule now names its subjects,
   * so a directory added tomorrow keeps the chips until somebody says otherwise.
   *
   * The seventeen approved towns keep theirs for a second, stronger reason:
   * she requires them read whole, and hiding them behind a tap is the 1 Sep bug
   * (five cities nobody could see) arriving by another route.
   */
  if (dropdown) {
    return (
      <OptionPicker
        {...rest}
        options={merged}
        extra={unshown}
        selected={selected}
        onChange={onPick}
        otherLabel={otherLabel}
        onAddCustom={onAddCustom}
        searchLabel={searchLabel}
        query={query}
        onQueryChange={(q) => setQuery(q.slice(0, 60))}
        footnote={[otherLabel, footnote].filter(Boolean).join(". ") || undefined}
        /**
         * Only the failure, and deliberately only the failure.
         *
         * `OptionPicker` already carries a `role="status"` region for how many
         * options there are, so repeating the count here would announce one
         * fact twice in two wordings. What that region cannot say is that the
         * directory did not answer — which is the honesty rule this app applies
         * everywhere: say the search broke, rather than showing an empty list,
         * which reads as "your school is not in Pando".
         */
        status={
          failed ? (
            <p role="status" aria-live="polite" className="text-help text-gold-ink">
              Search isn&apos;t answering just now. You can still add it below.
            </p>
          ) : searching ? (
            <p className="text-help text-muted">Looking…</p>
          ) : null
        }
      />
    );
  }

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
        <Field
          id={`search-${category}`}
          label={searchLabel}
          value={query}
          /* Points at the one status line below, so the count is available on
             demand and not only when it happens to be announced. `Field` merges
             this with its own describedby rather than replacing it. */
          aria-describedby={`search-${category}-status`}
          aria-busy={searching}
          onChange={(e) => setQuery(e.target.value.slice(0, 60))}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          /* Her §5 placeholder, on the one question it describes. The other
             four directories are schools, classes, clubs and faith
             communities, where a ZIP means nothing.

             ⚠ **And a place is not a name** (15 Sep). `previous_places` is the
             one directory with no starters at all, so this box is the whole
             control — and it invited a parent to type "a name" for a question
             asking which cities they have lived in. The words are her own
             `searchLabel` for that question ("Add a city, state or country"),
             so nothing new is invented. */
          placeholder={
            category === "neighborhoods"
              ? "Type your town, neighborhood or ZIP code"
              : category === "previous_places"
                ? "Type a city, state or country"
                : "Start typing a name"
          }
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
                  ? "text-help text-muted"
                  : failed
                    ? "text-help text-gold-ink"
                    : unshown.length > 0
                      ? "sr-only"
                      : "text-help text-muted"
              }
            >
              {searching
                ? "Looking…"
                : failed
                  ? "Search isn't answering just now. You can still add it below."
                  : unshown.length > 0
                    ? `${unshown.length} ${unshown.length === 1 ? "match" : "matches"} for “${query.trim()}”.`
                    : /**
                       * ⚠ **A match already on screen is not "nothing"**, and
                       * saying so was a small lie this search has always told.
                       *
                       * `unshown` drops a result that is already a chip, which
                       * is right — it would otherwise appear twice — but the
                       * status read the empty list as *no match*. Typing
                       * "Pasadena" with Pasadena among the taps answered
                       * *"Nothing matching 'Pasadena'."*
                       *
                       * Rare enough to survive unnoticed until §5 made it
                       * routine: every in-footprint ZIP resolves to a place,
                       * and for the seventeen starter towns that place is
                       * already a chip. So a parent typing their own ZIP was
                       * told Pando had never heard of it.
                       */
                      matchedButShown.length > 0
                        ? `${matchedButShown.map((o) => o.label).join(", ")} — already in the list above.`
                        : /**
                           * Past Pando's own list, three more things can be
                           * true, and only one of them is "no such place".
                           *
                           * ⚠ **An unconfigured deployment says exactly what it
                           * says today, and that is deliberate rather than an
                           * omission.** With no key nothing wider was ever
                           * promised, so *"Nothing matching"* is a true
                           * statement about Pando's list. A **failure** is
                           * different: there we did reach for the map and it
                           * broke, and reporting that as "no such place" is the
                           * same small lie `unshown` was telling about a chip
                           * already on screen.
                           */
                          geoState === "looking"
                          ? "Looking further afield…"
                          : geo.length > 0
                            ? `${geo.length} ${geo.length === 1 ? "place" : "places"} found on the map. Pando doesn’t cover ${geo.length === 1 ? "it" : "them"} yet — you can still add ${geo.length === 1 ? "it" : "one"}.`
                            : geoState === "failed"
                              ? `Nothing matching “${query.trim()}”, and the wider map isn’t answering just now. You can still add it below.`
                              : `Nothing matching “${query.trim()}”.`}
            </p>

            {/**
              * Places Google knows and Pando does not.
              *
              * ⚠ **Its own list, visibly not the directory above it**, because
              * the two are different kinds of thing and the difference is what
              * a parent is agreeing to. A directory row is a `market_options`
              * record: tapping it stores a slug the matcher understands and
              * the schools, classes and neighbours of that place are already
              * in Pando. One of these is a name Google recognised and nobody
              * at Pando has looked at, so it goes in as a **typed answer**
              * (invariant 9) and waits for a person — and the row says so in
              * words rather than leaving a parent to find out that picking
              * their own town changed nothing.
              */}
            {!searching && geo.length > 0 && onAddPlace && (
              <ul className="mt-2 space-y-1.5">
                {geo.map((place) => (
                  <li key={place.key}>
                    <button
                      type="button"
                      disabled={atCap}
                      aria-label={`Add ${place.name}`}
                      onClick={() => {
                        /* The canonical name, never the key — see `lib/geo.ts`.
                           A slug written from here would be promotion by the
                           back door, and the name is also what collapses
                           "la canada" and "La Cañada" into one pending row an
                           admin can act on once. */
                        onAddPlace(place.storedValue);
                        setQuery("");
                        setResults([]);
                        setResultsFor("");
                        setGeo([]);
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-bark bg-paper px-4 py-2.5 text-left transition-colors enabled:hover:border-green disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-control font-medium">
                          {place.name}
                        </span>
                        {/* The disambiguator, not decoration: two Pasadenas
                            exist and one of them is in Texas. */}
                        {place.where !== "" && (
                          <span className="mt-0.5 block truncate text-dock text-muted">
                            {place.where}
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-help font-semibold text-green-deep"
                      >
                        Add
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

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
                        <span className="block truncate text-control font-medium">
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
                            <span className="mt-0.5 block truncate text-dock text-muted">
                              {meta.join(" · ")}
                            </span>
                          );
                        })()}
                      </span>
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-help font-semibold text-green-deep"
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
              <TextAction
                className="mt-2"
                disabled={atCap}
                onClick={() => {
                  onAddCustom(query.trim());
                  setQuery("");
                  setResults([]);
                  setResultsFor("");
                }}
              >
                Can&apos;t find it? Add “{query.trim()}”
              </TextAction>
            )}
          </div>
        )}

        {(otherLabel || footnote) && (
          <p className="mt-2 text-dock leading-relaxed text-muted">
            {[otherLabel, footnote].filter(Boolean).join(". ")}
          </p>
        )}
      </div>
    </div>
  );
}
