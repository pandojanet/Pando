-- Admin sign-in moves into the database.
--
-- `ADMIN_CREDENTIALS` got the important half right — one scrypt record per
-- person, no password stored anywhere, the cost parameters inside each record —
-- and the operational half wrong. Adding an admin, rotating a password, or
-- removing someone who left all meant editing an environment variable and
-- redeploying. **Revoking access needed a deploy**, which is the one operation
-- that must never wait for a build.
--
-- What does not change: the hash is still scrypt, still self-describing, still
-- the only thing stored. This table holds exactly what the env var held, plus
-- the three facts a credential store has to answer and a string could not:
-- who is still allowed in (`active`), when their password last changed, and when
-- they last used it.
--
-- The env variables remain as a **bootstrap fallback** — see `lib/admin/auth.ts`.
-- A deploy that adds this table must not take the admin dark before anyone has
-- been added to it.

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /* The actor string in every `audit_log` row. Constrained to the same shape the
     env records allowed, because that is what makes one readable in a log line —
     and because a name with a comma or colon in it used to break the parser. */
  name text NOT NULL UNIQUE,

  /* `scrypt:<N>:<r>:<p>:<salt-base64url>:<hash-base64url>` — the env record
     without the leading name. The CHECK is the point: it is what makes storing a
     plaintext password here a database error rather than a code review finding.
     A hash is never a passphrase, and this column can hold nothing else. */
  password_hash text NOT NULL,

  /* Deactivation rather than deletion. Their name stays resolvable in the audit
     log — a decision about a named caregiver keeps the name of whoever made it,
     including after they leave. */
  active boolean NOT NULL DEFAULT true,

  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz,

  CONSTRAINT admin_users_name_check
    CHECK (name ~ '^[a-z0-9][a-z0-9._-]*$'),
  CONSTRAINT admin_users_hash_check
    CHECK (password_hash ~ '^scrypt:[0-9]+:[0-9]+:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$')
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS admin_users_active_idx
  ON admin_users (name) WHERE active;--> statement-breakpoint

-- The same posture as every other table (0002): a Supabase project exposes
-- PostgREST publicly, and a table without RLS is readable by anyone holding the
-- anon key. Enabled with no policies is Postgres for "deny", and the REVOKE is
-- the belt to that braces — of every table in this database, this is the one
-- whose rows are worth the most to a stranger.
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON admin_users FROM anon, authenticated;--> statement-breakpoint

-- Missed when 0004 added it: a claim carries a caregiver's own answers and links
-- to their `people` row. Same one-line posture, same reason.
ALTER TABLE caregiver_claims ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON caregiver_claims FROM anon, authenticated;--> statement-breakpoint

-- ── What this migration asserts about itself ───────────────────────────────
-- The same style as 0002: a CHECK that has never been fired is a claim, not a
-- guarantee. This one matters more than most — it is the difference between
-- "we hash admin passwords" and "this column cannot hold anything else".
DO $$
BEGIN
  BEGIN
    INSERT INTO admin_users (name, password_hash)
    VALUES ('__check__', 'correct-horse-battery-staple');
    RAISE EXCEPTION 'CHECK admin_users_hash_check did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO admin_users (name, password_hash)
    VALUES ('Janet, Admin', 'scrypt:65536:8:1:c2FsdA:aGFzaA');
    RAISE EXCEPTION 'CHECK admin_users_name_check did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  DELETE FROM admin_users WHERE name = '__check__';
END $$;
