-- A parent's older SMS exchanges, kept as a structured memory (12 Nov).
--
-- The classifier reads the last 12 question/answer exchanges of the last 7 days
-- (`earlierExchangesFor`); anything older dropped off, so "the swim lessons I
-- asked about at the start" pointed at nothing. The developer: keep the whole
-- context once a conversation passes twelve exchanges — and never store
-- anything sensitive.
--
-- One row per person. `asks` holds what the exchanges that left the window
-- were about, and nothing in anyone's words: each entry is a topic from a
-- fixed list, an area from the market's list, when it suits them and their
-- reaction from fixed lists, and the date (`lib/conversation-memory.ts`,
-- `readMemoryAsks`). A free-text summary, then names of suggested places, were
-- built first and dropped the same day: two blind reviews showed that neither
-- word lists nor "found in Pando's answer" keep a diagnosis, a child's name, a
-- faith or an address out.
--
-- `covers_through` is the newest exchange folded in; nothing older than it, or
-- than the person's last STOP, or than 90 days, is folded again. Deleted with
-- the person (DELETE), cleared on STOP, and swept after 90 days without
-- activity (`expire_memory`).
CREATE TABLE IF NOT EXISTS conversation_summaries (
  person_id       uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  asks            jsonb NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(asks) = 'array' AND jsonb_array_length(asks) <= 30),
  covers_through  timestamptz NOT NULL,
  model           text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS conversation_summaries_updated_at_idx ON conversation_summaries (updated_at);--> statement-breakpoint

ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON conversation_summaries FROM anon, authenticated;
