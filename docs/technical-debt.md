# Technical debt

> Document type: **register**. Shortcuts taken on purpose, each with the event that makes
> it due and what to do then. An entry is removed in the change that pays it. A choice
> that is not a shortcut is a row in [decisions.md](decisions.md).

## decisions.md is 890 KB

**Now.** [decisions.md](decisions.md) holds 402 rows in one table, newest first
(`grep -c '^| ' docs/decisions.md`, minus the header and the separator). It is not loaded
into sessions; CLAUDE.md says to `grep` it by area. The `| --- |` separator sits at row
184 instead of under the header, so the top of the file does not render as a table.

**Due when** a grep for an area returns more rows than can be read in one sitting, or a
reader misses a decision because it sat in an unrelated row.

**Then.** Split by area (the seed flow, caregivers, SMS and outreach, admin, payments,
infrastructure), one file each under `docs/decisions/`, and keep `decisions.md` as the
index. Move the separator under the header.

## Code comments still point at "CLAUDE.md" for decisions

**Now.** 61 lines under `web/` mention CLAUDE.md (`git grep -n CLAUDE.md -- web`), many
of them to say a decision "is recorded in CLAUDE.md" — for example
`components/admin/kit.tsx`, `app/(seed)/join/page.tsx`, `web/.env.example`. Decisions moved to [decisions.md](decisions.md) on 4 Oct 2026, and the
invariants to [.claude/rules/invariants.md](../.claude/rules/invariants.md).

**Due when** each of those files is next changed for another reason.

**Then.** Point the comment at the file that now holds it, in that change.

## A changed migration is caught at commit, not at the write

**Now.** The agent's PreToolUse hook blocks Edit and Write on a committed migration,
but not a Bash command that writes one (`sed -i`, `perl -pi`, `rm -rf web/drizzle`): a
path cannot be read reliably out of command text, and trying blocked plain reads. The
git pre-commit hook refuses the commit instead. A person can still skip it with
`git commit --no-verify`; only the agent is stopped from doing that.

**Due when** a changed migration reaches `main` anyway.

**Then.** A CI step on pull requests that fails when a file under `web/drizzle/` that
exists on the target branch is modified or deleted (`_journal.json` excepted).

## CI runs no database

**Now.** CI runs typecheck, the offline suites and the build. The `*-live` suites,
`test:e2e` and `test:compliance` need the hosted database, which is production, so they
run by hand with the user's "yes". No job proves the migration chain replays from empty.

**Due when** Pando gets a second database (staging or a local Supabase stack), or a
migration fails on production.

**Then.** A CI job with a Postgres service: apply `web/drizzle/` from empty, assert the
applied count equals the journal's, then run `test:compliance` against it.
