-- Introductions (21 Oct): parent to parent, through a person at Pando.
--
-- The client: a parent asks about an activity, Pando answers and adds "a couple
-- of parents near you go there too, want an introduction?". The developer: the
-- parent leaves a request, an admin approves it, contacts the other parent and,
-- if they agree, creates the chat outside the app — Pando keeps the request and
-- its statuses so everyone can see how it is going.
--
--   offered → requested → approved → contacted → connected
--                       ↘ rejected   ↘ rejected  ↘ declined
--
-- `offered` rows exist so the yes-rate is countable, the same reason as
-- deep_dives (0058). The record is kept by id and by name: the name is what the
-- parent was told, and survives the record being renamed or retired.
--
-- No contact detail is stored here: the parents are rows in `people`, and the
-- chat itself happens outside Pando.
CREATE TABLE introductions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id        uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  share_id            uuid REFERENCES shares(id) ON DELETE SET NULL,
  share_name          text,
  -- The answer that carried the offer, or the one an explicit request was about.
  answer_id           uuid REFERENCES answers(id) ON DELETE SET NULL,
  trigger             text NOT NULL,
  status              text NOT NULL,
  -- The parent the admin contacted, and who agreed (or not).
  other_parent_id     uuid REFERENCES people(id) ON DELETE SET NULL,
  -- The admin's last word on it: why it was not taken forward, what was agreed.
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  requested_at        timestamptz,
  decided_at          timestamptz,
  decided_by          text,
  contacted_at        timestamptz,
  closed_at           timestamptz,
  is_test             boolean NOT NULL DEFAULT false,
  CONSTRAINT introductions_trigger_check CHECK (trigger IN ('proactive', 'explicit')),
  CONSTRAINT introductions_status_check CHECK (status IN
    ('offered', 'requested', 'approved', 'contacted', 'connected', 'declined', 'rejected')),
  CONSTRAINT introductions_note_length CHECK (note IS NULL OR char_length(note) <= 500),
  -- Somebody was contacted before anybody can be connected or decline. Keyed on
  -- the time, not on other_parent_id: that one is SET NULL when the other parent
  -- deletes themselves, and a CHECK on it made their DELETE fail (review, 21 Oct).
  CONSTRAINT introductions_contacted_has_time CHECK
    (status NOT IN ('contacted', 'connected', 'declined') OR contacted_at IS NOT NULL),
  CONSTRAINT introductions_not_self CHECK (other_parent_id IS NULL OR other_parent_id <> requester_id)
);--> statement-breakpoint
CREATE INDEX introductions_requester_created ON introductions (requester_id, created_at DESC);--> statement-breakpoint
CREATE INDEX introductions_status_created ON introductions (status, created_at DESC);--> statement-breakpoint
-- One open request per parent and record: a retried webhook or a second INTRO
-- can never make two.
CREATE UNIQUE INDEX introductions_one_open ON introductions (requester_id, share_id)
  WHERE status IN ('requested', 'approved', 'contacted') AND share_id IS NOT NULL;
