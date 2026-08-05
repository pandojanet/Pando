---
name: mobile-first-ui
description: Craft rules for phone-first web UI — thumb reach, tap targets, dynamic viewport height, iOS safe areas and keyboard behaviour, scroll containment, motion and performance budgets. Use when building or fixing any screen that will be used on a phone, when a layout jumps or the keyboard covers an input, or when deciding breakpoints and units.
---

# Mobile-first UI

This product is opened on a phone, one-handed, often with a child in the other
arm. Desktop is the afterthought, not the baseline. Build at **375px** and let
the layout relax upward; never design at 1440 and shrink.

## The five rules that matter most

1. **The primary action lives in a sticky bottom dock.** Top-right "Next" buttons
   are a desktop habit; on a 6.7" phone the top of the screen is out of thumb
   reach. Dock height ≥ 52px, `padding-bottom: max(1rem, env(safe-area-inset-bottom))`.
2. **44px is the floor, 48px is the norm.** Anything tappable, including icon-only
   buttons and remove "×" affordances. Text can be 15px inside a 48px target — the
   *target* is what must be big.
3. **Use `dvh`, never `vh`.** `100vh` is wrong the moment iOS Safari's toolbar
   collapses. `min-h-dvh` on the page shell, and let the dock be `sticky bottom-0`
   inside a flex column.
4. **Inputs are 16px minimum.** Anything smaller makes iOS Safari zoom the page on
   focus and the user never gets the zoom back cleanly. Set it in base CSS on
   `input, textarea, select` so no component can regress it.
5. **Kill the tap flash, then replace it.** `-webkit-tap-highlight-color: transparent`
   plus `touch-action: manipulation` (also removes the 300ms double-tap delay), and
   give every control a real press state (`active:scale-[0.97]`). Removing feedback
   without adding it back makes the app feel broken.

## Layout

```tsx
<div className="flex min-h-dvh flex-col bg-paper">
  <header className="sticky top-0 z-30 …/90 backdrop-blur-md pt-safe">…</header>
  <main className="flex-1 pb-8 pt-6">…</main>
  <div className="sticky bottom-0 z-30 …/95 backdrop-blur-md">…</div>
</div>
```

- One column, `max-w-[27rem] px-5`, centred. A 900px form on a laptop is worse
  than a phone-width one.
- `overflow-x: hidden` on `body` as a seatbelt, but treat any horizontal scroll as
  a bug to fix at the source (usually a fixed width or a long unbroken string).
- `overscroll-behavior-y: none` so pull-to-refresh doesn't fire mid-flow.
- Breakpoints: only add one when content demands it. This repo defines `xs: 25rem`
  purely so a chip grid can go 4→5 columns.
- Safe areas: `viewportFit: "cover"` in the `viewport` export, then pad with
  `env(safe-area-inset-*)` yourself. Cover without padding puts your button under
  the home indicator.

## Wide viewports: relayout, don't frame and don't stretch

A phone-first app on a 1440px screen should not become a 1440px app — but it also
should not be a **phone mock in a frame**. We built the frame version first and it
was worse to use than either alternative: a 27rem ribbon of content with its own
scrollbar, nested inside a page that couldn't scroll, while 60% of the screen held
decoration. Skeuomorphic device frames are a portfolio shot, not a tool.

What works, from the same markup:

1. **Widen the content column** (27rem → 40rem) so lists stop needing to scroll.
   A 20-chip list that took 10 rows and a scroll box on a phone fits in 5 rows.
2. **Let the window scroll.** One scroll container per page. A box inside a box is
   the single fastest way to make a desktop layout feel wrong.
3. **Drop the sticky dock into page flow** (`md:static`). A pinned action bar is a
   thumb-reach fix; with a mouse it just costs half the window. Opt back in per
   screen (`stickyOnDesktop`) where the CTA *is* the page.
4. **Use the space beside the app for context**, not for the app: a full-height
   sidebar with what this step is for, what's protected, and where they are in the
   flow. Below `lg` it doesn't render at all.

```tsx
// Phone: window scrolls, sticky header/dock. md+: wider column, action in flow.
// lg+: context sidebar beside it.
<div className="min-h-dvh bg-paper lg:flex lg:items-stretch">
  <BrandPanel />                                     {/* hidden lg:flex, sticky h-dvh */}
  <div className="flex min-h-dvh flex-col bg-paper lg:min-w-0 lg:flex-1">…</div>
</div>

// Container: mx-auto w-full max-w-[27rem] px-5 md:max-w-[40rem] md:px-8
```

