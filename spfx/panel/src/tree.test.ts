import { describe, it, expect } from 'vitest';
import { buildTree, currentViewOf, COLUMN_SCOPE, VIEW_SCOPE } from './tree';
import type { ListShape } from './targetIo';

const V1 = 'f24ba2a8-0000-0000-0000-000000000001';
const V2 = 'f24ba2a8-0000-0000-0000-000000000002';
const shape: ListShape = {
  fields: [
    { internalName: 'Title', displayName: 'Title', type: 'Text', readOnly: false, hidden: false },
    { internalName: 'Status', displayName: 'Status', type: 'Choice', readOnly: false, hidden: false, customFormatter: '{"elmType":"div"}' },
    { internalName: 'ID', displayName: 'ID', type: 'Counter', readOnly: true, hidden: false },
  ],
  views: [
    { title: 'All Items', id: V1, isDefault: true, viewFields: [], url: '/sites/x/Lists/L/AllItems.aspx' },
    { title: 'Mine', id: V2, isDefault: false, viewFields: [], customFormatter: '{}', url: '/sites/x/Lists/L/Mine.aspx' },
  ],
};

describe('buildTree', () => {
  it('lists views then columns with badges, dots, scope copy and the current view', () => {
    const t = buildTree(shape, new Set(['Field:Title', `View:${V2}`]), V2);
    expect(t.views.map((n) => [n.label, n.formatted, n.draft, n.current])).toEqual([
      ['All Items', false, false, false], ['Mine', true, true, true],
    ]);
    expect(t.views[1]).toMatchObject({ key: `View:${V2}`, target: { kind: 'View', id: V2 }, scope: VIEW_SCOPE, url: '/sites/x/Lists/L/Mine.aspx' });
    expect(t.columns.map((n) => [n.label, n.formatted, n.draft])).toEqual([
      ['Title', false, true], ['Status', true, false], ['ID', false, false],
    ]);
    expect(t.columns[0]).toMatchObject({ key: 'Field:Title', target: { kind: 'Field', id: 'Title' }, scope: COLUMN_SCOPE, current: false });
  });
  it('marks the default view current when the URL carries no viewid', () => {
    expect(buildTree(shape, new Set(), null).views.map((n) => n.current)).toEqual([true, false]);
    expect(currentViewOf(shape, null)?.id).toBe(V1);
    expect(currentViewOf(shape, V2)?.id).toBe(V2);
    expect(currentViewOf(shape, 'nope')?.id).toBe(V1);
  });
});
