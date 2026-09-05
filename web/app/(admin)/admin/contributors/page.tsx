"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  controlClass,
  Empty,
  ErrorNote,
  Loading,
  NotConfigured,
  PageHead,
  SampleBanner,
  slugLabel,
  TableWrap,
  Td,
  Th,
  Toolbar,
  when,
  yearList,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { Hint, SegmentedTabs, Select } from "@/components/admin/kit";
import { ConsentRecords } from "@/components/admin/ConsentRecords";
import { Standing } from "@/components/admin/Standing";
import { useAdminRows } from "@/lib/admin/client";
import type { ContributorRow } from "@/lib/admin/types";

/**
 * Everyone who came through, in two views of the same people: what they shared,
 * and what they agreed to.
 *
 * The consent file used to be its own item in the nav, and reading it cold gave
 * no clue why it existed. It is the same population asked a different question,
 * so it is a tab here — and it keeps the properties that make it evidence: the
 * number in full, test rows shown and labelled, and an audit row written every
 * time it is read.
 */
/**
 * The three questions this page answers about the same population.
 *
 * A constant rather than an inline array so the tab labels and the panel's own
 * accessible name come from one place — otherwise the panel would be named by a
 * second copy of the same three strings, which is how a tab ends up announcing
 * something other than the tab that opened it.
 */
const VIEWS = [
  { id: "people", label: "What they shared" },
  /* 14.4 — the same people, a third question. Its own nav item is what the
     consent file was moved off on 13 Aug, for the reason that nobody could tell
     what a separate item was for. */
  { id: "consents", label: "What they agreed to" },
  { id: "standing", label: "What they have earned" },
] as const;

