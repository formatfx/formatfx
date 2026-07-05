/**
 * styleScope.ts — pure scope/label derivation for the "violet = shared"
 * legibility work. Chip + banner copy are contracts (e2e locates by them).
 */
import { describe, it, expect } from 'vitest';
import type { SPElement } from '../core/types';
import { scopeFor, scopeChipLabel, styleBannerLabel } from './styleScope';

const mainRoot: SPElement = {
  elmType: 'div',
  children: [
    { elmType: 'div', txtContent: '[$Title]' },
    { elmType: 'div', columnFormatterReference: '[$Status]' },
  ],
};
const refs: Record<string, SPElement> = { Status: { elmType: 'div', txtContent: '@currentField' } };
const display = (n: string) => (n === 'Status' ? 'Status' : n);

describe('scopeFor', () => {
  it('main doc + plain selection in a row view → view scope', () => {
    expect(scopeFor('main', 'row', 'Status', mainRoot.children![0], mainRoot, refs)).toEqual({ kind: 'view' });
  });
  it('main doc + no selection in a row view → view scope', () => {
    expect(scopeFor('main', 'row', 'Status', null, mainRoot, refs)).toEqual({ kind: 'view' });
  });
  it('grid floor + plain selection → grid scope, never "view" (no view exists yet)', () => {
    expect(scopeFor('main', 'grid', 'Status', mainRoot.children![0], mainRoot, refs)).toEqual({ kind: 'grid' });
  });
  it('grid floor + no selection → grid scope', () => {
    expect(scopeFor('main', 'grid', 'Status', null, mainRoot, refs)).toEqual({ kind: 'grid' });
  });
  it('main doc + host cell selected in a view → host scope, view surface', () => {
    expect(scopeFor('main', 'row', 'Status', mainRoot.children![1], mainRoot, refs)).toEqual({ kind: 'host', field: 'Status', surface: 'view' });
  });
  it('grid floor + host cell selected → host scope, grid surface', () => {
    expect(scopeFor('main', 'grid', 'Status', mainRoot.children![1], mainRoot, refs)).toEqual({ kind: 'host', field: 'Status', surface: 'grid' });
  });
  it('drilled into a style → style scope with blast count', () => {
    expect(scopeFor('Status', 'grid', 'Status', null, mainRoot, refs)).toEqual({ kind: 'style', field: 'Status', places: 1 });
  });
  it('drilled, zero references → places clamps to 1 (the style itself)', () => {
    expect(scopeFor('Owner', 'grid', 'Status', null, mainRoot, refs)).toEqual({ kind: 'style', field: 'Owner', places: 1 });
  });
  it('a column-kind formatter IS the main doc → style scope, not view (the chip must not lie)', () => {
    expect(scopeFor('main', 'column', 'Status', null, mainRoot, refs)).toEqual({ kind: 'style', field: 'Status', places: 1 });
  });
  it('main doc, column kind, zero references → places clamps to 1', () => {
    expect(scopeFor('main', 'column', 'Owner', null, mainRoot, refs)).toEqual({ kind: 'style', field: 'Owner', places: 1 });
  });
});

describe('scopeChipLabel', () => {
  it('view', () => expect(scopeChipLabel({ kind: 'view' }, display)).toBe('This view only'));
  it('grid', () => expect(scopeChipLabel({ kind: 'grid' }, display)).toBe('This grid only'));
  it('host in a view', () => expect(scopeChipLabel({ kind: 'host', field: 'Status', surface: 'view' }, display)).toBe('Host cell · this view only'));
  it('host on the grid floor', () => expect(scopeChipLabel({ kind: 'host', field: 'Status', surface: 'grid' }, display)).toBe('Host cell · this grid only'));
  it('style plural', () => expect(scopeChipLabel({ kind: 'style', field: 'Status', places: 3 }, display)).toBe('Status style · 3 places'));
  it('style singular', () => expect(scopeChipLabel({ kind: 'style', field: 'Status', places: 1 }, display)).toBe('Status style · 1 place'));
});

describe('styleBannerLabel', () => {
  it('plural', () => expect(styleBannerLabel('Status', 3))
    .toBe('Editing the Status style — used in 3 places · changes apply everywhere'));
  it('singular', () => expect(styleBannerLabel('Status', 1))
    .toBe("Editing the Status style — changes apply everywhere it's used"));
});
