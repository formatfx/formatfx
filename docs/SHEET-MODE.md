# Sheet mode — the Excel-true surface (design, locked 2026-06-12)

> **Superseded 2026-06-17:** the Sheet/Advanced *mode toggle* was removed
> at the owner's request — there is now a single unified surface that
> always shows everything (palette, Structure, ribbon's Formatted-columns
> button, the fx bar, the Properties/JSON pane, and all the former
> "advanced" tools). The Sheet *ideas* below (the ribbon, the fx bar, the
> Format-cells dialog, the transpiler) all live on inside that one surface;
> only the basic-vs-advanced split and `uiPrefs.mode` are gone. Read the
> rest of this file as history of how those pieces were designed.

> Owner decisions from the 2026-06-12 voice brief. This is the destination
> for the mode currently labeled "Basic". The pitch in `branding.ts` —
> *"If you can use Excel, you can do this."* — becomes literally true at
> the interface level: Excel's **formatting** experience, a supported
> subset, transpiled to schema-valid SharePoint JSON.

## The promise, scoped honestly

Excel's *formatting*, exactly how people remember it — not Excel's
calculation. Formatters paint **display**; they calculate values but never
store them (a list export will not contain painted output). Everything is
per-row: a formula or format applies to a **whole column or whole row,
never one cell** — every surface must make that hard to misinterpret
(say "every row" out loud; never present a single-cell affordance).

**Audience framing, clarified 2026-06-25.** "For Excel users" means *meet
the spreadsheet mental model* — grid, formulas, direct manipulation — with
modern craft (progressive disclosure, high-contrast validation,
edit-in-context), and, because the real maker pain is the **blank page**,
*show what's possible* rather than make them invent it from nothing.
Excel-true where it aids fidelity; never an Excel clone — and never a
licence to inherit Excel's density or dated chrome. The audience is a
reason to respect muscle memory, not an excuse to skip web craft.

