-- One invite per group, not per parent.
--
-- The 31 Jul decision — reaffirmed 12 Aug against QC Answers Q3 — is that there is
-- no unique link per founding contributor. This table does not change that and must
-- not be turned into it: a row here is a *group* ("Field Elementary PTA"), shared by
-- everyone in that group, and the moment a row means one person, cross-device
-- resume, automatic referral attribution and `/seed/[token]` all come with it.
--
-- What it buys: the question Janet cannot answer today — which group actually
-- delivered contributors, rather than which group was sent a link.
--
-- `SEED_INVITE_CODES` stays as the fallback, so an unconfigured or unreachable
-- database still lets a parent in on the built-in codes. Same honesty rule as
-- `persisted: false` everywhere else.
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What goes in the URL. Lowercase and hyphenated, like every other id a person
  -- can type: `?i=pta-field`.
  code text NOT NULL UNIQUE,
  market_id text NOT NULL,
  -- Shown to the parent ("You joined through Field Elementary PTA"), so it is
  -- written the way a human would say it, not slugified.
  label text NOT NULL,
  -- Optional link to `market_options.parent_groups`. When set, P6 can confirm the
  -- group instead of asking for it — and only the parent's *yes* writes the
  -- affinity edge. A forwarded link is not evidence of membership.
  group_option_value text,
  active boolean NOT NULL DEFAULT true,
  -- The admin's own note: where it was posted, who runs the group.
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by text
);--> statement-breakpoint

ALTER TABLE invites
  ADD CONSTRAINT invites_code_check
  CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint

-- Which invite this contributor arrived on. `people.invite_code` already stores the
-- raw string; this is the resolved row, so the admin can count per group without
-- matching text. Null for everyone who arrived before this existed, on a retired
-- code, or with no code at all — all three are ordinary states.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS invite_id uuid REFERENCES invites(id) ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS people_invite_idx ON people (invite_id) WHERE NOT is_test;
