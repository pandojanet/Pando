-- M13 — the payment half of the Twilio/Stripe milestone, and the retry half of 13.4.
--
-- Two unrelated things in one migration because both are columns on tables that
-- already exist and neither is worth its own file: money on `blasts`, and the
-- link between a failed send and the one that replaced it on `message_log`.
--
-- ## Why the price is stored on the row
--
-- The same reasoning as `pool_target`, which is already here for it: a tier's
-- configuration can change, and **this parent was charged what was in force when
-- they asked**. Reading `TIERS[tier].price_cents` at refund time would refund
-- whatever the tier costs today, which is either short-changing somebody or
-- paying them extra — and neither is recoverable from the row.
--
-- ## The price list conflict, recorded rather than resolved silently
--
-- Estimate 13.5 says "the configured tier prices ($5 / $12 / $20 / $35)". That
-- is the estimate's own older five-tier scheme, unchanged between the 26 Aug and
-- 3 Sep versions of the workbook, and it does not match the client's *Pando
-- Strategy — Current Direction* (8.18) §8, which names **Passive (free) · Board
-- Ask $5 · Targeted Ask $15 · Last-Minute Care (free in the pilot)**. CLAUDE.md's
-- rule is that the newer client document wins, and `lib/blast-tiers.ts` already
-- encodes the strategy's four. So there is no price list in this schema at all:
-- the amount comes from `blast-tiers.ts` at checkout time and is then frozen
-- here. Changing the prices stays a one-file edit; it never becomes a migration.
--
-- ## What `payment_status` is for, and what it is not
--
-- It is the state of *the money*, kept apart from `status`, which is the state of
-- the *question*. A blast can be `fulfilled` and `refund_due` at the same time —
-- 7.7's guarantee is "no useful answer in the window, automatic credit", and an
-- admin refunding a card payment for a blast that did get answers is a different
-- decision from one that expired. Folding them into one column would make those
-- two states unrepresentable.
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required';--> statement-breakpoint
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS stripe_session_id text;--> statement-breakpoint
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;--> statement-breakpoint
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS paid_at timestamptz;--> statement-breakpoint
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS refunded_at timestamptz;--> statement-breakpoint
-- Why a refund happened, in the admin's own words. 13.7 is a *manual* flow for
-- the first ~60 days, so the reason is the only record of the judgement — the
-- same rule as `claim.decline` and `share.retire`.
ALTER TABLE blasts ADD COLUMN IF NOT EXISTS refund_reason text;--> statement-breakpoint

ALTER TABLE blasts DROP CONSTRAINT IF EXISTS blasts_payment_status_check;--> statement-breakpoint
ALTER TABLE blasts ADD CONSTRAINT blasts_payment_status_check
  CHECK (payment_status IN ('not_required', 'pending', 'paid',
                            'refund_due', 'refunded', 'failed'));--> statement-breakpoint

ALTER TABLE blasts DROP CONSTRAINT IF EXISTS blasts_price_check;--> statement-breakpoint
ALTER TABLE blasts ADD CONSTRAINT blasts_price_check CHECK (price_cents >= 0);--> statement-breakpoint

-- A free tier and a credit-funded blast both owe nothing, so neither may carry a
-- price or a payment state. Without this, a `passive` row could be marked `paid`
-- for $15 and the payments page would report revenue that never existed.
ALTER TABLE blasts DROP CONSTRAINT IF EXISTS blasts_free_owes_nothing;--> statement-breakpoint
-- Written as a plain implication — free ⇒ owes nothing — rather than an
-- equivalence. The converse is deliberately *not* asserted: a paid tier can
-- legitimately sit at `not_required` with a zero price for the moment between
-- being drafted and checkout opening, and a CHECK forbidding that would make
-- the ordinary creation path fail.
ALTER TABLE blasts ADD CONSTRAINT blasts_free_owes_nothing
  CHECK (
    NOT (tier IN ('passive', 'last_minute') OR credit_id IS NOT NULL)
    OR (payment_status = 'not_required' AND price_cents = 0)
  );--> statement-breakpoint

-- Paid means there is a payment to point at. A `paid` row with no Stripe id is
-- either a bug or somebody marking a row by hand, and both are worth refusing:
-- 13.7's refund flow has nothing to refund without it.
ALTER TABLE blasts DROP CONSTRAINT IF EXISTS blasts_paid_needs_evidence;--> statement-breakpoint
ALTER TABLE blasts ADD CONSTRAINT blasts_paid_needs_evidence
  CHECK (
    payment_status NOT IN ('paid', 'refund_due', 'refunded')
    OR (stripe_payment_intent_id IS NOT NULL AND paid_at IS NOT NULL)
  );--> statement-breakpoint

