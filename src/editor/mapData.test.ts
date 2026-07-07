/**
 * The ▦ Map data dialog (#217, happy-dom): a per-property visual
 * IF / ELSE-IF / ELSE builder that compiles through the EXISTING condition
 * engine (mapRulesToExpr/condExpr) and stamps ONE undoable mutation.
 * Reopening re-hydrates its own chains (rebuild-verify gated); a foreign
 * formula gets the teaching note + "Start fresh" — refuse, never guess.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openMapData, closeMapData } from './mapData';
import { mapRulesToExpr } from './condRules';
import { state } from './state';
import type { SPElement } from '../core/types';

const panel = (): HTMLElement => document.querySelector('.wb-md') as HTMLElement;

const undoDepth = (): number => (state as unknown as { undoStack: string[] }).undoStack.length;

/** A row view with one styled leaf span, selected. */
function mountDoc(el: Partial<SPElement> = {}): void {
  state.resetAll();
  state.doc = {
    kind: 'row',
    root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'hello', ...el } as SPElement] },
  };
  state.selection = [0];
}

const node = (): SPElement => state.nodeAt([0])!;

const setInput = (el: HTMLInputElement | HTMLSelectElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};

afterEach(() => {
  closeMapData();
  document.querySelectorAll('body > *').forEach((n) => n.remove());
});

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Map data — fresh build on a style property', () => {
  it('adds an IF row, compiles through the engine, applies as ONE undoable mutation', () => {
    mountDoc({ style: { 'background-color': '#eeeeee' } });
    const toasts: string[] = [];
    openMapData({ path: [0], slot: 'style', prop: 'background-color', label: 'Background' }, (m) => toasts.push(m));
    expect(panel()).toBeTruthy();

    // the existing plain value pre-fills the ELSE output (the no-match look)
    const elseOut = panel().querySelector<HTMLInputElement>('.wb-md-else .wb-md-outtext')!;
    expect(elseOut.value).toBe('#eeeeee');

    // apply refuses until a complete row exists
    const apply = panel().querySelector<HTMLButtonElement>('.wb-md-apply')!;
    expect(apply.disabled).toBe(true);

    // + IF… → Status equals Blocked → #fde7e9
    panel().querySelector<HTMLButtonElement>('.wb-md-add')!.click();
    const row = panel().querySelector('.wb-md-row')!;
    setInput(row.querySelector<HTMLSelectElement>('.wb-md-field')!, 'Status');
    const opSel = panel().querySelector<HTMLSelectElement>('.wb-md-op')!;
    expect([...opSel.options].map((o) => o.value)).toContain('neq'); // type-honest menu
    setInput(panel().querySelector<HTMLSelectElement>('.wb-md-val')!, 'Blocked'); // choices arrive as a select
    setInput(panel().querySelector<HTMLInputElement>('.wb-md-row:not(.wb-md-else) .wb-md-outtext')!, '#fde7e9');

    const applyBtn = panel().querySelector<HTMLButtonElement>('.wb-md-apply')!;
    expect(applyBtn.disabled).toBe(false);
    // the compiled chain is shown as a receipt
    expect(panel().querySelector('.wb-md-expr')!.textContent).toContain("[$Status] == 'Blocked'");

    const before = undoDepth();
    applyBtn.click();

    const expected = mapRulesToExpr(state.fields, [
      { fieldName: 'Status', cond: { kind: 'eq', value: 'Blocked' }, output: '#fde7e9' },
    ], '#eeeeee');
    expect(node().style?.['background-color']).toBe(expected);
    expect(undoDepth()).toBe(before + 1); // ONE undoable step
    expect(toasts.join(' ')).toContain('Ctrl+Z');

    state.undo();
    expect(node().style?.['background-color']).toBe('#eeeeee');
  });

  it('binds the text slot too (conditional txtContent)', () => {
    mountDoc();
    openMapData({ path: [0], slot: 'text', label: 'Text' });
    panel().querySelector<HTMLButtonElement>('.wb-md-add')!.click();
    setInput(panel().querySelector<HTMLSelectElement>('.wb-md-field')!, 'Status');
    setInput(panel().querySelector<HTMLSelectElement>('.wb-md-val')!, 'Done');
    setInput(panel().querySelector<HTMLInputElement>('.wb-md-row:not(.wb-md-else) .wb-md-outtext')!, 'Shipped');
    panel().querySelector<HTMLButtonElement>('.wb-md-apply')!.click();
    expect(node().txtContent).toBe(mapRulesToExpr(state.fields, [
      { fieldName: 'Status', cond: { kind: 'eq', value: 'Done' }, output: 'Shipped' },
    ], 'hello'));
  });
});

