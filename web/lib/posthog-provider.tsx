"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";

/**
 * The other half of estimate 3.1 — `lib/analytics.ts` has always called
 * `window.posthog?.capture(...)`, but nothing ever set `window.posthog`. This is
 * that init, gated the same way the rest of the app treats an unconfigured
 * integration: unset `NEXT_PUBLIC_POSTHOG_KEY` means no client is created and
 * `track()`'s `window.posthog?.capture` stays a no-op, same as `persisted: false`
 * without a `DATABASE_URL`.
 *
 * Autocapture is off and stays off — a deliberate departure from PostHog's own
 * defaults. Session recording is off by *default* and can be switched on for QA
 * with `NEXT_PUBLIC_POSTHOG_SESSION_RECORDING=1`; it must be off again before the
 * first real founding contributor (see the comment on the flag below).
 *
 * This product's invariant 7 is "never log phone numbers, names or free text;
 * counts and enums only," and it doesn't carve out an exception for third-party
 * analytics. Autocapture would send DOM attributes and input values off-app;
 * session recording sends screen content, which is why it is a dated, deadlined
 * exception rather than a setting. Every event this app actually wants is already a named `track()` call
 * with structured props — see the `SeedEvent` union in `lib/analytics.ts`, none
 * of which carry free text.
 */
/**
 * How long a gap in activity ends a session, and therefore ends a recording.
 *
 * PostHog's own default is 30 minutes, and its absolute ceiling is 24 hours from
 * the session's *start* — so one session id can legitimately span a whole day,
 * and a replay of it spans the same. That is useless here: the seed flow takes
 * about two minutes, so a recording measured in hours is a tab somebody left
 * open, not a parent we can learn anything from.
 *
 * Ten minutes is the client's number. The mechanism is worth knowing, because it
 * is better than "the next event starts a new session": posthog-js runs a timer
 * at 1.1x this value, and when it fires on an idle session it resets the session
 * id and emits `forcedIdleReset`, which the recorder listens for. So an idle tab
 * rotates on its own, with no event needed to trigger it.
 */
const SESSION_IDLE_MINUTES = 10;

/**
 * And a ceiling on an *active* session, which the idle timeout cannot give.
 *
 * Somebody who touches the page every few minutes for three hours never goes
 * idle, so nothing above splits their recording — posthog-js would carry it to
 * its own 24-hour cap. There is no config option for this, so we do it
 * ourselves: once a session id has been alive this long, reset it and start a
 * new one.
 */
const SESSION_MAX_MINUTES = 30;

/** Our own record of when the current session id first appeared. */
const SESSION_START_KEY = "pando.ph_session_start";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  /**
   * QA-only screen recording, off unless explicitly switched on — see the block
   * comment above and CLAUDE.md's dated decision. Read here rather than inlined
   * below so the one switch that changes what leaves a parent's phone is named
   * in one place.
   */
  const recordScreens = process.env.NEXT_PUBLIC_POSTHOG_SESSION_RECORDING === "1";

  useEffect(() => {
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      // We capture pageviews ourselves on route change (below) — App Router
      // navigation doesn't reload the page, so PostHog's own on-load capture
      // would only ever see the first screen a parent lands on.
      capture_pageview: false,
      autocapture: false,
      /* Off by default, and that default is the product's position (invariant 7:
         never log names or free text — replay ships the whole screen). It is a
         switch rather than a constant for one reason: the client walks this flow
         herself before any real parent does, and "where did she get stuck" is not
         answerable from named events alone.

         What it costs while it is on, because it is not nothing: this flow puts
         a child's birth year, their school, the neighborhood and free text about
         a named caregiver on screen, and the review stage, the chat transcript
         and /done all render *every earlier answer at once* — so there is no
         "safe screen" to start from and no partial version of this. It comes out
         on the same deadline as SEED_VERIFY_DEV_CODES and the `pando` starter
         password: before the first real founding contributor. */
      disable_session_recording: !recordScreens,
      // We don't need exit/bounce timing — one less background request per visit.
      capture_pageleave: false,
      /* See SESSION_IDLE_MINUTES. Clamped by posthog-js to [60, 36000] seconds,
         so this value is inside the supported range rather than silently
         falling back to the 1800 default. */
      session_idle_timeout_seconds: SESSION_IDLE_MINUTES * 60,
    });
    /* `lib/analytics.ts`'s `track()` predates this provider and was written
       against the snippet-install pattern, where PostHog's own bootstrap script
       sets `window.posthog`. The npm import here does not do that on its own —
       it's a module-scoped instance — so without this line every `track()` call
       would find `window.posthog` still undefined and silently do nothing. */
    window.posthog = posthog;
  }, [key, recordScreens]);

  useSessionLengthCap(Boolean(key));

  if (!key) return <>{children}</>;
  return <Provider client={posthog}>{children}</Provider>;
}

