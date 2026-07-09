# Columns · Components · Views — the model-B migration (owner-approved 2026-07-06)

> Owner decisions, verbatim in spirit, from the 2026-07-06 session:
> 1. **Mockup B is approved** — "columns are just [data], components are where
>    we build [packaged] formatting, and views are where we lay them out and
>    where we set the view-specific behaviors and properties."
> 2. **Never use "tokens" or "bundles" as nouns or labels** — the words are
>    columns, components, views. (Code identifiers follow the same rule.)
> 3. **"§ disappears from the model too"** — `columnFormatterReference` leaves
>    the document model, not just the UI.
> 4. **"Format this column is no longer a gesture"** — a column gets its look
>    by having a component applied to it. There is no per-column formatter
>    editing surface.
> 5. **Canvas tabs** — "editing components and views both happen in the canvas
>    …each component or view that gets opened using the left pane becomes a
>    tab in the right canvas pane in the order that they're opened, but the
>    tabs can be rearranged." This supersedes FLOOR-AND-SHEETS §2.2's
>    left-strip-of-sheets (owner call 2026-07-05) — the canvas tab strip is
>    now the one navigation surface; the Grid is the standing first tab.
>
> Everything else in FLOOR-AND-SHEETS survives: floor/sheet document
> separation, navigation-never-mutates, ONE global undo stack, one gesture =
> one undoable mutation, refuse-and-teach, zero runtime deps, frozen
> localStorage keys (names, not formats — no compat machinery until a
> real-user baseline).

## 1. The model

**A column is data.** `MockField` carries no formatting: the `subtype` /
`subtypeArgs` tags are deleted. Columns appear in the UI as typed chips
(the shelf) and as grid columns.

**A component is the only unit of formatting.** Unchanged shape
(`ComponentDef`: typed slots + tree over slot keys). Every placed piece of
formatting is a bound INSTANCE stamped `_component: {id, map}` —
provenance that already exists. Editing happens in the workshop (now a
canvas tab); saving re-bakes every instance (the existing
`batchProjectUpdate` / `rebindInstance` / as-found-variant machinery).

**A column's look = a component applied to it.**
- Stored: `state.columnLooks: Record<field, SPElement>` (the renamed
  `columnRefs`) — the BAKED bound instance in explicit-`[$Field]` dialect,
  root stamped with `_component`. Baked (not `{id,map}`) so a share link
  or project file renders without the recipient owning the def.
- The floor's grid cell for a look-carrying column EMBEDS a clone of the
  look (no reference element): `gridCellForField` wraps the clone with the
  cell's flex/min-width. Applying/removing a look rewrites both the store
  and the placed cell as ONE undoable mutation.
- The per-column SharePoint export compiles on demand:
  `toColumnFormatter(look, field)` (`[$Field]` → `@currentField`). Import
  of a list schema's per-column CustomFormatter registers
  `inlineColumnFormatter(parsed, field)` (`@currentField` → `[$Field]`) as
  the look — unstamped (no def); the inspector's instance card offers
  "Save as component" to lift it into an editable def (refuse-and-teach:
  imported looks are not silently editable, they are one gesture from it).

**Views own layout + view-scoped behavior.** Field drops and
`buildRowView`/templates embed a CLONE of the column's current look (or a
plain-value cell) — instances of the COMPONENT, not references to the
column. Reuse flows through the component: editing the def updates every
instance; changing which component a COLUMN wears changes the grid only.
View-scoped behavior/properties (row click action, hover/click cards,
density, additionalRowClass) surface on a per-view card in the left pane.

**Deleted concepts:** `SPElement.columnFormatterReference`, the renderer's
CFR resolution (`resolveColumnRef`/`cfrStack`/`wb-cfr-chip`), the drill-in
surface (`activeDocKey` as a column key, `openColumnRef`, `kind:'column'`
canvas docs), `forkCfr`/`promoteToColumn`/`materializeCfrHost`, the violet
§ channel (styleScope 'style'/'host' scopes, style banner, tree
"reference" tags, `wb-colgal` gallery), the subtype engine (knob catalog,
`bakeSubtype`, `wb-subtypes` seeds; custom subtypes already migrate to
components on load), and the "Format this column" / per-column Format
cells / per-column conditional-formatting on-ramps.

