"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Note } from "@/components/ui/Note";
import { TextAction } from "@/components/ui/TextAction";
import { Wordmark } from "@/components/ui/Logo";
import {
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { track } from "@/lib/analytics";
import {
  completeSeed,
  updateDemand,
  verifyStatus,
  type VerifyStatus,
} from "@/lib/api-client";
import { buildConsentRecord, FOLLOW_UP_CONSENT_TEXT } from "@/lib/consent";
import { DemandQuestion } from "@/components/seed/DemandQuestion";
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import {
  flushSession,
  handleExpiredVerification,
  holdsUntilVerified,
} from "@/lib/submit";
import { cn } from "@/lib/cn";
import { saveSession } from "@/lib/storage";
import type { SeedSession } from "@/lib/types";
import {
  chosenAllowance,
  DoneProfileReminder,
  NoSession,
  useDoneSession,
} from "./shared";

/**
 * Estimate 1.7 — the only completion screen that asks for anything.
 *
 * ⚠⚠ **It comes before the chat now, not after it** (7 Oct, the developer:
 * profile → this → contributions → thanks and next steps). So the order is
 * `/profile` → `/done/ask` → `/share` → `/done` → `/done/next`, Back here goes to
 * the profile, and the dock goes on to `/share`. Three things moved with it:
 *
 *  - **The completion write happens before any card.** It never read the cards —
 *    `writeCompletion` stores the founding standing, the consent and D1 — so only
 *    `shared` changes, and that is a funnel count in a log line, now 0 here.
 *  - **The held-session fallback still has to end the flow.** A confirmation that
 *    runs out *during* the chat leaves its cards on the phone, and this screen is
 *    no longer after them; `/done` asks for the code and sends them
 *    (`SendHeld`), without a second completion write.
 *  - **"You're all set" and "Last step" are gone from here**, because neither is
 *    true any more.
 *
 * Two asks and a gate, in this order for a reason: D1 rides along in the same
 * completion write as the consent (`demand: session.demand`), so it has to be
 * answered *before* the follow-up buttons submit. Moving it after would silently
 * drop every demand signal.
 *
 * **What reaches this screen changed on 12 Aug.** Normally the number was
 * confirmed at the entry screen, the profile is already stored (the cards come
 * after this screen since 7 Oct), and this writes one completion record. The gate below is now the *fallback* path,
 * for the two sessions that still arrive holding everything: a deployment that
 * could not send a code at entry (A2P pending), and a confirmation that ran out
 * mid-flow. Both are answered here exactly as the whole flow used to be — one code,
 * then contributor, cards and completion in one pass.
 */
export function FinishAsks() {
  const { session, setSession, loaded } = useDoneSession();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** The founding path answered the follow-up and now owes us a code. */
  const [needsVerify, setNeedsVerify] = useState(false);
  /**
   * The profile is known to be stored: a write that needs a confirmed number
   * came back 401, so the number *was* confirmed when the profile went up. The
   * flush after the fresh code must not send it again — it appends consent rows.
   */
  const [profileStored, setProfileStored] = useState(false);
  /** What a confirmed code is for: the follow-up answer, or a D1 edit (7 Oct). */
  const afterVerify = useRef<"flush" | "demand">("flush");
  /** A D1 changed after the completion that has not reached the server yet. */
  const demandDirty = useRef(false);
  const verifyRef = useRef<HTMLDivElement | null>(null);
  /**
   * How this deployment is configured. Null until it answers — the follow-up buttons
   * wait for it, because the wrong branch either loses a submission or asks for a code
   * that can never arrive.
   */
  const [gate, setGate] = useState<VerifyStatus | null>(null);

  useEffect(() => {
    void verifyStatus()
      .then(setGate)
      // If we can't ask, assume the gate is on: refusing to submit is recoverable,
      // submitting something that should have waited is not.
      .catch(() =>
        setGate({
          required: true,
          sendable: false,
          provisioned: false,
          dev_codes: false,
        }),
      );
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setAnswer(session?.follow_up_opt_in ?? null);
    setDone(Boolean(session?.completed_at));
  }, [loaded, session]);

  /**
   * ⚠⚠ **Both buttons on this screen looked dead, and this is why** — the P0
   * the client's own analysis logged as *"CTA on permissions / texting page …
   * 'No thanks' behaves incorrectly. Then testing the alternative 'Yes, text
   * me', after which also 'nothing is working'. Not a wording issue — a
   * functional bug."*
   *
   * It was one fault rather than two, which is exactly why it read as both
   * branches being broken: *Yes, text me* and *No, thanks* both call
   * `submit()`, and on the founding path `submit()` neither saves nor advances
   * — it sets `needsVerify` and the OTP panel mounts **below** the D1 question
   * and the consent paragraph. On a phone that is off the bottom of the
   * screen, and the button itself does not change (`saving` is only set on the
   * other branch), so the parent taps, nothing visibly happens, and the
   * conclusion available to them is that the control is broken. With the code
   * then not arriving (their BUG-1), "nothing is working" is the honest reading
   * of what they saw.
   *
   * Same shape as the 3 Sep admin fix and the same three rules: `block:
   * "nearest"` so a panel already in view does not jump, **no `smooth`**
   * because they are trying to finish rather than watch a journey, and
   * `tabIndex={-1}` so focus can land at all — without it the browser scrolls
   * and leaves focus on a button that is now off-screen, so the next Tab goes
   * straight back to where they were.
   */
  useEffect(() => {
    if (!needsVerify) return;
    const el = verifyRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
  }, [needsVerify]);

  const count = session?.chat?.submissions.length ?? 0;
  const hasPhone = Boolean(session?.phone);
  /** See `chosenAllowance` for why this is not `Number(...)`. */
  const allowance = chosenAllowance(session);

  /**
   * Everything held on the phone goes up in one pass, once the code is confirmed.
   * Order matters: contributor, then their cards, then the completion record.
   */
  async function flush(
    optedIn: boolean,
    verified: boolean,
    /**
     * ⚠ The session to send, passed in by `submit` rather than read from this
     * render. `submit` saves the answer and then calls this in the same tick, so
     * the closure's `session` predates it — and the `saveSession` below wrote
     * that older copy back, erasing `follow_up_opt_in` and `consent` from the
     * phone. Harmless while this screen ended the flow; since 7 Oct the chat's
     * Back returns here, finds no answer, and offers the buttons again.
     */
    base: SeedSession | null = session,
  ) {
    if (!base) return;
    setSaving(true);
    setError(null);
    try {
      const result = await flushSession(
        withoutRepeatedDemand(base),
        { follow_up_opt_in: optedIn },
        /* Once completed — or once a 401 proved it went up confirmed — the
           profile is already stored, and saving it again appends consent rows
           and recounts every "Other" answer. */
        { profile: !(base.completed_at || profileStored) },
      );
      const sent = new Set(result.persisted_ids);
      const next = saveSession({
        ...base,
        /* Usually empty — the chat comes after this screen — but a returning
           parent can arrive here holding cards, and `/done` reads this flag to
           decide whether anything is still waiting to be sent. */
        chat: base.chat && {
          ...base.chat,
          submissions: base.chat.submissions.map((s) =>
            sent.has(s.id) ? { ...s, persisted: true, error: false } : s,
          ),
        },
        /* Only true when a code was actually confirmed. With the gate off the number
           is unverified, and saying otherwise here would be a lie the founding
           checklist later reads as fact. */
        phone_verified: verified,
        completed_at: base.completed_at ?? new Date().toISOString(),
      });
      setSession(next);
      setDone(true);
      setNeedsVerify(false);
      track("seed_submit_flushed", {
        verified,
        profile: result.profile,
        cards: result.cards_persisted,
        cards_total: result.cards_total,
        persisted: result.completion?.persisted ?? false,
      });
      track("seed_completion_recorded", {
        opted_in: optedIn,
        persisted: result.completion?.persisted ?? false,
        shared: count,
      });
      /* A completion written just now carried the D1 as it stands, so nothing is
         owed. One written earlier carried none (`withoutRepeatedDemand`), so an
         edit made since still has to go up on its own. */
      if (demandDirty.current && base.completed_at) void syncDemand(next);
      else demandDirty.current = false;
    } catch (err) {
      /* The confirmation ran out between the last screen and this one. Back to
         holding, and the code box below is exactly the thing that fixes it. */
      if (handleExpiredVerification(err)) {
        setSession(saveSession({ ...base, phone_verified: false }));
        afterVerify.current = "flush";
        setNeedsVerify(true);
        setError("Your number needs confirming again — nothing has been lost.");
        return;
      }
      setError(
        "That didn't go through. Everything is still safe on this phone — try again.",
      );
      track("seed_submit_failed");
    } finally {
      setSaving(false);
    }
  }

  async function submit(optedIn: boolean) {
    if (!session) return;
    setAnswer(optedIn);
    setError(null);
    track("seed_follow_up_answered", { opted_in: optedIn, has_phone: hasPhone });

    /* Founding path with the gate on: nothing has been sent yet and nothing will be
       until the code is confirmed. Record the answer on this phone and open the gate.

       With the gate off (SEED_REQUIRE_VERIFICATION=0 — the pilot running before Twilio
       is provisioned) the same held profile and cards flush right here instead. The
       number stays unconfirmed, so `phone_verified_at` is null and these contributors
       cannot reach Founding until they confirm one later. */
    if (holdsUntilVerified(session)) {
      const next = saveSession({
        ...session,
        follow_up_opt_in: optedIn,
        consent: buildConsentRecord("follow_up", optedIn, "seed_completion_screen"),
      });
      setSession(next);

      if (gate && !gate.required) {
        void flush(optedIn, false, next);
        return;
      }

      afterVerify.current = "flush";
      setNeedsVerify(true);
      return;
    }

    setSaving(true);

    const counts = (session.chat?.submissions ?? []).reduce<
      Record<string, number>
    >((acc, s) => {
      acc[s.kind] = (acc[s.kind] ?? 0) + 1;
      return acc;
    }, {});

    try {
      const result = await completeSeed({
        invite_code: session.invite_code,
        source: session.source,
        is_test: session.is_test === true,
        name: session.name,
        phone: session.phone,
        follow_up_opt_in: optedIn,
        /* Not sent: the profile write owns the allowance and the mode it has to
           agree with. See `repo/completion.ts` for what sending it cost. */
        demand: withoutRepeatedDemand(session).demand,
        shared: counts,
        profile_saved_at: session.profile_saved_at,
        started_at: session.started_at,
      });

      const next = saveSession({
        ...session,
        follow_up_opt_in: optedIn,
        consent: buildConsentRecord(
          "follow_up",
          optedIn,
          "seed_completion_screen",
        ),
        completed_at: new Date().toISOString(),
      });
      setSession(next);
      setDone(true);
      track("seed_completion_recorded", {
        opted_in: optedIn,
        persisted: result.persisted,
        shared: count,
      });
    } catch (err) {
      /**
       * ⚠⚠ **The confirmation ran out, and this used to be a wall** (7 Oct). The
       * phone still said "confirmed", the server said 401, and the only thing on
       * screen was "That didn't save… try again" — with no code box, so every
       * retry was the same 401. `flush` always handled it; this branch did not.
       * It became easy to reach on 7 Oct: the chat's Back returns here, often
       * hours after the code, and changing the follow-up answer lands in it.
       *
       * Now it is the flush path's own recovery: hold the answer on the phone,
       * ask for a fresh code, send on confirm. `profileStored` because a 401
       * here proves the profile already went up under a confirmed number.
       */
      if (handleExpiredVerification(err)) {
        setProfileStored(true);
        setSession(
          saveSession({
            ...session,
            phone_verified: false,
            follow_up_opt_in: optedIn,
            consent: buildConsentRecord("follow_up", optedIn, "seed_completion_screen"),
          }),
        );
        afterVerify.current = "flush";
        setNeedsVerify(true);
        setError("Your number needs confirming again — nothing has been lost.");
        return;
      }
      setError("That didn't save. Your answers are safe on this phone — try again.");
      track("seed_completion_failed");
    } finally {
      setSaving(false);
    }
  }

  /**
   * A D1 edited after the completion goes up on its own (7 Oct): the same
   * question, changed on the server (`/api/seed/demand`), or withdrawn when the
   * parent skips it or says not to keep it. A lapsed confirmation asks for a code
   * and sends it after, exactly like the follow-up answer.
   */
  async function syncDemand(base: SeedSession) {
    setError(null);
    try {
      await updateDemand({
        is_test: base.is_test === true,
        demand: base.demand
          ? {
              question_text: base.demand.question_text,
              category: base.demand.category,
              may_save: base.demand.may_save,
            }
          : null,
      });
      demandDirty.current = false;
      track("seed_demand_edited", { kept: base.demand !== null });
    } catch (err) {
      if (handleExpiredVerification(err)) {
        setSession(saveSession({ ...base, phone_verified: false }));
        afterVerify.current = "demand";
        setNeedsVerify(true);
        setError("Your number needs confirming again — your question is safe on this phone.");
        return;
      }
      setError("Your change didn't save. It's safe on this phone — try again.");
      track("seed_demand_edit_failed");
    }
  }

  return (
    <Screen>
      <ScreenHeader
        left={<Wordmark />}
        below={<DoneProfileReminder session={session} />}
      />

      <ScreenBody className="pt-7">
        <div className="animate-rise">
          {/* Was "Last step" and, once answered, "You're all set." — both true
              while this screen ended the flow, and neither since 7 Oct: the
              recommendations come next. The answered state then read "Saved.",
              which the developer rejected the same day: it sat above an open,
              empty D1 box and claimed the whole screen was done. The title names
              the screen in both states; the cards below say what is saved. */}
          <Eyebrow>Before you share</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] font-extrabold leading-[1.1]">
            Two quick things.
          </h1>
          {!done && (
            <p className="mt-2.5 text-[15.5px] leading-relaxed text-ink-soft">
              One is your turn to ask Pando something. The other is the permission
              that decides whether Pando can come back to you.
            </p>
          )}

          {/* Demand capture: the first moment in the whole flow where the parent
              gets to ask for something. Above the consent on purpose — its answer
              travels in the same write. */}
          {session && (
            <DemandQuestion
              saved={session.demand}
              onSave={(value) => {
                const next = saveSession({
                  ...session,
                  demand: value.question_text ? value : null,
                });
                setSession(next);
                /* Before the completion it travels with it. After, it has to go
                   up on its own — the 7 Oct instruction: an edit is saved, the
                   same question changed rather than a second one added. */
                if (!next.completed_at) return;
                demandDirty.current = true;
                if (holdsUntilVerified(next)) {
                  afterVerify.current = "demand";
                  setNeedsVerify(true);
                  return;
                }
                void syncDemand(next);
              }}
            />
          )}

          {/* Follow-up permission — the one Phase 1 answer that decides whether
              this parent can be reached once the network is live. Needs a session
              to attach the consent record to; without one there is nothing to
              consent *for*, so we point back to the start instead of showing a
              button that can't do anything. */}
          {session ? (
            <FollowUpCard
              answer={answer}
              done={done}
              saving={saving}
              hasPhone={hasPhone}
              allowance={allowance}
              onAnswer={(value) => void submit(value)}
            />
          ) : null}

          {/* The fallback gate — only reached by a session that is still holding
              everything: no code was sendable at entry, or the confirmation ran
              out on the way here. */}
          {session?.phone && needsVerify && gate?.sendable === false && (
            <Panel tone="warning" className="mt-7">
              <h2 className="font-display text-[1.15rem] font-semibold text-gold-ink">
                We can&apos;t confirm your number yet.
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-gold-ink/90">
                Pando&apos;s texting isn&apos;t switched on, so there&apos;s no code to
                send you — and we won&apos;t pretend otherwise. Everything you wrote is
                still on this phone: open this same link when we text you that it&apos;s
                live, and it picks up right here.
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-gold-ink/80">
                Nothing has been sent anywhere, and nothing has been lost.
              </p>
            </Panel>
          )}

          {session?.phone && needsVerify && gate?.sendable !== false && (
            <div ref={verifyRef} tabIndex={-1} className="outline-none">
            <VerifyPhone
              phone={session.phone}
              /* `undefined` for the open-ended level, so that panel drops the
                 "at most N a month" clause rather than printing a number this
                 parent did not choose — its copy already handles the absence. */
              allowance={allowance ?? undefined}
              /* Something is already stored when the code is a fresh one, so
                 "nothing you write reaches us" would be false (7 Oct). */
              audience={done || profileStored ? "lapsed" : "parent"}
              submits
              busy={saving}
              onVerified={() => {
                if (afterVerify.current === "demand" && session) {
                  const next = saveSession({ ...session, phone_verified: true });
                  setSession(next);
                  setNeedsVerify(false);
                  void syncDemand(next);
                  return;
                }
                void flush(answer === true, true);
              }}
            />
            </div>
          )}

          {loaded && !session && <NoSession />}

          {/* Was a byte-identical copy of `Note`'s own class string, minus the
              `role="alert"` — so the one thing that made it a `Note` was the one
              thing it had dropped. ⚠ It is announced now. */}
          {error && <Note>{error}</Note>}
        </div>
      </ScreenBody>

      <ScreenDock>
        {/* ⚠ The second branch is the one the 7 Oct move made necessary. With
            no code sendable at all (Twilio unprovisioned, dev codes off) the
            answer is kept on this phone and the warning above says so — and
            while this screen ended the flow, that was the end. In front of the
            chat it would strand the parent before their recommendations, so
            they go on and the cards are held with everything else; the next
            visit, once a code can be sent, comes back through here. */}
        {done || (needsVerify && gate?.sendable === false) ? (
          /* On to the chat — this screen sits between the profile and the
             recommendations since 7 Oct. Its own event rather than the old
             `seed_done_next_opened`, which counted a different step. */
          <Link
            href="/share"
            onClick={() => track("seed_ask_continued", { shared: count })}
            className={buttonClass("primary", true)}
          >
            Continue
          </Link>
        ) : (
          /* No primary here on purpose: the action on this screen is the yes/no
             inside the consent card, and a dock button that only navigated past it
             would be a way to skip the one thing this screen exists for. Back is
             the profile: it is the screen before this one now. */
          <TextAction href="/profile" full>
            Back
          </TextAction>
        )}
      </ScreenDock>
    </Screen>
  );
}

