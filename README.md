# FormatFX — visual special effects for SharePoint lists

> The visual sandbox and layout editor for SharePoint list formatting.
> *If you can use Excel, you can do this.*

An interactive, fully client-side sandbox and **visual layout editor for SharePoint
List Formatting** (column formatters, view/row formatters, and tile/gallery
formatters). Lay out formatting elements graphically, watch them render live
against real or mock list data, and export valid, schema-compliant SharePoint
JSON — or paste any existing formatter (e.g. a sample from
[pnp/List-Formatting](https://github.com/pnp/List-Formatting)) and edit it visually.

No server, no tenant connection, no framework runtime — vanilla TypeScript + Vite.

## The workflow

1. **Import your list** — Data tab → *Import schema…* → pick the file SharePoint
   gives you from **Export → Export to CSV** with *Include schema*. One file
   yields the columns (types, choices, read-only flags), up to 10 real rows of
   preview data, **and every column's live formatter**, auto-registered — the
   grid workspace rebuilds around it, so you're looking at *your* list,
   formatters and all. (Also accepted: JSON from `tools/Export-ListSchema.ps1`,
   or a hand-written CSV — see in-app help.)
2. **Edit visually** — the Structure pane is a **workspace tree**: your view
   formatter plus every registered column formatter, with badges showing which
   columns the view references (`⤷ in view` / `unused` / missing). Click any
   header to put that formatter on the canvas; edits to a column formatter
   propagate live into the view's `columnFormatterReference`s.
3. **Ship it** — one-click topbar **JSON** copy (sanitized, `$schema`-wrapped)
   for SharePoint's Format pane, per-column copy buttons in the registry, or
   download / CSOM-safe variants from the JSON tab.

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
  restyle in the playground, conditional formatting, rename, wrap in a
  container, ungroup, duplicate, copy its JSON, remove. All click-only and
  undoable, so it works in Basic mode too; grid headers answer right-click
  with their column menu.
- **Conditional formatting builder** — the Excel mental model ("when the
  value …, make it look …") without the dialog maze. The field's type
  drives the suggestions: choice columns arrive with **one ready chip per
  choice** and a one-click **“✨ a color for each choice”** (the words pick
  the colors — *Done* goes green, *Blocked* goes red); dates get
  overdue/today/within-N-days (with the null-date quirk handled correctly);
  people get *is you*; numbers get thresholds. Pick a look — text color,
  soft fill, solid pill, edge stripe, strike out — and a swatch, watch every
  rule render against **your actual rows** through the real engine, then
  apply: one undoable mutation that compiles the rules into schema-valid
  `=if(…)` chains (first match wins; an element's existing look becomes the
  no-match fallback). From a grid header it lands on that column's
  registered formatter, exactly like *format this column*.
- **Basic & Advanced modes** — the app lands in **Basic**: a curated palette
  of the pieces people actually reach for (status pills, traffic lights,
  date badges, data bars, personas, stars…), the canvas, the structure tree,
  your data, the inspect-outlines toggle, and a single click-only
  **Alignment** control — nothing hand-editable, so a misclick can't corrupt
  the formatter, and everything is undoable. **Advanced** (topbar toggle,
  remembered per browser) restores the full surface: every preset, all
  element/style/attribute properties, the box model, the raw JSON tab with
  lint diagnostics, `forEach` loops, row actions, hover cards, inline edit,
  the CFR registry and tenant themes.
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
  Advanced adds a devtools-style **box model** (per-side margin/padding with
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
  Whitespace Rule, `not()` doesn't exist, nested `=` inside expressions,
  XML-entity-escaped operators (`&amp;&amp;`), `forEach`+`split()` scope,
  `_comment` placement, div-with-children card triggers, CFR-in-card,
  unsupported CSS, unknown `[$Field]` references against your schema, `if()`
  depth, and more. Written for low-code makers, not compiler authors.
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
npm run test:ui       # 39 visual/E2E specs in your installed Edge (PW_CHANNEL=chrome to override)
npm run build         # type-check + production bundle in dist/
npm run build:single  # everything inlined into one dist-single/index.html
```

`build:single` produces a single self-contained HTML file you can email,
drop in a doc library, or open on a phone — no server needed.
`.github/workflows/deploy-sandbox.yml` deploys `dist/` to GitHub Pages
(Settings → Pages → Source = "GitHub Actions" to enable);
`sandbox-e2e.yml` runs the visual suite on a GitHub runner
(`PW_CHANNEL=bundled`).

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
