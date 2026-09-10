"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Button } from "@/components/ui/Button";
import { PhoneField } from "@/components/ui/PhoneField";
import {
  Container,
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { Wordmark } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { Consent } from "@/components/ui/Consent";
import { InlineAction, TextAction } from "@/components/ui/TextAction";
import { identifyArrival, track } from "@/lib/analytics";
import {
  isNumberRegistered,
  verifyStatus,
  type VerifyStatus,
} from "@/lib/api-client";
import {
  buildConsentRecord,
  SMS_CONSENT_AGREEMENT,
  SMS_CONSENT_REASSURANCE,
  SMS_CONSENT_TERMS,
} from "@/lib/consent";
import { formatPhone, isPhoneComplete, toE164 } from "@/lib/phone";
import { REWARD_OFFER } from "@/lib/rewards";
import {
  hasResumableProgress,
  loadSession,
  newSession,
  saveSession,
  clearSession,
} from "@/lib/storage";
import type { InviteResult, SeedSession } from "@/lib/types";

interface Props {
  invite: InviteResult;
  inviteCode: string | null;
  source: string;
}

export function InviteLanding({ invite, inviteCode, source }: Props) {
  const router = useRouter();
  /* Not state any more, and that is the whole of what the removal cost here:
     nothing in the browser re-resolves an invite now that the code screen is
     gone, so there is nothing left to set. The server has already decided. */
  const resolved = invite;

  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [canResume, setCanResume] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);
  /** "form" until the details are in; "verify" while the code is being confirmed. */
  const [session, setSession] = useState<SeedSession | null>(null);
  /**
   * How this deployment is configured. Asked on mount rather than at the tap, so
   * the button never pauses — and null means "not answered yet", which reads as
   * "cannot verify" below: sending a parent onward is recoverable, showing a code
   * box that can never be satisfied is not.
   */
  const [gate, setGate] = useState<VerifyStatus | null>(null);
  /**
   * The number check on the way through, and its answer.
   *
   * `registered` is the refusal, and it is cleared the moment the number is
   * edited — a parent who mistyped a digit into somebody else's number must not
   * be left staring at a wall that no longer applies to what is in the field.
   */
  const [checking, setChecking] = useState(false);
  const [registered, setRegistered] = useState(false);

  /**
   * First name and mobile, and nothing else — the client, 10 Sep: *"Let's
   * collect first name and mobile only."*
   *
   * ⚠ **This reverses the 3 Aug instruction that split the name in two**, and
   * the cost is worth stating rather than discovering: a surname is what an
   * admin used to tell two Sarahs in one parent group apart on `/admin/founding`,
   * which is the queue that decides whether somebody really is who they say.
   * That judgement is now made on a first name, a masked number and the link
   * they arrived on. `people.last_name` stays in the schema and is simply never
   * filled from this screen, so nothing already stored is lost.
   */
  const canBegin =
    firstName.trim().length > 0 && isPhoneComplete(phone) && smsConsent;

  useEffect(() => {
    /**
     * Before the first capture, so `seed_link_opened` carries it too.
     *
     * This is what makes estimate 3.1's "segmented by which shared link the
     * parent arrived from" possible at all: a PostHog funnel can only break down
     * by a property present on its steps, and until now no event carried the
     * code — `source` says `qr` or `link`, never *which group*.
     */
    identifyArrival({
      invite_code: inviteCode,
      invite_group: invite.group_option_value ?? null,
      source,
    });
    track("seed_link_opened", { source });
    /* Reaching this component means one of two things: a valid code, or the
       marker from an earlier valid arrival — a Back tap from the first profile
       question, a resumed session, a link whose code has since been retired. So
       the distinction is still real and still worth recording; what changed is
       **who is left in the invalid bucket**. It is no longer strangers, because
       an arrival with neither is redirected before any client code runs, so
       ⚠ uninvited arrivals are invisible in PostHog and `invites.opens` is the
       only remaining signal for them — and that counter no longer moves for a
       *retired* code either, since the proxy turns those away before the page
       renders. `seed_invite_invalid` now means "somebody already invited arrived
       without a usable code", which is a much smaller and more useful set. */
    track(invite.valid ? "seed_invite_valid" : "seed_invite_invalid", {
      reason: invite.reason ?? null,
    });
  }, [invite.valid, invite.reason, invite.group_option_value, inviteCode, source]);

  /* Whether a code can reach this parent at all. Left null on failure, which the
     branch in `begin` treats as "no" — the flow still works, held on the phone. */
  useEffect(() => {
    void verifyStatus()
      .then(setGate)
      .catch(() => setGate(null));
  }, []);

  // Read storage after mount only — the server render can't know about it.
  useEffect(() => {
    const existing = loadSession();
    setCanResume(hasResumableProgress(existing));
    setAlreadySaved(Boolean(existing?.profile_saved_at));
    if (existing?.first_name) setFirstName(existing.first_name);
    /**
     * The number too, or "Continue where you left off" is disabled and a parent who
     * comes back mid-flow is stuck: the dock button needs all four identity fields,
     * and this was the only one not being restored. Their own number, on their own
     * device, formatted the way they typed it.
     */
    if (existing?.phone) setPhone(formatPhone(existing.phone));
    if (existing?.sms_consent?.status === "opted_in") setSmsConsent(true);
  }, []);

  /**
   * Captures the identity, then decides whether the code comes now or later.
   *
   * The code moved here (12 Aug) so that "saved" means saved: once the number is
   * confirmed, the profile and every card post as they are finished instead of
   * living on the phone until the last screen. It also fails kindly — a parent who
   * cannot receive a code finds out in the first ten seconds rather than after
   * fifteen screens of work.
   */
  async function begin(mode: "new" | "resume") {
    const e164 = toE164(phone);

    /**
     * Is this number already in Pando? Asked **here**, on the client's
     * instruction of 8 Sep, and it is the one place in this app that answers a
     * question about somebody who has proved nothing.
     *
     * Her report: entering a registered number threw the parent into the
     * questionnaire and *"інформація затирається"*. Both halves are true. The
     * write is an upsert on the number (invariant 10) and every derived set is
     * **replaced rather than merged**, so filling the form again from a second
     * device overwrote the richer profile — and the only warning came after the
     * code, i.e. after eighteen screens.
     *
     * ⚠ **This is a reversal of the 8 Sep decision that put the check behind
     * the code, and the reason that decision existed has not gone away** — it is
     * an enumeration oracle, and who is in the network is what this product does
     * not publish. The cost was put to her in those words and she chose the
     * overwrite as the bigger harm. `app/api/seed/registered/route.ts` carries
     * the four rules that narrow it; read those before touching this.
     *
     * **It refuses rather than warns**, which is her wording — *"не пропускає"*.
     * The way forward is `/signin`, which since 8 Sep restores the profile
     * *including the answers*, so updating a profile is still possible and is
     * now the honest route to it: prove the number, then edit what is there,
     * rather than retyping it and hoping the upsert keeps the rest.
     *
     * And a failure is not a wall: `isNumberRegistered` answers `false` on any
     * error, so an unreachable database lets the parent through to the flow that
     * has always caught this at the end.
     */
    if (e164) {
      setChecking(true);
      const taken = await isNumberRegistered(e164);
      setChecking(false);
      if (taken) {
        setRegistered(true);
        /* Counts and a boolean, never the number (invariant 7). */
        track("seed_number_already_registered", { source });
        return;
      }
    }

    const existing = loadSession();

    const base =
      mode === "resume" && existing
        ? existing
        : newSession({
            /* The code travels with the session; the *group* behind it does not.
               The server re-resolves it from this code on every write, so a
               client copy would only be a second version of the same fact — and
               the one the browser could edit. */
            invite_code: resolved.valid ? inviteCode : null,
            market_id: resolved.market_id,
            source,
          });

    const first = firstName.trim() || null;

    const saved = saveSession({
      ...base,
      first_name: first ?? base.first_name,
      /* Kept in step for anything still reading `name`. A surname is no longer
         collected here, so this is the first name alone — and `last_name` is
         left exactly as a resumed session had it rather than being cleared,
         because somebody who gave one under an older build still gave it. */
      name: first ?? base.name,
      phone: e164 ?? base.phone,
      wants_founding: true,
      /* The checkbox is what authorises the first verification text, so the record
         is written the moment it's ticked — with the exact wording version shown. */
      sms_consent: smsConsent
        ? buildConsentRecord("sms", true, "seed_entry_phone_field")
        : null,
      /* Whatever a resumed session claims, this is re-established by the step
         below — the server is the only thing that can say a number is confirmed. */
      phone_verified: mode === "resume" ? base.phone_verified : false,
    });

    track("seed_phone_captured", { founding_path: true });
    track(mode === "resume" ? "seed_profile_resumed" : "seed_profile_started", {
      market_id: resolved.market_id,
      source,
    });

    /**
     * The code is **not** asked for here (13 Aug). It sat on this screen for a
     * day, and it was the wrong door: a parent who has not yet seen a single
     * question was being asked to prove a phone number, which is exactly the
     * friction the client wanted kept off the entrance.
     *
     * It now sits at the end of the profile — the answers are on this phone until
     * then, so the rule that matters is unchanged: abandon before the code and
     * nothing exists anywhere. `ProfileFlow` owns it, and it awaits the status
     * rather than reading whatever a background fetch had finished, which is what
     * used to let a slow response wave somebody straight past it.
     */
    router.push("/profile");
  }

  function startOver() {
    clearSession();
    setCanResume(false);
    setAlreadySaved(false);
  }

  /**
   * ⚠ **The invite-code screen is gone** — the client's call, 4 Sep — and it is a
   * change to who can reach this tool, not to how a screen looks.
   *
   * `/join` used to branch here on `!resolved.valid` and *ask* for a code: its
   * own screen, with a field, a "Checking…" button and a manual-entry analytics
   * path. **The gate itself did not go with it.** It moved one layer up and got
   * stricter: `app/(seed)/join/page.tsx` now redirects an arrival with no code,
   * a retired one or an unknown one to the public site, so an uninvited visitor
   * never reaches this component at all. Access is by link.
   *
   * Why the screen was the wrong answer rather than merely an extra step: it was
   * the one place this address was useful to somebody who had *not* been invited
   * — it confirmed they had found the right door and only lacked the key — while
   * 1.1's rule is that the founding tool is "shared privately inside parent
   * groups, not published".
   *
   * **What is unchanged.** The gate is still *soft* everywhere below this point:
   * nothing authenticates anybody, `invite_code` may still be null on a session,
   * and the write routes still accept one — a link forwarded last week must not
   * become a dead end mid-flow (12 Aug). Attribution is unchanged too: a valid
   * `?i=` still lands on `people.invite_id`, still segments PostHog, still counts
   * an open.
   */


  return (
    <Screen>
      {/**
       * 1 Sep, items 1 and 16: *"Remove the contradictory Founding parent badge
       * until Founding Status has actually been earned. Use 'Founding
       * contributor' before then if a label is needed."*
       *
       * The badge said a parent already held a status the very next paragraph
       * explained they would earn on their second approved contribution — the
       * screen contradicting itself in two places a thumb apart. "Founding
       * contributor" is what they are the moment they start, and it is the word
       * `/done` has used since 6 Aug.
       */}
      {/* The badge takes `text-dock` (12.5px) rather than a bracket value: 12px
          is below the design system's own floor and is not a step on the scale.
          It was the last hand-written font size on this screen. */}
      <ScreenHeader
        left={<Wordmark />}
        right={
          /* 10 Sep, the client: *"Use 'Founding Contributor' and 'San Gabriel
             Valley' everywhere vs the current mixture."* Both halves were a
             real mixture rather than a preference — this badge said "Founding
             contributor" while `/done` says "Founding Status", and the eyebrow
             below said "Pasadena", which is one of seventeen towns on offer and
             not the market. */
          <span className="rounded-full border border-bark bg-card px-3 py-1.5 text-dock font-semibold text-muted">
            Founding Contributor
          </span>
        }
      />

      <ScreenBody className="pt-7">
        {/**
         * 3 Sep, her instruction: *"Проміжну сторінку «Join the founding
         * Network» вирішено видалити. Користувачі повинні потрапляти за
         * загальним посиланням/QR-кодом безпосередньо на екран введення номера
         * телефону."*
         *
         * ## What was here, and why it going is a real change rather than a trim
         *
         * A hero, three promise rows, and a card explaining what joining
         * enables — four benefits, a green reassurance box and a privacy link.
         * Most of it was built on **1 Sep from her own suggested page** (items 1
         * and 16), so this reverses that round deliberately: the newer
         * instruction wins, which is this file's own rule for her feedback.
         *
         * What it costs, stated rather than discovered later: a parent arriving
         * cold now reads three lines instead of a page before being asked for a
         * number. The four founding benefits she dictated on 1 Sep ("earn
         * permanent Founding Status after your second approved contribution",
         * "a reserved place in the Pasadena pilot") are **no longer anywhere in
         * the flow** — `/done` still names Founding Status, but only after the
         * fact. If she wants them back, the place is a tooltip on the badge
         * rather than a page.
         *
         * What survives, and each for a reason she gave earlier:
         *
         *  - **"Private by default"** — one line, because it is the promise the
         *    parent is deciding on (1 Sep item 1: her exact replacement for
         *    "Your name is never shown", which was false).
         *  - **"Tap, not type"** — her wording, 24 Aug item 2, and it sets the
         *    expectation that makes the next screen make sense.
         *
         * ⚠ The third survivor of that round — the secondary, no-account route
         * — is **gone as of 10 Sep**; see the note above the card below. Her 1
         * Sep rule about how it had to be *worded* went with it.
         */}
        <div className="animate-rise">
          <Eyebrow>Founding Contributor · San Gabriel Valley</Eyebrow>
          <h1 className="mt-3 font-display text-[1.7rem] font-extrabold leading-[1.08]">
            Your number, and you&apos;re in.
          </h1>
          {/**
           * *"If the invite code resolves, show '{first name} invited you';
           * otherwise show nothing."* (10 Sep.)
           *
           * ⚠ **A code that resolves perfectly well can still have nobody
           * behind it, and that is the common case rather than an edge.** An
           * invite is per *group* (12 Aug, reaffirmed 27 Aug), and since
           * `drizzle/0034` it may also point at a school — neither has a person
           * to name. Only `invites.kind = 'personal'` carries a
           * `referrer_person_id`, which is why `lib/server/invite.ts` reads the
           * first name through a `case` on the kind rather than a plain join:
           * a group link must resolve to attribution and to no name at all.
           *
           * So "otherwise show nothing" is honoured by the null, and this line
           * is deliberately not softened into "you were invited" for the group
           * case — that says nothing the screen does not already say.
           */}
          {resolved.inviter_first_name && (
            <p className="mt-3 text-[15px] font-semibold leading-snug text-green-deep">
              {resolved.inviter_first_name} invited you
            </p>
          )}
          {/**
            * The launch offer, once, here — the client, 10 Sep §6: *"Use the
            * exact offer sentence in the invite text and **once** on the Join
            * page under '{first name} invited you'. Link Terms. Keep it
            * separate from SMS consent."*
            *
            * ⚠ **Separate from the consent, and that is a rule rather than
            * layout.** A payment offer inside a `<label>` would make agreeing
            * to messages and accepting an offer one tap, which is the shape a
            * TCPA complaint reads worst — so it sits here, above the form, and
            * the consent box below is untouched.
            *
            * ⚠ **Once.** Her word, and it is why this is not repeated on the
            * profile: *"Do not show the reward or add a reward step anywhere in
            * the profile."* A parent answering questions should not be counting
            * money while they do it.
            *
            * ⚠ It renders for **every** arrival rather than only an invited
            * one, and the guardrail lives where it can be enforced:
            * *"invite-code holders only"* is a condition of being **paid**
            * (`rewardStatus`), and a promise shown only to some arrivals would
            * be a second, quieter eligibility rule on a screen. Entry has been
            * open since 7 Sep, so the two are no longer the same population.
            */}
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">
            {REWARD_OFFER}{" "}
            <InlineAction href="/terms" external tone="green">
              Terms
            </InlineAction>
          </p>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            Pando is a text line for San Gabriel Valley parents. Tell us the
            classes, camps and caregivers you&apos;d actually vouch for —{" "}
            <strong className="font-semibold text-ink">about two minutes</strong>,
            and it&apos;s tapping rather than typing.
          </p>
        </div>

        {/**
         * ⚠ **The no-account route is gone** — the client, 10 Sep: *"Remove the
         * no-account route."*
         *
         * It was hers too (3 Aug), so this is a reversal rather than a tidy-up,
         * and the newer instruction wins by this file's own rule. What goes with
         * it, stated rather than left to be found: there is no longer any way to
         * contribute without a number, so **a parent who will not give one
         * cannot use the tool at all** — the flow's one path is now the founding
         * path. A stored session from the old route (`wants_founding: false`)
         * still loads and is simply treated as founding from here, which is the
         * only behaviour left that is not a dead end.
         */}
        <Panel className="mt-6" tone="card" raised>
          {/* `on="card"` — these sit inside a raised white `Panel`, and a
            field is always the opposite surface to the thing it sits on. */}
          {/* One column, not a grid: with the surname gone there is one field,
            and `sm:grid-cols-2` around a single child put it in half a card. */}
          <Field
          id="first-name"
          label="First name"
          on="card"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value.slice(0, 40))}
          autoComplete="given-name"
          enterKeyHint="next"
          placeholder="Janet"
          />

          <div className="mt-4">
          {/**
           * `country="US"` — *"Fix the code to +1 vs current number."*
           *
           * The picker was added on 20 Aug so a `+380` could be typed at all,
           * which is a testing need rather than a parent's: the market is the
           * San Gabriel Valley, so every real contributor on this screen has a
           * `+1`, and a country selector in front of the number reads as a
           * question about something they have no reason to think about.
           *
           * ⚠ It is fixed **here only**. `/signin`, the caregiver flow and the
           * chat keep the picker, so a `+380` already stored can still get
           * back in — and the parsing in `lib/phone.ts` is untouched, so
           * nothing about how a number is stored or compared changed.
           */}
          <PhoneField
            label="Mobile number"
            country="US"
            value={phone}
            onChange={(next) => {
              setPhone(next);
              /* The refusal belongs to the number that produced it. */
              setRegistered(false);
            }}
          />
          </div>

          {/**
           * The consent box, and 3 Sep moved two things into it.
           *
           * Her instruction: *"Посилання на політику конфіденційності потрібно
           * підняти вище, ближче до чекбоксу згоди на отримання SMS. Learn
           * more... перенести в цей бокс."*
           *
           * The Privacy Policy and Terms links were already inside this box,
           * but below a paragraph of carrier disclosure and indented under it
           * — far enough down that they read as belonging to the disclosure
           * rather than to the tick. They now sit **directly under the
           * label**, on their own line, ahead of the disclosure; and "Learn
           * more about privacy", which used to live at the very bottom of the
           * screen beside the secondary action, is here too.
           *
           * That is the right place for a different reason as well: this is
           * the one control on the screen that grants something, so the thing
           * a parent might want to read before granting it belongs beside it
           * rather than a screen away.
           *
           * **The wording split is unchanged and is not cosmetic.** The
           * `<label>` covers only the sentence being agreed to; the carrier
           * disclosure sits beside it via `aria-describedby`. When the whole
           * registered text was inside the label, a tap anywhere in ~230px of
           * legal copy toggled consent, and an accidental opt-in is the worst
           * failure this control has.
           */}
          {/**
           * The links sit immediately under the tick, ahead of the disclosure,
           * and open in a new tab on purpose: nothing is saved until Start, so
           * navigating away here used to lose a typed name and number.
           *
           * **"Learn more about privacy" was this link.** Her two instructions
           * name it twice — raise the Privacy Policy link to the checkbox, and
           * move "Learn more…" into this box — and both were the same
           * `/privacy` page under two names. A row with two links to one page
           * is a reader deciding which of them is the real one, so it says it
           * once. **"Privacy Policy" is the name that survives**, and that is
           * not a style call: it is the document a consent box has to point at
           * by its own name, and it is the phrase the registered A2P opt-in
           * language pairs with Terms.
           */}
          {/**
            * ⚠ **Promoted out of the phone field, 10 Sep**: *"Keep 'We won’t
            * text you anything you didn’t ask for.' and make it more
            * visible."*
            *
            * It was the field’s `hint` — 12.5px muted, under the input, and
            * sharing that slot with the format error, so on the one screen
            * where a parent decides whether to hand over a number it was the
            * quietest thing on it. Here it is body type directly above the box
            * it is about.
            *
            * ⚠ It is deliberately **outside** the `<label>`: it is reassurance
            * rather than a term being agreed to, and a label that swallowed it
            * would turn the sentence into a control that toggles consent —
            * which is the split `Consent` exists to make structural.
            */}
          <p className="mt-4 text-control font-medium text-ink">
            {SMS_CONSENT_REASSURANCE}
          </p>
          <Consent
            id="sms-consent"
            className="mt-2"
            on="card"
            checked={smsConsent}
            onChange={setSmsConsent}
            detail={SMS_CONSENT_TERMS}
            links={
              <>
                {/* `TextAction`, not `InlineAction`: these are their own row
                    now rather than a clause in a sentence, so the 2.5.8
                    exemption that let them be 31px no longer applies to them.
                    See `Consent`. */}
                <TextAction href="/privacy" external>
                  Privacy Policy
                </TextAction>
                <TextAction href="/terms" external>
                  Terms
                </TextAction>
              </>
            }
          >
            {SMS_CONSENT_AGREEMENT}
          </Consent>

          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            {gate?.required && gate.sendable
              ? "Once you've answered the questions, we'll text a 6-digit code — that's what saves them."
              : "We'll send a 6-digit code to confirm the number when you finish."}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4">
            {/**
              * The way back in (7 Sep, her second instruction). On this screen
              * rather than only in the header, because a returning parent's
              * mistake is to start filling the form in again — and the moment
              * they notice is when they are looking at it.
              */}
            {/* 9 Sep, her copy list. "I've joined before" described a fact
                about the past; what a returning parent is looking for on this
                screen is the way in, and every product they use calls it
                logging in. */}
            <TextAction href="/signin" tone="quiet">
              Already have an account? Log in
            </TextAction>
          </div>
          </Panel>

        {registered && (
          /**
           * Gold, not red: this is not an error and they have done nothing
           * wrong — `warning` is *pending or needs care* in this design system,
           * and `alert` is reserved for what is owed a person today (and never
           * appears in the parent flow at all).
           *
           * It says **what would have happened**, because "this number is
           * already registered" on its own reads as a refusal to let them in
           * rather than as a protection of their own answers — and the whole
           * reason the client asked for this screen is the overwrite.
           *
           * ⚠ New user-facing copy, on the list for the client.
           */
          <Panel className="mt-6" tone="warning">
            <p className="text-[14.5px] leading-relaxed">
              This number already has a Pando profile. Filling the questions in
              again would replace what is there, so sign in instead — you can
              change any answer once you&apos;re in.
            </p>
            <div className="mt-3">
              <TextAction href="/signin">
                Sign in with this number
              </TextAction>
            </div>
          </Panel>
        )}

        {/**
          * ⚠⚠ **"Start a fresh one" is gone, and it was a dead end she walked
          * into** — the client, 10 Sep: *"I clicked 'Your profile is already
          * saved on this phone. Start a fresh one'. It just took me back to
          * where I was."*
          *
          * It was doing exactly what it said and the product refuses the
          * result. `startOver` clears the device — and the number is still
          * registered, so the 8 Sep check on the button below then refuses the
          * same number and points at `/signin`, which restores the profile they
          * had just asked to be rid of. A control that clears local state and
          * is then overruled by server state one tap later is worse than no
          * control: it looks like it worked.
          *
          * What she actually wanted is in the same paragraph — *"I wanted to
          * change one of my answers"* — so the offer is now editing, which is
          * a thing this product can do: `/profile` opens on the review for a
          * saved profile (7 Sep) and every row there has its own Edit.
          *
          * ⚠ **Only the saved case changed.** Unsaved progress has no server
          * state to contradict it, so "Start over instead" still means what it
          * says and still works.
          *
          * ⚠ What is still missing, and is hers to weigh: **there is no way for
          * a parent to delete their profile** ("how do people delete their
          * profile if they want to?"). A caregiver can text DELETE (11.3); a
          * contributing parent cannot, from any surface. That is a product
          * decision about what deletion means for their contributions, not a
          * missing button.
          */}
        {(canResume || alreadySaved) && (
          <Panel className="mt-6" tone="positive">
            <p className="text-[14.5px] leading-relaxed text-green-deep">
              {alreadySaved ? (
                <>
                  Your profile is already saved on this phone.{" "}
                  <InlineAction onClick={() => router.push("/profile")}>
                    Review or edit your answers
                  </InlineAction>
                  .
                </>
              ) : (
                <>
                  You have answers saved on this phone from earlier.{" "}
                  <InlineAction onClick={startOver}>Start over instead</InlineAction>
                  .
                </>
              )}
            </p>
          </Panel>
        )}
      </ScreenBody>


      {/**
       * Not `stickyOnDesktop`, and the reason is this screen's own shape rather
       * than a preference about docks.
       *
       * The button is disabled until the consent box is ticked, and that box is
       * *below* the dock in the flow — so a dock pinned on a laptop paints a
       * permanently dead button over the one control that would enable it, with
       * a hint underneath naming a checkbox it is covering. Measured at
       * 1440x720: the box sits at y=656 against a dock top of y=596, i.e.
       * covered on first paint (it is reachable — scrolling to the bottom puts
       * it at y=253 — but the parent has to scroll past a disabled CTA to find
       * out why it is disabled).
       *
       * Pinning bought nothing here: nobody can press Start before scrolling to
       * the box anyway. In the flow the action sits after the content, which is
       * what every other screen in this flow already does.
       */}
      <ScreenDock>
        {alreadySaved ? (
          <Button full onClick={() => router.push("/done")}>
            See what happens next
            <ArrowRight />
          </Button>
        ) : (
          <Button
            full
            /* Disabled *while* checking rather than only afterwards: the check
               is a round trip, and a second tap would run it twice and race
               its own `setChecking`. `registered` keeps it disabled after, so
               the refusal cannot be tapped past — editing the number clears
               both. */
            disabled={!canBegin || checking || registered}
            onClick={() => void begin(canResume ? "resume" : "new")}
          >
            {/**
             * ✅ **Settled, 10 Sep — the code is sent at the end of the
             * profile.** This button asked for a decision twice and has one.
             *
             * Her list twice said the join CTA should read *"Text me a code."*
             * A button saying that has to send one, which would move the OTP to
             * the front door — where it sat for a day on 13 Aug and was
             * deliberately taken off. Asked directly, the answer was *"Ні, код
             * надсилаємо в кінці"*, so the placement stands and this label
             * stays the one that describes what the tap actually does.
             *
             * ⚠ **Her wording is not dropped — it is on the control that really
             * sends a code**, which is the send button in `VerifyPhone` at the
             * end of the flow, and the dock on `/signin`. Both read "Text me a
             * code" today, so the sentence she asked for is the one a parent
             * reads at the moment it becomes true. That is the whole of why
             * this was worth asking about rather than pasting.
             */}
            {checking
              ? "Checking…"
              : canResume
                ? "Continue where you left off"
                : "Start — about two minutes"}
            {!checking && <ArrowRight />}
          </Button>
        )}
        {/**
         * *"The footer must not create a third competing action."*
         *
         * It never was one — it is a line of text — but it did read as a third
         * offer when the card above already held two, so it says only what the
         * button needs.
         *
         * **And nothing at all once the button is ready** (2 Sep, client): "No
         * app. No account. No password." was a reassurance about *signing up*,
         * printed under a button that by then says "Continue where you left
         * off" — so it was answering a worry the parent had already moved past,
         * in the one slot where the screen should be quiet.
         */}
        {!canBegin && (
          <p className="py-3 text-center text-[12.5px] text-muted">
            Add your name and number, and tick the box, to join.
          </p>
        )}
      </ScreenDock>
    </Screen>
  );
}
