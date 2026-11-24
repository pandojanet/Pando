"use client";

import { useState } from "react";
import { Sparkles, SquareTerminal } from "lucide-react";
import { Badge, Button, Card, Empty, ErrorNote, Failed, Loading, NotConfigured, PageHead, Stat, StatStrip, TableWrap, Td, Th, whenExact } from "@/components/admin/ui";
import { SegmentedFilter, Toggle } from "@/components/admin/kit";
import { RevealMore } from "@/components/admin/Reveal";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { McpAdminResult, McpCallCounts, McpPeriod } from "@/lib/admin/types";
import { PANDO_TOOLS } from "@/lib/mcp/tool-names";
import { mcpCallReasonLabel } from "@/lib/admin/labels";
import { cn } from "@/lib/cn";

/**
 * Pando MCP (20 Nov; redrawn the same day after GitHub's and Google's connected-apps pages and
 * Stripe's and Vercel's request logs): the one switch in the head, the apps connected — one row per
 * admin and app, however many times Claude registered — with Revoke behind a confirm in place.
 *
 * The calls (24 Nov — the developer: *"хотілось би бачити більш детальну аналітику колів"*), after
 * Vercel's and Stripe's request dashboards: a period (24 hours, 7 or 30 days); its figures against the
 * period before; a timeline of how calls ended, stacked, on Pasadena's clock; per tool (share answered,
 * median and 95th-percentile time, rows); per admin; the slowest; the latest, filtered by tool, admin or
 * outcome. Off, every tool answers that it is switched off; `PANDO_MCP=off` keeps it off whatever the
 * switch says.
 */

type Connection = McpAdminResult["connections"][number];
type Call = McpAdminResult["recent"][number];

const IDLE_DAYS = 14;
/** The busiest tools first; the rest behind "more", so a phone does not scroll past 27 blocks. */
const TOOLS_FIRST = 8;
const PERIODS: ReadonlyArray<{ id: McpPeriod; label: string }> = [
  { id: 1, label: "24 hours" },
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
];

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return whenExact(iso);
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
/** Today's calls by the time alone; older ones with their day. */
const when = (iso: string) =>
  new Date(iso).toDateString() === new Date().toDateString()
    ? time(iso)
    : new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const duration = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** A bucket's start, as the market's wall clock wrote it ("2026-11-24T15:00"), read without moving it. */
