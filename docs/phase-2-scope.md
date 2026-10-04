# Phase 2, before any of it

> Document type: **scope reconciliation**. Moved out of [CLAUDE.md](../CLAUDE.md) on
> 4 Oct 2026. Read it before quoting, planning or building any Phase 2 work.

Reconciled 27 Aug against *Pando Strategy — Current Direction* (Aug 2026), the
QC Strategy Reconciliation 8.18, and `Pando_Estimate_v3.2_updated.xlsx`
(M5–M15). Three things a future session must not discover the hard way.

**Two pieces of scope are in the strategy and in no estimate row.** Searched, not
assumed: `digest`, `grove`, `leaves` and `leaf` return **zero** matches in the
workbook. (a) *The Pando Digest* (§10) — a scarce, event-triggered SMS that reads
like a well-connected friend, with layered access (headlines free, depth for
members, and "answer one board question and the week's Digest opens fully"). The
strategy calls it "primarily a retention engine … likely the strongest habit
mechanism we have", so it is not a nice-to-have that fell off a list. (b) *The
grove* (§13) — a private per-contributor ledger where a leaf converts at posted
rates (5 = a free Targeted Ask · 15 = a month of Pando+ · 40 = a year), with
impact receipts and earned statuses, and **no leaderboard ever**. M9 covers the
thanks loop, impact tracking and tiers, which is adjacent but is not a ledger with
a published exchange rate. Both need quoting before they are built.

**The open board is a surface, not a feature of Blast.** §3 and §8 describe a
once-a-day digest of anonymous questions that opted-in parents browse and answer,
priced as the $5 Board Ask, with a rule attached that shapes the whole allowance
model: **answering on the board never spends the monthly allowance, and still
counts as giving** (§7). M7 is written around a targeted blast; nothing in it is
this.

**The tiers are named and priced.** Passive (free) · Board Ask $5 · Targeted Ask
$15 · Last-Minute Care (free during the pilot, strongest neighborhoods only), and
every paid Ask is guaranteed — no useful answer in the window, automatic credit.
The first Targeted Ask is free, deliberately: the pilot's real question is whether
she pays for the *second*.

**Four areas have no neighbour, and that is correct.** `drizzle/0018` seeds 29
pairs; Whittier, San Dimas, Glendora and West Covina are selectable neighborhoods
with curated starters and touch nothing else on the list, because on the ground
they do not. A parent there gets no adjacency credit, which is the honest answer
rather than an omission — and the migration cannot be annotated after the fact,
since a committed migration is never edited.

**Three client answers, 27 Aug.** (1) The A2P campaign is **approved** — Twilio
provisioning is unblocked, and the ordering rule in the dev-codes decision applies
now: add the three `TWILIO_*` values first, remove `SEED_VERIFY_DEV_CODES` only
after. (2) **A contribution enters the graph only after approval** — already true
in code rather than a change to make: `shares_answerable` requires
`s.status = 'approved' AND sc.status = 'approved'`, so this closes open question 8
of docs/spec-compliance-review.md by confirming the build. (3) The contest
threshold stays undecided and is **not material for now**, so the app continues to
invent no rule.
