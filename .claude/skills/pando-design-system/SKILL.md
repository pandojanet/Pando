---
name: pando-design-system
description: Pando's visual and verbal design system — brand tokens, type scale, component recipes, and copy voice. Use whenever building, restyling, or reviewing any Pando UI (Seed Tool, web chat, admin), picking a colour or font size, writing user-facing copy, or when a screen "looks off" and you need the house rules.
---

# Pando design system

Pando is a text line for parents. Every surface should feel like it belongs next
to a message from a friend — warm paper, one confident green, gold used like a
highlighter. Not a SaaS dashboard, not a kids' app.

**Source of truth:** `web/app/globals.css` (`@theme` block). Never hard-code a hex
value in a component. If a colour isn't in the theme, it isn't in the product.

## Tokens

| Token                      | Value     | Use                                              |
| -------------------------- | --------- | ------------------------------------------------ |
| `paper`                    | `#F7F6F0` | Page background. Always. Never white pages.      |
| `card`                     | `#FFFFFF` | Raised surfaces, chips, inputs.                  |
| `bark` / `bark-soft`       | `#E6E2D4` | Borders and dividers. 1px, never 2px.            |
| `ink` / `ink-soft`/`muted` | `#223018` | Headings / body / secondary.                     |
| `green`                    | `#587A4A` | Marks, icons, active bar segments.               |
| `green-deep`              | `#3C5733` | Primary buttons, selected chips, links.          |
| `green-wash`              | `#EEF2E8` | Positive/reassurance notes.                      |
| `gold`                     | `#D9A31C` | Highlighter, focus ring, founding badge.         |
| `gold-wash`/`gold-line`/`gold-ink` | —  | Warnings, "other" chips, pending states.         |
| `alert`/`alert-wash`/`alert-line` | — | The only red, and **not a brand colour**. Reserved for what is owed a person *today*: an escalated flag, a high-stakes D1 question, a rejected record, an error line. Gold already means "pending" — if red starts meaning that too, neither means anything. Added 10 Aug, replacing three literal hexes that had been copy-pasted through `components/admin/*`, which is exactly what the rule above the table forbids and exactly the cost of breaking it: nothing else could reuse them. |
| `moss`                     | `#26331D` | Dark bands, sheet scrims.                        |

Rules that keep it coherent:

- **One accent per screen.** Green carries interaction; gold marks *specialness*
  (founding status, a highlighted phrase, a warning). Two golds on one screen and
  neither means anything.
- **Never a grey drop shadow.** Elevation is `shadow-card` — warm, low, wide.
- **Radii:** chips and buttons are pills (`rounded-full`); cards `rounded-3xl`;
  inputs `rounded-2xl`. Nothing sharp, nothing at 4px.
- **Borders over shadows** for anything inline. Shadow only for the one card the
  screen is about.

## Type

Two families, both already loaded via `next/font`:

- **Bricolage Grotesque** (`font-display`) — headings only. 600/700/800.
  `letter-spacing: -0.022em`, `line-height: 1.12`, `text-wrap: balance`.
- **Instrument Sans** (`font-sans`) — everything else. Body is 17px/1.55.

