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
  share.ts     the share-link codec: project JSON ⇄ URL fragment
               (deflate-raw via native CompressionStream + base64url,
               versioned schemes w1/w1r — contract in docs/SHARE-URL.md;
               payload is serializeProject/loadProject verbatim)
  stressTest.ts the edge-case matrix generators (empty/novel/time/numbers/
               multi/unicode variants, honoring §3 blank semantics) +
               threshold mining from the formatter's own comparisons
  explain.ts   the plain-English decompiler: explainAst over the same 9
               node kinds evalAst walks (both expression syntaxes) +
               explainDocument element walk addressed by NodePath;
               refuse-don't-guess on anything outside the vocabulary
src/editor/    the shell: state.ts (workspace store), presets.ts (palette +
               schema-aware field rebinding), palette/treeView/canvas/
               inspector/jsonPanel/dataPanel, playground.ts (the
               consequence-free style playground overlay; doc-card data —
               STYLE_PROP_DOCS/FAMILY_EXPLAINS/GROUPS — lives in core/schema;
               QUICK_LOOKS style bundles live here), gridScaffold.ts
               (grid-first workspace generation/mapping — pure,
               node-testable; state.ts imports it for the default doc, so
               it must never import state), gridView.ts (the grid canvas
               context: headers, per-column menus, drag-to-group),
               menu.ts (THE anchored action menu — header menus, "+ column"
               and right-click share it; `wb-grid-menu` class is
               load-bearing for e2e/CSS), contextMenu.ts (preview-pane
               right-click: the works-on-most-things element actions),
               condRules.ts (conditional formatting brain — condition
               catalog per field type, looks, palette, =if() chain codegen;
               pure + node-tested like gridScaffold), condFormat.ts (the
               conditional formatting overlay UI; imports state, never the
               other way), formatCells.ts (the Excel-comfort Format cells
               dialog: Font/Border/Fill/Alignment over the allow-list,
               staged patch, OK = one undoable mutation),
               areas.ts (the maker-first "make a row view" brain — pure +
               node-tested: per-area weight Normal/Wide/Widest ⇄ a CSS-fr-like
               flex grow factor, row density Roomy/Compact = gap/padding only,
               buildRowView turns a grid root into a weighted row), cfr.ts
               (the CFR linked-instance brain — pure: cfrBlastRadius =
               change-everywhere scope, inlineColumnFormatter forks a linked
               cell local @currentField→[$Field], toColumnFormatter promotes a
               local cell to the column's shared format [$Field]→@currentField)
src/bridge/    the Tier-0 connectivity bridge (docs/CONNECTIVITY.md):
               extractSnippet.ts / deploySnippet.ts generate the auditable
               paste-into-devtools snippets. Pure + dependency-free, and
               bridge.test.ts EXECUTES the generated code against stubbed
               fetch fixtures, round-tripping the captured payload through
               importSchema — that executed round trip is the contract
src/main.ts    app shell: panes (resize/peek/max), basic/advanced mode,
               doc switcher, copy, theme
```

Collaborative-hub surfaces (issue #86, built 2026-07-02): shareUi.ts (the
Share dialog, the incoming-link banner and the never-clobber boot path —
autosave pausing lives in state.ts), stressTestUi.ts (the read-only 🧪
overlay over core/stressTest), explainPanel.ts (the Explain tab, a side-pane
peer of JSON). The autosave BACKUP key `….project.v1.bak` is additive —
the frozen keys stay frozen.

Key structural invariants:
- **Grid-first workspace (kind 'grid', the landing default)**: a grid doc
  IS a row formatter in embryo — the root is the future rowFormatter flex
  row and **each root child is one grid column**. The canvas renders header
  + body rows as separate CSS grids sharing one track template
  (`--wb-grid-cols`), cells carry the child's `data-sp-path`, so selection
  /palette-drop/tree/inspector all work unchanged. Column↔field mapping is
  derived (CFR target, else the single `[$Field]` ref in the subtree —
  `gridColumnField`), NOT stored: no extra metadata in the JSON. Serializer
  treats 'grid' exactly like 'row' (re-importing detects 'row'; project
  files keep 'grid'). **Every grid gesture is ONE undoable document
  mutation** (`moveNodeTo`/`groupNodes`/`unwrapNode`/insert/remove) — a
  roadmap contract; no-op moves must not snapshot. Generated structure
  arrives fully `_elmName`'d ("Status + DueDate group"). "Format this
  column" registers a `defaultColumnFormatter` scaffold and swaps the plain
  cell for a CFR cell (one doc mutation), then `openColumnRef`s it. Schema
  import rebuilds the grid root **only while `isPureGrid`** (every column
  still single-field) — never clobber a layout someone has started.
- **Workspace model**: one "main" document (column/row/tile/grid) + N registered
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
- **One unified surface** (the Sheet/Advanced split was removed 2026-06-17
  at the owner's request — there is no mode toggle, no `uiPrefs.mode`):
  every tool is on screen at once. The palette pane (far left), the
  **Structure** pane, the preview/grid with the **fx bar** and the
  **ribbon** (`#wb-ribbon` — the Formatted-columns picker), the center Data
  dock, and the right Properties/JSON pane all coexist. `applyLayout` builds
  the full 7-column grid template unconditionally; the ribbon (`.wb-ribbon`)
  and fx bar (`#wb-fxbar`) are shown by default in CSS. Editing happens both
  ways now — the **Format-cells dialog** (right-click / grid header menu)
  *and* the inspector pane. The `.wb-adv` / `.wb-adv-active` class markers
  remain in the markup but no longer hide anything (the `body.wb-basic`
  rules are gone); they're harmless and can be cleaned up opportunistically.
  E2E `beforeEach` just clears `localStorage`; the unified surface is
  asserted in `sandbox.spec.ts`. The app defaults to a **grid-first maker
  view** (`#wb-layout.wb-maker`): the Palette, Structure, and Properties/JSON panes
  are hidden on first load and revealed via the topbar **Studio** toggle
  (pref `studioOpen` in `wb-ui-prefs`, default `false`); the panes are not
  removed, only hidden. The topbar no longer has a "Type" dropdown — the
  formatter type is shown by a read-only **destination chip** (`#wb-dest-chip`,
  derived via `formatterDestination()`); the kind-switching `#wb-kind` select
  moved into the Studio side pane as "Advanced: formatter type" (`setKind`
  semantics unchanged).
- **Left Edit Pane formatter navigation (2026-07-02, owner mockup)**: the
  ribbon breadcrumb strip (`#wb-ribbon`, `breadcrumb.ts`) is GONE. The Left
  Edit Pane owns navigation: the formatter tabs under the lens tabs —
  VIEWS (accent blue, grid icon), COLUMNS (violet, §) and COMPONENTS (teal ⬡),
  relabeled 2026-07-03: no visible "Formatters" text on the bar (it lives on
  as an `aria-label` on the tablist for AT users only), and the ← back +
  🕘 snapshot buttons right-align on that bar (moved up from the pill row) —
  and a **document dropdown** (`#wb-doc-pill`) naming what's on the canvas
  with a subtle type tag ("list row schema"/"tile schema" for views, "<type>
  column" for columns). The pill opens the View Formatters menu (rename,
  "+ New rowview") or the Column Formatters gallery (previews + "Not yet
  formatted"). The tree renders the ACTIVE document only (no doc headers, no
  per-row checkboxes — the row highlight is the selection UI; Ctrl/Cmd-click
  multi-selects). A CFR host in the tree is ONE normal row (2026-07-03 —
  the old indented violet stub row is gone; every reference has an inherent
  wrapper div, so the child presentation was noise): § ink + a right-aligned
  "reference" tag-button, violet as INK only, no fill. Row click selects the
  HOST element (the inspector shows the wrapper div); the tag-button is the
  explicit door that drills into the shared column formatter (blast radius
  in its tooltip; inert span + teaching tooltip when unregistered). The tree
  region sits on `--wb-lp-tree-bg`, one subtle step lighter than the pane.
  Host-cell defaults were AUDITED, not changed: the scaffold's
  `flex:1/min-width:0` block host passes full width through and imposes
  nothing — the referenced formatter's alignment/size wins exactly as far as
  real SP allows (probe evidence in PR #158; `align-self` stays unverified,
  so nothing new is emitted). The Save/Discard checkpoint buttons were removed
  (issue #140 tracks their snapshot-based replacement; the state API —
  `markSavepoint`/`discardToSavepoint` — is kept for it).
- **Snapshots + navigation back (2026-07-03, issue #140)**: the 🕘 button on
  the Formatters bar opens the snapshot menu (`snapMenu.ts` over the
  pure `snapshots.ts` store brain). Snapshots are **full-workspace-only**
  (owner decision, later same day — superseding the scoped-primary design):
  the ONE take action always captures `{ kind: 'all' }` (view + every column
  formatter + view name); legacy scoped captures stay restorable under a
  collapsed "Older, scoped snapshots" group (never orphan user data), and
  `snapshots.ts` still knows the old scopes for storage compat. Every
  restore is ONE undoable step — `applySnapshot` rides `snapState` (doc +
  registry together), so even restore-everything is a single Ctrl+Z; the
  view name restores off the undo stack (same rule as `setViewName`).
  Storage: `wb-snapshots.v1` (ADDITIVE key — frozen keys stay frozen),
  capped at 25 per scope, oldest evicted per scope. The ← button on the
  Formatters bar is **navigation back** — a nav-history stack in state
  (`backTarget`/`goBack`, pushed by `openMain`/`openColumnRef`) that
  retraces doc switches; it is NOT undo, skips unregistered columns, and
  never ping-pongs (going back pops the trail). Related canvas fix:
  `.wb-fxbar` reserves its populated min-height so selection changes never
  shift the grid mid-double-click (that jump used to swallow drill-in
  dblclicks after a deselect).
- **Components — formatting without a column to call home (2026-07-03, owner
  brief)**: the third color channel — **teal ⬡** (`--wb-component`, beside
  blue=view and violet=column; same exclusivity rule). A component
  (`components.ts`, pure) declares typed SLOTS ("needs a person column, a
  date column") over a tree written against slot keys as field names;
  binding rewrites `[$Key]`→`[$YourColumn]` via `remapFieldRefs` (the SAME
  boundary-aware remap presets.ts now imports for schema-aware drop). The
  **COMPONENTS tab** in the Left Edit Pane is a library browser (a local UI
  mode, not a canvas doc — any doc navigation exits it): built-ins ("Yours"
  below), live best-guess previews, slot chips, and **Add to view…** → the
  typed mapping dialog (type-filtered pickers, best-guess prefilled, live
  preview; insert = one undoable step, a new grid column on the grid).
  **Save as component…** lives on the element context menu AND the column
  header menu (packaging the registered format via `inlineColumnFormatter`);
  it derives slots from the referenced fields and REFUSES subtrees carrying
  a columnFormatterReference (components are self-contained). Storage:
  `wb-components.v1` (additive), 50 cap. Built-ins must pass the
  definitely-renders unit contract (bound + rendered over every mock row,
  zero runtime issues, no standalone `!`).
  **Surface consolidation (owner request, same date)**: the custom-subtype
  authoring surface was SWALLOWED — "Save as reusable subtype…", the refine
  ⋯ modal and its push-update button are gone from the UI; the "Format this
  column" catalog = built-in seeds (subtype engine, knobs intact) + YOUR
  single-slot type-compatible components badged "Yours" (snapshot-apply
  semantics, recipe-tagged with the component id — `resolveSubtype`
  optional-chains unknown ids so the fx vocab degrades to broad
  suggestions; US-8 restriction stays unit-pinned in fxSuggest.test.ts).
  Legacy `wb-subtypes` customs migrate one-way into components on first
  library read (flag `wb-components.subtypes-migrated.v1`; the old key is
  left untouched as the rollback path). The pure subtype machinery
  (`subtypeFromColumn`/`forkSubtype`/knob promotion, `pushSubtypeUpdate`)
  remains in code + unit tests but is currently unreachable from the UI.
  The library's "Whole rows" group points into **New rowview** (the
  templateModal) — the row-scoped sibling, one implementation.
- **Row components + the pnp bridge + replace-and-push (2026-07-03, issue
  #148 executed)**: `ComponentDef.kind: 'element' | 'row'` — a ROW component
  is the whole row layout (+ optional `additionalRowClass`); applying one
  runs `applyRowTemplate` (one undoable step, template semantics), so
  component libraries can carry whole rowformatter shapes. Saving the ROOT
  of an explicit row view offers row kind automatically; row components
  live under the library's "Whole rows" group beside the New rowview
  pointer and never enter the one-click column catalog. **Import from
  formatter JSON…** ("Bring your own") is the pnp/List-Formatting bridge:
  paste any column/view formatter → `componentFromFormatterDoc` (core
  `importJson` does wrapper detection) — @currentField becomes an ANY-type
  'Column' slot, refs the current schema doesn't know get ALL_FIELD_TYPES
  slots (never guess-and-hide), tiles and CFR-carrying trees refuse with
  teaching. **Replace-and-push**: saving over an existing component name
  REPLACES it (keeps its id) and, for a single-slot element component,
  `pushSubtypeUpdate(def.id, …)` re-bakes every column wearing it — one
  Ctrl+Z reverts the batch (the knobs half of subtype parity is tracked
  separately). Items 1 & 4 of #148 were assessed and deliberately deferred:
  palette drops stay prompt-free (unifying catalogs would tax simple drops)
  and the two Save labels never co-appear post-#149.
- **Components pane redesign (2026-07-03 owner brief, PRs #156–#159 via the
  integration branch)**: the ⬡ tab is first an **inventory of the project**.
  (a) **Instance provenance**: insertions go through `bindComponentInstance`,
  stamping the bound root `_component: { id, map }` (typed on SPElement beside
  `_elmName`; ships in exports by default, stripped by `keepMeta:false`,
  `META_KEYS` updated). Previews stay on plain `bindComponent` so a preview
  never reads as a usage. (b) **The usage scan** (`componentUsage.ts`, pure):
  stamped subtrees in the main doc (card content included) + column usages
  via the `field.subtype` tag OR stamped subtrees in registered trees, ONE
  usage per (component, column); deleted ids leave no ghosts. The tab renders
  "In this project" first — usage-count chips, "Show usages" jump rows
  (openMain+select / openColumnRef; `mainUsageLabel` speaks the
  column-formatter noun when the MAIN doc is a JSON-tab-imported column) —
  then the add-a-component browser. (c) **Context-aware insertion**
  (`componentInsertTarget`, pure): with a column formatter open, element
  components insert INTO it (components in CFRs are allowed — bound trees
  reference explicit `[$Field]`s); the view path is unchanged; row components
  still replace the view body with honest copy. (d) **The component EDITOR**
  (`componentEditor.ts`, modal over the canvas pane): staged editing of
  name/description/slot labels (keys immutable) and elements visually
  (preview click-select via `data-sp-path`, compact Format-cells-vocabulary
  style panel; number/boolean style values are LITERALS — only `=`-strings
  and AST objects read as formulas). "Save as new" (only option for
  built-ins) vs "Save and apply to N places": re-bakes every usage via its
  own stored `_component.map` (`rebindInstance` preserves renames +
  flex/min-width), with per-usage **"keep as-found" pinning** — pinned
  instances restamp onto a one-off variant frozen from the OLD recipe
  (`variantOf` lineage, additive in `wb-components.v1`; variants nest under
  their parent card, dangling lineage renders top-level). The whole apply is
  ONE undoable step via `state.batchProjectUpdate` — its version-bump
  ordering is load-bearing (bumps must ride INSIDE the undo snapshot or undo
  skips the re-bakes; a no-op rolls them back wholesale — see the doc
  comment). The pnp/List-Formatting live sample browser is a parked note:
  issue #155.

- **The row view builder (2026-07-03, owner brief — supersedes the 06-24
  template modal's interaction layer)**: "+ New rowview" / the row-view
  toolbar's Templates button open a WIREFRAME-first builder. The pure brain
  (`rowTemplates.ts`) now models ZONES, not one-field areas: a wireframe
  (Lead + details / Avatar card / Title + chips / Dashboard / Equal / Blank,
  `WIREFRAMES`) seeds zones by field TYPE; each zone holds ITEMS — field
  cells and ⬡ COMPONENTS (bound via `bindComponentInstance`, so applied rows
  show up in the ⬡ inventory) — and owns its space behavior in maker
  language: size `hug|normal|wide|widest` (hug = flex 0 0 auto; fills reuse
  the areas.ts weights + min-width:0), flow `side|wrap|stack` (wrap =
  flex-wrap, allow-listed: items sit side by side until the zone tightens,
  then the right item moves BENEATH the left — fill items there ride
  `flex: 1 1 auto` with NO min-width:0 so they wrap instead of crushing;
  that rule is pinned in rowTemplates.test.ts), and item width
  natural|fill. The modal opens on a CSS-drawn wireframe GALLERY
  (`data-wireframe` cards), then the zone canvas: chips for fields AND
  element components (best-guess mapping prefilled on drop; an unmapped
  slot BLOCKS Apply via `applyBlocker`, refuse-and-teach), zone/item
  selection with a contextual inspector, dividers cycling zone size, and
  the WIDTH SCRUBBER — Full/Medium/Narrow presets + a draggable stage edge
  that squeezes the preview so shrink/wrap behavior is watched, not
  imagined. Empty zones render as drop targets but are PRUNED on Apply.
  Apply is still exactly `state.applyRowTemplate` — one undoable mutation;
  everything before it is modal-local config (click-safety by
  construction). `composeRowStyle`, the kebab engine, and the dock pref
  (`wb-template-inspector-dock`) carried over unchanged.

## 3. Verified SP semantics (do not "fix" these without re-verification)

These were validated against a **real SharePoint tenant** via the
visual-compare harness (screenshot comparison, all 9 pairs MATCH on
2026-06-11; report archived in the incubation repo at
`docs/visual-compare-report-2026-06-10.md`):

1. **There is NO logical NOT** in the expression language — neither a
   `not()` function nor a standalone `!` prefix, in either syntax
   (Excel-style strings or the AST object form). `!=` (not-equals) is a
   different operator and fully supported. Negation must be rewritten
   inside the expression: `==` ↔ `!=`, `<` ↔ `>=`, swap the `if()`
   branches, or compare a yes/no field with `== false`. Owner-corrected
   2026-06-12 — the engine previously *recommended* `!` in its `not()`
   error message, which was wrong; parser, AST evaluator and linter now
   all throw/flag teaching errors for it, and generators (condRules etc.)
   must never emit a standalone `!`.
2. **CFR `@currentField` context**: inside a resolved
   `columnFormatterReference`, `@currentField` evaluates in the context of the
   *referenced* column (acting as a window into that column's data and format).
3. `gap`/`row-gap`/`column-gap` ARE supported by modern SP (an older
   internal rule said otherwise — the allow-list here is correct).
4. `.sp-card-formatterRef` is `visibility:hidden` in LIST row context on
   real SP (occupies layout, never paints) — the theme CSS emulates this
   identically. It looks like a bug; it's fidelity.
5. SP's **Export to CSV with schema omits calculated AND lookup columns**
   from the schema XML, and empty multi-lookups export as the literal
   string `"[]"`. The import help warns about this; "unresolved CFR" after
   import usually means exactly this.
6. The renderer **silently drops** styles not on the allow-list — exactly
   like SP. Surfacing them is the linter's job, not the renderer's.

Blank-cell comparison semantics (dates, lookups, people) are also
live-verified and settled — they're enforced by `core.test.ts` /
`condRules.test.ts` and a teaching lint rule. Treat them as closed: the
tests are the spec; no need to re-discuss or re-document them.

### 3b. Canon corrections — owner field testimony, 2026-06-13

The imported TwFw canon overstated several rules. The owner corrected them
from active production formatters; linter + field guide were updated to
match. Do not resurrect the old wording without fresh tenant evidence:

- **Zero Whitespace Rule** is verified fatal **only inside split()
  expressions**. Elsewhere it's an unverified generalization — the linter
  keeps a precautionary flag (info severity for non-split cases) because
  sanitize-on-export strips it anyway, but never publish "every spaced
  expression breaks".
- **CFR inside customCardProps works** (rule `cfr-in-card` REMOVED — was
  error severity, was wrong). Used in production constantly, including
  referenced formatters that open their own cards. The documented limits
  that stand: no multi-level reference resolution; no references to
  multi-choice template formatters.
- **inlineEditField inside forEach works** (rule `inline-edit-foreach`
  REMOVED). Production formatters render inline editors on looped elements.
- **forEach + split() is fatal on the ROOT element only** (rule scoped to
  `path.length === 0`); on child elements the pattern works — the old
  "only works inside customCardProps" framing was wrong.
- **_comment-as-sibling breakage is unverified** (downgraded error →
  warning). SP ignores most non-schema keys — `_elmName` ships in exports
  unharmed. Re-test before re-tightening.
- **align-self and pointer-events are unverified** "unsupported" entries —
  KNOWN_UNSUPPORTED_STYLES now says "reported … unverified" for both.
- **Card trigger hijack is a field observation, not certified** (downgraded
  warning → info). Owner-preferred robust trigger: absolutely-positioned
  overlay div; button-with-direct-txtContent also holds.
- **`.sp-card-formatterRef` scoping** (the §3 item above): the verified
  invisibility is the class used in LIST row context *outside card
  markup*. The class belongs with `sp-card-*` containers (where it's the
  expected CFR wrapper); CFRs in list views don't need it at all.

## 4. Known emulation gaps (honest list)

- `inlineEditField` renders an indicator, not an editable control.
- `defaultHoverField` is accepted/round-tripped but not emulated.
- `@isSelected` is always false; `executeQuickstep` actions aren't modeled.
- `filepreview` renders as a plain `img`.
- Footer/group formatters and form (body/header/footer sections) JSON are
  detected and **rejected with explanatory errors** — not editable.
- Icon glyphs split two ways. The app's OWN chrome icons (tree, menus,
  palette, toolbar, theme toggle, the element-reference badge) are
  **self-hosted** as inline-SVG masks in `src/chromeIcons.css` — generated
  by `tools/gen-chrome-icons.mjs` from `@fluentui/svg-icons` (MIT, pulled
  `--no-save` at authoring time; no runtime/committed dependency) — so they
  render with **no network**. ARBITRARY SharePoint `iconName` previews (the
  icon picker, the fx bar's suggestions, and the canvas renderer) still ride
  the Fabric Core 11 CDN font: those names have no local rule and fall
  through to it. So in an offline container the chrome paints but those
  arbitrary previews are blank — that's expected, not a bug. A tenant's
  newer Fluent font may also draw slightly different glyphs for the CDN
  path (cosmetic only).
- Stock palettes ≠ tenant theme; the Data tab's **Tenant theme import**
  (paste `JSON.stringify(window.__themeState__.theme)`) closes that gap
  per-project.

## 5. CI / hosting / domain — how and why

- **`.github/workflows/ci.yml`**: `test-build` (vitest unit tests + vite
  build, uploads `dist/` as the Pages artifact) → `deploy-pages` (main
  only); `e2e` runs the Playwright specs with `PW_CHANNEL=bundled`
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

1. ~~Node 20 runner deprecation — DEADLINE 2026-06-16~~ **DONE**: GitHub
   completed the forced switch, so the actions were bumped to their
   Node-24-native majors (checkout@v5, setup-node@v5,
   upload-pages-artifact@v5, deploy-pages@v5, upload-artifact@v7) and the
   temporary `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env opt-in was deleted
   from ci.yml and release.yml. No more Node 20 deprecation warnings.
1.5. **Grid-first workspace — BUILT 2026-06-12** (designed 2026-06-11,
   owner's vision). Shipped as designed: fourth canvas context on a new
   DocumentKind 'grid' (now the landing default), header menus (format /
   style / copy / hide + "+ column" for unplaced fields), drag headers to
   reorder (edge zones) or drop ONTO another column (center zone / any
   cell) to generate named row-formatter scaffolding; groups get Ungroup
   in their menu. All constraints honored — grid metaphor until grouped,
   fully _elmName'd output, one undoable mutation per gesture (see the
   invariants in §2). Schema import rebuilds pure grids so "pills etc.
   from import" land immediately. Default showcase: Title/Status/DueDate/
   Progress/AssignedTo/Project columns; Owner stays registered-but-unplaced
   to demo "+ column" adding an already-formatted column. Still open from
   this vision: advanced-mode hover-card creation from the grid surface.
1.6. ~~Playground polish backlog~~ **DONE 2026-06-12**: panel top-anchored
   (no recentering between family tabs), breathing room around the family
   story, CFR slots labeled "name ⤷ [$Field]" on their overlays with a
   confirm-and-enter button that switches the workspace to the referenced
   column formatter and reopens the playground there, and a soft confirm
   on Apply-to-canvas when name-less JSON would replace a named design.
1.7. **Preview context menus + playground restructure + conditional
   formatting — BUILT 2026-06-12** (owner's voice-memo brief). Three parts:
   (a) right-click in the preview: shared menu.ts; elements/columns/groups
   get the common actions (playground, conditional formatting, rename,
   wrap, ungroup, duplicate, copy JSON, remove — all undoable, basic-safe);
   grid headers answer right-click with their existing column menu.
   (b) playground reorganized into labeled groups: QUICK_LOOKS macro
   bundles (pill/card/stripe/ellipsis…, toggle on/off as picks), the nav
   "road" replaced by a mini structure tree beside the stage (ancestors +
   children, stash dots, CFR enter row keeps `wb-pg-navcfr`), the family
   story restyled as a tagged callout, the selected property rendered as a
   formatted card with self-applying examples, and an "already on X"
   current-styles list (expressions shown as 𝑓x; picks strike the old
   value). e2e specs for the old road were updated to the tree.
   (c) conditional formatting: condRules.ts is the brain (pure; its test
   file is the contract for generated-expression semantics — change
   behavior there first), condFormat.ts the overlay. Semantics: rules are
   first-match-
   wins via per-property =if() chains threaded through every rule; an
   existing PLAIN value on a managed property becomes the no-match
   fallback, an existing FORMULA is replaced (UI warns first). Column route
   = "Format this column" semantics (register scaffold, CFR-swap the cell
   as one doc mutation, openColumnRef switches the workspace, then the
   style merge is the undoable step). Known gap, deliberate: the builder
   is a one-way generator — it does not parse existing =if() chains back
   into editable rules; reopening starts fresh over the current style as
   fallback. Parsing chains back into rules is the obvious next step.
1.8. **Sheet mode (the Excel-true surface) — design locked 2026-06-12**,
   see docs/SHEET-MODE.md (owner decisions: ribbon, fx bar with a
   property-slot dropdown, bidirectional dialect transpiler that refuses
   rather than guesses, "every row" scope clarity, JSON host columns
   gating txtContent replacement, column subtypes = settings not paint,
   Basic → Sheet rename lands with the stage-3 shell). **Stage 1 SHIPPED
   same day**: Format cells dialog (formatCells.ts — Font/Border/Fill/
   Alignment, one undoable patch) on header + right-click menus, and
   conditional formatting now watches any column (paintField vs watched
   field split in condFormat.ts — keep those distinct). Stages 2–3 next.
1.9. **Field guide — BUILT 2026-06-12** (owner request; landed via PR #7,
   renumbered from 1.7 in the merge): ☰ menu → 📖 opens a
   full-screen Learn-style reader (`editor/guide.ts` UI + `editor/guideContent.ts`
   pages: chapter tree, in-this-article rail with scroll spy, filter,
   prev/next, inline SVG diagrams). Content = the SQL-under-React story,
   the column type system (joins/calculated/single-vs-multi capability
   matrix), the formatting JSON layer, and the linter's gotchas with rule
   tags. Factual claims were re-verified against Microsoft Learn / support
   docs at build time (lookup source types, inlineEditField + setValue
   supported types, 5,000 view / 12-join thresholds, calculated-column
   own-row rule) and against §3 of this doc; keep new claims sourced the
   same way. `e2e/guide.spec.ts` covers it.
1.10. **Connectivity Tier 0 — BUILT 2026-06-13** (owner brief; design in
   docs/CONNECTIVITY.md — read its §1 auth reality before touching
   anything here: no app registrations is a HARD constraint and only
   page-context auth satisfies it post-ACS). Shipped: the FormatFX List
   Snapshot v1 (fourth schemaImport format, ALSO the future extension
   wire protocol — version it), the GET-only extract snippet ("⚡ Live
   from SharePoint" in the Data tab; captures fields + live column AND
   view formatters + 10 rows), captured views in state.importedViews
   (additive project key) with default-view auto-load under the exact
   isPureGrid guard, and the confirm-first deploy snippet (JSON tab →
   🚀 Deploy…, advanced-gated, LINT-GATED — refuse-and-teach applies to
   deployment). Owner still owes the one-time live checklist in
   CONNECTIVITY.md §3.6 against a real tenant. Next per the design:
   npm package prep (separate PR; owner adds NPM_TOKEN + tags v0.1.0),
   then Tier-1 extension after Sheet stage 3.
1.11. **Maker-first redesign — stages 1–4 SHIPPED** (continuation tracker:
   `docs/HANDOFF-redesign.md`, added by PR #42). A five-stage pass that makes
   the default surface serve the maker and folds the developer studio behind
   one door. Stage 1 (PR #40): grid-first landing, the Studio toggle
   (`#wb-layout.wb-maker`, pref `studioOpen`), monochrome theme icon
   (themeToggle.ts). Stage 2 (PR #41): emergent formatter type — the upfront
   Type dropdown moved into the Studio, replaced by a read-only destination
   chip (`#wb-dest-chip`, formatterDestination.ts). **Stage 3 (this branch):
   the row-view builder** — Ctrl/Cmd-click grid columns to multi-select, "make
   a row view" turns them into weighted **areas** (Normal/Wide/Widest, a
   conflict-free CSS-fr-like flex; areas.ts), with row **density**
   (Roomy/Compact) a separate knob and **tile** an explicit pick that can never
   emerge; per-area sizing on each area's right-click menu, density + back-to-
   grid in a row-view toolbar. **Stage 4 (this branch): CFR linked instances
   (the Figma model)** — a teal link badge (`.wb-cfr-link`, the `#038387` of
   the Structure ⤷ chip) marks a columnFormatterReference cell; its header menu
   offers "Format this Column" (edit the shared format, blast radius named) and
   "Override in this view" (fork local, default fork-local), and a plain column
   promotes via "Save as the column's format" (cfr.ts; state.forkCfr /
   promoteToColumn, one undo step each). **Stage 5: safety + the single
   Advanced door.** (a) **Deploy clobber guard** — the deploy snippet bakes the
   target kind and, before replacing an EXISTING *view* formatter, shows a
   pointed foreign-clobber warning ("REPLACES THE ENTIRE view formatter…",
   deploySnippet.ts); columns keep the mild field-level prompt. (b) **Validated
   JSON as the single Advanced door** — the topbar toggle is relabeled
   **Advanced** and opens straight to the JSON tab (the escape hatch, with
   Deploy); Palette/Structure/Properties stay reachable, de-emphasized
   (consolidate, not delete — per the owner). (c) **"Format this column" preset
   picker** (owner request) — columnPresets.ts maps a field type to the palette
   presets that fit it (Facepile for people, data bar for number, status pill
   for choice…) and `buildColumnPreset` turns the pick into a real
   @currentField column formatter; the header menu shows the presets then
   "Format this column manually". The dead `.wb-adv` markers (no CSS since the
   2026-06-17 unification) are being removed opportunistically. e2e:
   `areas.spec.ts`, `cfr.spec.ts`, plus grid/maker/bridge coverage.
1.12. **Collaborative hub (issue #86) — BUILT 2026-07-02.** The CodePen
   model: the whole workspace serializes into the URL fragment. W1 Share —
   core/share.ts codec (native deflate-raw + base64url, versioned `w1`/`w1r`
   schemes, zero deps), topbar Share dialog (privacy toggle for mock rows,
   size warning ≥8k chars), and the never-clobber boot path (autosave paused
   while viewing a shared workspace; Save-a-copy backs the prior autosave up
   to the additive `.bak` key, restorable/swappable via ☰; Discard writes
   nothing; fragment stripped via history.replaceState after load). A bare
   formatter JSON payload (raw PnP sample) also opens — it gets wrapped in a
   synthesized workspace (shareUi.normalizeSharedPayload), which is the W2
   docs-runtime bridge; the stable third-party contract lives in
   docs/SHARE-URL.md. W3 Stress Test — ☰ → 🧪: core/stressTest.ts variants
   + threshold mining, read-only overlay (rendered rows are cloned so even
   clicks are inert; the one write is the explicit "Add to my rows", a
   normal data edit). W4 Explain — core/explain.ts + the Explain tab beside
   JSON in the Advanced pane; entries select by NodePath like lint rows.
   Unit tests: share/stressTest/explain/shareUi test files are the
   contracts; e2e/share.spec.ts covers the real-browser round trip with
   fresh-context recipients. Still open from the epic: W2's outreach motion
   (badges/PRs into pnp docs — owner's call), oversized-workspace row
   capping (the dialog warns + offers fallbacks instead).
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

- `npm test` — 701 vitest unit tests across 42 files (engine semantics incl.
  every live-verified behavior in §3, serializer round-trips, schema import
  incl. the List Snapshot edges, workspace/state, preset binding, grid
  scaffolding + grid mutations, conditional-formatting codegen evaluated
  through the real engine — that test file is the contract for
  generated-condition semantics — the bridge's EXECUTED-snippet round trips
  against stubbed fetch, and the collaborative-hub contracts: the share
  codec byte-exact round trips, the stress-test variant catalog incl.
  threshold mining, the Explain visitor over both expression syntaxes, and
  the autosave-pause never-clobber guarantee). Run headlessly anywhere.
  (Keep this count honest when you add tests — a stale number here is how
  the docs drift out from under the code.)
- `npm run test:ui` — 124 Playwright specs across `sandbox.spec.ts`
  (core flows), `import.spec.ts` (schema import + CFR + grid rebuild +
  snapshot-import/views/deploy-panel), `workspace.spec.ts` (doc switching,
  box model, flex editor, playground incl. quick looks/structure tree/property
  card, pane modes, dark-mode probe), `grid.spec.ts` (grid-first workspace:
  header menus, right-click context menus, conditional formatting incl.
  cross-column watching, the Format cells dialog, format-column round trip,
  hide/add, drag-to-group/reorder), `guide.spec.ts` (field guide),
  `areas.spec.ts` + `cfr.spec.ts` + `maker.spec.ts` (the maker-first redesign:
  row-view builder, CFR linked instances, Studio/Advanced toggle),
  `formatterNav.spec.ts` (the Left Edit Pane's VIEW/COLUMN FORMATTERS tabs +
  document dropdown), `snapshots.spec.ts` (snapshots + navigation back),
  `components.spec.ts` (the ⬡ tab: inventory + usage jumps, typed mapping
  into the view OR an open column formatter, the component editor incl.
  save-and-apply with as-found pinning, save-as, CFR refusal),
  `share.spec.ts` (the collaborative hub: real-browser
  share round trips with fresh-context recipients, the never-clobber/backup/
  restore flows, Explain, Stress Test), `styleLegibility.spec.ts`
  ("violet = shared"), `icons.spec.ts`, `subtypes.spec.ts` and
  `templates.spec.ts`.
  Containers that can't reach the browser CDN: `npm i -D --no-save
  @sparticuz/chromium`, extract with `executablePath()`, run with
  `PW_EXECUTABLE=/tmp/chromium` (verified working 2026-06-12).
- The dark-mode "engine probe" spec exists because a capture once showed
  light pills under dark mode; it pins generation AND the reload/autosave
  path. It exonerated the engine once already — keep it.
