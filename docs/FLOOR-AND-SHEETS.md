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
- **Amended 2026-07-05 (owner, during the Stage-2 build):** the left strip
  lists the SHEETS only — there is **no grid/floor chip and no flip-flop
  button**. The grid isn't "in the background": standing on the floor is
  what the **COLUMNS tab** means (see §2.2b below). Everything else here
  stands: leaving is navigation, never mutation, and the strip + tabs are
  always visible, so flipping under a drill still works.
- The data pane stays as it is (owner call, 2026-07-04).

### 2.2b The grid is the COLUMNS tab's canvas (owner, 2026-07-05)

Selecting **COLUMNS** in the Left Edit Pane shows the grid — the
columns-only floor document IS columns mode. Clicking COLUMNS from a drill
or a sheet lands on the grid (pure navigation); clicking it when the grid
is already up browses the formatted-columns gallery. **VIEWS** is active
exactly while a sheet is up: from the grid it returns to the sheet last on
the canvas.

**Amended 2026-07-06 (owner):** with no sheets yet, VIEWS **creates a
starting row view from the grid's columns** (`makeRowView`, one undoable
step) and opens it — clicking the tab must land in views mode with
something real on the canvas, never bounce back to Columns with the View
Formatters popup (the old on-ramp). The strip's ＋ stays the door to tile
views and templates.

**Also 2026-07-06 (owner):** Columns mode carries **no view-wrapper
chrome** in the edit pane. On the floor: the document pill shows plain
"Grid" (no "list row schema" tag — that tag is sheets-only); the structure
tree lists the columns themselves (the grid root is scaffolding and never
gets a row); and the inspector never shows the "Document — grid formatter"
wrapper card (with the root selected it teaches "select a column" instead
of exposing wrapper internals like `hideSelection`).

### 2.2c Column tab groups (owner, 2026-07-05)

Grid columns group **like browser tabs**: multi-select headers →
"⬒ Group columns" → a named, colored pill spanning the members; the pill
menu renames, recolors, collapses (a slim track — the columns wait intact,
nothing leaves the document) and ungroups. Groups are PRESENTATIONAL
project metadata (`floorGroups`, an additive v2 key, sanitized on load):
the exported floor document is byte-identical with or without them, and
group gestures live off the undo stack exactly like sheet renames.

### 2.3 One editor chrome, three tiers

1. **Studio sheets** (view builder, component editor): full modal with the
   template builder's top bar — ↶ ↷ / Cancel / Save, modal-local undo,
   Save = ONE undoable document mutation.
2. **Property dialogs** (Format cells, conditional formatting, knob
   forms): the same chrome, smaller.
3. **Quick actions**: context menus / popovers.

One Escape convention through the `wb-esc-owner` marker (already the
chokepoint) — no hand-maintained exception lists.

