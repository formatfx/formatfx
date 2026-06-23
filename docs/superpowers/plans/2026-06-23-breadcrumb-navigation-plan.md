# Breadcrumb navigation — implementation plan

**Source spec:** `docs/superpowers/specs/2026-06-22-breadcrumb-navigation-design.md`
(APPROVED 2026-06-22). **Branch:** `claude/keen-bardeen-janrfj`.
**Method:** test-first per house rules — change the contract (test), watch it
fail, then make it pass.

This plan turns the approved design into ordered, individually-verifiable
tasks. Each task names the file(s), the test that proves it, and the success
gate. Run `npx vitest run` after every unit task and the relevant
`PW_EXECUTABLE=/tmp/chromium npx playwright test <spec>` after every e2e task.

## Ground truth captured during research

- **Topbar** (`src/main.ts:37-44`) holds `Editing`+`#wb-activedoc` `<select>`
  and the `#wb-dest-chip` `<span>`. The **ribbon** (`src/main.ts:71-73`) holds
  only `#wb-ribbon-cols` (`▦ Formatted columns`).
- The active-doc `<select>` is wired by `refreshActiveDocSel()`
  (`main.ts:504-534`) which ALSO disables `#wb-kind` / `#wb-example` off the
  main doc — that side effect must be preserved when the select is removed.
- The in-canvas Back is `backToMainBar()` (`canvas.ts:100-113`), appended in the
  `column` branch (`canvas.ts:130`); class `.wb-back-bar .wb-rowview-back`.
- The header "Format this column" flow is `openFormatColumnMenu` →
  `applyColumnFormatter` (`gridView.ts:71-108`). `applyColumnFormatter` only
  CFR-wires when `!col.el.columnFormatterReference && col.path.length > 0`, so a
  synthetic `{ el, path: [] }` column makes it "register + open, no grid
  mutation" — exactly the unplaced branch the spec wants. `openColumnRef`
  resets the undo stack, so the header path already loses its cell-swap undo on
  open; the menu path mirrors that (no new undo guarantee to preserve).
- `formattedColumnNames()` = `Object.keys(state.columnRefs)`. Not-yet-formatted
  = `state.fields` with no `columnRefs` entry (exclude `protected` fields like
  ID — they are never formatted and `gridScaffold` never places them).
