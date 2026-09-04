# How to test Phase 2

The third of three. [qa-checklist.md](qa-checklist.md) walks the parent and
caregiver flows in the order somebody meets them;
[test-plan-by-estimate.md](test-plan-by-estimate.md) indexes **Phase 1** by
estimate row. This one covers the SMS product — the conversation loop, Network
Asks, freshness, thanks, money and the jobs behind them — and it is written for
the Slack relay, because that is what stands in for Twilio until the number is
live.

Written 4 Sep against what is actually deployed. Where something cannot be
tested, it says so and why: those are not failures and reporting them as such
wastes a round with the client.

---

## Read this first, or half of this document reads as broken

**Nothing in Phase 2 sends unprompted, and the seed flow sends almost nothing at
all.** A walk of `/join` and the profile produces **no channel traffic** — that
is correct. Phase 1 writes to the database; its one outbound is the verification
code, and `transportFor` pins that to the real provider always, because a code
posted into a test channel is a code the parent never receives.

Three doors produce a message, and everything below goes through one of them:

| Door | What comes out |
|---|---|
| **An inbound message** | keyword replies, the settings menu, the capture script, the caregiver refusal, the acknowledgement to a question |
| **An admin action** | an approved answer, a Network Ask, a refund |
| **A job** | freshness pings, did-it-help prompts, thank-yous, retries |

**A question does not get an instant reply, and that is the design.**
`PILOT_HOLD_EVERYTHING` holds every composed answer for a person (§19), so the
loop is: question → *acknowledgement* → silence → an admin approves → answer.
The silence in the middle is a human reading, not a fault.

---

## The switches that change what "correct" means

Phase 1's four are in the other document and still apply. These are the ones
that decide what Phase 2 does at all.

| Variable | Set | Unset |
|---|---|---|
| `MESSAGING_RELAY=slack` **+** `SLACK_BOT_TOKEN` **+** `SLACK_CHANNEL_ID` | everything except verification goes to one Slack channel | the real provider, or nothing |
| `SLACK_SIGNING_SECRET` | the events door verifies | it **refuses everything** — fail-closed, like the Twilio signature |
| the three `TWILIO_*` | real texts | `not_provisioned`, and the UI says so |
| `JOBS_SECRET` | `/api/jobs/run` works | every job is refused |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | a paid Ask can be bought | `/admin/payments` paints the state red, and no blast can be paid for |

⚠ **`SLACK_API_BASE` and `TWILIO_API_BASE` must never be set in production.**
They exist so the posting path can be exercised against a local stub.

⚠ **The relay must never be enabled against real contributors.** One channel
holding every message Pando sends is a transcript of the network. It comes off
on the same deadline as `SEED_VERIFY_DEV_CODES` and the `pando` starter
password.

### Which state is this deployment in

Three commands answer all of it, and the third is the one people miss:

```bash
curl -s https://pando.is/api/health
```

```bash
curl -s https://pando.is/api/seed/verify/status
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://pando.is/api/slack/events
```

- **`404`** — the relay is off. `MESSAGING_RELAY` is not `slack`, or the token or
  channel is missing.
- **`403`** — the relay is on and the signature was refused, which is the
  **correct** answer to an unsigned request. This is the state you want.

**On the server as of 4 Sep:** database reachable · `provisioned: true`,
`dev_codes: false` · relay **on**. So a verification code goes as a real text to
a real phone, and everything else goes to Slack.

### Setting the Slack side up

Four things, and the fourth is the one that is usually missed:

1. **Event Subscriptions** → Request URL `https://pando.is/api/slack/events`,
   showing **Verified**. If it is not, press Retry — the route answers the
   handshake only when the relay is already switched on, so a URL saved before
   `MESSAGING_RELAY` was set is stuck unverified forever.
2. **Subscribe to bot events** → `message.channels` for a public channel, or
   `message.groups` for a private one. Without it Slack sends nothing even with
   a verified URL.
