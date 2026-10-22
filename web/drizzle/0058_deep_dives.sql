-- Deep Dive (21 Oct): a structured report on one question — the top options
-- ranked, why each fits this family, what parents near them say, and roughly
-- how far each is — built from Pando's records plus a deeper web search, and
-- sent over SMS.
--
-- Its own table rather than a value on `answers`, because the thing the client
-- wants to MEASURE is the offer, not the report: how many parents are offered a
-- deep dive, how many say yes, and how many ask for one themselves. A row is
-- written when Pando offers (or is asked), and every later state is an update
-- of that row — so "offered, never answered" stays visible instead of being
-- reset the way `spendBlastOffer` resets `answers.next_step`.
--
-- The report itself is an `answers` row (`answer_id`), so what was sent is
-- stored and reviewable exactly as every other answer is.
--
-- status:
--   offered        Pando offered it at the end of an answer; waiting for DEEP
--   awaiting_topic the parent asked for one without saying about what
--   generating     accepted or asked for; the report is being built
--   sent           the report went out
--   failed         it could not be built or sent (the parent was told)
--   unsupported    asked for on a subject a deep dive does not cover (care,
--                  health, legal, safety) — answered the ordinary way instead
--
-- An offer that is never accepted simply stays `offered`; its age says it lapsed.
CREATE TABLE deep_dives (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid REFERENCES people(id) ON DELETE CASCADE,
  market_id        text NOT NULL DEFAULT 'pasadena',
  -- The parent's question, as asked. Stored for the same reason
  -- `answers.question_text` is: the report is about it. Never logged.
  question         text,
  trigger          text NOT NULL,
  status           text NOT NULL,
  -- The answer that carried the offer (proactive), and the report itself.
  source_answer_id uuid REFERENCES answers(id) ON DELETE SET NULL,
  answer_id        uuid REFERENCES answers(id) ON DELETE SET NULL,
  -- How many SMS parts the report went out in.
  parts            integer,
  -- Which offer wording was sent (lib/deep-dive.ts DEEP_DIVE_OFFER_VERSION),
  -- so a rewording can be compared against the yes-rate it replaced.
  offer_version    text,
  -- The report's quality, as counts: whether the model's draft was used at
  -- all, how many reasons survived the check, and how the options split
  -- between parents and public pages. Low interest and a bad report must be
  -- told apart.
  drafted          boolean,
  reasons_kept     integer,
  parent_options   integer,
  public_options   integer,
  is_test          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  accepted_at      timestamptz,
  sent_at          timestamptz,
  CONSTRAINT deep_dives_trigger_check CHECK (trigger IN ('proactive', 'explicit')),
  CONSTRAINT deep_dives_status_check CHECK (status IN
    ('offered', 'awaiting_topic', 'generating', 'sent', 'failed', 'unsupported')),
  CONSTRAINT deep_dives_parts_check CHECK (parts IS NULL OR parts BETWEEN 1 AND 6)
);--> statement-breakpoint
CREATE INDEX deep_dives_person_created ON deep_dives (person_id, created_at DESC);--> statement-breakpoint
CREATE INDEX deep_dives_status_created ON deep_dives (status, created_at DESC);
