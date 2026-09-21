"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Heading,
  controlClass,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  Toolbar,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { SegmentedFilter, SegmentedTabs } from "@/components/admin/kit";
import {
  FactInline,
  FactLine,
  RecordCard,
  RecordDrawer,
  RecordList,
} from "@/components/admin/Record";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { useUrlFilter, useUrlValue } from "@/lib/admin/url-state";
import {
  DEMAND_CATEGORY,
  DEMAND_SENSITIVITY,
  DEMAND_STATUS,
  sentence,
} from "@/lib/admin/labels";
import type { DemandRow, PlaceDemand } from "@/lib/admin/types";

/**
 * Estimate 2.7 — what parents asked for (D1).
 *
 * Every parent gets one question at the end of the flow, and what Pando said back
 * already depended on what they asked. This page is the other half of that promise:
 *
 *  - **high-stakes questions come first, and are not answerable here.** The parent was
 *    given professional resources in the flow. What is owed now is a human following
 *    up, not a recommendation.
 *  - **peer support is not a queue of tickets.** These were only stored because the
 *    parent said yes to keeping them, and the answer is a matched cohort at launch —
 *    so the useful action is marking them matched, never replying in a database.
 *  - **ordinary questions are the launch inventory.** They are the reason to know
 *    which neighborhood needs which answer first.
 *
 * Nothing here is ever published. The text is a parent's own words about their own
 * family, and it stays on this screen.
 */
/** Which filter over the queue, and what the query parameter may say. */
const FILTERS = ["urgent", "open", "all"] as const;

/**
 * The two halves of this page — see the note at the tab strip.
 *
 * Named for what a reader came to do rather than for the data behind them: one
 * is a queue of questions, the other is the place ranking an expansion decision
 * is taken off.
 */
const VIEWS = [
  { id: "questions", label: "Questions parents asked" },
  { id: "places", label: "Where demand is strongest" },
] as const;
const VIEWS_IDS = VIEWS.map((v) => v.id);

