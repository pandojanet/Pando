# Pando MCP — the interface

> Document type: **reference**. What the founder's operating playbook (v1.2, *"Minimum technical
> interfaces to request from QC"*) asks QuitCode to document for the agents' door into Pando: auth,
> schema, audit, error behaviour, quotas, test mode and ownership. Written 20 Nov 2026; the code is
> the source of truth — `web/lib/server/mcp/server.ts` for the tools.

Pando MCP is a remote MCP server (MCP = Model Context Protocol, the way Claude calls another
system's tools) at **`https://pando.is/api/mcp`**, inside the Pando app. Every agent of the Pando
plugin for Claude ([`pando-plugin`](https://github.com/OleksandrMartynov/pando-plugin)) reaches Pando
only through it. Transport: Streamable HTTP, stateless — a new server for every request, so there is no
session to lose between deploys.

## Ownership

| What | Who |
| --- | --- |
| The server, its tools, its data rules | QuitCode, until the handover to the fractional technical owner the playbook names |
| Switching it on or off; revoking a connection | any Pando admin, at `/admin/mcp` |
| Approving what agents propose | any Pando admin, at `/admin/proposals` or in chat |
| The emergency switch-off | whoever runs the server: `PANDO_MCP=off` in its `.env`, over the admin's switch |
| The plugin (agents, skills) | QuitCode; skills the Agent builder saves go in through `save_skill` |

## Auth

OAuth 2.0 as Claude's connectors require it, on the **Pando admin login**. Only someone who can sign
in to the Pando admin can connect; every admin has full access (no roles, decision of 20 Nov).

- **Discovery:** a request without a token gets `401` and `WWW-Authenticate: Bearer
  resource_metadata="…/.well-known/oauth-protected-resource"`; that document names the
  authorization server, whose metadata is at `/.well-known/oauth-authorization-server`.
- **Clients:** Dynamic Client Registration (`POST /api/oauth/register`) or a client metadata document
  on `claude.ai` / `claude.com`. Codes go **only** to Claude's callback
  (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) or a
  loopback address (Claude Code). A registered client still needs an admin's yes on `/admin/connect`.
- **Codes and tokens:** PKCE S256 required; a code lives 5 minutes and works once; an access token
  lives 1 hour, a refresh token 30 days and works once (rotation). A refresh token presented again
  after it was rotated revokes every token descended from it — unless it was rotated in the last 30
  seconds (a retry, or two helpers at once): then it is refused without revoking its successor. Tokens are stored only as SHA-256 hashes.
  An admin who loses admin access loses their tokens at the next call.
- **Scopes:** `pando:read` (every read tool) and `pando:propose` (every tool that writes: proposals,
  decisions, `save_skill`). None asked = both; an unknown scope is refused (`invalid_scope`).
- **Revocation:** `POST /api/oauth/revoke` (RFC 7009), or *Revoke* on `/admin/mcp`, which also voids
  codes not yet exchanged.

## Data rules

- Totals are counts. No tool returns a parent's name, phone, email or id.
- A parent's words come back in two places only: the approved texts about a record (`get_record`,
  without who wrote them) and the questions Pando could not answer yet (`unanswered_questions`, without
  who asked, never the answer). Phone numbers and emails are masked in both. A question held as
  sensitive (health, legal, safety, a named person), about a caregiver, or asking for a person is
  counted, never quoted; so is a Seed Tool question that needs a person's review.
- Caregivers never leave the admin through MCP.
- A record flagged as possibly a person's name is left out of search and read without its name, venue
  or texts until an admin resolves the flag.
- Test rows (`is_test`) are left out of everything that has the flag. The message log and the job runs
  have none, so delivery and job counts include the admin's own test sends.
- Nothing an agent does texts a parent. No tool sends anything.

## Tools

An event proposed for the digest (`propose_event`) reaches parents' texts once approved, so it is held
to the digest's own rules and more (`lib/server/mcp/candidate.ts`, on proposal and again on approval):
the event's own page on a public site's name (not an address in numbers or a local machine), typed in
plain ASCII, no punycode host, no `user@host`, tracking parameters dropped, at most 400 characters,
never a listing page; no phone number, email or other link in its words; real calendar dates; not one
Pando has or had in the last 60 days (a recurring event's next date is new).

An approved event is a candidate for the whole market (it has no areas of its own). Each Saturday it
goes into every group whose window and ages it fits — at most 8 candidates a group, ahead of the
digest agent's finds in the group's list; each family's own picks still go by its children's ages and
by kind. Approved after the groups' digests were prepared, it joins the prepared ones nobody has
approved or sent (one the agent found nothing for included); an approved digest stays as approved, and
*Take out* says when one still carries it. `/admin/digests` marks such an item
*Approved event*; *Take out* on `/admin/proposals` also takes it out of prepared, unapproved digests.

A record's proposed name, venue and subcategory carry no phone number, email or link either. A skill
saved through `save_skill` may not mention `approve_proposal`, `reject_proposal`, `save_skill` or the
`admin_said_*` flags: those wait for a person every time and are never a skill's step.

`digest_weeks` for one week is a summary by default (totals and each group's state, ~1k characters) and
adds the items only with `detail: "items"` (the full week was ~32k characters on test data, past Claude
Code's 10k-token warning).

Lists (`search_records`, `list_proposals`, `digest_candidates`) answer `{ results, has_more, narrow }`:
when the list was cut, `narrow` says how to ask for less. Every tool carries `title`, `readOnlyHint`,
`destructiveHint`, `idempotentHint` and `openWorldHint: false`, so Claude runs the reads without a prompt and
always asks before a destructive one. Descriptions say what a tool does, keywords first, and never tell
Claude how to behave (Claude's connector review). A proposal keeps the record as the agent saw it
(`mcp_proposals.before`, 0075), so the admin sees "was → becomes" and "Record changed since"; a rejection
may carry the admin's reason (`decision_note`), which `list_proposals` gives back to the agent.

Writes are **proposals**: nothing changes until an admin approves — on `/admin/proposals`, or in chat
through `approve_proposal`, which needs `admin_said_yes: true` and is marked destructive so Claude asks
the person before each call. Every approval runs the same function as the admin's own button
(`applyAction`), in one transaction with its `audit_log` row.

| Tool | Reads / writes | Playbook capability |
| --- | --- | --- |
| `pando_overview` | today's totals and the review queues | `list_approval_queue` (in part) |
| `parents_totals`, `questions_totals`, `records_totals`, `impact_totals` | totals, by week | — |
| `daily_activity` | each day on Pasadena's clock; yesterday against the 7 days before | daily founder report |
| `demand_by_place`, `unanswered_questions` | where Pando is wanted; questions it could not answer | demand loop |
| `delivery_health`, `what_went_wrong` | delivery; failed jobs, undelivered texts, digest groups not ready, answers held over a day, tool errors | failure / incident |
| `digest_weeks`, `digest_candidates` | the weekly digest; events approved for it | — |
| `search_records`, `get_record` | records, their facts, source page and last check | `search_evidence` |
| `propose_new_record`, `propose_record_edit`, `propose_fact_check`, `propose_event` | **proposal** | `submit_candidate_evidence` |
| `list_proposals` | proposals and their decisions | `get_request_status`, `list_approval_queue` |
| `approve_proposal`, `reject_proposal` | **applies / closes a proposal**, after the admin's yes or no in chat | human approval |
| `save_skill` | **commits a skill into the plugin repo**, after the admin's "save" | Prompt Architect / reusable workflows |
| `costs_summary` | Twilio's billed usage; AI spend from PostHog | `log_cost_event` (read side) |

**Not here, on purpose:** `add_watch`, `cancel_watch`, `request_network_check`, `record_outcome`.
Each acts towards a parent; the plugin never texts parents, so they stay in the SMS product. A
`source_status` tool comes with Sources & partners.

## Audit

- **Every tool call that reaches a tool:** one row in `mcp_calls` — admin, connection, tool, outcome
  (`ok`, `error`, `refused`, `off`), milliseconds, rows returned. Never the arguments. A connection over
  its quota adds one row a minute (`(rate limited)`, `refused`); a call whose arguments do not fit the
  schema is refused by the MCP library before it reaches a tool and is not a row. `/admin/mcp` shows
  the last 24 hours' calls per tool; `what_went_wrong` reports errors and refusals.
- **Every change:** an `audit_log` row naming the admin — `proposal.approve` / `proposal.reject` (with
  `via: chat` or `admin`, and the connection for chat), plus the row of the change itself
  (`share.rename`, …), `skill.save`, `digest_candidate.remove`, `mcp.switch`, `mcp.revoke`.
- **Proposals** keep who proposed, the source page, who decided, where, and when (`mcp_proposals`).
- Server logs carry counts and enums only (invariant 7): never a token, code, name or argument.

## Error behaviour

| What happens | What the caller gets |
| --- | --- |
| No token, expired, revoked, or not an admin any more | `401` with the `WWW-Authenticate` pointer — Claude signs in again |
| The database or the admin list cannot be read while checking the token | `503`, `Retry-After: 5` — not a new sign-in |
| A JSON-RPC batch (an array of messages) | `400`, `-32600` — one message per request |
| Too many requests (below) | `429`, `Retry-After`, `RateLimit-*` headers |
| Pando MCP switched off | the tool answers *"Pando MCP is switched off in the Pando admin."* (`isError`); never a 401, so no sign-in loop |
| A read-only connection calls a tool that writes | *"This connection may only read…"* (`isError`, outcome `refused`) |
| Arguments that do not fit the tool's schema | JSON-RPC error `-32602`, naming the field |
| A proposal Pando refuses (past event, record gone, duplicate, …) | one sentence saying why (`isError`, outcome `refused`) |
| Anything else that fails | *"That didn't work just now. Try again in a minute."* (`isError`, outcome `error`; the log keeps the error's class only) |
| OAuth endpoints | RFC 6749 errors: `invalid_grant`, `invalid_scope`, `invalid_target`, `invalid_request`, `temporarily_unavailable` |

## Load and retention

- A read tool runs in a **read-only** transaction with a **10 s** statement limit: it cannot write, and a
  slow query cannot hold a connection the SMS side shares. `costs_summary`, which waits on Twilio and
  PostHog, runs outside one.
- A token's "last used" is written at most every five minutes, not on every call.
- The nightly `mcp_prune` job deletes codes a day after they expired, tokens 30 days after they were
  revoked or ran out, clients nobody signed in through after 30 days, and calls after 90 days.
- `demand_by_place` shows a count of 1 or 2 as `"<3"`.
- Revoking an admin (`npm run admin:user -- disable <name>`) ends their Claude connections at once.
- Slack alerts (`critical_alerts`) include 5+ tool failures in 30 minutes and a connection stopped by
  its quota.

## Quotas

| Limit | Ceiling | Counted per |
| --- | --- | --- |
| `mcp` | 120 requests a minute | connection (one admin in one Claude) |
| `mcp_day` | 3,000 requests a day | connection |
| `oauth` | 120 requests a minute | address |
| `oauth_register` | 30 registrations an hour | address |
| client registrations | 500 in 30 days; ones never used for a sign-in are dropped after a day | the whole server |
| waiting proposals | 100 at once | admin |

Schedules (the 8am brief, the weekly review) are Cowork scheduled tasks, not Pando jobs; Pando's
numbers are on Pasadena's clock (`daily_activity`, and weeks Monday–Sunday in the weekly totals).

Counters live in the app's memory (`lib/server/rate-limit.ts`): one container, so one set of counters;
a deploy resets them. `costs_summary` keeps a result for an hour.

## Test mode

There is no test switch on production. Everything is tried in the lab first (`.chat-lab`, the local
database on `127.0.0.1:55432`, the admin on `localhost:3100`): `.chat-lab/tmp/mcp-walk.mjs` walks the
whole sign-in and every read tool, and `tmp/mcp-call.mjs <tool> '<json>'` calls one tool;
`save_skill` there writes to a local copy of GitHub (`tmp/mock-github.mjs`), never the real repo.
`npm --prefix web run test:mcp` checks the rules above in the code, and `test:mcp-db` runs them against a
real Postgres: an in-memory PGlite on 127.0.0.1, every migration applied, the real route handlers called
for sign-in, refresh, every read tool, a proposal applied with its audit row, the switch, the cleanup and
the alerts. Both run in the gate.

## Configuration

`PANDO_MCP` (`off` overrides the admin's switch) · `MCP_BASE_URL` (the public origin, if not
`NOTIFY_BASE_URL`) · `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_HOST` (AI spend) ·
`PLUGIN_GITHUB_TOKEN`, `PLUGIN_GITHUB_REPO`, `PLUGIN_GITHUB_BRANCH` (`save_skill`). Twilio's existing
credentials give the SMS spend. Turning it on: [DEPLOY.md](../../DEPLOY.md#turning-on-pando-mcp-20-nov).
