"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  TableWrap,
  Td,
  Th,
  inputClass,
  slugLabel,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import { affinityLabel, matchReason } from "@/lib/admin/labels";
import type { MatchingResult } from "@/lib/admin/types";

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
 * ## Why the weights are on screen
 *
 * Because the question this page is really for is "did my weight change do
 * anything", and that is unanswerable if the page does not say what it scored
 * with. They come from `affinity_weights` on every run — a config edit shows up
 * here on the next reload, with no deploy and no backfill.
 *
 * ## 1 Sep — search, and an honest results header
 *
 * The client's report: "there is no search now, and the scoring logic is not
 * entirely clear." Two real faults, and neither was a missing feature so much
 * as something this page had stopped telling the truth about.
 *
 * **The picker had no search.** A plain `<select>` over every contributor works
 * at the 26-person demo cohort and stops working long before the pilot's
 * ~350. Fixed the way `/admin/contributors` already does it — a text filter
 * over the same rows, client-side, because the endpoint already returns every
 * contributor in one query and a second round trip would only add latency to
 * typing.
 *
 * **The results header implied a selection this page never makes.** "Pando
 * would ask (8 of 5 wanted)" reads as a decision — as if the eight rows shown
 * were already the short list a live Ask would contact. They are not:
 * `rankCandidates` returns everyone who scored above zero, the *entire* ranked
 * graph, while `selectPool` (M7.3) is what actually selects — it asks for
 * `wanted × 4` candidates and only then removes anyone opted out or inside
 * their 48-hour gap, neither of which this harness does. The header now says
 * what is actually on screen, and a line above the table says what a live Ask
 * would additionally exclude.
 */
