"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ProfileBanner } from "@/components/seed/ProfileDepth";
import { profileDepth } from "@/lib/questions";
import { loadSession } from "@/lib/storage";
import type { SeedSession } from "@/lib/types";
import type { ShareKind } from "@/lib/seed-chat/types";

/**
 * Shared bits of the completion flow (estimate 1.7), which is three screens
 * rather than one: /done says what happened, /done/ask collects the two things
 * Pando still needs, /done/next says what's ahead.
 *
 * See CLAUDE.md for why it was split — the single screen carried the badge, the
 * shared list, D1, the consent, the OTP gate, five next-steps, the referral and
 * a come-back card, which is more than anyone reads.
 */

export const KIND_LABEL: Record<ShareKind, string> = {
  activity: "Activity",
  caregiver: "Caregiver",
  place: "Place",
  tip: "Tip",
};

/**
 * The session, plus whether we've actually looked yet.
 *
 * `loaded` is the point of this hook. localStorage only exists in the browser, so
 * the session arrives in an effect — and every screen here has a "we don't have a
 * session on this phone" branch. Without the flag that branch renders in the
 * server HTML and then vanishes on hydration, which reads as the app losing the
 * parent's work for one frame on the last screen of the flow.
 */
export function useDoneSession() {
  const [session, setSession] = useState<SeedSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setLoaded(true);
  }, []);

  return { session, setSession, loaded };
}

/**
 * The profile banner on a completion screen (21 Sep).
 *
 * One wrapper rather than the same three-line expression on three screens:
 * they would drift, and the one that drifts is the one nobody reopens.
 *
 * ⚠⚠ **High on the screen, under the heading — measured, not chosen.** It
 * sat at the foot first, on the argument that these three screens are Pando
 * *telling* a parent something and a green box asking for more above *Thank
 * you.* replaces the point of the screen with an errand. That argument is
 * still right about the order and wrong about the outcome: at the foot it
 * landed at **y = 806 · 1579 · 1803** on a 375×812 phone, so on two of the
 * three a parent would never see it — which is the whole of *"постійно у
 * користувача"*. So it goes directly after each screen's own heading block
 * and before the first thing they scroll through, which keeps the screen's
 * point first and the banner on the first paint.
 *
 * On the review and `/share` it is at the top, because there the screen is
 * about the profile and the recommendation rather than about news.
 *
 * Renders nothing with no session on this phone, and nothing once the profile
 * clears the bar.
 */
export function DoneProfileBanner({
  session,
  className,
}: {
  session: SeedSession | null;
  className?: string;
}) {
  if (!session) return null;
  return <ProfileBanner depth={profileDepth(session.answers)} className={className} />;
}

/** They chose the labelled path with no Founding status and no follow-ups. */
export function isAnonymous(session: SeedSession | null): boolean {
  return session?.wants_founding === false;
}

export function NoSession() {
  return (
    <Panel as="p" size="inset" className="mt-7 leading-relaxed text-muted text-help">
      {/* Not a link any more: it used to point at /join, which since 4 Sep
          redirects anybody arriving without a code — so the one instruction on
          this panel led to the public site. The invite link is the thing they
          have to find, and only they have it. */}
      We don&apos;t have a session on this phone — nothing was lost, but to be
      counted as a founding parent, open the invite link you were sent and start
      from there.
    </Panel>
  );
}

/** One step of "what happens next". */
export function Next({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <Panel as="li" size="inset" className="flex gap-3.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-green-wash text-[13px] font-bold text-green-deep">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-[15.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-snug text-muted">
          {body}
        </span>
      </span>
    </Panel>
  );
}
