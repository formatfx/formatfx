/**
 * The THIS VIEW card (happy-dom) — COLUMNS-COMPONENTS-VIEWS §3.2: hidden on
 * the grid; on a view tab it names the view and carries the view-scoped
 * behaviors & properties (density, additionalRowClass, scanned action/card
 * rows with jump-to-element); while a component workshop tab is active it
 * shows a compact DEF card (name, slot chips, usage count) instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountViewCard, scanBehaviors } from './viewCard';
import { state, CARD_SEGMENT } from './state';
import { rowDensityOf } from './areas';
import type { SPElement } from '../core/types';

function mount(toasts: string[] = []): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountViewCard(host, (m) => toasts.push(m));
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.resetAll();
});

describe('what shows when (per-tab shapes)', () => {
  it('the grid shows NOTHING — the card is hidden', () => {
    const host = mount();
    expect(state.onFloor).toBe(true);
    expect(host.hidden).toBe(true);
  });

  it('a view tab shows name + kind; navigation keeps it live', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } }, 'Sprint board');
    const host = mount();
    expect(host.hidden).toBe(false);
    expect(host.querySelector('.wb-viewcard-name')?.textContent).toBe('Sprint board');
    expect(host.querySelector('.wb-viewcard-kind')?.textContent).toBe('row view');
    state.minimizeView();
    expect(host.hidden).toBe(true);
    state.openView(state.views[0].id);
    expect(host.hidden).toBe(false);
  });

  it('a tile view reads "tile view"', () => {
    state.createView({ kind: 'tile', root: { elmType: 'div', children: [] } }, 'Gallery');
    const host = mount();
    expect(host.querySelector('.wb-viewcard-kind')?.textContent).toBe('tile view');
  });

  it('a component tab shows the compact DEF card: ⬡ name, slot chips, usage count', () => {
    state.createView({
      kind: 'row',
      root: {
        elmType: 'div',
        children: [{
          elmType: 'div', txtContent: 'x',
          _component: { id: 'builtin-deadline-chip', map: { Due: 'DueDate' } },
        } as SPElement],
      },
    });
    state.openComponentTab('builtin-deadline-chip');
    const host = mount();
    expect(host.hidden).toBe(false);
    expect(host.querySelector('.wb-viewcard-mark')?.textContent).toBe('⬡');
    expect(host.querySelector('.wb-viewcard-name')?.textContent).toBe('Deadline chip');
    expect(host.querySelectorAll('.wb-comp-slot').length).toBe(1); // one Due slot
    expect(host.querySelector('.wb-viewcard-usage')?.textContent).toContain('1 place');
    // no view-scoped controls on a def card
    expect(host.querySelector('.wb-viewcard-rowclass')).toBeNull();
    state.deactivateComponentTab();
    expect(host.querySelector('.wb-viewcard-name')?.textContent).toBe('View 1');
  });
});

describe('density (state.setRowDensity — one undoable step)', () => {
  it('reflects the current density and switches it', () => {
    state.makeRowView(); // roomy by default
    const host = mount();
    const btns = [...host.querySelectorAll<HTMLButtonElement>('.wb-viewcard-segbtn')];
    expect(btns.map((b) => b.textContent)).toEqual(['Roomy', 'Compact']);
    expect(btns[0].classList.contains('active')).toBe(true);
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    btns[1].click();
    expect(rowDensityOf(state.doc.root)).toBe('compact');
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth + 1);
    // the card re-rendered on the mutation — Compact now reads active
    expect(host.querySelector('.wb-viewcard-segbtn.active')?.textContent).toBe('Compact');
  });
});

describe('row class (viewExtras.additionalRowClass — one mutation per commit)', () => {
  it('sets, edits and clears the class; empty deletes the key (and an empty viewExtras)', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } });
    const host = mount();
    const inp = host.querySelector('.wb-viewcard-rowclass') as HTMLInputElement;
    expect(inp.value).toBe('');
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    inp.value = 'sp-zebra';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.doc.viewExtras?.additionalRowClass).toBe('sp-zebra');
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth + 1);

    // clearing deletes the key AND the now-empty viewExtras (clean export)
    const inp2 = host.querySelector('.wb-viewcard-rowclass') as HTMLInputElement;
    inp2.value = '';
    inp2.dispatchEvent(new Event('blur'));
    expect(state.doc.viewExtras).toBeUndefined();
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth + 2);
  });

  it('a no-op commit pushes NO undo step', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } });
    const host = mount();
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    const inp = host.querySelector('.wb-viewcard-rowclass') as HTMLInputElement;
    inp.dispatchEvent(new Event('blur')); // '' → '' — nothing changed
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);
  });

  it('other viewExtras keys survive a clear (carried verbatim — the import contract)', () => {
    state.createView({
      kind: 'row',
      root: { elmType: 'div', children: [] },
      viewExtras: { additionalRowClass: 'x', hideListHeader: true },
    });
    const host = mount();
    const inp = host.querySelector('.wb-viewcard-rowclass') as HTMLInputElement;
    expect(inp.value).toBe('x');
    inp.value = '';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.doc.viewExtras).toEqual({ hideListHeader: true });
  });
});

describe('scanned behaviors (jump-to-element rows)', () => {
  const behaviorDoc = (): SPElement => ({
    elmType: 'div',
    children: [
      { elmType: 'button', _elmName: 'Go button', txtContent: 'Go', customRowAction: { action: 'executeFlow' } },
      {
        elmType: 'div', _elmName: 'Owner chip',
        customCardProps: {
          openOnEvent: 'hover',
          formatter: { elmType: 'div', children: [{ elmType: 'button', txtContent: 'inner', customRowAction: { action: 'defaultClick' } }] },
        },
      },
    ],
  });

  it('scanBehaviors finds actions and cards, card content included (CARD_SEGMENT paths)', () => {
    const rows = scanBehaviors(behaviorDoc());
    expect(rows.map((r) => r.path)).toEqual([[0], [1], [1, CARD_SEGMENT, 0]]);
    expect(rows[0].label).toBe('▶ executeFlow — Go button');
    expect(rows[1].label).toBe('▣ hover card — Owner chip');
    expect(rows[2].label).toBe('▶ defaultClick — <button>');
  });

  it('renders one row per behavior; clicking JUMPS (selects) — never mutates', () => {
    state.createView({ kind: 'row', root: behaviorDoc() });
    const host = mount();
    const rows = [...host.querySelectorAll<HTMLElement>('.wb-viewcard-behavior')];
    expect(rows.length).toBe(3);
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    rows[1].click();
    expect(state.selection).toEqual([1]);
    rows[2].click();
    expect(state.selection).toEqual([1, CARD_SEGMENT, 0]);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);
  });

  it('a behavior-free view shows no Behaviors group', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } });
    const host = mount();
    expect(host.querySelector('.wb-viewcard-group')).toBeNull();
    expect(host.querySelector('.wb-viewcard-behavior')).toBeNull();
  });
});
