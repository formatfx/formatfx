// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/state.ts — Single store for the editor: the workspace (floor grid +
 * named view sheets + per-column looks), mock data, selection (by node
 * path), undo/redo, and change notification.
 *
 * FLOOR-AND-SHEETS Stage 1 — the state model:
 *   · The FLOOR is its own columns-only grid document (`floorDoc`, kind
 *     'grid'). It never holds a view layout; nothing a view does can change
 *     it, and nothing on the floor can destroy a view.
 *   · Each row/tile view is a named SHEET document (`views`). Opening a
 *     sheet slides it over the floor; minimizing drops back to the floor
 *     WITHOUT touching the sheet. Leaving/opening is navigation, never a
 *     document mutation — it pushes nothing onto the undo stack.
 *   · `doc` stays the live canvas document every consumer reads — the
 *     active surface's slot object (floorDoc or a sheet's doc),
 *     write-through.
 *
 * COLUMNS-COMPONENTS-VIEWS (model B) — the column-look model:
 *   · A column's look = a component applied to it. `columnLooks` stores the
 *     BAKED bound instance (root stamped `_component`) in explicit-[$Field]
 *     dialect; imported looks are the same trees, unstamped. The floor's
 *     grid cells EMBED clones of the look (gridScaffold) — no reference
 *     element, no per-column editing surface, no drill-in. Applying,
 *     removing or importing a look rewrites the store AND the floor cell
 *     as one undoable step.
 *   · The per-column SharePoint export compiles on demand —
 *     toColumnFormatter(look, field); imports come back through
 *     inlineColumnFormatter (both in lookDialect.ts).
 *   · Undo is ONE GLOBAL app-level stack (FLOOR-AND-SHEETS §2.3): every
 *     snapshot captures the whole workspace plus where the mutation
 *     happened, so undo/redo also navigate back to the surface they change
 *     — the spreadsheet-workbook convention. Modal editors keep their own
 *     local stacks and commit as one app step (template builder,
 *     batchProjectUpdate, Format cells).
 */

import type {
  FormatterDocument, SPElement, NodePath, MockField, MockRow, PersonValue, DocumentKind,
} from '../core/types';
import { sampleValue, type ImportedView, type ImportedRule } from '../core/schemaImport';
import { buildGridRoot, gridCellForField, gridColumnField, isPureGrid } from './gridScaffold';
import { addGroup, sanitizeGroups, type ColumnGroup } from './colGroups';
import { inlineColumnFormatter } from './lookDialect';
import { foldRowClassIntoRoot } from './rowTemplates';
import {
  bindComponentInstance, bestGuessMapping,
  BUILTIN_COMPONENTS, COMPONENTS_KEY, loadComponents,
  type ComponentDef,
} from './components';
import { paletteComponents } from './paletteComponents';
import {
  buildRowView, rowDensityOf,
  setRowDensity as applyRowDensity,
  type RowDensity,
} from './areas';
import {
  snapshotId, defaultLabel,
  type Snapshot, type SnapshotScope,
} from './snapshots';
import { foldState } from './foldState';

export type ChangeReason =
  | 'document' | 'selection' | 'data' | 'kind' | 'theme' | 'load' | 'lens'
  | 'workshop';

/** The active component workshop's staged-editing seam (spec §C, 2026-07-09 —
 *  supersedes the v1 "a workshop tab never re-targets the tree" constraint).
 *  Registered by mountComponentWorkshop while its tab is up; the tree and the
 *  inspector resolve against it instead of the surface doc, so staged
 *  elements get the full editing vocabulary. Commits land on the WORKSHOP's
 *  modal-undo stack (one gesture = one ↶ step) and emit 'workshop' — never
 *  the app undo stack, never autosave; Save stays the one app-level step. */
export interface WorkshopContext {
  /** The staged tree's root (a live object — mutate only through commit()). */
  root(): SPElement;
  /** The staged selection ([] = the root). */
  selection(): NodePath;
  /** Move the staged selection; re-highlights the preview, emits 'workshop'. */
  select(path: NodePath): void;
  /** Resolve a staged path (CARD_SEGMENT-aware); null when stale. */
  nodeAt(path: NodePath): SPElement | null;
  /** An embed placeholder's component name (#225) — null for real elements.
   *  Placeholders are read-only stand-ins: edits on them would vanish when
   *  flatten swaps the child's tree in, so surfaces label them and refuse. */
  embedNameOf(el: SPElement): string | null;
  /** Run one staged mutation: fn(), then dirty + mu.commit + preview
   *  refresh + a 'workshop' emit. */
  commit(fn: () => void): void;
}

/** The Left Edit Pane's three interaction lenses (progressive disclosure). */
export type EditorLens = 'simple' | 'pro' | 'code';

/** One named sheet — a row/tile view document above the floor. */
export interface SheetDoc {
  /** Opaque, stable identity ('v1', 'v2', … — monotonic per workspace). */
  id: string;
  /** The maker-facing name ("View 1", "Sprint board", …). */
  name: string;
  /** The view document — kind 'row' | 'tile' only. */
  doc: FormatterDocument;
}

/** One CANVAS TAB (COLUMNS-COMPONENTS-VIEWS §2): the standing Grid tab, a
 *  named view, or a component workshop. Tabs are presentational project
 *  metadata (the renameView rule — off the undo stack, autosaved). */
export type CanvasTab =
  | { kind: 'grid' }
  | { kind: 'view'; id: string }
  | { kind: 'component'; defId: string };

/** Stable identity key for a canvas tab ('grid' | 'view:v1' | 'component:c-…'). */
export function tabKey(t: CanvasTab): string {
  if (t.kind === 'grid') return 'grid';
  if (t.kind === 'view') return `view:${t.id}`;
  return `component:${t.defId}`;
}

/** Every component id the stores currently know: built-ins, the palette
 *  derivations, and the maker's saved customs (raw read — sanitize only). */
function knownComponentIds(): Set<string> {
  let customs: ComponentDef[] = [];
  try {
    customs = loadComponents(localStorage.getItem(COMPONENTS_KEY));
  } catch { /* private mode — customs just read as absent */ }
  return new Set([...BUILTIN_COMPONENTS, ...paletteComponents(), ...customs].map((d) => d.id));
}

type Listener = (reason: ChangeReason) => void;

const ME: PersonValue = {
  title: 'Sandbox User', email: 'me@contoso.com', jobTitle: 'Maker', department: 'IT',
};

