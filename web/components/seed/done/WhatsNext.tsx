"use client";


import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { CopyButton } from "@/components/ui/CopyButton";
import { InlineAction, TextAction } from "@/components/ui/TextAction";
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
            <Panel as="p" tone="warning" size="inset" className="mt-4 leading-relaxed text-gold-ink text-control">
              One thing is still open — the follow-up permission on the{" "}
              <InlineAction href="/done/ask">previous step</InlineAction>
              . Until that&apos;s answered, nothing below has started.
            </Panel>
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

          <Panel size="inset" className="mt-8" title="Thought of something later?">
            <p className="mt-1 leading-relaxed text-muted text-help">
              Open this same link again on this phone and pick up where you left off
              — no password, no account. One more recommendation is genuinely useful.
            </p>
          </Panel>

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
        {/* One of three "secondary link under the dock" copies that predated
            `TextAction`, at three different heights. 48px→44px and 15px→14px is
            the design system's "Help / secondary" step, which is what the other
            two were already close to. */}
        <TextAction href="/profile" full className="mt-2">
          Review my answers
        </TextAction>
        <p className="py-2 text-center text-muted text-dock">
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
    <Panel
      size="inset"
      className="mt-8"
      title="Know another parent whose recommendations people trust?"
    >
      <p className="mt-1 leading-relaxed text-muted text-help">
        When someone you invite completes their profile and has a contribution
        approved, you earn a free Targeted Network Ask.
      </p>
      <Panel
        as="p"
        tone="quiet"
        size="inset"
        className="mt-3 whitespace-pre-line leading-relaxed text-help"
      >
        {message}
      </Panel>
      <CopyButton
        className="mt-3"
        text={message}
        label="Copy the invite"
        copiedLabel="Copied — send it to one parent"
        onCopied={() => track("seed_referral_copied")}
      />
    </Panel>
  );
}
