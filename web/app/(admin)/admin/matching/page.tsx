"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  controlClass,
  Empty,
  ErrorNote,
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
 * **The weights are explained where they are used.** `Explainer` put the
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
      <PageHead
        title="Who Pando would ask"
        intro="Pick a parent and see who Pando would go to with their question, and why each of them scored where they did. Nothing is sent from this page."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card title="The question">
        <div className="flex flex-wrap items-start gap-4 px-4 py-3.5">
          <PersonPicker
            className="flex-1 basis-[20rem]"
            label="Asking on behalf of"
            people={people}
            value={asker}
            onChange={setAsker}
            hint="Type a name or a town — “south pas” finds South Pasadena."
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
            <p className="mt-1 max-w-[16rem] text-[12px] leading-relaxed text-muted">
              A Targeted Ask goes to three to five parents. This is only used to
              tell you when the network cannot fill that.
            </p>
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
          ) : !configured ? (
            <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample="There is no sample ranking on purpose: judging whether the real ranking is any good is this page's whole purpose, so a made-up one is the single thing it must never show."
            />
          ) : !asker ? (
            <Empty
              title="Choose a parent above"
              body="You'll see who Pando would go to, and what makes each of them relevant."
            />
          ) : !data?.asker ? (
            <Empty title="That parent has no record to score" />
          ) : data.ranked.length === 0 ? (
            <Empty
              title="Nobody is connected to this parent yet"
              body="Not a fault — an early network is sparse. Every approved contribution adds connections."
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

              <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
                Only <strong className="font-semibold text-ink">approved</strong>{" "}
                contributions put a parent in this graph at all — somebody whose
                cards are still in the review queue is not yet someone Pando asks.
              </p>
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
 * **The list is ordered by name, not by weight** (see `sortWeights`): a field
 * that jumps to a new position the moment its value changes moves under the
 * cursor of the person who just typed in it.
 */
function WeightsCard({
  weights,
  configured,
  onSaved,
}: {
  weights: Array<{ affinity_type: string; weight: number }>;
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const shown = (w: { affinity_type: string; weight: number }) =>
    draft[w.affinity_type] ?? String(w.weight);

  const changed = weights.filter((w) => shown(w) !== String(w.weight));
  /* The same range the route enforces — checked here so a bad value disables the
     button rather than travelling to the server to be refused. */
  const bad = changed.filter((w) => !inRange(shown(w)));

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
      setNote(
        changed.length === 1
          ? `Saved. ${affinityLabel(changed[0].affinity_type)} is now ${shown(changed[0])} — the next ranking uses it.`
          : `Saved ${changed.length} weights. The next ranking uses them.`,
      );
      setDraft({});
      onSaved();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
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
          body={
            configured
              ? "No weights have been set up yet, so no kind of shared connection counts for anything and nobody can be ranked."
              : "There is nothing to change until DATABASE_URL is set."
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-3.5 px-4 py-3.5">
            {weights.map((w) => (
              <label key={w.affinity_type} className="flex items-center gap-2">
                <span className="text-[13.5px]">{affinityLabel(w.affinity_type)}</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  inputMode="numeric"
                  disabled={busy}
                  aria-invalid={!inRange(shown(w))}
                  /* A **ring**, not a border colour. `controlClass` already sets
                     `border-bark`, and two utilities for one property in the same
                     layer are resolved by Tailwind's output order rather than by
                     the order they sit in the string — the trap `controlClass`
                     itself is named after. A ring is a different property, so it
                     cannot lose that argument. */
                  className={`${controlClass} w-16 text-right tabular-nums ${
                    inRange(shown(w)) ? "" : "ring-1 ring-alert-line"
                  }`}
                  value={shown(w)}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [w.affinity_type]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && changed.length > 0 && bad.length === 0) void save();
                  }}
                />
              </label>
            ))}

            {/* Read-only, and labelled as such rather than left looking broken. */}
            <span className="flex items-center gap-2">
              <span className="text-[13.5px] text-muted">Any kind of similar context</span>
              <span className="rounded-lg border border-bark bg-paper px-3 py-2 text-[14px] tabular-nums text-muted">
                {RELEVANCE_STEP}
              </span>
              <span className="text-[11.5px] uppercase tracking-[0.06em] text-muted">
                in code
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-bark/70 px-4 py-2.5">
            <Button
              tone="primary"
              disabled={busy || changed.length === 0 || bad.length > 0}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : saveLabel(changed.length)}
            </Button>
            {changed.length > 0 && !busy && (
              <Button tone="ghost" onClick={() => setDraft({})}>
                Undo
              </Button>
            )}
            {bad.length > 0 && (
              <span className="text-[12.5px] text-alert">
                A weight is a whole number between 1 and 20.
              </span>
            )}
            {note && <ResultNote inline>{note}</ResultNote>}
            {failed && <span className="text-[12.5px] text-alert">{failed}</span>}
          </div>
        </>
      )}
    </Card>
  );
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
  return `Only ${found} of the ${wanted} wanted. In the pilot this is the ordinary case — a Targeted Ask would widen the area or say so honestly rather than fill the gap with people it doesn't suit.`;
}

/** The flat-tail line — one string, for the whitespace reason above. */
function tiedTail(count: number): string {
  return `The last ${count} rows score exactly the same. Their order below is a tiebreaker, not a ranking — the network doesn't yet distinguish between them.`;
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