-- A refund needs its own two facts, for the same reason.
ALTER TABLE blasts DROP CONSTRAINT IF EXISTS blasts_refund_needs_reason;--> statement-breakpoint
ALTER TABLE blasts ADD CONSTRAINT blasts_refund_needs_reason
  CHECK (
    payment_status <> 'refunded'
    OR (refunded_at IS NOT NULL AND refund_reason IS NOT NULL)
  );--> statement-breakpoint

-- One blast per Stripe session. The webhook is delivered more than once by
-- design (Stripe retries until it gets a 2xx), so the *database* has to be what
-- makes activation idempotent rather than a check in the handler.
CREATE UNIQUE INDEX IF NOT EXISTS blasts_stripe_session_uniq
  ON blasts (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;--> statement-breakpoint

-- 14.5's page is "paid blasts, credit-funded blasts, status, and refund needs",
-- which is one scan over anything that is not free.
CREATE INDEX IF NOT EXISTS blasts_payments_idx
  ON blasts (payment_status, created_at DESC)
  WHERE payment_status <> 'not_required' OR credit_id IS NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN blasts.payment_status IS
  'The state of the money, separate from `status` which is the state of the question. not_required (free tier or a credit paid), pending (checkout open), paid, refund_due (an admin decided one is owed), refunded, failed.';--> statement-breakpoint
COMMENT ON COLUMN blasts.price_cents IS
  'What was actually charged, in US cents, frozen at checkout. Never read the tier price at refund time — the tier may have changed since.';--> statement-breakpoint

-- ── 13.4, the retry half ────────────────────────────────────────────────────
--
-- `message_log` records that Pando sent something and, since 0020, what the
-- carrier said happened to it. What it could not say is that **two rows are one
-- message**: a send that failed for a transient reason and the attempt that
-- replaced it.
--
-- That matters for one specific reason, and it is a promise rather than a tidy-up.
-- Every contributor-protection counter reads this table — the monthly allowance,
-- the request gap, the response-rate governor (`repo/outreach.ts`). A retry
-- written as an ordinary row would spend a parent's allowance **twice for one
-- message they received once**, which is exactly the ceiling invariant 5 exists
-- to keep. So a retry points at what it is retrying, and every counter excludes
-- rows that do.
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS retry_of uuid
  REFERENCES message_log(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE message_log ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE message_log DROP CONSTRAINT IF EXISTS message_log_retry_count_check;--> statement-breakpoint
ALTER TABLE message_log ADD CONSTRAINT message_log_retry_count_check
  CHECK (retry_count >= 0 AND retry_count <= 3);--> statement-breakpoint

-- A retry is an outbound message about an outbound message. An inbound row can
-- never be one, and letting it be would corrupt the counters this exists to keep
-- honest.
ALTER TABLE message_log DROP CONSTRAINT IF EXISTS message_log_retry_is_outbound;--> statement-breakpoint
ALTER TABLE message_log ADD CONSTRAINT message_log_retry_is_outbound
  CHECK (retry_of IS NULL OR direction = 'out');--> statement-breakpoint

-- One retry per original: the second attempt is the retry, and a third is a
-- retry *of the retry*, which keeps the chain a chain rather than a fan.
CREATE UNIQUE INDEX IF NOT EXISTS message_log_retry_of_uniq
  ON message_log (retry_of)
  WHERE retry_of IS NOT NULL;--> statement-breakpoint

-- The sweep looks for outbound rows that failed, are recent, and have not been
-- retried. Covered here so it stays one index lookup as the table grows.
CREATE INDEX IF NOT EXISTS message_log_retriable_idx
  ON message_log (status, sent_at DESC)
  WHERE direction = 'out' AND status IN ('failed', 'undelivered');--> statement-breakpoint

COMMENT ON COLUMN message_log.retry_of IS
  'The message_log row this attempt is retrying. Rows with retry_of set are excluded from every contributor-protection counter — one message received once must not spend an allowance twice.';--> statement-breakpoint
COMMENT ON COLUMN message_log.retry_count IS
  'How many attempts preceded this one. Capped by policy at 1 retry (RETRY_LIMIT in lib/delivery.ts); the CHECK allows 3 so the policy can be loosened without a migration.';