3. **OAuth scopes** → `chat:write`, plus `channels:history` (or
   `groups:history`).
4. **Reinstall the app after adding any scope**, then `/invite @Pando` in the
   channel. A scope in the list that the token predates does nothing.

The bot appearing under *Agents & Apps* rather than *Members* is normal.

---

## How to address a message

Everything below is a **top-level** message in the channel. You do not need to
hunt for threads: a message outside a thread is parsed for an address whether or
not that person already has one.

```
16265550003: HELP
```

**Inside a thread, do not write the prefix** — the thread *is* the address, and
until 4 Sep a prefix typed there ended up inside the message. It is stripped now
when it really is a phone number, but the habit is still worth keeping.

Both forms of the number work. `+16265550003` used to fail silently because
Slack turns it into a `tel:` link; that is fixed, and `test:relay` pins it.

### The demo cohort

Real rows, fictional numbers (the 555 convention). Nothing here is a
contributor.

| Number | Who | Useful for |
|---|---|---|
| `16265550001` | Maya, Altadena | anything |
| `16265550003` | Priya, San Marino, allowance **10** | the settings walk |
| `16265550005` | Dana, Madison Heights | the capture walk |
| `16265550008` | Carmen, NW Pasadena | PASS |
| `16265550013` | Helen — **already opted out** | proving a refusal |
| `16265550901` | Elena V., caregiver claim `linked` | DELETE, irreversibly |
| `16265550902` | Aisha, claim `pending` | DELETE, cheaper |
| `16265559999` | nobody | the cold inbound (5.9) |

Approved records a question can actually hit: **Little Maestros** (South
Pasadena, toddler/preschool) · **Tom Sawyer Camps** (Altadena / La Cañada) ·
**Rose Bowl Aquatics parent & me** (Old Pasadena, baby/toddler) · **Hahamongna
Watershed Park** (Altadena) · **AYSO soccer** (Sierra Madre). Two caregivers
pass invariant 1: **Maria G.** and **Elena V.**

---

# A · The conversation loop

Start here. If A1 fails, nothing else in this document will work.

### A1 · HELP

```
16265550001: HELP
```

**Pass:** the registered help text arrives in a thread headed by a **masked**
number and a first name. A full number in the channel is a finding.

### A2 · Settings, which is two messages (8.3)

```
16265550003: SETTINGS
```

The menu states the current setting first — Priya is on 10 a month. Then,
separately:

```
16265550003: 1
```

`1` = five a month, `2` = ten, `3` = anytime it is genuinely relevant.

**Pass:** the confirmation names the new level *and* repeats the 48-hour gap,
and `/admin/contributors` shows the change. **The rule being tested** is that a
bare `1` means a monthly allowance here and a one-year-old in the clarifying
flow — the records decide, never the words.

### A3 · Adding a recommendation by text (10.1)

```
16265550005: ADD
```

Start words are `ADD`, `RECOMMEND`, `SHARE`, `SUGGEST`, exact on the whole
message. Then five, one at a time:

```
16265550005: class
16265550005: Sierra Madre Tumbling
16265550005: USED
16265550005: YES BUT
16265550005: SKIP
```

Closed steps are strict: `class`/`camp`/`place`/`tip` · `USED`/`HEARD` ·
`YES`/`YES BUT`/`NO`. The last is free text or `SKIP`. `CANCEL` stops it at any
point.

**Pass:** a confirmation naming the record, and a `pending_review` row in
`/admin/activities`.

⚠ **`SKIP` on the last step is the check worth doing deliberately.** It is also
a PASS keyword, and until 4 Sep it was intercepted as one: the card was never
written and the reply was silence. It now completes the capture. `PASS` on the
same step still means PASS.

### A4 · A caregiver by text must be **refused** (10.1)

```
16265550006: I want to add our nanny Marisol, she is wonderful
```

