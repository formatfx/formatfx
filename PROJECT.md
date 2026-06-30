# Project: formatfx UX Refactoring

## Architecture
The application is a Single Page Application (SPA) designed as a spreadsheet-faithful formatter editor.
- **State Management (`src/editor/state.ts`)**: Holds selection state (`selections: NodePath[]`), history stack for Undo/Redo, and savepoints.
- **Left Edit Pane (`src/editor/leftPane.ts`)**: Displays tabs (Simple, Pro, Code) and controls layout, sizing, padding, and draw tools.
- **Tree View (`src/editor/treeView.ts`)**: Visualizes document hierarchy, handles checkboxes for multi-select, and communicates with state.
- **Inspector (`src/editor/inspector.ts`)**: Rendered based on current selection, binds controls to edit fields, and supports multi-edit.
- **Canvas / Preview Area (`src/editor/canvas.ts` / `src/editor/render.ts`)**: Renders the preview of the sheet, highlights active selections.
- **Styling (`src/style.css`)**: Contains design tokens (`--wb-*`) and Fluent UI styles.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Critique | Analyze current left pane, sync, and state flow; write critique of 3 friction points | None | DONE |
| 2 | Implementation | Refactor Left Pane layout, synchronize selection states across tree/canvas/inspector, and fix undo/redo/checkpoints | M1 | DONE |
| 3 | Review & Challenge | Independent reviewer and challenger tests verification | M2 | DONE |
| 4 | Audit & Victory | Forensic Audit verification, all tests pass, final report | M3 | DONE |

## Code Layout
- `src/` — Main TypeScript source files.
- `public/` — Public assets.
- `e2e/` — Playwright end-to-end tests.
- `.agents/` — Agent coordination directory.

## Interface Contracts
### `state` ↔ `treeView`
- Tree selection changes must update `state.selections` and trigger visual highlight updates.
- State changes (e.g. undo/redo) must re-render the tree view with correct selection classes and checkbox checked/unchecked states.

### `state` ↔ `inspector`
- Selection updates must trigger inspector sections to re-evaluate active node paths and bindings.
- Multi-edit actions on inspector controls must iterate over all paths in `state.selections` and apply updates via standard state actions.

### `state` ↔ `canvas`
- Canvas click selections must update `state.selections`.
- Canvas highlights must match current selections exactly, without layout shift.
