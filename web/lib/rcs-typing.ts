/**
 * "Pando is typing…" on an RCS phone while a reply is worked out (29 Oct).
 *
 * An answer takes 10–40 seconds to compose, and until now the person watched
 * nothing happen. Twilio's Typing Indicator API (v3, June 2026) shows the dots on
 * an RCS phone until our message is delivered or 20 seconds pass, so a long
 * reply needs the request repeated. This file is only the timing — when to show
 * the dots, how often, and when to stop. The request itself is made by
 * `lib/server/sms.ts` (invariant 6: no Twilio call anywhere else).
 *
 * The rules, and why:
 *
 * - **Only while that person's own text is answered.** `begin` opens a session
 *   for the number when its text arrived over RCS; the dots never start outside
 *   one, so nothing proactive ever shows them.
 * - **Not at once.** The first indicator waits `TYPING_DELAY_MS`: SETTINGS, an
 *   ADD step or a "yes" is answered within a second, and dots that flash before
 *   it — or arrive after it and hang for 20 seconds — are worse than none.
 * - **Stopped by the reply.** Sending a message to that number stops the loop
 *   before the message is posted, so no repeat follows the answer. `resume`
 *   starts it again inside the same session — the deep dive does, after "On it",
 *   for the minutes its search and writing take (`TYPING_DEEP_MAX_MS`).
 * - **Opt-out first.** Read before every request (so not at all when the reply is
 *   quick), so a STOP that arrives mid-answer ends the dots at the next renewal.
 * - **Bounded.** A loop repeats for at most its `maxMs`, and a refused request
 *   ends it rather than retrying.
 *
 * The dots change nothing about how long anything takes: they only show it.
 *
 * What it cannot do: take back dots already shown. A text answered with nothing
 * after more than 1.5 s leaves them up to Twilio's 20 seconds. And two texts from
 * one phone answered at once share one loop: the first reply ends it for both.
 *
 * Pure: no imports, the clock and the two calls are passed in, so the suite can
 * run it with short timings.
 */

export const TYPING_DELAY_MS = 1_500;
/** Under Twilio's 20 seconds, so the dots do not drop between two requests. */
export const TYPING_REPEAT_MS = 15_000;
/** An ordinary answer: classify, retrieve, search, write — well under this. */
export const TYPING_MAX_MS = 90_000;
/**
 * A deep dive after "On it": a search of up to 150 s, searched again when thin, and a
 * draft of up to 90 s — runs of 260 s and 484 s are on record (docs/status.md), so
 * ten minutes, not five.
 */
export const TYPING_DEEP_MAX_MS = 600_000;

export interface TypingDeps {
  /** One indicator request; true when Twilio accepted it. Never throws. */
  post: (to: string) => Promise<boolean>;
  isOptedOut: (to: string) => Promise<boolean>;
  delayMs?: number;
  repeatMs?: number;
  maxMs?: number;
  now?: () => number;
}

export interface Typing {
  /** Open a session for this number and start the dots; returns its end. */
  begin: (to: string) => () => void;
  /** Start the dots again inside an open session (no-op without one). */
  resume: (to: string, maxMs?: number) => void;
  /** Stop the dots for this number now (a message is about to go). */
  stop: (to: string) => void;
  /** How many numbers have dots scheduled — for the suite. */
  active: () => number;
}

export function createTyping(deps: TypingDeps): Typing {
  const delayMs = deps.delayMs ?? TYPING_DELAY_MS;
  const repeatMs = deps.repeatMs ?? TYPING_REPEAT_MS;
  const defaultMax = deps.maxMs ?? TYPING_MAX_MS;
  const now = deps.now ?? Date.now;
  type Run = { timer?: ReturnType<typeof setTimeout> };
  const runs = new Map<string, Run>();
  /* Open sessions per number, counted, so the first of two texts answered at once
     does not close the second's session (the loop itself they share). */
  const sessions = new Map<string, number>();

  const stop = (to: string) => {
    const run = runs.get(to);
    if (!run) return;
    clearTimeout(run.timer);
    runs.delete(to);
  };
  const end = (to: string, run: Run) => {
    if (runs.get(to) === run) stop(to);
  };
  const later = (run: Run, ms: number, fn: () => Promise<void>) => {
    run.timer = setTimeout(() => void fn(), ms);
    /* A pending indicator never keeps the process alive. */
    (run.timer as { unref?: () => void }).unref?.();
  };

  const loop = (to: string, maxMs: number) => {
    stop(to);
    const run: Run = {};
    const started = now();
    const tick = async () => {
      if (runs.get(to) !== run) return;
      if (await deps.isOptedOut(to).catch(() => true)) return end(to, run);
      /* A reply may have gone while the opt-out was read. */
      if (runs.get(to) !== run) return;
      const ok = await deps.post(to);
      if (!ok || runs.get(to) !== run || now() - started + repeatMs > maxMs) return end(to, run);
      later(run, repeatMs, tick);
    };
    runs.set(to, run);
    later(run, delayMs, tick);
  };

  const begin = (to: string) => {
    sessions.set(to, (sessions.get(to) ?? 0) + 1);
    loop(to, defaultMax);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      const left = (sessions.get(to) ?? 1) - 1;
      if (left > 0) sessions.set(to, left);
      else {
        sessions.delete(to);
        stop(to);
      }
    };
  };

  const resume = (to: string, maxMs = defaultMax) => {
    if (sessions.has(to)) loop(to, maxMs);
  };

  return { begin, resume, stop, active: () => runs.size };
}

/**
 * Whether an inbound text came over RCS, from Twilio's `ChannelMetadata` — a
 * JSON string whose `type` is `"rcs"` for an RCS message. Anything else,
 * missing or unreadable, is SMS.
 */
export function inboundChannel(channelMetadata: string | undefined): "rcs" | "sms" {
  if (!channelMetadata) return "sms";
  try {
    const parsed = JSON.parse(channelMetadata) as { type?: unknown } | null;
    return parsed && parsed.type === "rcs" ? "rcs" : "sms";
  } catch {
    return "sms";
  }
}

/**
 * The sender the indicator is sent from: `TWILIO_RCS_SENDER_ID` as the Console
 * shows it (with or without `rcs:`). Unset or malformed ⇒ no indicator at all,
 * which is how the feature is switched off.
 */
export function rcsSenderId(raw: string | undefined): string | null {
  const id = (raw ?? "").trim().replace(/^rcs:/i, "");
  return /^[A-Za-z0-9_.-]{1,128}$/.test(id) ? id : null;
}

/** The request body Twilio's documentation shows for RCS. */
export function typingRequest(sender: string, to: string) {
  return { channel: "RCS", from: `rcs:${sender}`, to: `rcs:${to}`, event: "START" };
}
