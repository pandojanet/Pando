-- What the July documents ask for and 0000–0005 do not have.
--
-- Four unrelated additions in one migration because they arrived from one review
-- pass over three client documents (spec v3.2, the Product Strategy paper, and
-- "Pando — QC Answers + A2P Prep"). Each one is annotated with where it comes
-- from, so a future session can tell a requirement from a preference.

-- 1. answer_ready — spec v3.2 §15.1, §17.1, §21.1, and §23.1 step 9.
--
-- The pre-launch "golden answer" pass: an admin marks the records that are already
-- complete enough to power an excellent answer with no Blast behind them. It lives
-- on `places` rather than on `place_contributions` because the thing that answers a
-- question is the venue/class, not one parent's sentence about it.
--
-- The CHECK is the point of the column. "Ready to answer with" must be a superset
-- of "reviewed by a human", or the flag becomes a way to route unreviewed
-- parent text into an answer — which is invariant 8 with extra steps.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS answer_ready boolean NOT NULL DEFAULT false;--> statement-breakpoint

ALTER TABLE places
  ADD CONSTRAINT places_answer_ready_check
  CHECK (NOT answer_ready OR status = 'approved');--> statement-breakpoint

-- 2. The asker's neighborhood on a demand signal — spec v3.2 §9 and §15.1, and
-- QC Answers Q7 ("log the question with neighborhood — this becomes your
-- market-expansion demand signal"). Three independent requests for the same
-- column, which is what it takes to know a field is not decoration.
--
-- Nullable on purpose: the anonymous path has no `people` row to read it from, and
-- an invented neighborhood would corrupt the one number this column exists to
-- produce — demand per area.
ALTER TABLE demand_signals
  ADD COLUMN IF NOT EXISTS neighborhood text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS demand_signals_area_idx
  ON demand_signals (neighborhood, category)
  WHERE NOT is_test;--> statement-breakpoint

-- 3. The fourth D1 class — Product Strategy, "Safety classes": negative claims
-- about a named nanny, doctor, teacher or parent get "human review only; never
-- broadly circulated or automatically written into the knowledge base".
--
-- It is a separate class rather than a flavour of high_stakes because the two ask
-- for different things: high_stakes is owed professional resources, an allegation
-- is owed silence until a person has read it. The second CHECK is what makes the
-- rule structural instead of a habit — no code path can store one of these as
-- self-serve knowledge, whatever it forgets.
ALTER TABLE demand_signals
  DROP CONSTRAINT IF EXISTS demand_signals_sensitivity_check;--> statement-breakpoint

ALTER TABLE demand_signals
  ADD CONSTRAINT demand_signals_sensitivity_check
  CHECK (sensitivity IN ('ordinary','peer_support','high_stakes','named_allegation'));--> statement-breakpoint

ALTER TABLE demand_signals
  ADD CONSTRAINT demand_signals_allegation_review_check
  CHECK (sensitivity <> 'named_allegation' OR requires_human_review);--> statement-breakpoint

-- 4. Caregiver Stage 1, the three captures the Product Strategy lists and the card
-- did not ask for: "schedule pattern; whether the caregiver is still employed;
-- duration and recency; rate, hours and benefits".
--
-- Duration is `how_long`, recency is `last_worked`, and "still employed" is
-- `last_worked = 'current'` — so no column is added for those three. What was
-- genuinely missing is the shape of the week, its size, and what came with the job:
-- an hourly band alone cannot tell a guaranteed-hours 40-hour role from ten hours
-- of date nights, and pay benchmarking on the first is worthless without the rest.
--
-- All three are nullable and every one of them is skippable in the flow. They sit
-- inside the same `pay_benchmark_consent` decision, which is why they are asked
-- immediately before it.
ALTER TABLE caregiver_nominations
  ADD COLUMN IF NOT EXISTS schedule_pattern text[];--> statement-breakpoint

ALTER TABLE caregiver_nominations
  ADD COLUMN IF NOT EXISTS hours_per_week text;--> statement-breakpoint

ALTER TABLE caregiver_nominations
  ADD COLUMN IF NOT EXISTS benefits text[];
