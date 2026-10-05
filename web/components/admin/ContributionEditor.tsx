"use client";

import { useState } from "react";
import { Button, Field, inputClass } from "@/components/admin/ui";
import { Select } from "@/components/admin/kit";
import type { ContributionRow } from "@/lib/admin/types";
import type { CleanPatch } from "@/lib/admin/contribution-edit";
import {
  HOW_MUCH,
  LAST_THERE,
  PRICE_BAND,
  PRICE_UNIT,
  RECOMMENDATION_OPTIONS,
  WORTH_IT,
} from "@/lib/seed-chat/scripts";

/**
 * Every field of a contribution, answered or not (5 Oct, the client's admin
 * round). The drawer used to hold four text boxes, so a card that "needs
 * follow-up" for a missing age could not be completed by the person reading it.
 *
 * A module-level component with its own state, not a block inside the page: a
 * component declared during render is a new type every keystroke, and each
 * keystroke would take the caret with it.
 *
 * Only what changed is sent, so the audit row says what an admin did rather than
 * restating the whole card, and a field left alone is left alone. An empty value
 * on a field that had one clears it.
 *
 * Which fields appear follows the kind — a tip has no price and an activity has
 * no "the tip" — but within a kind **all** of them are here. `firsthand` is not:
 * it is the parent's own statement of whose experience this is.
 */

const NONE = [{ id: "", label: "Not answered" }];
const withNone = (options: ReadonlyArray<{ id: string; label: string }>) => [...NONE, ...options];

function parseAges(text: string): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const ages = parts.map(Number);
  if (ages.some((a) => !Number.isInteger(a) || a < 0 || a > 25)) return null;
  return [...new Set(ages)].sort((a, b) => a - b);
}

