"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Failed,
  Field,
  inputClass,
  Loading,
  NotConfigured,
  PageHead,
  ResultNote,
  SampleBanner,
  slugLabel,
  when,
} from "@/components/admin/ui";
import { RevealMore, useReveal } from "@/components/admin/Reveal";
import { SegmentedFilter, Select } from "@/components/admin/kit";
import { PersonPicker } from "@/components/admin/PersonPicker";
import {
  Fact,
  FactGrid,
  Quote,
  RecordCard,
  RecordDrawer,
  RecordList,
} from "@/components/admin/Record";
import { adminAction, useAdminRows } from "@/lib/admin/client";
import { useUrlFilter } from "@/lib/admin/url-state";
import {
  BLAST_STATUS,
  BLAST_TIER,
  DEMAND_CATEGORY,
  PAYMENT_STATUS,
  matchReason,
  matchReasonValue,
  poolHeldReason,
  sentence,
} from "@/lib/admin/labels";
import { formatCents, refundOwed } from "@/lib/payments";
import { TIERS, TIER_IDS, type BlastTier } from "@/lib/blast-tiers";
import type {
  BlastPoolResult,
  BlastRow,
  DeliveryHealthRow,
  MatchingResult,
} from "@/lib/admin/types";

/**
 * Estimate 14.3 — the blast manager.
 *
 * The fullest row in M14: "preview the selected recipient pool, read the
 * responses, rate their quality, pick the best, and manage fulfillment and
 * refund flags."
 *
 * ## What was already built, and what was actually missing
 *
 * Three of those five had a home. Reading a reply, rating it and deciding
 * whether it enters the graph are `/admin/responses` — built under 7.6/7.9 on
 * 27 Aug, and 14.8 under its own number. What had **no** home was the blast
 * itself: there was no list of Network Asks anywhere in the admin, no way to see
 * a pool before it went out, and no way to say "this one was answered" or "this
 * one owes a refund". So this page is the blast, and it links to the replies
 * rather than duplicating them — the same rule that keeps the consent file on
 * `/admin/contributors` instead of giving it a second nav item.
 *
 * ## The pool preview, and why it is a read
 *
 * It calls the same `selectPool` a live send calls: matcher, then the opt-out
 * list in the WHERE clause, then the M8 protection rules per person. A preview
 * that scored differently from the send would be worse than none. And it is a
 * *read* resource, deliberately — 6.7's rule that a screen able to both score
 * and message puts the pilot's first blast a mis-click from a page built for
 * looking.
 *
 * The **held** list is shown as prominently as the chosen one, because it is
 * usually the more interesting half: a pool that came back short is not a fault,
 * it is four contributors inside their 48-hour gap, and an admin who cannot see
 * that reads a three-person pool as a broken matcher.
 *
 * ## Three verbs, and each is a judgement
 *
 * **Open a checkout** hands back a Stripe link; the admin passes it on, because
 * during the pilot there is no consumer web channel for an Ask. **Mark
 * fulfilled** is a person saying the parent got what they paid for — no query
 * can decide that, since three replies of "no idea, sorry" leave the guarantee
 * owed. **Flag a refund** is the first half of 13.7, kept separate from making
 * one so that noticing and authorising can be different people.
 */
/**
 * Is Pando allowed to text anybody right now?
 *
 * §14's window is 8am-9pm **Pacific** — the parent's clock, not the reader's —
 * and `sendSms` refuses outreach outside it. Nothing in the admin said so, and
 * the failure it produces is the misleading kind: every send is skipped, the
 * Ask is marked for review, and the screen looks like a broken pool. Whoever is
 * testing from Europe is inside quiet hours for their whole working day.
 *
 * Rendered only after mount. The server's answer and the browser's are the same
 * computation but a second apart, which is a hydration mismatch for a clock —
 * and the server's is the one nobody is looking at.
 */
