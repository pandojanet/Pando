"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Loading,
  NotConfigured,
  PageHead,
  TableWrap,
  Td,
  Th,
  Toolbar,
  when,
} from "@/components/admin/ui";
import { sentence } from "@/lib/admin/labels";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { useAdminRows } from "@/lib/admin/client";
import { DEEP_DIVE_STATUS } from "@/lib/admin/labels";

/**
 * Deep dives (21 Oct) — the client's measure: how many parents say yes.
 *
 * Read-only. Nothing here waits for a person: by the developer's decision a
 * deep dive goes out without review, so this page answers two questions only —
 * *is anybody taking the offer*, and *are the reports any good* (how many kept
 * the model's reasons, how many options rest on parents rather than pages).
 *
 * An offer nobody answered is not a no until its window has closed; the yes
 * rate counts only offers that have either been taken or have lapsed.
 */

const OFFER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function percent(n: number, of: number): string {
  return of === 0 ? "—" : `${Math.round((n / of) * 100)}%`;
}

export default function DeepDivesPage() {
  const [hideTest, setHideTest] = useState(true);
  const { rows, configured, loading, error, demo, setDemo } = useAdminRows("deep_dives");

  const all = useMemo(() => {
    const list = rows?.rows ?? [];
    return hideTest ? list.filter((r) => !r.is_test) : list;
  }, [rows, hideTest]);
  const testCount = (rows?.rows ?? []).filter((r) => r.is_test).length;

  const funnel = useMemo(() => {
    const now = Date.now();
    const offers = all.filter((r) => r.trigger === "proactive");
    const taken = offers.filter((r) => r.accepted_at !== null);
    const settled = offers.filter((r) => r.accepted_at !== null || now - Date.parse(r.created_at) > OFFER_WINDOW_MS);
    const explicit = all.filter((r) => r.trigger === "explicit");
    const sent = all.filter((r) => r.status === "sent");
    return {
      offered: offers.length,
      taken: taken.length,
      settled: settled.length,
      explicit: explicit.length,
      sent: sent.length,
      notBuilt: all.filter((r) => r.status === "failed").length,
      notCovered: all.filter((r) => r.status === "unsupported").length,
      drafted: sent.filter((r) => r.drafted === true).length,
    };
  }, [all]);

  const { shown, hidden, revealAll } = useReveal(all);
  const tableConfigured = configured && rows?.configured !== false;

  return (
    <>
      <PageHead
        title="Deep dives"
        intro="Offers, requests and the reports that went out. How many people say yes to an offer is the number to watch."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {testCount > 0 && (
        <Toolbar>
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} />
            Hide test ({testCount})
          </label>
        </Toolbar>
      )}

      <div className="space-y-4">
        {loading && !rows ? (
          <Card>
            <Loading />
          </Card>
        ) : error && !rows ? (
          <Card>
            <Failed />
          </Card>
        ) : !tableConfigured ? (
          <Card>
            <NotConfigured demo={demo} onDemo={setDemo} noSample />
          </Card>
        ) : (
          <>
            <Card title="The funnel">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-[14px] sm:grid-cols-4">
                <div>
                  <dt className="text-muted">Offered</dt>
                  <dd className="text-[1.25rem] font-semibold tabular-nums">{funnel.offered}</dd>
                </div>
                <div>
                  <dt className="text-muted">Said yes</dt>
                  <dd className="text-[1.25rem] font-semibold tabular-nums">
                    {funnel.taken}{" "}
                    <span className="text-[13px] font-normal text-muted">
                      {percent(funnel.taken, funnel.settled)} of {funnel.settled} settled
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Asked for one</dt>
                  <dd className="text-[1.25rem] font-semibold tabular-nums">{funnel.explicit}</dd>
                </div>
                <div>
                  <dt className="text-muted">Sent</dt>
                  <dd className="text-[1.25rem] font-semibold tabular-nums">
                    {funnel.sent}{" "}
                    <span className="text-[13px] font-normal text-muted">
                      {funnel.notBuilt} not built · {funnel.notCovered} not covered
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Model&apos;s reasons kept</dt>
                  <dd className="text-[1.25rem] font-semibold tabular-nums">
                    {funnel.drafted}{" "}
                    <span className="text-[13px] font-normal text-muted">of {funnel.sent} sent</span>
                  </dd>
                </div>
              </dl>
            </Card>

            {all.length === 0 ? (
              <Card>
                <Empty title="No deep dives yet" body="They appear here the moment Pando offers one or a parent asks." />
              </Card>
            ) : (
              <Card title="Every offer and request">
                <TableWrap label="Deep dives">
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Parent</Th>
                      <Th>How</Th>
                      <Th>About</Th>
                      <Th>State</Th>
                      <Th className="text-right">Options</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <Td className="whitespace-nowrap text-muted">{when(r.created_at)}</Td>
                        <Td>{r.asker ?? <span className="text-muted">no name</span>}</Td>
                        <Td>{r.trigger === "proactive" ? "Offered" : "Asked"}</Td>
                        <Td className="max-w-[28rem]">{r.question ?? <span className="text-muted">waiting for a topic</span>}</Td>
                        <Td>
                          <Badge tone={DEEP_DIVE_STATUS[r.status]?.tone ?? "neutral"}>{DEEP_DIVE_STATUS[r.status]?.label ?? sentence(r.status)}</Badge>
                          {r.is_test && (
                            <span className="ml-1">
                              <Badge tone="gold">test</Badge>
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">
                          {r.status === "sent"
                            ? `${r.parent_options ?? 0} ${(r.parent_options ?? 0) === 1 ? "parent" : "parents"} · ${r.public_options ?? 0} public`
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
                <RevealMore n={hidden} onClick={revealAll} />
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
