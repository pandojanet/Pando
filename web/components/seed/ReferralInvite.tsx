"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Eyebrow } from "@/components/ui/Screen";

/**
 * A parent's own referral link — as the panel it lives in, and as the dialog
 * shown once when they first verify.
 *
 * Her third instruction: after the first verification a popup carries the link
 * for inviting others, and on a later sign-in the same link is on the thank-you
 * screen with a way to copy it. Those are one piece of content in two frames, so
 * they are one component with two wrappers rather than two copies that drift.
 *
 * ## The popup opens *on* a page, not instead of one
 *
 * The first version returned a dialog over an **empty** screen, and the
 * client's report was exactly right: a modal with nothing behind it does not
 * read as a popup, it reads as a broken page. So the flow saves, goes to
 * `/share` — the screen the parent is meant to land on next — and the popup
 * opens over it. Closing it leaves them exactly where they were going.
 *
 * That also makes "once" honest without a second mechanism: the trigger is a
 * code in the session that has not been shown yet, so it cannot reappear on a
 * re-save, and a parent who reloads mid-popup still gets it.
 *
 * ## The copy control is an icon button, and it says when it failed
 *
 * `navigator.clipboard` is refused outright in some webviews and in a browser
 * with site data blocked, and the earlier version of this pattern in the chat
 * swallowed that — the parent tapped, the button said "copied", and nothing was
 * on the clipboard. Then they paste the previous clipboard into a group chat.
 * That is the `CopyButton` lesson (3 Sep) and the `/admin/invites` one (7 Sep),
 * and the answer both times is the same: say so, and leave the link selectable
 * so a person can copy it by hand.
 *
 * ⚠ The wording here is new user-facing copy, so it is on the list for the
 * client — including the one thing this panel must not overclaim: inviting
 * somebody is not a promise of anything, because a credit is denominated in
 * Network Asks and those do not exist yet (the 10 Aug rule).
 */

export function referralLink(code: string): string {
  /* `window.location.origin` on purpose rather than a hard-coded domain: a
     parent testing on a staging host must get a link that works where they
     are, and production is the only place the origin is pando.is. */
  const origin =
    typeof window === "undefined" ? "https://pando.is" : window.location.origin;
  return `${origin}/join?i=${code}`;
}

/**
 * The link, and one 44px icon button beside it.
 *
 * The icon carries the meaning and the accessible name carries the words — a
 * bare icon with no name is the "unnamed control" fault this codebase audits
 * for, and an icon *plus* a visible label would make the row wider than the
 * link it is copying on a 375px screen.
 */
