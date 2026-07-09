# View chrome kebab · left-pane polish · workshop integration — design

> Owner brief 2026-07-09 (five requests in one session, "think for me and make
> it so"). Design locked by the session against the explored code; the owner's
> review gate is the PR. Delivery is TWO stacked PRs: **PR 1 = A+B (chrome)**,
> **PR 2 = C (workshop)** — C rewires heavily-pinned e2e contracts and must not
> block the chrome shipping.

## A. The View-header kebab

Everything view-scoped moves under a kebab (⋮) at the far right of the THIS
VIEW card's heading row (`.wb-viewcard-head` — mark, name, kind, now + kebab).
The card body keeps only the heading and the Behaviors list. The inspector's
Pro-gated "Document — {kind} formatter" section (inspector.ts:159-185) is
**removed** — its controls move here. The card stays hidden on the grid floor
and shows no kebab on the workshop def card.

### A1. Panel mechanics

New module `src/editor/viewKebab.ts`, snapMenu-pattern popover (the JSON-pane
kebab's static-DOM trick doesn't apply — the view card re-renders wholesale on
every `document` emit, which would destroy an inline panel mid-gesture):

- body-appended, `position:fixed` under the anchor, singleton, `wb-esc-owner`,
  Escape + outside-`pointerdown` (armed via setTimeout 0), item clicks do NOT
  close (it's a settings surface, not an action menu).
- Subscribes to state while open: `document` → redraw content in place
  (undo/redo included, preserving mode + scroll); `load`/`kind`/`data` → close
  (surface switched under the panel).
- Two content modes: `main` and `commands` (drill-in with ‹ Back).

### A2. Main mode rows

| Row | Control | Storage | Gate |
|---|---|---|---|
| Density | existing Roomy/Compact seg | root gap/padding via `state.setRowDensity` | all |
| Row class | existing text input | `viewExtras.additionalRowClass` | all |
| Selection boxes | Show/Hide seg | `doc.hideSelection` (inverted: Hide = true) | all |
| Column headers | Show/Hide seg | `doc.hideColumnHeader` | row only |
| List header | Show/Hide seg | `viewExtras.hideListHeader` | row only (typed on SPViewFormatter) |
| Tile size | two number inputs | `doc.tileWidth` / `doc.tileHeight` | tile only |
| Fill horizontally | Show/Hide-style seg (On/Off) | `doc.fillHorizontally` | tile only |
| Command buttons… | drill-in row + "N hidden" badge | `viewExtras.commandBarProps` | all |

Toggles reuse `.wb-viewcard-seg` / `.wb-viewcard-segbtn` verbatim (the density
look: `--wb-lp-seg-track` track, lifted-surface active pill). Every gesture is
ONE `state.mutateDocument` call.

### A3. Command buttons drill-in

Preset chips on top, then five groups of per-button rows. A row is one large
toggle button: label + right-aligned eye glyph; hidden rows dim the label (the
tree's `wb-tree-hidden` language). `aria-pressed` reflects hidden. An entry
whose `hide` is a formula (string/AST) renders an `𝑓x` chip; an explicit click
overwrites it with a boolean (one gesture, undoable).

**Data brain: `src/core/commandBar.ts`** (pure, node-tested). A LOGICAL BUTTON
bundles every key alias Microsoft has used for that button (the docs' rename
table + the pnp `commandbar-hide-all` field pattern): hiding emits ALL aliases
(`hide: true` each), un-hiding removes the managed `hide` from each alias
entry, deletes entries left with only `key`, and drops empty
`commands`/`commandBarProps` so exports stay clean. Entries carrying other
customizations (`text`, `iconName`, `position`…) are preserved byte-for-byte —
only `hide` is managed. Unknown keys are never touched (SPFx custom commands
etc. pass through). Read state: a logical button is "hidden" when ANY alias
has `hide === true`.

Sources of truth: learn.microsoft.com view-commandbar-formatting (fetched
2026-07-09) ∪ pnp `commandbar-hide-all` v1.2. The repo has no JSON-schema
validator and SP ignores unknown keys, so emitting the newer keys the official
schema hasn't caught up to is safe (the pnp sample ships exactly this way).

Catalog — 53 logical buttons over 93 keys, five groups:

1. **List toolbar**: New `[new, newComposite]` · Edit in grid view
   `[editInGridView]` · Exit grid view `[exitGridView]` · Undo (grid editing)
   `[undo]` · Share `[share]` · Copy link `[copyLink]` · Export (menu)
   `[export]` · Export to Excel `[exportExcel]` · Export to CSV `[exportCSV]`
2. **Automate & alerts**: Automate (menu) `[automate]` · Rules
   `[automateCreateRule, automateManageRules, rulesCommand]` · Quick steps
   `[quickStepsCommand]` · Power Automate flows `[powerAutomate,
   powerAutomateCreateFlow, powerAutomateSeeFlows,
   powerAutomateConfigureFlows]` · Workflows (classic) `[workflowsCommand]` ·
   Approvals `[approvalsCommand, requestApprovalCommand]` · Alert me
   `[alertMe]` · Manage my alerts `[manageAlert]`
3. **Integrate & AI**: Integrate (menu) `[integrate]` · Power Apps
   `[powerApps, powerAppsCreateApp, powerAppsSeeAllApps,
   powerAppsCustomizeForms]` · Power BI `[powerBI, powerBIVisualizeList]` ·
   AI Builder `[aiBuilder, aiBuilderCreate, aiBuilderGoto]` · Copilot agent
   `[createCopilot]` · Microsoft Forms `[manageForms]` · Syntex / Classify &
   extract `[classifyAndExtract, viewDocumentUnderstandingModels,
   syntexTranslateCommand]`
4. **Item & selection**: Edit `[edit]` · Delete `[delete]` · Comment
   `[comment]` · Open `[open]` · Properties `[properties, propertiesCommand]`
   · Version history `[versionHistory, versionHistoryCommand]` · Pin to top
   `[pinItem, pinItemCommand]` · Favorite `[favoriteCommand]` · Immersive
   Reader `[openInImmersiveReader]` · Go to channel in Teams
   `[GoToChannelInTeams]` · Preview `[previewFileCommand]` · Compliance
   details `[complianceDetails]` · More (context submenu) `[more]`
5. **Library & files**: Upload `[upload, UploadCommand, uploadFile,
   uploadFileCommand, uploadFolder, uploadFolderCommand]` · Sync `[sync,
   syncCommand]` · Add shortcut to OneDrive `[addShortcut,
   addShortcutToOneDriveCommand, stasherContextMenuCommand,
   stasherCommand.myFiles, stasherCommand.otherLocations]` · Pin to Quick
   access `[pinToQuickAccess, PinToQuickAccessCommand, unpinFromQuickAccess]`
   · New folder `[newFolder]` · New Office documents `[newWordDocument,
   newExcelWorkbook, newPowerPointPresentation, newOneNoteNotebook,
   newFormsForExcel, newVisioDrawing, newLink]` · Edit New menu
   `[editNewMenu]` · New-menu templates `[uploadTemplate,
   uploadTemplateCommand, addTemplate]` · Download `[download]` · Rename
   `[rename]` · Copy to `[copyTo]` · Move to `[moveTo]` · Check out / in
   `[checkOut, checkIn, undoCheckOut]` · Open in Office (web)
   `[openInOfficeOnline]` · Open in Office (desktop) `[openInOfficeClient]` ·
   Publish `[PublishCommand]`

Presets (each REPLACES the managed hide set — one undoable mutation; foreign
entries and non-`hide` props survive):

- **Hide all** — every catalog button (the pnp hide-all use case).
- **Show all** — clear every managed hide.
- **Collect entries** — visible: New + Automate menu + Rules + Quick steps +
  Alert me + Manage alerts; everything else hidden. (The owner's example:
  keep New, lose grid edit, keep the rules machinery.)
- **Read only** — hide anything that mutates: New, grid edit/exit/undo, Edit,
  Delete, Properties, Automate menu + Rules + Quick steps + flows + workflows
  + approvals, Power Apps, AI Builder, Copilot, Forms, Syntex, Upload, New
  folder, New Office docs, Edit New menu, templates, Rename, Copy/Move to,
  Check in/out, Publish. Sharing, export, alerts, Power BI, sync and the
  read-side item commands stay.
- **Declutter** — hide the upsell, keep the work: Integrate menu, Power Apps,
  Power BI, AI Builder, Copilot, Forms, Syntex, flows, workflows, Teams link.
  Rules/alerts/Quick steps survive.

### A4. Side effects

- `types.ts`: widen the `commandBarProps.commands` entry type to the
  documented shape (`hide`/`text`/`title` string-or-expression, `iconName`,
  `primary`, `position`, `sectionType`, `selectionModes`) — doc accuracy only.
- `jsonComplete.ts` `ROW_WRAPPER_KEYS`/`TILE_WRAPPER_KEYS` gain
  `commandBarProps` (and a `commands` nested def) so the IDE pane suggests it.
- `viewCard.test.ts` / `workspace.spec.ts:412-439` re-target density/rowclass
  through the kebab. New `commandBar.test.ts` + `viewKebab.test.ts`.

## B. Left-pane polish

1. **Sticky section headers**: `.wb-lp-sec-head` gets `position: sticky; top:
   0` + opaque `--wb-lp-bg` background + hairline bottom border inside the two
   scroll containers (`.wb-lp-shelves`, `.wb-lp-props`). Title ink steps up
   from `--wb-lp-text-2` to `--wb-lp-text`; same 11px/700/uppercase, same
   height — distinct, not bigger.
2. **Structure gets a real header**: new `sectionHead('tree', 'Structure')`
   as `.wb-lp-tree`'s first child (outside the scrolling body → naturally
   frozen), collapsible like the rest (collapse clears the splitter's inline
   height; expand restores). Hidden in the Simple lens (which already hides
   the tree body).
3. **Views section**: leftPane wraps `#wb-lp-views` in a real
   `wb-lp-sec[data-sec="views"]` with a section header; viewMenu drops its own
   `wb-viewslist-head` row (hint copy moves to the header's title attr).
   `PaneSectionId` gains `'views' | 'tree'` (additive localStorage values on
   the frozen key — safe).
4. **Properties vertical space**: the shelves/props 50/50 `flex: 1 1 0` split
   is replaced — props defaults heavier (`flex: 1.4 1 0`, `min-height`
   raised), and a SECOND splitter (same `.wb-lp-splitter` chrome) lands
   between shelves and props so the boundary is draggable. Collapsing the
   Properties section clears any manual inline height so the existing
   space-reclaim rule keeps working. Double-click resets the split.

## C. Workshop integration (PR 2)

Supersedes the v1 "a workshop tab never re-targets the tree" constraint
(leftPane.ts:15-17) — owner brief 2026-07-09.

1. **Editing context seam**: `state.workshopCtx` (nullable), registered by
   `mountComponentWorkshop` on mount, cleared on destroy. Shape: staged root
   accessor, staged selection get/set, staged node resolver, and
   `commit(fn)` = run fn → `setDirty` → `mu.commit(muBag())` → refresh ↶↷ →
   re-render preview → `state.emit('workshop')`. New `ChangeReason
   'workshop'` never autosaves and the canvas ignores it.
2. **Tree**: while `activeComponentTab !== null`, render the staged root;
   row clicks route to ctx selection; row actions (rename, eye) commit via
   ctx (modal-undo steps, not app undo). Re-renders on `'workshop'`.
3. **Inspector**: node/selection/commit resolve against ctx when active (the
   two chokepoints `commit`/`commitAll` + the `selectedNode`/`selectedNodes`
   reads). Workshop mode gates OFF: the instance card, conditional
   formatting, Map-data — surface-coupled tools. Multi-select degrades to
   the single staged selection.
4. **componentEditor**: the embedded style panel (491-625), `CE_MANAGED`,
   and the formatCells/condRules imports die; preview caption becomes
   "Elements — click to select; style them in the Properties pane". The
   exported `stylePlainValue`/`styleIsFormula` seams stay (components.test.ts
   contract, still used by the inspector routing). Workshop body collapses
   to a single column.
5. **Contracts**: e2e `.wb-ce-style .wb-ce-swatch` drivers (components.spec,
   canvasTabs.spec) re-target the inspector's Style controls;
   treeView.test/leftPane.test v1 assertions updated. Save stays ONE
   app-level undo step via `batchProjectUpdate`; staged Ctrl+Z keeps riding
   modalUndo's capture-phase keys.

## Invariants honored

One gesture = one undoable mutation (per toggle, per preset, per staged
commit). Frozen keys/prefix untouched (new localStorage values are additive
under `wb-lp-sections.v1`). Zero runtime deps. Generated JSON stays
schema-shaped and SP-real (keys grounded in MS docs + pnp field practice;
foreign JSON preserved byte-for-byte). Click-only safety: presets are
deterministic, undoable, and never touch foreign entries' customizations.