**The undo contract — global but layered (owner, 2026-07-04):** every
modal editor keeps a LOCAL undo stack that bottoms out at the moment it
opened — in-editor undo can never reach past its own opening into the
document's history. Committing (Save/Apply/OK) collapses the whole editor
session into exactly ONE app-level undo step: after commit, the main
Ctrl+Z reverts the editor's entire output at once, never replaying its
intermediate states onto the canvas (those were modal-preview states the
document never held, and some would be states the editor's own Save
guards refuse). This is the template builder's shipped behavior,
generalized to every tier-1/tier-2 editor. Undo remains GLOBAL across
floor and sheets at the app level.

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
- **Stage 1 — split the documents. SHIPPED 2026-07-05.** The floor is its
  own columns-only document (`EditorState.floorDoc`, kind always 'grid');
  views are named sheet documents (`views: SheetDoc[]`, each
  `{id, name, doc}` with kind 'row'|'tile'; `activeViewId` names the open
  sheet, null = floor). `openView`/`minimizeView` are pure navigation —
  no snapshot, ever — and work while drilled into a column formatter
  (§2.2's owner requirement). Undo is ONE global app-level stack per
  §2.3: snapshots capture the whole workspace plus where the mutation
  happened, so undo/redo navigate back to the surface they change; the
  per-document stack stashes and the columnRefVersions merge machinery
  are gone. `columnRefs` stays workspace-owned (column formatters render
  on both surfaces via CFR). A main document of kind 'column' no longer
  exists — column examples/JSON register to the current field and open
  the drill-in. Graduation (`makeRowView`, template Save from the floor,
  schema-import default views) CREATES a sheet; the floor is never
  overwritten, so the Stage-0 overwrite confirm died on that path.
  Autosave is format v2 under the SAME frozen key
  (`floor`/`views`/`activeViewId` replace `doc`/`viewName`); the share
  codec is untouched (`w1` names the byte encoding). Per the owner call
  of 2026-07-04 there is **no migration/upgrade code**: a pre-Stage-1
  autosave, share link, or wb-snapshots entry fails its strict load
  guard and the app falls back to a fresh default — a load guard, not a
  converter. The frozen-NAMES rule (never rename localStorage keys or
  `wb-` prefixes) still stands; frozen names ≠ frozen formats. This
  deleted the relabeling bug class entirely: "◧ Back to grid" and the
  "⟳ Reopen" bar now ride `minimizeView`/`openView` until Stage 2's
  strip replaces them, and the View Formatters menu is the real
  multi-view list (floor entry + every sheet + "+ New row/tileview…").
- **Stage 2 — sheet chrome. SHIPPED 2026-07-05**, amended by the owner
  mid-build (§2.2b/§2.2c). The left VIEW STRIP (`viewStrip.ts`, under the
  Formatters bar) lists every sheet as a chip — click opens (navigation),
  double-click renames inline, ＋ is the template on-ramp — and carries NO
  grid chip: the grid is the COLUMNS tab's canvas, so "minimize" is
  "click COLUMNS". The VIEWS tab returns to the sheet last on the canvas
  (`lastOpenViewId`); with no sheets yet, Stage 2 as shipped opened the
  View Formatters menu as the on-ramp — amended 2026-07-06 (§2.2b): it
  now creates a starting row view instead.
  "◧ Back to grid" and the Stage-0/1 "⟳ Reopen" bar are retired. The
  floor can no longer render pseudo-columns at all: the last path in —
  Apply-to-canvas of a row payload over the floor — now gates on the
  schema-import `isPureGrid` guard, so a zoned/composite layout becomes a
  NEW named sheet instead (the floor's own columns-only export still
  round-trips onto the floor; a childless root still seeds an empty
  floor). Column TAB GROUPS (§2.2c) shipped with the same brief:
  `colGroups.ts` (pure, node-tested) + `state.floorGroups`, rendered by
  the grid as a pill ribbon, header bands and collapsible slim tracks.
- **Stage 2 follow-ups (owner, 2026-07-05, second brief).** The formatter
  tabs read **Columns | Components | Views** — the mental model left to
  right: *views are made up of columns and components*. The View
  Formatters menu is views-only (its "◧ Grid" floor row is gone; the grid
  pill opens the column gallery instead — the grid IS columns mode); the
  strip's ＋ is the landing-screen on-ramp. **Components are offered from
  the palette** (`paletteComponents.ts`, pure + memoized): every
  field-bound preset becomes an element component over its CANONICAL tree,
  slots typed by AUTHORED intent (`presetRefTypes` — a due-date badge asks
  for a date column regardless of the open schema), shown under "From the
  palette" beside the built-ins and held to the same definitely-renders
  unit bar. Element component cards are DRAG SOURCES onto the canvas
  (the palette gesture, generalized): a complete best-guess binds and
  inserts at the drop point (ONE undoable step, provenance-stamped so the
  ⬡ inventory counts it); an incomplete guess opens the typed mapper —
  never a wrong-typed bind. Primitives stay on the draw toolbar; Layout
  Shells stay with the builder gallery.
- **Stage 3 — Select/Live canvas toggle. SHIPPED 2026-07-05.** A
  segmented toggle on the shared canvas chrome (`state.canvasMode`,
  session-only UI state — a reload lands back in Select). **Select** (the
  default): clicks select — including customRowAction buttons, which the
  renderer no longer intercepts (`RenderOptions.interactive: false` skips
  the behavior handler so the click bubbles to click-to-select).
  **Live**: clicks route through the real behaviors (actions fire via
  `onAction`, nothing selects, selection outlines stand down). Card
  flyouts open in BOTH modes — the flyout is also the editing door into
  customCardProps. The template builder already ships the always-live-rows
  version of this idea and is unchanged. ⚠ visual-compare watch spot: the
  harness drives customRowAction/inlineEdit clicks — it must flip the
  canvas to Live before interaction captures or the sandbox side reads
  `click-no-effect`.
- **Stage 4 — editor-chrome unification. SHIPPED 2026-07-05** (two
  passes). *Structural half:* the hand-maintained Escape exception list §1
  complained about was already collapsed onto the one `wb-esc-owner`
  marker check in canvas.ts — what remained was stale prose enumerations
  in comments (removed; the marker IS the convention) and two stragglers,
  both fixed: the conditional formatting dialog hand-rolled its
  backdrop/Esc machinery (now on the `createOverlay` chokepoint) and the
  view menu self-closed on Escape without carrying the marker.
  *Local-undo half:* §2.3's modal-local ↶↷ contract now has ONE shared
  implementation — `modalUndo.ts` (pure + node-tested: baseline floor,
  no-op-commit guard, redo-tail truncation, capture-phase Ctrl+Z/Y wiring
  that never reaches the app stack, text inputs keep native editing undo)
  — wired into the component editor (the staged ELEMENT tree; identity
  text fields stay native), Format cells (the staged patch + border
  model; render() is the commit chokepoint, so tab switches are free) and
  conditional formatting (the rules list + watched field; composer picks
  are pre-gesture config). Each still commits its Save/Apply as exactly
  ONE app-level mutation. DELIBERATE EXEMPTIONS, recorded not forgotten:
  the subtype knob form and the component-map dialogs are single-pick
  forms with nothing destructive — every control is individually
  re-settable and text inputs carry native undo, so a local stack would
  be chrome without protection; the playground stays apply-per-action
  (each apply is its own app-level undo step) — it is not a Save-committed
  editor; and the template builder keeps its own predating local-undo
  implementation (the pattern `modalUndo.ts` was extracted from) —
  migrating it onto the helper is opportunistic cleanup, not a gap.

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
