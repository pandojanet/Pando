"use client";

import { useEffect, useState } from "react";
import { InlineAction } from "@/components/ui/TextAction";
import { Panel } from "@/components/ui/Panel";
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

/** They chose the labelled path with no Founding status and no follow-ups. */
export function isAnonymous(session: SeedSession | null): boolean {
  return session?.wants_founding === false;
}

export function NoSession() {
  return (
    <Panel as="p" size="inset" className="mt-7 leading-relaxed text-muted text-help">
      We don&apos;t have a session on this phone — nothing was lost, but to be
      counted as a founding parent,{" "}
      <InlineAction href="/join">start from your invite link</InlineAction>
      .
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
