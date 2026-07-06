/**
 * DOM contract for the redesigned ⬡ Components pane (owner brief 2026-07-05:
 * the pane speaks the Columns/Views inventory language — tree-idiom ROWS with
 * a click-to-expand drawer, no card list) and for the mapper's trigger picker
 * (issue #204: "Where should this appear?" — inline vs hover/click card,
 * one undoable mutation, robust pattern by construction).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { renderComponentLibrary, openComponentMapper } from './componentLibrary';
import { BUILTIN_COMPONENTS } from './components';
import { mountCanvas } from './canvas';
import { state } from './state';
import type { SPElement } from '../core/types';

const DEADLINE = BUILTIN_COMPONENTS[0]; // 1 date slot — default schema has DueDate

beforeEach(() => {
  state.resetAll();
});

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
});

function mountLibrary(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  renderComponentLibrary(host, () => {});
  return host;
}

describe('components pane — inventory rows, not cards', () => {
  it('renders every component as a tree-idiom row; the card classes are gone', () => {
    const host = mountLibrary();
    expect(host.querySelector('.wb-comp-card')).toBeNull();
    expect(host.querySelector('.wb-comp-used')).toBeNull();
    const rows = [...host.querySelectorAll('.wb-tree-row.wb-comp-row')];
    expect(rows.length).toBeGreaterThanOrEqual(BUILTIN_COMPONENTS.length);
    // row anatomy: ⬡ mark + name in the tree label, hover actions present
    const first = rows[0];
    expect(first.querySelector('.wb-tree-label .wb-comp-mark')?.textContent).toBe('⬡');
    expect(first.querySelector('.wb-tree-name')).toBeTruthy();
    expect(first.querySelector('.wb-tree-actions')).toBeTruthy();
  });

  it('clicking a row expands the details drawer (preview + Add), clicking again collapses', () => {
    const host = mountLibrary();
    const row = host.querySelector<HTMLElement>('.wb-comp-row')!;
    const drawer = row.parentElement!.querySelector<HTMLElement>('.wb-comp-details')!;
    expect(drawer.hidden).toBe(true);
    row.click();
    expect(drawer.hidden).toBe(false);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.querySelector('.wb-comp-preview')).toBeTruthy(); // live preview lives in the drawer
    expect(drawer.querySelector('.wb-comp-add')).toBeTruthy();
    row.click();
    expect(drawer.hidden).toBe(true);
  });

  it('a used component appears under "In this project" with a count chip and usage jump rows in its drawer', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [{
          elmType: 'div', txtContent: 'x',
          _component: { id: DEADLINE.id, map: { Due: 'DueDate' } },
        } as SPElement],
      },
    };
    const host = mountLibrary();
    const invRow = [...host.querySelectorAll<HTMLElement>('.wb-comp-row')]
      .find((r) => r.querySelector('.wb-comp-count'));
    expect(invRow).toBeTruthy();
    expect(invRow!.querySelector('.wb-comp-count')!.textContent).toBe('1');
    invRow!.click();
    const drawer = invRow!.parentElement!.querySelector<HTMLElement>('.wb-comp-details')!;
    expect(drawer.querySelector('.wb-comp-usage')).toBeTruthy();
  });

  it('element-component rows are drag sources carrying the component MIME', () => {
    const host = mountLibrary();
    const row = host.querySelector<HTMLElement>('.wb-comp-row')!;
    expect(row.draggable).toBe(true);
  });
});

describe('mapper — the trigger picker (issue #204)', () => {
  it('defaults to inline; hover-card attach lands customCardProps on the picked host as ONE undo step', () => {
    state.doc = {
      kind: 'row',
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'hello' }] },
    };
    state.selection = null;
    openComponentMapper(DEADLINE, () => {});
    const panel = document.querySelector<HTMLElement>('.wb-compmap')!;
    expect(panel).toBeTruthy();

    const appear = panel.querySelector<HTMLSelectElement>('select[data-role=appear]')!;
    expect(appear.value).toBe('inline');
    // candidate exists (the root division), so card modes are offered
    appear.value = 'hover-card';
    appear.dispatchEvent(new Event('change', { bubbles: true }));
    const hostSel = panel.querySelector<HTMLSelectElement>('select[data-role=host]')!;
    expect(hostSel.closest('label')!.hidden).toBe(false);

    const insert = panel.querySelector<HTMLButtonElement>('.wb-compmap-insert')!;
    expect(insert.textContent).toBe('Attach as a hover card');
    insert.click();

    const hostEl = state.doc.root;
    expect(hostEl.customCardProps?.openOnEvent).toBe('hover');
    // the card body is the bound, STAMPED instance (provenance for the inventory)
    expect(hostEl.customCardProps?.formatter._component?.id).toBe(DEADLINE.id);
    // hover card on a division: no overlay needed, and the host got selected
    expect(state.selection).toEqual([]);

    state.undo(); // one gesture — a single undo removes the whole binding
    expect(state.doc.root.customCardProps).toBeUndefined();
  });

  it('click-card attach generates the robust overlay (children can never swallow the click)', () => {
    state.doc = {
      kind: 'row',
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'hello' }] },
    };
    openComponentMapper(DEADLINE, () => {});
    const panel = document.querySelector<HTMLElement>('.wb-compmap')!;
    const appear = panel.querySelector<HTMLSelectElement>('select[data-role=appear]')!;
    appear.value = 'click-card';
    appear.dispatchEvent(new Event('change', { bubbles: true }));
    panel.querySelector<HTMLButtonElement>('.wb-compmap-insert')!.click();

    const overlay = state.doc.root.children![1];
    expect(overlay.elmType).toBe('button');
    expect(overlay.attributes?.class).toBe('sp-card-defaultClickButton');
    expect(overlay.customCardProps?.openOnEvent).toBe('click');
    expect(state.doc.root.style?.position).toBe('relative');
    expect(state.selection).toEqual([1]); // the trigger carrier is selected
  });

  it('pick-on-canvas: candidates highlight on the real canvas and a click chooses the host (Esc cancels)', () => {
    // two candidates: the root and its first child division
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'div', children: [{ elmType: 'span', txtContent: 'inner' }] },
          { elmType: 'span', txtContent: 'leaf' },
        ],
      },
    };
    const canvasHost = document.createElement('div');
    canvasHost.id = 'wb-canvas';
    document.body.appendChild(canvasHost);
    mountCanvas(canvasHost, () => {});

    openComponentMapper(DEADLINE, () => {});
    const panel = document.querySelector<HTMLElement>('.wb-compmap')!;
    const appear = panel.querySelector<HTMLSelectElement>('select[data-role=appear]')!;
    appear.value = 'hover-card';
    appear.dispatchEvent(new Event('change', { bubbles: true }));

    const overlayEl = document.querySelector<HTMLElement>('.wb-compmap-overlay')!;
    const pick = panel.querySelector<HTMLButtonElement>('.wb-compmap-pick')!;
    pick.click();
    // the dialog steps aside and every candidate copy glows
    expect(overlayEl.style.display).toBe('none');
    const marked = [...document.querySelectorAll<HTMLElement>('.wb-trigger-candidate')];
    expect(marked.length).toBeGreaterThan(0);
    // Esc cancels: dialog returns, highlights clear, selection untouched
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlayEl.style.display).toBe('');
    expect(document.querySelector('.wb-trigger-candidate')).toBeNull();

    // pick again — a STRAY click (editor chrome outside any candidate, here
    // the Live mode button) is swallowed whole: it neither acts underneath
    // nor ends the pick. (A click INSIDE a candidate resolves to it via
    // closest() — the whole division is its own click surface.)
    pick.click();
    const liveBtn = [...canvasHost.querySelectorAll<HTMLButtonElement>('.wb-canvas-mode')]
      .find((b) => /Live/.test(b.textContent ?? ''))!;
    liveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.canvasMode).toBe('select'); // the click never reached the toggle
    expect(document.querySelector('.wb-trigger-candidate')).not.toBeNull();

    // now CLICK the child-division copy — the host select lands on that candidate
    const child = [...document.querySelectorAll<HTMLElement>('.wb-trigger-candidate')]
      .find((el) => el.dataset.spPath === '0')!;
    child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.wb-trigger-candidate')).toBeNull();
    const hostSel = panel.querySelector<HTMLSelectElement>('select[data-role=host]')!;
    expect(hostSel.value).toBe('1'); // hosts are [root, child] in document order

    // …and attaching lands the card on the PICKED division
    panel.querySelector<HTMLButtonElement>('.wb-compmap-insert')!.click();
    expect(state.doc.root.children![0].customCardProps?.openOnEvent).toBe('hover');
    expect(state.doc.root.customCardProps).toBeUndefined();
  });

  it('the beak toggle rides into isBeakVisible', () => {
    state.doc = {
      kind: 'row',
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'x' }] },
    };
    openComponentMapper(DEADLINE, () => {});
    const panel = document.querySelector<HTMLElement>('.wb-compmap')!;
    const appear = panel.querySelector<HTMLSelectElement>('select[data-role=appear]')!;
    appear.value = 'hover-card';
    appear.dispatchEvent(new Event('change', { bubbles: true }));
    const beak = panel.querySelector<HTMLInputElement>('input[data-role=beak]')!;
    expect(beak.closest('label')!.hidden).toBe(false);
    beak.checked = false;
    beak.dispatchEvent(new Event('change', { bubbles: true }));
    panel.querySelector<HTMLButtonElement>('.wb-compmap-insert')!.click();
    expect(state.doc.root.customCardProps?.isBeakVisible).toBe(false);
  });

  it('offers no card modes when nothing on the canvas can host one', () => {
    state.doc = { kind: 'column', root: { elmType: 'span', txtContent: 'leaf' } };
    openComponentMapper(DEADLINE, () => {});
    const panel = document.querySelector<HTMLElement>('.wb-compmap')!;
    const appear = panel.querySelector<HTMLSelectElement>('select[data-role=appear]')!;
    expect(appear.disabled).toBe(true);
    expect([...appear.options].filter((o) => o.disabled).map((o) => o.value))
      .toEqual(['hover-card', 'click-card']);
  });
});
