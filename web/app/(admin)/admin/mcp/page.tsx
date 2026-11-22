"use client";

import { useState } from "react";
import { Sparkles, SquareTerminal } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Failed, Loading, NotConfigured, PageHead, whenExact } from "@/components/admin/ui";
import { SegmentedFilter, Toggle } from "@/components/admin/kit";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { McpAdminResult } from "@/lib/admin/types";
import { cn } from "@/lib/cn";

/**
 * Pando MCP (20 Nov; redrawn the same day after GitHub's and Google's connected-apps pages and
 * Stripe's and Vercel's request logs): the one switch in the head, the apps connected — one row per
 * admin and app, however many times Claude registered — with Revoke behind a confirm in place, the
 * day's calls per tool, and the last calls with failures first. Off, every tool answers that it is
 * switched off; the server's `PANDO_MCP=off` keeps it off whatever the switch says.
 */

type Connection = McpAdminResult["connections"][number];
type Call = McpAdminResult["recent"][number];

const IDLE_DAYS = 14;

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return whenExact(iso);
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

const OUTCOME: Record<string, { word: string; tone: string }> = {
  ok: { word: "answered", tone: "text-green-deep" },
  refused: { word: "refused", tone: "text-gold-ink" },
  off: { word: "while off", tone: "text-muted" },
  error: { word: "failed", tone: "text-alert" },
};

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

export default function McpPage() {
  const { rows, configured, loading, error, demo, setDemo, reload } = useAdminRows("mcp");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<"failures" | "all">("failures");
  const [tool, setTool] = useState<string | null>(null);

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
  const recent: Call[] = (m?.recent ?? []).filter((c) => (view === "all" || c.outcome !== "ok") && (!tool || c.tool === tool));
  const previous = (m?.history ?? []).slice(1, 4);

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
      ) : !configured || !m?.configured ? (
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

          <Card title="Calls · last 24 hours">
            {m.calls.length === 0 ? (
              <Empty title="No calls" />
            ) : (
              <ul className="divide-y divide-bark/60">
                {m.calls.map((c) => {
                  const rest = [
                    c.refused ? { n: c.refused, ...OUTCOME.refused } : null,
                    c.error ? { n: c.error, ...OUTCOME.error } : null,
                    c.off ? { n: c.off, ...OUTCOME.off } : null,
                  ].filter((x): x is { n: number; word: string; tone: string } => x !== null);
                  const on = tool === c.tool;
                  return (
                    <li key={c.tool}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setTool(on ? null : c.tool);
                          if (!on) setView("all");
                        }}
                        className={cn("flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-paper", on && "bg-green-wash")}
                      >
                        <span className="min-w-[11rem] font-mono text-[13px] text-ink">{c.tool}</span>
                        <span className="flex-1 text-[13px]">
                          <span className="text-ink">{`${c.ok} answered`}</span>
                          {rest.map((r) => (
                            <span key={r.word} className={r.tone}>{` · ${r.n} ${r.word}`}</span>
                          ))}
                        </span>
                        <span className="text-[12.5px] text-muted">{`last ${time(c.last_at)}`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card
            title={tool ? `Recent calls · ${tool}` : "Recent calls"}
            right={
              <div className="flex items-center gap-2">
                {tool && (
                  <Button tone="ghost" onClick={() => setTool(null)}>
                    All tools
                  </Button>
                )}
                <SegmentedFilter
                  track
                  label="Which calls"
                  value={view}
                  onChange={setView}
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
              <ul className="divide-y divide-bark/60">
                {recent.slice(0, 25).map((c, i) => {
                  const o = OUTCOME[c.outcome] ?? { word: c.outcome, tone: "text-muted" };
                  return (
                    <li key={`${c.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
                      <span className="w-[4.5rem] shrink-0 tabular-nums text-muted">{time(c.at)}</span>
                      <span className="min-w-[11rem] font-mono text-ink">{c.tool}</span>
                      <span className={cn("font-semibold", o.tone)}>{o.word}</span>
                      <span className="flex-1 text-right text-muted">{`${c.admin_user} · ${c.ms} ms`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
