# Click-header "What do you want to build?" popover — design

**Status: DRAFT design (2026-06-25). Awaiting owner review before writing-plans.**

_Owner: samyost. Brainstormed 2026-06-25 off `origin/main`._

This is the single highest-leverage move from the "blank-page / discovery"
brainstorm: when a maker clicks an **unformatted** grid column, give them a
visual popover — _"What do you want to build?"_ — with large preview cards
(Status pill, Data bar, Traffic light, …) instead of today's text submenu.
Click a card → the column is formatted, one undoable step. It is the Excel
gesture a maker already expects: **click the column, change the column.**

It absorbs two convergent proposals (the "in-place scaffolding" UX shift and
the "inline goals surface" from the discovery brainstorm) into one feature.

---

## 1. Motivation

The capability is already there; nobody finds it. Today, formatting an
unformatted column is a **two-level text-menu hunt**:

1. Click (or right-click) the header → `menuFor` opens a multi-action text
   menu (Format this column · Conditional formatting · Format cells · Style ·
   Copy JSON · Hide).
2. Choose "Format this column" → `openFormatColumnMenu` opens a _second_ text
   menu listing subtype **names** with small icons.

So the on-ramp is buried behind a click, a generic menu, and a second menu —
and the maker chooses by reading words, not by seeing the result. For an
audience that "knows Excel," that is the cognitive-drain moment. The fix is to
make the **primary gesture on an unformatted column** open a visual,
type-matched picker, and to choose by **what it looks like**.

Nothing about the underlying binding changes — this is a new _presentation_ of
the already-tested `subtypesForType` → `applySubtype` path.

## 2. Goals / non-goals

**Goals**
- Clicking an **unformatted, non-group** column header opens the build popover
  as the primary action (no intervening multi-action menu).
- The popover shows **type-matched** subtype cards (`subtypesForType(field.type)`),
  each a **live preview** rendered against the mock rows (the `columnGallery`
  technique), with a Built-in / Yours badge.
- Picking a card applies it as exactly **one undoable mutation** via the
  existing `applySubtype` (zero-knob → instant; knob-bearing → the existing
  apply-time knob form first).
- A **"Blank canvas"** card = "format manually" (the existing `manual()` path).
- A **"More actions…"** affordance opens the existing full `menuFor` text menu,
  so nothing currently reachable is lost (Conditional formatting, Format cells,
  Copy JSON, Hide, Save-as-subtype, etc.).
- Reuse the popover anywhere an unformatted column is started — in particular
  the Column Formatters gallery's _"Not yet formatted"_ rows
  (`openColumnFormatMenuFor`) route to the same popover.
- Fully click-safe and keyboard-accessible: cards are real `<button>`s,
  focusable, Enter/Space activate; Esc / outside-click closes.

**Non-goals (YAGNI)**
- **No `goals.ts` catalog module.** The subtype catalog already _is_ the goal
  source, per type. We render it visually; we do not build a parallel catalog.
- **No filter/search box.** A single column's type yields only ~2–3 matches;
  a filter is dead weight here. (The filter belonged to the deferred
  whole-app launcher, not this per-column popover.)
- **No launcher overlay.** The fresh-visit Start overlay remains explicitly
  deferred (it was the cut-first piece). This spec is the inline surface only.
- **No change to formatted / linked / group columns.** Those keep today's
  `menuFor` menu unchanged — the popover is strictly the _unformatted_ on-ramp.
