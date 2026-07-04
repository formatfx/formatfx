/**
 * Stage 3 — "make a row view": grid columns become weighted areas in an
 * explicit row layout. areas.ts is the pure brain (like gridScaffold /
 * condRules); this file is its contract. Weights are conflict-free (CSS-fr
 * like) and density is a separate row-level knob that only touches gap/padding.
 */
import { describe, it, expect } from 'vitest';
import {
  WEIGHT_FLEX, DENSITY_STYLE, areaWeightOf, setAreaWeight,
  rowDensityOf, setRowDensity, buildRowView,
} from './areas';
import { buildGridRoot } from './gridScaffold';
import { exportJson } from '../core/serializer';
import type { MockField, SPElement } from '../core/types';

const FIELDS: MockField[] = [
  { name: 'Title', type: 'text' },
  { name: 'Status', type: 'choice', choices: ['A', 'B'] },
  { name: 'DueDate', type: 'date' },
];

describe('area weights (conflict-free, CSS-fr-like)', () => {
  it('weight ⇄ flex round-trips through the grow factor', () => {
    expect(WEIGHT_FLEX).toEqual({ normal: '1', wide: '2', widest: '3' });
    const el: SPElement = { elmType: 'div' };
    setAreaWeight(el, 'wide');
    expect(el.style?.['flex']).toBe('2');
    expect(el.style?.['min-width']).toBe('0'); // an area must be allowed to shrink
    expect(areaWeightOf(el)).toBe('wide');
    setAreaWeight(el, 'widest');
    expect(areaWeightOf(el)).toBe('widest');
    setAreaWeight(el, 'normal');
    expect(areaWeightOf(el)).toBe('normal');
  });

  it('areaWeightOf reads heavier shorthand flex and defaults to normal', () => {
    expect(areaWeightOf({ elmType: 'div' })).toBe('normal');
    expect(areaWeightOf({ elmType: 'div', style: { flex: '1' } })).toBe('normal');
    expect(areaWeightOf({ elmType: 'div', style: { flex: '2 1 0%' } })).toBe('wide');
    expect(areaWeightOf({ elmType: 'div', style: { flex: '3 0 120px' } })).toBe('widest');
  });

  it('setAreaWeight never disturbs an existing explicit min-width', () => {
    const el: SPElement = { elmType: 'div', style: { 'min-width': '80px' } };
    setAreaWeight(el, 'wide');
    expect(el.style?.['min-width']).toBe('80px');
  });
});

describe('row density (separate row-level knob)', () => {
  it('density only sets gap + padding, and reads back', () => {
    const root: SPElement = { elmType: 'div', style: { display: 'flex' } };
    setRowDensity(root, 'compact');
    expect(root.style?.['gap']).toBe(DENSITY_STYLE.compact.gap);
    expect(root.style?.['padding']).toBe(DENSITY_STYLE.compact.padding);
    expect(root.style?.['display']).toBe('flex'); // untouched
    expect(rowDensityOf(root)).toBe('compact');
    setRowDensity(root, 'roomy');
    expect(rowDensityOf(root)).toBe('roomy');
  });

  it('defaults to roomy when no density is set', () => {
    expect(rowDensityOf({ elmType: 'div' })).toBe('roomy');
  });
});

describe('buildRowView', () => {
  it('all columns become weighted areas; round-trips as a view (row) formatter', () => {
    const grid = buildGridRoot(FIELDS, {}, ['Title', 'Status', 'DueDate']);
    const row = buildRowView(grid);
    expect(row.children).toHaveLength(3);
    expect(row.children?.every((c) => c.style?.['flex'] !== undefined)).toBe(true);
    expect(rowDensityOf(row)).toBe('roomy');
    // same elements, so it still compiles to a view (row) formatter
    const parsed = JSON.parse(exportJson({ kind: 'row', root: row }));
    expect(parsed.$schema).toContain('view-formatting');
    expect(parsed.rowFormatter.children).toHaveLength(3);
  });

  it('an index subset curates which columns become areas, in the given order', () => {
    const grid = buildGridRoot(FIELDS, {}, ['Title', 'Status', 'DueDate']);
    const row = buildRowView(grid, [2, 0]);
    expect(row.children?.map((c) => c._elmName)).toEqual(['DueDate', 'Title']);
  });

  it('preserves an already-heavier area weight; honors the density argument', () => {
    const grid = buildGridRoot(FIELDS, {}, ['Title', 'Status']);
    setAreaWeight(grid.children![1], 'widest');
    const row = buildRowView(grid, undefined, 'compact');
    expect(areaWeightOf(row.children![0])).toBe('normal');
    expect(areaWeightOf(row.children![1])).toBe('widest');
    expect(rowDensityOf(row)).toBe('compact');
  });

  it('does not mutate the source grid', () => {
    const grid = buildGridRoot(FIELDS, {}, ['Title', 'Status']);
    const before = JSON.stringify(grid);
    buildRowView(grid, undefined, 'compact');
    expect(JSON.stringify(grid)).toBe(before);
  });

  it('as tile: areas stack vertically and fill the tile box (never a row in tile clothing)', () => {
    const grid = buildGridRoot(FIELDS, {}, ['Title', 'Status', 'DueDate']);
    const tile = buildRowView(grid, undefined, 'roomy', 'tile');
    expect(tile.style?.['flex-direction']).toBe('column');
    expect(tile.style?.['height']).toBe('100%');
    expect(tile.style?.['overflow']).toBe('hidden');
    expect(tile.style?.['box-sizing']).toBe('border-box');
    // the grid's row-centering must not shrink-wrap the stacked zones
    expect(tile.style?.['align-items']).toBeUndefined();
    expect(tile._elmName).toBe('Tile layout');
    // areas keep their conflict-free weights (they now share HEIGHT)
    expect(tile.children?.every((c) => c.style?.['flex'] !== undefined)).toBe(true);
    // a maker's custom root name is never clobbered
    const named = buildRowView({ ...grid, _elmName: 'My board' }, undefined, 'roomy', 'tile');
    expect(named._elmName).toBe('My board');
  });
});