function defaultFloor(): FormatterDocument {
  // the grid-first workspace: the floor starts as a Microsoft-Lists style
  // grid — one column per view column, each cell embedding its column's look
  // (Status/Progress arrive wearing components; Owner's look is registered
  // but unplaced so "+ column" demonstrates adding an already-dressed column).
  return {
    kind: 'grid',
    root: buildGridRoot(defaultFields(), defaultColumnLooks(),
      ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']),
  };
}

/** Showcase looks — REAL stamped instances of palette-derived components
 *  (COLUMNS-COMPONENTS-VIEWS §1), so the default workspace demonstrates the
 *  model it teaches: a column's look IS a component applied to it. Owner is
 *  dressed but unplaced, on purpose. */
function defaultColumnLooks(): Record<string, SPElement> {
  const fields = defaultFields();
  const looks: Record<string, SPElement> = {};
  const wear = (defId: string, fieldName: string): void => {
    const def = paletteComponents().find((d) => d.id === defId);
    const field = fields.find((f) => f.name === fieldName);
    if (!def || !field) return; // defensive: a retired preset just skips its look
    const mapping = bestGuessMapping(def, fields);
    const slot = def.slots.find((s) => s.types.includes(field.type));
    if (slot) mapping[slot.key] = field.name; // the wearer wins its fitting slot
    looks[fieldName] = bindComponentInstance(def, mapping);
  };
  wear('palette-status-pill', 'Status');
  wear('palette-data-bar', 'Progress');
  wear('palette-persona', 'Owner');
  return looks;
}

export function defaultFields(): MockField[] {
  return [
    { name: 'ID', type: 'number', protected: true },
    { name: 'Title', type: 'text' },
    { name: 'Status', type: 'choice', choices: ['Not started', 'In Progress', 'Blocked', 'Done'] },
    { name: 'DueDate', type: 'date' },
    { name: 'Progress', type: 'number' },
    { name: 'AssignedTo', type: 'personMulti' },
    { name: 'Owner', type: 'person' },
    { name: 'Project', type: 'lookup', lookup: { list: 'Projects', column: 'Title' } },
    { name: 'Tags', type: 'text' },
    { name: 'Link', type: 'hyperlink' },
  ];
}

export function defaultRows(): MockRow[] {
  const people = (names: string[]): PersonValue[] =>
    names.map((n) => ({ title: n, email: `${n.toLowerCase().replace(/ /g, '.')}@contoso.com` }));
  return [
    {
      ID: 1, Title: 'Launch new intranet', Status: 'In Progress', DueDate: isoDaysFromNow(5),
      Progress: 64, AssignedTo: people(['Ada Lovelace', 'Grace Hopper', 'Mark Otto']),
      Owner: people(['Ada Lovelace'])[0], Project: { lookupId: 3, lookupValue: 'Apollo' },
      Tags: 'web;intranet;sprint-12', Link: 'https://contoso.sharepoint.com',
    },
    {
      ID: 2, Title: 'Migrate file shares', Status: 'Blocked', DueDate: isoDaysFromNow(-3),
      Progress: 20, AssignedTo: people(['Linus T']),
      Owner: people(['Grace Hopper'])[0], Project: { lookupId: 7, lookupValue: 'Hermes' },
      Tags: 'storage;migration', Link: 'https://contoso.sharepoint.com',
    },
    {
      ID: 3, Title: 'Quarterly review deck', Status: 'Done', DueDate: isoDaysFromNow(-10),
      Progress: 100, AssignedTo: [],
      Owner: people(['Mark Otto'])[0], Project: { lookupId: 3, lookupValue: 'Apollo' },
      Tags: 'reporting', Link: '',
    },
  ];
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

/** One navigation-trail entry: which doc was up, over which surface. */
interface NavEntry { key: string; view: string | null }

export class EditorState {
  /** The FLOOR — the columns-only grid document. Its kind is always 'grid'. */
  floorDoc: FormatterDocument = defaultFloor();
  /** The SHEETS — named row/tile view documents (the multi-view list). */
  views: SheetDoc[] = [];
  /** Which sheet is up on the canvas; null = standing on the floor. */
  activeViewId: string | null = null;
  /** The live canvas document — the active surface's slot object (floorDoc
   *  or a sheet's doc), write-through. */
  doc: FormatterDocument = this.floorDoc;
  fields: MockField[] = defaultFields();
  rows: MockRow[] = defaultRows();
  /** Field the column formatter targets (@currentField). */
  currentFieldName = 'Status';
  /** Column LOOKS: field name → the column's baked look — a bound component
   *  instance (root stamped `_component`, explicit-[$Field] dialect), or an
   *  unstamped imported tree. Owned by the WORKSPACE — the floor's cells and
   *  view drops EMBED clones of these; the per-column SharePoint export
   *  compiles them on demand (toColumnFormatter). */
  columnLooks: Record<string, SPElement> = defaultColumnLooks();
  /** Views captured by a List Snapshot import (formatters kept as raw text). */
  importedViews: ImportedView[] = [];
  /** Rules/Quick Steps captured by a List Snapshot import — INERT metadata
   *  (no UI interprets them yet, #214); carried so a captured list is whole. */
  importedRules: ImportedRule[] = [];
  /** Column TAB GROUPS on the grid floor (owner brief 2026-07-05): named,
   *  colored, collapsible groupings of columns. Presentational project
   *  metadata like sheet names — never a document mutation, never an undo
   *  step; the exported floor is identical with or without them. */
  floorGroups: ColumnGroup[] = [];
  /** Which document key is on the canvas. Always 'main' (the active surface)
   *  this phase — the canvas component tabs re-target it in a later phase
   *  (COLUMNS-COMPONENTS-VIEWS §2). */
  activeDocKey = 'main';
  /** The CANVAS TABS (§2): every surface/workshop opened from the left pane,
   *  in open order, rearrangeable. The Grid tab is always present. Tab
   *  bookkeeping only — `doc` keeps aliasing the active SURFACE; which tab
   *  reads active derives from `activeViewId` / `activeComponentTab`. */
  openTabs: CanvasTab[] = [{ kind: 'grid' }];
  /** The active COMPONENT tab's defId, or null when the surface is showing.
   *  UI state like the lens: a component tab COVERS the canvas with the
   *  workshop; the surface (and `doc`) waits untouched underneath. */
  activeComponentTab: string | null = null;
  /** The mounted workshop's staged-editing seam (see WorkshopContext).
   *  Null whenever no workshop DOM is mounted. */
  workshopCtx: WorkshopContext | null = null;
  /** The sheet last on the canvas — session-local memory for the VIEWS tab's
   *  return target (the grid lives on the COLUMNS tab since Stage 2, so the
   *  VIEWS tab needs to know which sheet to come back to). Never persisted. */
  lastOpenViewId: string | null = null;
  /**
   * Selection backing store. Figma-style multi-select: the array holds every
   * selected node path; `selection` (below) is the backward-compatible primary
   * = `_selections[0]`. `[]` as a member means the root is selected; an empty
   * array means nothing is selected (the old `selection === null`).
   */
  private _selections: NodePath[] = [[]];
  /** The Left Edit Pane lens — UI view state, NOT part of the project file. */
  activeLens: EditorLens = 'pro';
  /** FLOOR-AND-SHEETS Stage 3: the shared canvas mode. 'select' = clicks
   *  select elements for editing (the default — click-safety); 'live' =
   *  clicks route through the real behaviors (customRowAction fires, nothing
   *  selects), like real SharePoint. UI view state: session-only, never
   *  persisted — a reload always lands back in Select. */
  canvasMode: 'select' | 'live' = 'select';
  /** Simulate-hover pin (issue #203): in Select mode, force-reveal every
   *  sp-card-showOnHoverChild so hidden-until-hover elements stay visible,
   *  selectable and editable. UI view state, session-only — Live mode always
   *  behaves like real SP regardless of the pin. */
  simulateHover = false;
  /** The "last Save" checkpoint Discard reverts to (a snapState string). */
  private _savepoint: string | null = null;
  themeMode: 'light' | 'dark' = 'dark';
  /** Tenant theme palette overrides (token → hex), or null for stock Fluent. */
  customTheme: Record<string, string> | null = null;
  me: PersonValue = ME;

  private listeners: Listener[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saveTimer = 0;
  /** Per-surface selection memory (pure view state): 'floor' or a view id →
   *  the selection that was live when you navigated away. */
  private surfaceSelections: Record<string, NodePath[]> = {};
  /** Per-surface FOLD memory (same idea, PR #290 review): the shared
   *  foldState set that was live when you navigated away — restored on
   *  return, so folds never bleed onto another surface's same-numbered
   *  paths. Session-only, never snapshotted or persisted. */
  private surfaceFolds: Record<string, string[]> = {};
  /** Monotonic view-id source, seeded past any loaded ids. */
  private viewIdCounter = 0;

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Primary selected path — the backward-compatible single-selection accessor.
   *  Reads the first of the multi-selection; assigning collapses to a single
   *  selection (or clears it when null), so every existing `this.selection = …`
   *  mutation and the canvas/inspector readers keep working unchanged. */
  get selection(): NodePath | null { return this._selections.length ? this._selections[0] : null; }
  set selection(path: NodePath | null) { this._selections = path == null ? [] : [path]; }

  /** Every selected node path (Figma-style multi-select). */
  get selections(): NodePath[] { return this._selections; }

  /** Every selected node, resolved against the live document (drops dead paths). */
  get selectedNodes(): SPElement[] {
    return this._selections
      .map((p) => this.nodeAt(p))
      .filter((n): n is SPElement => n != null);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(reason: ChangeReason): void {
    for (const fn of this.listeners) fn(reason);
    // 'selection' and 'lens' are pure view state, and 'workshop' is STAGED
    // state (persisted only by an explicit Save) — none of them autosave.
    if (reason !== 'selection' && reason !== 'lens' && reason !== 'workshop') this.scheduleAutosave();
  }

  // ─── the workshop's staged-editing seam (spec §C) ──────────────────────────

  registerWorkshop(ctx: WorkshopContext): void {
    this.workshopCtx = ctx;
    this.emit('workshop');
  }

  /** Idempotent per-context: a stale destroy never clears a newer mount. */
  unregisterWorkshop(ctx: WorkshopContext): void {
    if (this.workshopCtx !== ctx) return;
    this.workshopCtx = null;
    this.emit('workshop');
  }

  // ─── Left Edit Pane: lens + Save checkpoint ────────────────────────────────

  /** Switch the Simple/Pro/Code lens. UI-only: off the undo stack, no autosave. */
  setLens(lens: EditorLens): void {
    if (this.activeLens === lens) return;
    this.activeLens = lens;
    this.emit('lens');
  }

  /** Flip the canvas between Select and Live (Stage 3). UI-only, like the
   *  lens: off the undo stack, no autosave; 'lens' re-renders the canvas so
   *  the behavior handlers rebind. */
  setCanvasMode(mode: 'select' | 'live'): void {
    if (this.canvasMode === mode) return;
    this.canvasMode = mode;
    this.emit('lens');
  }

  /** Pin/unpin the simulate-hover reveal (issue #203). UI-only, like the
   *  canvas mode: off the undo stack, no autosave. */
  setSimulateHover(on: boolean): void {
    if (this.simulateHover === on) return;
    this.simulateHover = on;
    this.emit('lens');
  }

  /** Mark the live workspace as the Save checkpoint (the Save button / first load). */
  markSavepoint(): void { this._savepoint = this.snapState(); }

  /** Whether there are unsaved mutations since the last Save checkpoint.
   *  Compares CONTENT (floor + sheets + looks) — navigation and selection
   *  are view state and never count as dirt. */
  get isDirtySinceSave(): boolean {
    if (this._savepoint == null) return false;
    const clean = (snap: string) => {
      const parsed = JSON.parse(snap);
      delete parsed.selections;
      delete parsed.activeViewId;
      delete parsed.activeDocKey;
      return JSON.stringify(parsed);
    };
    return clean(this._savepoint) !== clean(this.snapState());
  }

  /** Discard every mutation back to the last Save checkpoint (multi-step undo).
   *  The discard itself is one undoable step, so an accidental Discard is Ctrl+Z-able. */
  discardToSavepoint(): void {
    if (this._savepoint == null) return;
    const before = this.snapState();
    if (before === this._savepoint) return;
    this.pushUndo(before);
    this.restoreSnap(this._savepoint);
    this.clampSelection();
    this.emit('load');
    this.emit('document');
    this.emit('selection');
  }

  // ─── Workspace: the floor and the sheets ───────────────────────────────────

  /** Whether the floor is the active surface. */
  get onFloor(): boolean { return this.activeViewId === null; }

  /** The active sheet, or null when standing on the floor. */
  get activeView(): SheetDoc | null {
    return this.activeViewId ? this.viewById(this.activeViewId) ?? null : null;
  }

  /** Human name of the active surface — the sheet's name, or the floor's. */
  get activeViewName(): string { return this.activeView?.name ?? 'Grid'; }

  viewById(id: string): SheetDoc | undefined {
    return this.views.find((v) => v.id === id);
  }

  /** The active SURFACE document slot (floor or the open sheet) — what
   *  `doc` aliases. */
  private surfaceDoc(): FormatterDocument {
    return this.activeView?.doc ?? this.floorDoc;
  }

  /** Selection-memory key for the current canvas document. */
  private surfaceKey(): string {
    return this.activeViewId ?? 'floor';
  }

  /** Write the live canvas document back into its slot. The surface slots are
   *  write-through aliases already; this re-asserts the invariant (defensive). */
  private flushActiveDoc(): void {
    const v = this.activeView;
    if (v) v.doc = this.doc;
    else this.floorDoc = this.doc;
  }

  /** Stash the current selection under its surface key and restore the
   *  target's. Fold state rides along (PR #290 review): fold keys are
   *  numeric node paths, so leaving them live across a surface switch would
   *  collapse whatever unrelated nodes share those paths on the next
   *  surface. The restore is SILENT (foldState.swap) — every caller emits
   *  'load' right after, which is when both fold surfaces re-read the set
   *  against the newly-active document. */
  private swapSelections(toKey: string): void {
    const fromKey = this.surfaceKey();
    this.surfaceSelections[fromKey] = this._selections;
    this._selections = this.surfaceSelections[toKey] ?? [[]];
    this.surfaceFolds[fromKey] = foldState.keys();
    foldState.swap(this.surfaceFolds[toKey] ?? []);
  }

  /**
   * Navigation history — the "oops, how did I get here" stack. Every doc or
   * surface switch pushes where you WERE; goBack() retraces. Pure navigation
   * state: not undo, not persisted, capped small.
   */
  private navStack: NavEntry[] = [];

  private pushNav(): void {
    const top = this.navStack[this.navStack.length - 1];
    if (top && top.key === this.activeDocKey && top.view === this.activeViewId) return;
    this.navStack.push({ key: this.activeDocKey, view: this.activeViewId });
    if (this.navStack.length > 50) this.navStack.shift();
  }

  private navEntryValid(e: NavEntry): boolean {
    if (e.key === this.activeDocKey && e.view === this.activeViewId) return false;
    if (e.key !== 'main') return false; // no drilled/column surfaces exist this phase
    if (e.view !== null && !this.viewById(e.view)) return false;
    return true;
  }

  /** Where goBack() would land ('main' — the only doc key this phase), or
   *  null if nowhere. Skips entries whose sheet has since been removed. */
  get backTarget(): string | null {
    for (let i = this.navStack.length - 1; i >= 0; i--) {
      if (this.navEntryValid(this.navStack[i])) return this.navStack[i].key;
    }
    return null;
  }

  /** Retrace the last doc/surface switch. Returns where it landed, or null. */
  goBack(): string | null {
    let entry: NavEntry | null = null;
    for (let i = this.navStack.length - 1; i >= 0; i--) {
      if (this.navEntryValid(this.navStack[i])) {
        entry = this.navStack[i];
        this.navStack.length = i; // drop it and everything above — no ping-pong
        break;
      }
    }
    if (!entry) return null;
    this.inGoBack = true;
    try {
      if (entry.view !== this.activeViewId) {
        if (entry.view) this.openView(entry.view);
        else this.minimizeView();
      }
      if (entry.key !== this.activeDocKey) this.openMain(); // 'main' is the only valid key
    } finally {
      this.inGoBack = false;
    }
    return entry.key;
  }

  private inGoBack = false;

  /**
   * Open a sheet over the floor. NAVIGATION: never a document mutation, never
   * an undo step (FLOOR-AND-SHEETS §2.2).
   */
  openView(id: string): void {
    const v = this.viewById(id);
    if (!v) return;
    // the navigation chokepoint doubles as the tab chokepoint (§2): every
    // opened view has a tab, appended in open order
    const appended = this.ensureTab({ kind: 'view', id });
    if (this.activeViewId === id) {
      // already the active surface — just make sure it's SHOWING (a
      // component tab may be covering the canvas)
      const covered = this.activeComponentTab !== null;
      this.activeComponentTab = null;
      if (appended || covered) this.emit('data');
      return;
    }
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();
    if (this.activeDocKey === 'main') this.swapSelections(id);
    this.activeViewId = id;
    this.lastOpenViewId = id;
    this.activeComponentTab = null; // surface navigation always shows the surface
    if (this.activeDocKey === 'main') this.doc = v.doc;
    this.emit('load');
    this.emit('data');
  }

  /** Drop back to the floor. NAVIGATION — the sheet is untouched and waits in
   *  the view list; nothing lands on the undo stack. */
  minimizeView(): void {
    if (this.activeViewId === null) {
      // already the floor — just uncover it if a component tab is up
      if (this.activeComponentTab !== null) {
        this.activeComponentTab = null;
        this.emit('data');
      }
      return;
    }
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();
    this.lastOpenViewId = this.activeViewId;
    if (this.activeDocKey === 'main') this.swapSelections('floor');
    this.activeViewId = null;
    this.activeComponentTab = null; // surface navigation always shows the surface
    if (this.activeDocKey === 'main') this.doc = this.floorDoc;
    this.emit('load');
    this.emit('data');
  }

  /** Next fresh sheet id — monotonic, seeded past loaded ids. */
  private nextViewId(): string {
    for (const v of this.views) {
      const m = /^v(\d+)$/.exec(v.id);
      if (m) this.viewIdCounter = Math.max(this.viewIdCounter, Number(m[1]));
    }
    return `v${++this.viewIdCounter}`;
  }

  /** Default sheet name — the first "View N" not already taken. */
  private nextViewName(): string {
    let n = this.views.length + 1;
    while (this.views.some((v) => v.name === `View ${n}`)) n++;
    return `View ${n}`;
  }

  /**
   * Register a new named sheet and open it. The registration is ONE undoable
   * step (undo removes the sheet and lands you back where you stood); the
   * opening is navigation riding along. Only row/tile documents can be sheets.
   */
  createView(doc: FormatterDocument, name?: string): SheetDoc | null {
    if (doc.kind !== 'row' && doc.kind !== 'tile') return null;
    if (this.activeDocKey !== 'main') this.openMain(); // navigation, not mutation
    this.pushNav(); // opening the new sheet is navigation — Back retraces it
    if (doc.kind === 'tile') {
      doc.tileWidth = doc.tileWidth ?? 254;
      doc.tileHeight = doc.tileHeight ?? 220;
    }
    this.snapshot();
    const sheet: SheetDoc = { id: this.nextViewId(), name: name?.trim() || this.nextViewName(), doc };
    this.views.push(sheet);
    // sheets are born open — every open view has a canvas tab (§2). The tab
    // itself is presentational (outside the snapshot above): undoing the
    // creation drops it on the restore-side sanitize.
    this.ensureTab({ kind: 'view', id: sheet.id });
    this.swapSelections(sheet.id);
    this.activeViewId = sheet.id;
    this.lastOpenViewId = sheet.id;
    this.activeComponentTab = null;
    this.doc = sheet.doc;
    this.selection = [];
    // the canvas surface changed — emit 'load' like every other navigation so
    // load-scoped UI state resets too (e.g. the left pane's library browser)
    this.emit('load');
    this.emit('kind');
    this.emit('data');
    return sheet;
  }

  /** Rename a sheet. Project metadata, not a formatter edit — deliberately off
   *  the undo stack; emits 'data' so the document dropdown + menus refresh and
   *  the change autosaves. */
  renameView(id: string, name: string): void {
    const v = this.viewById(id);
    if (!v) return;
    v.name = name.trim() || v.name;
    this.emit('data');
  }

  // ─── Canvas tabs (COLUMNS-COMPONENTS-VIEWS §2 — the renameView rule) ───────
  // Tab open/close/reorder are PRESENTATIONAL: off the undo stack, autosaved
  // ('data'). The active tab DERIVES from existing state — a component tab is
  // active while `activeComponentTab` is set; otherwise the active surface's
  // tab is (activeViewId's view, or the Grid).

  /** The active tab's stable key — what the strip marks aria-current. */
  get activeTabKey(): string {
    if (this.activeComponentTab !== null) return `component:${this.activeComponentTab}`;
    return this.activeViewId !== null ? `view:${this.activeViewId}` : 'grid';
  }

  /** Append `tab` unless one with its key is already open. True if appended. */
  private ensureTab(tab: CanvasTab): boolean {
    const k = tabKey(tab);
    if (this.openTabs.some((t) => tabKey(t) === k)) return false;
    this.openTabs.push(tab);
    return true;
  }

  /** Drop dead tabs (a view undone away, a def gone from the stores when
   *  `defIds` is supplied), dedupe, and re-assert the invariants: the Grid
   *  tab is always present, the active view always has a tab. Silent —
   *  presentational bookkeeping; callers own any notification. */
  private sanitizeTabs(defIds?: Set<string>): void {
    const seen = new Set<string>();
    this.openTabs = this.openTabs.filter((t) => {
      const alive = t.kind === 'grid'
        || (t.kind === 'view' && Boolean(this.viewById(t.id)))
        || (t.kind === 'component' && (defIds ? defIds.has(t.defId) : true));
      if (!alive) return false;
      const k = tabKey(t);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!this.openTabs.some((t) => t.kind === 'grid')) this.openTabs.unshift({ kind: 'grid' });
    if (this.activeViewId !== null
      && !this.openTabs.some((t) => t.kind === 'view' && t.id === this.activeViewId)) {
      this.openTabs.push({ kind: 'view', id: this.activeViewId });
    }
    if (this.activeComponentTab !== null
      && !this.openTabs.some((t) => t.kind === 'component' && t.defId === this.activeComponentTab)) {
      this.activeComponentTab = null;
    }
  }

  /** Open (or focus) a component's WORKSHOP tab. The workshop covers the
   *  canvas; the surface — and `doc` — waits untouched underneath. */
  openComponentTab(defId: string): void {
    const appended = this.ensureTab({ kind: 'component', defId });
    if (!appended && this.activeComponentTab === defId) return; // already up
    this.activeComponentTab = defId;
    this.emit('data');
  }

  /** Bring the active SURFACE back onto the canvas (leave the workshop
   *  showing-wise; its tab and staged state stay put). No-op when no
   *  component tab is active. */
  deactivateComponentTab(): void {
    if (this.activeComponentTab === null) return;
    this.activeComponentTab = null;
    this.emit('data');
  }

  /** Close a tab by key. The Grid tab refuses (it's the standing tab);
   *  closing the ACTIVE view's tab minimizes to the grid (navigation only —
   *  the view itself waits in the views list); closing the active component
   *  tab uncovers the surface. Returns whether anything closed. */
  closeTab(key: string): boolean {
    if (key === 'grid') return false;
    const i = this.openTabs.findIndex((t) => tabKey(t) === key);
    if (i < 0) return false;
    const [closed] = this.openTabs.splice(i, 1);
    if (closed.kind === 'view' && this.activeViewId === closed.id) {
      this.minimizeView(); // navigation — emits 'load' + 'data' itself
    } else if (closed.kind === 'component' && this.activeComponentTab === closed.defId) {
      this.activeComponentTab = null;
    }
    this.emit('data');
    return true;
  }

  /** Rearrange tabs: move the tab at `fromIndex` to sit at `toIndex`
   *  (post-removal index, clamped). Presentational, like every tab gesture. */
  moveTab(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.openTabs.length) return;
    const to = Math.max(0, Math.min(toIndex, this.openTabs.length - 1));
    if (to === fromIndex) return;
    const [t] = this.openTabs.splice(fromIndex, 1);
    this.openTabs.splice(to, 0, t);
    this.emit('data');
  }

  /** Add a column to the mock schema: seeds a sample value into every row
   *  and, while the floor is still a pure grid, grows its grid column (ONE
   *  undoable mutation — the exact recipe the Data tab's add-field form has
   *  always used; the lint footer's "create missing column" rides it too).
   *  Returns false (no change, no emit) for an empty/spaced or taken name. */
  addMockField(field: MockField): boolean {
    const name = field.name.trim();
    if (!name || /\s/.test(name)) return false;
    if (this.fields.some((f) => f.name === name)) return false;
    const f: MockField = { ...field, name };
    this.fields.push(f);
    this.rows.forEach((row, i) => { row[name] = sampleValue(f, i); });
    if (isPureGrid(this.floorDoc.root)) {
      this.mutateDocument(() => {
        this.floorDoc.root = buildGridRoot(this.fields, this.columnLooks);
      });
    }
    this.emit('data');
    return true;
  }

  // ─── Column tab groups (grid floor chrome — the renameView metadata rule) ──

  /** Group columns like browser tabs. `fields` are member field names (only
   *  ones the schema knows are kept); members are stolen from any group they
   *  were in. Returns the created group, or null if nothing groupable. */
  groupColumns(fields: string[], name?: string): ColumnGroup | null {
    const members = fields.filter((f) => this.fields.some((x) => x.name === f));
    if (!members.length) return null;
    const { groups, group } = addGroup(this.floorGroups, members, name);
    this.floorGroups = groups;
    this.emit('data');
    return group;
  }

  renameGroup(id: string, name: string): void {
    const g = this.floorGroups.find((x) => x.id === id);
    if (!g) return;
    g.name = name.trim() || g.name;
    this.emit('data');
  }

  setGroupColor(id: string, color: string): void {
    const g = this.floorGroups.find((x) => x.id === id);
    if (!g || g.color === color) return;
    g.color = color;
    this.emit('data');
  }

  /** Collapse/expand a group — its columns wait intact in the document; the
   *  grid just stops drawing them (presentational, zero document mutations). */
  toggleGroupCollapsed(id: string): void {
    const g = this.floorGroups.find((x) => x.id === id);
    if (!g) return;
    g.collapsed = !g.collapsed;
    this.emit('data');
  }

  /** Dissolve a group. The columns themselves are untouched. */
  ungroupColumns(id: string): void {
    const before = this.floorGroups.length;
    this.floorGroups = this.floorGroups.filter((g) => g.id !== id);
    if (this.floorGroups.length !== before) this.emit('data');
  }

  /** The active SURFACE's formatter root — what scope calculations read. */
  get mainRootForScope(): SPElement | undefined {
    return this.activeDocKey === 'main' ? this.doc.root : this.surfaceDoc().root;
  }

  /** Human label for the active surface, e.g. "View formatter (row layout)". */
  mainDocLabel(): string {
    const d = this.activeDocKey === 'main' ? this.doc : this.surfaceDoc();
    switch (d.kind) {
      case 'row': return 'View formatter — row layout';
      case 'tile': return 'View formatter — tile/gallery';
      default: return 'View formatter — grid';
    }
  }

  // ─── Canvas doc key (always 'main' this phase) ─────────────────────────────

  /** Return to the active surface. A no-op guard while 'main' is the only
   *  canvas doc key — callers keep routing through it, and the canvas
   *  component tabs re-target `activeDocKey` in a later phase. */
  openMain(): void {
    if (this.activeDocKey === 'main') return;
    this.activeDocKey = 'main';
    this.doc = this.surfaceDoc();
    this.emit('load');
    this.emit('data');
  }

  // ─── Project persistence ───────────────────────────────────────────────────

  static readonly STORAGE_KEY = 'list-formatting-sandbox.project.v1';

  serializeProject(): string {
    this.flushActiveDoc();
    return JSON.stringify({
      version: 3,
      floor: this.floorDoc,
      views: this.views,
      activeViewId: this.activeViewId,
      fields: this.fields,
      rows: this.rows,
      currentFieldName: this.currentFieldName,
      columnLooks: this.columnLooks,
      ...(this.importedViews.length ? { importedViews: this.importedViews } : {}),
      // ADDITIVE key (like importedViews): inert Rules/Quick Steps metadata
      ...(this.importedRules.length ? { importedRules: this.importedRules } : {}),
      ...(this.floorGroups.length ? { floorGroups: this.floorGroups } : {}),
      // ADDITIVE key (like floorGroups): only written once there's more than
      // the standing Grid tab; absent → the loader reseeds the default
      ...(this.openTabs.length > 1 ? { openTabs: this.openTabs } : {}),
      themeMode: this.themeMode,
      customTheme: this.customTheme,
    }, null, 2);
  }

  /**
   * Load a project payload. STRICT v3 shape guard: anything else — including
   * every pre-Stage-1 payload and the v2 `columnRefs` format — throws, and
   * restore() falls back to the fresh default. That is a LOAD GUARD, not a
   * converter: no migration code exists or is maintained (FLOOR-AND-SHEETS §3
   * Stage 1, owner call 2026-07-04; COLUMNS-COMPONENTS-VIEWS §1).
   */
  loadProject(text: string): void {
    const p = JSON.parse(text);
    const viewOk = (v: unknown): boolean => {
      const s = v as SheetDoc;
      // 'floor' is reserved: it keys the floor surface in selection memory,
      // so a sheet carrying it would collide with the floor deterministically
      return Boolean(s && typeof s.id === 'string' && s.id && s.id !== 'floor'
        && typeof s.name === 'string'
        && (s.doc?.kind === 'row' || s.doc?.kind === 'tile')
        && s.doc?.root?.elmType);
    };
    const idsUnique = (views: SheetDoc[]): boolean =>
      new Set(views.map((v) => v.id)).size === views.length;
    if (!p || typeof p !== 'object'
      || !p.floor?.root?.elmType
      || !Array.isArray(p.views) || !p.views.every(viewOk) || !idsUnique(p.views)
      || !Array.isArray(p.fields) || !Array.isArray(p.rows)
      || !p.columnLooks || typeof p.columnLooks !== 'object') {
      throw new Error('Not a formatfx workspace file (expected floor/views/fields/rows/columnLooks).');
    }
    this.floorDoc = { ...p.floor, kind: 'grid' };
    this.views = p.views;
    this.activeViewId = (typeof p.activeViewId === 'string' && p.views.some((v: SheetDoc) => v.id === p.activeViewId))
      ? p.activeViewId : null;
    this.fields = p.fields;
    this.rows = p.rows;
    this.currentFieldName = typeof p.currentFieldName === 'string' ? p.currentFieldName : this.fields[0]?.name ?? 'Title';
    this.columnLooks = p.columnLooks;
    this.importedViews = Array.isArray(p.importedViews) ? p.importedViews : [];
    this.importedRules = Array.isArray(p.importedRules) ? p.importedRules : []; // additive key
    this.floorGroups = sanitizeGroups(p.floorGroups); // additive key: absent → none
    // openTabs is ADDITIVE and outside the strict guard: malformed entries
    // and tabs whose view/def no longer exists just drop (custom defs live in
    // localStorage — a dangling component tab is normal across machines);
    // sanitize re-asserts the Grid tab + the active view's tab.
    const tabOk = (t: unknown): t is CanvasTab => {
      const x = t as { kind?: unknown; id?: unknown; defId?: unknown };
      return Boolean(x) && (x.kind === 'grid'
        || (x.kind === 'view' && typeof x.id === 'string')
        || (x.kind === 'component' && typeof x.defId === 'string'));
    };
    this.openTabs = Array.isArray(p.openTabs) ? (p.openTabs as unknown[]).filter(tabOk) : [];
    this.activeComponentTab = null;
    this.sanitizeTabs(knownComponentIds());
    this.activeDocKey = 'main';
    this.doc = this.surfaceDoc();
    this.lastOpenViewId = this.activeViewId;
    if (p.themeMode === 'light' || p.themeMode === 'dark') this.themeMode = p.themeMode;
    this.customTheme = (p.customTheme && typeof p.customTheme === 'object') ? p.customTheme : null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.surfaceSelections = {};
    this.surfaceFolds = {};
    this.navStack = [];
    this.viewIdCounter = 0;
    // folds are view state SHARED between the JSON pane and the tree
    // (foldState) — a whole-workspace swap starts unfolded, old paths
    // would just resolve onto unrelated nodes
    foldState.clear();
    this.markSavepoint();
    this.emit('load');
    this.emit('data');
  }

  /** Restore the autosaved project, if any. Returns true when restored.
   *  An unparseable blob (corrupt, or a pre-Stage-1 format) falls through to
   *  the fresh default — the caller keeps the default workspace. */
  restore(): boolean {
    try {
      const saved = localStorage.getItem(EditorState.STORAGE_KEY);
      if (!saved) return false;
      this.loadProject(saved);
      return true;
    } catch {
      return false;
    }
  }

  resetAll(): void {
    try { localStorage.removeItem(EditorState.STORAGE_KEY); } catch { /* private mode */ }
    this.floorDoc = defaultFloor();
    this.views = [];
    this.activeViewId = null;
    this.doc = this.floorDoc;
    this.fields = defaultFields();
    this.rows = defaultRows();
    this.currentFieldName = 'Status';
    this.columnLooks = defaultColumnLooks();
    this.importedViews = [];
    this.importedRules = [];
    this.floorGroups = [];
    this.openTabs = [{ kind: 'grid' }];
    this.activeComponentTab = null;
    this.activeDocKey = 'main';
    this.lastOpenViewId = null;
    this.customTheme = null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.surfaceSelections = {};
    this.surfaceFolds = {};
    this.navStack = [];
    this.viewIdCounter = 0;
    // folds are view state SHARED between the JSON pane and the tree
    // (foldState) — a whole-workspace swap starts unfolded, old paths
    // would just resolve onto unrelated nodes
    foldState.clear();
    this.markSavepoint();
    this.emit('load');
    this.emit('data');
  }

  /**
   * While true, nothing is written to localStorage — the share-link boot path
   * (editor/shareUi.ts) views a shared workspace read-until-you-act: the
   * recipient's own autosaved work is untouched until they explicitly choose
   * "Save a copy" (which resumes autosave) or "Discard" (which restores it).
   */
  private autosavePaused = false;

  get isAutosavePaused(): boolean { return this.autosavePaused; }

  /** Stop persisting to the autosave key (viewing shared state). */
  pauseAutosave(): void {
    this.autosavePaused = true;
    window.clearTimeout(this.saveTimer);
  }

  /** Resume persisting; pass `saveNow` to write the current state immediately. */
  resumeAutosave(saveNow = false): void {
    this.autosavePaused = false;
    if (saveNow) this.flushAutosave();
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  private saveNow(): void {
    if (this.autosavePaused) return; // shared-view mode: never touch the key
    try { localStorage.setItem(EditorState.STORAGE_KEY, this.serializeProject()); } catch { /* quota/private mode */ }
  }

  /** Persist immediately — a reload inside the debounce window must not lose state. */
  flushAutosave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveNow();
  }

  // ─── Node access by path ───────────────────────────────────────────────────
  // Path segments are child indices; the special segment -1 descends into a
  // node's customCardProps.formatter, so card content is fully addressable.

  nodeAt(path: NodePath): SPElement | null {
    let node: SPElement | undefined = this.doc.root;
    for (const i of path) {
      node = i === CARD_SEGMENT ? node?.customCardProps?.formatter : node?.children?.[i];
      if (!node) return null;
    }
    return node ?? null;
  }

  parentOf(path: NodePath): { parent: SPElement; index: number } | null {
    if (path.length === 0) return null;
    const last = path[path.length - 1];
    if (last === CARD_SEGMENT) return null; // a card root has no sibling list
    const parent = this.nodeAt(path.slice(0, -1));
    if (!parent) return null;
    return { parent, index: last };
  }

  get selectedNode(): SPElement | null {
    return this.selection ? this.nodeAt(this.selection) : null;
  }

  // ─── Mutations (all snapshot for undo) ────────────────────────────────────

  snapshot(): void {
    this.pushUndo(this.snapState());
  }

  /** The undo snapshot: the WHOLE workspace — floor, sheets, the column
   *  looks — plus where the mutation happened (surface) and the selection.
   *  One global app-level stack (FLOOR-AND-SHEETS §2.3): undo/redo restore
   *  content AND navigate back to the surface they change. Structural field
   *  edits (add/remove/type, via the data panel) deliberately live outside
   *  undo, so a later field edit is never clobbered by an unrelated doc undo. */
  private snapState(): string {
    this.flushActiveDoc();
    return JSON.stringify({
      floor: this.floorDoc,
      views: this.views,
      activeViewId: this.activeViewId,
      activeDocKey: this.activeDocKey,
      looks: this.columnLooks,
      selections: this._selections,
    });
  }

  private restoreSnap(snap: string): void {
    const parsed = JSON.parse(snap) as {
      floor: FormatterDocument;
      views: SheetDoc[];
      activeViewId: string | null;
      activeDocKey: string;
      looks: Record<string, SPElement>;
      selections?: NodePath[];
    };
    // sheet NAMES are project metadata, off the undo stack (the renameView
    // rule) — a content restore keeps the live name of any surviving sheet
    const liveNames = new Map(this.views.map((v) => [v.id, v.name]));
    this.floorDoc = parsed.floor;
    this.views = parsed.views;
    for (const v of this.views) {
      const live = liveNames.get(v.id);
      if (live !== undefined) v.name = live;
    }
    this.columnLooks = parsed.looks;
    this.activeViewId = (parsed.activeViewId && this.views.some((v) => v.id === parsed.activeViewId))
      ? parsed.activeViewId : null;
    if (this.activeViewId) this.lastOpenViewId = this.activeViewId;
    // 'main' is the only canvas doc key this phase — coerce anything else
    this.activeDocKey = 'main';
    this.doc = this.surfaceDoc();
    if (parsed.selections) this._selections = parsed.selections;
    // tabs are OFF the snapshot (presentational) — but a restore can remove
    // the view a tab pointed at (undoing a createView), so drop dead ones
    this.sanitizeTabs();
  }

  private pushUndo(state: string): void {
    this.undoStack.push(state);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapState());
    this.applyRestore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapState());
    this.applyRestore(next);
  }

  /** Restore a snapshot and notify: emits 'load' too when the restore moved
   *  the canvas to another surface (undo navigates to its change). 'data'
   *  fires unconditionally — a restore can change the views/tabs/looks
   *  collections WITHOUT moving the canvas (e.g. undoing a floor-side
   *  createView after wandering back to the floor), and the list surfaces
   *  (tab strip, views list, library) re-render on 'data'. */
  private applyRestore(snap: string): void {
    const navBefore = `${this.activeDocKey}·${this.activeViewId}`;
    this.restoreSnap(snap);
    this.clampSelection();
    if (`${this.activeDocKey}·${this.activeViewId}` !== navBefore) {
      this.emit('load');
    }
    this.emit('data');
    this.emit('document');
    this.emit('selection');
  }

  private clampSelection(): void {
    const valid = this._selections.filter((p) => this.nodeAt(p) != null);
    // keep what survives; if a non-empty selection went fully stale fall back to
    // the root, but an already-empty selection stays empty (old null behavior).
    this._selections = valid.length ? valid : (this._selections.length ? [[]] : []);
  }

  select(path: NodePath | null): void {
    this.selection = path; // setter collapses to a single selection / clears
    this.emit('selection');
  }

  /** Replace the entire selection set (Figma-style multi-select). */
  selectMulti(paths: NodePath[]): void {
    this._selections = paths.slice();
    this.emit('selection');
  }

  /** Add or remove one path from the selection set (checkbox toggle). */
  toggleSelect(path: NodePath): void {
    const i = this._selections.findIndex((p) => samePath(p, path));
    if (i >= 0) this._selections.splice(i, 1);
    else this._selections.push(path);
    this.emit('selection');
  }

  /** Whether this exact path is part of the current selection set. */
  isSelected(path: NodePath): boolean {
    return this._selections.some((p) => samePath(p, path));
  }

  mutateDocument(fn: () => void): void {
    // Snapshot the pre-mutation state, but only commit it if fn actually changed
    // the workspace — a no-op gesture (rename to the same value, arrow-step that
    // re-commits the current value on blur) must not push a phantom undo step.
    const before = this.snapState();
    fn();
    if (this.snapState() === before) return;
    this.pushUndo(before);
    this.emit('document');
  }

  /** Insert a child into the container at `path` (or its parent if not a container). */
  insertNode(fragment: SPElement, at?: NodePath): NodePath {
    this.snapshot();
    let target = at ?? this.selection ?? [];
    let container = this.nodeAt(target);
    if (!container) { target = []; container = this.doc.root; }
    // Only divs/spans sensibly take children; otherwise insert as sibling.
    if (container.txtContent !== undefined || ['img', 'path', 'filepreview'].includes(container.elmType)) {
      const p = this.parentOf(target);
      if (p) {
        p.parent.children = p.parent.children ?? [];
        p.parent.children.splice(p.index + 1, 0, fragment);
        const newPath = [...target.slice(0, -1), p.index + 1];
        this.selection = newPath;
        this.emit('document');
        return newPath;
      }
    }
    container.children = container.children ?? [];
    container.children.push(fragment);
    const newPath = [...target, container.children.length - 1];
    this.selection = newPath;
    this.emit('document');
    return newPath;
  }

  removeNode(path: NodePath): void {
    const p = this.parentOf(path);
    if (!p) return;
    this.snapshot();
    p.parent.children?.splice(p.index, 1);
    this.selection = path.slice(0, -1);
    this.emit('document');
  }

  duplicateNode(path: NodePath): void {
    const p = this.parentOf(path);
    const node = this.nodeAt(path);
    if (!p || !node) return;
    this.snapshot();
    p.parent.children?.splice(p.index + 1, 0, JSON.parse(JSON.stringify(node)));
    this.selection = [...path.slice(0, -1), p.index + 1];
    this.emit('document');
  }

  /** Wrap the node at `path` in a new flex container — works on the root too
   *  (a formatter has exactly one root element; wrapping is how you add a parent). */
  wrapNode(path: NodePath): void {
    const node = this.nodeAt(path);
    if (!node) return;
    this.snapshot();
    const wrapper: SPElement = {
      elmType: 'div',
      style: { 'display': 'flex', 'align-items': 'center' },
      children: [node],
    };
    if (path.length === 0) {
      this.doc.root = wrapper;
    } else if (path[path.length - 1] === CARD_SEGMENT) {
      const host = this.nodeAt(path.slice(0, -1));
      if (host?.customCardProps) host.customCardProps.formatter = wrapper;
    } else {
      const p = this.parentOf(path);
      if (p?.parent.children) p.parent.children[p.index] = wrapper;
    }
    this.selection = path;
    this.emit('document');
  }

  moveNode(path: NodePath, delta: -1 | 1): void {
    const p = this.parentOf(path);
    if (!p || !p.parent.children) return;
    const to = p.index + delta;
    if (to < 0 || to >= p.parent.children.length) return;
    this.snapshot();
    const [node] = p.parent.children.splice(p.index, 1);
    p.parent.children.splice(to, 0, node);
    this.selection = [...path.slice(0, -1), to];
    this.emit('document');
  }

  /** Move a node so it sits before the sibling currently at `beforeIndex`
   *  (children.length = end). One undo step; a no-op move snapshots nothing. */
  moveNodeTo(path: NodePath, beforeIndex: number): void {
    const p = this.parentOf(path);
    if (!p || !p.parent.children) return;
    const to = Math.max(0, Math.min(beforeIndex > p.index ? beforeIndex - 1 : beforeIndex, p.parent.children.length - 1));
    if (to === p.index) return;
    this.snapshot();
    const [node] = p.parent.children.splice(p.index, 1);
    p.parent.children.splice(to, 0, node);
    this.selection = [...path.slice(0, -1), to];
    this.emit('document');
  }

  /** Grid grouping: wrap the nodes at `onto` (kept first) and `from` in a
   *  new named flex-column div at `onto`'s position — the row-formatter
   *  scaffolding, generated as ONE undoable document mutation. */
  groupNodes(from: NodePath, onto: NodePath, name: string): void {
    if (from.length === 0 || from.length !== onto.length) return;
    if (!samePath(from.slice(0, -1), onto.slice(0, -1))) return; // siblings only
    const i = from[from.length - 1];
    const j = onto[onto.length - 1];
    if (i === j || i === CARD_SEGMENT || j === CARD_SEGMENT) return;
    const parent = this.nodeAt(from.slice(0, -1));
    if (!parent?.children?.[i] || !parent.children[j]) return;
    this.snapshot();
    const dragged = parent.children[i];
    const target = parent.children[j];
    const group: SPElement = {
      elmType: 'div',
      _elmName: name,
      style: {
        'display': 'flex', 'flex-direction': 'column', 'align-items': 'flex-start',
        'gap': '4px', 'flex': '1', 'min-width': '0',
      },
      children: [target, dragged],
    };
    parent.children.splice(i, 1);
    const at = j > i ? j - 1 : j;
    parent.children[at] = group;
    this.selection = [...from.slice(0, -1), at];
    this.emit('document');
  }

  /** Dissolve a wrapper: replace the node with its children (ungroup). */
  unwrapNode(path: NodePath): void {
    const node = this.nodeAt(path);
    const p = this.parentOf(path);
    if (!node?.children?.length || !p?.parent.children) return;
    this.snapshot();
    p.parent.children.splice(p.index, 1, ...node.children);
    this.selection = [...path];
    this.emit('document');
  }

  /** Move a node to become a child of another container (drag & drop). */
  reparentNode(from: NodePath, toContainer: NodePath, index?: number): void {
    if (pathStartsWith(toContainer, from)) return; // can't drop into own subtree
    const node = this.nodeAt(from);
    const p = this.parentOf(from);
    const container = this.nodeAt(toContainer);
    if (!node || !p || !container) return;
    this.snapshot();
    p.parent.children?.splice(p.index, 1);
    // adjust target path if removal shifted it
    const adjusted = [...toContainer];
    const fp = from.slice(0, -1);
    if (fp.length < adjusted.length && pathStartsWith(adjusted.slice(0, fp.length), fp) === false) {
      // different branch — no adjustment needed
    } else if (fp.length <= adjusted.length && samePath(adjusted.slice(0, fp.length), fp) && adjusted[fp.length] > from[from.length - 1]) {
      adjusted[fp.length] -= 1;
    }
    const dest = this.nodeAt(adjusted) ?? this.doc.root;
    dest.children = dest.children ?? [];
    const at = index === undefined ? dest.children.length : Math.min(index, dest.children.length);
    dest.children.splice(at, 0, node);
    this.selection = [...adjusted, at];
    this.emit('document');
  }

  /**
   * Switch the ACTIVE document's wrapper kind. Reshaped by Stage 1:
   *   · on a sheet, 'row' ⇄ 'tile' is a document mutation (one undo step);
   *     'grid' minimizes back to the floor — NAVIGATION, nothing mutates.
   *   · on the floor, 'row'/'tile' creates a NEW sheet carrying a copy of the
   *     floor's tree (the old lossless relabel, into its own document — the
   *     floor is untouched). 'grid' is a no-op.
   *   · 'column' documents are never a canvas surface (a column's look is a
   *     component instance, not a document), so setKind ignores that value.
   */
  setKind(kind: DocumentKind): void {
    if (this.activeDocKey !== 'main' || kind === 'column') return;
    if (this.onFloor) {
      if (kind === 'grid') return;
      const doc: FormatterDocument = { kind, root: clone(this.floorDoc.root) };
      if (this.floorDoc.viewExtras) doc.viewExtras = clone(this.floorDoc.viewExtras);
      this.createView(doc);
      return;
    }
    if (kind === 'grid') { this.minimizeView(); return; }
    if (this.doc.kind === kind) return; // no-op: don't snapshot an unchanged kind
    this.snapshot();
    this.doc.kind = kind;
    if (kind === 'tile') {
      this.doc.tileWidth = this.doc.tileWidth ?? 254;
      this.doc.tileHeight = this.doc.tileHeight ?? 220;
    }
    this.emit('kind');
  }

  // ─── Stage 3: areas / row-view builder ─────────────────────────────────────
  // The floor's columns graduate into a NEW sheet whose columns are weighted
  // areas. Each call is ONE undoable document mutation (the sheet's creation);
  // the floor itself is never touched.

  /** Graduate floor columns into a new row-view sheet. `indices` curates which
   *  columns become areas (in the given order); omit for all. The chosen kind
   *  is 'row' or 'tile' — tile is an explicit pick (it can never emerge from
   *  structure). A floor-only gesture; no-op while a sheet is up. */
  makeRowView(indices?: number[], kind: 'row' | 'tile' = 'row'): void {
    if (this.activeDocKey !== 'main' || !this.onFloor || this.floorDoc.kind !== 'grid') return;
    const root = buildRowView(clone(this.floorDoc.root), indices, rowDensityOf(this.floorDoc.root), kind);
    this.createView({ kind, root });
  }

  /** Apply a pre-built row template. On a sheet: replace its body, switch it
   *  to 'row', and set/clear the zebra wrapper class — ONE undoable mutation;
   *  other viewExtras (footerFormatter, commandBarProps, groupProps, …) are
   *  preserved. From the floor: register a NEW sheet carrying the template
   *  (nothing is overwritten — the floor never holds a layout). */
  applyRowTemplate(root: SPElement, additionalRowClass?: string): void {
    // The app never writes additionalRowClass anymore: SP IGNORES it whenever
    // a rowFormatter is present (MS syntax reference — mutual exclusivity),
    // so wrapper-borne striping silently never worked on real lists. A class
    // still arriving here (a stored row-component def from before the
    // retirement) gets FOLDED into the root's own class expression, where the
    // same @rowIndex conditional actually works; any stale wrapper key on the
    // target doc is cleared.
    if (additionalRowClass) root = foldRowClassIntoRoot(root, additionalRowClass);
    if (this.activeDocKey !== 'main') this.openMain();
    if (this.onFloor) {
      this.createView({ kind: 'row', root });
      return;
    }
    // Snapshot BEFORE mutating and push undo only if the doc actually changed —
    // an Apply that reproduces the current layout must not push a phantom undo
    // step (the no-op-snapshot invariant from 5df1f99 / mutateDocument). Touch
    // viewExtras only when there's a stale class to clear, so a no-op Apply
    // doesn't flip viewExtras from undefined to {} and read as a change.
    const before = this.snapState();
    this.doc.root = root;
    this.doc.kind = 'row';
    if (this.doc.viewExtras?.additionalRowClass !== undefined) {
      this.doc.viewExtras = { ...this.doc.viewExtras };
      delete this.doc.viewExtras.additionalRowClass;
    }
    if (this.snapState() !== before) this.pushUndo(before);
    this.selection = [];
    this.emit('kind');
  }

  /** Apply a pre-built TILE template — same routing and no-op guard as
   *  applyRowTemplate. On a sheet, viewExtras stay untouched: the tile wrapper
   *  doesn't export them, but switching back to a row view must not have lost
   *  them. */
  applyTileTemplate(root: SPElement, size?: { width?: number; height?: number }): void {
    if (this.activeDocKey !== 'main') this.openMain();
    if (this.onFloor) {
      this.createView({ kind: 'tile', root, tileWidth: size?.width ?? 254, tileHeight: size?.height ?? 220 });
      return;
    }
    const before = this.snapState();
    this.doc.root = root;
    this.doc.kind = 'tile';
    this.doc.tileWidth = size?.width ?? this.doc.tileWidth ?? 254;
    this.doc.tileHeight = size?.height ?? this.doc.tileHeight ?? 220;
    if (this.snapState() !== before) this.pushUndo(before);
    this.selection = [];
    this.emit('kind');
  }

  /** Set the row's density (Roomy/Compact) — gap + padding on the root only. */
  setRowDensity(density: RowDensity): void {
    const root = this.doc.root;
    this.mutateDocument(() => applyRowDensity(root, density));
  }

  // ─── Column looks: apply, remove, import ───────────────────────────────────
  // A column gets its look by having a component applied to it (COLUMNS-
  // COMPONENTS-VIEWS §4) — there is no per-column editing surface. Every
  // gesture below rewrites the STORE and the column's FLOOR CELL together as
  // ONE undoable mutation, so the grid never goes stale and a single Ctrl+Z
  // reverts both.

  /** Re-embed `fieldName`'s floor cell from the current look store (or the
   *  plain-value cell once the look is gone). Mutates in place — callers own
   *  the undo step. A floor without that column (unplaced) is left alone. */
  private refreshFloorCell(fieldName: string): void {
    const field = this.fields.find((f) => f.name === fieldName);
    const children = this.floorDoc.root.children;
    if (!field || !children) return;
    const i = children.findIndex((c) => gridColumnField(c) === fieldName);
    if (i >= 0) children[i] = gridCellForField(field, this.columnLooks);
  }

  /** Apply a component to a column — the gesture that replaced "Format this
   *  column": bake a stamped bound instance, store it as the column's look,
   *  and re-embed the floor cell. ONE undoable step. */
  applyComponentToColumn(fieldName: string, def: ComponentDef, mapping: Record<string, string>): void {
    if (!this.fields.some((f) => f.name === fieldName)) return;
    this.mutateDocument(() => {
      this.columnLooks[fieldName] = bindComponentInstance(def, mapping);
      this.refreshFloorCell(fieldName);
    });
    this.emit('data'); // the look shows up in pickers/library
  }

  /** Undress a column: delete its look and re-embed the plain-value cell.
   *  ONE undoable step. */
  removeColumnLook(fieldName: string): void {
    if (!Object.hasOwn(this.columnLooks, fieldName)) return;
    this.mutateDocument(() => {
      delete this.columnLooks[fieldName];
      this.refreshFloorCell(fieldName);
    });
    this.emit('data');
  }

  /** Register an imported column-dialect formatter (a schema import, pasted
   *  column JSON, a share link) as `fieldName`'s look: @currentField becomes
   *  the explicit [$Field] store dialect. UNSTAMPED — no def backs it; the
   *  instance card offers "Save as component" to lift it into one
   *  (refuse-and-teach: an imported look is one gesture from editable, never
   *  silently editable). ONE undoable step, floor cell included. */
  registerImportedLook(fieldName: string, columnDialectRoot: SPElement): void {
    this.mutateDocument(() => {
      this.columnLooks[fieldName] = inlineColumnFormatter(columnDialectRoot, fieldName);
      this.refreshFloorCell(fieldName);
    });
    this.emit('data');
  }

  // ─── Snapshots (issue #140): capture & restore a formatter's state ─────────
  // The store itself (localStorage, caps, scope keys) lives in snapshots.ts +
  // the snapshot menu; state only knows how to CAPTURE the live payload and
  // APPLY one back. Every apply is ONE undoable step (snapState carries the
  // whole workspace, so even "restore everything" is a single Ctrl+Z).

  /** Capture what `scope` describes right now, or null if there's nothing to
   *  capture (e.g. a column scope naming a look-less column). */
  captureSnapshot(scope: SnapshotScope, now: Date = new Date()): Snapshot | null {
    let payload: Snapshot['payload'] | null = null;
    if (scope.kind === 'column') {
      // own keys only — 'toString' etc. must never read as a look
      if (!Object.hasOwn(this.columnLooks, scope.field)) return null;
      payload = { root: clone(this.columnLooks[scope.field]) };
    } else {
      payload = {
        all: { floor: clone(this.floorDoc), views: clone(this.views), columnLooks: clone(this.columnLooks) },
      };
    }
    return {
      id: snapshotId(now),
      takenAt: now.toISOString(),
      label: defaultLabel(scope, this.views.length),
      scope,
      payload,
    };
  }

  /** Restore a snapshot as ONE undoable step. Returns false if the payload
   *  doesn't match its scope (corrupt store) — nothing is touched then. */
  applySnapshot(snap: Snapshot): boolean {
    if (snap.scope.kind === 'column') {
      const root = snap.payload.root;
      if (!root) return false;
      const field = snap.scope.field;
      this.mutateDocument(() => {
        // the look AND the floor cell together — the grid must not go stale
        this.columnLooks[field] = clone(root);
        this.refreshFloorCell(field);
      });
      this.selection = [];
      this.emit('data'); // tree/library/grid pick up the look change
      return true;
    }
    const all = snap.payload.all;
    if (!all?.floor?.root || !Array.isArray(all.views)) return false;
    const before = this.snapState();
    this.floorDoc = { ...clone(all.floor), kind: 'grid' };
    this.views = clone(all.views);
    this.columnLooks = clone(all.columnLooks);
    if (this.activeViewId && !this.views.some((v) => v.id === this.activeViewId)) {
      this.activeViewId = null; // the sheet you stood on isn't in this capture
    }
    this.sanitizeTabs(); // the capture may predate (or postdate) some views' tabs
    this.doc = this.surfaceDoc();
    if (this.snapState() !== before) this.pushUndo(before);
    this.selection = [];
    this.emit('kind');
    this.emit('data');
    return true;
  }

  /**
   * Batched cross-cutting apply (the component editor's Save-and-apply): view
   * subtree replacements and look re-bakes together as ONE undoable step. A
   * single Ctrl+Z reverts everything `fn` touched (docs + columnLooks); a
   * no-op `fn` leaves ZERO trace.
   */
  batchProjectUpdate(_touchedColumns: string[], fn: () => void): void {
    if (this.activeDocKey !== 'main') this.openMain();
    const before = this.snapState();
    fn();
    if (this.snapState() === before) return; // no-op: zero trace
    this.pushUndo(before);
    this.emit('document');
    this.emit('data'); // look changes show up in pickers/tree/library
  }

  /** Register a row/tile document as a NEW named sheet and open it — how
   *  examples and imported view formatters enter the workspace. */
  loadViewDocument(doc: FormatterDocument, name?: string): SheetDoc | null {
    return this.createView(doc, name);
  }

  /**
   * "Apply to canvas": replace whatever is being edited with `doc` — the JSON
   * tab's contract. Routing per surface:
   *   · a COLUMN payload (from ANY surface) becomes the current field's LOOK
   *     (registerImportedLook — @currentField → [$Field]); the canvas lands
   *     on the floor with that column selected. No drill surface exists.
   *   · a sheet up → the sheet's document (kind follows the payload);
   *   · on the floor → a PURE-GRID row payload (every root child still a
   *     single-field column — the schema-import guard) replaces the FLOOR
   *     ROOT, kind stays 'grid', so the floor's own export round-trips
   *     losslessly; a row LAYOUT (zones/composites) becomes a NEW sheet —
   *     the floor never renders pseudo-columns (FLOOR-AND-SHEETS Stage 2);
   *     a tile payload becomes a NEW sheet (a tile can never be a floor).
   */
  loadDocument(doc: FormatterDocument): void {
    if (doc.kind === 'column') {
      const field = this.currentFieldName;
      this.registerImportedLook(field, doc.root);
      if (!this.onFloor) this.minimizeView(); // navigation — the look lives on the grid
      const i = (this.floorDoc.root.children ?? []).findIndex((c) => gridColumnField(c) === field);
      this.selection = i >= 0 ? [i] : [];
      this.emit('load');
      return;
    }
    if (this.onFloor) {
      if (doc.kind === 'tile') { this.createView(doc); return; }
      if (doc.root.children?.length && !isPureGrid(doc.root)) {
        // a LAYOUT can never be the floor — the floor renders columns only.
        // (A childless/empty root has no columns to fake and stays a floor
        // replacement, e.g. seeding an empty grid.)
        this.createView({ ...doc, kind: 'row' });
        return;
      }
      this.snapshot();
      this.floorDoc.root = doc.root; // 'row'/'grid' payloads: the floor's tree
      if (doc.viewExtras) this.floorDoc.viewExtras = doc.viewExtras;
      else delete this.floorDoc.viewExtras;
      this.selection = [];
      this.emit('load');
      return;
    }
    this.snapshot();
    const v = this.activeView!;
    const next: FormatterDocument = { ...doc, kind: doc.kind === 'tile' ? 'tile' : 'row' };
    if (next.kind === 'tile') {
      next.tileWidth = next.tileWidth ?? 254;
      next.tileHeight = next.tileHeight ?? 220;
    }
    v.doc = next;
    this.doc = v.doc;
    this.selection = [];
    this.emit('load');
  }
}

/** Path segment that descends into customCardProps.formatter. */
export const CARD_SEGMENT = -1;

export function pathStartsWith(longer: NodePath, prefix: NodePath): boolean {
  if (prefix.length > longer.length) return false;
  return prefix.every((v, i) => longer[i] === v);
}

export function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((v, i) => b[i] === v);
}

export const state = new EditorState();

// A reload/navigation inside the 400ms autosave debounce would silently drop
// the last change (e.g. a theme toggle right before the page reloads).
window.addEventListener('beforeunload', () => state.flushAutosave());
