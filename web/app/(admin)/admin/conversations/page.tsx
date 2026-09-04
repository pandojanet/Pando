"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Explainer,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  TableWrap,
  Td,
  Th,
  Toolbar,
  when,
} from "@/components/admin/ui";
import { Hint, SegmentedFilter } from "@/components/admin/kit";
import { useAdminRows } from "@/lib/admin/client";
import { slugLabel } from "@/components/admin/ui";
import type {
  ConversationDetail,
  ConversationRow,
  ConversationsResult,
} from "@/lib/admin/types";

/**
 * Estimate 14.1 — the conversation inbox.
 *
 * ## What it shows, and the thing it deliberately cannot
 *
 * The row asks for "all conversations, inbound and outbound", which reads as a
 * transcript. **There is no transcript to show.** `message_log` stores the
 * direction, the category, the template, the provider's id, the delivery status
 * and the time — and no body. That is invariant 7 holding at the schema rather
 * than at a log line: Pando does not warehouse what parents write, and adding a
 * body column to fill this page would be a privacy decision dressed as a
 * feature.
 *
 * So the page says so, once, at the top. What is left is not a consolation
 * prize — it is the answer to every question an admin actually arrives with:
 *
 *  - **did Pando text her, and did it arrive** (12.5's status, per message);
 *  - **did she reply**, and did that reply answer something Pando asked — which
 *    is the exact signal 8.4's response-rate governor acts on;
 *  - **how often has she been asked lately**, against the allowance she herself
 *    set (P14), so eight messages reads as either well inside "ask me anytime"
 *    or as a bug.
 *
 * ## Why there is no reply box
 *
 * The same rule as the matching harness, for the same reason. Nothing is sent
 * from a page whose purpose is reading a record: an answer goes out through the
 * queue at `/admin/answers`, where it has been composed, held and read. A send
 * button here would be a second path around 5.8, and the one thing this product
 * promises never to send is an answer nobody read.
 */
