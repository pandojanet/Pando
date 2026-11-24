"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics";
import { checkAccount, joinAgainHref, signInHref } from "@/lib/account-sync";
import { clearSession, saveSession } from "@/lib/storage";
import type { SeedSession } from "@/lib/types";

/** What a screen says about the phone's copy, when there is something to say. */
export type AccountNotice = "updated" | "offline" | null;

/** A check again on coming back to the tab, at most this often. */
const RECHECK_MS = 60_000;

/**
 * One way every screen that shows a saved profile keeps the phone's copy in step with the database
 * (24 Nov, `lib/account-sync.ts`). Call it with the screen's own session state:
 *
 * - on the first copy the screen has, and again when the tab comes back into view (`live`), it asks
 *   the server;
 * - `in_step` writes what the server owns into the screen's **latest** state and to the phone;
 * - `signed_out` goes to sign in with a code and back to `returnTo`; `erased` empties the phone and
 *   goes to the invite link;
 * - `offline` keeps the phone's copy and says so.
 *
 * `checked` is false while the first answer is awaited for an account, so a screen can hold its
 * content back rather than show a profile that is about to be locked.
 */
export function useAccountSync({
  session,
  setSession,
  returnTo,
  live = true,
}: {
  session: SeedSession | null;
  setSession: Dispatch<SetStateAction<SeedSession | null>>;
  returnTo: string;
  /** Check again when the tab comes back — off while a parent is mid-edit on a question. */
  live?: boolean;
}): { checked: boolean; notice: AccountNotice } {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [notice, setNotice] = useState<AccountNotice>(null);
  const started = useRef(false);
  const lastAt = useRef(0);
  const latest = useRef<SeedSession | null>(session);
  latest.current = session;

  const run = useCallback(async () => {
    const local = latest.current;
    lastAt.current = Date.now();
    const { check } = await checkAccount(local);
    switch (check.state) {
      case "draft":
        break;
      case "in_step":
        /* Applied to the screen's latest state: what the server owns comes from the check; anything
           the parent touched meanwhile on the phone-only fields stays theirs. */
        setSession((prev) => {
          if (!prev) return prev;
          /* Another number's copy is not merged into: nobody's chat, cards or consents under someone else. */
          if (check.replaced) return saveSession(check.session);
          return saveSession({ ...prev, ...pick(check.session) });
        });
        if (check.changed) {
          setNotice("updated");
          track("seed_account_synced", { changed: true });
        } else {
          setNotice((n) => (n === "offline" ? null : n));
        }
        break;
      case "signed_out":
        track("seed_account_signed_out", {});
        router.replace(signInHref(returnTo));
        return;
      case "erased":
        track("seed_account_erased", {});
        clearSession();
        router.replace(joinAgainHref(local));
        return;
      case "offline":
        setNotice("offline");
        break;
    }
    setChecked(true);
  }, [returnTo, router, setSession]);

  useEffect(() => {
    if (started.current || session === null) return;
    started.current = true;
    void run();
  }, [session, run]);

  useEffect(() => {
    if (!live) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !started.current) return;
      if (Date.now() - lastAt.current < RECHECK_MS) return;
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [live, run]);

  return { checked, notice };
}

/** The fields the server owns — what an `in_step` check writes over the screen's state. */
function pick(s: SeedSession): Partial<SeedSession> {
  return {
    phone: s.phone,
    phone_verified: s.phone_verified,
    first_name: s.first_name,
    name: s.name,
    wants_founding: s.wants_founding,
    referral_code: s.referral_code,
    profile_saved_at: s.profile_saved_at,
    server_saved_at: s.server_saved_at,
    answers: s.answers,
  };
}
