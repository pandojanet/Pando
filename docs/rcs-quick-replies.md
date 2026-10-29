# RCS quick replies

> Document type: **runbook**. How the RCS quick-reply messages work, how to create
> each template, how to switch them on, test them and switch them off. First two built
> 29 Oct 2026; the full set built the same day after the review of
> [rcs-templates](rcs-templates.md), which holds the research and the reasons.
> Code: `web/lib/sms-rich.ts`.

## What it does

On a phone with RCS, these messages carry quick-reply buttons. On a phone without RCS
the same message arrives as the SMS it always was.

| Kind (`lib/sms-rich.ts`) | Template | Buttons | Messages |
| --- | --- | --- | --- |
| `yes_no` | `pando_yes_no` | Yes, No | the Network Ask offer under an answer (also after an admin approves a held answer); "did it help?"; the freshness ping; the last part of a deep dive when it offers the Ask |
| `pass` | `pando_pass` | Pass | a Network Ask request to a contributor (the answer is typed) |
| `deep_offer` | `pando_deep_offer` | Deep dive | the deep-dive offer under an answer |
| `intro_offer` | `pando_intro_offer` | Intro | the introduction offer under an answer |
| `settings_allowance` | `pando_settings_allowance` | 5 a month, 10 a month, As relevant | the SETTINGS menu; the participation question wherever it is asked |
| `capture_kind` | `pando_capture_kind` | Activity or class, Place, Doctor or specialist, Caregiver, Something else | ADD, first step (the web flow's five categories) |
| `capture_firsthand` | `pando_capture_firsthand` | Used, Heard | ADD, "did you use it yourself?" |
| `capture_recommend` | `pando_capture_recommend` | Yes, Yes but, No | ADD, "would you recommend it?" |
| `skip` | `pando_skip` | Skip | ADD, last step (the note is typed) |

Every other message is plain text, on RCS and on SMS alike.

The freshness ping has **no Pass button** although its SMS says "or PASS to skip": PASS is
read before the ping is, and it releases whatever Network Ask the person still has open, so
a one-tap Pass under a ping would do that by accident (review, 29 Oct).

How it works:

1. `sendSms` runs every rule it always ran (opt-out, quiet hours, frequency, throttle).
2. If the kind's template SID is set, the request to Twilio carries `ContentSid` and two
   variables, and **no `Body`** (Twilio refuses a `Body` with variables, error 35127):
   - `{{1}}` — the **card text**: the message without the sentence that says what to type
     ("Reply 1 for…", "Reply DEEP."), because the buttons say it;
   - `{{2}}` — the **SMS text**, exactly as before. Three of them are registered A2P
     samples and are never changed.
3. Twilio sends the card to a phone with RCS and the template's Text (`{{2}}`) to a phone
   without it.
4. If Twilio refuses the template with a 4xx, the same message goes again as plain text.
   A timeout or a 5xx is not retried, because the first may have gone.
5. A tap arrives at `/api/sms/inbound` with the button's id in `ButtonPayload` (and its
   title in `Body`). A known id fills an empty `Body` or confirms the title in it; it never
   replaces words the person sent. The title is a word the existing parsers understand.
   Tested on a real phone on 29 Oct (SETTINGS).
6. RCS reports a delivery status `read`; it counts as delivered.

7. The card text is formatted (`cardFormat`): section labels at the start of a line
   ("Heads up:", "My take:"…) in bold Unicode letters, "Drive times are rough estimates."
   in italic, "- " list lines as "• ". Markup such as `*bold*` does not render on RCS
   (tested 29 Oct), Unicode letters do. Names, prices, sites, parents' words, trust labels
   and STOP/HELP are never formatted, because those are copied, searched or read aloud;
   the SMS text is never formatted.

It is **off per kind**. A kind with no SID set sends plain text exactly as before.

## Creating a template in the Twilio Console

Do this once per template in the table below.

1. Console → **Messaging → Content Template Builder → Create new template** (in the new
   menu: **Communications → Messaging → Templates → Create new template**).
2. **Template name**: the name in the table (for example `pando_capture_kind`).
   **Language**: English. **Content type**: **Card**.
3. **Title**: leave empty. **Subtitle**: leave empty. **Media**: leave empty. A card without
   media is shown as text with buttons and costs about the same as an SMS.
