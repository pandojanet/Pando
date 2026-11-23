"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Minus, Plus, TriangleAlert } from "lucide-react";
import { SegmentedFilter } from "@/components/admin/kit";
import { Badge, Button, Card, Empty, ErrorNote, Failed, Loading, NotConfigured, PageHead, ResultNote, TextLink, inputClass, when } from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { DigestCandidateAdmin, ProposalRowAdmin, RecordFactsAdmin } from "@/lib/admin/types";
import { cn } from "@/lib/cn";
import { diffLines } from "@/lib/admin/line-diff";

/**
 * What Pando's agents proposed through Pando MCP (20 Nov; redrawn the same day after GitHub's pull
 * request review, Google Docs' suggestion mode and Linear's triage): the queue oldest first, grouped by
 * kind, every change shown as "was → becomes" from the record as the agent saw it (0075), a warning
 * when the record changed since, Reject with an optional reason the agent sees, and one press for the
 * low-risk batch — fact checks that confirm a record is current. Apply runs `proposal.approve`.
 * Nothing an agent proposes changes a record before it.
 *
 * 23 Nov (the security review): this page is now the only place a proposal is decided — the chat's
 * approve/reject are gone — and it carries two more kinds: an entry for the sources & partners list,
 * and a change to the Pando plugin itself — a skill, an agent or a connector, new, changed or removed —
 * shown as the lines it removes and adds, exactly as it would be committed, with what it lets the plugin
 * do in plain words above it. *Commit to plugin* commits it (the developer, 23 Nov: the client changes
 * the plugin without QuitCode).
 */

type View = "proposed" | "decided" | "candidates";

const GROUPS: Array<{ kind: ProposalRowAdmin["kind"]; title: string }> = [
  { kind: "record_edit", title: "Edits" },
  { kind: "new_record", title: "New records" },
  { kind: "fact_check", title: "Fact checks" },
  { kind: "event", title: "Digest events" },
  { kind: "source", title: "Sources & partners" },
  { kind: "plugin", title: "Plugin: skills, agents, connectors" },
];

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const VERDICT: Record<string, string> = { confirmed: "Confirmed as current", stale: "No longer current", unreachable: "Couldn't check the page" };

/** One changed field: the old value struck through, the new in green — Google Docs' suggestion, one line. */
function Diff({ label, was, becomes }: { label: string; was: string | null; becomes: string }) {
  const had = was !== null && was !== "";
  if (had && was === becomes)
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
        <span className="w-24 shrink-0 text-muted">{label}</span>
        <span className="text-ink">{becomes}</span>
        <span className="text-muted">· no change</span>
      </div>
    );
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      {had && <span className="text-muted line-through decoration-muted/60">{was}</span>}
      {had && (
        <span className="text-muted" aria-hidden>
          →
        </span>
      )}
      <span className="font-semibold text-green-deep">{becomes}</span>
    </div>
  );
}

/** A list field: what is added and what goes, not two whole lists. */
function ListDiff({ label, was, becomes }: { label: string; was: string[]; becomes: string[] }) {
  const added = becomes.filter((x) => !was.includes(x));
  const gone = was.filter((x) => !becomes.includes(x));
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13.5px]">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      {added.map((x) => (
        <span key={`+${x}`} className="inline-flex items-center gap-0.5 font-semibold text-green-deep">
          <Plus className="size-3" aria-label="added" />
          {x}
        </span>
      ))}
      {gone.map((x) => (
        <span key={`-${x}`} className="inline-flex items-center gap-0.5 text-muted line-through decoration-muted/60">
          <Minus className="size-3" aria-label="removed" />
          {x}
        </span>
      ))}
      {added.length === 0 && gone.length === 0 && <span className="text-muted">{becomes.join(", ") || "none"}</span>}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 break-words text-ink">{children}</span>
    </div>
  );
}

