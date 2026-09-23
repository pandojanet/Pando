"use client";

import { Badge, ConfidenceBadge, optionLabel, slugLabel, when } from "@/components/admin/ui";
import { Fact, FactGrid, Quote, RecordNotes } from "@/components/admin/Record";
import type { ContributionRow } from "@/lib/admin/types";
import { FRESHNESS, RECOMMENDATION, sentence } from "@/lib/admin/labels";
import { PRICE_BAND, PRICE_UNIT, WORTH_IT } from "@/lib/seed-chat/scripts";

/**
 * Everything one parent said about one recommendation — the facts and their
 * own words — as the contributions queue shows it (23 Sep, extracted).
 *
 * It lives here because it has two readers now: the queue, where a reviewer
 * decides on the card, and the contributor page, where the Founding decision
 * is checked against the cards it rests on. Two copies of this block would
 * drift in exactly the place where a reviewer and an approver must be reading
 * the same record.
 */
export function ContributionFacts({ row }: { row: ContributionRow }) {
  const missing = missingForFounding(row);
  return (
    <>
      <FactGrid>
        <Fact label="Where">
          {row.share.neighborhoods.length === 0
            ? null
            : row.share.neighborhoods.map(slugLabel).join(", ")}
        </Fact>
        <Fact label="Who it was for">
          {row.child_age_at_time.length
            ? `Age ${row.child_age_at_time.join(", ")} at the time`
            : null}
        </Fact>
        <Fact label="Would recommend">
          {row.recommendation ? (
            <Badge
              tone={RECOMMENDATION[row.recommendation]?.tone ?? "gold"}
            >
              {RECOMMENDATION[row.recommendation]?.label ??
                sentence(row.recommendation)}
            </Badge>
          ) : null}
        </Fact>
        <Fact
          label="Paid"
          hint={row.worth_it ? optionLabel(WORTH_IT, row.worth_it) : undefined}
        >
          {row.price_band ? (
            <>
              {optionLabel(PRICE_BAND, row.price_band)}
              {row.price_unit && (
                <span className="text-muted">
                  {" / "}
                  {optionLabel(PRICE_UNIT, row.price_unit).toLowerCase()}
                </span>
              )}
            </>
          ) : null}
        </Fact>
        <Fact
          label="How recent"
          /* Only when there is a date. `when(null)` is an em dash,
             and an em dash under a filled value reads as a second,
             missing answer rather than as "no date recorded". */
          hint={
            row.share.last_confirmed_at
              ? `Last confirmed ${when(row.share.last_confirmed_at)}`
              : undefined
          }
        >
          {FRESHNESS[row.share.freshness_state]?.label ??
              sentence(row.share.freshness_state)}
        </Fact>
        {/* R11 — a permission, so it belongs with the recommendation
            it applies to rather than in the badge row, where it was
            a fourth pill competing with the review status. */}
        <Fact
          label="Follow-up"
        >
          {row.follow_up_ok
            ? "Happy to be asked more about this one"
            : "Not offered"}
        </Fact>
        {/**
            * ⚠⚠ **"Fully answered", not "Counts toward Founding"** (23 Sep). That
            * was this fact's label, and since 16 Sep it has been false: Founding
            * counts two contributions an admin **approved**, whatever they answer
            * (`FOUNDING_MIN_APPROVED`, `lib/rewards.ts`), while this reads the
            * older six-field checklist. On the contributor page it sat under an
            * approved card that counts and said "Not yet". What it measures is
            * whether the record is complete, so that is what it now says.
            */}
          <Fact label="Fully answered">
          {!row.firsthand ? (
            <span className="text-muted">No — heard from a friend</span>
          ) : missing.length === 0 ? (
            <Badge tone="green">Yes</Badge>
          ) : (
            <span className="text-gold-ink">
              Not yet — they didn&apos;t say {missing.join(", ")}
            </span>
          )}
        </Fact>
        <Fact label="How useful their words are">
          <ConfidenceBadge
            value={row.confidence}
            note={row.confidence_note}
          />
        </Fact>
        {row.share.venue && <Fact label="Venue">{row.share.venue}</Fact>}
      </FactGrid>

      {(row.what_makes_it_great ||
        row.tip_text ||
        row.caveat ||
        row.caveat_answered ||
        row.extra_note ||
        row.who_for ||
        row.who_not_for ||
        (row.status === "needs_detail" && row.needs_detail_note)) && (
        <RecordNotes>
          {row.what_makes_it_great && (
            <Quote label="What they liked">
              {row.what_makes_it_great}
            </Quote>
          )}
          {row.tip_text && <Quote label="Their tip">{row.tip_text}</Quote>}
          {/* ⚠ `Quote` rather than a `Field`: this is the parent's
              own sentence, and invariant 8 turns on a reviewer
              being able to see that without checking. */}
          {row.extra_note && (
            <Quote label="Anything else">{row.extra_note}</Quote>
          )}
          {row.caveat ? (
            <Quote label="Know first">{row.caveat}</Quote>
          ) : row.caveat_answered ? (
            <p className="text-[12.5px] text-muted">
              Asked what to know first — nothing came to mind.
            </p>
          ) : null}
          {(row.who_for || row.who_not_for) && (
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {row.who_for && (
                <>
                  <span className="font-semibold">Perfect for</span>{" "}
                  {row.who_for}.{" "}
                </>
              )}
              {row.who_not_for && (
                <>
                  <span className="font-semibold">Might not suit</span>{" "}
                  {row.who_not_for}.
                </>
              )}
            </p>
          )}
          {row.status === "needs_detail" && row.needs_detail_note && (
            <p className="rounded-lg border border-gold-line bg-gold-wash px-3 py-2 text-[12.5px] leading-relaxed text-gold-ink">
              You asked: “{row.needs_detail_note}”
            </p>
          )}
        </RecordNotes>
      )}
    </>
  );
}

/**
 * What the record still lacks, in the words a parent was actually asked.
 *
 * These read out on screen as "missing a strength, fit, caveat asked" — which
 * were the *column* names and not questions anybody recognises. Each one now
 * names the question the parent skipped, so an admin can tell at a glance
 * whether it is worth asking for.
 *
 * ⚠ Not the Founding rule (see "Fully answered" above): the name is kept so
 * the queue's filters, which use it, did not move in this change.
 */
export function missingForFounding(row: ContributionRow): string[] {
  const missing: string[] = [];
  if (row.child_age_at_time.length === 0) missing.push("how old their child was");
  if (!row.last_there) missing.push("when they were last there");
  if (!row.what_makes_it_great) missing.push("what they liked about it");
  if (!row.who_for && !row.who_not_for) missing.push("who it suits");
  if (!row.caveat_answered) missing.push("whether there's a catch");
  return missing;
}