4. **Body**: type `{{1}}` and nothing else. Give `{{1}}` the sample card text from the
   table.
5. **Buttons**: for each button in the table, add a **Quick reply** with exactly that
   **title** and that **id** (the field may be called *ID* or *Payload*). Same order,
   same spelling, same capitals. Leave the placement (chip list) as it is.
6. **Fallback for devices without RCS**: add a text message whose body is `{{2}}` and
   nothing else. Give `{{2}}` the sample SMS text from the table. **This is required**:
   without it a phone without RCS gets no text.
7. **Save**. Do not choose "Save and submit for WhatsApp approval"; RCS needs no template
   approval.
8. Open the saved template and copy its **Content SID** (`HX` and 32 characters). Check in
   the preview that it has both the card with the buttons and the text fallback.

If the Console does not offer a field for the button id, the template still works: a tap
also arrives as its title. If the Console refuses a body that is only a variable, send
the error text to the developer.

The same templates can be created through the Content API instead; the request body for
each kind is `contentTemplateDefinition(kind)` in `lib/sms-rich.ts`.

## The templates

The samples are only for the Console's preview; Pando fills both variables on every send.

### 1. `pando_yes_no` — already exists, **edit it**

| Field | Value |
| --- | --- |
| Buttons | **Yes** (id `yes`), **No** (id `no`) |
| Body | `{{1}}` |
| Fallback text | change it from `{{1}}` to **`{{2}}`** |
| Sample `{{1}}` | `Pando: a few days ago we sent you a recommendation from a local parent. Did it help? A yes lets us thank whoever shared it. Reply STOP to opt out, HELP for help.` |
| Sample `{{2}}` | `Pando: a few days ago we sent you a recommendation from a local parent. Did it help? Reply YES or NO — a yes lets us thank whoever shared it. Reply STOP to opt out, HELP for help.` |
| Env var | `TWILIO_RCS_CONTENT_SID_YES_NO` (already set; the SID does not change when a template is edited) |
| Also carries | the freshness ping, the Network Ask offer, the last deep-dive part — same two buttons |

### 2. `pando_settings_allowance` — already exists, **edit it**

| Field | Value |
| --- | --- |
| Buttons | **5 a month** (`5_a_month`), **10 a month** (`10_a_month`), **As relevant** (`as_relevant`) |
| Body | `{{1}}` |
| Fallback text | change it from `{{1}}` to **`{{2}}`** |
| Sample `{{1}}` | `Right now Pando may ask you up to 5 questions a month. How many would you like? As relevant means up to 3 a week. However you set it, you'll never get two requests within 48 hours.` |
| Sample `{{2}}` | `Right now Pando may ask you up to 5 questions a month. Reply 1 for up to 5 a month, 2 for up to 10, or 3 for up to 3 a week. However you set it, you'll never get two requests within 48 hours.` |
| Env var | `TWILIO_RCS_CONTENT_SID_SETTINGS` (already set) |

### 3. `pando_pass` — new

| Field | Value |
| --- | --- |
| Buttons | **Pass** (`pass`) |
| Sample `{{1}}` | `Pando: a parent nearby asked — "Any good swim classes for a 4 year old?" We thought of you (you live nearby). Reply with anything useful. Msg & data rates may apply. Reply STOP to opt out, HELP for help.` |
| Sample `{{2}}` | `Pando: a parent nearby asked — "Any good swim classes for a 4 year old?" We thought of you (you live nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.` |
| Env var | `TWILIO_RCS_CONTENT_SID_PASS` |

### 4. `pando_deep_offer` — new

| Field | Value |
| --- | --- |
| Buttons | **Deep dive** (`deep`) |
| Sample `{{1}}` | `Rose Bowl Aquatics has lessons from age 3. Want a deep dive? I'll rank these for your family with what local parents said, what's online and rough drive times.` |
| Sample `{{2}}` | `Rose Bowl Aquatics has lessons from age 3. Want a deep dive? I'll rank these for your family with what local parents said, what's online and rough drive times. Reply DEEP.` |
| Env var | `TWILIO_RCS_CONTENT_SID_DEEP_OFFER` |

### 5. `pando_intro_offer` — new

