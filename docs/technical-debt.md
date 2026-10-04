# Technical debt

> Document type: **register**. Shortcuts taken on purpose, each with the event that makes
> it due and what to do then. An entry is removed in the change that pays it. A choice
> that is not a shortcut is a row in [decisions.md](decisions.md).

## decisions.md is 890 KB

**Now.** [decisions.md](decisions.md) holds 398 rows in one table, newest first.
It is not loaded into sessions; CLAUDE.md says to `grep` it by area. Its header row has
no `| --- |` separator, so it does not render as a table.

**Due when** a grep for an area returns more rows than can be read in one sitting, or a
reader misses a decision because it sat in an unrelated row.

**Then.** Split by area (the seed flow, caregivers, SMS and outreach, admin, payments,
infrastructure), one file each under `docs/decisions/`, and keep `decisions.md` as the
index. Add the separator row.

## Code comments still point at "CLAUDE.md" for decisions

**Now.** 60 lines under `web/` mention CLAUDE.md (`git grep -n CLAUDE.md -- web`), many
of them to say a decision "is recorded in CLAUDE.md" — for example
`components/admin/kit.tsx`, `app/(seed)/join/page.tsx`, `web/.env.example`. Decisions moved to [decisions.md](decisions.md) on 4 Oct 2026, and the
invariants to [.claude/rules/invariants.md](../.claude/rules/invariants.md).

**Due when** each of those files is next changed for another reason.

**Then.** Point the comment at the file that now holds it, in that change.

## The agent's path guard reads paths as text

**Now.** `.claude/hooks/protect-files.mjs` finds paths in a Bash command by pattern. A
path built at run time (`$(printf …)`, a variable, base64) or a write made by a script
whose source does not name the path gets past it; `test:hooks` pins one such case as a
known limit. The pre-commit secret scan and code review are the layers behind it.

**Due when** a committed migration or a vendored skill changes without a reviewer
noticing.

**Then.** Add a CI step that fails when a file under `web/drizzle/` that exists on the
target branch is modified.

## CI runs no database

**Now.** CI runs typecheck, the offline suites and the build. The `*-live` suites,
`test:e2e` and `test:compliance` need the hosted database, which is production, so they
run by hand with the user's "yes". No job proves the migration chain replays from empty.

**Due when** Pando gets a second database (staging or a local Supabase stack), or a
migration fails on production.

**Then.** A CI job with a Postgres service: apply `web/drizzle/` from empty, assert the
applied count equals the journal's, then run `test:compliance` against it.
