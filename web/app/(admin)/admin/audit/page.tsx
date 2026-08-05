"use client";

import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  TableWrap,
  Td,
  Th,
  slugLabel,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import type { AuditRow } from "@/lib/admin/types";

/**
 * Estimate 2.8 — the audit log, read side.
 *
 * The rows are written by the admin_write workflow as the last step of every action,
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
        intro="Who changed what, and when. Written automatically for every sensitive action — caregiver consent, activity approval, option promotion, profile edits."
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
                <Th>Action</Th>
                <Th>Record</Th>
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
                  <Td>
                    <Badge tone="neutral">{row.action}</Badge>
                  </Td>
                  <Td className="text-[13px]">
                    {slugLabel(row.resource)}
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
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (keys.length === 0) return <span className="text-muted">—</span>;

  return (
    <ul className="space-y-0.5">
      {keys.map((key) => (
        <li key={key}>
          <span className="text-muted">{key}: </span>
          <span className="line-through decoration-[#8a2f2f]/40">
            {format(before?.[key])}
          </span>
          <span className="mx-1 text-muted">→</span>
          <span className="font-medium">{format(after?.[key])}</span>
        </li>
      ))}
    </ul>
  );
}

function format(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
