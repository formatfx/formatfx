# Specification: Custom Column Subtypes

*Finalized 2026-06-22 via lisa:plan. Source brainstorm:
`docs/superpowers/specs/2026-06-22-fx-bar-subtypes-design.md`.*

## Overview

A **framework** that lets power users (makers) define named, reusable **rendering
recipes** for SharePoint columns — like Word paragraph styles / CSS classes /
design tokens, but for SP column rendering — plus a built-in **seed catalog**.
A recipe is a *subtype*: a saved, re-applyable formatter that may carry typed
**knobs** (apply-time fill-ins), and that the fx bar can read to offer only
relevant suggestions.

This v1 delivers the data model, the seed catalog, save-as birth, a full
refine/knob editor, snapshot apply with push-update, and the fx-bar rewiring that
fixes the original suggestion-noise complaint.

## Problem Statement

The fx-bar value drop-down mixes useful suggestions with noise: `src/editor/
fxSuggest.ts` builds each slot's list from type-aware templates and then **pads it
with everything** (`out.push(...refs)` adds a reference to every column;
`...values` adds every playground value for the property). The only filter is the
broad SP field type (`date`/`number`/`choice`). The bar knows a column is "a date"
but not whether it's a *due date* vs a *created timestamp* — so it fills gaps with
whatever is lying around. **The missing layer is column _intent_.** Subtypes are
that layer: a named recipe carries the vocabulary the bar should offer, so noise
can be suppressed where intent is known.

## Scope

### In Scope
- **Data model** — a structured `Subtype` record carrying all three facets
  (value→text transform, visual styling, fx-bar vocabulary), plus `MockField`
  gaining `subtype?` and `subtypeArgs?`.
- **Storage** — a new `wb-subtypes` localStorage key holding custom subtypes only,
  schema-versioned; built-in seeds live in code.
- **Seed catalog** — existing `columnPresets` re-expressed as built-in subtypes,
  plus one new value→text seed: **Money** (`symbol`, `decimals` knobs).
- **Apply** — snapshot: bake knobs (apply-time form), write the column formatter,
  tag `field.subtype` + `field.subtypeArgs`; one undoable mutation.
- **Push-update** — opt-in "update the N columns using this" after a refine,
  re-baking each tagged column from its stored args as one batched undoable mutation.
- **Full parameter editor (refine)** — extracted-literals checklist → promote a
  literal to a typed knob (text/number/bool/color/choice) with label + default;
  rename, edit `baseTypes`, edit vocab, delete, fork.
- **Save-as birth** — create a custom subtype from a column's current formatter.
- **fx-bar rewiring (strict)** — when a column has a subtype, the bar offers only
  that subtype's vocab; padding is suppressed (with an empty-vocab fallback).
- **Catalog UI** — the "Format this column" menu becomes the type-filtered catalog
  with Built-in/Yours badges; refine is an inline modal.

### Out of Scope (deferred, confirmed)
- **Elapsed / Until seeds** (relative-time value→text) — deferred until the owner
  supplies the verified relative-time expression.
- **Sharing / tenant storage** — v1 is maker-local localStorage only; team/tenant
  libraries, sync, and permissions are a separate effort.
- **Composition / layering** of subtypes (stacking) — apply replaces the formatter
  wholesale; no merge.
- **Cascade / auto-reflow** — editing a subtype never auto-updates columns;
  refresh is via re-apply or the explicit push-update action.
- **Override / shadow semantics** — a custom subtype never shadows a built-in; you
  fork instead.
- **Fragment-swap knobs** — knobs only substitute literals; behavioral effects are
  the seed author's expression logic.
- **Modified-since-apply tracking** — not tracked in v1 (push overwrites all).

## Data Model

```
type KnobType = 'text' | 'number' | 'bool' | 'color' | 'choice';

interface Knob {
  path: string;        // locates the literal in the formatter tree
  label: string;       // shown in the apply-time form + refine editor
  type: KnobType;
  default: string | number | boolean;
  choices?: string[];  // for type === 'choice'
}

interface Subtype {
  id: string;                 // opaque identity (cosmetic dotted name lives in `name`)
  name: string;               // free display label, e.g. "Money" / "number.money"
  origin: 'builtin' | 'custom';
  forkedFrom?: string;        // source subtype id when created via Save-as from a built-in
  baseTypes: FieldType[];     // the set of field types this fits (e.g. ['number','currency'])
  formatter: SPElement;       // the whole-column formatter tree (the recipe)
  knobs: Knob[];              // literals promoted to apply-time params
  vocab: { refs: string[]; values: string[] }; // what the fx bar should offer
}
```

