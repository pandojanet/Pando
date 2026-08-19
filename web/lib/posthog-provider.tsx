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
    });
    /* `lib/analytics.ts`'s `track()` predates this provider and was written
       against the snippet-install pattern, where PostHog's own bootstrap script
       sets `window.posthog`. The npm import here does not do that on its own —
       it's a module-scoped instance — so without this line every `track()` call
       would find `window.posthog` still undefined and silently do nothing. */
    window.posthog = posthog;
  }, [key, recordScreens]);

  if (!key) return <>{children}</>;
  return <Provider client={posthog}>{children}</Provider>;
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
