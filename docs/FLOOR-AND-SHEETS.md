# Floor & Sheets — the view-formatter UX model (designed 2026-07-04)

> Owner + Claude session, 2026-07-04. This is the agreed direction for how
> the grid, view formatters (row/tile), column formatters, and the app's
> many editing surfaces relate to each other. Stage 0 (the quick fixes)
> ships with the PR that adds this doc; stages 1+ are open work. Peers:
> SHEET-MODE.md (the surface's spreadsheet-comfort canon — still law),
> HANDOFF.md (architecture as built).

## 1. Why — what the 2026-07-04 investigation found

The presenting bug: **apply a row view, click "◧ Back to grid", and the
row view is effectively unreachable.** Root cause is structural, not a
missing button: there is ONE document, and `setKind('grid')` merely
relabels it. The row layout's zones then render as pseudo-columns
("Lead zone", "Details zone" headers), and every path back was broken or
hidden:

- **Ctrl+Z** works (setKind snapshots) but is undiscoverable and dies on
  the next mutation.
- The **`#wb-kind` select** works losslessly but lives in the Studio side
  pane as "Advanced: formatter type" — hidden by default.
- **Ctrl-click headers → "Make a row view"** re-graduates through
  `buildRowView`, whose weight normalization maps a hug zone
  (`flex: 0 0 auto`) to Normal (`flex: 1`) — it CORRUPTS builder layouts.
- **"+ New rowview…" → Save** replaced the relabeled layout with NO
  overwrite confirm (the guard short-circuited on `kind === 'grid'`).
  Fixed in Stage 0.

Related findings, same review:

- The row/tile wizard templates are NOT flipped (verified end to end),
  but the grid's "Make a tile" built a *horizontal* row layout stamped
  with tile dimensions — a row in tile clothing. Fixed in Stage 0.
- Two competing sizing vocabularies: the old per-area right-click
  Normal/Wide/Widest (+ the toolbar hint teaching it) vs the builder's
  Hug/Fill/2×/3× inspector control. Old one removed in Stage 0.
- ~13 overlay surfaces via `createOverlay` plus a half-dozen hand-rolled
  popover roots, three distinct editing idioms (canvas-inline CFR
  drill-in, modal editors, popover menus), and a hand-maintained list of
  Escape-owner exceptions in canvas.ts. No system.

## 2. The model

Three layers. The mental picture is a spreadsheet workbook: a floor you
always stand on, sheets you pull up over it, and one consistent way every
editor opens and closes.

### 2.1 The grid is the FLOOR

A real, separate, columns-only document. It renders schema columns and
their column formatters (CFR drill-in stays exactly as shipped) and
**never renders a view layout**. Nothing you do to a view can change what
the floor shows; nothing that happens on the floor can destroy a view.

- Hiding a column stashes it in the **"Columns not shown" tray** (the
  "+ column · N" affordance is the Stage-0 down payment); resurfacing is
  one click, hidden and never-placed fields wait in the same place.
- Column formatting, conditional formatting, Format cells, grouping-as-
  scaffolding all stay floor gestures.

### 2.2 Views are SHEETS above the floor

Each row/tile view is its own named document, listed in the View
Formatters menu (viewMenu.ts already frames itself as "the shell the
multi-view future grows into"). Opening a view slides its surface over
the floor; **minimizing** it (the successor of "Back to grid", living on
the LEFT with the other view actions) drops you to the floor *without
touching the view document*. A tab/chip strip on the left reopens any
sheet. Leaving is navigation, never mutation.

- **Owner requirement (2026-07-04):** flipping between the floor and any
  sheet must stay available **while drilled into a column formatter**.
  This falls out of the model: the column-style editor rides on whichever
  surface is up — column formatters render on both via CFR — so the drill
  banner stays put while the surface underneath switches.
- The data pane stays as it is (owner call, 2026-07-04).

### 2.3 One editor chrome, three tiers

1. **Studio sheets** (view builder, component editor): full modal with the
   template builder's top bar — ↶ ↷ / Cancel / Save, modal-local undo,
   Save = ONE undoable document mutation.
2. **Property dialogs** (Format cells, conditional formatting, knob
   forms): the same chrome, smaller.
3. **Quick actions**: context menus / popovers.

One Escape convention through the `wb-esc-owner` marker (already the
chokepoint) — no hand-maintained exception lists.

### 2.4 The canvas gets a Select / Live toggle

Interactivity (customRowAction, customCardProps triggers, …) needs a
canvas that can act like real SharePoint without losing click-to-select.
Not a separate Preview screen: a **mode toggle on the shared canvas
chrome**. Select = today's click-selects-in-tree. Live = clicks route
through the real behaviors (the renderer already has `onAction` and
working flyouts). The template builder already ships the house pattern —
an editable exemplar with always-live rows below it — this generalizes
that precedent to every canvas (floor, sheets, builder).

## 3. Stages

- **Stage 0 — quick fixes (SHIPPED with this doc's PR).**
  1. Save-over-layout confirm no longer skips `kind === 'grid'` — it asks
     whenever the root isn't a pure grid and the builder didn't reopen it.
  2. Grid → tile graduation stacks zones vertically (a real tile, not a
     row in a tile box).
  3. The stale per-area sizing UI is gone: the "right-click an area to
     size it" hint and the context menu's Area width entries. Zone sizing
     is the builder inspector's job (`setAreaWeight` stays as the engine
     primitive under `buildRowView`).
  4. A visible way back: leaving a row/tile view for the grid arms a
     "⟳ Reopen …" affordance above the grid (session-local memory; the
     real fix is Stage 1's separate documents).
- **Stage 1 — split the documents.** The floor becomes its own document;
  views become named documents (the multi-view list). Reshape the state
  model, autosave shape, and share codec **freely** — there are no users
  yet, so pre-Stage-1 autosaves and share links carry NO support
  obligation and **no migration/upgrade code is built or maintained**
  (owner call, 2026-07-04). If an old blob doesn't parse, the app simply
  falls back to a fresh default — that's a load guard, not a converter.
  The frozen-NAMES rule (never rename localStorage keys or `wb-`
  prefixes) still stands; frozen names ≠ frozen formats. This deletes the
  relabeling bug class entirely and makes "minimize" trivial.
- **Stage 2 — sheet chrome.** The left view strip (open/minimize/rename/
  new), "Back to grid" retired in favor of minimize; the floor stops ever
  rendering pseudo-columns.
- **Stage 3 — Select/Live canvas toggle**, shared across floor, sheets,
  and the builder preview.
- **Stage 4 — editor-chrome unification** (the three tiers), migrating
  the hand-rolled popover roots onto the shared conventions.

## 4. Invariants that survive every stage

- Vanilla TS + Vite, zero runtime dependencies.
- One user gesture = one undoable document mutation; leaving/minimizing a
  view is navigation and must never mutate.
- Generated formatters stay schema-valid and definitely-work-on-real-SP;
  refuse-and-teach; no standalone `!`.
- localStorage keys and `wb-` CSS names are frozen (naming, not format —
  renames must never wipe work; formats may change while nobody's here).
- No compatibility machinery: until there are real users, old saved
  formats and share schemes are DROPPED, not migrated (owner call,
  2026-07-04 — this supersedes any decode-forever wording elsewhere,
  e.g. SHARE-URL.md, until the owner declares a real-user baseline).
