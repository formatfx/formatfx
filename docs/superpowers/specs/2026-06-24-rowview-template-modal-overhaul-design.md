# Row-View Template Modal — Direct-Manipulation Overhaul

- **Date:** 2026-06-24
- **Branch:** `claude/rowview-preview-overhaul`
- **Status:** Design approved; ready for implementation plan.
- **Supersedes the interaction layer of:** PR #59 (row-view templates) — the
  pure engine it shipped is reused as-is; only the modal UI is rebuilt.

## 1. Motivation

The "Templates…" modal (`src/editor/templateModal.ts`) pairs a left **config
pane** (a Template dropdown, one **dropdown per area**, and row-style toggles)
with a right **3-row live preview**. Two problems:

1. **The dropdowns are the editing surface, and they're clumsy.** Field chips
   already exist and are draggable, but their drop targets are the area `<div>`s
   *in the config pane* (which wrap the dropdowns) — so a dragged field lands on
   a dropdown, not on the rendered row it will actually occupy. The owner's
   verdict: "dropping onto the dropdowns is dumb… I don't even want dropdowns."
2. **The preview is inert.** It already reuses the real renderer
   (`renderElement` + `ctxForRow` + `resolveColumnRef`), so expressions and field
   references evaluate faithfully — but you cannot *edit* on it, and interactive
   behaviors (hover highlight, the kebab) are described in honesty-note captions
   rather than demonstrated.

So the rendering fidelity is already good; the gap is **interactivity** — both
for editing and for previewing real behavior.

## 2. Goals / Non-goals

**Goals**
- Make the rendered row the direct-manipulation editing surface; delete the
  per-area dropdowns.
- Add an **Edit / Preview** mode toggle: Edit makes the row editable; Preview
  makes it behave like a real list row.
- Wire the built-but-unused `buildKebab` / `placeKebab` engine into the UI.
- Preserve every locked invariant: one Apply = one undo, click-only safety,
  schema-valid output, the frozen `wb-` CSS prefix and localStorage keys.

**Non-goals**
- No engine rewrite. `rowTemplates.ts`, `areas.ts`, the renderer, and
  `state.applyRowTemplate` are reused unchanged (save for small additive pure
  helpers).
- `leftStripe: 'status'` stays deferred — it needs a schema extension and is
  already a documented v2 item.

## 3. Decisions (locked during brainstorming)

| # | Decision |
|---|----------|
| 1 | **Canvas + Edit/Preview toggle.** The rendered row *is* the editor in Edit; a faithful, interactive row in Preview. |
| 2 | **Inspector + drag-to-resize width.** A contextual inspector is the editing home base; width also gets a direct drag-the-divider gesture (the one spatial property where direct manipulation beats a control). |
| 3 | **Layout:** FIELDS pinned on top → PREVIEW → INSPECTOR below by default, with a toggle to dock the inspector to the **left**. Dock choice persists. In Preview the inspector collapses to a thin status strip. |
| 4 | **Skeleton on-ramp → free-form.** A skeleton seeds the initial blocks; thereafter blocks are added / removed / reordered freely. |
| 5 | **Preview semantics (option A):** make-live what we own (hover highlight, zebra, custom kebab flyout); honest captioned **stubs** for what we can't reproduce in a modal (native kebab → placeholder menu; row click → toast). Nothing pretends to be real SharePoint chrome. |
| 6 | **Full kebab wired this round:** enable, Native vs Custom, position, and Custom action buttons — with blank flow-ID / setValue targets refused via an inline hint. |

## 4. Architecture

### What does NOT change
- `src/editor/rowTemplates.ts` — the pure brain: `defaultConfigFor`,
  `buildTemplateView`, `composeRowStyle`, `buildKebab`, `placeKebab`, and the
  `RowTemplateConfig` / `RowAreaConfig` / `KebabConfig` types. The data model
  already carries `areas[]`, `kebab`, and every style field the new UI touches.
- `src/editor/areas.ts`, `src/core/renderer.ts`, `src/editor/previewCtx.ts`.
- `state.applyRowTemplate(root, additionalRowClass)` — still the single undoable
  mutation; the structural `isPureGrid` confirm gate is preserved.