**Guiding principle (the owner's, verbatim in spirit):** the system does
the thinking — type-awareness and contextual filtering are baked into the
design, not documented around it. Ship only what will definitely work on a
real list, even at the expense of functionality for now. Confidence is the
product; it is earned by never generating something that silently fails.

## Decisions

- **Rename Basic → Sheet — DONE 2026-06-16** (stage 3). The mode button,
  its tooltip and the mode toast now read "Sheet"; the e2e specs that
  locate the button by text were updated with it. Label only: the persisted
  `uiPrefs.mode` value `'basic'` and the `wb-basic` body class stay frozen,
  per the standing rename rule, so the rename never wipes autosaved prefs.
- **Ribbon: yes** — it signals "sheet things live here"; it does not have
  to clone Excel's. Comfort and ribbon are not in tension. The current
  Basic palette becomes a ribbon tab (Insert-flavored).
- **No flanking panels in Sheet mode** — the grid is front and center,
  full-bleed. Palette/Structure/Inspector are Advanced (studio) furniture.
  *Status (2026-06-16): SHIPPED. The shell visual landed early in Basic —
  palette → ribbon, inspector dropped, preview widened — the fx bar (stage
  2) sits above the grid, and the Basic → Sheet rename has now landed. Per
  the owner the Structure pane is kept (a useful map; not strictly
  full-bleed). See HANDOFF "Basic/advanced mode".*
- **fx bar: yes, but not Excel-literal.** The known discomforts are design
  inputs, not features to copy:
  - It must be structurally clear that the bar **formats, never sets
    values** (in Excel, typing `=` into a cell sets that cell — here it
    cannot, and the UI must not even suggest it).
  - **Left-edge context dropdown** (Excel's Name Box / the PowerApps
    property picker, done right): selects *which property slot* the bar is
    editing — "Text shown", "Fill color", "Left border", "Visible" — and
    its options change with what's selected. This resolves both "what does
    the bar show at all times" and "what is this formula FOR". A cell with
    a plain number selected shows the *property list*, not the number.
  - **Editing comfort**: never a cramped single line — the editor expands
    (and may float/detach), addressing the Excel/PowerApps complaint.
  - This also delivers "conditions anywhere SP allows them": every
    property slot accepts an expression (e.g. left border neutral vs theme
    color by condition), with type-aware suggestions per slot.
- **Dialect**: the stored truth is always the SP dialect. The bar may
  render stored formulas "parsed out toward" the Excel dialect (Excel
  syntax is pseudo-code people already read) and accepts Excel-ish input.
  Something in between is fine; leaning on concepts users already know is
  the requirement, strict mimicry is not.

## The transpiler (stage 2's brain)

A pure module (sibling of `condRules.ts`: node-tested, generators only)
that translates **both directions** over a closed, round-trip-safe subset.
If an input falls outside the subset, it refuses with teaching copy — it
never emits a guess.

Known mappings: `=` ↔ `==` · `<>` ↔ `!=` · `&` ↔ `+` (concat) · `"` ↔ `'`
· `TODAY()`/`NOW()` → `@now` · `AND()`/`OR()` → `&&`/`||` · `IF` → `if`
(names case-folded) · column display names ↔ `[$InternalName]` resolved
against the imported schema (picked from a list, never typed).

**`NOT(x)` has no direct target** — SP has no logical NOT (no `not()`, no
standalone `!`; `!=` is a different, supported operator — see HANDOFF §3).
The transpiler rewrites negation inside the expression (operator flips,
branch swaps, De Morgan) and refuses with an explanation when it can't.

## Stored values, painted values, and host columns

A data column always displays **its own stored value**, possibly dressed
up (pill, bar, badge) — its text is never silently replaced by a
composition of other columns. Replacing displayed content with computed
output is a real capability, but it is **gated to columns purpose-created
for it ("JSON host columns")** — mirroring the community pattern of an
empty-expression calculated column, hidden from forms, that exists only to
host a formatter. The Data tab grows a "add a display column" affordance;
only such columns offer "show a formula's output here". This keeps "where
did my value go" impossible.

## Column subtypes are settings, not formatting

"Type" means more than data type: a number column may be a percent, may
want thousands separators — in SharePoint those are **column settings**,
not formatter JSON. Sheet mode never silently pretends otherwise.
Advanced mode may later capture such intents and export a PowerShell
script (prompting for site/list) the user runs themselves, or point at the
column-settings path. Out of scope for stages 1–3; recorded so nobody
"helpfully" fakes a percent format in paint.

## Stages

1. **Comfort now — SHIPPED 2026-06-12.** Format cells dialog (Font /
   Border / Fill / Alignment tabs, live preview box, OK = one undoable
   patch) on header menus and the right-click menu; conditional formatting
   can watch a **different column** than the one it paints (type-labeled
   dropdown, no typing); "every row" said out loud in both dialogs.
2. **The transpiler + fx bar — LANDED 2026-06-16.** The dialect module
   (`src/editor/dialect.ts`: pure, tested, both directions,
   refuse-don't-guess) surfaced as the fx bar in Basic/Sheet mode. The
   left-edge property-slot dropdown (`src/editor/fxSlots.ts`) picks what's
   painted — "Text shown", "Fill color", "Left border" and any expression
   the element already carries; the editor shows the stored SP formula
   parsed out toward Excel and accepts Excel-ish input back, committing one
   undoable mutation. Bad input is refused, never written (a misclick/typo
   can't corrupt the formatter); a formula outside the Excel subset shows
   read-only with an "edit in Advanced" pointer. Advanced keeps showing the
   raw SP dialect (the inspector). The two additive comforts also landed
   2026-06-16: **type-aware per-slot suggestions** (`fxSuggest.ts` — the
   datalist offers values that fit the slot and the schema's field types,
   and every suggested formula is one the transpiler accepts) and the
   **floating/detached editor** (the fx bar's ⤢ opens a roomy popup so it's
   never a cramped single line).
3. **The shell — SHIPPED 2026-06-16.** Sheet mode proper: single surface,
   grid front and center, ribbon (palette as a tab), the stage 1–2 dialogs
   and the fx bar as the editing vocabulary — and the Basic → Sheet rename
   landed here (label only; the `'basic'` value and `wb-basic` class stay
   frozen).