export default function MatchingPage() {
  const [asker, setAsker] = useState("");
  const [wanted, setWanted] = useState(5);
  const [pickerQuery, setPickerQuery] = useState("");

  const { rows, configured, loading, error, demo, setDemo } = useAdminRows<MatchingResult>(
    "matching",
    { asker, wanted },
  );

  const data = rows;
  const people = data?.people ?? [];

  /**
   * The picker's own filter, over rows the page already has.
   *
   * The currently chosen asker is kept in the list even when a later query
   * would exclude them, so typing a search after picking someone cannot
   * silently blank the select out from under them.
   */
  const visiblePeople = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return people;
    const matched = people.filter((p) =>
      [p.name, p.neighborhood ? slugLabel(p.neighborhood) : null]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
    if (asker && !matched.some((p) => p.person_id === asker)) {
      const current = people.find((p) => p.person_id === asker);
      if (current) return [current, ...matched];
    }
    return matched;
  }, [people, pickerQuery, asker]);

  return (
    <>
      <PageHead
        title="Who would Pando ask?"
        intro="Pick a parent and see who Pando would go to with their question, and why. Nothing is sent from this page."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card title="The question">
        <div className="flex flex-wrap items-end gap-3 px-4 py-3.5">
          <div className="min-w-[16rem] flex-1">
            <label
              htmlFor="asker-search"
              className="block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted"
            >
              Asking on behalf of
            </label>
            <input
              id="asker-search"
              type="search"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search name or neighborhood…"
              className={`${inputClass} mt-1 w-full`}
              aria-controls="asker"
            />
            <select
              id="asker"
              aria-label="Choose the parent to ask on behalf of"
              className={`${inputClass} mt-1.5 w-full`}
              value={asker}
              onChange={(e) => setAsker(e.target.value)}
            >
              <option value="">Choose a parent…</option>
              {visiblePeople.map((p) => (
                <option key={p.person_id} value={p.person_id}>
                  {p.name ?? "Unnamed"}
                  {p.neighborhood ? ` · ${slugLabel(p.neighborhood)}` : ""}
                </option>
              ))}
            </select>
            {pickerQuery.trim() !== "" && (
              <p className="mt-1 text-[12px] text-muted">
                {visiblePeople.length} of {people.length} match “{pickerQuery.trim()}”.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="wanted"
              className="block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted"
              title="A Targeted Ask goes to three to five parents. Set what the tier would want, so the page can tell you when the network cannot fill it."
            >
              Parents wanted
            </label>
            <input
              id="wanted"
              type="number"
              min={1}
              max={20}
              className={`${inputClass} mt-1 w-24`}
              value={wanted}
              onChange={(e) => setWanted(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>

          {(asker !== "" || pickerQuery !== "") && (
            <Button
              tone="secondary"
              onClick={() => {
                setAsker("");
                setPickerQuery("");
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {data?.asker && (
          <div className="border-t border-bark/70 px-4 py-2.5 text-[13px] text-muted">
            <p>
              {data.asker.name ?? "This parent"} ·{" "}
              {data.asker.neighborhood ? slugLabel(data.asker.neighborhood) : "no area recorded"} ·{" "}
              {data.asker.child_birth_years.length > 0
                ? `kids born ${data.asker.child_birth_years.join(", ")}`
                : "no children recorded"}{" "}
              · {data.asker.edges} connection{data.asker.edges === 1 ? "" : "s"} ·{" "}
              {data.asker.relevance} context answer{data.asker.relevance === 1 ? "" : "s"}
            </p>
            {/**
             * 1 Sep — spelled out, because it explains every "+ 0" in the score
             * column below before a reader has to work it out for themselves.
             * Zero context answers is a fact about *this parent's own profile*;
             * the relevance boost needs both sides to have answered something,
             * so nobody can score any relevance points against them until they
             * do — no candidate is "worse" for it.
             */}
            {data.asker.relevance === 0 && (
              <p className="mt-1 text-gold-ink">
                They haven't answered any of the context questions yet, so
                every score below is shared connections alone — the "+ 0" is a
                gap in their own profile, not a judgement on the candidates.
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="mt-5">
        <Card
          title={data?.asker ? `Ranked by relevance (${data.found})` : "Who would Pando ask?"}
          className={data?.asker && data.cold ? "border-gold-line" : undefined}
        >
          {loading && !data ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
          ) : !configured ? (
            <NotConfigured demo={demo} onDemo={setDemo} />
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
               * 1 Sep — what this list is, and what it is not, said before the
               * table rather than left to be inferred from a header. This is
               * the whole ranked graph, not a selection: a live Ask still has
               * to exclude anyone opted out or inside their 48-hour gap, and
               * widens the pool once it does. Saying so here is what stops "8
               * shown" from reading as "8 chosen".
               */}
              <p className="border-b border-bark/70 bg-paper px-4 py-2.5 text-[13px] leading-relaxed text-muted">
                Everyone Pando's graph connects to this parent, best match
                first. A live Ask narrows this further — anyone opted out or
                asked in the last 48 hours is skipped — so who is actually
                contacted is a subset of this list, not all of it.
              </p>

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
               * from the last; when several share one identical score and one
               * identical reason, that implication is false — the network
               * genuinely cannot distinguish between them yet, and the table's
               * own numbering would otherwise be the only thing suggesting it
               * can.
               */}
              {tiedTailCount(data.ranked) >= 3 && (
                <p className="border-b border-bark/70 px-4 py-2.5 text-[13px] leading-relaxed text-muted">
                  The last {tiedTailCount(data.ranked)} rows score exactly the
                  same, for the same reason — the network doesn't yet
                  distinguish between them. Their order below is a tiebreaker,
                  not a ranking.
                </p>
              )}

              <TableWrap>
                <thead>
                  <tr>
                    <Th>Parent</Th>
                    <Th
                      className="text-right"
                      title="Shared connections plus a small boost for similar context."
                    >
                      Score
                    </Th>
                    <Th>Why them</Th>
                    <Th
                      className="text-right"
                      title="Only approved contributions count — a parent whose cards are still in the queue is not yet someone Pando asks."
                    >
                      Added
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
                          <span className="ml-2 text-[12.5px] text-muted">{row.phone_masked}</span>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        <span className="font-semibold">{round(row.score)}</span>
                        {/* The split, because the two layers mean different
                            things and a single number hides which one carried
                            the row. Named "connections" / "context" (1 Sep)
                            rather than the internal field names, so the split
                            reads without needing the header's tooltip — which
                            a touch device cannot even reach. */}
                        <span className="ml-1.5 text-[12px] text-muted">
                          {round(row.affinity)} connections + {round(row.relevance)} context
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1.5">
                          {row.reasons.map((r, j) => (
                            <Badge
                              key={`${r.kind}-${j}`}
                              tone={r.kind.startsWith("relevance:") ? "neutral" : "green"}
                              title={`${r.value} · ${round(r.points)} point${r.points === 1 ? "" : "s"}`}
                            >
                              {matchReason(r.kind)}
                            </Badge>
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

      {data && data.weights.length > 0 && (
        <div className="mt-5">
          <Card title="What it scored with">
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-4 py-3.5">
              {data.weights.map((w) => (
                <span key={w.affinity_type} className="text-[13.5px]">
                  {affinityLabel(w.affinity_type)}{" "}
                  <span className="font-semibold tabular-nums">{w.weight}</span>
                </span>
              ))}
              <span className="text-[13.5px] text-muted">
                Next-door areas: {data.adjacency_pairs} pairs
              </span>
            </div>
            <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
              Read fresh on every run, so changing a weight changes the ranking on the
              next reload — no deploy. A similar setup adds half a point per kind, and
              all of them together stay below one shared school: real experience comes
              first, and context breaks the tie.
            </p>
          </Card>
        </div>
      )}
    </>
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
