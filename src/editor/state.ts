/**
 * editor/state.ts — Single store for the editor: formatter document, mock
 * data, selection (by node path), undo/redo, and change notification.
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
  setAreaWeight as applyAreaWeight, setRowDensity as applyRowDensity,
  type AreaWeight, type RowDensity,
} from './areas';
import {
  snapshotId, defaultLabel,
  type Snapshot, type SnapshotScope,
} from './snapshots';

export type ChangeReason =
  | 'document' | 'selection' | 'data' | 'kind' | 'theme' | 'load' | 'lens';

/** The Left Edit Pane's three interaction lenses (progressive disclosure). */
export type EditorLens = 'simple' | 'pro' | 'code';

type Listener = (reason: ChangeReason) => void;

const ME: PersonValue = {
  title: 'Sandbox User', email: 'me@contoso.com', jobTitle: 'Maker', department: 'IT',
};

function defaultDocument(): FormatterDocument {
  // the grid-first workspace: the preview pane starts as a Microsoft-Lists
  // style grid — one column per view column, each rendered with its current
  // formatter (Status/Progress arrive formatted; Owner stays registered but
  // unplaced so "+ column" demonstrates adding an already-formatted column).
  // Dragging one column header onto another generates the row-formatter
  // scaffolding — the on-ramp from "I know grids" to row formatting.
  return {
    kind: 'grid',
    root: buildGridRoot(defaultFields(), defaultColumnRefs(),
      ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']),
  };
}

/** Showcase column formatters — referenced by the default view (Owner is registered but unused, on purpose). */
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

export class EditorState {
  doc: FormatterDocument = defaultDocument();
  fields: MockField[] = defaultFields();
  rows: MockRow[] = defaultRows();
  /** Field the column formatter targets (@currentField). */
  currentFieldName = 'Status';
  /** Registered column formatters for columnFormatterReference resolution: field name → tree. */
  columnRefs: Record<string, SPElement> = defaultColumnRefs();
  /** Views captured by a List Snapshot import (formatters kept as raw text). */
  importedViews: ImportedView[] = [];
  /** Which formatter is on the canvas: 'main' or a columnRefs key. */
  activeDocKey = 'main';
  /** The view's editable name — project metadata, travels with Save/Open. */
  viewName = 'View 1';
  private mainDocStash: FormatterDocument | null = null;
  private mainFieldStash: string | null = null;
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
  private docUndoStash: Record<string, string[]> = {};
  private docRedoStash: Record<string, string[]> = {};
  private docSavepointStash: Record<string, string | null> = {};
  private columnRefVersions: Record<string, number> = {};
  private docSelectionStash: Record<string, NodePath[]> = {};
  private inMutateDocument = false;

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
    // CFRs in the main formatter pick up edits the moment you switch back
    if (this.activeDocKey !== 'main' && (reason === 'document' || reason === 'load')) {
      this.columnRefs[this.activeDocKey] = this.doc.root;
    }
    if (this.activeDocKey !== 'main' && (reason === 'document' || reason === 'kind') && !this.inMutateDocument) {
      this.incrementColumnVersion(this.activeDocKey);
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

  /** Mark the live document as the Save checkpoint (the Save button / first load). */
  markSavepoint(): void { this._savepoint = this.snapState(); }

  /** Whether there are unsaved mutations since the last Save checkpoint. */
  get isDirtySinceSave(): boolean {
    if (this._savepoint == null) return false;
    const clean = (snap: string) => {
      const parsed = JSON.parse(snap);
      delete parsed.selections;
      delete parsed.refs;
      delete parsed.refVersions;
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
    this.emit('document');
    this.emit('selection');
  }

  // ─── Workspace: main formatter ⇄ column formatters ─────────────────────────

  /** Write the active document back into its slot. */
  private flushActiveDoc(): void {
    if (this.activeDocKey !== 'main') {
      this.columnRefs[this.activeDocKey] = this.doc.root;
    }
  }

  /**
   * Navigation history — the "oops, how did I get here" stack. Every doc
   * switch (openMain/openColumnRef) pushes where you WERE; goBack() retraces.
   * Pure navigation state: not undo, not persisted, capped small.
   */
  private navStack: string[] = [];

  private pushNav(): void {
    if (this.navStack[this.navStack.length - 1] === this.activeDocKey) return;
    this.navStack.push(this.activeDocKey);
    if (this.navStack.length > 50) this.navStack.shift();
  }

  /** Where goBack() would land ('main' or a column name), or null if nowhere.
   *  Skips column keys that have since been unregistered. */
  get backTarget(): string | null {
    for (let i = this.navStack.length - 1; i >= 0; i--) {
      const key = this.navStack[i];
      if (key === this.activeDocKey) continue;
      if (key === 'main' || Object.hasOwn(this.columnRefs, key)) return key;
    }
    return null;
  }

  /** Retrace the last doc switch. Returns where it landed, or null. */
  goBack(): string | null {
    const target = this.backTarget;
    if (target === null) return null;
    // drop everything above (and including) the entry we're landing on, so
    // repeated Back keeps walking down the trail instead of ping-ponging
    for (let i = this.navStack.length - 1; i >= 0; i--) {
      if (this.navStack[i] === target) { this.navStack.length = i; break; }
    }
    this.inGoBack = true;
    try {
      if (target === 'main') this.openMain();
      else this.openColumnRef(target);
    } finally {
      this.inGoBack = false;
    }
    return target;
  }

  private inGoBack = false;

  /** Open a registered column formatter for editing. */
  openColumnRef(name: string): void {
    // own-key check: `in` would also match prototype members ('toString', …),
    // and a registry read on such a name must never open a "formatter"
    if (!Object.hasOwn(this.columnRefs, name) || this.activeDocKey === name) return;
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();
    if (this.activeDocKey === 'main') {
      this.mainDocStash = this.doc;
      this.mainFieldStash = this.currentFieldName;
    }
    // Stash current activeDocKey's stacks, savepoint, and selections
    this.docUndoStash[this.activeDocKey] = this.undoStack;
    this.docRedoStash[this.activeDocKey] = this.redoStack;
    this.docSavepointStash[this.activeDocKey] = this._savepoint;
    this.docSelectionStash[this.activeDocKey] = this._selections;

    this.doc = { kind: 'column', root: this.columnRefs[name] };
    this.activeDocKey = name;
    // @currentField inside a column formatter is that column
    if (this.fields.some((f) => f.name === name)) this.currentFieldName = name;

    // Restore new activeDocKey's selections, stacks, and savepoint
    this._selections = this.docSelectionStash[name] ?? [[]];
    this.undoStack = this.docUndoStash[name] ?? [];
    this.redoStack = this.docRedoStash[name] ?? [];
    if (name in this.docSavepointStash) {
      this._savepoint = this.docSavepointStash[name];
    } else {
      this.markSavepoint();
    }
    this.emit('load');
    this.emit('data');
  }

  /** Return to the main (row/view/column) formatter. */
  openMain(): void {
    if (this.activeDocKey === 'main') return;
    if (!this.inGoBack) this.pushNav();
    this.flushActiveDoc();

    // Stash current activeDocKey's stacks, savepoint, and selections
    this.docUndoStash[this.activeDocKey] = this.undoStack;
    this.docRedoStash[this.activeDocKey] = this.redoStack;
    this.docSavepointStash[this.activeDocKey] = this._savepoint;
    this.docSelectionStash[this.activeDocKey] = this._selections;

    this.doc = this.mainDocStash ?? this.doc;
    this.mainDocStash = null;
    this.activeDocKey = 'main';
    if (this.mainFieldStash) {
      this.currentFieldName = this.mainFieldStash;
      this.mainFieldStash = null;
    }

    // Restore main's selections, stacks, and savepoint
    this._selections = this.docSelectionStash['main'] ?? [[]];
    this.undoStack = this.docUndoStash['main'] ?? [];
    this.redoStack = this.docRedoStash['main'] ?? [];
    if ('main' in this.docSavepointStash) {
      this._savepoint = this.docSavepointStash['main'];
    } else {
      this.markSavepoint();
    }
    this.emit('load');
    this.emit('data');
  }

  /** The main (view) formatter root, even while drilled into a column style —
   *  scope/blast-radius calculations need it and mainDocStash is private. */
  get mainRootForScope(): SPElement | undefined {
    return this.activeDocKey === 'main' ? this.doc.root : this.mainDocStash?.root;
  }

  /** Rename the view. Project metadata, not a formatter edit — deliberately
   *  off the undo stack; emits 'data' so the document dropdown + menus refresh and
   *  the change autosaves. */
  setViewName(name: string): void {
    this.viewName = name.trim() || 'View 1';
    this.emit('data');
  }

  /** Human label for the main document, e.g. "View formatter (row layout)". */
  mainDocLabel(): string {
    const d = this.activeDocKey === 'main' ? this.doc : this.mainDocStash ?? this.doc;
    const field = this.activeDocKey === 'main' ? this.currentFieldName : this.mainFieldStash ?? this.currentFieldName;
    switch (d.kind) {
      case 'grid': return 'View formatter — grid';
      case 'row': return 'View formatter — row layout';
      case 'tile': return 'View formatter — tile/gallery';
      default: return `Column formatter on [$${field}]`;
    }
  }

  /** Column names the main formatter references via columnFormatterReference. */
  referencedColumns(): Set<string> {
    const out = new Set<string>();
    const root = this.activeDocKey === 'main' ? this.doc.root : this.mainDocStash?.root;
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

  // ─── Project persistence ───────────────────────────────────────────────────

  static readonly STORAGE_KEY = 'list-formatting-sandbox.project.v1';

  serializeProject(): string {
    this.flushActiveDoc();
    return JSON.stringify({
      version: 1,
      doc: this.activeDocKey === 'main' ? this.doc : this.mainDocStash ?? this.doc,
      fields: this.fields,
      rows: this.rows,
      currentFieldName: this.activeDocKey === 'main' ? this.currentFieldName : this.mainFieldStash ?? this.currentFieldName,
      columnRefs: this.columnRefs,
      // additive keys — older builds simply ignore them (no version bump)
      viewName: this.viewName,
      ...(this.importedViews.length ? { importedViews: this.importedViews } : {}),
      themeMode: this.themeMode,
      customTheme: this.customTheme,
    }, null, 2);
  }

  loadProject(text: string): void {
    const p = JSON.parse(text);
    if (!p || typeof p !== 'object' || !p.doc?.root?.elmType || !Array.isArray(p.fields) || !Array.isArray(p.rows)) {
      throw new Error('Not a sandbox project file (expected doc/fields/rows).');
    }
    this.doc = p.doc;
    this.fields = p.fields;
    this.rows = p.rows;
    this.currentFieldName = typeof p.currentFieldName === 'string' ? p.currentFieldName : this.fields[0]?.name ?? 'Title';
    this.columnRefs = (p.columnRefs && typeof p.columnRefs === 'object') ? p.columnRefs : {};
    this.viewName = (typeof p.viewName === 'string' && p.viewName.trim()) || 'View 1';
    this.importedViews = Array.isArray(p.importedViews) ? p.importedViews : [];
    this.activeDocKey = 'main';
    this.mainDocStash = null;
    this.mainFieldStash = null;
    if (p.themeMode === 'light' || p.themeMode === 'dark') this.themeMode = p.themeMode;
    this.customTheme = (p.customTheme && typeof p.customTheme === 'object') ? p.customTheme : null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.docUndoStash = {};
    this.docRedoStash = {};
    this.docSavepointStash = {};
    this.columnRefVersions = {};
    this.docSelectionStash = {};
    this.navStack = [];
    this.markSavepoint();
    this.emit('load');
    this.emit('data');
  }

  /** Restore the autosaved project, if any. Returns true when restored. */
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
    this.doc = defaultDocument();
    this.fields = defaultFields();
    this.rows = defaultRows();
    this.currentFieldName = 'Status';
    this.columnRefs = defaultColumnRefs();
    this.viewName = 'View 1';
    this.importedViews = [];
    this.activeDocKey = 'main';
    this.mainDocStash = null;
    this.mainFieldStash = null;
    this.customTheme = null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.docUndoStash = {};
    this.docRedoStash = {};
    this.docSavepointStash = {};
    this.columnRefVersions = {};
    this.docSelectionStash = {};
    this.navStack = [];
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

  /** The undo snapshot: the document, the per-field subtype tags, AND the
   *  registered column formatters. Tags ride along so an apply
   *  (applyColumnSubtype) reverts its field tag on the same undo step; the
   *  registry rides along so a push-update (pushSubtypeUpdate, US-7) — which
   *  overwrites columnRefs and changes no document node — is one undoable batch.
   *  Structural field edits (add/remove/type, via the data panel) deliberately
   *  live outside undo, so a later field edit is never clobbered by an unrelated
   *  doc undo. */
  private snapState(): string {
    return JSON.stringify({
      doc: this.doc,
      tags: this.subtypeTags(),
      refs: this.columnRefs,
      refVersions: this.columnRefVersions,
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

  private incrementColumnVersion(name: string): void {
    this.columnRefVersions[name] = (this.columnRefVersions[name] ?? 0) + 1;
  }

  private restoreSnap(snap: string): void {
    const parsed = JSON.parse(snap) as {
      doc: FormatterDocument;
      tags?: Record<string, { subtype?: string; subtypeArgs?: Record<string, string | number | boolean> }>;
      refs?: Record<string, SPElement>;
      refVersions?: Record<string, number>;
      selections?: NodePath[];
    };
    this.doc = parsed.doc;
    if (parsed.refs) {
      const refVersions = parsed.refVersions ?? {};
      const nextRefs: Record<string, SPElement> = {};
      for (const name of Object.keys(parsed.refs)) {
        const currVer = this.columnRefVersions[name] ?? 0;
        const snapVer = refVersions[name] ?? 0;
        if (name === this.activeDocKey || currVer <= snapVer) {
          nextRefs[name] = parsed.refs[name];
        } else {
          if (name in this.columnRefs) {
            nextRefs[name] = this.columnRefs[name];
          }
        }
      }
      for (const name of Object.keys(this.columnRefs)) {
        if (!(name in nextRefs)) {
          const currVer = this.columnRefVersions[name] ?? 0;
          const snapVer = refVersions[name] ?? 0;
          if (name === this.activeDocKey || currVer > snapVer) {
            nextRefs[name] = this.columnRefs[name];
          }
        }
      }
      this.columnRefs = nextRefs;
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
    this.restoreSnap(prev);
    this.clampSelection();
    this.emit('document');
    this.emit('selection');
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapState());
    this.restoreSnap(next);
    this.clampSelection();
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
    // the document or its subtype tags — a no-op gesture (rename to the same
    // value, arrow-step that re-commits the current value on blur) must not push
    // a phantom undo step.
    const before = this.snapState();
    this.inMutateDocument = true;
    try {
      fn();
    } finally {
      this.inMutateDocument = false;
    }
    if (this.snapState() === before) return;
    if (this.activeDocKey !== 'main') {
      this.incrementColumnVersion(this.activeDocKey);
    }
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

  setKind(kind: DocumentKind): void {
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
  // A grid is a row formatter in embryo; "make a row view" graduates it to an
  // explicit row layout whose columns are weighted areas. Each call is ONE
  // undoable document mutation, like every other grid gesture.

  /** Graduate the grid to a row view. `indices` curates which columns become
   *  areas (in the given order); omit for all. The chosen kind is 'row' or
   *  'tile' — tile is an explicit pick (it can never emerge from structure). */
  makeRowView(indices?: number[], kind: 'row' | 'tile' = 'row'): void {
    if (this.doc.kind !== 'grid') { this.setKind(kind); return; }
    this.snapshot();
    this.doc.root = buildRowView(this.doc.root, indices, rowDensityOf(this.doc.root));
    this.doc.kind = kind;
    if (kind === 'tile') {
      this.doc.tileWidth = this.doc.tileWidth ?? 254;
      this.doc.tileHeight = this.doc.tileHeight ?? 220;
    }
    this.selection = [];
    this.emit('kind');
  }

  /** Apply a pre-built row template: replace the row formatter body, switch to
   *  'row', and set/clear the zebra wrapper class — as ONE undoable mutation
   *  (snapState captures the whole doc), mirroring makeRowView. Other viewExtras
   *  (footerFormatter, commandBarProps, groupProps, …) are preserved. */
  applyRowTemplate(root: SPElement, additionalRowClass?: string): void {
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

  /** Set one area's weight (Normal/Wide/Widest). Conflict-free — only the
   *  named area's flex changes; neighbors keep theirs (CSS-fr semantics). */
  setAreaWeight(path: NodePath, weight: AreaWeight): void {
    const el = this.nodeAt(path);
    if (!el) return;
    this.mutateDocument(() => applyAreaWeight(el, weight));
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
    this.incrementColumnVersion(field);
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
  // doc AND the registry, so even "restore everything" is a single Ctrl+Z).

  /** The main (view) document, stash-aware — whole doc, not just the root. */
  private mainDocForScope(): FormatterDocument {
    return this.activeDocKey === 'main' ? this.doc : this.mainDocStash ?? this.doc;
  }

  /** Capture what `scope` describes right now, or null if there's nothing to
   *  capture (e.g. a column scope naming an unregistered, un-open column). */
  captureSnapshot(scope: SnapshotScope, now: Date = new Date()): Snapshot | null {
    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    let payload: Snapshot['payload'] | null = null;
    if (scope.kind === 'view') {
      payload = { doc: clone(this.mainDocForScope()) };
    } else if (scope.kind === 'column') {
      // the open column's live tree wins; then the registry (own keys only —
      // 'toString' etc. must not read as a formatter); then the
      // main-document-is-a-column edge (e.g. a loaded column example)
      const root = this.activeDocKey === scope.field
        ? this.doc.root
        : (Object.hasOwn(this.columnRefs, scope.field) ? this.columnRefs[scope.field] : undefined)
          ?? (this.activeDocKey === 'main' && this.doc.kind === 'column' && this.currentFieldName === scope.field
            ? this.doc.root : undefined);
      if (!root) return null;
      payload = { root: clone(root) };
    } else {
      // read-only capture: overlay the open column's live tree on a CLONE of
      // the registry instead of flushing it back into editor state
      const refs = clone(this.columnRefs);
      if (this.activeDocKey !== 'main') refs[this.activeDocKey] = clone(this.doc.root);
      payload = {
        all: { doc: clone(this.mainDocForScope()), columnRefs: refs, viewName: this.viewName },
      };
    }
    return {
      id: snapshotId(now),
      takenAt: now.toISOString(),
      label: defaultLabel(scope, this.viewName, this.mainDocForScope().kind),
      scope,
      payload,
    };
  }

  /** Restore a snapshot as ONE undoable step. Returns false if the payload
   *  doesn't match its scope (corrupt store) — nothing is touched then. */
  applySnapshot(snap: Snapshot): boolean {
    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    if (snap.scope.kind === 'column') {
      const root = snap.payload.root;
      if (!root) return false;
      const field = snap.scope.field;
      const restored = clone(root);
      if (this.activeDocKey === field) {
        // open on the canvas — emit('document') live-syncs the registry
        this.mutateDocument(() => { this.doc.root = restored; });
      } else if (Object.hasOwn(this.columnRefs, field)) {
        this.incrementColumnVersion(field);
        this.mutateDocument(() => { this.columnRefs[field] = restored; });
      } else if (this.activeDocKey === 'main' && this.doc.kind === 'column' && this.currentFieldName === field) {
        this.mutateDocument(() => { this.doc.root = restored; });
      } else {
        // unregistered and not open: register it (the snapshot is the format)
        this.incrementColumnVersion(field);
        this.mutateDocument(() => { this.columnRefs[field] = restored; });
      }
      this.selection = [];
      this.emit('data'); // tree/gallery/grid pick up the registry change
      return true;
    }
    // view / all replace the MAIN document — leave a drilled column first
    // (navigation, not a mutation; it also feeds the Back trail)
    if (snap.scope.kind === 'view') {
      if (!snap.payload.doc) return false;
      if (this.activeDocKey !== 'main') this.openMain();
      const restored = clone(snap.payload.doc);
      const before = this.snapState();
      this.doc = restored;
      if (this.snapState() !== before) this.pushUndo(before);
      this.selection = [];
      this.emit('kind'); // kind may have changed; canvas + kind select follow
      return true;
    }
    const all = snap.payload.all;
    if (!all) return false;
    if (this.activeDocKey !== 'main') this.openMain();
    for (const name of new Set([...Object.keys(this.columnRefs), ...Object.keys(all.columnRefs)])) {
      this.incrementColumnVersion(name);
    }
    const before = this.snapState();
    this.doc = clone(all.doc);
    this.columnRefs = clone(all.columnRefs);
    if (this.snapState() !== before) this.pushUndo(before);
    // the view name is project metadata — restored, but off the undo stack
    // (same rule as setViewName)
    this.viewName = all.viewName;
    this.selection = [];
    this.emit('kind');
    this.emit('data');
    return true;
  }

  // ─── Column subtypes: snapshot apply ───────────────────────────────────────

  /** Apply a subtype to a column as ONE undoable mutation: register the
   *  already-baked formatter, tag the field (subtype id + baked args), and
   *  CFR-wire the grid cell so the grid renders it — ALL inside the snapshot
   *  (snapState captures the registry + tags + doc), so a single undo reverts
   *  the render, the tag, AND the registry entry. This makes even a re-apply
   *  over an already-CFR cell fully reversible (no lingering/mismatched entry).
   *  Stays on the grid (no doc switch — that would clear the undo stack and
   *  defeat Ctrl+Z). */
  applyColumnSubtype(
    fieldName: string,
    baked: SPElement,
    subtypeId: string,
    args: Record<string, string | number | boolean>,
    path: NodePath,
  ): void {
    const field = this.fields.find((f) => f.name === fieldName);
    if (!field) return;
    this.incrementColumnVersion(fieldName);
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
    for (const f of targets) {
      this.incrementColumnVersion(f.name);
    }
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
   * mutation — the applySnapshot precedent) so the MAIN doc is live and inside
   * snapState, and bumps `touchedColumns`' versions so the registry rewrites
   * survive restoreSnap's merge. `fn` runs inside one mutateDocument: a single
   * Ctrl+Z reverts everything it touched (doc + columnRefs + subtype tags),
   * and a no-op `fn` pushes nothing.
   */
  batchProjectUpdate(touchedColumns: string[], fn: () => void): void {
    if (this.activeDocKey !== 'main') this.openMain();
    for (const name of touchedColumns) this.incrementColumnVersion(name);
    this.mutateDocument(fn);
    this.emit('data'); // registry/tag changes show up in pickers/tree/gallery
  }

  loadDocument(doc: FormatterDocument): void {
    // NOTE: when a column formatter is open, this intentionally applies to that
    // open doc — the JSON tab's "Apply to canvas" edits whichever formatter is
    // on the canvas, and emit('load') live-syncs it back into columnRefs. That
    // is the JSON-edit-a-column path (see e2e workspace.spec "CFR round-trip" /
    // grid.spec "header menu formats an unformatted column"). Callers that mean
    // "replace the MAIN doc" (e.g. schema import) call openMain() first.
    this.snapshot();
    this.doc = doc;
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
