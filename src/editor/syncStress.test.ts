import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state';
import { mountTree } from './treeView';
import { mountInspector } from './inspector';
import { mountCanvas } from './canvas';

describe('Panel selection synchronization and multi-select stress tests', () => {
  beforeEach(() => {
    state.resetAll();
    // Reset private listeners to keep tests clean and decoupled
    (state as any).listeners = [];
  });

  it('updates selection on state and tree view rows when clicked or checkbox toggled', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A' },
          { elmType: 'span', txtContent: 'Span B' }
        ]
      }
    };
    state.selection = []; // Select root initially

    const viewHost = document.createElement('div');
    const colsHost = document.createElement('div');
    document.body.appendChild(viewHost);
    document.body.appendChild(colsHost);

    mountTree(viewHost, colsHost);

    const rows = viewHost.querySelectorAll<HTMLElement>('.wb-tree-row');
    expect(rows).toHaveLength(3); // root + two children

    const rootRow = [...rows].find(r => r.dataset.path === '');
    const spanARow = [...rows].find(r => r.dataset.path === '0');
    const spanBRow = [...rows].find(r => r.dataset.path === '1');

    expect(rootRow).toBeTruthy();
    expect(spanARow).toBeTruthy();
    expect(spanBRow).toBeTruthy();

    // Verify initial selection CSS classes
    expect(rootRow!.classList.contains('selected')).toBe(true);
    expect(spanARow!.classList.contains('selected')).toBe(false);
    expect(spanBRow!.classList.contains('selected')).toBe(false);

    // 1. Click on Span A row -> should select Span A
    spanARow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual([0]);
    expect(rootRow!.classList.contains('selected')).toBe(false);
    expect(spanARow!.classList.contains('selected')).toBe(true);

    // 2. Toggle Span B selection via its checkbox
    const checkboxB = spanBRow!.querySelector<HTMLInputElement>('.wb-tree-check');
    expect(checkboxB).toBeTruthy();
    checkboxB!.click(); // triggers toggleSelect([1])

    // Under multi-select, Span A and Span B should both be selected
    expect(state.selections).toEqual([[0], [1]]);
    expect(spanARow!.classList.contains('selected')).toBe(true);
    expect(spanBRow!.classList.contains('selected')).toBe(true);

    // Cleanup DOM
    viewHost.remove();
    colsHost.remove();
  });

  it('handles Ctrl/Cmd/Shift key modifiers in tree view to multi-select', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A' },
          { elmType: 'span', txtContent: 'Span B' }
        ]
      }
    };
    state.selection = [];

    const viewHost = document.createElement('div');
    const colsHost = document.createElement('div');
    document.body.appendChild(viewHost);
    document.body.appendChild(colsHost);

    mountTree(viewHost, colsHost);

    const spanARow = viewHost.querySelector<HTMLElement>('[data-path="0"]');
    const spanBRow = viewHost.querySelector<HTMLElement>('[data-path="1"]');

    // Plain click on Span A collapses to Span A only
    spanARow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selections).toEqual([[0]]);

    // Ctrl+click on Span B adds Span B to selections
    spanBRow!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(state.selections).toEqual([[0], [1]]);

    // Shift+click on Span A removes Span A from selections
    spanARow!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(state.selections).toEqual([[1]]);

    // Cleanup DOM
    viewHost.remove();
    colsHost.remove();
  });

  it('updates selection on canvas clicks and updates canvas highlights on selection changes', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A' },
          { elmType: 'span', txtContent: 'Span B' }
        ]
      }
    };
    state.selection = [];

    const host = document.createElement('div');
    document.body.appendChild(host);

    mountCanvas(host, () => {});

    // Find canvas elements with data-sp-path attributes
    const rootEl = host.querySelector('[data-sp-path=""]');
    const spanAEl = host.querySelector('[data-sp-path="0"]');
    const spanBEl = host.querySelector('[data-sp-path="1"]');

    expect(rootEl).toBeTruthy();
    expect(spanAEl).toBeTruthy();
    expect(spanBEl).toBeTruthy();

    // Initial highlight check
    expect(rootEl!.classList.contains('wb-selected')).toBe(true);
    expect(spanAEl!.classList.contains('wb-selected')).toBe(false);
    expect(spanBEl!.classList.contains('wb-selected')).toBe(false);

    // Canvas click on Span B selects Span B
    spanBEl!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual([1]);
    expect(rootEl!.classList.contains('wb-selected')).toBe(false);
    expect(spanBEl!.classList.contains('wb-selected')).toBe(true);

    // Ctrl+click on Span A multi-selects
    spanAEl!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(state.selections).toEqual([[1], [0]]);
    expect(spanAEl!.classList.contains('wb-selected')).toBe(true);
    expect(spanBEl!.classList.contains('wb-selected')).toBe(true);

    // Cleanup DOM
    host.remove();
  });

  it('propagates kvEditor style changes to all selected nodes via commitAll under multi-selection', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A', style: { color: 'red', 'font-size': '12px' } },
          { elmType: 'span', txtContent: 'Span B', style: { color: 'blue', 'font-weight': 'bold' } }
        ]
      }
    };

    // Select both children: Span A and Span B
    state.selectMulti([[0], [1]]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    mountInspector(host);

    const styleSection = [...host.querySelectorAll<HTMLDetailsElement>('.wb-inspector-section')]
      .find(s => s.querySelector('.wb-sec-title')?.textContent === 'Style (all properties)');
    expect(styleSection).toBeTruthy();

    const kvRows = styleSection!.querySelectorAll<HTMLElement>('.wb-kv-row');
    expect(kvRows).toHaveLength(2);

    const colorRow = [...kvRows].find(row => row.querySelector<HTMLInputElement>('.wb-kv-key')?.value === 'color');
    expect(colorRow).toBeTruthy();

    const colorValInput = colorRow!.querySelector<HTMLInputElement>('.wb-kv-val');
    expect(colorValInput?.value).toBe('red');

    // Simulate changing color from 'red' to 'green'
    colorValInput!.value = 'green';
    colorValInput!.dispatchEvent(new Event('change', { bubbles: true }));

    // Verify both nodes are updated to green
    const nodeA = state.nodeAt([0]);
    const nodeB = state.nodeAt([1]);
    expect(nodeA?.style?.color).toBe('green');
    expect(nodeB?.style?.color).toBe('green');

    // Check that non-modified styles are untouched
    expect(nodeA?.style?.['font-size']).toBe('12px');
    expect(nodeB?.style?.['font-weight']).toBe('bold');

    // Cleanup DOM
    host.remove();
  });

  it('preserves focus on the active input during kvEditor change commits (DOM recycling)', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A', style: { color: 'red' } }
        ]
      }
    };

    state.select([0]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    mountInspector(host);

    const styleSection = [...host.querySelectorAll<HTMLDetailsElement>('.wb-inspector-section')]
      .find(s => s.querySelector('.wb-sec-title')?.textContent === 'Style (all properties)');
    expect(styleSection).toBeTruthy();

    const colorRow = styleSection!.querySelector('.wb-kv-row');
    expect(colorRow).toBeTruthy();

    const colorValInput = colorRow!.querySelector<HTMLInputElement>('.wb-kv-val');
    expect(colorValInput).toBeTruthy();

    // Focus the input
    colorValInput!.focus();
    expect(document.activeElement).toBe(colorValInput);

    // Simulate typing/changing value
    colorValInput!.value = 'orange';
    colorValInput!.dispatchEvent(new Event('change', { bubbles: true }));

    // Focus must still be on the same input element
    expect(document.activeElement).toBe(colorValInput);
    expect(colorValInput!.value).toBe('orange');

    // Cleanup DOM
    host.remove();
  });

  it('does not leak subscribers when mounting panels multiple times because unsubscribe is called', () => {
    const initialListeners = (state as any).listeners.length;
    expect(initialListeners).toBe(0);

    const host = document.createElement('div');
    document.body.appendChild(host);

    // Mount once
    mountInspector(host);
    expect((state as any).listeners.length).toBe(1);

    // Mount again (simulating navigation or hot reload)
    mountInspector(host);
    expect((state as any).listeners.length).toBe(1); // Correctly disposed old listener

    // Mount tree view
    const viewHost = document.createElement('div');
    const colsHost = document.createElement('div');
    document.body.appendChild(viewHost);
    document.body.appendChild(colsHost);
    mountTree(viewHost, colsHost);
    expect((state as any).listeners.length).toBe(2); // 1 for inspector, 1 for tree view

    // Clean up DOM
    host.remove();
    viewHost.remove();
    colsHost.remove();
  });
});
