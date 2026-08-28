"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { PandoMark } from "./Logo";

/**
 * Desktop-only pane beside the app (lg+). Renders nothing below lg.
 *
 * The Seed Tool is a phone product, so a wide viewport isn't used to stretch it —
 * it's used to hold the app steady in its frame and put context around it. That
 * context follows the flow: what this step is for, what's protected, and where the
 * parent is. On a phone none of it exists, and none of it is load-bearing.
 */

type PanelKey = "join" | "profile" | "share" | "finish" | "done" | "caregiver";

const STEPS: Array<{ key: PanelKey; label: string }> = [
  { key: "profile", label: "Your profile" },
  { key: "share", label: "What you know" },
  { key: "done", label: "Done" },
];

const PANELS: Record<
  PanelKey,
  { badge: string; title: React.ReactNode; lead: string; points: string[] }
> = {
  join: {
    badge: "Founding tool",
    title: (
      <>
        AI knows things.
        <br />
        <span className="text-gold">Pando knows someone.</span>
      </>
    ),
    lead: "This is where it starts: the first parents in each neighborhood putting in what they actually know — the classes worth the money, the camps worth the waitlist, the caregivers they'd hand their keys to.",
    points: [
      "Nothing here is published or searchable.",
      "Your name is never attached to a recommendation another parent sees.",
      /* Was "a caregiver you nominate is contacted for consent" — which the
         product deliberately does not do. Pando holds no way to reach them and
         never asks on your behalf (invariant 13, client's call 3 Aug); you send
         the invite yourself, and nothing about them is stored until they set up
         their own profile. Stale copy that promised the opposite. */
      "You invite a caregiver yourself — Pando never contacts them, and stores no way to.",
    ],
  },
  /**
   * 2C. A different reader with a different worry: not "will my recommendation be
   * useful" but "who is going to see this, and can I get out". So the three points
   * are the three things they are owed before answering anything.
   */
  caregiver: {
    badge: "For caregivers",
    title: (
      <>
        A family recommended you.
        <br />
        <span className="text-gold">Nothing is listed until you say so.</span>
      </>
    ),
    lead: "Pando is how parents here ask each other about care. Someone you've worked for put your name forward — this is you deciding what, if anything, a family gets to see.",
    points: [
      "Your number is never shown to a family, and never passed on without asking you first.",
      "Every permission is separate, and each one is a yes you can take back.",
      "Text DELETE at any point and the whole profile goes.",
    ],
  },
  profile: {
    badge: "Step 1 · About a minute",
    title: (
      <>
        An answer is only as good as
        <br />
        <span className="text-gold">the parent it came from.</span>
      </>
    ),
    lead: "This is what lets Pando send a question to the handful of parents whose lives actually look like yours — the same school run, the same budget, the same Saturday.",
    points: [
      "Only your neighborhood and your kids' ages are required.",
      "Everything else is one tap, or skip it.",
      "Autosaved as you go — close the tab and come back to it.",
    ],
  },
  share: {
    badge: "Step 2 · The part that matters",
    title: (
      <>
        Only you can answer
        <br />
        <span className="text-gold">this part.</span>
      </>
    ),
    lead: "Not the listing, not the star rating — the thing you'd actually text a friend. One recommendation is genuinely useful; add as many as you like.",
    points: [
      "Your name is never shown with what you share.",
      "A caregiver you nominate stays invisible until they personally consent.",
      "Every answer lands in its own field, so nothing gets lost in a wall of text.",
    ],
  },
  /* /done/ask still has two questions on it. The "done" panel congratulates them
     for finishing, which would be the rail contradicting the screen beside it. */
  finish: {
    badge: "Last step",
    title: (
      <>
        Two things left,
        <br />
        <span className="text-gold">then it&apos;s ours to carry.</span>
      </>
    ),
    lead: "One is your turn to ask — the question you'd actually want a straight answer to. The other is whether Pando may come back to you about what you shared.",
    points: [
      "Your answers are saved on this phone as you go.",
      "Follow-ups are capped at the number you set, and STOP works from the first text.",
      "Saying no to follow-ups doesn't affect your founding place.",
    ],
  },
  done: {
    badge: "Founding parent",
    title: (
      <>
        You&apos;re one of
        <br />
        <span className="text-gold">the roots now.</span>
      </>
    ),
    lead: "Pando answers from what parents like you put in. When your neighborhood goes live, that knowledge comes back to you first.",
    points: [
      "Founding Status is permanent — it never downgrades.",
      "A human reads every submission; messy answers get cleaned up, not guessed at.",
      "Caregivers are asked for consent before anyone sees them.",
    ],
  },
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
  const panel = PANELS[key];
  /* "finish" is not its own step in the rail — it's the last stretch of "Done", and
     giving it a fourth dot would tell the parent the flow just got longer. */
  const railKey = key === "finish" ? "done" : key;
  const activeStep = STEPS.findIndex((s) => s.key === railKey);

  return (
    <aside
      className={cn(
        "frame-scroll hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[21rem] lg:shrink-0 lg:flex-col",
        /* The rail grows on a wide window too. It carries real context, so giving
           it the room is using the space rather than padding the app column with
           it. */
        "lg:justify-between lg:overflow-y-auto lg:px-8 lg:py-10 xl:w-[25rem] xl:px-10 2xl:w-[29rem] 3xl:w-[34rem]",
        "lg:bg-moss lg:bg-[radial-gradient(120%_80%_at_10%_6%,var(--color-moss-lift)_0%,var(--color-moss)_55%,var(--color-moss-deep)_100%)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5 text-paper">
        <PandoMark className="h-6" tone="light" />
        <span className="font-display text-[1.1rem] font-bold tracking-[-0.02em]">
          Pando
        </span>
        {/* 11.5px is the smallest size in the type scale (the eyebrow). 10.5px was
            below the system's own floor for no reason other than fitting. */}
        <span className="rounded-full border border-gold/40 px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-gold">
          {panel.badge}
        </span>
      </div>

      <div className="py-8">
        <h2 className="font-display text-[1.8rem] font-extrabold leading-[1.08] text-paper xl:text-[2.1rem]">
          {panel.title}
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-paper-soft">
          {panel.lead}
        </p>

        <ul className="mt-7 space-y-3">
          {panel.points.map((point) => (
            <li
              key={point}
              className="flex gap-2.5 text-[14px] leading-snug text-paper-soft"
            >
              <CheckMark />
              {point}
            </li>
          ))}
        </ul>
      </div>

      {/* Where they are in the flow. The phone shows this as a progress bar in the
          header; on desktop there's room to name the steps. */}
      {activeStep >= 0 ? (
        <ol className="flex flex-wrap items-center gap-2.5 text-[12.5px]">
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
        <p className="text-[12.5px] leading-relaxed text-paper-faint">
          Pando Systems, Inc · Pasadena, CA ·{" "}
          <a
            href="mailto:hello@pando.is"
            className="text-paper-soft underline underline-offset-2"
          >
            hello@pando.is
          </a>
        </p>
      )}
    </aside>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 18 18"
      className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.2" opacity=".5" />
      <path
        d="M5.6 9.2 8 11.6l4.4-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
