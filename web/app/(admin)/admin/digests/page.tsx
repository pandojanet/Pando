"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bell, ChevronLeft, ChevronRight, GraduationCap, HandHeart, Tent, Ticket, TriangleAlert, type LucideIcon } from "lucide-react";
import { Calendar, SegmentedFilter, Select } from "@/components/admin/kit";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Loading,
  NotConfigured,
  PageHead,
  Stat,
  StatStrip,
  TextLink,
  when,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import { DIGEST_EDITION_STATUS, DIGEST_ITEM_KIND, sentence } from "@/lib/admin/labels";
import { cn } from "@/lib/cn";
import type { DigestGroup, DigestItemRow, DigestVariant, DigestWeek, DigestWeekIndex } from "@/lib/admin/types";

/**
 * Weekly digests (12 Nov; rebuilt the same day after an independent review) —
 * what went out each Saturday, what families picked, and what needs a look.
 *
 * Laid out the way the leading admin tools lay out a dense list (12 Nov, the developer: "it looks wooden —
 * improve it the way the leading sites do"): one surface per level, hairlines instead of boxes in boxes,
 * hierarchy by weight and colour rather than capitals, numbers in tabular figures, chrome that recedes.
 *
 * Read top to bottom the way the page is used:
 *  - **the week** — a picker of our own (`Select`, not the platform's list),
 *    stepped with ‹ ›, real and test weeks kept apart, the week in the URL;
 *  - **the week in one sentence**, its numbers, and — only when there is one —
 *    what needs a look (a failed search, families nothing suited);
 *  - **the groups**, one row each, failed first then the largest, opened one at
 *    a time;
 *  - in a group, **what was sent** (and, folded, what was found but went to
 *    nobody — a digest has four places, a search returns up to twelve), then
 *    **what families received**: not N copies of near-identical texts but the
 *    sets of items side by side, what most families got first, the differences
 *    bold, and an item another group's search found named as such — the reason
 *    texts differ is the layout, not a paragraph (the client's rule, 7 Sep).
 *
 * Read-only. Texts are rebuilt from each send's stored items — bodies are never
 * stored (invariant 7).
 */

type Which = "real" | "test";