function CopyLink({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const link = referralLink(code);

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2600);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-start gap-2">
        {/* Selectable, and it wraps: this is the fallback when the clipboard is
            refused, so it has to be readable rather than truncated. */}
        <p className="min-w-0 flex-1 break-all rounded-2xl border border-bark bg-paper px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-ink-soft">
          {link}
        </p>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={state === "copied" ? "Link copied" : "Copy the link"}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-bark bg-card text-green-deep transition-colors hover:border-green/60 hover:text-ink"
        >
          {state === "copied" ? (
            <Check className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <Copy className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
      {/* Permanently mounted, so the change is announced rather than the button
          being re-read under a new name. */}
      <p
        role="status"
        className={
          state === "failed"
            ? "mt-2 text-[13.5px] leading-snug text-alert"
            : "mt-2 text-[13.5px] leading-snug text-green-deep"
        }
      >
        {state === "copied"
          ? "Copied."
          : state === "failed"
            ? "Couldn't copy — select the link and copy it by hand."
            : ""}
      </p>
    </div>
  );
}


/**
 * Why a parent would bother — her item 15, and the constraint on it is sharper
 * than "write something motivating".
 *
 * All three places a parent meets their link said only the **mechanic**:
 * *"anyone who joins through it is recorded as having come from you."* True,
 * and it answers a question nobody asked.
 *
 * ⚠⚠ **It must not promise a reward, and the obvious motivating sentence
 * would.** A referral credit is denominated in Network Asks, which do not exist
 * yet (10 Aug), so "invite three parents and get a free Ask" is a balance
 * nothing can spend. What is left is the honest motivation, and it happens to be
 * the true one: this product answers with what local parents know, so who is in
 * it *is* the quality of the answers.
 *
 * One constant, used in all three, so the day Janet supplies her wording it is
 * one string rather than three that have drifted.
 *
 * ⚠ Provisional copy. Her note on this item is *"погоджено; final wording
 * немає"* — the text is agreed in principle and not in words, so this is on the
 * list for her like everything else in this file.
 */
const WHY_INVITE =
  "Pando answers with what local parents know, so it is only as good as who is in it. Every parent you bring makes the answers you get better.";

/**
 * The same link as a small box in a screen header — her instruction of 8 Sep:
 * on the sharing screen, beside the Pando wordmark, a little highlighted
 * window with a way to copy.
 *
 * ## Why a box behind a pill, rather than a copy button on its own
 *
 * A header at 375px has about 200px to the right of the wordmark, which is a
 * pill and not a link — and a pill that copies straight away has nowhere to put
 * the one sentence that matters when the clipboard is **refused**. That refusal
 * is real (some webviews, and any browser with site data blocked), and every
 * previous version of this pattern in the app swallowed it: the parent taps,
 * something says "copied", nothing is on the clipboard, and they paste the
 * previous clipboard into a group chat. So the pill opens the box, the box
 * carries the link itself, and `CopyLink` — the same one the popup and the
 * thank-you panel use — owns the copying and the honest failure line.
 *
 * That also makes the link **readable** rather than merely copyable, which is
 * the only fallback there is when the clipboard cannot be reached.
 *
 * ## Three mechanics worth not undoing
 *
 * It is `absolute` inside a `relative` wrapper rather than `fixed`: the header
 * is sticky and paints above the transcript, and a `fixed` overlay here would
 * be clipped by any animated ancestor — the 5 Aug bug, which is why the popup
 * two functions down is a real `<dialog>` and this deliberately is not. It is
 * not a modal: nothing behind it needs to be inert, and trapping focus for a
 * link somebody may want to read beside the conversation would be hostile.
 *
 * Escape and a pointer outside both close it, because a panel with no way out
 * but the control that opened it is the "dead button" complaint one step along.
 *
 * ⚠ The pill's wording is new user-facing copy and is on the list for the
 * client, along with everything else in this file.
 */
export function ReferralHeaderInvite({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        /* `select-none` for the same reason `Chip` has it: a tap-and-hold on a
           phone otherwise selects the label instead of pressing the control. */
        className="inline-flex min-h-11 select-none items-center gap-1.5 rounded-full border border-green/30 bg-green-wash px-3 text-dock font-semibold text-green-deep transition-colors hover:border-green/60 active:scale-[0.97]"
      >
        <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Invite link
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[min(21rem,calc(100vw-2.5rem))] rounded-2xl border border-green/25 bg-card p-3.5 text-left shadow-card"
        >
          <p className="text-[13.5px] leading-relaxed text-ink-soft">{WHY_INVITE}</p>
          <CopyLink code={code} />
        </div>
      )}
    </div>
  );
}

/** The panel form, for the thank-you screen. */
export function ReferralPanel({ code }: { code: string }) {
  return (
    <Panel className="mt-6" tone="positive">
      <Eyebrow tone="deep">Your invite link</Eyebrow>
      <h2 className="mt-2 font-display text-[1.1rem] font-semibold text-green-deep">
        Know a parent everyone asks for recommendations?
      </h2>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{WHY_INVITE}</p>
      <CopyLink code={code} />
    </Panel>
  );
}

/**
 * The dialog form, shown once after the first verification.
 *
 * Small on purpose — 28rem and three short lines — because it sits over the
 * page the parent has just landed on.
 *
 * A real `<dialog showModal>` for the reasons `components/admin/kit.tsx`
 * documents at length: the platform gives the focus trap, Escape, the inert
 * background and focus restoration, and — the part that cannot be hand-rolled
 * here — the **top layer**. A `position: fixed` overlay inside this flow would
 * be clipped to its own animated ancestor, which is the 5 Aug bug this app has
 * already paid for once.
 */
export function ReferralDialog({
  code,
  onClose,
}: {
  code: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    /* `close` does not fire in every browser this is walked in (kit.tsx records
       that), so React owns the closing and this is belt and braces. */
    const handler = () => closeRef.current();
    el.addEventListener("close", handler);
    return () => el.removeEventListener("close", handler);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="referral-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        /* The backdrop is the dialog element itself; anything inside is a
           child, so this fires only for a click outside the panel. */
        if (e.target === ref.current) onClose();
      }}
      /* `m-auto` is load-bearing: a modal `<dialog>` centres itself through
         the UA's `margin: auto`, and Tailwind's preflight zeroes every margin —
         so without it the popup sits in the top-left corner. */
      className="m-auto w-[min(28rem,calc(100vw-1.5rem))] rounded-3xl border border-green/25 bg-card p-0 text-ink shadow-card backdrop:bg-moss/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="px-5 pb-4 pt-5">
        <Eyebrow tone="deep">You&apos;re in</Eyebrow>
        <h2
          id="referral-dialog-title"
          className="mt-2 font-display text-[1.15rem] font-bold leading-snug"
        >
          Your invite link is ready.
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{WHY_INVITE}</p>
        <CopyLink code={code} />
      </div>
      <div className="flex justify-end border-t border-bark/70 px-5 py-3">
        <Button variant="primary" onClick={onClose}>
          Start sharing
        </Button>
      </div>
    </dialog>
  );
}
