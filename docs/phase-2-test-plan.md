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

**Pass:** a link to `/share`, and **no caregiver record anywhere** — and nothing in `/admin/answers` either. This is the walk that found four faults on 4 Sep: the redirect only fired inside a capture, so an unprompted offer came back as a *queued answer* recommending a music class and a park. This is the
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

**Step 1 — the channel.** ⚠ **Give it up to 30 seconds, not "a second or two".**
The pipeline searches the open web (4–9s) after retrieval, on top of the intent
call, and the reply lands when that finishes. A suite that waited 12s failed six
assertions in a row on 8 Sep, the first of them reading exactly like broken
wiring.

What arrives is **the answer itself** for an ordinary question — auto-send came
on 8 Sep — and it must carry **both halves**:

> 3 parents near you have used Little Maestros, a class in South Pasadena, last
> confirmed Aug 2026.
> Best for: a cautious toddler who warms up slowly.
> One said: "Small groups and the teacher is unbelievably patient with the ones
> who won't join in for the first month."
> Heads up: Saturdays are packed - take the 9am.
> About $50-100 a month.
> Also nearby: Rose Bowl Aquatics parent & me, a class in Old Pasadena, 2 parents.
>
> Public/general information:
> LoveBug & Me Music - baby and toddler music classes. Ages 0-5 years.