- Tail label for a column uses `field.displayName ?? field.name`
  (matches `columnGallery`'s card labels).
- `serializeProject`/`loadProject`/`resetAll` are at `state.ts:250-318`;
  `importedViews` shows the additive-field pattern to copy for `viewName`.
- `tsconfig` has `noUnusedLocals`/`noUnusedParameters` → remove dead imports.
- Tests baseline green: 289 vitest, build OK. Browser:
  `PW_EXECUTABLE=/tmp/chromium` (extracted via `@sparticuz/chromium`).

---

## Phase 1 — state: `viewName` + persistence (design F)

**Task 1.1 (test).** In `src/editor/state.test.ts` add a `describe('view name')`:
default is `'View 1'`; `setViewName('Sprint board')` changes it without pushing
an undo step (snapshot undo length unaffected — assert via a probe mutation +
single undo round-trip); `serializeProject()`→`loadProject()` round-trips the
name; a project payload missing `viewName` loads as `'View 1'`; `resetAll()`
returns it to `'View 1'`.

**Task 1.2 (code).** In `state.ts`: add `viewName = 'View 1'` field;
`setViewName(name)` → assign `name.trim() || 'View 1'`, `emit('data')` (no
snapshot, not undoable); add `viewName` to the `serializeProject()` object
(additive, no version bump); read `typeof p.viewName === 'string' ? … : 'View
1'` in `loadProject()`; reset to `'View 1'` in `resetAll()`.

**Gate:** `npx vitest run state` green.

---

## Phase 2 — shared "format a column" entry for any field (design D wrinkle)

**Task 2.1 (code, refactor — no behavior change).** In `gridView.ts` export a
resolver + opener that reuse the existing menu/apply path:
- `gridColumnForField(field): GridColumn` — when `activeDocKey==='main' &&
  doc.kind==='grid'`, return the placed child whose `gridColumnField === name`
  (path `[i]`); otherwise a synthetic `{ el: { elmType:'div' }, path: [] }`.
- `openColumnFormatMenuFor(field, anchor, onToast)` — calls the existing
  `openFormatColumnMenu(gridColumnForField(field), field, anchor, onToast)`.

These are pure additions; existing header behavior is untouched, so the full
`grid`/`cfr` suites must stay green (the regression guard for this task).

**Gate:** `npx vitest run` green; `PW_EXECUTABLE=/tmp/chromium npx playwright
test grid.spec.ts cfr.spec.ts` green.

---

## Phase 3 — Column Formatters menu (design D — extend `columnGallery.ts`)

**Task 3.1 (test).** Extend `columnGallery.test.ts`: a "Not yet formatted" group
lists every unformatted, non-protected field as a row (`.wb-colgal-newrow`),
none for already-formatted columns; clicking a not-yet row reaches the
format-column flow (assert it registers a formatter + opens it, e.g. click
`DueDate`'s row then `state.activeDocKey === 'DueDate'` after the manual path —
or assert the `.wb-grid-menu` "Format …" opens). Keep the existing 4 assertions
passing (cards = formatted count; empty note still shows when `columnRefs={}`).

**Task 3.2 (code).** In `columnGallery.ts`: keep the Formatted cards (rename the
panel head to "Column Formatters", add a "Formatted" sub-label). Append a "Not
yet formatted" sub-group of `.wb-colgal-newrow` buttons (name only, no preview)
for `state.fields.filter(f => !f.protected && !(f.name in state.columnRefs))`;
click → `closeColumnGallery()` then `openColumnFormatMenuFor(field, anchor,
onToast)`. Signature `openColumnGallery(anchor, onToast)` unchanged.

**Gate:** `npx vitest run columnGallery` green.

---

## Phase 4 — View Formatters menu (design E — new `viewMenu.ts`)

**Task 4.1 (test).** New `src/editor/viewMenu.test.ts` (happy-dom): `openViewMenu`
renders one row with the current `state.viewName` and a Rename action; Rename
reveals an `<input>` prefilled with the name; Enter commits via `setViewName`
(state updated, menu closed); Esc cancels (name unchanged).

**Task 4.2 (code).** New `viewMenu.ts`: `openViewMenu(anchor, onToast)` builds a
small panel (reuse `wb-grid-menu` chrome or a dedicated `wb-viewmenu`), lists the
view name, Rename → inline input (Enter commits `state.setViewName(v.trim()||'View
1')` + toast, Esc cancels, blur commits). One state call.

**Gate:** `npx vitest run viewMenu` green.

---

## Phase 5 — breadcrumb component (design B/C) + Back relocation

**Task 5.1 (code).** New `src/editor/breadcrumb.ts`: `mountBreadcrumb(host,
onToast)` renders, into the ribbon, `[root ▾] › [tail]` + a right-aligned Back;
subscribes to `data`/`load`/`kind`. Shape from `activeDocKey`/`doc.kind`:
- main + grid/row/tile → root `View Formatters ▾` (→ `openViewMenu`), tail =
  `state.viewName`.
- main + column → root `Column Formatters ▾` (→ `openColumnGallery`), tail =
  `displayName ?? currentFieldName`.
- drilled (`activeDocKey!=='main'`) → root `Column Formatters ▾`, tail =
  `displayName ?? activeDocKey`.
Root = `button.wb-crumb.wb-crumb-root`; tail = non-interactive
`span.wb-crumb.wb-crumb-tail`; Back = `button.wb-crumb-back` shown only when
drilled, text `← Back to {viewName} view formatter`, `→ state.openMain()`.

**Task 5.2 (code).** Trim `canvas.ts`: remove `backToMainBar()` and its call in
the `column` branch (Back now lives in the ribbon).

**Gate:** `npx vitest run` green; app still builds.

---

## Phase 6 — wire into the shell (design A/G) + CSS

**Task 6.1 (code).** `main.ts`:
- Remove the `Editing`+`#wb-activedoc` and `#wb-dest-chip` from the topbar
  markup; remove `#wb-ribbon-cols` from the ribbon and add `<div
  id="wb-breadcrumb" class="wb-breadcrumb"></div>` in the ribbon.
- Delete `refreshActiveDocSel`, the activeDoc change handler + its subscribe,
  `updateDestChip`/`destChip` + its subscribe, the `#wb-ribbon-cols` click
  handler, and the now-unused `formatterDestination`/`openColumnGallery`(direct)
  imports as appropriate.
- Add `refreshStudioDisabled()` (kind/example disabled off the main doc),
  subscribed on `data`/`load`/`kind`, to preserve that side effect.
- `mountBreadcrumb(document.getElementById('wb-breadcrumb')!, toast)`.

**Task 6.2 (code).** `style.css`: add `.wb-breadcrumb`, `.wb-crumb`,
`.wb-crumb-root`, `.wb-crumb-sep`, `.wb-crumb-tail`, `.wb-crumb-back`
(additive, `wb-` prefix). Retire `.wb-ribbon-cols` rule (id removed).

**Gate:** build OK; `npx vitest run` green.

---

## Phase 7 — rewrite the e2e contracts (design H)

Rewrite each removed/relocated assertion, then add the new spec. Run each after
editing.

- **7.1 `maker.spec.ts`** (`:57`,`:66`) — `#wb-dest-chip` → breadcrumb shape
  (root text + tail text).
- **7.2 `grid.spec.ts`** (`:38`,`:61`,`:62`,`:69`,`:71-73`,`:74`,`:182`,`:206`)
  — `#wb-activedoc` value → tail text; `#wb-dest-chip` → shape;
  `.wb-back-bar .wb-rowview-back` → `.wb-crumb-back`.
- **7.3 `cfr.spec.ts`** (`:45`,`:46`,`:55`) — tail crumb + Column Formatters
  menu listing instead of `#wb-activedoc`/chip.
- **7.4 `areas.spec.ts`** (`:74`) — `#wb-dest-chip` "tile layout" → tile-view
  breadcrumb shape (root `View Formatters`, tail `View 1`).
- **7.5 `sandbox.spec.ts`** (`:138`,`:156`) — `#wb-activedoc`/`#wb-ribbon-cols`
  visible → breadcrumb root + tail visible.
- **7.6 `workspace.spec.ts`** (`:270`) — `#wb-activedoc` value → tail crumb.
- **7.7 new `breadcrumb.spec.ts`** — the two menus open from the root; the three
  breadcrumb states; Rename round-trips + persists across reload; the
  Not-yet-formatted group starts a formatter; relocated Back returns to the
  named view.

**Gate:** `PW_EXECUTABLE=/tmp/chromium npx playwright test` fully green.

---

## Phase 8 — verify + ship

`npm run build`, `npx vitest run`, full Playwright suite green. Commit per
phase or as one reviewed change; push to `claude/keen-bardeen-janrfj`. Per
`CLAUDE.md` end-of-session contract, open a PR to `main` (never merge).

## House-rule checks (carried through every phase)

Zero new deps; `setViewName` is metadata (off the undo stack); every breadcrumb
action is navigation or one guarded create (click-only safety); frozen
localStorage key + `wb-` prefix untouched (`viewName` is an additive payload
field, no version bump); no new generated expressions.
