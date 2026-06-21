/**
 * Stage 5 — "Format this column" preset picker. columnPresets.ts is the pure
 * brain: a field type offers the presets that fit it (refuse-don't-guess), and
 * a chosen preset becomes a real column formatter (primary field → @currentField)
 * that renders correctly in the column context.
 */
import { describe, it, expect } from 'vitest';
import { columnPresetsFor, buildColumnPreset } from './columnPresets';
import { renderElement } from '../core/renderer';
import type { EvalContext } from '../core/expressions';
import type { MockField } from '../core/types';

function ctx(row: Record<string, unknown>, currentFieldName: string): EvalContext {
  return {
    row: row as EvalContext['row'],
    rowIndex: 0,
    currentFieldName,
    me: { title: 'Me', email: 'me@x.com' },
    iterators: {},
    iteratorIndex: {},
    displayNames: {},
    now: new Date(),
  };
}

describe('columnPresetsFor: type-aware, confident matches only', () => {
  it('offers people presets for a multi-person column', () => {
    expect(columnPresetsFor('personMulti').map((p) => p.id)).toEqual(['facepile', 'member-count']);
  });
  it('offers status looks for choice and bars for number', () => {
    expect(columnPresetsFor('choice').map((p) => p.id)).toContain('status-pill');
    expect(columnPresetsFor('number').map((p) => p.id)).toContain('data-bar');
  });
  it('returns nothing for types with no confident preset (manual only)', () => {
    expect(columnPresetsFor('boolean')).toEqual([]);
    expect(columnPresetsFor('note')).toEqual([]);
  });
  it('every option carries label/description/icon from the palette', () => {
    const opt = columnPresetsFor('date')[0];
    expect(opt.label).toBeTruthy();
    expect(opt.description).toBeTruthy();
    expect(opt.icon).toBeTruthy();
  });
});

describe('buildColumnPreset: a real @currentField column formatter', () => {
  const assignedTo: MockField = { name: 'AssignedTo', type: 'personMulti' };
  const reviewers: MockField = { name: 'Reviewers', type: 'personMulti' };

  it('facepile on the natural column folds [$AssignedTo] into @currentField and renders avatars', () => {
    const tree = buildColumnPreset('facepile', assignedTo)!;
    expect(tree.children?.[0].forEach).toBe('_person in @currentField');
    expect(tree._elmName).toBe('AssignedTo — Facepile');
    const node = renderElement(tree, ctx({ AssignedTo: [{ title: 'Ada', email: 'a@x' }, { title: 'Grace', email: 'g@x' }] }, 'AssignedTo'));
    expect(node.querySelectorAll('img').length).toBe(2);
  });

  it('rebinds the primary field to a different column of the same type', () => {
    const tree = buildColumnPreset('facepile', reviewers)!;
    // the loop binds to the chosen column via @currentField, not the default
    expect(tree.children?.[0].forEach).toBe('_person in @currentField');
    expect(JSON.stringify(tree)).not.toContain('AssignedTo');
    const node = renderElement(tree, ctx({ Reviewers: [{ title: 'Linus', email: 'l@x' }] }, 'Reviewers'));
    expect(node.querySelectorAll('img').length).toBe(1);
  });

  it('status pill on a choice column renders the value', () => {
    const tree = buildColumnPreset('status-pill', { name: 'Status', type: 'choice' })!;
    expect(tree.txtContent).toContain('@currentField');
    const node = renderElement(tree, ctx({ Status: 'Blocked' }, 'Status'));
    expect(node.textContent).toBe('Blocked');
  });

  it('refuses an unknown preset / type mismatch', () => {
    expect(buildColumnPreset('facepile', { name: 'X', type: 'number' })).toBeNull();
    expect(buildColumnPreset('nope', assignedTo)).toBeNull();
  });
});