**Pass:** a link to `/share`, and **no caregiver record anywhere**. This is the
correct behaviour: a text cannot ask the firsthand-employment question
(invariant 14), the 18+ question (invariant 2) or hold a restricted note
(invariant 12). Refusing to collect something badly is not a missing feature.

### A5 · STOP, then START (12.3)

```
16265550002: STOP
```

**Pass: no reply at all.** The carrier sends the standard confirmation, and a
second goodbye to somebody who asked for silence is one too many. Then prove it
holds:

```
16265550002: HELP
```

Silence again — `sendSms` refuses at the first step. Then:

```
16265550002: START
```

Now a confirmation. `YES` deliberately does **not** opt anybody back in: it is
an answer to a Network Ask.

Helen (`16265550013`) is already opted out, so `16265550013: HELP` proves the
refusal without changing anybody's state.

### A6 · DELETE (11.3)

```
16265550902: DELETE
```

**Pass:** the profile, the copied record, the consent rows and the identity
created for it are gone in one statement, and the reply says so. Aisha's claim
is `pending`, so this is the cheap one; `16265550901` (Elena, `linked`) is real
and irreversible.

```
16265550000: DELETE
```

Sarah is a parent, not a caregiver. **Pass:** "you had no profile", and **no row
is created for her** — the check runs before `ensureInboundPerson`.

---

# B · A question, end to end

This is the loop that was joined up on 4 Sep, and the one most worth walking.

```
16265559999: any good toddler classes near South Pasadena?
```

**Step 1 — the channel.** Within a second or two:

> Got it. Someone at Pando is putting an answer together from local parents, and
> will text it to you. One thing that'll make my answers much better, how old is
> your child? (Just the age is fine.)

**Step 2 — the database.** A nameless `people` row now exists with
`phone_verified_at` set, and its consent is recorded under the **inbound**
wording (`inbound-text-2026-08`), not the seed one — that parent never saw the
seed paragraph.

**Step 3 — `/admin/answers`.** One row, held, with:

- the question as asked;
- the composed answer;
- **the trust labels it rests on, as their own row.** This is what a reviewer is
  actually checking. "Validated by multiple parents" on a record one parent used
  is the most damaging thing Pando can say.
- a hold reason. `pilot_review_all` means *everything is held*;
  `caregiver`, `sensitive` and `generator_asked` mean **this one always will
  be**.

**Step 4 — approve and send.** The answer arrives **in the same thread**, and
the row turns `sent` only because the send layer said it went.

**Step 5 — the clarifying question.** Reply in the thread with an age:

```
3
```

**Pass:** a `children` row appears for that person, and the *next* question they
ask is retrieved against a toddler band. Answer with something unreadable
instead and nothing is stored **and it is not asked again** — one refusal is a
parent who did not want to answer.

### What to try that should behave differently

| Message | Expected |
|---|---|
| `16265550001: we need a nanny three days a week` | held with reason **`caregiver`**, marked permanent |
| `16265550001: my toddler has a rash, what do i do` | held with reason **`sensitive`** — and no resource list is invented |
| a question about something Pando has nothing on | an answer offering a Network Ask, still queued |

⚠ **Two intents deliberately do nothing.** `chitchat` is answered with silence on
purpose. `unclear` is supposed to reach a person and **there is no queue for it**
— it is logged and nothing else. That is a real gap, not a bug to file.

---

# C · A Network Ask (M7)

Admin-driven. Two active blasts already exist in the demo data.

1. `/admin/blasts` → open one → **the pool preview**. It calls the same
   `selectPool` a live send calls, and shows the **held** list as prominently as
   the chosen one. A short pool is usually contributors inside their 48-hour gap
   rather than a thin network, and only that list can tell you which.
2. **Send.** Each recipient gets their own thread.
3. Reply as one of them, and as another:

```
16265550008: PASS
```