/** What the proposal changes, field by field, against the record as the agent saw it. */
function Changes({ p }: { p: ProposalRowAdmin }) {
  const c = p.change;
  const was: RecordFactsAdmin | null = p.before ?? p.current;
  if (p.kind === "record_edit") {
    if (c.change === "rename") return <Diff label="Name" was={was?.name ?? null} becomes={String(c.name ?? "")} />;
    if (c.change === "retire") return <Diff label="Status" was={was?.status ?? null} becomes="retired" />;
    if (c.change === "answer_ready") return <Diff label="Answers" was={was ? (was.answer_ready ? "ready" : "not ready") : null} becomes={c.to === true ? "ready" : "not ready"} />;
    if (c.change === "facts")
      return (
        <div className="space-y-1">
          {typeof c.venue === "string" && <Diff label="Venue" was={was?.venue ?? null} becomes={c.venue} />}
          {Array.isArray(c.areas) && <ListDiff label="Areas" was={was?.areas ?? []} becomes={c.areas.map(String)} />}
          {Array.isArray(c.age_bands) && <ListDiff label="Ages" was={was?.age_bands ?? []} becomes={c.age_bands.map(String)} />}
          {typeof c.subcategory === "string" && <Diff label="Subcategory" was={was?.subcategory ?? null} becomes={c.subcategory} />}
        </div>
      );
  }
  if (p.kind === "fact_check") {
    const verdict = String(c.verdict ?? "");
    return (
      <div className="space-y-1">
        <Fact label="Check">{VERDICT[verdict] ?? verdict}</Fact>
        {verdict !== "unreachable" && was?.freshness && <Diff label="Freshness" was={was.freshness} becomes={verdict === "confirmed" ? "fresh" : "stale"} />}
      </div>
    );
  }
  if (p.kind === "new_record")
    return (
      <div className="space-y-1">
        <Fact label="Kind">{String(c.kind ?? "")}</Fact>
        {typeof c.venue === "string" && <Fact label="Venue">{c.venue}</Fact>}
        {Array.isArray(c.areas) && c.areas.length > 0 && <Fact label="Areas">{c.areas.join(", ")}</Fact>}
        {Array.isArray(c.age_bands) && c.age_bands.length > 0 && <Fact label="Ages">{c.age_bands.join(", ")}</Fact>}
        {typeof c.subcategory === "string" && <Fact label="Subcategory">{c.subcategory}</Fact>}
      </div>
    );
  if (p.kind === "event")
    return (
      <div className="space-y-1">
        <Fact label="When">{String(c.when_text ?? "")}</Fact>
        {typeof c.place === "string" && <Fact label="Place">{c.place}</Fact>}
        {(typeof c.age_min === "number" || typeof c.age_max === "number") && <Fact label="Ages">{`${c.age_min ?? 0}–${c.age_max ?? 18}`}</Fact>}
        {typeof c.summary === "string" && <Fact label="Summary">{c.summary}</Fact>}
      </div>
    );
  if (p.kind === "source")
    return (
      <div className="space-y-1">
        {typeof c.source_id === "string" && <Fact label="Changes">an entry already on the list</Fact>}
        {typeof c.role === "string" && <Fact label="Role">{c.role}</Fact>}
        {typeof c.kind === "string" && <Fact label="Kind">{c.kind}</Fact>}
        {typeof c.name === "string" && <Fact label="Name">{c.name}</Fact>}
        {typeof c.area === "string" && <Fact label="Area">{c.area}</Fact>}
        {typeof c.status === "string" && <Fact label="Status">{c.status}</Fact>}
        {typeof c.note === "string" && <Fact label="Note">{c.note}</Fact>}
      </div>
    );
  if (p.kind === "plugin") return <PluginChange c={c} />;
  return null;
}

/**
 * A plugin change: what it lets the plugin do, in plain words, then the file as lines removed (struck,
 * red) and added (green) — the whole file for a new one — exactly as *Commit to plugin* would commit it.
 */
