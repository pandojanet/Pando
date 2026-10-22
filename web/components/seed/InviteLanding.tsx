"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Button } from "@/components/ui/Button";
import { PhoneField } from "@/components/ui/PhoneField";
import {
  Container,
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
  SkipLink,
} from "@/components/ui/Screen";
import { Wordmark } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { Note } from "@/components/ui/Note";
import { Consent } from "@/components/ui/Consent";
import { InlineAction, TextAction } from "@/components/ui/TextAction";
import { identifyArrival, track } from "@/lib/analytics";
import {
  fetchMe,
  isNumberRegistered,
  verifyStatus,
  type VerifyStatus,
} from "@/lib/api-client";
import { VerifyPhone } from "@/components/seed/VerifyPhone";
import { JOIN_WRAP, JoinFacts, JoinFooter, RecentLine } from "@/components/seed/join/JoinParts";
import { ChipGroup } from "@/components/ui/ChipGroup";
import {
  isRelationship,
  OTHER_RELATIONSHIP,
  RELATIONSHIP_CHIPS,
  relationshipNote,
  relationshipQuestion,
  type Relationship,
} from "@/lib/inviter-relationship";
import {
  buildConsentRecord,
  PILOT_LAUNCH_CONSENT_TEXT,
  SMS_CONSENT_AGREEMENT,
  SMS_CONSENT_TERMS,
} from "@/lib/consent";
import { formatPhone, isPhoneComplete, toE164 } from "@/lib/phone";
import {
  hasResumableProgress,
  loadSession,
  newSession,
  saveSession,
  clearSession,
} from "@/lib/storage";
import type { InviteResult, SeedSession } from "@/lib/types";

interface Props {
  invite: InviteResult;
  inviteCode: string | null;
  source: string;
}

