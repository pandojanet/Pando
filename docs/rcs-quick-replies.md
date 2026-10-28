# RCS quick replies

> Document type: **runbook**. How the two RCS quick-reply messages work, how to switch
> them on, how to test them and how to switch them off. Built 29 Oct 2026. Decision row:
> [decisions.md](decisions.md); code: `web/lib/sms-rich.ts`.

## What it does

Two messages can carry quick-reply buttons on a phone that has RCS:

| Message | Where it is sent | Buttons |
| --- | --- | --- |
| The Network Ask offer under a recommendation (*"Want me to ask a few nearby parents for more?"*) | `answerQuestion` in `lib/server/inbound.ts` | Yes, No |
| The SETTINGS menu | `settingsStep`, and the model-read "settings" intent | 5 a month, 10 a month, As relevant |

Every other message is plain text, on RCS and on SMS alike.

It is **off by default**. With the two variables unset (`TWILIO_RCS_CONTENT_SID_YES_NO`,
`TWILIO_RCS_CONTENT_SID_SETTINGS`) `sendSms` sends exactly what it sent before.

When a variable is set:

1. `sendSms` runs every rule it always ran (opt-out, quiet hours, frequency, throttle).
2. The request to Twilio carries `ContentSid` and `ContentVariables`, and **no `Body`**.
   Twilio refuses a `Body` together with variables (error 35127). The message text is the
   template's only variable, `{{1}}`.
3. The template has two types. Twilio sends the card to a phone with RCS and the template's
   `twilio/text` to a phone without it. **The SMS a person without RCS gets is the text they
   always got.** Pando never asks which phone it is.
4. If Twilio refuses the rich request with a 4xx (a wrong SID, an archived template), the
   same message is sent again as plain text. A timeout or a 5xx is **not** retried: the
   first request may have gone.

## What a person without RCS loses

The buttons. The text still says what to reply (*"Reply 1 for up to 5 a month..."*, and the
Ask offer is a plain yes or no), so nothing is lost but the convenience.

## Switching it on

You need a Twilio account that can send RCS. Until the RCS sender is approved by the
carriers, only phones added as **test devices** of the sender receive a card
([Twilio's onboarding](https://www.twilio.com/docs/rcs/onboarding) says to allow four to six
weeks). A phone without RCS gets the text version whether or not the sender is approved.

1. In the Twilio Console, create the RCS sender, add your own phone as a test device, and
   add the sender to the same Messaging Service as the SMS number.
2. Create the two Content Templates, in the Content Template Builder or by posting each
   definition below to the Content API (`POST https://content.twilio.com/v1/Content`).
   The `twilio/text` type is required: without it a phone without RCS has no text version.
   The definitions come from `contentTemplateDefinition` in `lib/sms-rich.ts`.
3. Copy each template's SID (`HX...`) into `/docker/pando/.env` on the server:
   `TWILIO_RCS_CONTENT_SID_YES_NO` and `TWILIO_RCS_CONTENT_SID_SETTINGS`.
4. Apply it: **Actions, Deploy, Run workflow** (DEPLOY.md section 5), or
   `cd /docker/pando && docker compose up -d`.

### Template `pando_yes_no`

```json
{
  "friendly_name": "pando_yes_no",
  "language": "en",
  "variables": {
    "1": "The message text"
  },
  "types": {
    "twilio/card": {
      "body": "{{1}}",
      "actions": [
        {
          "type": "QUICK_REPLY",
          "title": "Yes",
          "id": "yes"
        },
        {
          "type": "QUICK_REPLY",
          "title": "No",
          "id": "no"
        }
      ]
    },
    "twilio/text": {
      "body": "{{1}}"
    }
  }
}
```

### Template `pando_settings_allowance`

```json
{
  "friendly_name": "pando_settings_allowance",
  "language": "en",
  "variables": {
    "1": "The message text"
  },
  "types": {
    "twilio/card": {
      "body": "{{1}}",
      "actions": [
        {
          "type": "QUICK_REPLY",
          "title": "5 a month",
          "id": "5_a_month"
        },
        {
          "type": "QUICK_REPLY",
          "title": "10 a month",
          "id": "10_a_month"
        },
        {
          "type": "QUICK_REPLY",
          "title": "As relevant",
          "id": "as_relevant"
        }
      ]
    },
    "twilio/text": {
      "body": "{{1}}"
    }
  }
}
```

## Testing it

1. From a phone **with** RCS: text SETTINGS. You should see the menu with three buttons.
   Tap one; the reply is *"Done: up to ... a month"*.
2. From a phone **without** RCS (or an RCS phone with the sender not yet approved): the same
   text, no buttons. Reply `1`, `2` or `3`.
3. Ask a question that Pando answers thinly (few parent records). The answer ends with
   *"Want me to ask a few nearby parents for more?"* and Yes, No. Tap Yes: an Ask is
   created as a draft (an admin still presses Send).
4. In the container log, `[sms] sent` has `rich: true` when the card went. `[sms] rich send
   refused, sending plain` means Twilio refused the template (check the SID).

**Check what a tap sends us.** This was not verified on a real device. A tap should arrive
in the inbound webhook with the button's title as the text; every title is a word the
parsers already read. If a tap arrives as something else, the reply is treated as an
ordinary message: the person is not harmed, the button just does nothing.

## Switching it off

Clear the two variables in `/docker/pando/.env` and redeploy. Messages are plain text
from then on. No code change and no migration is involved. To remove the code, revert the
commit; nothing else depends on it.

## What is not built

The options below are written down so the next session does not repeat the research.

- **The age question** under a recommendation, with one button per age. Twilio allows up to
  11 buttons in a chip list and 20 characters per title, so ages need two screens, and the
  title `Under 1` would be read by `parseAge` as 1. Needs a decision on one child at a time.
- **The deep-dive and intro offers**, **the capture steps** (kind, used or heard,
  recommend), **the freshness ping** and **"did it help?"**: closed answers that fit
  buttons. The last two are registered A2P samples; their RCS wording would be registered
  with the RCS sender.
- **Never:** the verification code (stays SMS), STOP and HELP (Twilio answers them), any
  button that shows a caregiver's phone number (invariant 13).
- **Approval.** Twilio's documents describe approval of the RCS **sender** by the carriers.
  They do not say a Content Template is approved one by one, nor that it is not. Ask Twilio
  before adding a new template in a new use case.

## What is not verified

- No handset has seen a card. The RCS sender is not approved.
- What a tap carries in the webhook (title, payload, or both).
- Limits of a template variable, and the price of a card against an SMS.
- Which field of Twilio's response or status callback says a message went as RCS. The
  `message_log` does not record the channel.
