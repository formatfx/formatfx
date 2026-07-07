# Left Edit Pane — status & continuation handoff

> **RESOLVED 2026-06-29** — every "What remains" item below has shipped: the e2e
> rewrite merged in **#116**; the Function Bar (dock + autocomplete) and the
> inspector polish in **#117**. Unit suite is now at **488**. Kept as a record of
> the design and what landed; nothing here is outstanding.
>
> Branch (historical): `claude/formatfx-left-edit-pane-ys3gsf`.
> Spec: the "FormatFX Left Edit Pane — Complete Specification" (Claude-style
> consolidated editing surface).
>
> **2026-07-07:** the pane was REBUILT to Mockup B in the Columns ·
> Components · Views migration (nav row → This-view card → tree → columns
> shelf → components library → views list) — see
> [specs/COLUMNS-COMPONENTS-VIEWS.md](specs/COLUMNS-COMPONENTS-VIEWS.md) §3.

## What's done (verified)

- **Layout** — the 7-column grid is replaced by `Left Edit Pane (360px) | Canvas |
  JSON pane`. The left pane is always visible; the JSON pane (the Advanced escape
  hatch) folds away by default and is revealed by the topbar **Advanced** toggle
  (`uiPrefs.jsonOpen`). The studio/maker pane-hiding is gone.
- **State** (`state.ts`) — `selections: NodePath[]` multi-select with a
  backward-compatible `selection` getter/setter; `activeLens` + `setLens` ('lens'
  ChangeReason); Save checkpoint (`markSavepoint`/`isDirtySinceSave`/`discardToSavepoint`).
- **Pure cores (unit-tested)** — `classPrecedence.ts` (class-precedence engine),
  `codeMode.ts` (Code-lens parser), `multiSelect.ts` (union/divergence).
- **Shell** (`leftPane.ts`) — action header (Edit/Discard/Save), Simple/Pro/Code
  lens tabs, structure-tree region, drag splitter, draw toolbar (Select/Text/Frame/
  Icon/Undo/Redo + palette overflow popover).
- **Code lens** (`codeEditor.ts`) — monospace declarations sheet over `codeMode`.
- **Inspector** (`inspector.ts`) — lens-aware:
  - Simple: Text, Typography, (Arrange children), Appearance, Border, box model.
  - Pro: Element, **Sizing** (Hug/Fixed/Fill), **Position** (Inline/Absolute),
    **Contents layout** (display sans Grid + flex direction + alignment presets +
    Gap), **Padding/Margin** (`– 1x 2x 4x`), Appearance, Border, Style (all
    properties, with class-override badges), Attributes, superpowers.
  - The **`=` expression toggle** on Simple/Pro visual controls.
  - **Multi-edit**: dedicated controls write to every selected node (`commitAll`)
    with a "Mixed" indicator; whole-object/identity editors stay primary-only.
- **Tree** (`treeView.ts`) — 13×13 multi-select checkboxes, 👁 eye visibility
  toggle, right-click context menu (Copy/Paste/Group/Ungroup/Duplicate/Delete via
  `contextMenu.ts` + `clipboard.ts`).
- **Re-skin** — Microsoft-blue CTA + cool Fluent pane (tokenized in `style.css`).

## What remained — now COMPLETE (2026-06-29)

1. **Function Bar** (`fxBar.ts`, `fxSuggest.ts`, `inspector.ts`) — **done (#117).**
   `focusFxSlot(prop)` + the inspector `=` field's **ƒx** dock button; the
   `slotIdForProp` curated map; draggable detach **with a dock-back button**; and
   inline autocomplete — `columnCompletions`/`contextCompletions`/
   `operandSuggestions`/`resultSuggestions` plus the caret-driven `completionAt()`
   dispatcher, all Excel-dialect and round-trip-safe.

2. **Inspector polish** — **done (#117).** Section collapse chevron + per-section
   **Reset** + the active-dot aggregated across the selection; **quick-add links**
   (allow-list-filtered); **ⓘ doc cards** on the dedicated Simple/Pro fields
   (reusing `buildDocCard`); and the **forEach amber "code-driven" card**.
   (`inlineEditField`/`defaultHoverField` already autocomplete via the field-ref
   datalist; the `customCardProps` subtree is editable via the tree's "Edit card
   content" → so those two were pre-existing, not rebuilt.)

3. **e2e rewrite** — **done (#116, merged).** All six affected specs
   (`sandbox`, `workspace`, `maker`, `grid`, `import`, `icons`) rewritten against
   the new DOM; the `e2e` check is green. The unit suite stayed the green contract.

Nothing here is outstanding. The broader product roadmap lives in
`docs/SHEET-MODE.md`.

## How to continue (historical)

```
git checkout claude/formatfx-left-edit-pane-ys3gsf
npm ci
npm run build      # tsc + vite
npm test           # 472 unit tests
npm run dev        # http://localhost:5173
```

New modules: `leftPane.ts`, `codeEditor.ts`, `codeMode.ts`, `classPrecedence.ts`,
`multiSelect.ts`, `clipboard.ts`. Heavily extended: `inspector.ts`, `main.ts`,
`treeView.ts`, `contextMenu.ts`, `style.css`. All new colors are tokenized
(`:root` + `body.wb-dark`) — re-skins are one place.
