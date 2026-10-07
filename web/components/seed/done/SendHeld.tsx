"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Note } from "@/components/ui/Note";
import { Panel } from "@/components/ui/Panel";
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import { track } from "@/lib/analytics";
import { verifyStatus, type VerifyStatus } from "@/lib/api-client";
import { saveSession } from "@/lib/storage";
import {
  flushSession,
  handleExpiredVerification,
  holdsUntilVerified,
} from "@/lib/submit";
import type { SeedSession } from "@/lib/types";
import { chosenAllowance } from "./shared";

/**
 * Recommendations still on this phone, sent from `/done` (7 Oct).
 *
 * ## Why this exists
 *
 * Until 7 Oct `/done/ask` was the last screen of the flow, and it was also where a
 * session that had gone back to holding — the confirmation ran out mid-flow, or the
 * container restarted and took the in-memory record with it — asked for a fresh
 * code and sent everything. The developer moved that screen in front of the chat,
 * so a confirmation that runs out **during** the chat left its cards on the phone
 * with nothing after them to send them: the chat's own footer promises they go up
 * "at the end", and the end had stopped doing it.
 *
 * So the end does it again, here, and only for that case:
 *
 *  - **completed** — the follow-up answer and D1 are already written. A session
 *    that never answered them is sent to `/done/ask` by the dock instead, and that
 *    screen flushes everything, cards included.
 *  - **holding** — `holdsUntilVerified`, the one predicate the whole flow asks.
 *  - **at least one card not sent** — `persisted` on the card, which `ChatSeeding`
 *    sets when a save lands.
 *
 * ⚠ **Cards only: `flushSession(session, null, { profile: false })`.** The cards
 * upsert by client id. Neither of the other two writes does — the completion
 * appends a follow-up consent and a demand signal, the profile appends three
 * consent rows and recounts every "Other" answer — and both were written before
 * `completed_at` could be set.
 *
 * The gate's three states are `FinishAsks`'s, for the same reasons: on but unable
 * to send says so rather than offering a code that cannot arrive; on and sendable
 * asks for one; **off** (a pilot deployment without Twilio) sends on arrival,
 * with the number left unconfirmed — `/done/ask` used to do exactly that at the end
 * of the flow, and a button here would be one more thing a parent could walk past.
 */
/**
 * The cards `SendHeld` would offer to send, or none. One expression, read by the
 * panel and by `/done`'s dock note, so the note cannot say "nothing else is
 * needed" above a panel saying two recommendations are still waiting.
 */
export function heldCards(session: SeedSession | null) {
  if (!session?.completed_at || !holdsUntilVerified(session)) return [];
  return (session.chat?.submissions ?? []).filter((s) => !s.persisted);
}

export function SendHeld({
  session,
  setSession,
}: {
  session: SeedSession | null;
  setSession: (next: SeedSession) => void;
}) {
  const [gate, setGate] = useState<VerifyStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  const held = heldCards(session);
  const owed = held.length > 0;

  useEffect(() => {
    if (!owed || gate) return;
    void verifyStatus()
      .then(setGate)
      /* Same fallback as `FinishAsks`: refusing to send is recoverable, sending
         something that should have waited is not. */
      .catch(() =>
        setGate({
          required: true,
          sendable: false,
          provisioned: false,
          dev_codes: false,
        }),
      );
  }, [owed, gate]);

  async function flush(verified: boolean) {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      /* Cards only. The profile went before `completed_at` could be set, and
         sending it again appends consent rows and recounts "Other" answers. */
      const result = await flushSession(session, null, { profile: false });
      const landed = new Set(result.persisted_ids);
      const next = saveSession({
        ...session,
        /* Only true when a code was actually confirmed — with the gate off the
           number is still unconfirmed, and the founding checklist reads this. */
        phone_verified: verified,
        chat: session.chat && {
          ...session.chat,
          submissions: session.chat.submissions.map((s) =>
            landed.has(s.id) ? { ...s, persisted: true, error: false } : s,
          ),
        },
      });
      setSession(next);
      setSent(result.persisted_ids.length);
      track("seed_held_cards_sent", {
        verified,
        cards: result.cards_persisted,
        cards_total: result.cards_total,
      });
    } catch (err) {
      if (handleExpiredVerification(err)) {
        setError("Your number needs confirming again — nothing has been lost.");
        return;
      }
      setError(
        "That didn't go through. Everything is still safe on this phone — try again.",
      );
      track("seed_held_cards_failed");
    } finally {
      setSaving(false);
    }
  }

  /* Gate off: send on arrival, once. The ref, not `saving`, is the guard — state
     set in this effect is not visible until the next render, and a re-render in
     between would send twice. */
  const autoSent = useRef(false);
  useEffect(() => {
    if (!owed || gate?.required !== false || autoSent.current) return;
    autoSent.current = true;
    void flush(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `flush` reads the session it is given; the ref stops a second send
  }, [owed, gate]);

  if (sent !== null && sent > 0) {
    return (
      <Panel tone="positive" size="inset" className="mt-6" title="Sent.">
        <p className="mt-1 leading-relaxed text-muted text-help">
          {sent === 1
            ? "Your recommendation is with Pando now."
            : `Your ${sent} recommendations are with Pando now.`}
        </p>
      </Panel>
    );
  }

  if (!session?.phone || !owed) return null;

  const n = held.length;
  const allowance = chosenAllowance(session);

  return (
    <div className="mt-6">
      <Panel
        tone="warning"
        size="inset"
        title={
          n === 1
            ? "One recommendation is still on this phone."
            : `${n} recommendations are still on this phone.`
        }
      >
        <p className="mt-1 leading-relaxed text-gold-ink/90 text-help">
          {gate?.required === false
            ? "Send them now and they go to Pando — nothing has been lost."
            : gate?.sendable === false
              ? "Pando's texting isn't switched on, so there's no code to send yet. They stay on this phone — open this same link when we text you that it's live."
              : "Your number needs confirming again before they reach Pando — nothing has been lost."}
        </p>
        {gate?.required === false && (
          <Button
            className="mt-3"
            full
            disabled={saving}
            onClick={() => void flush(false)}
          >
            {saving ? "Sending…" : "Send them"}
          </Button>
        )}
      </Panel>

      {gate?.required !== false && gate?.sendable !== false && gate !== null && (
        <VerifyPhone
          phone={session.phone}
          allowance={allowance ?? undefined}
          /* The profile and the follow-up answer are already stored, so the
             default "nothing you write reaches us" would be false here. */
          audience="lapsed"
          submits
          busy={saving}
          onVerified={() => void flush(true)}
        />
      )}

      {error && <Note>{error}</Note>}
    </div>
  );
}
