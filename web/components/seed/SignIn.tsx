"use client";
import { DEFAULT_MARKET_ID } from "@/lib/markets";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { Panel } from "@/components/ui/Panel";
import { PhoneField } from "@/components/ui/PhoneField";
import {
  Container,
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { Wordmark } from "@/components/ui/Logo";
import { TextAction } from "@/components/ui/TextAction";
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import { track } from "@/lib/analytics";
import { fetchMe } from "@/lib/api-client";
import { reconcile, safeNext } from "@/lib/account-sync";
import { isPhoneComplete, toE164 } from "@/lib/phone";
import {
  loadSession,
  newSession,
  saveSession,
} from "@/lib/storage";

/**
 * Coming back — her second instruction: authenticate again with a number and a
 * code.
 *
 * ## Why this screen exists at all
 *
 * The flow is autosaved to the **device** (31 Jul, reaffirmed 27 Aug: no
 * per-parent token, so cross-device resume is impossible by design), and the
 * OTP has only ever appeared at the *end* of the profile as a gate on storing
 * anything. So a parent who filled everything in on their phone and then opened
 * Pando on a laptop had no way back in: not because they were refused, but
 * because nothing asked who they were.
 *
 * The machinery was all there — `/verify/start`, `/verify/check`, and the
 * `pando_verify` cookie (seven days since 24 Nov) that already outlives a whole visit. What was
 * missing was a screen that starts with the number instead of ending with it,
 * and `/api/seed/me` to say who the confirmed number belongs to.
 *
 * ## What signing in gives them, and what it deliberately does not
 *
 * It restores their **profile**: their name, whether it is in, their own
 * referral link, and — since 8 Sep — the answers themselves, read back from
 * `people.raw_answers`.
 *
 * ⚠ **The answers are new here and reverse the 7 Sep note this replaces**,
 * which read *"It restores identity, not answers … rebuilding a session from
 * `raw_answers` would be a second way to produce one."* That held while nothing
 * could prove a browser belonged to a profile; this screen is that proof, and it
 * is the same proof `submitGate` demands before anything may be written. The
 * client's report is what forced it: a returning parent was being shown whatever
 * was on the phone rather than what Pando holds.
 *
 * ⚠ What still does **not** travel, and the screen says so: the session itself.
 * No `screen_index`, no chat draft, no half-finished recommendation — those are
 * autosaved to the device that is making them, and a card is not a fact Pando
 * has agreed to keep until it is saved.
 */
export function SignIn() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* The number this phone already holds, offered (24 Nov): a parent sent here because their week ran
     out should not have to type it again. Read from the phone's own copy — never from the address. */
  useEffect(() => {
    const held = loadSession()?.phone;
    if (held && /^\+1\d{10}$/.test(held)) setPhone(held.slice(2));
  }, []);

  const ready = isPhoneComplete(phone);

  /**
   * The code is confirmed; ask the server who it is.
   *
   * The phone is **not** sent — `/api/seed/me` reads it from the verification
   * the server itself recorded, because an endpoint that took a number in the
   * body would hand out a stranger's name and referral link to anybody who can
   * type ten digits.
   */
  async function land() {
    setBusy(true);
    setError(null);
    try {
      const body = await fetchMe();

      if (body.reason === "unavailable") {
        setError(
          "Pando can't reach its records right now. Your number is confirmed — try again in a minute.",
        );
        return;
      }
      if (!body.ok) {
        setError("That confirmation has expired. Ask for a fresh code.");
        setStage("phone");
        return;
      }
      if (!body.found) {
        /* No profile against this number. Not an error and not a dead end: the
           way forward is the same screen everybody else starts on. */
        track("seed_signin_no_profile");
        router.push("/join");
        return;
      }

      /**
       * Their session, from the database — through the same `reconcile` every screen uses on entry
       * (24 Nov, `lib/account-sync.ts`), so signing in and coming back cannot disagree about what the
       * phone keeps: the answers, the referral code, Founding and the number are the database's; the
       * chat, cards waiting to go and the name in full stay the phone's. A copy on this phone made under
       * **another** number is rebuilt, not merged — until now a second parent signing in on a shared
       * phone kept the first one's chat and consents.
       *
       * `profile_saved_at` is set as before (7 Sep): it is what makes `/done` and `/profile` treat
       * a returning parent as finished rather than dropping them mid-questionnaire.
       */
      const now = new Date().toISOString();
      const confirmed = toE164(phone);
      const local =
        loadSession() ??
        newSession({ invite_code: null, market_id: DEFAULT_MARKET_ID, source: "signin" });
      const check = reconcile(
        { ...local, phone: local.phone ?? confirmed, phone_verified: true },
        { ...body, phone: body.phone ?? confirmed ?? undefined },
      );
      const merged = check.state === "in_step" ? check.session : { ...local, phone: confirmed, phone_verified: true };
      saveSession({
        ...merged,
        /* Shown already, by definition: this is a returning parent, and the popup is for the first
           verification. The link is on the thank-you screen instead. */
        referral_shown_at: merged.referral_shown_at ?? now,
        profile_saved_at: merged.profile_saved_at ?? now,
      });
      track("seed_signin_completed", { has_referral: Boolean(body.referral_code) });
      /* Back to the screen that sent them here to sign in, if it was one of ours. */
      router.push(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "code") {
    return (
      <Screen>
        <ScreenHeader left={<Wordmark />} />
        <ScreenBody className="pt-2">
          <div className="animate-step-in">
            <Eyebrow>Signing in</Eyebrow>
            {/**
              * `sr-only`, on the `/share` precedent (3 Sep): the document needs a
              * name and this screen has no room for a second one — `VerifyPhone`
              * carries the visible heading, and rendering "Confirm it's your
              * number." above a panel headed "Confirm it's your number" is the
              * same sentence twice with nothing distinguishing them.
              */}
            <h1 className="sr-only">Sign in — confirm your number</h1>
            {error && <Note>{error}</Note>}
            {/**
              * 9 Sep — "Use a different number" moved **into** the panel.
              *
              * It used to sit in a `mt-5` div under the whole thing, which is
              * what she reported: the number this screen is about is in the
              * panel's first sentence, and the only control that could correct
              * it was below the code box, the resend and the validity line,
              * detached from everything else on the page. It is `VerifyPhone`'s
              * own `onChangeNumber` now, rendered beside the number.
              */}
            <VerifyPhone
              phone={toE164(phone) ?? ""}
              audience="returning"
              autoStart
              busy={busy}
              onChangeNumber={() => setStage("phone")}
              onVerified={() => void land()}
            />
          </div>
        </ScreenBody>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader left={<Wordmark />} />
      <ScreenBody className="pt-7">
        <div className="animate-step-in">
          <Eyebrow>Welcome back</Eyebrow>
          <h1 className="mt-2.5 font-display text-[1.7rem] font-extrabold leading-[1.08]">
            Sign in with your number.
          </h1>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft">
            Pando texts you a six-digit code. There is no password — the number
            is the account.
          </p>

          <Panel className="mt-6" tone="card" raised>
            {/* `PhoneField` renders its own label — wrapping it in `Field` would
                give the input two, and its accessible name would become both
                concatenated. */}
            <PhoneField label="Mobile number" value={phone} onChange={setPhone} />
            {error && <Note>{error}</Note>}
            {/**
              * ⚠ Said here rather than discovered on the next screen — and it is
              * a **narrower** promise than it was before 8 Sep, not a bigger
              * one. The profile comes back, because Pando has it. A
              * recommendation somebody was part-way through does not: that is
              * autosaved to the phone making it and has never been written
              * anywhere else. New user-facing copy, on the list for the client.
              */}
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
              This brings back your profile, your place and your invite link. A
              recommendation you were part-way through stays on the phone you
              started it on.
            </p>
          </Panel>

          <div className="mt-4">
            <TextAction tone="quiet" href="/join">
              I haven&apos;t joined yet
            </TextAction>
          </div>
        </div>
      </ScreenBody>

      <ScreenDock>
        <Button
          full
          variant="primary"
          disabled={!ready || busy}
          onClick={() => {
            track("seed_signin_started");
            setStage("code");
          }}
        >
          Text me a code <ArrowRight />
        </Button>
      </ScreenDock>
    </Screen>
  );
}
