"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Explainer,
  inputClass,
  Loading,
  NotConfigured,
  TableWrap,
  Td,
  Th,
  Toolbar,
} from "@/components/admin/ui";
import { Hint, SegmentedFilter } from "@/components/admin/kit";
import { useAdminRows } from "@/lib/admin/client";
import { TIERS, type TierId } from "@/lib/tiers";
import type { StandingRow } from "@/lib/admin/types";

/**
 * Estimate 14.4 — counters, response rate, tier and limits.
 *
 * ## Why this is a view on the contributors page and not its own nav item
 *
 * The 13 Aug precedent, and the same argument exactly: the consent file stopped
 * being `/admin/consents` because *"as a separate nav item nobody could tell
 * what it was for, and it is the same people asked a different question"*.
 * Standing is the same people asked a third question, so it is a third tab.
 *
 * ## What this page is the first consumer of
 *
 * `lib/tiers.ts` has computed a five-rung ladder since 1 Sep and **nothing had
 * ever read it**. The tier was real, correct and invisible. That is the hole
 * this closes, and it is worth naming because the same was true of
 * `impact_events` and `freshness_pings`: M9 and M10 wrote four things the admin
 * could not see.
 *
 * ## The three rules the numbers follow
 *
 * **The tier is recomputed on every read, never stored.** 9.4's decision, and
 * the reason is that a nightly write of a tier into a column would only create
 * the second copy that goes stale — the same argument that makes `matching.ts`
 * recompute an age band rather than read the stored edge.
 *
 * **A response rate below four requests is not shown at all.** One unanswered
 * message out of one is a 0% rate, and putting that on screen would show a
 * contributor's very first miss as a verdict. `RESPONSE_MIN_SAMPLE` is the
 * floor, and below it the column says so in words.
 *
 * **No score is ever shown to a contributor** — 9.4 says the reward is better
 * access rather than points, and strategy §13 says no leaderboard ever. The
 * `equivalents` figure and the next rung are admin-side, which is what this
 * whole surface is; they exist so a person can see who is close, not so anybody
 * can be ranked.
 */
