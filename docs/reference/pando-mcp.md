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
| Approving what agents propose | any Pando admin, at `/admin/proposals` — only there (23 Nov) |
| The emergency switch-off | whoever runs the server: `PANDO_MCP=off` in its `.env`, over the admin's switch |
| The plugin (skills, agents, connectors) | the client, without QuitCode: the Agent builder proposes a change (`propose_plugin_change`) and an admin commits it on `/admin/proposals`; QuitCode keeps the rules below |
| The sources & partners list | any Pando admin, by approving `propose_source` proposals |

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
- **Codes and tokens:** PKCE S256 required; a code lives 5 minutes and works once, and is spent only by
  a request carrying its own client, redirect and verifier (checked in the statement that marks it
  used, so nobody else can burn it). A code presented again after it was exchanged revokes the tokens it
  bought and every pair rotated from them (RFC 6749 §4.1.2). An access token lives 1 hour, a refresh
  token 30 days and works once (rotation). A refresh token presented again after it was rotated revokes
  every token descended from it — at once, with no grace period (23 Nov: a 30-second grace kept a
  thief's racing refresh alive). Tokens are stored only as SHA-256 hashes. An admin who loses admin
  access loses their tokens at the next call; a new password (their own change, or the CLI's
  `password`) and `disable` revoke them at once.
- **Bearer check:** a token not shaped like Pando's (`pma_` and 43 base64url characters) is refused
  without a database read; an address whose well-shaped tokens keep failing is refused (`429`) before
  the read (`mcp_bad_token`).
- **Issuer:** the public origin is `MCP_BASE_URL`, `NOTIFY_BASE_URL` or `NEXT_PUBLIC_SITE_URL`, else
  `https://pando.is` in production — never the request's `Host` header. Only local development falls
  back to the request's origin.
- **Consent:** `/admin/connect` says to allow only a connection you just started from your own Claude.
- **Scopes:** `pando:read` (every read tool) and `pando:propose` (every tool that writes: proposals and
  `record_source_check`). None asked = both; an unknown scope is refused (`invalid_scope`).
- **Revocation:** `POST /api/oauth/revoke` (RFC 7009), or *Revoke* on `/admin/mcp`, which also voids
  codes not yet exchanged.

## Data rules

- Totals are counts. No tool returns a parent's name, phone, email or id.
- A parent's words come back in two places only: the approved texts about a record (`get_record`,
  without who wrote them) and the questions Pando could not answer yet (`unanswered_questions`, without
  who asked, never the answer). Phone numbers, emails and a child's first name are masked in both
  (`maskContactDetails`, then `maskNames`; a name is read from the sentence's shape, so a lowercase one
  after "for" or one in no shape at all is not caught — hence the next rule). A question held as
  sensitive (health, legal, safety, a named person), about a caregiver, or asking for a person is
  counted, never quoted; so is a Seed Tool question that needs a person's review.
- Caregivers never leave the admin through MCP.
- A record flagged as possibly a person's name is left out of search and read without its name, venue
  or texts until an admin resolves the flag; `propose_new_record`'s "already known" does not count it
  either, so a guessed name cannot be confirmed that way.
- A record comes with its **trust labels**, verbatim from `lib/trust-labels.ts` (`trust_labels`, and
  `public_only` when no parent stands behind it) — the only words an agent may use for where it came from
  (invariants 3, 4). `search_records` returns approved records unless asked for another status.
- Test rows (`is_test`) are left out of everything that has the flag, the admin's test digest editions
  included. The message log and the job runs have none, so delivery and job counts include the admin's
  own test sends.
- The sources & partners list holds organisations and feeds only — no person's name, email or phone.
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
approved or sent (one the agent found nothing for included), **first** in the list, as in a group
prepared after it; an item the admin took out does not count toward the edition's 12, and an edition
already full is said in the result (*"N prepared digests are full"*). An approved digest stays as
approved, and *Take out* says when one still carries it. `/admin/digests` marks such an item
*Approved event*; *Take out* on `/admin/proposals` also takes it out of prepared, unapproved digests.

A record's proposed name, venue and subcategory carry no phone number, email or link either.

### Changing the plugin itself (23 Nov)

The client changes the Pando plugin without QuitCode: a **skill**, an **agent** (subagent) or a
**connector** (a remote MCP server), created, updated or deleted. The Agent builder reads the plugin
(`read_plugin`: the index, or one file to start an edit from) and proposes one change per file
(`propose_plugin_change`). Pando renders the file at once, against the plugin as it is, and keeps that
text and the blob it was made on (`base_sha`). `/admin/proposals` shows the change as lines removed and
added, with what it lets the plugin do in plain words above it; *Commit to plugin* commits it to the
plugin's branch with the patch version raised (`commitPluginChange`, an `audit_log` row
`plugin.commit`), then marks the proposal applied. No pull request (20 Nov). Rules
(`lib/server/mcp/plugin-repo.ts`), whatever a proposal says:

