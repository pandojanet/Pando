"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Wordmark } from "@/components/ui/Logo";
import {
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { submissionTitle } from "@/lib/seed-chat/engine";
import type { Submission } from "@/lib/seed-chat/types";
import { isAnonymous, KIND_LABEL, NoSession, useDoneSession } from "./shared";

/**
 * Estimate 1.7, screen 1 of 3 — what just happened.
 *
 * This screen only tells. Everything Pando still needs is on /done/ask, and
 * everything that happens later is on /done/next, so the parent reads one thing
 * at a time.
 */
export function Thanks() {
  const { session, loaded } = useDoneSession();
  const viewed = useRef(false);

  const shared: Submission[] = session?.chat?.submissions ?? [];
  const count = shared.length;
  const anonymous = isAnonymous(session);
  const completed = Boolean(session?.completed_at);

  useEffect(() => {
    if (!loaded || viewed.current) return;
    viewed.current = true;
    track("seed_completion_viewed", {
      shared: session?.chat?.submissions.length ?? 0,
      already_completed: Boolean(session?.completed_at),
    });
  }, [loaded, session]);

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
              "inline-flex animate-pop items-center rounded-full border px-4 py-2 text-[13px] font-semibold",
              anonymous
                ? "border-bark bg-card text-ink-soft"
                : "border-gold-line bg-gold-wash text-gold-ink",
            )}
          >
            {anonymous
              ? "Anonymous contributor"
              : "Founding contributor · in review"}
          </span>

          <h1 className="mt-5 font-display text-[2rem] font-extrabold leading-[1.08] sm:text-[2.1rem]">
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
                You shared anonymously, so there&apos;s nothing more for you to do
                and nothing for us to send — what you gave still counts.
              </>
            ) : (
              <>
                {" "}
                Founding status activates when your second contribution is approved
                — we&apos;ll text you the moment it does, with a link to reserve
                your place.
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
                    /* Label above value under ~26rem: the two-column row put a
                       6-word title in a 9rem gutter on a 320px phone. */
                    className="flex flex-col gap-1 px-4 py-3 xs:flex-row xs:items-baseline xs:gap-3"
                  >
                    <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted xs:w-[5.5rem]">
                      {KIND_LABEL[submission.kind]}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] leading-snug">
                      {submissionTitle(submission)}
                      {submission.kind === "caregiver" && (
                        <span className="ml-2 whitespace-nowrap rounded-full border border-gold-line bg-gold-wash px-2 py-0.5 text-[11.5px] font-semibold text-gold-ink">
                          consent pending
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loaded && !session && <NoSession />}
        </div>
      </ScreenBody>

      <ScreenDock>
        {completed ? (
          <Link href="/done/next" className={buttonClass("primary", true)}>
            What happens next
          </Link>
        ) : (
          <Link
            href="/done/ask"
            onClick={() => track("seed_done_continue", { shared: count })}
            className={buttonClass("primary", true)}
          >
            Continue
          </Link>
        )}
        {/* Named on the button's own screen rather than left as a surprise: this is
            the last required step, and the split added a place to abandon before
            it. */}
        <p className="mt-2 text-center text-[13px] text-muted">
          {completed
            ? "You're all set — nothing else is needed."
            : "One question and one permission left — about 30 seconds."}
        </p>
      </ScreenDock>
    </Screen>
  );
}