**Pass, and check each separately:** the evidence is a **number** and not the
word "multiple"; a parent's own sentence is in quotation marks and **unedited**;
the public block has its own heading and its lines carry **no** parent claim; and
the whole thing is GSM-7 (an em dash in it triples the bill — `test:answer` pins
the encoding, but a parent's own punctuation is normalised, never their words).

A **sensitive** question still holds and gets `heldReply` instead:

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
- a hold reason. ⚠ `pilot_review_all` is **gone** — the blanket rule came off on
  8 Sep. `not_held` means it was sent automatically; `caregiver`, `sensitive`
  and `generator_asked` mean **this one always waits**; `low_evidence` and
  `public_only` wait until the base fills.

**Step 4 — approve and send** *(only for a held answer; an ordinary one is
already `sent` by step 1)*. The answer arrives **in the same thread**, and the
row turns `sent` only because the send layer said it went.

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

Admin-driven, and **walk it in order** — until 8 Sep two of these five steps had
no button at all, which is the kind of gap only a walk finds.

0. **Create one.** `/admin/blasts` → *Record a question* (`blast.create`). This
   is the pilot's manual entry; there is deliberately no automatic one, because
   a parent's "yes" to Pando's own offer would have to be priced first.
1. **The pool preview** → *Who would be asked*. It calls the same `selectPool` a
   live send calls, and shows the **held** list as prominently as the chosen one.
   A short pool is usually contributors inside their 48-hour gap rather than a
   thin network, and only that list can tell you which.
2. **Send the Ask.** ⚠ Offered only where it could work — a passive entry
   contacts nobody by design, and an Ask already sent has recipients. Everything
   else shows the button and lets the refusal explain: *unpaid*, *waiting for a
   person*, *already sent*, *nothing went out*. **Pass:** each of those is a
   different sentence naming a different next step, never "that has changed".
   Each recipient gets their own thread.
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
5. **Send the answers.** Back on `/admin/blasts`, the card now reads
   *"Still waiting — the answers have not gone out"* and offers *Send the
   answers* (`blast.deliver`). **Pass:** the asker's thread receives the approved
   replies **in the parents' own words**, ranked by the admin's rating; the card
   flips to *Answered*; and pressing it again is **refused** rather than texting
   them twice.

**What must not happen:** a blast marked `human_review` sending at all; a paid
Ask sending before its checkout completed; an *unapproved* reply reaching the
asker; or the card reading as finished while the asker has heard nothing.

⚠ **`npm run test:relay-live` walks 0 → 5 automatically** (65 checks), including
every refusal. What it deliberately does **not** do is call `blast.send` for
real: that runs `selectPool` against the live cohort and would text real demo
contributors, spending their 48-hour gap for a test. Step 2 is the one step you
have to walk by hand, and only against an Ask you created yourself.

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

**Counts are as of 9 Sep.** They move, and a stale one here is worse than none —
if a number below does not match, the table is out of date and not the suite.

**Pure — no database, no server, seconds each.** Run all of these first.

| Command | Checks | What it holds |
|---|---|---|
| `test:answer` | 89 | composition: relevance before evidence, the parents' own words, the public block, the budget |
| `test:routing` | 45 | what waits for a person, and the two replies to a message that is not a question |
| `test:intent` · `test:onboarding` | 69 · 38 | reading a message, and the one question to ask next |
| `test:trust` | 47 | the labels — most of them asserting one does **not** appear |
| `test:matching` | 53 | the two-layer scorer, the age ladder, the topic reader |
| `test:starters` · `test:derive` | 27 · 21 | which taps a screen offers; a place → the tenure signal |
| `test:blast` | 64 | tiers, the guarantee, and what the asker is finally told |
| `test:outreach` | 57 | the gap, the ceiling, the governor, quiet hours |
| `test:inbound` | 49 | the keyword order, mostly forged requests |
| `test:capture` | 66 | the five-question script, and which words a step accepts |
| `test:caregiver` | 68 | the four consent scopes, the 18+ gate, the named-person detector |
| `test:payments` | 90 | segmentation, prices, the Stripe signature, the retry policy |
| `test:jobs` · `test:tiers` · `test:thanks` · `test:vouch` | 33 · 32 · 41 · 32 | the lock; the ladder; the two thank-you loops; refresh vs vouch |
| `test:feedback` | 117 | every client feedback item, pinned by her own number |
| `test:security` | 67 | every route is guarded, the limits are sane, invariant 7 by shape |
| `test:relay` · `test:phone` · `test:person-search` · `test:auth` · `test:confirm` | 33 · 35 · 24 · 45 · 9 | the transport decision; US/UA numbers; the admin picker; sign-in; the vagueness follow-up |

**Live — need `.env.local`, the database, and (where noted) a build.**

| Command | Checks | What it needs |
|---|---|---|
| `test:relay-live` | 65 | `npm run build` first. A **real server** against a stubbed Slack: the question → answer loop, and the whole blast chain including the exit |
| `test:e2e` | 285 | a **dev server** (not a build) and a live database. Walks all of Phase 1 |
| `test:compliance` | 26 | the five acceptance checks, against the live database |
| `test:payments-live` | 18 | `drizzle/0029`'s constraints against the real schema |
| `test:referral-live` | 21 | the referral chain and the identity endpoint's refusals |
| `probe:web-search` | 10 cases | ⚠ **spends real API calls and searches the live web.** Ten questions through the real pipeline, printing what a parent would receive. It **reports rather than gates** — a model plus a live web is not deterministic |

⚠ **Never run a live suite and a dev server against the same `.next`.** A
production build writes into it, and afterwards some route handlers answer from
a stale module graph while others recompile — the symptom is `test:e2e` failing
at a *different* assertion each run, each looking like a real bug. Stop the dev
server, `rm -rf .next`, restart.

---

# Not built, and how you would know

Reporting these as failures wastes a round.

| Thing | Why it is absent |
|---|---|
| ~~**Auto-send**~~ | **Built 8 Sep** on the client's instruction. `PILOT_HOLD_EVERYTHING` is `false`; only sensitive, caregiver-related and generator-asked answers wait. Every row carries the reason it was or was not held, so the queue can be re-read afterwards |
| ~~**`unclear` → a person**~~ | **Built 8 Sep.** `pending_questions` asks for the detail twice, then hands over — and the handover raises an `unreadable_question` escalation carrying the words, rather than closing into a table nobody reads |
| **The automatic entry to a Network Ask** | a thin answer offers *"want me to ask a few nearby parents?"* and nothing reads the yes. Wiring it means saying what that reply costs — a decision, not missing code |
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
