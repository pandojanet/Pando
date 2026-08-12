-- 2C — the caregiver's own flow (G1–G10).
--
-- Additive only: nothing existing changes shape, because the parent-side
-- nomination path (1.6) is in use and must keep working untouched.
--
-- ## Why a *claim* and not a caregiver row
--
-- The invite the parent sends carries no token — `pando.is/caregiver`, one shared
-- link, for the same reason the parent invite is one shared link, plus a harder
-- one: Pando holds no contact detail for a nominated caregiver (invariant 13), so
-- there is nothing to put a token against. A caregiver therefore arrives
-- self-identified and unlinked, and we cannot know which nomination is theirs.
--
-- Matching them by name would be the one thing `cards.ts` already refuses to do:
-- "name and initial aren't an identifier", and folding two people called Maria G.
-- together would blend their strengths, their pay bands and their consent state.
--
-- And they must not simply create their own listing. The client's rule (kickoff
-- call, 51:01): "the only way that a caregiver can be on Pando is if a parent has
-- sent them a link." A self-made `caregivers` row would also be indistinguishable
-- from a parent nomination, which is exactly the hole invariant 4 exists to close —
-- a "vouched by a parent" label requires `provenance = parent_submitted` *and* a
-- real contributor behind it.
--
-- So this table holds what the caregiver said about themselves, keyed to their own
-- verified identity in `people`, and an admin attaches it to a nomination. Until
-- they do, the claim is invisible to every answering path: it is not a caregiver.
CREATE TABLE IF NOT EXISTS caregiver_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- G1. One person, one identity, keyed by phone (invariant 10) — the caregiver
  -- gets a `people` row like anyone else, and `phone_verified_at` on it is what
  -- proves this claim belongs to a reachable human.
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  market_id text NOT NULL DEFAULT 'pasadena',
  first_name text NOT NULL,
  -- Initial only, the same rule as the nomination side: never a full surname.
  last_initial char(1),

  -- G3–G7, the profile itself.
  roles_wanted text[] NOT NULL DEFAULT '{}',
  age_experience text[] NOT NULL DEFAULT '{}',
  areas_served text[] NOT NULL DEFAULT '{}',
  drives boolean,
  days_available text[] NOT NULL DEFAULT '{}',
  hours_note text,
  rate_band text,
  -- The client asked for this by name on the kickoff call ("recommend that
  -- caregiver to someone looking from August 2027"). A band rather than a date:
  -- a date goes stale silently, and what a matching query needs is "is this
  -- person available in the window I'm asking about".
  available_from text,

  -- G8–G10. Three separate decisions, and stored as three columns rather than one
  -- "visibility" level for the same reason the parent's three consents are
  -- separate: they are different levels of exposure and one must not imply another.
  open_to_reference_intros boolean NOT NULL DEFAULT false,
  appear_in_answers boolean NOT NULL DEFAULT false,
  open_to_introductions boolean NOT NULL DEFAULT false,
  consent_text_version text NOT NULL,

  status text NOT NULL DEFAULT 'pending',
  linked_caregiver_id uuid REFERENCES caregivers(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT caregiver_claims_status_check
    CHECK (status IN ('pending', 'linked', 'declined')),
  -- The same rule the caregivers table enforces one level up: being introduced is
  -- more exposure than appearing in an answer, so it cannot be the only yes.
  CONSTRAINT claim_ladder_order
    CHECK (NOT open_to_introductions OR appear_in_answers),
  -- Re-running the flow updates the claim rather than adding a second one. A
  -- caregiver changing their mind about their hours is not a new person.
  CONSTRAINT caregiver_claims_person_key UNIQUE (person_id)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS caregiver_claims_pending_idx
  ON caregiver_claims (created_at DESC)
  WHERE status = 'pending';--> statement-breakpoint

-- Mirrors the claim column, so a linked profile carries it too.
ALTER TABLE caregiver_profiles
  ADD COLUMN IF NOT EXISTS available_from text;--> statement-breakpoint

-- The caregiver's own permissions, recorded where every other consent already
-- lives, so "what did this person agree to, and under which wording" has one
-- answer per person rather than one per surface. `caregiver_profile` was already
-- allowed here — the schema was written expecting 2C.
ALTER TABLE consents DROP CONSTRAINT IF EXISTS consents_scope_check;--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consents_scope_check
  CHECK (scope IN (
    'sms',
    'follow_up',
    'blast',
    'reference',
    'caregiver_profile',
    'caregiver_listing',
    'caregiver_introduction',
    'caregiver_reference'
  ));--> statement-breakpoint

-- Invariant 1 asserted again, now that a second surface can move the ladder: a
-- caregiver is visible only when they have consented *and* are active. The claim
-- never sets these — an admin does, after linking — but the check belongs next to
-- the new table so the next person to touch it sees the rule.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM caregivers
    WHERE (consent_status <> 'consented' OR NOT active) AND discoverable
  ) THEN
    RAISE EXCEPTION 'invariant 1: a caregiver is discoverable without consent';
  END IF;
END $$;
