"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  PageHead,
  ResultNote,
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
import { CATEGORY_LABEL } from "@/lib/admin/labels";

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
        result.persisted ? label : `${label} — but nothing was saved.`,
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
        title="Names & places"
        intro="Things parents typed because they weren't on the list. Add the real ones so the next parent can tap them."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      <Card title={`Waiting (${pending.length})`}>
        {loading && pending.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        ) : !configured && pending.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : pending.length === 0 ? (
          <Empty
            title="Nothing waiting"
            body="New ones appear as parents type them."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>What they typed</Th>
                <Th>Category</Th>
                <Th className="text-right" title="How many parents typed this. More than one is the strongest reason to add it.">
                  Parents who typed it
                </Th>
                <Th>First from</Th>
                <Th>When</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id}>
                  <Td>
                    {/* The badge here said "asked for 3×" and the column three
                        cells along said "3" — the same number twice on one row.
                        The badge is the half that goes: a column is scannable
                        down the table, and the badge only repeated it. */}
                    <span className="font-semibold">{row.submitted_value}</span>
                  </Td>
                  <Td>{CATEGORY_LABEL[row.category] ?? slugLabel(row.category)}</Td>
                  <Td className="text-right">
                    {row.occurrences > 1 ? (
                      <span
                        className="font-semibold text-green-deep"
                        title="More than one parent typed this, which is the strongest reason to add it."
                      >
                        {row.occurrences}
                      </span>
                    ) : (
                      row.occurrences
                    )}
                  </Td>
                  <Td className="text-[13px]">{row.submitted_by?.name ?? "—"}</Td>
                  <Td className="text-muted">{when(row.created_at)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        tone="primary"
                        disabled={busy}
                        onClick={() =>
                          void run("Added — parents can tap it now.", async () =>
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
                        Add to the list
                      </Button>
                      <Button
                        tone="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run("Set aside.", async () =>
                            adminAction({ action: "option.reject", id: row.id }),
                          )
                        }
                      >
                        Ignore this one
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
        Adding one connects everyone who typed it, straight away.
      </p>
    </>
  );
}
