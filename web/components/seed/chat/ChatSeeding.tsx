"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wordmark } from "@/components/ui/Logo";
import {
  Screen,
  ScreenBody,
  ScreenDock,
  ScreenHeader,
} from "@/components/ui/Screen";
import { track, trackAbandonOnHide } from "@/lib/analytics";
import { saveSubmission } from "@/lib/api-client";
import {
  buildSubmission,
  formatAnswer,
  isEmptyValue,
  newDraft,
  nextIndex,
} from "@/lib/seed-chat/engine";
import { buildScripts } from "@/lib/seed-chat/scripts";
import type {
  ChatMessage,
  ChatState,
  FieldValue,
  Fields,
  ShareKind,
  Submission,
} from "@/lib/seed-chat/types";
import { caregiverInviteMessage } from "@/lib/caregiver-invite";
import { loadSession, newSession, saveSession } from "@/lib/storage";
import { holdsUntilVerified } from "@/lib/submit";
import type { SeedSession } from "@/lib/types";
import { Bubble, CardRecap, TypingDots } from "./Bubble";
import { InviteMessage } from "./InviteMessage";
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
export function ChatSeeding() {
  const router = useRouter();
  const [session, setSession] = useState<SeedSession | null>(null);
  const [typing, setTyping] = useState(false);
  const initialized = useRef(false);
  const timers = useRef<number[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  const scripts = useMemo(
    () => buildScripts(session?.market_id ?? "pasadena"),
    [session?.market_id],
  );

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const existing =
      loadSession() ??
      newSession({ invite_code: null, market_id: "pasadena", source: "direct" });

    let chat: ChatState =
      existing.chat ??
      {
        mode: "menu",
        draft: null,
        submissions: [],
        messages: [
          {
            id: uid(),
            role: "pando",
            text: existing.name
              ? `Thanks, ${existing.name}. Now the part only you can answer.`
              : "Now for the part only you can answer.",
            aside:
              "One thing at a time, mostly taps. Add as many as you like — or just one.",
          },
          {
            /* The reuse disclosure the client's question set opens Part 2A with.
               Said once, before the first question, not buried in a footer. */
            id: uid(),
            role: "pando",
            text: "Pando may summarize and reuse what you share in future answers, using only the privacy settings you chose.",
            aside:
              "We never reveal your identity or private affiliations without permission.",
          },
          {
            id: uid(),
            role: "pando",
            text: "What would you like to share first — an activity or class your kids loved, a camp, a caregiver, or a local tip?",
          },
        ],
      };

    /* A draft pointing at a step that no longer exists — the scripts grew between
       the parent's last visit and this one — leaves the chat in "card" mode with no
       card: no question, no dock, nothing to do. Drop it and show the menu. The
       answers in that draft are lost either way; what matters is not stranding them
       on a dead screen. */
    if (chat.draft) {
      const steps = scripts[chat.draft.kind]?.steps;
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

  const withTyping = useCallback((fn: () => void, ms = 430) => {
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
  const draft = chat?.draft ?? null;
  const script = draft ? scripts[draft.kind] : null;
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

  /* ── Turn taking ──────────────────────────────────────────────── */

  function pushPrompt(kind: ShareKind, fields: Fields, index: number) {
    const nextStep = scripts[kind].steps[index];
    patchChat((c) => ({
      ...c,
      mode: "card",
      draft: { ...(c.draft ?? newDraft(kind)), kind, fields, step_index: index },
      messages: [
        ...c.messages,
        { id: uid(), role: "pando", text: nextStep.prompt, aside: nextStep.aside },
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
      withTyping(() => pushPrompt(kind, {}, first), 520);
    });
  }

  /**
   * Tapping a row on a finished card re-asks that one step, seeded with the answer
   * already on record. It's the only way to correct a mistake after saving — the
   * alternative was re-doing the whole card.
   */
  function startFieldEdit(submission: Submission, field: string) {
    const editScript = scripts[submission.kind];
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
        editing: { submission_id: submission.id, step_id: field },
      },
      messages: [
        ...c.messages,
        {
          id: uid(),
          role: "parent",
          text: `Edit: ${editScript.recap.find((r) => r.field === field)?.label ?? field}`,
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
            aside: `It currently says “${formatAnswer(editStep, submission.fields[field] as FieldValue)}”.`,
          },
        ],
      })),
    );
  }

  /** Applying a correction: update the saved card in place, then re-save it. */
  function applyFieldEdit(value: FieldValue) {
    if (!draft?.editing || !step || !chat) return;
    const { submission_id, step_id } = draft.editing;

    const existing = chat.submissions.find((s) => s.id === submission_id);
    if (!existing) return;

    // Built outside the state updater: React may run an updater twice, so it has
    // to stay pure.
    const updated: Submission = {
      ...existing,
      fields: { ...draft.fields, [step_id]: value },
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

  function answer(value: FieldValue) {
    if (!draft || !script || !step) return;

    if (draft.editing) {
      applyFieldEdit(value);
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
      ...(hold ? { review_hold: "true", hold_reason: step.id } : {}),
    };
    if (hold) track("seed_card_review_hold", { kind: draft.kind, step: step.id });
    track(isEmptyValue(value) ? "seed_card_step_skipped" : "seed_card_step_answered", {
      kind: draft.kind,
      step: step.id,
    });

    patchChat((c) => ({
      ...c,
      draft: { ...draft, fields, step_index: draft.step_index },
      messages: [...c.messages, parentMessage],
    }));

    const upcoming = nextIndex(script, fields, draft.step_index + 1);
    withTyping(() => {
      if (hold) {
        patchChat((c) => ({
          ...c,
          messages: [...c.messages, { id: uid(), role: "pando", text: hold }],
        }));
        withTyping(() => {
          if (upcoming < 0) finishCard(draft.kind, draft.id, fields);
          else pushPrompt(draft.kind, fields, upcoming);
        }, 520);
        return;
      }
      if (upcoming < 0) finishCard(draft.kind, draft.id, fields);
      else pushPrompt(draft.kind, fields, upcoming);
    });
  }

  function finishCard(kind: ShareKind, draftId: string, fields: Fields) {
    const submission = buildSubmission({ id: draftId, kind, fields, step_index: 0 });

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
          text:
            kind === "caregiver"
              ? "Thank you — that's the hardest kind to get right. Nothing about them is stored until they set up their own profile and say yes."
              : "Got it, thank you. Anything else you'd pass on?",
        },
        // C11: the invite is the parent's to send, so it appears here as text to
        // copy rather than as something Pando promises to do.
        ...(kind === "caregiver" && fields.send_invite === "yes"
          ? [
              {
                id: uid(),
                role: "pando" as const,
                invite: caregiverInviteMessage({
                  caregiverFirstName: Array.isArray(fields.name)
                    ? String(fields.name[0])
                    : null,
                  parentFirstName: session?.first_name ?? session?.name ?? null,
                }),
              },
            ]
          : []),
      ],
    }));

    void persist(submission);
  }

  async function persist(submission: Submission) {
    if (!session) return;
    /* Founding path: the card stays on this phone until the parent confirms their
       code on the completion screen, then goes up with everything else. The footer
       already says exactly that — "Kept on this phone until you finish." */
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
          fields: submission.fields as Record<string, unknown>,
          created_at: submission.created_at,
        },
      });
      markSubmission(submission.id, { persisted: result.persisted, error: false });
      track("seed_card_saved", {
        kind: submission.kind,
        persisted: result.persisted,
      });
    } catch {
      markSubmission(submission.id, { persisted: false, error: true });
      track("seed_card_save_failed", { kind: submission.kind });
    }
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
    const stepIndex = script.steps.findIndex((s) => s.id === lastParent.step_id);
    if (cutAt < 0 || stepIndex < 0) return;

    const fields: Fields = { ...draft.fields };
    delete fields[lastParent.step_id];

    patchChat((c) => ({
      ...c,
      // The prompt for that step sits just above, so it stays on screen.
      messages: c.messages.slice(0, cutAt),
      draft: { ...draft, fields, step_index: stepIndex },
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

  return (
    <Screen>
      {/* No running "N cards ready" counter: the saved cards are already on the
          screen as recaps, so the pill only repeated what the parent could see —
          and a count in the header edges towards scorekeeping. */}
      <ScreenHeader left={<Wordmark />} />

      <ScreenBody className="pt-5">
        <div className="space-y-2.5">
          {chat.messages.map((message) =>
            message.invite ? (
              <InviteMessage key={message.id} text={message.invite} />
            ) : message.card ? (
              <CardRecap
                key={message.id}
                submission={message.card}
                script={scripts[message.card.kind]}
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
          <div ref={bottomRef} className="h-px" />
        </div>
      </ScreenBody>

      <ScreenDock>
        {typing ? (
          <div className="min-h-[60px]" />
        ) : chat.mode === "card" && draft && script && step ? (
          <StepWidget
            key={`${draft.id}-${step.id}-${draft.editing ? "edit" : "ask"}`}
            step={step}
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
            onUndo={undoLast}
          />
        ) : (
          <ShareMenu
            scripts={scripts}
            onPick={startCard}
            onDone={doneForNow}
            savedCount={savedCount}
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
