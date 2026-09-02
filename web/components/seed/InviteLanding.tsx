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
import { identifyArrival, track } from "@/lib/analytics";
import { validateInvite, verifyStatus, type VerifyStatus } from "@/lib/api-client";
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
  const [resolved, setResolved] = useState(invite);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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
    track("seed_link_opened", { source, invite_valid: invite.valid });
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

  async function submitCode() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setChecking(true);
    setCodeError(null);
    try {
      const result = await validateInvite(trimmed);
      if (result.valid) {
        setResolved(result);
        /* A typed code is the same arrival by a slower route — re-registered, or
           every event after it would be attributed to the empty link they
           landed on. */
        identifyArrival({
          invite_code: trimmed,
          invite_group: result.group_option_value ?? null,
          source,
        });
        track("seed_invite_valid", { reason: "manual_entry" });
      } else {
        setCodeError("That code isn't one of ours. Check the message it came in?");
        track("seed_invite_invalid", { reason: "manual_entry" });
      }
    } catch {
      setCodeError("Couldn't check that just now. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  }

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
            invite_code: resolved.valid
              ? (inviteCode ?? (code.trim() || null))
              : null,
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

  if (!resolved.valid) {
    return (
      <Screen>
        <ScreenHeader left={<Wordmark />} />
        <ScreenBody>
          <Eyebrow>Invite needed</Eyebrow>
          <h1 className="mt-3 font-display text-[1.95rem] font-extrabold">
            This link needs its code.
          </h1>
          <p className="mt-4 text-[16.5px] leading-relaxed text-ink-soft">
            Pando&apos;s founding tool is shared privately inside parent groups,
            not published. Paste the code from the message you got — or scan the
            QR again.
          </p>

          <label
            htmlFor="invite-code"
            className="mt-8 block text-[15px] font-semibold"
          >
            Invite code
          </label>
          <input
            id="invite-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCode();
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="sgv-founding"
            className="mt-2.5 min-h-[52px] w-full rounded-2xl border border-bark bg-card px-4 text-[16px] outline-none placeholder:text-muted/60 focus:border-green"
          />
          {codeError && (
            <p className="mt-2.5 animate-rise text-[14px] font-medium text-gold-ink">
              {codeError}
            </p>
          )}

          <p className="mt-8 rounded-2xl border border-bark bg-card p-4 text-[14px] leading-relaxed text-muted">
            Got here by accident? Pando is a text line for San Gabriel Valley
            parents, launching this fall.{" "}
            <Link
              href="/"
              className="font-semibold text-green-deep underline decoration-gold decoration-2 underline-offset-2"
            >
              Read the story
            </Link>
            .
          </p>
        </ScreenBody>
        <ScreenDock stickyOnDesktop>
          <Button
            full
            onClick={() => void submitCode()}
            disabled={checking || code.trim().length === 0}
          >
            {checking ? "Checking…" : "Continue"}
          </Button>
          <p className="py-3 text-center text-[12.5px] text-muted">
            No app. No account. No password.
          </p>
        </ScreenDock>
      </Screen>
    );
  }


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
        <div className="animate-rise">
          <Eyebrow>Founding network · Pasadena</Eyebrow>
          <h1 className="mt-3 font-display text-[2.05rem] font-extrabold leading-[1.06]">
            You&apos;re one of the parents{" "}
            <span className="highlight-gold">everyone asks</span>.
          </h1>
          <p className="mt-4 text-[16.5px] leading-relaxed text-ink-soft">
            Pando is a text line for San Gabriel Valley parents — and it only
            works if it starts with real local knowledge. Yours. Tell us the
            classes, camps and caregivers you&apos;d actually vouch for.
          </p>
        </div>

        <ul className="mt-7 space-y-2.5 md:grid md:grid-cols-3 md:gap-3 md:space-y-0">
          <PromiseRow
            icon={<ClockIcon />}
            title="About two minutes"
            body="Two questions are required. Everything else is one tap, or skip it."
          />
          <PromiseRow
            icon={<TapIcon />}
            /* Client's wording, 24 Aug — not "Taps, not typing". */
            title="Tap, not type"
            body="Your neighborhood's schools, classes and groups are already in the list."
          />
          <PromiseRow
            icon={<ShieldIcon />}
            /**
             * 1 Sep, items 1 and 16. *"Change 'Your name is never shown' to:
             * 'Private by default. Your name and contact information are not
             * shown unless you explicitly choose otherwise.'"*
             *
             * The old line was a promise the product does not keep: P13 lets a
             * parent choose to be named, and the privacy screen offers to show
             * a shared connection. "Never" was therefore false on the one
             * screen a parent decides to trust — and it also made the founding
             * route look like the *less* private of the two, which is item 16's
             * central objection.
             */
            title="Private by default"
            body="Your name and contact information are not shown unless you explicitly choose otherwise."
          />
        </ul>

        {/**
         * 1 Sep, items 1 and 16 — the whole block rewritten, and the reframing
         * is the point rather than the copy.
         *
         * **"Sharing anonymously" was inaccurate.** Her words: recommendations
         * *are already* private from other parents by default, so calling one
         * route anonymous implied the other was not — and the founding route is
         * the one this network runs on. Worse, Pando can tie a "share without
         * joining" contribution to a device and a session, so *"do not describe
         * the contribution as anonymous if Pando can associate it with a phone
         * number, account, device or other identifier. Use 'private' or 'not
         * shown to other parents.'"*
         *
         * **"What you give up" led with a punishment.** *"Lead with what joining
         * enables rather than 'what you give up.' The current framing feels
         * punitive and may imply that joining reduces privacy."* So the list is
         * the same four facts, stated as what joining is for, and the sentence
         * that closes it is hers: joining does not change what other parents
         * see.
         *
         * **The four InfoDots are gone**, on her instruction to *"remove the
         * multiple information icons and expanded explanation boxes"* and keep
         * one privacy link. They were added on 24 Aug at her own request and
         * she has now seen them on a phone: four dots down one short list is
         * four things to tap before you can read a paragraph.
         *
         * **And the thank-you claim is conditional.** *"Only say Pando cannot
         * send the thank-you if the non-joining route genuinely leaves Pando
         * without a usable payment or contact method."* It does — that route
         * stores no name and no number at all — so the sentence stands, and it
         * is stated once, in the secondary route's own words rather than as a
         * penalty in a list.
         */}
        {anonymous ? (
          <div className="mt-7 rounded-3xl border border-bark bg-card p-5">
            <h2 className="font-display text-[1.1rem] font-semibold">
              Share without joining for now
            </h2>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              Your recommendations can still help the network. They will not be
              connected to a founding profile, and founding benefits will not
              apply — including the thank-you, which needs a name and a number
              to send.
            </p>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-soft">
              Either way, what other parents see is the same: the
              recommendation, not who shared it.
            </p>
            <button
              type="button"
              onClick={() => setAnonymous(false)}
              className="mt-3 min-h-11 text-[14.5px] font-semibold text-green-deep underline underline-offset-2"
            >
              Join the founding network
            </button>
          </div>
        ) : (
          <div className="mt-7 rounded-3xl border border-bark bg-card p-5 shadow-card">
            {/**
             * Her suggested page, in her order: what joining *enables*, then the
             * fields it needs. One privacy link at the end of the screen, and no
             * information icons — see the block comment above.
             */}
            <h2 className="font-display text-[1.1rem] font-semibold">
              Join the founding network
            </h2>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              Joining allows Pando to recognize your contribution, reserve your
              place in the pilot, and let you know when something you shared
              helps another family. As a founding contributor, you can:
            </p>
            <ul className="mt-2.5 space-y-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              <li>Receive a thank-you for your first qualifying contribution</li>
              <li>
                Earn permanent Founding Status after your second approved
                contribution
              </li>
              <li>Have a reserved place in the Pasadena pilot</li>
              <li>
                Receive private updates when your recommendations help other
                parents
              </li>
            </ul>
            {/* Her line, and it is the one that answers item 16's objection
                outright: joining is not the less private route. */}
            <p className="mt-3 rounded-2xl border border-green/20 bg-green-wash p-3 text-[14px] font-medium leading-relaxed text-green-deep">
              Joining does not change what other parents see. Your
              recommendations remain private by default.
            </p>

            <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
              Your details
            </h3>
            {/* "…confirm you're really from the group" removed on the client's
                instruction (24 Aug, item 4). Her reason is upstream of the
                wording: she is moving away from a link that belongs to a group,
                so telling a parent we are checking they belong to one reads as a
                door being guarded. The other two reasons are the real ones. */}
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              Needed for Founding Status — it&apos;s how we hold your place in
              the pilot, and thank you when a parent uses what you shared.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="first-name" className="block text-[15px] font-semibold">
                  First name
                </label>
                <input
                  id="first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value.slice(0, 40))}
                  autoComplete="given-name"
                  enterKeyHint="next"
                  placeholder="Janet"
                  className="mt-2 min-h-[52px] w-full rounded-2xl border border-bark bg-paper px-4 text-[16px] outline-none placeholder:text-muted/60 focus:border-green"
                />
              </div>
              <div>
                <label htmlFor="last-name" className="block text-[15px] font-semibold">
                  Last name
                </label>
                <input
                  id="last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value.slice(0, 60))}
                  autoComplete="family-name"
                  enterKeyHint="next"
                  placeholder="Alvarez"
                  className="mt-2 min-h-[52px] w-full rounded-2xl border border-bark bg-paper px-4 text-[16px] outline-none placeholder:text-muted/60 focus:border-green"
                />
              </div>
            </div>

            <div className="mt-4">
              <PhoneField
                label="Mobile number"
                hint={SMS_CONSENT_REASSURANCE}
                value={phone}
                onChange={setPhone}
              />
            </div>

            {/* Its own element, unchecked by default, never bundled with anything
                else — this checkbox is what authorises the verification text.

                The wording is split across a label and a described-by paragraph for
                one reason: when the whole registered text was inside the <label>, a
                tap anywhere in ~230px of legal copy toggled consent. An accidental
                opt-in is the worst failure this control has, so the label now covers
                the sentence the parent is agreeing to, and the rest sits beside it —
                same words, same order, still adjacent, and read out by a screen
                reader through aria-describedby. */}
            <div className="mt-4 rounded-2xl border border-bark bg-paper p-3.5">
              <label className="flex gap-3">
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  aria-describedby="sms-consent-detail"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-green-deep)]"
                />
                <span className="text-[13.5px] leading-relaxed text-ink-soft">
                  {SMS_CONSENT_AGREEMENT}
                </span>
              </label>
              <p
                id="sms-consent-detail"
                className="mt-2 pl-8 text-[13px] leading-relaxed text-muted"
              >
                {SMS_CONSENT_TERMS} See our{" "}
                {/* New tab on purpose: the form isn't saved until Start, so
                    navigating away here used to lose a typed name and number. */}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="-my-1 inline-block py-1 font-semibold text-green-deep underline underline-offset-2"
                >
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="-my-1 inline-block py-1 font-semibold text-green-deep underline underline-offset-2"
                >
                  Terms
                </a>
                .
              </p>
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              {gate?.required && gate.sendable
                ? "Once you've answered the questions, we'll text a 6-digit code — that's what saves them."
                : "We'll send a 6-digit code to confirm the number when you finish."}
            </p>

            {/**
             * The secondary route, in her exact words. *"Use 'Share without
             * joining for now' as the secondary action. Do not use 'Continue
             * anonymously,' because that implies the founding route is not
             * private."*
             *
             * It only switches which block is shown; the saved answers are
             * untouched either way, which is her *"both routes must preserve
             * saved answers and continue from the same point."*
             */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4">
              <button
                type="button"
                onClick={() => setAnonymous(true)}
                className="min-h-11 text-[13.5px] font-semibold text-muted underline underline-offset-2 hover:text-green-deep"
              >
                Share without joining for now
              </button>
              {/* The one privacy link she asked to keep. */}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-11 self-center text-[13.5px] font-semibold text-muted underline underline-offset-2 hover:text-green-deep"
              >
                Learn more about privacy
              </a>
            </div>
          </div>
        )}

        {(canResume || alreadySaved) && (
          <p className="mt-6 rounded-2xl border border-green/25 bg-green-wash p-4 text-[14.5px] leading-relaxed text-green-deep">
            {alreadySaved
              ? "Your profile is already saved on this phone."
              : "You have answers saved on this phone from earlier."}{" "}
            <button
              type="button"
              onClick={startOver}
              className="font-semibold underline underline-offset-2"
            >
              {alreadySaved ? "Start a fresh one" : "Start over instead"}
            </button>
            .
          </p>
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
                : "Join the founding network"}
            <ArrowRight />
          </Button>
        )}
        {/**
         * *"The footer must not create a third competing action."*
         *
         * It never was one — it is a line of text — but it did read as a third
         * offer when the card above already held two, so it now says only what
         * the button needs, and nothing when the button is ready.
         */}
        <p className="py-3 text-center text-[12.5px] text-muted">
          {canBegin
            ? "No app. No account. No password."
            : "Add your name and number, and tick the box, to join."}
        </p>
      </ScreenDock>
    </Screen>
  );
}

function PromiseRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3.5 rounded-2xl border border-bark/70 bg-card/60 p-4">
      <span className="mt-0.5 shrink-0 text-green">{icon}</span>
      <span>
        <span className="block text-[15.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-snug text-muted">
          {body}
        </span>
      </span>
    </li>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 5.8V10l3 1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TapIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M8 9V4.6a1.6 1.6 0 0 1 3.2 0V9m0 0V7.8a1.5 1.5 0 0 1 3 0V9m0 0a1.5 1.5 0 0 1 3 0v3.4A4.6 4.6 0 0 1 12.6 17h-1.2a4.4 4.4 0 0 1-3.3-1.5l-3-3.4a1.6 1.6 0 0 1 2.3-2.2L8 10.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M10 2.8 4.4 4.9v4.6c0 3.3 2.3 6.3 5.6 7.6 3.3-1.3 5.6-4.3 5.6-7.6V4.9L10 2.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.6 10.1 9.4 12l3.2-3.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
