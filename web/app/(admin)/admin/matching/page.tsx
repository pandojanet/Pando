"use client";

import { useState } from "react";
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
 */
export default function MatchingPage() {
  const [asker, setAsker] = useState("");
  const [wanted, setWanted] = useState(5);

  const { rows, configured, loading, error, demo, setDemo } = useAdminRows<MatchingResult>(
    "matching",
    { asker, wanted },
  );

  const data = rows;
  const people = data?.people ?? [];

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
              htmlFor="asker"
              className="block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted"
            >
              Asking on behalf of
            </label>
            <select
              id="asker"
              className={`${inputClass} mt-1 w-full`}
              value={asker}
              onChange={(e) => setAsker(e.target.value)}
            >
              <option value="">Choose a parent…</option>
              {people.map((p) => (
                <option key={p.person_id} value={p.person_id}>
                  {p.name ?? "Unnamed"}
                  {p.neighborhood ? ` · ${slugLabel(p.neighborhood)}` : ""}
                </option>
              ))}
            </select>
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

          {asker !== "" && (
            <Button tone="secondary" onClick={() => setAsker("")}>
              Clear
            </Button>
          )}
        </div>

        {data?.asker && (
          <p className="border-t border-bark/70 px-4 py-2.5 text-[13px] text-muted">
            {data.asker.name ?? "This parent"} ·{" "}
            {data.asker.neighborhood ? slugLabel(data.asker.neighborhood) : "no area recorded"} ·{" "}
            {data.asker.child_birth_years.length > 0
              ? `kids born ${data.asker.child_birth_years.join(", ")}`
              : "no children recorded"}{" "}
            · {data.asker.edges} connection{data.asker.edges === 1 ? "" : "s"} ·{" "}
            {data.asker.relevance} context answer{data.asker.relevance === 1 ? "" : "s"}
          </p>
        )}
      </Card>

      <div className="mt-5">
        <Card
          title={
            data?.asker
              ? `Pando would ask (${data.found} of ${data.wanted} wanted)`
              : "Pando would ask"
          }
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

              <TableWrap>
                <thead>
                  <tr>
                    <Th>Parent</Th>
                    <Th
                      className="text-right"
                      title="Connection plus context. Connection is a shared school, area, class, group, faith community or child's stage; context is a similar setup."
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
                        {/* The split, because the two layers mean different things
                            and a single number hides which one carried the row. */}
                        <span className="ml-1.5 text-[12px] text-muted">
                          {round(row.affinity)} + {round(row.relevance)}
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
