-- M9.3 — what a contributor actually did that helped somebody.
--
-- 9.4 computes tiers "from activity", and 9.3's job is to make activity a thing
-- that exists: without a record of *which* contribution reached *which* parent,
-- a tier can only be computed from submission counts — which rewards volume
-- rather than usefulness, and is exactly the "points" the estimate says the
-- reward must not be.
--
-- ## Why an event log rather than counters on `people`
--
-- Because the strategy's grove (13) promises impact receipts — "your answer
-- reached her in 20 minutes — she booked it" — and a counter cannot say what it
-- counted. An event carries what happened, when, and to which record, so the
-- receipt is a read rather than a second thing to maintain.
--
-- It is also append-only by nature. A tier that dropped because a counter was
-- recomputed differently would be a status taken away from somebody who did
-- nothing wrong.
CREATE TABLE IF NOT EXISTS impact_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  -- What it was about, when there is something to point at. Nullable because a
  -- blast answer that created no record is still impact.
  share_id   uuid REFERENCES shares(id) ON DELETE SET NULL,
  blast_id   uuid REFERENCES blasts(id) ON DELETE SET NULL,
  -- The admin's 1-5 rating where there was one (7.6). Null otherwise.
  quality    integer,
  is_test    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impact_events_kind_check
    CHECK (kind IN ('contribution_approved', 'blast_answered',
                    'freshness_confirmed', 'answer_used')),
  CONSTRAINT impact_events_quality_check
    CHECK (quality IS NULL OR (quality >= 1 AND quality <= 5))
);--> statement-breakpoint

COMMENT ON TABLE impact_events IS
  'M9.3. One row per thing a contributor did that helped: a contribution approved, a Network Ask answered, a freshness ping confirmed, an answer that reached a parent. Tiers (9.4) and the grove (strategy 13) are both reads over this. Append-only: a status taken away from somebody who did nothing wrong is worse than a stale one.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS impact_events_person_idx
  ON impact_events (person_id, created_at DESC)
  WHERE NOT is_test;--> statement-breakpoint

-- One event per thing. A contribution approved twice — a status flipped back and
-- forth by an admin — must not count twice.
CREATE UNIQUE INDEX IF NOT EXISTS impact_events_once
  ON impact_events (person_id, kind, coalesce(share_id, blast_id, person_id));
