"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Wordmark } from "@/components/ui/Logo";
import {
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { track } from "@/lib/analytics";
import { NoSession, Next, useDoneSession } from "./shared";

/**
 * Estimate 1.7, screen 3 of 3 — what happens after they close the tab.
 *
 * Nothing here asks for anything or writes anything, which is why it can sit
 * behind the completion write rather than in front of it.
 */
export function WhatsNext() {
  const { session, loaded } = useDoneSession();

  const count = session?.chat?.submissions.length ?? 0;
  const completed = Boolean(session?.completed_at);

  return (
    <Screen>
      <ScreenHeader left={<Wordmark />} />

      <ScreenBody className="pt-7">
        <div className="animate-rise">
          <Eyebrow>What happens next</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] font-extrabold leading-[1.1]">
            From here, it&apos;s us doing the work.
          </h1>

          {/* Somebody who navigated here without answering the consent would
              otherwise read a list of things that happen to a submission Pando
              never received. */}
          {loaded && session && !completed && (
            <p className="mt-4 rounded-2xl border border-gold-line bg-gold-wash p-4 text-[14.5px] leading-relaxed text-gold-ink">
              One thing is still open — the follow-up permission on the{" "}
              <Link
                href="/done/ask"
                className="font-semibold underline underline-offset-2"
              >
                previous step
              </Link>
              . Until that&apos;s answered, nothing below has started.
            </p>
          )}

          <ol className="mt-5 space-y-2.5">
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
              body="Founding parents get first access, permanent Founding Status, and their first Network Ask on us."
            />
          </ol>

          {session && <ReferralCard firstName={session.first_name ?? session.name} />}

          <div className="mt-8 rounded-2xl border border-bark bg-card p-4">
            <h3 className="text-[15.5px] font-semibold">
              Thought of something later?
            </h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">
              Open this same link again on this phone and pick up where you left off
              — no password, no account. One more recommendation is genuinely useful.
            </p>
          </div>

          {loaded && !session && <NoSession />}
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
    (firstName
      ? `

(If you sign up, mention ${firstName} sent you.)`
      : "");

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
