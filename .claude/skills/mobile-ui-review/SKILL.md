---
name: mobile-ui-review
description: Run a phone-first review pass on a Pando screen or flow — drive it in the browser at 375px, audit tap targets, overflow, fonts, focus and semantics, walk the happy path plus resume/error/gating cases, and report findings. Use when asked to check, QA, or verify how a screen looks and behaves on mobile, or before handing a flow to the client.
---

# Mobile UI review pass

A review is not "read the JSX and say it looks fine". Start the app, drive it,
measure it.

## 1. Get it running

```bash
npm --prefix web run dev
```

Prefer `preview_start` with the `pando-seed-web` config in `.claude/launch.json`,
then `resize_window` to the `mobile` preset (375×812). Start at the real entry
URL, not `/`:

```
http://localhost:3000/join?i=sgv-founding&src=qr
```

`read_page` gives you the accessibility tree — which is also the first finding: if
a control has no accessible name there, it has no name for a screen reader either.
Take a screenshot when the Browser pane is visible; when it isn't, fall back to
measuring (below) and say in the report that visual checks were done structurally.

## 2. Measure, don't eyeball

```js
const de = document.documentElement;
({
  horizontalScroll: [de.scrollWidth, de.clientWidth],
  smallTargets: [...document.querySelectorAll('button,a,input,[role=radio],[aria-pressed]')]
    .map(el => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0,24),
                  h: Math.round(el.getBoundingClientRect().height) }))
    .filter(x => x.h > 0 && x.h < 44),
  smallInputs: [...document.querySelectorAll('input,textarea,select')]
    .filter(i => parseFloat(getComputedStyle(i).fontSize) < 16).length,
  clipped: [...document.querySelectorAll('button,span,p,h1,h2')]
    .filter(el => el.scrollWidth > el.clientWidth + 1).length,
  dockBottom: document.querySelector('.sticky.bottom-0')?.getBoundingClientRect().bottom,
  fonts: [getComputedStyle(document.body).fontFamily,
          getComputedStyle(document.querySelector('h1')).fontFamily],
})
```

Expected: no horizontal scroll, `smallTargets` empty, `smallInputs` 0, nothing
clipped, `dockBottom === 812`, both custom fonts resolved (a fallback in the list
means the font never loaded).

Then check the console for hydration warnings — a hydration mismatch usually shows
up as a page that renders but ignores taps.

## 3. Walk the cases, not just the happy path

For a question flow, verify all of these and say which you checked:

- **Happy path** — entry → every screen → review → save → confirmation.
- **Required gating** — the dock button is disabled with nothing selected, and the
  hint says what to do.
- **Skip** — an optional screen skips forward and lands in `answers.skipped`.
- **Exclusive options** — "None / prefer not to say" clears the rest of *its own*
  group and no other group.
- **Conditional questions** — change the gating answer (child age), go forward, and
  confirm questions and chips re-evaluated rather than staying stale.
- **Other / free text** — sheet opens, focuses, submits, shows as a provisional
  chip, lands in `pending_options`, and Escape/scrim closes without saving.
- **Autosave & resume** — reload mid-flow; answers survive; the entry screen offers
  resume rather than silently jumping in.
- **Error path** — make the save fail (stop the server or point the webhook at a
  dead URL): the message is human, answers are not lost, retry works.
- **Invalid entry** — a wrong invite code shows the gate, a good one recovers.

Read the persisted state directly when checking data:
`JSON.parse(localStorage.getItem('pando.seed.v1'))`.

For controlled React inputs, set values the way React sees them:

```js
const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
set.call(input, 'Sierra Vista Co-op');
input.dispatchEvent(new Event('input', { bubbles: true }));
```

Use `javascript_tool` for inspection and driving a test walkthrough — never to fix
a UI problem. Fixes go in the source.

## 4. Check the server side of the screen

`preview_logs` (or the dev terminal): the request should log **counts, not people**
— no phone numbers, names, or free text anywhere (spec §19). A log line with a
phone number in it is a finding, and a serious one.

## 5. Report

Group findings as **blocking / should fix / nit**, each with the file and line, the
concrete symptom ("chip at 41px on the ages grid", not "targets feel small"), and
say plainly what you could not verify — real iOS Safari, real device fonts, actual
QR scanning, and anything needing a live backend.

Related: `mobile-first-ui` for the rules being checked, `pando-design-system` for
the visual ones.
