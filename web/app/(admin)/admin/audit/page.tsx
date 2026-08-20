"use client";

import {
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  TableWrap,
  Td,
  Th,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import {
  AUDIT_ACTION,
  AUDIT_FIELD,
  AUDIT_RESOURCE,
  CONSENT_STATE,
  DEMAND_SENSITIVITY,
  DEMAND_STATUS,
  RECOMMENDATION,
  REVIEW_STATUS,
  sentence,
} from "@/lib/admin/labels";
import type { AuditRow } from "@/lib/admin/types";

/**
 * Estimate 2.8 — the audit log, read side.
 *
 * The rows are written inside the same transaction as every action,
 * not by this page. It exists so the trail is *visible*: consent decisions, trust
 * changes, promotions and profile edits are exactly the actions that need a name and
 * a timestamp against them, and a log nobody can read isn't accountability.
 */
export default function AuditPage() {
  const { rows, configured, sample, demo, setDemo, loading, error } =
    useAdminRows<AuditRow[]>("audit", { limit: 200 });

  const entries = rows ?? [];

  return (
    <>
      <PageHead
        title="Audit log"
        intro="Who did what, and when. Written by itself — nobody can turn it off."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      <Card>
        {loading && entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        ) : !configured && entries.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : entries.length === 0 ? (
          <Empty
            title="Nothing recorded yet"
            body="Actions appear here as soon as an admin makes one."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What they did</Th>
                <Th>To what</Th>
                <Th>Change</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={row.id}>
                  <Td className="whitespace-nowrap text-[13px] text-muted">
                    {new Date(row.at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Td>
                  <Td className="font-semibold">{row.user}</Td>
                  <Td className="text-[13.5px]">
                    {/* Was `<Badge>{row.action}</Badge>`, i.e.
                        `nomination.release_hold` in a pill. This is the one page
                        whose whole job is to be readable months later, so it is
                        the worst place to print an identifier. Not a badge
                        either: a sentence in a pill reads as a status. */}
                    {AUDIT_ACTION[row.action] ?? sentence(row.action)}
                  </Td>
                  <Td className="text-[13px]">
                    {AUDIT_RESOURCE[row.resource] ?? sentence(row.resource)}
                    {row.resource_id && (
                      <span className="mt-0.5 block font-mono text-[12px] text-muted">
                        {row.resource_id}
                      </span>
                    )}
                  </Td>
                  <Td className="text-[13px]">
                    <Diff before={row.before} after={row.after} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function Diff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ]
    /* `id` is the row's own identifier, already printed in the column to the
       left — so every created record showed the same uuid twice, side by side,
       and the eye had to check whether they differed. They never do. */
    .filter((key) => key !== "id");
  if (keys.length === 0) return <span className="text-muted">—</span>;

  return (
    <ul className="space-y-0.5">
      {keys.map((key) => (
        <li key={key}>
          <span className="text-muted">
            {AUDIT_FIELD[key] ?? sentence(key)}:{" "}
          </span>
          <span className="line-through decoration-alert/40">
            {format(before?.[key])}
          </span>
          <span className="mx-1 text-muted">→</span>
          <span className="font-medium">{format(after?.[key])}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One stored value, readable.
 *
 * The three cases that mattered: `true`/`false` — which nobody says out loud —
 * an enum this app already has words for, and a JSON blob that used to be
 * printed as `{"a":1}`. The enum lookup deliberately runs through the same maps
 * every other page uses, so a status reads the same here as it does where it was
 * changed; two names for one value is worse than either.
 */
function format(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    /* Objects here are small (a consent evidence record, a set of flags). Keys
       and values, not braces and quotes. */
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${sentence(k)}: ${format(v)}`)
      .join(", ");
  }
  const s = String(value);
  return (
    REVIEW_STATUS[s]?.label ??
    CONSENT_STATE[s]?.label ??
    DEMAND_STATUS[s]?.label ??
    DEMAND_SENSITIVITY[s]?.label ??
    RECOMMENDATION[s]?.label ??
    s
  );
}
