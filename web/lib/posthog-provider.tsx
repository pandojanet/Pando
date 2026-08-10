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
 * Autocapture and session recording are off, and stay off — a deliberate
 * departure from PostHog's own defaults. This product's invariant 7 is "never
 * log phone numbers, names or free text; counts and enums only," and it doesn't
 * carve out an exception for third-party analytics. Autocapture would send DOM
 * attributes and input values off-app; session recording would send screen
 * content. Every event this app actually wants is already a named `track()` call
 * with structured props — see the `SeedEvent` union in `lib/analytics.ts`, none
 * of which carry free text.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  useEffect(() => {
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      // We capture pageviews ourselves on route change (below) — App Router
      // navigation doesn't reload the page, so PostHog's own on-load capture
      // would only ever see the first screen a parent lands on.
      capture_pageview: false,
      autocapture: false,
      disable_session_recording: true,
      // We don't need exit/bounce timing — one less background request per visit.
      capture_pageleave: false,
    });
    /* `lib/analytics.ts`'s `track()` predates this provider and was written
       against the snippet-install pattern, where PostHog's own bootstrap script
       sets `window.posthog`. The npm import here does not do that on its own —
       it's a module-scoped instance — so without this line every `track()` call
       would find `window.posthog` still undefined and silently do nothing. */
    window.posthog = posthog;
  }, [key]);

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
