"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Note } from "@/components/ui/Note";
import { track } from "@/lib/analytics";
import {
  checkVerification,
  startVerification,
  type VerifyStartResult,
} from "@/lib/api-client";
import { SMS_CONSENT_REASSURANCE } from "@/lib/consent";
import { maskPhoneRecognisable } from "@/lib/phone";
import { VERIFICATION_TTL_MINUTES } from "@/lib/sms-templates";

/**
 * Phone verification — the gate everything a named parent does sits behind.
 *
 * It stands in two places and the wording is deliberately neutral about which:
 * at the **entry screen**, where it is what lets the rest of the visit save as it
 * happens (the normal path since 12 Aug), and on the **completion screen**, where
 * it flushes a session that had to be held — a deployment that could not send a
 * code, or a confirmation that ran out mid-flow.
 *
 * Either way the promise is the same and is worth not dressing up as a formality:
 * a correct code is what makes this parent storable, and it is also the moment
 * they become reachable.
 *
 * The honest part: the A2P 10DLC campaign isn't approved yet, so the send layer
 * can answer "not provisioned". When it does we say so, in plain words, instead of
 * showing a code box that can never be satisfied.
 */

/**
 * +16265550143 → (626) •••‑0143 — enough to recognise, not enough to publish.
 *
 * Shared with `lib/phone.ts` rather than kept local, because the local copy took
 * the last ten digits and wrapped them in US parentheses: a Ukrainian number came
 * out as `(067) •••‑4567`, which is a trunk zero and an operator code dressed as
 * an area code.
 */
const maskPhone = maskPhoneRecognisable;

interface Props {
  phone: string;
  /**
   * A parent's monthly cap, echoed so confirming isn't an open-ended yes.
   * Meaningless for a caregiver — they are not on the question rota — so it is
   * optional and the copy below drops that sentence rather than inventing a number.
   */
  allowance?: number;
  /**
   * Which flow this is standing in. Only the wording differs: the send limits, the
   * attempt ceiling and the "not provisioned yet" honesty are the same mechanism,
   * and forking the component to reword three lines would have duplicated all of it.
   */
  audience?: "parent" | "caregiver";
  /**
   * True where confirming also *sends* something — the completion screen, which
   * flushes a held session, and the caregiver flow, which writes the claim. At the
   * entry screen it does not: there is nothing to submit yet, and a button saying
   * so would be describing a different screen.
   */
  submits?: boolean;
  onVerified: () => void;
  /** Disabled while the flush that follows is in flight. */
  busy?: boolean;
}

export function VerifyPhone({
  phone,
  allowance,
  audience = "parent",
  submits = false,
  onVerified,
  busy,
}: Props) {
  const [stage, setStage] = useState<"idle" | "sent" | "blocked">("idle");
  const [start, setStart] = useState<VerifyStartResult | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setSending(true);
    setError(null);
    track("seed_verify_requested", { resend: stage === "sent" });
    try {
      const result = await startVerification({ phone, sms_consent: true });
      setStart(result);
      if (result.sent || result.dev_code) {
        setStage("sent");
      } else {
        setStage("blocked");
        track("seed_verify_send_blocked", { reason: result.reason ?? "unknown" });
      }
      // A refused send is still an answer worth showing precisely — see Blocked below.
    } catch {
      setError("We couldn't reach Pando just now. Your answers are safe on this phone.");
    } finally {
      setSending(false);
    }
  }

  async function confirm() {
    setChecking(true);
    setError(null);
    try {
      const result = await checkVerification(code);
      if (result.ok) {
        track("seed_verify_confirmed");
        onVerified();
        return;
      }
      track("seed_verify_failed", { reason: result.reason ?? "unknown" });

      /**
       * Three wrong guesses locks the number for fifteen minutes (spec §19), so
       * "send a fresh one" would be advice that cannot work. The screen switches to
       * the blocked state instead, which is the one that says how long and that
       * nothing is lost.
       */
      if (result.reason === "too_many_attempts" || result.reason === "locked") {
        setCode("");
        setStart((s) => ({
          ...(s ?? { sent: false, sends: 0, max_sends: 0, expires_at: "" }),
          sent: false,
          reason: "locked",
          retry_in_seconds: result.retry_in_seconds,
        }));
        setStage("blocked");
        return;
      }

      setError(
        result.reason === "expired"
          ? "That code expired. Send a fresh one and we'll try again."
          : result.reason === "unknown"
            ? "We don't have a code waiting for this phone. Send one now."
            : `That code doesn't match.${
                result.attempts_left ? ` ${result.attempts_left} tries left.` : ""
              }`,
      );
      if (result.reason === "expired") setCode("");
    } catch {
      setError("We couldn't reach Pando just now. Nothing was lost.");
    } finally {
      setChecking(false);
    }
  }

  const resendsLeft = start ? Math.max(0, start.max_sends - start.sends) : null;

  return (
    <Panel tone="positive" className="mt-7">
      <h2 className="font-display text-[1.15rem] font-semibold text-green-deep">
        Confirm it&apos;s your number
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        {audience === "caregiver" ? (
          <>
            {"Only you should be able to set up your profile, so we text "}
            <span className="whitespace-nowrap font-semibold">{maskPhone(phone)}</span>
            {" a six-digit code. Until you confirm it, nothing you've written is saved."}
          </>
        ) : (
          <>
            {"Founding Status is tied to a real, reachable parent — so we text "}
            <span className="whitespace-nowrap font-semibold">{maskPhone(phone)}</span>
            {" a six-digit code. Until you confirm it, nothing you write reaches us at all."}
          </>
        )}
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        {SMS_CONSENT_REASSURANCE}{" "}
        {audience === "caregiver"
          ? "Your number is never shown to a family, and STOP ends it any time."
          : allowance !== undefined
            ? `At most ${allowance} ${allowance === 1 ? "question" : "questions"} a month, and STOP ends it any time.`
            : "STOP ends it any time."}
      </p>

      {stage === "idle" && (
        <Button
          className="mt-4"
          onClick={() => void requestCode()}
          disabled={sending || busy}
          full
        >
          {sending ? "Sending…" : "Text me a code"}
        </Button>
      )}

      {stage === "blocked" && (
        <Blocked
          reason={start?.reason}
          phone={phone}
          retryInSeconds={start?.retry_in_seconds}
        />
      )}

      {stage === "sent" && (
        <div className="mt-4">
          {start?.dev_code && (
            <p className="mb-3 rounded-xl border border-gold-line bg-gold-wash px-3 py-2 text-[13px] font-semibold text-gold-ink">
              QA mode: the code is {start.dev_code}. Real parents never see this.
            </p>
          )}
          {!start?.sent && !start?.dev_code && (
            <p className="mb-3 text-[13.5px] text-muted">
              If it doesn&apos;t arrive, send another in a moment.
            </p>
          )}

          <label
            htmlFor="verify-code"
            className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted"
          >
            Six-digit code
          </label>
          <input
            id="verify-code"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            aria-describedby="verify-help"
            className="mt-1.5 w-full rounded-2xl border border-bark bg-card px-4 py-3 text-center text-[22px] font-semibold tracking-[0.35em] tabular-nums outline-none focus-visible:border-green focus-visible:ring-4 focus-visible:ring-green/15"
          />
          <p id="verify-help" className="mt-2 text-[13px] text-muted">
            Valid for {VERIFICATION_TTL_MINUTES} minutes.
            {resendsLeft !== null &&
              (resendsLeft > 0
                ? ` ${resendsLeft} resend${resendsLeft === 1 ? "" : "s"} left.`
                : " No resends left — email hello@pando.is and we'll sort it.")}
          </p>

          <Button
            className="mt-3"
            onClick={() => void confirm()}
            disabled={code.length !== 6 || checking || busy}
            full
          >
            {checking || busy
              ? "Confirming…"
              : submits
                ? "Confirm and submit"
                : "Confirm"}
          </Button>

          {resendsLeft !== null && resendsLeft > 0 && (
            <button
              type="button"
              onClick={() => void requestCode()}
              disabled={sending || busy}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center text-[14.5px] font-semibold text-green-deep disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send a new code"}
            </button>
          )}
        </div>
      )}

      {error && (
        <Note>{error}</Note>
      )}
    </Panel>
  );
}

