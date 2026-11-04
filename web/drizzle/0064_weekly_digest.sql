-- The weekly digest (3 Nov): one text every Saturday to a parent who said yes to
-- it, with what is on locally — events, camps, classes, opportunities.
--
-- The consent box on /join has named "a weekly digest" since 2 Nov (registered
-- A2P copy), and nothing sent one. The developer's decisions: its own separate
-- yes; every Saturday for now (holidays later); the agent finds the items and
-- it goes out without an approval step; events and opportunities only; it does
-- not count toward the contributor-protection limits; it may run to several
-- segments.
--
-- Four changes, all widening or new:
--   * consents.scope + 'digest' — the separate yes, append-only like every
--     consent (0028, 0057): the newest row for the scope is the answer.
--   * message_log.category + 'digest' — its own category, so quiet hours and
--     opt-out apply to it (lib/server/sms.ts) and the invariant-5 counters,
--     which read category = 'outreach', never see it.
--   * digest_editions / digest_items — what the agent found for a market and a
--     Saturday, kept so a week is sent from one set and can be read back.
--   * digest_sends — one row per person per edition, the guard that makes a
--     second run that Saturday send nothing twice.
ALTER TABLE consents DROP CONSTRAINT consents_scope_check;--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consents_scope_check
  CHECK (scope in ('sms','sms_recurring','follow_up','blast','reference',
                    'caregiver_profile','caregiver_listing',
                    'caregiver_introduction','caregiver_reference',
                    'listening_ear','pilot_launch','digest'));--> statement-breakpoint

ALTER TABLE message_log DROP CONSTRAINT message_log_category_check;--> statement-breakpoint
ALTER TABLE message_log ADD CONSTRAINT message_log_category_check
  CHECK (category in ('transactional','outreach','digest'));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS digest_editions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     text NOT NULL,
  -- The Saturday it is for, on the market's clock.
  edition_date  date NOT NULL,
  -- ready: items to send · empty: the agent finished and found nothing ·
  -- failed: it ended badly (a deadline, a cut-off reply) and is tried again,
  -- up to three attempts a Saturday (lib/digest.ts, `DIGEST_AGENT_ATTEMPTS`).
  status        text NOT NULL DEFAULT 'ready',
  attempts      integer NOT NULL DEFAULT 1,
  -- A test run's edition (the lab, or an admin trying it): sent only to test
  -- people, and never the one a real Saturday sends from.
  is_test       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digest_editions_status_check CHECK (status IN ('ready', 'empty', 'failed')),
  CONSTRAINT digest_editions_one_per_week UNIQUE (market_id, edition_date, is_test)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS digest_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id    uuid NOT NULL REFERENCES digest_editions(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  kind          text NOT NULL,
  title         text NOT NULL,
  -- When, as a parent reads it ("Sat Nov 7, 10am-2pm"), and as dates to filter on.
  when_text     text NOT NULL,
  starts_on     date,
  ends_on       date,
  place         text,
  -- Ages it is for; both null is everyone.
  age_min       integer,
  age_max       integer,
  summary       text NOT NULL,
  url           text NOT NULL,
  CONSTRAINT digest_items_kind_check CHECK (kind IN ('event', 'camp', 'class', 'opportunity')),
  CONSTRAINT digest_items_ages_check CHECK (
    (age_min IS NULL OR age_min BETWEEN 0 AND 99) AND
    (age_max IS NULL OR age_max BETWEEN 0 AND 99) AND
    (age_min IS NULL OR age_max IS NULL OR age_min <= age_max)),
  CONSTRAINT digest_items_url_check CHECK (url ~ '^https?://')
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS digest_sends (
  edition_id    uuid NOT NULL REFERENCES digest_editions(id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- Claimed before the send, so nobody is sent one edition twice.
  item_count    integer NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (edition_id, person_id)
);--> statement-breakpoint

ALTER TABLE digest_editions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE digest_items    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE digest_sends    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON digest_editions FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON digest_items    FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON digest_sends    FROM anon, authenticated;