- **Pando writes every frontmatter** from plain fields: a skill's name, description, argument hint; an
  agent's name, description, tools, model. No hooks, `mcpServers` or permission mode.
- **An agent's tools** (since 24 Nov) are `pando-tools:`, each by its own name: `Read`, `Grep`, `Glob`,
  `WebFetch`, `WebSearch`, Pando's tools (`search_records` — `lib/mcp/tool-names.ts`, the list the server
  registers from) and `<connector>:<tool>` for a connector the plugin declares. A long name
  (`mcp__claude_ai_Pando__search_records`) is accepted and read for its own name, so a deciding tool
  cannot slip in under one. Every agent gets `disallowedTools: Bash, Write, Edit, NotebookEdit`; the
  plugin's hook (`hooks/agent-tools.mjs`) holds it to its list on any connection. Never Claude's
  `tools:` — it needs the long name `mcp__<connection>__<tool>`, whose middle changes with how Pando was
  connected, and an agent whose list named another connection got no tools and was refused. An agent
  that reads Gmail or other accounts connected to Claude (`account_connectors`) also gets
  `pando-accounts: true`, every read tool and every Pando read; of Pando's changes, only the ones it names.
- **A connector** is `{ "type": "http", "url": … }` at an `https://` address on a public host, with no
  user, key or query in it, no headers, no local command; each person signs in to it in Claude.
- **Supabase and PostHog stay read-only.** The plugin carries them as `supabase`
  (`https://mcp.supabase.com/mcp?project_ref=…&read_only=true&features=database,docs,debugging`) and
  `posthog` (`https://mcp.posthog.com/mcp?readonly=true&features=…`); the read-only switch is in the
  address, so a proposal can remove them but never change them, and no second connector to
  `mcp.supabase.com` or `mcp.posthog.com` is accepted (`READ_ONLY_CONNECTORS`).
- **Text** carries no phone number or email, and no step that approves, rejects or saves.
- **Cannot be removed** (can be changed): the `pando` connector, the `customize` and `pando-data`
  skills, the `agent-builder` agent. `shared/` (the safety rules) is not reachable at all.
- **One waiting change per file.** A file changed after the proposal is never overwritten: the commit is
  refused and the proposal waits, to be rejected and proposed again. The commit renders the change again
  under the rules of the day and refuses anything that is not exactly what the admin read.
- `PLUGIN_GITHUB_TOKEN` needs Contents read and write on the plugin repo only.

