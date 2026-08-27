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
               markers, plain-language "why") + the WCAG low-contrast rule
               (below 3:1 warning, 3–4.5:1 info; one-sided cases flag only
               when BOTH stock themes fail; theme classes/unresolvables mark
               the channel unknown → silence)
  contrast.ts  the color brain behind low-contrast: CSS color parsing
               (hex/rgb/hsl/named), WCAG luminance/ratio math, and STATIC
               color-outcome extraction over both expression syntaxes —
               SOUND pairings only (constant × chain always; two conditional
               chains pair branchwise only on identical condition sequences,
               mismatches never cross-multiply; literal group opacity is
               modeled into the blend — formula opacity is ignored, never
               silenced, since blending only lowers contrast). paletteContrast.test.ts
               holds the product's own palettes/presets/components to the
               same bar (that sweep is why #737a7f became #605e5c)
  serializer.ts   JSON ⇄ document (column/row/tile wrapper detection),
               whitespace sanitization, CSOM-safe & escaping
  commandBar.ts   the command-bar hide brain (pure, node-tested): the
               LOGICAL-BUTTON catalog (53 buttons over 93 key aliases —
               MS docs' rename table + the pnp hide-all field pattern:
               hiding emits EVERY alias), presets, and the surgical
               viewExtras.commandBarProps read/write that preserves
               foreign entries and non-`hide` customizations verbatim
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
               buildRowView turns a grid root into a weighted row),
               lookDialect.ts (the two ref-dialect converters behind column
               LOOKS — pure: inlineColumnFormatter registers pasted/imported
               column JSON as a look, @currentField→[$Field]; toColumnFormatter
               compiles a look back to a real per-column formatter,
               [$Field]→@currentField), canvasTabs.ts (the canvas TAB STRIP —
               ▦ Grid + view tabs + ⬡ workshop tabs; workshop keep-alive +
               dirty dots), leftPane.ts + viewCard/columnShelf/
               componentLibrary/viewMenu (the Mockup-B left pane sections —
               COLUMNS-COMPONENTS-VIEWS §3), viewKebab.ts (the ⋮ settings
               panel off the STRUCTURE section header since 2026-07-10 —
               on a view: density, row class, hide toggles, tile box,
               Templates, the Command buttons drill-in over
               core/commandBar; on a component workshop tab
               openComponentKebab shows Add-to-view + the where-it's-used
               jump rows instead; body-owned + fixed because pane chrome
               re-renders on every 'document' emit)
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

