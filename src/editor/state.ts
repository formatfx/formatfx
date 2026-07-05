/**
 * editor/state.ts — Single store for the editor: the workspace (floor grid +
 * named view sheets + registered column formatters), mock data, selection
 * (by node path), undo/redo, and change notification.
 *
 * FLOOR-AND-SHEETS Stage 1 — the state model:
 *   · The FLOOR is its own columns-only grid document (`floorDoc`, kind
 *     'grid'). It never holds a view layout; nothing a view does can change
 *     it, and nothing on the floor can destroy a view.
 *   · Each row/tile view is a named SHEET document (`views`). Opening a
 *     sheet slides it over the floor; minimizing drops back to the floor
 *     WITHOUT touching the sheet. Leaving/opening is navigation, never a
 *     document mutation — it pushes nothing onto the undo stack.
 *   · `doc` stays the live canvas document every consumer reads. While
 *     `activeDocKey === 'main'` it IS the active surface's slot object
 *     (floorDoc or a sheet's doc); drilled into a column formatter it is
 *     that column's tree, kind 'column'.
 *   · Undo is ONE GLOBAL app-level stack (FLOOR-AND-SHEETS §2.3): every
 *     snapshot captures the whole workspace plus where the mutation
 *     happened, so undo/redo also navigate back to the surface they change
 *     — the spreadsheet-workbook convention. Modal editors keep their own
 *     local stacks and commit as one app step (template builder,
 *     batchProjectUpdate, Format cells); the canvas-inline CFR drill-in is
 *     a surface, so its gestures are app-level steps.
 */

import type {
  FormatterDocument, SPElement, NodePath, MockField, MockRow, PersonValue, DocumentKind,
} from '../core/types';
import type { ImportedView } from '../core/schemaImport';
import { cfrFieldName } from '../core/refs';
import { buildGridRoot, gridCellForField, gridColumnField } from './gridScaffold';
import { inlineColumnFormatter, toColumnFormatter } from './cfr';
import {
  buildRowView, rowDensityOf,
  setRowDensity as applyRowDensity,
  type RowDensity,
} from './areas';
import {
  snapshotId, defaultLabel,
  type Snapshot, type SnapshotScope,
} from './snapshots';

export type ChangeReason =
  | 'document' | 'selection' | 'data' | 'kind' | 'theme' | 'load' | 'lens';

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

type Listener = (reason: ChangeReason) => void;

const ME: PersonValue = {
  title: 'Sandbox User', email: 'me@contoso.com', jobTitle: 'Maker', department: 'IT',
};