**Pass:** `PASS` frees the seat immediately, with no reply and **no penalty** —
and it counts as a *response* in the governor, not as silence. Paying only for
enthusiasm is how a network stops hearing from polite people.

4. `/admin/responses` → rate a reply, then approve it. **Pass:** it enters the
   graph as `pending_review` with `firsthand: false` — a text never establishes
   that the writer used the thing themselves — and merge candidates are offered
   beside creating a new record.

**What must not happen:** a blast marked `human_review` sending at all, and a
paid Ask sending before its checkout completed.

---

# D · Freshness and vouching (M10)

`freshness_pings` is **empty**, so there is nothing to answer until the job runs.

```bash
curl -X POST -H "authorization: Bearer $JOBS_SECRET" \
  "https://pando.is/api/jobs/run?job=freshness_ping"
```

Then reply to a ping with `yes` or `no`.

- **yes** from the parent who contributed it = a **refresh** — the date moves and
  the record still has one parent behind it.
- **yes** from a *different* parent = a **vouch** — a second firsthand
  contribution, `pending_review`, and only this one changes the label.
- **no** = the record goes stale and a withdrawal flag is raised. It is **not**
  rejected: one parent's changed mind is evidence, and others may still stand
  behind it. Work it at `/admin/freshness`, where the two numbers on the card —
  how many used it, how many would still recommend it — are what make it a
  decision.

⚠ **The tie-break worth provoking:** get a freshness ping and a did-it-help
prompt open for the same person, then reply `yes`. The **more recently asked**
question wins. Nothing in the word separates them; only the records can.

---

# E · Thanks and impact (M9)

```bash
curl -X POST -H "authorization: Bearer $JOBS_SECRET" \
  "https://pando.is/api/jobs/run?job=thanks_prompt"
```

Then `thanks_delivery`. **Three rules to check rather than assume:**

- a **silence** is not a no — `helped` stays null, and `/admin/impact` shows "no
  reply" as its own tab rather than folding it into the noes;
- **one thank-you per contributor per week**, and a held batch is owed rather
  than dropped;
- the thank-you **names what they did and asks for nothing**. A thank-you
  carrying a request is a request wearing a thank-you.

`/admin/impact` exists for the case invisible from either half: a parent said
yes and the contributors behind it were never thanked.

---

# F · Money (M13, M14.5)

`/admin/payments` **leads with whether Stripe is switched on**, and paints test
mode as loudly as unconfigured — a screen of plausible payments that all happened
in a sandbox is the most misleading state this surface has.

- Only **$5** (Board Ask) and **$15** (Targeted Ask) are chargeable anywhere. The
  estimate's $12/$20/$35 are charged by nothing; that is the 8.18 strategy
  winning, not an omission.
- **The success page cannot activate a blast.** Only the signed webhook can. Test
  by completing a checkout and watching `payment_status` move.
- **A refund goes to Stripe before the row.** A record saying the money went back
  when it did not is worse than the reverse — the parent can see their statement.
- **Nothing is owed until the window closes.** A paid Ask still live is not a
  failed guarantee.

---

# G · Two views that cannot send

- **`/admin/matching`** — pick a parent, see who Pando would ask and why. Every
  badge carries the points it contributed, and they add up to the score. The
  weights are editable and audited; there is **no send button**, deliberately.
- **`/admin/conversations`** — who Pando texted, whether it arrived, whether they
  replied, and how often they have been asked **against the allowance they
  chose**. ⚠ **There is no message text and there never will be**: `message_log`
  stores no body. That is invariant 7 at the schema level, not a missing column.

---

# H · Delivery health (12.5)

`/admin/delivery` answers three questions in order: is anything wrong now, how
bad, and how much is not yet known.

- **In-flight messages are their own figure**, never folded into the rate.
- **21610 is our bug**, not carrier noise — it means Pando texted somebody who
  had opted out.
- **30034 says stop sending**, not retry.
- If messages are going out and this page stays empty, the Messaging Service has
  no status callback pointing at `/api/sms/status`.

