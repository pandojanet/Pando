"use client";

import { Note } from "@/components/ui/Note";
import { Panel } from "@/components/ui/Panel";
import type { AccountNotice } from "@/components/seed/useAccountSync";

/**
 * What the phone's copy is, said when it matters (24 Nov, `lib/account-sync.ts`): replaced with what the
 * database holds, or shown from the phone because Pando could not be reached. Nothing when it simply
 * matched — the usual case is silent.
 */
export function AccountNoticeNote({ notice, className = "mt-4" }: { notice: AccountNotice; className?: string }) {
  if (notice === "offline") {
    return (
      <Note className={className}>
        Pando can&apos;t be reached right now. This is what&apos;s saved on this phone — changes go through once
        you&apos;re back online.
      </Note>
    );
  }
  if (notice === "updated") {
    return (
      <Panel tone="positive" size="inset" className={className}>
        <p className="text-help leading-relaxed text-ink-soft">Updated with what&apos;s saved in your profile.</p>
      </Panel>
    );
  }
  return null;
}
