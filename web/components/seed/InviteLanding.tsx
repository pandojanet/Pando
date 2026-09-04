"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { verifyStatus, type VerifyStatus } from "@/lib/api-client";
import {
  buildConsentRecord,
  SMS_CONSENT_AGREEMENT,
  SMS_CONSENT_REASSURANCE,
  SMS_CONSENT_TERMS,
} from "@/lib/consent";
import { formatPhone, isPhoneComplete, toE164 } from "@/lib/phone";
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
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  /** The anonymous path: contribute without Founding Status. */
  const [anonymous, setAnonymous] = useState(false);
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

  const identityComplete =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    isPhoneComplete(phone) &&
    smsConsent;
  const canBegin = anonymous || identityComplete;

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
    if (existing?.last_name) setLastName(existing.last_name);
    /**
     * The number too, or "Continue where you left off" is disabled and a parent who
     * comes back mid-flow is stuck: the dock button needs all four identity fields,
     * and this was the only one not being restored. Their own number, on their own
     * device, formatted the way they typed it.
     */
    if (existing?.phone) setPhone(formatPhone(existing.phone));
    if (existing?.sms_consent?.status === "opted_in") setSmsConsent(true);
    if (existing && existing.wants_founding === false) setAnonymous(true);
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
  function begin(mode: "new" | "resume") {
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

    const e164 = anonymous ? null : toE164(phone);
    const first = anonymous ? null : firstName.trim() || null;
    const last = anonymous ? null : lastName.trim() || null;

    const saved = saveSession({
      ...base,
      first_name: first ?? base.first_name,
      last_name: last ?? base.last_name,
      // Kept in step with the split fields for anything still reading `name`.
      name: [first, last].filter(Boolean).join(" ") || base.name,
      phone: e164 ?? base.phone,
      wants_founding: !anonymous,
      /* The checkbox is what authorises the first verification text, so the record
         is written the moment it's ticked — with the exact wording version shown. */
      sms_consent:
        anonymous || !smsConsent
          ? null
          : buildConsentRecord("sms", true, "seed_entry_phone_field"),
      /* Whatever a resumed session claims, this is re-established by the step
         below — the server is the only thing that can say a number is confirmed. */
      phone_verified: mode === "resume" ? base.phone_verified : false,
    });

    track(e164 ? "seed_phone_captured" : "seed_phone_skipped", {
      founding_path: !anonymous,
    });
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
      <ScreenHeader
        left={<Wordmark />}
        right={
          <span className="rounded-full border border-bark bg-card px-3 py-1.5 text-[12px] font-semibold text-muted">
            Founding contributor
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
         *  - **The secondary route**, "Share without joining for now" (1 Sep
         *    item 16: never "Continue anonymously", because that implies the
         *    founding route is not private).
         */}
        <div className="animate-rise">
          <Eyebrow>Founding network · Pasadena</Eyebrow>
          <h1 className="mt-3 font-display text-[1.7rem] font-extrabold leading-[1.08]">
            Your number, and you&apos;re in.
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            Pando is a text line for San Gabriel Valley parents. Tell us the
            classes, camps and caregivers you&apos;d actually vouch for —{" "}
            <strong className="font-semibold text-ink">about two minutes</strong>,
            and it&apos;s tapping rather than typing.
          </p>
        </div>

        {anonymous ? (
          <Panel className="mt-6" tone="card" raised>
            <h2 className="font-display text-[1.1rem] font-semibold">
              Share without joining for now
            </h2>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              Your recommendations can still help the network. They will not be
              connected to a founding profile, and founding benefits will not
              apply — including the thank-you, which needs a name and a number to
              send.
            </p>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-soft">
              Either way, what other parents see is the same: the recommendation,
              not who shared it.
            </p>
            <div className="mt-3">
              <TextAction onClick={() => setAnonymous(false)} tone="green">
                Join the founding network instead
              </TextAction>
            </div>
          </Panel>
        ) : (
          <Panel className="mt-6" tone="card" raised>
            {/* `on="card"` — these sit inside a raised white `Panel`, and a
                field is always the opposite surface to the thing it sits on. */}
            <div className="grid gap-3 sm:grid-cols-2">
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
              <Field
                id="last-name"
                label="Last name"
                on="card"
                value={lastName}
                onChange={(e) => setLastName(e.target.value.slice(0, 60))}
                autoComplete="family-name"
                enterKeyHint="next"
                placeholder="Alvarez"
              />
            </div>

            <div className="mt-4">
              <PhoneField
                label="Mobile number"
                hint={SMS_CONSENT_REASSURANCE}
                value={phone}
                onChange={setPhone}
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
            <Consent
              id="sms-consent"
              className="mt-4"
              on="card"
              checked={smsConsent}
              onChange={setSmsConsent}
              detail={SMS_CONSENT_TERMS}
              links={
                <>
                  <InlineAction href="/privacy" external>Privacy Policy</InlineAction>
                  <InlineAction href="/terms" external>Terms</InlineAction>
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

            <div className="mt-3">
              <TextAction onClick={() => setAnonymous(true)} tone="quiet">
                Share without joining for now
              </TextAction>
            </div>
          </Panel>
        )}

        {(canResume || alreadySaved) && (
          <Panel className="mt-6" tone="positive">
            <p className="text-[14.5px] leading-relaxed text-green-deep">
              {alreadySaved
                ? "Your profile is already saved on this phone."
                : "You have answers saved on this phone from earlier."}{" "}
              <InlineAction onClick={startOver}>
                {alreadySaved ? "Start a fresh one" : "Start over instead"}
              </InlineAction>
              .
            </p>
          </Panel>
        )}
      </ScreenBody>


      <ScreenDock stickyOnDesktop>
        {alreadySaved ? (
          <Button full onClick={() => router.push("/done")}>
            See what happens next
            <ArrowRight />
          </Button>
        ) : (
          <Button
            full
            disabled={!canBegin}
            onClick={() => begin(canResume ? "resume" : "new")}
          >
            {/**
             * 1 Sep, items 1 and 16: the primary action is *"Join the founding
             * network"*, and the secondary is the link inside the card. Resume
             * still says so, because it is the same route continued — *"both
             * routes must preserve saved answers and continue from the same
             * point."*
             */}
            {canResume
              ? "Continue where you left off"
              : anonymous
                ? "Start — about two minutes"
                : "Start — about two minutes"}
            <ArrowRight />
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