---

# The automated suites

Run these before any manual walk; they are faster and they assert refusals.

| Command | Checks | What it holds |
|---|---|---|
| `test:relay` | 31 | the routing decision, the signature, and Slack's own markup |
| `test:relay-live` | 38 | a **real server** against a stubbed Slack and the live database — the full question → queue → approve → threaded answer loop |
| `test:inbound` | 49 | the keyword order, mostly forged requests |
| `test:capture` | 54 | the five-question script, and which words a step accepts |
| `test:outreach` | 50 | the gap, the ceiling, the governor |
| `test:blast` | 42 | tiers, pool selection, the guarantee |
| `test:payments` | 87 | segmentation, prices, the Stripe signature, the retry policy |
| `test:payments-live` | 18 | `drizzle/0029`'s constraints against the real schema |
| `test:jobs` | 33 | the lock, and which jobs may send |
| `test:trust` | 47 | the labels — most of them asserting one does **not** appear |
| `test:answer` · `test:routing` | 34 · 36 | composition, and what waits for a person |
| `test:intent` · `test:onboarding` | 31 · 38 | reading a message, and the one question to ask next |
| `test:security` | 64 | every route is guarded, and invariant 7 by shape |
| `test:compliance` | 5 | the acceptance checks, against the live database |

⚠ **`test:e2e` (285) has not been run since 3 Sep.** It needs a live database and
a dev server on port 3000, and it now walks through the invite gate. Run it
before the client sees anything.

---

# Not built, and how you would know

Reporting these as failures wastes a round.

| Thing | Why it is absent |
|---|---|
| **Auto-send** | `PILOT_HOLD_EVERYTHING` is true, so the branch is unreachable. Writing it now would be code nothing can execute — and its first run would be against a real parent |
| **`unclear` → a person** | 5.3 says route it to a human; no queue exists for a question with no answer, so it is logged |
| **The Pando Digest** (§10) | in the strategy, in **no estimate row**, unquoted |
| **The grove** (§13) | same — a ledger with published exchange rates, and M9 is not it |
| **The open board** ($5 Board Ask) | a surface, not a feature of Blast; answering there must not spend the allowance |
| **Re-blast from `/admin/freshness`** | a Network Ask has an asker and a price; a freshness question asked by an admin has neither |
| **11.5** | asks Pando to text a nominated caregiver — reversed by the client on 3 Aug, and forbidden by invariant 13 |
| **RCS buttons** | Twilio needs Content API templates; `Body` alone stays plain text on RCS |

---

# Before the first real contributor

Not test steps — the switch-off list, and every item is dated in CLAUDE.md.

- [ ] **The Slack relay off.** One channel is a transcript of the network.
- [ ] **`SEED_VERIFY_DEV_CODES` removed** — and only *after* Twilio is
      provisioned, never before, or every parent falls to the deferred path and
      nothing reaches the database.
- [ ] **The `pando` starter password rotated** for both admins. Five guessable
      characters open every profile, every restricted note and the consent file
      with unmasked numbers. *(Already done as of 4 Sep — the live walk's
      sign-in with it fails, which is how we know.)*
- [ ] **`ADMIN_SESSION_SECRET` set**, or rotating one password signs everyone
      out.
- [ ] **`NEXT_PUBLIC_POSTHOG_SESSION_RECORDING` off** — it is a build arg, so
      this is a redeploy and not a restart.
- [ ] **Rows created under dev codes cleared or marked `is_test`.** None of those
      numbers was verified in the sense the column claims.
- [ ] **`SLACK_API_BASE` / `TWILIO_API_BASE` unset.**
- [ ] **Twilio Geo Permissions** if any tester is on a `+380` number — and note
      an Alphanumeric Sender ID is one-way, so **STOP cannot work on it**. Fine
      for a code the parent just asked for; not fine for outreach.
