# <img src="public/favicon.svg" width="30" alt="" valign="middle"> FormatFX

[![CI](https://github.com/formatfx/formatfx/actions/workflows/ci.yml/badge.svg)](https://github.com/formatfx/formatfx/actions/workflows/ci.yml)

**Format SharePoint lists like a spreadsheet.**

SharePoint lists are secretly one of the best app platforms most teams
already own: a real database, with auth, permissions and sharing solved,
sitting exactly where your users already are. Millions of people build on
them every day. But the layer that turns a flat grid into something great —
status pills, data bars, hover cards, whole gallery tiles — is List
Formatting: raw JSON in a narrow sidebar, with quirks that make mistakes
render as *nothing at all*. The platform did the hard parts with ease and
left the "easy" part to pro-coders.

FormatFX fixes that. It's the experience every list owner already knows —
your real list in a grid, a ribbon, a formula bar, a *Format cells…* dialog.
You work the way you work in Excel; FormatFX quietly compiles every gesture
into formatter JSON that is schema-valid and checked against the quirks that
silently break on real SharePoint. And because plenty of makers *want* to
peek under the hood, it teaches as you go — every rule, dialog and
explanation is written for the person who owns the list, not the person who
wrote the schema.

**Try it: [formatfx.dev](https://formatfx.dev)** — fully client-side. No
sign-in, no install, and nothing you paste ever leaves your browser.

<!--
  Screenshot placeholder. When adding shots, prefer tight feature crops —
  the fx bar mid-formula, a formatted column on the grid, the
  conditional-formatting builder — over a full-app capture:

  <p align="center"><img src="docs/assets/<crop>.png" width="720" alt="…"></p>
-->

## What makes it different

### You write Excel. It ships SharePoint.

The formula bar speaks the dialect you already read: `IF`, `AND`, `TODAY()`,
`&` for concat, column names picked from *your* list. A two-way transpiler
turns that into SharePoint's expression syntax — and turns existing
formatters back into Excel-style formulas you can actually read. A property
picker on the bar's left edge says exactly what each formula paints: *Text
shown*, *Fill color*, *Left border*, *Visible*. And when something can't be
translated faithfully, FormatFX **refuses and explains rather than guessing**
— it never emits a formula that might silently fail on a real list.

### You format your list, not a demo

Import your actual list in seconds: copy the ⚡ live snippet, run it in the
browser console on your list page, paste the snapshot back. Read-only, no
install, no app registration — it captures your columns, real rows, every
live formatter and your views' row formatting. From then on you're editing
*your* view: real headers, real data, real choices in every dropdown, and a
tenant theme import so the preview wears your actual palette.

### Formatting is clicks, not code

*Format cells…* opens the dialog you expect — Font, Border, Fill, Alignment,
live preview. Conditional formatting is built from your field's type: choice
columns arrive with one ready chip per choice and a one-click *✨ a color for
each choice*; dates get overdue/today/within-N-days; people get *is you*;
numbers get thresholds. Rules can watch a different column than the one they
paint, and preview against your actual rows through the real engine. Need a
head start? ~25 schema-aware components — pills, data bars, personas, hover
cards, the canonical gallery card — rebind themselves to your best-matching
columns. Every gesture is exactly one undo step.

### It will not let you ship something broken

This is the core promise: **confidence is the product.**

- A **teaching linter** catches every silent-failure quirk — the Zero
  Whitespace Rule, the missing logical NOT, unknown column references
  against *your* schema — each explained in plain language with a ▶ marker
  at the exact spot.
- The **🧪 stress test** renders your formatter against null dates, boundary
  numbers mined from your own comparisons, crowded multi-values, unicode/RTL
  and maximum-length text — the inputs that break formatters in production.
- **Explain** decompiles any formatter into English: *"Shows 'Status'. The
  background color is: if 'Status' is 'Blocked', then '#d13438'…"* — paste a
  wall of community JSON and read what it actually does; click a sentence to
  select that element.
- The preview enforces SharePoint's real behavior — its style allow-list,
  its CSS classes, its icons — so what you see is what your users get.

### It teaches while you build

Every safeguard doubles as a lesson. The linter explains *why* in plain
language, not compiler-speak. Every style property carries an ⓘ doc card —
a concept diagram, a no-jargon explanation, and clickable examples that
apply themselves. A consequence-free ⚗ style playground lets you poke at
ideas without touching your work. And a built-in 📖 field guide starts at
"what a list actually is" and descends all the way to the CSS allow-list.
If you've wanted an on-ramp from "I own this list" to "I understand this
code," this is it.

### Shipping is one click

Copy the sanitized, `$schema`-wrapped JSON straight into SharePoint's Format
pane — or use the confirm-first 🚀 Deploy snippet that writes the formatter
from your own list page, using only your own permissions, showing exactly
what it will replace, and refusing to run while the linter sees errors. A
[companion browser extension](extension/) turns the whole round-trip into
one click. And one **share link** carries your entire workspace — schema,
rows, half-built formatter — in a URL fragment that browsers never send to a
server ([docs/SHARE-URL.md](docs/SHARE-URL.md)).

## Built to be trusted

The friendly surface sits on a rigorously tested core:

- **A real expression engine** — the complete operator and function set, in
  *both* of SharePoint's syntaxes (Excel-style strings and the older AST
  object form), verified against real
  [pnp/List-Formatting](https://github.com/pnp/List-Formatting) community
  samples.
- **1,600 unit tests and 146 Playwright e2e tests** on every push. The
  engine test files are the spec: semantics change in the test first, then
  the code.
- **Vanilla TypeScript + Vite, zero runtime dependencies** — no framework,
  no supply chain, hostable anywhere, and `npm run build:single` emits the
  whole app as one self-contained HTML file you can email or drop in a
  document library.
- **Nothing leaves your browser.** No telemetry, no backend. Your workspace
  autosaves to localStorage and saves/opens as portable `.sandbox.json`
  files. The connectivity snippets are short, commented and auditable —
  written so your IT department can read every line — and extraction never
  changes your data.

## Run it

```bash
npm install
npm run dev           # local dev server
npm test              # engine test suite (vitest + happy-dom)
npm run test:ui       # 146 Playwright e2e tests in your installed Edge (PW_CHANNEL=chrome to override)
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

## Contributing

Contributions are welcome — [`CONTRIBUTING.md`](CONTRIBUTING.md) has setup
and the contributor terms; [`docs/HANDOFF.md`](docs/HANDOFF.md) has the
architecture, the invariants and the verified SharePoint semantics. The
house rules, in short:

- **Zero runtime dependencies.** Vanilla TypeScript + Vite; devDependencies
  are fine.
- **Test files are contracts.** Engine and generated-expression semantics
  change in the test first.
- **Generated formatters must work on real SharePoint** — schema-valid
  always, and never a standalone `!` (SharePoint has no logical NOT).
- **Never rename localStorage keys or `wb-` CSS classes** — renames silently
  wipe people's autosaved work.
- **One user gesture = one undoable mutation.**
- **`src/bridge/` stays dependency-free and auditable** — every line
  readable by a maker's IT department; extraction never changes the user's
  data.

## Disclaimer

The preview is an *emulation*, not the real SharePoint renderer. It is built
to be pixel-plausible and quirk-faithful, but always verify the exported
JSON on a real list before shipping. THIS CODE IS PROVIDED AS IS WITHOUT
WARRANTY OF ANY KIND.

## License

FormatFX is **dual-licensed**: **AGPL-3.0-only** ([`LICENSE`](LICENSE)) or a
**commercial license**. [`LICENSING.md`](LICENSING.md) is the plain-language
guide to which track fits.

| You are… | Your track |
| --- | --- |
| Using [formatfx.dev](https://formatfx.dev) and exporting JSON | Free, no obligations. The JSON is your own work product — use it anywhere, including commercial projects. |
| Self-hosting, forking, or modifying the code | **AGPL-3.0** — serving a modified version over a network (§13) means offering its source under the same terms. |
| Embedding FormatFX in a proprietary product or SaaS | **Commercial license** — also the track for private in-tenant deployment (list data never leaves your network), SSO and priority support. |

**To purchase or ask which track fits**, open an issue on this repo or
contact the author.

© 2026 Sam Yost.
