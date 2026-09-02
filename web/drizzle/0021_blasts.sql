-- M7 — a Network Ask and who it went to.
--
-- Two tables, because they answer different questions and have different
-- lifetimes: `blasts` is what the parent asked and what they were promised;
-- `blast_recipients` is who Pando decided to ask and what came back.
--
-- ## The tier names follow the 8.18 strategy, not the estimate
--
-- Estimate 7.2 lists five tiers — passive, standard (~20), targeted (~25),
-- precision (~15) and last-minute care (~35). The client's own *Pando Strategy —
-- Current Direction* (Aug 2026) §8 replaces that: **Passive (free) · Board Ask
-- $5 · Targeted Ask $15 · Last-Minute Care (free in the pilot)** — and says
-- outright that human review of an unusual match "absorbed what we once called
-- Precision". The newer client document wins, which is CLAUDE.md's own rule.
--
-- The pool sizes differ by more than the names. The estimate's targeted tier is
-- ~25 people; the strategy's is "three to five carefully matched parents", and
-- §6 explains why: "Pando never sends a question to everyone — that's how group
-- chats train people to ignore things." Twenty-five is a broadcast; five is a
-- request. The CHECK below encodes the strategy's shape.
CREATE TABLE IF NOT EXISTS blasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     text NOT NULL DEFAULT 'pasadena',
  asker_id      uuid REFERENCES people(id) ON DELETE SET NULL,
  question_text text NOT NULL,
  category      text,
  -- Read from the asker's profile, never from a request body — the same rule as
  -- the demand signal's neighborhood (11 Aug).
  neighborhood  text,
  tier          text NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  -- What the tier promised, kept on the row: a tier's configuration may change
  -- and this parent was promised what was in force when they asked.
  pool_target   integer NOT NULL,
  -- 7.7's window. A blast not fulfilled by then is flagged, and a paid one earns
  -- an automatic credit — the strategy's guarantee is the point of the price.
  expires_at    timestamptz,
  -- Strategy §8: a question with unusual or stacked requirements gets a human
  -- reviewing the match before anything is sent. Last-Minute Care always does.
  human_review  boolean NOT NULL DEFAULT false,
  -- Which credit paid for it, when one did. 7.7: a credit-funded blast is
  -- refunded as a credit, never as money.
  credit_id     uuid REFERENCES credits(id) ON DELETE SET NULL,
  is_test       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  fulfilled_at  timestamptz,
  CONSTRAINT blasts_tier_check
    CHECK (tier IN ('passive', 'board', 'targeted', 'last_minute')),
  CONSTRAINT blasts_status_check
    CHECK (status IN ('draft', 'pending_review', 'active', 'fulfilled',
                      'expired', 'refunded', 'cancelled')),
  CONSTRAINT blasts_pool_target_check CHECK (pool_target >= 0),
  -- A passive entry contacts nobody by definition (7.2, and 7.11 is what it is
  -- for): it is a question logged against a neighborhood, not an outreach.
  CONSTRAINT blasts_passive_contacts_nobody
    CHECK (tier <> 'passive' OR pool_target = 0)
);--> statement-breakpoint

COMMENT ON TABLE blasts IS
  'A Network Ask. Tiers follow the 8.18 strategy: passive (free, contacts nobody), board ($5, the open board), targeted ($15, three to five parents), last_minute (free in the pilot). Precision was absorbed into targeted as a human-review flag.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS blasts_open_idx
  ON blasts (status, expires_at)
  WHERE status IN ('active', 'pending_review');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS blasts_demand_idx
  ON blasts (market_id, neighborhood, category)
  WHERE NOT is_test;--> statement-breakpoint

-- Who was asked, and what came back.
CREATE TABLE IF NOT EXISTS blast_recipients (
  blast_id      uuid NOT NULL REFERENCES blasts(id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- Why this person, from the matcher — so a pool can be argued with later,
  -- exactly as the 6.7 harness shows it now.
  match_score   numeric(6,2),
  match_reasons jsonb,
  sent_at       timestamptz,
  -- Set by the inbound webhook when a reply arrives (7.5). The link is what the
  -- response-rate governor counts.
  responded_at  timestamptz,
  -- The reply itself. Held here rather than in message_log, which deliberately
  -- stores no free text: this is a contribution and needs a human before it is
  -- used (invariant 8), which is what review_status is for.
  response_text text,
  review_status text NOT NULL DEFAULT 'pending_review',
  -- 7.6: the admin's rating, which feeds credits and tiers.
  quality       integer,
  -- PASS (strategy §6): "an effortless exit — no follow-up, no penalty, and
  -- nothing recorded against you". Recorded on the blast so the question can move
  -- on immediately; deliberately NOT counted as a non-response by the governor.
  passed_at     timestamptz,
  PRIMARY KEY (blast_id, person_id),
  CONSTRAINT blast_recipients_review_check
    CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
  CONSTRAINT blast_recipients_quality_check
    CHECK (quality IS NULL OR (quality >= 1 AND quality <= 5))
);--> statement-breakpoint

COMMENT ON COLUMN blast_recipients.passed_at IS
  'They replied PASS. The strategy calls this an effortless exit with nothing recorded against them, so it is not a non-response: the governor must not count it.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS blast_recipients_person_idx
  ON blast_recipients (person_id, sent_at DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS blast_recipients_review_idx
  ON blast_recipients (review_status)
  WHERE response_text IS NOT NULL;
