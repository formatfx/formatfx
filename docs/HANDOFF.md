# FormatFX — Architecture & Handoff

> Written 2026-06-11 by the session that built, named, and launched this
> project. This document replaces that session's context. If something here
> contradicts the code, the code wins — but check git blame first; most
> "odd" decisions below were deliberate and several were live-verified
> against real SharePoint.

## 1. What this is and where it came from

FormatFX is a fully client-side visual sandbox/layout editor for SharePoint
List Formatting JSON (column, view/row, and tile formatters). Vanilla
TypeScript + Vite, zero runtime dependencies, by design — so it can be
hosted anywhere, embedded as a single HTML file, or eventually offered to
the pnp/List-Formatting community.

It was incubated 2026-06-10 → 06-11 inside a **private corporate repo**
("TwFw", a SharePoint formatter engineering workspace) as `Workbench/`,
then extracted here with a **fresh single-commit history** — deliberately,
so nothing from the private repo's history (tenant URLs, internal commit
messages) could ever leak via a later visibility flip. Do not graft the old
history onto this repo.

### What was excluded at extraction (and why)
- `e2e/visual-compare/` — a Playwright harness that screenshots a **real
  SharePoint tenant** and visually compares against this sandbox. It is
  tenant-coupled (corporate URLs, authenticated storageState) and lives in
  the private repo. It will be re-pointed at a local clone of this repo.
- `dependencies: { twfw: "file:.." }` — a link to the incubation repo.
- `visual:auth` / `visual:check` / `visual:compare` npm scripts (drive the
  excluded harness).
- `dist-single/` — the single-file build was *committed* in the incubation
  repo (for phone-sharing); here it's gitignored. `npm run build:single`
  regenerates it at `dist-single/index.html`.