- `MockField` (in `src/core/types.ts`) gains `subtype?: string` (the applied
  subtype id) and `subtypeArgs?: Record<string, string | number | boolean>` (the
  baked knob answers, keyed by knob label/path).
- **Built-in seeds** are defined in code (immutable, app-versioned). **Custom
  subtypes** are persisted to `wb-subtypes`. Both share the `Subtype` shape; only
  `origin` differs.

## Storage

- New localStorage key: **`wb-subtypes`** (the `wb-` prefix and all existing keys
  remain frozen; introducing a *new* key is allowed by the house rules).
- Shape: `{ version: 1, subtypes: Subtype[] }` (only `origin: 'custom'` records).
- All reads/writes wrapped in `try/catch` (private-mode safe, as `wb-ui-prefs`).
- Seeds are never stored, never deletable — a maker forks a built-in instead.

## User Stories

### US-1: Subtype data model + store
**Description:** As a developer, I want the `Subtype` type, the `MockField`
additions, and a `wb-subtypes` store module so every later piece has a stable
foundation.

**Acceptance Criteria:**
- [ ] `Subtype`, `Knob`, `KnobType` exported from a core module; `MockField` gains
      `subtype?` and `subtypeArgs?`.
- [ ] Store module exposes list/get/save/delete for custom subtypes against
      `wb-subtypes`, schema-versioned `{ version: 1, subtypes: [] }`.
- [ ] Reads/writes are `try/catch`-guarded; a corrupt/missing key yields an empty
      catalog, never a throw.
- [ ] Unit tests cover round-trip persistence, version guard, and private-mode
      fallback.
- [ ] Typecheck/lint/build pass.

### US-2: Seed catalog (existing presets + Money)
**Description:** As a maker, I want built-in subtypes so the catalog is useful on
first run.

**Acceptance Criteria:**
- [ ] Each existing `columnPresets` entry (data-bar, status-pill, traffic-light,
      severity-class, progress-ring, star-rating, date-badge, day-counter, persona,
      facepile, member-count, lookup-chip, link) is exposed as a built-in subtype
      with correct `baseTypes` and `origin: 'builtin'`.
- [ ] A new **Money** seed exists with `symbol` (text, default "$") and `decimals`
      (number, default 2) knobs and a value→text formatter; `baseTypes` includes
      `number` and `currency`.
- [ ] Each seed's `formatter` is schema-valid and its `vocab` is hand-authored.
- [ ] Unit tests assert every seed validates, has ≥1 baseType, and Money exposes
      both knobs.
- [ ] Typecheck/lint/build pass.

### US-3: Catalog menu + zero-knob apply
**Description:** As a maker, I want the "Format this column" menu to show the
subtypes that fit my column and apply one in a click.

**Acceptance Criteria:**
- [ ] The menu lists seeds + customs whose `baseTypes` include the column's type,
      with "Built-in"/"Yours" badges, plus "format manually".
