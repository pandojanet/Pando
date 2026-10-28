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

## A question about one named place is answered with a list that leaves it out

**Now.** Walked in the SMS lab on 28 Oct: after "swim lessons for my 4 year old in Pasadena" and "what about for my 8 year old?", the text "is the first one good for a shy kid?" was rewritten correctly (*Is the City of Pasadena Aquatics Program good for a shy 8 year old learning to swim?*), but the answer listed two other places and not that one. A place the question names leads only when it is a parent's record (`rank: mentionsName(body, share.name) ? -1 : i` in `lib/server/inbound.ts`); the place here is a web result. The cause past that was not traced. The rewrite (`standalone`) was uncommitted work that day.

**Due when** the `standalone` rewrite is committed.

**Then.** Give the web search the named place as its subject, and answer honestly when no parent has used it ("no one I know has used it; here is what its page says").

## The care reply is the same for a swallowed battery as for a rash

**Now.** "My 2 year old swallowed a battery and is drooling" gets `highStakesReply` (`lib/answer-routing.ts`): 911, an after-hours line, 988, legal help, and "please reach someone qualified **today**". It is correct and a person is flagged, but it names no Poison Control (1-800-222-1222) and says nothing about minutes. The copy is marked there as new user-facing copy on the list for the client, so it was not changed.

**Due when** the next round of client copy.

**Then.** Ask the client to approve a second wording for swallowing, choking and not breathing that says "now" and gives Poison Control; pick it in `highStakesReply` from the existing `HEALTH_HELP` words in `lib/intent.ts`.

## No cap on inbound texts per number

**Now.** `/api/sms/inbound` checks Twilio's signature and nothing else, so a real number can send without limit and each text runs the classifier and may run a web search. The 27 Oct review left a throttle step and webhook replay for a decision (see its row in [decisions.md](decisions.md)); this is the same gap seen from the cost side.

**Due when** the model bill shows a spike that one number explains, or the pilot opens beyond the first cohort.

**Then.** Count inbound texts per number per hour in the route before `after()`, answer the first one over the limit with one plain sentence and stay silent after it, and record the limit in decisions.md (the handler's rule is one reply per message, so this is a decision, not a fix).

## Two SQL arrays are built by string

**Now.** `lib/server/repo/admin-read.ts` (`ARRAY['${ids.join("','")}']::uuid[]`) and `lib/server/repo/profile.ts` (`sql.raw("ARRAY[" … "]::text[]")`, quotes doubled by hand) build an array literal from values. Both are safe today: the first takes ids the same query read from `people`, the second doubles every quote. `app/api/market/search/route.ts` is held by a `[a-z0-9-]` filter.

**Due when** either function is next changed, or a third copy appears.

**Then.** Build the array with `sql.join(values.map((v) => sql`${v}`), sql`, `)` inside `ARRAY[ … ]`, so nothing is concatenated, and check it against Postgres in the same change.
