-- Estimate 2.2's per-link funnel: "drop-off is measured as a per-link funnel
-- (opens vs completions per channel) rather than per person".
--
-- Completions per channel already existed — `/admin/invites` shows arrivals and
-- how many of them delivered an approved contribution. The missing half was
-- **opens**: how many people the link reached at all, which is what turns two
-- bare numbers into a funnel and answers "did this channel bring the wrong
-- people, or did it not bring anyone".
--
-- ## Why a counter here rather than a PostHog query
--
-- `seed_link_opened` is already instrumented, and PostHog is the right place to
-- *analyse* it. But the admin must work with PostHog unconfigured — that is the
-- same honesty rule as `persisted: false` — and the overview cannot ask a third
-- party a question it needs to render a queue. So the count lives with the invite
-- it belongs to.
--
-- ## What this number is and is not
--
-- It counts server-rendered opens of `/join?i=<code>`, so it includes bots,
-- link-preview fetches and a parent opening the same link twice. That inflation
-- is roughly uniform across channels, which is what makes the *comparison*
-- between them usable even though no single figure is a headcount. It is
-- deliberately not de-duplicated: doing so needs an identifier before consent,
-- and nothing about a person may be stored before their number is verified
-- (invariant 11).
ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS opens integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;--> statement-breakpoint