| Field | Value |
| --- | --- |
| Buttons | **Intro** (`intro`) |
| Sample `{{1}}` | `Little Maestros runs music classes for toddlers. By the way, a parent Pando knows has used Little Maestros. Want an introduction? Someone at Pando will ask them first.` |
| Sample `{{2}}` | `Little Maestros runs music classes for toddlers. By the way, a parent Pando knows has used Little Maestros. Want an introduction? Reply INTRO and someone at Pando will ask them first.` |
| Env var | `TWILIO_RCS_CONTENT_SID_INTRO_OFFER` |

### 6. `pando_capture_kind` — new

The web flow's five categories. Caregiver saves nothing: the parent gets the link to the
careful form, as when they type the word.

| Field | Value |
| --- | --- |
| Buttons | **Activity or class** (`activity`), **Place** (`place`), **Doctor or specialist** (`doctor`), **Caregiver** (`caregiver`), **Something else** (`other`) |
| Sample `{{1}}` | `Pando: happy to add it. Is it an activity, a place, a doctor or specialist, a caregiver, or something else?` |
| Sample `{{2}}` | `Pando: happy to add it. Is it an activity, a place, a doctor or specialist, a caregiver, or something else? Reply ACTIVITY, PLACE, DOCTOR, CAREGIVER or OTHER.` |
| Env var | `TWILIO_RCS_CONTENT_SID_CAPTURE_KIND` |

### 7. `pando_capture_firsthand` — new

| Field | Value |
| --- | --- |
| Buttons | **Used** (`used`), **Heard** (`heard`) |
| Sample `{{1}}` | `Pando: did you use it yourself, or did you hear about it from someone?` |
| Sample `{{2}}` | `Pando: did you use it yourself, or did you hear about it from someone? Reply USED or HEARD.` |
| Env var | `TWILIO_RCS_CONTENT_SID_CAPTURE_FIRSTHAND` |

### 8. `pando_capture_recommend` — new

| Field | Value |
| --- | --- |
| Buttons | **Yes** (`yes`), **Yes but** (`yes_but`), **No** (`no`) |
| Sample `{{1}}` | `Pando: would you recommend it to another parent? Yes but means there's a catch.` |
| Sample `{{2}}` | `Pando: would you recommend it to another parent? Reply YES, YES BUT (if there's a catch), or NO.` |
| Env var | `TWILIO_RCS_CONTENT_SID_CAPTURE_RECOMMEND` |

### 9. `pando_skip` — new

| Field | Value |
| --- | --- |
| Buttons | **Skip** (`skip`) |
| Sample `{{1}}` | `Pando: last one, anything another parent should know? Reply with a sentence.` |
| Sample `{{2}}` | `Pando: last one, anything another parent should know? Reply with a sentence, or SKIP.` |
| Env var | `TWILIO_RCS_CONTENT_SID_SKIP` |

## Switching it on

1. **First edit the two existing templates** (fallback `{{1}}` → `{{2}}`). Until then, a
   phone without RCS receives the card text, without "Reply 1…", under those two kinds.
2. Put each new SID in `/docker/pando/.env` on the server:

   ```
   TWILIO_RCS_CONTENT_SID_PASS=HX…
   TWILIO_RCS_CONTENT_SID_DEEP_OFFER=HX…
   TWILIO_RCS_CONTENT_SID_INTRO_OFFER=HX…
   TWILIO_RCS_CONTENT_SID_CAPTURE_KIND=HX…
   TWILIO_RCS_CONTENT_SID_CAPTURE_FIRSTHAND=HX…
   TWILIO_RCS_CONTENT_SID_CAPTURE_RECOMMEND=HX…
   TWILIO_RCS_CONTENT_SID_SKIP=HX…
   ```

   A kind can be switched on alone; the others stay plain text.
3. `cd /docker/pando && docker compose up -d`.

**Before switching on the card texts of proactive messages** ("did it help?", the
freshness ping, a Network Ask request): their card wording is new copy beside
registered samples. It goes to the client and into the RCS sender's registration
samples first.

## Testing it

Use a test number that is a profile in production, never a real parent's: SETTINGS and
the participation question change the allowance of whoever answers, and Yes to the
Network Ask creates a draft Ask (an admin still presses Send).

