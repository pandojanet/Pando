"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bell, ChevronLeft, ChevronRight, GraduationCap, HandHeart, Tent, Ticket, TriangleAlert, type LucideIcon } from "lucide-react";
import { Calendar, Dialog, SegmentedFilter, Select } from "@/components/admin/kit";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  Empty,
  ErrorNote,
  Failed,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  inputClass,
  Stat,
  StatStrip,
  TextLink,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
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
 * Texts are rebuilt from each send's stored items — bodies are never stored
 * (invariant 7).
 *
 * **Approval (19 Nov).** The job prepares each group's edition on Friday and
 * sends on Saturday only what was approved here. A group waiting for it opens
 * on its items, each of which can be taken out (and put back) before the
 * group is approved; an approval can be taken back while nothing from it has
 * gone out. Every press is an audited action (`digest.*`, `digest_item.*`).
 */

type Which = "real" | "test";

/** One admin action on the page, then a fresh read; its result said at the top. */
type Act = (action: Parameters<typeof adminAction>[0], done: string) => Promise<void>;

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
    awaiting: week.groups.filter(awaitsApproval),
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

/** Prepared, found something, and nobody has approved it: nothing of it goes until somebody does. */
const awaitsApproval = (g: DigestGroup) => g.approval === "awaiting" && g.status === "ready";
/** Approved here and nothing of it sent yet: the approval can still be taken back. */
const approvedUnsent = (g: DigestGroup) => g.approval === "approved" && g.families_sent === 0 && g.items.every((i) => i.sent_to === 0);

/* Waiting for approval first, then failed searches, then the groups that reached the most families. */
function ordered(groups: DigestGroup[]): DigestGroup[] {
  return [...groups].sort(
    (a, b) =>
      Number(awaitsApproval(b)) - Number(awaitsApproval(a)) ||
      Number(b.status === "failed") - Number(a.status === "failed") ||
      b.families_sent - a.families_sent,
  );
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
  const { rows, configured, loading, error, demo, setDemo, reload } = useAdminRows("digests", asked ? { week: asked } : undefined);
  /* A result in green and a refusal in red (review, 19 Nov: a refused take-back read as a success). */
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const act: Act = useCallback(
    async (action, done) => {
      setBusy(true);
      setMessage(null);
      try {
        const result = await adminAction(action);
        setMessage({ text: result.persisted ? done : `${done} — but nothing was saved.`, error: !result.persisted });
        await reload();
      } catch (err) {
        setMessage({ text: err instanceof Error ? err.message : "That didn't go through", error: true });
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

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
      {message && (message.error ? <ErrorNote>{message.text}</ErrorNote> : <ResultNote>{message.text}</ResultNote>)}

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
          <WeekView key={`${week.edition_date}-${week.is_test}`} week={week} picksKnown={picksKnown} act={act} busy={busy} />
        )}
      </div>

      {/* A test tool, below the week it is about (review, 19 Nov: above the week bar, an open Preview pushed
          the week and its groups a phone's length down). */}
      {/* The page's section rhythm (the week's `space-y-6`), not glued to the groups' card (19 Nov). */}
      {tableConfigured && (
        <div className="mt-6">
          <OneNumber
            onSent={async (week) => {
              setWhich("test");
              setDate(week);
              await reload();
            }}
            onPrepared={reload}
          />
        </div>
      )}
    </>
  );
}

/* ── The digest as a phone shows it (19 Nov) ──────────────────────────────── */

/** The `digest_pick` card's buttons: fixed at four in its Twilio template. */
const DIGEST_BUTTONS = 4;

/**
 * Two messages since 19 Nov (`composeDigest`): the list as plain text, so its
 * links open, then the question — on RCS the card with buttons 1-4, on SMS one line.
 */