/**
 * Why a code didn't go out, in the parent's terms.
 *
 * Each of these is a different situation and a different next step, so none of them
 * gets the generic "something went wrong" — the honesty rule that applies to
 * `persisted: false` applies here too.
 */
function Blocked({
  reason,
  phone,
  retryInSeconds,
}: {
  reason?: string;
  phone: string;
  retryInSeconds?: number;
}) {
  const retryMinutes =
    retryInSeconds && retryInSeconds > 60
      ? `${Math.ceil(retryInSeconds / 60)} minutes`
      : "a few minutes";

  if (reason === "opted_out") {
    return (
      <div className="mt-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
        <p className="text-[14.5px] font-semibold text-gold-ink">
          This number has texted STOP to Pando.
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-gold-ink/90">
          We can&apos;t text it again until you turn it back on — that&apos;s the rule,
          and we&apos;re not going to work around it. Text <strong>START</strong> to the
          Pando number from{" "}
          <span className="whitespace-nowrap font-semibold">{maskPhone(phone)}</span>,
          then come back and tap send again. Everything you&apos;ve written is still on
          this phone.
        </p>
      </div>
    );
  }

  /**
   * §19's lock. Says how long, because "try again later" from a screen that just
   * refused you reads as a dead end — and everything they wrote is still here.
   */
  if (reason === "locked") {
    return (
      <div className="mt-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
        <p className="text-[14.5px] font-semibold text-gold-ink">
          Too many wrong codes for this number.
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-gold-ink/90">
          It&apos;s locked for {retryMinutes} to keep the number safe. Come back to
          this link after that and tap send again — your profile and everything you
          shared are still on this phone.
        </p>
      </div>
    );
  }

  if (reason === "phone_send_limit") {
    return (
      <div className="mt-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
        <p className="text-[14.5px] font-semibold text-gold-ink">
          That&apos;s a lot of codes to one number.
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-gold-ink/90">
          We cap how many we&apos;ll send in an hour, to keep the number safe. Give it
          an hour and try again, or email hello@pando.is and we&apos;ll finish it by
          hand. Nothing you shared is lost.
        </p>
      </div>
    );
  }

  if (reason === "not_provisioned") {
    return (
      <div className="mt-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
        <p className="text-[14.5px] font-semibold text-gold-ink">
          Text verification isn&apos;t switched on yet.
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-gold-ink/90">
          Nothing is lost: your profile and everything you shared stay on this phone,
          and this link picks up right here once it&apos;s live — we&apos;ll text you
          the moment it is.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-gold-line bg-gold-wash p-4">
      <p className="text-[14.5px] font-semibold text-gold-ink">
        That text didn&apos;t go out.
      </p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-gold-ink/90">
        Not your fault, and nothing is lost — everything you&apos;ve written is still on
        this phone. Try again in a moment, or email hello@pando.is and we&apos;ll finish
        it by hand.
      </p>
    </div>
  );
}