export function ContributionEditor({
  row,
  busy,
  onSave,
}: {
  row: ContributionRow;
  busy: boolean;
  onSave: (patch: CleanPatch) => void;
}) {
  const start = {
    why: row.what_makes_it_great ?? "",
    caveat: row.caveat ?? "",
    nothingToFlag: row.caveat_answered && !row.caveat,
    who_for: row.who_for ?? "",
    who_not_for: row.who_not_for ?? "",
    tip: row.tip_text ?? "",
    extra: row.extra_note ?? "",
    ages: row.child_age_at_time.join(", "),
    last_there: row.last_there ?? "",
    how_much: row.how_much ?? "",
    recommendation: row.recommendation ?? "",
    price_band: row.price_band ?? "",
    price_unit: row.price_unit ?? "",
    worth_it: row.worth_it ?? "",
    follow_up: row.follow_up_ok,
  };
  const [v, setV] = useState(start);
  const set = <K extends keyof typeof start>(key: K, value: (typeof start)[K]) =>
    setV((cur) => ({ ...cur, [key]: value }));

  const isActivity = row.kind === "activity";
  const isTip = row.kind === "tip";
  const ages = parseAges(v.ages);
  const paid = v.price_band !== "" && v.price_band !== "free" && v.price_band !== "prefer_not_to_say";
  const problem =
    ages === null
      ? "Ages are whole numbers from 0 to 25, like 3, 6"
      : paid && v.price_unit === ""
        ? "A price needs what it is per"
        : null;

  const patch: CleanPatch = {};
  if (v.why !== start.why) patch.what_makes_it_great = v.why;
  if (v.caveat !== start.caveat) patch.caveat = v.caveat;
  if (v.nothingToFlag !== start.nothingToFlag && v.caveat === "") patch.caveat_answered = v.nothingToFlag;
  if (isTip && v.tip !== start.tip) patch.tip_text = v.tip;
  if (v.extra !== start.extra) patch.extra_note = v.extra;
  if (isActivity) {
    if (v.who_for !== start.who_for) patch.who_for = v.who_for;
    if (v.who_not_for !== start.who_not_for) patch.who_not_for = v.who_not_for;
    if (v.last_there !== start.last_there) patch.last_there = v.last_there;
    if (v.how_much !== start.how_much) patch.how_much = v.how_much;
    if (v.recommendation !== start.recommendation) patch.recommendation = v.recommendation;
    if (v.worth_it !== start.worth_it) patch.worth_it = v.worth_it;
    if (v.price_band !== start.price_band || v.price_unit !== start.price_unit) {
      patch.price_band = v.price_band;
      patch.price_unit = v.price_unit;
    }
    if (v.follow_up !== start.follow_up) patch.follow_up_ok = v.follow_up;
  }
  if (!isTip && ages !== null && v.ages !== start.ages) patch.child_age_at_time = ages;
  const changed = Object.keys(patch).length > 0;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {!isTip && (
          <Field label="Child's age at the time">
            <input
              className={inputClass}
              placeholder="e.g. 3, 6"
              value={v.ages}
              onChange={(e) => set("ages", e.target.value)}
            />
          </Field>
        )}
        {isActivity && (
          <Field label="Last there">
            <Select
              label="Last there"
              value={v.last_there}
              onChange={(x) => set("last_there", x)}
              options={withNone(LAST_THERE)}
              className="w-full"
            />
          </Field>
        )}
        {isActivity && (
          <Field label="Would recommend">
            <Select
              label="Would recommend"
              value={v.recommendation}
              onChange={(x) => set("recommendation", x)}
              options={withNone(RECOMMENDATION_OPTIONS)}
              className="w-full"
            />
          </Field>
        )}
        {isActivity && (
          <Field label="How long or how often">
            <Select
              label="How long or how often"
              value={v.how_much}
              onChange={(x) => set("how_much", x)}
              options={withNone(HOW_MUCH)}
              className="w-full"
            />
          </Field>
        )}
        {isTip && (
          <Field label="The tip">
            <textarea
              className={inputClass}
              rows={2}
              value={v.tip}
              onChange={(e) => set("tip", e.target.value)}
            />
          </Field>
        )}
        <Field label={isTip ? "Why it helped" : "What makes it good"}>
          <textarea
            className={inputClass}
            rows={2}
            value={v.why}
            onChange={(e) => set("why", e.target.value)}
          />
        </Field>
        {!isTip && (
          <Field label="Know first (caveat)">
            <textarea
              className={inputClass}
              rows={2}
              value={v.caveat}
              onChange={(e) => set("caveat", e.target.value)}
            />
            <label className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={v.nothingToFlag}
                disabled={v.caveat !== ""}
                onChange={(e) => set("nothingToFlag", e.target.checked)}
              />
              They were asked, and had nothing to flag
            </label>
          </Field>
        )}
        {isActivity && (
          <Field label="Perfect for">
            <input
              className={inputClass}
              value={v.who_for}
              onChange={(e) => set("who_for", e.target.value)}
            />
          </Field>
        )}
        {isActivity && (
          <Field label="Might not suit">
            <input
              className={inputClass}
              value={v.who_not_for}
              onChange={(e) => set("who_not_for", e.target.value)}
            />
          </Field>
        )}
        {isActivity && (
          <Field label="Paid">
            <Select
              label="Paid"
              value={v.price_band}
              onChange={(x) => set("price_band", x)}
              options={withNone(PRICE_BAND)}
              className="w-full"
            />
          </Field>
        )}
        {isActivity && paid && (
          <Field label="Per">
            <Select
              label="Per"
              value={v.price_unit}
              onChange={(x) => set("price_unit", x)}
              options={withNone(PRICE_UNIT)}
              className="w-full"
            />
          </Field>
        )}
        {isActivity && (
          <Field label="Worth the money">
            <Select
              label="Worth the money"
              value={v.worth_it}
              onChange={(x) => set("worth_it", x)}
              options={withNone(WORTH_IT)}
              className="w-full"
            />
          </Field>
        )}
        <Field label="Anything else (their last comment)">
          <textarea
            className={inputClass}
            rows={2}
            value={v.extra}
            onChange={(e) => set("extra", e.target.value)}
          />
        </Field>
        {isActivity && (
          <label className="flex items-center gap-2 self-end text-[13px]">
            <input
              type="checkbox"
              checked={v.follow_up}
              onChange={(e) => set("follow_up", e.target.checked)}
            />
            Happy to be asked more about this one
          </label>
        )}
      </div>
      {problem && <p className="mt-2 text-[12.5px] text-alert">{problem}</p>}
      <div className="mt-3">
        <Button
          tone="primary"
          disabled={busy || !changed || problem !== null}
          onClick={() => onSave(patch)}
        >
          Save changes
        </Button>
      </div>
    </>
  );
}
