# RCS templates: research and plan

> Document type: **research and plan**, 29 Oct 2026. Reviewed by the developer and
> **built the same day**: every template in section 5 and changes 1–4 of section 7. How to
> create the templates and switch them on is in [rcs-quick-replies](rcs-quick-replies.md);
> this document keeps the research and the reasons. The decisions are in section 9.

## 1. Summary

- Through Twilio, RCS gives Pando **one useful building block: a text message with
  quick-reply buttons**, plus an SMS version of the same message for phones without RCS.
  Everything Pando sends is text; the buttons only save typing.
- In the Twilio Console that is the **Card** type with **no media**, plus a **Text**
  fallback inside the same template. A card without media is shown as text with a row of
  buttons, and it is **billed like RCS text, at about the price of SMS**. Every other
  Console type is either WhatsApp-only or not useful to Pando (section 2.1).
- **14 kinds of message get buttons**, through **9 templates: the 2 that exist and 7 new**
  (section 5; ten were proposed, and Pass under the freshness ping was dropped at review). The other places that send stay plain text, on RCS and on SMS alike. That is correct for them: they confirm something or
  ask for free text.
- Four small code changes come with it (section 7). Two of them matter beyond buttons:
  - the card text and the SMS text become **two variables**, so the card no longer says
    "Reply 1 for…" next to the buttons (the SETTINGS test on 29 Oct showed this);
  - a delivery status of **`read`**, which RCS adds, must count as delivered.
- **Not proposed now:** a carousel for recommendations, age buttons, a dial button on the
  crisis reply, typing indicators. Each is in section 6 with what it would need.
- **What has been tested on a real phone (29 Oct):** a card with quick replies arrived;
  a tap reached our webhook and was understood. Everything else is from documents and is
  marked as such.

## 2. What we know about RCS (checked 29 Oct 2026)

Each fact links to its source in section 10. "Twilio" means Twilio's documents; "Google"
means Google's RCS for Business documents (the product formerly called RBM).

### 2.1 What renders on RCS through Twilio

Of the Console types (Text, Media, List picker, Call to action, Quick reply, Card, Catalog,
Carousel, WhatsApp card, WhatsApp authentication, Flows), only **four render on RCS: Text,
Media, Card, Carousel**. Quick reply, Call to action and List picker are WhatsApp and
Messenger only, even though the same *buttons* exist on RCS inside a Card.

| Type | RCS | SMS | Use for Pando |
| --- | --- | --- | --- |
| Text (`twilio/text`) | yes | yes | the SMS version inside every template |
| Card (`twilio/card`) | yes | no | **every message with buttons** |
| Carousel (`twilio/carousel`) | yes | no | possibly later, deep dive only (6.3) |
| Media (`twilio/media`) | yes | MMS only | none: Pando sends no images |
| all others | no | no | none |

A template can hold several types; Twilio sends "the most complex translation that the
chosen channel supports". That is how the Text type becomes the SMS version.

**Buttons on a Card over RCS:** `QUICK_REPLY` (sends a reply), `URL` (opens a web page),
`PHONE_NUMBER` (starts a call). Google's platform also has *view location*, *share
location* and *create calendar event*, but Twilio's templates do not expose them.

### 2.2 Limits that shape the copy

| Item | Limit | Source |
| --- | --- | --- |
| Card body | 1,600 characters (Twilio); Google allows 2,000 | Twilio, Google |
| Card title | 200, **may not be shown on a card without media** | Twilio |
| Quick-reply button title | **20 characters** on a card (25 on a carousel) | Twilio |
| URL / dial button title | 25 characters | Twilio |
| Buttons | 4 on a card with media; **11 in a chip list** (a card without media) | Twilio, Google |
| Template variables | up to 100; a value up to 1,600 characters, 250 recommended | Twilio |
| Carousel | 2–10 cards (Google); each card needs media, 1–2 buttons, title + text ≤ 160 | Google, Twilio |
| Plain RCS text | 3,072 characters | Google |

