"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  NotConfigured,
  PageHead,
  SampleBanner,
  TableWrap,
  Td,
  Th,
  inputClass,
  slugLabel,
  when,
} from "@/components/admin/ui";
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
        result.persisted ? `${text} — done.` : `${text} — not stored (no database).`,
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
  }

  return (
    <>
      <PageHead
        title="Invites"
        intro="One link per group, so you can see which group actually brought contributors — not just which group was sent a link. A code identifies a group and a market, never a person."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && (
        <div className="mb-4 rounded-xl border border-green/25 bg-green-wash px-4 py-2.5 text-[13.5px] font-medium text-green-deep">
          {message}
        </div>
      )}

      <Card title="New invite">
        <div className="grid gap-3 px-4 py-3 md:grid-cols-2">
          <Field
            label="Group name"
            hint="What the parent reads back: “You joined through …”"
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
            hint="Optional. When set, the profile asks the parent to confirm that group instead of picking it from a list — and only their yes writes the match."
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

      <div className="mt-4">
        <Card title={`Live (${live.length})`}>
          {loading && all.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted">
              Loading…
            </div>
          ) : !configured && all.length === 0 ? (
            <NotConfigured demo={demo} onDemo={setDemo} />
          ) : live.length === 0 ? (
            <Empty
              title="No invites yet"
              body="Until there is one, the built-in codes from SEED_INVITE_CODES still work."
            />
          ) : (
            <InviteTable rows={live} busy={busy} onAction={run} />
          )}
        </Card>
      </div>

      {retired.length > 0 && (
        <div className="mt-4">
          <Card title={`No longer shared (${retired.length})`}>
            <InviteTable rows={retired} busy={busy} onAction={run} />
            <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
              A stopped code still lets a parent in — it just records no group. The
              link was already forwarded; making it a dead end punishes the wrong
              person.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}

function InviteTable({
  rows,
  busy,
  onAction,
}: {
  rows: InviteRow[];
  busy: boolean;
  onAction: (
    text: string,
    fn: () => Promise<{ persisted: boolean }>,
  ) => Promise<void>;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Group</Th>
          <Th>Link</Th>
          <Th>Matches</Th>
          <Th>Arrived</Th>
          <Th>Delivered</Th>
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
              <button
                type="button"
                title="Copy the link"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    `https://pando.is/join?i=${row.code}`,
                  );
                  setCopied(row.id);
                }}
                className="font-mono text-[12.5px] text-green-deep underline underline-offset-2"
              >
                {copied === row.id ? "copied" : `?i=${row.code}`}
              </button>
            </Td>
            <Td className="text-[13px]">
              {row.group_option_value ? (
                slugLabel(row.group_option_value)
              ) : (
                <span
                  className="text-muted"
                  title="The profile will ask which group, instead of confirming this one"
                >
                  not linked
                </span>
              )}
            </Td>
            <Td className="tabular-nums">{row.contributors}</Td>
            <Td className="tabular-nums">
              {row.delivered}
              {row.contributors > 0 && (
                <span className="ml-1.5 text-[12px] text-muted">
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