| Kind | How to make Pando send it |
| --- | --- |
| `settings_allowance` | text **SETTINGS** |
| `capture_*`, `skip` | text **ADD** and tap through; the name is typed |
| `yes_no` (Network Ask) | ask something Pando knows little about |
| `deep_offer` | ask "which … is best …" about classes, camps or schools |
| `intro_offer` | ask about a place a parent in the network has used |
| `yes_no` ("did it help?", the freshness ping), `pass` | sent by the scheduled jobs and by an admin's Send; not on demand |

On each: the phone with RCS shows the card text and the buttons; a tap gets the same
answer as typing the word; a phone without RCS gets the SMS text. In the container log
`[sms] sent` has `rich: true` when a template was used, and `[sms] rich send refused,
sending plain` when Twilio refused it (check the SID).

## Switching it off

Clear a kind's variable in `/docker/pando/.env` and run `docker compose up -d`; that
message is plain text from then on. No code change and no migration. To remove the code,
revert the commits; nothing else depends on it.

## "Pando is typing…"

On a phone with RCS, while Pando works out the answer to the person's own text, the
phone shows the typing dots (Twilio's Typing Indicator API, v3; built 29 Oct). Code:
`web/lib/rcs-typing.ts` for the timing, the request in `lib/server/sms.ts`.

- **When:** an ordinary text that arrived over RCS (Twilio's `ChannelMetadata` says
  `rcs`). Never for STOP, START, HELP or PASS, never on a phone without RCS, never for
  anything proactive. Other commands (SETTINGS, DELETE, a tap) are answered within the
  first 1.5 seconds and so show none.
- **How long:** the first indicator after 1.5 seconds; renewed every 15 seconds (Twilio
  shows it for 20); at most 90 seconds for an answer. A deep dive shows them again after
  "On it" for up to 10 minutes, until the report arrives (deep searches of 260 and 484
  seconds are on record).
- **Stopped by:** any message Pando sends to that number, before it is posted, and the
  end of the answer. The opt-out list is read before every request, so a number that
  opted out sees none, and a STOP that arrives mid-answer ends them at the next renewal.
  A refused request ends them.
- **Limits:** dots already shown cannot be taken back. A text that ends with no reply
  after more than 1.5 seconds (a "no" to an offer, say) leaves them for up to 20 seconds.
  Two texts from one phone answered at the same time share one loop; the first reply
  ends it.
- **What it is not:** a message. Nothing is written to `message_log`, no limit counts it,
  and it changes nothing about how long an answer or a deep dive takes.

**Switching it on:** Console → Messaging → Senders → RCS → copy the sender's ID
(`rcs:…_agent`), then in `/docker/pando/.env`:

```
TWILIO_RCS_SENDER_ID=rcs:pando_xxxxxxxx_agent
```

and `docker compose up -d`. **Off:** clear the value and run the same command.

**Checking it:** ask an ordinary question from an RCS phone; the dots appear after about
a second and a half and go when the answer lands. The container log shows `[sms] typing
shown` for each request, and `[sms] typing refused` with Twilio's status when it said no
(check the sender ID). `[sms:inbound]` carries `channel: "rcs"` or `"sms"`; if a phone
with RCS shows `sms` there, Twilio's `ChannelMetadata` is not what the docs describe and
no indicator is sent.

**Price:** Twilio publishes none for the indicator (checked 29 Oct). After the first day
on, check Console → Monitor → Usage for a new line; an answer sends one or two requests,
a deep dive about six to twenty. The requests are not throttled with the messages:
they are not messages.

## What is not verified

- Every kind except SETTINGS has been walked only in the local chat lab, not on a phone.
- What a tap on a URL or dial button sends (no such buttons are used).
- The real wait before an offline RCS phone gets the SMS instead.
- How the cards look on an iPhone (Twilio: buttons in a dropdown).
- Which channel each message used: `message_log` does not record it.
- The typing indicator on a real phone: walked in the chat lab only (29 Oct). Not seen:
  that Twilio's `ChannelMetadata` reaches us with `type: "rcs"`, that the request is
  accepted with the account's SID and token, its price, and whether a request that lands
  after the answer shows dots again (the loop stops before every send, but one already
  on its way can arrive late).