**Load guard (no compat):** a project/share/snapshot payload containing
`columnFormatterReference` anywhere, or the old field tags, fails the
strict guard and falls back to the fresh default. `columnLooks` replaces
`columnRefs` in the payload (format change under the same frozen storage
key).

## 2. Canvas tabs (the one navigation surface)

- `state.openTabs: TabRef[]` where `TabRef = {kind:'grid'} |
  {kind:'view', id} | {kind:'component', defId}`; `state.activeTab`.
  Grid is always present and initially first; tabs append in open order;
  reordering is presentational metadata (off the undo stack, autosaved).
- Opening a view/component from the left pane opens (or focuses) its tab.
  Closing a view tab never deletes the view; closing a component tab
  prompts on unsaved staged changes.
- View/grid tabs = today's `openView`/`minimizeView` navigation.
- A component tab is the WORKSHOP: the canvas doc is the def's staged
  tree (slot-key dialect, previewed via best-guess binding). Save commits
  through the existing save-and-apply path (variants, pinning, instance
  re-bake) as ONE app-level undo step. The componentEditor modal's guts
  re-house here; the modal dies.
- The left pane's view strip dies; `viewMenu` becomes the views list in
  the pane. The fx bar, JSON pane, Explain, and deploy target follow the
  ACTIVE TAB's document (a component tab exports its def preview as
  column-formatter JSON only via explicit copy — deploy stays view/grid).
- **v1 constraint (Phase B, 2026-07-06):** the workshop tab is
  SELF-CONTAINED — its own preview, mini structure list and staged style
  panel live inside the tab, while the left pane's tree/inspector and the
  fx bar / JSON pane / Explain keep following the active SURFACE
  (`state.doc` never aliases a staged def; the kind select disables while
  a component tab is up). The previous bullet's follow-the-active-tab
  behavior for those panels is deferred; revisit once the owner reacts to
  the shipped tabs. (The view strip also survives Phase B alongside the
  canvas strip; it dies when the left pane rebuilds in Phase C.)

## 3. The left pane (Mockup B, approved)

Top to bottom:
1. **Nav row** — back (retrace), snapshots. (Tabs live on the canvas.)
2. **This view card** — name/kind of the active view tab + behaviors:
   scanned rows for row-click actions and hover/click cards with
   jump-to-element; hidden for grid and component tabs (grid shows
   nothing; component tabs show a def card: name, slots, usage count).
   *(Amended 2026-07-09, spec
   docs/superpowers/specs/2026-07-09-view-chrome-workshop-design.md: the
   inline row-class + density controls moved into the card's ⋮ VIEW
   SETTINGS kebab — viewKebab.ts — together with the hide toggles, the
   tile box, and the Command buttons drill-in over core/commandBar.ts.)*
3. **Structure tree** — the active tab's document. Instance rows read
   "⬡ Name ← Column" (from `_component.map`); no § marks, no reference
   tags. Splitter below (kept).
4. **Columns — your data** — the shelf: one chip per field, type-tagged,
   draggable (`FIELD_MIME`); click inserts into the active view at the
   selection (grid: as a new column). No formatter state on chips.
5. **Components — your formatting** — the library, always visible:
   "In this project" inventory + Built-in / From the palette / Yours /
   Whole rows / Bring your own. Rows drag (`COMPONENT_MIME`). ✎ opens
   the component's canvas tab. "＋ New component…" opens a blank def tab.
6. **Lens tabs + draw toolbar + inspector** — as today; the inspector
   gains the INSTANCE card (component name, "Bound to <column ▾>"
   re-mapping, "Open in workshop", "Detach to plain elements") and, for
   grid look cells, "Remove the look".

## 4. Gestures (replacing "Format this column")