function QuietHoursNote({ relay }: { relay: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  /* The relay is exempt, so a banner warning about the hour while sends
     actually go through would be the page contradicting the send layer — the
     class of thing this file keeps fixing. `quietHoursBlocks` is the one rule;
     this reads the same two facts it does. */
  const quiet = hour < 8 || hour >= 21;
  const blocked = quiet && !relay;

  return (
    <p
      className={`mb-4 rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed ${
        blocked
          ? "border-gold-line bg-gold-wash text-gold-ink"
          : "border-bark bg-paper text-muted"
      }`}
    >
      <strong>{time} in Pasadena.</strong>{" "}
      {blocked
        ? "That is outside 8am–9pm Pacific, so nothing will send — every recipient is skipped and the Ask comes back marked for review. Replies still arrive."
        : quiet
          ? "That is outside 8am–9pm Pacific, but sends are going to the Slack test channel, where nobody’s phone buzzes — so the window is not enforced and you can send now."
          : "Inside 8am–9pm Pacific, so sending is open."}
    </p>
  );
}

/** The tabs, and what the query parameter may say. */
const FILTERS = ["open", "owed", "paid", "all"] as const;

/** `busy` for the create form, which is the one action here with no row. */
const CREATING = "new-ask";

export default function BlastsPage() {
  const { rows, configured, sample, demo, setDemo, loading, error, reload } =
    useAdminRows<BlastRow[]>("blasts");

  const [filter, setFilter] = useUrlFilter(FILTERS, "open");
  const [openPool, setOpenPool] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; kind: "fulfil" | "refund_due" } | null>(
    null,
  );
  const [note, setNote] = useState("");
  /* The Ask being acted on — or CREATING, for the form at the top, which is
     the one control on this page that belongs to no row. */
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /* 7.1's entry. The people list comes from the matching resource, which
     already returns it with no asker chosen — a second query for the same
     names would be a second list to keep in step. */
  const { rows: matching } = useAdminRows<MatchingResult>("matching");
  /* Only for the transport flag — whether a send tonight reaches a phone or a
     Slack channel decides whether the quiet-hours window applies at all. */
  const { rows: delivery } = useAdminRows<DeliveryHealthRow>("delivery");
  const [asker, setAsker] = useState("");
  const [question, setQuestion] = useState("");
  const [tier, setTier] = useState<BlastTier>("targeted");

  const all = rows ?? [];
  const real = useMemo(() => all.filter((r) => !r.is_test), [all]);

  /**
   * Whether the guarantee is owed, from `lib/payments.ts` rather than from a
   * predicate written here. The page and the action have to agree about it, and
   * two places deriving "is a refund owed" is how they stop agreeing — the
   * lesson the demand queue's tab counter already paid for.
   */
  const owedBy = useMemo(() => {
    const map = new Map<string, ReturnType<typeof refundOwed>>();
    for (const row of real) {
      map.set(
        row.id,
        refundOwed({
          status: row.status,
          payment_status: row.payment_status as never,
          credit_id: row.credit_funded ? "credit" : null,
          approved_responses: row.approved_responses,
          /* 7.7's clock. Without it this said "Pando owes a refund" about an
             Ask that was still live — see the note in `refundOwed`. */
          expires_at: row.expires_at,
          /* And the other end of it: the credit half of the guarantee is
             granted by `expire_blasts`, so without this the row reported it
             as still owed on a promise the job had already kept. */
          credit_granted_at: row.credit_granted_at,
        }),
      );
    }
    return map;
  }, [real]);

  const visible = useMemo(() => {
    if (filter === "open")
      return real.filter(
        (r) => r.status === "draft" || r.status === "pending_review" || r.status === "active",
      );
    if (filter === "owed") return real.filter((r) => owedBy.get(r.id)?.owed === true);
    if (filter === "paid") return real.filter((r) => r.payment_status === "paid");
    return real;
  }, [real, filter, owedBy]);

  /* Counts from the same expressions as the tabs — see the demand-queue rule. */
  const counts = {
    open: real.filter(
      (r) => r.status === "draft" || r.status === "pending_review" || r.status === "active",
    ).length,
    owed: real.filter((r) => owedBy.get(r.id)?.owed === true).length,
    paid: real.filter((r) => r.payment_status === "paid").length,
    all: real.length,
  };

  async function run(
    rowId: string,
    label: string,
    fn: () => Promise<{ persisted: boolean; detail?: Record<string, unknown> }>,
  ) {
    setBusy(rowId);
    setMessage(null);
    try {
      const result = await fn();
      const url = typeof result.detail?.url === "string" ? result.detail.url : null;
      setMessage(
        !result.persisted
          ? `${label} — but nothing was saved.`
          : url
            ? `${label} Send this to the parent: ${url}`
            : label,
      );
      setNoteFor(null);
      setNote("");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  /* Every queue reveals the same way: thirty rows, then a button saying how
     many are left. Inert until the list is long enough to need it. */
  const { shown, hidden, revealAll } = useReveal(visible);

  return (
    <>
      <PageHead
        title="Network Asks"
        intro="Every question a parent paid Pando to ask, who it went to, and what it owes them."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}
      {message && <ResultNote>{message}</ResultNote>}
      <QuietHoursNote relay={delivery?.relay === true} />

      {/**
        * 7.1 — where an Ask begins.
        *
        * `createBlast` was written on 27 Aug and had no caller: the page below
        * managed Asks that only a seed script could create. This is the manual
        * entry, which is how the rest of the pilot already works — a parent's
        * question reaches a person, and a person records it.
        *
        * ⚠ It creates and stops. Sending is its own button on the row (that is
        * the path to five strangers' phones), paying is another, and choosing
        * who to ask is the pool preview. Creating a question is not deciding to
        * ask it.
        */}
      <Card title="Record an Ask">
        <div className="grid gap-3.5 px-4 py-3.5 md:grid-cols-[1fr_12rem]">
          <PersonPicker
            label="Asking on behalf of"
            people={matching?.people ?? []}
            value={asker}
            onChange={setAsker}
            hint="Type a name or a town — “south pas” finds South Pasadena."
            emptyLabel="No contributors in the database yet."
          />
          <Field label="Tier" hint={TIERS[tier].note}>
            <Select
              label="Which tier this Ask is"
              value={tier}
              onChange={setTier}
              options={TIER_IDS.map((id) => ({
                id,
                label:
                  TIERS[id].price_cents > 0
                    ? `${TIERS[id].label} — ${formatCents(TIERS[id].price_cents)}`
                    : `${TIERS[id].label} — free`,
              }))}
            />
          </Field>
          <Field
            label="The question"
            hint="Their words, not a summary — this is the text five parents read."
          >
            <textarea
              className={`${inputClass} min-h-[4.5rem]`}
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Any good toddler swim classes near South Pasadena?"
            />
          </Field>
          <div className="flex items-end">
            <Button
              tone="primary"
              disabled={busy === CREATING || !asker || question.trim() === ""}
              onClick={() =>
                run(CREATING, "Ask recorded. Nothing has been sent.", async () => {
                  const result = await adminAction({
                    action: "blast.create",
                    asker_id: asker,
                    question_text: question.trim(),
                    tier,
                  });
                  setQuestion("");
                  return result;
                })
              }
            >
              Record it
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-4">
        <SegmentedFilter
          unknown={!rows}
          label="Which Asks to show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "open", label: "Still open", count: counts.open },
            { id: "owed", label: "Owes an answer", count: counts.owed },
            { id: "paid", label: "Paid", count: counts.paid },
            { id: "all", label: "Everything", count: counts.all },
          ]}
        />
      </div>
      <Card>

        {loading && all.length === 0 ? (
          <Loading />
        ) : error && all.length === 0 ? (
          <Failed />
        ) : !configured && all.length === 0 ? (
          <NotConfigured
              demo={demo}
              onDemo={setDemo}
              noSample="There are no sample Asks on purpose — invented money is worse than invented anything else, and a fabricated $15 payment answers “has anybody actually paid?” with a yes."
            />
        ) : visible.length === 0 ? (
          <Empty
            title="Nothing in this view"
            body={
              filter === "owed"
                ? "No Ask is waiting on an answer or a refund. That is the state you want."
                : "Switch the filter, or wait for a parent to ask something."
            }
          />
        ) : (
          <RecordList>
            {shown.map((row) => {
              const owed = owedBy.get(row.id);
              const status = BLAST_STATUS[row.status];
              const payment = PAYMENT_STATUS[row.payment_status];
              const drawer = noteFor?.id === row.id ? noteFor.kind : null;
              return (
                <RecordCard
                  key={row.id}
                  /* Only an outstanding refund gets a wash: it is the one row on
                     this page that is somebody's unfinished task. A tint on
                     every paid Ask would be a tint on the ordinary case. */
                  tone={
                    row.payment_status === "refund_due"
                      ? "urgent"
                      : row.human_review && row.status === "pending_review"
                        ? "pending"
                        : "plain"
                  }
                  title={<span className="font-normal leading-relaxed">“{row.question_text}”</span>}
                  aside={
                    <>
                      {row.asker?.name ?? "No profile"}
                      <span className="mt-0.5 block">{when(row.created_at)}</span>
                    </>
                  }
                  badges={
                    <>
                      <Badge tone={status?.tone ?? "neutral"}>
                        {status?.label ?? sentence(row.status)}
                      </Badge>
                      {row.payment_status !== "not_required" && (
                        <Badge tone={payment?.tone ?? "neutral"}>
                          {payment?.label ?? sentence(row.payment_status)}
                          {row.price_cents > 0 ? ` · ${formatCents(row.price_cents)}` : ""}
                        </Badge>
                      )}
                      {row.credit_funded && (
                        <Badge tone="green">Paid with an earned credit</Badge>
                      )}
                      {row.human_review && (
                        <Badge tone="gold">A person reads this before it goes</Badge>
                      )}
                    </>
                  }
                  actions={
                    <>
                      {/* Only when there is genuinely something to pay: a free
                          tier and a credit-funded Ask are refused by
                          `openCheckout`, so offering it would be a button that
                          can only fail. */}
                      {row.payment_status === "pending" ||
                      row.payment_status === "failed" ||
                      (row.payment_status === "not_required" &&
                        !row.credit_funded &&
                        (row.tier === "board" || row.tier === "targeted")) ? (
                        <Button
                          tone="primary"
                          disabled={busy === row.id}
                          title="Creates a Stripe payment link. You pass it to the parent — Pando has no web channel for an Ask yet."
                          onClick={() =>
                            void run(row.id, "Checkout opened.", async () =>
                              adminAction({ action: "blast.checkout", id: row.id }),
                            )
                          }
                        >
                          {row.payment_status === "pending"
                            ? "New payment link"
                            : "Take payment"}
                        </Button>
                      ) : null}

                      <Button
                        tone="secondary"
                        disabled={busy === row.id}
                        onClick={() => setOpenPool(openPool === row.id ? null : row.id)}
                      >
                        {openPool === row.id ? "Hide the pool" : "Who would be asked"}
                      </Button>

                      {(row.status === "active" ||
                        row.status === "pending_review" ||
                        row.status === "expired") && (
                        <Button
                          tone="secondary"
                          disabled={busy === row.id}
                          title="Your judgement that the parent got a useful answer. Replies alone are not an answer."
                          onClick={() => {
                            setNoteFor({ id: row.id, kind: "fulfil" });
                            setNote("");
                          }}
                        >
                          Mark answered
                        </Button>
                      )}

                      {row.payment_status === "paid" && (
                        <Button
                          tone="danger"
                          disabled={busy === row.id}
                          title="Flags that a refund is owed. Making it is a separate step on the payments page."
                          onClick={() => {
                            setNoteFor({ id: row.id, kind: "refund_due" });
                            setNote(owed?.why ?? "");
                          }}
                        >
                          Flag a refund
                        </Button>
                      )}
                    </>
                  }
                >
                  <FactGrid>
                    <Fact label="Tier">{BLAST_TIER[row.tier] ?? sentence(row.tier)}</Fact>
                    <Fact label="About">
                      {row.category
                        ? (DEMAND_CATEGORY[row.category] ?? sentence(row.category))
                        : null}
                    </Fact>
                    <Fact label="Where from">
                      {row.neighborhood ? slugLabel(row.neighborhood) : null}
                    </Fact>
                    <Fact
                      label="Asked"
                      hint={
                        row.recipients > 0 && row.recipients < row.pool_target
                          ? `${row.pool_target} wanted — the rest were inside a protection rule`
                          : undefined
                      }
                    >
                      {row.recipients === 0
                        ? "Nobody yet"
                        : `${row.recipients} parent${row.recipients === 1 ? "" : "s"}`}
                    </Fact>
                    <Fact
                      label="Replies"
                      hint={row.passed > 0 ? `${row.passed} passed — no penalty` : undefined}
                    >
                      {row.responded === 0
                        ? "None yet"
                        : `${row.responded}, ${row.approved_responses} approved`}
                    </Fact>
                    <Fact label="Window">
                      {row.expires_at
                        ? `Closes ${when(row.expires_at)}`
                        : "No window — nobody is contacted"}
                    </Fact>
                  </FactGrid>

                  {/* 7.7's guarantee, said in words on the row it applies to
                      rather than left for a reader to work out from two badges. */}
                  {owed?.owed && (
                    <p className="mt-3.5 rounded-lg border border-alert-line bg-alert-wash px-3 py-2 text-[12.5px] leading-relaxed text-alert">
                      {owed.why}{" "}
                      {owed.as === "credit"
                        ? "Pando owes a fresh credit, not money."
                        : "Pando owes this parent a refund."}
                    </p>
                  )}

                  {/* Settled, and said rather than left silent: "the guarantee
                      was owed and has been met" is a different answer from
                      "nothing was ever owed", and only one of them tells an
                      admin why this Ask cost the parent nothing. Neutral, not
                      alert — there is nothing to do. */}
                  {owed && !owed.owed && owed.as === "credit" && (
                    <p className="mt-3.5 rounded-lg border border-bark bg-paper px-3 py-2 text-[12.5px] leading-relaxed text-muted">
                      {owed.why}
                    </p>
                  )}

                  {row.refund_reason && (
                    <div className="mt-3.5">
                      <Quote label="Why a refund was flagged">{row.refund_reason}</Quote>
                    </div>
                  )}

                  {drawer && (
                    <RecordDrawer
                      title={
                        drawer === "fulfil"
                          ? "What did the parent actually get?"
                          : "Why is a refund owed?"
                      }
                    >
                      <Field
                        label={drawer === "fulfil" ? "Your note" : "Your reason"}
                        hint="Saved with your name. It never reaches the parent."
                      >
                        <input
                          className={inputClass}
                          value={note}
                          onChange={(e) => setNote(e.target.value.slice(0, 300))}
                        />
                      </Field>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          tone={drawer === "fulfil" ? "primary" : "danger"}
                          disabled={busy === row.id || note.trim().length < 3}
                          onClick={() =>
                            void run(
                              row.id,
                              drawer === "fulfil" ? "Marked answered." : "Refund flagged.",
                              async () =>
                                drawer === "fulfil"
                                  ? adminAction({
                                      action: "blast.fulfil",
                                      id: row.id,
                                      note: note.trim(),
                                    })
                                  : adminAction({
                                      action: "blast.refund_due",
                                      id: row.id,
                                      reason: note.trim(),
                                    }),
                            )
                          }
                        >
                          {drawer === "fulfil" ? "Mark answered" : "Flag the refund"}
                        </Button>
                        <Button
                          tone="secondary"
                          onClick={() => {
                            setNoteFor(null);
                            setNote("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </RecordDrawer>
                  )}

                  {openPool === row.id && <PoolPreview blastId={row.id} />}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
        <RevealMore n={hidden} onClick={revealAll} />
      </Card>
    </>
  );
}

/**
 * Who Pando would ask, and who it would not.
 *
 * Fetched only when a card is opened (`enabled`), for the reason
 * `/admin/conversations` gives: a round trip for a panel nobody looked at.
 *
 * The **held** list is not an afterthought. `selectPool` asks the matcher for
 * four times the target precisely because the protection rules remove people,
 * and early in a pilot they remove most of them — so a three-person pool is
 * usually four contributors inside their 48-hour gap rather than a thin
 * network, and only this list can tell you which.
 */
function PoolPreview({ blastId }: { blastId: string }) {
  const { rows, loading, error } = useAdminRows<BlastPoolResult>(
    "blast_pool",
    { id: blastId },
  );

  if (loading && !rows) {
    return (
      <p className="mt-4 rounded-xl border border-bark bg-paper/70 px-3.5 py-3 text-[13px] text-muted">
        Working out who Pando would ask…
      </p>
    );
  }
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!rows) return null;

  return (
    <RecordDrawer title={`Who Pando would ask (${rows.chosen.length} of ${rows.wanted} wanted)`}>
      {rows.human_review.required && (
        <p className="mb-3 rounded-lg border border-gold-line bg-gold-wash px-3 py-2 text-[12.5px] leading-relaxed text-gold-ink">
          A person has to read this match before it goes out
          {rows.human_review.reason ? ` — ${sentence(rows.human_review.reason)}` : ""}. That
          is 7.3 working: an unusual or stacked request is exactly where a scorer is
          confident and wrong.
        </p>
      )}

      {rows.chosen.length === 0 ? (
        <p className="text-[13px] text-muted">
          Nobody is eligible right now. The held list below says why — an early
          network is sparse, and that is not a fault.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.chosen.map((member, i) => (
            <li
              key={member.person_id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-bark/50 pb-2 last:border-b-0"
            >
              <span className="text-[13.5px] font-semibold">
                {i + 1}. {member.name ?? "Unnamed"}
                {member.phone_masked && (
                  <span className="ml-2 font-normal text-muted">{member.phone_masked}</span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {member.reasons.map((r, j) => {
                  const named = matchReasonValue(r.kind, r.value);
                  return (
                    <Badge key={`${r.kind}-${j}`} tone="green">
                      {matchReason(r.kind)}
                      {named && <span className="font-normal">: {named}</span>}
                      <span className="ml-1.5 tabular-nums opacity-70">
                        +{Math.round(r.points * 100) / 100}
                      </span>
                    </Badge>
                  );
                })}
                <span className="ml-1 font-display text-[0.95rem] font-bold tabular-nums">
                  {Math.round(member.score * 100) / 100}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {rows.held.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
            Matched, but not asked ({rows.held.length})
          </p>
          <ul className="mt-1.5 space-y-1">
            {rows.held.map((member) => (
              <li key={member.person_id} className="text-[13px] text-muted">
                <span className="font-medium text-ink-soft">
                  {member.name ?? "Unnamed"}
                </span>{" "}
                — {poolHeldReason(member.reason)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Every one of these is a contributor&apos;s own agreement being kept. A
            short pool is usually this list, not a thin network.
          </p>
        </div>
      )}
    </RecordDrawer>
  );
}
