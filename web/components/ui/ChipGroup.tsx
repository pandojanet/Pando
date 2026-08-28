"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { Option } from "@/lib/types";
import { AddOtherChip, Chip, CustomChip } from "./Chip";
import { OtherSheet } from "./OtherSheet";

interface Props {
  /** Shown when a screen carries more than one question. */
  label?: string;
  options: Option[];
  mode: "single" | "multi";
  selected: string[];
  onChange: (next: string[], changed: { id: string; on: boolean }) => void;
  layout?: "wrap" | "grid";
  /** Free-text answers already added for this question. */
  custom?: string[];
  otherLabel?: string;
  onAddCustom?: (value: string) => void;
  onRemoveCustom?: (value: string) => void;
  groupLabel: string;
  /**
   * The most answers this question can hold, counting typed ones. Undefined is
   * the normal case — most questions take as many as apply.
   *
   * A cap only ever blocks *adding*: deselecting stays possible at the limit, or
   * a parent who reaches it can never change their mind, and "swap one for
   * another" becomes "start the screen again".
   */
  max?: number;
  /** Shown once the cap is reached. Worded by the caller — only it knows why. */
  maxHint?: string;
}

export function ChipGroup({
  label,
  options,
  mode,
  selected,
  onChange,
  layout = "wrap",
  custom = [],
  otherLabel,
  onAddCustom,
  onRemoveCustom,
  groupLabel,
  max,
  maxHint,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const exclusiveIds = options.filter((o) => o.exclusive).map((o) => o.id);

  /* Typed answers count. "Another school" is still a school, so leaving customs
     out would make the cap trivially avoidable by the one path that produces the
     least matchable data. */
  const atMax = max !== undefined && selected.length + custom.length >= max;

  /**
   * Split into the options that carry a `section` and those that do not.
   *
   * Order is preserved rather than sorted: the taxonomy importer writes clubs in
   * her order — private clubs first, then service leagues — and the two special
   * options ("None", "Prefer not to say") carry no section, so they stay above
   * the headings where a refusal reads as belonging to the whole question rather
   * than to one group.
   */
  const ungrouped = options.filter((o) => !o.section);
  const grouped = (() => {
    const bySection = new Map<string, Option[]>();
    for (const o of options) {
      if (!o.section) continue;
      const list = bySection.get(o.section) ?? [];
      list.push(o);
      bySection.set(o.section, list);
    }
    return [...bySection.entries()];
  })();
  /* "None / prefer not to say" clears the group, so it can never take it over the
     limit — and refusing to answer must stay reachable at any count. */
  const blocked = (option: Option) =>
    mode === "multi" &&
    atMax &&
    !option.exclusive &&
    !selected.includes(option.id);

  function toggle(option: Option) {
    const on = !selected.includes(option.id);
    if (on && blocked(option)) return;

    if (mode === "single") {
      /* Radio semantics: tapping the chosen one keeps it chosen. Allowing a
         deselect meant the pre-set answer (the monthly allowance defaults to 3)
         was cleared by the first tap, which is the opposite of what tapping it
         means. */
      onChange([option.id], { id: option.id, on: true });
      return;
    }

    let next: string[];
    if (option.exclusive) {
      // "None / prefer not to say" clears everything else.
      next = on ? [option.id] : [];
    } else {
      next = on
        ? [...selected.filter((id) => !exclusiveIds.includes(id)), option.id]
        : selected.filter((id) => id !== option.id);
    }
    onChange(next, { id: option.id, on });
  }

  return (
    <div>
      {label && (
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
          {label}
        </h2>
      )}

      <div
        role={mode === "single" ? "radiogroup" : "group"}
        aria-label={groupLabel}
        className={cn(
          /* The age picker used to be a real grid, which left its last row
             ragged against the right edge — 17 options never divide evenly into
             4/5/7 columns. Wrapping flex centres every row instead, and the
             uniform `min-w` on a compact chip keeps the tidy grid rhythm. */
          layout === "grid"
            ? "flex flex-wrap justify-center gap-2"
            : "flex flex-wrap gap-2",
        )}
      >
        {ungrouped.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            hint={option.hint}
            mode={mode}
            compact={layout === "grid"}
            selected={selected.includes(option.id)}
            disabled={blocked(option)}
            onToggle={() => toggle(option)}
          />
        ))}

        {/**
          * Visible sections inside one question — the client's instruction for
          * clubs (24 Aug): "Keep one multi-select question but separate the
          * options into: (1) Private, recreational & social clubs; and (2)
          * Service leagues & member organizations. These are both valid shared
          * circles but should not be presented as the same kind of affiliation."
          *
          * Grouped here rather than by splitting the question, exactly as she
          * asked: one answer, two headings. Options with no `section` render
          * above, ungrouped, which is what keeps every other question unchanged.
          */}
        {grouped.map(([section, list]) => (
          <div key={section} className="w-full">
            <p className="mb-1.5 mt-1 text-[12px] font-semibold uppercase tracking-[0.09em] text-muted">
              {section}
            </p>
            <div className="flex flex-wrap gap-2">
              {list.map((option) => (
                <Chip
                  key={option.id}
                  label={option.label}
                  hint={option.hint}
                  mode={mode}
                  compact={layout === "grid"}
                  selected={selected.includes(option.id)}
                  disabled={blocked(option)}
                  onToggle={() => toggle(option)}
                />
              ))}
            </div>
          </div>
        ))}

        {custom.map((value) => (
          <CustomChip
            key={value}
            label={value}
            onRemove={() => onRemoveCustom?.(value)}
          />
        ))}

        {onAddCustom && (
          <AddOtherChip
            label={otherLabel ?? "Other"}
            disabled={atMax}
            onClick={() => setSheetOpen(true)}
          />
        )}
      </div>

      {/* Stated only once it bites. Explaining a limit a parent has not reached
          is a rule to remember instead of a screen to answer — and this is a
          full question, never an error: they have done nothing wrong. */}
      {atMax && maxHint && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{maxHint}</p>
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
