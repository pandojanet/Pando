"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Note } from "@/components/ui/Note";
import { TextAction } from "@/components/ui/TextAction";
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import { forgetThisDevice, loadSession } from "@/lib/storage";
import { forgetAnalyticsIdentity, track } from "@/lib/analytics";

/**
 * Deleting your own profile (client §1, 9 Sep).
 *
 * Her question is one line — *"Also how do people delete their profile if they
 * want to?"* — and everything below it is about being honest about what the
 * answer actually does.
 *
 * ## The copy states what stays, because a parent cannot guess it
 *
 * `people` cascades to everything describing the person and **nulls** the link
 * on everything they contributed, so the profile goes and their
 * recommendations remain with nothing pointing back. That is the right
 * behaviour — other parents' answers rest on them, and the privacy screen
 * already promises *"Your recommendation is still shared — your name is not."*
 * But it is not what "delete my profile" sounds like, so the panel says it
 * before the tap rather than leaving somebody to discover that a class they
 * recommended is still being recommended.
 *
 * ## Two taps, unlike the caregiver's DELETE
 *
 * 11.3 acts on one message and that is right *there*: the flow promises "text
 * DELETE and the whole profile goes", and a confirmation step would make that
 * sentence false. Here there is no such promise and a button on a screen is
 * easy to hit by accident, so the destructive control is behind a panel that
 * has to be opened first. ⚠ The panel is the confirmation — the route does not
 * ask again, because a second server round of the same question is a second
 * place to get it wrong.
 *
 * ## Afterwards
 *
 * The device is cleared too. Leaving the session behind would put a parent who
 * just deleted everything back into a half-filled questionnaire, which reads
 * as the delete having failed.
 */
export function DeleteProfile({
  /* Where it sits (16 Sep): directly under "Save my profile" in the review
     dock, so the page's own spacing is the caller's. */
  className = "mt-6 border-t border-bark/70 pt-4",
}: { className?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The number to confirm before the server will delete anything (24 Nov). */
  const [confirm, setConfirm] = useState<string | null>(null);

  /* Everything of theirs off the device (24 Nov): the questionnaire, every other `pando.` key, the
     analytics identity — the server clears the number's cookies itself. A full page load, not a client
     route change, so no screen keeps their answers in memory either. */
  function leave() {
    forgetThisDevice();
    forgetAnalyticsIdentity();
    window.location.replace("/");
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/seed/delete", { method: "POST" });
      /**
       * ⚠⚠ **Not confirmed on this device — the case that looked like a delete doing nothing (24 Nov).**
       *
       * This screen reads the profile from the phone, so it opens whether or not this browser still
       * holds a confirmed number (a lapsed confirmation, another browser, a profile held until
       * verified). The delete then answered 401, the panel said "confirm your number first" with no
       * way to, nothing was deleted on the server and nothing left the phone — and the parent was
       * still "in". Now: with a number on the phone, the code is asked right here and the delete runs
       * once it is confirmed; with none, nothing of theirs can be on the server (invariant 11 — nothing
       * is stored before a confirmed number), so clearing the phone is the whole delete.
       */
      if (res.status === 401) {
        const phone = loadSession()?.phone ?? null;
        track("seed_profile_delete_needs_code", { has_phone: phone !== null });
        if (!phone) {
          leave();
          return;
        }
        setConfirm(phone);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        /* Said out loud rather than swallowed: a destructive control that
           appears to do nothing is the worst of both — they cannot tell
           whether it worked, and the honest answer is that it did not. */
        setError("That didn't go through. Nothing was deleted — try again in a moment.");
        setBusy(false);
        return;
      }
      const body = (await res.json().catch(() => null)) as { deleted?: boolean } | null;
      track("seed_profile_deleted", { had_profile: body?.deleted === true });
      leave();
    } catch {
      setError("That didn't go through. Nothing was deleted — try again in a moment.");
      setBusy(false);
    }
  }

  if (confirm) {
    /* The warning panel and the code are siblings, never a panel inside a panel. */
    return (
      <div className="mt-6">
        <Panel tone="warning" size="inset" title="Delete your profile?">
          <p className="mt-1.5 text-help leading-relaxed text-gold-ink/90">
            Your profile is kept under your number, so we check it&apos;s yours first. Once you
            confirm, everything listed goes.
          </p>
          {error && <Note className="mt-3">{error}</Note>}
          <div className="mt-3 flex flex-col items-start gap-1">
            <TextAction tone="quiet" disabled={busy} onClick={leave}>
              Only clear this phone
            </TextAction>
            <TextAction
              tone="quiet"
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                setOpen(false);
              }}
            >
              Keep my profile
            </TextAction>
          </div>
        </Panel>
        <VerifyPhone
          key={confirm}
          phone={confirm}
          audience="returning"
          busy={busy}
          onVerified={() => void remove()}
        />
      </div>
    );
  }

  if (!open) {
    return (
      <div className={className}>
        <TextAction tone="quiet" onClick={() => setOpen(true)}>
          Delete my profile
        </TextAction>
      </div>
    );
  }

  return (
    <Panel tone="warning" size="inset" className="mt-6" title="Delete your profile?">
      <p className="mt-1.5 text-help leading-relaxed text-gold-ink/90">
        Your answers, your children&apos;s ages, your connections and your
        message settings are removed, and Pando stops texting you.
      </p>
      <p className="mt-2 text-help leading-relaxed text-gold-ink/90">
        What you recommended stays, with nothing linking it to you — other
        parents&apos; answers are built on it.
      </p>
      <p className="mt-2 text-help leading-relaxed text-gold-ink/80">
        This cannot be undone.
      </p>

      {error && <Note className="mt-3">{error}</Note>}

      {/**
        * ⚠ **The safe action is the loud one, and that is the design system
        * rather than timidity.** `alert` red means *owed a person today* and
        * never appears in the parent flow at all, so there is no destructive
        * colour to reach for here — and inventing one for this screen would
        * put the only red a parent ever sees on the control most likely to be
        * hit by mistake. The parent opened this panel deliberately, so the
        * quiet button costs them nothing.
        */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button full disabled={busy} onClick={() => setOpen(false)}>
          Keep my profile
        </Button>
        <Button full variant="secondary" disabled={busy} onClick={() => void remove()}>
          {busy ? "Deleting…" : "Delete it"}
        </Button>
      </div>
    </Panel>
  );
}