function TwoMessages({ list, card, sms, as }: { list: string; card: string; sms: string; as: "card" | "sms" }) {
  /* `anywhere`, not only `break-words`: a long URL must shrink the bubble's min-content too (review, 19 Nov). */
  const bubble = "whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2.5 text-[14px] leading-relaxed text-ink ring-1 ring-bark/70";
  return (
    <div className="min-w-0 max-w-[22rem] space-y-2">
      <p className={bubble}>{list}</p>
      {as === "card" ? (
        <div className="rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 ring-1 ring-bark/70">
          <p className="text-[14px] leading-relaxed text-ink">{card}</p>
          <div className="mt-2 flex gap-1.5" aria-hidden>
            {Array.from({ length: DIGEST_BUTTONS }, (_, k) => k + 1).map((n) => (
              <span key={n} className="rounded-full bg-paper px-3 py-0.5 text-[13px] font-medium text-green-deep ring-1 ring-green/40">
                {n}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className={bubble}>{sms}</p>
      )}
    </div>
  );
}

/* ── One number (19 Nov) ──────────────────────────────────────────────────── */

/** How long Prepare's search may take before the page reads again on its own (the agent's deadline is three minutes). */
const PREPARE_RELOAD_MS = 200_000;

/**
 * The digest for one number while the scheduled jobs are paused: Prepare (the
 * agent's search for that family's group, minutes, after the response), then
 * Approve the group under Test, Preview, then Send — to that number only.
 * `/api/admin/digest-one`; every press audited.
 *
 * Review, 19 Nov: folded below the week (a test tool, not the page's subject);
 * its results said under its own buttons, a refusal in red; the Preview closable
 * and called a preview; Send asks first, repeating the number — it goes out at
 * once and is not held by quiet hours (invariant 6's one exception); the phone
 * field 16px on a phone so iOS does not zoom; the page reads again after Prepare.
 */
function OneNumber({ onSent, onPrepared }: { onSent: (week: string) => Promise<void>; onPrepared: () => Promise<void> | void }) {
  const [phone, setPhone] = useState("");
  const [working, setWorking] = useState<"prepare" | "preview" | "send" | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  /* Preview (19 Nov): the exact text Send would send now; nothing written. Cleared when the number changes. */
  const [preview, setPreview] = useState<{ body: string; ask: { card: string; sms: string }; edition_date: string; items: number } | null>(null);
  const [as, setAs] = useState<"card" | "sms">("card");
  useEffect(() => {
    if (note?.text !== PREPARING) return;
    const t = setTimeout(() => void onPrepared(), PREPARE_RELOAD_MS);
    return () => clearTimeout(t);
  }, [note, onPrepared]);
  const run = async (step: "prepare" | "preview" | "send") => {
    setWorking(step);
    setNote(null);
    try {
      const response = await fetch("/api/admin/digest-one", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step, phone }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        edition_date?: string;
        body?: string;
        ask?: { card: string; sms: string };
        items?: string[];
      };
      if (!response.ok) {
        if (step === "preview") setPreview(null);
        setNote({ text: data.error ?? "That didn't go through", error: true });
      } else if (step === "preview") {
        if (data.body && data.ask && data.edition_date) {
          setPreview({ body: data.body, ask: data.ask, edition_date: data.edition_date, items: data.items?.length ?? 0 });
        }
      } else if (step === "prepare") {
        setNote({ text: PREPARING, error: false });
      } else {
        /* copy: state */
        setNote({ text: `Sent: ${plural(data.sent ?? 0, "item")}.`, error: false });
        if (data.edition_date) await onSent(data.edition_date);
      }
    } finally {
      setWorking(null);
    }
  };
  const ready = phone.replace(/\D/g, "").length >= 10;
  return (
    <Disclosure title="Digest for one number">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[14rem] flex-1">
          <span className="sr-only">Phone number</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPreview(null);
              setNote(null);
            }}
            placeholder="+1 626 555 0123"
            className={cn(inputClass, "text-[16px] md:text-[14px]")}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!ready || working !== null} onClick={() => void run("prepare")}>
            {working === "prepare" ? "Preparing…" : "Prepare"}
          </Button>
          <Button disabled={!ready || working !== null} onClick={() => void run("preview")}>
            {working === "preview" ? "Loading…" : "Preview"}
          </Button>
          <Button tone="primary" disabled={!ready || working !== null} onClick={() => setConfirming(true)}>
            {working === "send" ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
      {note && (note.error ? <ErrorNote className="mt-3">{note.text}</ErrorNote> : <ResultNote inline>{note.text}</ResultNote>)}
      {preview && (
        <div className="mt-4 border-t border-bark/60 pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <SegmentedFilter
              track
              label="Show as"
              value={as}
              onChange={setAs}
              options={[
                { id: "card", label: "RCS" },
                { id: "sms", label: "SMS" },
              ]}
            />
            <span className="text-[12.5px] text-muted">{`Preview · ${saturday(preview.edition_date)}`}</span>
            {preview.items < DIGEST_BUTTONS && <Badge tone="gold">{`${preview.items} of ${DIGEST_BUTTONS} buttons`}</Badge>}
            <Button tone="ghost" className="ml-auto" onClick={() => setPreview(null)}>
              Close preview
            </Button>
          </div>
          <TwoMessages list={preview.body} card={preview.ask.card} sms={preview.ask.sms} as={as} />
        </div>
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Send the digest to ${phone.trim()}?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              onClick={() => {
                setConfirming(false);
                void run("send");
              }}
            >
              Send now
            </Button>
          </div>
        }
      >
        {/* copy: kept — a warning before an action: it is a real text, now, at any hour */}
        <p className="text-[14px] text-ink">It goes out now, at any hour, to this number only.</p>
      </Dialog>
    </Disclosure>
  );
}

/* copy: state */
const PREPARING = "Preparing — the group shows under Test when the search ends, in a few minutes.";

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
                compact
                label="Which Saturday"
                className="min-w-0 flex-1 sm:w-[12rem] sm:flex-none"
                value={week.edition_date}
                onChange={onPick}
                options={weeks.map((w) => ({
                  id: w.edition_date,
                  label: saturday(w.edition_date),
                  detail: [
                    /* Zero is left out of a list of outcomes (review, 19 Nov). */
                    w.families > 0 ? plural(w.families, "family", "families") : null,
                    plural(w.groups, "group"),
                    w.awaiting > 0 ? `${w.awaiting} awaiting approval` : null,
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
              /* The number is always families (review, 19 Nov: it was groups awaiting on one week, families on the next);
                 a week waiting for approval or with a failed search is marked. */
              marks={new Map(weeks.map((w) => [w.edition_date, { note: `${w.families} ${w.families === 1 ? "family" : "families"}`, alert: w.failed > 0 || w.awaiting > 0 }]))}
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

function WeekView({ week, picksKnown, act, busy }: { week: DigestWeek; picksKnown: boolean; act: Act; busy: boolean }) {
  const t = weekTotals(week);
  const groups = ordered(week.groups);
  /* One group open at a time is the default reading; a "needs a look" link opens the one it names. */
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0].id] : []));
  const reveal = useCallback((g: DigestGroup) => {
    setOpen((was) => new Set([...was, g.id]));
    requestAnimationFrame(() => document.getElementById(groupAnchor(g))?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const sentOn = week.groups.map((g) => g.sent_at).filter((s): s is string => !!s).sort()[0] ?? null;
  const problems = t.failed.length > 0 || t.nothing.length > 0 || t.awaiting.length > 0;
  /* What the searches found and nobody took out before approval (review, 19 Nov: a taken-out item counted as found). */
  const found = week.groups.reduce((n, g) => n + g.items.filter((i) => !i.removed).length, 0);
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
            <Stat label="Reminders" value={t.remindersSet > 0 ? t.remindersSet : "—"} hint={t.remindersSent > 0 ? `${t.remindersSent} sent` : null} />
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
              {t.awaiting.map((g) => (
                <li key={`a-${g.id}`}>
                  <TextLink onClick={() => reveal(g)}>
                    {groupName(g)}
                  </TextLink>{" "}
                  waits for approval.
                </li>
              ))}
              {t.failed.map((g) => (
                <li key={`f-${g.id}`}>
                  The search failed for{" "}
                  <TextLink onClick={() => reveal(g)}>
                    {groupName(g)}
                  </TextLink>
                  {g.attempts > 1 ? `, after ${g.attempts} tries` : ""}.
                </li>
              ))}
              {t.nothing.map((g) => (
                <li key={`n-${g.id}`}>
                  {plural(g.families_nothing, "family", "families")} in{" "}
                  <TextLink onClick={() => reveal(g)}>
                    {groupName(g)}
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
              act={act}
              busy={busy}
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

/** "Toddler · Altadena": who and where, as the group's row says it (review, 19 Nov: raw lower-case labels leaked into sentences). */
function labelName(label: string | null): string {
  const { who, where } = labelParts(label);
  return where ? `${who} · ${where}` : who;
}
const groupName = (g: DigestGroup) => labelName(g.label);

function GroupRow({
  group: g,
  picksKnown,
  act,
  busy,
  open,
  onOpen,
}: {
  group: DigestGroup;
  picksKnown: boolean;
  act: Act;
  busy: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const gt = groupTotals(g);
  const status = DIGEST_EDITION_STATUS[g.status];
  const { who, where, also } = labelParts(g.label);
  const panel = `${groupAnchor(g)}-panel`;
  /* An item taken out before approval was never going to anyone: not "found" for the counts. */
  const kept = g.items.filter((i) => !i.removed);
  const pending = awaitsApproval(g) || approvedUnsent(g);
  const pendingSay = `${kept.length} ${awaitsApproval(g) ? "to approve" : "approved"}`;
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
            {awaitsApproval(g) && <Badge tone="gold">Awaiting approval</Badge>}
            {approvedUnsent(g) && <Badge tone="green">Approved</Badge>}
            {g.attempts > 1 && <Badge tone="gold">{`Searched ${g.attempts} times`}</Badge>}
            {g.general && <Badge tone="muted">Market-wide</Badge>}
          </span>
          {also && <span className="mt-0.5 block text-[12.5px] text-muted">{also}</span>}
          <span className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px] tabular-nums text-muted md:hidden">
            {pending ? (
              <span>{pendingSay}</span>
            ) : (
              <>
                <span>{plural(g.families_sent, "family", "families")}</span>
                <span>{g.status === "failed" ? "search failed" : kept.length === 0 ? "nothing found" : sendsKnown(g) ? `${gt.sentItems} of ${kept.length} sent` : `${kept.length} found`}</span>
              </>
            )}
            {picksKnown && gt.remindersSet > 0 && <span>{plural(gt.remindersSet, "reminder")}</span>}
          </span>
        </span>
        <span className="hidden text-right text-[14px] tabular-nums text-ink md:block">
          {g.families_sent}
          <span className="sr-only"> {g.families_sent === 1 ? "family" : "families"}</span>
        </span>
        <span className="hidden md:block">
          {pending ? (
            /* Waiting, or approved and not yet sent: what is to go, not "0 of 3 sent" (review, 19 Nov). */
            <span className="text-[14px] tabular-nums text-ink">{pendingSay}</span>
          ) : g.status === "failed" ? (
            <span className="text-[13px] text-muted">search failed</span>
          ) : sendsKnown(g) ? (
            <Coverage sent={gt.sentItems} found={kept.length} />
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
          <span className="sr-only"> {gt.remindersSet === 1 ? "reminder" : "reminders"}</span>
        </span>
      </button>
      {open && (
        <div id={panel} className="border-t border-bark/60 bg-paper/50 px-4 pb-5 pt-4 md:pl-11">
          {g.items.length === 0 ? (
            <p className="text-[13.5px] text-muted">
              {g.status === "failed"
                ? /* copy: state */ `The search failed${g.attempts > 1 ? ` after ${g.attempts} tries` : ""}, so nobody got a text from this group.`
                : /* copy: state */ "Nothing found for this group, so nobody got a text from it."}
            </p>
          ) : pending ? (
            <Review group={g} act={act} busy={busy} />
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
      {/* Who approved it stays on record once it has gone (review, 19 Nov). */}
      {g.approval === "approved" && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <Badge tone="green">Approved</Badge>
          {[g.approved_by, g.approved_at ? when(g.approved_at) : null].filter(Boolean).join(" · ")}
        </p>
      )}
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

/**
 * A group waiting for approval, or approved with nothing of it sent yet: every
 * item it found, each with Remove / Put back while it waits; then Approve, or
 * the approval and a way to take it back.
 */
function Review({ group: g, act, busy }: { group: DigestGroup; act: Act; busy: boolean }) {
  const waiting = awaitsApproval(g);
  const items = [...g.items].sort((a, b) => a.position - b.position);
  const kept = items.filter((i) => !i.removed).length;
  const out = items.length - kept;
  const name = labelParts(g.label).who;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="flex items-baseline gap-2 text-[13.5px] font-semibold text-ink">
          {waiting ? "To approve" : "Approved"}
          <span className="font-normal tabular-nums text-muted">
            {kept}
            {out > 0 ? ` · ${out} taken out` : ""}
          </span>
          {/* 19 Nov: a digest has four buttons; fewer kept leaves one with nothing behind it. */}
          {kept < DIGEST_BUTTONS && <Badge tone="gold">{`${kept} of ${DIGEST_BUTTONS} buttons`}</Badge>}
        </h3>
        {waiting ? (
          <Button
            tone="primary"
            disabled={busy || kept === 0}
            subject={name}
            onClick={() => act({ action: "digest.approve", id: g.id }, "Approved")}
          >
            Approve
          </Button>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[12.5px] text-muted">
              {[g.approved_by, g.approved_at ? when(g.approved_at) : null].filter(Boolean).join(" · ")}
            </span>
            <Button
              tone="ghost"
              disabled={busy}
              subject={name}
              onClick={() => act({ action: "digest.unapprove", id: g.id }, "Approval taken back")}
            >
              Take back approval
            </Button>
          </span>
        )}
      </div>
      <ul className="divide-y divide-bark/60">
        {items.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            picksKnown={false}
            muted={i.removed}
            aside={
              waiting ? (
                <Button
                  tone="ghost"
                  disabled={busy}
                  subject={i.title}
                  onClick={() =>
                    act(
                      { action: i.removed ? "digest_item.restore" : "digest_item.remove", id: i.id },
                      i.removed ? "Put back" : "Taken out",
                    )
                  }
                >
                  {i.removed ? "Put back" : "Remove"}
                </Button>
              ) : null
            }
          />
        ))}
      </ul>
    </section>
  );
}

function ItemRow({
  item: i,
  picksKnown,
  muted = false,
  aside,
}: {
  item: DigestItemRow;
  picksKnown: boolean;
  muted?: boolean;
  /** In place of the sent counts: a control (`Review`), or nothing when null. */
  aside?: React.ReactNode;
}) {
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
        <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-snug", muted ? "font-medium text-ink-soft" : "font-semibold text-ink")}>
          <span className={cn(i.removed && "line-through decoration-muted/60")}>{i.title}</span>
          {i.removed && <Badge tone="muted">Taken out</Badge>}
        </p>
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
      {aside !== undefined ? (
        aside && <div className="col-start-2 mt-1.5 sm:col-start-3 sm:mt-0 sm:self-center">{aside}</div>
      ) : !muted && (
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
      ? /* copy: state */ total === 1
        ? `The one family got ${plural(main.items.length, "item")}.`
        : `All ${total} families got the same ${plural(main.items.length, "item")}.`
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
                <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold tabular-nums text-ink">
                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform", isOpen && "rotate-90 text-ink")} aria-hidden="true" />
                  {plural(v.families, "family", "families")}
                  {k === 0 && hasMost && <Badge tone="green">Most</Badge>}
                  {/* Sent with fewer items than the card has buttons (review, 19 Nov). */}
                  {v.items.length < DIGEST_BUTTONS && <Badge tone="gold">{`${v.items.length} of ${DIGEST_BUTTONS} buttons`}</Badge>}
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
                        {it.from_group && <span className="font-normal opacity-75">· from {labelName(it.from_group)}</span>}
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
  return (
    <div className="border-t border-bark/60 bg-paper/40 px-3.5 pb-4 pt-3 sm:pl-[10.5rem]">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedFilter
          track
          label="Show as"
          value={as}
          onChange={onAs}
          options={[
            { id: "card", label: "RCS" },
            { id: "sms", label: "SMS" },
          ]}
        />
        <span className="text-[12.5px] text-muted">First sent {when(v.first_sent_at)}</span>
      </div>
      {/* One shrinkable column below lg (review, 19 Nov: a long URL widened the track and the page scrolled sideways at 375px). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {v.text ? (
          <TwoMessages list={v.text} card={v.card} sms={v.ask_sms} as={as} />
        ) : (
          <p className="text-[13px] text-muted">{/* copy: state */}This text cannot be shown: one of its items has since been deleted.</p>
        )}
        <div>
          <h4 className="mb-1.5 text-[12.5px] font-medium text-muted">Sent to</h4>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-[13.5px]">
            {/* Families with no name are numbered, so three links are three people (review, 19 Nov). */}
            {v.people.map((p, k) => (
              <li key={p.id}>
                <TextLink href={`/admin/contributors/${p.id}`}>
                  {p.name ?? `Unnamed family ${v.people.slice(0, k + 1).filter((q) => !q.name).length}`}
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
