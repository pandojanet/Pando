"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/Button";
import { Wordmark } from "@/components/ui/Logo";
import {
  Eyebrow,
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
import {
  flushSession,
  handleExpiredVerification,
  holdsUntilVerified,
} from "@/lib/submit";
import { cn } from "@/lib/cn";
import { saveSession } from "@/lib/storage";
import { NoSession, useDoneSession } from "./shared";

/**
 * Estimate 1.7, screen 2 of 3 — the only screen here that asks for anything.
 *
 * Two asks and a gate, in this order for a reason: D1 rides along in the same
 * completion write as the consent (`demand: session.demand`), so it has to be
 * answered *before* the follow-up buttons submit. Moving it after would silently
 * drop every demand signal.
 *
 * **What reaches this screen changed on 12 Aug.** Normally the number was
 * confirmed at the entry screen, the profile and the cards are already stored, and
 * this writes one completion record. The gate below is now the *fallback* path,
 * for the two sessions that still arrive holding everything: a deployment that
 * could not send a code at entry (A2P pending), and a confirmation that ran out
 * mid-flow. Both are answered here exactly as the whole flow used to be — one code,
 * then contributor, cards and completion in one pass.
 */
export function FinishAsks() {
  const { session, setSession, loaded } = useDoneSession();
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

  useEffect(() => {
    void verifyStatus()
      .then(setGate)
      // If we can't ask, assume the gate is on: refusing to submit is recoverable,
      // submitting something that should have waited is not.
      .catch(() =>
        setGate({
          required: true,
          sendable: false,
          provisioned: false,
          dev_codes: false,
        }),
      );
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setAnswer(session?.follow_up_opt_in ?? null);
    setDone(Boolean(session?.completed_at));
  }, [loaded, session]);

  const count = session?.chat?.submissions.length ?? 0;
  const hasPhone = Boolean(session?.phone);
  const allowance = session?.answers.allowance
    ? Number(session.answers.allowance)
    : 3;

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
    } catch (err) {
      /* The confirmation ran out between the last screen and this one. Back to
         holding, and the code box below is exactly the thing that fixes it. */
      if (handleExpiredVerification(err)) {
        setSession(saveSession({ ...session, phone_verified: false }));
        setNeedsVerify(true);
        setError("Your number needs confirming again — nothing has been lost.");
        return;
      }
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

    const counts = (session.chat?.submissions ?? []).reduce<
      Record<string, number>
    >((acc, s) => {
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
        monthly_contact_allowance: allowance,
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

      <ScreenBody className="pt-7">
        <div className="animate-rise">
          <Eyebrow>Last step</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] font-extrabold leading-[1.1]">
            {done ? "You're all set." : "Two quick things."}
          </h1>
          {!done && (
            <p className="mt-2.5 text-[15.5px] leading-relaxed text-ink-soft">
              One is your turn to ask Pando something. The other is the permission
              that decides whether Pando can come back to you.
            </p>
          )}

          {/* Demand capture: the first moment in the whole flow where the parent
              gets to ask for something. Above the consent on purpose — its answer
              travels in the same write. */}
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
              allowance={allowance}
              onAnswer={(value) => void submit(value)}
            />
          ) : null}

          {/* The fallback gate — only reached by a session that is still holding
              everything: no code was sendable at entry, or the confirmation ran
              out on the way here. */}
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
              allowance={allowance}
              submits
              busy={saving}
              onVerified={() => void flush(answer === true, true)}
            />
          )}

          {loaded && !session && <NoSession />}

          {error && (
            <p className="mt-3 animate-rise rounded-2xl border border-gold-line bg-gold-wash p-3 text-[14px] font-medium text-gold-ink">
              {error}
            </p>
          )}
        </div>
      </ScreenBody>

      <ScreenDock>
        {done ? (
          <Link
            href="/done/next"
            onClick={() => track("seed_done_next_opened", { shared: count })}
            className={buttonClass("primary", true)}
          >
            What happens next
          </Link>
        ) : (
          /* No primary here on purpose: the action on this screen is the yes/no
             inside the consent card, and a dock button that only navigated past it
             would be a way to skip the one thing this screen exists for. */
          <Link
            href="/done"
            className="flex min-h-[48px] items-center justify-center text-[15px] font-semibold text-green-deep"
          >
            Back
          </Link>
        )}
      </ScreenDock>
    </Screen>
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
          answer ? "border-green/25 bg-green-wash" : "border-bark bg-card",
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
        check it&apos;s still current — or ask a question your experience can answer?
      </p>

      <p className="mt-3 rounded-2xl bg-paper p-3.5 text-[13px] leading-relaxed text-muted">
        {FOLLOW_UP_CONSENT_TEXT}
      </p>

      {!hasPhone && (
        <p className="mt-3 text-[13px] leading-relaxed text-gold-ink">
          You didn&apos;t leave a number, so we can&apos;t text you either way — your
          answer is still recorded, and you can add a number when the network opens.
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
