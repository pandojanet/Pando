"use client";

import { useState } from "react";
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
import { isPhoneComplete, toE164 } from "@/lib/phone";
import { loadSession, newSession, saveSession } from "@/lib/storage";

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
 * 12-hour `pando_verify` cookie that already outlives a whole visit. What was
 * missing was a screen that starts with the number instead of ending with it,
 * and `/api/seed/me` to say who the confirmed number belongs to.
 *
 * ## What signing in gives them, and what it deliberately does not
 *
 * It restores **identity**, not answers: their name, whether the profile is in,
 * and their own referral link — which is what her third instruction asks to be
 * on the thank-you screen for a returning parent. It does **not** reconstruct
 * the questionnaire from the server. The answers are on the device that gave
 * them, `raw_answers` is a record rather than a source, and rebuilding a
 * session from it would be a second way to produce one — with all the drift
 * that implies — for a screen a returning parent has already finished.
 *
 * ⚠ So a parent signing in on a new device sees the thank-you screen and their
 * link, not their filled-in profile. That is the honest consequence of the
 * device-local decision the client has taken three times, and it is worth
 * saying out loud rather than discovering.
 */
export function SignIn() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const res = await fetch("/api/seed/me");
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        found?: boolean;
        first_name?: string | null;
        referral_code?: string | null;
        profile_saved?: boolean;
        wants_founding?: boolean;
      } | null;

      if (res.status === 503) {
        setError(
          "Pando can't reach its records right now. Your number is confirmed — try again in a minute.",
        );
        return;
      }
      if (!body?.ok) {
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
       * Enough of a session for the thank-you screen to be itself.
       *
       * Merged over whatever is already on this device rather than replacing
       * it: a parent signing in on the *same* phone must not lose the answers
       * sitting in `localStorage`, and a parent on a new one has nothing to
       * lose. `profile_saved_at` is what makes `/done` and `/profile` treat
       * them as finished (7 Sep) rather than dropping them mid-questionnaire.
       */
      const existing =
        loadSession() ??
        newSession({ invite_code: null, market_id: "pasadena", source: "signin" });
      saveSession({
        ...existing,
        phone: toE164(phone),
        phone_verified: true,
        first_name: existing.first_name ?? body.first_name ?? null,
        /* `name` is what the screens greet by, and it is a separate field from
           `first_name` — setting only the latter left a returning parent on
           "Thank you." where a parent who had just filled the form got "Thank
           you, Alice." */
        name: existing.name ?? body.first_name ?? null,
        wants_founding: body.wants_founding !== false,
        referral_code: body.referral_code ?? existing.referral_code,
        /* Shown already, by definition: this is a returning parent, and the
           popup is for the first verification. The link is on the thank-you
           screen instead. */
        referral_shown_at:
          existing.referral_shown_at ?? new Date().toISOString(),
        profile_saved_at: existing.profile_saved_at ?? new Date().toISOString(),
      });
      track("seed_signin_completed", { has_referral: Boolean(body.referral_code) });
      router.push("/done");
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
            <VerifyPhone
              phone={toE164(phone) ?? ""}
              audience="returning"
              autoStart
              busy={busy}
              onVerified={() => void land()}
            />
            <div className="mt-5">
              <TextAction tone="quiet" onClick={() => setStage("phone")}>
                Use a different number
              </TextAction>
            </div>
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
              * ⚠ Said here rather than discovered on the next screen: signing in
              * restores who they are and their invite link, not the answers they
              * tapped. Those live on the device that gave them (31 Jul), and
              * this screen must not imply otherwise.
              */}
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
              This brings back your place and your invite link. Answers you
              typed on another phone stay on that phone.
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
