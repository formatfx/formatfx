# TRIGGER MODEL — one workflow for binding content to hover cards, click cards and row actions

> Design exploration for issue #204, written 2026-07-05. **Direction proposed,
> not locked** — nothing here is canon until the owner signs off. Companion to
> the hover-reveal work (issue #203, shipped: HANDOFF §3.7, lint pairing rules,
> the inspector "Reveal on hover" toggle, the canvas simulate-hover pin).
> Includes the advanced-toolbox authoring-parity audit (#203 item 4).

## 1. Problem

A maker can design a component that ends up *being* a hover card
(`customCardProps.formatter`) on a column or view, or being the body of a
click action. Today there is no shape for **the trigger** — the thing that
says *when and where this content appears*. Two unanswered questions from
issue #204:

1. **Where does the trigger get defined?** In the component ("I am a hover
   card"), or at apply time ("attach this component to that division, open on
   hover")?
2. **What does the apply gesture look like?** There is no consistent step in
   the mental model where "content meets trigger", and it needs to happen the
   same way across all three formatter modes (view, column, components).

## 2. Proposed answer to question 1: triggers live at APPLY time

A component stays trigger-agnostic content. The act of applying it binds it to
a **host element + event**. Reasons:

- **Reusability** — the same card body can be a hover card on one column and a
  click flyout on another. Baking `openOnEvent` into the component forks the
  component per trigger.
- **It matches the schema.** SharePoint itself puts the trigger on the *host*
  (`customCardProps`/`customRowAction` are properties of the element you
  hover/click), not on the card body. Apply-time binding mirrors the JSON we
  ship, so Code view stays legible.
- **It lines up with the knob machinery (issue #150 / subtypes).** A knob is
  an apply-time fill-in (`docs/specs/custom-column-subtypes.md`); the trigger
  is the biggest knob. The apply-time form the subtypes flow already renders
  (`gridView.ts` knob form) is the natural home for the trigger picker — same
  moment, same dialog family, same "bake at apply" semantics
  (`subtypes.ts` baking).
- **Precedent in the codebase already works this way.** The component mapper
  (`componentLibrary.ts` → `bindComponentInstance` → one undoable write via
  `state.insertNode` / `state.applyRowTemplate`) is an apply-time binding
  dialog: slots → columns. The trigger is one more section of that dialog,
  not a new surface.

What stays *in* the component: nothing trigger-shaped. A component may hint
("designed as a card body" — e.g. its root uses the `sp-card-*` scaffold), and
the picker can use that hint to preselect "open card", but the hint is
cosmetic, never binding.

## 3. Proposed answer to question 2: the apply gesture (drop-target model)

When a component is applied **as a card or action**:

1. **Show candidate host divisions.** Highlight divisions that
   (a) have children, and (b) carry **no existing `customRowAction` or
   `customCardProps` anywhere in their subtree** (no trigger collision —
   nested/overlapping triggers are parked in #205).
   The candidate scan is a pure tree walk, same family as
   `componentUsage.ts` and the linter's subtree scans.
2. **Baseline gesture: a click-based "Apply to…" picker** listing the same
   candidate divisions (by `_elmName`/breadcrumb, hover-highlights the canvas
   region). Click-only and misclick-resistant per house rules.
   **Drag-and-drop onto the highlighted division is the aspirational
   upgrade**, same drop plumbing the canvas already has for palette items and
   components (`canvas.ts` drop targeting) — but D&D is never the only path.
3. **The drop/pick layers the trigger onto the division**, generating the
   robust pattern by construction (see §5).
4. **Follow-up options, fixed vocabulary** (a small form, prefilled with
   defaults — every field optional to touch):

   | knob | values | schema landing spot |
   |---|---|---|
   | event | hover \| click | `customCardProps.openOnEvent` |
   | action kind | open card \| defaultClick \| executeFlow \| setValue \| link | `customCardProps` vs `customRowAction.action` vs `a href` |
   | cursor | pointer \| default | `style.cursor` on the trigger surface |
   | card placement | `directionalHint` (the `DIRECTIONAL_HINTS` list), `isBeakVisible` | `customCardProps` |

   Nothing outside this vocabulary is offered. `executeFlow`/`setValue`
   parameter completeness is already lint-gated (`flow-missing-id`,
   `setvalue-missing-target`) — the form refuses to finish with blanks rather
   than shipping a dead action (refuse and teach; deploys are lint-gated).

**One drop = one undoable document mutation**: wrapper/overlay div + trigger
props + bound component reference commit together through one
`state.mutateDocument()` (the inspector/`componentLibrary` precedent — and the
same contract the #203 "Reveal on hover" toggle just shipped with: both class
edits, one undo step).

**Same surface and vocabulary in all three modes.** View mode: candidates come
from the row tree. Column mode: from the cell tree. Components mode: applying
*onto* a component draft uses the draft's tree. The picker is one module; the
mode only changes which root it scans.

## 4. Relationship of the two trigger kinds

Two things both read as "appears on interaction" and must not be conflated in
the UI:

- **Style-level trigger — hover-reveal** (`sp-card-showOnHoverParent/Child`):
  content is already in the DOM, CSS reveals it. Shipped as a first-class
  toggle in #203. No collision constraints — it can nest freely.
- **Structural trigger — cards and actions** (`customCardProps`,
  `customRowAction`, `sp-card-defaultClickButton` overlay): content lives
  elsewhere (callout) or an action fires. This is what the apply workflow in
  §3 governs, and where collision rules apply.

The inspector should eventually present them as one "On hover / On click"
family ("reveal element" | "open card" | "run action"), but the schema
mechanics stay separate underneath.

## 5. Generate the robust pattern, don't lint it after the fact

The linter knows children swallow `customCardProps` clicks
(`card-trigger-button`, `linter.ts`). The workflow must never produce the
pattern that rule exists to catch:

- **Click trigger on a division with children** → generate the
  **overlay pattern**: an absolutely-positioned child
  (`sp-card-defaultClickButton` — already themed in `theme.ts`:
  `position:absolute;inset:0;z-index:1`) carries the `customRowAction`/
  `customCardProps`; the division only gains `position:relative` if it isn't
  positioned already.
- **Trigger on a leaf** → put the props straight on it, preferring
  `elmType: button` with direct `txtContent`.
- **Hover card** → props go on the division directly (hover isn't swallowed
  by children the way click is).

## 6. Advanced-toolbox authoring parity audit (#203 item 4)

Where each advanced concept stands today, and the authoring gap:

| concept | engine support today | authoring gap → proposed answer |
|---|---|---|
| `sp-card-showOnHoverParent/Child` | schema suggestions, `theme.ts` emulation, lint pairing rules, inspector toggle, canvas pin (all #203) | **closed** — first-class as of #203 |
| `customCardProps` | full: renderer flyout, linter, inspector section (enable/openOnEvent/directionalHint/JSON body), select-card-root button | body is edited as raw JSON or via drill-in; **binding a component as the body is the #204 workflow (§3)** |
| `customRowAction` | full: renderer stub+toast, completeness lint, inspector section (action/actionInput/actionParams) | raw fields; wants the §3 fixed-vocabulary form (esp. flow picker / setValue form) |
| `sp-card-defaultClickButton` | themed in `theme.ts`, class suggestion | never generated; **becomes the §5 overlay pattern the workflow emits** |
| `defaultHoverField` | schema + inspector free-text field; **not emulated** in preview (HANDOFF §4) | low priority: field-picker dropdown + a preview affordance (even a badge) so makers know it did something |
| `inlineEditField` | schema + inspector free-text; renderer shows indicator only; works-in-forEach canon (§3b) | field-picker limited to Text/Person; true inline-edit preview is a separate feature |
| `columnFormatterReference` | full subsystem (registry, cycle protection, CFR drill-in, blast radius) | **closed** — already first-class |
| `openOnEvent` / `directionalHint` / `isBeakVisible` | types, renderer, inspector selects, tests | folded into the §3 vocabulary so they're set at bind time, not hunted for afterwards |

Priority order suggested by the audit: (1) the §3 apply workflow (unlocks
components-as-cards, the biggest maker win), (2) `customRowAction` param
forms, (3) `defaultHoverField`/`inlineEditField` pickers.

## 7. Out of scope

- Nested/overlapping click triggers and the z-order "elevation" view — parked
  in #205; the §3 candidate filter (no trigger in subtree) is what keeps this
  out of scope safely.
- Emulating `defaultHoverField`'s OOTB card in the preview.
- Any new runtime dependency, localStorage key or `wb-` prefix change — none
  needed.

## 8. Open questions for the owner

1. Does the trigger picker live inside the existing component mapper dialog
   (one more section) or as a second step after slot mapping? (Proposal: same
   dialog, collapsed "Where should this appear?" section, defaulting to
   "replace selection / add as element" so plain applies stay one click.)
2. When a maker picks "open card" on a division that already carries a
   *hover-reveal* (style-level) trigger, do we warn, allow silently, or
   offer to convert? (Proposal: allow — they compose safely — but explain in
   the picker's fine print.)
3. Is `link` (plain `a href`) worth having in the action vocabulary, or does
   it stay an element-level concern outside the trigger model? (Proposal:
   keep it — makers think "click → go somewhere" as one family.)
