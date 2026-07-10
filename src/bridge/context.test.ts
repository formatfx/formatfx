/**
 * context.test.ts — the popup dashboard's view-model
 * (extension/src/context.ts): what the popup shows about the list you're on,
 * computed from a captured List Snapshot. Also pins the additive `viewId`
 * option on selectFromSnapshot the per-view grab relies on.
 */
import { describe, it, expect } from 'vitest';
import { dashboardFrom, viewGrabFields } from '../../extension/src/context';
import { selectFromSnapshot, type ListSnapshot } from './spClient';

const SNAP: ListSnapshot = {
  formatfx: 'list-snapshot',
  version: 1,
  capturedAt: '2026-07-10T00:00:00Z',
  siteUrl: 'https://contoso.sharepoint.com/sites/Team',
  list: 'Projects',
  fields: [
    { internalName: 'Title', displayName: 'Title', type: 'Text', readOnly: false, hidden: false },
    { internalName: 'Status', displayName: 'Status', type: 'Choice', readOnly: false, hidden: false, customFormatter: '{"elmType":"div"}' },
    { internalName: 'Owner', displayName: 'Owner', type: 'User', readOnly: false, hidden: false, customFormatter: '{"elmType":"span","txtContent":"@currentField.title"}' },
    { internalName: 'Due', displayName: 'Due date', type: 'DateTime', readOnly: false, hidden: false },
  ],
  views: [
    { title: 'All Items', id: 'v-default', isDefault: true, viewFields: ['Title', 'Status', 'Due'] },
    { title: 'Board', id: 'v-board', isDefault: false, viewFields: ['Title', 'Owner', 'Ghost'], customFormatter: '{"hideSelection":true}' },
  ],
  rows: [],
  currentViewId: 'v-board',
};

describe('dashboardFrom', () => {
  it('summarises the list and surfaces only formatted columns/views', () => {
    const d = dashboardFrom(SNAP);
    expect(d.listLabel).toBe('Projects');
    expect(d.currentViewTitle).toBe('Board');
    expect(d.totalColumns).toBe(4);
    expect(d.totalViews).toBe(2);
    expect(d.formattedColumns.map((c) => c.internalName)).toEqual(['Status', 'Owner']);
    expect(d.formattedColumns[0].formatterChars).toBe('{"elmType":"div"}'.length);
    expect(d.formattedViews).toHaveLength(1);
    expect(d.formattedViews[0]).toMatchObject({ title: 'Board', isCurrent: true });
  });

  it('sorts the current view first among formatted views', () => {
    const snap: ListSnapshot = {
      ...SNAP,
      views: [
        { title: 'Zeta', id: 'v-z', isDefault: false, viewFields: [], customFormatter: '{}' },
        { title: 'Board', id: 'v-board', isDefault: false, viewFields: [], customFormatter: '{}' },
      ],
    };
    expect(dashboardFrom(snap).formattedViews.map((v) => v.title)).toEqual(['Board', 'Zeta']);
  });

  it('falls back to the site URL when the list has no title, and to empty sections', () => {
    const d = dashboardFrom({ ...SNAP, list: undefined, fields: [], views: [], currentViewId: undefined });
    expect(d.listLabel).toBe('https://contoso.sharepoint.com/sites/Team');
    expect(d.currentViewTitle).toBeUndefined();
    expect(d.formattedColumns).toEqual([]);
    expect(d.formattedViews).toEqual([]);
  });
});

describe('viewGrabFields', () => {
  it("returns the view's own columns, narrowed to fields the capture has", () => {
    // 'Ghost' is in the view's field list but was filtered out of the capture
    expect(viewGrabFields(SNAP, 'v-board')).toEqual(['Title', 'Owner']);
  });

  it('falls back to all captured fields when the intersection is empty', () => {
    const snap: ListSnapshot = {
      ...SNAP,
      views: [{ title: 'Odd', id: 'v-odd', isDefault: false, viewFields: ['Ghost'] }],
    };
    expect(viewGrabFields(snap, 'v-odd')).toEqual(['Title', 'Status', 'Owner', 'Due']);
    // unknown view id → same safety net
    expect(viewGrabFields(SNAP, 'nope')).toEqual(['Title', 'Status', 'Owner', 'Due']);
  });
});

describe('selectFromSnapshot with viewId (per-view grab)', () => {
  it('keeps exactly the named view, flagged isDefault so it auto-loads', () => {
    const sel = selectFromSnapshot(SNAP, {
      fieldNames: ['Title', 'Owner'], includeCurrentView: true, viewId: 'v-default',
    });
    expect(sel.views).toHaveLength(1);
    expect(sel.views[0]).toMatchObject({ title: 'All Items', isDefault: true });
    expect(sel.fields.map((f) => f.internalName)).toEqual(['Title', 'Owner']);
  });

  it('still selects the current view when viewId is omitted (existing behavior)', () => {
    const sel = selectFromSnapshot(SNAP, { fieldNames: ['Title'], includeCurrentView: true });
    expect(sel.views[0].title).toBe('Board');
  });

  it('carries no view when the viewId is unknown', () => {
    const sel = selectFromSnapshot(SNAP, { fieldNames: ['Title'], includeCurrentView: true, viewId: 'nope' });
    expect(sel.views).toEqual([]);
  });
});
