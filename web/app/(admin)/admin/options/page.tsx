"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  TableWrap,
  Td,
  slugify,
  Th,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { PendingOptionRow } from "@/lib/admin/types";

/**
 * Estimate 2.6 — the "other" queue.
 *
 * Why this page matters more than it looks: matching joins on exact canonical values,
 * so anything a parent typed is **not matchable** until it's promoted here. Every row
 * left sitting in this queue is a parent whose school or class contributes nothing to
 * their matching.
 *
 * Retiring an option is a soft delete — profiles already reference it.
 */
export default function PendingOptionsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<PendingOptionRow[]>("options", { status: "pending" });

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pending = (rows ?? []).filter((r) => r.status === "pending");

  async function run(label: string, fn: () => Promise<{ persisted: boolean }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(
        result.persisted ? `${label} — done.` : `${label} — not stored (no admin_write hook).`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Tap lists"
        intro="Free-text answers waiting to become official options. Until one is promoted it can't be matched on — so a long queue here quietly weakens matching."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && (
        <div className="mb-4 rounded-xl border border-green/25 bg-green-wash px-4 py-2.5 text-[13.5px] font-medium text-green-deep">
          {message}
        </div>
      )}

      <Card title={`Waiting (${pending.length})`}>
        {loading && pending.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        ) : !configured && pending.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : pending.length === 0 ? (
          <Empty
            title="Nothing waiting"
            body="Every 'other' answer has been dealt with. New ones appear as parents type them."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>What they typed</Th>
                <Th>Category</Th>
                <Th className="text-right">Times</Th>
                <Th>First from</Th>
                <Th>When</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <span className="font-semibold">{row.submitted_value}</span>
                    {row.occurrences > 1 && (
                      <span className="ml-2">
                        <Badge tone="green" title="More than one parent typed this">
                          asked for {row.occurrences}×
                        </Badge>
                      </span>
                    )}
                  </Td>
                  <Td>{slugLabel(row.category)}</Td>
                  <Td className="text-right">{row.occurrences}</Td>
                  <Td className="text-[13px]">{row.submitted_by?.name ?? "—"}</Td>
                  <Td className="text-muted">{when(row.created_at)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        tone="primary"
                        disabled={busy}
                        onClick={() =>
                          void run("Promoted", async () =>
                            adminAction({
                              action: "option.promote",
                              id: row.id,
                              /* The slug is what matching keys on, so it is created
                                 here rather than guessed at by a workflow. */
                              option_value: slugify(row.submitted_value),
                              label: row.submitted_value,
                            }),
                          )
                        }
                      >
                        Promote
                      </Button>
                      <Button
                        tone="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run("Rejected", async () =>
                            adminAction({ action: "option.reject", id: row.id }),
                          )
                        }
                      >
                        Not a real option
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
        Promoting adds the value to <code>market_options</code> for this market, so it
        appears as a chip for the next parent and becomes matchable. Retiring an
        existing option sets <code>active = false</code> rather than deleting it —
        profiles already point at it.
      </p>
    </>
  );
}
