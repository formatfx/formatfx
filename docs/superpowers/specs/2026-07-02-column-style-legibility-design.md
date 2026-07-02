# Column-style legibility — design ("violet = shared")

**Date:** 2026-07-02 · **Status:** approved by owner (brainstorm w/ visual companion)

## Problem

Users cannot easily maintain the mental model distinguishing the five
entities the editor juggles:

1. a **CFR** — a column's registered shared formatter (`state.columnRefs`),
2. the **row** — the main view formatter on the grid,
3. an **element on the row**,
4. an **element inside a CFR**, and
5. a **host cell** — a row-owned element carrying `columnFormatterReference`,
   which renders the CFR inline but owns none of its content.

The confusion is systemic (owner confirmed all four symptoms): the canvas
looks identical when editing a CFR vs the view; linked and local cells look
the same at rest; edit scope (this view vs everywhere) surprises; and the
Structure tree doesn't convey the containment/reference relationships. The
shipped breadcrumb (`src/editor/breadcrumb.ts`) answers *where am I* but not
*what owns what* at the point of interaction.

## Locked decisions

- **Vocabulary — Office "style", not Figma "component".** A CFR is a
  **column style**; a plain styled cell is **direct formatting**; the
  wrapper is the **host cell**. The **§ glyph** is the style mark
  everywhere. Internal names (`cfr.ts`, `columnFormatterReference`,
  `columnRefs`) are unchanged — presentation only.
- **Interaction — drill-in (Figma-style), not gates/prompts.** Double-click
  on style content enters the style for editing; single-click selects the
  host cell, whose edits are always local to the view — and the UI must say
  so at the moment of interaction.
- **Visual language — Approach A (signature color) + B's name-tag.** One
  reserved violet-family accent used *only* for style-owned things, in every
  surface, at rest and while editing; the selected linked cell additionally
  shows a corner name-tag naming the style.
- **Tree — opaque stub.** The style is a door, not a folder: one
  non-expandable violet link node under the host cell; opening it drills in.
  (Rejected: transparent read-only peek — two selection grammars in one
  pane; badge-only cross-references — tells rather than shows.)
- **No isolation editor.** Drilled-in editing stays in context on real rows
  (the rest of the grid dims); a lone-swatch editor was rejected as fighting
  the paint-on-real-rows confidence story.

## Design

### 1. Copy pass (style vocabulary)

All user-facing copy adopts the style vocabulary:

- "Format this Column" → **"Edit the {Field} style"**
- promote (`toColumnFormatter`) → **"Save as the {Field} column style"**
- fork / "Override in this view" (`inlineColumnFormatter`) →
  **"Detach from style (format just this cell)"**
- Blast-radius tooltips reworded accordingly ("shared with N places" stays,
  anchored to "the {Field} style").

Playwright specs that locate menus by text are updated in the same commit
as each rename.

### 2. Signature color

A violet-family accent reserved exclusively for style-owned surfaces.
Exact hue chosen during implementation to pass WCAG contrast in **both
themes** (the 2026-07 design-pass floor applies). Delivered as new
`--wb-shared-*` custom properties and new `wb-`-prefixed classes —
strictly additive; frozen class/key names untouched.

### 3. Grid at rest

- Every linked cell: violet inset left edge (`box-shadow: inset`-style rail).
- Linked column header: `§ {Field}` + small violet "style" chip.
- Selecting a linked cell: normal blue selection outline on the **host
  box**; a small corner **name-tag** ("{Field} style") sits on the content.
- Hovering style content: violet outline + tooltip
  "{Field} style — double-click to edit (used in N places)".
- Host-level edits (area weight, box borders, padding) behave exactly as
  today and stay local to the view.

### 4. Scope chip (fx bar)

Always visible next to the fx bar, naming what an edit will hit:

- **"Host cell · this view only"** — neutral/selection blue, or
- **"{Field} style · N places"** — violet; N from the existing
  `cfrBlastRadius` (`src/editor/cfr.ts`).

### 5. Drill-in editing

- Double-click style content (or open the tree stub) → enter the style:
  violet 2px canvas frame; banner
  "§ Editing the {Field} style — used in N places · changes apply
  everywhere" with a **Done** button; non-style columns/rows dim but keep
  rendering (in-context preview preserved).
- Exit via Done, Esc, or the existing breadcrumb Back — all equivalent.
- Drill-in/out is **pure navigation, never an undo step**. Fork and promote
  remain one undoable mutation each (existing invariant).

### 6. Structure tree (opaque stub)

- Under a host cell: exactly one violet, non-expandable node —
  `§ {Field} style · used in N places → open`. Activating it drills in
  (canvas + tree swap together, banner appears).
- When drilled in, the tree shows the style's own element tree under a
  violet § header.
- The existing bottom column-formatters section keeps its shape, restyled
  with §, violet, and usage badges (`⤷ in view` copy joins the style
  vocabulary).

### 7. Testing

- **Unit (vitest, pure):** scope-chip derivation (selection → chip label
  and scope) and blast-radius copy live beside `cfr.test.ts`; no DOM.
- **Playwright:** drill-in/out flow (double-click, Done, Esc, Back);
  name-tag appears on linked-cell selection; tree stub opens the style;
  copy renames (menu locators updated with them); scope chip flips between
  host and style contexts.

## Constraints (standing, restated)

Vanilla TS + Vite, zero runtime deps. One gesture = one undoable mutation
(navigation excluded). `wb-` prefix and localStorage keys frozen — all new
CSS is additive. Dark-mode + WCAG floor per the 2026-07 design pass.

## Out of scope

- Choosing the exact violet hue (implementation-time, with contrast
  validation in both themes).
- Any change to CFR semantics, serialization, or `cfr.ts` transforms.
- Style management features beyond legibility (rename/duplicate/delete
  flows keep their current behavior, re-worded only).