function defaultFloor(): FormatterDocument {
  // the grid-first workspace: the floor starts as a Microsoft-Lists style
  // grid — one column per view column, each rendered with its current
  // formatter (Status/Progress arrive formatted; Owner stays registered but
  // unplaced so "+ column" demonstrates adding an already-formatted column).
  return {
    kind: 'grid',
    root: buildGridRoot(defaultFields(), defaultColumnRefs(),
      ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']),
  };
}

/** Showcase column formatters — referenced by the default floor (Owner is registered but unused, on purpose). */
function defaultColumnRefs(): Record<string, SPElement> {
  return {
    Status: {
      elmType: 'div',
      _elmName: 'Status pill',
      txtContent: "=if([$Status]=='','None',[$Status])",
      style: {
        'display': 'inline-flex', 'align-items': 'center', 'justify-content': 'center',
        'border-radius': '12px', 'padding': '2px 10px',
        'font-size': '12px', 'font-weight': '600', 'color': '#ffffff',
        'background-color': "=if([$Status]=='Done','#107c10',if([$Status]=='Blocked','#d13438',if([$Status]=='In Progress','#0078d4','#737a7f')))",
      },
    },
    Progress: {
      elmType: 'div',
      _elmName: 'Progress bar',
      attributes: { class: 'ms-bgColor-neutralLighter' },
      style: { 'width': '120px', 'border-radius': '3px', 'overflow': 'hidden' },
      children: [{
        elmType: 'div',
        _elmName: 'Fill',
        txtContent: "=@currentField+'%'",
        style: {
          'width': "=@currentField+'%'", 'min-width': '24px',
          'background-color': "=if(@currentField>=100,'#107c10','#0078d4')",
          'color': '#ffffff', 'font-size': '11px', 'padding': '2px 4px', 'box-sizing': 'border-box',
        },
      }],
    },
    Owner: {
      elmType: 'div',
      _elmName: 'Owner persona',
      style: { 'display': 'flex', 'align-items': 'center' },
      children: [
        {
          elmType: 'img',
          _elmName: 'Avatar',
          attributes: { src: "=getUserImage([$Owner.email],'S')", title: '=[$Owner.title]' },
          style: { 'width': '24px', 'height': '24px', 'border-radius': '50%', 'margin-right': '6px' },
        },
        { elmType: 'span', txtContent: '[$Owner.title]', style: { 'font-size': '13px' } },
      ],
    },
  };
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
  /** The live canvas document. While `activeDocKey === 'main'` this IS the
   *  active surface's slot object (write-through); drilled into a column
   *  formatter it is that column's tree with kind 'column'. */
  doc: FormatterDocument = this.floorDoc;
  fields: MockField[] = defaultFields();
  rows: MockRow[] = defaultRows();
  /** Field the column formatter targets (@currentField). */
  currentFieldName = 'Status';
  /** Registered column formatters for columnFormatterReference resolution:
   *  field name → tree. Owned by the WORKSPACE — column formatters render on
   *  the floor's cells and on sheets via CFR alike, so the registry sits
   *  above both surfaces. */
  columnRefs: Record<string, SPElement> = defaultColumnRefs();
  /** Views captured by a List Snapshot import (formatters kept as raw text). */
  importedViews: ImportedView[] = [];
  /** Which formatter is on the canvas: 'main' or a columnRefs key. */
  activeDocKey = 'main';
  /** The sheet last on the canvas — session-local memory for the "⟳ Reopen"
   *  affordance (Stage 2's tab strip replaces it). Never persisted. */
  lastOpenViewId: string | null = null;
  /** The maker's data-tab field pick, stashed while a drill-in overrides
   *  currentFieldName, restored on the way back out. */
  private drillFieldStash: string | null = null;
  /**
   * Selection backing store. Figma-style multi-select: the array holds every
   * selected node path; `selection` (below) is the backward-compatible primary
   * = `_selections[0]`. `[]` as a member means the root is selected; an empty
   * array means nothing is selected (the old `selection === null`).
   */
  private _selections: NodePath[] = [[]];
  /** The Left Edit Pane lens — UI view state, NOT part of the project file. */
  activeLens: EditorLens = 'pro';
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
  /** Per-surface selection memory (pure view state): 'floor', a view id, or a
   *  column name → the selection that was live when you navigated away. */
  private surfaceSelections: Record<string, NodePath[]> = {};
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
    // keep the registry live while a column formatter is being edited, so
    // CFRs on the floor and sheets pick up edits the moment you switch back
    if (this.activeDocKey !== 'main' && (reason === 'document' || reason === 'load')) {
      this.columnRefs[this.activeDocKey] = this.doc.root;
    }
    for (const fn of this.listeners) fn(reason);
    // 'selection' and 'lens' are pure view state — neither autosaves (the lens
    // is not part of the project file; it lives in wb-ui-prefs).
    if (reason !== 'selection' && reason !== 'lens') this.scheduleAutosave();
  }

  // ─── Left Edit Pane: lens + Save checkpoint ────────────────────────────────

  /** Switch the Simple/Pro/Code lens. UI-only: off the undo stack, no autosave. */
  setLens(lens: EditorLens): void {
    if (this.activeLens === lens) return;
    this.activeLens = lens;
    this.emit('lens');
  }

  /** Mark the live workspace as the Save checkpoint (the Save button / first load). */
  markSavepoint(): void { this._savepoint = this.snapState(); }

  /** Whether there are unsaved mutations since the last Save checkpoint.
   *  Compares CONTENT (floor + sheets + registry + tags) — navigation and
   *  selection are view state and never count as dirt. */
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

  // ─── Workspace: the floor, the sheets, and the drill-in ────────────────────

  /** Whether the floor is the active surface (regardless of a column drill). */
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
   *  `doc` aliases while no column formatter is drilled into. */
  private surfaceDoc(): FormatterDocument {
    return this.activeView?.doc ?? this.floorDoc;
  }

  /** Selection-memory key for the current canvas document. */
  private surfaceKey(): string {
    return this.activeDocKey !== 'main' ? this.activeDocKey : (this.activeViewId ?? 'floor');
  }

  /** Write the live canvas document back into its slot. The surface slots are
   *  write-through aliases already; this re-asserts the invariant (defensive)
   *  and syncs a drilled column tree into the registry. */
  private flushActiveDoc(): void {
    if (this.activeDocKey !== 'main') {
      this.columnRefs[this.activeDocKey] = this.doc.root;
      return;
    }
    const v = this.activeView;
    if (v) v.doc = this.doc;
    else this.floorDoc = this.doc;
  }

  /** Stash the current selection under its surface key and restore the target's. */
  private swapSelections(toKey: string): void {
    this.surfaceSelections[this.surfaceKey()] = this._selections;
    this._selections = this.surfaceSelections[toKey] ?? [[]];
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
    if (e.key !== 'main' && !Object.hasOwn(this.columnRefs, e.key)) return false;
    if (e.view !== null && !this.viewById(e.view)) return false;
    return true;
  }

  /** Where goBack() would land ('main' or a column name), or null if nowhere.
   *  Skips entries whose column/sheet has since been unregistered/removed. */
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
      if (entry.key !== this.activeDocKey) {
        if (entry.key === 'main') this.openMain();
        else this.openColumnRef(entry.key);
      }
    } finally {
      this.inGoBack = false;
    }
    return entry.key;
  }

  private inGoBack = false;

  /**
   * Open a sheet over the floor. NAVIGATION: never a document mutation, never
   * an undo step (FLOOR-AND-SHEETS §2.2). Works while drilled into a column
   * formatter — the surface underneath switches, the drill stays put.
   */
  openView(id: string): void {
    const v = this.viewById(id);
    if (!v || this.activeViewId === id) return;
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();
    if (this.activeDocKey === 'main') this.swapSelections(id);
    this.activeViewId = id;
    this.lastOpenViewId = id;
    if (this.activeDocKey === 'main') this.doc = v.doc;
    this.emit('load');
    this.emit('data');
  }

  /** Drop back to the floor. NAVIGATION — the sheet is untouched and waits in
   *  the view list; nothing lands on the undo stack. */
  minimizeView(): void {
    if (this.activeViewId === null) return;
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();
    this.lastOpenViewId = this.activeViewId;
    if (this.activeDocKey === 'main') this.swapSelections('floor');
    this.activeViewId = null;
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
    this.swapSelections(sheet.id);
    this.activeViewId = sheet.id;
    this.lastOpenViewId = sheet.id;
    this.doc = sheet.doc;
    this.selection = [];
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

  /** The main (view) formatter root, even while drilled into a column style —
   *  scope/blast-radius calculations need the active SURFACE. */
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

  /** Column names the active surface references via columnFormatterReference. */
  referencedColumns(): Set<string> {
    const out = new Set<string>();
    const root = this.mainRootForScope;
    const walk = (el: SPElement | undefined): void => {
      if (!el) return;
      if (el.columnFormatterReference) {
        out.add(cfrFieldName(el.columnFormatterReference));
      }
      el.children?.forEach(walk);
      if (el.customCardProps?.formatter) walk(el.customCardProps.formatter);
    };
    walk(root);
    return out;
  }

  // ─── Drill-in: main surface ⇄ column formatters ────────────────────────────

  /** Open a registered column formatter for editing. */
  openColumnRef(name: string): void {
    // own-key check: `in` would also match prototype members ('toString', …),
    // and a registry read on such a name must never open a "formatter"
    if (!Object.hasOwn(this.columnRefs, name) || this.activeDocKey === name) return;
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();
    this.swapSelections(name);
    if (this.activeDocKey === 'main') this.drillFieldStash = this.currentFieldName;
    this.doc = { kind: 'column', root: this.columnRefs[name] };
    this.activeDocKey = name;
    // @currentField inside a column formatter is that column
    if (this.fields.some((f) => f.name === name)) this.currentFieldName = name;
    this.emit('load');
    this.emit('data');
  }

  /** Return to the active surface (the floor or the open sheet). */
  openMain(): void {
    if (this.activeDocKey === 'main') return;
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();
    this.swapSelections(this.activeViewId ?? 'floor');
    this.activeDocKey = 'main';
    this.doc = this.surfaceDoc();
    if (this.drillFieldStash) {
      this.currentFieldName = this.drillFieldStash;
      this.drillFieldStash = null;
    }
    this.emit('load');
    this.emit('data');
  }

  // ─── Project persistence ───────────────────────────────────────────────────

  static readonly STORAGE_KEY = 'list-formatting-sandbox.project.v1';

  serializeProject(): string {
    this.flushActiveDoc();
    return JSON.stringify({
      version: 2,
      floor: this.floorDoc,
      views: this.views,
      activeViewId: this.activeViewId,
      fields: this.fields,
      rows: this.rows,
      currentFieldName: (this.activeDocKey !== 'main' && this.drillFieldStash) || this.currentFieldName,
      columnRefs: this.columnRefs,
      ...(this.importedViews.length ? { importedViews: this.importedViews } : {}),
      themeMode: this.themeMode,
      customTheme: this.customTheme,
    }, null, 2);
  }

  /**
   * Load a project payload. STRICT v2 shape guard: anything else — including
   * every pre-Stage-1 payload — throws, and restore() falls back to the fresh
   * default. That is a LOAD GUARD, not a converter: no migration code exists
   * or is maintained (FLOOR-AND-SHEETS §3 Stage 1, owner call 2026-07-04).
   */
  loadProject(text: string): void {
    const p = JSON.parse(text);
    const viewOk = (v: unknown): boolean => {
      const s = v as SheetDoc;
      return Boolean(s && typeof s.id === 'string' && s.id
        && typeof s.name === 'string'
        && (s.doc?.kind === 'row' || s.doc?.kind === 'tile')
        && s.doc?.root?.elmType);
    };
    if (!p || typeof p !== 'object'
      || !p.floor?.root?.elmType
      || !Array.isArray(p.views) || !p.views.every(viewOk)
      || !Array.isArray(p.fields) || !Array.isArray(p.rows)) {
      throw new Error('Not a formatfx workspace file (expected floor/views/fields/rows).');
    }
    this.floorDoc = { ...p.floor, kind: 'grid' };
    this.views = p.views;
    this.activeViewId = (typeof p.activeViewId === 'string' && p.views.some((v: SheetDoc) => v.id === p.activeViewId))
      ? p.activeViewId : null;
    this.fields = p.fields;
    this.rows = p.rows;
    this.currentFieldName = typeof p.currentFieldName === 'string' ? p.currentFieldName : this.fields[0]?.name ?? 'Title';
    this.columnRefs = (p.columnRefs && typeof p.columnRefs === 'object') ? p.columnRefs : {};
    this.importedViews = Array.isArray(p.importedViews) ? p.importedViews : [];
    this.activeDocKey = 'main';
    this.doc = this.surfaceDoc();
    this.lastOpenViewId = this.activeViewId;
    if (p.themeMode === 'light' || p.themeMode === 'dark') this.themeMode = p.themeMode;
    this.customTheme = (p.customTheme && typeof p.customTheme === 'object') ? p.customTheme : null;
    this.drillFieldStash = null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.surfaceSelections = {};
    this.navStack = [];
    this.viewIdCounter = 0;
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
    this.columnRefs = defaultColumnRefs();
    this.importedViews = [];
    this.activeDocKey = 'main';
    this.lastOpenViewId = null;
    this.drillFieldStash = null;
    this.customTheme = null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.surfaceSelections = {};
    this.navStack = [];
    this.viewIdCounter = 0;
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

  /** The undo snapshot: the WHOLE workspace — floor, sheets, the registered
   *  column formatters, the per-field subtype tags — plus where the mutation
   *  happened (surface + drill) and the selection. One global app-level stack
   *  (FLOOR-AND-SHEETS §2.3): undo/redo restore content AND navigate back to
   *  the surface they change. Structural field edits (add/remove/type, via
   *  the data panel) deliberately live outside undo, so a later field edit is
   *  never clobbered by an unrelated doc undo. */
  private snapState(): string {
    this.flushActiveDoc();
    return JSON.stringify({
      floor: this.floorDoc,
      views: this.views,
      activeViewId: this.activeViewId,
      activeDocKey: this.activeDocKey,
      tags: this.subtypeTags(),
      refs: this.columnRefs,
      selections: this._selections,
    });
  }

  private subtypeTags(): Record<string, { subtype?: string; subtypeArgs?: Record<string, string | number | boolean> }> {
    const out: Record<string, { subtype?: string; subtypeArgs?: Record<string, string | number | boolean> }> = {};
    for (const f of this.fields) {
      if (f.subtype !== undefined || f.subtypeArgs !== undefined) out[f.name] = { subtype: f.subtype, subtypeArgs: f.subtypeArgs };
    }
    return out;
  }

  private restoreSnap(snap: string): void {
    const parsed = JSON.parse(snap) as {
      floor: FormatterDocument;
      views: SheetDoc[];
      activeViewId: string | null;
      activeDocKey: string;
      tags?: Record<string, { subtype?: string; subtypeArgs?: Record<string, string | number | boolean> }>;
      refs: Record<string, SPElement>;
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
    this.columnRefs = parsed.refs;
    this.activeViewId = (parsed.activeViewId && this.views.some((v) => v.id === parsed.activeViewId))
      ? parsed.activeViewId : null;
    if (this.activeViewId) this.lastOpenViewId = this.activeViewId;
    this.activeDocKey = (parsed.activeDocKey !== 'main' && Object.hasOwn(this.columnRefs, parsed.activeDocKey))
      ? parsed.activeDocKey : 'main';
    if (this.activeDocKey !== 'main') {
      this.doc = { kind: 'column', root: this.columnRefs[this.activeDocKey] };
      if (this.fields.some((f) => f.name === this.activeDocKey)) this.currentFieldName = this.activeDocKey;
    } else {
      this.doc = this.surfaceDoc();
      if (this.drillFieldStash) {
        this.currentFieldName = this.drillFieldStash;
        this.drillFieldStash = null;
      }
    }
    if (parsed.selections) this._selections = parsed.selections;
    const tags = parsed.tags ?? {};
    for (const f of this.fields) {
      const t = tags[f.name];
      if (t && t.subtype !== undefined) f.subtype = t.subtype; else delete f.subtype;
      if (t && t.subtypeArgs !== undefined) f.subtypeArgs = t.subtypeArgs; else delete f.subtypeArgs;
    }
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
   *  the canvas to another surface or drill (undo navigates to its change). */
  private applyRestore(snap: string): void {
    const navBefore = `${this.activeDocKey}·${this.activeViewId}`;
    this.restoreSnap(snap);
    this.clampSelection();
    if (`${this.activeDocKey}·${this.activeViewId}` !== navBefore) {
      this.emit('load');
      this.emit('data');
    }
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
    // inserting into a solo-CFR host: split the reference into its own child
    // so the fragment sits beside it, not swallowed by the CFR (see reparentNode).
    this.materializeCfrHost(container);
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

  /**
   * A CFR host cell carries the columnFormatterReference DIRECTLY on a div, so
   * the tree collapses it to a single "solo CFR" row — the wrapper div is noise
   * when the reference is all it holds. The moment something else joins that
   * div, that collapsed row would read as "the CFR absorbed the newcomer". Push
   * the reference (and the column's throwaway name) down into its own child div
   * so the container becomes a plain parent that HOSTS the CFR and the newcomer
   * as siblings — the div earns its own tree row exactly when it stops being
   * solo. Slot styles (flex/min-width) stay on the container: they position the
   * cell within its row, not the reference within the cell. Mutates in place;
   * callers snapshot first. No-op unless `container` carries a reference.
   */
  private materializeCfrHost(container: SPElement): void {
    if (!container.columnFormatterReference) return;
    const cfrCell: SPElement = {
      elmType: container.elmType ?? 'div',
      columnFormatterReference: container.columnFormatterReference,
    };
    if (container._elmName !== undefined) {
      cfrCell._elmName = container._elmName;
      delete container._elmName;
    }
    delete container.columnFormatterReference;
    container.children = [cfrCell, ...(container.children ?? [])];
  }

  /** Move a node to become a child of another container (drag & drop). */
  reparentNode(from: NodePath, toContainer: NodePath, index?: number): void {
    if (pathStartsWith(toContainer, from)) return; // can't drop into own subtree
    const node = this.nodeAt(from);
    const p = this.parentOf(from);
    const container = this.nodeAt(toContainer);
    if (!node || !p || !container) return;
    this.snapshot();
    // dropping onto a solo-CFR host: split the div out from the reference so
    // both the reference and the dropped node become its children (siblings),
    // instead of the newcomer vanishing "inside" the CFR.
    this.materializeCfrHost(container);
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
   *   · 'column' main documents no longer exist; drilled docs are read-only
   *     'column' by construction, so setKind ignores that value.
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
    if (this.activeDocKey !== 'main') this.openMain();
    if (this.onFloor) {
      const doc: FormatterDocument = { kind: 'row', root };
      if (additionalRowClass) doc.viewExtras = { additionalRowClass };
      this.createView(doc);
      return;
    }
    // Snapshot BEFORE mutating and push undo only if the doc actually changed —
    // an Apply that reproduces the current layout must not push a phantom undo
    // step (the no-op-snapshot invariant from 5df1f99 / mutateDocument). Touch
    // viewExtras only when there's a zebra class to set or clear, so a no-op
    // Apply doesn't flip viewExtras from undefined to {} and read as a change.
    const before = this.snapState();
    this.doc.root = root;
    this.doc.kind = 'row';
    if (additionalRowClass) {
      this.doc.viewExtras = { ...this.doc.viewExtras, additionalRowClass };
    } else if (this.doc.viewExtras?.additionalRowClass !== undefined) {
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

  // ─── Stage 4: CFR linked instances (the Figma model) ───────────────────────

  /** "Override in this view": fork a linked grid cell into a LOCAL copy of the
   *  registered formatter, inlined into THIS view — its own to restyle, no
   *  longer tied to the column's shared format. The cell keeps its grid layout
   *  (flex/min-width) and name; @currentField becomes the explicit [$Field] ref
   *  so it renders locally. */
  forkCfr(path: NodePath): void {
    const el = this.nodeAt(path);
    if (!el?.columnFormatterReference) return;
    const field = cfrFieldName(el.columnFormatterReference);
    const registered = this.columnRefs[field];
    if (!registered) return;
    const local = inlineColumnFormatter(registered, field);
    this.mutateDocument(() => {
      local.style = { ...local.style, 'flex': el.style?.['flex'] ?? '1', 'min-width': el.style?.['min-width'] ?? '0' };
      if (el._elmName) local._elmName = el._elmName;
      delete local.columnFormatterReference;
      const p = this.parentOf(path);
      if (p?.parent.children) p.parent.children[p.index] = local;
      else this.doc.root = local;
    });
  }

  /** "Save as the column's format": promote a LOCAL single-field cell to the
   *  column's shared formatter (registered, [$Field] → @currentField), then
   *  relink this cell to it as a CFR — so the design is reusable everywhere.
   *  Returns the field name promoted, or null if the cell isn't promotable. */
  promoteToColumn(path: NodePath): string | null {
    const el = this.nodeAt(path);
    if (!el || el.columnFormatterReference) return null;
    const field = gridColumnField(el);
    if (!field) return null;
    this.mutateDocument(() => {
      this.columnRefs[field] = toColumnFormatter(el, field);
      const cell = gridCellForField(
        this.fields.find((f) => f.name === field) ?? { name: field, type: 'text' },
        this.columnRefs,
      );
      if (el._elmName) cell._elmName = el._elmName;
      const p = this.parentOf(path);
      if (p?.parent.children) p.parent.children[p.index] = cell;
      else this.doc.root = cell;
    });
    this.emit('data'); // the new registered formatter shows up in pickers/tree
    return field;
  }

  // ─── Snapshots (issue #140): capture & restore a formatter's state ─────────
  // The store itself (localStorage, caps, scope keys) lives in snapshots.ts +
  // the snapshot menu; state only knows how to CAPTURE the live payload and
  // APPLY one back. Every apply is ONE undoable step (snapState carries the
  // whole workspace, so even "restore everything" is a single Ctrl+Z).

  /** Capture what `scope` describes right now, or null if there's nothing to
   *  capture (e.g. a column scope naming an unregistered, un-open column). */
  captureSnapshot(scope: SnapshotScope, now: Date = new Date()): Snapshot | null {
    let payload: Snapshot['payload'] | null = null;
    if (scope.kind === 'column') {
      // the open column's live tree wins; then the registry (own keys only —
      // 'toString' etc. must not read as a formatter)
      const root = this.activeDocKey === scope.field
        ? this.doc.root
        : (Object.hasOwn(this.columnRefs, scope.field) ? this.columnRefs[scope.field] : undefined);
      if (!root) return null;
      payload = { root: clone(root) };
    } else {
      // read-only capture: overlay the open column's live tree on a CLONE of
      // the registry instead of flushing it back into editor state
      const refs = clone(this.columnRefs);
      if (this.activeDocKey !== 'main') refs[this.activeDocKey] = clone(this.doc.root);
      payload = {
        all: { floor: clone(this.floorDoc), views: clone(this.views), columnRefs: refs },
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
      const restored = clone(root);
      if (this.activeDocKey === field) {
        // open on the canvas — emit('document') live-syncs the registry
        this.mutateDocument(() => { this.doc.root = restored; });
      } else {
        // registered, or unregistered-and-not-open: the snapshot IS the format
        this.mutateDocument(() => { this.columnRefs[field] = restored; });
      }
      this.selection = [];
      this.emit('data'); // tree/gallery/grid pick up the registry change
      return true;
    }
    const all = snap.payload.all;
    if (!all?.floor?.root || !Array.isArray(all.views)) return false;
    // restoring everything replaces the surfaces — leave a drilled column
    // first (navigation, not a mutation; it also feeds the Back trail)
    if (this.activeDocKey !== 'main') this.openMain();
    const before = this.snapState();
    this.floorDoc = { ...clone(all.floor), kind: 'grid' };
    this.views = clone(all.views);
    this.columnRefs = clone(all.columnRefs);
    if (this.activeViewId && !this.views.some((v) => v.id === this.activeViewId)) {
      this.activeViewId = null; // the sheet you stood on isn't in this capture
    }
    this.doc = this.surfaceDoc();
    if (this.snapState() !== before) this.pushUndo(before);
    this.selection = [];
    this.emit('kind');
    this.emit('data');
    return true;
  }

  // ─── Column subtypes: snapshot apply ───────────────────────────────────────

  /** Apply a subtype to a column as ONE undoable mutation: register the
   *  already-baked formatter, tag the field (subtype id + baked args), and
   *  CFR-wire the grid cell so the grid renders it — ALL inside the snapshot
   *  (snapState captures the registry + tags + docs), so a single undo reverts
   *  the render, the tag, AND the registry entry. This makes even a re-apply
   *  over an already-CFR cell fully reversible (no lingering/mismatched entry).
   *  Stays on the grid (no doc switch — that would move the canvas away and
   *  defeat the gesture). */
  applyColumnSubtype(
    fieldName: string,
    baked: SPElement,
    subtypeId: string,
    args: Record<string, string | number | boolean>,
    path: NodePath,
  ): void {
    const field = this.fields.find((f) => f.name === fieldName);
    if (!field) return;
    this.mutateDocument(() => {
      this.columnRefs[fieldName] = baked; // captured by snapState → reverts on undo
      field.subtype = subtypeId;
      field.subtypeArgs = args;
      const el = this.nodeAt(path);
      if (el && !el.columnFormatterReference && path.length > 0) {
        const p = this.parentOf(path);
        if (p?.parent.children) {
          const cell = gridCellForField(field, this.columnRefs);
          if (el._elmName) cell._elmName = el._elmName;
          p.parent.children[p.index] = cell;
        }
      }
    });
  }

  /** Columns currently wearing `subtypeId` (and registered) — the push count. */
  columnsUsingSubtype(subtypeId: string): MockField[] {
    return this.fields.filter((f) => f.subtype === subtypeId && (f.name in this.columnRefs));
  }

  /**
   * Push a refined subtype to every column using it (US-7): re-bake each tagged,
   * registered column from its OWN stored `subtypeArgs` and overwrite its
   * formatter (hand-edits included), as ONE batched undoable mutation — a single
   * undo reverts every column (the registry is captured by snapState). `rebake`
   * is supplied by the caller (gridView, which holds bakeSubtype) so state never
   * imports the subtypes/editor graph. Returns how many columns were re-baked.
   */
  pushSubtypeUpdate(
    subtypeId: string,
    rebake: (args: Record<string, string | number | boolean>) => SPElement,
  ): number {
    const targets = this.columnsUsingSubtype(subtypeId);
    if (targets.length === 0) return 0;
    this.mutateDocument(() => {
      for (const f of targets) {
        this.columnRefs[f.name] = rebake(f.subtypeArgs ?? {});
      }
    });
    return targets.length;
  }

  /**
   * Batched cross-cutting apply (the component editor's Save-and-apply): view
   * subtree replacements, registry re-bakes and field-tag restamps together as
   * ONE undoable step. Leaves a drilled column first (navigation, not a
   * mutation — the applySnapshot precedent) so the active SURFACE is live and
   * inside snapState. A single Ctrl+Z reverts everything `fn` touched (docs +
   * columnRefs + subtype tags); a no-op `fn` leaves ZERO trace.
   */
  batchProjectUpdate(_touchedColumns: string[], fn: () => void): void {
    if (this.activeDocKey !== 'main') this.openMain();
    const before = this.snapState();
    fn();
    if (this.snapState() === before) return; // no-op: zero trace
    this.pushUndo(before);
    this.emit('document');
    this.emit('data'); // registry/tag changes show up in pickers/tree/gallery
  }

  /** Register a column formatter for `field` (default: the current field) and
   *  open its drill-in — how a standalone column-formatter document (example,
   *  pasted JSON) enters the workspace now that the main surface is always the
   *  floor or a sheet. Registration is ONE undoable step; the drill rides along. */
  loadColumnDocument(root: SPElement, field?: string): void {
    const name = field ?? this.currentFieldName;
    if (this.activeDocKey !== 'main' && this.activeDocKey !== name) this.openMain();
    if (this.activeDocKey === name) {
      this.mutateDocument(() => { this.doc.root = root; });
      this.selection = [];
      this.emit('data');
      return;
    }
    this.mutateDocument(() => { this.columnRefs[name] = root; });
    this.openColumnRef(name);
    this.selection = [];
    this.emit('data');
  }

  /** Register a row/tile document as a NEW named sheet and open it — how
   *  examples and imported view formatters enter the workspace. */
  loadViewDocument(doc: FormatterDocument, name?: string): SheetDoc | null {
    return this.createView(doc, name);
  }

  /**
   * "Apply to canvas": replace whatever is being edited with `doc` — the JSON
   * tab's contract. Routing per surface:
   *   · drilled into a column → that column's tree (any payload kind);
   *   · a sheet up → the sheet's document (kind follows the payload);
   *   · on the floor → a row payload replaces the FLOOR ROOT (kind stays
   *     'grid' — the floor's own export round-trips losslessly), a tile
   *     payload becomes a NEW sheet (a tile can never be a floor), a column
   *     payload registers to the current field and drills in.
   */
  loadDocument(doc: FormatterDocument): void {
    if (this.activeDocKey !== 'main') {
      // the JSON tab edits whichever formatter is on the canvas — a drilled
      // column; emit('load') live-syncs it back into columnRefs (see e2e
      // workspace.spec "CFR round-trip" / grid.spec "header menu formats an
      // unformatted column").
      this.snapshot();
      this.doc = { kind: 'column', root: doc.root };
      this.selection = [];
      this.emit('load');
      return;
    }
    if (this.onFloor) {
      if (doc.kind === 'column') { this.loadColumnDocument(doc.root); return; }
      if (doc.kind === 'tile') { this.createView(doc); return; }
      this.snapshot();
      this.floorDoc.root = doc.root; // 'row'/'grid' payloads: the floor's tree
      if (doc.viewExtras) this.floorDoc.viewExtras = doc.viewExtras;
      else delete this.floorDoc.viewExtras;
      this.selection = [];
      this.emit('load');
      return;
    }
    if (doc.kind === 'column') { this.loadColumnDocument(doc.root); return; }
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
