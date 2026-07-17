/**
 * lookDialect.ts is the contract for the two reference dialects a column's
 * look moves between: inlineColumnFormatter (`@currentField` → `[$Field]`,
 * import/registration) and toColumnFormatter (`[$Field]` → `@currentField`,
 * the per-column SharePoint export). The two are inverses — store → export →
 * import round-trips the field binding — and each output must render
 * correctly in its own context (a placed look under the row ctx, a compiled
 * column formatter under @currentField).
 */
import { describe, it, expect } from 'vitest';
import { inlineColumnFormatter, toColumnFormatter } from './lookDialect';
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

describe('inlineColumnFormatter — @currentField → [$Field]', () => {
  const registered: SPElement = {
    elmType: 'div',
    _elmName: 'Status pill',
    txtContent: '@currentField',
    style: { 'background-color': "=if(@currentField=='Done','#107c10','#888')" },
  };

  it('rewrites txtContent and style formulas; the result renders under the row context', () => {
    const local = inlineColumnFormatter(registered, 'Status');
    expect(local.txtContent).toBe('[$Status]');
    expect(local.style?.['background-color']).toBe("=if([$Status]=='Done','#107c10','#888')");
    // a placed look renders under the row ctx — whatever column is "current"
    const node = renderElement(local, ctx({ Status: 'Done' }, 'Title'));
    expect(node.textContent).toBe('Done');
  });

  it('carries dotted props through (@currentField.title → [$Owner.title])', () => {
    const persona: SPElement = {
      elmType: 'img',
      attributes: { src: '=getUserImage(@currentField.email)', title: '@currentField.title' },
    };
    const local = inlineColumnFormatter(persona, 'Owner');
    expect(local.attributes?.title).toBe('[$Owner.title]');
    expect(local.attributes?.src).toBe('=getUserImage([$Owner.email])');
  });

  it('reaches every expression slot: forEach, children and card content', () => {
    const tree: SPElement = {
      elmType: 'div',
      forEach: '_t in split(@currentField,";")',
      children: [{ elmType: 'span', txtContent: '@currentField' }],
      customCardProps: {
        openOnEvent: 'hover',
        formatter: { elmType: 'div', txtContent: '@currentField.title' },
      },
    };
    const local = inlineColumnFormatter(tree, 'Tags');
    expect(local.forEach).toBe('_t in split([$Tags],";")');
    expect(local.children?.[0].txtContent).toBe('[$Tags]');
    expect(local.customCardProps?.formatter.txtContent).toBe('[$Tags.title]');
    // deep-clone contract: the input tree is untouched
    expect(tree.children?.[0].txtContent).toBe('@currentField');
  });
});

describe('toColumnFormatter — [$Field] → @currentField', () => {
  it('rewrites only the named field, drops root grid-layout artifacts, renders as a column formatter', () => {
    const cell: SPElement = {
      elmType: 'div',
      _elmName: 'Status',
      txtContent: '[$Status]',
      style: {
        'flex': '1', 'min-width': '0', // the grid cell's layout — export drops them
        'font-weight': '600',
        'color': "=if([$Status]=='Done','#107c10','#888')",
      },
    };
    const col = toColumnFormatter(cell, 'Status');
    expect(col.txtContent).toBe('@currentField');
    expect(col.style?.['flex']).toBeUndefined();
    expect(col.style?.['min-width']).toBeUndefined();
    expect(col.style?.['font-weight']).toBe('600');
    expect(col.style?.['color']).toBe("=if(@currentField=='Done','#107c10','#888')");
    // renders as a column formatter (@currentField IS the column)
    const node = renderElement(col, ctx({ Status: 'Done' }, 'Status'));
    expect(node.textContent).toBe('Done');
    // purity: the source cell keeps its layout styles
    expect(cell.style?.['flex']).toBe('1');
  });

  it('dotted refs compile ([$Owner.title] → @currentField.title); OTHER fields stay explicit', () => {
    const cell: SPElement = {
      elmType: 'div',
      txtContent: '[$Owner.title]',
      style: { color: "=if([$DueDate]<@now,'#d13438','#605e5c')" },
    };
    const col = toColumnFormatter(cell, 'Owner');
    expect(col.txtContent).toBe('@currentField.title');
    // a look may reference several columns — only ITS column becomes @currentField
    expect(col.style?.['color']).toBe("=if([$DueDate]<@now,'#d13438','#605e5c')");
  });

  it('a style left empty after dropping flex/min-width disappears entirely', () => {
    const cell: SPElement = { elmType: 'div', txtContent: '[$Status]', style: { 'flex': '1', 'min-width': '0' } };
    const col = toColumnFormatter(cell, 'Status');
    expect(col.style).toBeUndefined();
  });

  it('flex/min-width are only dropped from the ROOT — a child keeps its layout', () => {
    const cell: SPElement = {
      elmType: 'div',
      style: { 'flex': '1', 'min-width': '0' },
      children: [{ elmType: 'div', txtContent: '[$Progress]', style: { 'flex': '2', 'min-width': '24px' } }],
    };
    const col = toColumnFormatter(cell, 'Progress');
    expect(col.style).toBeUndefined();
    expect(col.children?.[0].style?.['flex']).toBe('2');
    expect(col.children?.[0].style?.['min-width']).toBe('24px');
  });
});