function PluginChange({ c }: { c: Record<string, unknown> }) {
  const before = typeof c.before_text === "string" ? c.before_text : null;
  const after = typeof c.after_text === "string" ? c.after_text : null;
  const lines = diffLines(before, after);
  const warnings = Array.isArray(c.warnings) ? c.warnings.map(String) : [];
  return (
    <div className="space-y-2">
      <Fact label="File">
        <span className="font-mono text-[12.5px]">{String(c.path ?? "")}</span>
      </Fact>
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-xl border border-gold-line bg-gold-wash px-3 py-2 text-[13px] text-gold-ink">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-gold-ink" aria-hidden />
          {w}
        </p>
      ))}
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-bark bg-paper py-2 font-mono text-[12.5px] leading-relaxed" role="group" aria-label="The change, line by line">
        {lines.map((l, k) =>
          l.op === "skip" ? (
            <div key={k} className="px-3.5 py-0.5 text-muted">{`… ${l.count} unchanged line${l.count === 1 ? "" : "s"}`}</div>
          ) : (
            <div
              key={k}
              className={cn(
                "whitespace-pre-wrap break-words px-3.5",
                l.op === "add" && "bg-green-wash text-green-deep",
                l.op === "del" && "bg-alert-wash text-alert line-through decoration-alert/40",
                l.op === "same" && "text-ink",
              )}
            >
              <span className="sr-only">{l.op === "add" ? "added: " : l.op === "del" ? "removed: " : ""}</span>
              <span aria-hidden className="mr-2 select-none text-muted">{l.op === "add" ? "+" : l.op === "del" ? "−" : " "}</span>
              {l.text || " "}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

const TARGET_WORD: Record<string, string> = { skill: "skill", agent: "agent", connector: "connector" };

function titleOf(p: ProposalRowAdmin): string {
  if (p.record?.name) return p.record.name;
  if (p.kind === "event") return String(p.change.title ?? "Event");
  if (p.kind === "new_record") return String(p.change.name ?? "New record");
  if (p.kind === "plugin") return String(p.change.name ?? "Plugin");
  if (p.kind === "source") return String(p.change.name ?? "Source");
  return p.current?.name ?? "Record";
}

function kindWord(p: ProposalRowAdmin): string {
  const c = p.change;
  if (p.kind === "record_edit") return c.change === "rename" ? "rename" : c.change === "retire" ? "retire" : c.change === "answer_ready" ? "ready to answer" : "facts";
  if (p.kind === "new_record") return `new ${String(c.kind ?? "record")}`;
  if (p.kind === "fact_check") return "fact check";
  if (p.kind === "plugin") {
    const what = TARGET_WORD[String(c.target)] ?? "plugin change";
    return c.action === "create" ? `new ${what}` : c.action === "delete" ? `remove ${what}` : `change to a ${what}`;
  }
  if (p.kind === "source") return c.source_id ? `change to a ${String(c.role ?? "source")}` : `new ${String(c.role ?? "source")}`;
  return String(c.kind ?? "event");
}

function ProposalRow({ p, busy, onDecide }: { p: ProposalRowAdmin; busy: boolean; onDecide: (action: "proposal.approve" | "proposal.reject", reason?: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const waiting = p.status === "proposed";
  const note = typeof p.change.note === "string" && p.change.note ? p.change.note : null;
  const title = titleOf(p);
  return (
    <li className={cn("px-4 py-3.5", p.changed_since && "bg-gold-wash/40")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-[15.5px] font-semibold text-ink">{title}</span>
            <span className="text-[13px] text-muted">{kindWord(p)}</span>
            {p.changed_since && <Badge tone="gold">Record changed since</Badge>}
            {!waiting && (
              <Badge tone={p.status === "applied" ? "green" : p.status === "rejected" ? "muted" : "red"}>
                {p.status === "applied" ? "Applied" : p.status === "rejected" ? "Rejected" : "Failed"}
              </Badge>
            )}
          </div>
          <div className="mt-2">
            <Changes p={p} />
          </div>
          {p.decision_note && <p className="mt-1.5 text-[13px] text-muted">{`Reason: ${p.decision_note}`}</p>}
          {open && (
            <div className="mt-2 space-y-1">
              {note && <Fact label="Agent's note">{`“${note}”`}</Fact>}
              {p.source_url && (
                <Fact label="Source">
                  <TextLink href={p.source_url} external>
                    {/* An event's link goes into parents' texts: shown whole, so a look-alike is seen. */}
                    {p.kind === "event" ? p.source_url : host(p.source_url)}
                  </TextLink>
                </Fact>
              )}
              {p.decided_by && <Fact label="Decided">{`${p.decided_by}, ${p.decided_via === "chat" ? "in chat" : "here"} · ${when(p.decided_at)}`}</Fact>}
            </div>
          )}
          {(note || p.source_url || p.decided_by) && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="mt-2 inline-flex min-h-7 items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-green-deep"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
              {open ? "Less" : p.source_url ? `Source · ${host(p.source_url)}` : "Details"}
            </button>
          )}
        </div>
        <div className="text-right text-[12.5px] leading-snug text-muted">
          {p.proposed_by}
          <br />
          {when(p.created_at)}
        </div>
      </div>
      {waiting &&
        (rejecting ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className={cn(inputClass, "max-w-sm flex-1")}
              placeholder="Why not? (optional)"
              aria-label={`Reason for rejecting ${title}`}
              value={reason}
              maxLength={300}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onDecide("proposal.reject", reason.trim() || undefined);
                if (e.key === "Escape") setRejecting(false);
              }}
            />
            <Button tone="danger" disabled={busy} subject={title} onClick={() => onDecide("proposal.reject", reason.trim() || undefined)}>
              Reject
            </Button>
            <Button disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button tone="primary" disabled={busy} subject={title} onClick={() => onDecide("proposal.approve")}>
              {p.changed_since ? "Apply anyway" : p.kind === "plugin" ? "Commit to plugin" : "Apply"}
            </Button>
            <Button disabled={busy} subject={title} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        ))}
    </li>
  );
}

function CandidateRow({ c, busy, onTakeOut }: { c: DigestCandidateAdmin; busy: boolean; onTakeOut: () => void }) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-[15.5px] font-semibold text-ink">{c.title}</span>
          <span className="text-[13px] text-muted">{c.kind}</span>
        </div>
        <Fact label="When">{c.when_text}</Fact>
        {c.place && <Fact label="Place">{c.place}</Fact>}
        {c.ages && <Fact label="Ages">{c.ages}</Fact>}
        <Fact label="Source">
          <TextLink href={c.url} external>
            {c.url}
          </TextLink>
        </Fact>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="text-[12.5px] text-muted">{`${c.added_by} · ${when(c.created_at)}`}</span>
        <Button disabled={busy} subject={c.title} onClick={onTakeOut}>
          Take out
        </Button>
      </div>
    </li>
  );
}

