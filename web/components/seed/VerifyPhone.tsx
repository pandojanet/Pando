"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { track } from "@/lib/analytics";
import {
  checkVerification,
  startVerification,
  type VerifyStartResult,
} from "@/lib/api-client";
import { SMS_CONSENT_REASSURANCE } from "@/lib/consent";
import { VERIFICATION_TTL_MINUTES } from "@/lib/sms-templates";

/**
 * Phone verification, the last step of the founding path.
 *
 * Everything the parent has done so far is on their phone and nowhere else. This
 * is the gate: a correct code is what makes them storable, and it's also the
 * moment they become reachable, so it is deliberately not dressed up as a
 * formality — it says what confirming does.
 *
 * The honest part: the A2P 10DLC campaign isn't approved yet, so the send layer
 * can answer "not provisioned". When it does we say so, in plain words, instead of
 * showing a code box that can never be satisfied.
 */

/** +16265550143 → (626) •••‑0143 — enough to recognise, not enough to publish. */
function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return e164;
  return `(${digits.slice(0, 3)}) •••‑${digits.slice(6)}`;
}

interface Props {
  phone: string;
  /** Their monthly cap, echoed so confirming isn't an open-ended yes. */
  allowance: number;
  onVerified: () => void;
  /** Disabled while the flush that follows is in flight. */
  busy?: boolean;
}

export function VerifyPhone({ phone, allowance, onVerified, busy }: Props) {
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
      setError(
        result.reason === "expired"
          ? "That code expired. Send a fresh one and we'll try again."
          : result.reason === "too_many_attempts"
            ? "Too many tries on that code. Send a fresh one."
            : result.reason === "unknown"
              ? "We don't have a code waiting for this phone. Send one now."
              : `That code doesn't match.${
                  result.attempts_left ? ` ${result.attempts_left} tries left.` : ""
                }`,
      );
      if (result.reason === "expired" || result.reason === "too_many_attempts") {
        setCode("");
      }
    } catch {
      setError("We couldn't reach Pando just now. Nothing was lost.");
    } finally {
      setChecking(false);
    }
  }

  const resendsLeft = start ? Math.max(0, start.max_sends - start.sends) : null;

  return (
    <div className="mt-7 rounded-3xl border border-green/25 bg-green-wash p-5">
      <h2 className="font-display text-[1.15rem] font-semibold text-green-deep">
        One last step: confirm your number
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        Founding status is tied to a real, reachable parent — so we text{" "}
        <span className="whitespace-nowrap font-semibold">{maskPhone(phone)}</span>
        {" a six-digit code. Until you confirm it, everything you’ve written stays on this phone and reaches no one."}
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        {SMS_CONSENT_REASSURANCE} At most {allowance}{" "}
        {allowance === 1 ? "question" : "questions"} a month, and STOP ends it any
        time.
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

      {stage === "blocked" && <Blocked reason={start?.reason} phone={phone} />}

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
            {checking || busy ? "Confirming…" : "Confirm and submit"}
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
        <p className="mt-3 animate-rise rounded-2xl border border-gold-line bg-gold-wash p-3 text-[14px] font-medium text-gold-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Why a code didn't go out, in the parent's terms.
 *
 * Each of these is a different situation and a different next step, so none of them
 * gets the generic "something went wrong" — the honesty rule that applies to
 * `persisted: false` applies here too.
 */
function Blocked({ reason, phone }: { reason?: string; phone: string }) {
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