### What IS rebuilt
The DOM/interaction layer (today a single `templateModal.ts`). To keep files
focused and independently testable, it splits into four units:

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| `templateModal.ts` | Shell: overlay, region assembly, modal-local state (`config`, `mode`, `selectedAreaIndex`, `dock`), `rerender()` orchestration, Apply/Cancel. | `overlay`, the three modules below, `state`, `rowTemplates` |
| `templatePreview.ts` | Renders the row(s) via the real renderer; in **Edit** overlays affordances (select, drop, reorder, divider-resize, end-gap add, kebab placement); in **Preview** runs the live behaviors. | `renderer`, `previewCtx`, `rowTemplates` |
| `templateInspector.ts` | The contextual inspector: block view, row view, and the kebab section. Emits new configs. | `rowTemplates` (`composeRowStyle`), `areas` |
| `templateFields.ts` | The pinned FIELDS bar — the drag source; dims already-placed fields. | `state.fields` |

### New pure helpers (additive, in the brain)
`addArea(config)`, `removeArea(config, i)`, `moveArea(config, from, to)` —
immutable operations on `config.areas`. `buildTemplateView` already iterates
`config.areas` generically, so arbitrary block counts work with no engine change.
These get their own unit tests.

## 5. Layout & the two modes

**Edit** (default dock = below):

```
┌ FIELDS  [Title][Status][Owner][Due][Priority]…  (placed ones dimmed) ┐
├ PREVIEW                                          [ Edit │ Preview ]   ┤
│  ⬚  ‖ Title… ●  ‖  Due        ⋯      ← ‖ = drag to resize, ● = selected│
│  ⬚    Title     Due           ⋯              + drop a field here →    │
│  ⬚    Title     Due           ⋯                                       │
├ INSPECTOR — "Title" block                              [⇤ dock left]  ┤
│  Width [Norm│Wide│Wider]  Wrap [Wrap│Trunc]  Align [L│C│R]  [✕ remove]│
└──────────────────────────────────────────────────────────────────────┘
```

**Preview** (inspector collapses to a thin strip; row goes live):

```
┌ FIELDS  (dimmed — not draggable in Preview)                          ┐
├ PREVIEW                                          [ Edit │ Preview ]   ┤
│  ▓▓ hover-highlighted row ▓▓   Title   Due      ⋯ ← opens flyout/stub │
│     Title   Due                                 ⋯                     │
├ Preview — hover & kebab are live; row-click & native menu are stubbed ┤
└──────────────────────────────────────────────────────────────────────┘
```

**Docked-left** (Edit): FIELDS stays pinned on top; the inspector becomes a left
rail beside the preview. The dock choice is stored under a new localStorage key
`wb-template-inspector-dock` (`'bottom'` | `'left'`). New keys are permitted; the
frozen-keys rule forbids only *renames*.

## 6. Edit-mode interaction grammar

| Gesture | Effect |
|---------|--------|
| Drag chip → block | Sets that block's field (replaces if occupied). |
| Drag chip → trailing **"+ drop a field here"** gap | Appends a new block (`addArea`). |
| Click a block | Selects it (`●`); inspector shows its controls. |
| Drag the **‖ divider** between blocks | Sets the left block's weight. The model has three discrete weights (`normal` / `wide` / `widest` = flex 1 / 2 / 3), so the drag **snaps** to the nearest — it is not free-form pixel sizing. |
| `Norm│Wide│Wider` segmented control (inspector) | Same effect (maps to `normal` / `wide` / `widest`), keyboard-accessible. Drag is the shortcut; the control is the accessible path. |
| Drag a block to a new slot | Reorders (`moveArea`). |
| `✕` (inspector) or drag a block off the row | Removes the block (`removeArea`). |
| "Start from…" menu (row inspector) | Reseeds areas from a skeleton (Split / Avatar / Equal / Header-detail). **Confirms first** if the row already has content. |

## 7. The inspector (contextual)

- **A block is selected →** Field (shown; assignment is by drag), Width, Wrap,
  Align, and Remove for that block.
- **Nothing selected (row view) →**
  - **Row style:** Style (Flat / Card / Minimalist), Border, Zebra, Hover
    highlight, Left accent stripe. `composeRowStyle`'s mutual-exclusion and
    greyed-with-reason logic is reused unchanged (e.g. Card disables Border and
    Zebra, with the reason surfaced as a `title`/`.wb-disabled` cue).
  - **Row actions / kebab:** the kebab is **row-level, not an area block** — it
    is configured here, never selected as a block. (Clicking the kebab in the
    Edit preview opens this row-view section; the affordance overlay excludes it
    from area selection but must still skip its spliced slot when mapping
    children → area indices — see Risks.) Controls: Enable on/off; **Native** vs
    **Custom**; position (left / after-title / right / hover); and, for Custom,
    the action buttons.
    A button with a blank flow-ID or setValue target is **refused with an inline
    hint** ("Add a flow ID to enable this action") rather than silently dropped —
    matching `buildActionButtons`' existing refusal and the repo's
    refuse-and-teach rule.