/**
 * Ends a session that has been running too long, however active it is.
 *
 * `session_idle_timeout_seconds` only fires on a *gap*. A parent who is on the
 * page on and off all afternoon never has one, so their recording keeps growing
 * — which is how a replay ends up measured in hours for a flow that takes two
 * minutes. posthog-js has no max-session-length option, so this is the ceiling.
 *
 * Two things worth not "simplifying":
 *
 * **The start time is in `sessionStorage`, not a ref.** A reload would reset a
 * ref and the cap would never fire on anyone who refreshes — which is exactly
 * the long-lived tab this exists for. `sessionStorage` is per-tab and survives a
 * reload, which is the right scope: a genuinely new tab *is* a new visit.
 *
 * **It is keyed by session id.** posthog-js rotates the id for its own reasons
 * (idle, its 24-hour cap, a cross-tab refresh). Storing a bare timestamp would
 * mean the next session inherits the previous one's clock and gets cut short.
 */
function useSessionLengthCap(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      if (!posthog.__loaded) return;
      const id = posthog.get_session_id();
      if (!id) return;

      let startedAt = 0;
      try {
        const raw = window.sessionStorage.getItem(SESSION_START_KEY);
        const saved = raw ? (JSON.parse(raw) as { id?: string; at?: number }) : null;
        if (saved?.id === id && typeof saved.at === "number") startedAt = saved.at;
      } catch {
        /* Private mode, or a value from an older build. Treat as unknown and
           re-stamp below rather than failing — this is analytics, not the app. */
      }

      if (startedAt === 0) {
        try {
          window.sessionStorage.setItem(
            SESSION_START_KEY,
            JSON.stringify({ id, at: Date.now() }),
          );
        } catch {
          /* Nothing to do: without storage the cap cannot be enforced, and a
             broken cap must not break the page. */
        }
        return;
      }

      if (Date.now() - startedAt >= SESSION_MAX_MINUTES * 60_000) {
        /* Public and typed on the client (`sessionManager?: SessionIdManager`).
           Resetting the id is what the recorder watches for, so this starts a
           fresh recording rather than merely relabelling events. */
        posthog.sessionManager?.resetSessionId();
        try {
          window.sessionStorage.removeItem(SESSION_START_KEY);
        } catch {
          /* see above */
        }
      }
    };

    check();
    /* A minute is fine: the cap is 30, so the worst case is a session running
       31 minutes rather than 30. Cheap, and no listener on user activity —
       nothing here should add work to a tap. */
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
}

/**
 * Fires a `$pageview` on every route change. Wrapped in Suspense because
 * `useSearchParams` opts the tree under it out of static rendering otherwise —
 * scoped to this one component so it doesn't force the public site's static
 * pages (`/`, `/about`, …) to become dynamic.
 */
export function PostHogPageview() {
  return (
    <Suspense fallback={null}>
      <PageviewTracker />
    </Suspense>
  );
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthog.__loaded) return;
    const query = searchParams.toString();
    posthog.capture("$pageview", {
      $current_url: query ? `${pathname}?${query}` : pathname,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return null;
}