export function Standing() {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<"all" | TierId>("all");
  const [hideTest, setHideTest] = useState(true);

  const { rows, configured, loading, error, demo, setDemo } =
    useAdminRows<StandingRow[]>("standing");

  const all = rows ?? [];

  const counts = useMemo(() => {
    const byTier = new Map<string, number>();
    for (const r of all) {
      if (hideTest && r.is_test) continue;
      byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1);
    }
    return byTier;
  }, [all, hideTest]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (hideTest && r.is_test) return false;
      if (tier !== "all" && r.tier !== tier) return false;
      if (!q) return true;
      return [r.name, r.phone_masked]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, search, tier, hideTest]);

  const testCount = all.filter((r) => r.is_test).length;
  const governed = filtered.filter((r) => r.governed).length;

  return (
    <>
      <Explainer title="What a tier is, and what it is not">
        <p>
          A tier is <strong>earned access, not a score</strong>. It counts what
          somebody has done — contributions approved, Network Asks answered,
          freshness checks confirmed — and it never goes down.
        </p>
        <p className="mt-2">
          Nobody is ever shown their own. There are no points and no leaderboard:
          what a higher tier buys is being able to ask the community more, and
          Founding is granted by you on a second approved contribution rather
          than earned by volume.
        </p>
        <p className="mt-2">
          <strong>How often somebody is asked</strong> is a separate mechanism.
          A contributor who stops answering is asked <em>less</em> — that is the
          response rate column — but they keep the tier they earned.
        </p>
      </Explainer>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mt-4">
        <Toolbar>
          <SegmentedFilter
            label="Which tier"
            value={tier}
            onChange={(v) => setTier(v as "all" | TierId)}
            options={[
              { id: "all" as const, label: "Everyone", count: filteredTotal(counts) },
              ...(Object.keys(TIERS) as TierId[]).map((id) => ({
                id,
                label: TIERS[id].label,
                count: counts.get(id) ?? 0,
              })),
            ]}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or number…"
            className={`${inputClass} w-[12rem]`}
          />
          {testCount > 0 && (
            <label className="flex items-center gap-1.5 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={hideTest}
                onChange={(e) => setHideTest(e.target.checked)}
              />
              Hide test ({testCount})
            </label>
          )}
        </Toolbar>
      </div>

      <div className="mt-4">
        <Card
          title={`Standing (${filtered.length})`}
          right={
            governed > 0 ? (
              <span className="text-[12.5px] text-gold-ink">
                {beingAskedLess(governed)}{" "}<Hint>{"Their response rate is under a quarter over 30 days, so Pando has lowered how often it asks them — never below five a month, which is the community minimum."}</Hint></span>
            ) : undefined
          }
        >
          {loading && !rows ? (
            <Loading />
          ) : !configured ? (
            <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample="There are no sample standings on purpose: a tier is earned access, and inventing one puts a rung against a real person's name."
            />
          ) : filtered.length === 0 ? (
            <Empty
              title={all.length === 0 ? "Nobody has a standing yet" : "Nothing in this view"}
              body={
                all.length === 0
                  ? "A standing is built from approved contributions, answered Asks and confirmed freshness checks. Approve a contribution and the first one appears."
                  : undefined
              }
            />
          ) : (
            <TableWrap label="Contributor standing">
              <thead>
                <tr>
                  <Th>Contributor</Th>
                  <Th>Standing</Th>
                  <Th
                    className="text-right"
                    hint="Approved contributions · Asks answered · freshness checks confirmed · times a recommendation of theirs reached a parent."
                  >
                    What they have done
                  </Th>
                  <Th
                    className="text-right"
                    hint="Proactive messages in the last 30 days and how many they answered. Below four requests no rate is shown — one miss out of one is not a pattern."
                  >
                    Answering
                  </Th>
                  <Th className="text-right">May be asked</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <StandingTableRow key={row.person_id} row={row} />
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}

function StandingTableRow({ row }: { row: StandingRow }) {
  return (
    <tr>
      <Td>
        <span className="font-semibold">{row.name ?? "Unnamed"}</span>
        {row.phone_masked && (
          <span className="ml-2 text-[12.5px] text-muted">{row.phone_masked}</span>
        )}
        {row.is_test && <Badge tone="neutral">Test</Badge>}
      </Td>
      <Td>
        <Badge tone={row.tier === "founding" ? "gold" : "green"}>
          {TIERS[row.tier as TierId]?.label ?? row.tier}
        </Badge>
        {/**
         * The next rung, and how far — for the admin, never for the parent.
         *
         * **Its own block, deliberately.** As an inline `ml-2` sibling it wrapped
         * onto a second line in this column anyway, and measuring it in the DOM
         * showed both spans reporting the same `left` — the same shape of fault
         * as the matching page's "7.57 connections", where a cell read as one
         * run-together number. A block says the layout was chosen rather than
         * arrived at.
         */}
        {row.next_tier && (
          <span className="mt-0.5 block text-[12.5px] text-muted">
            {toNext(row.equivalents, row.next_tier as TierId)}
          </span>
        )}
      </Td>
      <Td className="text-right tabular-nums text-[13px]">
        {contributionSummary(row)}
      </Td>
      <Td className="text-right tabular-nums">
        <span className={row.governed ? "text-gold-ink" : undefined}>
          {answering(row)}
        </span>
      </Td>
      <Td className="text-right text-[13px]">
        {row.allowance_mode === "as_relevant"
          ? "Anytime relevant"
          : perMonth(row.monthly_contact_allowance ?? 5)}
        {row.governed && (
          <Badge
            tone="gold"
            hint="Pando has lowered how often it asks them, because they have not been answering. It never goes below five a month."
          >
            Lowered
          </Badge>
        )}
      </Td>
    </tr>
  );
}

const filteredTotal = (counts: Map<string, number>): number =>
  [...counts.values()].reduce((a, b) => a + b, 0);

/**
 * "2 approved · 1 Ask · 3 checks", and only the parts that are non-zero.
 *
 * Built in JS rather than interpolated, for the reason the matching page's
 * `shortfall` documents: JSX strips the whitespace on *both* boundaries of an
 * embedded expression when the block wraps across lines.
 *
 * `answers_used` is listed last and phrased as a *receipt* rather than a
 * counter, because it is worth **zero** toward a tier (9.4): it is an outcome
 * rather than an act, and one popular recommendation used fifty times would
 * otherwise mint a Local Expert out of a single share.
 */
function contributionSummary(row: StandingRow): string {
  const parts: string[] = [];
  if (row.contributions_approved > 0) parts.push(`${row.contributions_approved} approved`);
  if (row.asks_answered > 0) parts.push(`${row.asks_answered} answered`);
  if (row.freshness_confirmed > 0) parts.push(`${row.freshness_confirmed} confirmed`);
  if (parts.length === 0) return "nothing yet";
  const done = parts.join(" · ");
  return row.answers_used > 0 ? `${done} — used ${row.answers_used}×` : done;
}

/** "3 of 4 answered", or why there is no rate yet. */
function answering(row: StandingRow): string {
  if (row.asked_30 === 0) return "not asked";
  if (row.response_rate === null) {
    return `${row.answered_30} of ${row.asked_30} — too few to judge`;
  }
  return `${row.answered_30} of ${row.asked_30} · ${Math.round(row.response_rate * 100)}%`;
}

function perMonth(n: number): string {
  return `Up to ${n} a month`;
}

function beingAskedLess(n: number): string {
  return n === 1 ? "1 being asked less" : `${n} being asked less`;
}

/** How far to the next rung. Admin-side only — see the header. */
function toNext(equivalents: number, next: TierId): string {
  const threshold = TIERS[next]?.threshold;
  if (threshold === null || threshold === undefined) return "";
  const left = Math.max(0, threshold - equivalents);
  if (left === 0) return `${TIERS[next].label} on the next sync`;
  const rounded = Math.round(left * 10) / 10;
  /* "1 more for Trusted", not "1 to Trusted" — the terse version read as a
     ratio on screen and needed a second look to parse. */
  return rounded === 1
    ? `1 more for ${TIERS[next].label}`
    : `${rounded} more for ${TIERS[next].label}`;
}