export default function ProposalsPage() {
  const [view, setView] = useState<View>("proposed");
  const { rows, configured, loading, error, demo, setDemo, reload } = useAdminRows("proposals", { status: view });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const list = rows?.rows ?? [];
  const candidates = rows?.candidates ?? [];
  const counts = rows?.counts;

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    setFailure(null);
    try {
      setMessage(await work());
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  const decide = (p: ProposalRowAdmin) => (action: "proposal.approve" | "proposal.reject", reason?: string) =>
    void run(async () => {
      const out = await adminAction({ action, id: p.id, ...(reason ? { reason } : {}) });
      if (action === "proposal.reject") return `Rejected · ${titleOf(p)}`;
      if (p.kind === "plugin") return `Committed to the plugin · ${titleOf(p)}${typeof out.detail?.version === "string" ? ` · version ${out.detail.version}` : ""}`;
      const full = Number(out.detail?.editions_full ?? 0);
      return full > 0
        ? /* copy: kept — 23 Nov: the event could not join a prepared digest that is already full */ `Applied · ${titleOf(p)} · ${full} prepared digest${full === 1 ? " is" : "s are"} full, so it waits for next week there`
        : `Applied · ${titleOf(p)}`;
    });

  const takeOut = (c: DigestCandidateAdmin) =>
    void run(async () => {
      const out = await adminAction({ action: "digest_candidate.remove", id: c.id });
      const still = Number(out.detail?.still_in_approved ?? 0);
      return still > 0 ? /* copy: kept — the result: an approved digest still sends it */ `Taken out · still in ${still} approved digest${still === 1 ? "" : "s"}` : `Taken out · ${c.title}`;
    });

  const confirmedChecks = list.filter((p) => p.status === "proposed" && p.kind === "fact_check" && p.change.verdict === "confirmed" && !p.changed_since);
  const applyConfirmed = () =>
    void run(async () => {
      let done = 0;
      for (const p of confirmedChecks) {
        await adminAction({ action: "proposal.approve", id: p.id });
        done++;
      }
      setBulk(false);
      return `Applied ${done} fact check${done === 1 ? "" : "s"}`;
    });

  /* A tab's rows are the tab's: while another tab's answer is still on screen, it is loading. */
  const stale = rows ? (view === "candidates") !== (rows.candidates !== undefined) : true;

  return (
    <>
      <PageHead
        title="Proposals"
        right={
          <SegmentedFilter
            track
            label="Which proposals"
            value={view}
            onChange={setView}
            options={[
              { id: "proposed", label: counts ? `Waiting ${counts.waiting}` : "Waiting" },
              { id: "decided", label: "Decided" },
              { id: "candidates", label: counts ? `Digest events ${counts.candidates}` : "Digest events" },
            ]}
          />
        }
      />
      {error && rows && <ErrorNote>{error}</ErrorNote>}
      {message && <ResultNote>{message}</ResultNote>}
      {failure && <ErrorNote>{failure}</ErrorNote>}
      {loading && stale ? (
        <Card>
          <Loading />
        </Card>
      ) : error && !rows ? (
        <Card>
          <Failed />
        </Card>
      ) : !configured || rows?.configured === false ? (
        <Card>{!configured ? <NotConfigured demo={demo} onDemo={setDemo} noSample /> : <Empty title="Pando MCP's tables are not set up yet" />}</Card>
      ) : view === "candidates" ? (
        <Card>
          {candidates.length === 0 ? (
            <Empty title="No events ahead" />
          ) : (
            <ul className="divide-y divide-bark/60">
              {candidates.map((c) => (
                <CandidateRow key={c.id} c={c} busy={busy} onTakeOut={() => takeOut(c)} />
              ))}
            </ul>
          )}
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <Empty title={view === "proposed" ? "Nothing waiting" : "Nothing decided yet"} />
        </Card>
      ) : view === "decided" ? (
        <Card>
          <ul className="divide-y divide-bark/60">
            {list.map((p) => (
              <ProposalRow key={p.id} p={p} busy={busy} onDecide={decide(p)} />
            ))}
          </ul>
        </Card>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const items = list.filter((p) => p.kind === g.kind);
            if (items.length === 0) return null;
            const batch = g.kind === "fact_check" && confirmedChecks.length > 1;
            return (
              <Card
                key={g.kind}
                title={`${g.title} · ${items.length}`}
                right={
                  batch ? (
                    bulk ? (
                      <div className="flex items-center gap-2">
                        <Button tone="primary" disabled={busy} onClick={applyConfirmed}>
                          {`Apply ${confirmedChecks.length} confirmed`}
                        </Button>
                        <Button disabled={busy} onClick={() => setBulk(false)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button tone="ghost" disabled={busy} onClick={() => setBulk(true)}>
                        {`Apply all confirmed (${confirmedChecks.length})`}
                      </Button>
                    )
                  ) : undefined
                }
              >
                <ul className="divide-y divide-bark/60">
                  {items.map((p) => (
                    <ProposalRow key={p.id} p={p} busy={busy} onDecide={decide(p)} />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
