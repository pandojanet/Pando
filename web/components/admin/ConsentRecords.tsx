"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  NotConfigured,
  SampleBanner,
  TableWrap,
  Td,
  Th,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import type { ConsentRow } from "@/lib/admin/types";

/**
 * The consent file, shown as a tab of Contributors rather than a page of its own
 * (13 Aug). It was its own item in the nav and nobody could tell what it was for
 * — which is fair: "who came through" and "what each of them agreed to" are two
 * questions about the same people, and splitting them made the second look like
 * an unrelated export screen. It keeps every property that makes it a defence
 * file; it just lives next to the people it is about.
 *
 * A2P §3.3: "consent records must be exportable. If there's ever a TCPA
 * complaint, this table is the defense."
 *
 * Three things this page does deliberately differently from every other admin page:
 *
 *  - **the phone number is not masked.** Everywhere else it is, because nobody needs
 *    it to make a decision. Here the number *is* the record — a defence file that
 *    cannot say which number agreed proves nothing.
 *  - **test rows are shown and labelled, never filtered out.** A complaint arrives
 *    about a phone number, not about our idea of which rows count.
 *  - **the download is built here, from rows already on screen.** Reading this
 *    resource writes an audit row, so "when did a list of numbers leave, and who
 *    took it" is answerable; a separate export endpoint would be a second way in
 *    that could forget to.
 *
 * There is no free text on this screen at all — no note, no question, no caveat.
 * Consent is a decision about wording, and the wording is a version number.
 */
export function ConsentRecords() {
  const { rows, configured, sample, demo, setDemo, loading, error } =
    useAdminRows<ConsentRow[]>("consents");

  const [scope, setScope] = useState<string>("all");
  const all = rows ?? [];

  const scopes = useMemo(
    () => ["all", ...new Set(all.map((r) => r.scope))],
    [all],
  );

  const visible = useMemo(
    () => (scope === "all" ? all : all.filter((r) => r.scope === scope)),
    [all, scope],
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[40rem] text-[13.5px] leading-relaxed text-muted">
          Every yes and every no, with the version of the wording it was given
          under. This is the file that answers a TCPA complaint, so it is exported
          as it stands — including test rows, clearly marked, and with the number
          in full.
        </p>
        <div className="flex flex-wrap gap-1">
            {scopes.map((key) => (
              <Button
                key={key}
                className="shrink-0"
                tone={scope === key ? "primary" : "secondary"}
                onClick={() => setScope(key)}
              >
                {key === "all" ? "Every scope" : slugLabel(key)}
              </Button>
            ))}
            <Button
              tone="secondary"
              disabled={visible.length === 0}
              onClick={() => downloadCsv(visible)}
              title="Downloads exactly the rows shown, as a CSV"
            >
              Download CSV
            </Button>
          </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      <Card>
        {loading && all.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">
            Loading…
          </div>
        ) : !configured && all.length === 0 ? (
          <NotConfigured demo={demo} onDemo={setDemo} />
        ) : visible.length === 0 ? (
          <Empty
            title="No consent records"
            body="They are written as parents give their number and finish the flow."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Who</Th>
                <Th>Number</Th>
                <Th>What they agreed to</Th>
                <Th>Decision</Th>
                <Th>Where</Th>
                <Th>Wording</Th>
                <Th>When</Th>
                <Th>Opted out</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className={row.is_test ? "bg-paper/70" : undefined}>
                  <Td className="text-[13px]">
                    {row.name ?? "—"}
                    {row.is_test && (
                      <span className="ml-1.5">
                        <Badge tone="neutral">test</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-[12.5px]">
                    {row.phone ?? "—"}
                  </Td>
                  <Td className="text-[13px]">{slugLabel(row.scope)}</Td>
                  <Td>
                    <Badge
                      tone={
                        row.status === "opted_in"
                          ? "green"
                          : row.status === "declined"
                            ? "neutral"
                            : "red"
                      }
                    >
                      {slugLabel(row.status)}
                    </Badge>
                  </Td>
                  <Td className="text-[13px] text-muted">{slugLabel(row.source)}</Td>
                  <Td className="font-mono text-[12px] text-muted">
                    {row.text_version}
                  </Td>
                  <Td className="whitespace-nowrap text-[13px] text-muted">
                    {when(row.captured_at)}
                  </Td>
                  <Td className="text-[13px]">
                    {row.opted_out_at ? (
                      <span className="text-alert">{when(row.opted_out_at)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
        A version number is not the wording. `lib/consent.ts` and
        `lib/sms-templates.ts` hold the text each version refers to, and an old
        version is never edited in place — otherwise a stored record would resolve to
        words nobody ever saw.
      </p>
    </>
  );
}

/**
 * CSV, built in the browser from the rows on screen.
 *
 * Every field is quoted and every quote doubled, because a phone number is safe but
 * a name is not: one comma in "Smith, Jr." shifts every column after it and the file
 * stops being evidence. The header names match the spec's column names (§15.1) so a
 * lawyer reading it and an engineer reading the schema see the same words.
 */
function downloadCsv(rows: ConsentRow[]): void {
  const header = [
    "person_id",
    "name",
    "phone",
    "consent_scope",
    "consent_status",
    "consent_source",
    "consent_text_version",
    "consent_timestamp",
    "opted_out_at",
    "is_test",
  ];

  const cell = (value: unknown): string =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const body = rows.map((r) =>
    [
      r.person_id,
      r.name,
      r.phone,
      r.scope,
      r.status,
      r.source,
      r.text_version,
      r.captured_at,
      r.opted_out_at,
      r.is_test,
    ]
      .map(cell)
      .join(","),
  );

  const csv = [header.join(","), ...body].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "pando-consent-records.csv";
  link.click();
  URL.revokeObjectURL(url);
}
