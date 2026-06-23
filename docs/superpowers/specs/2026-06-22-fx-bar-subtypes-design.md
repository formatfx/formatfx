# fx-bar maturity → Custom Column Styles & Subtypes

**Status: DRAFT — brainstorm in progress, NOT finished, NOT approved.**
Do **not** implement yet — the brainstorming HARD-GATE is still in force
(present a finished design, get the owner's approval, write the final spec,
*then* writing-plans). Resume by asking the one open question at the bottom.

_Brainstorm opened 2026-06-22. Owner: samyost._

---

## Why this exists (the motivation)

The fx-bar value drop-down (the on-focus styled menu added in `c442cb9`)
mixes genuinely useful suggestions with noise — e.g. it will offer `=[ID]`
when you're formatting a **date** column. The owner wants a "mature, pro"
bar with a north star to build toward, and proposed the cure:

> **Custom Column Styles and Subtypes** — let power users define custom
> styles / create their own subtypes for columns. Examples given:
> `number.money`, `date.elapsed`, `date.until`.

### Root cause of the noise (verified in code)

`src/editor/fxSuggest.ts` builds each slot's suggestion list from a few
type-aware templates and then **pads it with everything**:

- `out.push(...refs)` appends a reference to **every column** in the list.
- `...values` appends **every** playground value for that CSS property.

The only filter is the broad SharePoint field type (`date` / `number` /
`choice` …). So the bar knows a column is "a date" but has no idea it's a
*due date* vs. a *created timestamp* — and fills the gaps with whatever's
lying around. **The missing layer is column _intent_.** Subtypes are that
layer.

---

## Locked decisions (owner-confirmed)

1. **A subtype IS a rendering recipe** (chosen over "relevance lens" and
   "both"). A *named, reusable formatter* a power user defines once and
   reapplies — Word paragraph styles / CSS classes / design tokens, but for
   SharePoint column rendering. The examples (`number.money`,
   `date.elapsed` → "3 days ago", `date.until` → countdown) are mostly
   **value→text transforms** (how the cell's displayed value reads), not
   pure visual styling. **The bar getting smarter is the downstream payoff
   of subtypes, not the primary mechanism.**

2. **Authoring is HYBRID ("C")** — save-as is how a custom subtype is
   *born* (no blank-page editor to learn), and a saved subtype can then be
   *opened to rename + refine*. Most makers never leave save-as; power
   users get the depth. (Owner originally pictured a top-down style-library
   editor "B", but values the accessibility of bottom-up save-as "A" — C
   unifies them.)

## Working premises (assumed, confirm when resumed)

- **Base-type parenting:** a subtype is parented to exactly one SP field
  type (`number.money` only applies to number columns), so it only offers /
  applies where it fits — keeps refuse-don't-guess.
- **Knobs are apply-time fill-ins:** SharePoint has no runtime inputs, so a
  "knob" can only be a prompt *at apply time* that bakes a literal into the
  expression (drop `number.money` on a column → it asks "currency symbol?"
  → answer is baked in). This makes knobs cheap and click-safe.
- **Storage:** maker-local (localStorage) for v1; sharing/tenant later.
  Note house rule — existing localStorage keys + the `wb-` CSS prefix are
  **frozen**; a *new* key is fine.

---

## OPEN QUESTION — resume here

**How parameterized should a v1 custom subtype be?** (Owner has not
answered yet.)

- **A — Frozen recipe.** A custom subtype is exactly the formatter you
  built; a EU variant means saving a second `money.eu`. "Refine" = rename +
  edit the raw expression. Ships fastest, zero knob machinery.
- **B — Fully parameterized.** Authoring lets you mark any literal as a
  typed knob (symbol, decimals, +sign) with labels + defaults — a real
  parameter editor. Most powerful, biggest v1.
- **C — Opt-in knobs (recommended for v1).** Born frozen via save-as; in
  the refine editor you can promote a single literal to one named knob when
  you want one. Knobs are opt-in and grow over time, so simple subtypes
  stay simple and `money` can earn its "symbol?" prompt without a parameter
  IDE.

### Still to decide after that
- Catalog/namespace model details (how built-ins + customs coexist).
- Storage/scope confirmation (maker-local localStorage v1?).
- The built-in **seed catalog** (which presets become built-in subtypes).
- How the fx bar reads a subtype's vocabulary to replace the `...refs` /
  `...values` padding (the loop back to the original complaint).
- Rendering feasibility in SP for `date.elapsed` / `date.until` (relative
  time is awkward in the SP expression dialect — needs a feasibility pass).
- Likely **decompose** into sub-specs: (a) catalog + data model, (b)
  save-as birth, (c) refine editor + knobs, (d) bar wiring.

---

## Relevant existing code (so the new chat doesn't re-explore)

- `src/editor/fxSuggest.ts` — the suggestion engine; the `...refs` /
  `...values` padding is the noise source.
- `src/editor/fxBar.ts` — bar UI: slot picker, Excel-dialect editor,
  on-focus styled value menu, smart-default *draft* (muted, uncommitted),
  and the feedback line (see parked task).
- `src/editor/columnPresets.ts` — `FieldType → built-in whole-column
  presets` (`data-bar`, `status-pill`, `date-badge`, `day-counter`). The
  natural **seed catalog** for built-in subtypes.
- `src/editor/cfr.ts` — `toColumnFormatter`; Stage 4's "Save as the
  column's format" — the natural basis for the **save-as birth** flow.
- `src/editor/palette.ts` — palette presets (`paletteItemById`,
  `.create()`).
- `src/core/types.ts` — `MockField` (has `type: FieldType`, **no subtype
  field yet** — would gain `subtype?: string`).

### House rules that constrain the design
Vanilla TS + Vite, zero runtime deps. One gesture = one undoable document
mutation. Click-only safety (a misclick must never corrupt a formatter).
localStorage keys + `wb-` prefix frozen (new key OK). Generators stay
schema-valid + refuse-don't-guess (never emit a standalone `!`). Test files
are contracts — change the test first, then the code.

---

## Parked side-task (NOT part of the subtype design)

**fx-bar feedback line → silent-unless-wrong + transient.** The owner wants
the helpful text under the bar gone. Decision:

- Default state **empty** — no slot hint, no "Suggested for you…" nudge, no
  "✓ Applied" confirmation, no read-only note.
- On a **refusal** only: show the reason in red, **auto-fade after ~6s**,
  clear instantly on the next keystroke (they're fixing it), tiny **✕** to
  dismiss now. (Refusal messaging must survive — refuse-and-teach is a
  house rule.)
- Small standalone edit, **not gated** by the subtype design.
- Touches: `src/editor/fxBar.ts` (the `setFeedback` calls + the inline
  `feedback` div appended at the end of `render()`), `src/style.css`
  (`.wb-fx-feedback`); update the contract in `src/editor/fxBar.test.ts`.
- Note: the detached **float** editor has its own in-context feedback line —
  leave that one alone (it's not "below the bar").

---

## How to resume in the new chat

> "Read `docs/superpowers/specs/2026-06-22-fx-bar-subtypes-design.md` and
> let's continue the fx-bar subtypes brainstorm — I'll answer the open knob
> question (A/B/C)."
