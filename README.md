# <img src="public/favicon.svg" width="30" alt="" valign="middle"> FormatFX

[![CI](https://github.com/formatfx/formatfx/actions/workflows/ci.yml/badge.svg)](https://github.com/formatfx/formatfx/actions/workflows/ci.yml)

**The visual editor for SharePoint List Formatting.** Lay out column, row and
gallery formatters on a canvas, watch them render live against your real list
data, and export JSON that is schema-valid and checked against the quirks that
make formatters silently break on real SharePoint.

**Try it: [formatfx.dev](https://formatfx.dev)** — fully client-side. No
sign-in, no tenant connection, and nothing you paste ever leaves your browser.

<!--
  Screenshot placeholder. When adding shots, prefer tight feature crops —
  a formatted column on the grid, the conditional-formatting builder, the
  Explain tab — over a full-app capture:

  <p align="center"><img src="docs/assets/<crop>.png" width="720" alt="…"></p>
-->

List Formatting can do far more than most lists ever show — status pills, data
bars, personas, hover cards, whole gallery tiles — but the native experience is
raw JSON in a narrow sidebar, with quirks you learn from scattered blog posts
and mistakes that render as nothing at all. FormatFX is the missing editor. It
is also the missing teacher: every linter rule, doc card and Explain sentence
is written for the person who owns the list, not the person who wrote the
schema.

Vanilla TypeScript + Vite, zero runtime dependencies.

## The loop

1. **Bring your list in** — Data tab → *Import schema…*. Fastest path is the
   ⚡ live snippet: copy it, run it in the browser console on your list page,
   paste the snapshot back. Read-only, no install, no app registration — it
   captures your columns (types, choices, read-only flags), up to 10 real
   rows, every column's live formatter and your views' row formatting.
   CSV-with-schema exports, `tools/Export-ListSchema.ps1` JSON and
   hand-written CSVs work too.
2. **Edit on your list, not a toy** — the app lands on a
   Microsoft-Lists-style grid of your view: real headers, every column
   rendered through its current formatter. Header menus hold *format this
   column*, *conditional formatting* and *style*; drop one column onto
   another and the pair becomes row-formatter scaffolding you can restyle
   with the same click-only tools. Every gesture is exactly one undo step.
3. **Let it check your work** — the linter flags each silent-failure quirk
   with a plain-language explanation and a ▶ position marker; the Explain tab
   reads any formatter back in English; the 🧪 stress test renders yours
   against null dates, boundary numbers mined from your own comparisons,
   crowded multi-values, unicode/RTL and maximum-length text.
4. **Ship it** — one-click Copy from the JSON pane (sanitized,
   `$schema`-wrapped, straight into SharePoint's Format pane), or the
   confirm-first 🚀 Deploy snippet that writes the formatter from your list
   page using only your own permissions — it shows exactly what it will
   replace, and refuses to generate while the linter sees errors.
5. **Share the whole workspace** — one link carries the schema, mock rows and
   half-built formatter in the URL fragment, which browsers never send to a
   server. Whoever opens it lands in your exact workspace; their own saved
   work stays untouched until they choose *Save a copy* or *Discard*. The
   encoding is stable and documented for third parties:
   [docs/SHARE-URL.md](docs/SHARE-URL.md).

## What's inside

### Build

- **~25 schema-aware components** distilled from years of community samples:
  status pills, traffic lights, due-date badges, day counters, data bars,
  progress donuts, personas, facepiles, action / Flow / mailto buttons, hover
  cards, star ratings, lookup chips, row cards, the canonical 3-layer gallery
  card. Presets rebind their field references to your best-matching columns
  by type.
- **A conditional-formatting builder** driven by the field's type: choice
  columns arrive with one ready chip per choice and a one-click *✨ a color
  for each choice* (*Done* goes green, *Blocked* goes red); dates get
  overdue/today/within-N-days; people get *is you*; numbers get thresholds.
  Rules can watch a different column than the one they paint, preview against
  your actual rows through the real engine, and compile into schema-valid
  `=if(…)` chains as one undoable apply.
- **Comfortable dialogs where they matter** — *Format cells…* (Font / Border
  / Fill / Alignment tabs with a live preview), a plain-language alignment
  picker, a devtools-style box model, and a consequence-free ⚗ style
  playground whose examples apply themselves. Right-click works on every
  element, column and group — including inside hover-card flyouts.
- **A structure tree that tells the truth** — elmType icons, behavior chips
  (⟳ loop · ▶ action · ▣ card · ⤷ reference · ✎ inline edit), drag-reorder,
  wrap-in-parent, and friendly element names ("Status pill", not "div") that
  survive export and never confuse SharePoint.

### Trust

- **A real expression engine** — the complete operator/function set,
  `[$Field.prop]` / `@currentField` / `@me` / `@now` / `forEach` +
  `loopIndex()` / lookups, in **both** syntaxes: Excel-style strings and the
  older AST object form, verified against real
  [pnp/List-Formatting](https://github.com/pnp/List-Formatting) samples.
- **A faithful renderer** — SharePoint's style allow-list enforced
  (unsupported properties silently dropped, exactly like the real thing),
  `sp-css-*` / `ms-*` / `sp-card-*` class emulation, Fluent icons, CFR
  resolution with circular-reference protection, and tenant theme import so
  the preview wears your actual palette.
- **1,387 unit tests and 142 Playwright e2e tests** run on every push. The
  engine test files are the spec: generated-expression semantics change in
  the test first, then the code.

### Learn

- **A linter that teaches** — the Zero Whitespace Rule, no `not()` and no
  standalone `!` (`!=` is fine), nested `=`, XML-entity-escaped operators,
  `forEach`+`split()` scope, div-with-children card triggers, unknown
  `[$Field]` references against *your* schema, and more — each explained for
  low-code makers, not compiler authors.
- **Explain** — paste a wall of community JSON and read what it does:
  "Shows “Status”. The background color is: if “Status” is ‘Blocked’, then
  ‘#d13438’…". Clicking a sentence selects that element on the canvas.
- **A built-in 📖 field guide** — a full-screen, Learn-style reference that
  starts at "what a list actually is" and descends through the column type
  system to allow-listed CSS, cross-referenced to the linter's rules.
- **ⓘ doc cards on every style property** — an SVG concept diagram, a
  no-jargon explanation, and clickable examples that apply themselves.

### Keep

- The whole workspace **autosaves to localStorage** and saves/opens as
  portable `.sandbox.json` files.
- `npm run build:single` emits **one self-contained HTML file** — email it,
  drop it in a document library, open it on a phone.
- A **companion browser extension** ([`extension/`](extension/)) turns the
  extract/apply snippets into one click — same auth (your own page session),
  same handful of REST endpoints, nothing more.

## Run it

```bash
npm install
npm run dev           # local dev server
npm test              # engine test suite (vitest + happy-dom)
npm run test:ui       # 142 Playwright e2e tests in your installed Edge (PW_CHANNEL=chrome to override)
npm run build         # type-check + production bundle in dist/
npm run build:single  # everything inlined into one dist-single/index.html
```

`.github/workflows/ci.yml` runs the unit tests and the Playwright suite on
every push, builds `dist/`, and deploys it to GitHub Pages from `main`.

## The npm package

The UI-free engine ships as [**`formatfx`**](https://www.npmjs.com/package/formatfx)
on npm — the teaching linter, headless and dependency-free:

```bash
npx formatfx lint my-formatter.json        # the silent-failure quirks, explained
npx formatfx lint *.json --strict --json   # CI-friendly: warnings fail, JSON out
npx formatfx validate my-formatter.json    # shape check only
```

```ts
import { importJson, lintDocument, evaluate, buildExtractSnippet } from 'formatfx';
```

The package exports the schema types, JSON ⇄ document serializer, expression
engine (both syntaxes), allow-lists, the schema importer and the connectivity
snippet builders. The renderer is deliberately not part of the headless
surface — the sandbox at formatfx.dev *is* the renderer.

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
  bridge/          # self-contained, auditable SharePoint connectivity snippets
  editor/          # the visual editor shell
    state.ts       #   workspace store: main doc + column refs, undo, autosave
    presets.ts     #   palette factories + schema-aware binding
    gridView.ts    #   the grid canvas: headers, menus, drag-to-group
    palette/treeView/canvas/inspector/jsonPanel/dataPanel
  main.ts          # app shell: panes, switcher, copy, persistence
extension/         # the Tier-1 companion extension (own package)
tools/
  Export-ListSchema.ps1  # PnP exporter for the schema-import path
e2e/               # Playwright suite (local Edge or CI chromium)
```

`core/` has no editor coupling beyond DOM output and is designed to be
reusable — the CLI, the tests and the npm package all sit on it.

## Contributing

Contributions are welcome — [`CONTRIBUTING.md`](CONTRIBUTING.md) has setup and
the contributor terms; [`docs/HANDOFF.md`](docs/HANDOFF.md) has the
architecture, the invariants and the verified SharePoint semantics. The house
rules, in short:

- **Zero runtime dependencies.** Vanilla TypeScript + Vite; devDependencies
  are fine.
- **Test files are contracts.** Engine and generated-expression semantics
  change in the test first.
- **Generated formatters must work on real SharePoint** — schema-valid
  always, and never a standalone `!` (SharePoint has no logical NOT).
- **Never rename localStorage keys or `wb-` CSS classes** — renames silently
  wipe people's autosaved work.
- **One user gesture = one undoable mutation.**
- **`src/bridge/` stays dependency-free and auditable** — every line readable
  by a maker's IT department; extraction never changes the user's data.

## Disclaimer

The preview is an *emulation*, not the real SharePoint renderer. It is built
to be pixel-plausible and quirk-faithful, but always verify the exported JSON
on a real list before shipping. THIS CODE IS PROVIDED AS IS WITHOUT WARRANTY
OF ANY KIND.

## License

FormatFX is **dual-licensed**: **AGPL-3.0-only** ([`LICENSE`](LICENSE)) or a
**commercial license**. [`LICENSING.md`](LICENSING.md) is the plain-language
guide to which track fits.

| You are… | Your track |
| --- | --- |
| Using [formatfx.dev](https://formatfx.dev) and exporting JSON | Free, no obligations. The JSON is your own work product — use it anywhere, including commercial projects. |
| Self-hosting, forking, or modifying the code | **AGPL-3.0** — serving a modified version over a network (§13) means offering its source under the same terms. |
| Embedding FormatFX in a proprietary product or SaaS | **Commercial license** — also the track for private in-tenant deployment (list data never leaves your network), SSO and priority support. |

**To purchase or ask which track fits**, open an issue on this repo or contact
the author.

© 2026 Sam Yost.