Scale actually used (phone-first, in `px` so it doesn't drift):

| Role              | Size          | Weight |
| ----------------- | ------------- | ------ |
| Landing h1        | `2rem–2.05rem` | 800    |
| Step title        | `1.7rem`      | 700    |
| Card heading      | `1.1–1.15rem` | 600    |
| Body              | `16.5px`      | 400    |
| Chip / control    | `15px`        | 500    |
| Help / secondary  | `14px`        | 400    |
| Eyebrow           | `11.5px`, `tracking-[0.15em]`, uppercase | 600 |
| Dock footnote     | `12.5px`      | 400    |

Don't invent sizes between these. If something needs to be smaller than 12.5px,
it needs to be cut instead.

## Component recipes

Reach for the existing primitives before writing new markup:

```
components/ui/Screen.tsx    Screen · Container · ScreenHeader · ScreenBody · ScreenDock · Eyebrow
components/ui/Button.tsx    primary | gold | secondary | ghost, min 52px tall
components/ui/Chip.tsx      Chip · CustomChip · AddOtherChip
components/ui/ChipGroup.tsx selection semantics, exclusive options, "other" sheet
components/ui/Progress.tsx  segmented step progress
components/ui/OtherSheet.tsx bottom sheet for free text
components/ui/PhoneField.tsx E.164-aware phone input
```

```
components/ui/Screen.tsx    …also carries the desktop relayout (md+ 40rem column,
                            action in page flow; lg+ context sidebar)
components/ui/BrandPanel.tsx the moss sidebar beside the app on lg+ —
                             route-aware: per-step headline, promises, step rail
components/seed/chat/*      Bubble · TypingDots · CardRecap · ShareMenu · StepWidget
```

The public site (pando.is) is a separate shell — a normal responsive website, not
the phone frame:

```
components/site/Shell.tsx    SiteShell · Wrap (wide|text|story) · Section · SectionGrid
                             SiteHeader (full|back) · SiteFooter · SiteButton · Eyebrow
components/site/DocShell.tsx the /privacy and /terms layout: sticky title rail + index
components/site/PhoneMock.tsx the hero conversation, CSS-only
```

`SectionGrid` is the site's desktop signature: heading and intro become a sticky
left rail (`lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]`) while the content
scrolls past. On a phone it collapses to title → intro → content. Use it for any
content section rather than centring a lone column.

Every screen is: `Screen > ScreenHeader + ScreenBody + ScreenDock`. One column,
`max-w-[27rem]`, `px-5`. The primary action always lives in the dock. On desktop
the same markup is framed as a card on moss — see `mobile-first-ui` for why.

Chat surfaces: Pando speaks in `bg-card` bubbles with a `border-bark` and a
squared bottom-left corner; the parent answers in `bg-green-deep` with a squared
bottom-right. Structured recaps are white cards with a `green-wash` header, and a
`gold-wash` footer whenever something is pending (caregiver consent). Gold on a
recap always means "not finished yet", never decoration.

Selected state is a **fill**, not a border change: `bg-green-deep text-white`.
Multi-select chips carry a circle→check tick so a parent knows they can pick
several *before* tapping.

## Motion

One easing (`--ease-soft`), short durations, and it always means something:

- Screen change: `animate-step-in` forward, `animate-step-in-back` on back.
- Content arriving: `animate-rise`. Something earned: `animate-pop` (badges).
- Sheets: `animate-sheet-up` + `animate-fade` scrim.
- Press feedback: `active:scale-[0.97]` on chips, `0.985` on buttons.

`prefers-reduced-motion` is globally honoured in `globals.css` — don't re-implement
it per component, and don't build anything whose meaning depends on animation.

**Never put a `position: fixed` element inside an animated wrapper.** All of these
keyframes end at `transform: none`, but a *filled* animation computes to the identity
matrix — which is still a transform, so the wrapper becomes the containing block and
the "full-screen" overlay is clipped to it forever. Modals and sheets render through
`createPortal(…, document.body)`; see `OtherSheet.tsx`.

Sheets are a phone idiom. From `md` a sheet becomes a centred dialog: `md:animate-rise`
instead of `md:animate-sheet-up`, all four corners rounded, the grab handle `md:hidden`,
actions right-aligned instead of a full-width primary.

## Copy voice

Pando's product promise is honesty about where knowledge comes from. The writing
carries that.

- **Plain, warm, specific.** "Two questions are required. Everything else is one
  tap, or skip it." Not "Complete your profile to continue."
- **Say the benefit to the parent**, not the mechanic to the system. "This is how
  Pando finds parents whose local world overlaps with yours" — not "used for
  matching".
- **Never overstate the data** (spec §6). Public info is never dressed as parent
  trust. Labels read the source, never who entered it.
- **No gamification.** No streaks, points, leaderboards, or "🎉 Great job!".
  The reward is better access, and the tone stays adult.
- Sentence case everywhere. Em dashes are fine. Exclamation marks are not.
- Errors state what happened and what's safe: "That didn't go through. Your
  answers are safe on this phone — try again."

## Definition of done for any Pando screen

1. Renders correctly at 375px wide with no horizontal scroll.
2. Every colour and font comes from the theme.
3. Primary action in a sticky dock, thumb-reachable, 52px tall.
4. Every tap target ≥ 44px (chips 48px).
5. Copy passes the voice rules above — read it aloud once.
6. Looks unremarkable and calm. If a screen is exciting, something is wrong.

Related: `mobile-first-ui` for device craft, `tap-first-flow` for questionnaire
mechanics.
