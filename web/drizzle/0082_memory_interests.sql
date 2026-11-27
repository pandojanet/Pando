-- 27 Nov: a family's conversation memory becomes one entry per topic that is never pushed out by another
-- (lib/conversation-memory.ts: MemoryInterest, MEMORY_MAX_INTERESTS 150) — the developer: the memory feeds
-- the weekly digest and the open answers, so nothing a family asked about may be forgotten. The 12 Nov CHECK
-- held 30 asks; this widens it to 200. Widening only: every row that passed the old CHECK passes the new one,
-- and no row is rewritten (old one-ask entries are read and merged by topic in code, `validMemory`).
-- The constraint's name is the one Postgres gave 0066's inline CHECK (checked on production, 27 Nov).
ALTER TABLE conversation_summaries DROP CONSTRAINT IF EXISTS conversation_summaries_asks_check;--> statement-breakpoint
ALTER TABLE conversation_summaries ADD CONSTRAINT conversation_summaries_asks_check
  CHECK (jsonb_typeof(asks) = 'array' AND jsonb_array_length(asks) <= 200);
