"use client";

import { Fragment, useState } from "react";
import {
  Badge,
  Button,
  Card,
  controlClass,
  Empty,
  ErrorNote,
  Failed,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  slugLabel,
  TableWrap,
  Td,
  Th,
} from "@/components/admin/ui";
import { PersonPicker } from "@/components/admin/PersonPicker";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { RELEVANCE_STEP } from "@/lib/matching";
import { affinityLabel, matchReason, matchReasonValue } from "@/lib/admin/labels";
import type { MatchCandidateRow, MatchingResult } from "@/lib/admin/types";

/**
 * Estimate 6.7 — the matching harness.
 *
 * The client asked for this one herself, and the reason is in the estimate: it is
 * "the cheap way to de-risk matching early without building a consumer web
 * channel". Pando's answer to any question depends entirely on *who it asks*, and
 * until this page existed that choice was reachable only from code.
 *
 * ## What it is for, and what it deliberately cannot do
 *
 * It answers two questions and no others. **"Who would Pando ask?"** — pick a
 * parent, see the ranking. **"Why them?"** — every row shows the reasons that add
 * up to its score, so a ranking can be disagreed with rather than trusted.
 *
 * There is **no send button, and no write action for this resource at all**. The
 * estimate's framing is "validated *before* any live outreach", and a screen that
 * could both score and message would put the pilot's first blast one mis-click
 * from a page whose whole purpose is experimenting.
 *
 * ## 1 Sep — the picker, and the arithmetic
 *
 * The client's report: "there is no search now, and the scoring logic is not
 * entirely clear." Both halves came back after a first pass, which is the part
 * worth recording: a search box was added, and it was a text input stacked on
 * top of the native `<select>` it filtered; a line was added above the table,
 * and the numbers it described were still only explained in a `title`
 * attribute.
 *
 * So, second pass, and this time the fixes are structural rather than textual.
 *
 * **The picker is one control** — `PersonPicker`, a real combobox. Two controls
 * for one job did not only look wrong; typing in the first while the second sat
 * unchanged below it read as a search that did not work.
 *
 * **The score is shown as arithmetic that can be checked.** Every reason badge
 * now carries the points it contributed and, where the value is the
 * interesting fact, *which* school or club it was — so the badges in a row
 * visibly add up to the connections figure beside them, and that figure plus
 * the context figure visibly add up to the total. A reader who wants to know
 * why somebody is second no longer has to hover anything: the row says so. The
 * one number that could be mistaken for another is fixed too — "7.5" beside "7
 * connections" rendered as **"7.57 connections"** on one line, which is not a
 * subtle failure of clarity but a wrong number on the screen.
 *
 * **The weights are explained where they are used.** A page-level explainer put the
 * sentences on the page instead of in a tooltip, and the weight table sat
 * inside that explanation rather than in a separate card at the bottom, where
 * it described badges a screen-height away.
 *
 * ## 2 Sep — the prose goes, the coefficients become the control
 *
 * The client's next instruction was to take the descriptive text about the
 * weights and the arithmetic off this page, leave the coefficients, and let her
 * change them. So the explainer is gone in full — including its first
 * paragraph, which was about what the list is rather than about the scoring —
 * and what is left is `WeightsCard`: the same numbers, as fields.
 *
 * **That is a smaller change to this page's purpose than it looks, and a real
 * one to what it can do.** The rule above still holds exactly as written —
 * nothing here sends anything, and there is still no action on the *matching*
 * resource that reaches a phone. What is new is that the page writes
 * configuration: `matching.weight` updates one row of `affinity_weights`,
 * audited like every other admin write. It is the right home for it, because
 * the harness exists to answer "did my weight change do anything" and the
 * answer was previously reachable only by editing a table by hand.
 *
 * **The arithmetic did not become unexplained, it became demonstrated.** Every
 * row still carries the points each reason contributed, so the badges add up to
 * the score in front of them; what went was the paragraph saying that they
 * would.
 */
