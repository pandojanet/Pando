"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * The one-line moss bar above the app on desktop (lg+). Renders nothing below lg.
 *
 * ## What this was, and what collapsing it cost
 *
 * Until 10 Sep this was a **21–34rem full-height rail** carrying a headline, a
 * lead paragraph and three reassurance points per step, plus the named step rail.
 * The client's instruction: *"Mobile is the primary experience and the desktop
 * panel currently consumes space… Collapse the desktop panel to a one-line
 * header."*
 *
 * ⚠ **Six panels of approved copy went with it and are not anywhere else in the
 * product.** Some of it was load-bearing rather than decorative — the caregiver
 * rail's three promises ("your number is never shown to a family", "every
 * permission is separate", "text DELETE and the whole profile goes") were a
 * caregiver's only statement of those things *before* they answered anything,
 * and 2C's own screens repeat only the last. It is recoverable from git
 * (`components/ui/BrandPanel.tsx`, before this change) if she wants any of it
 * back; the honest place for it would be the screen itself rather than a rail,
 * since a phone never showed it.
 *
 * ⚠ **The measured premise did not hold and is worth recording**: at 390px this
 * rail was already `display: none` and 0px wide, so it never consumed a pixel of
 * the mobile experience. What it consumed was the *desktop* column, and that is
 * what this returns.
 *
 * What is left is the two things a parent read rather than was sold: which step
 * this is, and where they are in the flow.
 */

type PanelKey = "join" | "profile" | "share" | "finish" | "done" | "caregiver";

const STEPS: Array<{ key: PanelKey; label: string }> = [
  { key: "profile", label: "Your profile" },
  { key: "share", label: "What you know" },
  { key: "done", label: "Done" },
];

/* Badge only. `title`, `lead` and `points` are gone rather than left unread —
   a payload nothing renders is the fault this repository has already paid for
   three times, and keeping them would make the next reader think the rail is
   still there. */
const BADGES: Record<PanelKey, string> = {
  join: "Founding tool",
  caregiver: "For caregivers",
  /* "About 2 minutes" is the client's own number (10 Sep) and it is now the
     honest one: the required path is two questions, so the old "about a minute"
     described the flow before the optional detail was folded behind a fork and
     was optimistic about the flow after it. */
  profile: "Step 1 · About 2 minutes",
  share: "Step 2 · Share what you know",
  finish: "Last step",
  done: "Founding Contributor",
};

function panelFor(pathname: string): PanelKey {
  /* First, because the fallback below is the parent's founding pitch — on the
     caregiver flow that panel would address the wrong person and promise them a
     status they cannot have. */
  if (pathname.startsWith("/caregiver")) return "caregiver";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/share")) return "share";
  // Before the bare /done check — it is a prefix of this one.
  if (pathname.startsWith("/done/ask")) return "finish";
  if (pathname.startsWith("/done")) return "done";
  return "join";
}

export function BrandPanel() {
  const key = panelFor(usePathname());
  const badge = BADGES[key];
  /* "finish" is not its own step in the rail — it's the last stretch of "Done", and
     giving it a fourth dot would tell the parent the flow just got longer. */
  const railKey = key === "finish" ? "done" : key;
  const activeStep = STEPS.findIndex((s) => s.key === railKey);

  return (
    <div
      /* Still an `aside` in role but no longer a landmark worth naming: one line
         of context is not a region anybody navigates to, and an unnamed banner
         above every screen is one more stop between a keyboard and the content
         the `SkipLink` exists to reach. */
      className={cn(
        "hidden lg:flex lg:items-center lg:justify-between lg:gap-6",
        "lg:px-8 lg:py-3 xl:px-10",
        "lg:bg-moss lg:bg-[radial-gradient(120%_400%_at_10%_50%,var(--color-moss-lift)_0%,var(--color-moss)_55%,var(--color-moss-deep)_100%)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5 text-paper">
        {/* The one piece of the old rail that is still doing work on this line:
            it names the step, which is the only thing on that panel a parent was
            reading rather than being sold.

            ⚠ **No `Wordmark` here, and its absence is the fix rather than an
            omission.** While this was a 21rem side rail its lockup sat *beside*
            the app column's own header, and the two read as a frame. Collapsed
            to a bar it sits directly *above* that header, so from `lg` every
            flow screen carried two Pando lockups stacked — measured on `/join`
            at 1440x900: two visible lockups inside 245px of stacked chrome
            (52px bar + 69px header + 124px dock), 27% of the window.

            Hiding the *header's* lockup instead was the obvious fix and is
            worse: on five of the nine flow screens (`/share`, `/done`,
            `/done/next`, `/done/ask`, `/signin`) the header's left slot holds
            nothing else, so it would leave an empty 69px sticky band. This way
            the logo stays in one place at every width — which is what
            `/profile` has always done, its header having never carried one. */}
        <span className="shrink-0 rounded-full border border-gold/40 px-2.5 py-1 font-semibold uppercase text-eyebrow tracking-eyebrow text-gold">
          {badge}
        </span>
      </div>

      {/* Where they are in the flow. The phone shows this as a progress bar in
          the header; on one line there is still room to name the steps, and it
          is the half of the old rail worth keeping. */}
      {activeStep >= 0 ? (
        <ol className="flex shrink-0 items-center gap-2.5 text-dock">
          {STEPS.map((step, i) => (
            <li key={step.key} className="flex items-center gap-2.5">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-5",
                    i <= activeStep ? "bg-gold/60" : "bg-paper/20",
                  )}
                />
              )}
              <span
                className={cn(
                  "flex items-center gap-2 font-medium",
                  i === activeStep
                    ? "text-gold"
                    : i < activeStep
                      ? "text-paper-soft"
                      : "text-paper-faint",
                )}
                aria-current={i === activeStep ? "step" : undefined}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    i === activeStep
                      ? "bg-gold"
                      : i < activeStep
                        ? "bg-paper-soft"
                        : "bg-paper-faint",
                  )}
                />
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="shrink-0 text-dock leading-relaxed text-paper-faint">
          Pando Systems, Inc · San Gabriel Valley, CA
        </p>
      )}
    </div>
  );
}