export default function ContributorsPage() {
  /* ?view=consents is where the old /admin/consents address lands. */
  const initialView =
    useSearchParams().get("view") === "consents" ? "consents" : "people";
  const [view, setView] = useState<"people" | "consents" | "standing">(initialView);
  const { rows, configured, sample, demo, setDemo, loading, error } =
    useAdminRows<ContributorRow[]>("contributors");
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(true);
  const [reward, setReward] = useState<"all" | ContributorRow["reward_status"]>("all");
  /**
   * The contest the client described ("give more information and you're entered")
   * has no threshold — she never named one, and inventing a number here would
   * make up a rule nobody agreed to. So this sorts, and she picks off the top.
   */
  const [sort, setSort] = useState<"recent" | "contributions">("recent");

  const all = rows ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = all.filter((row) => {
      if (hideTest && row.is_test) return false;
      if (reward !== "all" && row.reward_status !== reward) return false;
      if (!q) return true;
      return [row.name, row.neighborhood, row.phone_masked]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });

    if (sort === "recent") return matched;
    return [...matched].sort(
      (a, b) =>
        b.qualifying_approved + b.caregiver_approved -
        (a.qualifying_approved + a.caregiver_approved),
    );
  }, [all, search, hideTest, reward, sort]);

  const testCount = all.filter((r) => r.is_test).length;

  /* Every queue reveals the same way: thirty rows, then a button saying how
     many are left. Inert until the list is long enough to need it. */
  const { shown, hidden, revealAll } = useReveal(filtered);

  return (
    <>
      <PageHead
        title="Contributors"
        intro="Everyone who filled in a profile."
      />

      {/**
       * 2 Sep — the controls moved out of `PageHead`'s `right` slot, and this is
       * a defect fix rather than a rearrangement. That slot is a `flex` of
       * `shrink-0` items, and the last control here is a **checkbox with a text
       * label** — the one thing in a row with no intrinsic width to defend. So
       * "Hide 2 test" rendered as three lines of one word each, wedged against
       * the page title.
       *
       * `Toolbar` lets the controls wrap as whole controls and keeps a label in
       * one piece. Below the title rather than beside it, because four controls
       * are not an afterthought to a heading — they are how this page is used.
       */}
      <Toolbar>
        {/* A real tab strip, not `SegmentedFilter`. These three swap whole
            panels — different columns, different fetch — which is precisely
            what `SegmentedFilter` documents itself as not being for. Manual
            activation matters here: arrowing across to the third tab with
            select-on-focus would fire two round trips nobody asked for. */}
        <SegmentedTabs
          panelId="contributor-view"
          label="Which question to answer about these contributors"
          value={view}
          onChange={setView}
          options={VIEWS}
        />
        {view === "people" && (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, neighborhood…"
              aria-label="Search contributors"
              className={`${controlClass} w-[13rem]`}
            />
            <Select
              label="Reward"
              value={reward}
              onChange={setReward}
              options={[
                { id: "all", label: "Every contributor" },
                { id: "eligible", label: "Reward earned" },
                { id: "started", label: "Waiting on review" },
                { id: "none", label: "Gave nothing" },
              ]}
            />
            <Select
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { id: "recent", label: "Newest first" },
                { id: "contributions", label: "Most contributions" },
              ]}
            />
            {testCount > 0 && (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={hideTest}
                  onChange={(e) => setHideTest(e.target.checked)}
                />
                Hide {testCount} test
              </label>
            )}
            <span className="text-[12.5px] tabular-nums text-muted">
              {filtered.length} shown
            </span>
          </>
        )}
      </Toolbar>

      {/* The one panel the tabs swap. Named by the chosen tab and focusable, so
          a keyboard user who commits a tab can step straight into what changed
          instead of hunting for it. */}
      <div
        id="contributor-view"
        role="tabpanel"
        tabIndex={0}
        aria-label={VIEWS.find((v) => v.id === view)?.label}
        className="mt-4"
      >
      {view === "consents" && <ConsentRecords />}
      {view === "standing" && <Standing />}

      {view === "people" && (
        <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      <Card>
        {loading && all.length === 0 ? (
          <Loading />
        ) : !configured && all.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : filtered.length === 0 ? (
          <Empty
            title={all.length === 0 ? "No contributors yet" : "Nothing matches"}
            body={
              all.length === 0
                ? "They appear here as soon as somebody finishes the profile."
                : "Try a shorter search."
            }
          />
        ) : (
          <TableWrap label="Contributors">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Neighborhood</Th>
                {/* Not the contributor's own birth year — the label has to say
                    whose, because a column of bare years reads as theirs. Matches
                    the wording on the detail page rather than inventing a second. */}
                <Th>Children born</Th>
                <Th className="text-right" hint="Everything they shared, whether or not you have looked at it yet.">
                  Shared
                </Th>
                {/* "Qualifying" is the word the estimate and the checklist both
                    use, so it stays — but it is the one heading here nobody can
                    infer, and the two thresholds behind it look alike and are
                    not: reward is one, Founding is two. */}
                {/* "Counts towards it" had no antecedent — "it" was whichever of
                    the next two columns you happened to be looking at. The
                    heading has to stand on its own, so it names the bigger of the
                    two thresholds and the tooltip carries both. */}
                <Th className="text-right" hint="Approved, firsthand, recent enough and complete. Both thresholds read this number, and they are not the same: one earns the reward, two activates Founding.">
                  Counts for Founding
                </Th>
                <Th hint="Paid for one qualifying contribution.">Reward</Th>
                <Th hint="Activates on the second qualifying contribution, and never automatically — you confirm it.">
                  Founding
                </Th>
                <Th hint="Whether they agreed another parent may come back to them about something they shared.">
                  Open to questions
                </Th>
                <Th>Joined</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className="hover:bg-paper/70">
                  <Td>
                    <Link
                      href={`/admin/contributors/${row.id}`}
                      className="font-semibold text-green-deep underline underline-offset-2"
                    >
                      {row.name ?? "Unknown"}
                    </Link>
                    <span className="mt-0.5 block text-[12.5px] text-muted">
                      {row.phone_masked ?? "no number"}
                    </span>
                    {row.is_test && (
                      <span className="mt-1 inline-block">
                        <Badge tone="gold">test</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>{row.neighborhood ? slugLabel(row.neighborhood) : "—"}</Td>
                  <Td>{yearList(row.child_birth_years)}</Td>
                  <Td className="text-right font-semibold">{row.submissions}</Td>
                  {/* No `title` here: the column heading now carries that
                      explanation as a reachable `Hint`, and saying it twice —
                      once unreachably — is worse than saying it once. */}
                  <Td className="text-right font-semibold">
                    {row.qualifying_approved}
                    {row.caregiver_approved > 0 && (
                      <span className="ml-1 text-[12px] font-normal text-muted">
                        {/* Was "+3 cg". Nobody expands that on sight, and this
                            column already has room for the word. */}
                        + {row.caregiver_approved}{" "}
                        {row.caregiver_approved === 1 ? "caregiver" : "caregivers"}{" "}<Hint>{"Caregivers this family put forward that you have accepted and that are not on hold"}</Hint></span>
                    )}
                  </Td>
                  <Td>
                    {row.reward_status === "eligible" ? (
                      <Badge tone="green">Earned</Badge>
                    ) : row.reward_status === "started" ? (
                      <Badge tone="gold">In review</Badge>
                    ) : (
                      <Badge tone="muted">Nothing yet</Badge>
                    )}
                  </Td>
                  <Td>
                    {/* "Pending" reads as "the system is working on it", and
                        Founding is never granted automatically — somebody has to
                        confirm it. The label says whose move it is. */}
                    {row.founding_status === "founding" ? (
                      <Badge tone="green">Confirmed</Badge>
                    ) : row.founding_status === "request_invite" ? (
                      <Badge tone="muted" hint="Not a rejection — they keep everything they shared and become an ordinary user at launch.">
                        Not from the group
                      </Badge>
                    ) : (
                      /**
                       * Neutral, not gold, and only on this page. Gold means
                       * "pending, not finished" and it is the right colour for
                       * this state — but nearly every row on a *directory* of 29
                       * contributors is unconfirmed, so twenty gold pills down
                       * one column is the failure the design system names in so
                       * many words: two golds on a screen and neither means
                       * anything. The work itself lives on the founding queue,
                       * which counts it in the sidebar and paints it there. Here
                       * the pill is a fact about a row, and what a reader needs
                       * to spot is the row that *differs*.
                       */
                      <Badge tone="neutral" hint="Founding is never granted automatically — somebody has to confirm it, on the founding queue.">
                        Waiting on you
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    {row.follow_up_opt_in === true ? (
                      <Badge tone="green">Yes</Badge>
                    ) : row.follow_up_opt_in === false ? (
                      <Badge tone="muted">No</Badge>
                    ) : (
                      <Badge tone="muted">—</Badge>
                    )}
                  </Td>
                  <Td className="text-muted">{when(row.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <RevealMore n={hidden} onClick={revealAll} />
      </Card>
        </>
      )}
      </div>
    </>
  );
}