IDE-style JSON pane (issue #244, built 2026-07-09): the textarea stays the
real editor but paints transparent over a scroll-synced highlight overlay
inside `.wb-json-shell` — jsonIde.ts is the DOM dressing (line gutter,
bracket match, active-line band, the selected element's scope bar, the
caret-anchored typeahead + the =function( signature chip) over two pure
brains: jsonHighlight.ts (the tolerant lexer — mid-edit buffers paint, no
parser) and jsonComplete.ts (the context scanner: element/style/attributes/
wrapper key catalogs with docs, value catalogs per key, and the expression
layer riding fxSuggest's engine-grounded items + SP_FUNCTION_DOCS — never a
standalone `!`). All of it is BUFFER work: the one document write stays the
Apply button, and bare-structure menus open on Ctrl+Space only (auto-pop
would fight plain typing). acMenu gained an optional caret anchor (additive).
Prior art: thechriskent/jsonify's HorseScript IntelliSense — the feature
shape (completions + signature help + expression highlighting inside JSON),
not the code.
**Overlay sync is TRANSFORM-based (2026-07-12)**: the layers follow the
textarea via `translate()` on their `code` children, never by scrollTop —
a scroll offset clamps to the overlay's own max, which sits a
scrollbar-thickness short of the textarea's (classic-scrollbar platforms
carve the textarea's client box; the overlays never grow scrollbars), and
at max scroll the painted text sheared off the real glyph grid so a
double-click selected the NEIGHBOURING word. A shell ResizeObserver
re-syncs when a resize clamps the textarea's scroll without a scroll event
(e.g. the lint footer emptying). jsonIde.test.ts pins the transform.

The lint FOOTER (2026-07-12, owner brief): missing-column warnings fold to
ONE row per column — `unknown-field` issues carry the column name as
structured `LintIssue.field`, and the pure `lintView.ts` groups them
(count badge = references, jump = first reference) and infers a create
TYPE from usage (person/lookup accessors, forEach = multi with iterator
accessors attributed back to the field, date fns/@now comparisons,
arithmetic, boolean compares — `inferFieldType`). The row's "＋ Create
column" opens a type picker preseeded with the guess; Add rides
`state.addMockField` (the Data-tab recipe, shared now: sample values
seeded, a pure floor grows its grid column as ONE undoable mutation). The
head bar minimizes the list to a severity summary (session-only state;
per level the chip reads "2 errors (×51)" — distinct issue TYPES, then
total occurrences, runtime issues folding by message since they carry no
rule — owner ask 2026-07-17) and
hosts the missing-column filter for the paste-JSON-as-scratchpad workflow
(label reads "ignore warnings about columns missing from Data" — owner
call 2026-07-13: "hide … columns" sounded like list columns get hidden) —
it quiets rows AND squiggles, always says "N ignored" (never silent), and
persists under `wb-lint-prefs.v1` (ADDITIVE key — the frozen originals
stay frozen; the stored property keeps its original `hideMissingColumns`
name for compat). The topbar badge keeps full-truth counts. Contracts:
lintView.test.ts + lintPanel.dom.test.ts.

Same-brief follow-ups (2026-07-13):
- **Wrapper sections FOLD**: `exportJsonWithMap` emits `sections` beside the
  element ranges — every object/array under a viewExtras key (groupProps and
  its headerFormatter/footerFormatter trees, commandBarProps/commands and
  each command entry, top-level footerFormatter), keyed by '/'-joined
  wrapper path. The panel folds them exactly like elements ('@'-prefixed
  fold keys in the same foldedPaths set; chevrons labelled "section …";
  Ctrl+Shift+[ in wrapper chrome folds the innermost section; Fold others
  folds them all). Fixed alongside: candidates elided inside an ACTIVE fold
  clamp onto the sentinel's opener line — foldableFoldedLines and
  toggleAtFoldedLine now skip them in FULL-text coordinates, so interior
  nodes can neither stack ghost chevrons nor swallow the visible chevron's
  toggle (latent for elements since #PR-C, exposed by sections).
- **columnFormatterReference awareness restored (IDE/linter side)**: the
  model-B migration removed CFR from the EDITOR's document model, but pasted
  JSON carrying it always round-tripped verbatim (cloneTree copies unknown
  keys). `SPElement.columnFormatterReference?: string` types the passthrough;
  the linter treats it as standing in for elmType (no more false
  `elmType-required` ERRORS that also blocked the deploy gate), validates
  the referenced column against the schema (`unknown-field` with structured
  `field` — it joins the missing-column grouping and create flow), and
  teaches the emulation gap with a per-element `cfr-not-emulated` info
  (preview renders a placeholder; @currentField inside reads the REFERENCED
  column — §3). jsonComplete offers the key + field-ref values, and the
  view wrapper vocabulary gained groupProps/footerFormatter (carried
  verbatim, canvas doesn't edit them).
- **Search ranking + the "it replaced my canvas" scare (owner report)**: the
  universal search overlay (searchUi.ts over pure search.ts) pins the
  ACTIVE surface's document hits above other surfaces' (`SearchEntry.pin`
  tiebreak after score, before alphabetics) — searching right after pasting
  a view means THAT view, not the showcase floor's rule formulas. And any
  hit that navigates across surfaces (openView/minimizeView swap the canvas
  AND the JSON pane) now toasts "Jumped to X — Y stays open in its tab":
  the swap is pure navigation, but silent it read as data loss.

Selection-flash + fold-sync brief (2026-07-16, owner report/asks):
- **The flash that "only worked on unnamed elements"**: the JSON pane's
  selection flash bar was cleared by ANY textarea scroll event — including
  the async one fired by the reveal's own `scrollTop` write, so any element
  whose lines needed scrolling into view (the big containers, i.e. the
  _elmName'd ones) lost its flash a frame after it appeared. jsdom fires no
  scroll on scrollTop writes, which is why the suite never saw it. The bar
  now stores CONTENT-space geometry and a scroll listener repositions it
  (clipped to the viewport, hidden when scrolled fully out) instead of
  killing it; buffer swaps (edits, fold toggles, regenerate) still clear it
  via syncFoldDisplay. jsonPanel.sync.test.ts pins bar-survives-scroll.
- **Synced canvas pulse**: whenever the JSON pane flashes a selection, the
  canvas pulses the same element (every rendered instance) with the existing
  `wb-search-flash` "here it is" language — canvas.ts subscribes and skips
  origins the pane also skips. The echo instance moved to a shared
  `selectionEcho` (codeSync.ts) so both surfaces consult ONE origin tag:
  caret-originated selections ('code') flash/pulse NOTHING — arrow-keying
  through the JSON must not strobe the canvas.
- **Folding synced between the Structure tree and the JSON pane**: the fold
  set moved out of the panel into `editor/foldState.ts` — one shared Set of
  keys ('0/2' element · '#c/0/2' children array · '@groupProps' section),
  origin-tagged notifications, cleared by resetAll/loadProject, and
  stashed/restored PER SURFACE on navigation (swapSelections carries it
  beside the selection memory, silently — the callers' own 'load' emit is
  when both surfaces re-read the set, so the pane never prunes incoming
  keys against the outgoing doc's map; PR #290 review). The tree
  (treeView.ts) grew chevrons: collapse folds the node's **children:[** in
  the JSON (card-only nodes fold their element object — the only JSON fold
  that hides a card subtree), expand clears both fold kinds; an 'elm' fold
  from the JSON side collapses the row AND its card note, mirroring exactly
  what the pane elides. Collapsed rows holding the selection get
  `wb-tree-holdsel` (accent inset; no auto-expand — the same philosophy as
  the pane's clamp-to-sentinel flash). Workshop trees fold LOCALLY (staged
  paths mean nothing to the pane's map). The panel stays the owner of the
  VIEW (cuts/caret math) and prunes keys that stop resolving.
- **children:[ folds** (owner ask — "let me fold whole children arrays"):
  `exportJsonWithMap` emits `childrenRanges` (every non-empty children
  array, keyed by parent path, identity-registered like elements), the pane
  offers a chevron on each `"children": [` line ("children of element 0.1"),
  and the fold keeps the parent's own properties visible. Contracts:
  jsonMap.test.ts, foldState.test.ts, treeView.test.ts, jsonFold.dom.test.ts
  (tree↔pane round trip), jsonPanel.sync.test.ts (pulse + echo).
- **The tree follows the selection + ☰ Preferences** (owner ask, the PR
  after): on every 'selection' emit the Structure tree scrolls its selected
  row into view — `scrollIntoView({block:'nearest'})`, so an already-visible
  row never moves; a selection buried in a collapsed subtree reveals its
  nearest VISIBLE ancestor (the holdsel row) rather than auto-expanding.
  Deliberately NEVER on document/data re-renders — a maker who scrolled away
  to browse must not be yanked back by a repaint. Gated behind the new
  ☰ → More… → **Preferences** section ("Structure tree follows selection",
  default on), persisted as the ADDITIVE `treeFollowSelection` field in the
  frozen `wb-ui-prefs` blob and read live through a getter threaded
  main.ts → mountLeftPane → mountTree, so toggling needs no re-mount. The
  Preferences heading (.wb-menu-sec) is the home for future editor-behavior
  toggles; "Outline every element" moved under it.

DIRTY-BUFFER SAFETY (2026-07-13, owner ask — "can I clobber my own shit if
I edit the pane without applying?"): a dirty JSON buffer is the maker's
DRAFT. The panel's subscriber used to `clearDirty()+regenerate()` on every
non-selection emit — ANY canvas change silently ate unapplied hand-edits.
Now, while dirty: document-moving emits ('document'/'load'/'kind') never
touch the buffer — they set a `divergedWhileDirty` fork flag instead — and
**Apply confirms only when the canvas actually moved underneath** (a
never-diverged buffer applies without ceremony; the names-drop confirm
still follows). The ways out: Apply, or the new **↩ Discard edits** button
beside it (clearDirty+regenerate, doc untouched). The **sanitize
whitespace** toggle — which regenerates — confirms on a dirty buffer
before discarding (it used to discard silently) and flips itself back on
decline. While dirty the canvas sits behind `body.wb-json-editing`
(::before veil + "unapplied JSON edits" chip on `#wb-canvas`) — a
VISIBILITY cue, never a lock: both layers are pointer-events:none, so
browsing/selecting/inspecting stay live (deliberate owner-approved call
over a full gray-out lock). Contracts: jsonDirtyGuard.dom.test.ts.

View chrome kebab + left-pane polish (2026-07-09 owner brief; spec:
docs/superpowers/specs/2026-07-09-view-chrome-workshop-design.md; the kebab
RE-ANCHORED 2026-07-10 from the THIS VIEW card's heading onto the Structure
section header — leftPane.ts holds the `#wb-structure-kebab` door now, and
in component mode it opens `openComponentKebab` instead: Add-to-view + the
where-it's-used jump rows, because view settings don't apply to a def). The
card lost its inline controls AND its kebab; the inspector's Pro "Document —
{kind} formatter" section is GONE — density, row class, the hide toggles
(Selection boxes / Column headers / List header — Show DELETES the prop,
Hide writes true, so exports stay clean), the tile box, **Templates** (moved
off the canvas row-view toolbar 2026-07-10 — that bar is label-only now),
and the **Command buttons** drill-in all live in the kebab. Command hides ride `viewExtras.commandBarProps` through
`core/commandBar.ts` (see the src map — logical buttons emit every key
alias; presets: Hide all / Show all / Collect entries / Read only /
Declutter; one preset or toggle = ONE undoable mutation; foreign entries
and text/iconName/position customizations survive byte-for-byte). The
panel is body-owned (snapMenu pattern, `wb-esc-owner`), redraws in place on
'document' emits, and closes only when the tab it opened on stops being
active. jsonComplete gained the commandBarProps/commands vocabulary (key
values suggest the real catalog). Left pane same day: every top-level
section (Structure tree included — it finally has a header) is a
collapsible `wb-lp-sec` with a FROZEN (sticky) header inside the two
scroll regions; the Views list's own title row died (the section header
carries it); `.wb-lp-props` defaults heavier (flex 1.4) and **splitter 2**
(`#wb-lp-splitter2`) makes the shelves/props boundary draggable
(double-click resets; folding the inspector or tree clears stale drag
sizes) — available in BOTH lenses (the 2026-07-10 note about the tree
splitter hiding in Simple is history: Simple/Pro merged 2026-07-24, below).
Same pass: the structure tree's row hover-actions are
display:none at rest now (the always-in-flow invisible buttons reserved
width and displaced row content; a row min-height keeps hover from
reflowing). playwright.config gained PW_PORT for this multi-session machine —
without it, reuseExistingServer attaches tests to whichever session's dev
server owns 5173 and silently tests THEIR code.

Left-pane lens merge + section fold affordances (2026-07-24 owner brief):
the **Simple lens is GONE** — the pane has TWO lenses now, **Properties**
(internally still `'pro'`: the id is FROZEN because it persists in
`wb-ui-prefs`; main.ts maps a stored `'simple'` to it) and **Code**, so the
tab swap reads as "Code replaces Properties and vice versa". The Properties
inspector is the UNION: the old Pro sections plus the Simple-only
conveniences (Arrange children, Box model, Typography) in one sectioned
flow. The `.wb-lp-collapsebar` rails — VERTICAL 7px rails wearing the
splitter look but acting as CLICK targets (the shape was corrected twice on
2026-07-24, from a horizontal first cut, then from per-section rails): the
tree and the inspector each carry their own down their section's left edge
(aria-hidden divs — their header buttons stay the accessible controls), and
the Columns/Components/Views trio SHARES ONE (`data-sec-bar="shelves"`)
riding the `.wb-lp-shelves` region outside the new `.wb-lp-shelves-scroll`
column — so it spans the sections plus the slack space down to the props
splitter, mirroring the one resize handle the trio already shares. The
shared rail is a real `<button>` (aria-label + aria-expanded, keyboard-
activatable — Copilot a11y catch on #306): its fold-the-trio action has no
other single control. Clicking it folds the group (any open → fold all;
all folded → open all — the same persisted per-section flags the headers
write; it subsumes the #280 shelves border-rail), and the ALL-FOLDED state
— reached from the rail or the last header — shrinks the region to its
three header bars (a `:has` rule drops its flex share) and clears the
splitter-2 pin so **Properties auto-fills the freed height** (owner
follow-up on #305); reopening returns the default split. Splitter 2's
drag math treats a folded trio as un-shrinkable (its floor is the measured
header-bars height, not the 72px flex floor). And **splitter 2 displaces the tree** (issue #292
round 2): dragging the shelves/props boundary up shrinks the flex shelves
to their 72px floor first, then the Structure tree down to its 80px floor,
regrowing the tree (up to where it started) while the same drag returns.
Contracts: leftPane.test.ts + the workspace.spec.ts left-pane-chrome test.

Same-day follow-ups (2026-07-24, second PR): the collapse bar became the
VERTICAL left rail described above. **Nav trail widened (#145)**: `NavEntry`
is a union — `{kind:'surface'}` doc/sheet switches plus `{kind:'lens'}`
Properties↔Code switches; kind changes (grid↔row/tile) are deliberately NOT
recorded (document mutations belong to the undo stack — Back never mutates),
and overlays keep their own close affordances. `state.backLabel` names the
destination for the tooltip/toast. **Placement (#145/#152)**: ← Back and 📷
take-snapshot moved OUT of the ⋮ menu into the nav row's actions cluster
(`.wb-lp-nav-actions`; `takeWorkspaceSnapshot` exported from snapMenu.ts —
the restore list stays under ⋮). **Drawer (#127)**: below the 900px
breakpoint the edit pane is a fixed slide-in drawer (`#wb-lp-drawerbtn`
handle + `#wb-lp-scrim`, `wb-lp-drawer-open` on the layout; pure view state,
closed on load) instead of an inline region in the stacked scroll. **Data on
land (#87 WA)**: the no-saved-prefs `dataMode` default flipped 'min' →
'normal' so a fresh maker sees rows immediately; saved `wb-ui-prefs` win.

Narrow-shell polish (2026-07-24, owner screenshot review): the <900px
topbar earns a single row — Search/Share collapse to icons (`.wb-btn-label`
hides; Search gains an inline-SVG magnifier `.wb-btn-icnarrow`, deliberately
NOT a new `ms-Icon--` literal so the chromeIcons drift guard stays quiet),
undo/redo drop their wide-desktop side padding, and "Send to extension"
swaps for a ☰ twin (`#wb-menu-send-ext`, same handler and extension-ready
gate; CSS shows exactly one of the pair per breakpoint). The stacked JSON
pane now GROWS to fill the viewport leftover (flex 1 1 auto — no dead band
below Problems), and the ⛶ JSON maximize is no longer neutralized when
stacked: it hides the whole center section plus the drawer's floating ✎
handle and pins the pane to everything under the top bar (min-height:0 —
the pane's tabs scroll internally). Maximizing also CLOSES an open drawer
through `setDrawer(false)` (the `closeLeftDrawer` hook in main.ts): the
scrim blocks mouse clicks on ⛶, but keyboard activation gets through and
the drawer would otherwise keep covering the maximized pane (Copilot
review, #307). Contracts: the stacked-⛶ spec in paneStates.spec.ts and
the narrow-topbar spec in sandbox.spec.ts.

The workshop seam (2026-07-09 owner brief, same spec §C — supersedes the v1
"a workshop tab never re-targets the tree" constraint): `state.workshopCtx`
(a `WorkshopContext`) is registered by `mountComponentWorkshop` and cleared
on unmount. While a workshop tab is up, the STRUCTURE TREE renders the
STAGED component tree (select + rename + eye only — structural gestures
stay surface-only; embed placeholders are read-only ⬡ rows via
`embedNameOf`) and the INSPECTOR styles staged elements with its full
vocabulary — every write in inspector.ts routes through
`editMutate`/`editNodes`/`docRoot`, landing on the workshop's MODAL-undo
(one gesture = one ↶ step, `'workshop'` emits, never autosave, never the
app stack; Save stays the one app-level step). Surface-coupled tools gate
off in workshop mode: the instance card, conditional formatting, ▦ Map
data, the trigger generator. The workshop's embedded style panel and mini
struct list are GONE (the canvas got slimmer — preview + identity + slots
+ embeds + save is all that's left); its `stylePlainValue`/`styleIsFormula`
exports remain the pure classification seam. Known follow-up: the fx bar
still targets the covered SURFACE's selection while a workshop is up
(pre-existing; visible now that the pane re-targets — owner call on
whether it should hide or ride the seam).

Key structural invariants:
- **Columns · Components · Views (2026-07-06/07 — the model-B migration;
  spec: docs/specs/COLUMNS-COMPONENTS-VIEWS.md, all phases shipped)**: a
  COLUMN is data (typed shelf chips; `MockField` carries no formatting), a
  COMPONENT is the only unit of formatting, and a column's look = a
  component applied to it. `state.columnLooks` (field → baked bound
  instance, explicit-`[$Field]` dialect, root stamped `_component`)
  replaced the `columnRefs` CFR registry; the floor's grid cells EMBED
  clones of the looks (no reference element — `columnFormatterReference`
  left the document model, the renderer resolves nothing). Per-column
  export compiles on demand (`toColumnFormatter`); imports register
  UNSTAMPED looks one "Save as component…" gesture from editability.
  Navigation is the CANVAS TAB STRIP (`#wb-canvastabs`): the standing
  ▦ Grid tab + one rearrangeable tab per opened view (dblclick renames,
  ✕ closes without deleting) or ⬡ component WORKSHOP (the re-housed
  componentEditor covering the canvas; staged edits keep-alive across tab
  switches, dirty-dot + confirm-to-discard). The left pane is Mockup B:
  nav row → This-view card → structure tree ("⬡ Name ← Column" binding
  rows) → columns shelf → always-on components library ("＋ New
  component…") → views list → lens tabs/toolbar/inspector (+ the INSTANCE
  card: re-bind, open-in-workshop, detach, remove-the-look). Grid header
  menu: Apply/Change/Remove a component, Save as component…, Copy column
  JSON (compiled), Hide; ⬡ drops on columns apply looks. DELETED surfaces
  (don't trust older bullets that mention them): the VIEW/COLUMNS/
  COMPONENTS formatter tabs, the document pill, the column gallery, the
  view strip, the CFR drill-in (`openColumnRef`), the § channel, the
  subtype engine + knob forms, and the per-column Format-cells/
  conditional-formatting header routes (both live on at ELEMENT level via
  the context menu).
- **Grid-first workspace (kind 'grid', the landing default)**: a grid doc
  IS a row formatter in embryo — the root is the future rowFormatter flex
  row and **each root child is one grid column**. The canvas renders header
  + body rows as separate CSS grids sharing one track template
  (`--wb-grid-cols`), cells carry the child's `data-sp-path`, so selection
  /palette-drop/tree/inspector all work unchanged. Column↔field mapping is
  derived (the look cell's `_field` stamp when present, else the single
  `[$Field]` ref in the subtree — `gridColumnField`), NOT stored beyond the
  stamp. Serializer
  treats 'grid' exactly like 'row' (re-importing detects 'row'; project
  files keep 'grid'). **Every grid gesture is ONE undoable document
  mutation** (`moveNodeTo`/`groupNodes`/`unwrapNode`/insert/remove) — a
  roadmap contract; no-op moves must not snapshot. Generated structure
  arrives fully `_elmName`'d ("Status + DueDate group"). A column gets its
  formatting by WEARING a component (`applyComponentToColumn` — store +
  placed cell rewrite together, one step). Schema
  import rebuilds the grid root **only while `isPureGrid`** (every column
  still single-field) — never clobber a layout someone has started.
- **Workspace model (FLOOR-AND-SHEETS Stage 1, 2026-07-05; registry/drill
  language SUPERSEDED 2026-07-07 by the migration bullet above — column
  formatters are now `columnLooks`, there is no drill-in, and the canvas
  doc key is always 'main')**: the FLOOR
  (`state.floorDoc`, a columns-only grid document, kind always 'grid') +
  N named view SHEETS (`state.views: SheetDoc[]`, each row/tile;
  `activeViewId` is the open sheet or null for the floor) + the column
  LOOKS (`state.columnLooks`, keyed by field internal name,
  workspace-owned — the floor's cells embed clones; view drops clone them).
  `state.doc` is the live canvas document: the active surface's slot
  object. `openView`/`minimizeView`
  are NAVIGATION (never a mutation, never an undo step). Undo is ONE
  global app-level stack whose snapshots capture the
  whole workspace + where the change happened — undo/redo navigate back to
  the surface they change (and always emit 'data': a restore can change
  the views/tabs/looks collections without moving the canvas).
  A main document of kind 'column' does not exist: column examples/JSON
  register as the current field's look and select its grid column.
  **Stage 2 (2026-07-05; its NAVIGATION chrome — the view strip and the
  COLUMNS/VIEWS tab semantics — was replaced 2026-07-07 by the canvas tab
  strip; `viewStrip.ts` is deleted)**:
  `loadDocument` gates row-payload-onto-floor on `isPureGrid` — a
  zoned layout becomes a NEW sheet, so the floor never renders
  pseudo-columns. Column TAB GROUPS (`colGroups.ts` pure + node-tested;
  `state.floorGroups`, an ADDITIVE project key sanitized on load) are
  presentational-only browser-style groups on the grid: pill ribbon +
  header bands + collapsible slim tracks; group gestures are project
  metadata off the undo stack (the renameView rule), and the exported
  floor is byte-identical with or without them.
  **Stage-2 follow-ups + Stages 3–4 (2026-07-05, second owner brief; the
  formatter-tab/pill/gallery chrome named here died 2026-07-07)**:
  components are OFFERED FROM THE PALETTE
  (`paletteComponents.ts` — canonical trees, authored-intent slot types
  via `presetRefTypes`, same definitely-renders unit bar) and element
  component rows drag onto the canvas (complete best-guess → insert at
  the drop point, provenance-stamped; incomplete → the typed mapper;
  dropped on a grid COLUMN they apply as its look).
  Stage 3: the **Select/Live** toggle on the canvas chrome
  (`state.canvasMode`, session-only; `RenderOptions.interactive: false`
  makes Select-mode clicks select customRowAction buttons instead of
  firing them; Live fires behaviors and never selects; card flyouts open
  in both modes). Stage 4: condFormat now rides
  `createOverlay`, viewMenu carries `wb-esc-owner`, and the marker is the
  whole Escape convention (no owner lists — the old prose enumerations
  were stale and are gone). The §2.3 modal-local ↶↷ undo is shared:
  `modalUndo.ts` (pure brain + capture-phase key wiring + the ↶↷ button
  pair) is wired into the component editor (staged tree only — text
  fields stay native), Format cells and conditional formatting, each with
  render()-chokepoint commits; Save/Apply still lands as ONE app-level
  step. Deliberate exemptions (knob form, compmap dialogs, playground,
  the builder's own predating stack) are recorded in FLOOR-AND-SHEETS §3
  Stage 4.
- **Node addressing**: selection/lint paths are arrays of child indices;
  the sentinel **`CARD_SEGMENT = -1` descends into
  `customCardProps.formatter`** — that's how card content is fully
  editable (tree, canvas-flyout click-select, inspector).
- **Inspector self-commit**: the inspector skips re-rendering on its own
  commits (module-level `selfCommit` flag) so focus stays put — this is
  what makes box-model ↑/↓ stepping possible. Don't "simplify" it away.
- **Autosave**: debounced 400ms to localStorage + `flushAutosave()` on
  `beforeunload` (a real bug once: a theme toggle right before reload was
  lost to the debounce). Format v2 since Stage 1 (`floor`/`views`/
  `activeViewId` replace the old `doc`/`viewName`) under the SAME frozen
  key; `loadProject` is a strict load guard — an old or garbled blob
  throws and `restore()` falls back to the fresh default (no migration
  code, per FLOOR-AND-SHEETS §3/§4).
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
- **Left Edit Pane (2026-07-02 owner mockup; its FORMATTER TABLIST,
  document pill and § tree language were RETIRED 2026-07-07 — the pane is
  Mockup B now, see the migration bullet above)**: the
  ribbon breadcrumb strip (`#wb-ribbon`, `breadcrumb.ts`) is GONE; the nav
  row is ◂ minimize · lens tabs · ⋮ menu since 2026-07-10 — ← back is an
  item INSIDE the ⋮ menu (with undo/redo/insert/snapshots), and the ◂
  minimize took back's old far-left spot. The tree renders
  the ACTIVE surface only (no doc headers, no
  per-row checkboxes — the row highlight is the selection UI; Ctrl/Cmd-click
  multi-selects); a bound component instance is ONE normal row reading
  "⬡ Name ← Column" (from `_component.map`). The tree
  region sits on `--wb-lp-tree-bg`, one subtle step lighter than the pane.
  Host-cell defaults were AUDITED, not changed: the scaffold's
  `flex:1/min-width:0` block host passes full width through and imposes
  nothing — the embedded look's alignment/size wins exactly as far as
  real SP allows (probe evidence in PR #158; `align-self` stays unverified,
  so nothing new is emitted). The Save/Discard checkpoint buttons were removed
  (issue #140 tracks their snapshot-based replacement; the state API —
  `markSavepoint`/`discardToSavepoint` — is kept for it).
- **Snapshots + navigation back (2026-07-03, issue #140)**: the 🕘 button on
  the left pane's nav row opens the snapshot menu (`snapMenu.ts` over the
  pure `snapshots.ts` store brain). Snapshots are **full-workspace-only**
  (owner decision, later same day — superseding the scoped-primary design):
  the ONE take action always captures `{ kind: 'all' }` (floor + every view
  + the column looks); legacy scoped captures stay restorable under a
  collapsed "Older, scoped snapshots" group (never orphan user data — a
  legacy column scope now restores as that field's LOOK), and
  `snapshots.ts` still knows the old scopes for storage compat. Every
  restore is ONE undoable step — `applySnapshot` rides `snapState` (docs +
  looks together), so even restore-everything is a single Ctrl+Z; the
  view name restores off the undo stack (same rule as `setViewName`).
  Storage: `wb-snapshots.v1` (ADDITIVE key — frozen keys stay frozen),
  capped at 25 per scope, oldest evicted per scope. The **← Back** item at
  the top of the same ⋮ menu (a standalone nav-row button until 2026-07-10)
  is **navigation back** — a nav-history stack in state
  (`backTarget`/`goBack`, pushed by surface switches) that
  retraces grid⇄view wandering; it is NOT undo, skips entries whose sheet
  has since been removed, and
  never ping-pongs (going back pops the trail). Related canvas fix:
  `.wb-fxbar` reserves its populated min-height so selection changes never
  shift the grid mid-double-click.
- **Components — formatting without a column to call home (2026-07-03, owner
  brief)**: the third color channel — **teal ⬡** (`--wb-component`, beside
  blue=view and violet=column; same exclusivity rule). A component
  (`components.ts`, pure) declares typed SLOTS ("needs a person column, a
  date column") over a tree written against slot keys as field names;
  binding rewrites `[$Key]`→`[$YourColumn]` via `remapFieldRefs` (the SAME
  boundary-aware remap presets.ts now imports for schema-aware drop). The
  components LIBRARY is a STANDING left-pane section since 2026-07-07 (the
  old tab-swap mode died with the formatter tabs): built-ins ("Yours"
  below), live best-guess previews, slot chips, and **Add…** → the
  typed mapping dialog (type-filtered pickers, best-guess prefilled, live
  preview; insert = one undoable step, a new grid column on the grid).
  **Save as component…** lives on the element context menu AND the column
  header menu (packaging the registered format via `inlineColumnFormatter`);
  it derives slots from the referenced fields and REFUSES subtrees carrying
  a columnFormatterReference (components are self-contained). Storage:
  `wb-components.v1` (additive), 50 cap. Built-ins must pass the
  definitely-renders unit contract (bound + rendered over every mock row,
  zero runtime issues, no standalone `!`).
  **Surface consolidation (owner request, same date; completed by the
  2026-07-07 migration)**: the custom-subtype
  authoring surface was SWALLOWED and then the SUBTYPE ENGINE ITSELF was
  DELETED with the migration (knob catalog, `bakeSubtype`, the seeds, the
  `subtype`/`subtypeArgs` field tags) — the one-click catalog is the header
  menu's **"Apply a component…"**: single-slot type-fitting components,
  badged Built-in / Yours.
  Legacy `wb-subtypes` customs still migrate one-way into components on
  first library read (flag `wb-components.subtypes-migrated.v1`; the old
  key is left untouched as the rollback path).
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
  integration branch)**: the library leads with an **inventory of the
  project**.
  (a) **Instance provenance**: insertions go through `bindComponentInstance`,
  stamping the bound root `_component: { id, map }` (typed on SPElement beside
  `_elmName`; ships in exports by default, stripped by `keepMeta:false`,
  `META_KEYS` updated). Previews stay on plain `bindComponent` so a preview
  never reads as a usage. (b) **The usage scan** (`componentUsage.ts`, pure,
  reshaped 2026-07-07): stamped subtrees in the ACTIVE surface's doc (card
  content included) + one usage per (component, column) whose LOOK carries a
  stamp — so on the grid a dressed column reads as TWO usages, the look
  store entry and its embedded floor cell; deleted ids leave no ghosts. The
  pane renders
  "In this project" first — plain clickable usage counts (the teal badge
  chrome died 2026-07-10; clicking pops out the where-it's-used jump rows,
  `openUsagePopout`/`usageJumpList`, shared with the def card's count and
  the component kebab), jump rows in the drawer
  (select on the canvas / select the dressed grid column) —
  then the add-a-component browser. (c) **Insertion target**
  (`componentInsertTarget`, pure): on the grid element components arrive as
  a new root column, on a view at the selection; row components
  still replace the view body with honest copy. (d) **The component EDITOR
  = the WORKSHOP** (`componentEditor.ts`, re-housed 2026-07-07 from the
  retired modal into a canvas TAB — `mountComponentWorkshop`): staged
  editing of
  name/description/slot labels (keys immutable) and elements visually
  (preview click-select via `data-sp-path`; the embedded style panel and
  mini struct list DIED 2026-07-09 — the Structure tree and the real
  inspector ride `state.workshopCtx` instead, see the workshop-seam
  paragraph below; number/boolean style values are LITERALS — only
  `=`-strings and AST objects read as formulas). "Save as new" (only option for
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
- **⬡ pane rows + the one trigger model (2026-07-05, owner brief — "why do
  we have such a different looking card list"; issues #203/#204 executed)**:
  the components pane now speaks the SAME inventory language as Columns and
  Views — one `wb-tree-row`-idiom ROW per component (⬡ teal ink, dim
  slot-type hint, plain clickable usage count, hover actions ✎/＋/✕ sized
  like the structure tree's #220 buttons — order flipped + plain count
  2026-07-10, drag source for
  element kinds) with a click-to-expand details drawer (description, slot
  chips, live preview, usage jump rows, Add). Both card shapes
  (`.wb-comp-card`/`.wb-comp-used`) are gone from the DOM; their CSS blocks
  remain (frozen prefix — harmless). DOM contract:
  `componentLibrary.test.ts`. TRIGGERS bind at APPLY time
  (docs/specs/TRIGGER-MODEL.md, decisions §8 owner-delegated): the mapper
  gained "Where should this appear?" — inline (default) or hover/click card
  on a candidate division (`triggerBind.ts` pure: candidate scan = div +
  children + no card/action in subtree, never inside a card; the generator
  emits the robust `sp-card-defaultClickButton` overlay for click so
  children can't swallow it — generate, don't lint). One pick = ONE
  `mutateDocument` (overlay + props + stamped component); the trigger
  carrier gets selected. The inspector's Row action section gained
  "⚡ Make this a click surface" for the action kinds — a full param form
  (defaultClick / executeFlow flow id / setValue column+value / link url,
  refuse-on-incomplete). The drop-target gesture shipped same-day after
  owner pushback as "🎯 Point at it…": mapper card mode hides the dialog,
  candidates glow on the canvas (`.wb-trigger-candidate`), click picks the
  host, Esc cancels; placement + beak toggles beside it. Raw canvas drops
  stay prompt-free inline inserts (standing #148 decision) — the pick
  gesture, not the drop, is the trigger door. Nested/overlapping triggers
  stay parked (#205).

- **The row view builder (2026-07-03, owner brief — supersedes the 06-24
  template modal's interaction layer)**: "+ New rowview" / the
  structure-header kebab's Templates entry (on the canvas toolbar until
  2026-07-10) open a WIREFRAME-first builder. The pure brain
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
  selection with a contextual inspector (zone size lives there — the
  divider is a drop seam only, its click-to-cycle was removed 2026-07-04
  at the owner's request), and
  the WIDTH SCRUBBER — Full/Medium/Narrow presets + a draggable stage edge
  that squeezes the preview so shrink/wrap behavior is watched, not
  imagined. Empty zones render as drop targets but are PRUNED on Apply.
  Apply is still exactly `state.applyRowTemplate` — one undoable mutation;
  everything before it is modal-local config (click-safety by
  construction). `composeRowStyle`, the kebab engine, and the dock pref
  (`wb-template-inspector-dock`) carried over unchanged.
  **Round trip (owner request, same date — the builder is NOT a one-way
  generator)**: `configFromView` parses an applied row view back into the
  builder config, so reopening the builder on a row it produced lands in
  the ZONE EDITOR with zones/items/mappings/styles intact (and re-Apply
  skips the overwrite confirm — it's the edit flow). Correctness is the
  **rebuild-verify gate**: the parse is best-effort, then rebuilt through
  `buildTemplateView` and deep-compared against the original tree +
  wrapper class; anything hand-edited beyond the builder vocabulary fails
  the gate and falls back to the gallery with an honest note
  (`wb-template-foreign-note`) — a lossy reopen-then-Apply is structurally
  impossible. Zebra recognition is pinned to the exported
  `ZEBRA_ROW_CLASS`; a baked leftStripe color verifies against the color
  the ORIGINAL carries so theme flips between Apply and reopen still
  round-trip. Same-date UX pass: the zone TREE rail (`wb-ztree-*` —
  NAMESPACED; `wb-tree-*` belongs to the studio structure tree, a real
  collision found by e2e) is the deterministic selection surface with
  "＋ Zone" (empty zone, no drop required — the jarring edit/preview
  end-gap is gone); zone tags lead with the zone NAME, and hovering an
  inspector section (Width/Items/Align) stamps `data-peek` on the modal so
  every tag peeks that setting's value — pure CSS switch, no rerender.
  **Second same-date pass (owner brief)**: the builder now has the
  Left-Edit-Pane SHAPE — a fixed left side column with the zone tree ON TOP
  of the always-left inspector (`wb-template-side`/`wb-template-treehost`;
  the dock toggle and `wb-template-inspector-dock` pref are retired — the
  orphaned key is harmless). **Positional drag-drop everywhere**, one rule
  (`dropPos`, pure + unit-pinned): near an edge = BETWEEN (an accent
  insertion bar via box-shadow — never position:relative on rendered
  formatter content), on the body = INTO (highlight). Tree rows and canvas
  blocks are both drag sources AND targets; chips/items drop between items
  (flow-aware axis), onto a zone body (append), onto a zone edge or the
  divider (SPAWN a new zone between — `insertZone`/`newZoneAt`, item moves
  ride along); zone rows reorder by edge. **Modal-local undo/redo**: every
  gesture funnels through `commit()` onto an immutable-config stack —
  Ctrl/Cmd+Z / Shift+Z / Ctrl+Y (capture-phase; text inputs keep native
  editing undo) plus ↶/↷ buttons; a fresh wireframe pick is the BASELINE
  (not a step), a dirty re-pick is undoable; Apply remains the only
  document write.
  **Third same-date pass (owner brief — "zones inside zones")**: the model
  is RECURSIVE — a zone is a valid item of another zone (`NestedZoneItem`),
  and every address is a `ZonePath` (`[root, item, item…]` — one address
  space for selection and drag; DOM keys join with ':'). The pure ops are
  path-based (`zoneAt`/`nodeAt`/`addItemAt`/`removeNode`/`patchZoneAt`/
  `patchItemAt`) with ONE generalized `moveNode(from, toZone, toIndex)`:
  into a zone NESTS (a leaf stays a leaf, a zone becomes a nested item),
  onto the root row UN-NESTS (a leaf gets a zone of its own — same rule
  that spawns zones from chips at seams), own-subtree drops refuse,
  `toZone: []` is the root. Drag payloads collapsed to one `NODE_MIME`
  JSON path. prune/applyBlocker/the round-trip parser all RECURSE (nested
  zones are recognized by the builder's own "<label> zone" naming, gated
  as ever by rebuild-verify). The Edit/Preview toggle is GONE — always-
  live rows (the PRUNED layout, exactly what Apply writes) render under a
  "Live" caption right below the edit row; the width scrubber squeezes
  both. Clicking a zone selects the ZONE first; a second click drills
  into the item (progressive selection — canvas clicks are no longer
  ambiguous). Polish per the brief: the 2×2 action grid (↶ ↷ / Cancel
  Save) sits top-left beside the chips (the inspector footer is gone; the
  Save button keeps the `wb-template-apply` class), the tree sits on the
  lighter `--wb-lp-tree-bg` step with ▤ Layouts beside its ZONES header,
  the empty-zone hint is a zero-footprint absolute overlay (never drives
  hug sizing; pruned live rows never show it), nested-zone tags paint
  inside on hover/selection only, and the zone inspector gained
  "＋ Nested zone".
  **Tiles (2026-07-04, owner brief — the builder works for tiles too)**:
  the config carries a TARGET (`'row' | 'tile'`, `BuilderTarget`) — the
  SAME zone model either way; a tile just stacks its zones top to bottom
  inside the fixed tile box (root: flex column, width/height 100%,
  box-sizing border-box, overflow hidden — all allow-listed; zone `size`
  then shares HEIGHT). The gallery groups **Row layouts / Tile layouts**
  (4 tile wireframes: Headline/Profile/Stat/Blank; `wireframeById`'s
  fallback stays the ROW blank), "＋ New tileview…" sits beside "＋ New
  rowview…" in the left pane's views list (an explicit ask that doesn't
  match what reopened lands on
  the GALLERY, reopened config kept — the dirty re-pick confirm is the
  net), and the root inspector's **"Applies as"** segmented re-targets
  the same zones row↔tile mid-edit (modal-local until Save). Tile
  differences are exclusions with reasons, not new machinery: zebra greys
  ("tiles sit in a grid" — the tile wrapper has no additionalRowClass)
  and the kebab section is a teaching note (every position would render
  as a stacked strip; buildTemplateView + childSlotOrder both refuse it).
  The Tile inspector owns the tile box (width/height knobs, stock
  254×220, `TILE_DEFAULT_*`); the preview drops the width scrubber for
  tiles and renders a live TILE DECK at the exact box instead. Save
  routes to `state.applyTileTemplate` (one undoable mutation: root + kind
  + tileWidth/Height together, same no-op guard as applyRowTemplate;
  viewExtras deliberately untouched so switching back to a row view loses
  nothing). The round trip is target-aware: `configFromView(…, target)`
  reopens a tile doc as tile zones (the tile box reseeds from the doc
  wrapper), and the rebuild-verify gate makes cross-target parses
  structurally impossible. Root-zone drag axis + dividers follow the
  target (vertical seams, `wb-edit-divider--h`); nested-zone drop axis
  now follows the parent zone's flow everywhere.
  **Alignment pass (2026-07-09, owner brief — "visually edit the relationship
  between child elements, not just the elements")**: every level has TWO
  alignment axes in maker language. A zone keeps `align` (Left/Center/Right,
  semantics unchanged) and gains `valign` — Top/Middle/Bottom (+ **Text
  baseline** on row flows; a stack's vertical is `justify-content`, where
  baseline has no meaning and paints as top). The ROOT gets the same pair:
  `rootVAlign` (row = `align-items`, incl. **Fill height** = stretch — the
  legitimate door to per-zone vertical placement, since per-child `align-self`
  stays unverified/refused (§3b); tile = `justify-content`, vertical only) and
  `rootAlign` (row-only horizontal packing). Defaults emit byte-identical
  trees to the pre-alignment builder and the round-trip parser recovers every
  knob, so old applied layouts reopen unchanged (rowTemplates.test.ts pins
  both). The ROOT is a first-class selection now — the old selection
  confusion is gone: a standing "▦ Row layout / ▢ Tile layout" tree row
  (highlighted whenever the selection is null, which always meant the root)
  plus a clickable ▦/▢ tag pill on the edit exemplar. Alignment edits are
  VISUAL: icon pads (self-drawn inline-SVG bar glyphs — no icon font, no
  network) on labelled axis rows, and hovering an Align control PEEKS (new
  'valign'/'rootvalign' keys): zone tags flip to their vertical value and
  every zone paints a dashed guide line at its alignment level
  (`data-zone-valign` / `data-root-valign` stamps + pure-CSS ::after — no
  rerender). Same-day scrubber repair (owner's live bug): the width handle
  painted UNDER the position:relative stage and could not be grabbed (it is
  position:relative itself now), and the squeeze is HONEST — non-tile
  preview rows `overflow-x: clip` at the simulated width the way a real
  narrow screen cuts off, with a measured "doesn't fit — ~Npx too wide" note
  under the edit row instead of content silently painting past the moved
  boundary. Same-day polish (owner brief): a selected zone's DIRECT child
  zones echo the selection ring in translucent accent (pure CSS, full ring
  stays on the selected/drop-hovered node), the between-zones divider is
  INVISIBLE at rest — still the drop seam, painting only while a payload
  hovers it — and the empty-zone min-width floor is !important because a
  fill zone's inline min-width:0 collapsed an empty nested zone inside a
  stack to an invisible 0px drop target.
  **The layout SELECTOR + one "New view" door (2026-08-26, owner brief —
  supersedes the wireframe-card gallery and the rowview/tileview split)**:
  stage `'pick'` is a two-pane SELECTOR now — a narrow left list of every
  layout (compact thumb + name; foldable **Recent / Row layouts / Tile
  layouts** groups, recents session-scoped module memory à la searchUi,
  `resetPickMemory()` for tests) beside a wide LIVE right-pane preview
  (pruned `buildTemplateView` + `ctxForRow`, the exact Live-section path,
  real sample rows; a quiet prompt until a selection). Selecting DRILLS the
  left pane into a details card (`.wb-lay-detail`, one elevation step up,
  back arrow leading): blurb, zones in the house vocabulary, the columns
  the seed would place, and behaviors via the new pure
  **`summarizeConfig`** (rowTemplates.ts) — derived from the SAME rules
  Apply uses (buildKebab refusals mirrored), so the pane never promises
  what Apply won't write. Selecting is BROWSING: nothing touches the
  config until **Next** (footer, bottom-right beside Back) runs
  `confirmPick` — RESUME requires BOTH the selection matching
  `ui.config.wireframeId` AND explicit-pick provenance from the TRUST
  CHAIN (`currentTrust`/`pastTrust`/`futureTrust`, kept in lockstep with
  the undo stacks): id equality alone is NOT sufficient, because a
  reopened sheet's configFromView stamp is the 'blank'/'tile-blank'
  sentinel and 'blank' is also a real, pickable layout — only a pick this
  open pedigrees an id, and undo/redo carry that pedigree with the
  config. On RESUME the context renders the KEPT config in the details
  pane + live preview (`ModalApi.resumeConfig`, with an accent "edits in
  progress" row); a different layout → `pickWireframe`, whose at-stake
  gate is `dirty || past.length > 0 || future.length > 0` — a prior
  re-pick leaves dirty=false with real states in `past`, and an undone
  re-pick leaves the replaced work in `future` ONLY; all three must keep
  both the confirm and the undoable-commit path (the adversarial review
  caught the silent history wipe; Copilot caught the redo-only leg). A reopened sheet backed out to the list (no source
  wireframe) gets the footer button as an enabled **Resume**. Ctrl+Z is
  INERT in the pick stage (nothing renders the config there — an undo
  would be invisible work loss). Chrome geometry mirrors the app: top bar = title + CENTERED
  undo/redo (edit only), chips on their own bar (edit only), and the
  footer holds the journey buttons in both stages — Back/Next ↔ Cancel +
  **Create** (`creating`) / Save (editing an existing sheet); the zone
  tree's headrow leads with a '‹' back arrow (class `.wb-template-layouts`
  kept) that reopens the selector drilled into the current layout.
  `close()` gates on `past.length > 0` (touched work confirms on Cancel /
  Escape / backdrop; undo-to-baseline disarms; Apply closes force).
  Entry points collapsed to ONE **"＋ New view…"** (views list
  `.wb-viewslist-newview`, canvas-tab ＋ menu, component library — the
  library card also gained the `createNew: true` its "New" label always
  implied); the kebab's "Templates…" stays the edit-existing door, and
  `openTemplateModal` dropped `opts.target` (galleryFirst now derives
  from the reopened/doc kind alone).

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
7. **Hover-reveal (`sp-card-showOnHoverParent` / `sp-card-showOnHoverChild`)
   works in column formatters, row formatters AND tile/gallery formatters**
   — no gallery view required, and no `additionalRowClass` or `sp-row-card`
   scaffolding needed. Empirically confirmed in the sharepoint-list-formatting
   skill corpus (ported here 2026-07-05, issue #203); no fresh tenant pass
   needed. The mechanism is pure CSS: the child class hides the element
   (`visibility:hidden`) and a **descendant `:hover` selector** on the parent
   class reveals it — `theme.ts` emulates exactly this pair, verbatim:
   `.sp-card-showOnHoverChild{visibility:hidden}` +
   `.sp-card-showOnHoverParent:hover .sp-card-showOnHoverChild{visibility:visible}`.
   Consequences the linter teaches (`hover-child-no-parent` warning,
   `hover-parent-no-child` info, enforced by `core.test.ts` — the tests are
   the spec): a child with no parent-class *ancestor* never appears (both
   classes on the same element doesn't work — a hidden element can't be
   hovered); a parent with no child in its subtree is inert; the pairing
   never crosses a `customCardProps` boundary, because the card body renders
   in a callout, not as a DOM descendant of the host.

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
- `@isSelected` is always false; `executeQuickStep` is typed + lint-warned
  (#286: `quickstep-undocumented`/`quickstep-missing-id`) but firing the Quick
  Step isn't emulated — the click shows the generic action toast.
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
  arbitrary previews are blank — that's expected, not a bug. When NEW
  chrome names a glyph, add it to the generator's MAP and regenerate —
  `chromeIcons.test.ts` now sweeps the source for literal glyph names and
  fails on any without a bundled mask (the Stage-2 view-strip menu shipped
  three unbundled glyphs before this guard existed). A tenant's
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
   story, CFR slot overlays with a confirm-and-enter button (that whole
   enter-the-column-formatter affordance left the product 2026-07-07 with
   the CFR model — nothing to enter), and a soft confirm
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
   children, stash dots; the CFR enter row died with the CFR model), the family
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
   fallback, an existing FORMULA is replaced (UI warns first). The
   per-COLUMN route (a `{kind:'column'}` target reachable from the grid
   header menu) was RETIRED 2026-07-07 with the migration — `CondTarget`
   is element-only now; conditional formatting is element styling inside
   a view or the workshop, reached via the context menu.
   The old "one-way generator" gap
   CLOSED 2026-07-05: `parseRulesFromStyle` (condRules.ts — the contract
   tests pin it) parses generated =if() chains back into editable rules,
   so reopening the dialog lands on the applied rules with the WATCHED
   field recovered and the pre-rules fallbacks preserved (our own
   formulas never warn as "replaced"). Correctness is the rebuild-verify
   gate: the parse regenerates the chains and requires byte-identical
   output — a foreign or hand-edited formula fails it and the dialog
   starts fresh over the current style, exactly as before. New with the
   round trip: ZERO rules + Apply REMOVES the managed chains (each
   property returns to its pre-rules fallback; effect statics stay,
   clearable in Format cells).
1.8. **Sheet mode (the Excel-true surface) — design locked 2026-06-12**,
   see docs/SHEET-MODE.md (owner decisions: ribbon, fx bar with a
   property-slot dropdown, bidirectional dialect transpiler that refuses
   rather than guesses, "every row" scope clarity, JSON host columns
   gating txtContent replacement, column subtypes = settings not paint,
   Basic → Sheet rename lands with the stage-3 shell). **Stage 1 SHIPPED
   same day**: Format cells dialog (formatCells.ts — Font/Border/Fill/
   Alignment, one undoable patch) on header + right-click menus, and
   conditional formatting now watches any column (paintField vs watched
   field split in condFormat.ts — keep those distinct). Stages 2–3 SHIPPED
   2026-06-16 (the transpiler + fx bar, then the shell — SHEET-MODE.md is
   the history; the 2026-07-05 §6 cleanup fixed this line's stale "next").
1.9. **Field guide — BUILT 2026-06-12** (owner request; landed via PR #7,
   renumbered from 1.7 in the merge): ☰ menu → More… → 📖 opens a
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
   **RESTRUCTURED 2026-07-05** (owner request) as a progressive-technicality
   gradient: reading order descends basic → complex AND the nav tree nests
   (`GuidePage.parent` → `GUIDE_DEPTH`; indent classes `wb-guide-navd1/2`;
   deeper page = more technical, and the nav says so). New pages: `basics`
   (plain-language lists-and-libraries floor, now the landing page) and
   `limits` (thresholds-from-the-engine, the chapter's depth-2 leaf, content
   extracted from `overview` which is now "Under the hood: SQL + React"
   nested under basics). joins/calculated/matrix nest under column-types;
   icons/actions under formatting. Tree invariants are pinned in
   `src/editor/guideContent.test.ts`. Sourcing caveat: the three
   support.microsoft.com links added for the basics page (introduction to
   lists, what is a document library, create/change/delete a view) are
   standard article ids but could NOT be re-fetched at edit time — this
   container's proxy blocks microsoft.com entirely — spot-check them from a
   networked session; every other claim on the new pages reuses the
   already-verified largeLists/spoLimits sources.
1.10. **Connectivity Tier 0 — BUILT 2026-06-13** (owner brief; design in
   docs/CONNECTIVITY.md — read its §1 auth reality before touching
   anything here: no app registrations is a HARD constraint and only
   page-context auth satisfies it post-ACS). Shipped: the FormatFX List
   Snapshot v1 (fourth schemaImport format, ALSO the future extension
   wire protocol — version it), the read-only extract snippet ("⚡ Live
   from SharePoint" in the Data tab; captures fields + live column AND
   view formatters + 10 rows — GET-only today, but the constraint is now
   "read-only, no mutation" so read-POSTs like GetAllRules() are allowed:
   owner decision 2026-07-07, CONNECTIVITY §8), captured views in
   state.importedViews
   (additive project key) with default-view auto-load under the exact
   isPureGrid guard, and the confirm-first deploy snippet (JSON tab →
   🚀 Deploy…, advanced-gated, LINT-GATED — refuse-and-teach applies to
   deployment). Owner still owes the one-time live checklist in
   CONNECTIVITY.md §3.6 against a real tenant. Next per the design:
   npm package prep (separate PR; owner adds NPM_TOKEN + tags v0.1.0),
   then the Tier-1 extension — its "after Sheet stage 3" gate was met
   2026-06-16, so it's unblocked, just unscheduled (§6 cleanup 2026-07-05).
1.11. **Maker-first redesign — all five stages SHIPPED** (continuation tracker:
   `docs/HANDOFF-redesign.md`, added by PR #42). A five-stage pass that makes
   the default surface serve the maker and folds the developer studio behind
   one door. Stage 1 (PR #40): grid-first landing, the Studio toggle
   (`#wb-layout.wb-maker`, pref `studioOpen`), monochrome theme icon
   (themeToggle.ts). Stage 2 (PR #41): emergent formatter type — the upfront
   Type dropdown moved into the Studio, replaced by a read-only destination
   chip (`#wb-dest-chip`, formatterDestination.ts). **Stage 3:
   the row-view builder** — Ctrl/Cmd-click grid columns to multi-select, "make
   a row view" turns them into weighted **areas** (Normal/Wide/Widest, a
   conflict-free CSS-fr-like flex; areas.ts), with row **density**
   (Roomy/Compact) a separate knob and **tile** an explicit pick that can never
   emerge (a graduated tile STACKS its areas — buildRowView's `as: 'tile'`);
   density + back-to-grid rode a row-view toolbar (density moved into the
   structure-header kebab 2026-07-10 — that toolbar is label-only now), and
   the grid offers
   "⟳ Reopen" after a back-to-grid (state.lastLayoutKind, session-local —
   FLOOR-AND-SHEETS Stage 0; both the back-to-grid button and the Reopen
   bar were later RETIRED by FLOOR-AND-SHEETS Stage 2, 2026-07-05, and
   that stage's COLUMNS-tab/view-strip navigation was itself replaced by
   the canvas tab strip 2026-07-07). Per-area
   right-click sizing was retired 2026-07-04 — zone sizing is the template
   builder inspector's job. **Stage 4: CFR linked instances
   (the Figma model)** — SUPERSEDED 2026-07-07: the whole CFR
   linked-instance model (link badges, forkCfr/promoteToColumn, the §
   channel) left the product with the Columns · Components · Views
   migration — a column's look is a ⬡ component applied to it
   (docs/specs/COLUMNS-COMPONENTS-VIEWS.md). **Stage 5: safety + the single
   Advanced door.** (a) **Deploy clobber guard** — the deploy snippet bakes the
   target kind and, before replacing an EXISTING *view* formatter, shows a
   pointed foreign-clobber warning ("REPLACES THE ENTIRE view formatter…",
   deploySnippet.ts); columns keep the mild field-level prompt. (b) **Validated
   JSON as the single Advanced door** — the topbar toggle is relabeled
   **Advanced** and opens straight to the JSON tab (the escape hatch, with
   Deploy); Palette/Structure/Properties stay reachable, de-emphasized
   (consolidate, not delete — per the owner). (c) **"Format this column" preset
   picker** (owner request) — SUPERSEDED twice over: first by the subtype
   catalog, then 2026-07-07 by the header menu's "Apply a component…"
   ("Format this column" is no longer a gesture; columnPresets.ts and the
   subtype engine are deleted). The dead `.wb-adv` markers (no CSS since the
   2026-06-17 unification) are being removed opportunistically. e2e:
   `areas.spec.ts` plus grid/maker/bridge coverage (`cfr.spec.ts` retired
   with the CFR model; `lookLegibility.spec.ts` is its successor).
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
2. ~~Re-point the private visual-compare harness at a local clone~~
   SUPERSEDED (§6 cleanup 2026-07-05): the public tenant-agnostic rebuild
   (`npm run visual:compare`, §7) replaced the private harness for this
   repo. Still live from this item: invoke the tenant-theme import before
   captures so color becomes a first-class MATCH dimension — and the SP
   half's first run against a real tenant is still owed (the numbered ⚠
   watch spots mark the likely first-run adjustments).
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

- `npm test` — 1722 vitest unit tests across 95 files (engine semantics incl.
  every live-verified behavior in §3, serializer round-trips, schema import
  incl. the List Snapshot edges, workspace/state incl. the looks model —
  `columnLooks`, `applyComponentToColumn`, the canvas-tab store — the
  `lookDialect` ref-dialect converters, preset binding, grid scaffolding +
  grid mutations, conditional-formatting codegen evaluated
  through the real engine — that test file is the contract for
  generated-condition semantics, incl. the Map Data property mapper's
  compile/round-trip/refuse discipline (#217) and the ▦ dialog + canvas
  token-drop DOM contracts — the bridge's EXECUTED-snippet round trips
  against stubbed fetch, the collaborative-hub contracts (the share
  codec byte-exact round trips, the stress-test variant catalog incl.
  threshold mining, the Explain visitor over both expression syntaxes, the
  autosave-pause never-clobber guarantee), the Mockup-B left-pane sections
  (shelf, library, view card, views list), the column tab-groups brain,
  the pure-grid Apply-to-canvas guard, the palette-derived components'
  definitely-renders contract, the Select/Live canvas mode, and the IDE-style
  JSON pane — the tolerant tokenizer/bracket matcher, the contextual
  completion brain incl. its no-standalone-`!` guarantee, and the mounted
  shell's DOM contracts — plus, 2026-07-09, the command-bar hide brain
  (`commandBar.test.ts`: catalog integrity, alias emission, foreign-entry
  preservation, presets, the serializer round trip) and the View kebab's
  DOM/undo contracts (`viewKebab.test.ts`), and the workshop seam
  (`componentEditor.test.ts` + the treeView/inspector workshop modes:
  staged commits ride modal-undo, app undo untouched, surface tools
  gated), and, 2026-08-15, the WCAG contrast dimension (`contrast.test.ts`:
  color parsing/ratio math/outcome extraction/pairing soundness + the
  STOCK_THEME↔theme.ts sync pin; the `core.test.ts` low-contrast linter
  block; `paletteContrast.test.ts`: every shipped preset, built-in
  component, condRules effect and the default workspace held to the
  rule's own bar)). Run headlessly anywhere.
  (Keep this count honest when you add tests — a stale number here is how
  the docs drift out from under the code.)
- `npm run test:ui` — 142 Playwright tests across 16 spec files
  (multi-session machines: set `PW_PORT` so reuseExistingServer can't attach
  to another session's dev server — see playwright.config.ts):
  `sandbox.spec.ts` (core smoke flows: the grid-first landing with dressed
  columns, palette insert, JSON round trip, lint teaching, hover cards,
  dark mode, the one unified surface), `canvasTabs.spec.ts` (the canvas
  tab strip — the one navigation surface: the standing ▦ Grid tab,
  open/focus/close/inline-rename/drag-reorder, reload persistence, the
  workshop covering the canvas with keep-alive staged edits),
  `grid.spec.ts` (the grid-first workspace: the header menu's LOOK
  gestures — apply/change/remove a component, the reuse loop — hide/add,
  drag to reorder/group, column tab groups, compiled column-JSON export,
  element right-click menus, element-level Format cells + conditional
  formatting incl. cross-column watching and the parse-back round trip),
  `import.spec.ts` (schema import + the List Snapshot: imported
  CustomFormatters register as column looks, the review opt-out, captured
  views opening as canvas tabs, the lint-gated deploy panel),
  `workspace.spec.ts` (the workspace loop: shelf chip inserts + field
  drags, the instance card's re-bind/detach, workshop saves re-baking worn
  columns, compiled copy, element naming, style doc cards, the playground,
  box-model/alignment editors, the This-view card, the dark-mode engine
  probe, Select/Live), `components.spec.ts` (the always-on library:
  project inventory + usage jumps, the typed mapping dialog + the trigger
  picker, Save as component…, replace-and-push re-baking, Bring your own
  incl. the CFR-import refusal, the legacy-subtypes migration),
  `lookLegibility.spec.ts` ("teal ⬡ = a component at work": header marks,
  the tree's binding rows, accept-gated drops, the instance card — and no
  violet § channel anywhere in the DOM), `areas.spec.ts` (Ctrl-click
  multi-select → "make a row view" as a NEW canvas tab, the density knob
  via the structure-header kebab, explicit tile), `maker.spec.ts` (the
  maker-first shell: grid landing,
  the single Advanced door, the tab strip as the where-am-I),
  `snapshots.spec.ts` (snapshots + navigation Back inside the ⋮ menu),
  `templates.spec.ts`
  (the row/tile builder opened from the structure-header kebab: wireframe
  gallery, zone editor, field/component
  drags into zones, width presets, in-place reopen), `share.spec.ts`
  (the collaborative hub: real-browser
  share round trips with fresh-context recipients, the never-clobber/backup/
  restore flows, Explain, Stress Test), `search.spec.ts` (the universal
  search overlay: Ctrl+F/🔎, grouped results, navigate-never-mutate, the
  explicit Insert card, the no-logical-NOT teaching no-match),
  `guide.spec.ts` (the field guide reader) and `icons.spec.ts` (the
  Fluent icon gallery: the fx bar's Icon slot + the guide's icon wall).
  (The same keep-the-count-honest rule applies here.)
  Shared mechanics (fresh-app reset, `header()`, `openJson()`,
  `openPalette()`, `loadExample()`, the Data-dock schema-import steps) live
  in `e2e/helpers.ts` — navigation only, never assertions; each spec keeps
  its own contracts. Despite the directory name these are browser UI tests
  against the local app with mock data, not end-to-end against real
  SharePoint — live-SP semantics are pinned headlessly (§3).
  Containers that can't reach the browser CDN: `npm i -D --no-save
  @sparticuz/chromium`, extract with `executablePath()`, run with
  `PW_EXECUTABLE=/tmp/chromium` (verified working 2026-06-12).
- `npm run visual:compare` — the ground-truth harness (`e2e/visual-compare/`,
  the public tenant-agnostic rebuild of the private repo's excluded
  visual-compare, scaffolded 2026-07-04): a share link IS the fixture
  (decoded in Node via `core/share.ts`; unset → minted from the default
  workspace). It provisions a sacrificial list from the workspace under the
  maker's own bottled browser session (`npm run visual:auth`) — typed
  columns, rows, column formatters, view formatter on a second view — then
  compares per-cell: exact text, lenient color (family-level, per owner
  2026-07-04), and pixelmatch crop diffs with sandbox|SP|diff triptychs
  attached. pixelmatch + pngjs are the harness's only (dev) deps; the
  runtime app stays at zero. Manual CLI only, never CI (`.vspec.ts` suffix
  keeps it out of `test:ui`); the SP half has NOT yet run against a live
  tenant — numbered ⚠ watch spots in `sp.ts`/`compare.vspec.ts`/
  `workspace.ts` mark the likely first-run adjustments. Evidence persists
  to stable paths in `artifacts/run/`; the `/visual-compare` skill
  (`.claude/skills/visual-compare/`) is the local-agent runbook — run,
  visually review every triptych, diagnose to a culprit (symptom→culprit
  map inside), calibrate `verdict.ts` when the thresholds misjudge.
  Interactive surfaces are driven, not just painted: customCardProps
  hover cards open on both sides (scored, `hover-card-missing` fails),
  customRowAction/inlineEditField get clicked with before/after evidence
  (a pixel-identical after-click means `click-no-effect`). Every finding
  carries a label from `labels.ts` (the stable "what it looks like"
  taxonomy) and the agent appends labeled findings to the committed
  `findings.jsonl` ledger — the months-long dataset the skill's periodic
  assessment mines for recurring gotchas to bake into rules (skill map →
  verdict knobs → teaching lint rules).
- The dark-mode "engine probe" spec exists because a capture once showed
  light pills under dark mode; it pins generation AND the reload/autosave
  path. It exonerated the engine once already — keep it.