Our longest single text is a deep-dive part, `DEEP_DIVE_PART_MAX = 1530`, and an answer
is planned within `SMS_BUDGET = 1224` plus an offer, so both fit a card body.

### 2.3 Cost (Twilio US prices, October 2026)

| What | Price | Note |
| --- | --- | --- |
| SMS, outbound or inbound | $0.0083 per segment | segment = 153–160 GSM-7 characters, 67–70 UCS-2 |
| RCS "Rich" (text, card without media, quick replies) | $0.0083 per segment | segment = 160 bytes of UTF-8 |
| RCS "Rich Media" (card with media, carousel, webview) | $0.022 outbound | one flat price per message |
| Carrier fees | apply to both, per carrier | see the pricing page |

So **a card without media costs about what the SMS cost**. An emoji counts 2–4 bytes, so it
costs a little more on RCS than it looks. Google's US model also bills **the person's
reply**, and **a tap on a quick reply is billed as a reply** (the same as typing it); taps
on other actions are billed per tap. Pando already pays for inbound SMS, so this is not
new money, but it means buttons do not make a conversation cheaper.

### 2.4 iPhone

RCS for business works on iPhone (iOS 18.1 and later) where the carrier enables it. It
renders differently, and the design has to work on both:

- Twilio: on iOS "buttons always appear in a dropdown list". On Android a chip list
  scrolls sideways under the message.
- Google: no persistent chips on iOS; media must be TALL.
- Secondary reports (not Apple): card text cut at 3 lines, carousels shown as a stack,
  the sender's ID sometimes shown instead of its name on the first message.

Rule that follows: **the message text must make sense without the buttons** — which is
true already, because it is the SMS text.

### 2.5 What reaches our webhook

- A typed reply: `Body`, as with SMS.
- A tapped quick reply: `ButtonText` (the title) and `ButtonPayload` (the button's `id`,
  returned exactly). **Tested 29 Oct:** the title also arrived in `Body`, and the existing
  parser understood it. `From` arrived as the person's normal number, because the
  person was found.
- `ButtonType` (`REPLY` or `ACTION`) and `ChannelMetadata` (`type: "rcs"`) also arrive.
- Whether a tap on a URL or dial button sends anything: not documented.

### 2.5b Formatting (tested on a phone, 29 Oct)

No markup renders on RCS through Twilio: `*bold*`, `**bold**`, `_italic_`, `~strike~`,
backticks and `<b>` all arrive as typed. Unicode's mathematical sans-serif letters
("𝗕𝗼𝗹𝗱") and "•" show, because they are ordinary characters — which is also their cost:
a copied name would not match, a search would not find it, a screen reader reads them
oddly. GSMA's Universal Profile 4.0 (March 2026) adds real bold and italic; when it
reaches phones is unknown. What Pando does with this: [rcs-quick-replies](rcs-quick-replies.md),
point 7.

### 2.6 Delivery, fallback and opt-out

- Twilio checks whether the phone can take RCS and sends RCS first, otherwise the
  template's Text as SMS. When the message went as RCS, `From` in the status callback is
  `rcs:<SenderId>`; otherwise it is our phone number. The SID is believed to stay the same
  (a Twilio help article, not the API docs).
- **A new status, `read`**, is reported for RCS when the person has read receipts on.
  Pando's delivery statistics do not know it yet (section 7, change 3).
- How long Twilio waits for a phone that has RCS but is offline before it sends the SMS is
  not published. Twilio advises a shorter `ValidityPeriod` than the 10-hour default for
  time-sensitive messages. Since 10 Aug 2026 an unconfirmed RCS attempt reports error
  **30046**.
- **Opt-out is shared** between RCS and SMS for the same Messaging Service (since 15 Mar
  2026): STOP on one stops both, and a send fails with 21610 as before. Google Messages has
  an "Unsubscribe" menu that sends STOP. A Twilio help article mentions a known issue with
  Advanced Opt-Out on RCS; not confirmed in the docs.