- **No new persisted state, no new localStorage keys.** Frozen-key rule intact.
- **No "recipe" / cross-column goals** (tracked in issue #84).
- **No live-rendered _example-project_ thumbnails** (issue #85); this spec
  renders _column subtype_ previews only, which `columnGallery` already does.

## 3. The interaction

```
Maker clicks an unformatted column header "DueDate"
        │
        ▼
┌─────────────────────────────────────────────┐
│  Format DueDate — what do you want to build? │
│  ┌───────────┐ ┌───────────┐                 │
│  │ ▤ ▤ ▤     │ │  3d left  │   ← live previews│
│  │ Due-date  │ │  Days     │     vs mock rows │
│  │ badge     │ │  counter  │                  │
│  │ Built-in  │ │ Built-in  │                  │
│  └───────────┘ └───────────┘                 │
│  ┌───────────┐                               │
│  │  (blank)  │   Blank canvas                 │
│  └───────────┘                               │
│  ───────────────────────────────             │
│  ⋯ More actions                              │
└─────────────────────────────────────────────┘
```

- Anchored under the clicked header, kept on-screen (same positioning logic as
  `columnGallery`).
- Cards in `subtypesForType(field.type)` order; built-ins first, "Yours" after
  (the catalog already orders this).
- Each card: live preview block (up to 3 mock rows via `renderElement`, with
  the `columnGallery` try/catch fallback to an icon + label on render error) +
  name + origin badge.
- **Blank canvas** card is always present (even when the type has no matched
  subtypes — that case shows _only_ Blank canvas, replacing today's silent
  jump to a blank formatter so the maker still sees a deliberate choice).
- **More actions** opens `menuFor(col, header, onToast)` unchanged.

## 4. Architecture

One new module; small, surgical edits to two existing files.

### New: `src/editor/buildPopover.ts`
A self-contained floating popover (peer of `columnGallery.ts` — same
open/close/outside-click/Esc lifecycle, same anchored positioning). Exports:

```ts
openBuildPopover(col: GridColumn, field: MockField, anchor: HTMLElement,
                 onToast: (m: string) => void): void
```

Responsibilities (presentation only — no binding logic of its own):
- List `subtypesForType(field.type)`; render each as a preview card using
  `renderElement` against `state.rows` (lift/share the `previewCtx` +
  `resolveColumnRef` helpers from `columnGallery.ts` rather than duplicating —
  extract them to a tiny shared `previewCtx.ts` if cleaner).
- Card click → `applySubtype(col, field, st, onToast)` (re-exported from
  `gridView.ts`), then close. Zero-knob applies instantly; knob-bearing opens
  the existing knob form (which closes the popover on Apply).
- Blank-canvas click → the existing manual path (`applyColumnFormatter(col,
  field, defaultColumnFormatter(field), …)`), then close.
- More-actions click → `menuFor(col, anchor, onToast)`, then close.

`GridColumn`, `applySubtype`, `menuFor`'s building blocks, and
`defaultColumnFormatter` already exist in `gridView.ts`; the minimal export
surface needed by the popover is added there (e.g. `applySubtype`,
`gridColumnForField` is already exported).

### Edit: `src/editor/gridView.ts`
- Header `click` handler: when the column is **unformatted and not a group**,
  always open `openBuildPopover` instead of `menuFor` (the popover always
  offers at least Blank canvas + More actions, so it is the right surface even
  when the type has zero matched subtypes). Formatted / linked / group columns
  and the Ctrl/Cmd-multiselect path are unchanged.
- Keep **right-click (`contextmenu`)** → `menuFor` as the power-user "full
  menu" shortcut (discoverable escape hatch, unchanged behavior).
- Export `applySubtype` (and any small helper the popover needs) so the new
  module can call the tested binding without copying it.

### Edit: `src/editor/columnGallery.ts`
- The _"Not yet formatted"_ rows already call `openColumnFormatMenuFor`. Point
  that path at the build popover too (via `gridColumnForField` → `openBuildPopover`)
  so the gallery and the header give the same visual experience.

### Data flow (unchanged underneath)
```
click → openBuildPopover → applySubtype → commitSubtype
      → state.applyColumnSubtype(field.name, baked, st.id, args, col.path)
      → ONE mutateDocument → grid re-renders the column → toast → Ctrl+Z reverts
```

## 5. Edge cases & safety

- **No matched subtypes for the type:** popover shows only Blank canvas
  (deliberate choice preserved; no silent behavior).
- **Preview render throws:** card falls back to `subtypeIcon` + name (mirrors
  `columnGallery`'s catch) — a bad preview can never block formatting.
- **Knob-bearing subtype:** unchanged refuse-and-teach apply-time form; nothing
  bakes until valid. Click-only safety preserved end to end.
- **Group / formatted / linked columns:** untouched — `menuFor` as today.
- **Unplaced field (path `[]`):** `gridColumnForField` already yields a
  synthetic column so `applyColumnFormatter`/`applySubtype` register + open
  without a grid mutation — the gallery entry point works identically.
- **Accessibility (addresses a known gap):** cards are focusable `<button>`s
  with `aria-label` naming the subtype; the popover is keyboard-traversable;
  honors `prefers-reduced-motion` for any open animation.

## 6. Testing (tests are contracts)

**Unit / jsdom (`buildPopover.test.ts`)**
- For a `date` field, the popover lists exactly the `subtypesForType('date')`
  cards plus Blank canvas plus More actions.
- For a type with no matches, only Blank canvas + More actions render.
- Clicking a **zero-knob** card calls `state.applyColumnSubtype` exactly once
  (one undoable mutation) and closes the popover.
- Clicking a **knob-bearing** card opens the knob form and does _not_ mutate
  until Apply.
- A subtype whose preview render throws still renders a clickable card
  (icon fallback) and still applies.

**e2e (`grid.spec.ts` addition)**
- Click an unformatted header → visual popover with preview cards appears.
- Click "Status pill" → the column renders pills across rows; one Ctrl+Z
  reverts to the unformatted column.
- Right-click the same header → the full `menuFor` text menu still appears.

No engine/generated-expression semantics change, so no `core.test.ts` /
`condRules.test.ts` edits are expected.

## 7. Build order

Single stage (this is deliberately _one thing_):
1. Extract the shared preview context (`previewCtx` + `resolveColumnRef`) if it
   reduces duplication; export `applySubtype` from `gridView.ts`.
2. Build `buildPopover.ts` + its unit tests.
3. Wire the header click and the gallery's "Not yet formatted" path.
4. Add the e2e case.
5. Verify: `npm run build`, `npm test`, Playwright when a browser is available.

## 8. Out of scope, recorded

- Whole-app **Start launcher** overlay (fresh-visit goals + examples + "use my
  data") — deferred; gate on whether this inline popover moves the needle.
- **Recipe** goals (cross-column / row-level) — issue #84.
- **Live-rendered example-project** thumbnails — issue #85.
- **Contextual "Format pane"** reframe of the inspector (t-shirt sizes / visual
  style cards / Advanced toggle) — a separate, related effort; not this spec.
