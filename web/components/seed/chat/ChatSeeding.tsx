"use client";
import { DEFAULT_MARKET_ID } from "@/lib/markets";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PandoMark, Wordmark } from "@/components/ui/Logo";
import {
  BackButton,
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { track, trackAbandonOnHide } from "@/lib/analytics";
import { assistTurn, saveSubmission } from "@/lib/api-client";
import { assessChatCard } from "@/lib/contribution-quality";
import { FOUNDING_MIN_PROFILE_DEPTH, foundingProgressLine } from "@/lib/rewards";
import {
  buildSubmission,
  formatAnswer,
  isEmptyValue,
  newDraft,
  nextIndex,
  nextUnanswered,
  openerFor,
  withThing,
  promptFor,
  scriptFor,
} from "@/lib/seed-chat/engine";
import { FOLLOW_UP, buildScripts, buildSubScripts, followUpMark, homeAreaLabel } from "@/lib/seed-chat/scripts";

/** A town follow-up with no area left to fill: the script's own words. */
const FOLLOW_UP_TOWN = FOLLOW_UP.location;
import {
  ASK_AHEAD_PAUSE_MS,
  NAME_TOKEN,
  fillArea,
  PREFETCH_MAX_OPTIONS,
  afterClassified,
  conversationOf,
  fillName,
  followedUpIds,
  nameAllowed,
  worthAskingAhead,
  type TurnInput,
  type TurnResult,
} from "@/lib/seed-chat/assist";
import { followUpFor, mergeFollowUp, withoutMarkers } from "@/lib/seed-chat/follow-up";
import { isClassifiedKind, subcategoryFor, unsureSubcategory } from "@/lib/seed-chat/subcategories";
import { useMarketOptions } from "@/lib/use-market-options";
import type {
  ChatDraft,
  ChatMessage,
  ChatState,
  FieldValue,
  Fields,
  Script,
  ShareKind,
  Step,
  Submission,
} from "@/lib/seed-chat/types";
import {
  caregiverInviteMessage,
  newCaregiverInviteToken,
} from "@/lib/caregiver-invite";
import { ProfileReminder } from "@/components/seed/ProfileDepth";
import { EMPTY_ANSWERS, profileDepth } from "@/lib/questions";
import { loadSession, newSession, saveSession } from "@/lib/storage";
import {
  ReferralDialog,
  ReferralHeaderInvite,
} from "@/components/seed/ReferralInvite";
import { handleExpiredVerification, holdsUntilVerified } from "@/lib/submit";
import type { SeedSession } from "@/lib/types";
import { Bubble, CardRecap, TypingDots } from "./Bubble";
import { InviteMessage } from "./InviteMessage";
import { ConfirmBackWidget } from "./ConfirmBackWidget";
import { ShareMenu } from "./ShareMenu";
import { StepWidget } from "./StepWidget";

/**
 * Estimate 1.4 — the chat-seeding interface.
 *
 * It reads as a text conversation, but nothing is captured as prose: every turn
 * is a step from `lib/seed-chat/scripts.ts`, answered through an embedded widget,
 * written to its own field, and played back as a structured card. After each card
 * the share menu returns — that's the "add another" loop.
 *
 * The turn-taking lives here for now; if a server-driven conversation arrives
 * (spec §16.1, POST /api/seed/chat) it decides the next step and this component
 * keeps rendering exactly the same widgets.
 */
/**
 * The line after a finished card. ⚠ It must stay a different sentence from the
 * card's own last question (`EXTRA_NOTE_PROMPT`) — `test:feedback` holds that;
 * see the note where it is used in `finishCard`.
 */
function thanksLine(kind: ShareKind): string {
  return kind === "caregiver"
    ? "Thank you — that's the hardest kind to get right. Nothing about them is stored until they set up their own profile and say yes."
    : "Got it, thank you. Anything else you'd like to share?";
}

/** How long Pando "types" before a line it already has. */
const TYPING_MS = 430;

export function ChatSeeding() {
  const router = useRouter();
  const [session, setSession] = useState<SeedSession | null>(null);
  const [typing, setTyping] = useState(false);
  /* Read from the session the same way every other fact on this screen is:
     there is no server round trip here, and `answers` is what the profile
     write derived from in the first place. */
  const depth = profileDepth(session?.answers ?? EMPTY_ANSWERS);
  const initialized = useRef(false);
  const timers = useRef<number[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  /* The neighborhood chips inside these scripts come from `market_options`;
     `optionsVersion` changes when that table loads, which is what rebuilds them. */
  const optionsVersion = useMarketOptions(session?.market_id ?? DEFAULT_MARKET_ID);
  /* A place the parent found on the map and an admin has not approved yet is
     still where they live, so their cards can name it (21 Sep). Joined into a
     string for the dependency list: a fresh array each render would rebuild
     every script on every keystroke. */
  const ownPlaces = (session?.answers.other?.neighborhood ?? []).join("|");
  /* Their own neighbourhood (12 Oct): first among the town chips, and what the
     town question may offer as a check. It never leaves the device. */
  const home = session?.answers.neighborhood ?? null;
  const homeArea = homeAreaLabel(session?.market_id ?? DEFAULT_MARKET_ID, home, ownPlaces ? ownPlaces.split("|") : []);
  const scripts = useMemo(
    () =>
      buildScripts(
        session?.market_id ?? DEFAULT_MARKET_ID,
        ownPlaces ? ownPlaces.split("|") : [],
        home,
      ),
    [session?.market_id, optionsVersion, ownPlaces, home],
  );
  /* The client's sub-categories (9 Oct), built from the same inputs. */
  const subScripts = useMemo(
    () =>
      buildSubScripts(
        session?.market_id ?? DEFAULT_MARKET_ID,
        ownPlaces ? ownPlaces.split("|") : [],
        home,
      ),
    [session?.market_id, optionsVersion, ownPlaces, home],
  );
  /** The script a draft or a saved card is asked from — its sub-category's, or its button's. */
  const scriptOf = (card: Pick<ChatDraft, "kind" | "subcategory"> & { fields?: Fields }): Script =>
    scriptFor(scripts, subScripts, card);

  useEffect(() => {
    /* Read **and** subscribed. It was read once at mount and never again, so a
       parent who turned reduced motion on mid-session kept the typing delays
       until they reloaded — and this is the one screen where those delays are
       the whole experience. A ref rather than state on purpose: a state change
       here would re-render the entire transcript on a media-query flip. */
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduced.current = e.matches;
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const existing =
      loadSession() ??
      newSession({ invite_code: null, market_id: DEFAULT_MARKET_ID, source: "direct" });

    let chat: ChatState =
      existing.chat ??
      {
        mode: "menu",
        draft: null,
        submissions: [],
        messages: [
          {
            /**
             * ⚠ **One opening bubble, not three** — the client, 10 Sep:
             * *"Three opening bubbles before Step 2 → 'Thanks, {first name}.
             * What's one thing you'd recommend to another parent?'"*
             *
             * Her sentence does two jobs the three did between them: it thanks
             * them and it asks the question, so the menu underneath reads as an
             * answer to something rather than as a fourth thing to get through.
             * What went with the other two was a line about how the flow works
             * ("one thing at a time, mostly taps"), which the flow demonstrates
             * one tap later, and an "activity, camp, caregiver or tip" list,
             * which is the menu's own four buttons written out as prose.
             *
             * ⚠ **The two disclosures did not go with them** — they are not
             * conversation. The first is what her own question set opens
             * Part 2A with, reworded to her line ("Pando may use what you
             * share…"); the second is the only statement of the name default
             * anywhere in the product, now that the attribution screen sits
             * behind the optional fork. Both are the `aside` on this one
             * bubble, which is the slot for a disclosure that belongs *beside*
             * the ask rather than as its own turn.
             *
             * ⚠ The rail that used to sit next to this said *"Your name is
             * never shown with what you share"* — an absolute promise the
             * attribution question made false, which is the contradiction she
             * reported. It is gone (10 Sep), and what the aside states now is
             * the two rules as they are actually enforced: a name appears only
             * where the parent turned it on for that one recommendation
             * (`show_name` on the card, default off), and a school, class or
             * childcare arrangement is never named to another parent at all
             * (`mayBeNamed` — see `lib/affiliations.ts`).
             */
            id: uid(),
            role: "pando",
            text: existing.name
              ? `Thanks, ${existing.name}. What’s one thing you’d recommend to another parent?`
              : "What’s one thing you’d recommend to another parent?",
            aside:
              "Pando may use what you share to answer other parents’ questions, following your privacy settings. Your name stays private unless you choose to show it, and your schools, classes and childcare are never named to anyone.",
          },
        ],
      };

    /* A draft pointing at a step that no longer exists — the scripts grew between
       the parent's last visit and this one — leaves the chat in "card" mode with no
       card: no question, no dock, nothing to do. Drop it and show the menu. The
       answers in that draft are lost either way; what matters is not stranding them
       on a dead screen. */
    if (chat.draft) {
      const steps = scriptFor(scripts, subScripts, chat.draft)?.steps;
      if (!steps || !steps[chat.draft.step_index]) {
        chat = { ...chat, mode: "menu", draft: null };
      }
    }

    // Coming back after finishing: reopen rather than dead-end.
    if (chat.mode === "closed") {
      chat = {
        ...chat,
        mode: "menu",
        messages: [
          ...chat.messages,
          { id: uid(), role: "pando", text: "Back for more? What have you got?" },
        ],
      };
    }

    setSession(saveSession({ ...existing, chat }));
    track("seed_chat_opened", { saved: chat.submissions.length });
  }, []);

  const update = useCallback((mutate: (s: SeedSession) => SeedSession) => {
    setSession((prev) => (prev ? saveSession(mutate(prev)) : prev));
  }, []);

  const patchChat = useCallback(
    (fn: (chat: ChatState) => ChatState) => {
      update((s) => (s.chat ? { ...s, chat: fn(s.chat) } : s));
    },
    [update],
  );

  const withTyping = useCallback((fn: () => void, ms = TYPING_MS) => {
    setTyping(true);
    const t = window.setTimeout(
      () => {
        setTyping(false);
        fn();
      },
      reduced.current ? 0 : ms,
    );
    timers.current.push(t);
  }, []);

  const chat = session?.chat ?? null;
  /**
   * Has anything of theirs actually reached Pando? (10 Sep — the invite
   * control waits for it.)
   *
   * `persisted` rather than a count of cards: on the founding path a card is
   * written to the phone and held until a code is confirmed, and "saved" in
   * her sentence means saved. On the anonymous path a card posts as soon as it
   * is finished, so it is true a moment after the first one.
   */
  const draft = chat?.draft ?? null;
  const script = draft ? scriptOf(draft) : null;
  const step = script && draft ? script.steps[draft.step_index] : null;
  const savedCount = chat?.submissions.length ?? 0;

  // Open a resumed transcript at the newest message instantly; animate only for
  // new turns. A macrotask rather than requestAnimationFrame — rAF is throttled
  // to nothing in a backgrounded tab, and landing at the bottom must not depend
  // on the page being on screen.
  const firstScroll = useRef(true);
  useEffect(() => {
    if (!chat) return;
    const behavior: ScrollBehavior =
      firstScroll.current || reduced.current ? "auto" : "smooth";
    firstScroll.current = false;
    // Twice: once now, once after late reflow (web fonts, a card recap laying
    // out), so a long resumed transcript always ends up truly at the bottom.
    const timers = [
      window.setTimeout(() => scrollToEnd(bottomRef.current, behavior), 0),
      window.setTimeout(() => scrollToEnd(bottomRef.current, "auto"), 160),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [chat, typing]);

  // The keyboard opening or closing, or a rotation, changes how much transcript
  // fits — re-pin so the current question never ends up behind the dock.
  useEffect(() => {
    const repin = () => scrollToEnd(bottomRef.current, "auto");
    window.addEventListener("resize", repin);
    window.visualViewport?.addEventListener("resize", repin);
    return () => {
      window.removeEventListener("resize", repin);
      window.visualViewport?.removeEventListener("resize", repin);
    };
  }, []);

  useEffect(() => {
    if (!chat) return;
    return trackAbandonOnHide(() => ({
      last_screen: "chat",
      chat_mode: chat.mode,
      open_card: draft?.kind ?? null,
      open_step: step?.id ?? null,
      saved: savedCount,
    }));
  }, [chat, draft?.kind, step?.id, savedCount]);

  /**
   * ⚠⚠ **A card held for an unconfirmed number goes up the first time the chat
   * opens on a session that can send it** (8 Oct, the developer: a doctor card
   * added through the browser never reached the admin).
   *
   * A card finished before the number was confirmed is held on the phone. Every
   * way of confirming it afterwards missed it: \`/signin\` restores the session
   * and sends nothing; \`/done/ask\` sends only the cards that exist when it
   * completes; and \`/done\` offers to send held cards only *while the number is
   * unconfirmed* — so a confirmed session with an unsent card had no way out at
   * all, and the card read "Kept on this phone until you finish" forever.
   *
   * Once per mount, on the session as it was loaded: a card finished during this
   * visit is sent by \`finishCard\` itself, and one waiting on its follow-up is
   * sent when that is answered. A failed send keeps its own "Try again". Every
   * write is keyed by the card's id, so a card that did reach the server and is
   * sent again is updated in place, not duplicated.
   */
  const heldSent = useRef(false);
  useEffect(() => {
    if (heldSent.current || !session || !chat) return;
    heldSent.current = true;
    if (holdsUntilVerified(session)) return;
    const unsent = chat.submissions.filter((s) => !s.persisted && !s.error);
    if (unsent.length === 0) return;
    track("seed_held_cards_sent", { count: unsent.length });
    for (const s of unsent) void persist(s);
    // Once, on the session as loaded — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, chat]);

  /**
   * A reload while `/api/seed/assist` was answering (9 Oct): the draft still
   * sits on the last context question, already answered. Ask again — once, on
   * the session as loaded — rather than re-asking the parent.
   */
  const assistResumed = useRef(false);

  /**
   * Turns asked ahead, by their exact input (12 Oct, the developer: *"reduce
   * the time, keep the personalisation, no streaming"*). While a question with
   * a few buttons is on screen, the turn after each button is asked already;
   * a tap then finds its answer waiting instead of waiting ~1.5 s for it. The
   * key is the whole `TurnInput`, so a result is used only for exactly the
   * turn it was asked for — anything else (an undo, an edit) asks afresh.
   */
  const prefetched = useRef<Map<string, Promise<TurnResult>>>(new Map());
  useEffect(() => {
    if (assistResumed.current || !chat) return;
    assistResumed.current = true;
    if (chat.draft?.assist === "pending" && !chat.draft.editing) {
      const d = chat.draft;
      const last = scriptOf(d).steps[d.step_index];
      if (last) void takeTurn(d, last);
    }
    // Once, on the session as loaded — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat]);

  /* ── Turn taking ──────────────────────────────────────────────── */

  /** Ask `next.step_index` of the draft's own script, in the model's words when it gave some. */
  /**
   * `lead` is a reaction to the last answer, said in the same bubble; `note`
   * what was noted from their words, in small print under it (12 Oct).
   */
  function pushPrompt(ask: ChatDraft, lead?: string | null, note?: string | null) {
    const nextStep = scriptOf(ask).steps[ask.step_index];
    /* The questions before the model's first turn, said one of several ways
       (12 Oct, `openerFor`): the seed moves with each saved card, so two cards
       in a row do not open alike. A variant with their name counts as a use. */
    let next = ask;
    if (nextStep.variants && !ask.prompts?.[nextStep.id]) {
      const parent = nameAllowed(ask, firstName !== null) ? firstName : null;
      const opener = openerFor(nextStep, ask.fields, savedCount + ask.step_index + ask.kind.length, parent);
      if (opener) {
        const usedName = !!parent && opener.startsWith(`${parent},`);
        next = {
          ...ask,
          prompts: { ...(ask.prompts ?? {}), [nextStep.id]: opener },
          ...(usedName ? { names_used: (ask.names_used ?? 0) + 1, named_at_turn: ask.turns ?? 0 } : {}),
        };
      }
    }
    const question = promptFor(nextStep, next.prompts, next.fields);
    patchChat((c) => ({
      ...c,
      mode: "card",
      draft: { ...next, followup: null },
      messages: [
        ...c.messages,
        {
          id: uid(),
          role: "pando",
          text: lead ? `${lead} ${question}` : question,
          aside: [note, nextStep.aside].filter(Boolean).join(" ") || undefined,
        },
      ],
    }));
  }

  function startCard(kind: ShareKind) {
    const picked = scripts[kind];
    const first = nextIndex(picked, {}, 0);
    if (first < 0) return;

    patchChat((c) => ({
      ...c,
      mode: "card",
      draft: newDraft(kind),
      messages: [...c.messages, { id: uid(), role: "parent", text: picked.label }],
    }));
    track("seed_card_started", { kind });

    withTyping(() => {
      patchChat((c) => ({
        ...c,
        messages: [...c.messages, { id: uid(), role: "pando", text: picked.intro }],
      }));
      withTyping(() => pushPrompt({ ...newDraft(kind), step_index: first }), 520);
    });
  }

  /**
   * Tapping a row on a finished card re-asks that one step, seeded with the answer
   * already on record. It's the only way to correct a mistake after saving — the
   * alternative was re-doing the whole card.
   */
  function startFieldEdit(submission: Submission, field: string) {
    const subcategory = subcategoryFor(submission.kind, submission.fields.subcategory);
    const editScript = scriptOf({ kind: submission.kind, subcategory });
    const stepIndex = editScript.steps.findIndex((s) => s.id === field);
    if (stepIndex < 0) return;
    const editStep = editScript.steps[stepIndex];

    patchChat((c) => ({
      ...c,
      mode: "card",
      draft: {
        id: submission.id,
        kind: submission.kind,
        fields: { ...submission.fields },
        step_index: stepIndex,
        subcategory,
        editing: { submission_id: submission.id, step_id: field },
      },
      messages: [
        ...c.messages,
        {
          id: uid(),
          role: "parent",
          text: `${isEmptyValue(submission.fields[field]) ? "Add" : "Edit"}: ${editScript.recap.find((r) => r.field === field)?.label ?? field}`,
        },
      ],
    }));
    track("seed_card_field_edit_started", { kind: submission.kind, step: field });

    withTyping(() =>
      patchChat((c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            id: uid(),
            role: "pando",
            text: editStep.prompt,
            aside: isEmptyValue(submission.fields[field])
              ? editStep.aside
              : `It currently says “${formatAnswer(editStep, submission.fields[field] as FieldValue)}”.`,
          },
        ],
      })),
    );
  }

  /** Applying a correction: update the saved card in place, then re-save it. */
  function applyFieldEdit(value: FieldValue, extra?: Fields) {
    if (!draft?.editing || !step || !chat) return;
    const { submission_id, step_id } = draft.editing;

    const existing = chat.submissions.find((s) => s.id === submission_id);
    if (!existing) return;

    // Built outside the state updater: React may run an updater twice, so it has
    // to stay pure.
    /* `extra` is the second field the `place` widget writes — the town of a
       name it matched — so correcting the name corrects both (5 Oct). */
    const fields: Fields = { ...draft.fields, [step_id]: value, ...(extra ?? {}) };
    const updated: Submission = {
      ...existing,
      fields,
      persisted: false,
      error: false,
    };

    patchChat((c) => ({
      ...c,
      mode: "menu",
      draft: null,
      submissions: c.submissions.map((s) => (s.id === submission_id ? updated : s)),
      messages: [
        ...c.messages.map((m) =>
          m.card?.id === submission_id ? { ...m, card: updated } : m,
        ),
        { id: uid(), role: "parent", text: formatAnswer(step, value), step_id },
      ],
    }));

    track("seed_card_field_edited", { kind: draft.kind, step: step_id });

    withTyping(() => {
      patchChat((c) => ({
        ...c,
        messages: [
          ...c.messages,
          { id: uid(), role: "pando", text: "Updated — thank you. Anything else?" },
        ],
      }));
      // Same client id, so the backend upserts rather than duplicating the card.
      void persist(updated);
    });
  }

  /**
   * ⚠ `extra` is for the one widget that answers more than one question:
   * `place` writes the name **and** the town the matched record already
   * carries (10 Sep), which is what lets the town step disappear and takes the
   * activity card to six questions. It is spread into `fields` exactly as
   * `holdIf` already spreads its two, so nothing else about this path changes.
   */
  function answer(value: FieldValue, extra?: Fields) {
    if (!draft || !script || !step) return;

    if (draft.editing) {
      applyFieldEdit(value, extra);
      return;
    }

    const skipped = isEmptyValue(value);
    const parentMessage: ChatMessage = {
      id: uid(),
      role: "parent",
      text: skipped ? "Skipped" : formatAnswer(step, value),
      step_id: step.id,
      skipped,
    };

    const stop = step.stopIf?.(value) ?? null;
    if (stop) {
      patchChat((c) => ({
        ...c,
        mode: "menu",
        draft: null,
        messages: [...c.messages, parentMessage],
      }));
      track("seed_card_aborted", { kind: draft.kind, step: step.id });
      withTyping(() =>
        patchChat((c) => ({
          ...c,
          messages: [...c.messages, { id: uid(), role: "pando", text: stop }],
        })),
      );
      return;
    }

    /* A hold keeps the answer and adds a flag — it never silently drops the card,
       and the parent is told in the next line that a person will look at it. */
    const hold = step.holdIf?.(value) ?? null;
    const fields: Fields = {
      ...draft.fields,
      [step.id]: value,
      ...(extra ?? {}),
      ...(hold ? { review_hold: "true", hold_reason: step.id } : {}),
    };
    if (hold) track("seed_card_review_hold", { kind: draft.kind, step: step.id });
    track(isEmptyValue(value) ? "seed_card_step_skipped" : "seed_card_step_answered", {
      kind: draft.kind,
      step: step.id,
    });

    const answered: ChatDraft = { ...draft, fields };
    patchChat((c) => ({
      ...c,
      draft: answered,
      messages: [...c.messages, parentMessage],
    }));

    if (hold) {
      withTyping(() => {
        patchChat((c) => ({
          ...c,
          messages: [...c.messages, { id: uid(), role: "pando", text: hold }],
        }));
        advance(answered, step, 520, skipped ? "" : parentMessage.text);
      });
      return;
    }
    advance(answered, step, undefined, skipped ? "" : parentMessage.text);
  }

  /**
   * After an answer (and after its follow-up, if it had one).
   *
   * Once a card's last context question is answered, every turn is the
   * adaptive interview's (`takeTurn`): the server decides whether to follow the
   * answer up, which closed answers the parent's words already gave, and which
   * open question to ask next, in words for them. Before that — and always on a
   * caregiver card — the script's own order, with the rule-based follow-ups.
   */
  function advance(d: ChatDraft, last: Step, delay?: number, said?: string) {
    const adaptive = isClassifiedKind(d.kind) && (d.assist === "done" || last.classifyAfter === true);
    if (adaptive) {
      void takeTurn(d, last, said);
      return;
    }
    if (askRuleFollowUp(d, last)) return;
    const s = scriptOf(d);
    const upcoming = nextIndex(s, d.fields, d.step_index + 1);
    withTyping(() => {
      if (upcoming < 0) finishCard(d);
      else pushPrompt({ ...d, step_index: upcoming });
    }, delay);
  }

  /**
   * Ask a follow-up about `last` (9 Oct): once per question — the marker is
   * written with it, so a reload mid-follow-up cannot ask it a second time.
   */
  function askFollowUp(d: ChatDraft, last: Step, question: string, delay?: number) {
    /* A step with buttons (12 Oct: the town) is asked again with its own
       buttons — a text box cannot hold a town — once, and skippable again. */
    if (last.widget !== "text") {
      const s = scriptOf(d);
      const index = s.steps.findIndex((x) => x.id === last.id);
      if (index >= 0) {
        const fields: Fields = { ...d.fields, [followUpMark(last.id)]: "yes" };
        delete fields[last.id];
        track("seed_confirm_back_shown", { kind: d.kind, subcategory: d.subcategory ?? null, field: last.id });
        withTyping(
          () =>
            pushPrompt({
              ...d,
              fields,
              step_index: index,
              followup: null,
              prompts: { ...(d.prompts ?? {}), [last.id]: question },
            }),
          delay,
        );
        return;
      }
    }
    const asked: ChatDraft = {
      ...d,
      fields: { ...d.fields, [followUpMark(last.id)]: "yes" },
      followup: { step_id: last.id, question, before: (d.fields[last.id] ?? "") as FieldValue },
    };
    patchChat((c) => ({ ...c, draft: asked }));
    track("seed_confirm_back_shown", {
      kind: d.kind,
      subcategory: d.subcategory ?? null,
      field: last.id,
    });
    withTyping(
      () =>
        patchChat((c) => ({
          ...c,
          messages: [...c.messages, { id: uid(), role: "pando", text: question }],
        })),
      delay,
    );
  }

  /** The rule-based follow-up (`followUpFor`), when no model is asked. */
  function askRuleFollowUp(d: ChatDraft, last: Step, delay?: number): boolean {
    const ask = followUpFor(d.kind, last, (d.fields[last.id] ?? "") as FieldValue, d.fields);
    if (!ask) return false;
    askFollowUp(d, last, ask, delay);
    return true;
  }

  /**
   * The parent answered the follow-up, or skipped it. What they add is appended
   * to the answer it follows up (`mergeFollowUp`), and the card goes on.
   */
  function answerFollowUp(text: string) {
    if (!draft?.followup) return;
    const { step_id, before } = draft.followup;
    const last = scriptOf(draft).steps.find((x) => x.id === step_id);
    const addition = text.trim();
    const fields: Fields = { ...draft.fields, [step_id]: mergeFollowUp(before, addition) };
    const next: ChatDraft = { ...draft, fields, followup: null };
    patchChat((c) => ({
      ...c,
      draft: next,
      messages: [
        ...c.messages,
        addition
          ? { id: uid(), role: "parent" as const, text: addition }
          : { id: uid(), role: "parent" as const, text: "Skipped", skipped: true },
      ],
    }));
    track("seed_confirm_back_answered", {
      kind: draft.kind,
      subcategory: draft.subcategory ?? null,
      field: step_id,
      added: addition.length > 0,
    });
    if (last) advance(next, last, undefined, addition);
  }

  /**
   * One turn of the adaptive interview (9 Oct) — `/api/seed/assist`.
   *
   * On the last context question it classifies first. Then, from everything
   * said so far: a follow-up about `last` (once), the closed answers the
   * parent's words already gave (each one shown to them as noted, and
   * editable on the recap like any answer), and the next open question in
   * words for them. Every failure is the script's own order with the
   * rule-based follow-ups — `assistTurn` never throws.
   */
  /** `said` is what the parent has just sent — not on screen yet (12 Oct). */
  /* The parent's first name stays on this device: the server is told only
     that there is one to use (12 Oct), and the token is filled in here. */
  const firstName = (session?.first_name ?? session?.name ?? "").trim().split(/\s+/)[0] || null;

  /** One turn's request — built the same way for a turn and for one asked ahead. */
  function turnInputFor(d: ChatDraft, last: Step, said?: string): TurnInput | null {
    if (!isClassifiedKind(d.kind)) return null;
    return {
      kind: d.kind,
      classify: d.assist !== "done",
      subcategory: d.subcategory ?? null,
      fields: withoutMarkers(d.fields),
      last_step: last.id,
      followed_up: followedUpIds(d.fields),
      child_ages: session?.answers.child_ages ?? [],
      market_id: session?.market_id ?? DEFAULT_MARKET_ID,
      may_name: nameAllowed(d, firstName !== null),
      has_area: homeArea !== null,
      recent_reactions: d.reactions ?? [],
      conversation: conversationOf(chat?.messages ?? [], scripts[d.kind].label, firstName, said, homeArea),
    };
  }

  /* Ask ahead for each button of the question on screen (see `prefetched`). */
  useEffect(() => {
    if (!draft || !step || typing || draft.editing || draft.followup) return;
    if (!isClassifiedKind(draft.kind) || draft.assist !== "done") return;
    if (step.widget !== "quick" || !step.options || step.options.length > PREFETCH_MAX_OPTIONS) return;
    if (step.stopIf || step.holdIf) return;
    const asks = step.options.flatMap((o) => {
      const input = turnInputFor({ ...draft, fields: { ...draft.fields, [step.id]: o.id } }, step, formatAnswer(step, o.id));
      return input ? [[JSON.stringify(input), input] as const] : [];
    });
    if (asks.every(([key]) => prefetched.current.has(key))) return;
    prefetched.current = new Map(asks.map(([key, input]) => [key, assistTurn(input)]));
    // Asked again only when the question on screen or the chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, step, typing, chat?.messages.length]);

  /**
   * An answer typed or picked but not sent yet, asked ahead (12 Oct, the
   * developer: *"reduce the time, keep the personalisation, no streaming"*).
   * The buttons cover a third of the turns; the rest follow something typed or
   * picked, where the parent spends a moment before Send. Once they stop
   * typing (`ASK_AHEAD_PAUSE_MS`), the turn for exactly that answer goes into
   * `prefetched` under the same key `takeTurn` looks up — so Send uses it only
   * if not a character changed. Bounded: one guess in flight at a time, at
   * most `ASK_AHEAD_PER_QUESTION` per question (`worthAskingAhead`).
   */
  const ahead = useRef<{
    question: string;
    asked: number;
    inFlight: boolean;
    timer: number | null;
    next: { key: string; input: TurnInput } | null;
  }>({ question: "", asked: 0, inFlight: false, timer: null, next: null });

  function askAheadNow() {
    const a = ahead.current;
    a.timer = null;
    const next = a.next;
    if (!next || a.inFlight || prefetched.current.has(next.key)) return;
    a.inFlight = true;
    a.asked += 1;
    const asked = assistTurn(next.input);
    prefetched.current.set(next.key, asked);
    void asked.finally(() => {
      a.inFlight = false;
      /* They changed it while this one was out, and have paused since. */
      if (a.timer === null && a.next && !prefetched.current.has(a.next.key)) askAheadNow();
    });
  }

  /** `answered` is the draft exactly as `answer` or `answerFollowUp` would send it; `said`, their words. */
  function stageAnswer(question: string, answered: ChatDraft, last: Step, value: FieldValue, said: string, pause: number) {
    const a = ahead.current;
    if (a.question !== question) Object.assign(a, { question, asked: 0, next: null });
    if (a.timer !== null) window.clearTimeout(a.timer);
    a.timer = null;
    const input = worthAskingAhead(value, a.asked) ? turnInputFor(answered, last, said) : null;
    a.next = input ? { key: JSON.stringify(input), input } : null;
    if (a.next && !prefetched.current.has(a.next.key)) a.timer = window.setTimeout(askAheadNow, pause);
  }

  /** Only a turn `advance` would hand to `takeTurn`, on a step that neither stops nor holds the card. */
  function asksAhead(d: ChatDraft, last: Step): boolean {
    return (
      isClassifiedKind(d.kind) &&
      (d.assist === "done" || last.classifyAfter === true) &&
      !last.stopIf &&
      !last.holdIf
    );
  }

  /** The step widget's staged value (`StepWidget.onStage`), built as `answer` builds it. */
  function stageStep(value: FieldValue) {
    if (!draft || !step || typing || draft.editing || draft.followup || !asksAhead(draft, step)) return;
    if (step.widget !== "text" && step.widget !== "ages" && step.widget !== "chips") return;
    const answered: ChatDraft = { ...draft, fields: { ...draft.fields, [step.id]: value } };
    const said = isEmptyValue(value) ? "" : formatAnswer(step, value);
    const pause = step.widget === "text" ? ASK_AHEAD_PAUSE_MS.typed : ASK_AHEAD_PAUSE_MS.picked;
    stageAnswer(`${draft.id}:${step.id}`, answered, step, value, said, pause);
  }

  /** The draft after the follow-up is answered with `text`, built as `answerFollowUp` builds it. */
  function followUpAnswered(d: ChatDraft, text: string): { answered: ChatDraft; last: Step } | null {
    if (!d.followup) return null;
    const { step_id, before } = d.followup;
    const last = scriptOf(d).steps.find((x) => x.id === step_id);
    if (!last || !asksAhead(d, last)) return null;
    return {
      answered: { ...d, fields: { ...d.fields, [step_id]: mergeFollowUp(before, text) }, followup: null },
      last,
    };
  }

  function stageFollowUp(text: string) {
    if (!draft?.followup || typing) return;
    const f = followUpAnswered(draft, text);
    if (f) stageAnswer(`${draft.id}:fu:${draft.followup.step_id}`, f.answered, f.last, text, text, ASK_AHEAD_PAUSE_MS.typed);
  }

  /* Declining is asked ahead the moment it is on screen, like a button
     (12 Oct): "It's fine as it is" under a follow-up, and Skip under an
     optional question that is typed or picked (the town, who it suits) — one
     tap, and often the answer. A question with buttons has its own above. */
  useEffect(() => {
    if (!draft || !step || typing || draft.editing) return;
    let ask: { answered: ChatDraft; last: Step } | null = null;
    if (draft.followup) ask = followUpAnswered(draft, "");
    else if (step.optional && (step.widget === "text" || step.widget === "chips" || step.widget === "ages") && asksAhead(draft, step))
      ask = { answered: { ...draft, fields: { ...draft.fields, [step.id]: step.widget === "text" ? "" : [] } }, last: step };
    const input = ask ? turnInputFor(ask.answered, ask.last, "") : null;
    if (!input) return;
    const key = JSON.stringify(input);
    if (!prefetched.current.has(key)) prefetched.current.set(key, assistTurn(input));
    // Once per question on screen, as the buttons above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, step, typing, chat?.messages.length]);

  async function takeTurn(d: ChatDraft, last: Step, said?: string) {
    const input = turnInputFor(d, last, said);
    if (!input) return;
    const kind = input.kind;
    const classify = input.classify;
    patchChat((c) => ({ ...c, draft: { ...d, assist: classify ? "pending" : "done" } }));
    setTyping(true);
    const followed = input.followed_up;
    const ready = prefetched.current.get(JSON.stringify(input));
    prefetched.current = new Map();
    if (ahead.current.timer !== null) window.clearTimeout(ahead.current.timer);
    Object.assign(ahead.current, { timer: null, next: null });
    const started = Date.now();
    const raw = await (ready ?? assistTurn(input));
    setTyping(false);
    /* A follow-up waits out only what is left of the usual typing pause
       (12 Oct): it used to add the whole pause after the model's own second. */
    const pause = Math.max(0, TYPING_MS - (Date.now() - started));
    const named = [raw.followup, raw.ack, raw.next?.prompt].some((t) => t?.includes(NAME_TOKEN) ?? false);
    const fill = (t: string | null | undefined) => (t ? fillName(t, firstName) : null);
    const result = {
      ...raw,
      /* The town asked again may carry their area (12 Oct). */
      followup: raw.followup ? (fillArea(fillName(raw.followup, firstName), homeArea) ?? withThing(FOLLOW_UP_TOWN, d.fields)) : null,
      ack: fill(raw.ack),
      next: raw.next
        ? {
            ...raw.next,
            /* No area to fill (it was cleared mid-card): the script's own words, never "{area}". */
            prompt:
              fillArea(fillName(raw.next.prompt, firstName), homeArea) ??
              (scriptOf(d).steps.find((x) => x.id === raw.next?.id)?.prompt ?? ""),
          }
        : null,
    };

    /* Unsure, or no reply at all: the button's fallback (12 Oct — specialists). */
    const subcategory = classify
      ? (subcategoryFor(kind, result.subcategory) ?? unsureSubcategory(kind))
      : (d.subcategory ?? null);
    const base: ChatDraft = {
      ...d,
      subcategory,
      named: d.named || named,
      names_used: (d.names_used ?? 0) + (named ? 1 : 0),
      named_at_turn: named ? (d.turns ?? 0) + 1 : d.named_at_turn,
      turns: (d.turns ?? 0) + 1,
      reactions: [...(d.reactions ?? []), raw.ack ?? raw.followup ?? ""].slice(-3),
      assist: "done",
      fields: classify ? afterClassified(kind, subcategory, d.fields) : d.fields,
    };
    if (classify) {
      track("seed_card_classified", {
        kind,
        subcategory: subcategory ?? "general",
        configured: result.configured,
      });
    }
    const s = scriptOf(base);

    if (!result.configured) {
      if (askRuleFollowUp(base, last, pause)) return;
      const upcoming = nextUnanswered(s, base.fields, 0);
      if (upcoming < 0) finishCard(base);
      else pushPrompt({ ...base, step_index: upcoming });
      return;
    }

    if (result.followup && !followed.includes(last.id)) {
      askFollowUp(base, last, result.followup, pause);
      return;
    }

    /* Closed answers the parent already gave, said back to them so nothing is
       recorded behind their back. */
    const fields: Fields = { ...base.fields, ...result.prefill };
    const noted = Object.entries(result.prefill).flatMap(([id, value]) => {
      const x = s.steps.find((st) => st.id === id);
      if (!x) return [];
      const label = s.recap.find((r) => r.field === id)?.label ?? id;
      return [`${label}: ${formatAnswer(x, value as FieldValue)}`];
    });
    /* 12 Oct: a small line under the next question, not a bubble of its own —
       "Noted from what you said — …" read as a form talking. */
    const note = noted.length > 0 ? `Noted from what you said: ${noted.join(" · ")}.` : null;
    const nextDraft: ChatDraft = { ...base, fields };

    /* A short reaction to what they just typed (iteration 1, 9 Oct) leads into
       the next question in the same bubble (12 Oct, the developer: questions
       should look dynamic); said alone only when the card ends here. */
    const ack = result.ack;
    const sayAlone = () => {
      if (ack || note) {
        patchChat((c) => ({
          ...c,
          messages: [...c.messages, { id: uid(), role: "pando", text: ack ?? undefined, aside: note ?? undefined }],
        }));
      }
    };

    if (!result.next) {
      sayAlone();
      finishCard(nextDraft);
      return;
    }
    const index = s.steps.findIndex((x) => x.id === result.next?.id);
    if (index < 0) {
      const upcoming = nextUnanswered(s, fields, 0);
      if (upcoming < 0) {
        sayAlone();
        finishCard(nextDraft);
      } else pushPrompt({ ...nextDraft, step_index: upcoming }, ack, note);
      return;
    }
    pushPrompt(
      {
        ...nextDraft,
        step_index: index,
        prompts: { ...(d.prompts ?? {}), [result.next.id]: result.next.prompt },
      },
      ack,
      note,
    );
  }

  /**
   * What to say about the way to Founding after `card` (5 Oct).
   *
   * "Completed" is what the phone can know — every question the card's kind
   * requires is answered (`assessChatCard`) — and `others` are the cards this
   * parent has already finished. The last line, "you're a Founding
   * Contributor", is held back until the profile also clears the bar, because
   * the badge needs both.
   */
  function progressLine(card: Submission, others: Submission[]): string | null {
    const done = (s: Submission) => assessChatCard(s.kind, s.fields).status === "qualifies";
    const justCompleted = done(card);
    const completed = others.filter((s) => s.id !== card.id && done(s)).length + (justCompleted ? 1 : 0);
    const profileReady =
      session?.phone_verified === true &&
      Boolean(session?.answers.neighborhood) &&
      (session?.answers.child_ages ?? []).length > 0 &&
      profileDepth(session.answers).percent >= FOUNDING_MIN_PROFILE_DEPTH;
    return foundingProgressLine({ completed, justCompleted, profileReady });
  }

  function finishCard(d: ChatDraft) {
    const { kind } = d;
    /* The sub-category rides in the card's fields, where the save route and
       `submissions.fields` already look for everything the parent answered. */
    const fields: Fields = d.subcategory ? { ...d.fields, subcategory: d.subcategory } : d.fields;
    /**
     * The standing answer is the **default**, never the decision (10 Sep).
     *
     * `people.attribution` is what the parent said in general; this is what they
     * say about this one recommendation, and the client asked for the second
     * precisely because one enum cannot answer for both — a parent is willing to
     * be named on the swim class and not on the therapist.
     *
     * Anything but an explicit "use my first name" arrives as `false`, including
     * the null carried by a parent who never reached that screen — it is behind
     * the optional fork since 10 Sep, so most will not have. Naming somebody is
     * the one mistake this flag can make, so every path that is not an explicit
     * yes has to land on no.
     *
     * Deliberately absent on a caregiver card: that card is about a named person
     * already, it writes no `share_contributions` row, and the toggle is not
     * offered on it.
     */
    const submission: Submission = {
      ...buildSubmission({ id: d.id, kind, fields, step_index: 0 }),
      /* A caregiver card mints its invite token here, before any round trip,
         so the message below can carry it at once (drizzle/0049). */
      ...(kind === "caregiver"
        ? { invite_token: newCaregiverInviteToken() }
        : { show_name: session?.answers.attribution === "first_name" }),
    };

    /* Follow-ups were asked as the card went (9 Oct), so it is finished and
       sent as it is — the end-of-card confirm-back is gone. */
    const progress = progressLine(submission, chat?.submissions ?? []);

    patchChat((c) => ({
      ...c,
      mode: "menu",
      draft: null,
      submissions: [...c.submissions, submission],
      messages: [
        ...c.messages,
        { id: uid(), role: "pando", card: submission },
        {
          id: uid(),
          role: "pando",
          /**
           * ⚠⚠ **"Anything else you'd pass on?" was the reported confusion
           * and it is fixed here rather than reworded.** It arrives *after*
           * the card is saved, so it can only mean *another card* — but on
           * a screen that had just spent six questions on this one it read
           * as *more about this one*, and there was no field to answer it
           * with. ⚠⚠ **The first fix put those words on the card and made this
           * line read *Want to add another?*, and the developer swapped them
           * back the same day**: *anything else* reads as *another
           * recommendation*, which is exactly what this line asks, while the
           * card's own last step is about **this** one and now says so.
           *
           * ⚠ The two must stay different sentences, and `test:feedback` holds
           * that rather than trusting it — they were the same words in two
           * places for a day, which is how this was reported.
           */
          text: thanksLine(kind),
        },
        /* The way to Founding, after the card (5 Oct) — in the chat, where the
           parent is, rather than in a banner they have to notice. */
        ...(progress ? [{ id: uid(), role: "pando" as const, text: progress }] : []),
      ],
    }));

    void persist(submission);
  }

  /**
   * C11: the invite is the parent's to send, so it appears as text to copy
   * rather than as something Pando promises to do.
   *
   * ⚠⚠ **Only once the card is saved** (23 Sep). It used to appear the moment the
   * card was finished, before the round trip — and since the link carries a
   * token that names this card, a message shown for a card that then failed to
   * save, or was held on the phone, sent the caregiver to a token that existed
   * nowhere. With the bare `/caregiver` address closed that is a dead end, and it
   * is exactly what the developer hit: the link opened with her name blank. So
   * the message waits for the server to say the card is in, and a correction
   * that re-saves the same card does not add it twice.
   */
  function offerCaregiverInvite(submission: Submission) {
    const token = submission.invite_token;
    /* Always, since 23 Sep — the question asking whether to show it is gone. */
    if (submission.kind !== "caregiver" || !token) return;
    /* 30 Sep, the client's table: a No must never generate a recommendation or
       an invitation. The card is kept as a private, held record and nothing is
       offered to send. */
    if (submission.fields.hire_again === "no") return;
    const name = submission.fields.name;
    patchChat((c) =>
      c.messages.some((m) => m.invite?.includes(token))
        ? c
        : {
            ...c,
            messages: [
              ...c.messages,
              {
                id: uid(),
                role: "pando",
                invite: caregiverInviteMessage({
                  caregiverFirstName: Array.isArray(name) ? String(name[0]) : null,
                  parentFirstName: session?.first_name ?? session?.name ?? null,
                  token,
                }),
              },
            ],
          },
    );
  }

  async function persist(submission: Submission) {
    if (!session) return;
    /* No confirmed number yet — the anonymous path aside, that means a deployment
       that cannot send a code, or a confirmation that ran out. The card stays on
       this phone and goes up with everything else at the end; the footer says so. */
    if (holdsUntilVerified(session)) {
      markSubmission(submission.id, { persisted: false, error: false });
      track("seed_card_held", { kind: submission.kind });
      return;
    }
    try {
      const result = await saveSubmission({
        invite_code: session.invite_code,
        market_id: session.market_id,
        source: session.source,
        is_test: session.is_test === true,
        contributor_name: session.name,
        contributor_phone: session.phone,
        submission: {
          id: submission.id,
          kind: submission.kind,
          /* Its own field rather than an entry in `fields`, which is the
             verbatim record of what the parent said about the *place*. A
             privacy decision about Pando does not belong in the evidence. */
          show_name: submission.show_name === true,
          ...(submission.invite_token
            ? { invite_token: submission.invite_token }
            : {}),
          /* The `__fu_*` follow-up markers are facts about the conversation,
             not about the recommendation, and `/api/seed/save` would have no
             field to put them in. Stripped here rather than never stored,
             because they have to survive a reload — a parent who refreshes
             mid-card must not be asked the same follow-up again. */
          fields: withoutMarkers(submission.fields),
          created_at: submission.created_at,
        },
      });
      markSubmission(submission.id, { persisted: result.persisted, error: false });
      if (result.persisted) offerCaregiverInvite(submission);
      track("seed_card_saved", {
        kind: submission.kind,
        persisted: result.persisted,
      });
    } catch (err) {
      /* The confirmation ran out. Not an error the parent did anything about, and
         not a lost card: the session goes back to holding, this card is held with
         the rest, and the end of the flow asks for a fresh code. */
      if (handleExpiredVerification(err)) {
        update((s) => ({ ...s, phone_verified: false }));
        markSubmission(submission.id, { persisted: false, error: false });
        track("seed_card_held", { kind: submission.kind });
        return;
      }
      markSubmission(submission.id, { persisted: false, error: true });
      track("seed_card_save_failed", { kind: submission.kind });
    }
  }

  /**
   * The client's per-recommendation name toggle (10 Sep).
   *
   * ⚠ **It re-sends the card, and that is the point rather than a side effect.**
   * The decision lives on `share_contributions.show_first_name`, so a flag that
   * only moved in local state would be a control that visibly works and changes
   * nothing another parent ever sees — the fault this repository has now paid
   * for five times. Every write is keyed by `client_id`, so the save upserts.
   *
   * ⚠ The local state is patched **first**, so the switch answers the tap even
   * when the send is slow or the session is holding the card until a code is
   * confirmed. On that path `persist` marks it held and returns, and the flag
   * travels with everything else in `flushSession`.
   */
  function toggleName(card: Submission, next: boolean) {
    markSubmission(card.id, { show_name: next });
    track("seed_card_name_toggled", { kind: card.kind, on: next });
    void persist({ ...card, show_name: next });
  }

  function markSubmission(id: string, patch: Partial<Submission>) {
    patchChat((c) => ({
      ...c,
      submissions: c.submissions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      messages: c.messages.map((m) =>
        m.card?.id === id ? { ...m, card: { ...m.card, ...patch } } : m,
      ),
    }));
  }

  function undoLast() {
    if (!chat || !draft || !script) return;

    const lastParent = [...chat.messages]
      .reverse()
      .find((m) => m.role === "parent" && m.step_id);
    if (!lastParent?.step_id) return;

    const cutAt = chat.messages.findIndex((m) => m.id === lastParent.id);
    /* Undoing one of the context questions undoes the classification too: the
       card goes back to its button's script and is classified again (9 Oct). */
    const general = scripts[draft.kind];
    const contextEnd = general.steps.findIndex((s) => s.classifyAfter);
    const generalIndex = general.steps.findIndex((s) => s.id === lastParent.step_id);
    const backToGeneral = contextEnd >= 0 && generalIndex >= 0 && generalIndex <= contextEnd;
    const target = backToGeneral ? general : script;
    const stepIndex = target.steps.findIndex((s) => s.id === lastParent.step_id);
    if (cutAt < 0 || stepIndex < 0) return;

    const fields: Fields = { ...draft.fields };
    delete fields[lastParent.step_id];
    delete fields[followUpMark(lastParent.step_id)];
    if (backToGeneral && draft.kind === "tip") delete fields.tip;

    patchChat((c) => ({
      ...c,
      // The prompt for that step sits just above, so it stays on screen.
      messages: c.messages.slice(0, cutAt),
      draft: {
        ...draft,
        fields,
        step_index: stepIndex,
        followup: null,
        ...(backToGeneral
          ? { subcategory: undefined, prompts: undefined, followups: undefined, assist: undefined }
          : {}),
      },
    }));
    track("seed_card_answer_undone", { kind: draft.kind, step: lastParent.step_id });
  }

  function doneForNow() {
    patchChat((c) => ({
      ...c,
      mode: "closed",
      messages: [
        ...c.messages,
        {
          id: uid(),
          role: "parent",
          text: savedCount > 0 ? "That's me for now" : "I'll do this later",
        },
      ],
    }));
    track("seed_chat_finished", { shared: savedCount });
    router.push("/done");
  }

  /* ── Render ───────────────────────────────────────────────────── */

  if (!chat) {
    return (
      <Screen>
        <ScreenHeader left={<Wordmark />} />
        <ScreenBody>
          <div className="h-10 w-3/4 rounded-3xl bg-bark/50" />
        </ScreenBody>
      </Screen>
    );
  }

  const canUndo =
    Boolean(draft) &&
    chat.messages.some((m) => m.role === "parent" && m.step_id) &&
    draft!.step_index > nextIndex(script!, {}, 0);

  /* The latest thing Pando said, for the live region below the transcript. */
  const lastFromPando = (() => {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      const m = chat.messages[i];
      if (m.role !== "pando" || m.card || m.invite) continue;
      return [m.text, m.aside].filter(Boolean).join(" ");
    }
    return "";
  })();

  return (
    <Screen>
      {/* No running "N cards ready" counter: the saved cards are already on the
          screen as recaps, so the pill only repeated what the parent could see —
          and a count in the header edges towards scorekeeping. */}
      <ScreenHeader
        /**
         * ⚠⚠ **This screen had no way back, and that is the wall she hit** —
         * her §1: *"I was unable to go 'back' beyond a certain point which I
         * found very tough to manage … Should we not allow people to save
         * progress where they are and go back until the point they see the
         * final page of everything they have entered?"*
         *
         * Every other surface in the flow has one. `ProfileFlow` walks back
         * screen by screen and from its first question to `/join`; `/done` and
         * `/done/ask` carry a Back in the dock. This header held the wordmark
         * and nothing else, so once the profile was saved and a parent landed
         * here, the only route to change an answer was typing `/profile` — and
         * the two controls that look like they might help both make it worse:
         * "Start over" clears the device, and logging back in returns the same
         * profile. That trio is exactly the *"super confusing"* she named.
         *
         * It goes to the **review**, not to the last question: `ProfileFlow`
         * opens there for a saved profile (7 Sep), which is her own *"the
         * final page of everything they have entered … and then edit any
         * response"*.
         *
         * ⚠ Nothing is lost by leaving. A half-finished card lives in the
         * session, which is autosaved on every answer, and the transcript is
         * rebuilt from it on return — the same property that makes the flow
         * resumable a day later.
         *
         * ⚠ **`/done/ask` since 7 Oct, not the review.** That screen now sits
         * between the profile and this one, so it is the step back; its own
         * Back leads on to the review, so the route above still exists — one
         * tap further.
         */
        left={
          <div className="flex items-center gap-1">
            <BackButton onClick={() => router.push("/done/ask")} />
            {/* On a phone the header also carries the profile badge and the invite
                link (21 Sep), and the full lockup overlapped them at 375px — so the
                mark alone there, and the word from sm up. Wrappers, not classes on
                Wordmark: its own flex and a hidden would fight in one layer. */}
            <span className="sm:hidden"><PandoMark className="h-6" /></span>
            <span className="hidden sm:block"><Wordmark /></span>
          </div>
        }
        /**
         * Her instruction of 8 Sep put the invite link within reach on the
         * screen a parent actually spends time on, rather than only in the
         * popup they see once and on a thank-you screen two taps further on.
         *
         * ⚠⚠ **It waited for a saved recommendation between 10 and 15 Sep, and
         * the developer asked for it back** — *"поверни реферальне посилання в
         * тому вигляді, якому воно було, на сторінку share"*. That gate was
         * the client's own (10 Sep: *"The Invite button appears only after the
         * first recommendation is saved"*) and its reasoning was real: asking
         * somebody to bring their friends before they have given anything is a
         * favour asked on the strength of nothing. **This reverses it for the
         * pill and is hers to reverse back.** What made it expensive in
         * practice is that the control most parents will use is invisible for
         * the whole of their first visit, on the one screen they sit on.
         *
         * ⚠ Since 9 Oct the **popup** no longer waits either — see below.
         *
         * ⚠ `referral_code` is still required and there is no fallback: the
         * code is minted by the server (the profile write, or `/api/seed/me`),
         * so no code means Pando has no link to give — the `persisted: false`
         * rule, and the reason this renders nothing on a deployment with no
         * database rather than an address that would 404.
         */
        right={
          /* 21 Sep: the percentage moved up here beside the invite link that
             morning, and moved out again the same day when it became a
             banner over the thread — ⚠ the pill said the same number a
             hundred pixels from the banner's own, which is one measure said
             twice on one screen. The invite link keeps the slot. */
          session?.referral_code ? (
            <ReferralHeaderInvite code={session.referral_code} />
          ) : undefined
        }
        below={<ProfileReminder depth={depth} />}
      />

      {/**
        * The referral popup, over this page (7 Sep, her third instruction).
        *
        * The trigger is the session rather than a prop or a query parameter: a
        * code that has not been shown yet. So it appears once, survives a
        * reload, cannot come back on a re-save, and needs nothing from the
        * screen that navigated here.
        *
        * ⚠⚠ **It opens on the first arrival after the profile is saved, not
        * after the first saved recommendation** (9 Oct, the developer: the
        * popup "came up after the first contribution instead of after saving
        * the profile — fix it"). That reverses the client's 10 Sep gate
        * (*"The Invite button appears only after the first recommendation is
        * saved"*) for the popup too — the pill lost it on 15 Sep — and it is
        * hers to reverse back. It is also her 7 Sep instruction as first
        * written: the link arrives with the profile. The code it needs is
        * minted by the profile write, so a held profile (no code yet) still
        * shows nothing until the code exists.
        */}
      {session?.referral_code && !session.referral_shown_at && (
        <ReferralDialog
          code={session.referral_code}
          onClose={() =>
            update((s) => ({
              ...s,
              referral_shown_at: new Date().toISOString(),
            }))
          }
        />
      )}

      <ScreenBody className="pt-5">
        {/* `/share` was the one route in the app with no `<h1>` — the screen is
            a message thread, so it has no visible title and never should have
            one. Screen-reader-only is the whole fix: the document gets a name,
            and nothing on screen changes. */}
        <h1 className="sr-only">Share a recommendation</h1>

        <div className="space-y-2.5">
          {chat.messages.map((message) =>
            message.invite ? (
              <InviteMessage key={message.id} text={message.invite} />
            ) : message.card ? (
              <CardRecap
                key={message.id}
                submission={message.card}
                script={scriptOf(message.card)}
                held={holdsUntilVerified(session)}
                onRetry={
                  message.card.error
                    ? () => void persist(message.card as Submission)
                    : undefined
                }
                /* Only offered between cards — mid-card the dock is busy. */
                onEditField={
                  chat.mode === "menu"
                    ? (field) => startFieldEdit(message.card as Submission, field)
                    : undefined
                }
                /* Same gate as Edit, and for the same reason: mid-card the dock
                   belongs to the question on screen. */
                onToggleName={
                  chat.mode === "menu"
                    ? (next) => toggleName(message.card as Submission, next)
                    : undefined
                }
                firstName={session?.first_name ?? session?.name ?? null}
              />
            ) : (
              <Bubble
                key={message.id}
                role={message.role}
                text={message.text}
                aside={message.aside}
                skipped={message.skipped}
              />
            ),
          )}
          {typing && <TypingDots />}

          {/**
            * What Pando is saying, for a reader who cannot see the transcript.
            *
            * A live region has to be **in the document before its content
            * changes**, so this is always rendered and only its text moves —
            * which is precisely why the `aria-live` that used to sit on
            * `TypingDots` never fired: that element mounted together with its
            * one and only message.
            *
            * It carries only Pando's side. The transcript itself is not a live
            * region on purpose: it also holds the parent's own answers, which
            * they just gave and do not need read back, and the card recaps,
            * which are twenty lines each — announcing all of it on every turn
            * is noisier than announcing none of it.
            */}
          <p className="sr-only" role="status" aria-live="polite">
            {typing ? "Pando is typing" : lastFromPando}
          </p>

          <div ref={bottomRef} className="h-px" />
        </div>
      </ScreenBody>

      <ScreenDock>
        {typing ? (
          <div className="min-h-[60px]" />
        ) : chat.mode === "card" && draft?.followup ? (
          /**
           * A follow-up turn (9 Oct). A plain text field and two ways out,
           * because it is a *request* rather than a question the card depends
           * on — the answer it follows up is already recorded.
           *
           * "It's fine as it is" is deliberately as easy to reach as the input.
           * A follow-up a parent cannot decline stops being a follow-up and
           * becomes a required field, which is the opposite of what a two-minute
           * tap-first flow promised them.
           */
          <ConfirmBackWidget
            key={draft.id + draft.followup.step_id}
            question={draft.followup.question}
            onAnswer={answerFollowUp}
            onSkip={() => answerFollowUp("")}
            onStage={stageFollowUp}
          />
        ) : chat.mode === "card" && draft && script && step ? (
          <StepWidget
            key={`${draft.id}-${step.id}-${draft.editing ? "edit" : "ask"}`}
            /* The dock repeats the question — in the words the transcript used. */
            step={draft.editing ? step : { ...step, prompt: promptFor(step, draft.prompts, draft.fields) }}
            script={script}
            fields={draft.fields}
            stepIndex={draft.step_index}
            canUndo={canUndo && !draft.editing}
            editing={Boolean(draft.editing)}
            initialValue={
              draft.editing ? (draft.fields[step.id] as FieldValue) : undefined
            }
            onAnswer={answer}
            onSkip={() => answer(step.widget === "text" || step.widget === "phone" ? "" : [])}
            onStage={draft.editing ? undefined : stageStep}
            onUndo={undoLast}
            /* `place` only: which directory to search, and the parent's own
               town to rank by — a hint after relevance, never a filter. */
            market={session?.market_id ?? DEFAULT_MARKET_ID}
            area={session?.answers.neighborhood ?? null}
          />
        ) : (
          <ShareMenu
            scripts={scripts}
            onPick={startCard}
            onDone={doneForNow}
            savedCount={savedCount}
            heading={
              (chat.submissions ?? []).filter(
                (sub) => assessChatCard(sub.kind, sub.fields).status === "qualifies",
              ).length === 1
                ? "Add one more contribution"
                : undefined
            }
          />
        )}
        {/* One line mid-card: the widget is already the tallest thing on screen,
            and the privacy promise is carried by the step asides where it applies. */}
        <p className="py-2 text-center text-[12px] text-muted">
          {chat.mode === "card"
            ? "Autosaved as you go."
            : "Add as many as you like — one is genuinely useful."}
        </p>
      </ScreenDock>
    </Screen>
  );
}

function uid(): string {
  return crypto.randomUUID();
}

/**
 * The transcript scrolls the window on a phone and the framed card on desktop,
 * so pin whichever ancestor actually scrolls rather than aligning an anchor —
 * that also keeps the newest message clear of the sticky dock.
 */
function scrollToEnd(node: HTMLElement | null, behavior: ScrollBehavior) {
  if (!node) return;

  let parent = node.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      parent.scrollTo({ top: parent.scrollHeight, behavior });
      return;
    }
    parent = parent.parentElement;
  }

  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior,
  });
}