export function InviteLanding({ invite, inviteCode, source }: Props) {
  const router = useRouter();
  /* Not state any more, and that is the whole of what the removal cost here:
     nothing in the browser re-resolves an invite now that the code screen is
     gone, so there is nothing left to set. The server has already decided. */
  const resolved = invite;

  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  /* The optional second tick (14 Oct, the mockup): one text when the pilot opens. */
  const [pilotLaunch, setPilotLaunch] = useState(false);
  const [canResume, setCanResume] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);
  /**
   * ## The code is asked for **here** again — 15 Sep
   *
   * *"Спробуй поправити, щоб верифікація номера йшла перед заповненням
   * профіля, а не після"*.
   *
   * ⚠⚠ **This reverses two decisions, and the second one is the client's own
   * answer to a direct question.** 13 Aug moved the code off this screen (*"it
   * spent a day on the entry screen and was wrong there"*), and on 10 Sep she
   * was asked whether the join button should read *"Text me a code."* — which
   * it can only say if it sends one — and answered **"Ні, код надсилаємо в
   * кінці"**. So this is hers to confirm before it reaches a parent, and the
   * cost 13 Aug named still stands: a parent who has not seen a single
   * question is asked to prove a phone number.
   *
   * ⚠ What it buys, and why it was asked for: nothing a parent answers can be
   * lost to an expired or refused verification, because the window opens
   * before the questions rather than closing over them — and the *"you already
   * have a profile"* case is caught before eighteen screens rather than after.
   *
   * ⚠⚠ **The old position is not deleted, it is the fallback**, and that is
   * what keeps this safe: `holdsUntilVerified` still gates the write, so a
   * deployment that cannot send a code (no Twilio, no dev codes — production
   * today), a status that could not be fetched, and a window that runs out
   * mid-flow all land in `ProfileFlow`'s verify stage exactly as before.
   * Deleting that would make the front door a dead end the day a send fails.
   *
   * `"form"` until the details are in; `"verify"` while the code is being
   * confirmed. `session` carries what was saved, so the code screen addresses
   * the number that was actually stored rather than the field's text.
   */
  const [step, setStep] = useState<"form" | "verify" | "relationship">("form");
  /** The tap on the relationship question, before Continue saves it. */
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  /** Their words for "Something else" (23 Sep); set only beside `other`. */
  const [relationshipOther, setRelationshipOther] = useState<string | null>(null);
  const [session, setSession] = useState<SeedSession | null>(null);
  /**
   * A profile already exists on this number, found **after** the code rather
   * than before it.
   *
   * `isNumberRegistered` runs at the door and fails open by design (an
   * unreachable database must not turn a warning into a wall), so this is the
   * check that cannot be walked around — and here it costs nothing, because
   * the parent has just proved the number is theirs and has answered nothing
   * yet. `/signin` is the way on: it restores the answers too (8 Sep), which
   * is what "edit my profile" actually means.
   */
  const [returning, setReturning] = useState<string | null>(null);
  /**
   * How this deployment is configured. Asked on mount rather than at the tap, so
   * the button never pauses — and null means "not answered yet", which reads as
   * "cannot verify" below: sending a parent onward is recoverable, showing a code
   * box that can never be satisfied is not.
   */
  const [gate, setGate] = useState<VerifyStatus | null>(null);
  /**
   * The number check on the way through, and its answer.
   *
   * `registered` is the refusal, and it is cleared the moment the number is
   * edited — a parent who mistyped a digit into somebody else's number must not
   * be left staring at a wall that no longer applies to what is in the field.
   */
  const [checking, setChecking] = useState(false);
  /** The code could not be asked for because the status never came back (8 Oct). */
  const [startError, setStartError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  /**
   * First name and mobile, and nothing else — the client, 10 Sep: *"Let's
   * collect first name and mobile only."*
   *
   * ⚠ **This reverses the 3 Aug instruction that split the name in two**, and
   * the cost is worth stating rather than discovering: a surname is what an
   * admin used to tell two Sarahs in one parent group apart on `/admin/founding`,
   * which is the queue that decides whether somebody really is who they say.
   * That judgement is now made on a first name, a masked number and the link
   * they arrived on. `people.last_name` stays in the schema and is simply never
   * filled from this screen, so nothing already stored is lost.
   */
  const canBegin =
    firstName.trim().length > 0 && isPhoneComplete(phone) && smsConsent;

  useEffect(() => {
    /**
     * Before the first capture, so `seed_link_opened` carries it too.
     *
     * This is what makes estimate 3.1's "segmented by which shared link the
     * parent arrived from" possible at all: a PostHog funnel can only break down
     * by a property present on its steps, and until now no event carried the
     * code — `source` says `qr` or `link`, never *which group*.
     */
    identifyArrival({
      invite_code: inviteCode,
      invite_group: invite.group_option_value ?? null,
      source,
      personal: invite.has_inviter === true,
    });
    track("seed_link_opened", { source });
    /* Reaching this component means one of two things: a valid code, or the
       marker from an earlier valid arrival — a Back tap from the first profile
       question, a resumed session, a link whose code has since been retired. So
       the distinction is still real and still worth recording; what changed is
       **who is left in the invalid bucket**. It is no longer strangers, because
       an arrival with neither is redirected before any client code runs, so
       ⚠ uninvited arrivals are invisible in PostHog and `invites.opens` is the
       only remaining signal for them — and that counter no longer moves for a
       *retired* code either, since the proxy turns those away before the page
       renders. `seed_invite_invalid` now means "somebody already invited arrived
       without a usable code", which is a much smaller and more useful set. */
    track(invite.valid ? "seed_invite_valid" : "seed_invite_invalid", {
      reason: invite.reason ?? null,
    });
  }, [invite.valid, invite.reason, invite.group_option_value, inviteCode, source]);

  /* Whether a code can reach this parent at all. Left null on failure, which the
     branch in `begin` treats as "no" — the flow still works, held on the phone. */
  useEffect(() => {
    void verifyStatus()
      .then(setGate)
      .catch(() => setGate(null));
  }, []);

  // Read storage after mount only — the server render can't know about it.
  useEffect(() => {
    const existing = loadSession();
    setCanResume(hasResumableProgress(existing));
    setAlreadySaved(Boolean(existing?.profile_saved_at));
    if (existing?.first_name) setFirstName(existing.first_name);
    /**
     * The number too, or "Continue where you left off" is disabled and a parent who
     * comes back mid-flow is stuck: the dock button needs all four identity fields,
     * and this was the only one not being restored. Their own number, on their own
     * device, formatted the way they typed it.
     */
    if (existing?.phone) setPhone(formatPhone(existing.phone));
    if (existing?.sms_consent?.status === "opted_in") setSmsConsent(true);
    if (existing?.pilot_launch_consent?.status === "opted_in") setPilotLaunch(true);
  }, []);

  /**
   * Captures the identity, then decides whether the code comes now or later.
   *
   * The code moved here (12 Aug) so that "saved" means saved: once the number is
   * confirmed, the profile and every card post as they are finished instead of
   * living on the phone until the last screen. It also fails kindly — a parent who
   * cannot receive a code finds out in the first ten seconds rather than after
   * fifteen screens of work.
   */
  async function begin(mode: "new" | "resume") {
    const e164 = toE164(phone);
    setStartError(null);

    /**
     * ⚠⚠ **The code is asked here and nowhere else on the way in** (8 Oct, the
     * developer: *"прибери модель підтвердження sms з кінця, нехай буде лише на
     * початку"*). Until then a status that had not come back yet (null) sent the
     * parent onward and the end of the profile asked instead; that end step is
     * gone, so a null status is no longer a shrug — it is awaited, and a status
     * that cannot be fetched stops here with a line that says so, rather than
     * letting the parent answer every question with nothing able to confirm them.
     */
    let status = gate;
    if (!status) {
      setChecking(true);
      status = await verifyStatus().catch(() => null);
      setChecking(false);
      if (!status) {
        setStartError("We couldn't reach Pando to send your code. Check your connection and try again.");
        track("seed_verify_status_failed", { at: "entry" });
        return;
      }
      setGate(status);
    }

    /**
     * Is this number already in Pando? Asked **here**, on the client's
     * instruction of 8 Sep, and it is the one place in this app that answers a
     * question about somebody who has proved nothing.
     *
     * Her report: entering a registered number threw the parent into the
     * questionnaire and *"інформація затирається"*. Both halves are true. The
     * write is an upsert on the number (invariant 10) and every derived set is
     * **replaced rather than merged**, so filling the form again from a second
     * device overwrote the richer profile — and the only warning came after the
     * code, i.e. after eighteen screens.
     *
     * ⚠ **This is a reversal of the 8 Sep decision that put the check behind
     * the code, and the reason that decision existed has not gone away** — it is
     * an enumeration oracle, and who is in the network is what this product does
     * not publish. The cost was put to her in those words and she chose the
     * overwrite as the bigger harm. `app/api/seed/registered/route.ts` carries
     * the four rules that narrow it; read those before touching this.
     *
     * **It refuses rather than warns**, which is her wording — *"не пропускає"*.
     * The way forward is `/signin`, which since 8 Sep restores the profile
     * *including the answers*, so updating a profile is still possible and is
     * now the honest route to it: prove the number, then edit what is there,
     * rather than retyping it and hoping the upsert keeps the rest.
     *
     * And a failure is not a wall: `isNumberRegistered` answers `false` on any
     * error, so an unreachable database lets the parent through to the flow that
     * has always caught this at the end.
     */
    if (e164) {
      setChecking(true);
      const taken = await isNumberRegistered(e164);
      setChecking(false);
      if (taken) {
        setRegistered(true);
        /* Counts and a boolean, never the number (invariant 7). */
        track("seed_number_already_registered", { source });
        return;
      }
    }

    const existing = loadSession();

    const base =
      mode === "resume" && existing
        ? existing
        : newSession({
            /* The code travels with the session; the *group* behind it does not.
               The server re-resolves it from this code on every write, so a
               client copy would only be a second version of the same fact — and
               the one the browser could edit. */
            invite_code: resolved.valid ? inviteCode : null,
            market_id: resolved.market_id,
            source,
          });

    const first = firstName.trim() || null;

    const saved = saveSession({
      ...base,
      first_name: first ?? base.first_name,
      /* Kept in step for anything still reading `name`. A surname is no longer
         collected here, so this is the first name alone — and `last_name` is
         left exactly as a resumed session had it rather than being cleared,
         because somebody who gave one under an older build still gave it. */
      name: first ?? base.name,
      phone: e164 ?? base.phone,
      wants_founding: true,
      /* The checkbox is what authorises the first verification text, so the record
         is written the moment it's ticked — with the exact wording version shown. */
      sms_consent: smsConsent
        ? buildConsentRecord("sms", true, "seed_entry_phone_field")
        : null,
      /* Only when ticked: an optional box left alone is no record, never a
         "declined" one (`PILOT_LAUNCH_CONSENT_TEXT`). */
      pilot_launch_consent: pilotLaunch
        ? buildConsentRecord("pilot_launch", true, "seed_entry_phone_field")
        : null,
      /* Whatever a resumed session claims, this is re-established by the step
         below — the server is the only thing that can say a number is confirmed. */
      phone_verified: mode === "resume" ? base.phone_verified : false,
    });

    track("seed_phone_captured", { founding_path: true });
    track(mode === "resume" ? "seed_profile_resumed" : "seed_profile_started", {
      market_id: resolved.market_id,
      source,
    });

    /**
     * The code, when this deployment can actually send one (15 Sep — see the
     * note on `step`).
     *
     * ⚠ **The condition is the whole safety of the change.** `gate` is null
     * until the status comes back and null reads as *cannot verify*, so a slow
     * or failed `/verify/status` sends the parent onward to the flow that has
     * always asked at the end — never to a code box that cannot be satisfied.
     * That is the same rule this screen already applied to its own copy, and
     * it is why the old position stays built.
     *
     * The rule that matters is unchanged either way: nothing about a named
     * parent is stored until the number is confirmed (invariant 11), and the
     * answers live on this phone until then. What moves is only *when* Pando
     * asks — before the questions rather than after them.
     */
    if (status.required && status.sendable) {
      setSession(saved);
      setStep("verify");
      track("seed_verify_reached", { at: "entry" });
      return;
    }

    proceed(saved);
  }

  /**
   * On to the questions — unless this parent arrived on somebody's **personal**
   * link and has not yet said how they know them (16 Sep). That question sits
   * here, after the name and number (and the code, where one is sent) and
   * before the first profile question.
   *
   * ⚠ Only for the invite this session actually carries: a resumed session that
   * came in on a different link is not asked about this one's owner.
   */
  function proceed(current: SeedSession) {
    const ask =
      resolved.valid &&
      resolved.has_inviter === true &&
      current.invite_code === inviteCode &&
      !current.inviter_relationship_asked &&
      !current.profile_saved_at;
    if (ask) {
      setSession(current);
      /* A resumed session's stored value is untrusted like any other (4 Aug):
         anything the question no longer offers is dropped rather than carried
         into the control as a selection nothing can show. */
      const stored = current.inviter_relationship;
      setRelationship(isRelationship(stored) ? stored : null);
      setRelationshipOther(relationshipNote(stored, current.inviter_relationship_other));
      setStep("relationship");
      track("seed_inviter_relationship_shown", { named: Boolean(resolved.inviter_first_name) });
      return;
    }
    router.push("/profile");
  }

  /**
   * ⚠ There is no longer a null case (21 Sep): **Prefer not to say** is an
   * option rather than a control under the dock, so every way past this screen
   * is an answer. The refusal is stored on the device like any other and
   * dropped at the write — see `storedRelationship`.
   */
  function answerRelationship(value: Relationship) {
    if (!session) return;
    const next = saveSession({
      ...session,
      inviter_relationship: value,
      inviter_relationship_other: value === OTHER_RELATIONSHIP ? relationshipOther : null,
      inviter_relationship_asked: true,
    });
    track("seed_inviter_relationship_answered", { relationship: value });
    setSession(next);
    router.push("/profile");
  }

  /**
   * Between the confirmed code and the first question: does this number
   * already have a profile?
   *
   * `isNumberRegistered` asked the same thing at the door and **fails open**
   * on any error, so this is the one that cannot be walked around — and it is
   * free here, because the parent has just proved the number is theirs, which
   * is exactly what made the same question at the phone field an enumeration
   * oracle (8 Sep).
   *
   * ⚠ Every other outcome goes on to the questions, including a failure: a
   * warning that could not be fetched must not become a wall, and the write at
   * the end is still an upsert the parent will be asked about on the fallback
   * path.
   */
  async function afterEntryVerified(verified: SeedSession) {
    const me = await fetchMe();
    if (me.ok && me.found && me.profile_saved) {
      setReturning(me.first_name ?? "");
      track("seed_profile_exists_shown");
      return;
    }
    proceed(verified);
  }

  function startOver() {
    clearSession();
    setCanResume(false);
    setAlreadySaved(false);
  }

  /**
   * ⚠ **The invite-code screen is gone** — the client's call, 4 Sep — and it is a
   * change to who can reach this tool, not to how a screen looks.
   *
   * `/join` used to branch here on `!resolved.valid` and *ask* for a code: its
   * own screen, with a field, a "Checking…" button and a manual-entry analytics
   * path. **The gate itself did not go with it.** It moved one layer up and got
   * stricter: `app/(seed)/join/page.tsx` now redirects an arrival with no code,
   * a retired one or an unknown one to the public site, so an uninvited visitor
   * never reaches this component at all. Access is by link.
   *
   * Why the screen was the wrong answer rather than merely an extra step: it was
   * the one place this address was useful to somebody who had *not* been invited
   * — it confirmed they had found the right door and only lacked the key — while
   * 1.1's rule is that the founding tool is "shared privately inside parent
   * groups, not published".
   *
   * **What is unchanged.** The gate is still *soft* everywhere below this point:
   * nothing authenticates anybody, `invite_code` may still be null on a session,
   * and the write routes still accept one — a link forwarded last week must not
   * become a dead end mid-flow (12 Aug). Attribution is unchanged too: a valid
   * `?i=` still lands on `people.invite_id`, still segments PostHog, still counts
   * an open.
   */


  /**
   * The code screen, standing in front of the questions rather than behind
   * them (15 Sep).
   *
   * Its own return rather than a branch inside the card, because nothing else
   * on this screen belongs on it: not the reward line, not the consent box
   * (already agreed to — that tick is what authorised this text), not the
   * resume panel. What a parent needs here is the number, the box, and the way
   * back if the number is wrong.
   */
  /**
   * "How do you know the person who invited you?" (16 Sep). One single-select
   * question on its own screen, worded by the inviter's own privacy:
   * `inviter_first_name` only reaches this page when they let their first name
   * show, so a private inviter is asked about generically.
   *
   * ⚠ **Every way past it is an answer** (21 Sep). There is no Skip; the last
   * option is *Prefer not to say*, which is stored on the device and dropped
   * at the write, so nothing about how these two know each other is recorded.
   */
  if (step === "relationship" && session) {
    const question = relationshipQuestion(resolved.inviter_first_name);
    return (
      <Screen>
        <ScreenHeader left={<Wordmark />} />
        <ScreenBody className="pt-7">
          <Container>
            <Eyebrow>Before the questions</Eyebrow>
            <h1 className="mt-2.5 font-display text-[1.7rem] font-bold leading-tight">
              {question}
            </h1>
            <p className="mt-2.5 leading-relaxed text-ink-soft text-control">
              This stays inside Pando — it is never shown to anyone.
            </p>
            <div className="mt-6">
              <ChipGroup
                groupLabel={question}
                options={RELATIONSHIP_CHIPS.map((o) => ({ id: o.id, label: o.label }))}
                mode="single"
                selected={
                  relationship && relationship !== OTHER_RELATIONSHIP ? [relationship] : []
                }
                onChange={(next) => {
                  const picked = next[0];
                  setRelationship(isRelationship(picked) ? picked : null);
                  /* One answer, whichever control it came from (the 15 Sep
                     single-select rule): a chip replaces their own words. */
                  setRelationshipOther(null);
                }}
                /* 23 Sep: "Something else" is the profile's own control — the
                   same "+ Something else" chip and sheet, taking their words. */
                otherLabel="+ Something else"
                /* Their words describe how two people know each other and join
                   no directory, so the sheet must not promise they will. */
                otherAddsToList={false}
                custom={relationship === OTHER_RELATIONSHIP && relationshipOther ? [relationshipOther] : []}
                onAddCustom={(value) => {
                  const note = relationshipNote(OTHER_RELATIONSHIP, value);
                  if (!note) return;
                  setRelationship(OTHER_RELATIONSHIP);
                  setRelationshipOther(note);
                }}
                onRemoveCustom={() => {
                  setRelationship(null);
                  setRelationshipOther(null);
                }}
              />
            </div>
          </Container>
        </ScreenBody>
        {/**
         * ⚠ **No Skip** (21 Sep). The way past is *Prefer not to say*, in the
         * list, where it says what it means — where Skip only said that this
         * screen was over. It also puts the refusal one tap from the answers
         * rather than in a different control at the other end of the screen,
         * and it is the shape the questionnaire already uses on eight
         * screens.
         */}
        <ScreenDock>
          <Button
            full
            disabled={!relationship}
            onClick={() => relationship && answerRelationship(relationship)}
          >
            Continue
            <ArrowRight />
          </Button>
        </ScreenDock>
      </Screen>
    );
  }

  if (step === "verify" && session?.phone) {
    return (
      <Screen>
        <ScreenHeader left={<Wordmark />} />
        <ScreenBody className="pt-7">
          <Container>
            <Eyebrow>One quick check</Eyebrow>
            <h1 className="mt-2.5 font-display text-[1.7rem] font-bold leading-tight">
              {returning
                ? "You already have a profile."
                : "Confirm your number, then the questions."}
            </h1>
            {returning ? (
              /**
               * ⚠ Caught **before** the questions now, which is the whole
               * argument for moving the code: the same parent used to answer
               * eighteen screens and meet this at the end. There is nothing to
               * replace and nothing to choose between, so this is a signpost
               * rather than the two-button decision `ProfileFlow` still shows
               * on the fallback path — where by then they *have* answered.
               */
              <>
                <p className="mt-2.5 leading-relaxed text-ink-soft text-control">
                  This number is already in Pando{returning ? `, ${returning}` : ""}.
                  Sign in and you can change any answer that is already there —
                  filling the questions in again would replace them.
                </p>
                <div className="mt-5">
                  {/* The parent flow's Button is a real button (the admin's
                      is the one that also renders a link), so this navigates
                      rather than carrying an href. */}
                  <Button full onClick={() => router.push("/signin")}>
                    Sign in with this number
                    <ArrowRight />
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* ⚠ One fact, said once. The panel below already says the
                    number it is texting and that nothing is stored until this
                    is confirmed, and the heading says what comes next — so all
                    this adds is the length of what follows, which was on the
                    form's dock until that button became "Text me a code". */}
                <p className="mt-2.5 leading-relaxed text-ink-soft text-control">
                  The questions take about two minutes.
                </p>
                <VerifyPhone
                  /* Remounted when the number changes, or a code already sent
                     to the old one leaves the box waiting for something that
                     will never arrive. */
                  key={session.phone}
                  phone={session.phone}
                  /* The dock they just tapped said "Text me a code", so one is
                     already on its way — without this they read the same words
                     twice and the first tap visibly did nothing. */
                  autoStart
                  onChangeNumber={() => {
                    setStep("form");
                    setSession(null);
                    track("seed_verify_number_changed");
                  }}
                  onVerified={() => {
                    const verified = saveSession({ ...session, phone_verified: true });
                    setSession(verified);
                    track("seed_verified", { at: "entry" });
                    void afterEntryVerified(verified);
                  }}
                />
              </>
            )}
          </Container>
        </ScreenBody>
      </Screen>
    );
  }

  /**
   * ## The front screen — the client's join mockup, ported (14 Oct)
   *
   * `pando_join_mockup (3).html`, section for section: a moss **hero** (wordmark,
   * eyebrow, the inviter pill, *"You had me at 'I know someone.'"*, the lede,
   * the live line), a paper **panel** rising 16px over it with the three facts
   * and the **form card**, "Already joined? Log in", and the **footer**. One
   * 460px column (`JOIN_WRAP`) at every width, with the hero band full-bleed —
   * which is how the mockup itself reads on a desktop; a first port that turned
   * it into a moss page with a small form card, and a second that put it in
   * the flow's paper column, were both walked and rejected by the developer.
   *
   * **What the form does is unchanged** — same fields, gate, labels, resume and
   * already-registered branches — and its look is the mockup's: white fields
   * with a 1.5px border, the `+1` in its own box (`PhoneField look="split"`),
   * the tick straight on the card (`Consent plain`), a gold pill in the
   * display face. The footer carries the mockup's words in the
   * flow's format (`JoinFooter`, styled as `ScreenFooter`).
   *
   * Where it does not follow the mockup, on purpose:
   *
   *  - **The consent wording is the registered A2P text** (`SMS_CONSENT_TEXT`),
   *    not the mockup's shorter sentence: changing it is a compliance event
   *    (re-registration, counsel), never a layout change. The label still wraps
   *    only the sentence agreed to (`Consent`).
   *  - **The $10 tile explains itself** (the developer): an info mark, a dotted
   *    underline, and `REWARD_OFFER` on hover or tap — see `RewardFact`.
   *
   * Gone with the mockup: the "Founding Contributor" header badge, the offer
   * sentence under the facts (10 Sep's "once on Join" — it lives in the $10
   * tile now) and the "We won't text you anything you didn't ask for" line
   * above the tick (10 Sep) — the mockup has neither.
   */
  const field =
    "w-full rounded-[14px] border-[1.5px] border-bark bg-card px-4 py-[15px] text-[1.1rem] text-ink placeholder:text-muted/60 focus:border-green";
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SkipLink />
      <main id="main" className="flex-1">
        {/* The hero on moss. */}
        {/* On a desktop the hero is shorter (14 Oct, the developer: "trim the top
            so the page does not scroll on desktop"): the heading on one line and
            tighter spacing. The eyebrow stays above the heading, as drawn — set
            beside the wordmark it sat alone at the far edge, and the developer
            sent it back. The phone keeps the mockup's stack. */}
        <section className="bg-moss pb-7 pt-4 text-paper md:pb-5 md:pt-3.5">
          <div className={JOIN_WRAP}>
            <a href="/" aria-label="Pando home" className="inline-flex text-white">
              <Wordmark tone="light" size="lead" />
            </a>
            <p className="mt-4 text-dock font-semibold uppercase tracking-[0.16em] text-gold md:mt-3">
              Founding parents · Pasadena &amp; nearby
            </p>
            {/* "{first name} invited you" only when a personal link names somebody (10 Sep). */}
            {resolved.inviter_first_name && (
              <p className="mt-3.5 inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/15 px-[13px] py-[7px] text-[0.92rem] font-semibold text-gold-line">
                <span aria-hidden="true">✦</span>
                {resolved.inviter_first_name} invited you
              </p>
            )}
            <h1 className="mt-3.5 font-display text-[clamp(2.25rem,10.2vw,2.8rem)] font-extrabold leading-[0.98] tracking-[-0.03em] text-white md:mt-2.5 md:text-[2.5rem]">
              You had me at <span className="text-gold">“I&nbsp;know someone.”</span>
            </h1>
            <p className="mt-3 text-[1.05rem] leading-[1.45] text-paper/90 md:mt-2">
              Help build Pando by sharing your recommendations.
            </p>
            <RecentLine marketId={resolved.market_id} />
          </div>
        </section>

        {/* The form on paper, rising over the band. */}
        <section className="-mt-4 rounded-t-3xl bg-paper pb-8 pt-[18px] md:pb-4">
          <div className={JOIN_WRAP}>
            <JoinFacts />

            <div className="rounded-[20px] border border-bark bg-card px-4 pb-3.5 pt-4 shadow-[0_24px_48px_-32px_color-mix(in_oklab,var(--color-ink)_35%,transparent)]">
              <div className="mb-3">
                <label htmlFor="first-name" className="mb-[5px] block text-[0.9rem] font-semibold">
                  First name
                </label>
                <input
                  id="first-name"
                  type="text"
                  className={field}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value.slice(0, 40))}
                  autoComplete="given-name"
                  enterKeyHint="next"
                  placeholder="Your first name"
                />
              </div>
              <div className="mb-3">
                <PhoneField
                  look="split"
                  label="Mobile number"
                  value={phone}
                  onChange={(next) => {
                    setPhone(next);
                    /* The refusal belongs to the number that produced it. */
                    setRegistered(false);
                  }}
                />
              </div>

              {/* The registered wording, split so only the sentence agreed to
                  toggles the tick (`Consent`). */}
              <Consent
                id="sms-consent"
                plain
                className="mb-3.5 mt-0.5"
                checked={smsConsent}
                onChange={setSmsConsent}
                detail={SMS_CONSENT_TERMS}
                links={
                  <>
                    <InlineAction href="/terms" external tone="green">
                      Terms
                    </InlineAction>
                    <InlineAction href="/privacy" external tone="green">
                      Privacy
                    </InlineAction>
                  </>
                }
              >
                {SMS_CONSENT_AGREEMENT}
              </Consent>

              {/* The mockup's second tick, optional and muted: joining never waits
                  on it, and `canBegin` does not read it. */}
              <Consent
                id="pilot-launch"
                plain
                className="-mt-1 mb-3.5"
                checked={pilotLaunch}
                onChange={setPilotLaunch}
              >
                <span className="text-muted">{PILOT_LAUNCH_CONSENT_TEXT}</span>
              </Consent>

              {alreadySaved ? (
                <button type="button" className={JOIN_BUTTON} onClick={() => router.push("/done")}>
                  See what happens next
                </button>
              ) : (
                <button
                  type="button"
                  className={JOIN_BUTTON}
                  /* Disabled while checking, so a second tap cannot run the
                     check twice; `registered` keeps it disabled after, and
                     editing the number clears both. */
                  disabled={!canBegin || checking || registered}
                  onClick={() => void begin(canResume ? "resume" : "new")}
                >
                  {/* Her "Text me a code" only where a code can be sent (15 Sep);
                      elsewhere the tap starts the questions and says so. */}
                  {checking
                    ? "Checking…"
                    : gate?.required && gate.sendable
                      ? "Text me a code"
                      : canResume
                        ? "Continue where you left off"
                        : "Start"}
                </button>
              )}
              {/* Promised only where a code is sent (8 Oct): no code, no promise. */}
              {!alreadySaved && gate?.required && gate.sendable && (
                <p className="mt-3 text-center text-[0.88rem] leading-[1.45] text-ink-soft">
                  Enter your code, then share your recommendations.
                </p>
              )}
              {!alreadySaved && !canBegin && (
                <p className="mt-1.5 text-center text-dock text-muted">
                  Add your name and number, and tick the box, to join.
                </p>
              )}
            </div>

            {startError && <Note className="mt-4">{startError}</Note>}

            {registered && (
              /* Gold, not red: nothing they did is wrong, and it says what
                 would have happened — the overwrite she asked to prevent (8 Sep). */
              <Panel className="mt-4" tone="warning">
                <p className="text-[14.5px] leading-relaxed">
                  This number already has a Pando profile. Filling the questions in
                  again would replace what is there, so sign in instead — you can
                  change any answer once you&apos;re in.
                </p>
                <div className="mt-3">
                  <TextAction href="/signin">Sign in with this number</TextAction>
                </div>
              </Panel>
            )}

            {/* Editing, not "start a fresh one", for a saved profile (10 Sep);
                unsaved progress can still be started over. */}
            {(canResume || alreadySaved) && (
              <Panel className="mt-4" tone="positive">
                <p className="text-[14.5px] leading-relaxed text-green-deep">
                  {alreadySaved ? (
                    <>
                      Your profile is already saved on this phone.{" "}
                      <InlineAction onClick={() => router.push("/profile")}>
                        Review or edit your answers
                      </InlineAction>
                      .
                    </>
                  ) : (
                    <>
                      You have answers saved on this phone from earlier.{" "}
                      <InlineAction onClick={startOver}>Start over instead</InlineAction>.
                    </>
                  )}
                </p>
              </Panel>
            )}

            {/* The second door (14 Sep, her "sign up or login"), quiet beside the loud one. */}
            {!alreadySaved && (
              <p className="mt-[18px] text-center text-[0.92rem] text-muted">
                Already joined?{" "}
                <InlineAction href="/signin" tone="green">
                  <span className="font-semibold">Log in</span>
                </InlineAction>
              </p>
            )}
          </div>
        </section>
      </main>
      {/* The mockup's footer in the flow's format (14 Oct, the developer). */}
      <JoinFooter />
    </div>
  );
}

/** The mockup's `.btn`: the gold pill in the display face, no arrow. */
const JOIN_BUTTON =
  "block w-full cursor-pointer rounded-full bg-gold p-[18px] font-display text-[1.2rem] font-extrabold tracking-[-0.01em] text-ink transition hover:-translate-y-px hover:bg-gold-deep active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-bark disabled:text-muted disabled:hover:translate-y-0";