- [ ] Subtypes whose `baseTypes` exclude the column type never appear
      (refuse-don't-guess).
- [ ] Applying a zero-knob subtype writes the column formatter and sets
      `field.subtype` + `field.subtypeArgs = {}` as **one** undoable mutation
      (single Ctrl+Z reverts).
- [ ] e2e: pick a seed → grid renders it; Ctrl+Z restores prior state.
- [ ] Typecheck/lint/build pass.

### US-4: Apply-time knob form
**Description:** As a maker, when I apply a subtype with knobs I want a small form
to fill them in before it bakes.

**Acceptance Criteria:**
- [ ] A subtype with ≥1 knob opens a dialog listing each knob's typed widget
      (text→box, number→numeric, bool→checkbox, color→swatch, choice→dropdown),
      pre-filled with defaults.
- [ ] Invalid input (e.g. non-numeric for a number knob) is refused-and-taught;
      nothing is baked until valid.
- [ ] "Apply" bakes the literals into the formatter and commits **one** undoable
      mutation; the baked answers are stored in `field.subtypeArgs`.
- [ ] e2e: apply Money, set symbol="€", decimals=0 → cell renders accordingly.
- [ ] Typecheck/lint/build pass.

### US-5: Save-as birth
**Description:** As a maker, I want to save a column's current formatter as a
reusable subtype.

**Acceptance Criteria:**
- [ ] A "Save as reusable subtype…" action in the column-format flow prompts for a
      name and creates a custom subtype.
- [ ] `baseTypes` defaults to the source column's type; `formatter` is the column's
      current formatter; `vocab` is **auto-derived** (refs used + literal values set).
- [ ] The new subtype persists to `wb-subtypes` and appears in the catalog as
      "Yours".
- [ ] Saving from a built-in sets `forkedFrom` to that built-in's id.
- [ ] Unit tests cover vocab derivation and persistence; e2e covers the birth flow.
- [ ] Typecheck/lint/build pass.

### US-6: Refine modal + full parameter editor
**Description:** As a power user, I want to open a custom subtype to rename it,
edit where it applies, and promote literals to typed knobs.

**Acceptance Criteria:**
- [ ] A "⋯" on a custom catalog entry opens an inline modal: rename, edit
      `baseTypes` (checklist of compatible types), edit `vocab`, delete, fork.
- [ ] The editor shows an **extracted-literals checklist** (distinct value-literals
      from the formatter); checking one promotes it to a knob with `{label, type,
      default}`; unchecking demotes it.
- [ ] Promotion is **by value**: one value = one knob; every occurrence updates.
- [ ] No raw-JSON free-text editing is required for any of the above (click-safe).
- [ ] Edits persist to `wb-subtypes`; editing a subtype does **not** alter columns
      already using it.
- [ ] Unit tests cover literal extraction + promote/demote; e2e covers a rename +
      one promotion.
- [ ] Typecheck/lint/build pass.

### US-7: Push-update
**Description:** As a maker, after refining a subtype I want to optionally push the
change to the columns already using it.

**Acceptance Criteria:**
- [ ] After a refine, an opt-in "Update the N columns using this" action is offered
      (N = count of columns whose `field.subtype` matches).
- [ ] Push re-bakes each tagged column from its stored `field.subtypeArgs` and
      overwrites its formatter (hand-edits included).
- [ ] The whole push is **one batched** undoable mutation (single Ctrl+Z reverts
      every column).
- [ ] Unit/e2e: refine Money's decimals, push, assert all tagged columns re-baked;
      Ctrl+Z restores all.
- [ ] Typecheck/lint/build pass.

### US-8: fx-bar rewiring (strict vocab)
**Description:** As a maker, I want the fx bar to stop offering noise on columns
whose intent I've declared via a subtype.

**Acceptance Criteria:**
- [ ] When a column has a subtype with **non-empty** vocab, `fxSuggest` offers only
      that subtype's `vocab` refs/values; the `...refs`/`...values` padding is
      suppressed for that column.
- [ ] When a column's subtype has **empty** vocab, the bar **falls back** to today's
      padding (no empty bar).
- [ ] Columns with **no** subtype behave exactly as today.
- [ ] `fxSuggest` unit tests (contract) updated first, then the engine; an e2e
      asserts a tagged column's bar shows vocab and hides unrelated refs.
- [ ] Typecheck/lint/build pass.

## Technical Design

### Integration Points
- `src/core/types.ts` — `Subtype`/`Knob`/`KnobType`; `MockField.subtype?`,
  `MockField.subtypeArgs?`.
- New module (e.g. `src/editor/subtypes.ts`) — the `wb-subtypes` store + the
  built-in seed registry + vocab derivation + knob baking helpers.
- `src/editor/columnPresets.ts` — re-expressed as the built-in seed source.
- `src/editor/cfr.ts` (`toColumnFormatter`) — basis for save-as birth.
- `src/editor/gridView.ts` (`openFormatColumnMenu`, `applyColumnFormatter`) — the
  catalog menu, apply tagging, knob form, refine modal entry, push action.
- `src/editor/fxSuggest.ts` — strict-vocab read of `field.subtype` (US-8).
- `src/editor/fxBar.ts` — surfaces the suggestion changes only as needed.
- `src/style.css` — catalog badges, knob form, refine modal (reuse `wb-` classes).

### Knob baking
A knob's `path` locates a literal in the cloned formatter tree; baking replaces
every occurrence of that literal's value with the maker's typed answer (validated
per `type`). Baking is pure and click-safe; the source subtype is never mutated.

### Apply semantics
Apply deep-clones the subtype's `formatter`, bakes knobs, writes it to the column
(via the existing `applyColumnFormatter` path), and sets `field.subtype` +
`field.subtypeArgs` within the same document mutation.

## Edge Cases
- **Same literal, two meanings** — promoted by value, so both become one knob in
  v1 (accepted).
- **Empty vocab + strict bar** — falls back to padding (US-8 guard).
- **Hand-edited column + push** — overwritten (no modified tracking); Ctrl+Z
  recovers.
- **Corrupt/missing `wb-subtypes`** — empty catalog, never a throw.
- **Subtype applied to an incompatible type** — impossible via UI (filtered);
  programmatic apply refuses.

## Non-Functional Requirements
- NFR-1: Vanilla TypeScript + Vite, **zero runtime dependencies**.
- NFR-2: **One user gesture = one undoable document mutation** (push = one batch).
- NFR-3: **Click-only safety** — no flow can corrupt a formatter via misclick; no
  required raw-JSON editing.
- NFR-4: Generated formatters are schema-valid and refuse-don't-guess (never emit a
  standalone `!`).
