"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  inputClass,
  slugLabel,
  yearList,
  when,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import type { ContributorRow } from "@/lib/admin/types";

/** Estimate 2.3 — contributors list. Detail lives at /admin/contributors/[id]. */
export default function ContributorsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error } =
    useAdminRows<ContributorRow[]>("contributors");
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(true);

  const all = rows ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((row) => {
      if (hideTest && row.is_test) return false;
      if (!q) return true;
      return [row.name, row.neighborhood, row.phone_masked]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, search, hideTest, ]);

  const testCount = all.filter((r) => r.is_test).length;

  return (
    <>
      <PageHead
        title="Contributors"
        intro="Everyone who has been through the Seed Tool. Open one to see the derived matching profile, everything they submitted, and the original conversation."
        right={
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, neighborhood…"
              className={`${inputClass} w-[13rem]`}
            />
            {testCount > 0 && (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={hideTest}
                  onChange={(e) => setHideTest(e.target.checked)}
                />
                Hide {testCount} test
              </label>
            )}
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      <Card>
        {loading && all.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">Loading…</div>
        ) : !configured && all.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : filtered.length === 0 ? (
          <Empty
            title={all.length === 0 ? "No contributors yet" : "Nothing matches"}
            body={
              all.length === 0
                ? "They appear here as soon as somebody finishes the profile."
                : "Try a shorter search."
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Neighborhood</Th>
                <Th>Born</Th>
                <Th className="text-right">Cards</Th>
                <Th className="text-right">Qualifying</Th>
                <Th>Founding</Th>
                <Th>Follow-ups</Th>
                <Th>Joined</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-paper/70">
                  <Td>
                    <Link
                      href={`/admin/contributors/${row.id}`}
                      className="font-semibold text-green-deep underline underline-offset-2"
                    >
                      {row.name ?? "Unknown"}
                    </Link>
                    <span className="mt-0.5 block text-[12.5px] text-muted">
                      {row.phone_masked ?? "no number"}
                    </span>
                    {row.is_test && (
                      <span className="mt-1 inline-block">
                        <Badge tone="gold">test</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>{row.neighborhood ? slugLabel(row.neighborhood) : "—"}</Td>
                  <Td>{yearList(row.child_birth_years)}</Td>
                  <Td className="text-right font-semibold">{row.submissions}</Td>
                  <Td
                    className="text-right font-semibold"
                    title="Approved contributions meeting every Founding criterion"
                  >
                    {row.qualifying_approved}
                  </Td>
                  <Td>
                    {row.founding_status === "founding" ? (
                      <Badge tone="green">Founding</Badge>
                    ) : row.founding_status === "request_invite" ? (
                      <Badge tone="muted">Not from group</Badge>
                    ) : (
                      <Badge tone="gold">Pending</Badge>
                    )}
                  </Td>
                  <Td>
                    {row.follow_up_opt_in === true ? (
                      <Badge tone="green">Yes</Badge>
                    ) : row.follow_up_opt_in === false ? (
                      <Badge tone="muted">No</Badge>
                    ) : (
                      <Badge tone="muted">—</Badge>
                    )}
                  </Td>
                  <Td className="text-muted">{when(row.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