Put all of it in the shared shell so every page inherits it and no page can drift.

**Content pages are the other case.** A marketing or legal page shouldn't be
framed like an app — but it also shouldn't be one narrow column floating in the
middle of 1440px. Give it a genuinely different desktop layout from the same
markup:

- Heading + intro become a **sticky left rail**; the content sits beside it.
  Stacks back to title → intro → content on a phone.
- **Cap the measure in rem, not fluid** — long text at 95 characters a line reads
  badly. Aim for 70–80 (`36rem` at 15.5px), and centre the rail+text pair so the
  page looks composed rather than left-anchored. Watch out for `ch` units: they
  resolve against the *container's* font size, not the paragraph's.
- Let a pull quote or card **step out into the margin** at `lg` (`-mx-10`) so a
  long read has rhythm.
- Ambient background gradients belong to desktop only — on a phone they just
  muddy the type.

## Keyboard

- Put free-text entry in a **bottom sheet**, not a centred modal: the field lands
  directly above the keyboard, where the thumb already is.
- Focus *after* paint (`requestAnimationFrame`) so the keyboard rises with the
  sheet instead of before it.
- Set `enterKeyHint` ("done" / "go" / "next") and the right `inputMode`
  (`tel`, `email`, `numeric`) — the keyboard should arrive already correct.
- Lock background scroll while a sheet is open (`body.style.overflow = "hidden"`,
  restored on cleanup), and close on `Escape` and on scrim tap.
- Never rely on `resize` heuristics to detect the keyboard. Design so it doesn't
  matter — but do re-pin a bottom-anchored view when the viewport changes:
  `window.visualViewport` fires on keyboard show/hide, plain `resize` on rotation.
  Without it, the thing the parent is answering can end up behind the dock.
- **Budget the dock.** Measure it on a 360×640 Android, not just a 390×844
  iPhone: header + dock should leave at least ~40% of the screen for content.
  A scrolling option list inside a dock needs both caps —
  `max-h-[min(32dvh,15rem)]` — because a dvh-only cap is fine at 844 and
  suffocating at 640.

## Interaction

- **No hover-only affordances.** Hover doesn't exist. Anything discoverable only
  on hover is invisible on the device that matters.
- **No drag, long-press, or swipe as the only path.** Fine as accelerators, never
  as the only way to do something.
- Scroll position resets to top on step change (`window.scrollTo({top: 0})`),
  otherwise step 3 opens halfway down.
- Optimistic and autosaved: assume the tab can be closed by a phone call at any
  moment. Persist after every tap, not on submit.

## Performance and stability

- Ship no icon library — inline the four SVGs the screen actually uses.
- Self-host fonts via `next/font` with `display: "swap"`; two families maximum,
  only the weights used.
- Reserve space for anything async so nothing shifts (CLS): render a skeleton with
  the final dimensions, never a spinner that collapses.
- Read `localStorage` in `useEffect`, never during render — server HTML can't know
  it, and a mismatch breaks hydration silently (the page renders but nothing
  responds to taps).

## Accessibility on a phone

- Real semantics: `role="radiogroup"`/`role="radio"` + `aria-checked` for
  single-select, `aria-pressed` for multi-select toggles, `role="progressbar"`
  with `aria-valuenow` for step progress.
- Visible focus for keyboard/switch-control users: `:focus-visible` with a gold
  2px ring, offset 2px — one global rule, not per component.
- Label every icon-only control (`aria-label="Back"`, `aria-label="Remove X"`).
- Don't disable zoom. No `maximum-scale=1`, no `user-scalable=no`.
- Colour is never the only signal: selected chips change fill *and* show a check.

## Quick self-check before calling a screen done

Run this in the browser console at 375×812:

```js
const de = document.documentElement;
({
  horizontalScroll: de.scrollWidth > de.clientWidth,
  smallTargets: [...document.querySelectorAll('button,a,input,[role=radio]')]
    .filter(el => { const h = el.getBoundingClientRect().height; return h > 0 && h < 44; })
    .map(el => el.textContent.trim().slice(0, 24) || el.tagName),
  smallInputs: [...document.querySelectorAll('input,textarea,select')]
    .filter(i => parseFloat(getComputedStyle(i).fontSize) < 16).length,
  dockAtBottom: document.querySelector('.sticky.bottom-0')?.getBoundingClientRect().bottom,
})
```

All four should come back clean: no horizontal scroll, no small targets, no small
inputs, dock bottom equal to viewport height.
