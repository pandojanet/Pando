"use client";

import { useState } from "react";

/**
 * Show the first handful of a queue, and the rest on request.
 *
 * ## Why this exists, and it is not the paging that was turned down
 *
 * Every queue in the admin renders every row it has, and nobody had measured
 * what that costs until 4 Sep: **`/admin/audit` is 31,726 pixels tall** — about
 * thirty-five screens of one table, and by some distance the longest page here.
 * The developer's report was that the pages are hard to take in, and the first
 * three things anybody reaches for (tooltips, intros, explanatory prose) do not
 * touch this: the length is *rows*.
 *
 * ⚠ Measure at a real width. The first figures taken for this were read in a
 * Browser pane reporting `innerWidth: 0`, where every line wraps to one
 * character — they came out several times too large (audit "42,055"), they were
 * internally consistent, and nothing about them looked wrong.
 *
 * ⚠ **This is not the "load more" the 4 Sep audit decision declined**, and the
 * distinction is the whole reason it is allowed. That decision was about
 * *server* paging — *"paging means an offset and a stable sort key, which is a
 * read-layer change and not presentation"* — and it stands. Every row here has
 * already been fetched and is already in memory; all that changes is how many of
 * them are put in the document. No offset, no cursor, no second query, and the
 * count is honest because it is counting the array it holds.
 *
 * ## Two rules
 *
 * **It never hides the last few.** Revealing to save four rows costs a click and
 * buys nothing, so a list within `slack` of the limit renders whole — otherwise
 * a queue of twenty-eight would show twenty-five and a button.
 *
 * **It is one-way.** There is no collapsing again: somebody who opened a long
 * queue is working it, and taking the rows back is the page moving under them.
 * The next navigation is the reset.
 */
export function useReveal<T>(rows: readonly T[], limit = 25, slack = 5) {
  const [all, setAll] = useState(false);
  const whole = all || rows.length <= limit + slack;
  return {
    shown: whole ? rows : rows.slice(0, limit),
    hidden: whole ? 0 : rows.length - limit,
    revealAll: () => setAll(true),
  };
}

/**
 * The control, so every queue asks in the same words.
 *
 * It says how many rather than "show more", because the number is the thing a
 * reader is deciding on: seventeen more is a scroll, four hundred and
 * seventy-five is a different plan for the afternoon.
 */
export function RevealMore({ n, onClick }: { n: number; onClick: () => void }) {
  if (n <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border-t border-bark/70 px-4 py-3 text-[13.5px] font-medium text-green-deep hover:bg-paper/70"
    >
      Show the other {n} <span aria-hidden="true">↓</span>
    </button>
  );
}
