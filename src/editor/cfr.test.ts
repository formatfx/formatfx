/**
 * Stage 4 — CFR linked-instance model. cfr.ts is the pure brain; this is its
 * contract. Blast radius = the change-everywhere scope; fork (inline) and
 * promote (toColumnFormatter) are inverse ref swaps that must render correctly
 * in their respective contexts (row vs column).
 */
import { describe, it, expect } from 'vitest';
import { cfrBlastRadius, inlineColumnFormatter, toColumnFormatter } from './cfr';
import { renderElement } from '../core/renderer';
import type { EvalContext } from '../core/expressions';
import type { SPElement } from '../core/types';

function ctx(row: Record<string, unknown>, currentFieldName = 'Status'): EvalContext {
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

describe('cfrBlastRadius', () => {
  it('counts linked instances across the view and other column formatters', () => {
    const mainRoot: SPElement = {
      elmType: 'div',
      children: [
        { elmType: 'div', columnFormatterReference: '[$Status]' },
        { elmType: 'div', txtContent: '[$Title]' },
      ],
    };
    const columnRefs: Record<string, SPElement> = {
      Status: { elmType: 'div', txtContent: '@currentField' },
      // a card formatter that itself links to Status
      Card: { elmType: 'div', children: [{ elmType: 'div', columnFormatterReference: '[$Status]' }] },
    };
    const r = cfrBlastRadius('Status', mainRoot, columnRefs);
    expect(r.count).toBe(2);
    expect(r.places).toEqual(['the view', 'the Card formatter']);
  });

  it('is zero when nothing links to the column', () => {
    const r = cfrBlastRadius('DueDate', { elmType: 'div' }, {});
    expect(r).toEqual({ count: 0, places: [] });
  });
});

describe('fork ⇄ promote ref swaps are inverse and render in context', () => {
  const registered: SPElement = {
    elmType: 'div',
    _elmName: 'Status pill',
    txtContent: '@currentField',
    style: { 'background-color': "=if(@currentField=='Done','#107c10','#888')" },
  };

  it('inlineColumnFormatter: @currentField → [$Field], renders under the row context', () => {
    const local = inlineColumnFormatter(registered, 'Status');
    expect(local.txtContent).toBe('[$Status]');
    expect(local.style?.['background-color']).toBe("=if([$Status]=='Done','#107c10','#888')");
    // a local cell renders under the row ctx (no CFR @currentField swap)
    const node = renderElement(local, ctx({ Status: 'Done' }, 'Title'));
    expect(node.textContent).toBe('Done');
  });

  it('inlineColumnFormatter carries dotted props through', () => {
    const persona: SPElement = { elmType: 'img', attributes: { src: '=getUserImage(@currentField.email)', title: '@currentField.title' } };
    const local = inlineColumnFormatter(persona, 'Owner');
    expect(local.attributes?.title).toBe('[$Owner.title]');
    expect(local.attributes?.src).toBe('=getUserImage([$Owner.email])');
  });

  it('toColumnFormatter: [$Field] → @currentField, drops grid-layout artifacts', () => {
    const localCell: SPElement = {
      elmType: 'div',
      _elmName: 'Status',
      txtContent: '[$Status]',
      style: { 'flex': '1', 'min-width': '0', 'font-weight': '600', 'color': "=if([$Status]=='Done','#107c10','#888')" },
      columnFormatterReference: undefined,
    };
    const col = toColumnFormatter(localCell, 'Status');
    expect(col.txtContent).toBe('@currentField');
    expect(col.style?.['flex']).toBeUndefined();
    expect(col.style?.['min-width']).toBeUndefined();
    expect(col.style?.['font-weight']).toBe('600');
    expect(col.style?.['color']).toBe("=if(@currentField=='Done','#107c10','#888')");
    // renders as a column formatter (@currentField = the column)
    const node = renderElement(col, ctx({ Status: 'Done' }, 'Status'));
    expect(node.textContent).toBe('Done');
  });

  it('promote then fork round-trips the field binding', () => {
    const localCell: SPElement = { elmType: 'div', txtContent: '[$Status]', style: { 'flex': '1', 'min-width': '0' } };
    const promoted = toColumnFormatter(localCell, 'Status');
    expect(promoted.txtContent).toBe('@currentField');
    const forked = inlineColumnFormatter(promoted, 'Status');
    expect(forked.txtContent).toBe('[$Status]');
  });
});
