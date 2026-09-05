"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  slugLabel,
  TableWrap,
  Td,
  Th,
  when,
} from "@/components/admin/ui";
import { Hint } from "@/components/admin/kit";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { InviteRow } from "@/lib/admin/types";

/**
 * Invites — **one per group, never per parent.**
 *
 * That boundary is the whole design. A row here is "Field Elementary PTA", shared
 * by everyone in that group; the day a row means one person, cross-device resume,
 * automatic referral attribution and `/seed/[token]` come with it, and that is a
 * decision the client has now made twice (31 Jul, reaffirmed 12 Aug).
 *
 * What this page answers that nothing else could: **which group actually delivered
 * contributors**, not which group was sent a link. `delivered` counts people who
 * arrived on the code *and* gave at least one approved contribution — read the two
 * numbers together, because a group with forty arrivals and four deliveries is
 * telling you something about that group.
 *
 * The code is a soft gate, not a password. It keeps the tool off the open web and
 * records where somebody came from; a retired one still lets a parent in, without
 * attribution, because a link forwarded a week ago must not become a dead end.
 */
export default function InvitesPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<InviteRow[]>("invites");

  /**
   * The **live** parent-group chips, from the same endpoint the questionnaire
   * reads. It has to be the same list, and specifically not the pending queue: the
   * value stored here is what P6 will ask the parent to confirm, so anything that
   * is not already a real option would produce a confirm step for a group no chip
   * can match.
   */
  const [groups, setGroups] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    void fetch("/api/market/options?market_id=pasadena")
      .then((r) => r.json())
      .then((body) => setGroups(body?.options?.parent_groups ?? []))
      .catch(() => setGroups([]));
  }, []);

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");
  const [note, setNote] = useState("");
  /** The create form is folded away until asked for — see below. */
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const all = rows ?? [];
  const live = useMemo(() => all.filter((i) => i.active), [all]);
  const retired = useMemo(() => all.filter((i) => !i.active), [all]);

  /** Suggests a code from the group's name, which is what an admin would type anyway. */
  const suggested = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  async function run(text: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted ? text : `${text} — but nothing was saved.`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const value = (code.trim() || suggested).toLowerCase();
    await run("Invite created", async () =>
      adminAction({
        action: "invite.create",
        code: value,
        label: label.trim(),
        market_id: "pasadena",
        group_option_value: group || null,
        note: note.trim() || null,
      }),
    );
    setCode("");
    setLabel("");
    setGroup("");
    setNote("");
    setCreating(false);
  }

  return (
    <>
      <PageHead
        title="Invites"
        intro="One link per group. A link is never tied to one person."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      {/**
       * Folded away by default (19 Aug). This form has four fields and four
       * hints, and it sat permanently above the table — so the usual visit,
       * which is *reading* how the groups are doing, began by scrolling past a
       * form. Making a link is the rarer job of the two.
       */}
      {!creating ? (
        <Button tone="secondary" onClick={() => setCreating(true)}>
          New invite link
        </Button>
      ) : (
      <Card
        title="New invite"
        right={
          <Button tone="secondary" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        }
      >
        <div className="grid gap-3 px-4 py-3 md:grid-cols-2">
          <Field
            label="Group name"
          >
            <input
              className={inputClass}
              value={label}
              placeholder="Field Elementary PTA"
              onChange={(e) => setLabel(e.target.value.slice(0, 80))}
            />
          </Field>
          <Field label="Code" hint="Goes in the link. Lowercase and hyphenated.">
            <input
              className={inputClass}
              value={code}
              placeholder={suggested || "pta-field"}
              onChange={(e) => setCode(e.target.value.slice(0, 40))}
            />
          </Field>
          <Field
            label="Matches which group in the tap lists?"
            hint="Optional. Records which group somebody came through — it never claims they belong to it."
          >
            <select
              className={inputClass}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">— none —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note" hint="Yours. Where it was posted, who runs the group.">
            <input
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-bark/70 px-4 py-3">
          <Button
            tone="primary"
            disabled={busy || label.trim().length === 0}
            onClick={() => void create()}
          >
            Create invite
          </Button>
          {(code.trim() || suggested) && (
            <span className="font-mono text-[12.5px] text-muted">
              pando.is/join?i={code.trim() || suggested}
            </span>
          )}
        </div>
      </Card>
      )}

      <div className="mt-4">
        <Card title={`Live (${live.length})`}>
          {loading && all.length === 0 ? (
            <Loading />
          ) : !configured && all.length === 0 ? (
            <NotConfigured demo={demo} onDemo={setDemo} />
          ) : live.length === 0 ? (
            <Empty
              title="No invites yet"
              body="Make one above, and the link works straight away."
            />
          ) : (
            <InviteTable rows={live} busy={busy} onAction={run} groups={groups} />
          )}
        </Card>
      </div>

      {retired.length > 0 && (
        <div className="mt-4">
          <Card title={`No longer shared (${retired.length})`}>
            <InviteTable rows={retired} busy={busy} onAction={run} groups={groups} />
            {/* Kept: this is genuinely surprising behaviour, so one line stays.
                The reasoning behind it — a forwarded link must not become a dead
                end — is a decision, and decisions live in CLAUDE.md. */}
            <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
              A stopped link still lets a parent in — it just records no group.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * The invite link, and a copy button that does not eat it.
 *
 * **Two defects, and the first destroyed data on screen.** The cell rendered
 * `copied === row.id ? "copied" : `?i=${row.code}`` — the confirmation
 * *replaced* the code — and `setCopied` was never reset, so the moment an admin
 * copied a link that row stopped showing which link it was, permanently, until
 * a reload. A table cell must not be able to lose its own value; the
 * confirmation sits **beside** the code now and the code never leaves.
 *
 * **Second, a blocked clipboard said nothing.** `void navigator.clipboard?.…`
 * discards both the missing-API case and the rejected promise, so on a browser
 * that refuses it the admin taps and the row confirms a copy that did not
 * happen — worse than a visible failure, because they then paste the previous
 * clipboard into a group chat. That is the `CopyButton` lesson from the parent
 * flow (3 Sep) arriving on the admin side, and the same answer: say so.
 *
 * The timer is cleared on unmount, because a row can be removed by a reload
 * while its confirmation is still up.
 */
function LinkCell({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(`https://pando.is/join?i=${code}`);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {/* `aria-label`, not `title`. The visible text is the code (`?i=sgv-…`),
          which does not say that pressing it copies anything — and a `title`
          conveys that to a mouse and to nobody else. An accessible name is the
          right home for what a control *does*. */}
      <button
        type="button"
        aria-label={`Copy the full invite link for ${code}`}
        onClick={() => void copy()}
        className="font-mono text-[12.5px] text-green-deep underline underline-offset-2"
      >
        ?i={code}
      </button>
      {/* Permanently mounted, so a screen reader hears the change rather than
          the button being re-read under a new name. */}
      <span
        role="status"
        className={
          state === "failed"
            ? "text-[12px] text-alert"
            : "text-[12px] text-muted"
        }
      >
        {state === "copied"
          ? "copied"
          : state === "failed"
            ? "couldn't copy — select it and copy by hand"
            : ""}
      </span>
    </span>
  );
}

function InviteTable({
  rows,
  busy,
  onAction,
  groups,
}: {
  rows: InviteRow[];
  busy: boolean;
  /** The live chip list, so the column shows the group's real name and not its id. */
  groups: Array<{ id: string; label: string }>;
  onAction: (
    text: string,
    fn: () => Promise<{ persisted: boolean }>,
  ) => Promise<void>;
}) {
  return (
    <TableWrap label="Invite links">
      <thead>
        <tr>
          <Th>Group</Th>
          <Th>Link</Th>
          <Th>Matches</Th>
          {/* "Arrived" and "Delivered" — the second of which read as if the
              *link* had been delivered, which is the opposite of what it counts.
              The pair only means anything read together, so both now say what
              they count and the second says what makes a group worth a link. */}
          {/* The denominator estimate 2.2 asks for. Without it "four joined" is
              unreadable: four out of six is a good channel and four out of two
              hundred is a bad one, and the page could not tell them apart. */}
          <Th hint="How many times the link was opened. Not a headcount — it counts opens, so a parent who came back twice counts twice, and link previews count. Read it against the next column rather than on its own.">
            Opened
          </Th>
          <Th hint="People who opened this link and filled in a profile.">
            Joined
          </Th>
          <Th hint="How many of those went on to share something you added to Pando. A group with thirty joins and two of these is telling you something.">
            Gave something
          </Th>
          <Th>Created</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>
              <span className="font-semibold">{row.label}</span>
              {row.note && (
                <span className="mt-0.5 block text-[12.5px] text-muted">
                  {row.note}
                </span>
              )}
            </Td>
            <Td>
              <LinkCell code={row.code} />
            </Td>
            <Td className="text-[13px]">
              {row.group_option_value ? (
                (groups.find((g) => g.id === row.group_option_value)?.label ??
                  slugLabel(row.group_option_value))
              ) : (
                <span className="text-muted">
                  not linked{" "}<Hint>{"Nothing is recorded about which group these contributors came from"}</Hint></span>
              )}
            </Td>
            <Td className="tabular-nums text-muted">{row.opens}</Td>
            <Td className="tabular-nums">
              {row.contributors}
              {/* The conversion, where there is one to state. Opens can lag a
                  join — a link opened before this counter existed, or a parent
                  who arrived by a route that did not record one — so a ratio over
                  100% is possible and is shown rather than clamped: a clamped
                  number would hide the very inconsistency worth noticing. */}
              {row.opens > 0 && (
                <span className="block text-[12px] text-muted">
                  of {row.opens} opens · {Math.round((row.contributors / row.opens) * 100)}%
                </span>
              )}
            </Td>
            <Td className="tabular-nums">
              {row.delivered}
              {/* "out of", not a bare percentage butted against the count: the
                  two numbers ran together as "2100%" with nothing saying which
                  was which. */}
              {row.contributors > 0 && (
                <span className="block text-[12px] text-muted">
                  of {row.contributors} ·{" "}
                  {Math.round((row.delivered / row.contributors) * 100)}%
                </span>
              )}
            </Td>
            <Td className="text-[13px] text-muted">
              {when(row.created_at)}
              {row.created_by && (
                <span className="mt-0.5 block">{row.created_by}</span>
              )}
            </Td>
            <Td>
              {row.active ? (
                <Button
                  tone="secondary"
                  disabled={busy}
                  title="Stops this link being handed out. Anyone already holding it still gets in — it just stops counting towards this group."
                  onClick={() =>
                    void onAction("Stopped sharing", async () =>
                      adminAction({ action: "invite.retire", id: row.id }),
                    )
                  }
                >
                  Stop sharing
                </Button>
              ) : (
                <Button
                  tone="secondary"
                  disabled={busy}
                  onClick={() =>
                    void onAction("Shared again", async () =>
                      adminAction({ action: "invite.restore", id: row.id }),
                    )
                  }
                >
                  Share again
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