### 2.7 Approval and registration

- Carriers approve the **RCS sender**, not each template. Neither Twilio nor Google
  describes a review of individual templates. Templates can be edited later
  (`PUT /v1/Content/{sid}`) and keep their SID.
- The sender's **use case cannot be changed after it is submitted**, and its name, logo
  and description cannot be edited after verification without the carriers. Pando's
  messages mix replies (transactional) and requests to contributors (promotional in
  Google's terms is about offers; our requests are not offers), so the use case needs a
  careful choice — likely **Multi-use** or **Transactional**. This is a registration
  decision, not a code decision.
- Registration asks for sample messages, STOP and HELP samples, and the opt-in flow. The
  card versions proposed in section 5 should be in those samples.

### 2.8 Not verified

- What a tap on a URL or dial button sends to the webhook.
- Whether a fallback SMS has the same SID and whether an intermediate failed status comes first.
- The real wait before fallback for an offline RCS phone.
- Whether the card title is shown on a card without media (proposal: never use the title).
- iPhone rendering of our cards (only Android-family behaviour is documented; the 29 Oct
  test phone's platform should be noted when the test is repeated on the other one).
- Whether US carriers apply the "Rich" price exactly as Twilio's page shows to every
  Pando card.

## 3. Rules for Pando's templates

1. **Card without media, plus a Text fallback.** No title, no media, no carousel.
2. **Two variables in every template:** `{{1}}` is the card text, `{{2}}` the SMS text.
   The SMS text is exactly what is sent today (several are registered A2P samples and may
   not change). The card text is the same message without the sentence that tells the
   person what to type, because the buttons say it.
3. **Button titles are words the existing parser already reads** (as in the first two
   templates). The button `id` is the same word in lower case. Parsing `ButtonPayload`
   first is added for safety (section 7, change 2), so a title can be reworded later
   without breaking the reply.
4. **At most 11 buttons, 20 characters each.** In practice 1–4.
5. **A button only where the answer is closed** (yes/no, a choice from a list, skip). Free
   text questions — a name, a neighbourhood, "anything another parent should know?" — keep
   no buttons, except a Skip where skipping is allowed.
6. **Proactive messages keep "Reply STOP to opt out, HELP for help." in the card text
   too.** RCS has its own unsubscribe menu, but the footer costs nothing and keeps the card
   and the registered SMS sample saying the same thing about leaving.
7. **The text must stand alone** without buttons (iPhone shows them in a menu).
8. **Never on a button:** a caregiver's contact details (invariant 13), anything about a
   named person that a person has not reviewed (invariant 8), a shortened URL.
9. **The verification code stays SMS** (`purpose: "verification"`), as now.
10. **Every rich send still goes through `sendSms`** (invariant 6): opt-out, quiet hours,
    frequency, throttle, then the provider. Nothing here changes those rules.

## 4. Every message Pando sends, and the decision for it

38 places in the code call `sendSms`. Grouped by what the person can answer:

| Message (`template` in `message_log`) | Where | Today's question | Decision |
| --- | --- | --- | --- |
| answer + Network Ask offer (`answer_sent`) | `inbound.ts` `answerQuestion` | "Want me to ask a few nearby parents for more?" | **Buttons** — `yes_no` (built) |
| approved held answer with the offer (`answer`) | `repo/answers.ts`, `repo/admin-write.ts` | same | **Buttons** — `yes_no` (new call sites) |
| answer + deep-dive offer (`answer_deep_offer`) | `answerQuestion` | "Reply DEEP." | **Buttons** — `deep_offer` |
| answer + introduction offer (`answer_intro_offer`) | `answerQuestion` | "Reply INTRO…" | **Buttons** — `intro_offer` |
| answer + participation question (`clarify_participation`), and the same question after a clarifying answer (`clarification_saved` chain) or under a held reply (`answer_queued`) | `answerQuestion`, `inbound.ts` clarify step | "Reply 1 for up to 5 a month, 2…, 3…" | **Buttons** — `settings_allowance` (built for SETTINGS) |
| SETTINGS menu (`settings`) | `settingsStep`, model-read settings | same | **Buttons** — `settings_allowance` (built; card text to shorten) |
| "did it help?" (`thanks_prompt`, A2P sample) | `repo/jobs.ts` | "Reply YES or NO" | **Buttons** — `yes_no` |
| freshness ping (`freshness_ping`) | `repo/jobs.ts` | "Reply YES, NO, or PASS" | **Buttons** — `yes_no` (no Pass: it would release an open Network Ask, 9) |
| Network Ask request to a contributor (`blast_request`, A2P sample) | `repo/blast.ts` | "Reply with anything useful, or PASS to skip" | **Button** — `pass` (the free-text answer stays typed) |
| ADD: kind (`capture_kind`) | `inbound.ts` capture | the web flow's five categories since 29 Oct (was "a class, a camp, a place, or a tip?", with no doctors) | **Buttons** — `capture_kind` |
| ADD: firsthand (`capture_firsthand`) | capture | "Reply USED or HEARD" | **Buttons** — `capture_firsthand` |
| ADD: recommend (`capture_recommend`) | capture | "Reply YES, YES BUT, or NO" | **Buttons** — `capture_recommend` |
| ADD: detail (`capture_detail`) | capture | "Reply with a sentence, or SKIP" | **Button** — `skip` |
| deep-dive report, last part (`deep_dive_report`) | `server/deep-dive.ts` | "…Reply YES." (and "Reply INTRO and the name") | **Buttons** — `yes_no` on the last part when the Ask is offered; the INTRO line stays text (6.5) |
| answer + age question (`clarify_child_age`) | `answerQuestion` | "How old are your kids?" | Text for now (6.2) |
| answer + neighbourhood / first name (`clarify_neighborhood`, `clarify_first_name`) | `answerQuestion` | free text | Text |
| ADD: name (`capture_name`), deep-dive topic (`deep_dive_topic`), ask for detail (`ask_detail`) | capture, deep dive, pending question | free text | Text |
| crisis replies (`answer_high_stakes`, `answer_allegation`) | `inbound.ts` | none | Text (a dial button is an option, 6.4) |
| caregiver / named-person redirect (`capture_caregiver_redirect`, `capture_named_person_redirect`) | capture | a link to pando.is/share | Text (a link button is an option, 6.6) |
| verification code | `/api/seed/verify/start` | none | **SMS only**, as now |
| everything else: answers with nothing offered, confirmations and receipts (`capture_saved`, `capture_cancelled`, `settings_confirmed`, `helped_reply_saved`, `freshness_reply_saved`, `blast_reply_saved`, `ask_started`, `ask_not_started`, `intro_requested`, `intro_already`, `intro_nothing`, `deep_dive_started`, `deep_dive_busy`, `deep_dive_cancelled`, `deep_dive_unsupported`, `deep_dive_failed`, `profile_deleted` and its two variants, `thanks`, `blast_answers`, `opener`, `small_talk`, `share_invite`, `unclear_handover`, `answer_queued` without a closed question) | various | none, or free text | Text. On an RCS phone they arrive as RCS text from the verified sender; on others as SMS |
| HELP, START, STOP replies | Twilio (Advanced Opt-Out) | — | not ours |
| retries (`repo/retry.ts`) | retry sweep | — | always plain text: a retry is rebuilt from the text |

## 5. The templates

Nine templates. Two exist already and change only by gaining the second variable; seven
are new.
In every one: type **Card**, body `{{1}}`, no title, no media; a **Text** fallback with
body `{{2}}`; the buttons below as **Quick reply** with the given title and id.

| Template | Buttons (title → id) | Used by | Status |
| --- | --- | --- | --- |
| `pando_yes_no` | Yes → `yes`, No → `no` | Network Ask offer (answer, approved answer, last deep-dive part), "did it help?", freshness ping | exists; add `{{2}}` |
| `pando_settings_allowance` | 5 a month → `5_a_month`, 10 a month → `10_a_month`, As relevant → `as_relevant` | SETTINGS, participation question | exists; add `{{2}}` |
| `pando_pass` | Pass → `pass` | Network Ask request | new |
| `pando_deep_offer` | Deep dive → `deep` | deep-dive offer under an answer | new |
| `pando_intro_offer` | Intro → `intro` | introduction offer under an answer | new |
| `pando_capture_kind` | Activity or class → `activity`, Place → `place`, Doctor or specialist → `doctor`, Caregiver → `caregiver`, Something else → `other` | ADD, first step | new |
| `pando_capture_firsthand` | Used → `used`, Heard → `heard` | ADD, firsthand | new |
| `pando_capture_recommend` | Yes → `yes`, Yes but → `yes_but`, No → `no` | ADD, recommend | new |
| `pando_skip` | Skip → `skip` | ADD, last step | new |

`pando_capture_recommend` cannot share `pando_yes_no`: its middle button "Yes but" makes
the button set different, and a template's buttons are fixed.

Why each title parses today:

| Title | Read by |
| --- | --- |
| Yes, No | `yesOrNo` (`lib/thanks.ts`); `readPingReply` (`lib/vouch.ts`); the capture options |
| Pass | `PASS_KEYWORDS` (`lib/sms-templates.ts`) |
| Deep dive | `acceptsDeepDive` (`lib/deep-dive.ts`): `deep[\s-]?dive` |
| Intro | the INTRO command (`lib/server/introductions.ts`) |
| 5 a month, 10 a month, As relevant | `parseAllowanceChoice` (since 29 Oct) |
| Class, Camp, Place, Tip / Used, Heard / Yes but / Skip | `CAPTURE_QUESTIONS` and `SKIP_WORDS` (`lib/capture.ts`) |

### 5.1 Card text for each message (for the client's review)

The SMS text does not change. The card text drops only the instruction. Proposed card
texts — **copy the client should confirm**, since three are registered A2P samples and the
card versions will be RCS registration samples:

| Message | Card text (`{{1}}`) |
| --- | --- |
| answer + Network Ask | the answer as sent today (it has no instruction to drop) |
| answer + deep dive | answer + "Want a deep dive? I'll rank these for your family with what local parents said, what's online and rough drive times." |
| answer + intro | answer + "By the way, … used …. Want an introduction? Someone at Pando will ask them first." |
| SETTINGS | "Right now Pando may ask you up to 5 questions a month. How many would you like? As relevant means up to 3 a week. However you set it, you'll never get two requests within 48 hours." |
| participation question | "Last thing: how many questions from nearby parents could Pando send you? As relevant means up to 3 a week." |
| "did it help?" | "Pando: a few days ago we sent you a recommendation from a local parent. Did it help? A yes lets us thank whoever shared it. Reply STOP to opt out, HELP for help." |
| freshness ping | "Pando: quick one - is … still worth recommending to other parents? Reply STOP to opt out, HELP for help." |
| Network Ask request | "Pando: a parent nearby asked — "…" We thought of you (…). Reply with anything useful. Msg & data rates may apply. Reply STOP to opt out, HELP for help." |
| ADD kind | "Pando: happy to add it. Is it an activity, a place, a doctor or specialist, a caregiver, or something else?" |
| ADD firsthand | "Pando: did you use it yourself, or did you hear about it from someone?" |
| ADD recommend | "Pando: would you recommend it to another parent? Yes but means there's a catch." (the SMS explains "YES BUT"; without it the button is unclear) |
| ADD detail | "Pando: last one, anything another parent should know? Reply with a sentence." |
| last deep-dive part | the part as sent today, without " Reply YES." |

## 6. Options not proposed now

### 6.1 Carousel for recommendations — no

Twilio's carousel needs media on every card, allows 160 characters of title and text per
card, drops the text above the carousel on RCS, has a fixed number of cards per template,
and is billed as Rich Media (about 3× the text price). An everyday answer is one
connected text (after `voiceAnswer`) whose value is a parent's own words, often 300
characters; it does not split into cards without losing that.

### 6.2 Age buttons — needs a product decision

Ages 0–25, months and "expecting" do not fit 11 buttons; two screens are needed, and the
flow becomes one child at a time instead of today's "3 and 7" in one reply. A title like
"Under 1" would be read by `parseAge` as 1, so titles would be "0", "1", … or the parser
reads `ButtonPayload`.

### 6.3 Carousel for the deep dive — possible experiment

The deep dive already builds structured options (`DeepOption`: name, area, distance,
parents who used it, price, warning). A card per option with an Intro or website button is
conceivable. Against it: media is required on each carousel card and Pando has no images;
a warning may never be dropped from a deep dive and may not fit 160 characters; the cost is
Rich Media. Worth one experiment only if the client wants it.

### 6.4 Dial button on the crisis reply — needs safety sign-off

The reply names 911, 211, 988 and the market's legal-help line. A "Call 988" button would
help. It must not replace the numbers in the text, and the wording is safety copy the
client owns.

### 6.5 INTRO with a name in the deep dive

"Reply INTRO and the name" needs one button per option, with the option's name in the
button. Titles are limited to 20 characters, so names would be cut and stop matching the
INTRO parser. Possible once `ButtonPayload` is read (the id can carry the record), as a
later step.

### 6.6 Link button to pando.is/share

The caregiver and named-person redirects carry the link in the text already. A URL button
("Open the form") would be a small convenience; it is billed as Rich (open in browser).
Low value; can be added with the others if wanted.

### 6.7 Typing indicator and read receipts

Twilio can show "typing…" on RCS for up to 20 seconds
(`POST /v3/Indicators/Typing.json`). An answer takes 10–40 seconds to compose, so this
would make the wait visible. It is a Twilio call and would have to live in
`lib/server/sms.ts` (invariant 6). Read receipts arrive as status `read`; beyond counting
them as delivered (change 3), Pando has no use for them now.

## 7. Code changes for the implementation

1. **Two variables.** `sendSms({ rich })` sends `{"1": cardText, "2": body}`. Each rich
   kind gets a card-text function next to its SMS text (in the file that owns that text),
   and `test:rich` checks the card text is the SMS text minus the instruction, never with
   new facts.
2. **Read `ButtonPayload` first.** In `app/api/sms/inbound`, a tap whose `ButtonPayload`
   is a known id is turned into the canonical word before the pipeline reads it
   (`yes` → `YES`). Unknown ids and typed replies go through as today. The parameter is
   signed by Twilio, like `Body`.
3. **`read` counts as delivered.** `lib/delivery.ts` (`DeliveryStatus`,
   `TERMINAL_STATUSES`) and the SQL in `repo/outreach.ts` that counts settled and
   delivered messages. Today a message that only ever reports `read` stays "in flight".
4. **Kinds and call sites.** New kinds in `lib/sms-rich.ts` with their env vars
   (`TWILIO_RCS_CONTENT_SID_<KIND>`), and the call sites in the table of section 4.
   Alternative to consider: one variable holding all SIDs, to keep `.env` short.

Optional, if the review wants them: record the channel (`rcs:` in the status callback's
`From`) on `message_log`, which needs a migration; a shorter `ValidityPeriod` for replies.

Proof for each change: `test:rich` extended (every title parses; card text ⊂ SMS text;
the payload mapping), `test:inbound` for the payload, a delivery test for `read`, the
gate, and a walk in the chat lab; then the real phone, both an RCS phone and one without.

## 8. Operator steps after the code ships

1. Edit the two existing templates: add `{{2}}` to the Text fallback (or recreate them).
2. Create the eight new templates as in section 5 (Console: Card, no media; Text fallback).
3. Put each SID in `/docker/pando/.env` and run `docker compose up -d`.
4. Add the card texts of section 5.1 to the RCS sender's registration samples.

## 9. Decisions (29 Oct)

The developer, after reading this as a page: *"давай імплементовуй всі ці типи
повідомлень, а я сам створю шаблони"*.

1. **All the templates** of section 5, on the messages of section 4 — nine after the
   review below.
2. **Two variables**: the card without the instruction, the SMS as before.
3. **The card texts of 5.1 as proposed**, built; the proactive ones ("did it help?", the
   freshness ping, a Network Ask request) go to the client before they are switched on.
4. **One env var per kind** (`TWILIO_RCS_CONTENT_SID_<KIND>`), the pattern already on the
   server.
5. **Nothing from section 6 now.**

The independent review of the code (29 Oct) changed three things: the SETTINGS and
participation cards say what "As relevant" allows (the first version dropped it with the
digits); the freshness ping has no Pass button (PASS is read before the ping and releases
an open Network Ask — true of a typed PASS already, filed separately); and a tap's
`ButtonPayload` never replaces words the person typed.

Creating the first template showed the ADD question was older than the web flow: "a
class, a camp, a place, or a tip", and no doctors at all. The developer: *"Перший
варіант, приводь до п'яти категорій"* — the question and its buttons now follow the web's
five (decision row of 29 Oct).

## 10. Sources

- Twilio, content types and channels: https://www.twilio.com/docs/content/content-types-overview
- Twilio, `twilio/card` (limits, chip list, iOS, billing, variables): https://www.twilio.com/docs/content/twiliocard
- Twilio, `twilio/carousel`: https://www.twilio.com/docs/content/carousel
- Twilio, variables in templates: https://www.twilio.com/docs/content/using-variables-with-content-api
- Twilio, Content API resources (editing templates): https://www.twilio.com/docs/content/content-api-resources
- Twilio, send an RCS message (fallback, `rcs:` From, typing indicator): https://www.twilio.com/docs/rcs/send-an-rcs-message
- Twilio, RCS onboarding: https://www.twilio.com/docs/rcs/onboarding
- Twilio, inbound webhook parameters: https://www.twilio.com/docs/messaging/guides/webhook-request
- Twilio, outbound status callbacks: https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
- Twilio, Message resource (`read`): https://www.twilio.com/docs/messaging/api/message-resource
- Twilio, US pricing: https://www.twilio.com/en-us/sms/pricing/us
- Twilio changelog: RCS delivery and fallback (1 Jul 2026): https://www.twilio.com/en-us/changelog/updates-to-optimize-rcs-delivery-and-fallback
- Twilio changelog: unified opt-outs (15 Mar 2026): https://www.twilio.com/en-us/changelog/twilio-now-supports-unified-opt-outs-across-rcs--sms--and-mms-ch
- Twilio changelog: button payload (14 Jul 2025): https://www.twilio.com/en-us/changelog/rcs-button-payload
- Twilio changelog: error 30046: https://www.twilio.com/en-us/changelog/rcs-error-code-changing
- Google, US billing model and FAQ: https://developers.google.com/business-communications/rcs-business-messaging/carriers/billing/us-billing-model , https://developers.google.com/business-communications/rcs-business-messaging/carriers/billing/us-billing-faq
- Google, sending messages (limits, iOS notes, expiry): https://developers.google.com/business-communications/rcs-business-messaging/guides/build/messages/send
- Google, rich cards: https://developers.google.com/business-communications/rcs-business-messaging/guides/learn/rich-cards
- Google, agent use cases: https://developers.google.com/business-communications/rcs-business-messaging/guides/learn/agent-use-cases
