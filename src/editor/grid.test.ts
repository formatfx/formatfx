/**
 * Grid-first workspace under the model-B migration (COLUMNS-COMPONENTS-VIEWS):
 * scaffold generation (pure — cells EMBED clones of column looks and carry
 * `_field` identity; no columnFormatterReference exists), the grid mutations
 * (each ONE undoable document step — a roadmap contract), the gridView header
 * surface (the slimmed menu + ⬡ component drops that apply a look), and the
 * wrapper semantics (a grid is a row formatter in embryo).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildGridRoot, gridCellForField, defaultColumnFormatter,
  gridColumnField, gridColumnLabel, groupName, isPureGrid, unplacedFields,
} from './gridScaffold';
import { renderGrid, gridColumnForField } from './gridView';
import { COMPONENT_MIME } from './componentLibrary';
import { EditorState, state } from './state';
import { exportJson } from '../core/serializer';
import { renderElement } from '../core/renderer';
import type { EvalContext } from '../core/expressions';
import type { MockField, SPElement } from '../core/types';

const FIELDS: MockField[] = [
  { name: 'Title', type: 'text' },
  { name: 'Status', type: 'choice', choices: ['A', 'B'] },
  { name: 'DueDate', type: 'date' },
  { name: 'AssignedTo', type: 'personMulti' },
  { name: 'Project', type: 'lookup', lookup: { list: 'Projects', column: 'Title' } },
  { name: 'Done', type: 'boolean' },
  { name: 'Link', type: 'hyperlink' },
  { name: 'ID', type: 'number', protected: true },
];

/** A baked LOOK, the way state.columnLooks stores one: a bound component
 *  instance in explicit-[$Field] dialect, root stamped `_component`. */
const STATUS_LOOK: SPElement = {
  elmType: 'div',
  _elmName: 'Status pill',
  txtContent: '[$Status]',
  style: { 'border-radius': '12px', 'padding': '2px 10px' },
  _component: { id: 'c-pill', map: { Status: 'Status' } },
};

/** A MULTI-COLUMN look worn by Status: its tree references DueDate too —
 *  the cell still IS the Status column (`_field` is the identity). */
const DEADLINE_LOOK: SPElement = {
  elmType: 'div',
  _elmName: 'Deadline pair',
  children: [
    { elmType: 'span', txtContent: '[$Status]' },
    { elmType: 'span', txtContent: '=toLocaleDateString([$DueDate])' },
  ],
  _component: { id: 'c-pair', map: { Status: 'Status', DueDate: 'DueDate' } },
};

const LOOKS: Record<string, SPElement> = { Status: STATUS_LOOK };

function ctx(row: Record<string, unknown>): EvalContext {
  return {
    row: row as EvalContext['row'],
    rowIndex: 0,
    currentFieldName: 'Status',
    me: { title: 'Me', email: 'me@x.com' },
    iterators: {},
    iteratorIndex: {},
    displayNames: {},
    now: new Date(),
  };
}

