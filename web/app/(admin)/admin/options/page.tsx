"use client";

import { Fragment, useState } from "react";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  slugify,
  slugLabel,
  TableWrap,
  Td,
  TextLink,
  Th,
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import type { PendingOptionRow } from "@/lib/admin/types";
import { CATEGORY_LABEL, REVIEW_STATUS, sentence } from "@/lib/admin/labels";

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

  /* The name being decided on, not the whole list. */
  const [busy, setBusy] = useState<string | null>(null);
  /* The name whose parents and recommendations are open (5 Oct). */
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pending = (rows ?? []).filter((r) => r.status === "pending");

  async function run(
    rowId: string,
    label: string,
    fn: () => Promise<{ persisted: boolean }>,
  ) {
    setBusy(rowId);
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
      setBusy(null);
    }
  }

  /* Every queue reveals the same way: thirty rows, then a button saying how
     many are left. Inert until the list is long enough to need it. */
  const { shown, hidden, revealAll } = useReveal(pending);

  return (
    <>
      <PageHead title="Names & places" />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}

      <Card title={`Waiting (${pending.length})`}>
        {loading && pending.length === 0 ? (
          <Loading />
        ) : error && pending.length === 0 ? (
          <Failed />
        ) : !configured && pending.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : pending.length === 0 ? (
          <Empty
            title="Nothing waiting"
          />
        ) : (
          <TableWrap label="Answers parents typed, waiting to be promoted">
            <thead>
              <tr>
                <Th>What they typed</Th>
                <Th>Category</Th>
                <Th className="text-right">
                  Parents who typed it
                </Th>
                <Th>Recommendations</Th>
                <Th>First from</Th>
                <Th>When</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <Fragment key={row.id}>
                <tr>
                  <Td>
                    {/* The badge here said "asked for 3×" and the column three
                        cells along said "3" — the same number twice on one row.
                        The badge is the half that goes: a column is scannable
                        down the table, and the badge only repeated it. */}
                    <span className="font-semibold">{row.submitted_value}</span>
                  </Td>
                  <Td>{CATEGORY_LABEL[row.category] ?? slugLabel(row.category)}</Td>
                  <Td className="text-right">
                    {/* The number opens onto who it is (5 Oct). It is counted
                        from the profiles, falling back to the stored counter
                        for a value no saved profile carries any more. */}
                    <button
                      type="button"
                      aria-expanded={openId === row.id}
                      aria-label={`Show who typed ${row.submitted_value}`}
                      onClick={() => setOpenId(openId === row.id ? null : row.id)}
                      className="font-semibold text-green-deep underline underline-offset-2 hover:text-green"
                    >
                      {row.parent_count > 0 ? row.parent_count : row.occurrences}
                    </button>
                  </Td>
                  <Td className="text-[13px]">
                    {row.recommendations.length === 0 ? (
                      <span className="text-muted">None — only mentioned</span>
                    ) : (
                      row.recommendations
                        .map((rec) => `${rec.contributions} on ${rec.name}`)
                        .join(", ")
                    )}
                  </Td>
                  <Td className="text-[13px]">{row.submitted_by?.name ?? "—"}</Td>
                  <Td className="text-muted">{when(row.created_at)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        tone="primary"
                        subject={row.submitted_value}
                        disabled={busy === row.id}
                        onClick={() =>
                          void run(row.id, "Added — parents can tap it now.", async () =>
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
                        subject={row.submitted_value}
                        disabled={busy === row.id}
                        onClick={() =>
                          void run(row.id, "Set aside.", async () =>
                            adminAction({ action: "option.reject", id: row.id }),
                          )
                        }
                      >
                        Ignore this one
                      </Button>
                    </div>
                  </Td>
                </tr>
                {openId === row.id && (
                  <tr>
                    <td colSpan={7} className="bg-paper px-4 py-3">
                      <div className="grid gap-4 text-[13px] sm:grid-cols-2">
                        <div>
                          <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                            Who typed it
                          </p>
                          {row.parents.length === 0 ? (
                            <p className="text-muted">
                              No saved profile carries it any more.
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {row.parents.map((pp) => (
                                <li key={pp.id}>
                                  <TextLink href={`/admin/contributors/${pp.id}`}>
                                    {pp.name ?? "Unnamed"}
                                  </TextLink>
                                  <span className="text-muted">
                                    {pp.neighborhood ? ` · ${sentence(pp.neighborhood)}` : ""}
                                    {pp.at ? ` · ${when(pp.at)}` : ""}
                                  </span>
                                </li>
                              ))}
                              {row.parent_count > row.parents.length && (
                                <li className="text-muted">
                                  and {row.parent_count - row.parents.length} more
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                        <div>
                          <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
                            Recommendations under this name
                          </p>
                          {row.recommendations.length === 0 ? (
                            <p className="text-muted">
                              Nobody has recommended it yet — a parent only mentioned it,
                              which is not a contribution.
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {row.recommendations.map((rec) => (
                                <li key={rec.id}>
                                  <span className="font-medium">{rec.name}</span>
                                  <span className="text-muted">
                                    {` · ${slugLabel(rec.kind)} · ${REVIEW_STATUS[rec.status]?.label ?? sentence(rec.status)} · ${rec.contributions} contribution${rec.contributions === 1 ? "" : "s"}, ${rec.approved} added`}
                                  </span>
                                </li>
                              ))}
                              <li>
                                <TextLink href="/admin/activities">
                                  Read them in the contributions queue
                                </TextLink>
                              </li>
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </TableWrap>
        )}
        <RevealMore n={hidden} onClick={revealAll} />
      </Card>

    </>
  );
}