function bucketLabel(at: string, hourly: boolean, long = false): string {
  const d = new Date(`${at}:00Z`);
  if (hourly) return d.toLocaleTimeString("en-US", long ? { weekday: "short", hour: "numeric", timeZone: "UTC" } : { hour: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
}

const OUTCOME: Record<string, { word: string; tone: string; bar: string }> = {
  ok: { word: "answered", tone: "text-green-deep", bar: "bg-green" },
  refused: { word: "refused", tone: "text-gold-ink", bar: "bg-gold" },
  error: { word: "failed", tone: "text-alert", bar: "bg-alert" },
  off: { word: "while off", tone: "text-muted", bar: "bg-muted/50" },
};
const ORDER = ["ok", "refused", "error", "off"] as const;
const outcomeOf = (o: string) => OUTCOME[o] ?? { word: o, tone: "text-muted", bar: "bg-muted/50" };
/** Failed first, then refused, then while off; a reason the log did not keep last within its outcome. */
const OUTCOME_RANK: Record<string, number> = { error: 0, refused: 1, off: 2 };

/** How a call ended, and why when it did not answer: "failed · Database didn't answer". */
function Ending({ outcome, reason }: { outcome: string; reason: string | null }) {
  const o = outcomeOf(outcome);
  return (
    <span>
      <span className={cn("font-semibold", o.tone)}>{o.word}</span>
      {outcome !== "ok" && reason && <span className="text-muted">{` · ${mcpCallReasonLabel(reason)}`}</span>}
    </span>
  );
}

/** The key a reason row filters the latest calls by; calls from before reasons were kept share one row. */
const NOT_KEPT = "*|";
const reasonKey = (outcome: string, reason: string | null) => (reason === null ? NOT_KEPT : `${outcome}|${reason}`);
const matchesReason = (key: string, c: { outcome: string; reason: string | null }) => c.outcome !== "ok" && reasonKey(c.outcome, c.reason) === key;

/**
 * The period's calls that did not answer, by reason — failed first, then refused, then while off — each a
 * row with its share of them, picked to filter the latest. Calls logged before reasons were kept are one
 * muted row at the end, with how they ended.
 */
function Reasons({ rows, picked, onPick }: { rows: McpAdminResult["reasons"]; picked: string | null; onPick: (key: string) => void }) {
  const total = rows.reduce((s, r) => s + r.calls, 0);
  const kept = rows.filter((r) => r.reason !== null).sort((a, b) => (OUTCOME_RANK[a.outcome] ?? 9) - (OUTCOME_RANK[b.outcome] ?? 9) || b.calls - a.calls);
  const old = rows.filter((r) => r.reason === null).sort((a, b) => (OUTCOME_RANK[a.outcome] ?? 9) - (OUTCOME_RANK[b.outcome] ?? 9));
  const lines = [
    ...kept.map((r) => ({ key: reasonKey(r.outcome, r.reason), label: mcpCallReasonLabel(r.reason), sub: outcomeOf(r.outcome).word, subTone: outcomeOf(r.outcome).tone, bar: outcomeOf(r.outcome).bar, calls: r.calls, last: r.last_at, muted: false })),
    ...(old.length
      ? [{
          key: NOT_KEPT,
          label: mcpCallReasonLabel(null),
          sub: old.map((r) => `${r.calls} ${outcomeOf(r.outcome).word}`).join(" · "),
          subTone: "text-muted",
          bar: "bg-muted/40",
          calls: old.reduce((s, r) => s + r.calls, 0),
          last: old.map((r) => r.last_at).sort().at(-1) ?? old[0].last_at,
          muted: true,
        }]
      : []),
  ];
  return (
    <ul className="divide-y divide-bark/60">
      {lines.map((l) => {
        const on = picked === l.key;
        return (
          <li key={l.key}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onPick(l.key)}
              className={cn(
                "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-paper/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold sm:grid-cols-[auto_minmax(0,1fr)_9rem_4.5rem_6rem]",
                on && "bg-green-wash",
              )}
            >
              <span className={cn("size-2.5 rounded-full", l.bar)} aria-hidden />
              <span className="min-w-0">
                <span className={cn("text-[14px] font-medium", l.muted ? "text-muted" : "text-ink")}>{l.label}</span>
                <span className={cn("ml-2 text-[12.5px]", l.subTone)}>{l.sub}</span>
              </span>
              <span className="hidden h-1.5 overflow-hidden rounded-full bg-bark-soft sm:block" aria-hidden>
                <span className={cn("block h-full rounded-full", l.bar)} style={{ width: `${Math.max(3, (l.calls / Math.max(1, total)) * 100)}%` }} />
              </span>
              <span className={cn("text-right text-[14px] font-semibold tabular-nums", l.muted ? "text-muted" : "text-ink")}>{l.calls}</span>
              <span className="col-start-2 text-[12.5px] text-muted sm:col-start-auto sm:text-right">{`last ${ago(l.last)}`}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ConnectionRow({ c, busy, onRevoke }: { c: Connection; busy: boolean; onRevoke: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const idle = !c.last_used_at || Date.now() - new Date(c.last_used_at).getTime() > IDLE_DAYS * 86400 * 1000;
  const Icon = c.app === "Claude Code" ? SquareTerminal : Sparkles;
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", idle && "opacity-60")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-moss text-paper" aria-hidden>
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[14.5px] font-semibold text-ink">{c.app}</span>
          {c.client_name && c.client_name !== c.app && <span className="text-[13px] text-muted">{c.client_name}</span>}
        </div>
        <div className="mt-0.5 text-[13px] text-muted">
          {c.admin_user} · {c.sessions === 1 ? "1 session" : `${c.sessions} sessions`} · since {whenExact(c.since)}
        </div>
      </div>
      <div className="text-right text-[13px] text-muted">{c.last_used_at ? `Last call ${ago(c.last_used_at)}` : "Never used"}</div>
      {confirming ? (
        <div className="flex items-center gap-2" role="group" aria-label={`Revoke ${c.app} for ${c.admin_user}`}>
          <Button tone="danger" disabled={busy} onClick={onRevoke}>
            {c.sessions === 1 ? "Revoke" : `Revoke ${c.sessions} sessions`}
          </Button>
          <Button disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button disabled={busy} subject={`${c.app}, ${c.admin_user}`} onClick={() => setConfirming(true)}>
          Revoke
        </Button>
      )}
    </li>
  );
}

function sum(rows: McpCallCounts[]): McpCallCounts {
  return rows.reduce(
    (s, r) => ({ calls: s.calls + r.calls, ok: s.ok + r.ok, refused: s.refused + r.refused, off: s.off + r.off, error: s.error + r.error }),
    { calls: 0, ok: 0, refused: 0, off: 0, error: 0 },
  );
}

/** "12 answered · 1 failed", zeros left out. */
const outcomeLine = (c: McpCallCounts) => ORDER.filter((k) => c[k] > 0).map((k) => `${c[k]} ${OUTCOME[k].word}`).join(" · ") || "no calls";

/** How the period's calls ended, one stacked bar per hour or day; the line above reads the bar under the pointer. */
function Timeline({ buckets, hourly, span }: { buckets: McpAdminResult["timeline"]; hourly: boolean; span: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const most = Math.max(1, ...buckets.map((b) => b.calls));
  const all = sum(buckets);
  const shown = hover === null ? null : buckets[hover];
  const present = ORDER.filter((k) => all[k] > 0);
  const ticks = buckets.length > 0 ? [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])] : [];
  return (
    <div className="px-4 pb-4 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]" aria-live="polite">
        <span className="font-medium text-ink">{shown ? bucketLabel(shown.at, hourly, true) : `Last ${span}`}</span>
        <span className="tabular-nums text-muted">{outcomeLine(shown ?? all)}</span>
      </div>
      <div
        role="img"
        aria-label={`Calls per ${hourly ? "hour" : "day"}, last ${span}: ${outcomeLine(all)}`}
        className="mt-3 flex h-28 items-end gap-[3px]"
        onMouseLeave={() => setHover(null)}
      >
        {buckets.map((b, i) => (
          <div key={b.at} className="flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
            <div
              className={cn("flex w-full flex-col-reverse overflow-hidden rounded-[3px]", b.calls === 0 && "bg-bark/70", hover === i && "outline-2 outline-offset-1 outline-gold")}
              style={{ height: b.calls === 0 ? "2px" : `${Math.max(4, (b.calls / most) * 100)}%` }}
            >
              {ORDER.map((k) => (b[k] > 0 ? <div key={k} className={OUTCOME[k].bar} style={{ height: `${(b[k] / b.calls) * 100}%` }} /> : null))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[12.5px] tabular-nums text-muted" aria-hidden>
        {ticks.map((i) => (
          <span key={i}>{bucketLabel(buckets[i].at, hourly)}</span>
        ))}
      </div>
      {present.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted" aria-hidden>
          {present.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", OUTCOME[k].bar)} />
              {OUTCOME[k].word}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The share answered as a small bar and its percentage; gold under 90%. */
function ShareBar({ part, whole }: { part: number; whole: number }) {
  const p = pct(part, whole);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-bark-soft" aria-hidden>
        <span className={cn("block h-full rounded-full", p !== null && p < 90 ? "bg-gold" : "bg-green")} style={{ width: `${p ?? 0}%` }} />
      </span>
      <span className="tabular-nums">{p === null ? "—" : `${p}%`}</span>
    </span>
  );
}

const pickClass = "rounded text-left hover:text-green-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";
const toolKind = (tool: string) => PANDO_TOOLS[tool as keyof typeof PANDO_TOOLS] ?? null;

export default function McpPage() {
  const [days, setDays] = useState<McpPeriod>(7);
  const { rows, configured, loading, error, demo, setDemo, reload } = useAdminRows("mcp", { days });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<"failures" | "all">("failures");
  const [tool, setTool] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [allTools, setAllTools] = useState(false);

  async function act(action: Parameters<typeof adminAction>[0]) {
    setBusy(true);
    setFailure(null);
    try {
      await adminAction(action);
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  const m = rows;
  const span = (PERIODS.find((p) => p.id === days) ?? PERIODS[1]).label;
  const t = m?.totals;
  const recent: Call[] = (m?.recent ?? []).filter(
    (c) => (view === "all" || c.outcome !== "ok") && (!tool || c.tool === tool) && (!person || c.admin_user === person) && (!why || matchesReason(why, c)),
  );
  const notAnswered = (m?.reasons ?? []).reduce((s, r) => s + r.calls, 0);
  const previous = (m?.history ?? []).slice(1, 4);
  const answered = t ? pct(t.ok, t.calls) : null;
  const pick = (kind: "tool" | "person" | "why", value: string) => {
    if (kind === "tool") setTool(tool === value ? null : value);
    else if (kind === "person") setPerson(person === value ? null : value);
    else setWhy(why === value ? null : value);
    setView(kind === "why" ? "failures" : "all");
    setMore(false);
  };

  return (
    <>
      <PageHead
        title="Pando MCP"
        right={
          m?.configured ? (
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <div className={cn("text-[14px] font-semibold", m.env_off ? "text-alert" : m.enabled ? "text-green-deep" : "text-ink")}>
                  {m.env_off ? "Off on the server" : m.enabled ? "On" : "Off"}
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted">
                  {m.env_off ? "PANDO_MCP=off" : m.switched_by ? `since ${whenExact(m.switched_at)} · ${m.switched_by}` : "never switched on"}
                </div>
              </div>
              <Toggle label="Pando MCP" checked={m.enabled && !m.env_off} busy={busy} disabled={m.env_off} onChange={(on) => void act({ action: "mcp.switch", on })} />
            </div>
          ) : null
        }
      />
      {failure && <ErrorNote>{failure}</ErrorNote>}
      {error && rows && <ErrorNote>{error}</ErrorNote>}
      {loading && !rows ? (
        <Card>
          <Loading />
        </Card>
      ) : error && !rows ? (
        <Card>
          <Failed />
        </Card>
      ) : !configured || !m?.configured || !t ? (
        <Card>{!configured ? <NotConfigured demo={demo} onDemo={setDemo} noSample /> : <Empty title="Pando MCP's tables are not set up yet" />}</Card>
      ) : (
        <div className="space-y-5">
          {previous.length > 0 && (
            <p className="-mt-2 text-[12.5px] text-muted">
              {`Earlier: ${previous.map((h) => `${h.on ? "on" : "off"} ${whenExact(h.at)} · ${h.by}`).join("  ·  ")}`}
            </p>
          )}

          <Card title={`Connected · ${m.connections.length}`}>
            {m.connections.length === 0 ? (
              <Empty title="No one connected" />
            ) : (
              <ul className="divide-y divide-bark/60">
                {m.connections.map((c) => (
                  <ConnectionRow
                    key={`${c.admin_user}|${c.app}|${c.client_name ?? ""}`}
                    c={c}
                    busy={busy}
                    onRevoke={() => void act({ action: "mcp.revoke", client_ids: c.client_ids, admin_user: c.admin_user })}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Calls"
            right={
              <SegmentedFilter
                track
                label="Period"
                value={days}
                onChange={(d) => {
                  setDays(d);
                  setMore(false);
                }}
                options={PERIODS}
              />
            }
          >
            <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
              <StatStrip inset label={`Calls, last ${span}`}>
                <Stat
                  label="Calls"
                  value={t.calls}
                  hint={t.calls === 0 && t.prev_calls === 0 ? null : `${t.prev_calls} in the ${span} before`}
                />
                <Stat label="Answered" value={answered === null ? "—" : `${answered}%`} hint={t.calls ? `${t.ok} of ${t.calls}` : null} tone={answered !== null && answered < 90 ? "warn" : "plain"} />
                <Stat
                  label="Failed"
                  value={t.error}
                  tone={t.error > 0 ? "alert" : "plain"}
                  hint={[t.refused ? `${t.refused} refused` : null, t.off ? `${t.off} while off` : null, `${t.prev_error} before`].filter(Boolean).join(" · ")}
                />
                <Stat label="Median time" value={duration(t.p50_ms)} hint={t.p95_ms === null ? null : `95% within ${duration(t.p95_ms)}`} />
              </StatStrip>
              {t.calls === 0 ? (
                <Empty title={`No calls in the last ${span}`} />
              ) : (
                <>
                  <Timeline buckets={m.timeline} hourly={days === 1} span={span} />
                  <div className="border-t border-bark/70">
                    <TableWrap label="Calls by tool">
                      <thead>
                        <tr>
                          <Th>Tool</Th>
                          <Th className="text-right">Calls</Th>
                          <Th>Answered</Th>
                          <Th className="text-right">Failed</Th>
                          <Th className="text-right">Refused</Th>
                          <Th className="text-right">Median</Th>
                          <Th className="text-right">95%</Th>
                          <Th className="text-right">Rows</Th>
                          <Th className="text-right">Last</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {(allTools ? m.tools : m.tools.slice(0, TOOLS_FIRST)).map((r) => {
                          const kind = toolKind(r.tool);
                          return (
                            <tr key={r.tool} className={cn(tool === r.tool && "bg-green-wash")}>
                              <Td>
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  <button type="button" aria-pressed={tool === r.tool} onClick={() => pick("tool", r.tool)} className={cn(pickClass, "font-mono text-[13px] text-ink")}>
                                    {r.tool}
                                  </button>
                                  {kind === "write" && <Badge tone="gold">proposes</Badge>}
                                  {kind === "decide" && <Badge tone="green">decides</Badge>}
                                </span>
                              </Td>
                              <Td className="text-right tabular-nums">{r.calls}</Td>
                              <Td>
                                <ShareBar part={r.ok} whole={r.calls} />
                              </Td>
                              <Td className={cn("text-right tabular-nums", r.error > 0 ? "font-semibold text-alert" : "text-muted/60")}>{r.error}</Td>
                              <Td className={cn("text-right tabular-nums", r.refused > 0 ? "text-gold-ink" : "text-muted/60")}>{r.refused}</Td>
                              <Td className="text-right tabular-nums">{duration(r.p50_ms)}</Td>
                              <Td className="text-right tabular-nums text-muted">{duration(r.p95_ms)}</Td>
                              <Td className="text-right tabular-nums text-muted">{r.avg_rows ?? "—"}</Td>
                              <Td className="whitespace-nowrap text-right text-muted">{ago(r.last_at)}</Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </TableWrap>
                    {!allTools && <RevealMore n={m.tools.length - TOOLS_FIRST} onClick={() => setAllTools(true)} />}
                  </div>
                </>
              )}
            </div>
          </Card>

          {notAnswered > 0 && (
            <Card title={`Not answered · ${notAnswered}`}>
              <Reasons rows={m.reasons} picked={why} onPick={(key) => pick("why", key)} />
            </Card>
          )}

          {t.calls > 0 && (
            <div className="space-y-5">
              <Card title={`By person · ${m.people.length}`}>
                <TableWrap label="Calls by person">
                  <thead>
                    <tr>
                      <Th>Person</Th>
                      <Th className="text-right">Calls</Th>
                      <Th className="text-right">Failed</Th>
                      <Th className="text-right">Tools</Th>
                      <Th>Most used</Th>
                      <Th className="text-right">Last</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.people.map((p) => (
                      <tr key={p.admin_user} className={cn(person === p.admin_user && "bg-green-wash")}>
                        <Td>
                          <button type="button" aria-pressed={person === p.admin_user} onClick={() => pick("person", p.admin_user)} className={cn(pickClass, "font-medium text-ink")}>
                            {p.admin_user}
                          </button>
                        </Td>
                        <Td className="text-right tabular-nums">{p.calls}</Td>
                        <Td className={cn("text-right tabular-nums", p.error > 0 ? "font-semibold text-alert" : "text-muted/60")}>{p.error}</Td>
                        <Td className="text-right tabular-nums">{p.tools}</Td>
                        <Td><span className="font-mono text-[12.5px] text-ink-soft">{p.top_tool ?? "—"}</span></Td>
                        <Td className="whitespace-nowrap text-right text-muted">{ago(p.last_at)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </Card>

              <Card title="Slowest">
                <ul className="divide-y divide-bark/60">
                  {m.slowest.map((c, i) => (
                    <li key={`${c.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
                      <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-ink">{duration(c.ms)}</span>
                      <span className="font-mono text-ink">{c.tool}</span>
                      {c.outcome !== "ok" && <Ending outcome={c.outcome} reason={c.reason} />}
                      <span className="flex-1 text-right text-muted">{`${c.admin_user} · ${when(c.at)}`}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}

          <Card
            title={["Recent calls", tool, person, why ? mcpCallReasonLabel(why === NOT_KEPT ? null : why.split("|")[1]) : null].filter(Boolean).join(" · ")}
            right={
              <div className="flex flex-wrap items-center gap-2">
                {(tool || person || why) && (
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setTool(null);
                      setPerson(null);
                      setWhy(null);
                    }}
                  >
                    Clear
                  </Button>
                )}
                <SegmentedFilter
                  track
                  label="Which calls"
                  value={view}
                  onChange={(v) => {
                    setView(v);
                    setMore(false);
                  }}
                  options={[
                    { id: "failures", label: "Not answered" },
                    { id: "all", label: "All" },
                  ]}
                />
              </div>
            }
          >
            {recent.length === 0 ? (
              <Empty title={view === "failures" ? "Every recent call was answered" : "No calls"} />
            ) : (
              <>
                <ul className="divide-y divide-bark/60">
                  {recent.slice(0, more ? recent.length : 25).map((c, i) => (
                    <li key={`${c.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
                      <span className="w-[7.5rem] shrink-0 tabular-nums text-muted">{when(c.at)}</span>
                      <span className="min-w-[11rem] font-mono text-ink">{c.tool}</span>
                      <Ending outcome={c.outcome} reason={c.reason} />
                      <span className="flex-1 text-right tabular-nums text-muted">
                        {[c.admin_user, duration(c.ms), c.rows === null ? null : `${c.rows} ${c.rows === 1 ? "row" : "rows"}`].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
                {!more && <RevealMore n={recent.length - 25} onClick={() => setMore(true)} />}
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