describe('the two converters are inverses', () => {
  it('export then import round-trips the field binding', () => {
    const cell: SPElement = { elmType: 'div', txtContent: '[$Status]', style: { 'flex': '1', 'min-width': '0' } };
    const compiled = toColumnFormatter(cell, 'Status');
    expect(compiled.txtContent).toBe('@currentField');
    const back = inlineColumnFormatter(compiled, 'Status');
    expect(back.txtContent).toBe('[$Status]');
  });

  it('import then export round-trips a dotted, formula-bearing recipe byte-for-byte', () => {
    const recipe: SPElement = {
      elmType: 'div',
      txtContent: '@currentField.title',
      style: { 'background-color': "=if(@currentField.email==@me,'#eff6fc','')" },
    };
    const look = inlineColumnFormatter(recipe, 'Owner');
    expect(toColumnFormatter(look, 'Owner')).toEqual(recipe);
  });
});

describe('AST (object-form SPExpr) rewriting — PR #213 Copilot regression', () => {
  it('inlineColumnFormatter rewrites @currentField inside AST operands', () => {
    const tree = {
      elmType: 'div',
      txtContent: { operator: '+', operands: ['@currentField', { operator: 'toString()', operands: ['@currentField.title'] }] },
      style: { 'background-color': { operator: '?', operands: [{ operator: '==', operands: ['@currentField', 'Done'] }, '#107c10', '#d13438'] } },
    } as unknown as import('../core/types').SPElement;
    const out = inlineColumnFormatter(tree, 'Status');
    expect(JSON.stringify(out)).not.toContain('@currentField');
    expect(JSON.stringify(out.txtContent)).toContain('[$Status]');
    expect(JSON.stringify(out.txtContent)).toContain('[$Status.title]');
    expect(JSON.stringify(out.style)).toContain('[$Status]');
  });

  it('multi-segment props stay INSIDE the reference (@currentField.lookupValue.length — the pnp colored-pills shape)', () => {
    const tree = {
      elmType: 'div',
      style: { 'background-color': "='rgba(' + ((@currentField.lookupValue.length) * 3) + ',0,0,1)'" },
    } as unknown as import('../core/types').SPElement;
    const out = inlineColumnFormatter(tree, 'SoldTo');
    expect(JSON.stringify(out.style)).toContain('[$SoldTo.lookupValue.length]');
    expect(JSON.stringify(out.style)).not.toContain(']​.length'); // no dangling segment outside the brackets
    // and the reverse compiles it back whole
    expect(JSON.stringify(toColumnFormatter(out, 'SoldTo').style)).toContain('@currentField.lookupValue.length');
  });

  it('toColumnFormatter rewrites [$Field] inside AST operands (round-trip)', () => {
    const tree = {
      elmType: 'div',
      txtContent: { operator: '+', operands: ['[$Due]', { operator: 'toString()', operands: ['[$Due.title]'] }] },
    } as unknown as import('../core/types').SPElement;
    const back = toColumnFormatter(tree, 'Due');
    expect(JSON.stringify(back)).not.toContain('[$Due');
    expect(JSON.stringify(back.txtContent)).toContain('@currentField');
    expect(JSON.stringify(back.txtContent)).toContain('@currentField.title');
    // full round-trip: inline again restores the explicit refs
    expect(JSON.stringify(inlineColumnFormatter(back, 'Due').txtContent)).toContain('[$Due.title]');
  });
});