export default function ConversationsPage() {
  const [view, setView] = useState<"all" | "waiting" | "quiet" | "failed">("all");
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const { rows, configured, loading, error, demo, setDemo } =
    useAdminRows<ConversationsResult>("conversations");

  /* Fetched only once a row is opened — a history nobody asked for is a round
     trip spent on nothing (the `enabled` argument exists for exactly this). */
  const detail = useAdminRows<ConversationDetail>(
    "conversation",
    { person_id: open ?? "" },
    open !== null,
  );

  const all = rows?.rows ?? [];

  const counts = useMemo(
    () => ({
      all: all.length,
      /**
       * **Her turn was last** — the newest message came in and nothing has gone
       * back. Not a queue Pando owes an answer to (that is `/admin/answers`),
       * but the honest reading of "somebody said something and it stopped
       * there", which is worth being able to see.
       */
      waiting: all.filter((r) => r.last_direction === "in").length,
      /**
       * Asked repeatedly and not answering. The governor lowers a tier at 25%
       * over 30 days with a floor of four requests (`RESPONSE_MIN_SAMPLE`), so
       * this is the same shape read early — a chance to notice that Pando is
       * asking the wrong person before it quietly asks them less.
       */
      quiet: all.filter((r) => r.outreach_30 >= 4 && r.answered_30 === 0).length,
      failed: all.filter((r) => r.failed > 0).length,
    }),
    [all],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (hideTest && r.is_test) return false;
      if (view === "waiting" && r.last_direction !== "in") return false;
      if (view === "quiet" && !(r.outreach_30 >= 4 && r.answered_30 === 0)) return false;
      if (view === "failed" && r.failed === 0) return false;
      if (!q) return true;
      return [r.name, r.phone_masked]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, view, search, hideTest]);

  const testCount = all.filter((r) => r.is_test).length;

  /* See the panel below for why this exists. */
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open === null) return;
    const el = panelRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus();
  }, [open]);

  return (
    <>
      <PageHead
        title="Conversations"
        intro="Every parent Pando has exchanged a message with. Nothing is sent from this page."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <Toolbar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or number…"
          className={`${inputClass} w-[12rem]`}
        />
        {testCount > 0 && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={hideTest}
              onChange={(e) => setHideTest(e.target.checked)}
            />
            Hide test ({testCount})
          </label>
        )}
      </Toolbar>

      {/**
       * Said once, at the top, where a reader meets it before they go looking
       * for message text and conclude the page is broken.
       */}

      <div className="mb-4">
        <SegmentedFilter
          label="Which conversations"
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { id: "all" as const, label: "Everyone", count: counts.all },
            { id: "waiting" as const, label: "They spoke last", count: counts.waiting },
            { id: "quiet" as const, label: "Asked, not answering", count: counts.quiet },
            { id: "failed" as const, label: "Something failed", count: counts.failed },
          ]}
        />
      </div>

      <Explainer title="Why there is no message text here">
        <p>
          Pando doesn&apos;t store what anyone writes — inbound or outbound. The
          record keeps who, when, which direction, what kind of message it was
          and whether it arrived, and nothing else.
        </p>
        <p className="mt-2">
          So this answers &ldquo;did Pando text her, did it arrive, and did she
          reply&rdquo; — which is also the arithmetic behind how often Pando is
          allowed to ask her again.
        </p>
      </Explainer>

      <div className="mt-4">
        <Card
          title={`Conversations (${filtered.length})`}
          right={
            rows && rows.unattributed > 0 ? (
              <span className="text-[12.5px] text-muted">
                {rows.unattributed} unattributed{" "}<Hint>{"A message from a number Pando had not yet made a person for, or one whose caregiver profile has since been deleted — the log row survives without them."}</Hint></span>
            ) : undefined
          }
        >
          {loading && !rows ? (
            <Loading />
          ) : !configured ? (
            <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample="There is no sample history on purpose — this page answers “did Pando really text her”, and invented rows answer yes."
            />
          ) : filtered.length === 0 ? (
            <Empty
              title={all.length === 0 ? "No messages yet" : "Nothing in this view"}
              body={
                all.length === 0
                  ? "Pando hasn't exchanged a message with anybody. Once it has, every one of them shows up here."
                  : undefined
              }
            />
          ) : (
            <TableWrap label="Parents Pando has messaged">
              <thead>
                <tr>
                  <Th>Parent</Th>
                  <Th>Last</Th>
                  <Th className="text-right">Sent</Th>
                  <Th className="text-right">Replies</Th>
                  <Th
                    className="text-right"
                    hint="Proactive messages in the last 30 days, and how many of them she answered. This is the window the response-rate governor uses."
                  >
                    Last 30 days
                  </Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <ConversationTableRow
                    key={row.person_id}
                    row={row}
                    onOpen={() => setOpen(row.person_id)}
                  />
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      {open !== null && (
        /**
         * The history opens **below** a nine-column table, so on a full page an
         * admin clicked "Open" and nothing appeared to happen — the panel
         * mounted a screen and a half further down. So it brings itself into
         * view and takes focus.
         *
         * Three details, each the same rule the parent flow settled on 3 Sep:
         * `block: "nearest"` rather than `"start"`, so a panel already on screen
         * does not jump; **no `behavior: "smooth"`**, because this is a tool and
         * a reader who clicked a row wants to be there already, not to watch a
         * journey; and `tabIndex={-1}` so focus can land on the panel at all —
         * without it the browser would scroll and leave focus on a button in a
         * row that is now off-screen, so the next Tab would return there.
         *
         * The focus ring is deliberately not suppressed: the last interaction
         * was a click or a keypress on the row, and the ring is what says where
         * the reader has been moved to.
         */
        <div className="mt-5" ref={panelRef} tabIndex={-1}>
          <Card
            title={
              detail.rows
                ? `${detail.rows.name ?? "Unnamed"} — ${detail.rows.messages.length} message${detail.rows.messages.length === 1 ? "" : "s"}`
                : "History"
            }
            right={
              <Button tone="secondary" onClick={() => setOpen(null)}>
                Close
              </Button>
            }
          >
            {detail.loading && !detail.rows ? (
              <Loading />
            ) : !detail.rows ? (
              <Empty title="No history for that parent" />
            ) : (
              <History detail={detail.rows} />
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function ConversationTableRow({
  row,
  onOpen,
}: {
  row: ConversationRow;
  onOpen: () => void;
}) {
  return (
    <tr>
      <Td>
        <span className="font-semibold">{row.name ?? "Unnamed"}</span>
        {row.phone_masked && (
          <span className="ml-2 text-[12.5px] text-muted">{row.phone_masked}</span>
        )}
        {row.is_test && (
          <Badge tone="neutral">Test</Badge>
        )}
      </Td>
      <Td>
        <span className="flex flex-wrap items-center gap-1.5">
          {/* Direction as a word, not an arrow: "she wrote" and "Pando wrote"
              are the two facts, and a glyph makes a reader decode it. */}
          <Badge tone={row.last_direction === "in" ? "green" : "neutral"}>
            {row.last_direction === "in" ? "She wrote" : "Pando wrote"}
          </Badge>
          {row.last_template && (
            <span className="text-[12.5px] text-muted">
              {slugLabel(row.last_template)}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[12.5px] text-muted">
          {when(row.last_at)}
        </span>
      </Td>
      <Td className="text-right tabular-nums">{row.sent}</Td>
      <Td className="text-right tabular-nums">{row.received}</Td>
      <Td className="text-right tabular-nums">
        {/* Built in JS: an embedded expression loses the whitespace on *both*
            sides when the block wraps, which is the trap `shortfall` on the
            matching page documents. */}
        <span className={row.outreach_30 >= 4 && row.answered_30 === 0 ? "text-gold-ink" : undefined}>
          {askedAndAnswered(row.outreach_30, row.answered_30)}
        </span>
      </Td>
      <Td className="text-right">
        {row.failed > 0 && (
          <Badge tone="red">{row.failed} failed</Badge>
        )}
        <Button tone="secondary" onClick={onOpen}>
          History
        </Button>
      </Td>
    </tr>
  );
}

function History({ detail }: { detail: ConversationDetail }) {
  return (
    <>
      <p className="border-b border-bark/70 px-4 py-2.5 text-[13px] text-muted">
        {agreement(detail)}
      </p>
      {detail.opted_out && (
        <p className="border-b border-alert-line bg-alert-wash px-4 py-2.5 text-[13.5px] font-medium text-alert">
          They have texted STOP. Nothing proactive reaches them — the send layer
          refuses it before anything else runs.
        </p>
      )}
      <ol className="divide-y divide-bark/70">
        {detail.messages.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <Badge tone={m.direction === "in" ? "green" : "neutral"}>
              {m.direction === "in" ? "She wrote" : "Pando wrote"}
            </Badge>
            <span className="text-[13.5px] font-medium">
              {m.template ? slugLabel(m.template) : slugLabel(m.category)}
            </span>
            <span className="text-[12.5px] text-muted">{when(m.sent_at)}</span>
            {m.answered_something && (
              <Badge
                tone="green"
                hint="This reply answered something Pando had asked, which is what the response-rate governor counts."
              >
                Answered a request
              </Badge>
            )}
            {m.status && m.status !== "delivered" && (
              <Badge tone={m.error_code ? "red" : "gold"}>
                {m.error_code ? `${slugLabel(m.status)} · ${m.error_code}` : slugLabel(m.status)}
              </Badge>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * "3 asked · 1 answered", as one string.
 *
 * Built here rather than interpolated in JSX for the reason the matching page's
 * `shortfall` records: JSX strips the whitespace on *both* boundaries of an
 * embedded expression when the block wraps across lines, which read as
 * "3asked·1answered" in the DOM while looking correct in the source.
 */
function askedAndAnswered(asked: number, answered: number): string {
  if (asked === 0) return "not asked";
  return `${asked} asked · ${answered} answered`;
}

/** What they agreed to, so the history above can be read against it. */
function agreement(detail: ConversationDetail): string {
  const limit =
    detail.allowance_mode === "as_relevant"
      ? "anytime a question is genuinely relevant"
      : `up to ${detail.monthly_contact_allowance ?? 5} questions a month`;
  return `They agreed to be asked ${limit}, with at least 48 hours between any two.`;
}
