/**
 * The inspector's INSTANCE card (happy-dom) — COLUMNS-COMPONENTS-VIEWS §3.6:
 * a selected node stamped `_component` leads with a ⬡ card ahead of the
 * element sections — the def's name, one type-filtered "bound to" select per
 * slot (change = ONE undoable re-bake via the instance's updated map), the
 * workshop door, and "Detach to plain elements". A grid LOOK cell (a
 * `_field` cell whose column wears a look) also offers "Remove the look",
 * and its re-binds keep the look STORE and the placed cell in lockstep.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountInspector } from './inspector';
import { state } from './state';
import { BUILTIN_COMPONENTS, bindComponentInstance } from './components';
import type { SPElement } from '../core/types';

const DEADLINE = BUILTIN_COMPONENTS[0]; // one 'Due' slot, types ['date']

function mount(toasts: string[] = []): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountInspector(host, { toast: (m) => toasts.push(m) });
  return host;
}

/** A row view whose second child is a bound Deadline-chip instance. */
function viewWithInstance(): void {
  state.createView({
    kind: 'row',
    root: {
      elmType: 'div',
      children: [
        { elmType: 'span', txtContent: 'plain' },
        bindComponentInstance(DEADLINE, { Due: 'DueDate' }),
      ],
    },
  });
  state.select([1]);
}

const undoDepth = (): number => (state as unknown as { undoStack: string[] }).undoStack.length;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.resetAll();
  state.setLens('pro');
});

describe('when the card shows', () => {
  it('leads the pane for a stamped instance; a plain node gets no card', () => {
    viewWithInstance();
    const host = mount();
    const card = host.querySelector('.wb-inst-card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.wb-comp-mark')?.textContent).toBe('⬡');
    expect(card!.querySelector('.wb-inst-name')?.textContent).toBe('Deadline chip');
    // ahead of the sections: the card is the pane's first rendered block
    expect(host.firstElementChild).toBe(card);

    state.select([0]); // the plain span
    expect(host.querySelector('.wb-inst-card')).toBeNull();
  });

  it('shows in the Simple lens too — provenance is a maker concept', () => {
    state.setLens('simple');
    viewWithInstance();
    const host = mount();
    expect(host.querySelector('.wb-inst-card')).not.toBeNull();
  });

  it('a deleted def reads honestly and still offers Detach (but no slots, no workshop)', () => {
    state.createView({
      kind: 'row',
      root: { elmType: 'div', children: [{ elmType: 'div', txtContent: 'x', _component: { id: 'c-ghost', map: {} } } as SPElement] },
    });
    state.select([0]);
    const host = mount();
    expect(host.querySelector('.wb-inst-name')?.textContent).toContain('no longer in the library');
    expect(host.querySelector('.wb-inst-open')).toBeNull();
    expect(host.querySelector('.wb-inst-slot')).toBeNull();
    expect(host.querySelector('.wb-inst-detach')).not.toBeNull();
  });
});