- **Apply a component to a column**: drop a ⬡ row/chip onto a grid
  column (header or cells) — a slot must fit the column's type: best-guess
  the remaining slots; any hole opens the mapper prefilled. Also from the
  library mapper when the grid tab is active: "Apply to a column…" picker.
  Implementation: `state.applyComponentToColumn(field, def, mapping)` —
  bake stamped instance, write `columnLooks[field]`, rewrite the placed
  cell; ONE undo step.
- **Remove the look**: instance card + grid header menu → plain cell +
  store delete, one step.
- **Grid header menu keeps**: copy column JSON (compiled), hide, group
  operations, rename. Everything formatter-editing is gone.
- **Element-level Format cells / conditional formatting stay** (they are
  element styling inside a view or the workshop) — only their per-column
  routes die (`condFormat`'s `{kind:'column'}` target, the header-menu
  entries).
- **Imports**: schema import registers looks (unstamped) as §1; pasted
  column JSON (JSON pane apply on grid, examples, share links of kind
  'column') registers as the current/matching field's look and selects
  that grid column — no drill.

## 5. Drag grammar

- Payloads: `application/x-wb-field` (column chips), COMPONENT_MIME
  (library rows), `application/x-wb-node` (tree), grid col MIME.
- Accept-gating everywhere: a target only highlights payloads it will
  act on (fixes the tree's unconditional dragover).
- Tree + canvas accept FIELD (insert plain/look cell) and COMPONENT
  (bind-and-insert; mapper on holes). Grid columns accept COMPONENT
  (apply as look). Canvas tab strip accepts drags: hovering a view tab
  ~600ms springs it open; drop inserts at its root.
- (Positional edge/body `dropPos` promotion from the template builder to
  tree/canvas is a follow-up, not this migration.)

## 6. Phases (each ends compiling + unit-green)

> **All six phases SHIPPED 2026-07-07** (A–E landed 2026-07-06→07 on the
> migration branch; F — the e2e realignment + docs refresh — closed
> 2026-07-07: unit suite 950 across 51 files, e2e 136 across 15 files).

- **A. Model core** — types (drop `columnFormatterReference`, `_component`
  stays; MockField loses subtype/subtypeArgs), renderer (delete CFR
  block + resolveColumnRef), cfr.ts → `lookDialect.ts` (keep the two
  ref-dialect converters; delete blastRadius), gridScaffold (embed
  looks), state.ts surgery (columnLooks, applyComponentToColumn,
  removeColumnLook, no drill-in, snapState/serializeProject/loadProject
  reshape, loadDocument routing), areas/rowTemplates (clone looks),
  previews drop resolveColumnRef. Rewrite unit contracts first:
  state/cfr/grid/core-renderer/rowTemplates/components/snapshots/
  shareUi/search/treeView/styleScope(del)/columnGallery(del)/subtypes(del).
- **B. Canvas tabs** — state.openTabs/activeTab + component-tab surface
  and staged-def editing; canvas tab strip UI (open/focus/close/reorder);
  componentEditor re-housed; viewStrip deleted; main.ts kind select
  follows active tab.
- **C. Left pane** — leftPane rebuild per §3 (fmt tabs gone, view card,
  shelf, always-on library, instance inspector card, tree binding rows).
- **D. Gestures** — gridView menu slim-down + component-drop apply;
  condFormat column route removal; dataPanel registry section removal +
  import-as-looks; searchUi/jsonPanel/deployPayload/main.ts rewires;
  guideContent CFR teaching rewritten to the components model.
- **E. Drag grammar** — §5.
- **F. e2e + docs** — grid/cfr(del)/styleLegibility(rewrite)/
  formatterNav(rewrite as tab nav)/subtypes(del→apply-component spec)/
  components/import/workspace/snapshots/sandbox/maker/search specs;
  HANDOFF §6/§7 refresh, FLOOR-AND-SHEETS supersession note, this doc
  marked shipped.

## 7. Contracts to preserve (unchanged canon)

- One gesture = one undoable mutation; navigation never mutates.
- Generated formatters schema-valid, definitely-work-on-real-SP, no
  standalone `!`; refuse-and-teach.
- Frozen localStorage key NAMES and `wb-` CSS prefixes.
- HANDOFF §3 semantics (closed) — untouched by this migration.
- Zero runtime dependencies.