/**
 * A changed follow-up answer is a new consent record, and that is right: the
 * decision moved. The D1 question did not, and a demand signal is appended, not
 * upserted — so once the completion is written, a second write carries none.
 * Reachable since 7 Oct, when the chat's Back started returning here.
 */
function withoutRepeatedDemand(s: SeedSession): SeedSession {
  return s.completed_at ? { ...s, demand: null } : s;
}

function FollowUpCard({
  answer,
  done,
  saving,
  hasPhone,
  allowance,
  onAnswer,
}: {
  answer: boolean | null;
  done: boolean;
  saving: boolean;
  hasPhone: boolean;
  /**
   * The cap the parent set on the profile screen, echoed back to them here —
   * **null** for the open level, which has no monthly number: its ceiling is
   * three a week (`OPEN_WEEKLY_LIMIT`), on top of the 48-hour gap.
   */
  allowance: number | null;
  onAnswer: (value: boolean) => void;
}) {
  if (done && answer !== null) {
    /* The tone carries the answer: green when they said yes to follow-ups,
       neutral when they didn't — neither is a warning, so neither is gold. */
    return (
      <Panel tone={answer ? "positive" : "card"} className="mt-7">
        <p
          className={cn(
            "text-[15.5px] font-semibold",
            answer ? "text-green-deep" : "text-ink",
          )}
        >
          {answer
            ? "You're in for occasional follow-ups."
            : "No follow-ups — noted."}
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
          {answer
            ? /* The open level has no monthly number, so it echoes the ceiling
                 it does have: three a week, and never two within 48 hours. */
              allowance === null
              ? "At most 3 a week, never two within 48 hours — the level you chose — and never a marketing message. Reply STOP any time once we're live."
              : `At most ${allowance} a month — the limit you set — and never a marketing message. Reply STOP any time once we're live.`
            : "You'll still be a founding parent. We just won't text you about what you share."}
        </p>
        <TextAction className="mt-3" onClick={() => onAnswer(!answer)} disabled={saving}>
          {answer ? "Actually, don't text me" : "Actually, follow-ups are fine"}
        </TextAction>
      </Panel>
    );
  }

  return (
    <Panel raised className="mt-7">
      {/* Her wording, §4 of 9 Sep — the one row of that table still unapplied
          when it was audited on 14 Sep. "One permission, then you're done"
          counts the work; hers says what the decision costs, which is the
          thing a parent is actually weighing here: it is reversible. */}
      <h2 className="font-display text-[1.15rem] font-semibold">
        Choose once. You can change it later.
      </h2>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
        When another parent asks about something you share, may Pando text you to
        check it&apos;s still current — or ask a question your experience can answer?
      </p>

      <p className="mt-3 rounded-2xl bg-paper p-3.5 text-[13px] leading-relaxed text-muted">
        {FOLLOW_UP_CONSENT_TEXT}
      </p>

      {!hasPhone && (
        <p className="mt-3 text-[13px] leading-relaxed text-gold-ink">
          You didn&apos;t leave a number, so we can&apos;t text you either way — your
          answer is still recorded, and you can add a number when the network opens.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button full disabled={saving} onClick={() => onAnswer(true)}>
          {saving ? "Saving…" : "Yes, text me"}
        </Button>
        <Button
          variant="secondary"
          full
          disabled={saving}
          onClick={() => onAnswer(false)}
        >
          No, thanks
        </Button>
      </div>
      <p className="mt-2.5 text-center text-[12.5px] text-muted sm:text-left">
        Separate from a paid Network Check and from being a reference — those are
        their own questions, later.
      </p>
    </Panel>
  );
}