describe('per-slot re-binding (type-filtered, one undo step)', () => {
  it('offers only columns the slot\'s types accept, current binding selected', () => {
    viewWithInstance();
    const host = mount();
    const sel = host.querySelector<HTMLSelectElement>('.wb-inst-slot-select[data-slot="Due"]')!;
    expect(sel.value).toBe('DueDate');
    // the default schema has exactly one date column — no wrong-typed offers
    expect([...sel.options].map((o) => o.value)).toEqual(['DueDate']);
  });

  it('changing the select re-bakes the instance from its def with the updated map — ONE undo step', () => {
    state.fields.push({ name: 'Review', type: 'date' });
    viewWithInstance();
    const host = mount();
    const before = undoDepth();
    const sel = host.querySelector<HTMLSelectElement>('.wb-inst-slot-select[data-slot="Due"]')!;
    sel.value = 'Review';
    sel.dispatchEvent(new Event('change'));
    const node = state.doc.root.children![1];
    expect(node._component?.map).toEqual({ Due: 'Review' });
    expect(JSON.stringify(node.txtContent)).toContain('[$Review]'); // the tree re-baked
    expect(JSON.stringify(node.txtContent)).not.toContain('[$DueDate]');
    expect(undoDepth()).toBe(before + 1);
    state.undo();
    expect(state.doc.root.children![1]._component?.map).toEqual({ Due: 'DueDate' });
  });

  it('a grid LOOK cell re-binds through applyComponentToColumn — store and cell in lockstep', () => {
    state.fields.push({ name: 'Review', type: 'date' });
    state.applyComponentToColumn('DueDate', DEADLINE, { Due: 'DueDate' });
    const i = state.floorDoc.root.children!.findIndex((c) => c._field === 'DueDate');
    state.select([i]);
    const host = mount();
    const before = undoDepth();
    const sel = host.querySelector<HTMLSelectElement>('.wb-inst-slot-select[data-slot="Due"]')!;
    sel.value = 'Review';
    sel.dispatchEvent(new Event('change'));
    expect(state.columnLooks.DueDate._component?.map).toEqual({ Due: 'Review' });
    expect(state.floorDoc.root.children![i]._component?.map).toEqual({ Due: 'Review' });
    expect(undoDepth()).toBe(before + 1);
    state.undo(); // one Ctrl+Z reverts BOTH
    expect(state.columnLooks.DueDate._component?.map).toEqual({ Due: 'DueDate' });
    expect(state.floorDoc.root.children![i]._component?.map).toEqual({ Due: 'DueDate' });
  });
});

describe('the card actions', () => {
  it('"Open in workshop ✎" opens the def\'s canvas tab', () => {
    viewWithInstance();
    const host = mount();
    (host.querySelector('.wb-inst-open') as HTMLButtonElement).click();
    expect(state.activeComponentTab).toBe(DEADLINE.id);
    expect(state.openTabs.some((t) => t.kind === 'component' && t.defId === DEADLINE.id)).toBe(true);
    state.deactivateComponentTab();
  });

  it('"Detach to plain elements" deletes the stamp, keeps the tree, teaches — one undo step', () => {
    const toasts: string[] = [];
    viewWithInstance();
    const host = mount(toasts);
    const before = undoDepth();
    (host.querySelector('.wb-inst-detach') as HTMLButtonElement).click();
    const node = state.doc.root.children![1];
    expect(node._component).toBeUndefined();
    expect(node.txtContent).toBeDefined(); // the elements stayed
    expect(undoDepth()).toBe(before + 1);
    expect(toasts.some((t) => t.includes('workshop edits won\'t reach'))).toBe(true);
    // the card is gone from the re-rendered pane — it's plain elements now
    expect(host.querySelector('.wb-inst-card')).toBeNull();
  });

  it('a grid look cell also detaches its STORED look (no silent restamp later)', () => {
    state.applyComponentToColumn('DueDate', DEADLINE, { Due: 'DueDate' });
    const i = state.floorDoc.root.children!.findIndex((c) => c._field === 'DueDate');
    state.select([i]);
    const host = mount();
    (host.querySelector('.wb-inst-detach') as HTMLButtonElement).click();
    expect(state.floorDoc.root.children![i]._component).toBeUndefined();
    expect(state.columnLooks.DueDate._component).toBeUndefined(); // unstamped, imported-like
    expect(Object.hasOwn(state.columnLooks, 'DueDate')).toBe(true); // the look itself survives
  });

  it('"Remove the look" appears ONLY for a grid look cell and routes to removeColumnLook', () => {
    viewWithInstance();
    const host = mount();
    expect(host.querySelector('.wb-inst-removelook')).toBeNull(); // a view instance is not a look

    state.minimizeView();
    state.applyComponentToColumn('DueDate', DEADLINE, { Due: 'DueDate' });
    const i = state.floorDoc.root.children!.findIndex((c) => c._field === 'DueDate');
    state.select([i]);
    const before = undoDepth();
    (host.querySelector('.wb-inst-removelook') as HTMLButtonElement).click();
    expect(Object.hasOwn(state.columnLooks, 'DueDate')).toBe(false);
    expect(state.floorDoc.root.children![i]._component).toBeUndefined(); // plain cell again
    expect(undoDepth()).toBe(before + 1);
  });
});