- NFR-5: `wb-` CSS prefix and existing localStorage keys stay frozen; only the new
  `wb-subtypes` key is added.
- NFR-6: Test files are contracts — for any generated-expression / engine change,
  change the test first.

## Implementation Phases

### Phase 1 — Foundation (data model, storage, seeds)
- US-1, US-2.
- **Verification:** `npm run build` && `npm test`.

### Phase 2 — Apply core (catalog menu, apply, knob form)
- US-3, US-4.
- **Verification:** `npm run build` && `npm test` && Playwright apply specs.

### Phase 3 — Authoring (save-as, refine/knobs, push-update)
- US-5, US-6, US-7.
- **Verification:** `npm run build` && `npm test` && Playwright authoring specs.

### Phase 4 — Bar rewiring (strict vocab)
- US-8.
- **Verification:** `npm run build` && `npm test` (fxSuggest contract) && Playwright
  bar spec.

## Definition of Done
- [ ] All user-story acceptance criteria pass.
- [ ] All four phases verified.
- [ ] `npm test` green (unit), Playwright green where a browser is available.
- [ ] `npm run build` succeeds; typecheck/lint clean.
- [ ] No existing localStorage key or `wb-` class renamed.

## Open Items / Dependencies
- **Relative-time expression** (owner-held) — required before Elapsed/Until seeds
  can be authored; explicitly out of v1.

## Decision Log (D1–D15 + reversals)
- D1 — A subtype carries all three facets in one record.
- D2 — *(reversed)* bar-rewiring is **in** v1.
- D3 — Structured recipe (named facets), not an opaque blob; apply replaces.
- D4 — Full parameter editor.
- D5 — Mark via extracted-literals checklist, by value.
- D6 — Knobs substitute literals; type drives widget + validation; no fragment-swap.
- D7 — `baseTypes` is a set; dotted name is cosmetic.
- D8 — Flat catalog, opaque ids, Built-in/Yours badges, Save-as forks.
- D9 — *(upgraded)* snapshot apply **+** push-update.
- D10 — New `wb-subtypes` key; seeds in code.
- D11 — Seeds = existing presets re-expressed + Money.
- D12 — Extend the "Format this column" menu; refine is an inline modal.
- D13 — Strict bar: vocab replaces padding on tagged columns; untagged unchanged.
- D14 — Push overwrites all tagged columns; one batched undoable mutation.
- D15 — Vocab auto-derived at birth; empty vocab falls back to padding.