export default function DemandPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<DemandRow[]>("demand");
  /* Its own resource rather than a field on the rows above: this is an
     aggregate over two tables with a roll-up the browser cannot do, and the
     queue is filtered by tab while these totals never are. */
  const { rows: placeData } = useAdminRows<PlaceDemand>("demand_places");
  const places = placeData ?? { rows: [], questions_no_place: 0 };

  const [filter, setFilter] = useUrlFilter(FILTERS, "urgent");
  /* Its own query key, so the Overview's `?filter=urgent` links keep landing
     on the queue exactly as they did. */
  const [view, setView] = useUrlFilter(VIEWS_IDS, "questions", "view");
  /**
   * The place the queue is scoped to, when one has been opened from the other
   * panel — the join between the two halves of this page.
   *
   * Free-form (`useUrlValue`) because a city comes from the database rather
   * than from a list of pills, and in the address bar so *"the eight questions
   * behind Pasadena's 8"* is a link somebody can send.
   */
  const [place, setPlace] = useUrlValue("place");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /* The question being acted on, not the whole queue. */
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const all = rows ?? [];
  /**
   * The place scope, applied **before** the tabs and their counts.
   *
   * ⚠ It matches the rolled-up city *or* the stored value, so a link can name
   * either — "Pasadena" catches every district under it, and "Bungalow Heaven"
   * catches only that one. Scoping the counts as well is the 2 Sep rule: a
   * pill reading 14 over a list of 3 is the fault this page was reported for.
   */
  const inPlace = useMemo(
    () =>
      place
        ? all.filter((r) => r.city === place || r.neighborhood === place)
        : all,
    [all, place],
  );
  const visible = useMemo(() => {
    const list = inPlace.filter((r) => !r.is_test);
    if (filter === "urgent")
      return list.filter((r) => r.requires_human_review && r.status === "open");
    if (filter === "open") return list.filter((r) => r.status === "open");
    return list;
  }, [inPlace, filter]);

  /* Counted off the filtered list, so the button follows the tab a reader is
     on. Inert at today's 27 questions and in place before the pilot fills it. */
  const { shown, hidden, revealAll } = useReveal(visible);

  /**
   * The counts, and each is computed with **the same predicate as the tab it
   * sits on** — which is a fix, not a refactor. The old badge read "Needs a
   * person · {high + peer}" while the tab it labelled shows everything with
   * requires_human_review, and that includes the allegation class. So on this
   * cohort the tab promised 14 and listed 19: the five questions the page
   * treats as the most serious of all were the five its own counter omitted.
   *
   * The rule that prevents the next one: a count and the list it describes come
   * from one expression, never from two that happen to agree.
   */
  const counts = useMemo(() => {
    const real = inPlace.filter((r) => !r.is_test);
    const open = real.filter((r) => r.status === "open");
    return {
      allegation: open.filter((r) => r.sensitivity === "named_allegation").length,
      high: open.filter((r) => r.sensitivity === "high_stakes").length,
      peer: open.filter((r) => r.sensitivity === "peer_support").length,
      ordinary: open.filter((r) => r.sensitivity === "ordinary").length,
      urgent: open.filter((r) => r.requires_human_review).length,
      open: open.length,
      all: real.length,
    };
  }, [inPlace]);


  async function run(
    rowId: string,
    label: string,
    fn: () => Promise<{ persisted: boolean }>,
  ) {
    setBusy(rowId);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted
          ? label
          : `${label} — but nothing was saved.`,
      );
      setNoteFor(null);
      setNote("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead title="What parents asked for" />

      {/* Banners above the filter — see `/admin/activities` for why: a wrapped
          filter row pushes a confirmation off a phone screen. */}
      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      {/**
        * ⚠⚠ **Two jobs, not one page of controls.**
        *
        * Measured at 1440 on the default view: the page was **1734px, and 980
        * of them — 57% — were "Where demand is strongest"**, which is not the
        * queue at all. One half is a worklist somebody reads a question on,
        * decides, and clears; the other is a report read once a week to argue
        * about which town to open next. Different readers, different cadence,
        * different shape — and the report was nearly twice the queue on the
        * screen titled *what parents asked for*.
        *
        * ⚠ **A tab strip rather than more filter pills**, which is the
        * distinction `SegmentedFilter` documents itself as not being for: these
        * swap whole panels, so arrowing across must not select (manual
        * activation), and `SegmentedTabs` is the primitive `/admin/contributors`
        * already uses for exactly this.
        *
        * ⚠ **Still one page, deliberately.** The 17 Sep decision put sign-ups
        * and questions in one table and one vocabulary *because* two place
        * lists side by side is the "some hide and some don't" this admin was
        * reported for. That argument is about not having two lists; it never
        * required them on one screen. One nav item, one address, two panels.
        *
        * ⚠ **No counts on the tabs.** The queue's numbers are on the filter
        * pills directly below, and a fourth number about the same list is the
        * noise this change exists to remove.
        */}
      <Toolbar>
        <SegmentedTabs
          panelId="demand-view"
          label="Which half of this page to read"
          value={view}
          onChange={setView}
          options={VIEWS}
        />
      </Toolbar>

      <div
        id="demand-view"
        role="tabpanel"
        tabIndex={0}
        aria-label={VIEWS.find((v) => v.id === view)?.label}
      >
        {view === "places" ? (
          <PlacesCard
            places={places}
            onOpenQuestions={(city) => {
              setPlace(city);
              setView("questions");
            }}
          />
        ) : (
          <>
          {/**
            * The scope, when the other panel sent them here.
            *
            * ⚠ Above the pills rather than beside them: the pills' numbers are
            * counted *inside* this scope, so a reader who cannot see the scope
            * is reading three numbers that do not add up to the page they
            * think they are on. Clearing it is the same tap that set it.
            */}
          {place && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-baseline gap-2 rounded-full border border-green-line bg-green-wash px-3 py-1 text-[12.5px] text-green-deep">
                <span className="font-semibold">{slugLabel(place)}</span>
                only
              </span>
              <Button tone="secondary" onClick={() => setPlace(null)}>
                Show every place
              </Button>
            </div>
          )}

          <div className="mb-4">
            <SegmentedFilter
              unknown={!rows}
              label="Which questions to show"
              value={filter}
              onChange={setFilter}
              options={[
                {
                  id: "urgent",
                  label: "Needs a person",
                  count: counts.urgent,
                },
                { id: "open", label: "All open", count: counts.open },
                { id: "all", label: "Everything", count: counts.all },
              ]}
            />
          </div>

          {/**
           * Above the high-stakes banner on purpose: this is the only class where Pando
           * does nothing at all until a person has read it.
           */}
          {counts.allegation > 0 && (
            <div className="mb-2 rounded-xl border border-alert-line bg-alert-wash px-4 py-2.5">
              <p className="text-[13.5px] font-semibold text-alert">
                {counts.allegation === 1
                  ? "One parent made a claim about a named person."
                  : `${counts.allegation} parents made claims about named people.`}
              </p>
            </div>
          )}

          {counts.high > 0 && (
            <div className="mb-4 rounded-xl border border-gold-line bg-gold-wash px-4 py-2.5">
              <p className="text-[13.5px] font-semibold text-gold-ink">
                {counts.high === 1
                  ? "One parent asked about health, legal or safety."
                  : `${counts.high} parents asked about health, legal or safety.`}
              </p>
            </div>
          )}

          <Card>
            {loading && all.length === 0 ? (
              <Loading />
            ) : error && all.length === 0 ? (
              <Failed />
            ) : !configured && all.length === 0 ? (
              <NotConfigured demo={demo} onDemo={setDemo} />
            ) : visible.length === 0 ? (
              <Empty
                title={
                  place
                    ? `Nothing from ${slugLabel(place)} in this view`
                    : filter === "urgent"
                      ? "Nothing needs a person"
                      : "Nothing in this view"
                }
              />
            ) : (
              <RecordList>
                {shown.map((row) => {
                  const kind = DEMAND_SENSITIVITY[row.sensitivity];
                  const needsNote =
                    row.sensitivity === "high_stakes" ||
                    row.sensitivity === "named_allegation";
                  return (
                    <RecordCard
                      key={row.id}
                      /**
                       * Only the allegation class gets a wash, and that is a change.
                       * Every non-ordinary row used to carry one, so in the "needs a
                       * person" view the whole page was pink or gold — and two
                       * banners above it were making the same point in words. One
                       * accent that means something beats a page-wide tint: an
                       * allegation is the single class where Pando does *nothing at
                       * all* until a person has read it. High-stakes keeps its badge,
                       * which is where the distinction belongs.
                       */
                      tone={row.sensitivity === "named_allegation" ? "urgent" : "plain"}
                      /* The question in the parent's own words is the record. */
                      title={
                        <span className="font-normal leading-relaxed">
                          “{row.question_text}”
                        </span>
                      }
                      aside={
                        <>
                          {row.contributor?.name ?? "No profile"}
                          <span className="mt-0.5 block">{when(row.created_at)}</span>
                        </>
                      }
                      badges={
                        <>
                          <Badge
                            tone={kind?.tone ?? "neutral"}
    >
                            {kind?.label ?? sentence(row.sensitivity)}
                          </Badge>
                          <Badge tone={DEMAND_STATUS[row.status]?.tone ?? "neutral"}>
                            {DEMAND_STATUS[row.status]?.label ?? sentence(row.status)}
                          </Badge>
                          {/**
                           * ⚠ There is deliberately **no** third badge here. It used
                           * to carry "Waiting for you to read it" whenever
                           * `requires_human_review` was set and the row was open —
                           * beside a status badge that already reads **"Not looked
                           * at"** for exactly those rows. Two pills saying one thing,
                           * on every open card. What it was really distinguishing is
                           * *this one needs a person*, and the sensitivity badge to
                           * its left says that in words.
                           *
                           * (Its history is worth keeping: it once read "not usable
                           * until read", driven by a column **nothing ever clears**,
                           * so a question you had read, followed up and answered
                           * still claimed to be unread forever. Tying it to `status`
                           * fixed the lie; removing it fixes the repetition.)
                           */}
                        </>
                      }
                      actions={
                        <>
                          {row.status === "open" && (
                            <Button
                              tone="primary"
                              disabled={busy === row.id}
                              subject={`"${row.question_text.slice(0, 44).trimEnd()}"`}
                              onClick={() => setNoteFor(noteFor === row.id ? null : row.id)}
                            >
                              {needsNote
                                ? "I've dealt with this"
                                : "I know who could answer"}
                            </Button>
                          )}
                          {row.status !== "closed" && (
                            <Button
                              tone="secondary"
                              disabled={busy === row.id}
                              subject={`"${row.question_text.slice(0, 44).trimEnd()}"`}
                              onClick={() =>
                                void run(row.id, "Closed", async () =>
                                  adminAction({
                                    action: "demand.status",
                                    id: row.id,
                                    to: "closed",
                                    note: null,
                                  }),
                                )
                              }
                            >
                              Nothing to do
                            </Button>
                          )}
                        </>
                      }
                    >
                      {/* One line, not a grid: two one-word values were taking
                          half a 1,130px row each, stacked over their labels — 347px
                          of card for a sentence and two words. */}
                      <FactLine>
                        <FactInline label="About">
                          {row.category
                            ? (DEMAND_CATEGORY[row.category] ?? sentence(row.category))
                            : null}
                        </FactInline>
                        <FactInline label="Where from">
                          {row.neighborhood ? (
                            slugLabel(row.neighborhood)
                          ) : (
                            <span className="text-muted">Not known</span>
                          )}
                        </FactInline>
                      </FactLine>

                      {noteFor === row.id && (
                        <RecordDrawer>
                          <Field
                            label={
                              needsNote
                                ? "What you did about it"
                                : "Who or what could answer this"
                            }
                            hint="Saved with your name. Never reaches the parent."
                          >
                            <input
                              className={inputClass}
                              value={note}
                              onChange={(e) => setNote(e.target.value.slice(0, 300))}
                            />
                          </Field>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              tone="primary"
                              disabled={busy === row.id || note.trim().length < 3}
                              onClick={() =>
                                void run(row.id, "Recorded", async () =>
                                  adminAction({
                                    action: "demand.status",
                                    id: row.id,
                                    to: needsNote ? "answered" : "matched",
                                    note: note.trim(),
                                  }),
                                )
                              }
                            >
                              Save
                            </Button>
                            <Button
                              tone="secondary"
                              onClick={() => {
                                setNoteFor(null);
                                setNote("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </RecordDrawer>
                      )}
                    </RecordCard>
                  );
                })}
              </RecordList>
            )}
            <RevealMore n={hidden} onClick={revealAll} />
          </Card>
          </>
        )}
      </div>

      {/* A guarantee the page has no way to break, stated under it on every
          visit. Enforced in the routing code, which is where it belongs. */}
    </>
  );
}

/**
 * 17 Sep — where people join from, ranked.
 *
 * ## Why there is a bar
 *
 * The card's own title is *where demand is strongest*, i.e. it is a ranking —
 * and as eight rows of "13 sign-ups", "6 sign-ups", "1 sign-up" set in one
 * muted size, the ranking was invisible: Pasadena being twice Altadena had to
 * be worked out by reading two numbers. That is the finding the matching
 * weights card already records (7 Sep) — *numbers whose only purpose is to be
 * weighed against each other, and not one of them aligned with another* — so
 * the answer is the same one: a bar, with the top row as the denominator, so
 * the longest is always full and the list reads at a glance.
 *
 * ⚠ **It draws sign-ups and never questions**, because sign-ups is what the SQL
 * orders by; a bar drawing one number beside a list sorted on another would be
 * two rankings on one row. Questions keeps its own figure, at a fixed x.
 *
 * ## Why the two sub-lines are labelled
 *
 * They were both `text-[12.5px] text-muted` at the same indent, so "13 with no
 * ZIP on record" and "Classes & activities · Childcare" read as one grey
 * paragraph and the ZIP line looked like one more topic. A ZIP is a token with
 * its count now, and the topics are a labelled run — the `Fact` idiom this
 * admin already uses everywhere else.
 *
 * ⚠ **An absent ZIP is drawn in a different register from a real one** (dashed
 * and muted, against bordered on paper), because it is not a place: the ZIP
 * question only exists since 14 Sep, so most profiles have none, and a chip
 * saying "13 with no ZIP" set like a postcode would read as a postcode. It is
 * sent by the server rather than counted here, per the 2 Sep rule that a count
 * and the list it describes come from one expression.
 */
function PlacesCard({
  places,
  onOpenQuestions,
}: {
  places: PlaceDemand;
  onOpenQuestions: (city: string) => void;
}) {
  /**
   * ## 21 Sep — it can be searched, and a place can be opened
   *
   * The developer: *"інформація виглядає сухо і не можна переглянути її для
   * кожного району, міста тощо, за пошуком."* Two things, and the second is
   * the one that was actually missing.
   *
   * **A box, because a ranking is not a directory.** The list is ordered by
   * sign-ups, which is right for *where is demand strongest* and useless for
   * *how is Temple City doing* — that question means reading down until you
   * find it, and it gets worse every week the pilot runs. It matches the city,
   * **the districts under it**, its ZIPs and what it was asked about, so the
   * three things a reader might type all land: a postcode nobody can place, a
   * district name that is not on screen because it rolled up, and a topic.
   *
   * **And a row opens.** The roll-up is the reason this card can be trusted
   * (17 Sep: un-rolled, Altadena led with 6 and Pasadena read as 1) and it is
   * also what it hides — the note says a Pasadena district counts towards
   * Pasadena and the page could not say **which**. Opening a city is where its
   * districts, all of its ZIPs and its full topic list live, and it is the
   * only place the word "район" in that sentence can be answered.
   *
   * ⚠ **Every count in the panel is server-sent**, never derived here: the
   * districts, the ZIPs and now the per-topic counts all come from one query
   * with the roll-up in it, which the browser cannot do (2 Sep, and the reason
   * `demand_places` is its own resource).
   */
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  /* The city label is what a reader types, so the match is over labels and
     slugs alike — `slugLabel` is what they can see. Folded to letters and
     digits so "la canada" finds "la-canada-flintridge" and "91104" is not
     defeated by a space. */
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = fold(query);

  const rows = useMemo(() => {
    if (!needle) return places.rows;
    return places.rows.filter((r) =>
      [
        r.city,
        slugLabel(r.city),
        ...r.areas.flatMap((a) => [a.area, slugLabel(a.area)]),
        ...r.zips.map((z) => z.zip),
        ...r.categories.flatMap((c) => [
          c.category,
          DEMAND_CATEGORY[c.category] ?? sentence(c.category),
        ]),
      ].some((v) => fold(String(v)).includes(needle)),
    );
  }, [places.rows, needle]);

  /* The condition that used to gate this block at the call site. As a panel it
     has to render something, and an empty tab that says nothing reads as a
     page that failed to load. */
  if (places.rows.length === 0 && places.questions_no_place === 0) {
    return (
      <Card>
        <Empty title="Nobody has joined from anywhere yet" />
      </Card>
    );
  }

  /**
   * The top row's own count, and it is taken from **every** place rather than
   * from the ones a search left on screen.
   *
   * ⚠ Otherwise the bars re-scale as somebody types: filter to Temple City and
   * its 2 sign-ups draw a full bar, which says it leads the market. A ranking
   * that changes with the search box is not a ranking. `Math.max(1, …)` so a
   * cohort that is questions only cannot divide by zero.
   */
  const most = Math.max(1, ...places.rows.map((r) => r.signups));

  return (
    <Card>
      <div className="px-4 py-3">
        {/* ⚠ No heading of its own since 17 Sep: the tab that opens this panel
            is called "Where demand is strongest", and a card heading repeating
            it two inches below is the duplication this split was made to
            remove. The panel is named by the tab (`aria-label`). */}
        {/* The denominator, said once. Every number in this block is a parent
            who finished — see `PlaceDemand` for why "or tried to" is not
            answerable here. */}
        <p className="text-[12.5px] text-muted">
          Grouped by city, so a Pasadena district counts towards Pasadena.
          Sign-ups are parents who finished a profile.
        </p>

        {/* ⚠ The box appears once the list is long enough to need it. Below
            that it is a control that can only ever hide rows the reader can
            already see — the same reasoning that keeps `RevealMore` off a
            short queue. */}
        {places.rows.length > 5 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/* The same box `/admin/contributors` uses, named rather than
                labelled: a visible "Find a place" above a control whose
                placeholder already says so is the duplication the 16 Sep
                schools fix records one surface along. */}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="City, district, ZIP or topic"
              aria-label="Find a place"
              className={`${controlClass} w-[15rem]`}
            />
            {needle && (
              <span className="text-[12.5px] text-muted">
                {rows.length === 0
                  ? "No place matches that."
                  : `${rows.length} of ${places.rows.length} places`}
              </span>
            )}
          </div>
        )}

        <ul className="mt-3">
          {rows.map((r) => {
            const isOpen = open === r.city;
            /**
             * ⚠ **All of them, the city-level row included, or the list does
             * not add up.** Dropping `area === city` reads tidier and cost the
             * panel its arithmetic: Pasadena's nine districts came to **12**
             * under a row saying 13, and the thirteenth parent — the one
             * stored under plain "Pasadena" with no district — was missing
             * with nothing saying so. It is labelled rather than hidden.
             *
             * A roll-up of exactly one member *is* the row above it, so that
             * case shows nothing at all.
             */
            const districts = r.areas.length > 1 ? r.areas : [];
            return (
              <li key={r.city} className="border-t border-bark/40 py-2.5">
                <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)]">
                  {/* `Heading`, not a hardcoded tag: with the card's own title
                      gone the level comes from the context, so these land at h2
                      under the page heading exactly as the question cards in the
                      other panel do. Hardcoded `h3` is what made this panel jump
                      a level the moment the h2 above it went — the 7 Sep fault,
                      reintroduced by removing a heading. */}
                  <Heading className="truncate text-[13.5px] font-semibold">
                    {/* ⚠ The whole name is the target, not a chevron beside it:
                        at 375px a 20px glyph next to a 100px word is the small
                        target this admin keeps being reported for, and the name
                        is what a reader is already pointing at. */}
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : r.city)}
                      aria-expanded={isOpen}
                      className="min-h-11 text-left hover:text-green-deep sm:min-h-0"
                    >
                      {slugLabel(r.city)}
                    </button>
                  </Heading>

                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      {/* Fixed width, with the figure right-aligned inside it,
                          so every bar starts at one x — without that they step
                          sideways with the width of "1" against "13" and stop
                          being comparable, which is the whole point of them. */}
                      <span className="flex w-[5.75rem] shrink-0 items-baseline gap-1 text-[12.5px] text-muted">
                        <span className="w-5 text-right text-[14px] font-semibold tabular-nums text-ink">
                          {r.signups}
                        </span>
                        {r.signups === 1 ? "sign-up" : "sign-ups"}
                      </span>

                      {/* Capped rather than free, so the questions figure beside
                          it also lands at one x on every row. `aria-hidden`: the
                          number it draws is already read out to its left. */}
                      <span
                        aria-hidden="true"
                        className="hidden h-1.5 max-w-[13rem] flex-1 rounded-full bg-bark/40 sm:block"
                      >
                        <span
                          className="block h-full rounded-full bg-green"
                          style={{ width: `${Math.max(4, (r.signups / most) * 100)}%` }}
                        />
                      </span>

                      {r.questions > 0 && (
                        <span className="flex shrink-0 items-baseline gap-1 text-[12.5px] text-muted">
                          <span className="text-[13px] font-semibold tabular-nums text-ink">
                            {r.questions}
                          </span>
                          {r.questions === 1 ? "question" : "questions"}
                        </span>
                      )}
                    </div>

                    {/* Closed, the row keeps the shape it had: what was asked
                        about, in one line. Open, the same list is below with
                        its counts, so this would be the same fact twice. */}
                    {!isOpen && r.categories.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <SubLabel>Asked about</SubLabel>
                        <span className="min-w-0 truncate text-[12.5px] text-muted">
                          {r.categories
                            .map((c) => DEMAND_CATEGORY[c.category] ?? sentence(c.category))
                            .join(" · ")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <RecordDrawer title={`Inside ${slugLabel(r.city)}`}>
                    {districts.length > 0 && (
                      <div className="mb-3">
                        <SubLabel>Districts</SubLabel>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {districts.map((a) => (
                            <Tally
                              key={a.area}
                              /* The city's own name inside its own panel needs
                                 saying why it is there: these are the parents
                                 who chose the town rather than a district. */
                              label={
                                a.area === r.city
                                  ? `${slugLabel(a.area)} (no district)`
                                  : slugLabel(a.area)
                              }
                              signups={a.signups}
                              questions={a.questions}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {(r.zips.length > 0 || r.signups_no_zip > 0) && (
                      <div className="mb-3">
                        <SubLabel>ZIPs</SubLabel>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {r.zips.map((z) => (
                            <span
                              key={z.zip}
                              className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-full border border-bark bg-paper px-2 py-0.5 text-[11.5px]"
                            >
                              <span className="font-semibold tabular-nums">{z.zip}</span>
                              <span className="text-muted">{z.signups}</span>
                            </span>
                          ))}
                          {/* ⚠ Dashed and muted against bordered-on-paper,
                              because an absent ZIP is not a place: the question
                              only exists since 14 Sep, so most profiles have
                              none and a chip saying "13 with no ZIP" set like a
                              postcode would read as a postcode. */}
                          {r.signups_no_zip > 0 && (
                            <span className="whitespace-nowrap rounded-full border border-dashed border-bark px-2 py-0.5 text-[11.5px] text-muted">
                              {r.signups_no_zip} with no ZIP
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {r.categories.length > 0 && (
                      <div className="mb-3">
                        <SubLabel>Asked about</SubLabel>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {r.categories.map((c) => (
                            <span
                              key={c.category}
                              className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-full border border-bark bg-paper px-2 py-0.5 text-[11.5px]"
                            >
                              {DEMAND_CATEGORY[c.category] ?? sentence(c.category)}
                              <span className="font-semibold tabular-nums text-muted">
                                {c.questions}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* The join to the other half of the page. It is the only
                        route from a number to the sentences behind it, which is
                        what "dry" was: eight topics and no way to read one. */}
                    {r.questions > 0 ? (
                      <Button
                        tone="secondary"
                        subject={slugLabel(r.city)}
                        onClick={() => onOpenQuestions(r.city)}
                      >
                        {r.questions === 1
                          ? "Read the question"
                          : `Read the ${r.questions} questions`}
                      </Button>
                    ) : (
                      <p className="text-[12.5px] text-muted">
                        Nobody here has asked anything yet.
                      </p>
                    )}
                  </RecordDrawer>
                )}
              </li>
            );
          })}
        </ul>

        {places.questions_no_place > 0 && (
          <p className="mt-3 border-t border-bark/40 pt-2.5 text-[12.5px] text-muted">
            {places.questions_no_place} question
            {places.questions_no_place === 1 ? "" : "s"} from anonymous sessions,
            with no neighborhood on record.
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * A district, with both of its numbers.
 *
 * Its own component because the two figures have to read as *one* place rather
 * than as two chips — and because a district with questions and no sign-ups is
 * the row an expansion decision most wants to see, so neither number may be
 * dropped when it is zero on the other side.
 */
function Tally({
  label,
  signups,
  questions,
}: {
  label: string;
  signups: number;
  questions: number;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border border-bark bg-paper px-2 py-0.5 text-[11.5px]">
      <span className="font-semibold">{label}</span>
      <span className="text-muted">
        {signups} sign-up{signups === 1 ? "" : "s"}
        {questions > 0 && ` · ${questions} question${questions === 1 ? "" : "s"}`}
      </span>
    </span>
  );
}


/** The 11px uppercase label `Fact` uses, for a line that is not a `<dl>`. */
function SubLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
      {children}
    </span>
  );
}
