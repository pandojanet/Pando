"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Keep a page's chosen filter or tab in the address bar.
 *
 * ## Why this exists
 *
 * Every queue in the admin held its filter in a bare `useState`, which meant
 * three things a person working the tool actually runs into. Reloading the page
 * threw the choice away and dropped them back on the default tab. A link to
 * "the eleven contributions that are missing a detail" could not be sent to
 * anybody, because the address did not say which tab was open. And the
 * Overview's own worklist could not point at a tab at all — it named a number
 * ("14 questions need a person") and then linked to a page that opened on a
 * different subset, so the figure the reader clicked and the list they landed
 * on were not the same set.
 *
 * The last one had already produced a **dead link**: `/admin/page.tsx` linked to
 * `/admin/activities?filter=golden`, and the contributions page did not read
 * search params at all, so the parameter was ignored and the reader was shown
 * "To review". That is the dead-payload fault this repository has already paid
 * for twice — a value sent to a screen that never reads it, where nothing looks
 * broken.
 *
 * ## Three rules
 *
 * **Local state stays authoritative and the URL mirrors it**, rather than the
 * other way round. Driving the render off `useSearchParams` would make every
 * tap on a pill wait for a navigation, and the admin layout is `async` (it
 * reads the session cookie), so that navigation is a server round trip for a
 * control that changes nothing on the server.
 *
 * **`replaceState`, never `pushState`.** A filter is not a place. With
 * `pushState` a reader who tried five tabs would have to press Back five times
 * to leave the page, which is the browser's own Back button behaving like the
 * page is broken. `replaceState` keeps Back meaning "the page I came from" —
 * usually the Overview whose worklist sent them here.
 *
 * **An unknown value falls back rather than refusing.** `?filter=nonsense` is a
 * stale bookmark or a typo, not an attack, and the honest answer is the default
 * tab and a working page. It is validated against the same list the pills are
 * built from, so a tab that is removed later cannot leave a link pointing at a
 * filter nothing can render.
 */
export function useUrlFilter<T extends string>(
  allowed: readonly T[],
  fallback: T,
  /** The query parameter's name. `filter` unless a page already reads another. */
  key = "filter",
): [T, (next: T) => void] {
  const params = useSearchParams();

  /* Read once, in the initialiser. Re-reading on every render would fight the
     `replaceState` below, which deliberately does not re-render anything. */
  const [value, setValue] = useState<T>(() => {
    const raw = params.get(key);
    return (allowed as readonly string[]).includes(raw ?? "")
      ? (raw as T)
      : fallback;
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      const url = new URL(window.location.href);
      /* The default tab leaves no parameter behind, so the address of a page
         somebody has not filtered is the plain one they would type. */
      if (next === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState(null, "", url);
    },
    [fallback, key],
  );

  return [value, set];
}
