/**
 * Grid-first workspace: scaffold generation (pure), the grid mutations
 * (each ONE undoable document step — a roadmap contract), and the wrapper
 * semantics (a grid is a row formatter in embryo).
 */
import { describe, it, expect } from 'vitest';
import {
  buildGridRoot, gridCellForField, defaultColumnFormatter,
  gridColumnField, gridColumnLabel, groupName, isPureGrid, unplacedFields,
} from './gridScaffold';
import { EditorState } from './state';
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

const REFS: Record<string, SPElement> = {
  Status: { elmType: 'div', txtContent: '@currentField' },
};

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
  it('buildGridRoot: a named flex row with one named child per field, CFRs where registered', () => {
    const root = buildGridRoot(FIELDS, REFS, ['Title', 'Status', 'DueDate']);
    expect(root._elmName).toBe('Row layout');
    expect(root.style?.display).toBe('flex');
    expect(root.children?.map((c) => c._elmName)).toEqual(['Title', 'Status', 'DueDate']);
    expect(root.children?.[0].txtContent).toBe('[$Title]');
    expect(root.children?.[1].columnFormatterReference).toBe('[$Status]');
    expect(root.children?.[1].txtContent).toBeUndefined();
    expect(root.children?.[2].txtContent).toBe('=toLocaleDateString([$DueDate])');
  });

  it('buildGridRoot default: every non-protected field, schema order', () => {
    const root = buildGridRoot(FIELDS, REFS);
    expect(root.children?.map((c) => c._elmName))
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

    const node = renderElement(gridCellForField(byName.AssignedTo, {}), ctx({
      AssignedTo: [{ title: 'Ada', email: 'a@x' }, { title: 'Grace', email: 'g@x' }],
    }));
    expect(node.textContent).toBe('Ada, Grace');
    const done = renderElement(gridCellForField(byName.Done, {}), ctx({ Done: true }));
    expect(done.textContent).toBe('Yes');
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

  it('gridColumnField: CFR target, single-ref cells, null for composites', () => {
    expect(gridColumnField({ elmType: 'div', columnFormatterReference: '[$Status]' })).toBe('Status');
    expect(gridColumnField({ elmType: 'div', txtContent: '=toLocaleDateString([$DueDate])' })).toBe('DueDate');
    expect(gridColumnField({
      elmType: 'div',
      children: [
        { elmType: 'span', txtContent: '[$Status]' },
        { elmType: 'span', txtContent: '[$DueDate]' },
      ],
    })).toBeNull();
  });

  it('gridColumnLabel: _elmName wins, then display name, then elmType', () => {
    const fields: MockField[] = [{ name: 'Title', displayName: 'Task name', type: 'text' }];
    expect(gridColumnLabel({ elmType: 'div', txtContent: '[$Title]' }, fields)).toBe('Task name');
    expect(gridColumnLabel({ elmType: 'div', _elmName: 'My col', txtContent: '[$Title]' }, fields)).toBe('My col');
    expect(gridColumnLabel({ elmType: 'span' }, fields)).toBe('<span>');
  });

  it('group naming follows the roadmap contract', () => {
    expect(groupName('Status', 'DueDate')).toBe('Status + DueDate group');
  });

  it('isPureGrid and unplacedFields gate rebuilds and the "+ column" menu', () => {
    const root = buildGridRoot(FIELDS, REFS, ['Title', 'Status']);
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
});

describe('grid document mutations (one undo step each)', () => {
  function gridState(): EditorState {
    const s = new EditorState();
    s.doc = {
      kind: 'grid',
      root: buildGridRoot(FIELDS, REFS, ['Title', 'Status', 'DueDate', 'Project']),
    };
    return s;
  }

  it('groupNodes wraps target-then-dragged in a named flex column at the target slot', () => {
    const s = gridState();
    // drag DueDate (2) onto Status (1)
    s.groupNodes([2], [1], groupName('Status', 'DueDate'));
    const names = s.doc.root.children!.map((c) => c._elmName);
    expect(names).toEqual(['Title', 'Status + DueDate group', 'Project']);
    const group = s.doc.root.children![1];
    expect(group.children?.map((c) => c._elmName)).toEqual(['Status', 'DueDate']);
    expect(group.style?.['flex-direction']).toBe('column');
    expect(s.selection).toEqual([1]);
    // ONE undo step restores the flat grid
    s.undo();
    expect(s.doc.root.children!.map((c) => c._elmName)).toEqual(['Title', 'Status', 'DueDate', 'Project']);
  });

  it('groupNodes works dragging right onto left-of-source and rejects non-siblings/self', () => {
    const s = gridState();
    // drag Title (0) onto Project (3) — group lands where Project was
    s.groupNodes([0], [3], 'Project + Title group');
    expect(s.doc.root.children!.map((c) => c._elmName))
      .toEqual(['Status', 'DueDate', 'Project + Title group']);
    expect(s.doc.root.children![2].children?.map((c) => c._elmName)).toEqual(['Project', 'Title']);

    const before = JSON.stringify(s.doc);
    s.groupNodes([1], [1], 'x'); // self
    s.groupNodes([], [1], 'x'); // root
    expect(JSON.stringify(s.doc)).toBe(before);
  });

  it('moveNodeTo reorders with before-index semantics; no-ops snapshot nothing', () => {
    const s = gridState();
    s.moveNodeTo([0], 3); // Title to before Project
    expect(s.doc.root.children!.map((c) => c._elmName)).toEqual(['Status', 'DueDate', 'Title', 'Project']);
    s.moveNodeTo([3], 0); // Project to the front
    expect(s.doc.root.children!.map((c) => c._elmName)).toEqual(['Project', 'Status', 'DueDate', 'Title']);
    // two real moves → exactly two undo steps, and a no-op adds none
    s.moveNodeTo([0], 1); // already there
    s.undo();
    s.undo();
    expect(s.doc.root.children!.map((c) => c._elmName)).toEqual(['Title', 'Status', 'DueDate', 'Project']);
    s.undo(); // stack exhausted — still the original order
    expect(s.doc.root.children!.map((c) => c._elmName)).toEqual(['Title', 'Status', 'DueDate', 'Project']);
  });

  it('unwrapNode dissolves a group back into grid columns', () => {
    const s = gridState();
    s.groupNodes([2], [1], 'Status + DueDate group');
    s.unwrapNode([1]);
    expect(s.doc.root.children!.map((c) => c._elmName)).toEqual(['Title', 'Status', 'DueDate', 'Project']);
  });

  it('the default workspace IS the grid: formatted columns resolve, Owner stays for "+ column"', () => {
    const s = new EditorState();
    expect(s.doc.kind).toBe('grid');
    expect(s.mainDocLabel()).toBe('View formatter — grid');
    const children = s.doc.root.children!;
    expect(children.map((c) => c._elmName))
      .toEqual(['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
    expect(children[1].columnFormatterReference).toBe('[$Status]');
    expect(children[3].columnFormatterReference).toBe('[$Progress]');
    // Owner is registered but unplaced — the add-column showcase
    expect('Owner' in s.columnRefs).toBe(true);
    expect(unplacedFields(s.doc.root, s.fields).map((f) => f.name)).toContain('Owner');
  });
});

describe('grid wrapper semantics', () => {
  it('exports as a view (row) formatter — the grid is editor presentation', () => {
    const doc = {
      kind: 'grid' as const,
      root: buildGridRoot(FIELDS, REFS, ['Title', 'Status']),
    };
    const parsed = JSON.parse(exportJson(doc));
    expect(parsed.$schema).toContain('view-formatting');
    expect(parsed.rowFormatter.elmType).toBe('div');
    expect(parsed.rowFormatter.children).toHaveLength(2);
    expect(parsed.formatter).toBeUndefined();
  });
});