/** "2026-11-21" → "Sat, Nov 21": the Saturday, read on its own date whatever the browser's clock. */
function saturday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The Saturday of the week a day is in (Sunday first): what a click anywhere in that week picks. */
function saturdayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (6 - d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Zero is left out of a sentence of outcomes (a column would show it). */
function outcomes(parts: Array<[number, string, string?]>): string {
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => (many ? plural(n, one, many) : `${n} ${one}`))
    .join(" · ");
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ages(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return min === max ? `Age ${min}` : `Ages ${min}–${max}`;
  return min !== null ? `Ages ${min}+` : `Up to ${max}`;
}

/** One expression for the week's numbers, so the sentence, the numbers and the rows cannot disagree. */
function weekTotals(week: DigestWeek) {
  const items = week.groups.flatMap((g) => g.items);
  return {
    groups: week.groups.length,
    failed: week.groups.filter((g) => g.status === "failed"),
    families: week.groups.reduce((n, g) => n + g.families_sent, 0),
    nothing: week.groups.filter((g) => g.families_nothing > 0),
    remindersSet: items.reduce((n, i) => n + i.reminders + i.reminded, 0),
    remindersSent: items.reduce((n, i) => n + i.reminded, 0),
    loved: items.reduce((n, i) => n + i.loved, 0),
    ok: items.reduce((n, i) => n + i.ok, 0),
    didntGo: items.reduce((n, i) => n + i.didnt_go, 0),
  };
}

function groupTotals(g: DigestGroup) {
  return {
    sentItems: g.items.filter((i) => i.sent_to > 0).length,
    remindersSet: g.items.reduce((n, i) => n + i.reminders + i.reminded, 0),
    loved: g.items.reduce((n, i) => n + i.loved, 0),
  };
}

/* Failed searches first, then the groups that reached the most families. */
function ordered(groups: DigestGroup[]): DigestGroup[] {
  return [...groups].sort((a, b) => Number(b.status === "failed") - Number(a.status === "failed") || b.families_sent - a.families_sent);
}

const groupAnchor = (g: DigestGroup) => `digest-group-${g.id}`;

/* Families were texted but which items each got was not stored (a week before 0067): its "sent" is unknown, not 0. */
const sendsKnown = (g: DigestGroup) => g.variants.length > 0 || g.families_sent === 0;

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function DigestsPage() {
  const [which, setWhich] = useState<Which | null>(null);
  const [date, setDate] = useState<string | null>(null);
  /* A Saturday older than the latest ones the page holds in full is read on its own (the calendar, 12 Nov). */
  const [asked, setAsked] = useState<string | null>(null);
  const { rows, configured, loading, error, demo, setDemo } = useAdminRows("digests", asked ? { week: asked } : undefined);

  /* The week lives in the URL (`?week=2026-11-21&test=1`): a reload or a shared link opens the same Saturday. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("week")) setDate(q.get("week"));
    if (q.get("test") === "1") setWhich("test");
  }, []);

  /* Every Saturday (the index), and those held in full. */
  const index = useMemo(() => rows?.index ?? [], [rows]);
  const real = index.filter((w) => !w.is_test);
  const test = index.filter((w) => w.is_test);
  /* Real weeks unless asked for test — or unless there are only test weeks, which then say so on the picker. */
  const set: Which = which ?? (real.length > 0 || test.length === 0 ? "real" : "test");
  const entries = set === "test" ? test : real;
  const entry = entries.find((w) => w.edition_date === date) ?? entries[0] ?? null;
  const week = entry ? (rows?.weeks ?? []).find((w) => w.edition_date === entry.edition_date && w.is_test === entry.is_test) ?? null : null;

  /* Chosen but not held in full (older than the latest): read it. */
  useEffect(() => {
    if (entry && !week && !loading && asked !== entry.edition_date) setAsked(entry.edition_date);
  }, [entry, week, loading, asked]);

  useEffect(() => {
    if (!entry) return;
    const q = new URLSearchParams(window.location.search);
    q.set("week", entry.edition_date);
    if (entry.is_test) q.set("test", "1");
    else q.delete("test");
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  }, [entry]);

  const tableConfigured = configured && rows?.configured !== false;
  const picksKnown = rows?.picks_configured === true;

  return (
    <>
      <PageHead title="Weekly digests" />

      {error && <ErrorNote>{error}</ErrorNote>}

      {tableConfigured && index.length > 0 && (
        <WeekBar
          weeks={entries}
          week={entry}
          onPick={setDate}
          set={set}
          onSet={(s) => {
            setWhich(s);
            setDate(null);
          }}
          counts={{ real: real.length, test: test.length }}
        />
      )}

      <div className="space-y-4">
        {loading && !rows ? (
          <Card>
            <Loading />
          </Card>
        ) : error && !rows ? (
          <Card>
            <Failed />
          </Card>
        ) : !tableConfigured ? (
          <Card>
            <NotConfigured demo={demo} onDemo={setDemo} noSample />
          </Card>
        ) : !entry ? (
          <Card>
            <Empty title="No digest yet" />
          </Card>
        ) : !week ? (
          <Card>
            <Loading />
          </Card>
        ) : (
          <WeekView key={`${week.edition_date}-${week.is_test}`} week={week} picksKnown={picksKnown} />
        )}
      </div>
    </>
  );
}

/* ── The week picker ──────────────────────────────────────────────────────── */

function WeekBar({
  weeks,
  week,
  onPick,
  set,
  onSet,
  counts,
}: {
  weeks: DigestWeekIndex[];
  week: DigestWeekIndex | null;
  onPick: (date: string) => void;
  set: Which;
  onSet: (s: Which) => void;
  counts: { real: number; test: number };
}) {
  /* `weeks` is newest first: "earlier" is the next index, "later" the previous. */
  const at = week ? weeks.indexOf(week) : -1;
  const step = (by: number) => {
    const to = weeks[at + by];
    if (to) onPick(to.edition_date);
  };
  return (
    /* Sticky from a tablet up: on a phone its two rows would hold a fifth of the screen. */
    <div className="z-20 -mx-4 mb-5 border-b border-bark/60 bg-paper/90 px-4 py-2.5 backdrop-blur sm:sticky sm:top-0 md:-mx-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          {/* One control, four segments — ‹ the Saturday, the calendar › — as a date navigator reads. */}
          <div className="flex min-w-0 flex-1 items-stretch divide-x divide-bark rounded-lg border border-bark bg-card shadow-card sm:flex-none">
            <StepButton label="An earlier Saturday" edge="left" disabled={at < 0 || at >= weeks.length - 1} onClick={() => step(1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </StepButton>
            {week && (
              <Select
                bare
                label="Which Saturday"
                className="min-w-0 flex-1 sm:w-[21rem] sm:flex-none"
                value={week.edition_date}
                onChange={onPick}
                options={weeks.map((w) => ({
                  id: w.edition_date,
                  label: saturday(w.edition_date),
                  detail: [
                    plural(w.families, "family", "families"),
                    plural(w.groups, "group"),
                    w.failed > 0 ? `${plural(w.failed, "search", "searches")} failed` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))}
              />
            )}
            {/* Any Saturday, by its date — the list is newest first, the calendar any month. */}
            <Calendar
              bare
              label="Find a week on the calendar"
              value={week?.edition_date ?? null}
              onChange={onPick}
              marks={new Map(weeks.map((w) => [w.edition_date, { note: `${w.families} ${w.families === 1 ? "family" : "families"}`, alert: w.failed > 0 }]))}
              resolve={(day) => {
                const sat = saturdayOf(day);
                return weeks.some((w) => w.edition_date === sat) ? sat : null;
              }}
            />
            <StepButton label="A later Saturday" edge="right" disabled={at <= 0} onClick={() => step(-1)}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </StepButton>
          </div>
          {at > 0 && (
            <Button tone="ghost" onClick={() => onPick(weeks[0].edition_date)}>
              Latest
            </Button>
          )}
        </div>
        {counts.test > 0 && (
          <SegmentedFilter
            track
            label="Which weeks"
            value={set}
            onChange={onSet}
            options={[
              { id: "real", label: "Real", count: counts.real },
              { id: "test", label: "Test", count: counts.test },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function StepButton({
  label,
  edge,
  disabled,
  onClick,
  children,
}: {
  label: string;
  edge: "left" | "right";
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center text-ink transition-colors hover:bg-bark-soft/70 disabled:cursor-default disabled:text-muted/40 disabled:hover:bg-transparent",
        edge === "left" ? "rounded-l-[7px]" : "rounded-r-[7px]",
      )}
    >
      {children}
    </button>
  );
}

/* ── One week ─────────────────────────────────────────────────────────────── */

function WeekView({ week, picksKnown }: { week: DigestWeek; picksKnown: boolean }) {
  const t = weekTotals(week);
  const groups = ordered(week.groups);
  /* One group open at a time is the default reading; a "needs a look" link opens the one it names. */
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0].id] : []));
  const reveal = useCallback((g: DigestGroup) => {
    setOpen((was) => new Set([...was, g.id]));
    requestAnimationFrame(() => document.getElementById(groupAnchor(g))?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const sentOn = week.groups.map((g) => g.sent_at).filter((s): s is string => !!s).sort()[0] ?? null;
  const problems = t.failed.length > 0 || t.nothing.length > 0;
  const found = week.groups.reduce((n, g) => n + g.items.length, 0);
  const sentItems = week.groups.reduce((n, g) => n + g.items.filter((i) => i.sent_to > 0).length, 0);
  const replies = t.loved + t.ok + t.didntGo;

  return (
    <div className="space-y-6">
      <StatStrip label="This week">
        <Stat label="Families texted" value={t.families} hint={[plural(t.groups, "group"), sentOn ? `sent ${when(sentOn)}` : null].filter(Boolean).join(" · ")} />
        {week.groups.every(sendsKnown) ? (
          <Stat label="Items sent" value={sentItems} hint={`of ${found} found`} />
        ) : (
          <Stat label="Items found" value={found} />
        )}
        {picksKnown ? (
          <>
            <Stat label="Reminders" value={t.remindersSet} hint={t.remindersSent > 0 ? `${t.remindersSent} sent` : null} />
            <Stat
              label="Afterwards"
              value={replies > 0 ? replies : "—"}
              hint={outcomes([
                [t.loved, "loved it"],
                [t.ok, "OK"],
                [t.didntGo, "didn't go"],
              ]) || null}
            />
          </>
        ) : (
          <div className="col-span-2 flex items-center bg-card px-4 py-3.5 text-[13px] text-muted">{/* copy: state */}Picks are not recorded for this week.</div>
        )}
      </StatStrip>

      {problems && (
        <section aria-labelledby="digest-look" className="flex gap-3 rounded-xl border border-gold-line bg-gold-wash/70 px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="digest-look" className="text-[13.5px] font-semibold text-gold-ink">
              Needs a look
            </h2>
            <ul className="mt-1 space-y-0.5 text-[13.5px] text-ink">
              {t.failed.map((g) => (
                <li key={`f-${g.id}`}>
                  The search failed for{" "}
                  <TextLink href={`#${groupAnchor(g)}`} onClick={() => reveal(g)}>
                    {g.label ?? "everyone"}
                  </TextLink>
                  {g.attempts > 1 ? `, after ${g.attempts} tries` : ""}.
                </li>
              ))}
              {t.nothing.map((g) => (
                <li key={`n-${g.id}`}>
                  {plural(g.families_nothing, "family", "families")} in{" "}
                  <TextLink href={`#${groupAnchor(g)}`} onClick={() => reveal(g)}>
                    {g.label ?? "everyone"}
                  </TextLink>{" "}
                  had nothing that suited, so got no text.
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="digest-groups">
        <h2 id="digest-groups" className="mb-2 flex items-baseline gap-2 px-1 text-[15px] font-semibold text-ink">
          Groups <span className="text-[13px] font-normal tabular-nums text-muted">{t.groups}</span>
        </h2>
        <div className="rounded-xl border border-bark bg-card shadow-card">
          <div aria-hidden="true" className={cn(ROW, "hidden border-b border-bark/70 py-2 text-[12px] font-medium text-muted md:grid")}>
            <span />
            <span>Group</span>
            <span className="text-right">Families</span>
            <span>Items sent</span>
            <span className="text-right">Reminders</span>
          </div>
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              picksKnown={picksKnown}
              open={open.has(g.id)}
              onOpen={(o) =>
                setOpen((was) => {
                  const next = new Set(was);
                  if (o) next.add(g.id);
                  else next.delete(g.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── One group ────────────────────────────────────────────────────────────── */

/** The group list's columns: the chevron, the group, families, items sent, reminders. */
const ROW = "grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 px-4 md:grid-cols-[1rem_minmax(0,1fr)_5.5rem_9.5rem_5.5rem] md:items-center md:gap-x-5";

/** "baby · Highland Park, Pasadena · under 20 min, easy parking" → who, where, what else (`cohortLabel`). */
function labelParts(label: string | null): { who: string; where: string | null; also: string | null } {
  if (!label) return { who: "One digest for everyone", where: null, also: null };
  const [who, where = null, ...rest] = label.split(" · ");
  return { who: who.charAt(0).toUpperCase() + who.slice(1), where, also: rest.length > 0 ? rest.join(" · ") : null };
}

function GroupRow({ group: g, picksKnown, open, onOpen }: { group: DigestGroup; picksKnown: boolean; open: boolean; onOpen: (open: boolean) => void }) {
  const gt = groupTotals(g);
  const status = DIGEST_EDITION_STATUS[g.status];
  const { who, where, also } = labelParts(g.label);
  const panel = `${groupAnchor(g)}-panel`;
  return (
    <div id={groupAnchor(g)} className="scroll-mt-24 border-b border-bark/60 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => onOpen(!open)}
        className={cn(ROW, "w-full py-3 text-left transition-colors hover:bg-paper/70", open && "bg-paper/40")}
      >
        <ChevronRight className={cn("mt-1 h-4 w-4 text-muted transition-transform md:mt-0", open && "rotate-90 text-ink")} aria-hidden="true" />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-semibold text-ink">{who}</span>
            {where && <span className="text-[14px] text-ink-soft">{where}</span>}
            {g.status !== "ready" && <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? sentence(g.status)}</Badge>}
            {g.attempts > 1 && <Badge tone="gold">{`Searched ${g.attempts} times`}</Badge>}
            {g.general && <Badge tone="muted">Market-wide</Badge>}
          </span>
          {also && <span className="mt-0.5 block text-[12.5px] text-muted">{also}</span>}
          <span className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px] tabular-nums text-muted md:hidden">
            <span>{plural(g.families_sent, "family", "families")}</span>
            <span>{g.items.length === 0 ? "nothing found" : sendsKnown(g) ? `${gt.sentItems} of ${g.items.length} sent` : `${g.items.length} found`}</span>
            {picksKnown && gt.remindersSet > 0 && <span>{plural(gt.remindersSet, "reminder")}</span>}
          </span>
        </span>
        <span className="hidden text-right text-[14px] tabular-nums text-ink md:block">
          {g.families_sent}
          <span className="sr-only"> families</span>
        </span>
        <span className="hidden md:block">
          {sendsKnown(g) ? (
            <Coverage sent={gt.sentItems} found={g.items.length} />
          ) : (
            <span className="text-[14px] tabular-nums text-ink">
              {g.items.length}
              <span className="text-muted"> found</span>
            </span>
          )}
        </span>
        <span className={cn("hidden items-center justify-end gap-1.5 text-[14px] tabular-nums md:flex", gt.remindersSet > 0 ? "text-ink" : "text-muted/50")}>
          {picksKnown && gt.remindersSet > 0 && <Bell className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
          {picksKnown ? gt.remindersSet || "—" : "—"}
          <span className="sr-only"> reminders</span>
        </span>
      </button>
      {open && (
        <div id={panel} className="border-t border-bark/60 bg-paper/50 px-4 pb-5 pt-4 md:pl-11">
          {g.items.length === 0 ? (
            <p className="text-[13.5px] text-muted">{/* copy: state */}Nothing found for this group, so nobody got a text from it.</p>
          ) : (
            <div className="space-y-6">
              <Items group={g} picksKnown={picksKnown} />
              <Received group={g} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "3 of 6" with a bar: how much of what the search found went out. */
function Coverage({ sent, found }: { sent: number; found: number }) {
  if (found === 0) return <span className="text-[13px] text-muted">nothing found</span>;
  return (
    <span className="flex items-center gap-2.5">
      <span className="w-11 text-[14px] tabular-nums text-ink">
        {sent}
        <span className="text-muted">/{found}</span>
        <span className="sr-only"> items sent</span>
      </span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-bark-soft" aria-hidden="true">
        <span className="block h-full rounded-full bg-green" style={{ width: `${Math.round((sent / found) * 100)}%` }} />
      </span>
    </span>
  );
}

function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <h3 className="mb-1 flex items-baseline gap-2 text-[13.5px] font-semibold text-ink">
      {title}
      {count !== undefined && <span className="font-normal tabular-nums text-muted">{count}</span>}
    </h3>
  );
}

const KIND_ICON: Record<DigestItemRow["kind"], LucideIcon> = {
  event: Ticket,
  camp: Tent,
  class: GraduationCap,
  opportunity: HandHeart,
};

/** What went to families first; what was found but went to nobody behind a toggle in the same list. */
function Items({ group: g, picksKnown }: { group: DigestGroup; picksKnown: boolean }) {
  const [showUnsent, setShowUnsent] = useState(false);
  const sent = g.items.filter((i) => i.sent_to > 0).sort((a, b) => b.sent_to - a.sent_to || a.position - b.position);
  const unsent = g.items.filter((i) => i.sent_to === 0);
  /* Families were texted, but which items each got was not recorded (a week before 0067): not "reached nobody". */
  if (g.families_sent > 0 && g.variants.length === 0) {
    return (
      <section>
        <SectionHead title="Found" count={g.items.length} />
        <p className="mb-1 text-[13px] text-muted">{/* copy: state */}Which of these each family got is not recorded for this week.</p>
        <ul className="divide-y divide-bark/60">
          {[...g.items].sort((a, b) => a.position - b.position).map((i) => (
            <ItemRow key={i.id} item={i} picksKnown={false} muted />
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section>
      <SectionHead title="Sent" count={sent.length} />
      {sent.length === 0 ? (
        <p className="py-2 text-[13.5px] text-muted">{/* copy: state */}None of what was found reached a family.</p>
      ) : (
        <ul className="divide-y divide-bark/60">
          {sent.map((i) => (
            <ItemRow key={i.id} item={i} picksKnown={picksKnown} />
          ))}
        </ul>
      )}
      {unsent.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showUnsent}
            onClick={() => setShowUnsent((v) => !v)}
            className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showUnsent && "rotate-90")} aria-hidden="true" />
            Not sent to anyone
            <span className="tabular-nums">{unsent.length}</span>
          </button>
          {showUnsent && (
            <ul className="divide-y divide-bark/60 border-t border-bark/60">
              {unsent.map((i) => (
                <ItemRow key={i.id} item={i} picksKnown={picksKnown} muted />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ItemRow({ item: i, picksKnown, muted = false }: { item: DigestItemRow; picksKnown: boolean; muted?: boolean }) {
  const Icon = KIND_ICON[i.kind] ?? Ticket;
  const age = ages(i.age_min, i.age_max);
  const after = picksKnown
    ? outcomes([
        [i.reminders + i.reminded, "reminder set", "reminders set"],
        [i.reminded, "sent"],
        [i.taken_off, "changed their mind"],
        [i.loved, "loved it"],
        [i.ok, "OK"],
        [i.didnt_go, "didn't go"],
      ])
    : "";
  const elsewhere = i.sent_to - i.sent_here;
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:gap-x-4">
      <span
        className={cn("mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg", muted ? "bg-bark-soft text-muted" : "bg-green-wash text-green-deep")}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className={cn("text-[14px] leading-snug", muted ? "font-medium text-ink-soft" : "font-semibold text-ink")}>{i.title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
          {[DIGEST_ITEM_KIND[i.kind] ?? sentence(i.kind), i.when_text, i.place, age].filter(Boolean).join(" · ")}
        </p>
        <a
          href={i.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex items-center gap-0.5 text-[12.5px] font-medium text-green-deep underline-offset-2 hover:underline"
        >
          {host(i.url)}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
        {!muted && after && (
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-soft">
            <Bell className="h-3 w-3 text-muted" aria-hidden="true" />
            {after}
          </p>
        )}
      </div>
      {!muted && (
        <div className="col-start-2 mt-1.5 flex items-baseline gap-2 sm:col-start-3 sm:mt-0 sm:block sm:text-right">
          <p className="text-[14px] font-semibold tabular-nums text-ink">
            {i.sent_to}
            <span className="font-normal text-muted"> {i.sent_to === 1 ? "family" : "families"}</span>
          </p>
          {elsewhere > 0 && (
            <p className="text-[12px] tabular-nums text-muted">
              {i.sent_here > 0 ? `${i.sent_here} here · ` : ""}
              {elsewhere} other {elsewhere === 1 ? "group" : "groups"}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/* ── What families received ───────────────────────────────────────────────── */

/**
 * The sets of items families got, what most got first. A row is one set: its
 * items in their numbers' order — in another row, the ones that differ from
 * the first are tinted and the shared ones muted, and an item another group's
 * search found (for a family's other child) says so. One text open at a time.
 */
function Received({ group: g }: { group: DigestGroup }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [as, setAs] = useState<"card" | "sms">("card");
  if (g.variants.length === 0) {
    return g.families_sent > 0 ? (
      <section>
        <SectionHead title="What families received" />
        <p className="text-[13.5px] text-muted">{/* copy: state */}Texts are not recorded for this week.</p>
      </section>
    ) : null;
  }
  const main = g.variants[0];
  const total = g.variants.reduce((n, v) => n + v.families, 0);
  const mainIds = new Set(main.item_ids);
  /* "Most" only when it is: with every set going to one family each, there is no most. */
  const hasMost = g.variants.length > 1 && main.families > g.variants[1].families;
  const summary =
    g.variants.length === 1
      ? `${total === 1 ? "The one family" : `All ${total} families`} got the same ${plural(main.items.length, "item")}.`
      : hasMost
        ? /* copy: state */ `${main.families} of ${total} families got the same ${plural(main.items.length, "item")}; ${plural(total - main.families, "family", "families")} got a different mix.`
        : g.variants.length === total
          ? /* copy: state */ `Each of the ${total} families got a different mix.`
          : `${total} families, ${g.variants.length} different mixes.`;

  return (
    <section>
      <SectionHead title="What families received" />
      <p className="mb-2 text-[13px] text-muted">{summary}</p>
      <ul className="divide-y divide-bark/60 rounded-lg border border-bark/80 bg-card">
        {g.variants.map((v, k) => {
          const key = v.item_ids.join(",");
          const isOpen = openKey === key;
          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenKey(isOpen ? null : key)}
                className={cn(
                  "grid w-full grid-cols-1 items-start gap-2 px-3.5 py-3 text-left transition-colors hover:bg-paper/60 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4",
                  isOpen && "bg-paper/40",
                )}
              >
                <span className="flex items-center gap-2 text-[13.5px] font-semibold tabular-nums text-ink">
                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform", isOpen && "rotate-90 text-ink")} aria-hidden="true" />
                  {plural(v.families, "family", "families")}
                  {k === 0 && hasMost && <Badge tone="green">Most</Badge>}
                </span>
                <ol className="flex min-w-0 flex-wrap gap-1.5">
                  {v.items.map((it, slot) => {
                    const differs = k > 0 && !mainIds.has(it.id);
                    return (
                      <li
                        key={it.id}
                        className={cn(
                          "inline-flex max-w-full items-baseline gap-1.5 rounded-md px-2 py-1 text-[12.5px] leading-snug",
                          differs ? "bg-green-wash font-semibold text-green-deep" : k > 0 ? "text-muted" : "bg-bark-soft/80 text-ink",
                        )}
                      >
                        <span className="tabular-nums opacity-60">{slot + 1}</span>
                        <span className="min-w-0 break-words">{it.title}</span>
                        {it.from_group && <span className="font-normal opacity-75">· from {it.from_group}</span>}
                      </li>
                    );
                  })}
                </ol>
              </button>
              {isOpen && <TextView variant={v} as={as} onAs={setAs} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TextView({ variant: v, as, onAs }: { variant: DigestVariant; as: "card" | "sms"; onAs: (a: "card" | "sms") => void }) {
  const text = as === "card" ? v.card : v.text;
  return (
    <div className="border-t border-bark/60 bg-paper/40 px-3.5 pb-4 pt-3 sm:pl-[10.5rem]">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedFilter
          track
          label="Show as"
          value={as}
          onChange={onAs}
          options={[
            { id: "card", label: "Card" },
            { id: "sms", label: "Plain text" },
          ]}
        />
        <span className="text-[12.5px] text-muted">First sent {when(v.first_sent_at)}</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {text ? (
          <div>
            <p className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 text-[14px] leading-relaxed text-ink shadow-card ring-1 ring-bark/70">{text}</p>
            {as === "card" && (
              <div className="mt-1.5 flex gap-1.5" aria-hidden>
                {[1, 2, 3, 4].map((n) => (
                  <span key={n} className="rounded-full bg-card px-3 py-0.5 text-[13px] font-medium text-green-deep ring-1 ring-green/40">
                    {n}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-muted">{/* copy: state */}This text cannot be shown: one of its items has since been deleted.</p>
        )}
        <div>
          <h4 className="mb-1.5 text-[12.5px] font-medium text-muted">Sent to</h4>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-[13.5px]">
            {v.people.map((p) => (
              <li key={p.id}>
                <TextLink href={`/admin/contributors/${p.id}`}>{p.name ?? "No name given"}</TextLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
