"use client";

import { useEffect, useState } from "react";

import { OptionPicker } from "@/components/ui/OptionPicker";
import { searchMarketOptions } from "@/lib/api-client";
import type { Fields, Step } from "@/lib/seed-chat/types";
import type { MarketCategory, MarketId, Option } from "@/lib/types";

/**
 * "Do you mean Lovebug and Friends in Pasadena?" — the client, 10 Sep.
 *
 * *"Autocomplete known places. If there is no match, ask for the town, never a
 * street address … it would be great if it felt like an easy conversation vs
 * lots of typing."*
 *
 * ## Why this is what makes six questions possible
 *
 * The activity card used to ask for the name, then the area, then *"anything
 * more exact — a street or the venue"*: three questions to identify one place,
 * and the third asked a parent to type an address from memory. The market
 * already holds **588 curated records** with their city on each one, so a
 * matched name answers all three at once — which is the difference between a
 * seven-question card and her six.
 *
 * So the match writes two fields, not one: `name` and the `location` the record
 * already knows. `location` then satisfies the town step's own `when`, and it
 * simply does not appear. A parent naming a place the directory has never heard
 * of gets the town question and nothing else — never the street.
 *
 * ## Three rules
 *
 * **The canonical label is what gets stored**, not what was typed. `saveCard`
 * reuses an existing `shares` row on an exact name match in the same market and
 * kind, so "little maestros" and "Little Maestros" being one record is the
 * difference between a place with four parents behind it and four places with
 * one each — which is the whole of what `Validated by multiple parents` means.
 *
 * **A name Pando does not know is a first-class answer**, taken through
 * `onAddCustom` exactly as it is on the profile's directory questions
 * (invariant 9's rule one layer up: an unmatched answer is recorded, not
 * refused). It carries no `location`, which is precisely the signal the town
 * step reads.
 *
 * ⚠ **The search is remote and debounced, and "still waiting" is derived** —
 * `resultsFor` records which query the results answer, so the status line can
 * never say *"Nothing matching X"* about a search that has not run. That is the
 * 26 Aug lesson from the profile's own search box, where the same status was
 * announced out loud and then corrected itself twice.
 */
export function PlaceStep({
  step,
  market,
  area,
  onAnswer,
}: {
  step: Step;
  market: MarketId;
  /** The parent's own town — ranks the results, never filters them. */
  area?: string | null;
  onAnswer: (value: string, extra?: Fields) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Option[]>([]);
  const [resultsFor, setResultsFor] = useState("");
  const [failed, setFailed] = useState(false);
  const searching = query.trim() !== resultsFor;

  const category = step.searchCategory as MarketCategory | undefined;

  useEffect(() => {
    const q = query.trim();
    if (!category || q.length < 2) {
      setResults([]);
      setResultsFor(q);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchMarketOptions({ category, market, q, area: area ?? undefined })
        .then((found) => {
          if (!live) return;
          setResults(found);
          setFailed(false);
        })
        .catch(() => {
          if (!live) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => {
          if (live) setResultsFor(q);
        });
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, category, market, area]);

  /**
   * ⚠ The status is one line, and it is the only one. Four sibling messages
   * ("Looking…", a failure, "Nothing matching…") is what the profile's search
   * had before 26 Aug, and a live region reading all of them per keystroke is
   * worse than silence.
   */
  const status = searching
    ? "Looking…"
    : failed
      ? "Search is unavailable — type the name and carry on."
      : query.trim().length >= 2 && results.length === 0
        ? `Nothing matching “${query.trim()}” — type it and carry on.`
        : "";

  return (
    <OptionPicker
      groupLabel={step.prompt}
      mode="single"
      options={results}
      selected={[]}
      onChange={(next) => {
        const picked = results.find((o) => o.id === next[0]);
        if (!picked) return;
        /* Both fields at once — the record already knows its town, so the step
           after this one has nothing left to ask. */
        onAnswer(
          picked.label,
          picked.area_slug ? { location: [picked.area_slug] } : undefined,
        );
      }}
      otherLabel={step.placeholder ?? "Use what I typed"}
      onAddCustom={(value) => {
        const typed = value.trim();
        if (typed !== "") onAnswer(typed);
      }}
      onRemoveCustom={() => {}}
      searchLabel={step.prompt}
      placeholder={step.placeholder ?? "Start typing a name"}
      query={query}
      onQueryChange={setQuery}
      status={status}
      wrapLabels
    />
  );
}