describe('grid scaffolding', () => {
  it('buildGridRoot: a named flex row, one _field-stamped child per field, looks embedded where stored', () => {
    const root = buildGridRoot(FIELDS, LOOKS, ['Title', 'Status', 'DueDate']);
    expect(root._elmName).toBe('Row layout');
    expect(root.style?.display).toBe('flex');
    expect(root.children?.map((c) => c._field)).toEqual(['Title', 'Status', 'DueDate']);
    expect(root.children?.[0].txtContent).toBe('[$Title]');
    // the Status cell IS the look — embedded, stamp intact, no reference element
    expect(root.children?.[1]._component).toEqual({ id: 'c-pill', map: { Status: 'Status' } });
    expect(root.children?.[1].txtContent).toBe('[$Status]');
    expect(root.children?.[2].txtContent).toBe('=toLocaleDateString([$DueDate])');
    // the retired reference channel must never be emitted
    expect(JSON.stringify(root)).not.toContain('columnFormatterReference');
  });

  it('buildGridRoot default: every non-protected field, schema order', () => {
    const root = buildGridRoot(FIELDS, LOOKS);
    expect(root.children?.map((c) => c._field))
      .toEqual(['Title', 'Status', 'DueDate', 'AssignedTo', 'Project', 'Done', 'Link']);
  });

  it('plain cells are faithful per field type and actually evaluate', () => {
    const byName = Object.fromEntries(FIELDS.map((f) => [f.name, f]));
    expect(gridCellForField(byName.AssignedTo, {}).txtContent).toBe("=join([$AssignedTo.title],', ')");
    expect(gridCellForField(byName.Project, {}).txtContent).toBe('[$Project.lookupValue]');
    expect(gridCellForField(byName.Done, {}).txtContent).toBe("=if([$Done],'Yes','No')");
    const link = gridCellForField(byName.Link, {});
    expect(link.elmType).toBe('a');
    expect(link.attributes?.href).toBe('[$Link]');
    // a plain cell is named after its field and stamped with its identity
    expect(link._elmName).toBe('Link');
    expect(link._field).toBe('Link');

    const node = renderElement(gridCellForField(byName.AssignedTo, {}), ctx({
      AssignedTo: [{ title: 'Ada', email: 'a@x' }, { title: 'Grace', email: 'g@x' }],
    }));
    expect(node.textContent).toBe('Ada, Grace');
    const done = renderElement(gridCellForField(byName.Done, {}), ctx({ Done: true }));
    expect(done.textContent).toBe('Yes');
  });

  it('gridCellForField EMBEDS a clone of the look: stamp kept, layout styles merged, never an alias', () => {
    const byName = Object.fromEntries(FIELDS.map((f) => [f.name, f]));
    const cell = gridCellForField(byName.Status, LOOKS);
    // identity + provenance both ride the cell
    expect(cell._field).toBe('Status');
    expect(cell._component).toEqual({ id: 'c-pill', map: { Status: 'Status' } });
    // the look's own name survives (the COLUMN header names the column instead)
    expect(cell._elmName).toBe('Status pill');
    // the cell's layout styles are MERGED onto the look's own styles
    expect(cell.style).toEqual({
      'border-radius': '12px', 'padding': '2px 10px', 'flex': '1', 'min-width': '0',
    });
    // …and the STORED look is untouched by the merge
    expect(STATUS_LOOK.style).toEqual({ 'border-radius': '12px', 'padding': '2px 10px' });
    // a clone, not an alias: editing the cell never reaches the store
    cell.txtContent = 'MUTATED';
    cell.style!['padding'] = '99px';
    expect(STATUS_LOOK.txtContent).toBe('[$Status]');
    expect(STATUS_LOOK.style!['padding']).toBe('2px 10px');
  });

  it('a nameless look borrows the field label; explicit display names win', () => {
    const fields: MockField[] = [{ name: 'Status', displayName: 'Stage', type: 'choice' }];
    const cell = gridCellForField(fields[0], { Status: { elmType: 'div', txtContent: '[$Status]' } });
    expect(cell._elmName).toBe('Stage');
    expect(cell._field).toBe('Status');
  });

  it('defaultColumnFormatter swaps field refs for @currentField (dotted too) and renders', () => {
    const byName = Object.fromEntries(FIELDS.map((f) => [f.name, f]));
    expect(defaultColumnFormatter(byName.Status).txtContent).toBe('@currentField');
    expect(defaultColumnFormatter(byName.DueDate).txtContent).toBe('=toLocaleDateString(@currentField)');
    expect(defaultColumnFormatter(byName.AssignedTo).txtContent).toBe("=join(@currentField.title,', ')");
    expect(defaultColumnFormatter(byName.Status)._elmName).toBe('Status formatter');

    const node = renderElement(defaultColumnFormatter(byName.Status), ctx({ Status: 'Blocked' }));
    expect(node.textContent).toBe('Blocked');
  });

  it('gridColumnField: the _field stamp wins — a multi-column look still IS one column', () => {
    const byName = Object.fromEntries(FIELDS.map((f) => [f.name, f]));
    // the embedded look references Status AND DueDate; identity stays Status
    const cell = gridCellForField(byName.Status, { Status: DEADLINE_LOOK });
    expect(cell._field).toBe('Status');
    expect(gridColumnField(cell)).toBe('Status');
    // a hand-built cell stays column-ish while it references exactly one field
    expect(gridColumnField({ elmType: 'div', txtContent: '=toLocaleDateString([$DueDate])' })).toBe('DueDate');
    // an unstamped composite referencing two fields is no column
    expect(gridColumnField({
      elmType: 'div',
      children: [
        { elmType: 'span', txtContent: '[$Status]' },
        { elmType: 'span', txtContent: '[$DueDate]' },
      ],
    })).toBeNull();
  });

  it("gridColumnLabel: the COLUMN's name beats the look's _elmName; composites fall back", () => {
    const fields: MockField[] = [{ name: 'Title', displayName: 'Task name', type: 'text' }];
    // a look cell keeps its own _elmName — the header still names the COLUMN
    const lookCell = gridCellForField(fields[0], { Title: { elmType: 'div', _elmName: 'My pill', txtContent: '[$Title]' } });
    expect(lookCell._elmName).toBe('My pill');
    expect(gridColumnLabel(lookCell, fields)).toBe('Task name');
    expect(gridColumnLabel({ elmType: 'div', txtContent: '[$Title]' }, fields)).toBe('Task name');
    // an unknown field name is still shown honestly
    expect(gridColumnLabel({ elmType: 'div', _field: 'Ghost' }, fields)).toBe('Ghost');
    // no field at all: _elmName, then a typed placeholder
    expect(gridColumnLabel({ elmType: 'div', _elmName: 'My group', children: [] }, fields)).toBe('My group');
    expect(gridColumnLabel({ elmType: 'span' }, fields)).toBe('<span>');
  });

  it('group naming follows the roadmap contract', () => {
    expect(groupName('Status', 'DueDate')).toBe('Status + DueDate group');
  });

  it('isPureGrid and unplacedFields gate rebuilds and the "+ column" menu', () => {
    const root = buildGridRoot(FIELDS, LOOKS, ['Title', 'Status']);
    expect(isPureGrid(root)).toBe(true);
    expect(unplacedFields(root, FIELDS).map((f) => f.name))
      .toEqual(['DueDate', 'AssignedTo', 'Project', 'Done', 'Link', 'ID']);
    // grouping makes it impure — schema import must keep hands off
    root.children = [{
      elmType: 'div', _elmName: 'Status + DueDate group',
      children: [root.children![1], { elmType: 'div', txtContent: '[$DueDate]' }],
    }, root.children![0]];
    expect(isPureGrid(root)).toBe(false);
  });

  it('unplacedFields: a multi-column look does not "place" its other referenced fields', () => {
    // Status wears a look that references DueDate — DueDate is still unplaced
    const root = buildGridRoot(FIELDS, { Status: DEADLINE_LOOK }, ['Title', 'Status']);
    expect(unplacedFields(root, FIELDS).map((f) => f.name)).toContain('DueDate');
    // …but a COMPOSITE (a group, no _field) places every field it references
    root.children!.push({
      elmType: 'div', _elmName: 'Done + Link group',
      children: [
        { elmType: 'span', txtContent: '[$Done]' },
        { elmType: 'span', txtContent: '[$Link]' },
      ],
    });
    const after = unplacedFields(root, FIELDS).map((f) => f.name);
    expect(after).not.toContain('Done');
    expect(after).not.toContain('Link');
    expect(after).toContain('DueDate');
  });
});