export default function MatchingPage() {
  const [asker, setAsker] = useState("");
  const [wanted, setWanted] = useState(5);

  const { rows, configured, loading, error, demo, setDemo, reload } = useAdminRows<MatchingResult>(
    "matching",
    { asker, wanted },
  );

  const data = rows;
  const people = data?.people ?? [];

  return (
    <>
      <PageHead title="Who Pando would ask" />

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card title="The question">
        <div className="flex flex-wrap items-start gap-4 px-4 py-3.5">
          <PersonPicker
            className="flex-1 basis-[20rem]"
            label="Asking on behalf of"
            people={people}
            value={asker}
            onChange={setAsker}
            emptyLabel="No contributors in the database yet."
          />

          <div>
            <label
              htmlFor="wanted"
              className="block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted"
            >
              Parents wanted
            </label>
            <input
              id="wanted"
              type="number"
              min={1}
              max={20}
              className={`${controlClass} mt-1 w-28`}
              value={wanted}
              onChange={(e) => setWanted(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            />
            {/* On the page, not in the header's tooltip: the number only means
                something if you know what a real Ask would want. */}
          </div>
        </div>

        {data?.asker && (
          <div className="border-t border-bark/70 px-4 py-2.5 text-[13px] text-muted">
            <p>
              <span className="font-semibold text-ink">
                {data.asker.name ?? "This parent"}
              </span>{" "}
              ·{" "}
              {data.asker.neighborhood ? slugLabel(data.asker.neighborhood) : "no area recorded"} ·{" "}
              {data.asker.child_birth_years.length > 0
                ? `kids born ${data.asker.child_birth_years.join(", ")}`
                : "no children recorded"}{" "}
              · {data.asker.edges} connection{data.asker.edges === 1 ? "" : "s"} ·{" "}
              {data.asker.relevance} context answer{data.asker.relevance === 1 ? "" : "s"}
            </p>
            {/**
             * 1 Sep — spelled out, because it explains every "0 context" in the
             * score column below before a reader has to work it out for
             * themselves. Zero context answers is a fact about *this parent's
             * own profile*; the relevance boost needs both sides to have
             * answered something, so nobody can score any context points
             * against them until they do — no candidate is "worse" for it.
             */}
            {data.asker.relevance === 0 && (
              <p className="mt-1 text-gold-ink">
                They haven&apos;t answered any of the context questions yet, so every
                score below is shared connections alone — the zero context is a gap
                in their own profile, not a judgement on the candidates.
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="mt-5">
        <WeightsCard
          weights={data?.weights ?? []}
          relevanceStep={data?.relevance_step ?? null}
          configured={configured}
          onSaved={reload}
        />
      </div>

      <div className="mt-5">
        <Card
          title={data?.asker ? `Ranked by relevance (${data.found})` : "Who would Pando ask?"}
          className={data?.asker && data.cold ? "border-gold-line" : undefined}
        >
          {loading && !data ? (
            <Loading />
          ) : error && !data ? (
            <Failed />
          ) : !configured ? (
            <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample
            />
          ) : !asker ? (
            <Empty
              title="Choose a parent above"
            />
          ) : !data?.asker ? (
            <Empty title="That parent has no record to score" />
          ) : data.ranked.length === 0 ? (
            <Empty
              title="Nobody is connected to this parent yet"
            />
          ) : (
            <>
              {/**
               * 6.6 — cold start, said plainly.
               *
               * The estimate asks the mechanism to "tell the parent honestly" when
               * too few people qualify, and this is the admin half of that: a
               * short list has to say whether it is short because the question was
               * narrow or because the network is thin. Without this line a reader
               * cannot tell, and would read four rows as a complete answer.
               */}
              {data.cold && (
                <p className="border-b border-gold-line bg-gold-wash px-4 py-2.5 text-[13.5px] leading-relaxed text-gold-ink">
                  {shortfall(data.found, data.wanted)}
                </p>
              )}

              {/**
               * 1 Sep — a flat tail, named rather than left to look like an
               * order. Numbering rows 2 through 8 implies each is a step down
               * from the last; when several share one identical score, that
               * implication is false — the network genuinely cannot distinguish
               * between them yet, and the table's own numbering would otherwise
               * be the only thing suggesting it can.
               *
               * The sentence is built in JS, for the reason `shortfall` below
               * records: an embedded expression that wraps across lines loses
               * the whitespace on *both* sides of itself, and this line had
               * already shipped once reading "The last 3rows score exactly the
               * same". It reads correctly in the source either way, which is
               * what makes it a trap rather than a typo.
               */}
              {tiedTailCount(data.ranked) >= 3 && (
                <p className="border-b border-bark/70 px-4 py-2.5 text-[13px] leading-relaxed text-muted">
                  {tiedTail(tiedTailCount(data.ranked))}
                </p>
              )}

              <TableWrap label="Ranked candidates">
                <thead>
                  <tr>
                    <Th>Parent</Th>
                    {/* The sub-line is the header's own explanation, on screen
                        rather than in a `title` a touch device cannot reach. */}
                    <Th className="text-right">
                      Score
                      <span className="mt-0.5 block text-[10.5px] font-medium normal-case tracking-normal">
                        connections + context
                      </span>
                    </Th>
                    <Th>
                      Why them
                      <span className="mt-0.5 block text-[10.5px] font-medium normal-case tracking-normal">
                        each with the points it added
                      </span>
                    </Th>
                    <Th className="text-right">
                      Added
                      <span className="mt-0.5 block text-[10.5px] font-medium normal-case tracking-normal">
                        approved contributions
                      </span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.ranked.map((row, i) => (
                    <tr key={row.person_id}>
                      <Td>
                        <span className="font-semibold">
                          {i + 1}. {row.name ?? "Unnamed"}
                        </span>
                        {row.phone_masked && (
                          <span className="ml-2 text-[12.5px] text-muted">
                            {row.phone_masked}
                          </span>
                        )}
                      </Td>
                      <ScoreCell row={row} />
                      <Td>
                        <span className="flex flex-wrap gap-1.5">
                          {row.reasons.map((r, j) => (
                            <ReasonBadge key={`${r.kind}-${j}`} reason={r} />
                          ))}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums text-muted">
                        {row.approved_contributions}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>

            </>
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * The coefficients, as fields.
 *
 * ## Why the prose went and this stayed
 *
 * 2 Sep, the client's instruction: take the descriptive text about the weights
 * and the calculation off the page, leave the coefficients, and let her change
 * them. A weight table that could be read but not edited was documentation of a
 * decision made somewhere else — and "somewhere else" was a hand-written UPDATE,
 * which is the one kind of change to Pando's matching that leaves no audit row.
 *
 * ## Four rules
 *
 * **Nothing is saved until Save.** A field that wrote on every keystroke would
 * put "5", "55" and "555" through three audited writes and three re-scorings on
 * the way to a typo. The button reports how many changed, so the reader knows
 * what they are committing.
 *
 * **Only what changed is sent**, one action per weight. Each is its own audit
 * row naming its own coefficient, which is what makes "who raised school to 8,
 * and when" answerable later; a single bulk action would have to write the whole
 * table into one row's `after` and would record five decisions as one.
 *
 * **The context step is shown and cannot be edited.** `RELEVANCE_STEP` is a
 * constant in `lib/matching.ts`, not a row in `affinity_weights` — the whole of
 * life relevance is deliberately worth less than one shared school, and that
 * balance is a code decision rather than a knob. Hiding it would leave the
 * arithmetic on every row unaccountable: the badges include context points, so
 * a reader checking a score needs the number. Rendering it as an editable field
 * would be worse — the admin rule this repo keeps relearning is that a control
 * must not claim a state nothing maintains.
 *
 * **The list is ordered by its own labels, and never by weight.** Ordering by
 * weight would be more useful to read and is not available: a field that jumps
 * to a new position the moment its value changes moves under the cursor of the
 * person who just typed in it. The bar beside each number carries the ranking
 * instead, which is the whole reason it is there.
 *
 * The old comment here claimed a `sortWeights` that **did not exist** — the
 * order came from the query, i.e. alphabetical by `affinity_type`, which is the
 * slug and not the label. On screen that read: *class or activity · next-door
 * area · children the same stage · faith community · area · school · club*.
 * Alphabetical by a string the reader cannot see is indistinguishable from
 * random, and the client reported the card as unstructured.
 */
function WeightsCard({
  weights,
  relevanceStep,
  configured,
  onSaved,
}: {
  weights: Array<{ affinity_type: string; weight: number }>;
  /**
   * Null on a deployment that has not run `drizzle/0036` — the scorer then uses
   * `RELEVANCE_STEP` and the field below says so rather than offering a value
   * nothing reads.
   */
  relevanceStep: number | null;
  /**
   * Without a database there are no weights *because there is no table* —
   * "nothing has been seeded yet" would be a guess presented as a fact, which
   * is the same honesty rule as `persisted: false`.
   */
  configured: boolean;
  onSaved: () => void;
}) {
  /** Only the fields somebody has touched; everything else reads from `weights`. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /**
   * The context step's own draft, separate because it is a different kind of
   * value: `null` means "not touched", where the weights use the absence of a
   * key. Kept out of `draft` so a `Record<string, string>` does not have to
   * carry one entry that is not an `affinity_type`.
   */
  const [stepDraft, setStepDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const shown = (w: { affinity_type: string; weight: number }) =>
    draft[w.affinity_type] ?? String(w.weight);

  const changed = weights.filter((w) => shown(w) !== String(w.weight));
  /* The bar's denominator is the heaviest weight *as currently typed*, so the
     longest bar is always full and raising school to 20 shortens every other bar
     rather than overflowing its own. Never below 1, or a table of zeroes would
     divide by nothing. */
  const heaviest = Math.max(
    1,
    ...weights.map((w) => (inRange(shown(w)) ? Number(shown(w)) : w.weight)),
  );
  /* The same range the route enforces — checked here so a bad value disables the
     button rather than travelling to the server to be refused. */
  const bad = changed.filter((w) => !inRange(shown(w)));

  /**
   * The context step, treated exactly like a weight and validated differently.
   *
   * ⚠ It is only editable when the row exists. A deployment behind on
   * `drizzle/0036` has nothing to update, so `matching.relevance_step` would
   * answer `not_found` — and offering a field that cannot save is the "control
   * claiming a state nothing maintains" fault that kept this number read-only
   * until now.
   */
  const stepEditable = relevanceStep !== null;
  const shownStep = stepDraft ?? (relevanceStep === null ? "" : String(relevanceStep));
  const stepChanged =
    stepEditable && stepDraft !== null && shownStep !== String(relevanceStep);
  const stepBad = stepChanged && !stepInRange(shownStep);

  const pending = changed.length + (stepChanged ? 1 : 0);
  const blocked = bad.length > 0 || stepBad;

  async function save() {
    setBusy(true);
    setFailed(null);
    setNote(null);
    try {
      for (const w of changed) {
        await adminAction({
          action: "matching.weight",
          affinity_type: w.affinity_type,
          weight: Number(shown(w)),
        });
      }
      /* Its own action and its own audit row, for the same reason each weight
         gets one: "who changed the context step, and when" has to be answerable
         on its own rather than folded into a row named after something else. */
      if (stepChanged) {
        await adminAction({
          action: "matching.relevance_step",
          value: Number(shownStep),
        });
      }
      setNote(
        pending === 1
          ? stepChanged
            ? `Saved. Similar context is now worth ${shownStep} a dimension — the next ranking uses it.`
            : `Saved. ${affinityLabel(changed[0].affinity_type)} is now ${shown(changed[0])} — the next ranking uses it.`
          : `Saved ${pending} changes. The next ranking uses them.`,
      );
      setDraft({});
      setStepDraft(null);
      onSaved();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The context step's cells, in the same three-column grid as a weight.
   *
   * ⚠ **Editable since 8 Sep, on the client's instruction**, and that reverses
   * the 2 Sep decision — "a constant in `lib/matching.ts` … a code decision
   * rather than something an admin sets", with the warning that "a control must
   * not claim a state nothing maintains". That warning is why this was a
   * migration and not a one-line change: the number moved into
   * `matching_settings` (`drizzle/0036`) and the scorer reads it there before
   * the field appeared, so what is typed here is what ranks.
   *
   * It stays read-only when the row is missing — a deployment behind on that
   * migration — because then `RELEVANCE_STEP` really is what the scorer uses,
   * and an input that saves nothing is the fault the old decision guarded
   * against.
   *
   * ## It has a bar since 8 Sep, and the card's own title is why
   *
   * ⚠ **This reverses the note that stood here**, which read: *"No bar. The
   * third cell is empty on purpose: a bar's denominator here is the heaviest
   * weight, and this is points per dimension … drawing 0.5 against 5 would read
   * as the weakest thing on the card, when the whole of life relevance is
   * deliberately worth about half a shared school."* The client asked for the
   * bar, and re-reading the objection it is about what a reader might *infer*,
   * not about the bar being wrong.
   *
   * The card is headed **"What one shared connection is worth"**, and that is
   * the unit every bar already draws: one of these, against the strongest one.
   * One matching context dimension really is worth 0.5 against a shared school's
   * 5. So the bar is `step / heaviest` like all the others — a tenth — and it is
   * the shortest on the card because it is genuinely the smallest single
   * contribution in the model, which is the intended shape (`RELEVANCE_STEP`:
   * "a boost, not a second scoring system").
   *
   * What the old note was right about is the inference, so **the footer carries
   * the stacking** — `RELEVANCE_DIMENSIONS` of them can match at once — and that
   * is where it belongs: the bar answers "how much is one worth", the sentence
   * answers "how many can there be". Splitting those across two denominators
   * would have made this the one bar on the card meaning something else.
   */
  function renderContextRow() {
    return (
      <Fragment key="context-step">
        <label
          htmlFor="relevance-step"
          className={`text-[13.5px] ${stepEditable ? "" : "text-muted"}`}
        >
          Any kind of similar context
        </label>
        {stepEditable ? (
          <input
            id="relevance-step"
            type="number"
            min={0}
            max={5}
            /* 0.05, matching the route and `numeric(4,2)`: a finer value would
               be **rounded** by Postgres rather than refused, and the page
               would come back showing a number nobody typed. */
            step={0.05}
            inputMode="decimal"
            disabled={busy}
            aria-invalid={stepBad}
            aria-describedby="step-scale"
            className={`${controlClass} w-full text-right tabular-nums ${
              stepBad ? "ring-1 ring-alert-line" : ""
            }`}
            value={shownStep}
            onChange={(e) => setStepDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pending > 0 && !blocked) void save();
            }}
          />
        ) : (
          <span className="rounded-lg border border-bark bg-paper px-3 py-2 text-right text-[14px] tabular-nums text-muted">
            {RELEVANCE_STEP}
          </span>
        )}
        {/* Same track, same denominator and the same `aria-hidden` as the seven
            above — the number is already in the field beside it. `shownStep` is
            what is typed rather than what is saved, so it moves as you type; a
            value out of range paints the bar alert-red exactly as a weight
            does, which is what stops a ringed field with a healthy green bar
            beside it. */}
        <span
          aria-hidden="true"
          className="hidden h-1.5 rounded-full bg-bark/50 md:block"
        >
          <span
            className={`block h-full rounded-full ${stepBad ? "bg-alert-line" : "bg-green"}`}
            style={{
              /* `RELEVANCE_STEP` on the read-only branch, not `shownStep`: that
                 branch holds "" and would draw the floor, i.e. a bar claiming
                 the step is near zero next to a field reading 0.5. Whatever the
                 span beside it shows is what the bar draws. */
              width: `${Math.min(
                100,
                Math.max(
                  4,
                  ((stepEditable ? Number(shownStep) : RELEVANCE_STEP) / heaviest) * 100,
                ),
              )}%`,
            }}
          />
        </span>
      </Fragment>
    );
  }

  return (
    <Card title="What one shared connection is worth">
      {weights.length === 0 ? (
        <Empty
          title={configured ? "No weights recorded" : "No database connected"}
          /* Was "Nothing has been seeded into affinity_weights yet" — a table
             name, on an empty state read by a non-technical admin. That is the
             fault `labels.ts` exists to end, surviving in prose rather than in a
             value. `DATABASE_URL` stays: it names a thing whoever reads that
             branch has to go and set, and there is no other word for it. */
        />
      ) : (
        <>
          {/**
           * Two columns, on the client's instruction (8 Sep).
           *
           * One column of seven rows capped at 36rem used a third of a 1440px
           * card and ran 525px tall; the same rows in two columns are 3 and 4
           * deep. The cap stays *per column* rather than on the pair, because
           * what it protects is the label-to-number distance — unconstrained,
           * "Same school" and the 5 that belongs to it sat ~500px apart.
           *
           * ⚠ Split **down then across**, not across then down. The list is
           * alphabetical by label, and a reader scanning for "Same school"
           * expects a phone book: reading order across two columns would put
           * consecutive entries side by side and make the ordering look random,
           * which is the exact complaint that produced `sortWeights`.
           *
           * ## The context step is the eighth row, not a block of its own
           *
           * It started below a rule, on the reasoning that it is a different
           * *kind* of number — per dimension, 0 to 5 in steps of 0.05, against
           * whole numbers 1 to 20. The client's instruction is that it belongs
           * in the second column, and she is right about what it looked like:
           * seven weights split 4 and 3 leave a gap at the bottom of the right
           * column, and an orphan row under a rule sat in the card's own
           * whitespace rather than filling it.
           *
           * It goes into the **split** rather than being appended to the second
           * column, so the two stay balanced at four and four — and because the
           * split reads down then across, the eighth entry lands last, which is
           * where a number that is not one of the seven belongs.
           *
           * ⚠ **Its scale sentence moved to the footer, and that is not
           * tidying.** In its own full-width row the third grid cell was wide
           * enough for it; in a column that cell is `minmax(2.5rem,5rem)` and
           * the sentence wrapped to three lines against a one-line field. The
           * footer already carries the weights' scale for exactly this reason,
           * and `aria-describedby` still points at it, so the rule is announced
           * with the field rather than being a sentence to go and find.
           */}
          <div className="grid gap-x-10 px-4 py-3.5 md:grid-cols-2">
            {splitColumns([...sortWeights(weights), CONTEXT_ROW]).map((column, i) => (
              <div key={i} className={WEIGHT_GRID}>
                {column.map((w) => {
                  if (w === CONTEXT_ROW) return renderContextRow();
                  const value = shown(w);
                  const ok = inRange(value);
                  return (
                    <Fragment key={w.affinity_type}>
                      <label
                        htmlFor={`weight-${w.affinity_type}`}
                        className="text-[13.5px]"
                      >
                        {affinityLabel(w.affinity_type)}
                      </label>
                      <input
                        id={`weight-${w.affinity_type}`}
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        inputMode="numeric"
                        disabled={busy}
                        aria-invalid={!ok}
                        aria-describedby="weight-scale"
                        /* A **ring**, not a border colour. `controlClass` already
                           sets `border-bark`, and two utilities for one property in
                           the same layer are resolved by Tailwind's output order
                           rather than by where they sit in the string — the trap
                           `controlClass` itself is named after. A ring is a
                           different property, so it cannot lose that argument. */
                        className={`${controlClass} w-full text-right tabular-nums ${
                          ok ? "" : "ring-1 ring-alert-line"
                        }`}
                        value={value}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [w.affinity_type]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && pending > 0 && !blocked) void save();
                        }}
                      />
                      {/**
                       * The ranking, without reordering the fields.
                       *
                       * This is the part that lets somebody who has never seen the
                       * platform read the card: "school is the strongest connection
                       * there is, a neighbouring area is the weakest" is visible at
                       * a glance, where seven numbers in a ragged row is arithmetic
                       * homework. It is derived from the value in the field beside
                       * it, so it moves as you type and cannot disagree with it —
                       * and it is `aria-hidden`, because the number is already
                       * there and a screen reader does not need it twice.
                       */}
                      <span
                        aria-hidden="true"
                        className="hidden h-1.5 rounded-full bg-bark/50 md:block"
                      >
                        <span
                          className={`block h-full rounded-full ${ok ? "bg-green" : "bg-alert-line"}`}
                          style={{
                            width: `${Math.min(100, Math.max(4, (Number(value) / heaviest) * 100))}%`,
                          }}
                        />
                      </span>
                    </Fragment>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-bark/70 px-4 py-2.5">
            <Button
              tone="primary"
              disabled={busy || pending === 0 || blocked}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : saveLabel(pending)}
            </Button>
            {pending > 0 && !busy && (
              <Button
                tone="ghost"
                onClick={() => {
                  setDraft({});
                  setStepDraft(null);
                }}
              >
                Undo
              </Button>
            )}
            {/* The scale, stated once and permanently rather than only when
                somebody has already got it wrong. `aria-describedby` on every
                field points here, so it is announced with the field instead of
                being a sentence a reader has to go and find. */}
            <span
              id="weight-scale"
              className={`text-[12.5px] ${bad.length > 0 ? "text-alert" : "text-muted"}`}
            >
              A weight is a whole number from 1 to 20.
            </span>
            {/* The context step's own rule, here rather than in its row: in a
                column the third cell is ~5rem and this wrapped to three lines
                against a one-line field.

                The stacking clause is what the bar cannot say (8 Sep). The bar
                draws one dimension against the strongest connection, which is a
                tenth and correct; without this sentence a reader would take the
                shortest bar on the card to mean context barely counts, when six
                of them together come to more than half a shared school. */}
            <span
              id="step-scale"
              className={`text-[12.5px] ${stepBad ? "text-alert" : "text-muted"}`}
            >
              {stepEditable
                ? `Similar context: 0 to 5 per dimension, in steps of 0.05.`
                : "Similar context is set in code."}
            </span>
            {note && <ResultNote inline>{note}</ResultNote>}
            {failed && <span className="text-[12.5px] text-alert">{failed}</span>}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The eighth row, as a value the split can carry.
 *
 * A sentinel rather than a flag on the array, so the column maths stays one
 * expression and the context step cannot end up in the wrong column by
 * arithmetic. Matched by **reference**, never by its `affinity_type` — the real
 * rows are fresh objects from a fetch, so nothing else can ever equal it, and
 * the reserved slug is only there to satisfy the shape.
 */
const CONTEXT_ROW = { affinity_type: "__context_step__", weight: 0 };

/**
 * Down the first column, then down the second.
 *
 * A phone book, not reading order: the list is alphabetical by label, and
 * splitting it across then down would put consecutive entries side by side —
 * which makes an alphabetical list look unordered, the exact complaint
 * `sortWeights` was written to fix.
 *
 * The taller column is the first, so an odd count leaves the gap at the bottom
 * right where a reader is already finished rather than in the middle.
 */
function splitColumns<T>(rows: T[]): [T[], T[]] {
  const half = Math.ceil(rows.length / 2);
  return [rows.slice(0, half), rows.slice(half)];
}

/**
 * The context step's range, and it is not the weights' range.
 *
 * Checked in **hundredths** rather than with `% 0.05`, because binary floating
 * point does not represent 0.05: `0.15 % 0.05` is 0.049999999999999996 and a
 * perfectly ordinary value would be refused. The same arithmetic runs in the
 * route, so the page and the server agree on what is typeable.
 */
function stepInRange(value: string): boolean {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n)) return false;
  return n >= 0 && n <= 5 && Math.round(n * 100) % 5 === 0;
}

/** The same range the route enforces, and the database's `weight > 0` above it. */
function inRange(value: string): boolean {
  const n = Number(value);
  return value.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 20;
}

/**
 * What the button commits, said before it is pressed.
 *
 * Built in JS for the whitespace reason `shortfall` records, and worded with the
 * count because this control writes one audited change per field: "Save 3
 * changes" is the difference between pressing it deliberately and discovering
 * afterwards that a stray keystroke went with it.
 */
/**
 * The three columns every row of the weights card lines up on: the connection,
 * its number, and the bar. One constant, because the read-only context row below
 * the list has to sit on exactly the same grid — two copies of a template is how
 * one of them ends up a quarter-rem out.
 */
const WEIGHT_GRID =
  /* Capped, because a label and the number it belongs to have to read as a
     pair: unconstrained, the 1fr label column stretched to the full content
     width and put ~500px of empty paper between "Same school" and the 5 that
     belongs to it at 1440px. */
  "grid max-w-[30rem] grid-cols-[minmax(0,1fr)_4.5rem] items-center content-start gap-x-4 gap-y-2.5 md:grid-cols-[minmax(0,1fr)_4.5rem_minmax(2.5rem,5rem)]";

/**
 * By the label a reader can see, not by the slug underneath it.
 *
 * `localeCompare` rather than `<`, so "Área" and "Area" would not sort by code
 * point if a market ever labels a connection in another language.
 */
function sortWeights<T extends { affinity_type: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    affinityLabel(a.affinity_type).localeCompare(affinityLabel(b.affinity_type), "en"),
  );
}

function saveLabel(count: number): string {
  if (count === 0) return "Nothing to save";
  return count === 1 ? "Save 1 change" : `Save ${count} changes`;
}

/**
 * The score, with its two halves kept visibly apart.
 *
 * They were one line — `7.5` then `7 connections + 0.5 context` — and the
 * browser rendered the first two of those as **"7.57 connections"**. A reader
 * who saw that had no way to know which digits were the score, which is a
 * worse failure than the missing explanation it was there to provide. The total
 * is now its own block, the breakdown its own line beneath, and neither can
 * wrap into the other.
 */
function ScoreCell({ row }: { row: MatchCandidateRow }) {
  return (
    <Td className="text-right">
      <span className="block font-display text-[1.05rem] font-bold leading-none tabular-nums">
        {round(row.score)}
      </span>
      <span className="mt-1 block whitespace-nowrap text-[11.5px] tabular-nums text-muted">
        {round(row.affinity)} connections
        {" + "}
        {round(row.relevance)} context
      </span>
    </Td>
  );
}

/**
 * One reason, with its points and — where naming it adds something — the school,
 * class, club or town it was about.
 *
 * The points are *on* the badge rather than in its tooltip, and that is the
 * whole answer to "the scoring logic is not entirely clear": with them there,
 * the badges in a row are the arithmetic behind the number beside them, and a
 * reader can check it rather than take it. The tooltip is kept for the exact
 * stored value, which is a debugging detail rather than an explanation.
 */
function ReasonBadge({
  reason,
}: {
  reason: { kind: string; value: string; points: number };
}) {
  const named = matchReasonValue(reason.kind, reason.value);
  const isContext = reason.kind.startsWith("relevance:");
  return (
    <Badge
      tone={isContext ? "neutral" : "green"}
      hint={`Stored as ${reason.kind} · ${reason.value}`}
    >
      {matchReason(reason.kind)}
      {named && <span className="font-normal">: {named}</span>}
      <span className="ml-1.5 tabular-nums opacity-70">+{round(reason.points)}</span>
    </Badge>
  );
}

/**
 * 6.6's line, built in JS rather than interpolated in JSX.
 *
 * `the {data.wanted} wanted. In the pilot…` rendered as **"20wanted"**, and
 * fixing only that side moved it to **"wanted.In"**: JSX strips the leading
 * whitespace of a text node whenever the block wraps across lines, so *both*
 * boundaries of an embedded expression lose their space. It reads correctly in
 * the source, which is why this was caught in the DOM and not in review. One
 * string has no whitespace rules to fall foul of.
 */
function shortfall(found: number, wanted: number): string {
  return `Only ${found} of the ${wanted} wanted.`;
}

/** The flat-tail line — one string, for the whitespace reason above. */
function tiedTail(count: number): string {
  return `The last ${count} rows score exactly the same — their order is a tiebreaker, not a ranking.`;
}

/** 7.5 rather than 7.5000000001, and 7 rather than 7.0. */
function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * How many rows at the bottom of the ranking share one identical score.
 *
 * Specifically the tail below the leader, because that is the shape a cold,
 * newly-seeded network actually produces: one clear top match, then a long
 * flat run at whatever the smallest nonzero weight in the graph is. `ranked`
 * is already sorted best-first (`rankCandidates`), so the tail is read from
 * the end. Fewer than three sharing a score is an ordinary tie, not a pattern
 * worth a banner over.
 */
function tiedTailCount(ranked: Array<{ score: number }>): number {
  if (ranked.length < 4) return 0;
  const tailScore = ranked[ranked.length - 1].score;
  let count = 0;
  for (let i = ranked.length - 1; i >= 0 && ranked[i].score === tailScore; i--) count++;
  return count >= 3 ? count : 0;
}