describe('Map data — reopen (round trip) and removal', () => {
  const CHAIN = (): string => mapRulesToExpr(
    [{ name: 'Status', type: 'choice', choices: ['Done', 'Blocked'] }],
    [{ fieldName: 'Status', cond: { kind: 'eq', value: 'Done' }, output: '#dff6dd' }],
    '#ffffff',
  )!;

  it('re-hydrates rows from a chain it generated', () => {
    mountDoc({ style: { color: CHAIN() } });
    openMapData({ path: [0], slot: 'style', prop: 'color', label: 'Color' });
    // one IF row + the ELSE row, pre-filled
    expect(panel().querySelectorAll('.wb-md-row:not(.wb-md-else)')).toHaveLength(1);
    expect(panel().querySelector<HTMLSelectElement>('.wb-md-field')!.value).toBe('Status');
    expect(panel().querySelector<HTMLSelectElement>('.wb-md-val')!.value).toBe('Done');
    expect(panel().querySelector<HTMLInputElement>('.wb-md-row:not(.wb-md-else) .wb-md-outtext')!.value).toBe('#dff6dd');
    expect(panel().querySelector<HTMLInputElement>('.wb-md-else .wb-md-outtext')!.value).toBe('#ffffff');
    expect(panel().querySelector('.wb-md-note')!.textContent).toContain('parsed back');
  });

  it('deleting every row turns Apply into "remove the mapping" — the ELSE stays as the plain value', () => {
    mountDoc({ style: { color: CHAIN() } });
    openMapData({ path: [0], slot: 'style', prop: 'color', label: 'Color' });
    panel().querySelector<HTMLButtonElement>('.wb-md-del')!.click();
    const apply = panel().querySelector<HTMLButtonElement>('.wb-md-apply')!;
    expect(apply.textContent).toContain('Remove');
    expect(apply.disabled).toBe(false);
    apply.click();
    expect(node().style?.['color']).toBe('#ffffff');
    state.undo();
    expect(node().style?.['color']).toBe(CHAIN());
  });
});

describe('Map data — the refuse path (foreign formulas)', () => {
  it('shows the teaching note + Start fresh instead of parsing a hand-written formula', () => {
    mountDoc({ style: { color: "='#'+substring([$Status],0,6)" } });
    openMapData({ path: [0], slot: 'style', prop: 'color', label: 'Color' });

    // refuse-and-teach: no builder rows, the formula quoted, a fresh-start door
    expect(panel().querySelector('.wb-md-foreign')).toBeTruthy();
    expect(panel().querySelector('.wb-md-foreign-code')!.textContent).toContain('substring');
    expect(panel().querySelectorAll('.wb-md-row')).toHaveLength(0);
    expect(panel().querySelector('.wb-md-apply')).toBeNull();

    // nothing was touched just by opening + closing
    closeMapData();
    expect(node().style?.['color']).toBe("='#'+substring([$Status],0,6)");
  });

  it('Start fresh opens an empty builder; the formula survives until Apply', () => {
    mountDoc({ style: { color: "='#'+substring([$Status],0,6)" } });
    openMapData({ path: [0], slot: 'style', prop: 'color', label: 'Color' });
    panel().querySelector<HTMLButtonElement>('.wb-md-fresh')!.click();
    expect(panel().querySelector('.wb-md-foreign')).toBeNull();
    expect(panel().querySelector<HTMLButtonElement>('.wb-md-apply')!.disabled).toBe(true);
    expect(node().style?.['color']).toBe("='#'+substring([$Status],0,6)"); // untouched until Apply

    panel().querySelector<HTMLButtonElement>('.wb-md-add')!.click();
    setInput(panel().querySelector<HTMLSelectElement>('.wb-md-field')!, 'Status');
    setInput(panel().querySelector<HTMLSelectElement>('.wb-md-val')!, 'Done');
    panel().querySelector<HTMLButtonElement>('.wb-md-apply')!.click();
    expect(node().style?.['color']).toContain('=if(');
    state.undo();
    expect(node().style?.['color']).toBe("='#'+substring([$Status],0,6)");
  });
});
