# Pane states: JSON maximize, edit-pane bar, syn-panel quick-hide

**Date:** 2026-07-10 · **Status:** approved (owner, in-session) · **Branch:** claude/pane-states-theme-syntax

## Problem

1. The JSON pane cannot reach full width: `sideMax()` (main.ts) always
   reserves ~420px of canvas, for both drag and window-resize clamping.
   The owner wants one click — or a drag — to take the pane over the
   canvas *and* the data bar.
2. The Left Edit Pane is a fixed 360px (`--wb-leftpane-w`), not
   resizable, not collapsible. It should minimize to a slim bar and be
   drag-widenable, like the JSON pane.
3. Panes should each carry a *state* (mode + remembered size) and return
   to it when reopened.
4. The syntax color mapper (PR E #273) can only be dismissed by
   reopening the JSON kebab → "Syntax colors…". It needs a close-in-place
   affordance.
5. "Syntax colors don't flip with theme" — PR E (#273) shipped per-theme
   defaults **and** per-theme user overrides, but the owner's report was
   still real: the sub-token slots were `var()` aliases on `:root`, and a
   custom property substitutes its `var()`s where it is *declared*
   (`<html>`) — so the aliases baked light values in before
   `body.wb-dark` could retheme what they point at. Operators, strings,
   functions and numbers inside expressions rendered light-theme colors
   in dark mode. Fix (verified live in both themes): the slots hold
   explicit hex in **both** theme blocks; the storage/override
   architecture is untouched.

## Owner decisions (2026-07-10)

- Drag past the 420px-canvas floor **snaps to full width** (with
  hysteresis) — the canvas is never left in a squished half-state.
- Maximize control: **⛶ button in the JSON pane header + double-click
  on the drag handle** (mirrors the data dock's ⛶).
- Minimized edit pane: **~28px vertical strip, vertical "Edit" label,
  click anywhere to restore**; double-click on its drag handle also
  toggles, for symmetry.

## Architecture

New pure-decisions module **`src/editor/paneLayout.ts`** (house pattern:
pure logic, shell owns the DOM), consumed by main.ts:

- `SideMode = 'normal' | 'max'`, `LeftMode = 'normal' | 'bar'`.
- `clampLeftW(w, layoutW)` — the edit pane's drag band.
- `sideMaxW(layoutW, leftColW)` — the normal-mode width ceiling (the
  420px canvas reserve, as today).
- `dragSide(proposedW, maxW, currentMode)` — snap hysteresis: enter
  `max` when the pointer overshoots the ceiling by the snap margin
  (40px), return to `normal` once it comes back under the ceiling, pin
  at the ceiling in between.
- `gridTemplate(view)` — the `grid-template-columns` string plus
  visibility flags (center hidden when maximized; which resizers show).

### State (persisted)

Additive fields in the frozen `wb-ui-prefs` blob (precedent: `canvasZoom`):

- `sideMode: 'normal' | 'max'` (default `'normal'`)
- `leftMode: 'normal' | 'bar'` (default `'normal'`)
- `leftW: number` (default 360)

Mode and remembered size are independent: maximizing never overwrites
`cols.side`; minimizing never overwrites `leftW`. Closing/reopening a
pane (topbar JSON toggle) restores both. Legacy blobs get defaults via
the existing spread.

### Layout

Grid children become: left pane · left resizer · center · side resizer ·
side pane. Hidden members use `display:none` (grid skips them), so the
template always matches the visible children:

- JSON closed: `leftCol 5px 1fr`
- JSON open, normal: `leftCol 5px 1fr 5px ${side}px`
- JSON open, maximized: `leftCol 5px 1fr` — center hidden, **side
  resizer stays** (drag-out + double-click restore), left resizer hides.
- Left bar mode: `leftCol` = 28px and the left resizer hides (its 5px
  track drops out of every template above).

### Interactions

- ⛶ (JSON header, next to kebab) toggles `sideMode`; double-click on the
  side resizer does the same; drag snaps per `dragSide`.
- Edit pane header gets a collapse chevron (shell-injected, absolutely
  positioned — leftPane.ts stays untouched); the bar strip restores on
  click; double-click the left resizer toggles the bar.
- Syn panel: × in its header row closes; Esc closes while it is visible
  (capture-phase listener active only while open); kebab item still
  toggles.

### Edge cases

- `<900px` stacked layout: CSS neutralizes bar/max modes and hides the
  new controls inside the existing media query — no JS breakpoint
  awareness (existing invariant).
- `wb-maker` view hides the side pane wholesale — unaffected.
- Canvas under `display:none`: audit measurements; dispatch a `resize`
  on restore so fit/zoom recompute.
- The "Left Edit Pane is always visible" invariant relaxes to: the pane
  or its bar is always visible — no state can strand the user with no
  way back.

## Testing

- `paneLayout.test.ts` — template per mode combo, clamps, snap
  enter/exit hysteresis, legacy-prefs defaults.
- DOM tests — syn panel × and Esc (alongside jsonIdeExtras.dom.test.ts).
- One targeted e2e spec — ⛶ maximize spans, bar minimize/restore,
  reload restores state.
- `npm run build` + full unit suite green before PR; the required CI
  `e2e` check is the arbiter (no full local Playwright run).

## Out of scope

- Lens shortcuts on the minimized bar (owner picked the plain strip).
- Edit-pane one-click maximize (only the JSON pane covers the canvas).
- Any change to syn palette storage (`wb-syn-colors` shipped in PR E).