## 8. Preview-mode behaviors (option A)

- **Live for real** (we own the DOM): hover highlight (real pointer-over), zebra
  (visible across the 3 rows), and the **custom kebab flyout** (its own
  `customCardProps` popup opens on click).
- **Honest stubs** (cannot be reproduced in a modal): the **native kebab** opens
  a small captioned placeholder menu ("SharePoint's item menu opens here"); a
  **row click** flashes a toast. Captions make clear these are stand-ins.
- The current per-row `try/catch` that renders `⚠ <message>` on a bad expression
  is preserved.

## 9. Data flow & safety

- **Single source of truth:** a modal-local `config: RowTemplateConfig`. Every
  gesture produces an immutable new config → `rerender()`. The preview path is
  unchanged: `buildTemplateView(config) → renderElement` per row, with
  `ctxForRow(i)` and `resolveColumnRef`.
- **Apply:** `buildTemplateView(config) → state.applyRowTemplate(root,
  additionalRowClass)` — exactly one undoable mutation. Cancel/Esc discards.
- **Click-safety falls out structurally:** nothing touches the document until
  Apply, so no in-modal gesture (drop, reorder, resize, remove, reseed) can
  corrupt a formatter — the worst outcome of any misclick is Cancel. This
  satisfies the house rule by construction, not by guarding each gesture.

## 10. Error handling & edge cases

- **Empty row (all blocks removed):** the preview shows a single
  "Drag a field here to start" drop target. **Apply is disabled** while there is
  no non-empty area (an empty row view is meaningless).
- **Duplicate field:** allowed (a field may legitimately appear twice); the
  FIELDS bar dims placed fields as a cue but does not block re-use.
- **Reseed over existing work:** confirmed before replacing; single-undo remains
  the net.
- **Kebab Custom with blank params:** the engine already refuses to emit; the UI
  surfaces *why* via the inline hint instead of a silent drop.
- **Native kebab in Preview:** stub menu, captioned.

## 11. Testing & changed contracts

Per CLAUDE.md, tests are contracts — change the test first, then the code.

**Rewritten (`src/editor/templateModal.test.ts`):** the existing
drag-chip-onto-config-area and per-area-dropdown assertions are replaced by
drag-chip-onto-preview-**block** assertions. New unit tests:
- add (drop on end gap), remove, reorder change `config.areas` correctly;
- selecting a block populates its inspector controls; Wrap/Align/Width edits
  update the config;
- the Edit/Preview toggle flips mode; in Preview the affordances are gone and
  hover/flyout are live;
- kebab: a Custom action with a blank param is refused and the hint is shown; a
  valid action's flyout opens in Preview;
- the dock toggle persists to `wb-template-inspector-dock`;
- Apply calls `state.applyRowTemplate` (one undo); Cancel mutates nothing.

**New (brain):** unit tests for `addArea` / `removeArea` / `moveArea`, and a test
pinning the **rendered-children → area-index mapping** (see Risks) including the
kebab's spliced position.

**Unchanged & must stay green:** `src/editor/areas.test.ts` (engine untouched).

**e2e (`e2e/templates.spec.ts`):** updated for drag-onto-preview, the mode
toggle, and kebab open.

## 12. Risks

- **Rendered DOM → area-index mapping.** The Edit-mode affordance overlay must
  map each rendered block back to its `config.areas` index, *accounting for the
  kebab spliced in by `placeKebab`* (left / after-title / right). `placeKebab`'s
  ordering is deterministic, so the overlay recomputes the same ordering rather
  than guessing from the DOM; a dedicated unit test pins this for every kebab
  position. This is the single non-trivial piece of the rewrite.

## 13. Out of scope / deferred

- `leftStripe: 'status'` (needs a schema extension; documented v2 item).
- Any change to the row-view *engine* or to `state` beyond consuming the existing
  `applyRowTemplate`.
