"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/Button";
import { PandoMark, Wordmark } from "@/components/ui/Logo";
import {
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { track } from "@/lib/analytics";
import { completeSeed, verifyStatus, type VerifyStatus } from "@/lib/api-client";
import { buildConsentRecord, FOLLOW_UP_CONSENT_TEXT } from "@/lib/consent";
import { DemandQuestion } from "@/components/seed/DemandQuestion";
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import { flushSession, holdsUntilVerified } from "@/lib/submit";
import { cn } from "@/lib/cn";
import { submissionTitle } from "@/lib/seed-chat/engine";
import type { ShareKind, Submission } from "@/lib/seed-chat/types";
import { loadSession, saveSession } from "@/lib/storage";
import type { SeedSession } from "@/lib/types";

/**
 * Estimate 1.7 — the completion screen.
 *
 * Five things, in the order the estimate lists them: an immediate thank-you, the
 * founding badge, what happens next, the follow-up permission, and a way back in
 * to add more later.
 *
 * Two corrections from the client's v3.2 round, both deliberate:
 *  - the founding badge is shown as *pending confirmation*, not granted. Founding
 *    comes out of the admin approval queue ("is this really Sarah from our
 *    group?"), so promising it here would be a promise we can't keep.
 *  - the follow-up opt-in is a real, explicit consent step with its wording
 *    versioned (lib/consent.ts), because it is taken on the web months before the
 *    SMS channel exists and it is what makes a seed contributor reachable later.
 */

const KIND_LABEL: Record<ShareKind, string> = {
  activity: "Activity",
  caregiver: "Caregiver",
  place: "Place",
  tip: "Tip",
};

export function ProfileSaved() {
  const [session, setSession] = useState<SeedSession | null>(null);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** The founding path answered the follow-up and now owes us a code. */
  const [needsVerify, setNeedsVerify] = useState(false);
  /**
   * How this deployment is configured. Null until it answers — the follow-up buttons
   * wait for it, because the wrong branch either loses a submission or asks for a code
   * that can never arrive.
   */
  const [gate, setGate] = useState<VerifyStatus | null>(null);
  const viewed = useRef(false);

  useEffect(() => {
    const existing = loadSession();
    setSession(existing);
    setAnswer(existing?.follow_up_opt_in ?? null);
    setDone(Boolean(existing?.completed_at));

    void verifyStatus()
      .then(setGate)
      // If we can't ask, assume the gate is on: refusing to submit is recoverable,
      // submitting something that should have waited is not.
      .catch(() =>
        setGate({ required: true, sendable: false, provisioned: false, dev_codes: false }),
      );

    if (!viewed.current) {
      viewed.current = true;
      track("seed_completion_viewed", {
        shared: existing?.chat?.submissions.length ?? 0,
        already_completed: Boolean(existing?.completed_at),
      });
    }
  }, []);

  const shared: Submission[] = session?.chat?.submissions ?? [];
  const count = shared.length;
  const hasPhone = Boolean(session?.phone);
  /** They chose the labelled path that has no Founding status and no follow-ups. */
  const anonymous = session?.wants_founding === false;

  /**
   * Everything held on the phone goes up in one pass, once the code is confirmed.
   * Order matters: contributor, then their cards, then the completion record.
   */
  async function flush(optedIn: boolean, verified: boolean) {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const result = await flushSession(session, { follow_up_opt_in: optedIn });
      const next = saveSession({
        ...session,
        /* Only true when a code was actually confirmed. With the gate off the number
           is unverified, and saying otherwise here would be a lie the founding
           checklist later reads as fact. */
        phone_verified: verified,
        completed_at: new Date().toISOString(),
      });
      setSession(next);
      setDone(true);
      setNeedsVerify(false);
      track("seed_submit_flushed", {
        verified,
        profile: result.profile,
        cards: result.cards_persisted,
        cards_total: result.cards_total,
        persisted: result.completion.persisted,
      });
      track("seed_completion_recorded", {
        opted_in: optedIn,
        persisted: result.completion.persisted,
        shared: count,
      });
    } catch {
      setError(
        "That didn't go through. Everything is still safe on this phone — try again.",
      );
      track("seed_submit_failed");
    } finally {
      setSaving(false);
    }
  }

  async function submit(optedIn: boolean) {
    if (!session) return;
    setAnswer(optedIn);
    setError(null);
    track("seed_follow_up_answered", { opted_in: optedIn, has_phone: hasPhone });

    /* Founding path with the gate on: nothing has been sent yet and nothing will be
       until the code is confirmed. Record the answer on this phone and open the gate.

       With the gate off (SEED_REQUIRE_VERIFICATION=0 — the pilot running before Twilio
       is provisioned) the same held profile and cards flush right here instead. The
       number stays unconfirmed, so `phone_verified_at` is null and these contributors
       cannot reach Founding until they confirm one later. */
    if (holdsUntilVerified(session)) {
      const next = saveSession({
        ...session,
        follow_up_opt_in: optedIn,
        consent: buildConsentRecord("follow_up", optedIn, "seed_completion_screen"),
      });
      setSession(next);

      if (gate && !gate.required) {
        void flush(optedIn, false);
        return;
      }

      setNeedsVerify(true);
      return;
    }

    setSaving(true);

    const counts = shared.reduce<Record<string, number>>((acc, s) => {
      acc[s.kind] = (acc[s.kind] ?? 0) + 1;
      return acc;
    }, {});

    try {
      const result = await completeSeed({
        invite_code: session.invite_code,
        source: session.source,
        is_test: session.is_test === true,
        name: session.name,
        phone: session.phone,
        follow_up_opt_in: optedIn,
        monthly_contact_allowance: session.answers.allowance
          ? Number(session.answers.allowance)
          : 3,
        demand: session.demand,
        shared: counts,
        profile_saved_at: session.profile_saved_at,
        started_at: session.started_at,
      });

      const next = saveSession({
        ...session,
        follow_up_opt_in: optedIn,
        consent: buildConsentRecord(
          "follow_up",
          optedIn,
          "seed_completion_screen",
        ),
        completed_at: new Date().toISOString(),
      });
      setSession(next);
      setDone(true);
      track("seed_completion_recorded", {
        opted_in: optedIn,
        persisted: result.persisted,
        shared: count,
      });
    } catch {
      setError("That didn't save. Your answers are safe on this phone — try again.");
      track("seed_completion_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader left={<Wordmark />} />

      <ScreenBody className="pt-8">
        <div className="animate-rise">
          {/* The entry screen told the anonymous path, in so many words, that it
              gives up Founding status. Showing them this badge anyway would be the
              app contradicting its own promise on the last screen they see. */}
          <span
            className={cn(
              "inline-flex animate-pop items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold",
              anonymous
                ? "border-bark bg-card text-ink-soft"
                : "border-gold-line bg-gold-wash text-gold-ink",
            )}
          >
            <PandoMark className="h-4" />
            {anonymous
              ? "Anonymous contributor"
              : "Founding contributor · in review"}
          </span>

          <h1 className="mt-5 font-display text-[2rem] font-extrabold leading-[1.08]">
            {session?.name ? `Thank you, ${session.name}.` : "Thank you."}
          </h1>

          <p className="mt-4 text-[16.5px] leading-relaxed text-ink-soft">
            {count > 0
              ? "What you shared goes into the founding layer of your neighborhood — the knowledge Pando answers from when a parent nearby asks."
              : "Your profile is saved. It's what lets Pando send a question to the handful of parents whose lives actually look like yours."}
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            A real person reads every contribution before it joins the network.
            {anonymous ? (
              <>
                {" "}
                You shared anonymously, so there&apos;s nothing more for you to do and
                nothing for us to send — what you gave still counts.
              </>
            ) : (
              <>
                {" "}
                Founding status activates when your second contribution is approved —
                we&apos;ll text you the moment it does, with a link to reserve your
                place.
              </>
            )}
          </p>

          {count > 0 && (
            <div className="mt-6 overflow-hidden rounded-3xl border border-bark bg-card shadow-card">
              <p className="border-b border-bark/70 bg-green-wash px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-[0.09em] text-green-deep">
                {count === 1 ? "What you shared" : `What you shared · ${count}`}
              </p>
              <ul className="divide-y divide-bark/60">
                {shared.map((submission) => (
                  <li
                    key={submission.id}
                    className="flex items-baseline gap-3 px-4 py-3"
                  >
                    <span className="w-[5.5rem] shrink-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
                      {KIND_LABEL[submission.kind]}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] leading-snug">
                      {submissionTitle(submission)}
                      {submission.kind === "caregiver" && (
                        <span className="ml-2 rounded-full border border-gold-line bg-gold-wash px-2 py-0.5 text-[11px] font-semibold text-gold-ink">
                          consent pending
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Demand capture: the first moment in the whole flow where the parent
              gets to ask for something. */}
          {session && (
            <DemandQuestion
              saved={session.demand}
              onSave={(value) => {
                const next = saveSession({
                  ...session,
                  demand: value.question_text ? value : null,
                });
                setSession(next);
              }}
            />
          )}

          {/* Follow-up permission — the one Phase 1 answer that decides whether
              this parent can be reached once the network is live. Needs a session
              to attach the consent record to; without one there is nothing to
              consent *for*, so we point back to the start instead of showing a
              button that can't do anything. */}
          {session ? (
            <FollowUpCard
              answer={answer}
              done={done}
              saving={saving}
              hasPhone={hasPhone}
              allowance={
                session.answers.allowance ? Number(session.answers.allowance) : 3
              }
              onAnswer={(value) => void submit(value)}
            />
          ) : null}

          {/* The gate. Nothing above this point has left the phone. */}
          {session?.phone && needsVerify && !done && gate?.sendable === false && (
            <div className="mt-7 rounded-3xl border border-gold-line bg-gold-wash p-5">
              <h2 className="font-display text-[1.15rem] font-semibold text-gold-ink">
                We can&apos;t confirm your number yet.
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-gold-ink/90">
                Pando&apos;s texting isn&apos;t switched on, so there&apos;s no code to
                send you — and we won&apos;t pretend otherwise. Everything you wrote is
                still on this phone: open this same link when we text you that it&apos;s
                live, and it picks up right here.
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-gold-ink/80">
                Nothing has been sent anywhere, and nothing has been lost.
              </p>
            </div>
          )}

          {session?.phone && needsVerify && !done && gate?.sendable !== false && (
            <VerifyPhone
              phone={session.phone}
              allowance={
                session.answers.allowance ? Number(session.answers.allowance) : 3
              }
              busy={saving}
              onVerified={() => void flush(answer === true, true)}
            />
          )}

          {!session && (
            <p className="mt-7 rounded-2xl border border-bark bg-card p-4 text-[14.5px] leading-relaxed text-muted">
              We don&apos;t have a session on this phone — nothing was lost, but to
              be counted as a founding parent,{" "}
              <Link
                href="/join"
                className="font-semibold text-green-deep underline underline-offset-2"
              >
                start from your invite link
              </Link>
              .
            </p>
          )}

          {error && (
            <p className="mt-3 animate-rise rounded-2xl border border-gold-line bg-gold-wash p-3 text-[14px] font-medium text-gold-ink">
              {error}
            </p>
          )}

          <h2 className="mt-8 font-display text-[1.15rem] font-semibold">
            What happens next
          </h2>
          <ol className="mt-3 space-y-2.5">
            {count === 0 && (
              <Next
                n="1"
                title="The part only you can answer"
                body="A short chat about the classes, camps and caregivers you'd actually vouch for."
              />
            )}
            <Next
              n={count === 0 ? "2" : "1"}
              title="Received — being read"
              body="A real person reads every contribution. If something needs one more detail, we'll ask a friendly question rather than reject it."
            />
            <Next
              n={count === 0 ? "3" : "2"}
              title="Added to Pando"
              body="Once it passes review, it's part of what your neighborhood knows. Two approved contributions make you a Founding Contributor."
            />
            <Next
              n={count === 0 ? "4" : "3"}
              title="Caregivers set up their own profile"
              body="We never contact anyone you nominate and we store nothing about them — you send them the invite, and everything after that is theirs to decide."
            />
            <Next
              n={count === 0 ? "5" : "4"}
              title="Pasadena goes live"
              body="Founding parents get first access, permanent founding status, and their first Network Ask on us."
            />
          </ol>

          {session && <ReferralCard firstName={session.first_name ?? session.name} />}

          <div className="mt-8 rounded-2xl border border-bark bg-card p-4">
            <h3 className="text-[15.5px] font-semibold">
              Thought of something later?
            </h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              Open this same link again on this phone and pick up where you left
              off — no password, no account. One more recommendation is genuinely
              useful.
            </p>
          </div>
        </div>
      </ScreenBody>

      <ScreenDock>
        <Link
          href="/share"
          onClick={() => track("seed_return_clicked", { shared: count })}
          className={buttonClass("primary", true)}
        >
          {count > 0 ? "Add one more" : "Share a recommendation"}
        </Link>
        <Link
          href="/profile"
          className="mt-2 flex min-h-[48px] items-center justify-center text-[15px] font-semibold text-green-deep"
        >
          Review my answers
        </Link>
        <p className="py-2 text-center text-[12.5px] text-muted">
          hello@pando.is · Pasadena, CA
        </p>
      </ScreenDock>
    </Screen>
  );
}

/**
 * D2 — referral. The reward is real ("a free Targeted Network Ask") but it is
 * earned, not given: the invited parent has to complete a profile *and* have a
 * contribution approved.
 *
 * One honest limitation on the screen's promise: with a single shared invite link
 * there is no way to attribute a signup to the parent who sent it. Rather than
 * imply otherwise, the card asks them to mention their name — and unique links are
 * an open question in docs/spec-compliance-review.md.
 */
function ReferralCard({ firstName }: { firstName: string | null }) {
  const [copied, setCopied] = useState(false);
  const message =
    `I just joined Pando — it's a private network of local parents that answers the ` +
    `questions you'd normally ask in a group chat, except the answers come from ` +
    `parents whose kids are the same age as yours.

` +
    `They're building the Pasadena network now: pando.is/join` +
    (firstName ? `

(If you sign up, mention ${firstName} sent you.)` : "");

  return (
    <div className="mt-8 rounded-2xl border border-bark bg-card p-4">
      <h3 className="text-[15.5px] font-semibold">
        Know another parent whose recommendations people trust?
      </h3>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">
        When someone you invite completes their profile and has a contribution
        approved, you earn a free Targeted Network Ask.
      </p>
      <p className="mt-3 whitespace-pre-line rounded-2xl border border-bark bg-paper p-3 text-[14px] leading-relaxed">
        {message}
      </p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard
            .writeText(message)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2400);
              track("seed_referral_copied");
            })
            .catch(() => setCopied(false));
        }}
        aria-live="polite"
        className="mt-3 min-h-[44px] w-full rounded-full border border-green bg-card px-4 text-[15px] font-semibold text-green-deep"
      >
        {copied ? "Copied — send it to one parent" : "Copy the invite"}
      </button>
    </div>
  );
}

function FollowUpCard({
  answer,
  done,
  saving,
  hasPhone,
  allowance,
  onAnswer,
}: {
  answer: boolean | null;
  done: boolean;
  saving: boolean;
  hasPhone: boolean;
  /** The cap the parent set on the profile screen, echoed back to them here. */
  allowance: number;
  onAnswer: (value: boolean) => void;
}) {
  if (done && answer !== null) {
    return (
      <div
        className={cn(
          "mt-7 rounded-3xl border p-5",
          answer
            ? "border-green/25 bg-green-wash"
            : "border-bark bg-card",
        )}
      >
        <p
          className={cn(
            "text-[15.5px] font-semibold",
            answer ? "text-green-deep" : "text-ink",
          )}
        >
          {answer
            ? "You're in for occasional follow-ups."
            : "No follow-ups — noted."}
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
          {answer
            ? `At most ${allowance} a month — the limit you set — and never a marketing message. Reply STOP any time once we're live.`
            : "You'll still be a founding parent. We just won't text you about what you shared."}
        </p>
        <button
          type="button"
          onClick={() => onAnswer(!answer)}
          disabled={saving}
          className="mt-3 min-h-11 text-[14px] font-semibold text-green-deep underline underline-offset-2 disabled:text-muted"
        >
          {answer ? "Actually, don't text me" : "Actually, follow-ups are fine"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-7 rounded-3xl border border-bark bg-card p-5 shadow-card">
      <h2 className="font-display text-[1.15rem] font-semibold">
        One permission, then you&apos;re done
      </h2>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
        When another parent asks about something you shared, may Pando text you to
        check it&apos;s still current — or ask a question your experience can
        answer?
      </p>

      <p className="mt-3 rounded-2xl bg-paper p-3.5 text-[13px] leading-relaxed text-muted">
        {FOLLOW_UP_CONSENT_TEXT}
      </p>

      {!hasPhone && (
        <p className="mt-3 text-[13px] leading-relaxed text-gold-ink">
          You didn&apos;t leave a number, so we can&apos;t text you either way —
          your answer is still recorded, and you can add a number when the network
          opens.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button full disabled={saving} onClick={() => onAnswer(true)}>
          {saving ? "Saving…" : "Yes, text me"}
        </Button>
        <Button
          variant="secondary"
          full
          disabled={saving}
          onClick={() => onAnswer(false)}
        >
          No, thanks
        </Button>
      </div>
      <p className="mt-2.5 text-center text-[12.5px] text-muted sm:text-left">
        Separate from paid Blasts and from being a reference — those are their own
        questions, later.
      </p>
    </div>
  );
}

function Next({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex gap-3.5 rounded-2xl border border-bark/70 bg-card/60 p-4">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-green-wash text-[13px] font-bold text-green-deep">
        {n}
      </span>
      <span>
        <span className="block text-[15.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-snug text-muted">
          {body}
        </span>
      </span>
    </li>
  );
}
