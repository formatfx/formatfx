/**
 * editor/state.ts — Single store for the editor: formatter document, mock
 * data, selection (by node path), undo/redo, and change notification.
 */

import type {
  FormatterDocument, SPElement, NodePath, MockField, MockRow, PersonValue, DocumentKind,
} from '../core/types';

export type ChangeReason =
  | 'document' | 'selection' | 'data' | 'kind' | 'theme' | 'load';

type Listener = (reason: ChangeReason) => void;

const ME: PersonValue = {
  title: 'Sandbox User', email: 'me@contoso.com', jobTitle: 'Maker', department: 'IT',
};

function defaultDocument(): FormatterDocument {
  // a small showcase workspace: a row-layout view formatter that pulls in
  // registered column formatters via CFRs — demonstrates the mental model
  // (view = layout shell; columns = reusable pieces it references)
  return {
    kind: 'row',
    root: {
      elmType: 'div',
      _elmName: 'Row card',
      attributes: { class: 'ms-bgColor-white sp-css-borderColor-neutralLight' },
      style: {
        'display': 'flex', 'align-items': 'center', 'width': '100%',
        'padding': '10px 14px', 'margin': '4px 0', 'border-radius': '6px',
        'border-width': '1px', 'border-style': 'solid',
        'box-shadow': '0 1.6px 3.6px rgba(0,0,0,.1)',
      },
      children: [
        {
          elmType: 'div',
          _elmName: 'Title block',
          style: { 'display': 'flex', 'flex-direction': 'column', 'flex': '1' },
          children: [
            {
              elmType: 'span', _elmName: 'Title', txtContent: '[$Title]',
              attributes: { class: 'ms-fontColor-neutralPrimary' },
              style: { 'font-size': '14px', 'font-weight': '600', 'margin-bottom': '3px' },
            },
            {
              elmType: 'span',
              _elmName: 'Due date · project',
              txtContent: "='Due '+toLocaleDateString([$DueDate])+' · '+[$Project.lookupValue]",
              attributes: { class: 'ms-fontColor-neutralSecondary' },
              style: { 'font-size': '11px' },
            },
          ],
        },
        { elmType: 'div', _elmName: 'Progress slot', style: { 'width': '130px' }, columnFormatterReference: '[$Progress]' },
        { elmType: 'div', _elmName: 'Status slot', style: { 'margin-left': '12px' }, columnFormatterReference: '[$Status]' },
      ],
    },
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
  /** Which formatter is on the canvas: 'main' or a columnRefs key. */
  activeDocKey = 'main';
  private mainDocStash: FormatterDocument | null = null;
  private mainFieldStash: string | null = null;
  selection: NodePath | null = [];
  themeMode: 'light' | 'dark' = 'light';
  /** Tenant theme palette overrides (token → hex), or null for stock Fluent. */
  customTheme: Record<string, string> | null = null;
  me: PersonValue = ME;

  private listeners: Listener[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saveTimer = 0;

  subscribe(fn: Listener): void { this.listeners.push(fn); }

  emit(reason: ChangeReason): void {
    // keep the registry live while a column formatter is being edited, so
    // CFRs in the main formatter pick up edits the moment you switch back
    if (this.activeDocKey !== 'main' && (reason === 'document' || reason === 'load')) {
      this.columnRefs[this.activeDocKey] = this.doc.root;
    }
    for (const fn of this.listeners) fn(reason);
    if (reason !== 'selection') this.scheduleAutosave();
  }

  // ─── Workspace: main formatter ⇄ column formatters ─────────────────────────

  /** Write the active document back into its slot. */
  private flushActiveDoc(): void {
    if (this.activeDocKey !== 'main') {
      this.columnRefs[this.activeDocKey] = this.doc.root;
    }
  }

  /** Open a registered column formatter for editing. */
  openColumnRef(name: string): void {
    if (!(name in this.columnRefs) || this.activeDocKey === name) return;
    this.flushActiveDoc();
    if (this.activeDocKey === 'main') {
      this.mainDocStash = this.doc;
      this.mainFieldStash = this.currentFieldName;
    }
    this.doc = { kind: 'column', root: this.columnRefs[name] };
    this.activeDocKey = name;
    // @currentField inside a column formatter is that column
    if (this.fields.some((f) => f.name === name)) this.currentFieldName = name;
    this.selection = [];
    this.undoStack = []; // undo history is per-document
    this.redoStack = [];
    this.emit('load');
    this.emit('data');
  }

  /** Return to the main (row/view/column) formatter. */
  openMain(): void {
    if (this.activeDocKey === 'main') return;
    this.flushActiveDoc();
    this.doc = this.mainDocStash ?? this.doc;
    this.mainDocStash = null;
    this.activeDocKey = 'main';
    if (this.mainFieldStash) {
      this.currentFieldName = this.mainFieldStash;
      this.mainFieldStash = null;
    }
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.emit('load');
    this.emit('data');
  }

  /** Human label for the main document, e.g. "View formatter (row layout)". */
  mainDocLabel(): string {
    const d = this.activeDocKey === 'main' ? this.doc : this.mainDocStash ?? this.doc;
    const field = this.activeDocKey === 'main' ? this.currentFieldName : this.mainFieldStash ?? this.currentFieldName;
    switch (d.kind) {
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
        out.add(el.columnFormatterReference.replace(/^\[\$?/, '').replace(/\]$/, '').replace(/^\$/, ''));
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
    this.activeDocKey = 'main';
    this.mainDocStash = null;
    this.mainFieldStash = null;
    if (p.themeMode === 'light' || p.themeMode === 'dark') this.themeMode = p.themeMode;
    this.customTheme = (p.customTheme && typeof p.customTheme === 'object') ? p.customTheme : null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
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
    this.activeDocKey = 'main';
    this.mainDocStash = null;
    this.mainFieldStash = null;
    this.customTheme = null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.emit('load');
    this.emit('data');
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  private saveNow(): void {
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
    this.undoStack.push(JSON.stringify({ doc: this.doc }));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify({ doc: this.doc }));
    this.doc = JSON.parse(prev).doc;
    this.clampSelection();
    this.emit('document');
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify({ doc: this.doc }));
    this.doc = JSON.parse(next).doc;
    this.clampSelection();
    this.emit('document');
  }

  private clampSelection(): void {
    if (this.selection && !this.nodeAt(this.selection)) this.selection = [];
  }

  select(path: NodePath | null): void {
    this.selection = path;
    this.emit('selection');
  }

  mutateDocument(fn: () => void): void {
    this.snapshot();
    fn();
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
    this.snapshot();
    this.doc.kind = kind;
    if (kind === 'tile') {
      this.doc.tileWidth = this.doc.tileWidth ?? 254;
      this.doc.tileHeight = this.doc.tileHeight ?? 220;
    }
    this.emit('kind');
  }

  loadDocument(doc: FormatterDocument): void {
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
