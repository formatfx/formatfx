# FormatFX — visual special effects for SharePoint lists

> The visual sandbox and layout editor for SharePoint list formatting.

An interactive, fully client-side sandbox and **visual layout editor for SharePoint
List Formatting** (column formatters, view/row formatters, and tile/gallery
formatters). Lay out formatting elements graphically, watch them render live
against real or mock list data, and export valid, schema-compliant SharePoint
JSON — or paste any existing formatter (e.g. a sample from
[pnp/List-Formatting](https://github.com/pnp/List-Formatting)) and edit it visually.

No server, no tenant connection, no framework runtime — vanilla TypeScript + Vite.

## The workflow

1. **Import your list** — Data tab → *Import schema…*. Fastest path:
   **⚡ Live from SharePoint** — copy the read-only extract snippet, run it
   in the console on your list page, paste the captured snapshot back. No
   install, no app registration, just your own session; it brings the
   columns (types, choices, read-only flags), up to 10 real rows, **every
   column's live formatter** (auto-registered) *and your views' row
   formatting* — the default view's formatter loads straight onto the
   canvas. Also accepted: the file from **Export → Export to CSV** with
   *Include schema*, JSON from `tools/Export-ListSchema.ps1`, or a
   hand-written CSV (see in-app help).
2. **Edit visually** — the Structure pane is a **workspace tree**: your view
   formatter plus every registered column formatter, with badges showing which
   columns the view references (`⤷ in view` / `unused` / missing). Click any
   header to put that formatter on the canvas; edits to a column formatter
   propagate live into the view's `columnFormatterReference`s.
3. **Ship it** — one-click topbar **JSON** copy (sanitized, `$schema`-wrapped)
   for SharePoint's Format pane, per-column copy buttons in the registry,
   download / CSOM-safe variants from the JSON tab — or **🚀 Deploy…**
   (JSON tab, Advanced): a generated, confirm-first snippet that writes the
   formatter to your column or view from the list page itself, using only
   your own permissions. It refuses to generate while the linter sees
   errors, and it shows exactly what it will replace before the one write.

## Editor features

- **Grid-first workspace** — the app lands on your list as a
  **Microsoft-Lists-style grid**: one column per view column, real headers,
  each column rendered with its current formatter (import a list and its
  pills/bars show up live). Header menus hold the per-column actions —
  *format this column* (scaffolds and opens a column formatter),
  *conditional formatting*, *style*, *copy JSON*, *hide* — plus a
  **“+ column”** chip for the rest of your schema. Drag a header left/right
  to reorder; **drop one column onto another** and the two become named
  row-formatter scaffolding ("Status + DueDate group") you can immediately
  reposition, wrap, border or shadow with the same click-only tools. The
  grid stays a grid until you group; every grid gesture is exactly one undo
  step; switch Type to *row layout* any time to see the same tree as a free
  layout.
- **Right-click anywhere in the preview** — every element, column and group
  carries a context menu with the actions that apply to nearly everything:
  restyle in the playground, conditional formatting, **Format cells…**
  (the comfortable dialog: Font / Border / Fill / Alignment tabs, a live
  preview box, OK applies everything as one undo step), rename, wrap in a
  container, ungroup, duplicate, copy its JSON, remove. All click-only and
  undoable, so a misclick can't corrupt the formatter; grid headers answer
  right-click with their column menu.
- **Conditional formatting builder** — "when the value …, make it look …",
  without the dialog maze. The field's type
  drives the suggestions: choice columns arrive with **one ready chip per
  choice** and a one-click **“✨ a color for each choice”** (the words pick
  the colors — *Done* goes green, *Blocked* goes red); dates get
  overdue/today/within-N-days;
  people get *is you*; numbers get thresholds. Rules can watch a
  **different column** than the one they paint ("color DueDate by Status")
  — the watched column is picked from a type-labeled dropdown, never
  typed. Pick a look — text color,
  soft fill, solid pill, edge stripe, strike out — and a swatch, watch every
  rule render against **your actual rows** through the real engine, then
  apply: one undoable mutation that compiles the rules into schema-valid
  `=if(…)` chains (first match wins; an element's existing look becomes the
  no-match fallback). From a grid header it lands on that column's
  registered formatter, exactly like *format this column*.
- **One maker-first surface** — there is no mode switch to get wrong. The app
  lands on your list as a grid with the pieces people actually reach for
  (status pills, traffic lights, date badges, data bars, personas, stars…),
  the canvas, your data, the inspect-outlines toggle, and click-only
  **Format cells**, **conditional formatting** and **Alignment** dialogs — so
  a misclick can't corrupt the formatter, and every gesture is undoable. The
  developer furniture is one door away, not a different mode: the topbar
  **Advanced** toggle opens the validated-JSON pane (the escape hatch, with
  **Deploy**) without moving the editor or canvas, and the Palette, Structure
  and Properties panes — every preset, all element/style/attribute properties,
  the box model, `forEach` loops, row actions, hover cards, inline edit, the
  CFR registry and tenant themes — stay reachable the whole time.
- **Named elements** — every element can carry a friendly name (double-click
  it in the Structure pane, or the ✎ action): presets arrive pre-named
  ("Status pill", not "div"). Names use the `_elmName` convention — SharePoint
  ignores it — and stay in exported JSON by default; untick "names" in the
  JSON tab for schema-pristine output. Project files always preserve them.
- **Element palette** — schema primitives plus ~25 ready-made components
  distilled from years of community samples: status pills, traffic lights,
  severity classes, tag pills, due-date badges, day counters, personas,
  facepiles, action / Flow / setValue / mailto buttons, hover cards, data
  bars, progress donuts, key-value tables, star ratings, lookup chips, row
  cards and the canonical 3-layer gallery card. **Schema-aware**: presets
  rebind their field references to your best-matching columns by type.
  Collapsible to an icon rail (drag still works).
- **Interactive canvas** — renders against every data row in a context
  matching the formatter type (Lists grid, list cell, full-width row, or
  gallery tile);
  click-to-select (including inside customCardProps flyouts), drag-drop with
  per-element target highlighting, light/dark Fluent theme toggle, and an
  inspect-outlines mode. The selection highlight is a pulsing dashed outline
  offset *outside* the element, so it can't be confused with your design.
- **Visual inspector** — a plain-language **Alignment** control: a summary
  chip reads out the current arrangement ("Side by side · centered · middle ·
  gap 8px") and expands into a picker whose 3×3 grid buttons sit *where their
  result puts the content*, plus click-only direction/spread/spacing chips.
  Alongside it, a devtools-style **box model** (per-side margin/padding with
  ↑/↓ stepping) and full property editing with per-key value suggestions
  (theme class tokens, Fluent icon names, style values), row actions, hover
  cards, inline edit and CFRs. Every style property and attribute carries an
  ⓘ **doc card**: an SVG concept diagram (the box, the flex shelf, paint
  layers…), a no-jargon explanation, «syntax shapes», clickable examples
  that apply themselves, longhand groups (one card serves `padding` and all
  its sides) and a full flex glossary — plus a one-click jump into the
  **⚗ Style playground** (also in the ☰ menu): a consequence-free overlay
  organized as labeled steps. **Quick looks** apply whole style bundles in
  one click (pill, card, accent edge, one-line ellipsis…); a mini
  **structure tree** beside the live stage shows ancestors and children
  (click any row to restyle that element instead; unapplied picks stash per
  element); the selected property gets a **formatted description card**
  whose examples apply themselves; the element's **current styles** are
  listed (expressions as 𝑓x) with your picks shown replacing them; and
  nothing touches the formatter until the explicit, undoable Apply.
- **customCardProps are first-class** — card formatters appear nested in the
  structure tree, are click-selectable inside the live flyout, and edit with
  the same palette/inspector as everything else.
- **Structure tree** — elmType icons, behavior chips (⟳ loop · ▶ action ·
  ▣ card · ⤷ reference · ✎ inline edit), drag-reorder/reparent, duplicate,
  and **wrap-in-parent** (works on the root — a formatter has exactly one
  root element; wrapping is how you add a parent).
- **Real expression engine** — full parser/evaluator for the SP expression
  language: the complete operator/function set, `[$Field.prop]` /
  `[!Field.DisplayName]` references, `@currentField`, `@me`, `@now`,
  `@rowIndex`, `forEach` + `loopIndex()`, lookup values
  (`.lookupValue`/`.lookupId`) — **both syntaxes**: Excel-style strings and
  the older Abstract Syntax Tree object form (including the legacy `":"`
  ternary alias), verified against real pnp/List-Formatting samples.
- **Tenant theme import** — Data tab → *Tenant theme*: paste
  `JSON.stringify(window.__themeState__.theme)` from your real site (or pick
  a Fluent Theme Designer JSON) and the preview wears your actual palette;
  partial palettes merge over the stock light/dark base. Saved with the
  project.
- **Faithful renderer emulation** — SP style allow-list enforcement
  (unsupported properties silently dropped, exactly like the real renderer),
  `sp-css-*` / `ms-*` / `sp-card-*` / `sp-field-*` class emulation, `iconName`
  Fluent icons, customRowAction stubs, CFR resolution with correct
  `@currentField` swapping and circular-reference protection.
- **Built-in linter that teaches** — the silent-failure quirks, each explained
  in plain language with a ▶ position marker in the formula: the Zero
  Whitespace Rule, no `not()` and no standalone `!` (`!=` is fine — negate
  inside the expression), nested `=` inside expressions,
  XML-entity-escaped operators (`&amp;&amp;`), `forEach`+`split()` scope,
  `_comment` placement, div-with-children card triggers, CFR-in-card,
  unsupported CSS, unknown `[$Field]` references against your schema, `if()`
  depth, and more. Written for low-code makers, not compiler authors.
- **Built-in field guide** (☰ menu → 📖) — a full-screen, Learn-style reference
  with a chapter tree, "in this article" rail, diagrams and Microsoft Learn
  links — written for developers. What lists really are
  (SQL tables behind a React UI — view thresholds and the 12-join lookup limit
  included), the column type system (person/metadata columns ARE lookups,
  projected fields, calculated-column boundaries, the single-vs-multi
  capability matrix), the formatting JSON layer (allow-listed CSS — no `var()`
  / `calc()` / grid — plus `customRowAction`, `inlineEditField`, hover cards),
  and every field-tested gotcha the linter knows, cross-referenced to its rules.
- **Projects & autosave** — the whole workspace (formatters + schema + data +
  references) autosaves to localStorage and saves/opens as portable
  `.sandbox.json` files. Panes are drag-resizable; the side pane has 📌
  auto-hide (hover the rail to open, click elsewhere to close) and ⛶
  maximize modes.

## Run it

```bash
npm install
npm run dev           # local dev server
npm test              # engine test suite (vitest + happy-dom)
npm run test:ui       # 90 visual/E2E specs in your installed Edge (PW_CHANNEL=chrome to override)
npm run build         # type-check + production bundle in dist/
npm run build:single  # everything inlined into one dist-single/index.html
```

`build:single` produces a single self-contained HTML file you can email,
drop in a doc library, or open on a phone — no server needed.
`.github/workflows/ci.yml` runs the unit tests and the Playwright suite on
every push (`PW_CHANNEL=bundled`), builds `dist/`, and deploys it to GitHub
Pages from `main` (Settings → Pages → Source = "GitHub Actions" to enable).

## The npm package

The UI-free engine ships as **`formatfx`** on npm — the teaching linter,
headless and dependency-free:

```bash
npx formatfx lint my-formatter.json        # the silent-failure quirks, explained
npx formatfx lint *.json --strict --json   # CI-friendly: warnings fail, JSON out
npx formatfx validate my-formatter.json    # shape check only
```

```ts
import { importJson, lintDocument, evaluate, buildExtractSnippet } from 'formatfx';
```

The package exports the schema types, JSON ⇄ document serializer,
expression engine (both syntaxes), allow-lists, the four-format schema
importer and the connectivity snippet builders (`npm run build:lib`
builds it; releases publish from a `v*` tag). The renderer is deliberately
not part of the headless surface — the sandbox at formatfx.dev *is* the
renderer.

## Architecture

```
src/
  core/            # reusable, UI-free engine
    types.ts       #   SP schema types + editor document model
    schema.ts      #   allow-lists, functions, tokens, value suggestions
    expressions.ts #   tokenizer → AST → evaluator (string + object syntaxes)
    renderer.ts    #   SPElement → DOM with SP-faithful semantics
    theme.ts       #   Fluent palettes; generates sp-css-*/ms-*/sp-card-* CSS
    linter.ts      #   teaching diagnostics for silent-failure quirks
    serializer.ts  #   JSON ⇄ document import/export (column/row/tile)
    schemaImport.ts#   list schema import (native CSV-with-schema, PS JSON, CSV)
  editor/          # the visual editor shell
    state.ts       #   workspace store: main doc + column refs, undo, autosave
    presets.ts     #   palette factories + schema-aware binding
    gridScaffold.ts#   grid-first workspace generation/mapping (pure)
    gridView.ts    #   the grid canvas context: headers, menus, drag-to-group
    palette/treeView/canvas/inspector/jsonPanel/dataPanel
  main.ts          # app shell: panes, switcher, copy, persistence
tools/
  Export-ListSchema.ps1  # PnP exporter for the schema-import path
e2e/               # Playwright visual suite (local Edge or CI chromium)
```

`core/` has no editor coupling beyond DOM output and is designed to be
reusable (CLI linting of sample JSON, tests, other UIs).

## Disclaimer

The preview is an *emulation*, not the real SharePoint renderer. It is built to
be pixel-plausible and quirk-faithful, but always verify the exported JSON on a
real list before shipping. THIS CODE IS PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND.
