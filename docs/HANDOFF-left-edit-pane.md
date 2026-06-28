# Left Edit Pane — status & continuation handoff

> Branch: `claude/formatfx-left-edit-pane-ys3gsf` (12 commits on top of `main`).
> Every commit: `npm run build` + `npm test` (472 unit tests) green.
> Spec: the "FormatFX Left Edit Pane — Complete Specification" (Claude-style
> consolidated editing surface).

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

## What remains

1. **Function Bar** (`fxBar.ts`, `fxSuggest.ts`, `inspector.ts`)
   - Add a `focusFxSlot(prop)` export to `fxBar.ts`; have the inspector's
     `exprField` formula preview call it (click formula → focus/dock the bar).
   - Map a style prop → the fx slot id (curated: color→`ink`, background-color→
     `fill`, font-weight→`weight`, font-size→`fontSize`, text-align→`align`,
     border-radius→`radius`, opacity→`opacity`; else `style:<prop>`).
   - Draggable detach (`openFloat()` already exists — add header drag + dock button).
   - Inline autocomplete: typing `[$` (column refs), `@` (context tokens),
     function names; property-type-aware result suggestions after `if(`. Extend
     `fxSuggest.ts` (it is pure + tested — add `columnCompletions`/`contextCompletions`/
     `operandSuggestions`/`resultSuggestions`).

2. **Inspector polish**
   - `section()` helper → collapse chevron + per-section **Reset** link +
     section-level blue-dot aggregation (per-property `.wb-active-dot` exists).
   - **Quick-add links** ("Add: min width · max width · shadow · …").
   - `ⓘ` doc cards on the new dedicated fields (reuse `buildDocCard`).
   - customCardProps nested editing; `inlineEditField`/`defaultHoverField`
     autocomplete; forEach code-driven **amber warning card** ("These N elements
     are code-driven").

3. **e2e rewrite** (`e2e/sandbox.spec.ts`, `e2e/workspace.spec.ts`)
   - These assert the OLD layout (`#wb-pane-palette`, side tabs, peek/max, the
     box-model in advanced, etc.) and will fail. Rewrite against the new
     selectors: `.wb-leftpane`, `.wb-lens-tab[data-lens="simple|pro|code"]`,
     `#wb-tree-view .wb-tree-check`, `.wb-tree-eye`, `.wb-seg`, `.wb-preset`,
     `.wb-expr-toggle`, `.wb-code-box`, `#wb-json-toggle`, `.wb-governed-badge`.
   - The **unit suite is the green contract** (CLAUDE.md) — keep it passing;
     rewrite e2e to match the new DOM.

## How to continue

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