`digest_weeks` for one week is a summary by default (totals and each group's state, ~1k characters) and
adds the items only with `detail: "items"` (the full week was ~32k characters on test data, past Claude
Code's 10k-token warning).

Lists (`search_records`, `list_proposals`, `digest_candidates`, `list_sources`) answer `{ results, has_more, narrow }`:
when the list was cut, `narrow` says how to ask for less. Every tool carries `title`, `readOnlyHint`,
`destructiveHint`, `idempotentHint` and `openWorldHint: false`, so Claude runs the reads without a prompt and
always asks before a destructive one. Descriptions say what a tool does, keywords first, and never tell
Claude how to behave (Claude's connector review). A proposal keeps the record as the agent saw it
(`mcp_proposals.before`, 0075), so the admin sees "was → becomes" and "Record changed since"; a rejection
may carry the admin's reason (`decision_note`), which `list_proposals` gives back to the agent.

Writes are **proposals**: nothing changes until the founder decides. Every decision runs `applyAction`,
in one transaction with its `audit_log` row. Waiting proposals are listed oldest first, decided ones newest
first.

**Decided in the chat, since 24 Nov — except a change to the plugin.** `approve_proposal` and
`reject_proposal` decide a record, an edit, a fact check, a digest event or a source, through the same
`applyAction` as the admin's buttons, recorded `decided_via: chat` (and `via: chat` in the audit row) — a
value only Pando MCP sets, never a request's body. A change to the plugin itself (`propose_plugin_change`)
is refused there (`plugin_admin_only`) and decided only on `/admin/proposals`, where the admin reads it
line by line and *Commit to plugin* commits it.

What makes the chat's yes the person's (the 23 Nov review removed the old tools because their
`admin_said_yes` was an argument the agent filled in itself):

- **No such argument.** The yes is the person allowing the call: both tools are `destructiveHint: true`,
  so Claude asks before each one (the server refuses to register a deciding tool that is not destructive).
  The plugin says to keep them on *Ask*, never *Allow always* — a setting the person controls, which is
  the residual risk, said plainly.
- **No agent has them.** `lib/mcp/tool-names.ts` marks them `decide`; `plugin-repo.ts` refuses them in any
  agent the client proposes and denies them in a deny-list agent; the plugin's `check-agents.mjs` checks
  QuitCode's agents, and the Partner analyst — which reads the inbox — denies them by name. So text an
  agent read on a page or in an email never sits next to the tool; it reaches the main conversation only
  as an agent's report, which the plugin's shared rule 2 treats as data.
- **No skill scripts one.** A proposed skill or agent that names them is refused (`DECIDING`); the rule
  for deciding lives in the plugin's `shared/safety.md` (rule 3), which no proposal can reach.
- **A ceiling.** `mcp_decide`: 30 decisions an hour per connection; a read-only connection cannot decide.

The one direct write besides is `record_source_check` (when a source was read and how that went — never
shown to a parent).

| Tool | Reads / writes | Playbook capability |
| --- | --- | --- |
| `pando_overview` | today's totals and the review queues | `list_approval_queue` (in part) |
| `parents_totals`, `questions_totals`, `records_totals`, `impact_totals` | totals, by week; sign-ups by channel (`people.source` and the invite's kind — `JOIN_CHANNELS` in `mcp-read.ts`), with what each channel's parents went on to do; "did it help" over every sent answer, optionally between two days | — |
| `daily_activity` | each day on Pasadena's clock; yesterday against the 7 days before | daily founder report |
| `demand_by_place`, `unanswered_questions` | where Pando is wanted; questions it could not answer | demand loop |
| `delivery_health`, `what_went_wrong` | delivery; failed jobs, undelivered texts, digest groups not ready, answers held over a day, tool errors | failure / incident |
| `digest_weeks`, `digest_candidates` | the weekly digest; events approved for it | — |
| `search_records`, `get_record` | records, their facts, trust labels, source page and last check; search by what the last check found or not checked since a date | `search_evidence` |
| `propose_new_record`, `propose_record_edit`, `propose_fact_check`, `propose_event` | **proposal** | `submit_candidate_evidence` |
| `list_sources` | the sources & partners list, least recently checked first | — (the features sheet's "sources & partners list") |
| `propose_source` | **proposal**: add an organisation or feed, or change, pause or retire one | — ("Keeps the partner list") |
| `record_source_check` | writes when a source was read and how (ok, failed, changed, gone) | `source_status` |
| `read_plugin` | the plugin's skills, agents and connectors; one file's text | — |
| `propose_plugin_change` | **proposal**: create, update or delete a skill, an agent or a connector; committed when an admin commits it | Prompt Architect / reusable workflows |
| `list_proposals` | proposals and their decisions | `get_request_status`, `list_approval_queue` |
| `approve_proposal`, `reject_proposal` | **decide** one waiting proposal, on the person's own word in the chat (not a plugin change) | `approve_request`, `reject_request` |
| `remove_digest_candidate` | **decide** an event out of the weekly digest's candidates (and out of any digest prepared but not approved), on the person's own word in the chat — the page's `digest_candidate.remove`, audited as decided in chat; kept, never deleted | — |
| `set_budget` | **decide** the monthly SMS and/or AI budget, on the person's own figure in the chat; the half not named stays, null removes one (`budget.set`, audited as set in chat) | — |
| `contributor_load` | requests, replies, PASSes and thank-yous in a window; who cannot be asked today and why (ceiling, 48-hour gap, governor); opt-outs after a request — counts only, the send layer's own rules | daily report: contributor pings / replies / fatigue |
| `costs_summary` | Twilio's billed usage (UTC days); AI spend from PostHog (Pasadena days); useful answers and the cost per one; for a period inside one month, each monthly budget (SMS, AI — said in the chat, kept by `set_budget` in `app_settings.monthly_budget`) beside its spend: left, share used, over, the pace for the month; the budget shows even when that half's spend is not configured | `log_cost_event` (read side) |

**Not here, on purpose:** `add_watch`, `cancel_watch`, `request_network_check`, `record_outcome`.
Each acts towards a parent; the plugin never texts parents, so they stay in the SMS product.
Approving or rejecting a proposal, and committing a change to the plugin, happen only on `/admin/proposals`.

## Audit

- **Every tool call that reaches a tool:** one row in `mcp_calls` — admin, connection, tool, outcome
  (`ok`, `error`, `refused`, `off`), milliseconds, rows returned. Never the arguments. A connection over
  its quota adds one row a minute (`(rate limited)`, `refused`); a call whose arguments do not fit the
  schema is refused by the MCP library before it reaches a tool and is not a row. Rows returned count
  the list inside an answer (`results`, `weeks`, `groups`, `questions`). `/admin/mcp` shows the last 24
  hours' calls per tool; `what_went_wrong` reports errors and refusals.
- **Every change:** an `audit_log` row naming the admin — `proposal.approve` / `proposal.reject`, plus
  the row of the change itself (`share.rename`, …), `plugin.commit`, `digest_candidate.remove`,
  `mcp.switch`, `mcp.revoke`. Decisions made in chat before 23 Nov keep `via: chat`.
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
| The switch cannot be read (the database did not answer, twice) | *"Pando's database didn't answer just now, so nothing was read or changed…"* (`isError`, outcome `error`) — refused, but never called "switched off" (24 Nov) |
| The call takes longer than 30 s | *"That took longer than 30 seconds, so Pando stopped waiting…"* — a read changed nothing; a proposal may have been made, so check `list_proposals` (outcome `error`) |
| A read-only connection calls a tool that writes | *"This connection may only read…"* (`isError`, outcome `refused`) |
| Arguments that do not fit the tool's schema | JSON-RPC error `-32602`, naming the field |
| A proposal Pando refuses (past event, record gone, duplicate, …) | one sentence saying why (`isError`, outcome `refused`) |
| An outside service does not answer (GitHub for the plugin) | its sentence, e.g. *"GitHub did not answer just now; try again."* (`isError`, outcome `error`, reason `outside_service`) |
| Anything else that fails | *"That didn't work just now. Try again in a minute."* (`isError`, outcome `error`; the log keeps a reason code — `deadline`, `database_unreachable`, `query_timeout`, `database_error`, `unexpected` — never the message (`mcp_calls.reason`, 0080)) |
| OAuth endpoints | RFC 6749 errors: `invalid_grant`, `invalid_scope`, `invalid_target`, `invalid_request`, `temporarily_unavailable` |

## Load and retention

- A read tool runs in a **read-only** transaction with a **10 s** statement limit: it cannot write, and a
  slow query cannot hold a connection the SMS side shares. `costs_summary`, which waits on Twilio and
  PostHog, runs outside one.
- A token's "last used" is written at most every five minutes, not on every call; when that write
  fails the token still works.
- **A lost connection is tried once more, for reads only** (24 Nov, `readWithRetry` in
  `lib/server/db.ts`): a read tool's transaction, the switch and the token lookup run again after
  250 ms when the socket closed, never opened or was sent away (`isTransientDbError`). A statement's own
  error (a syntax error, a timeout, a constraint) is never retried, and a write never is — its first try
  may have committed. Both tries stay inside the call's 30-second deadline.
- The app's pool is **15** sockets on Supabase's transaction pooler (was 5, 24 Nov), shared by the SMS
  side, the jobs, the admin and Pando MCP; the call log row is written after the answer.
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
| `oauth_token` | 30 token requests a minute | client (every Claude arrives from Anthropic's range) |
| `oauth_register` | 30 registrations an hour | address |
| `mcp_bad_token` | 60 unknown tokens a minute, then refused before the database | address |
| client registrations | 500 in 30 days; ones never used for a sign-in are dropped after a day | the whole server |
| waiting proposals | 100 at once, counted under a lock | admin |

Schedules (the 8am brief, the weekly review) are Cowork scheduled tasks, not Pando jobs; Pando's
numbers are on Pasadena's clock (`daily_activity`, and weeks Monday–Sunday in the weekly totals).

Counters live in the app's memory (`lib/server/rate-limit.ts`): one container, so one set of counters;
a deploy resets them. `costs_summary` keeps a result for an hour.

## Test mode

There is no test switch on production. Everything is tried in the lab first (`.chat-lab`, the local
database on `127.0.0.1:55432`, the admin on `localhost:3100`): `.chat-lab/tmp/mcp-walk.mjs` walks the
whole sign-in and every read tool, and `tmp/mcp-call.mjs <tool> '<json>'` calls one tool;
a plugin change committed there goes to a local copy of GitHub (`tmp/mock-github.mjs`), never the real repo; `test:mcp-db` runs the whole path — read, propose, commit, a stale file refused, a connector, a folder removed — against a GitHub stand-in on 127.0.0.1.
`npm --prefix web run test:mcp` checks the rules above in the code, and `test:mcp-db` runs them against a
real Postgres: an in-memory PGlite on 127.0.0.1, every migration applied, the real route handlers called
for sign-in, refresh, every read tool, a proposal applied with its audit row, the switch, the cleanup and
the alerts. Both run in the gate.

## Configuration

`PANDO_MCP` (`off` overrides the admin's switch) · `MCP_BASE_URL` (the public origin, if not
`NOTIFY_BASE_URL` or `NEXT_PUBLIC_SITE_URL`; `https://pando.is` in production otherwise) ·
`POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_HOST` (AI spend) ·
`PLUGIN_GITHUB_TOKEN`, `PLUGIN_GITHUB_REPO`, `PLUGIN_GITHUB_BRANCH` (reading the plugin and committing an approved change). Twilio's existing
credentials give the SMS spend. Turning it on: [DEPLOY.md](../../DEPLOY.md#turning-on-pando-mcp-20-nov).