describe('grid document mutations (one undo step each)', () => {
  function gridState(): EditorState {
    const s = new EditorState();
    // seed the FLOOR: a pure-grid payload applied on the floor replaces the
    // floor's tree (kind stays 'grid') — the Apply-to-canvas contract
    s.loadDocument({
      kind: 'grid',
      root: buildGridRoot(FIELDS, LOOKS, ['Title', 'Status', 'DueDate', 'Project']),
    });
    return s;
  }
  const colFields = (s: EditorState): (string | null)[] =>
    s.doc.root.children!.map((c) => gridColumnField(c));

  it('groupNodes wraps target-then-dragged in a named flex column at the target slot', () => {
    const s = gridState();
    // drag DueDate (2) onto Status (1)
    s.groupNodes([2], [1], groupName('Status', 'DueDate'));
    const names = s.doc.root.children!.map((c) => c._elmName);
    expect(names).toEqual(['Title', 'Status + DueDate group', 'Project']);
    const group = s.doc.root.children![1];
    expect(group.children?.map((c) => gridColumnField(c))).toEqual(['Status', 'DueDate']);
    // the grouped look cell arrives intact — stamp and all
    expect(group.children?.[0]._component?.id).toBe('c-pill');
    expect(group.style?.['flex-direction']).toBe('column');
    expect(s.selection).toEqual([1]);
    // ONE undo step restores the flat grid
    s.undo();
    expect(colFields(s)).toEqual(['Title', 'Status', 'DueDate', 'Project']);
  });

  it('groupNodes works dragging right onto left-of-source and rejects non-siblings/self', () => {
    const s = gridState();
    // drag Title (0) onto Project (3) — group lands where Project was
    s.groupNodes([0], [3], 'Project + Title group');
    expect(s.doc.root.children!.map((c) => c._elmName ?? gridColumnField(c)))
      .toEqual(['Status pill', 'DueDate', 'Project + Title group']);
    expect(s.doc.root.children![2].children?.map((c) => gridColumnField(c))).toEqual(['Project', 'Title']);

    const before = JSON.stringify(s.doc);
    s.groupNodes([1], [1], 'x'); // self
    s.groupNodes([], [1], 'x'); // root
    expect(JSON.stringify(s.doc)).toBe(before);
  });

  it('moveNodeTo reorders with before-index semantics; no-ops snapshot nothing', () => {
    const s = gridState();
    s.moveNodeTo([0], 3); // Title to before Project
    expect(colFields(s)).toEqual(['Status', 'DueDate', 'Title', 'Project']);
    s.moveNodeTo([3], 0); // Project to the front
    expect(colFields(s)).toEqual(['Project', 'Status', 'DueDate', 'Title']);
    // two real moves → exactly two undo steps, and a no-op adds none
    s.moveNodeTo([0], 1); // already there
    s.undo();
    s.undo();
    expect(colFields(s)).toEqual(['Title', 'Status', 'DueDate', 'Project']);
    s.undo(); // the next undo reverts the SEEDING, not a phantom move step
    expect(colFields(s))
      .toEqual(['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']); // the default floor
  });

  it('unwrapNode dissolves a group back into grid columns', () => {
    const s = gridState();
    s.groupNodes([2], [1], 'Status + DueDate group');
    s.unwrapNode([1]);
    expect(colFields(s)).toEqual(['Title', 'Status', 'DueDate', 'Project']);
  });

  it('the default workspace IS the grid: columns wear real component looks, Owner waits for "+ column"', () => {
    const s = new EditorState();
    expect(s.doc.kind).toBe('grid');
    expect(s.mainDocLabel()).toBe('View formatter — grid');
    const children = s.doc.root.children!;
    expect(children.map((c) => c._field))
      .toEqual(['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
    // Status and Progress arrive DRESSED: embedded clones of stamped palette
    // component instances — the workspace demonstrates the model it teaches
    expect(children[1]._component?.id).toBe('palette-status-pill');
    expect(children[3]._component?.id).toBe('palette-data-bar');
    expect(children[1].style?.['flex']).toBe('1');
    // no reference channel anywhere in the default floor
    expect(JSON.stringify(s.floorDoc)).not.toContain('columnFormatterReference');
    // Owner has a look registered but is unplaced — the add-column showcase
    expect(Object.hasOwn(s.columnLooks, 'Owner')).toBe(true);
    expect(unplacedFields(s.doc.root, s.fields).map((f) => f.name)).toContain('Owner');
  });
});

describe('row-view builder (graduation creates a SHEET — FLOOR-AND-SHEETS Stage 1)', () => {
  function gridState(): EditorState {
    const s = new EditorState();
    s.loadDocument({
      kind: 'grid',
      root: buildGridRoot(FIELDS, LOOKS, ['Title', 'Status', 'DueDate', 'Project']),
    });
    return s;
  }

  it('makeRowView creates a NEW row-view sheet in one undo step — the floor is untouched', () => {
    const s = gridState();
    const floorJson = JSON.stringify(s.floorDoc);
    s.makeRowView();
    expect(s.doc.kind).toBe('row');
    expect(s.views).toHaveLength(1);
    expect(s.onFloor).toBe(false);
    expect(s.doc.root.children).toHaveLength(4);
    expect(s.doc.root.children!.every((c) => c.style?.['flex'] !== undefined)).toBe(true);
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson); // nothing on the floor moved
    s.undo(); // ONE step removes the sheet and lands back on the intact floor
    expect(s.onFloor).toBe(true);
    expect(s.views).toEqual([]);
    expect(JSON.stringify(s.floorDoc)).toBe(floorJson);
  });

  it('makeRowView curates a column subset, in selection order — looks ride along as instances', () => {
    const s = gridState();
    s.makeRowView([3, 1]); // Project, Status
    expect(s.doc.kind).toBe('row');
    expect(s.doc.root.children!.map((c) => gridColumnField(c))).toEqual(['Project', 'Status']);
    // the graduated Status area is a CLONE of the look — instance stamp intact
    expect(s.doc.root.children![1]._component?.id).toBe('c-pill');
  });

  it('makeRowView(kind=tile) is an explicit tile pick with default dims and a vertical stack', () => {
    const s = gridState();
    s.makeRowView(undefined, 'tile');
    expect(s.doc.kind).toBe('tile');
    expect(s.doc.tileWidth).toBe(254);
    expect(s.doc.tileHeight).toBe(220);
    // a tile stacks its areas top to bottom — never a row squeezed into a box
    expect(s.doc.root.style?.['flex-direction']).toBe('column');
    expect(s.doc.root.style?.['height']).toBe('100%');
  });

  it('the sheet and the floor share NO nodes — shaping one can never corrupt the other', () => {
    const s = gridState();
    s.makeRowView();
    const sheet = s.activeView!;
    sheet.doc.root.children![0]._elmName = 'mutated on the sheet';
    expect(s.floorDoc.root.children![0]._elmName).toBe('Title');
  });

  it('makeRowView is a floor-only gesture — a no-op while a sheet is up', () => {
    const s = gridState();
    s.makeRowView();
    const count = s.views.length;
    s.makeRowView(); // already on a sheet
    expect(s.views).toHaveLength(count);
  });

  it('setRowDensity is one undo step', () => {
    const s = gridState();
    s.makeRowView();
    s.setRowDensity('compact');
    expect(s.doc.root.style?.['gap']).toBe('8px');
    s.undo(); // undo density
    expect(s.doc.root.style?.['gap']).not.toBe('8px');
  });

  it('leaving a sheet for the grid is NAVIGATION and remembers the way back', () => {
    const s = gridState();
    s.makeRowView();
    const sheet = s.activeView!;
    const sheetJson = JSON.stringify(sheet.doc);
    s.minimizeView(); // the COLUMNS tab (the grid is columns mode's canvas)
    expect(s.onFloor).toBe(true);
    expect(s.lastOpenViewId).toBe(sheet.id); // feeds the VIEWS tab's return
    expect(JSON.stringify(s.viewById(sheet.id)!.doc)).toBe(sheetJson); // untouched
    s.openView(sheet.id); // a strip chip / the VIEWS tab
    expect(s.doc.kind).toBe('row');
    expect(JSON.stringify(s.doc)).toBe(sheetJson); // same document, nothing rebuilt
  });
});

// ─── gridView: the header surface (happy-dom) ────────────────────────────────
// The per-column menu is slim: apply/change/remove the component look, save it
// as a component, copy the compiled column JSON, hide. Nothing formatter-
// editing survives — "Format this column" is not a gesture, there is no drill,
// no § anywhere. ⬡ component drops on a column apply the look.

describe('gridView header surface', () => {
  const toasts: string[] = [];
  const deps = () => ({
    opts: { issues: [], tagPaths: true },
    ctxForRow: (rowIndex: number): EvalContext => ({
      row: state.rows[rowIndex] ?? {},
      rowIndex,
      currentFieldName: state.currentFieldName,
      me: state.me,
      iterators: {},
      iteratorIndex: {},
      displayNames: {},
      now: new Date(),
    }),
    onToast: (m: string) => toasts.push(m),
  });

  let host: HTMLElement;
  const mount = (): HTMLElement => {
    host = document.createElement('div');
    document.body.appendChild(host);
    renderGrid(host, deps());
    return host;
  };
  const header = (i: number): HTMLElement =>
    host.querySelector<HTMLElement>(`.wb-grid-header[data-col="${i}"]`)!;
  const menuLabels = (): string[] =>
    [...document.querySelectorAll('.wb-grid-menu .wb-menu-main span')].map((n) => n.textContent ?? '');
  const menuItem = (label: string): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>('.wb-grid-menu .wb-menu-main')]
      .find((b) => b.querySelector('span')?.textContent === label)!;

  /** Synthetic drag event carrying one MIME (the library-row payload shape). */
  const dragEvent = (type: string, mime: string, payload = ''): Event => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
      types: [mime],
      getData: (t: string) => (t === mime ? payload : ''),
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    };
    return ev;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    toasts.length = 0;
    state.resetAll();
  });
  afterEach(() => vi.restoreAllMocks());

  it('a look-wearing column: ⬡ header mark; menu = Change/Remove/Save as/Copy/Hide — nothing formatter-editing, no §', () => {
    mount();
    const h = header(1); // Status — dressed by default
    expect(h.querySelector('.wb-grid-look')?.textContent).toBe('⬡');
    expect(h.querySelector('.wb-grid-look')?.getAttribute('aria-hidden')).toBe('true');
    h.click();
    expect(menuLabels()).toEqual([
      'Change the component…', 'Remove the look', 'Save as component…',
      'Copy column JSON', 'Hide column',
    ]);
    // the retired channel left no ink and no gestures behind
    expect(document.body.textContent).not.toContain('§');
    expect(document.body.textContent).not.toContain('Format this column');
    expect(host.querySelector('.wb-cfr-link, .wb-cell-linked, .wb-style-nametag')).toBeNull();
  });

  it('a plain column offers "Apply a component…" instead — no Remove, no look mark', () => {
    mount();
    const h = header(0); // Title — undressed
    expect(h.querySelector('.wb-grid-look')).toBeNull();
    h.click();
    expect(menuLabels()).toEqual(['Apply a component…', 'Copy column JSON', 'Hide column']);
  });

  it('an imported (unstamped) look keeps Remove + Save-as but has no def to reopen', () => {
    state.registerImportedLook('Title', { elmType: 'div', txtContent: '=@currentField' });
    mount();
    header(0).click();
    const labels = menuLabels();
    expect(labels).toContain('Remove the look');
    expect(labels).toContain('Save as component…'); // the one step to editability
    expect(labels).not.toContain('Change the component…'); // no def backs it
  });

  it('"Remove the look" undresses store + cell together, ONE undoable step', () => {
    mount();
    header(1).click();
    menuItem('Remove the look').click();
    expect(Object.hasOwn(state.columnLooks, 'Status')).toBe(false);
    const cell = state.floorDoc.root.children![1];
    expect(cell.txtContent).toBe('[$Status]'); // the plain-value cell again
    expect(cell._component).toBeUndefined();
    expect(cell._field).toBe('Status');
    state.undo(); // one Ctrl+Z redresses BOTH
    expect(state.columnLooks['Status']._component?.id).toBe('palette-status-pill');
    expect(state.floorDoc.root.children![1]._component?.id).toBe('palette-status-pill');
  });

  it('"Copy column JSON" compiles the look on demand — @currentField dialect, column schema', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } },
      configurable: true,
    });
    mount();
    header(1).click();
    menuItem('Copy column JSON').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0]);
    expect(parsed.$schema).toContain('column-formatting');
    expect(parsed.txtContent).toBe("=if(@currentField=='','None',@currentField)");
    expect(written[0]).not.toContain('[$Status]'); // fully compiled, store dialect gone
    expect(toasts.some((t) => t.includes("paste into that column's Format pane"))).toBe(true);
  });

  it('a ⬡ component dragged over a column highlights the WHOLE column (wb-grid-drop-look)', () => {
    mount();
    const h = header(2); // DueDate — a date column, deadline chip fits
    h.dispatchEvent(dragEvent('dragover', COMPONENT_MIME, 'builtin-deadline-chip'));
    const marked = host.querySelectorAll('.wb-grid-drop-look');
    expect(marked.length).toBe(1 + state.rows.length); // header + every body cell
    expect([...marked].every((n) => (n as HTMLElement).dataset.col === '2')).toBe(true);
    // leaving clears the highlight (the library row's dragend never reaches us)
    h.dispatchEvent(dragEvent('dragleave', COMPONENT_MIME));
    expect(host.querySelectorAll('.wb-grid-drop-look').length).toBe(0);
  });

  it('dropping a ⬡ component on a fitting column applies it as the look — ONE undo step', () => {
    mount();
    expect(Object.hasOwn(state.columnLooks, 'DueDate')).toBe(false);
    header(2).dispatchEvent(dragEvent('drop', COMPONENT_MIME, 'builtin-deadline-chip'));
    expect(state.columnLooks['DueDate']._component?.id).toBe('builtin-deadline-chip');
    // the floor cell was re-embedded in the same step
    const cell = state.floorDoc.root.children![2];
    expect(cell._component?.id).toBe('builtin-deadline-chip');
    expect(cell._field).toBe('DueDate');
    expect(cell.style?.['flex']).toBe('1');
    expect(toasts.some((t) => t.includes('Applied Deadline chip to DueDate'))).toBe(true);
    state.undo(); // one step undresses store + cell
    expect(Object.hasOwn(state.columnLooks, 'DueDate')).toBe(false);
    expect(state.floorDoc.root.children![2].txtContent).toBe('=toLocaleDateString([$DueDate])');
  });

  it('refuse-and-teach: a component with no slot for the column type applies nothing', () => {
    mount();
    header(0).dispatchEvent(dragEvent('drop', COMPONENT_MIME, 'builtin-deadline-chip'));
    expect(toasts.some((t) => t.includes('no slot that takes a text column'))).toBe(true);
    expect(Object.hasOwn(state.columnLooks, 'Title')).toBe(false);
    expect(state.canUndo).toBe(false); // a refusal is not a mutation
  });

  it('"+ column" lists unplaced fields, dressed ones marked, and inserts them wearing their look', () => {
    mount();
    const add = host.querySelector<HTMLElement>('.wb-grid-addcol')!;
    add.click();
    const labels = menuLabels();
    expect(labels).toContain('Owner · formatted'); // dressed but unplaced
    expect(labels).toContain('Tags');
    menuItem('Owner · formatted').click();
    const cell = state.floorDoc.root.children!.at(-1)!;
    expect(cell._field).toBe('Owner');
    expect(cell._component?.id).toBe('palette-persona'); // arrives wearing its look
  });

  it('gridColumnForField resolves a placed column, and a synthetic root path for unplaced ones', () => {
    mount();
    const owner = state.fields.find((f) => f.name === 'Owner')!;
    const status = state.fields.find((f) => f.name === 'Status')!;
    expect(gridColumnForField(status).path).toEqual([1]);
    expect(gridColumnForField(owner).path).toEqual([]);
  });
});

describe('grid wrapper semantics', () => {
  it('exports as a view (row) formatter — the grid is editor presentation', () => {
    const doc = {
      kind: 'grid' as const,
      root: buildGridRoot(FIELDS, LOOKS, ['Title', 'Status']),
    };
    const parsed = JSON.parse(exportJson(doc));
    expect(parsed.$schema).toContain('view-formatting');
    expect(parsed.rowFormatter.elmType).toBe('div');
    expect(parsed.rowFormatter.children).toHaveLength(2);
    expect(parsed.formatter).toBeUndefined();
  });
});
