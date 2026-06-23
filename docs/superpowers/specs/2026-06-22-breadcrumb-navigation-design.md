# Breadcrumb navigation — design

**Status: APPROVED design (2026-06-22). Ready for writing-plans.**

_Owner: samyost. Brainstormed 2026-06-22. Branch: `claude/breadcrumb-nav`
off `origin/main`._

This is the next step of the maker-first redesign (the post-Stage-5 shell).
It replaces the topbar's doc-navigation controls with a single **breadcrumb**
above the canvas, gives the view an **editable name**, and upgrades the
formatted-columns picker into a real **Column Formatters** menu.

---

## 1. Motivation

Doc navigation today is split across two unrelated topbar widgets plus a lone
ribbon button:

- `#wb-activedoc` — the **"Editing" `<select>`** (Main formatter ⇄
  `Column: X`). The workspace switcher.
- `#wb-dest-chip` — the read-only **"→ Saves to the view / column X" pill**
  (Stage 2's emergent destination chip).
- `#wb-ribbon-cols` — the **`▦ Formatted columns`** button in the ribbon
  strip, which opens the `columnGallery` floating picker.

Three controls answer one question — *what am I editing and where does it
save* — in three different idioms. The breadcrumb unifies them into one
always-visible "where am I" line whose **root is a browse menu** and whose
**tail is the current doc = the save target**.

### Terminology note (the paste conflated two elements)

The originating brief referred to a single `#wb-activedocdest-chip`. There is
no such element. The breadcrumb replaces **both** `#wb-activedoc` (the Editing
select) **and** `#wb-dest-chip` (the Saves-to pill). Both come out of the
topbar.

---

## 2. Goals / non-goals

**Goals**
- One breadcrumb above the canvas, always visible (maker mode included).
- Root crumb = a menu trigger (browse). Tail crumb = the current doc, named
  plainly (no pill, no `[$Field]`, no the word "column").
- A separate **Back** affordance beside it for retrace (return to the view
  you drilled from).
- The view gets an **editable name** (default `View 1`), persisted with the
  project.
- The formatted-columns picker becomes the **Column Formatters** menu, with a
  *Not yet formatted* group that starts a formatter via the existing
  "Format this column" path.
- A minimal **View Formatters** menu (the one view + Rename) — the shell that
  later grows into multi-view, without building multi-view now.

**Non-goals (YAGNI)**
- Multiple views. We build the *shell* (a named single view + a menu that
  lists it) only.
- Renaming columns. The Column Formatters menu navigates and creates; it does
  not rename fields.
- Any change to `◧ Back to grid` (the row-view layout toggle — a different
  axis from doc navigation).

---

## 3. Layout & placement (design A)

The breadcrumb lives in the existing **`#wb-ribbon` strip** — the full-width,
always-visible row directly above the canvas (`src/main.ts:71-73`). That
strip's only current occupant is `▦ Formatted columns`, which the breadcrumb
root **subsumes**. New left→right content of the strip:

```
[ Root crumb ▾ ] › [ Tail crumb ]                ← Back to View 1 view formatter
└── menu trigger (browse)  └── current doc        └── retrace (only when drilled)
```

Removed from the topbar (`src/main.ts:37-44`): the `Editing` `<label>` +
`#wb-activedoc` `<select>`, and the `#wb-dest-chip` `<span>`. Untouched in the
topbar: JSON copy, Undo, Redo, Advanced, ☰ menu.

---

## 4. The breadcrumb component (design B)

New unit: **`src/editor/breadcrumb.ts`**. Owns the ribbon strip's left side;
re-renders on `state.subscribe`. One clear purpose: render the crumbs + Back
from workspace state, and open the right menu on root-crumb click. It reads
state and calls `state.open*` / the two menu modules; nothing reads it back.

Three workspace states map to two breadcrumb shapes, derived from
`state.activeDocKey` and `state.doc.kind`:

| Workspace state | Root crumb (menu trigger) | Tail crumb (= save target) |
|---|---|---|
| `activeDocKey === 'main'`, kind `grid`/`row`/`tile` | **View Formatters ▾** | the view name (`View 1`) |
| `activeDocKey === 'main'`, kind `column` (standalone) | **Column Formatters ▾** | the field name (`Status`) |
| `activeDocKey !== 'main'` (drilled into a column ref) | **Column Formatters ▾** | the ref's column name (`Status`) |

- Root crumb click → opens the matching menu (§6 / §7), anchored under it.
- Tail crumb is **non-interactive text** — it states where you are and where
  it saves. No pill chrome, no `[$…]`, no "column" word.
- The tail-crumb text for a column uses the field's `displayName ?? name`
  (matches `columnGallery`'s card labels).

---

## 5. Back affordance (design C)

The contextual Back that exists today lives *inside the canvas* — a
`wb-back-bar` rendered above the column preview (`src/editor/canvas.ts:100-113`),
labeled "Editing the X column formatter," calling `state.openMain()`. This
design **relocates it into the ribbon strip**, right-aligned beside the
breadcrumb, and rewords it:

- Text: **`← Back to {viewName} view formatter`**.
- Shown **only** when `state.activeDocKey !== 'main'` (you drilled into a
  column from a view). Hidden otherwise.
- Action unchanged: `state.openMain()`.
- The in-canvas `backToMainBar()` is **removed** from `canvas.ts` (its job
  moves to the ribbon). The grid e2e that asserts `.wb-back-bar
  .wb-rowview-back` (`e2e/grid.spec.ts:71-73`) is rewritten to the new
  location.

Retrace (Back → one specific origin) vs. browse (root menu → any doc) stay
distinct. `◧ Back to grid` (kind toggle, `canvas.ts:50-55`) is untouched.

---

## 6. Column Formatters menu (design D — extend `columnGallery.ts`)

Extend the existing `openColumnGallery` (`src/editor/columnGallery.ts`) into
two groups:

- **Formatted** — the live-preview cards exactly as today
  (`formattedColumnNames()` → render each `columnRefs[name]` against mock
  rows). Click → `state.openColumnRef(name)`.
- **Not yet formatted** — every `state.fields` entry with **no** `columnRefs`
  entry, as plain rows (name only, no preview — there's nothing to preview
  yet). Click → **the existing "Format this column" path**, i.e. the
  type-aware preset picker.

### What "reuse the Format-this-column path" means precisely

The header-menu path is `gridView.ts:openFormatColumnMenu` → it offers
`columnPresetsFor(field.type)` (Facepile for people, status pill for choice,
data bar for number…) then **Format this column manually**, and falls
straight to manual when no preset fits. The Not-yet-formatted click reuses
this **including the preset picker** (faithful to the brief's "reuses the
header-menu 'Format this column' path").

One wrinkle to handle: `openFormatColumnMenu` / `formatColumn` are keyed off a
placed **`GridColumn`** (they CFR-wire the grid cell in place). From the menu,
a field may be **placed as a plain grid cell** or **registered-but-unplaced**
(e.g. Owner in the showcase). So the menu version resolves field → grid column
first:
- **placed** → CFR-wire the cell exactly like the header path (one document
  mutation), then `openColumnRef`;
- **unplaced** → just register the chosen formatter + `openColumnRef` (no grid
  mutation).
The chosen-formatter construction (`buildColumnPreset(id, field)` or
`defaultColumnFormatter(field)`) and the one-mutation rule are unchanged. A
small shared helper (likely lifted from `gridView.ts`'s
`applyColumnFormatter`) backs both the header path and this menu path so the
preset/manual logic lives in one place.

The menu **re-anchors under the breadcrumb root** (the root crumb is its
trigger).

---

## 7. View Formatters menu (design E — new, tiny)

New unit: **`src/editor/viewMenu.ts`** (or a sibling function in
`breadcrumb.ts` if it stays under ~30 lines). Anchored under the root crumb.
Contents:

- One row: the current view (its name).
- A **Rename** action → an inline `<input>` inside the menu, prefilled with
  the current name. **Enter** commits (`state.setViewName(value.trim() ||
  'View 1')`), **Esc** cancels, blur commits. One state call, one autosave.

This is the deliberate shell for future multi-view (the brief's Option B):
the menu already frames "views" as a list with per-view actions, so adding
"+ New view" / switching later is additive.

---

## 8. View naming + persistence (design F)

State additions on `EditorState` (`src/editor/state.ts`):

- `viewName: string = 'View 1'`.
- `setViewName(name: string): void` — assigns, `emit('data')` (so the
  breadcrumb + menus refresh), schedules autosave. **Not** an undoable
  document mutation — it's project metadata, not a formatter edit, so it does
  not touch the undo stack (consistent with how naming/labels are treated).

Persistence — **additive field in the project payload** (owner-confirmed,
over a separate localStorage key):

- `serializeProject()` adds `viewName` to its object, exactly how
  `importedViews` rides along (`state.ts:250-264`). The frozen key
  `list-formatting-sandbox.project.v1` is untouched; **no version bump**
  (older builds ignore the unknown field).
- `loadProject()` reads `typeof p.viewName === 'string' ? p.viewName : 'View
  1'` (`state.ts:266-287`).
- `resetAll()` resets it to `'View 1'` (`state.ts:301-318`).

Because it lives in the payload, the name **travels with Save/Open project
files** and survives autosave-restore — it is project data, not a
browser-local preference.

---

## 9. The `▦ Formatted columns` ribbon button (design G)

**Retired.** The breadcrumb root (Column Formatters) is the new entry point,
so the standalone button is redundant. Its id `#wb-ribbon-cols` is removed
from the markup; the `sandbox.spec.ts:156` assertion that it's visible is
rewritten to assert the breadcrumb root instead. `openColumnGallery` keeps its
`anchor` parameter — the anchor is now the root crumb.

---

## 10. E2E contract changes (design H)

These specs assert the removed/relocated elements and are rewritten as part of
the work (test-first per house rules — change the contract, then the code):

- **`e2e/maker.spec.ts`** — `#wb-dest-chip` text assertions (`:57`, `:66`) →
  breadcrumb shape (root = "View Formatters" + tail = view name; root =
  "Column Formatters" + tail = "Status").
- **`e2e/grid.spec.ts`** — `#wb-activedoc` value assertions (`:38`, `:61`,
  `:69`, `:74`, `:182`, `:206`) → breadcrumb tail-crumb text; `#wb-dest-chip`
  (`:62`) → breadcrumb shape; `.wb-back-bar .wb-rowview-back` (`:71-73`) → the
  relocated ribbon Back.
- **`e2e/cfr.spec.ts`** — `#wb-activedoc` value/option (`:45`, `:55`) +
  `#wb-dest-chip` (`:46`) → breadcrumb tail crumb + Column Formatters menu
  listing.
- **`e2e/areas.spec.ts`** — `#wb-dest-chip` (`:74`, "tile layout") →
  breadcrumb shape for a tile view.
- **`e2e/sandbox.spec.ts`** — `#wb-activedoc` visible (`:138`) +
  `#wb-ribbon-cols` visible (`:156`) → breadcrumb root + tail visible.
- **`e2e/workspace.spec.ts`** — `#wb-activedoc` value (`:270`) → breadcrumb
  tail crumb.
- **New `e2e/breadcrumb.spec.ts`** — the two menus open from the root; the
  three breadcrumb states; Rename round-trips and persists across reload; the
  Not-yet-formatted group starts a formatter; the relocated Back returns to
  the named view.

Unit coverage: `state.ts` gains `viewName` default / `setViewName` /
serialize-roundtrip / reset assertions (extend the existing state test).

---

## 11. Component boundaries (summary)

| Unit | Purpose | Depends on | Consumed by |
|---|---|---|---|
| `breadcrumb.ts` (new) | Render crumbs + Back; open menus on click | `state`, `columnGallery`, `viewMenu` | `main.ts` (mounts it in the ribbon) |
| `viewMenu.ts` (new) | View Formatters menu (list + Rename) | `state` | `breadcrumb.ts` |
| `columnGallery.ts` (extended) | Column Formatters menu: Formatted + Not-yet-formatted | `state`, `renderer`, the shared format-column helper | `breadcrumb.ts` |
| `state.ts` (extended) | `viewName` + `setViewName` + persistence | — | all of the above |
| `canvas.ts` (trimmed) | drops `backToMainBar()` (moves to ribbon) | — | — |
| `gridView.ts` (refactor) | extract the shared "apply a column formatter" helper | — | header menu + Column Formatters menu |

Each unit answers *what it does / how you use it / what it depends on*; the
breadcrumb can be understood without reading the menus' internals, and the
menus without reading the breadcrumb's.

---

## 12. House-rule compliance

- **Vanilla TS + Vite, zero runtime deps** — no new deps; DOM + `state` only.
- **One gesture = one undoable mutation** — starting a formatter from the
  Not-yet-formatted group is the same single `mutateDocument` the header path
  already uses. `setViewName` is project metadata (not a document mutation),
  so it deliberately stays off the undo stack.
- **Click-only safety** — every breadcrumb/menu action is navigation or a
  single guarded create; none can corrupt a formatter by misclick.
- **Frozen keys / `wb-` prefix** — no localStorage key renamed; `viewName` is
  an additive payload field (no version bump). New CSS classes are additive
  under the `wb-` prefix (e.g. `wb-crumb`, `wb-crumb-root`, `wb-crumb-tail`).
- **Refuse-don't-guess** — unchanged; this work is navigation + naming, no new
  generated expressions.

---

## 13. Deferred / open

- Multi-view (add/switch/delete views) — the View Formatters menu is the
  shell; building it out is a later step.
- Double-click-the-tail-crumb-to-rename shortcut — v1 keeps Rename in the View
  Formatters menu only; can be added later if wanted.
- Whether the Column Formatters menu should also offer column **rename** —
  out of scope (fields are named at import/schema time).
