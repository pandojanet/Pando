# Validation rules

> Document type: **rules**. How a change in this repository is proven before it is called
> done. [CLAUDE.md](../../CLAUDE.md) says what done means; this file says how to prove it,
> and wins where the `self-review` skill disagrees.

## 1. Gate

```bash
npm --prefix web run gate     # tsc --noEmit, then every offline test:* suite
npm --prefix web run build    # before a PR, and for anything touching config or routes
```

`npm test` reads the `test:*` list from `web/package.json`, so a new suite joins by being
added there. It leaves out what reaches real services — `web/scripts/run-tests.mjs` names
them. CI runs typecheck → test → build on every branch and PR.

**What the gate does not prove:** that a screen works, that a migration applies, anything
the `*-live` suites, `test:e2e` or `test:compliance` check (they need the live database or
a running server), and anything about production data. Each of those is §2.

Anything failing, skipped or not run is the first line of the report.

## 2. Proof by area

**UI.** Types and tests do not prove a screen works — a render loop, a CSS import that
resolves to nothing or a menu placed off-screen passes all of them. Run the
dev server and the `mobile-ui-review` skill at 375px; look at the screenshots. Cover the
empty, error and resume states of the flow you touched.

**Database.** The `db-migration` skill. The hosted Supabase project is the only database
and it is production, so `npm run migrate`, any write and any `*-live` suite need the
user's "yes" in this conversation first. `npm run check` is read-only and safe.

**SMS, outreach and money.** `test:outreach` and `test:compliance` pin invariant 5's
numbers; `test:payments` and `test:relay` cover the guarantee and the relay.
[phase-2-test-plan](../phase-2-test-plan.md) is the walk through the Slack relay.

**Hooks and guards** (`.claude/hooks`, `.githooks`). `test:hooks` and `test:githooks`
check the logic and the wiring. A guard counts as working only after a real attempt it
blocked in a session — with input that would otherwise succeed, because Edit validates
its input before a PreToolUse hook runs, so an invalid probe never reaches the hook.

**A reported defect.** Reproduce it before accepting how it was described, and fix the
cause, not the trigger. A regression test is shown failing on the old code first.

## 3. Review

Run by the `self-review` skill. The rules it must satisfy here:

1. **Full scope** — `git status --porcelain`; untracked files are part of the change.
2. **Size** — above roughly 15 files or 800 changed lines, one reviewer per area below;
   otherwise one reviewer with every checklist the touched areas name.
3. **Blind reviewers** — the file list, the area's checklists and the repository. Never
   the author's summary.
4. **Every finding verified** against the code: CONFIRMED · PLAUSIBLE · dropped, then
   fixed or rejected with the reason.

| Area | Paths | Checklists | Project checks |
|---|---|---|---|
| Auth & access | `web/proxy.ts`, `web/lib/seed-gate.ts`, `web/lib/admin/`, `web/lib/server/{admin-auth,gate,verify,rate-limit}.ts`, `web/app/api/admin` | Auth & access · Tests | Invariant 11: the phone comes from the verification, never the request. The seed gate is a marker, not authentication. |
| Data & API | `web/app/api/`, `web/lib/server/`, `web/lib/*.ts` | Data access & API contract · Tests | Invariants 1, 3, 4, 7, 12 at the query, not the screen. `lib/server/db.ts` is the only file with a connection string; unset `DATABASE_URL` answers `persisted: false`. |
| SMS & payments | `web/lib/server/{sms,inbound,slack,stripe}.ts`, `web/app/api/{sms,slack,stripe,jobs}`, `web/lib/{outreach-policy,payments,sms-*}.ts` | Data access & API contract · Tests | Invariant 6's order; no raw Twilio call. Stripe's webhook is the only evidence of payment. |
| Database | `web/drizzle/`, `web/lib/db/`, `web/scripts/` (seeds, backfills), `supabase/` | Database & migrations · Scripts & data fixes | The `db-migration` skill. A committed migration is never edited. |
| UI | `web/app/(seed)`, `(caregiver)`, `(admin)`, `(site)`, `web/components/` | UI · Tests | `pando-design-system`, `mobile-first-ui`; flows per `tap-first-flow`. |
| CI, deploy & agent tooling | `.github/`, `web/Dockerfile`, `deploy/`, `.claude/`, `.githooks/`, `web/package.json` | CI & workflows · Containers · Tests | The `deploy-ops` skill: impact, rollback, operator actions. |
| Docs | `docs/**`, `*.md` | — | The doc says what the code does; a contradiction is a defect in the same change. |

## 4. Done

- [ ] **Reuse searched** — [code-map](code-map.md) and the code; the report says what was
      searched and what was found.
- [ ] **Gate and area proof** (§1, §2), each with its real output. Every number in a doc,
      PR or report comes from a command run in this session, and the same number reads the
      same everywhere it appears.
- [ ] **Tests** for new pure logic. Expected values are literals, never computed by the
      code under test; a criterion names a property ("the instalments sum to the total"),
      not only one expected value.
- [ ] **Review** (§3) on the full change; `/security-review` when it touches auth, SMS,
      payments, secrets or personal data.
- [ ] **Docs in the same change** — CLAUDE.md → "Keeping this file current".
- [ ] **Not verified** — named first in the report, with why.