### What was NOT moved/renamed (common misconception)
Nothing was ported from the incubation repo's formatter library
(`Formatters/lib` over there). The engine in `src/core/` was written fresh
for this product. `tools/Export-ListSchema.ps1` was always part of the
sandbox (it's the PnP-PowerShell exporter that feeds the schema import).

### The rename
The product was "List Formatting Sandbox" / "Workbench" until 2026-06-11.
All identity strings live in **`src/branding.ts`** — name, tagline, project
file name, home URL. Rename = edit that one file. The `localStorage` keys
(`list-formatting-sandbox.project.v1`, `wb-ui-prefs`) and the `wb-` CSS
prefix deliberately did NOT change: renames must never wipe a user's
autosaved work. Leave them frozen.

## 2. Architecture map

```
src/core/      UI-free engine — reusable headlessly (tests import it in node)
  types.ts     SPElement/SPExpr/wrappers + FormatterDocument + mock-data model
  schema.ts    allow-lists (elmTypes/attrs/styles), SP functions/tokens,
               inspector value-suggestion catalogs
  expressions.ts  tokenizer → AST → evaluator. BOTH expression syntaxes:
               Excel-style strings AND the legacy object/AST form
               ({"operator":"?","operands":[...]}, incl. the ":" ternary
               alias real community samples use)
  renderer.ts  SPElement → DOM with SP-faithful semantics (see §4)
  theme.ts     stock Fluent light/dark palettes + tenant overrides →
               generates real CSS for sp-css-*/ms-*/sp-card-*/sp-field-*
  linter.ts    teaching diagnostics for silent-failure quirks (▶ position
               markers, plain-language "why")
  serializer.ts   JSON ⇄ document (column/row/tile wrapper detection),
               whitespace sanitization, CSOM-safe & escaping
  schemaImport.ts native "Export to CSV with schema" parser (CAML field XML
               incl. live CustomFormatters), PS-script JSON, hand CSV
src/editor/    the shell: state.ts (workspace store), presets.ts (palette +
               schema-aware field rebinding), palette/treeView/canvas/
               inspector/jsonPanel/dataPanel, playground.ts (the
               consequence-free style playground overlay; doc-card data —
               STYLE_PROP_DOCS/FAMILY_EXPLAINS/GROUPS — lives in core/schema)
src/main.ts    app shell: panes (resize/peek/max), basic/advanced mode,
               doc switcher, copy, theme
```

Key structural invariants:
- **Workspace model**: one "main" document (column/row/tile) + N registered
  column formatters (`state.columnRefs`, keyed by field internal name).
  CFRs resolve against the registry; editing an open column formatter
  updates the registry live (see `EditorState.emit`).
- **Node addressing**: selection/lint paths are arrays of child indices;
  the sentinel **`CARD_SEGMENT = -1` descends into
  `customCardProps.formatter`** — that's how card content is fully
  editable (tree, canvas-flyout click-select, inspector).
- **Inspector self-commit**: the inspector skips re-rendering on its own
  commits (module-level `selfCommit` flag) so focus stays put — this is
  what makes box-model ↑/↓ stepping possible. Don't "simplify" it away.
- **Autosave**: debounced 400ms to localStorage + `flushAutosave()` on
  `beforeunload` (a real bug once: a theme toggle right before reload was
  lost to the debounce).
- **Element names**: `SPElement._elmName` (a pre-existing TwFw provenance
  field) is the user-facing naming mechanism — tree shows it as the primary
  label (dblclick / ✎ renames), `instantiate()` stamps the palette label on
  inserted presets, and the showcase workspace ships named. Export contract
  (per explicit product decision): names stay in exported JSON by DEFAULT —
  `exportJson` keeps `_elmName` unless `keepMeta: false`; "clean" is opt-in
  via the JSON tab's "names" checkbox (default checked). The JSON tab's
  textarea always keeps them so Apply-to-canvas round-trips losslessly.
  Project save/autosave keep names (raw stringify).
- **Basic/advanced mode**: `uiPrefs.mode` in `wb-ui-prefs`, **default
  `basic`** — that's the landing experience, deliberately. The mechanism is
  CSS-only: `body.wb-basic` hides every `.wb-adv` element *unless* it also
  has `.wb-adv-active`. The basic contract is **click-only**: a curated
  palette tier (`PaletteItem.basic` — things people reach for that drop in
  right and can't break the formatter) and exactly ONE inspector section,
  the Alignment editor (summary chip → picker with a 3×3 position grid
  whose buttons sit where their result puts content). No free-text property
  editing in basic, anywhere in the inspector — that's by explicit product
  decision, don't "helpfully" re-reveal sections. `.wb-adv-active` is only
  used on the data side (CFR registry when references are unresolved,
  tenant theme when one is active) where hiding would strand live state.
  Mode is a UI pref, not project state: it never touches the document or
  autosave. E2E specs seed `{ mode: 'advanced' }` in `beforeEach` because
  they exercise the full surface.

## 3. Verified SP semantics (do not "fix" these without re-verification)

These were validated against a **real SharePoint tenant** via the
visual-compare harness (screenshot comparison, all 9 pairs MATCH on
2026-06-11; report archived in the incubation repo at
`docs/visual-compare-report-2026-06-10.md`):

1. **Empty Date cells are null, and `null == ''` is FALSE** in SP
   expressions — while empty *text* cells and *absent fields* DO equal `''`.
   Implemented in `looseEq`/`resolveFieldRef`; schema import coerces empty
   date cells to null. This contradicts what some community samples assume;
   it was live-verified. There's a teaching lint rule
   (`empty-date-compare`) for it.
2. `toLocaleDateString()` etc. of an empty date renders **empty text**, not
   the 1970 epoch.
3. **CFR `@currentField` swap**: inside a resolved
   `columnFormatterReference`, `@currentField` is the *referenced* column.
4. `gap`/`row-gap`/`column-gap` ARE supported by modern SP (an older
   internal rule said otherwise — the allow-list here is correct).
5. `.sp-card-formatterRef` is `visibility:hidden` in LIST row context on
   real SP (occupies layout, never paints) — the theme CSS emulates this
   identically. It looks like a bug; it's fidelity.
6. SP's **Export to CSV with schema omits calculated AND lookup columns**
   from the schema XML, and empty multi-lookups export as the literal
   string `"[]"`. The import help warns about this; "unresolved CFR" after
   import usually means exactly this.
7. The renderer **silently drops** styles not on the allow-list — exactly
   like SP. Surfacing them is the linter's job, not the renderer's.

## 4. Known emulation gaps (honest list)

- `inlineEditField` renders an indicator, not an editable control.
- `defaultHoverField` is accepted/round-tripped but not emulated.
- `@isSelected` is always false; `executeQuickstep` actions aren't modeled.
- `filepreview` renders as a plain `img`.
- Footer/group formatters and form (body/header/footer sections) JSON are
  detected and **rejected with explanatory errors** — not editable.
- Icon glyphs come from the Fabric Core 11 CDN font; a tenant's newer
  Fluent font may draw slightly different glyphs (cosmetic only).
- Stock palettes ≠ tenant theme; the Data tab's **Tenant theme import**
  (paste `JSON.stringify(window.__themeState__.theme)`) closes that gap
  per-project.

## 5. CI / hosting / domain — how and why

- **`.github/workflows/ci.yml`**: `test-build` (vitest 64 tests + vite
  build, uploads `dist/` as the Pages artifact) → `deploy-pages` (main
  only); `e2e` runs the 23 Playwright specs with `PW_CHANNEL=bundled`
  (Playwright's chromium). Locally, `npm run test:ui` defaults to the
  **installed Edge** (`channel: msedge`) because the original dev machine
  sat behind a corporate proxy that blocked Playwright's browser CDN —
  override with `PW_CHANNEL=chrome`, `bundled` for CI parity, or
  `PW_EXECUTABLE=/path/to/chromium` for containers that can't download.
- **Branch protection on `main`**: `test-build` and `e2e` checks required.
- **GitHub Pages is the canonical host** (build_type=workflow). Custom
  domain `formatfx.dev`; `https_enforced=true`; cert covers apex + www,
  auto-renews (Let's Encrypt via GitHub).
  - **Cert war story**: the domain was attached ~1h before DNS existed;
    GitHub's verification failed and never retried — stuck ~10h. The fix
    is a full **remove + re-add of the cname** (`PUT pages {"cname":null}`
    then `{"cname":"formatfx.dev"}`); cert approved in <60s after. If this
    ever recurs, do that before debugging DNS.
- **DNS** (registrar: Squarespace; .dev registered through 2029-06-11,
  nameservers nsa1-4.squarespacedns.com): apex A → 185.199.108.153/109/110/
  111; `www` CNAME → `formatfx.github.io`. No AAAA, no CAA. Note: the dev
  machine's corporate network (Zscaler) intercepts DNS and TLS — diagnose
  domain issues with DNS-over-HTTPS (`https://dns.google/resolve?...`) and
  read cert subjects knowing Zscaler re-signs but mirrors them.
- **Firebase Hosting is an idle mirror**: project `formatfx`,
  formatfx.web.app, `npm run deploy:web` (builds + deploys `dist/`).
  Pages stays canonical; Firebase exists as fallback/CDN experiment.
- Domains owned: formatfx.com/.net/.org/.studio/.io(?)/.app/.dev —
  **formatfx.com stays parked until announce**, then redirects to .dev.
- `github.com/samyost/formatfx` is an empty leftover repo (name
  reservation); the real repo is `formatfx/formatfx`.

## 6. Roadmap / TODO (in rough priority order)

1. **Node 20 runner deprecation — DEADLINE 2026-06-16**: GitHub forces
   actions to Node 24; either bump action versions in ci.yml or set
   `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` env. Do this first.
1.5. **Grid-first workspace (the big basic-mode bet — designed 2026-06-11,
   owner's vision, not yet built).** Reframe the preview pane as the
   WORKSPACE: it starts as a plain Microsoft-Lists-style grid — one column
   per view column, each rendered with its current formatter (pills etc.
   from import), real column headers. Header menus = per-column actions
   (format this column, hide, copy JSON). The on-ramp to row formatting:
   the user DRAGS a column header left/right to reorder — or drops one
   column ONTO another, which generates the row-formatter scaffolding
   (outer flex div + the two columns as children, named after the
   columns). That moment converts "I know grids" people into row-formatter
   users without them ever seeing JSON: from there groups can be
   repositioned, wrapped, bordered, shadowed via the existing click-only
   tools (alignment editor, element playground). Constraints to respect:
   keep the grid metaphor as long as possible (columns stay column-ish
   until grouped); generated structure must arrive fully _elmName'd
   ("Status + DueDate group"); each grid mutation maps to ONE undoable
   document mutation. Advanced mode later adds hover-card creation etc.
   from the same surface. Build it as a fourth canvas context (kind-aware
   like list/row/tile today) rather than a separate page, so the
   palette/tree/inspector keep working against it.
1.6. **Playground polish backlog (owner feedback 2026-06-12):**
   - the overlay recenters vertically as panel height changes between
     family tabs — jarring. Pin the panel (e.g. fixed top offset or
     anchor to a max height) so switching tabs doesn't move the window.
   - breathing room: space out the family tabs / story / property rows /
     value rows — mainly margin above AND below the family story text.
   - element mode + CFR slots: a `columnFormatterReference` child renders
     inline but is not enterable — indicate that subtly but usefully
     (e.g. overlay reads "⤷ Status — column formatter") so people don't
     wonder why they can't click into it; better: click → confirm prompt
     → open the playground against that column formatter document
     (`state.columnRefs[name]`, like openColumnRef does for the canvas).
   - audit every path that can drop `_elmName`: owner observed a tree row
     showing the `.ms-bgColor-white` class-fallback hint where a name used
     to be (i.e. the root lost its name). Playground apply only merges
     `style` and is now pinned by an e2e assertion; the prime suspects are
     applying JSON that was copied with the "names" checkbox unticked, or
     JSON saved from pre-names-by-default builds. Consider a soft warning
     on Apply-to-canvas when the pasted JSON is name-less but the current
     doc is named ("this will drop your element names — keep them?").
2. Re-point the private visual-compare harness at a local clone of this
   repo (it currently consumes the old in-repo copy), and have it invoke
   the tenant-theme import before captures so color becomes a first-class
   MATCH dimension.
3. pnp/List-Formatting community outreach — the pitch assets: README, the
   all-MATCH fidelity result, the teaching linter. Decide tool/ contribution
   vs linked standalone repo with maintainers.
4. `package.json` has `private: true` — intentional (not an npm package
   yet). The npm name `formatfx` was verified available 2026-06-10 if that
   changes.
5. Engine gaps from §4 as demand dictates; likeliest first: tenant-theme
   capture helper, `@isSelected` toggle in the canvas, form-formatter
   support (big).
6. Marketing-ish: formatfx.dev landing polish, announce, then un-park
   formatfx.com.

## 7. Test inventory

- `npm test` — 64 vitest unit tests (engine semantics incl. every
  live-verified behavior in §3, serializer round-trips, schema import,
  workspace/state, preset binding). Run headlessly anywhere.
- `npm run test:ui` — 22 Playwright specs across `sandbox.spec.ts`
  (core flows), `import.spec.ts` (schema import + CFR), `workspace.spec.ts`
  (doc switching, box model, flex editor, pane modes, dark-mode probe).
- The dark-mode "engine probe" spec exists because a capture once showed
  light pills under dark mode; it pins generation AND the reload/autosave
  path. It exonerated the engine once already — keep it.
